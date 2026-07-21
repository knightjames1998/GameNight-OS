// Ping Pong pack server routes: King of the Hill and Singles.
//
// Same server-owned-session shape as the other session packs (members join
// the host's session, live sync on every write, backed by the generic
// game_sessions table keyed by (eventId, pack='pingpong') so it can coexist
// with other packs on the same event). The difference is the ledger unit:
// the MATCH, not the game. One completed best-of-N match materializes one
// matches row plus two match_participants rows (winner placement 1, loser 2);
// the individual games and any optional points live only in the session
// jsonb. Match length rides matches.label; optional per-player points ride
// match_participants.score. No schema change (additive use of existing
// tables, same path Mario Kart uses).
//
// Doubles is explicitly out: match_participants is per player, so nothing
// here builds toward a team model.

import { Router } from "express";
import {
  getDb,
  events,
  games,
  gameSessions,
  matches,
  matchParticipants,
  memberships,
  rsvps,
  users,
  and,
  eq,
} from "@gamenight/db";
import {
  newPingPongState,
  recordGame,
  startFfaMatch,
  finalizeCurrent,
  undoLast,
  neededWins,
  summarizePingPong,
  matchGameTally,
  type PpSessionState,
  type PpPlayer,
  type PpMode,
  type PpBestOf,
  type PpMatch,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { broadcast } from "./ws.js";

const PACK = "pingpong";

export const pingPongRouter = Router();
export const pingPongTvRouter = Router();

// ---------- helpers ----------

async function roleOf(
  groupId: string,
  userId: string,
): Promise<"owner" | "admin" | "member" | undefined> {
  const rows = await getDb()
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, userId)))
    .limit(1);
  return rows[0]?.role;
}

const isHostRole = (r: string | undefined) => r === "owner" || r === "admin";

async function loadState(eventId: string): Promise<
  { row: typeof gameSessions.$inferSelect; state: PpSessionState } | null
> {
  const row = (
    await getDb()
      .select()
      .from(gameSessions)
      .where(and(eq(gameSessions.eventId, eventId), eq(gameSessions.pack, PACK)))
      .limit(1)
  )[0];
  if (!row) return null;
  return { row, state: row.state as unknown as PpSessionState };
}

async function saveState(
  eventId: string,
  state: PpSessionState,
  status: "setup" | "live" | "completed",
  origin?: string,
) {
  await getDb()
    .update(gameSessions)
    .set({ state: state as unknown as Record<string, unknown>, status, updatedAt: new Date() })
    .where(and(eq(gameSessions.eventId, eventId), eq(gameSessions.pack, PACK)));
  broadcast({ type: "ping_pong_updated", eventId }, origin);
}

/** The group's single Ping Pong game row, created on first use. */
async function ensureGame(groupId: string): Promise<string> {
  const db = getDb();
  const existing = (
    await db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.groupId, groupId), eq(games.pack, PACK)))
      .limit(1)
  )[0];
  if (existing) return existing.id;
  const created = (
    await db.insert(games).values({ groupId, name: "Ping Pong", pack: PACK }).returning()
  )[0]!;
  return created.id;
}

/**
 * Materialize one completed MATCH into the ledger. Keyed pp:{eventId}:{idx}.
 * Winner placement 1, loser placement 2. Match length rides matches.label;
 * each player's optional points (summed across the games they lost, the only
 * points we capture) ride match_participants.score, null when none entered.
 * Guests carry no lifetime stats, so they are skipped but counted and
 * reported rather than silently dropped.
 */
async function materializeMatch(
  groupId: string,
  eventId: string,
  gameId: string,
  match: PpMatch,
  state: PpSessionState,
): Promise<{ recorded: number; guests: number }> {
  if (!match.winnerId) return { recorded: 0, guests: 0 };
  const db = getDb();
  const key = `pp:${eventId}:${match.idx}`;
  const dupe = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.eventId, eventId), eq(matches.externalKey, key)))
    .limit(1);
  if (dupe[0]) return { recorded: 0, guests: 0 };

  const row = (
    await db
      .insert(matches)
      .values({
        groupId,
        gameId,
        eventId,
        externalKey: key,
        label: `bo${state.bestOf}`,
        round: 1,
        position: match.idx,
        status: "completed",
      })
      .returning()
  )[0]!;

  // Points captured are the loser's points per game; sum them per player.
  const points = new Map<string, number>();
  let anyPoints = false;
  for (const g of match.games) {
    if (g.loserPoints != null) {
      const gameLoserId = g.winnerId === match.aId ? match.bId : match.aId;
      points.set(gameLoserId, (points.get(gameLoserId) ?? 0) + g.loserPoints);
      anyPoints = true;
    }
  }

  // Per-player game wins/played, so lifetime "single game" totals survive
  // to the ledger (the games themselves are not materialized as rows).
  const tally = matchGameTally(match);

  const loserId = match.winnerId === match.aId ? match.bId : match.aId;
  const slotById = new Map(state.roster.map((p) => [p.id, p]));
  let recorded = 0;
  let guests = 0;
  for (const slotId of [match.winnerId, loserId]) {
    const slot = slotById.get(slotId);
    if (!slot || slot.kind === "guest" || !slot.userId) {
      guests++;
      continue;
    }
    const g = tally.get(slotId) ?? { wins: 0, played: 0 };
    await db
      .insert(matchParticipants)
      .values({
        groupId,
        matchId: row.id,
        userId: slot.userId,
        placement: slotId === match.winnerId ? 1 : 2,
        isWinner: slotId === match.winnerId,
        score: anyPoints ? points.get(slotId) ?? 0 : null,
        meta: { gameWins: g.wins, gamesPlayed: g.played },
      })
      .onConflictDoNothing();
    recorded++;
  }
  return { recorded, guests };
}

async function deleteMaterialized(eventId: string, idx: number) {
  const db = getDb();
  const key = `pp:${eventId}:${idx}`;
  const m = (
    await db
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.eventId, eventId), eq(matches.externalKey, key)))
      .limit(1)
  )[0];
  if (!m) return;
  await db.delete(matchParticipants).where(eq(matchParticipants.matchId, m.id));
  await db.delete(matches).where(eq(matches.id, m.id));
}

// ---------- launch context ----------

pingPongRouter.get("/pingpong-context/:eventId", requireAuth, async (req: AuthedRequest, res) => {
  const db = getDb();
  const event = (
    await db.select().from(events).where(eq(events.id, String(req.params.eventId))).limit(1)
  )[0];
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const role = await roleOf(event.groupId, req.user!.id);
  if (!role) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const yes = await db
    .select({ userId: rsvps.userId, displayName: users.displayName })
    .from(rsvps)
    .innerJoin(users, eq(rsvps.userId, users.id))
    .where(and(eq(rsvps.eventId, event.id), eq(rsvps.status, "yes")))
    .orderBy(rsvps.respondedAt);

  const members = await db
    .select({ userId: memberships.userId, displayName: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.groupId, event.groupId));

  const existing = await loadState(event.id);
  res.json({
    groupId: event.groupId,
    canHost: isHostRole(role),
    viewerId: req.user!.id,
    prefill: yes.map((r) => ({ userId: r.userId, name: r.displayName })),
    members: members.map((m) => ({ userId: m.userId, name: m.displayName })),
    live: !!existing && existing.row.status !== "completed",
  });
});

// ---------- read live state ----------

/**
 * The session payload the page renders. Mutations return this directly so
 * the acting client applies the response instead of refetching; the GETs
 * serve the same shape so the two can never disagree.
 */
async function sessionView(eventId: string) {
  const loaded = await loadState(eventId);
  if (!loaded) return { session: null };
  return {
    session: {
      status: loaded.row.status,
      groupId: loaded.row.groupId,
      ...loaded.state,
      needed: neededWins(loaded.state.bestOf),
      summary: summarizePingPong(loaded.state),
    },
  };
}

async function respondState(eventId: string, res: import("express").Response) {
  res.json(await sessionView(eventId));
}

pingPongRouter.get("/pingpong/:eventId", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await loadState(eventId);
  if (loaded && !(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await respondState(eventId, res);
});

// Public big-screen read. Event UUID is the access key. Mounted before the
// bare /api authed routers.
pingPongTvRouter.get("/pingpong/:eventId", async (req, res) => {
  await respondState(String(req.params.eventId), res);
});

// ---------- host: start ----------

pingPongRouter.post("/events/:eventId/pingpong", requireAuth, async (req: AuthedRequest, res) => {
  const db = getDb();
  const eventId = String(req.params.eventId);
  const event = (await db.select().from(events).where(eq(events.id, eventId)).limit(1))[0];
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (!isHostRole(await roleOf(event.groupId, req.user!.id))) {
    res.status(403).json({ error: "Only crew owners and admins can start a game" });
    return;
  }

  const mode = req.body?.mode as PpMode;
  if (mode !== "koth" && mode !== "ffa") {
    res.status(400).json({ error: "mode must be koth or ffa" });
    return;
  }
  const bestOf: PpBestOf = [1, 3, 5, 7].includes(Number(req.body?.bestOf))
    ? (Number(req.body.bestOf) as PpBestOf)
    : 3;

  // Don't clobber a session already in progress (standing rule 8).
  const existing = await loadState(eventId);
  if (existing && existing.row.status !== "completed" && existing.state.matches.length > 0) {
    res.status(409).json({ error: "A session is already in progress for this event" });
    return;
  }

  const rawRoster = Array.isArray(req.body?.roster) ? req.body.roster : [];
  const roster: PpPlayer[] = rawRoster
    .map((p: any, i: number): PpPlayer => {
      const name = String(p?.name ?? "").trim().slice(0, 24);
      const userId = typeof p?.userId === "string" ? p.userId : null;
      return { id: `p${i}_${Math.random().toString(36).slice(2, 8)}`, kind: userId ? "member" : "guest", userId, name };
    })
    .filter((p: PpPlayer) => p.name.length > 0)
    .slice(0, 16);

  if (roster.length < 2) {
    res.status(400).json({ error: "Add at least 2 players" });
    return;
  }

  const state = newPingPongState({ mode, bestOf, roster });
  await db
    .insert(gameSessions)
    .values({ eventId, pack: PACK, groupId: event.groupId, status: "live", state: state as any })
    .onConflictDoUpdate({
      target: [gameSessions.eventId, gameSessions.pack],
      set: { groupId: event.groupId, status: "live", state: state as any, updatedAt: new Date() },
    });
  broadcast({ type: "ping_pong_updated", eventId }, req.get("x-gn-client"));
  res.json(await sessionView(eventId));
});

// ---------- singles: start the next match (FFA only) ----------

pingPongRouter.post("/pingpong/:eventId/start-match", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  const role = await roleOf(loaded.row.groupId, req.user!.id);
  if (!role) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!isHostRole(role) && !loaded.state.openScoring) {
    res.status(403).json({ error: "Only the host starts matches (open scoring is off)" });
    return;
  }
  const ok = startFfaMatch(loaded.state, String(req.body?.aId ?? ""), String(req.body?.bId ?? ""));
  if (!ok) {
    res.status(400).json({ error: "Pick two different players; finish the current match first" });
    return;
  }
  await saveState(eventId, loaded.state, loaded.row.status, req.get("x-gn-client"));
  res.json(await sessionView(eventId));
});

// ---------- record a game (one tap on the winner) ----------

pingPongRouter.post("/pingpong/:eventId/record", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  const { state, row } = loaded;
  const role = await roleOf(row.groupId, req.user!.id);
  if (!role) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!isHostRole(role) && !state.openScoring) {
    res.status(403).json({ error: "Only the host records results (open scoring is off)" });
    return;
  }
  if (!state.current) {
    res.status(409).json({ error: "No match in progress" });
    return;
  }

  const winnerId = String(req.body?.winnerId ?? "");
  const lp = req.body?.loserPoints;
  const loserPoints = lp == null || lp === "" ? null : Number(lp);
  if (winnerId !== state.current.aId && winnerId !== state.current.bId) {
    res.status(400).json({ error: "Winner must be one of the two playing" });
    return;
  }

  const { completed } = recordGame(state, winnerId, loserPoints);

  const origin = req.get("x-gn-client");
  let report: { recorded: number; guests: number } | null = null;
  if (completed) {
    const gameId = await ensureGame(row.groupId);
    report = await materializeMatch(row.groupId, eventId, gameId, completed, state);
  }
  await saveState(eventId, state, "live", origin);
  if (completed) broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json({ ...(await sessionView(eventId)), ...(report ?? {}) });
});

// ---------- undo (one game, or the last completed match) ----------

pingPongRouter.post("/pingpong/:eventId/undo", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  const { state, row } = loaded;
  if (!isHostRole(await roleOf(row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Host only" });
    return;
  }
  const { unmaterializeIdx } = undoLast(state);
  const origin = req.get("x-gn-client");
  if (unmaterializeIdx != null) {
    await deleteMaterialized(eventId, unmaterializeIdx);
    await saveState(eventId, state, "live", origin);
    broadcast({ type: "leaderboard_updated", eventId }, origin);
  } else {
    await saveState(eventId, state, "live", origin);
  }
  res.json(await sessionView(eventId));
});

// ---------- host toggles + complete ----------

pingPongRouter.post("/pingpong/:eventId/open-scoring", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  if (!isHostRole(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Host only" });
    return;
  }
  loaded.state.openScoring = !!req.body?.open;
  await saveState(eventId, loaded.state, loaded.row.status, req.get("x-gn-client"));
  res.json(await sessionView(eventId));
});

pingPongRouter.post("/pingpong/:eventId/complete", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  if (!isHostRole(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Host only" });
    return;
  }
  // An in-progress best-of match would otherwise lose every game played in it
  // when the night is called. Finalize it to the game leader so those results
  // reach the ledger (and thus the recap and leaderboard) just like a match
  // that ran to its natural finish. A dead tie stays unrecorded.
  const origin = req.get("x-gn-client");
  const finalized = finalizeCurrent(loaded.state);
  if (finalized) {
    const gameId = await ensureGame(loaded.row.groupId);
    await materializeMatch(loaded.row.groupId, eventId, gameId, finalized, loaded.state);
  }
  await saveState(eventId, loaded.state, "completed", origin);
  if (finalized) broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json(await sessionView(eventId));
});

// ---------- lifetime crew stats ----------
// Reads the materialized ledger. A ping pong MATCH is one matches row, so
// match wins split by format come from matches.label (bo1 = free play, bo3
// /bo5/bo7). Individual game wins ride match_participants.meta.gameWins,
// which is why they can total the four games in a won bo7 plus every free
// play game. Kept separate from the generic aggregator like the other packs.

const FORMAT_LABELS: Record<string, string> = {
  bo1: "Free play",
  bo3: "Best of 3",
  bo5: "Best of 5",
  bo7: "Best of 7",
};

pingPongRouter.get("/groups/:id/pingpong-stats", requireAuth, async (req: AuthedRequest, res) => {
  const db = getDb();
  const groupId = String(req.params.id);
  if (!(await roleOf(groupId, req.user!.id))) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const game = (
    await db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.groupId, groupId), eq(games.pack, PACK)))
      .limit(1)
  )[0];
  if (!game) {
    res.json({ matches: 0, formats: [], byPlayer: [] });
    return;
  }

  const rows = await db
    .select({
      userId: matchParticipants.userId,
      displayName: users.displayName,
      isWinner: matchParticipants.isWinner,
      meta: matchParticipants.meta,
      label: matches.label,
      matchId: matchParticipants.matchId,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(users, eq(matchParticipants.userId, users.id))
    .where(and(eq(matches.groupId, groupId), eq(matches.gameId, game.id), eq(matches.status, "completed")));

  const matchIds = new Set<string>();
  const formatsSeen = new Set<string>();
  const byUser = new Map<
    string,
    {
      userId: string;
      name: string;
      matches: number;
      matchWins: number;
      gameWins: number;
      gamesPlayed: number;
      byFormat: Map<string, { wins: number; played: number }>;
    }
  >();

  for (const r of rows) {
    matchIds.add(r.matchId);
    const fmt = FORMAT_LABELS[r.label ?? ""] ?? "Other";
    formatsSeen.add(fmt);
    const meta = (r.meta as { gameWins?: number; gamesPlayed?: number } | null) ?? {};
    const p =
      byUser.get(r.userId) ??
      {
        userId: r.userId,
        name: r.displayName,
        matches: 0,
        matchWins: 0,
        gameWins: 0,
        gamesPlayed: 0,
        byFormat: new Map<string, { wins: number; played: number }>(),
      };
    p.matches++;
    if (r.isWinner) p.matchWins++;
    p.gameWins += meta.gameWins ?? 0;
    p.gamesPlayed += meta.gamesPlayed ?? 0;
    const f = p.byFormat.get(fmt) ?? { wins: 0, played: 0 };
    f.played++;
    if (r.isWinner) f.wins++;
    p.byFormat.set(fmt, f);
    byUser.set(r.userId, p);
  }

  // Stable format ordering for the columns.
  const ORDER = ["Free play", "Best of 3", "Best of 5", "Best of 7", "Other"];
  const formats = ORDER.filter((f) => formatsSeen.has(f));

  const byPlayer = [...byUser.values()]
    .map((p) => ({
      userId: p.userId,
      name: p.name,
      matches: p.matches,
      matchWins: p.matchWins,
      gameWins: p.gameWins,
      gamesPlayed: p.gamesPlayed,
      byFormat: formats.map((f) => ({ format: f, ...(p.byFormat.get(f) ?? { wins: 0, played: 0 }) })),
    }))
    .sort((a, b) => b.gameWins - a.gameWins || b.matchWins - a.matchWins);

  res.json({ matches: matchIds.size, formats, byPlayer });
});

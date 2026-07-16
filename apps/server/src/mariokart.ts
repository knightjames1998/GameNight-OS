// Mario Kart pack server routes: "general tracking" = FFA races.
//
// Same shape as the Smash pack (one server-side session per event so
// members join the host's session, each recorded race materializes into
// matches/match_participants with the racer as the character, live sync on
// every write), but FFA-only and backed by the generic game_sessions table
// keyed by (eventId, pack) so it can coexist with a Smash session or a
// bracket on the same event. The pure session logic is shared with Smash
// (packages/shared): a race is exactly an FFA game with a placement per
// racer, winner-only or full order.
//
// Beerio Kart is the OTHER Mario Kart format and is a separate branded pack
// (apps/server/src/beerio.ts); this file is only the general tracker.

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
  newSmashState,
  assignRandomFighters,
  validateFfa,
  isRacer,
  summarizeNight,
  MARIO_KART_RACERS,
  type SmashSessionState,
  type SmashPlayer,
  type SmashResultDetail,
  type SmashResultLine,
  type SmashGame,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { broadcast } from "./ws.js";

const PACK = "mario_kart";

export const marioKartRouter = Router();
export const marioKartTvRouter = Router();

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
  { row: typeof gameSessions.$inferSelect; state: SmashSessionState } | null
> {
  const row = (
    await getDb()
      .select()
      .from(gameSessions)
      .where(and(eq(gameSessions.eventId, eventId), eq(gameSessions.pack, PACK)))
      .limit(1)
  )[0];
  if (!row) return null;
  return { row, state: row.state as unknown as SmashSessionState };
}

async function saveState(
  eventId: string,
  state: SmashSessionState,
  status: "setup" | "live" | "completed",
) {
  await getDb()
    .update(gameSessions)
    .set({ state: state as unknown as Record<string, unknown>, status, updatedAt: new Date() })
    .where(and(eq(gameSessions.eventId, eventId), eq(gameSessions.pack, PACK)));
  broadcast({ type: "mario_kart_updated", eventId });
}

/** The group's single Mario Kart game row, created on first use. */
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
    await db.insert(games).values({ groupId, name: "Mario Kart", pack: PACK }).returning()
  )[0]!;
  return created.id;
}

/** Materialize one recorded race into the ledger. Keyed mk:{eventId}:{idx}. */
async function materializeGame(
  groupId: string,
  eventId: string,
  gameId: string,
  game: SmashGame,
  roster: SmashPlayer[],
): Promise<{ recorded: number; guests: number }> {
  const db = getDb();
  const key = `mk:${eventId}:${game.idx}`;
  const dupe = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.eventId, eventId), eq(matches.externalKey, key)))
    .limit(1);
  if (dupe[0]) return { recorded: 0, guests: 0 };

  const match = (
    await db
      .insert(matches)
      .values({
        groupId,
        gameId,
        eventId,
        externalKey: key,
        round: 1,
        position: game.idx,
        status: "completed",
      })
      .returning()
  )[0]!;

  const slotById = new Map(roster.map((p) => [p.id, p]));
  let recorded = 0;
  let guests = 0;
  for (const line of game.lines) {
    const slot = slotById.get(line.playerId);
    if (!slot || slot.kind === "guest" || !slot.userId) {
      guests++;
      continue;
    }
    await db
      .insert(matchParticipants)
      .values({
        groupId,
        matchId: match.id,
        userId: slot.userId,
        placement: line.placement,
        isWinner: line.isWinner,
        character: line.character ?? null,
      })
      .onConflictDoNothing();
    recorded++;
  }
  return { recorded, guests };
}

async function deleteMaterialized(eventId: string, idx: number) {
  const db = getDb();
  const key = `mk:${eventId}:${idx}`;
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

marioKartRouter.get("/mariokart-context/:eventId", requireAuth, async (req: AuthedRequest, res) => {
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

async function respondState(eventId: string, res: import("express").Response) {
  const loaded = await loadState(eventId);
  if (!loaded) {
    res.json({ session: null });
    return;
  }
  res.json({
    session: {
      status: loaded.row.status,
      groupId: loaded.row.groupId,
      ...loaded.state,
      summary: summarizeNight(loaded.state),
    },
  });
}

marioKartRouter.get("/mariokart/:eventId", requireAuth, async (req: AuthedRequest, res) => {
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
marioKartTvRouter.get("/mariokart/:eventId", async (req, res) => {
  await respondState(String(req.params.eventId), res);
});

// ---------- host: start / configure ----------

marioKartRouter.post("/events/:eventId/mariokart", requireAuth, async (req: AuthedRequest, res) => {
  const db = getDb();
  const eventId = String(req.params.eventId);
  const event = (await db.select().from(events).where(eq(events.id, eventId)).limit(1))[0];
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const role = await roleOf(event.groupId, req.user!.id);
  if (!isHostRole(role)) {
    res.status(403).json({ error: "Only crew owners and admins can start a game" });
    return;
  }

  const assignment = req.body?.assignment;
  const resultDetail = (req.body?.resultDetail ?? "winner") as SmashResultDetail;
  if (!["self", "random", "host"].includes(assignment)) {
    res.status(400).json({ error: "invalid assignment" });
    return;
  }

  // Don't clobber a session already in progress (standing rule 8).
  const existing = await loadState(eventId);
  if (existing && existing.row.status !== "completed" && existing.state.games.length > 0) {
    res.status(409).json({ error: "A session is already in progress for this event" });
    return;
  }

  const rawRoster = Array.isArray(req.body?.roster) ? req.body.roster : [];
  const roster: SmashPlayer[] = rawRoster
    .map((p: any, i: number): SmashPlayer => {
      const name = String(p?.name ?? "").trim().slice(0, 24);
      const userId = typeof p?.userId === "string" ? p.userId : null;
      return {
        id: `p${i}_${Math.random().toString(36).slice(2, 8)}`,
        kind: userId ? "member" : "guest",
        userId,
        name,
        character: isRacer(p?.character) ? p.character : null,
      };
    })
    .filter((p: SmashPlayer) => p.name.length > 0)
    .slice(0, 16);

  if (roster.length < 2) {
    res.status(400).json({ error: "Add at least 2 players" });
    return;
  }

  // Mario Kart general tracking is always FFA races.
  let state = newSmashState({ mode: "ffa", assignment, resultDetail, roster });
  if (assignment === "random") state.roster = assignRandomFighters(state.roster, MARIO_KART_RACERS);

  await db
    .insert(gameSessions)
    .values({ eventId, pack: PACK, groupId: event.groupId, status: "live", state: state as any })
    .onConflictDoUpdate({
      target: [gameSessions.eventId, gameSessions.pack],
      set: { groupId: event.groupId, status: "live", state: state as any, updatedAt: new Date() },
    });
  broadcast({ type: "mario_kart_updated", eventId });
  res.json({ ok: true });
});

// ---------- assignment ----------

marioKartRouter.post("/mariokart/:eventId/character", requireAuth, async (req: AuthedRequest, res) => {
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
  const playerId = String(req.body?.playerId ?? "");
  const character = req.body?.character;
  if (character !== null && !isRacer(character)) {
    res.status(400).json({ error: "Unknown racer" });
    return;
  }
  const slot = loaded.state.roster.find((p) => p.id === playerId);
  if (!slot) {
    res.status(404).json({ error: "Player not in session" });
    return;
  }
  const owns = slot.userId && slot.userId === req.user!.id;
  if (!isHostRole(role) && !owns) {
    res.status(403).json({ error: "You can only set your own racer" });
    return;
  }
  if (!isHostRole(role) && loaded.state.assignment !== "self") {
    res.status(403).json({ error: "The host is assigning racers this session" });
    return;
  }
  slot.character = character ?? null;
  await saveState(eventId, loaded.state, loaded.row.status);
  res.json({ ok: true });
});

marioKartRouter.post("/mariokart/:eventId/randomize", requireAuth, async (req: AuthedRequest, res) => {
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
  loaded.state.roster = assignRandomFighters(loaded.state.roster, MARIO_KART_RACERS);
  await saveState(eventId, loaded.state, loaded.row.status);
  res.json({ ok: true });
});

// ---------- record a race ----------

marioKartRouter.post("/mariokart/:eventId/record", requireAuth, async (req: AuthedRequest, res) => {
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

  const slotIds = new Set(state.roster.map((p) => p.id));
  const charOf = new Map(state.roster.map((p) => [p.id, p.character]));

  const raw = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const lines: SmashResultLine[] = raw
    .filter((l: any) => slotIds.has(String(l?.playerId)))
    .map((l: any) => ({
      playerId: String(l.playerId),
      character: isRacer(l?.character) ? l.character : (charOf.get(String(l.playerId)) ?? null),
      placement: Number(l?.placement) || 0,
      isWinner: !!l?.isWinner,
    }));
  if (state.resultDetail === "winner") {
    for (const l of lines) l.placement = l.isWinner ? 1 : 2;
  } else {
    for (const l of lines) l.isWinner = l.placement === 1;
  }
  const err = validateFfa(lines, state.resultDetail);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }

  const game: SmashGame = {
    idx: state.games.length,
    mode: "ffa",
    lines,
    at: new Date().toISOString(),
  };
  state.games.push(game);

  const gameId = await ensureGame(row.groupId);
  const report = await materializeGame(row.groupId, eventId, gameId, game, state.roster);

  await saveState(eventId, state, "live");
  broadcast({ type: "leaderboard_updated", eventId });
  res.json({ ok: true, ...report });
});

marioKartRouter.post("/mariokart/:eventId/undo", requireAuth, async (req: AuthedRequest, res) => {
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
  const last = state.games.pop();
  if (!last) {
    res.json({ ok: true, empty: true });
    return;
  }
  await deleteMaterialized(eventId, last.idx);
  await saveState(eventId, state, "live");
  broadcast({ type: "leaderboard_updated", eventId });
  res.json({ ok: true });
});

marioKartRouter.post("/mariokart/:eventId/open-scoring", requireAuth, async (req: AuthedRequest, res) => {
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
  await saveState(eventId, loaded.state, loaded.row.status);
  res.json({ ok: true, openScoring: loaded.state.openScoring });
});

marioKartRouter.post("/mariokart/:eventId/complete", requireAuth, async (req: AuthedRequest, res) => {
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
  await saveState(eventId, loaded.state, "completed");
  res.json({ ok: true });
});

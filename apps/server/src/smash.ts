// Smash pack server routes (Session A: FFA Night + King of the Hill).
//
// The live session is one server-side row per event (smash_sessions),
// so every member joins the HOST's session instead of a local copy
// (standing rule 2). Each completed game materializes into
// matches/match_participants with the fighter recorded on each
// participant, so lifetime "wins with <fighter>" survives the night
// (standing rule 5). Live sync rides the shared WebSocket hub: every
// write calls broadcast(), nobody refreshes (standing rule 6).
//
// Two routers are exported: smashRouter (authed, per-route) for play, and
// smashTvRouter (public, read-only) for the big screen. The TV router
// MUST mount before the bare /api authed routers (standing environment
// rule: router-level auth 401s before fall-through).

import { Router } from "express";
import {
  getDb,
  events,
  games,
  matches,
  matchParticipants,
  memberships,
  rsvps,
  smashSessions,
  users,
  and,
  eq,
  inArray,
} from "@gamenight/db";
import {
  newSmashState,
  assignRandomFighters,
  SMASH_TITLES,
  rosterForTitle,
  kothAdvance,
  validateFfa,
  isFighter,
  summarizeNight,
  type SmashSessionState,
  type SmashPlayer,
  type SmashMode,
  type SmashAssignment,
  type SmashResultDetail,
  type SmashResultLine,
  type SmashGame,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { broadcast } from "./ws.js";

export const smashRouter = Router();
export const smashTvRouter = Router();

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
  { row: typeof smashSessions.$inferSelect; state: SmashSessionState } | null
> {
  const row = (
    await getDb().select().from(smashSessions).where(eq(smashSessions.eventId, eventId)).limit(1)
  )[0];
  if (!row) return null;
  return { row, state: row.state as unknown as SmashSessionState };
}

async function saveState(
  eventId: string,
  groupId: string,
  state: SmashSessionState,
  status: "setup" | "live" | "completed",
  origin?: string,
) {
  await getDb()
    .update(smashSessions)
    .set({ state: state as unknown as Record<string, unknown>, status, updatedAt: new Date() })
    .where(eq(smashSessions.eventId, eventId));
  broadcast({ type: "smash_updated", eventId }, origin);
}

/** The group's single Smash game row, created on first use (pack "smash"). */
async function ensureSmashGame(groupId: string): Promise<string> {
  const db = getDb();
  const existing = (
    await db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.groupId, groupId), eq(games.pack, "smash")))
      .limit(1)
  )[0];
  if (existing) return existing.id;
  const created = (
    await db.insert(games).values({ groupId, name: "Smash Bros", pack: "smash" }).returning()
  )[0]!;
  return created.id;
}

/**
 * Materialize one recorded game into the ledger. One matches row keyed by
 * smash:{eventId}:{idx} (idempotent via the event/externalKey unique
 * index), one match_participants row per MEMBER with placement, winner
 * flag, and the fighter played. Guests (no userId) are skipped but
 * counted, and we report the count rather than dropping them silently.
 */
async function materializeGame(
  groupId: string,
  eventId: string,
  gameId: string,
  game: SmashGame,
  roster: SmashPlayer[],
): Promise<{ recorded: number; guests: number }> {
  const db = getDb();
  const key = `smash:${eventId}:${game.idx}`;
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
  const key = `smash:${eventId}:${idx}`;
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

/**
 * Setup context for the launcher: yes-RSVP prefill (never clobbers an
 * in-progress session, standing rule 8), the crew's members for roster
 * building, whether the viewer can host, and the viewer's own userId so
 * the client knows which slot is "you" for self-select.
 */
smashRouter.get("/smash-context/:eventId", requireAuth, async (req: AuthedRequest, res) => {
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
      summary: summarizeNight(loaded.state),
    },
  };
}

async function respondState(eventId: string, res: import("express").Response) {
  res.json(await sessionView(eventId));
}

smashRouter.get("/smash/:eventId", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await loadState(eventId);
  if (loaded && !(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await respondState(eventId, res);
});

// Public big-screen read. Event UUID is the access key, same model as the
// bracket TV view. Mounted before authed routers so it is reachable
// without a session.
smashTvRouter.get("/smash/:eventId", async (req, res) => {
  await respondState(String(req.params.eventId), res);
});

// ---------- host: start / configure ----------

smashRouter.post("/events/:eventId/smash", requireAuth, async (req: AuthedRequest, res) => {
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

  const mode = req.body?.mode as SmashMode;
  const assignment = req.body?.assignment as SmashAssignment;
  const resultDetail = (req.body?.resultDetail ?? "winner") as SmashResultDetail;
  if (mode !== "ffa" && mode !== "koth") {
    res.status(400).json({ error: "mode must be ffa or koth" });
    return;
  }
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
        character: isFighter(p?.character) ? p.character : null,
      };
    })
    .filter((p: SmashPlayer) => p.name.length > 0)
    .slice(0, 16);

  if (roster.length < 2) {
    res.status(400).json({ error: "Add at least 2 players" });
    return;
  }

  const titleId = SMASH_TITLES.some((t) => t.id === req.body?.titleId)
    ? String(req.body.titleId)
    : SMASH_TITLES[0]!.id;
  const pool = rosterForTitle(SMASH_TITLES, titleId);

  let state = newSmashState({ titleId, mode, assignment, resultDetail, roster });
  if (assignment === "random") state.roster = assignRandomFighters(state.roster, pool);

  await db
    .insert(smashSessions)
    .values({ eventId, groupId: event.groupId, status: "live", state: state as any })
    .onConflictDoUpdate({
      target: smashSessions.eventId,
      set: { groupId: event.groupId, status: "live", state: state as any, updatedAt: new Date() },
    });
  broadcast({ type: "smash_updated", eventId }, req.get("x-gn-client"));
  res.json(await sessionView(eventId));
});

// ---------- assignment ----------

// Set one player's fighter. Self-select: a member sets THEIR OWN slot.
// Host may set any slot. Guests are always host-set.
smashRouter.post("/smash/:eventId/character", requireAuth, async (req: AuthedRequest, res) => {
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
  const titlePool = rosterForTitle(SMASH_TITLES, loaded.state.titleId);
  if (character !== null && !titlePool.includes(character)) {
    res.status(400).json({ error: "That fighter isn't in this game" });
    return;
  }
  const slot = loaded.state.roster.find((p) => p.id === playerId);
  if (!slot) {
    res.status(404).json({ error: "Player not in session" });
    return;
  }
  const owns = slot.userId && slot.userId === req.user!.id;
  if (!isHostRole(role) && !owns) {
    res.status(403).json({ error: "You can only set your own fighter" });
    return;
  }
  if (!isHostRole(role) && loaded.state.assignment !== "self") {
    res.status(403).json({ error: "The host is assigning fighters this session" });
    return;
  }
  slot.character = character ?? null;
  await saveState(eventId, loaded.row.groupId, loaded.state, loaded.row.status, req.get("x-gn-client"));
  res.json(await sessionView(eventId));
});

// Host re-rolls random fighters for everyone.
smashRouter.post("/smash/:eventId/randomize", requireAuth, async (req: AuthedRequest, res) => {
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
  loaded.state.roster = assignRandomFighters(
    loaded.state.roster,
    rosterForTitle(SMASH_TITLES, loaded.state.titleId),
  );
  await saveState(eventId, loaded.row.groupId, loaded.state, loaded.row.status, req.get("x-gn-client"));
  res.json(await sessionView(eventId));
});

// ---------- record a game / round ----------

smashRouter.post("/smash/:eventId/record", requireAuth, async (req: AuthedRequest, res) => {
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
  let lines: SmashResultLine[];

  if (state.mode === "koth") {
    // Round input is just the winner id; the pair is derived from state.
    const koth = state.koth!;
    const pair = koth.kingId && koth.queue[0] ? [koth.kingId, koth.queue[0]] : null;
    if (!pair) {
      res.status(400).json({ error: "Not enough players queued" });
      return;
    }
    const winnerId = String(req.body?.winnerId ?? "");
    if (!pair.includes(winnerId)) {
      res.status(400).json({ error: "Winner must be one of the two playing" });
      return;
    }
    const loserId = pair.find((id) => id !== winnerId)!;
    lines = [
      { playerId: winnerId, character: charOf.get(winnerId) ?? null, placement: 1, isWinner: true },
      { playerId: loserId, character: charOf.get(loserId) ?? null, placement: 2, isWinner: false },
    ];
    state.koth = kothAdvance(koth, winnerId, loserId);
  } else {
    // FFA: client sends the full line set. Validate against roster + detail.
    const raw = Array.isArray(req.body?.lines) ? req.body.lines : [];
    lines = raw
      .filter((l: any) => slotIds.has(String(l?.playerId)))
      .map((l: any) => ({
        playerId: String(l.playerId),
        character: isFighter(l?.character) ? l.character : (charOf.get(String(l.playerId)) ?? null),
        placement: Number(l?.placement) || 0,
        isWinner: !!l?.isWinner,
      }));
    if (state.resultDetail === "winner") {
      // Winner-only: everyone else is placement 2 (tied second), one winner.
      for (const l of lines) l.placement = l.isWinner ? 1 : 2;
    } else {
      for (const l of lines) l.isWinner = l.placement === 1;
    }
    const err = validateFfa(lines, state.resultDetail);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
  }

  const game: SmashGame = {
    idx: state.games.length,
    mode: state.mode,
    lines,
    at: new Date().toISOString(),
  };
  state.games.push(game);

  const gameId = await ensureSmashGame(row.groupId);
  const report = await materializeGame(row.groupId, eventId, gameId, game, state.roster);

  const origin = req.get("x-gn-client");
  await saveState(eventId, row.groupId, state, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json({ ...(await sessionView(eventId)), ...report });
});

// Undo the last recorded game (host only): drop the ledger rows and replay
// KOTH state from scratch so the throne/queue can't drift.
smashRouter.post("/smash/:eventId/undo", requireAuth, async (req: AuthedRequest, res) => {
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
    res.json({ ...(await sessionView(eventId)), empty: true });
    return;
  }
  await deleteMaterialized(eventId, last.idx);

  if (state.mode === "koth") {
    // Rebuild from the opening throne (roster[0]) by replaying survivors.
    let koth = {
      kingId: state.roster[0]?.id ?? null,
      queue: state.roster.slice(1).map((p) => p.id),
      streak: 0,
      bestStreak: null as { playerId: string; streak: number } | null,
    };
    for (const g of state.games) {
      const w = g.lines.find((l) => l.isWinner);
      const lo = g.lines.find((l) => !l.isWinner);
      if (w && lo) koth = kothAdvance(koth, w.playerId, lo.playerId);
    }
    state.koth = koth;
  }
  const origin = req.get("x-gn-client");
  await saveState(eventId, row.groupId, state, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json(await sessionView(eventId));
});

// Host toggles open scoring (members may record when on). Defaults off.
smashRouter.post("/smash/:eventId/open-scoring", requireAuth, async (req: AuthedRequest, res) => {
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
  await saveState(eventId, loaded.row.groupId, loaded.state, loaded.row.status, req.get("x-gn-client"));
  res.json(await sessionView(eventId));
});

// Host ends the night.
smashRouter.post("/smash/:eventId/complete", requireAuth, async (req: AuthedRequest, res) => {
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
  await saveState(eventId, loaded.row.groupId, loaded.state, "completed", req.get("x-gn-client"));
  res.json(await sessionView(eventId));
});

// ---------- lifetime character stats ----------
// The Smash-specific stat view: wins by fighter and each member's main,
// read from the materialized ledger (pack "smash"). Kept separate from the
// generic stats endpoint so the character focus doesn't bloat it.
smashRouter.get("/groups/:id/smash-stats", requireAuth, async (req: AuthedRequest, res) => {
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
      .where(and(eq(games.groupId, groupId), eq(games.pack, "smash")))
      .limit(1)
  )[0];
  if (!game) {
    res.json({ games: 0, byCharacter: [], byPlayer: [] });
    return;
  }

  const rows = await db
    .select({
      userId: matchParticipants.userId,
      displayName: users.displayName,
      character: matchParticipants.character,
      isWinner: matchParticipants.isWinner,
      placement: matchParticipants.placement,
      matchId: matchParticipants.matchId,
      eventId: matches.eventId,
      position: matches.position,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(users, eq(matchParticipants.userId, users.id))
    .where(and(eq(matches.groupId, groupId), eq(matches.gameId, game.id), eq(matches.status, "completed")));

  const chars = new Map<string, { character: string; played: number; wins: number }>();
  const players = new Map<
    string,
    { userId: string; name: string; played: number; wins: number; counts: Map<string, number> }
  >();
  const matchIds = new Set<string>();

  for (const r of rows) {
    matchIds.add(r.matchId);
    if (r.character) {
      const c = chars.get(r.character) ?? { character: r.character, played: 0, wins: 0 };
      c.played++;
      if (r.isWinner) c.wins++;
      chars.set(r.character, c);
    }
    const p =
      players.get(r.userId) ??
      { userId: r.userId, name: r.displayName, played: 0, wins: 0, counts: new Map<string, number>() };
    p.played++;
    if (r.isWinner) p.wins++;
    if (r.character) p.counts.set(r.character, (p.counts.get(r.character) ?? 0) + 1);
    players.set(r.userId, p);
  }

  // Best win streak: longest run of consecutive wins within a single night,
  // ordering each player's games by position. This is the KOTH "king on a
  // roll" stat, and it reads sensibly for FFA too (games won in a row).
  const streakBest = new Map<string, number>();
  const byUserEvent = new Map<string, { position: number; isWinner: boolean }[]>();
  for (const r of rows) {
    const key = `${r.userId}|${r.eventId ?? ""}`;
    (byUserEvent.get(key) ?? byUserEvent.set(key, []).get(key)!).push({
      position: r.position ?? 0,
      isWinner: r.isWinner,
    });
  }
  for (const [key, list] of byUserEvent) {
    const userId = key.split("|")[0]!;
    list.sort((a, b) => a.position - b.position);
    let run = 0;
    let best = 0;
    for (const g of list) {
      run = g.isWinner ? run + 1 : 0;
      if (run > best) best = run;
    }
    streakBest.set(userId, Math.max(streakBest.get(userId) ?? 0, best));
  }

  // Head-to-head: for every match two members shared, the better placement
  // wins the meeting. Ties (equal placement, e.g. both non-winners in a
  // winner-only FFA) count as a meeting with no edge, so records stay honest.
  const byMatch = new Map<string, { userId: string; placement: number | null }[]>();
  for (const r of rows) {
    (byMatch.get(r.matchId) ?? byMatch.set(r.matchId, []).get(r.matchId)!).push({
      userId: r.userId,
      placement: r.placement,
    });
  }
  const nameOf = new Map([...players.values()].map((p) => [p.userId, p.name]));
  const h2h = new Map<string, { a: string; b: string; aWins: number; bWins: number; meetings: number }>();
  for (const parts of byMatch.values()) {
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const [x, y] = [parts[i]!, parts[j]!];
        const a = x.userId < y.userId ? x : y;
        const b = x.userId < y.userId ? y : x;
        const key = `${a.userId}|${b.userId}`;
        const rec = h2h.get(key) ?? { a: a.userId, b: b.userId, aWins: 0, bWins: 0, meetings: 0 };
        rec.meetings++;
        const ap = a.placement ?? 99;
        const bp = b.placement ?? 99;
        if (ap < bp) rec.aWins++;
        else if (bp < ap) rec.bWins++;
        h2h.set(key, rec);
      }
    }
  }

  const byPlayer = [...players.values()].map((p) => {
    let main: string | null = null;
    const variety = p.counts.size;
    let max = 0;
    for (const [c, n] of p.counts) if (n > max) ((max = n), (main = c));
    return {
      userId: p.userId,
      name: p.name,
      played: p.played,
      wins: p.wins,
      winRate: p.played ? p.wins / p.played : 0,
      main,
      variety,
      bestStreak: streakBest.get(p.userId) ?? 0,
    };
  });

  const headToHead = [...h2h.values()]
    .filter((r) => r.aWins + r.bWins > 0)
    .map((r) => ({
      aUserId: r.a,
      bUserId: r.b,
      aName: nameOf.get(r.a) ?? "?",
      bName: nameOf.get(r.b) ?? "?",
      aWins: r.aWins,
      bWins: r.bWins,
      meetings: r.meetings,
    }))
    .sort((x, y) => y.meetings - x.meetings || y.aWins + y.bWins - (x.aWins + x.bWins));

  res.json({
    games: matchIds.size,
    byCharacter: [...chars.values()]
      .map((c) => ({ ...c, winRate: c.played ? c.wins / c.played : 0 }))
      .sort((a, b) => b.wins - a.wins || b.played - a.played),
    byPlayer: byPlayer.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate),
    headToHead,
  });
});

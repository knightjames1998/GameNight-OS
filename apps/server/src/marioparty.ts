// Mario Party pack server routes.
//
// Session-based like Smash/Mario Kart (one server-side session per event on
// the generic game_sessions table keyed by (eventId, pack), members join the
// host's session, live sync on every write), but a game is one BOARD with a
// total-star count per player, so it records more than an FFA placement:
//   - the board goes on matches.label,
//   - total stars go on match_participants.score,
//   - the character on match_participants.character,
//   - bonus stars on match_participants.meta ({ bonusStars: [...] }).
// The winner is the most stars; a top tie is resolved by the host.
//
// Two new nullable columns back this: matches.label and
// match_participants.meta. Both are additive; ship the idempotent SQL with
// the deploy and confirm the drizzle push applied.

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
  newMpState,
  assignRandomFighters,
  rankMpLines,
  summarizeMpNight,
  MARIO_PARTY_TITLES,
  bonusStarsForTitle,
  bonusFamilyOf,
  rosterForTitle,
  type MpSessionState,
  type MpGame,
  type MpRawEntry,
  type SmashPlayer,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { broadcast } from "./ws.js";

const PACK = "mario_party";

export const marioPartyRouter = Router();
export const marioPartyTvRouter = Router();

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
  { row: typeof gameSessions.$inferSelect; state: MpSessionState } | null
> {
  const row = (
    await getDb()
      .select()
      .from(gameSessions)
      .where(and(eq(gameSessions.eventId, eventId), eq(gameSessions.pack, PACK)))
      .limit(1)
  )[0];
  if (!row) return null;
  return { row, state: row.state as unknown as MpSessionState };
}

async function saveState(
  eventId: string,
  state: MpSessionState,
  status: "setup" | "live" | "completed",
  origin?: string,
) {
  await getDb()
    .update(gameSessions)
    .set({ state: state as unknown as Record<string, unknown>, status, updatedAt: new Date() })
    .where(and(eq(gameSessions.eventId, eventId), eq(gameSessions.pack, PACK)));
  broadcast({ type: "mario_party_updated", eventId }, origin);
}

/** The group's single Mario Party game row, created on first use. */
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
    await db.insert(games).values({ groupId, name: "Mario Party", pack: PACK }).returning()
  )[0]!;
  return created.id;
}

/** Materialize one recorded board into the ledger. Keyed mp:{eventId}:{idx}. */
async function materializeGame(
  groupId: string,
  eventId: string,
  gameId: string,
  game: MpGame,
  roster: SmashPlayer[],
): Promise<{ recorded: number; guests: number }> {
  const db = getDb();
  const key = `mp:${eventId}:${game.idx}`;
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
        label: game.map,
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
        score: line.stars,
        placement: line.placement,
        isWinner: line.isWinner,
        character: line.character ?? null,
        meta: line.bonusStars.length ? { bonusStars: line.bonusStars } : null,
      })
      .onConflictDoNothing();
    recorded++;
  }
  return { recorded, guests };
}

async function deleteMaterialized(eventId: string, idx: number) {
  const db = getDb();
  const key = `mp:${eventId}:${idx}`;
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

marioPartyRouter.get("/marioparty-context/:eventId", requireAuth, async (req: AuthedRequest, res) => {
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
      summary: summarizeMpNight(loaded.state),
    },
  };
}

async function respondState(eventId: string, res: import("express").Response) {
  res.json(await sessionView(eventId));
}

marioPartyRouter.get("/marioparty/:eventId", requireAuth, async (req: AuthedRequest, res) => {
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
marioPartyTvRouter.get("/marioparty/:eventId", async (req, res) => {
  await respondState(String(req.params.eventId), res);
});

// ---------- host: start / configure ----------

marioPartyRouter.post("/events/:eventId/marioparty", requireAuth, async (req: AuthedRequest, res) => {
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
  if (!["self", "random", "host"].includes(assignment)) {
    res.status(400).json({ error: "invalid assignment" });
    return;
  }

  const existing = await loadState(eventId);
  if (existing && existing.row.status !== "completed" && existing.state.games.length > 0) {
    res.status(409).json({ error: "A session is already in progress for this event" });
    return;
  }

  const titleId = MARIO_PARTY_TITLES.some((t) => t.id === req.body?.titleId)
    ? String(req.body.titleId)
    : MARIO_PARTY_TITLES[0]!.id;
  const pool = rosterForTitle(MARIO_PARTY_TITLES, titleId);

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
        character: pool.includes(p?.character) ? p.character : null,
      };
    })
    .filter((p: SmashPlayer) => p.name.length > 0)
    .slice(0, 4);

  if (roster.length < 2) {
    res.status(400).json({ error: "Add at least 2 players" });
    return;
  }

  let state = newMpState({ titleId, assignment, roster });
  if (assignment === "random") state.roster = assignRandomFighters(state.roster, pool);

  await db
    .insert(gameSessions)
    .values({ eventId, pack: PACK, groupId: event.groupId, status: "live", state: state as any })
    .onConflictDoUpdate({
      target: [gameSessions.eventId, gameSessions.pack],
      set: { groupId: event.groupId, status: "live", state: state as any, updatedAt: new Date() },
    });
  broadcast({ type: "mario_party_updated", eventId }, req.get("x-gn-client"));
  res.json(await sessionView(eventId));
});

// ---------- assignment ----------

marioPartyRouter.post("/marioparty/:eventId/character", requireAuth, async (req: AuthedRequest, res) => {
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
  const titlePool = rosterForTitle(MARIO_PARTY_TITLES, loaded.state.titleId);
  if (character !== null && !titlePool.includes(character)) {
    res.status(400).json({ error: "That character isn't in this game" });
    return;
  }
  const slot = loaded.state.roster.find((p) => p.id === playerId);
  if (!slot) {
    res.status(404).json({ error: "Player not in session" });
    return;
  }
  const owns = slot.userId && slot.userId === req.user!.id;
  if (!isHostRole(role) && !owns) {
    res.status(403).json({ error: "You can only set your own character" });
    return;
  }
  if (!isHostRole(role) && loaded.state.assignment !== "self") {
    res.status(403).json({ error: "The host is assigning characters this session" });
    return;
  }
  slot.character = character ?? null;
  await saveState(eventId, loaded.state, loaded.row.status, req.get("x-gn-client"));
  res.json(await sessionView(eventId));
});

marioPartyRouter.post("/marioparty/:eventId/randomize", requireAuth, async (req: AuthedRequest, res) => {
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
    rosterForTitle(MARIO_PARTY_TITLES, loaded.state.titleId),
  );
  await saveState(eventId, loaded.state, loaded.row.status, req.get("x-gn-client"));
  res.json(await sessionView(eventId));
});

// ---------- record a board ----------

marioPartyRouter.post("/marioparty/:eventId/record", requireAuth, async (req: AuthedRequest, res) => {
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

  const map = String(req.body?.map ?? "").trim().slice(0, 60);
  if (!map) {
    res.status(400).json({ error: "Pick a board" });
    return;
  }

  const slotIds = new Set(state.roster.map((p) => p.id));
  const charOf = new Map(state.roster.map((p) => [p.id, p.character]));
  const allowedBonus = new Set(bonusStarsForTitle(state.titleId));

  const raw = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const entries: MpRawEntry[] = raw
    .filter((l: any) => slotIds.has(String(l?.playerId)))
    .map((l: any) => ({
      playerId: String(l.playerId),
      character: charOf.get(String(l.playerId)) ?? null,
      stars: Math.max(0, Math.min(99, Math.floor(Number(l?.stars) || 0))),
      bonusStars: Array.isArray(l?.bonusStars)
        ? [...new Set<string>((l.bonusStars as unknown[]).map((x) => String(x)))].filter((b) => allowedBonus.has(b))
        : [],
    }));

  const winnerId = req.body?.winnerId ? String(req.body.winnerId) : null;
  const { lines, error } = rankMpLines(entries, winnerId);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  const game: MpGame = {
    idx: state.games.length,
    map,
    lines,
    at: new Date().toISOString(),
  };
  state.games.push(game);

  const gameId = await ensureGame(row.groupId);
  const report = await materializeGame(row.groupId, eventId, gameId, game, state.roster);

  const origin = req.get("x-gn-client");
  await saveState(eventId, state, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json({ ...(await sessionView(eventId)), ...report });
});

marioPartyRouter.post("/marioparty/:eventId/undo", requireAuth, async (req: AuthedRequest, res) => {
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
  const origin = req.get("x-gn-client");
  await saveState(eventId, state, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json(await sessionView(eventId));
});

marioPartyRouter.post("/marioparty/:eventId/open-scoring", requireAuth, async (req: AuthedRequest, res) => {
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

marioPartyRouter.post("/marioparty/:eventId/complete", requireAuth, async (req: AuthedRequest, res) => {
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
  await saveState(eventId, loaded.state, "completed", req.get("x-gn-client"));
  res.json(await sessionView(eventId));
});

// ---------- lifetime Mario Party stats ----------
// Everything the pack tracks, read from the ledger: wins/win rate, total &
// average stars, wins by board, bonus-star breakdown, character stats.
marioPartyRouter.get("/groups/:id/marioparty-stats", requireAuth, async (req: AuthedRequest, res) => {
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
    res.json({ games: 0, byPlayer: [], byMap: [], byCharacter: [], bonusLeaders: [] });
    return;
  }

  const rows = await db
    .select({
      userId: matchParticipants.userId,
      displayName: users.displayName,
      character: matchParticipants.character,
      isWinner: matchParticipants.isWinner,
      stars: matchParticipants.score,
      meta: matchParticipants.meta,
      matchId: matchParticipants.matchId,
      map: matches.label,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(users, eq(matchParticipants.userId, users.id))
    .where(and(eq(matches.groupId, groupId), eq(matches.gameId, game.id), eq(matches.status, "completed")));

  const matchIds = new Set<string>();
  const players = new Map<
    string,
    {
      userId: string;
      name: string;
      games: number;
      wins: number;
      totalStars: number;
      charCounts: Map<string, number>;
      bonus: Map<string, number>;
    }
  >();
  const chars = new Map<string, { character: string; played: number; wins: number }>();
  const maps = new Map<string, { map: string; games: number; winners: Map<string, number> }>();
  const bonusByType = new Map<string, Map<string, number>>(); // star -> name -> count

  for (const r of rows) {
    matchIds.add(r.matchId);
    const p =
      players.get(r.userId) ??
      {
        userId: r.userId,
        name: r.displayName,
        games: 0,
        wins: 0,
        totalStars: 0,
        charCounts: new Map<string, number>(),
        bonus: new Map<string, number>(),
      };
    p.games++;
    if (r.isWinner) p.wins++;
    p.totalStars += r.stars ?? 0;
    if (r.character) p.charCounts.set(r.character, (p.charCounts.get(r.character) ?? 0) + 1);

    if (r.character) {
      const c = chars.get(r.character) ?? { character: r.character, played: 0, wins: 0 };
      c.played++;
      if (r.isWinner) c.wins++;
      chars.set(r.character, c);
    }

    if (r.map) {
      const m = maps.get(r.map) ?? { map: r.map, games: 0, winners: new Map<string, number>() };
      // count games per map once (via winner row) — but rows are per player,
      // so track distinct matches per map separately below.
      if (r.isWinner) m.winners.set(r.displayName, (m.winners.get(r.displayName) ?? 0) + 1);
      maps.set(r.map, m);
    }

    const bonus = (r.meta as { bonusStars?: unknown } | null)?.bonusStars;
    if (Array.isArray(bonus)) {
      for (const b of bonus) {
        // Titles rename the same award (Coin Star / Rich Star / Rich
        // Bonus), so lifetime totals aggregate by family.
        const star = bonusFamilyOf(String(b));
        p.bonus.set(star, (p.bonus.get(star) ?? 0) + 1);
        const byName = bonusByType.get(star) ?? new Map<string, number>();
        byName.set(r.displayName, (byName.get(r.displayName) ?? 0) + 1);
        bonusByType.set(star, byName);
      }
    }
    players.set(r.userId, p);
  }

  // distinct games per map (count unique matchIds per map)
  const mapGameCounts = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.map) continue;
    const s = mapGameCounts.get(r.map) ?? new Set<string>();
    s.add(r.matchId);
    mapGameCounts.set(r.map, s);
  }

  const byPlayer = [...players.values()]
    .map((p) => {
      let main: string | null = null;
      let max = 0;
      for (const [c, n] of p.charCounts) if (n > max) ((max = n), (main = c));
      return {
        userId: p.userId,
        name: p.name,
        games: p.games,
        wins: p.wins,
        winRate: p.games ? p.wins / p.games : 0,
        totalStars: p.totalStars,
        avgStars: p.games ? p.totalStars / p.games : 0,
        main,
        variety: p.charCounts.size,
        bonusStars: Object.fromEntries(p.bonus),
      };
    })
    .sort((a, b) => b.wins - a.wins || b.totalStars - a.totalStars);

  const byMap = [...maps.values()]
    .map((m) => {
      let topName: string | null = null;
      let topWins = 0;
      for (const [name, w] of m.winners) if (w > topWins) ((topWins = w), (topName = name));
      return {
        map: m.map,
        games: mapGameCounts.get(m.map)?.size ?? 0,
        topWinner: topName,
        topWinnerWins: topWins,
      };
    })
    .sort((a, b) => b.games - a.games);

  const byCharacter = [...chars.values()]
    .map((c) => ({ ...c, winRate: c.played ? c.wins / c.played : 0 }))
    .sort((a, b) => b.wins - a.wins || b.played - a.played);

  const bonusLeaders = [...bonusByType.entries()].map(([star, byName]) => {
    let leader: string | null = null;
    let count = 0;
    for (const [name, n] of byName) if (n > count) ((count = n), (leader = name));
    return { star, name: leader, count };
  });

  res.json({ games: matchIds.size, byPlayer, byMap, byCharacter, bonusLeaders });
});

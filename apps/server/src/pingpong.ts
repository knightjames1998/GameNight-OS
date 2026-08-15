// Ping Pong pack server routes: King of the Hill and Singles.
//
// The plumbing (session load/save, ledger keys, game row, launch context,
// broadcast) comes from pack-runtime.ts; this file is the pack's own routes,
// its request validation, and its ledger unit.
//
// The ledger unit is what makes this pack different: the MATCH, not the game.
// One completed best-of-N match materializes one matches row plus two
// match_participants rows (winner placement 1, loser 2); the individual games
// and any optional points live only in the session jsonb. Match length rides
// matches.label; optional per-player points ride match_participants.score.
// Backed by game_sessions keyed (eventId, pack='pingpong') so it can coexist
// with other packs on the same event.
//
// SIDES: a match is between two SIDES and a side holds one or more players, so
// doubles is a first-class format rather than the thing this pack said it could
// never do. A singles night is sides of one and writes `side` NULL on every
// row, which is byte-identical to what shipped before (see teams.ts sideIdFor,
// and the fixtures in packages/shared/tests/pingpong-singles.test.ts).

import { Router } from "express";
import {
  getDb,
  events,
  games,
  matches,
  matchParticipants,
  users,
  and,
  eq,
} from "@gamenight/db";
import {
  newPingPongState,
  ppModeBestOf,
  recordGame,
  startFfaMatch,
  finalizeCurrent,
  undoLast,
  neededWins,
  summarizePingPong,
  ppMatchLines,
  ppMatchLabel,
  normalizePpState,
  reshuffleSides,
  currentSides,
  isDoubles,
  shuffleIntoSides,
  singletonSides,
  validateSides,
  sideIdAt,
  defaultSideName,
  type Side,
  type PpSessionState,
  type PpPlayer,
  type PpMode,
  type PpBestOf,
  type PpFormat,
  type PpMatch,
  SESSION_PACKS,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { createPackRuntime, packConfig, roleOf, isHostRole, type LedgerLine } from "./pack-runtime.js";
import { broadcast } from "./ws.js";
import { memberCreditedKeys, type GuestCreditResult } from "./guest-link-util.js";

/** This pack's registry entry, the one place its identifiers exist. */
const DEF = SESSION_PACKS.pingpong;

export const pingPongRouter = Router();
export const pingPongTvRouter = Router();

export const pingPongRuntime = createPackRuntime<PpSessionState>({
  ...packConfig("pingpong"),
  // Sessions written before sides existed load through this at the two points
  // where jsonb becomes state, so a night already in progress when this deploys
  // keeps working and the guest backfill can still read finished ones.
  normalize: normalizePpState,
  extras: (state) => ({
    needed: neededWins(state.bestOf),
    sides: currentSides(state),
    doubles: isDoubles(state),
    summary: summarizePingPong(state),
  }),
});

const rt = pingPongRuntime;

// ---------- ledger ----------

/**
 * Materialize one completed MATCH. Winner placement 1, loser placement 2.
 * Match length rides matches.label; each player's optional points (summed
 * across the games they lost, the only points we capture) ride
 * match_participants.score, null when none were entered. Per-player game
 * wins/played ride meta, so lifetime "single game" totals survive to the
 * ledger even though the games themselves are never materialized as rows.
 */
async function materializeMatch(
  groupId: string,
  eventId: string,
  gameId: string,
  match: PpMatch,
  state: PpSessionState,
  linkMap?: Map<string, string>, // guest display name -> member userId (backfill)
): Promise<{ recorded: number; guests: number }> {
  // The row shape is a PURE function in the shared module (ppMatchLines), so
  // what a match writes can be pinned by a fixture with no database in the way.
  // This file keeps the insert and nothing else.
  const lines: LedgerLine[] = ppMatchLines(match);
  if (lines.length === 0) return { recorded: 0, guests: 0 };

  return rt.materializeUnit({
    groupId,
    eventId,
    gameId,
    idx: match.idx,
    sessionKey: state.sessionKey,
    label: ppMatchLabel(state),
    format: state.format,
    roster: state.roster,
    lines,
    linkMap,
  });
}

// ---------- guest -> member backfill (see guest-link.ts) ----------

/** Distinct guest display names across this crew's Ping Pong sessions. */
export async function guestNamesPingPong(groupId: string): Promise<string[]> {
  return rt.guestNames(groupId, (state) => state.roster);
}

/** Credit (or preview) every recoverable Ping Pong match the guest played. */
export async function creditGuestPingPong(
  groupId: string,
  guestName: string,
  memberId: string,
  dryRun: boolean,
): Promise<GuestCreditResult> {
  const rows = await rt.sessionsForGroup(groupId);
  const items: GuestCreditResult["items"] = [];
  const linkMap = new Map([[guestName, memberId]]);
  let gameId: string | null = null;

  for (const { eventId, state } of rows) {
    const guestSlots = new Set(
      (state.roster ?? []).filter((p) => p.kind === "guest" && p.name === guestName).map((p) => p.id),
    );
    if (guestSlots.size === 0) continue;
    const credited = await memberCreditedKeys(eventId, memberId);
    const label = state.format === "koth" ? "King of the Hill" : state.format === "bestof" ? `Best of ${state.bestOf}` : "Ping Pong game";

    const played = (m: (typeof state.matches)[number]) =>
      [...m.a.memberIds, ...m.b.memberIds].some((id) => guestSlots.has(id));

    for (const m of state.matches ?? []) {
      if (!m.winnerSideId || !played(m)) continue;
      if (credited.has(rt.ledgerKey(eventId, state.sessionKey, m.idx))) continue;
      // Won if the guest was on the winning SIDE, which in a doubles match is
      // true for both of its members.
      const winner = m.winnerSideId === m.a.id ? m.a : m.b;
      const won = winner.memberIds.some((id) => guestSlots.has(id));
      items.push({
        pack: DEF.ledger,
        packLabel: DEF.name,
        eventId,
        label,
        date: m.at ?? null,
        placement: won ? 1 : 2,
        isWinner: won,
      });
    }

    if (!dryRun) {
      gameId = gameId ?? (await rt.ensureGame(groupId));
      for (const m of state.matches ?? []) {
        if (m.winnerSideId && played(m)) {
          await materializeMatch(groupId, eventId, gameId, m, state, linkMap);
        }
      }
    }
  }
  return { items, written: dryRun ? 0 : items.length };
}

// ---------- launch context ----------

pingPongRouter.get("/pingpong-context/:eventId", requireAuth, async (req: AuthedRequest, res) => {
  const ctx = await rt.launchContext(String(req.params.eventId), req.user!.id);
  if (!ctx) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(ctx);
});

// ---------- read live state ----------

pingPongRouter.get("/pingpong/:eventId", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (loaded && !(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Reuse the row the role check just read instead of selecting it twice.
  await rt.respondState(eventId, res, loaded);
});

// Public big-screen read. Event UUID is the access key. Mounted before the
// bare /api authed routers.
pingPongTvRouter.get("/pingpong/:eventId", async (req, res) => {
  await rt.respondState(String(req.params.eventId), res);
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

  // New clients send an explicit format; older ones send mode + bestOf. The
  // format is the source of truth going forward and mode/bestOf are its
  // mechanical expansion (ppModeBestOf).
  const rawFormat = req.body?.format;
  const length: PpBestOf = [1, 3, 5, 7].includes(Number(req.body?.bestOf))
    ? (Number(req.body.bestOf) as PpBestOf)
    : 3;
  let format: PpFormat;
  let mode: PpMode;
  let bestOf: PpBestOf;
  if (rawFormat === "free" || rawFormat === "bestof" || rawFormat === "koth") {
    format = rawFormat;
    ({ mode, bestOf } = ppModeBestOf(format, length));
  } else {
    // Legacy body: derive the format back out of mode + bestOf.
    mode = req.body?.mode as PpMode;
    if (mode !== "koth" && mode !== "ffa") {
      res.status(400).json({ error: "format must be free, bestof, or koth" });
      return;
    }
    bestOf = length;
    format = mode === "koth" ? "koth" : bestOf === 1 ? "free" : "bestof";
  }

  // Don't clobber a session already in progress (standing rule 8) unless the
  // host explicitly confirmed a replace (client sends force after a 409).
  const existing = await rt.loadState(eventId);
  if (
    !req.body?.force &&
    existing &&
    existing.row.status !== "completed" &&
    existing.state.matches.length > 0
  ) {
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

  // SIDES AT SETUP. The client expresses them as ROSTER INDICES, because slot
  // ids are minted here and it has never seen them: `sides: [[0,1],[2,3]]` is
  // "p0 and p1 against p2 and p3". Absent means one side per player, which is a
  // singles night and exactly what every client sent before sides existed.
  //
  // `sideCount` with no `sides` is the random deal, done server-side so the
  // arrangement everybody sees is the one that was actually stored.
  const rawSides = Array.isArray(req.body?.sides) ? req.body.sides : null;
  let sides: Side[];
  if (rawSides) {
    sides = rawSides.map((members: unknown, i: number): Side => ({
      id: sideIdAt(i),
      name: defaultSideName(i),
      memberIds: (Array.isArray(members) ? members : [])
        .map((n: unknown) => roster[Number(n)]?.id)
        .filter((id: string | undefined): id is string => !!id),
    }));
    const check = validateSides(sides);
    if (check.error) {
      res.status(400).json({ error: check.error });
      return;
    }
    // Anybody the host left off a side is not playing, and a roster slot with
    // no side would be invisible to every screen. Reject rather than guess.
    const placed = new Set(sides.flatMap((x) => x.memberIds));
    if (placed.size !== roster.length) {
      res.status(400).json({ error: "Every player has to be on a side" });
      return;
    }
  } else if (Number(req.body?.sideCount) >= 2) {
    sides = shuffleIntoSides(roster.map((p) => p.id), Number(req.body.sideCount));
  } else {
    sides = singletonSides(roster.map((p) => p.id));
  }

  const state = newPingPongState({ format, mode, bestOf, roster, sides });
  res.json(await rt.startSession(eventId, event.groupId, state, req.get("x-gn-client")));
});

// ---------- host: reshuffle the sides mid-night ----------
//
// Sides are FIXED for the night by default (James's call), and this is the
// explicit way out of that: it applies from the NEXT match on and never touches
// a match already played, because each completed match carries its own snapshot
// of who was on it. In KOTH the ladder restarts, since a queue of sides that no
// longer exist is not a queue.

pingPongRouter.post("/pingpong/:eventId/sides", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  if (!isHostRole(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Host only" });
    return;
  }

  // Here the client HAS seen the roster, so sides come as slot ids.
  const rawSides = Array.isArray(req.body?.sides) ? req.body.sides : null;
  const ids = loaded.state.roster.map((p) => p.id);
  const sides: Side[] = rawSides
    ? rawSides.map((sd: any, i: number): Side => ({
        id: sideIdAt(i),
        name: defaultSideName(i),
        memberIds: (Array.isArray(sd?.memberIds) ? sd.memberIds : []).map((x: unknown) => String(x)),
      }))
    : shuffleIntoSides(ids, Math.max(2, Number(req.body?.sideCount) || 2));

  const placed = new Set(sides.flatMap((x) => x.memberIds));
  if (placed.size !== ids.length) {
    res.status(400).json({ error: "Every player has to be on a side" });
    return;
  }

  const err = reshuffleSides(loaded.state, sides);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

// ---------- singles: start the next match (FFA only) ----------

pingPongRouter.post("/pingpong/:eventId/start-match", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
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
  const ok = startFfaMatch(
    loaded.state,
    String(req.body?.aSideId ?? req.body?.aId ?? ""),
    String(req.body?.bSideId ?? req.body?.bId ?? ""),
  );
  if (!ok) {
    res.status(400).json({ error: "Pick two different sides; finish the current match first" });
    return;
  }
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

// ---------- record a game (one tap on the winner) ----------

pingPongRouter.post("/pingpong/:eventId/record", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
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

  // The client sends a SIDE id. In a singles session that is the side holding
  // the one player, so the tap is unchanged from the outside.
  const winnerSideId = String(req.body?.winnerSideId ?? req.body?.winnerId ?? "");
  const lp = req.body?.loserPoints;
  const loserPoints = lp == null || lp === "" ? null : Number(lp);
  if (winnerSideId !== state.current.a.id && winnerSideId !== state.current.b.id) {
    res.status(400).json({ error: "Winner must be one of the two sides playing" });
    return;
  }

  const { completed } = recordGame(state, winnerSideId, loserPoints);

  const origin = req.get("x-gn-client");
  let report: { recorded: number; guests: number } | null = null;
  if (completed) {
    const gameId = await rt.ensureGame(row.groupId);
    report = await materializeMatch(row.groupId, eventId, gameId, completed, state);
  }
  const view = await rt.saveState(loaded, "live", origin);
  if (completed) broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json({ ...view, ...(report ?? {}) });
});

// ---------- undo (one game, or the last completed match) ----------

pingPongRouter.post("/pingpong/:eventId/undo", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
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
    await rt.deleteMaterialized(eventId, state.sessionKey, unmaterializeIdx);
    const view = await rt.saveState(loaded, "live", origin);
    broadcast({ type: "leaderboard_updated", eventId }, origin);
    res.json(view);
    return;
  }
  res.json(await rt.saveState(loaded, "live", origin));
});

// ---------- host toggles + complete ----------

pingPongRouter.post("/pingpong/:eventId/open-scoring", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  if (!isHostRole(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Host only" });
    return;
  }
  loaded.state.openScoring = !!req.body?.open;
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

pingPongRouter.post("/pingpong/:eventId/complete", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
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
    const gameId = await rt.ensureGame(loaded.row.groupId);
    await materializeMatch(loaded.row.groupId, eventId, gameId, finalized, loaded.state);
  }
  const view = await rt.saveState(loaded, "completed", origin);
  if (finalized) broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json(view);
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
      .where(and(eq(games.groupId, groupId), eq(games.pack, DEF.ledger)))
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
      // DOUBLES IS DERIVED, NEVER LABELLED. Within this pack a non-null side
      // already means the match had team structure, so the split is a read on
      // the column the primitive writes anyway: no new matches.label value, no
      // new format string, and the bo{N} labels do not move. That is what makes
      // this safe to get wrong. A mislabelled row would be unrecoverable
      // history; a derived split is a query anyone can change their mind about.
      side: matchParticipants.side,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(users, eq(matchParticipants.userId, users.id))
    .where(and(eq(matches.groupId, groupId), eq(matches.gameId, game.id), eq(matches.status, "completed")));

  const matchIds = new Set<string>();
  const doublesMatchIds = new Set<string>();
  const formatsSeen = new Set<string>();
  /** Wins/played, counted the same way for each half of the split. */
  type Tally = { matches: number; matchWins: number; gameWins: number; gamesPlayed: number };
  const newTally = (): Tally => ({ matches: 0, matchWins: 0, gameWins: 0, gamesPlayed: 0 });
  const byUser = new Map<
    string,
    {
      userId: string;
      name: string;
      matches: number;
      matchWins: number;
      gameWins: number;
      gamesPlayed: number;
      singles: Tally;
      doubles: Tally;
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
        singles: newTally(),
        doubles: newTally(),
        byFormat: new Map<string, { wins: number; played: number }>(),
      };
    p.matches++;
    if (r.isWinner) p.matchWins++;
    p.gameWins += meta.gameWins ?? 0;
    p.gamesPlayed += meta.gamesPlayed ?? 0;

    // The split. The two halves sum to the unsplit totals by construction,
    // because every row goes in exactly one of them.
    const half = r.side ? p.doubles : p.singles;
    if (r.side) doublesMatchIds.add(r.matchId);
    half.matches++;
    if (r.isWinner) half.matchWins++;
    half.gameWins += meta.gameWins ?? 0;
    half.gamesPlayed += meta.gamesPlayed ?? 0;
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
      singles: p.singles,
      doubles: p.doubles,
      byFormat: formats.map((f) => ({ format: f, ...(p.byFormat.get(f) ?? { wins: 0, played: 0 }) })),
    }))
    .sort((a, b) => b.gameWins - a.gameWins || b.matchWins - a.matchWins);

  res.json({
    matches: matchIds.size,
    doublesMatches: doublesMatchIds.size,
    singlesMatches: matchIds.size - doublesMatchIds.size,
    formats,
    byPlayer,
  });
});

// Ping Pong pack: shared types and pure session logic. Dependency-free apart
// from the team primitive, so both server and web import it; the server owns
// the authoritative session state and these helpers keep the rules in one place.
//
// Formats: King of the Hill (winner stays, challenger line rotates), Free Play
// (every single game is its own result) and Best Of (a 3/5/7 set). Recording a
// GAME is one tap on the winner; the loser's points that game are optional. The
// LEDGER unit is the MATCH: one completed match materializes one row set, and
// the individual games and any points live only in this session state.
//
// ===========================================================================
// EVERYTHING HERE IS SIDE-SHAPED, AND SINGLES IS THE ONE-PER-SIDE CASE.
//
// This pack used to be single-player by construction: a match was `aId`/`bId`
// and KOTH was a `kingId` plus a queue of player ids, and the file said in its
// own header that doubles was out because "2v2 needs a team model the
// per-player ledger does not have". That model now exists
// (packages/shared/src/teams.ts), and Ping Pong is its first consumer.
//
// So a match is between two SIDES, and a side holds one or more players. A
// singles night is sides of one, which is not a special case in the code and is
// not a special case in the ledger either: `sideIdFor` writes null whenever
// every side has exactly one member, so every singles row is byte-identical to
// what shipped before this existed. That equivalence is pinned, hard, in
// tests/pingpong-singles.test.ts, which was written and confirmed green against
// the pre-conversion engine.
//
// A match holds SNAPSHOTS of the two sides that played it rather than ids into
// the session's current arrangement, because the host can reshuffle sides
// mid-night and a completed match must still know who was actually on it.
// ===========================================================================

import {
  placementsFromSideOrder,
  sideIdAt,
  sideOf,
  singletonSides,
  validateSides,
  type Side,
} from "./teams.js";

export type PpMode = "koth" | "ffa";
// 1 = free play: every single game is its own recorded result. 3/5/7 are
// best-of matches.
export type PpBestOf = 1 | 3 | 5 | 7;

// The user-facing FORMAT chosen at session start. This is the explicit picker
// value; mode + bestOf are its mechanical expansion (kept because the engine
// and ledger key off them):
//   free   -> mode ffa, bestOf 1  (one game per result)
//   bestof -> mode ffa, bestOf 3/5/7
//   koth   -> mode koth, bestOf 1  (single game per match, winner stays on)
export type PpFormat = "free" | "bestof" | "koth";

/** Expand a picked format + series length into the engine's mode + bestOf. */
export function ppModeBestOf(format: PpFormat, length: PpBestOf): { mode: PpMode; bestOf: PpBestOf } {
  if (format === "koth") return { mode: "koth", bestOf: 1 };
  if (format === "bestof") return { mode: "ffa", bestOf: length === 1 ? 3 : length };
  return { mode: "ffa", bestOf: 1 };
}

// A roster slot. Members carry a userId (stats accrue); guests are typed
// names (no lifetime stats until linked to a member, a backlog item).
export interface PpPlayer {
  id: string; // stable slot id within the session
  kind: "member" | "guest";
  userId: string | null;
  name: string;
}

/** One game within a match: which side won it, and optionally the loser's points. */
export interface PpGame {
  winnerSideId: string;
  loserPoints: number | null;
}

/**
 * One match between two sides, best-of-N.
 *
 * `a` and `b` are SNAPSHOTS taken when the match started, not references into
 * the session's current arrangement. A host who reshuffles sides at half time
 * must not retroactively change who played the matches already recorded, and a
 * snapshot is what makes materialize, the tally and the standings all readable
 * from the match alone.
 */
export interface PpMatch {
  idx: number; // completed-match order; the materialize/dedup key + position. -1 while in progress.
  a: Side;
  b: Side;
  games: PpGame[];
  winnerSideId: string | null; // set when the match completes
  at: string | null; // ISO when completed
}

/**
 * King of the Hill running state. The reigning SIDE stays; the losing side goes
 * to the back of the queue together, which is what makes a doubles KOTH work
 * the way a room actually plays it: the pair that won holds the table.
 *
 * `bestReign` names the SIDE and carries its members, because the reign record
 * is both things at once (James's call): the screen names the pair that did it,
 * and each member is credited individually in their own lifetime longestReign.
 */
export interface PpKothState {
  kingSideId: string | null;
  queue: string[]; // challenger side ids, front plays next
  reign: number;
  bestReign: { sideId: string; memberIds: string[]; reign: number } | null;
}

/**
 * One arrangement of sides, and the match index it takes effect from.
 *
 * Sides are FIXED for the night by default, with an explicit host reshuffle
 * (James's call). The reshuffle POINT has to be recorded rather than just
 * overwriting the arrangement, because KOTH's throne and queue are REBUILT by
 * replaying matches rather than maintained, and a replay needs to know which
 * arrangement each stretch of the night was played under. Same reason craps
 * derives its hands from an event log and Smashdown derives its burn board:
 * undo across a boundary is correct by construction instead of correct until
 * somebody forgets a counter.
 */
export interface PpSideSet {
  fromIdx: number;
  sides: Side[];
}

export interface PpSessionState {
  // Unique per session start. The ledger keys each materialized match
  // pp:{eventId}:{sessionKey}:{idx}; without the sessionKey a second session
  // on the SAME event resets idx to 0,1,2... and collides with the first
  // session's keys, so the dedup check silently drops every new match.
  sessionKey: string;
  // User-facing format chosen at start; mode + bestOf are its expansion.
  format: PpFormat;
  mode: PpMode;
  bestOf: PpBestOf;
  // When false, only owners/admins record results (standing rule 1). Host
  // may flip it on to let members score. Defaults off.
  openScoring: boolean;
  roster: PpPlayer[];
  /** Always at least one entry; the LAST is the arrangement in force. */
  sideSets: PpSideSet[];
  matches: PpMatch[]; // completed matches (materialized into the ledger)
  current: PpMatch | null; // the in-progress match
  koth: PpKothState | null;
}

/** The arrangement of sides in force right now. */
export function currentSides(state: PpSessionState): Side[] {
  return state.sideSets[state.sideSets.length - 1]?.sides ?? [];
}

/** True when any side in force holds more than one player. */
export function isDoubles(state: PpSessionState): boolean {
  return currentSides(state).some((s) => s.memberIds.length > 1);
}

/** A side by id out of the arrangement in force. */
export function sideById(state: PpSessionState, sideId: string | null | undefined): Side | undefined {
  return sideId ? currentSides(state).find((s) => s.id === sideId) : undefined;
}

/** Every player name, keyed by slot id, for labelling sides on a screen. */
export function ppNameOf(state: PpSessionState): (id: string) => string | undefined {
  const names = new Map(state.roster.map((p) => [p.id, p.name]));
  return (id) => names.get(id);
}

/** Game wins needed to take a match: bo3 -> 2, bo5 -> 3, bo7 -> 4. */
export function neededWins(bestOf: PpBestOf): number {
  return Math.floor(bestOf / 2) + 1;
}

/** Current game-win tally within a match, by side. */
export function gameWins(match: PpMatch): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const g of match.games) {
    if (g.winnerSideId === match.a.id) a++;
    else if (g.winnerSideId === match.b.id) b++;
  }
  return { a, b };
}

/** The losing side of a completed match. */
function loserSide(match: PpMatch): Side {
  return match.winnerSideId === match.a.id ? match.b : match.a;
}

/** The winning side of a completed match. */
function winnerSide(match: PpMatch): Side {
  return match.winnerSideId === match.a.id ? match.a : match.b;
}

function makeMatch(a: Side | undefined, b: Side | undefined): PpMatch | null {
  if (!a || !b || a.id === b.id) return null;
  return { idx: -1, a, b, games: [], winnerSideId: null, at: null };
}

// ---------- legacy state ----------

/**
 * Upgrade a session persisted under the pre-sides shape.
 *
 * Sessions in `game_sessions` were written with `aId`/`bId` on a match,
 * `winnerId` on a game, a `kingId` plus a queue of PLAYER ids on KOTH, and no
 * `sideSets` at all. A live night mid-session when this deploys must keep
 * working, and a finished one must still be readable by the guest backfill.
 *
 * The upgrade is exact rather than approximate: an old match was always between
 * two individuals, so it becomes two sides of one, which `sideIdFor` then
 * treats as no team structure, which is what it always was. Applied at the
 * runtime's two jsonb boundaries (see PackRuntimeConfig.normalize), so no call
 * site has to remember it.
 */
export function normalizePpState(state: PpSessionState): PpSessionState {
  const raw = state as unknown as Record<string, unknown>;
  if (Array.isArray(raw.sideSets) && raw.sideSets.length > 0) return state;

  const roster = (state.roster ?? []) as PpPlayer[];
  const sides = singletonSides(roster.map((p) => p.id));
  const sideIdOfPlayer = new Map(roster.map((p, i) => [p.id, sideIdAt(i)]));
  const sideOfPlayer = (playerId: string | null | undefined): Side | undefined =>
    sides.find((s) => s.id === (playerId ? sideIdOfPlayer.get(playerId) : undefined));

  const upgradeMatch = (m: Record<string, unknown> | null | undefined): PpMatch | null => {
    if (!m) return null;
    if (m.a && m.b) return m as unknown as PpMatch;
    const a = sideOfPlayer(m.aId as string);
    const b = sideOfPlayer(m.bId as string);
    if (!a || !b) return null;
    const games = ((m.games ?? []) as { winnerId?: string; loserPoints: number | null }[]).map((g) => ({
      winnerSideId: sideOfPlayer(g.winnerId)?.id ?? a.id,
      loserPoints: g.loserPoints ?? null,
    }));
    return {
      idx: (m.idx as number) ?? -1,
      a,
      b,
      games,
      winnerSideId: m.winnerId ? sideOfPlayer(m.winnerId as string)?.id ?? null : null,
      at: (m.at as string) ?? null,
    };
  };

  const k = raw.koth as Record<string, unknown> | null | undefined;
  const koth: PpKothState | null = k
    ? {
        kingSideId: sideOfPlayer(k.kingId as string)?.id ?? null,
        queue: ((k.queue ?? []) as string[]).map((id) => sideOfPlayer(id)?.id).filter((id): id is string => !!id),
        reign: (k.reign as number) ?? 0,
        bestReign: k.bestReign
          ? {
              sideId: sideOfPlayer((k.bestReign as { playerId: string }).playerId)?.id ?? "a",
              memberIds: [(k.bestReign as { playerId: string }).playerId],
              reign: (k.bestReign as { reign: number }).reign,
            }
          : null,
      }
    : null;

  return {
    ...state,
    sideSets: [{ fromIdx: 0, sides }],
    matches: ((raw.matches ?? []) as Record<string, unknown>[])
      .map(upgradeMatch)
      .filter((m): m is PpMatch => m !== null),
    current: upgradeMatch(raw.current as Record<string, unknown> | null),
    koth,
  };
}

// ---------- session construction ----------

export function newPingPongState(opts: {
  format: PpFormat;
  mode: PpMode;
  bestOf: PpBestOf;
  roster: PpPlayer[];
  /** Defaults to one side per player, which is a singles night. */
  sides?: Side[];
}): PpSessionState {
  const sides = opts.sides?.length ? opts.sides : singletonSides(opts.roster.map((p) => p.id));
  const state: PpSessionState = {
    sessionKey: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    format: opts.format,
    mode: opts.mode,
    bestOf: opts.bestOf,
    openScoring: false,
    roster: opts.roster,
    sideSets: [{ fromIdx: 0, sides }],
    matches: [],
    current: null,
    koth: null,
  };
  if (opts.mode === "koth") {
    const kingSideId = sides[0]?.id ?? null;
    const queue = sides.slice(1).map((s) => s.id);
    state.koth = { kingSideId, queue, reign: 0, bestReign: null };
    state.current = makeMatch(sides[0], sides.find((s) => s.id === queue[0]));
  }
  return state;
}

/**
 * Replace the arrangement of sides from here on. Returns an error string or
 * null; refuses while a match is under way, since the people at the table
 * cannot change mid-rally.
 *
 * Completed matches keep their own snapshots and are untouched, so the night's
 * history stays true. In KOTH the ladder restarts from the new arrangement,
 * because a queue of sides that no longer exist is not a queue.
 */
export function reshuffleSides(state: PpSessionState, sides: Side[]): string | null {
  const check = validateSides(sides);
  if (check.error) return check.error;
  const known = new Set(state.roster.map((p) => p.id));
  if (sides.some((s) => s.memberIds.some((id) => !known.has(id)))) {
    return "Somebody on a side is not in this session";
  }
  if (state.current && state.current.games.length > 0) {
    return "Finish the match in progress first";
  }

  const last = state.sideSets[state.sideSets.length - 1]!;
  const entry: PpSideSet = { fromIdx: state.matches.length, sides };
  // A reshuffle that has had no matches under it yet REPLACES rather than
  // stacks, so changing your mind twice does not leave a dead arrangement in
  // the log for the rebuild to walk past.
  if (last.fromIdx === state.matches.length) state.sideSets[state.sideSets.length - 1] = entry;
  else state.sideSets.push(entry);

  if (state.mode === "koth") rebuildKoth(state);
  else state.current = null;
  return null;
}

/**
 * Start a match between two sides (FFA mode). Refuses to clobber a match
 * already in progress. Returns whether it started.
 */
export function startFfaMatch(state: PpSessionState, aSideId: string, bSideId: string): boolean {
  if (state.mode !== "ffa") return false;
  if (state.current && state.current.games.length > 0) return false;
  if (aSideId === bSideId) return false;
  state.current = makeMatch(sideById(state, aSideId), sideById(state, bSideId));
  return state.current !== null;
}

/**
 * Record one game (one tap on the winning side), with the loser's points
 * optional. Mutates state. When the game decides the match, the match
 * completes: it is pushed to matches[] with an idx, and in KOTH the throne
 * advances and the next match is set up automatically. Returns the completed
 * match, or null if the match is still going.
 */
export function recordGame(
  state: PpSessionState,
  winnerSideId: string,
  loserPoints: number | null,
): { completed: PpMatch | null } {
  const m = state.current;
  if (!m || (winnerSideId !== m.a.id && winnerSideId !== m.b.id)) return { completed: null };

  const pts =
    loserPoints != null && Number.isFinite(loserPoints) && loserPoints >= 0
      ? Math.floor(loserPoints)
      : null;
  m.games.push({ winnerSideId, loserPoints: pts });

  const { a, b } = gameWins(m);
  const need = neededWins(state.bestOf);
  if (a < need && b < need) return { completed: null };

  m.winnerSideId = a >= need ? m.a.id : m.b.id;
  m.at = new Date().toISOString();
  m.idx = state.matches.length;
  state.matches.push(m);

  if (state.mode === "koth" && state.koth) {
    const k = state.koth;
    const loserId = loserSide(m).id;
    const reign = m.winnerSideId === k.kingSideId ? k.reign + 1 : 1;
    const winner = winnerSide(m);
    const bestReign =
      !k.bestReign || reign > k.bestReign.reign
        ? { sideId: winner.id, memberIds: [...winner.memberIds], reign }
        : k.bestReign;
    // The front challenger just played; the losing SIDE goes to the back
    // together, which is the whole point of a doubles ladder.
    const queue = [...k.queue.filter((id) => id !== m.winnerSideId && id !== loserId), loserId];
    state.koth = { kingSideId: m.winnerSideId, queue, reign, bestReign };
    state.current = makeMatch(sideById(state, m.winnerSideId), sideById(state, queue[0]));
  } else if (state.bestOf === 1) {
    // Free play: keep the same two sides teed up so the host can log the next
    // game with one tap. "Change sides" starts a fresh matchup.
    state.current = makeMatch(m.a, m.b);
  } else {
    state.current = null;
  }
  return { completed: m };
}

/**
 * Finalize an in-progress match when the night is called (the host ends the
 * session). Best-of matches only materialize on a decisive finish, so a match
 * abandoned mid-set would otherwise lose every game played in it. This awards
 * the match to whichever side leads on games so those results survive to the
 * ledger. An exact game tie (e.g. 2-2 in a bo5) has no fair winner and stays
 * unrecorded. Returns the finalized match to materialize, or null.
 */
export function finalizeCurrent(state: PpSessionState): PpMatch | null {
  const m = state.current;
  if (!m || m.games.length === 0) return null;
  const { a, b } = gameWins(m);
  if (a === b) return null;
  m.winnerSideId = a > b ? m.a.id : m.b.id;
  m.at = new Date().toISOString();
  m.idx = state.matches.length;
  state.matches.push(m);
  state.current = null;
  return m;
}

/**
 * Undo one step. If a match is in progress with games, drop the last game
 * (nothing was materialized). Otherwise pop the last completed match and
 * report its idx so the server can un-materialize it; KOTH state is rebuilt
 * from the remaining matches so the throne and queue can't drift.
 */
export function undoLast(state: PpSessionState): { unmaterializeIdx: number | null } {
  if (state.current && state.current.games.length > 0) {
    state.current.games.pop();
    return { unmaterializeIdx: null };
  }
  const last = state.matches.pop();
  if (!last) return { unmaterializeIdx: null };
  // Undoing back PAST a reshuffle restores the arrangement that was in force
  // before it. Without this the rebuild would replay old matches under new
  // sides, which is how a throne ends up held by a side that never played.
  while (
    state.sideSets.length > 1 &&
    state.sideSets[state.sideSets.length - 1]!.fromIdx > state.matches.length
  ) {
    state.sideSets.pop();
  }
  if (state.mode === "koth") rebuildKoth(state);
  else state.current = null;
  return { unmaterializeIdx: last.idx };
}

/**
 * Replay the matches played under the CURRENT arrangement to rebuild the throne
 * and queue. Matches from before a reshuffle are skipped: they were played by
 * sides that no longer exist, and the ladder restarts at a reshuffle.
 */
function rebuildKoth(state: PpSessionState) {
  const set = state.sideSets[state.sideSets.length - 1]!;
  const sides = set.sides;
  let k: PpKothState = {
    kingSideId: sides[0]?.id ?? null,
    queue: sides.slice(1).map((s) => s.id),
    reign: 0,
    bestReign: null,
  };
  for (const m of state.matches) {
    if (!m.winnerSideId || m.idx < set.fromIdx) continue;
    const loserId = loserSide(m).id;
    const reign = m.winnerSideId === k.kingSideId ? k.reign + 1 : 1;
    const winner = winnerSide(m);
    const bestReign =
      !k.bestReign || reign > k.bestReign.reign
        ? { sideId: winner.id, memberIds: [...winner.memberIds], reign }
        : k.bestReign;
    const queue = [...k.queue.filter((id) => id !== m.winnerSideId && id !== loserId), loserId];
    k = { kingSideId: m.winnerSideId, queue, reign, bestReign };
  }
  state.koth = k;
  state.current = makeMatch(sideById(state, k.kingSideId), sideById(state, k.queue[0]));
}

// ---------- the ledger shape ----------

/** One participant row a completed match produces, before the runtime sees it. */
export interface PpLedgerLine {
  playerId: string;
  placement: number;
  isWinner: boolean;
  /** The player's side's points across the games it lost, or null when none. */
  score: number | null;
  meta: { gameWins: number; gamesPlayed: number };
  /** null whenever every side is one player: see teams.ts sideIdFor. */
  side: string | null;
}

/** matches.label for this session's matches: bo1 / bo3 / bo5 / bo7. */
export function ppMatchLabel(state: PpSessionState): string {
  return `bo${state.bestOf}`;
}

/**
 * The participant rows for one completed match. Winning side placement 1,
 * losing side 2, on every member.
 *
 * POINTS GO ON EVERY MEMBER OF THE LOSING SIDE (James's call). A pair that lost
 * a game 18-21 both carry 18, which is what each of them actually scored as a
 * side and reads the way a singles row always has. The accepted cost is that a
 * future aggregate summing `score` across a crew would count a doubles game's
 * points once per member; nothing does that today, and the alternative (halving
 * them) produces a number nobody at the table would recognise.
 *
 * `side` comes from the primitive, so a singles match writes null on every row
 * and is byte-identical to what this pack wrote before sides existed.
 */
export function ppMatchLines(match: PpMatch): PpLedgerLine[] {
  if (!match.winnerSideId) return [];

  // Points captured are the LOSING SIDE's points per game, summed per side.
  const points = new Map<string, number>();
  let anyPoints = false;
  for (const g of match.games) {
    if (g.loserPoints != null) {
      const gameLoserId = g.winnerSideId === match.a.id ? match.b.id : match.a.id;
      points.set(gameLoserId, (points.get(gameLoserId) ?? 0) + g.loserPoints);
      anyPoints = true;
    }
  }

  const tally = matchGameTally(match);
  const order = [winnerSide(match), loserSide(match)];
  const sideOfMember = new Map<string, string>();
  for (const s of order) for (const id of s.memberIds) sideOfMember.set(id, s.id);

  return placementsFromSideOrder(order).map((line) => {
    const g = tally.get(line.playerId) ?? { wins: 0, played: 0 };
    const mySide = sideOfMember.get(line.playerId)!;
    return {
      playerId: line.playerId,
      placement: line.placement,
      isWinner: line.isWinner,
      score: anyPoints ? points.get(mySide) ?? 0 : null,
      meta: { gameWins: g.wins, gamesPlayed: g.played },
      side: line.side,
    };
  });
}

// ---------- Derived night stats ----------
// Computed from the completed matches for the live page and TV view. Lifetime
// cross-night stats come from the materialized ledger like every pack; these
// give an instant read of the night in progress without a round trip.

export interface PpPlayerStat {
  playerId: string;
  name: string;
  matches: number;
  wins: number; // match wins
  winRate: number;
  gameWins: number; // individual games won (the 4 games in a won bo7, etc.)
  gamesPlayed: number;
  currentStreak: number; // consecutive match wins right now
  bestStreak: number; // best consecutive match wins tonight
  longestReign: number; // KOTH only: longest run defended as king (else 0)
}

/**
 * Per-PLAYER game wins/played for one match, keyed by slot id. Every member of
 * a side is credited with the games their side won and played, which is what
 * keeps lifetime single-game totals meaningful when a pack has doubles in it.
 */
export function matchGameTally(match: PpMatch): Map<string, { wins: number; played: number }> {
  const t = new Map<string, { wins: number; played: number }>();
  const bump = (id: string, won: boolean) => {
    const e = t.get(id) ?? { wins: 0, played: 0 };
    e.played++;
    if (won) e.wins++;
    t.set(id, e);
  };
  for (const g of match.games) {
    const won = g.winnerSideId === match.a.id ? match.a : match.b;
    const lost = g.winnerSideId === match.a.id ? match.b : match.a;
    for (const id of won.memberIds) bump(id, true);
    for (const id of lost.memberIds) bump(id, false);
  }
  return t;
}

/** The night's reign record, naming the side that set it. */
export interface PpReignRecord {
  sideId: string;
  memberIds: string[];
  reign: number;
}

export function summarizePingPong(state: PpSessionState): {
  players: PpPlayerStat[];
  /** KOTH only: the pair (or player) that held the table longest tonight. */
  bestReign: PpReignRecord | null;
} {
  const acc = new Map<
    string,
    { matches: number; wins: number; cur: number; best: number; gw: number; gp: number }
  >();
  const ensure = (id: string) => {
    let s = acc.get(id);
    if (!s) {
      s = { matches: 0, wins: 0, cur: 0, best: 0, gw: 0, gp: 0 };
      acc.set(id, s);
    }
    return s;
  };

  const reignByPlayer = new Map<string, number>();
  let record: PpReignRecord | null = null;
  // The run is tracked by the winning side's MEMBERSHIP rather than its id,
  // because a reshuffle can hand id "a" to a different pair, and a run is a run
  // by the same people.
  let curKey: string | null = null;
  let curSide: Side | null = null;
  let run = 0;

  for (const m of state.matches) {
    if (!m.winnerSideId) continue;
    const won = winnerSide(m);
    const lost = loserSide(m);

    for (const id of won.memberIds) {
      const w = ensure(id);
      w.matches++;
      w.wins++;
      w.cur++;
      if (w.cur > w.best) w.best = w.cur;
    }
    for (const id of lost.memberIds) {
      const l = ensure(id);
      l.matches++;
      l.cur = 0;
    }

    // Individual games within the match.
    for (const [id, g] of matchGameTally(m)) {
      const e = ensure(id);
      e.gw += g.wins;
      e.gp += g.played;
    }

    const key = [...won.memberIds].sort().join("|");
    if (key === curKey) run++;
    else {
      curKey = key;
      curSide = won;
      run = 1;
    }
    // Per-player credit (both members of a pair get the reign), plus the side
    // record for the screen. James's call: the record is both things.
    for (const id of curSide!.memberIds) {
      reignByPlayer.set(id, Math.max(reignByPlayer.get(id) ?? 0, run));
    }
    if (!record || run > record.reign) {
      record = { sideId: curSide!.id, memberIds: [...curSide!.memberIds], reign: run };
    }
  }

  const players: PpPlayerStat[] = state.roster.map((p) => {
    const s = acc.get(p.id) ?? { matches: 0, wins: 0, cur: 0, best: 0, gw: 0, gp: 0 };
    return {
      playerId: p.id,
      name: p.name,
      matches: s.matches,
      wins: s.wins,
      winRate: s.matches ? s.wins / s.matches : 0,
      gameWins: s.gw,
      gamesPlayed: s.gp,
      currentStreak: s.cur,
      bestStreak: s.best,
      longestReign: state.mode === "koth" ? reignByPlayer.get(p.id) ?? 0 : 0,
    };
  });
  players.sort(
    (a, b) => b.wins - a.wins || b.winRate - a.winRate || b.matches - a.matches,
  );
  return { players, bestReign: state.mode === "koth" ? record : null };
}

/** Re-exported so pack code can label a side without importing the primitive. */
export { sideOf };

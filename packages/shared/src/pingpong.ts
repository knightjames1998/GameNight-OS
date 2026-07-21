// Ping Pong pack: shared types and pure session logic. Dependency-free so
// both server and web import it; the server owns the authoritative session
// state and these helpers keep the rules in one place.
//
// Scope (v1): King of the Hill (winner stays, challenger line rotates) and
// Singles (a pool of players, one match at a time between any two). No
// bracket format, no doubles. Doubles is explicitly out: 2v2 needs a team
// model the per-player ledger does not have, so nothing here builds toward
// it.
//
// The unit of a "match" is best-of-3/5/7. Recording a GAME is one tap on the
// winner; the loser's points that game are optional. A match ends
// automatically when a player reaches the required game wins. The LEDGER
// unit is the MATCH (see the server): one completed match materializes one
// row set, winner placement 1, loser 2. The individual games and any points
// live only in this session state.

export type PpMode = "koth" | "ffa";
// 1 = free play: every single game is its own recorded result. 3/5/7 are
// best-of matches.
export type PpBestOf = 1 | 3 | 5 | 7;

// A roster slot. Members carry a userId (stats accrue); guests are typed
// names (no lifetime stats until linked to a member, a backlog item).
export interface PpPlayer {
  id: string; // stable slot id within the session
  kind: "member" | "guest";
  userId: string | null;
  name: string;
}

// One game within a match: who won it, and optionally the loser's points.
export interface PpGame {
  winnerId: string;
  loserPoints: number | null;
}

// One match between two players, best-of-N.
export interface PpMatch {
  idx: number; // completed-match order; the materialize/dedup key + position. -1 while in progress.
  aId: string;
  bId: string;
  games: PpGame[];
  winnerId: string | null; // set when the match completes
  at: string | null; // ISO when completed
}

// King of the Hill running state. The reigning player stays; the loser goes
// to the back of the queue. reign is the current king's consecutive match
// wins as king (their current defended streak).
export interface PpKothState {
  kingId: string | null;
  queue: string[]; // challenger playerIds, front plays next
  reign: number;
  bestReign: { playerId: string; reign: number } | null;
}

export interface PpSessionState {
  mode: PpMode;
  bestOf: PpBestOf;
  // When false, only owners/admins record results (standing rule 1). Host
  // may flip it on to let members score. Defaults off.
  openScoring: boolean;
  roster: PpPlayer[];
  matches: PpMatch[]; // completed matches (materialized into the ledger)
  current: PpMatch | null; // the in-progress match
  koth: PpKothState | null;
}

/** Game wins needed to take a match: bo3 -> 2, bo5 -> 3, bo7 -> 4. */
export function neededWins(bestOf: PpBestOf): number {
  return Math.floor(bestOf / 2) + 1;
}

/** Current game-win tally within a match. */
export function gameWins(match: PpMatch): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const g of match.games) {
    if (g.winnerId === match.aId) a++;
    else if (g.winnerId === match.bId) b++;
  }
  return { a, b };
}

function makeMatch(aId: string | null, bId: string | null): PpMatch | null {
  if (!aId || !bId || aId === bId) return null;
  return { idx: -1, aId, bId, games: [], winnerId: null, at: null };
}

export function newPingPongState(opts: {
  mode: PpMode;
  bestOf: PpBestOf;
  roster: PpPlayer[];
}): PpSessionState {
  const state: PpSessionState = {
    mode: opts.mode,
    bestOf: opts.bestOf,
    openScoring: false,
    roster: opts.roster,
    matches: [],
    current: null,
    koth: null,
  };
  if (opts.mode === "koth") {
    const kingId = opts.roster[0]?.id ?? null;
    const queue = opts.roster.slice(1).map((p) => p.id);
    state.koth = { kingId, queue, reign: 0, bestReign: null };
    state.current = makeMatch(kingId, queue[0] ?? null);
  }
  return state;
}

/**
 * Start a singles match between two roster players (FFA mode). Refuses to
 * clobber a match already in progress. Returns whether it started.
 */
export function startFfaMatch(state: PpSessionState, aId: string, bId: string): boolean {
  if (state.mode !== "ffa") return false;
  if (state.current && state.current.games.length > 0) return false;
  const ids = new Set(state.roster.map((p) => p.id));
  if (aId === bId || !ids.has(aId) || !ids.has(bId)) return false;
  state.current = makeMatch(aId, bId);
  return state.current !== null;
}

/**
 * Record one game (one tap on the winner), with the loser's points optional.
 * Mutates state. When the game decides the match, the match completes: it is
 * pushed to matches[] with an idx, and in KOTH the throne advances and the
 * next match is set up automatically. Returns the completed match, or null if
 * the match is still going.
 */
export function recordGame(
  state: PpSessionState,
  winnerId: string,
  loserPoints: number | null,
): { completed: PpMatch | null } {
  const m = state.current;
  if (!m || (winnerId !== m.aId && winnerId !== m.bId)) return { completed: null };

  const pts =
    loserPoints != null && Number.isFinite(loserPoints) && loserPoints >= 0
      ? Math.floor(loserPoints)
      : null;
  m.games.push({ winnerId, loserPoints: pts });

  const { a, b } = gameWins(m);
  const need = neededWins(state.bestOf);
  if (a < need && b < need) return { completed: null };

  m.winnerId = a >= need ? m.aId : m.bId;
  m.at = new Date().toISOString();
  m.idx = state.matches.length;
  state.matches.push(m);

  if (state.mode === "koth" && state.koth) {
    const loserId = m.winnerId === m.aId ? m.bId : m.aId;
    const k = state.koth;
    const reign = m.winnerId === k.kingId ? k.reign + 1 : 1;
    const bestReign =
      !k.bestReign || reign > k.bestReign.reign ? { playerId: m.winnerId, reign } : k.bestReign;
    // The front challenger just played; loser goes to the back.
    const queue = [...k.queue.filter((id) => id !== m.winnerId && id !== loserId), loserId];
    state.koth = { kingId: m.winnerId, queue, reign, bestReign };
    state.current = makeMatch(m.winnerId, queue[0] ?? null);
  } else if (state.bestOf === 1) {
    // Free play singles: keep the same two teed up so the host can log the
    // next game with one tap. "Change players" starts a fresh matchup.
    state.current = makeMatch(m.aId, m.bId);
  } else {
    state.current = null;
  }
  return { completed: m };
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
  if (state.mode === "koth") rebuildKoth(state);
  else state.current = null;
  return { unmaterializeIdx: last.idx };
}

/** Replay completed matches from the opening order to rebuild KOTH + current. */
function rebuildKoth(state: PpSessionState) {
  const kingId = state.roster[0]?.id ?? null;
  let k: PpKothState = {
    kingId,
    queue: state.roster.slice(1).map((p) => p.id),
    reign: 0,
    bestReign: null,
  };
  for (const m of state.matches) {
    if (!m.winnerId) continue;
    const loserId = m.winnerId === m.aId ? m.bId : m.aId;
    const reign = m.winnerId === k.kingId ? k.reign + 1 : 1;
    const bestReign =
      !k.bestReign || reign > k.bestReign.reign ? { playerId: m.winnerId, reign } : k.bestReign;
    const queue = [...k.queue.filter((id) => id !== m.winnerId && id !== loserId), loserId];
    k = { kingId: m.winnerId, queue, reign, bestReign };
  }
  state.koth = k;
  state.current = makeMatch(k.kingId, k.queue[0] ?? null);
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

/** Per-player game wins/played for one match, keyed by playerId. */
export function matchGameTally(match: PpMatch): Map<string, { wins: number; played: number }> {
  const t = new Map<string, { wins: number; played: number }>();
  const bump = (id: string, won: boolean) => {
    const e = t.get(id) ?? { wins: 0, played: 0 };
    e.played++;
    if (won) e.wins++;
    t.set(id, e);
  };
  for (const g of match.games) {
    const loserId = g.winnerId === match.aId ? match.bId : match.aId;
    bump(g.winnerId, true);
    bump(loserId, false);
  }
  return t;
}

export function summarizePingPong(state: PpSessionState): { players: PpPlayerStat[] } {
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

  const bestReign = new Map<string, number>();
  let curKing: string | null = null;
  let run = 0;

  for (const m of state.matches) {
    if (!m.winnerId) continue;
    const loserId = m.winnerId === m.aId ? m.bId : m.aId;
    const w = ensure(m.winnerId);
    const l = ensure(loserId);
    w.matches++;
    l.matches++;
    w.wins++;
    w.cur++;
    if (w.cur > w.best) w.best = w.cur;
    l.cur = 0;

    // Individual games within the match.
    for (const [id, g] of matchGameTally(m)) {
      const e = ensure(id);
      e.gw += g.wins;
      e.gp += g.played;
    }

    if (m.winnerId === curKing) run++;
    else {
      curKing = m.winnerId;
      run = 1;
    }
    bestReign.set(curKing, Math.max(bestReign.get(curKing) ?? 0, run));
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
      longestReign: state.mode === "koth" ? bestReign.get(p.id) ?? 0 : 0,
    };
  });
  players.sort(
    (a, b) => b.wins - a.wins || b.winRate - a.winRate || b.matches - a.matches,
  );
  return { players };
}

// Generic best-of-N 1v1 series primitive, shared by the Smash and Mario Kart
// packs (Ping Pong has its own match-centric copy and is left untouched). A
// series is a head-to-head between two opaque slot ids; recording a game is
// one tap on the winner, and the series completes when a side reaches the
// needed game wins. Per-side game tallies feed match_participants.meta so
// lifetime game-win stats survive. Packs attach their own per-game detail
// (the character or racer played) at materialization, outside this primitive.
//
// The LEDGER unit for a best-of format is the SERIES: one completed series
// materializes one matches row plus two match_participants rows (winner
// placement 1, loser 2). Individual games live only in session state.

export type SeriesBestOf = 3 | 5 | 7;

export interface SeriesGame {
  winnerId: string;
}

export interface Series {
  idx: number; // completed-series order; the ledger key suffix + position. -1 while live.
  aId: string;
  bId: string;
  games: SeriesGame[];
  winnerId: string | null; // set when the series completes
  at: string | null; // ISO when completed
}

/** Game wins needed to take a series: bo3 -> 2, bo5 -> 3, bo7 -> 4. */
export function seriesNeededWins(bestOf: SeriesBestOf): number {
  return Math.floor(bestOf / 2) + 1;
}

/** Current game-win tally within a series. */
export function seriesGameWins(s: Series): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const g of s.games) {
    if (g.winnerId === s.aId) a++;
    else if (g.winnerId === s.bId) b++;
  }
  return { a, b };
}

/** A fresh series between two distinct slots, or null if the pair is invalid. */
export function newSeries(aId: string | null, bId: string | null): Series | null {
  if (!aId || !bId || aId === bId) return null;
  return { idx: -1, aId, bId, games: [], winnerId: null, at: null };
}

/**
 * Record one game (one tap on the winner). Mutates. When the game decides the
 * series, the series completes (winnerId + at set); the caller assigns idx,
 * pushes it to the completed log, and materializes it. Returns whether the
 * series just completed.
 */
export function recordSeriesGame(
  s: Series,
  bestOf: SeriesBestOf,
  winnerId: string,
): { completed: boolean } {
  if (winnerId !== s.aId && winnerId !== s.bId) return { completed: false };
  s.games.push({ winnerId });
  const { a, b } = seriesGameWins(s);
  const need = seriesNeededWins(bestOf);
  if (a < need && b < need) return { completed: false };
  s.winnerId = a >= need ? s.aId : s.bId;
  s.at = new Date().toISOString();
  return { completed: true };
}

/** Per-slot game wins/played for one series, keyed by slot id. */
export function seriesGameTally(s: Series): Map<string, { wins: number; played: number }> {
  const t = new Map<string, { wins: number; played: number }>();
  const bump = (id: string, won: boolean) => {
    const e = t.get(id) ?? { wins: 0, played: 0 };
    e.played++;
    if (won) e.wins++;
    t.set(id, e);
  };
  for (const g of s.games) {
    const loserId = g.winnerId === s.aId ? s.bId : s.aId;
    bump(g.winnerId, true);
    bump(loserId, false);
  }
  return t;
}

/**
 * Finalize an in-progress series when the night is called (the host ends the
 * session). Awards the series to whoever leads on games so those results
 * survive to the ledger; an exact game tie has no fair winner and stays
 * unrecorded. Mutates (sets winnerId + at). Returns whether it finalized.
 */
export function finalizeSeries(s: Series | null): s is Series {
  if (!s || s.games.length === 0) return false;
  const { a, b } = seriesGameWins(s);
  if (a === b) return false;
  s.winnerId = a > b ? s.aId : s.bId;
  s.at = new Date().toISOString();
  return true;
}

// ---------- Derived standings for the live page + TV ----------
// Computed from the completed series for an instant read of the night in
// progress; lifetime cross-night stats still come from the materialized
// ledger. Series wins are the match wins; game wins total every game inside
// those series (the classic "sets vs games" split).

export interface SeriesStanding {
  slotId: string;
  seriesWins: number;
  seriesPlayed: number;
  gameWins: number;
  gamesPlayed: number;
  currentStreak: number; // consecutive series wins right now
  bestStreak: number; // best consecutive series wins tonight
}

export function summarizeSeriesLog(log: Series[]): Map<string, SeriesStanding> {
  const acc = new Map<string, SeriesStanding>();
  const ensure = (id: string): SeriesStanding => {
    let s = acc.get(id);
    if (!s) {
      s = { slotId: id, seriesWins: 0, seriesPlayed: 0, gameWins: 0, gamesPlayed: 0, currentStreak: 0, bestStreak: 0 };
      acc.set(id, s);
    }
    return s;
  };
  for (const ser of log) {
    if (!ser.winnerId) continue;
    const loserId = ser.winnerId === ser.aId ? ser.bId : ser.aId;
    const w = ensure(ser.winnerId);
    const l = ensure(loserId);
    w.seriesPlayed++;
    l.seriesPlayed++;
    w.seriesWins++;
    w.currentStreak++;
    if (w.currentStreak > w.bestStreak) w.bestStreak = w.currentStreak;
    l.currentStreak = 0;
    for (const [id, g] of seriesGameTally(ser)) {
      const e = ensure(id);
      e.gameWins += g.wins;
      e.gamesPlayed += g.played;
    }
  }
  return acc;
}

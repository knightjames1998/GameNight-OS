// Mario Kart pack: the racer roster. The live-session logic itself is the
// same pure engine the Smash pack uses (roster, per-game placements, night
// summary). Mario Kart's "general tracking" is FFA races: pick a racer,
// log the finishing order (or just the winner). Only the character list and
// the wording differ, so this file carries just the roster; everything else
// is reused from ./smash.ts via the shared session helpers.
//
// Mario Kart 8 Deluxe roster (base + Booster Course Pass additions),
// character-select order-ish. Weight/variant duplicates (e.g. the metal
// skins) are kept because groups genuinely main them.
export const MARIO_KART_RACERS: string[] = [
  "Mario", "Luigi", "Peach", "Daisy", "Rosalina", "Tanooki Mario", "Cat Peach",
  "Yoshi", "Toad", "Koopa Troopa", "Shy Guy", "Lakitu", "Toadette", "King Boo",
  "Baby Mario", "Baby Luigi", "Baby Peach", "Baby Daisy", "Baby Rosalina",
  "Metal Mario", "Pink Gold Peach", "Wario", "Waluigi", "Donkey Kong", "Bowser",
  "Dry Bones", "Bowser Jr.", "Dry Bowser", "Lemmy", "Larry", "Wendy", "Ludwig",
  "Iggy", "Roy", "Morton", "Inkling Girl", "Inkling Boy", "Link", "Villager",
  "Isabelle", "Birdo", "Petey Piranha", "Wiggler", "Kamek", "Pauline",
  "Diddy Kong", "Funky Kong", "Peachette", "Mii",
];

const RACER_SET = new Set(MARIO_KART_RACERS);
export function isRacer(name: unknown): name is string {
  return typeof name === "string" && RACER_SET.has(name);
}

// ---------- Which Mario Kart title ----------
// The host picks a title on the pack's front page; it scopes the racer
// picker and the random pool to that game (standing rule: randomize within
// the game being played). Stats stay unified across titles by racer name.
// Newest-and-widest MK8 Deluxe is the default. Rosters use MK8 Deluxe
// spellings where a racer is shared so lifetime stats line up. Title-only
// racers (e.g. Paratroopa, Dry Bowser, Funky Kong) keep their own name.
import type { GameTitle } from "./smash.js";
export type { GameTitle } from "./smash.js";

// ---------- Mario Kart session ----------
// Mario Kart is its OWN pack (never merged with Smash), but it reuses the
// shared primitives: the Smash session shape and factory for the parts that
// are genuinely the same, and the best-of series engine (./series). Mk adds two
// formats of its own on top: Free Play (single races) and Grand Prix (a cup
// of N races scored on cumulative Mario Kart points). Grand Prix records each
// race as its own ledger match (game-as-unit) with the cup id on
// matches.label; the cup standings are derived on read, never a ledger row.
//
// ===========================================================================
// A KART IS A SIDE, AND A SOLO NIGHT IS ONE RACER PER KART.
//
// Double Dash puts two people in one kart, so from 2026-08-16 this pack is
// side-shaped all the way through: a race is a tapped order of KARTS, a
// best-of set is between two KARTS, and the throne in King of the Hill is held
// by a KART. A solo night is karts of one, which is not a special case in the
// code and is not a special case in the ledger either, because `sideIdFor`
// writes null whenever every side has exactly one member. Every row a solo
// night writes is the row it wrote before this existed, and that equivalence is
// pinned in tests/mariokart-baseline.test.ts and
// apps/server/tests/mariokart-ledger-baseline.test.ts, both written and
// confirmed green against the pre-conversion engine.
//
// THE FORK, AND WHY IT IS NOT A SHARED CHANGE. `packages/shared/src/smash.ts`
// is not touched by any of this. Mario Kart stops inheriting the parts of the
// Smash session shape that now have to carry a side (its games, whose lines
// gain a `side`, and its KOTH state, which is keyed on kart ids rather than
// player ids) and declares its own; everything else still comes through the
// Omit. Ping Pong answered this question first and the same way: share the
// primitive, fork the rotation. Putting sides into SmashSessionState instead
// would drag Smashdown's burn board into a decision nobody has taken, and
// changing what kothAdvance's ids MEAN fails silently, because nothing errors
// when a throne is held by somebody who never played.
// ===========================================================================
import {
  newSmashState,
  type SmashSessionState,
  type SmashPlayer,
  type SmashMode,
  type SmashAssignment,
  type SmashResultDetail,
} from "./smash.js";
import type { SeriesBestOf, Series } from "./series.js";
import { seriesGameTally } from "./series.js";
import {
  MAX_SIDES,
  placementsFromRankedSides,
  sideOf,
  singletonSides,
  validateSides,
  type RankedSide,
  type Side,
} from "./teams.js";
import {
  currentSides,
  hasTeamStructure,
  newSideLog,
  reshuffle,
  sidesAtIdx,
  type SideLog,
} from "./sidelog.js";

export type MkFormat = "free" | "grandprix" | "bestof" | "koth";

// Grand Prix groups races into cups of raceCount, DERIVED from the games log
// by chunking: race i belongs to cup floor(i / raceCount) + 1, so cups
// advance automatically and undo just recomputes (no stored cup pointer to
// drift). raceCount is the only stored setting.
export interface MkGrandPrix {
  raceCount: number;
}

/** 1-based cup number a race at games index `idx` belongs to. */
export function cupNoForRace(idx: number, raceCount: number): number {
  return Math.floor(idx / raceCount) + 1;
}

/**
 * One racer's line in a recorded race.
 *
 * The Smash line plus `side`, which is why this is Mario Kart's own type rather
 * than an import. `side` is the KART the racer was in, or null whenever every
 * kart in that race held exactly one racer; teams.ts `sideIdFor` owns that rule
 * and no pack may decide it differently.
 */
export interface MkResultLine {
  playerId: string;
  character: string | null;
  placement: number;
  isWinner: boolean;
  side: string | null;
}

/** One recorded race. Smash's game shape with Mario Kart's lines in it. */
export interface MkGame {
  idx: number;
  mode: SmashMode;
  lines: MkResultLine[];
  at: string;
}

/**
 * King of the Hill, keyed on KART ids rather than player ids.
 *
 * The winning kart holds the table and the losing kart rotates to the back
 * TOGETHER, which is the whole point of a pairs ladder. `bestStreak` names the
 * kart and carries its members, the same call Ping Pong's reign record took:
 * the screen names the pair that did it and each member is credited
 * individually.
 */
export interface MkKothState {
  kingSideId: string | null;
  queue: string[]; // challenger kart ids, front races next
  streak: number;
  bestStreak: { sideId: string; memberIds: string[]; streak: number } | null;
}

// MK's state is the Smash session shape with MK's own format union, the Grand
// Prix bookkeeping, the side log, and the two pieces that now carry a side.
// A distinct type so the two packs never entangle.
//
// Smashdown's three fields are dropped rather than inherited: a Mario Kart
// session has no burn board, and carrying dead bookkeeping in its jsonb is how
// a future reader ends up wondering whether MK is supposed to have one.
//
// `games` and `koth` are dropped for a different reason: they are the
// SIDE-BEARING parts, and inheriting them would mean either putting a side into
// the Smash shape (rejected, see the block at the top of this file) or leaving
// Mario Kart with a line type that cannot say which kart somebody was in.
export interface MkSessionState
  extends Omit<SmashSessionState, "format" | "battleCount" | "burned" | "mercy" | "games" | "koth"> {
  format: MkFormat;
  grandPrix: MkGrandPrix;
  /**
   * Which arrangement of karts was in force when, oldest first. A log rather
   * than a field because the KOTH throne is REBUILT by replaying races, and a
   * replay that cannot tell which stretch was raced under which arrangement
   * hands the table to a pair that never won it. See sidelog.ts.
   */
  sideSets: SideLog;
  games: MkGame[];
  koth: MkKothState | null;
  /**
   * Best Of: the series is between two KART ids, not two player ids. `series.ts`
   * is generic over opaque slot ids, so this is a change of what the ids MEAN
   * and not a change to the primitive. Legacy sessions carrying player ids are
   * upgraded by `normalizeMkState`.
   */
  series: Series | null;
  seriesLog: Series[];
}

export function newMkKartState(opts: {
  format: MkFormat;
  titleId?: string | null;
  assignment: SmashAssignment;
  resultDetail: SmashResultDetail;
  roster: SmashPlayer[];
  bestOf?: SeriesBestOf;
  raceCount?: number;
  /** Defaults to one kart per racer, which is every night this pack had before. */
  sides?: Side[];
}): MkSessionState {
  const mode: SmashMode = opts.format === "koth" ? "koth" : "ffa";
  const base = newSmashState({
    mode,
    titleId: opts.titleId,
    assignment: opts.assignment,
    resultDetail: opts.resultDetail,
    roster: opts.roster,
    bestOf: opts.bestOf,
  });
  const {
    format: _drop,
    battleCount: _b,
    burned: _bu,
    mercy: _m,
    games: _g,
    koth: _k,
    ...rest
  } = base;
  const raceCount = Math.min(Math.max(Math.floor(Number(opts.raceCount) || 4), 2), 12);
  const sides = opts.sides?.length ? opts.sides : singletonSides(opts.roster.map((p) => p.id));
  return {
    ...rest,
    format: opts.format,
    grandPrix: { raceCount },
    sideSets: newSideLog(sides),
    games: [],
    koth: mode === "koth" ? openMkKoth(sides) : null,
  };
}

/** The arrangement of karts in force right now. */
export function mkSides(state: MkSessionState): Side[] {
  return currentSides(state.sideSets);
}

/** True when a kart in force holds more than one racer. Drives the whole screen. */
export function isKartPairs(state: MkSessionState): boolean {
  return hasTeamStructure(state.sideSets);
}

/** A kart by id out of the arrangement in force. */
export function mkSideById(state: MkSessionState, sideId: string | null | undefined): Side | undefined {
  return sideId ? mkSides(state).find((s) => s.id === sideId) : undefined;
}

/**
 * How many ledger units this session has recorded, which is the index space the
 * side log is keyed in.
 *
 * Mario Kart has TWO of them and exactly one is live in any session: Free Play,
 * Grand Prix and King of the Hill record RACES into `games`, and Best Of
 * records SETS into `seriesLog`. Getting this wrong is the silent kind: a
 * reshuffle keyed to the wrong counter puts its `fromIdx` in the wrong place
 * and the arrangement a recorded unit is reported under drifts.
 */
export function mkUnitCount(state: MkSessionState): number {
  return state.format === "bestof" ? state.seriesLog.length : state.games.length;
}

/** The arrangement of karts the recorded unit at `idx` was run under. */
export function mkSidesAtIdx(state: MkSessionState, idx: number): Side[] {
  return sidesAtIdx(state.sideSets, idx);
}

/** The opening ladder: the first kart holds the table, the rest queue behind it. */
function openMkKoth(sides: readonly Side[]): MkKothState {
  return {
    kingSideId: sides[0]?.id ?? null,
    queue: sides.slice(1).map((s) => s.id),
    streak: 0,
    bestStreak: null,
  };
}

/**
 * Put a new arrangement of karts in force from the next race on.
 *
 * Returns an error string or null. Races already recorded keep the `side` that
 * was written on their lines, so the night's history stays true; in King of the
 * Hill the ladder restarts, because a queue of karts that no longer exist is
 * not a queue.
 */
export function reshuffleMkSides(state: MkSessionState, sides: Side[]): string | null {
  // The primitive's verdict first, then this pack's own check, so an
  // arrangement that fails both reports the structural problem rather than the
  // roster one. `reshuffle` asks the primitive again; both calls are pure.
  const check = validateSides(sides);
  if (check.error) return check.error;
  const known = new Set(state.roster.map((p) => p.id));
  if (sides.some((s) => s.memberIds.some((id) => !known.has(id)))) {
    return "Somebody in a kart is not in this session";
  }
  if (state.series && state.series.games.length > 0) {
    return "Finish the set in progress first";
  }
  reshuffle(state.sideSets, sides, mkUnitCount(state));
  if (state.format === "koth") state.koth = openMkKoth(sides);
  else if (state.format === "bestof") state.series = null;
  return null;
}

// ---------- recording a race ----------

/**
 * Check a tapped finish order of KARTS against the arrangement in force.
 *
 * Karts rather than racers, which is what replaced `validateFfa` on this path:
 * the thing being ranked is the kart, and a rule expressed over racers cannot
 * say "these two finished first" without saying it twice. The cap is MAX_SIDES
 * (eight), and eight karts of two is sixteen racers, which is this pack's
 * roster cap exactly.
 */
export function validateMkRaceOrder(order: readonly string[], sides: readonly Side[]): string | null {
  if (order.length < 2) return "At least 2 karts have to race";
  if (order.length > MAX_SIDES) return `At most ${MAX_SIDES} karts`;
  if (new Set(order).size !== order.length) return "A kart can only finish once";
  const known = new Set(sides.map((s) => s.id));
  if (order.some((id) => !known.has(id))) return "That kart is not in this session";
  return null;
}

/**
 * The lines one recorded race produces, from a tapped finish order of KARTS.
 *
 * `placementsFromRankedSides` owns the placement rule: karts are ranked 1..N
 * over N karts and every member of a kart carries its placement, so two karts
 * of two is 1,1,2,2 and a 2v1 is 1,1,2 (or 1,2,2 when the solo wins). That is
 * deliberately NOT competition ranking, which is for genuine ties between
 * individuals; read the block at the top of teams.ts before changing it.
 *
 * WINNER-ONLY DETAIL IS THE SAME RULE WITH TIES. The host who only taps a
 * winner is saying "this kart won and the rest did not place", which is every
 * kart after the first finishing LEVEL with each other, and competition ranking
 * over karts turns that into 1,2,2,2. So there is one code path and not two.
 *
 * THE SIDE IS DECIDED OVER THE KARTS THAT RACED, not over the whole
 * arrangement. A night with one pair and two solo karts, in a race between the
 * two solo karts, has no team structure IN THAT RACE and writes null on both
 * rows, which is exactly what "null means no team structure" has to mean if
 * buildRivalry is going to keep reading it correctly.
 */
export function mkRaceLines(
  order: readonly string[],
  sides: readonly Side[],
  detail: SmashResultDetail,
  charOf: (playerId: string) => string | null,
): MkResultLine[] {
  const byId = new Map(sides.map((s) => [s.id, s]));
  const ranked: RankedSide[] = [];
  for (const [i, sideId] of order.entries()) {
    const side = byId.get(sideId);
    if (!side) continue;
    ranked.push({ side, tiedWithAbove: detail === "winner" && i > 1 });
  }
  return placementsFromRankedSides(ranked).map((line) => ({
    playerId: line.playerId,
    character: charOf(line.playerId),
    placement: line.placement,
    isWinner: line.isWinner,
    side: line.side,
  }));
}

/**
 * The finish order of karts a per-racer submission implies, for the solo path.
 *
 * The shipped client sends a race as explicit per-player placements, and a solo
 * night is karts of one, so the two spellings are the same information. Sorting
 * by placement recovers the order; ties (winner-only detail puts everybody who
 * did not win on 2) keep their submitted order, which is what the placement
 * rule then collapses back to 2 anyway.
 */
export function mkOrderFromPlacements(
  lines: readonly { playerId: string; placement: number }[],
  sides: readonly Side[],
): string[] {
  const sideOfPlayer = new Map<string, string>();
  for (const s of sides) for (const id of s.memberIds) sideOfPlayer.set(id, s.id);
  const out: string[] = [];
  for (const line of [...lines].sort((a, b) => a.placement - b.placement)) {
    const sideId = sideOfPlayer.get(line.playerId);
    if (sideId && !out.includes(sideId)) out.push(sideId);
  }
  return out;
}

// ---------- King of the Hill, keyed on karts ----------

/**
 * Advance the ladder after one race: the winning kart holds the table and the
 * LOSING KART GOES TO THE BACK TOGETHER.
 *
 * Mario Kart's own rotation, sitting next to Mario Kart's own state, which is
 * what `pingpong.ts` did rather than reaching for `kothAdvance`. That function
 * is keyed on `winnerId` / `loserId` meaning PLAYERS, it is shipped, and it is
 * shared with Smash; quietly changing what its ids mean is the exact failure
 * this project guards against, because nothing errors when a throne ends up
 * held by somebody who never raced.
 *
 * The filter before the append is what stops a kart appearing in the queue
 * twice when it was already in it, and it is the same line Ping Pong uses.
 */
export function mkKothAdvance(koth: MkKothState, winner: Side, loser: Side): MkKothState {
  const streak = winner.id === koth.kingSideId ? koth.streak + 1 : 1;
  const bestStreak =
    !koth.bestStreak || streak > koth.bestStreak.streak
      ? { sideId: winner.id, memberIds: [...winner.memberIds], streak }
      : koth.bestStreak;
  const queue = [...koth.queue.filter((id) => id !== winner.id && id !== loser.id), loser.id];
  return { kingSideId: winner.id, queue, streak, bestStreak };
}

/**
 * Rebuild the throne and queue by REPLAYING the races run under the current
 * arrangement. Mutates.
 *
 * Races from before a reshuffle are skipped: they were raced by karts that no
 * longer exist, and the ladder restarts at a reshuffle. This is why the
 * arrangement is a log with a `fromIdx` rather than a field, and it is what
 * makes undo correct by construction instead of correct until somebody forgets
 * to unwind a counter.
 *
 * The winning and losing KART are recovered from the race's lines through the
 * arrangement rather than read off them, because a solo night writes `side`
 * null on every line by design and the kart is still perfectly well defined:
 * one racer, one kart.
 */
export function rebuildMkKoth(state: MkSessionState): void {
  const set = state.sideSets[state.sideSets.length - 1];
  const sides = set?.sides ?? [];
  let k = openMkKoth(sides);
  for (const g of state.games) {
    if (!set || g.idx < set.fromIdx) continue;
    const won = g.lines.find((l) => l.isWinner);
    const lost = g.lines.find((l) => !l.isWinner);
    const winner = won ? sideOf(sides, won.playerId) : undefined;
    const loser = lost ? sideOf(sides, lost.playerId) : undefined;
    if (!winner || !loser || winner.id === loser.id) continue;
    k = mkKothAdvance(k, winner, loser);
  }
  state.koth = k;
}

// ---------- recording a best-of set ----------

/** One participant row a completed set produces, before the runtime sees it. */
export interface MkSeriesLine {
  playerId: string;
  character: string | null;
  placement: number;
  isWinner: boolean;
  meta: { gameWins: number; gamesPlayed: number };
  side: string | null;
}

/**
 * The rows one completed best-of set writes: winning kart 1, losing kart 2, on
 * every member of each.
 *
 * The per-race tally is the KART's and is written onto each of its members,
 * exactly as Ping Pong credits both members of a pair with the games their side
 * won. Two people who won a set together both won that set.
 *
 * `sides` is the arrangement the SET was played under, which the caller looks
 * up rather than assuming: a host can reshuffle karts between sets.
 */
export function mkSeriesLines(
  series: Series,
  sides: readonly Side[],
  charOf: (playerId: string) => string | null,
): MkSeriesLine[] {
  if (!series.winnerId) return [];
  const byId = new Map(sides.map((s) => [s.id, s]));
  const loserId = series.winnerId === series.aId ? series.bId : series.aId;
  const winner = byId.get(series.winnerId);
  const loser = byId.get(loserId);
  if (!winner || !loser) return [];

  const tally = seriesGameTally(series);
  return placementsFromRankedSides([{ side: winner }, { side: loser }]).map((line) => {
    const mySide = winner.memberIds.includes(line.playerId) ? series.winnerId! : loserId;
    const g = tally.get(mySide) ?? { wins: 0, played: 0 };
    return {
      playerId: line.playerId,
      character: charOf(line.playerId),
      placement: line.placement,
      isWinner: line.isWinner,
      meta: { gameWins: g.wins, gamesPlayed: g.played },
      side: line.side,
    };
  });
}

// Mario Kart 8 points table (positions 1..12). Fewer racers just use the top
// of the table, which keeps the spread meaningful for a friend group.
const MK_POINTS = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
export function mkPoints(placement: number): number {
  return placement >= 1 && placement <= MK_POINTS.length ? MK_POINTS[placement - 1]! : 0;
}

export interface MkCupStanding {
  playerId: string;
  name: string;
  points: number;
  wins: number;
  races: number;
}

/**
 * Standings for the CURRENT cup, derived from the games log by chunking. On a
 * cup boundary (races is an exact multiple of raceCount) the just-completed
 * cup is shown as complete; otherwise the in-progress partial cup is shown.
 * Never a ledger row.
 */
export function cupStandings(state: MkSessionState): {
  standings: MkCupStanding[];
  cupNo: number;
  racesDone: number;
  raceCount: number;
  complete: boolean;
} {
  const rc = state.grandPrix.raceCount;
  const total = state.games.length;
  let cupNo: number;
  let cupStart: number;
  if (total === 0) {
    cupNo = 1;
    cupStart = 0;
  } else if (total % rc === 0) {
    cupNo = total / rc; // the cup that just filled up
    cupStart = total - rc;
  } else {
    cupNo = Math.floor(total / rc) + 1;
    cupStart = Math.floor(total / rc) * rc;
  }
  const cupGames = state.games.slice(cupStart, cupStart + rc);
  const nameOf = new Map(state.roster.map((p) => [p.id, p.name]));
  const acc = new Map<string, MkCupStanding>();
  const ensure = (id: string) => {
    let s = acc.get(id);
    if (!s) {
      s = { playerId: id, name: nameOf.get(id) ?? "?", points: 0, wins: 0, races: 0 };
      acc.set(id, s);
    }
    return s;
  };
  for (const g of cupGames) {
    for (const l of g.lines) {
      const s = ensure(l.playerId);
      s.points += mkPoints(l.placement);
      s.races++;
      if (l.isWinner) s.wins++;
    }
  }
  return {
    standings: [...acc.values()].sort((a, b) => b.points - a.points || b.wins - a.wins),
    cupNo,
    racesDone: cupGames.length,
    raceCount: rc,
    complete: cupGames.length >= rc,
  };
}

export const MARIO_KART_TITLES: GameTitle[] = [
  { id: "mk8dx", name: "Mario Kart 8 Deluxe", roster: MARIO_KART_RACERS },
  {
    id: "mkworld",
    name: "Mario Kart World",
    roster: [
      "Mario", "Luigi", "Peach", "Daisy", "Yoshi", "Donkey Kong", "Bowser", "Bowser Jr.",
      "Koopa Troopa", "Toad", "Toadette", "Lakitu", "King Boo", "Shy Guy", "Wario", "Waluigi",
      "Birdo", "Pauline", "Rosalina", "Baby Mario", "Baby Luigi", "Baby Peach", "Baby Daisy",
      "Baby Rosalina",
    ],
  },
  {
    id: "mkwii",
    name: "Mario Kart Wii",
    roster: [
      "Mario", "Luigi", "Peach", "Daisy", "Rosalina", "Baby Mario", "Baby Luigi", "Baby Peach",
      "Baby Daisy", "Toad", "Toadette", "Koopa Troopa", "Dry Bones", "Bowser", "Bowser Jr.",
      "Wario", "Waluigi", "Donkey Kong", "Diddy Kong", "Yoshi", "Birdo", "King Boo", "Dry Bowser",
      "Funky Kong", "Mii",
    ],
  },
  {
    id: "mkdd",
    name: "Double Dash!!",
    roster: [
      "Mario", "Luigi", "Peach", "Daisy", "Yoshi", "Birdo", "Baby Mario", "Baby Luigi", "Toad",
      "Toadette", "Koopa Troopa", "Paratroopa", "Donkey Kong", "Diddy Kong", "Bowser", "Bowser Jr.",
      "Wario", "Waluigi", "Petey Piranha", "King Boo",
    ],
  },
  {
    id: "mk64",
    name: "Mario Kart 64",
    roster: ["Mario", "Luigi", "Peach", "Toad", "Yoshi", "Donkey Kong", "Wario", "Bowser"],
  },
];

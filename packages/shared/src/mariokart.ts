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

// `isRacer` and the set behind it live at the BOTTOM of this file, after
// MARIO_KART_TITLES, because the set is the union of every title's roster and
// cannot be built before the titles exist. See the comment there.

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
// THE FORK IS OVER, AMENDED 2026-09-05 BY THE SMASH TEAM BATTLES SESSION.
//
// What this block used to say, and it was true on the day it was written: that
// `packages/shared/src/smash.ts` is not touched by any of this, that Mario Kart
// stops inheriting the side-bearing parts of the Smash session shape and
// declares its own, and that putting sides into SmashSessionState would drag
// Smashdown's burn board into a decision nobody had taken.
//
// That decision has now been taken. Smash's own 2v2 work put `sideSets` into
// SmashSessionState, put `side` on SmashResultLine, and re-keyed `kothAdvance`
// onto SIDES, which is what this block predicted would be needed and declined
// to do pre-emptively. Smashdown's burn board turned out not to be dragged
// anywhere at all: it burns per LINE and each player picks their own fighter,
// so a 2v2 burns four fighters per battle exactly as four solo players do, and
// `smashdownCap` did not move. The Smashdown problem that WAS real was a
// different one (mercy stops firing when standings are per player), and it is
// solved in Smash, not here.
//
// So Mario Kart declares LESS than it used to rather than more: MkResultLine,
// MkGame and MkKothState are now aliases of the Smash shapes they had forked
// from, `sideSets` is inherited, and the Omit is down to the four fields that
// genuinely differ (its own format union, and Smashdown's three, which a kart
// session still has no use for). What survives unchanged is the paragraph above
// this one: a kart is a side, a solo night is one racer per kart, and every row
// a solo night writes is the row it wrote before any of this existed.
//
// Left as a warning for the next reader: the reason this block existed at all
// was that changing what `kothAdvance`'s ids MEAN fails silently, because
// nothing errors when a throne is held by somebody who never played. That is
// still true. It was safe to do here only because both packs moved together and
// both carry a captured pre-conversion fixture that would have caught it.
// ===========================================================================
import {
  kothAdvance,
  newSmashState,
  openSmashKoth,
  type KothState,
  type SmashAssignment,
  type SmashGame,
  type SmashMode,
  type SmashPlayer,
  type SmashResultDetail,
  type SmashResultLine,
  type SmashSessionState,
} from "./smash.js";
import type { SeriesBestOf, Series } from "./series.js";
import { seriesGameTally } from "./series.js";
import {
  MAX_SIDES,
  placementsFromRankedSides,
  sideIdAt,
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
  truncateSideLog,
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
 * One racer's line in a recorded race. Mario Kart's NAME for the Smash line.
 *
 * It was this pack's own interface from 2026-08-16 to 2026-09-05, for the one
 * reason the header block gives: the Smash line had no `side` and this one
 * needed it. It has one now, so the fork has nothing left to hold apart and
 * this is an alias. `side` is the KART the racer was in, or null whenever every
 * kart in that race held exactly one racer; teams.ts `sideIdFor` owns that rule
 * and no pack may decide it differently.
 */
export type MkResultLine = SmashResultLine;

/** One recorded race. Smash's game shape, which now carries Mario Kart's lines. */
export type MkGame = SmashGame;

/**
 * King of the Hill, keyed on KART ids rather than player ids.
 *
 * The winning kart holds the table and the losing kart rotates to the back
 * TOGETHER, which is the whole point of a pairs ladder. `bestStreak` names the
 * kart and carries its members, the same call Ping Pong's reign record took:
 * the screen names the pair that did it and each member is credited
 * individually.
 */
export type MkKothState = KothState;

// MK's state is the Smash session shape with MK's own format union and the
// Grand Prix bookkeeping. A distinct type so the two packs never entangle.
//
// Smashdown's three fields are dropped rather than inherited: a Mario Kart
// session has no burn board, and carrying dead bookkeeping in its jsonb is how
// a future reader ends up wondering whether MK is supposed to have one. That is
// the whole Omit now.
//
// `games`, `koth` and `sideSets` used to be dropped and redeclared too, because
// they were the SIDE-BEARING parts and the Smash shape had no sides. It has
// them as of 2026-09-05, so redeclaring them here would be either a redundant
// restatement of the inherited type or a silent divergence from it. They are
// inherited. See the header block.
//
// `series` and `seriesLog` are inherited for the same reason and mean the same
// thing in both packs: a set is between two SIDE ids, not two player ids.
// `series.ts` is generic over opaque slot ids, so that is a change of what the
// ids MEAN and not a change to the primitive. Legacy sessions carrying player
// ids are upgraded by `normalizeMkState` here and `normalizeSmashState` there.
export interface MkSessionState
  extends Omit<SmashSessionState, "format" | "battleCount" | "burned" | "mercy"> {
  format: MkFormat;
  grandPrix: MkGrandPrix;
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
  // The side log, the empty games log and the opening ladder all come out of
  // the shared factory now, off the same `sides` this one takes. Only the three
  // Smashdown fields and the format union are dropped.
  const base = newSmashState({
    mode,
    titleId: opts.titleId,
    assignment: opts.assignment,
    resultDetail: opts.resultDetail,
    roster: opts.roster,
    bestOf: opts.bestOf,
    sides: opts.sides,
  });
  const { format: _drop, battleCount: _b, burned: _bu, mercy: _m, ...rest } = base;
  const raceCount = Math.min(Math.max(Math.floor(Number(opts.raceCount) || 4), 2), 12);
  return {
    ...rest,
    format: opts.format,
    grandPrix: { raceCount },
  };
}

// ---------- legacy state ----------

/**
 * Upgrade a session persisted under the pre-karts shape.
 *
 * Rows in `game_sessions` were written with no `sideSets` at all, no `side` on
 * a race's lines, a `koth` holding a `kingId` plus a queue of PLAYER ids, and a
 * `series` between two PLAYER ids. A night that is live when this deploys has
 * to keep working, and a finished one has to stay readable by the guest
 * backfill, so the upgrade happens at the two points where jsonb becomes state
 * (PackRuntimeConfig.normalize) and nowhere else. Doing it at the pack's own
 * call sites means getting all of them, and this pack reads state in nine
 * places plus the backfill.
 *
 * THE UPGRADE IS EXACT RATHER THAN APPROXIMATE. Every race ever recorded by
 * this pack was raced by individuals, so the roster becomes one kart per racer,
 * which `sideIdFor` then treats as no team structure, which is what it always
 * was. A legacy race's lines get `side: null` written on them explicitly, and
 * that is the same NULL the column has always held for this pack.
 *
 * Follows normalizePpState, which does the same job for Ping Pong's KOTH queue.
 */
export function normalizeMkState(state: MkSessionState): MkSessionState {
  const raw = state as unknown as Record<string, unknown>;
  if (Array.isArray(raw.sideSets) && raw.sideSets.length > 0) return state;

  const roster = (state.roster ?? []) as SmashPlayer[];
  const sides = singletonSides(roster.map((p) => p.id));
  const sideIdOfPlayer = new Map(roster.map((p, i) => [p.id, sideIdAt(i)]));
  /** A player id becomes the id of the kart holding them; anything else is left. */
  const toSideId = (id: string | null | undefined): string | null =>
    id ? sideIdOfPlayer.get(id) ?? null : null;

  const upgradeSeries = (s: Series | null | undefined): Series | null => {
    if (!s) return null;
    const aId = toSideId(s.aId);
    const bId = toSideId(s.bId);
    if (!aId || !bId) return null;
    return {
      idx: s.idx ?? -1,
      aId,
      bId,
      games: (s.games ?? []).map((g) => ({ winnerId: toSideId(g.winnerId) ?? aId })),
      winnerId: s.winnerId ? toSideId(s.winnerId) : null,
      at: s.at ?? null,
    };
  };

  const k = raw.koth as Record<string, unknown> | null | undefined;
  const legacyBest = k?.bestStreak as { playerId?: string; streak?: number } | null | undefined;
  const bestSideId = toSideId(legacyBest?.playerId);
  const koth: MkKothState | null = k
    ? {
        kingSideId: toSideId(k.kingId as string) ?? sides[0]?.id ?? null,
        queue: ((k.queue ?? []) as string[])
          .map((id) => toSideId(id))
          .filter((id): id is string => !!id),
        streak: (k.streak as number) ?? 0,
        bestStreak:
          legacyBest && bestSideId
            ? {
                sideId: bestSideId,
                memberIds: [legacyBest.playerId!],
                streak: legacyBest.streak ?? 0,
              }
            : null,
      }
    : null;

  return {
    ...state,
    sideSets: newSideLog(sides),
    games: ((raw.games ?? []) as MkGame[]).map((g) => ({
      ...g,
      lines: (g.lines ?? []).map((l) => ({ ...l, side: l.side ?? null })),
    })),
    koth,
    series: upgradeSeries(state.series),
    seriesLog: ((state.seriesLog ?? []) as Series[])
      .map(upgradeSeries)
      .filter((s): s is Series => s !== null),
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

/**
 * The opening ladder: the first kart holds the table, the rest queue behind it.
 *
 * The shared opener under Mario Kart's name. It was five duplicated lines until
 * the Smash pack grew the same ladder; see the header block.
 */
const openMkKoth = openSmashKoth;

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
 * This was Mario Kart's own rotation, forked deliberately in 2026-08 because
 * the shared `kothAdvance` was keyed on ids meaning PLAYERS and quietly
 * changing what they mean fails silently. The Smash team-battles session moved
 * that function onto SIDES, under the same fixture protection, so the two are
 * now the same rotation and this is its Mario Kart name. See the header block.
 */
export const mkKothAdvance = kothAdvance;

/** The two karts up next: the one holding the table and the front of the queue. */
export function mkKothPair(state: MkSessionState): { king: Side; challenger: Side } | null {
  const king = mkSideById(state, state.koth?.kingSideId);
  const challenger = mkSideById(state, state.koth?.queue[0]);
  if (!king || !challenger || king.id === challenger.id) return null;
  return { king, challenger };
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

/**
 * Undo the last recorded race. Mutates. Returns the idx the caller has to
 * un-materialize from the ledger, or null when there was nothing to undo.
 *
 * THE ORDER OF THE TWO STEPS IS THE WHOLE FUNCTION, which is why it is here
 * rather than inline in a route. Truncating the side log has to happen BEFORE
 * the throne is rebuilt: the rebuild replays the races run under the
 * arrangement in force, so rebuilding first would replay them under an
 * arrangement that nothing is raced under any more and hand the table to a kart
 * that never won it. Nothing errors either way, and the screen is simply wrong.
 */
export function undoMkRace(state: MkSessionState): { unmaterializeIdx: number | null } {
  const last = state.games.pop();
  if (!last) return { unmaterializeIdx: null };
  truncateSideLog(state.sideSets, state.games.length);
  if (state.format === "koth") rebuildMkKoth(state);
  return { unmaterializeIdx: last.idx };
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

// ---------- the title sets the shape ----------

/** The one title in the roster where two people share a kart. */
export const DOUBLE_DASH_TITLE_ID = "mkdd";

/** The one roster size the auto-apply fires for. Read the block below first. */
export const KART_PAIRS_ROSTER_SIZE = 4;

/**
 * Put the roster into karts when the host says which Mario Kart is on.
 *
 * DOUBLE DASH PLUS EXACTLY FOUR PLAYERS OPENS IN PAIRS, and nothing else does.
 * It is grounded in the actual game: the GameCube has four controller ports, so
 * four players in two karts is what a Double Dash co-op night IS. It follows
 * the Euchre precedent in titlenight.ts and for the same reason, that a default
 * which has to be found in a menu is a default that does not get used, and the
 * alternative is a crew recording four races as a free-for-all and noticing in
 * the stats a month later.
 *
 * EXACTLY FOUR IS A DELIBERATE LINE RATHER THAN A STARTING POINT (James,
 * 2026-08-16). Every other arrangement, uneven ones included, is available and
 * is OPT-IN through the picker. Three players is not two even karts, and
 * auto-dealing somebody into a solo kart is the app making a judgement about a
 * night it was not at. Two players is a 1v1, which is singletons. Six and eight
 * are not reachable on one console, and a host running two consoles can set
 * karts by hand. DO NOT widen this to "any even roster" because it looks tidier.
 *
 * THREE GUARDS, each with its own named test, because all three fail silently:
 *
 *   1. IT FIRES ONLY WHEN THE KART COUNT DIFFERS. A host who has already put
 *      four people into two specific karts and then taps Double Dash keeps
 *      their karts: the title wanted two and there are two, so there is nothing
 *      to decide. Free-for-all counts as one kart per racer, so its count is
 *      the roster size.
 *   2. GOING THE OTHER WAY IS DETERMINISTIC. Any title that is not Double Dash
 *      gives one kart per racer in ROSTER ORDER, never a shuffle. Reverting is
 *      correct rather than merely tidy, because no other title in the roster
 *      has a shared kart.
 *   3. SETUP ONLY, NEVER ONCE A RACE HAS BEEN LOGGED. Once races exist,
 *      changing the arrangement is a reshuffle with a fromIdx and it is a
 *      deliberate host action. An auto-apply that rearranged the table between
 *      two races would silently change what the night was raced under, and it
 *      would look exactly like a host who rearranged it on purpose.
 *
 * THE PAIRING ITSELF IS ROSTER ORDER, NOT A SHUFFLE, which is the one place
 * this departs from the Euchre precedent. It is what makes guard 2 hold in both
 * directions: Double Dash, then MK8 Deluxe, then Double Dash hands the host the
 * same screen back rather than a new random deal. It is also the least
 * opinionated answer available, because roster order is the order the host
 * typed people in, which on a four-port console is the order they are sitting
 * in. A host who wants a random deal has the Shuffle button in the picker.
 *
 * THE TRIGGER MATTERS AND IS PASSED IN. A title change evaluates both
 * directions; a ROSTER change only ever puts karts together, never takes them
 * apart. Without that split, a host who had hand-built karts for a five-player
 * MK8 Deluxe night and then added a sixth racer would watch their karts
 * dissolve, which is the feature undoing the host's work.
 *
 * Works in ROSTER INDICES rather than slot ids, because slot ids are minted by
 * the server when the session starts and this runs before that: it is the same
 * level TeamPicker works at, and the two have to agree.
 *
 * Returns the new assignment, or null for "leave the table alone".
 */
export function autoKartAssign(opts: {
  titleId: string | null | undefined;
  rosterSize: number;
  /** The picker's current assignment, as roster indices per kart. */
  assign: readonly (readonly number[])[];
  trigger: "title" | "roster";
  /** Anything above zero means the night has started. Defaults to 0. */
  racesRecorded?: number;
}): number[][] | null {
  // Guard 3, first, because it outranks the other two.
  if ((opts.racesRecorded ?? 0) > 0) return null;
  if (opts.rosterSize < 2) return null;

  const doubleDash = opts.titleId === DOUBLE_DASH_TITLE_ID;
  const pairs = doubleDash && opts.rosterSize === KART_PAIRS_ROSTER_SIZE;
  if (!pairs) {
    // A roster change puts karts together and never takes them apart.
    if (opts.trigger === "roster") return null;
    // NEITHER DOES DOUBLE DASH ITSELF. Reverting is justified by "no other
    // title in the roster has a shared kart", and Double Dash is the one that
    // does, so a five-player Double Dash night with hand-built karts keeps them
    // when the host taps the title again. Only a title with no shared kart
    // dissolves one.
    if (doubleDash) return null;
  }

  // Guard 1. Free-for-all is one kart per racer, so its count is the roster size.
  const target = pairs ? 2 : opts.rosterSize;
  if (opts.assign.length === target) return null;

  // Guard 2, and the forward direction, both in roster order.
  return pairs
    ? [[0, 1], [2, 3]]
    : Array.from({ length: opts.rosterSize }, (_, i) => [i]);
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

// ---------- the racer gate ----------

/**
 * Every racer ANY Mario Kart title in this pack offers.
 *
 * IT IS THE UNION AND NOT THE MK8 DELUXE LIST, and that fix closed a latent bug
 * that had a todo test sitting on it since 2026-08-15 (AUDIT-2026-08.md NOTED
 * 9). A title scopes the picker and the random pool, so a host on a Double Dash
 * night is offered Double Dash's roster, and Paratroopa is in it and is in no
 * other title. `isRacer` is the gate a submitted racer passes through on the
 * way to the ledger and it checked MARIO_KART_RACERS alone, which IS mk8dx's
 * roster. So Paratroopa was pickable and then unrecognised, and the failure was
 * the silent kind: the name was replaced with null rather than refused.
 *
 * It was LATENT rather than live because both gates had something rescuing
 * them, and the pairs session removed one of those rescues (the record route no
 * longer falls back to the slot's stored racer, because a race now carries its
 * racers from the roster rather than from the request). That is exactly the
 * "a pass that tidies away the fallback makes it live" case the todo named, so
 * it is fixed in the same session rather than left for the next one.
 *
 * MARIO_KART_RACERS is unchanged and still IS mk8dx's roster, which is pinned
 * by its own test. Widening that constant instead would have put Paratroopa in
 * the MK8 Deluxe picker, where the character does not exist.
 */
const RACER_SET = new Set(MARIO_KART_TITLES.flatMap((t) => t.roster));

export function isRacer(name: unknown): name is string {
  return typeof name === "string" && RACER_SET.has(name);
}

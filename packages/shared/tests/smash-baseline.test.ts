// WHAT THE SMASH PACK DOES TODAY, captured by RUNNING the unmodified engine.
//
// Written BEFORE the team-battles work starts, and containing no assertion
// about teams at all. That is the whole point of it. The team session puts a
// side log into SmashSessionState, re-keys King of the Hill onto side ids,
// changes what a Best Of series' two ids MEAN, and gives Smashdown a second
// standings shape. The risk in every one of those is not that it breaks
// loudly. It is that a SOLO night, which is every Smash night this crew has
// ever played, comes out fractionally different and nobody notices for a month.
//
// So the numbers below were produced by the shipped code rather than reasoned
// out by hand, and they cover all four formats: FFA (in both result details),
// King of the Hill (the throne replayed the way the server replays it on undo),
// Best Of (a bo5 to completion) and Smashdown (a full series, a mercy-clinched
// one, and a co-win).
//
// The Smashdown RULES already have smashdown.test.ts and are not duplicated;
// what IS here is what a whole series reports, because the team work replaces
// the standings computation with a per-side sibling and the solo answer has to
// survive it unchanged.
//
// IF A LATER COMMIT TURNS ONE OF THESE RED, THE LATER COMMIT IS WRONG.
//
// AMENDED ONCE, in the commit that put sides into the session shape, and the
// amendment is worth understanding before making another one. Two things moved
// and NEITHER is an asserted value:
//
//   - `sideSets` was ADDED to the field list. A field appearing is harmless; a
//     field DISAPPEARING is a live night reading undefined, and nothing
//     disappeared.
//   - `replayThrone` folds over the SINGLETON ARRANGEMENT instead of over bare
//     player ids, because `kothAdvance` is keyed on sides now. Every id it
//     asserts is still a player id, mapped back out of the side holding them,
//     so the ladder below is the same sequence it was captured as. That makes
//     this fixture stronger rather than weaker: it now pins that a solo ladder
//     comes out identical THROUGH the side machinery.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  burnedFrom,
  kothAdvance,
  openSmashKoth,
  sideOf,
  singletonSides,
  newSeries,
  newSmashState,
  recordSeriesGame,
  seriesGameTally,
  smashdownStatus,
  summarizeNight,
  summarizeSeriesLog,
  validateFfa,
  type SmashFormat,
  type SmashGame,
  type SmashMode,
  type SmashPlayer,
  type SmashResultDetail,
  type SmashResultLine,
  type SmashSessionState,
} from "../src/index.js";

const ROSTER: SmashPlayer[] = [
  { id: "p0", kind: "member", userId: "u0", name: "Ann", character: "Mario" },
  { id: "p1", kind: "member", userId: "u1", name: "Ben", character: "Fox" },
  { id: "p2", kind: "member", userId: "u2", name: "Cal", character: "Kirby" },
  { id: "p3", kind: "guest", userId: null, name: "Dee", character: "Link" },
];

const state = (
  format: SmashFormat,
  mode: SmashMode,
  resultDetail: SmashResultDetail = "placement",
  extra: Partial<{ battleCount: number; mercy: boolean }> = {},
): SmashSessionState =>
  newSmashState({
    format,
    mode,
    assignment: "self",
    resultDetail,
    roster: ROSTER.map((p) => ({ ...p })),
    ...extra,
  });

const charOf = new Map(ROSTER.map((p) => [p.id, p.character]));

/**
 * The FFA line mapping apps/server/src/smash.ts does today, both details.
 * Copied rather than imported because the route is not a function: it reads a
 * request body and writes a database row. These two are the shapes the team
 * work has to keep producing for a night with no team structure.
 */
function ffaWinner(winnerId: string): SmashResultLine[] {
  const lines: SmashResultLine[] = ROSTER.map((p) => ({
    playerId: p.id,
    character: charOf.get(p.id) ?? null,
    placement: 0,
    isWinner: p.id === winnerId,
  }));
  for (const l of lines) l.placement = l.isWinner ? 1 : 2;
  return lines;
}
function ffaPlacement(order: readonly string[]): SmashResultLine[] {
  const lines: SmashResultLine[] = order.map((playerId, i) => ({
    playerId,
    character: charOf.get(playerId) ?? null,
    placement: i + 1,
    isWinner: false,
  }));
  for (const l of lines) l.isWinner = l.placement === 1;
  return lines;
}
const game = (idx: number, lines: SmashResultLine[]): SmashGame => ({
  idx,
  mode: "ffa",
  lines,
  at: `2026-09-05T20:0${idx}:00.000Z`,
});

// ---------- the session a start produces ----------

test("BASELINE: a fresh Smash session has exactly these fields", () => {
  // The field list is the thing that moves when a pack takes a new sub-state,
  // and a field appearing is harmless while a field DISAPPEARING is a live
  // night reading undefined. Sorted so the assertion does not depend on the
  // order the spread happens to produce.
  assert.deepEqual(Object.keys(state("ffa", "ffa")).sort(), [
    "assignment",
    "battleCount",
    "bestOf",
    "burned",
    "format",
    "games",
    "koth",
    "mercy",
    "mode",
    "openScoring",
    "resultDetail",
    "roster",
    "series",
    "seriesLog",
    "sessionKey",
    "sideSets", // ADDED 2026-09-05 with team battles. Nothing was removed.
    "titleId",
  ]);
});

test("BASELINE: a KOTH session opens with the first slot on the throne", () => {
  const s = state("koth", "koth");
  assert.equal(s.mode, "koth");
  assert.equal(s.format, "koth");
  // Read back in PLAYERS, which is what a solo night's ladder is and what this
  // pinned before the throne was keyed on sides.
  assert.deepEqual(
    { king: memberOf(s.koth!.kingSideId), queue: s.koth!.queue.map(memberOf), streak: s.koth!.streak, bestStreak: s.koth!.bestStreak },
    { king: "p0", queue: ["p1", "p2", "p3"], streak: 0, bestStreak: null },
  );
  // And the arrangement it opened under is one side per player, in roster
  // order, which is the exactness claim the whole conversion rests on.
  assert.deepEqual(
    s.sideSets,
    [{ fromIdx: 0, sides: ROSTER.map((p, i) => ({ id: "abcd"[i], name: `Side ${"ABCD"[i]}`, memberIds: [p.id] })) }],
  );
});

test("BASELINE: bestof and smashdown open on the ffa engine, with empty logs", () => {
  const bo = state("bestof", "ffa");
  assert.deepEqual(
    { format: bo.format, mode: bo.mode, bestOf: bo.bestOf, series: bo.series, seriesLog: bo.seriesLog, games: bo.games },
    { format: "bestof", mode: "ffa", bestOf: 3, series: null, seriesLog: [], games: [] },
  );
  const sd = state("smashdown", "ffa", "winner", { battleCount: 3, mercy: true });
  assert.deepEqual(
    { format: sd.format, mode: sd.mode, battleCount: sd.battleCount, burned: sd.burned, mercy: sd.mercy },
    { format: "smashdown", mode: "ffa", battleCount: 3, burned: [], mercy: true },
  );
});

// ---------- FFA: both result details ----------

test("BASELINE: FFA winner detail is one 1 and everybody else on 2", () => {
  const lines = ffaWinner("p2");
  assert.equal(validateFfa(lines, "winner"), null);
  assert.deepEqual(lines, [
    { playerId: "p0", character: "Mario", placement: 2, isWinner: false },
    { playerId: "p1", character: "Fox", placement: 2, isWinner: false },
    { playerId: "p2", character: "Kirby", placement: 1, isWinner: true },
    { playerId: "p3", character: "Link", placement: 2, isWinner: false },
  ]);
});

test("BASELINE: FFA placement detail is a permutation of 1..N, winner on 1", () => {
  const lines = ffaPlacement(["p1", "p3", "p0", "p2"]);
  assert.equal(validateFfa(lines, "placement"), null);
  assert.deepEqual(lines, [
    { playerId: "p1", character: "Fox", placement: 1, isWinner: true },
    { playerId: "p3", character: "Link", placement: 2, isWinner: false },
    { playerId: "p0", character: "Mario", placement: 3, isWinner: false },
    { playerId: "p2", character: "Kirby", placement: 4, isWinner: false },
  ]);
});

test("BASELINE: FFA, three games, the night summary reads exactly this", () => {
  const s = state("ffa", "ffa");
  s.games.push(
    game(0, ffaPlacement(["p0", "p1", "p2", "p3"])),
    game(1, ffaPlacement(["p1", "p0", "p3", "p2"])),
    game(2, ffaWinner("p0")),
  );
  const summary = summarizeNight(s);
  assert.deepEqual(summary.characters, [
    { character: "Mario", played: 3, wins: 2 },
    { character: "Fox", played: 3, wins: 1 },
    { character: "Kirby", played: 3, wins: 0 },
    { character: "Link", played: 3, wins: 0 },
  ]);
  assert.deepEqual(summary.players, [
    { playerId: "p0", name: "Ann", played: 3, wins: 2, mainCharacter: "Mario", wonWith: 1 },
    { playerId: "p1", name: "Ben", played: 3, wins: 1, mainCharacter: "Fox", wonWith: 1 },
    { playerId: "p2", name: "Cal", played: 3, wins: 0, mainCharacter: "Kirby", wonWith: 0 },
    { playerId: "p3", name: "Dee", played: 3, wins: 0, mainCharacter: "Link", wonWith: 0 },
  ]);
});

// ---------- King of the Hill: six rounds, a throne change, a bestStreak ----------

/** The solo arrangement: one side per player, in roster order. */
const SIDES = singletonSides(ROSTER.map((p) => p.id));
/** The one player a singleton side holds, so every step below reads in players. */
const memberOf = (sideId: string | null | undefined): string | null =>
  SIDES.find((s) => s.id === sideId)?.memberIds[0] ?? null;

/**
 * The throne replay EXACTLY as apps/server/src/smash.ts does it on undo: open
 * on the roster order and fold every remaining game through kothAdvance.
 *
 * The rotation is keyed on SIDES, so a solo night folds the singleton
 * arrangement through it and maps each side back to the one player it holds.
 * The sequence asserted below is unchanged by that: it is what the pre-teams
 * engine produced, and this is the fixture that says the side machinery gives
 * a solo ladder back untouched.
 */
function replayThrone(rounds: readonly [string, string][]) {
  const sideFor = (playerId: string) => sideOf(SIDES, playerId)!;
  let koth = openSmashKoth(SIDES);
  const steps: { kingId: string | null; queue: (string | null)[]; streak: number }[] = [];
  for (const [winnerId, loserId] of rounds) {
    koth = kothAdvance(koth, sideFor(winnerId), sideFor(loserId));
    steps.push({ kingId: memberOf(koth.kingSideId), queue: koth.queue.map(memberOf), streak: koth.streak });
  }
  return { koth, steps };
}

const LADDER: [string, string][] = [
  ["p0", "p1"], // Ann defends
  ["p0", "p2"], // and again
  ["p0", "p3"], // and again: streak 3, which is the night's best
  ["p1", "p0"], // Ben takes the throne
  ["p1", "p2"], // Ben defends
  ["p3", "p1"], // Dee takes it
];

test("BASELINE: KOTH, the winner holds and the loser goes to the BACK", () => {
  const { steps } = replayThrone([["p0", "p1"]]);
  assert.deepEqual(steps[0], { kingId: "p0", queue: ["p2", "p3", "p1"], streak: 1 });
});

test("BASELINE: KOTH, six rounds replay to exactly this throne and queue", () => {
  const { koth, steps } = replayThrone(LADDER);
  assert.deepEqual(steps, [
    { kingId: "p0", queue: ["p2", "p3", "p1"], streak: 1 },
    { kingId: "p0", queue: ["p3", "p1", "p2"], streak: 2 },
    { kingId: "p0", queue: ["p1", "p2", "p3"], streak: 3 },
    { kingId: "p1", queue: ["p2", "p3", "p0"], streak: 1 },
    { kingId: "p1", queue: ["p3", "p0", "p2"], streak: 2 },
    { kingId: "p3", queue: ["p0", "p2", "p1"], streak: 1 },
  ]);
  // The throne changed twice and bestStreak stayed with the run that earned
  // it, rather than following whoever is holding the table now. It names the
  // SIDE and carries its members; on a solo night that member list is the one
  // player, which is the same fact the pre-teams `{ playerId, streak }` held.
  assert.deepEqual({ memberIds: koth.bestStreak!.memberIds, streak: koth.bestStreak!.streak }, {
    memberIds: ["p0"],
    streak: 3,
  });
  assert.deepEqual({ kingId: memberOf(koth.kingSideId), queue: koth.queue.map(memberOf), streak: koth.streak }, {
    kingId: "p3",
    queue: ["p0", "p2", "p1"],
    streak: 1,
  });
});

test("BASELINE: KOTH, undoing the last round is the replay of what is left", () => {
  // The whole reason the throne is rebuilt rather than unwound.
  const full = replayThrone(LADDER);
  const short = replayThrone(LADDER.slice(0, 5));
  assert.deepEqual(short.steps, full.steps.slice(0, 5));
  assert.deepEqual({ kingId: memberOf(short.koth.kingSideId), queue: short.koth.queue.map(memberOf) }, {
    kingId: "p1",
    queue: ["p3", "p0", "p2"],
  });
});

// ---------- Best Of: a bo5 played to completion ----------

test("BASELINE: BEST OF, a bo5 that goes the distance records exactly this", () => {
  const ser = newSeries("p0", "p1")!;
  assert.deepEqual(
    ["p0", "p1", "p1", "p0", "p0"].map((w) => recordSeriesGame(ser, 5, w).completed),
    [false, false, false, false, true],
  );
  assert.equal(ser.winnerId, "p0");
  assert.deepEqual(ser.games, [
    { winnerId: "p0" },
    { winnerId: "p1" },
    { winnerId: "p1" },
    { winnerId: "p0" },
    { winnerId: "p0" },
  ]);
  assert.deepEqual(
    [...seriesGameTally(ser)],
    [
      ["p0", { wins: 3, played: 5 }],
      ["p1", { wins: 2, played: 5 }],
    ],
  );

  ser.idx = 0;
  assert.deepEqual(
    [...summarizeSeriesLog([ser]).values()],
    [
      { slotId: "p0", seriesWins: 1, seriesPlayed: 1, gameWins: 3, gamesPlayed: 5, currentStreak: 1, bestStreak: 1 },
      { slotId: "p1", seriesWins: 0, seriesPlayed: 1, gameWins: 2, gamesPlayed: 5, currentStreak: 0, bestStreak: 0 },
    ],
  );
});

// ---------- Smashdown: a whole series ----------

/** A recorded battle: the winner first, then the rest, one fighter each. */
function battle(idx: number, winnerId: string, fighters: Record<string, string>): SmashGame {
  const order = [winnerId, ...ROSTER.map((p) => p.id).filter((id) => id !== winnerId)];
  return game(
    idx,
    order.map((playerId, i) => ({
      playerId,
      character: fighters[playerId]!,
      placement: i === 0 ? 1 : 2,
      isWinner: i === 0,
    })),
  );
}
function smashdown(battleCount: number, mercy: boolean, battles: SmashGame[]): SmashSessionState {
  const s = state("smashdown", "ffa", "winner", { battleCount, mercy });
  s.games = battles;
  s.burned = burnedFrom(battles);
  return s;
}

const B1 = { p0: "Mario", p1: "Fox", p2: "Kirby", p3: "Link" };
const B2 = { p0: "Yoshi", p1: "Pikachu", p2: "Samus", p3: "Ness" };
const B3 = { p0: "Peach", p1: "Zelda", p2: "Sheik", p3: "Marth" };

test("BASELINE: SMASHDOWN, a full three-battle series reports exactly this", () => {
  const status = smashdownStatus(
    smashdown(3, false, [battle(0, "p0", B1), battle(1, "p1", B2), battle(2, "p0", B3)]),
  );
  assert.deepEqual(
    { played: status.battlesPlayed, left: status.battlesLeft, poolSize: status.poolSize, fightersLeft: status.fightersLeft },
    { played: 3, left: 0, poolSize: 86, fightersLeft: 74 },
  );
  // The burn board is in the order the fighters went out, and a battle's own
  // order puts its winner first.
  assert.deepEqual(status.burned, [
    "Mario", "Fox", "Kirby", "Link",
    "Pikachu", "Yoshi", "Samus", "Ness",
    "Peach", "Zelda", "Sheik", "Marth",
  ]);
  assert.deepEqual(
    status.standings.map((s) => [s.playerId, s.name, s.wins, s.played, s.placement]),
    [
      ["p0", "Ann", 2, 3, 1],
      ["p1", "Ben", 1, 3, 2],
      ["p2", "Cal", 0, 3, 3],
      ["p3", "Dee", 0, 3, 3],
    ],
  );
  assert.deepEqual({ clinched: status.clinched, over: status.over, winnerIds: status.winnerIds }, {
    clinched: true,
    over: true,
    winnerIds: ["p0"],
  });
});

test("BASELINE: SMASHDOWN, mercy ends a series with a battle still unplayed", () => {
  const battles = [battle(0, "p0", B1), battle(1, "p0", B2), battle(2, "p0", B3)];
  const on = smashdownStatus(smashdown(4, true, battles));
  assert.deepEqual({ played: on.battlesPlayed, left: on.battlesLeft }, { played: 3, left: 1 });
  assert.deepEqual(
    on.standings.map((s) => [s.playerId, s.wins, s.placement]),
    [["p0", 3, 1], ["p1", 0, 2], ["p2", 0, 2], ["p3", 0, 2]],
  );
  assert.deepEqual({ clinched: on.clinched, over: on.over, winnerIds: on.winnerIds }, {
    clinched: true,
    over: true,
    winnerIds: ["p0"],
  });

  // The same series with the toggle OFF is clinched and NOT over: the clinch is
  // reported either way and only mercy acts on it.
  const off = smashdownStatus(smashdown(4, false, battles));
  assert.deepEqual({ clinched: off.clinched, over: off.over, winnerIds: off.winnerIds }, {
    clinched: true,
    over: false,
    winnerIds: [],
  });
});

test("BASELINE: SMASHDOWN, a level top is a CO-WIN, ranked 1, 1, 3, 3", () => {
  const status = smashdownStatus(smashdown(2, false, [battle(0, "p0", B1), battle(1, "p1", B2)]));
  assert.deepEqual(
    status.standings.map((s) => [s.playerId, s.wins, s.placement]),
    [["p0", 1, 1], ["p1", 1, 1], ["p2", 0, 3], ["p3", 0, 3]],
  );
  assert.deepEqual({ clinched: status.clinched, over: status.over, winnerIds: status.winnerIds }, {
    clinched: false,
    over: true,
    winnerIds: ["p0", "p1"],
  });
});

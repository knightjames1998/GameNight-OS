// A MARIO KART NIGHT THAT IS LIVE WHEN THIS DEPLOYS.
//
// The state shape moved: a session now carries a side log, its races carry a
// `side` on every line, its King of the Hill is keyed on kart ids and its
// best-of series is between two karts. Every row already sitting in
// `game_sessions` was written under the old shape, and the failure mode is the
// silent one this repo keeps running into: the row loads, the new code reads a
// field that is not there, and a night in progress quietly behaves as though
// nobody is racing.
//
// So the upgrade happens at the two points where jsonb becomes state (the pack
// runtime's `normalize` hook) and nowhere else, and it is EXACT rather than
// approximate: every race this pack ever recorded was raced by individuals, so
// the roster becomes one kart per racer, which `sideIdFor` then treats as no
// team structure, which is what it always was.
//
// The legacy shapes below are written out as raw objects on purpose. They are
// what is in the database, not what any current type describes, and a fixture
// that built them through today's constructors would be testing nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isKartPairs,
  mkKothPair,
  mkSeriesLines,
  mkSides,
  normalizeMkState,
  rebuildMkKoth,
  type MkSessionState,
} from "../src/index.js";

/** A session row as it was written before karts existed. */
function legacy(overrides: Record<string, unknown> = {}): MkSessionState {
  return {
    sessionKey: "abc123",
    titleId: "mk8dx",
    mode: "ffa",
    assignment: "self",
    resultDetail: "placement",
    openScoring: false,
    roster: [
      { id: "p0", kind: "member", userId: "u0", name: "Ann", character: "Mario" },
      { id: "p1", kind: "member", userId: "u1", name: "Ben", character: "Yoshi" },
      { id: "p2", kind: "guest", userId: null, name: "Cal", character: "Toad" },
    ],
    games: [],
    koth: null,
    bestOf: 3,
    series: null,
    seriesLog: [],
    format: "free",
    grandPrix: { raceCount: 4 },
    ...overrides,
  } as unknown as MkSessionState;
}

/** One race as the old engine wrote it: no `side` on any line. */
const legacyRace = (idx: number, order: string[]) => ({
  idx,
  mode: "ffa",
  at: `2026-08-15T20:0${idx}:00.000Z`,
  lines: order.map((playerId, i) => ({
    playerId,
    character: null,
    placement: i + 1,
    isWinner: i === 0,
  })),
});

// ---------- the side log ----------

test("NORMALIZE: a legacy session becomes ONE KART PER RACER, in roster order", () => {
  const s = normalizeMkState(legacy());
  assert.deepEqual(s.sideSets, [
    {
      fromIdx: 0,
      sides: [
        { id: "a", name: "Side A", memberIds: ["p0"] },
        { id: "b", name: "Side B", memberIds: ["p1"] },
        { id: "c", name: "Side C", memberIds: ["p2"] },
      ],
    },
  ]);
  assert.equal(isKartPairs(s), false, "which is what it always was");
});

test("NORMALIZE: A SESSION THAT ALREADY HAS A SIDE LOG IS RETURNED UNTOUCHED", () => {
  // Cheap and load-bearing: this runs on every read, so a version that rebuilt
  // the log each time would silently discard a host's karts on the next tap.
  const once = normalizeMkState(legacy({ format: "koth", mode: "koth" }));
  const twice = normalizeMkState(once);
  assert.equal(twice, once, "the same object, not a rebuilt copy");
});

test("NORMALIZE: an empty roster produces an empty arrangement rather than throwing", () => {
  const s = normalizeMkState(legacy({ roster: [] }));
  assert.deepEqual(mkSides(s), []);
});

// ---------- races ----------

test("NORMALIZE: a legacy race gets side NULL written on every line", () => {
  const s = normalizeMkState(
    legacy({ games: [legacyRace(0, ["p0", "p1", "p2"]), legacyRace(1, ["p2", "p0", "p1"])] }),
  );
  assert.deepEqual(
    s.games.map((g) => g.lines.map((l) => [l.playerId, l.placement, l.isWinner, l.side])),
    [
      [
        ["p0", 1, true, null],
        ["p1", 2, false, null],
        ["p2", 3, false, null],
      ],
      [
        ["p2", 1, true, null],
        ["p0", 2, false, null],
        ["p1", 3, false, null],
      ],
    ],
  );
});

// ---------- King of the Hill ----------

test("NORMALIZE: A LEGACY THRONE MAPS ONTO THE KARTS HOLDING THOSE PLAYERS", () => {
  // The one normalizePpState exists for too, and the one that is wrong in the
  // most expensive way: a queue read as kart ids when it holds player ids would
  // put nobody on the table and nothing would error.
  const s = normalizeMkState(
    legacy({
      format: "koth",
      mode: "koth",
      koth: { kingId: "p1", queue: ["p2", "p0"], streak: 2, bestStreak: { playerId: "p1", streak: 2 } },
    }),
  );
  assert.deepEqual(s.koth, {
    kingSideId: "b",
    queue: ["c", "a"],
    streak: 2,
    bestStreak: { sideId: "b", memberIds: ["p1"], streak: 2 },
  });
  const pair = mkKothPair(s);
  assert.deepEqual([pair?.king.memberIds, pair?.challenger.memberIds], [["p1"], ["p2"]]);
});

test("NORMALIZE: a legacy KOTH night replays to the throne it already had", () => {
  // The stronger check: upgrade a night mid-ladder, then rebuild it from its
  // own races and get the same answer the old engine was showing.
  const s = normalizeMkState(
    legacy({
      format: "koth",
      mode: "koth",
      games: [
        { ...legacyRace(0, ["p0", "p1"]), mode: "koth" },
        { ...legacyRace(1, ["p2", "p0"]), mode: "koth" },
      ],
      koth: { kingId: "p2", queue: ["p1", "p0"], streak: 1, bestStreak: { playerId: "p0", streak: 1 } },
    }),
  );
  const upgraded = { ...s.koth! };
  rebuildMkKoth(s);
  assert.deepEqual(
    { kingSideId: s.koth!.kingSideId, queue: s.koth!.queue, streak: s.koth!.streak },
    { kingSideId: upgraded.kingSideId, queue: upgraded.queue, streak: upgraded.streak },
  );
});

test("NORMALIZE: a KOTH night with no bestStreak yet keeps null rather than inventing one", () => {
  const s = normalizeMkState(
    legacy({ format: "koth", mode: "koth", koth: { kingId: "p0", queue: ["p1", "p2"], streak: 0, bestStreak: null } }),
  );
  assert.equal(s.koth!.bestStreak, null);
});

// ---------- best-of sets ----------

test("NORMALIZE: A LEGACY SET BECOMES A SET BETWEEN TWO KARTS", () => {
  const s = normalizeMkState(
    legacy({
      format: "bestof",
      seriesLog: [
        {
          idx: 0,
          aId: "p0",
          bId: "p1",
          games: [{ winnerId: "p0" }, { winnerId: "p1" }, { winnerId: "p0" }],
          winnerId: "p0",
          at: "2026-08-15T21:00:00.000Z",
        },
      ],
      series: { idx: -1, aId: "p2", bId: "p0", games: [{ winnerId: "p2" }], winnerId: null, at: null },
    }),
  );
  assert.deepEqual(s.seriesLog, [
    {
      idx: 0,
      aId: "a",
      bId: "b",
      games: [{ winnerId: "a" }, { winnerId: "b" }, { winnerId: "a" }],
      winnerId: "a",
      at: "2026-08-15T21:00:00.000Z",
    },
  ]);
  assert.deepEqual(s.series, {
    idx: -1,
    aId: "c",
    bId: "a",
    games: [{ winnerId: "c" }],
    winnerId: null,
    at: null,
  });
});

test("NORMALIZE: an upgraded set writes the ledger rows it would always have written", () => {
  // The proof that the upgrade did not just typecheck. The set was Ann beating
  // Ben 2-1, and after the upgrade it still materializes as Ann first, Ben
  // second, side null on both, with the same game tallies.
  const s = normalizeMkState(
    legacy({
      format: "bestof",
      seriesLog: [
        {
          idx: 0,
          aId: "p0",
          bId: "p1",
          games: [{ winnerId: "p0" }, { winnerId: "p1" }, { winnerId: "p0" }],
          winnerId: "p0",
          at: "2026-08-15T21:00:00.000Z",
        },
      ],
    }),
  );
  const charOf = new Map(s.roster.map((p) => [p.id, p.character ?? null]));
  assert.deepEqual(mkSeriesLines(s.seriesLog[0]!, mkSides(s), (id) => charOf.get(id) ?? null), [
    { playerId: "p0", character: "Mario", placement: 1, isWinner: true, meta: { gameWins: 2, gamesPlayed: 3 }, side: null },
    { playerId: "p1", character: "Yoshi", placement: 2, isWinner: false, meta: { gameWins: 1, gamesPlayed: 3 }, side: null },
  ]);
});

test("NORMALIZE: a set naming somebody no longer on the roster is dropped, not half-upgraded", () => {
  // A half-upgraded set would sit in the log pointing at a kart that does not
  // exist, and every read of it would come back empty without saying why.
  const s = normalizeMkState(
    legacy({
      format: "bestof",
      seriesLog: [
        { idx: 0, aId: "p0", bId: "gone", games: [{ winnerId: "p0" }], winnerId: "p0", at: "t" },
        { idx: 1, aId: "p0", bId: "p1", games: [{ winnerId: "p0" }], winnerId: "p0", at: "t" },
      ],
    }),
  );
  assert.equal(s.seriesLog.length, 1);
  assert.deepEqual([s.seriesLog[0]!.aId, s.seriesLog[0]!.bId], ["a", "b"]);
});

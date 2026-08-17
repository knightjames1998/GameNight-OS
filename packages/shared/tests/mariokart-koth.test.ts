// KING OF THE HILL WITH KARTS: the winning kart holds the table and the losing
// kart rotates to the back TOGETHER.
//
// This is the format the whole side log exists for. The throne and the queue
// are not maintained, they are REBUILT by replaying the races run under the
// arrangement in force, and a replay that does not know which stretch of the
// night was raced under which arrangement hands the table to a pair that never
// won it. Nothing errors when that happens. The screen just shows the wrong
// names, and whoever is holding the phone assumes they mis-tapped.
//
// TWO THINGS ARE PINNED HARDEST.
//
//   1. A SOLO LADDER IS THE LADDER THAT SHIPPED. The kart-keyed rotation has to
//      reproduce, step for step, the sequence mariokart-baseline.test.ts
//      captured off `kothAdvance` before any of this existed. That sequence is
//      restated here in player terms and checked against the new engine.
//   2. THE ORDER OF THE TWO STEPS IN UNDO. Truncating the side log has to
//      happen before the rebuild, and the test for it is a night that undoes
//      back past a reshuffle.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkKothAdvance,
  mkKothPair,
  mkRaceLines,
  mkSides,
  newMkKartState,
  rebuildMkKoth,
  reshuffleMkSides,
  truncateSideLog,
  undoMkRace,
  type MkSessionState,
  type Side,
  type SmashPlayer,
} from "../src/index.js";

const roster = (n: number): SmashPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    kind: "member" as const,
    userId: `u${i}`,
    name: `P${i}`,
    character: null,
  }));

const kart = (id: string, ...memberIds: string[]): Side => ({
  id,
  name: `Kart ${id.toUpperCase()}`,
  memberIds,
});

const koth = (players: number, sides?: Side[]): MkSessionState =>
  newMkKartState({
    format: "koth",
    assignment: "self",
    resultDetail: "placement",
    roster: roster(players),
    sides,
  });

/**
 * One KOTH race, exactly as the record route runs it: find the two karts up
 * next, write the lines, advance the ladder.
 */
function race(state: MkSessionState, winnerSideId: string) {
  const pair = mkKothPair(state);
  assert.ok(pair, "there are two karts up next");
  const { king, challenger } = pair;
  assert.ok(winnerSideId === king.id || winnerSideId === challenger.id, "the winner is one of the two racing");
  const winner = winnerSideId === king.id ? king : challenger;
  const loser = winnerSideId === king.id ? challenger : king;
  state.games.push({
    idx: state.games.length,
    mode: "koth",
    at: `2026-08-16T20:0${state.games.length}:00.000Z`,
    lines: mkRaceLines([winner.id, loser.id], mkSides(state), "placement", () => null),
  });
  state.koth = mkKothAdvance(state.koth!, winner, loser);
}

/** The ladder, as ids. */
const ladder = (s: MkSessionState) => ({
  kingSideId: s.koth!.kingSideId,
  queue: [...s.koth!.queue],
  streak: s.koth!.streak,
});

/** The ladder in PLAYER terms, which is how the pre-karts engine expressed it. */
function ladderAsPlayers(s: MkSessionState) {
  const sides = mkSides(s);
  const membersOf = (id: string | null) => sides.find((x) => x.id === id)?.memberIds ?? [];
  return {
    king: membersOf(s.koth!.kingSideId),
    queue: s.koth!.queue.map(membersOf),
    streak: s.koth!.streak,
  };
}

// ---------- the solo ladder has not moved ----------

test("KOTH SOLO: THE LADDER IS STEP FOR STEP THE ONE THAT SHIPPED", () => {
  // The exact sequence mariokart-baseline.test.ts captured off kothAdvance
  // before karts existed: Ann defends twice, Dee takes it, Dee defends.
  const s = koth(4);
  assert.deepEqual(ladderAsPlayers(s), { king: ["p0"], queue: [["p1"], ["p2"], ["p3"]], streak: 0 });

  race(s, "a"); // p0 beats p1
  assert.deepEqual(ladderAsPlayers(s), { king: ["p0"], queue: [["p2"], ["p3"], ["p1"]], streak: 1 });

  race(s, "a"); // p0 beats p2
  assert.deepEqual(ladderAsPlayers(s), { king: ["p0"], queue: [["p3"], ["p1"], ["p2"]], streak: 2 });

  race(s, "d"); // p3 beats p0
  assert.deepEqual(ladderAsPlayers(s), { king: ["p3"], queue: [["p1"], ["p2"], ["p0"]], streak: 1 });

  race(s, "d"); // p3 beats p1
  assert.deepEqual(ladderAsPlayers(s), { king: ["p3"], queue: [["p2"], ["p0"], ["p1"]], streak: 2 });

  assert.deepEqual(s.koth!.bestStreak, { sideId: "a", memberIds: ["p0"], streak: 2 });
});

test("KOTH SOLO: every race writes the two rows it always wrote, side null", () => {
  const s = koth(4);
  race(s, "b");
  assert.deepEqual(
    s.games[0]!.lines.map((l) => [l.playerId, l.placement, l.isWinner, l.side]),
    [
      ["p1", 1, true, null],
      ["p0", 2, false, null],
    ],
  );
});

// ---------- the pairs ladder ----------

test("KOTH PAIRS: THE LOSING KART ROTATES TO THE BACK TOGETHER", () => {
  const s = koth(6, [kart("a", "p0", "p1"), kart("b", "p2", "p3"), kart("c", "p4", "p5")]);
  assert.deepEqual(ladder(s), { kingSideId: "a", queue: ["b", "c"], streak: 0 });

  race(s, "a");
  assert.deepEqual(ladder(s), { kingSideId: "a", queue: ["c", "b"], streak: 1 });
  assert.deepEqual(ladderAsPlayers(s).queue, [["p4", "p5"], ["p2", "p3"]], "both of the losing pair went to the back");

  race(s, "c");
  assert.deepEqual(ladder(s), { kingSideId: "c", queue: ["b", "a"], streak: 1 });
});

test("KOTH PAIRS: a race writes 1,1,2,2 with the kart on every row", () => {
  const s = koth(4, [kart("a", "p0", "p1"), kart("b", "p2", "p3")]);
  race(s, "b");
  assert.deepEqual(
    s.games[0]!.lines.map((l) => [l.playerId, l.placement, l.isWinner, l.side]),
    [
      ["p2", 1, true, "b"],
      ["p3", 1, true, "b"],
      ["p0", 2, false, "a"],
      ["p1", 2, false, "a"],
    ],
  );
});

test("KOTH PAIRS: the streak record names the KART and carries its members", () => {
  const s = koth(6, [kart("a", "p0", "p1"), kart("b", "p2", "p3"), kart("c", "p4", "p5")]);
  race(s, "a");
  race(s, "a");
  assert.deepEqual(s.koth!.bestStreak, { sideId: "a", memberIds: ["p0", "p1"], streak: 2 });
});

test("KOTH UNEVEN: a solo kart can hold the table against pairs", () => {
  const s = koth(5, [kart("a", "p0"), kart("b", "p1", "p2"), kart("c", "p3", "p4")]);
  race(s, "a");
  assert.deepEqual(ladder(s), { kingSideId: "a", queue: ["c", "b"], streak: 1 });
  assert.deepEqual(
    s.games[0]!.lines.map((l) => [l.playerId, l.placement, l.side]),
    [
      ["p0", 1, "a"],
      ["p1", 2, "b"],
      ["p2", 2, "b"],
    ],
    "the solo racer carries a real kart id because another kart holds two",
  );
});

// ---------- the rebuild ----------

test("REBUILD: replaying the whole night gives the ladder the night produced", () => {
  const s = koth(6, [kart("a", "p0", "p1"), kart("b", "p2", "p3"), kart("c", "p4", "p5")]);
  race(s, "a");
  race(s, "c");
  race(s, "c");
  const live = ladder(s);
  rebuildMkKoth(s);
  assert.deepEqual(ladder(s), live, "the rebuild is not a second opinion, it is the same rule");
});

test("REBUILD: a race whose karts no longer exist is SKIPPED, not replayed", () => {
  const s = koth(6, [kart("a", "p0", "p1"), kart("b", "p2", "p3"), kart("c", "p4", "p5")]);
  race(s, "a");
  race(s, "c");
  assert.equal(reshuffleMkSides(s, [kart("a", "p0", "p2"), kart("b", "p1", "p3"), kart("c", "p4", "p5")]), null);
  // The ladder restarts from the new arrangement: a queue of karts that no
  // longer exist is not a queue.
  assert.deepEqual(ladder(s), { kingSideId: "a", queue: ["b", "c"], streak: 0 });
  rebuildMkKoth(s);
  assert.deepEqual(ladder(s), { kingSideId: "a", queue: ["b", "c"], streak: 0 });
});

// ---------- undo ----------

test("UNDO: the throne is REBUILT rather than unwound", () => {
  const s = koth(4);
  race(s, "a");
  race(s, "a");
  race(s, "d");
  const afterTwo = { king: ["p0"], queue: [["p3"], ["p1"], ["p2"]], streak: 2 };

  assert.deepEqual(undoMkRace(s), { unmaterializeIdx: 2 });
  assert.deepEqual(ladderAsPlayers(s), afterTwo);
  assert.equal(s.games.length, 2);
});

test("UNDO: undoing every race returns to the opening arrangement", () => {
  const s = koth(4);
  race(s, "a"); // p0 beats p1, so p2's kart is up next
  race(s, "c"); // p2 takes it
  undoMkRace(s);
  undoMkRace(s);
  assert.deepEqual(ladderAsPlayers(s), { king: ["p0"], queue: [["p1"], ["p2"], ["p3"]], streak: 0 });
  assert.deepEqual(undoMkRace(s), { unmaterializeIdx: null }, "there is nothing left to undo");
});

test("UNDO BACK PAST A RESHUFFLE RESTORES THE PREVIOUS ARRANGEMENT", () => {
  // The one this file exists for. Two races under the original karts, a
  // reshuffle, one race under the new ones, then undo twice. The second undo
  // has to put the ORIGINAL karts back on the screen and rebuild the ladder
  // from the two races that were actually raced under them.
  const s = koth(6, [kart("a", "p0", "p1"), kart("b", "p2", "p3"), kart("c", "p4", "p5")]);
  race(s, "a");
  race(s, "c");
  reshuffleMkSides(s, [kart("a", "p0", "p2"), kart("b", "p1", "p3"), kart("c", "p4", "p5")]);
  race(s, "b");
  assert.deepEqual(s.sideSets.map((e) => e.fromIdx), [0, 2]);

  // First undo: back to the reshuffle boundary, arrangement still the new one.
  assert.deepEqual(undoMkRace(s), { unmaterializeIdx: 2 });
  assert.deepEqual(s.sideSets.map((e) => e.fromIdx), [0, 2]);
  assert.deepEqual(mkSides(s).map((x) => x.memberIds), [["p0", "p2"], ["p1", "p3"], ["p4", "p5"]]);
  assert.deepEqual(ladder(s), { kingSideId: "a", queue: ["b", "c"], streak: 0 });

  // Second undo: back PAST it. The entry is dropped and the old karts return.
  assert.deepEqual(undoMkRace(s), { unmaterializeIdx: 1 });
  assert.deepEqual(s.sideSets.map((e) => e.fromIdx), [0]);
  assert.deepEqual(mkSides(s).map((x) => x.memberIds), [["p0", "p1"], ["p2", "p3"], ["p4", "p5"]]);
  // And the ladder is what replaying race 0 alone gives, under those karts.
  assert.deepEqual(ladder(s), { kingSideId: "a", queue: ["c", "b"], streak: 1 });
  assert.deepEqual(s.koth!.bestStreak, { sideId: "a", memberIds: ["p0", "p1"], streak: 1 });
});

test("UNDO: THE WRONG ORDER PRODUCES A DIFFERENT AND WRONG LADDER", () => {
  // The test above proves the right answer. This one proves the ordering is
  // what produces it, by running the two steps the other way round on an
  // identical night and showing the ladder comes out different. A future reader
  // who swaps the two lines in undoMkRace fails there and lands here.
  const build = () => {
    const s = koth(6, [kart("a", "p0", "p1"), kart("b", "p2", "p3"), kart("c", "p4", "p5")]);
    race(s, "a");
    race(s, "c");
    reshuffleMkSides(s, [kart("a", "p0", "p2"), kart("b", "p1", "p3"), kart("c", "p4", "p5")]);
    race(s, "b");
    s.games.pop();
    s.games.pop();
    return s;
  };

  const right = build();
  truncateSideLog(right.sideSets, right.games.length);
  rebuildMkKoth(right);

  const wrong = build();
  rebuildMkKoth(wrong);
  truncateSideLog(wrong.sideSets, wrong.games.length);

  assert.deepEqual(ladder(right), { kingSideId: "a", queue: ["c", "b"], streak: 1 });
  assert.deepEqual(
    ladder(wrong),
    { kingSideId: "a", queue: ["b", "c"], streak: 0 },
    "rebuilt against an arrangement nothing is raced under, so the one race that " +
      "survived the undo is skipped and the ladder resets",
  );
  assert.notDeepEqual(ladder(right), ladder(wrong));
});

// ---------- the pair up next ----------

test("a ladder with fewer than two karts has no race to run", () => {
  const s = koth(4);
  s.koth = { kingSideId: "a", queue: [], streak: 0, bestStreak: null };
  assert.equal(mkKothPair(s), null);
  s.koth = { kingSideId: null, queue: ["b"], streak: 0, bestStreak: null };
  assert.equal(mkKothPair(s), null);
});

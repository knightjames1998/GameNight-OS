// The side log's own surface, tested directly rather than through a pack.
//
// sidelog-baseline.test.ts proves Ping Pong did not move when this module came
// out from under it. This file is the other half: the module has one function
// Ping Pong does not call yet (`sidesAtIdx`, which Mario Kart's KOTH replay
// needs), and a module whose only coverage is a consumer's is a module that
// grows untested corners the moment a second consumer uses a different part of
// it.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentSides,
  hasTeamStructure,
  newSideLog,
  reshuffle,
  sidesAtIdx,
  singletonSides,
  truncateSideLog,
  type Side,
  type SideLog,
} from "../src/index.js";

const side = (id: string, ...memberIds: string[]): Side => ({
  id,
  name: `Side ${id.toUpperCase()}`,
  memberIds,
});

const PAIRS = [side("a", "p0", "p1"), side("b", "p2", "p3")];
const SWAPPED = [side("a", "p0", "p2"), side("b", "p1", "p3")];

const members = (sides: readonly Side[]) => sides.map((s) => s.memberIds);

// ---------- the arrangement in force ----------

test("a new log is one entry, in force from unit 0", () => {
  const log = newSideLog(PAIRS);
  assert.deepEqual(log, [{ fromIdx: 0, sides: PAIRS }]);
  assert.deepEqual(members(currentSides(log)), [["p0", "p1"], ["p2", "p3"]]);
});

test("AN EMPTY LOG READS AS NO SIDES rather than throwing", () => {
  // Reachable from jsonb written by an older deploy. A screen that renders
  // nothing is a better failure than a screen that renders a stack trace.
  const empty: SideLog = [];
  assert.deepEqual(currentSides(empty), []);
  assert.deepEqual(sidesAtIdx(empty, 3), []);
  assert.equal(hasTeamStructure(empty), false);
});

test("team structure is about the arrangement IN FORCE, not the whole history", () => {
  const log = newSideLog(PAIRS);
  assert.equal(hasTeamStructure(log), true);
  reshuffle(log, singletonSides(["p0", "p1", "p2", "p3"]), 2);
  assert.equal(hasTeamStructure(log), false, "a night that went back to singles is a singles night now");
});

// ---------- reshuffle ----------

test("a reshuffle with units under the last entry STACKS, keyed to the next unit", () => {
  const log = newSideLog(PAIRS);
  assert.equal(reshuffle(log, SWAPPED, 3), null);
  assert.deepEqual(
    log.map((e) => ({ fromIdx: e.fromIdx, members: members(e.sides) })),
    [
      { fromIdx: 0, members: [["p0", "p1"], ["p2", "p3"]] },
      { fromIdx: 3, members: [["p0", "p2"], ["p1", "p3"]] },
    ],
  );
});

test("A RESHUFFLE WITH NOTHING PLAYED UNDER THE LAST ENTRY REPLACES IT", () => {
  // Changing your mind twice must not leave a dead entry for a replay to walk
  // past: it is invisible on every screen and shows up only as an off-by-one in
  // a rebuilt ladder.
  const log = newSideLog(PAIRS);
  reshuffle(log, SWAPPED, 2);
  reshuffle(log, [side("a", "p0", "p3"), side("b", "p1", "p2")], 2);
  assert.equal(log.length, 2);
  assert.deepEqual(members(log[1]!.sides), [["p0", "p3"], ["p1", "p2"]]);
});

test("reshuffling before anything is played replaces the OPENING entry", () => {
  const log = newSideLog(PAIRS);
  reshuffle(log, SWAPPED, 0);
  assert.deepEqual(log, [{ fromIdx: 0, sides: SWAPPED }]);
});

test("the primitive's verdict is the log's verdict, and the log is left alone on a refusal", () => {
  const log = newSideLog(PAIRS);
  assert.equal(reshuffle(log, [side("a", "p0", "p1")], 1), "Need at least 2 sides");
  assert.equal(reshuffle(log, [side("a", "p0"), side("b")], 1), "Every side needs at least one player");
  assert.equal(reshuffle(log, [side("a", "p0"), side("b", "p0")], 1), "A player can only be on one side");
  assert.deepEqual(log, [{ fromIdx: 0, sides: PAIRS }], "nothing was appended by a rejected arrangement");
});

test("UNEVEN SIDES ARE NOT A REFUSAL, because a 2v1 is a real night", () => {
  const log = newSideLog(singletonSides(["p0", "p1", "p2"]));
  assert.equal(reshuffle(log, [side("a", "p0", "p1"), side("b", "p2")], 0), null);
  assert.deepEqual(members(currentSides(log)), [["p0", "p1"], ["p2"]]);
});

// ---------- which arrangement a given unit was played under ----------

test("SIDESATIDX ANSWERS FOR THE UNIT, not for now", () => {
  // The whole reason fromIdx is stored. Units 0 and 1 were played as the
  // original pairs and units 2 on were played as the swapped ones, and that
  // stays true however many more reshuffles happen afterwards.
  const log = newSideLog(PAIRS);
  reshuffle(log, SWAPPED, 2);
  assert.deepEqual(members(sidesAtIdx(log, 0)), [["p0", "p1"], ["p2", "p3"]]);
  assert.deepEqual(members(sidesAtIdx(log, 1)), [["p0", "p1"], ["p2", "p3"]]);
  assert.deepEqual(members(sidesAtIdx(log, 2)), [["p0", "p2"], ["p1", "p3"]]);
  assert.deepEqual(members(sidesAtIdx(log, 99)), [["p0", "p2"], ["p1", "p3"]]);
});

test("sidesAtIdx walks THREE entries as readily as two", () => {
  const log = newSideLog(PAIRS);
  reshuffle(log, SWAPPED, 2);
  reshuffle(log, [side("a", "p0", "p3"), side("b", "p1", "p2")], 5);
  assert.deepEqual(members(sidesAtIdx(log, 4)), [["p0", "p2"], ["p1", "p3"]]);
  assert.deepEqual(members(sidesAtIdx(log, 5)), [["p0", "p3"], ["p1", "p2"]]);
});

// ---------- truncation, which is what undo needs ----------

test("TRUNCATION DROPS AN ARRANGEMENT NOTHING IS PLAYED UNDER ANY MORE", () => {
  const log = newSideLog(PAIRS);
  reshuffle(log, SWAPPED, 2);
  assert.equal(truncateSideLog(log, 2), false, "still two units, so the entry is still reached");
  assert.equal(truncateSideLog(log, 1), true);
  assert.deepEqual(members(currentSides(log)), [["p0", "p1"], ["p2", "p3"]]);
});

test("truncation drops as many entries as the undo went back past", () => {
  const log = newSideLog(PAIRS);
  reshuffle(log, SWAPPED, 2);
  reshuffle(log, [side("a", "p0", "p3"), side("b", "p1", "p2")], 4);
  assert.equal(truncateSideLog(log, 0), true);
  assert.equal(log.length, 1);
});

test("THE FIRST ENTRY IS NEVER DROPPED, whatever the count says", () => {
  // A session with no arrangement at all has nothing to render, and undo can
  // legitimately take a night back to zero completed units.
  const log = newSideLog(PAIRS);
  assert.equal(truncateSideLog(log, 0), false);
  assert.equal(log.length, 1);
  assert.deepEqual(members(currentSides(log)), [["p0", "p1"], ["p2", "p3"]]);
});

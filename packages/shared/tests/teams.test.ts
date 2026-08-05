// The team primitive. Pure, no database, no Drizzle stub.
//
// The assertions that matter most here are the two that are SILENT when wrong:
//
//   - the placement rule, because a team result ranked by competition ranking
//     produces 1,1,3,3 for a 2v2 and nothing errors, it just says the losing
//     pair came third in a field of four when there was no third place;
//   - the null-when-every-side-is-one rule, because writing "a" and "b" for a
//     1v1 makes `meetingOutcome` classify two OPPONENTS as having played
//     together, and a rivalry is then quietly wrong forever.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SIDES,
  SIDE_IDS,
  defaultSideName,
  isTeamPlay,
  placementsFromSideOrder,
  shuffleIntoSides,
  sideIdAt,
  sideIdFor,
  sideLabel,
  sideOf,
  singletonSides,
  validateSides,
  type Side,
} from "../src/index.js";

const side = (id: string, ...memberIds: string[]): Side => ({
  id,
  name: `Side ${id.toUpperCase()}`,
  memberIds,
});

// ---------- the placement rule ----------

test("A 2v2 IS 1,1,2,2, NOT 1,1,3,3", () => {
  // The whole reason this module exists. Competition ranking is right for a
  // genuine tie and wrong for a team result: there were two sides, so there
  // were two places to finish.
  const lines = placementsFromSideOrder([side("a", "p1", "p2"), side("b", "p3", "p4")]);
  assert.deepEqual(lines.map((l) => l.placement), [1, 1, 2, 2]);
  assert.deepEqual(lines.map((l) => l.isWinner), [true, true, false, false]);
  assert.deepEqual(lines.map((l) => l.playerId), ["p1", "p2", "p3", "p4"]);
});

test("a 2v2v2 is 1,1,2,2,3,3", () => {
  const lines = placementsFromSideOrder([
    side("a", "p1", "p2"),
    side("b", "p3", "p4"),
    side("c", "p5", "p6"),
  ]);
  assert.deepEqual(lines.map((l) => l.placement), [1, 1, 2, 2, 3, 3]);
  assert.deepEqual(lines.map((l) => l.isWinner), [true, true, false, false, false, false]);
});

test("uneven sides still rank by side, not by head count", () => {
  // Three against two. The placement is still 1s and 2s: a side of three that
  // loses did not finish third, fourth and fifth.
  const lines = placementsFromSideOrder([side("a", "p1", "p2"), side("b", "p3", "p4", "p5")]);
  assert.deepEqual(lines.map((l) => l.placement), [1, 1, 2, 2, 2]);
});

test("every member of the winning side is a winner", () => {
  const lines = placementsFromSideOrder([side("a", "p1", "p2", "p3"), side("b", "p4")]);
  assert.equal(lines.filter((l) => l.isWinner).length, 3);
});

test("the side id rides every line, and it is the STABLE id", () => {
  const lines = placementsFromSideOrder([side("a", "p1", "p2"), side("c", "p3", "p4")]);
  assert.deepEqual(lines.map((l) => l.side), ["a", "a", "c", "c"]);
  // Two members of one side share a value; opponents do not. That equality IS
  // the whole contract of the column.
  assert.equal(lines[0]!.side, lines[1]!.side);
  assert.notEqual(lines[0]!.side, lines[2]!.side);
});

// ---------- null when there is no team structure ----------

test("A 1v1 WRITES NULL, because it is not a team match", () => {
  const lines = placementsFromSideOrder([side("a", "p1"), side("b", "p2")]);
  assert.deepEqual(lines.map((l) => l.side), [null, null]);
  // And the rest of the row is exactly what a singles match always wrote.
  assert.deepEqual(lines.map((l) => l.placement), [1, 2]);
  assert.deepEqual(lines.map((l) => l.isWinner), [true, false]);
});

test("a field of singletons is not a team match either", () => {
  // Six people in a free-for-all expressed as six sides of one. This is the
  // shape a converted pack produces for its ordinary singles night, and it must
  // stay byte-identical to what it wrote before sides existed.
  const lines = placementsFromSideOrder(singletonSides(["p1", "p2", "p3", "p4", "p5", "p6"]));
  assert.deepEqual(lines.map((l) => l.side), [null, null, null, null, null, null]);
  assert.deepEqual(lines.map((l) => l.placement), [1, 2, 3, 4, 5, 6]);
});

test("ONE player on a bigger side is enough to make it a team match", () => {
  // 2v1. The lone player's row still carries a side, because the MATCH had team
  // structure even though their own side did not.
  const sides = [side("a", "p1", "p2"), side("b", "p3")];
  assert.equal(isTeamPlay(sides), true);
  assert.deepEqual(placementsFromSideOrder(sides).map((l) => l.side), ["a", "a", "b"]);
});

test("isTeamPlay and sideIdFor agree, exhaustively over side sizes", () => {
  for (let a = 1; a <= 4; a++) {
    for (let b = 1; b <= 4; b++) {
      const sides = [
        side("a", ...Array.from({ length: a }, (_, i) => `x${i}`)),
        side("b", ...Array.from({ length: b }, (_, i) => `y${i}`)),
      ];
      const team = a > 1 || b > 1;
      assert.equal(isTeamPlay(sides), team, `${a}v${b}`);
      assert.equal(sideIdFor(sides, "x0"), team ? "a" : null, `${a}v${b} x0`);
      assert.equal(sideIdFor(sides, "y0"), team ? "b" : null, `${a}v${b} y0`);
    }
  }
});

test("sideIdFor on a player who is on no side is null, not a throw", () => {
  assert.equal(sideIdFor([side("a", "p1", "p2"), side("b", "p3", "p4")], "ghost"), null);
});

// ---------- validation ----------

test("two or more sides, and never fewer", () => {
  assert.match(validateSides([side("a", "p1")]).error!, /at least 2 sides/);
  assert.match(validateSides([]).error!, /at least 2 sides/);
  assert.equal(validateSides([side("a", "p1"), side("b", "p2")]).error, null);
});

test("an empty side is an error", () => {
  assert.match(validateSides([side("a", "p1"), side("b")]).error!, /at least one player/);
});

test("a player on two sides at once is an error", () => {
  assert.match(validateSides([side("a", "p1", "p2"), side("b", "p2")]).error!, /one side/);
});

test("two sides sharing an id is an error", () => {
  // The id is what reaches the ledger, so a duplicate would make two different
  // sides indistinguishable in the one place the column is ever read.
  assert.match(validateSides([side("a", "p1"), side("a", "p2")]).error!, /share an id/);
});

test("UNEVEN SIDES ARE A FACT, NOT AN ERROR", () => {
  // Five people into two sides is a real thing a crew does, and the app records
  // what the night did. The screen warns; nothing blocks.
  const check = validateSides([side("a", "p1", "p2", "p3"), side("b", "p4", "p5")]);
  assert.equal(check.error, null);
  assert.equal(check.even, false);
  assert.deepEqual(check.sizes, [3, 2]);
});

test("even sides report even", () => {
  const check = validateSides([side("a", "p1", "p2"), side("b", "p3", "p4")]);
  assert.equal(check.even, true);
  assert.deepEqual(check.sizes, [2, 2]);
});

// ---------- the shuffle ----------

/** A seeded RNG, so a deal can be pinned. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test("THE REMAINDER IS DISTRIBUTED, NOT DROPPED", () => {
  // Five into two is 3 and 2. Nobody is left out of their own game.
  const sides = shuffleIntoSides(["p1", "p2", "p3", "p4", "p5"], 2, seeded(1));
  assert.deepEqual(sides.map((s) => s.memberIds.length).sort(), [2, 3]);
  assert.equal(sides.flatMap((s) => s.memberIds).length, 5);
});

test("the shuffle never drops or duplicates a player, over many deals", () => {
  const players = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
  for (let seed = 0; seed < 200; seed++) {
    for (const count of [2, 3, 4]) {
      const sides = shuffleIntoSides(players, count, seeded(seed));
      const dealt = sides.flatMap((s) => s.memberIds);
      assert.equal(dealt.length, players.length, `seed ${seed} count ${count}`);
      assert.equal(new Set(dealt).size, players.length, `seed ${seed} count ${count} duplicates`);
      assert.equal(validateSides(sides).error, null);
      // As even as the numbers allow: no side is ever two or more bigger than
      // another, which is what round-robin dealing guarantees.
      const sizes = sides.map((s) => s.memberIds.length);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `seed ${seed} count ${count} lopsided`);
    }
  }
});

test("the shuffle actually shuffles", () => {
  // A deal that ignored the RNG would pass every check above. Two different
  // seeds must be able to disagree.
  const players = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const deals = new Set(
    Array.from({ length: 40 }, (_, s) =>
      shuffleIntoSides(players, 2, seeded(s)).map((x) => x.memberIds.join(",")).join("|"),
    ),
  );
  assert.ok(deals.size > 1, "every seed produced the same deal");
});

test("the shuffle clamps rather than producing nonsense", () => {
  // More sides than players would mean empty sides, which validateSides
  // rejects, so the count is clamped to what the roster can fill.
  const sides = shuffleIntoSides(["p1", "p2", "p3"], 8, seeded(3));
  assert.equal(validateSides(sides).error, null);
  assert.ok(sides.length <= 3);
  // And fewer than two sides is not a thing.
  assert.equal(shuffleIntoSides(["p1", "p2", "p3", "p4"], 1, seeded(3)).length, 2);
  assert.ok(shuffleIntoSides(["p1", "p2"], 99, seeded(3)).length <= MAX_SIDES);
});

// ---------- ids and labels ----------

test("side ids are the short stable ones, in order", () => {
  assert.equal(sideIdAt(0), "a");
  assert.equal(sideIdAt(1), "b");
  assert.equal(sideIdAt(7), "h");
  assert.equal(SIDE_IDS.length, MAX_SIDES);
  assert.equal(new Set(SIDE_IDS).size, SIDE_IDS.length);
  // Past the table it still returns something distinct rather than undefined.
  assert.equal(sideIdAt(8), "s8");
});

test("singletonSides gives one side per player, in roster order", () => {
  const sides = singletonSides(["p1", "p2", "p3"]);
  assert.deepEqual(sides.map((s) => s.id), ["a", "b", "c"]);
  assert.deepEqual(sides.map((s) => s.memberIds), [["p1"], ["p2"], ["p3"]]);
  assert.equal(isTeamPlay(sides), false);
});

test("default names are display only and never reach a line", () => {
  assert.equal(defaultSideName(0), "Side A");
  assert.equal(defaultSideName(2), "Side C");
  // The lines carry ids. If a name ever appears in `side`, this is where it
  // would show up.
  const named: Side[] = [
    { id: "a", name: "The Undefeated", memberIds: ["p1", "p2"] },
    { id: "b", name: "Everyone Else", memberIds: ["p3", "p4"] },
  ];
  assert.deepEqual(placementsFromSideOrder(named).map((l) => l.side), ["a", "a", "b", "b"]);
});

test("sideLabel reads member names, and falls back to the side's own", () => {
  const names = new Map([["p1", "James"], ["p2", "Sam"]]);
  const nameOf = (id: string) => names.get(id);
  assert.equal(sideLabel(side("a", "p1", "p2"), nameOf), "James + Sam");
  assert.equal(sideLabel(side("a", "p1"), nameOf), "James");
  assert.equal(sideLabel(side("b", "ghost"), nameOf), "Side B");
});

test("sideOf finds the holding side", () => {
  const sides = [side("a", "p1", "p2"), side("b", "p3")];
  assert.equal(sideOf(sides, "p2")?.id, "a");
  assert.equal(sideOf(sides, "p3")?.id, "b");
  assert.equal(sideOf(sides, "ghost"), undefined);
});

// Smash team battles: the rules that fail SILENTLY if they break.
//
// Three of them, which is why these are the tests rather than a general sweep:
//
//   - THE CAP IS ON PLAYERS, NOT SIDES. Mario Kart's race validator caps at
//     MAX_SIDES because eight karts of two is its sixteen-racer roster cap
//     exactly. Smash seats EIGHT PLAYERS, and FFA_MAX_PLAYERS is the arithmetic
//     underneath smashdownCap. A validator capped on sides would accept a
//     sixteen-player Smash battle and nothing would error, so the sixteen-player
//     case is asserted directly.
//   - THE PLACEMENT RULE. A 2v2 is 1,1,2,2, never competition ranking's
//     1,1,3,3. Read the block at the top of teams.ts: a losing pair did not
//     finish third in a field of four, there were two sides.
//   - `side` IS NULL WHENEVER NOTHING HAS TEAM STRUCTURE, decided over the
//     sides that BATTLED rather than the whole arrangement. A non-null side
//     means "these two played together" to buildRivalry, forever, with nothing
//     erroring.
//
// Uneven sides are a FACT and never an error, so 2v1 and 3v1 are asserted here
// as ordinary results rather than as edge cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FFA_MAX_PLAYERS,
  MAX_SIDES,
  singletonSides,
  smashBattleLines,
  smashOrderFromPlacements,
  validateSmashBattleOrder,
  type Side,
} from "../src/index.js";

const side = (id: string, ...memberIds: string[]): Side => ({ id, name: `Side ${id.toUpperCase()}`, memberIds });

/** Two pairs: the 2v2 headline. */
const PAIRS: Side[] = [side("a", "p0", "p1"), side("b", "p2", "p3")];
/** A pair against one: uneven, which validateSides treats as a fact. */
const UNEVEN: Side[] = [side("a", "p0", "p1"), side("b", "p2")];

const FIGHTERS: Record<string, string> = {
  p0: "Mario", p1: "Fox", p2: "Kirby", p3: "Link",
  p4: "Samus", p5: "Ness", p6: "Zelda", p7: "Marth",
};
const charOf = (id: string) => FIGHTERS[id] ?? null;

// ---------- the cap ----------

test("the battle cap counts PLAYERS, and says so", () => {
  // Eight sides of two is sixteen people in one Smash battle. Mario Kart's
  // validator would pass this; Smash's must not, and the message has to be
  // about players because "at most 8 sides" helps nobody here.
  const eightPairs = Array.from({ length: 8 }, (_, i) =>
    side("abcdefgh"[i]!, `x${i * 2}`, `x${i * 2 + 1}`),
  );
  assert.equal(
    validateSmashBattleOrder(eightPairs.map((s) => s.id), eightPairs),
    `Smash seats ${FFA_MAX_PLAYERS} players`,
  );
});

test("four pairs is eight players and is fine", () => {
  const fourPairs = Array.from({ length: 4 }, (_, i) => side("abcd"[i]!, `x${i * 2}`, `x${i * 2 + 1}`));
  assert.equal(validateSmashBattleOrder(fourPairs.map((s) => s.id), fourPairs), null);
});

test("five pairs is ten players and is refused on players, not on sides", () => {
  // Five sides is under MAX_SIDES, so only the player count can catch this.
  const fivePairs = Array.from({ length: 5 }, (_, i) => side("abcde"[i]!, `x${i * 2}`, `x${i * 2 + 1}`));
  assert.equal(
    validateSmashBattleOrder(fivePairs.map((s) => s.id), fivePairs),
    `Smash seats ${FFA_MAX_PLAYERS} players`,
  );
});

test("the MAX_SIDES rule only bites in the all-singletons case", () => {
  // Nine solo players: nine sides AND nine players. The player cap fires first,
  // which is the right message; MAX_SIDES is the backstop behind it.
  const nine = singletonSides(Array.from({ length: 9 }, (_, i) => `x${i}`));
  assert.equal(nine.length, 9);
  assert.ok(nine.length > MAX_SIDES);
  assert.equal(
    validateSmashBattleOrder(nine.map((s) => s.id), nine),
    `Smash seats ${FFA_MAX_PLAYERS} players`,
  );
  // Eight solo players is eight sides and eight players: the boundary, allowed.
  const eight = singletonSides(Array.from({ length: 8 }, (_, i) => `x${i}`));
  assert.equal(validateSmashBattleOrder(eight.map((s) => s.id), eight), null);
});

test("the structural rules, in order", () => {
  assert.equal(validateSmashBattleOrder(["a"], PAIRS), "At least 2 sides have to battle");
  assert.equal(validateSmashBattleOrder([], PAIRS), "At least 2 sides have to battle");
  assert.equal(validateSmashBattleOrder(["a", "b", "a"], PAIRS), "A side can only finish once");
  assert.equal(validateSmashBattleOrder(["a", "z"], PAIRS), "That side is not in this session");
});

// ---------- the placement rule ----------

test("a 2v2 is 1,1,2,2 and every member of the winning side is a winner", () => {
  const lines = smashBattleLines(["a", "b"], PAIRS, "placement", charOf);
  assert.deepEqual(lines, [
    { playerId: "p0", character: "Mario", placement: 1, isWinner: true, side: "a" },
    { playerId: "p1", character: "Fox", placement: 1, isWinner: true, side: "a" },
    { playerId: "p2", character: "Kirby", placement: 2, isWinner: false, side: "b" },
    { playerId: "p3", character: "Link", placement: 2, isWinner: false, side: "b" },
  ]);
});

test("a 2v1 is 1,1,2 when the pair wins and 1,2,2 when the solo does", () => {
  assert.deepEqual(
    smashBattleLines(["a", "b"], UNEVEN, "placement", charOf).map((l) => [l.playerId, l.placement, l.isWinner]),
    [["p0", 1, true], ["p1", 1, true], ["p2", 2, false]],
  );
  assert.deepEqual(
    smashBattleLines(["b", "a"], UNEVEN, "placement", charOf).map((l) => [l.playerId, l.placement, l.isWinner]),
    [["p2", 1, true], ["p0", 2, false], ["p1", 2, false]],
  );
});

test("a 3v1 falls out for free: nothing here knows a side's size", () => {
  const lopsided: Side[] = [side("a", "p0", "p1", "p2"), side("b", "p3")];
  assert.deepEqual(
    smashBattleLines(["b", "a"], lopsided, "placement", charOf).map((l) => [l.playerId, l.placement]),
    [["p3", 1], ["p0", 2], ["p1", 2], ["p2", 2]],
  );
});

test("winner-only detail puts every other side LEVEL on 2", () => {
  const three: Side[] = [side("a", "p0", "p1"), side("b", "p2", "p3"), side("c", "p4", "p5")];
  assert.deepEqual(
    smashBattleLines(["a", "b", "c"], three, "winner", charOf).map((l) => [l.playerId, l.placement]),
    [["p0", 1], ["p1", 1], ["p2", 2], ["p3", 2], ["p4", 2], ["p5", 2]],
  );
  // Placement detail on the same three sides ranks them 1, 2, 3.
  assert.deepEqual(
    smashBattleLines(["a", "b", "c"], three, "placement", charOf).map((l) => [l.playerId, l.placement]),
    [["p0", 1], ["p1", 1], ["p2", 2], ["p3", 2], ["p4", 3], ["p5", 3]],
  );
});

test("characters stay PER PLAYER: two on one side are on two fighters", () => {
  const lines = smashBattleLines(["a", "b"], PAIRS, "placement", charOf);
  assert.deepEqual(
    lines.filter((l) => l.side === "a").map((l) => l.character),
    ["Mario", "Fox"],
  );
});

// ---------- the side column ----------

test("an all-singletons battle writes side NULL on every line", () => {
  const solo = singletonSides(["p0", "p1", "p2", "p3"]);
  const lines = smashBattleLines(["a", "b", "c", "d"], solo, "placement", charOf);
  assert.deepEqual(lines.map((l) => l.side), [null, null, null, null]);
  // And it is otherwise the same result the pre-teams engine produced.
  assert.deepEqual(
    lines.map((l) => [l.playerId, l.placement, l.isWinner]),
    [["p0", 1, true], ["p1", 2, false], ["p2", 3, false], ["p3", 4, false]],
  );
});

test("the side is decided over the sides that BATTLED, not the arrangement", () => {
  // One pair and two solo sides in force; a battle between the two SOLO sides
  // has no team structure in it, so both rows are null. That is what "null
  // means no team structure" has to mean for buildRivalry to stay correct.
  const mixed: Side[] = [side("a", "p0", "p1"), side("b", "p2"), side("c", "p3")];
  assert.deepEqual(smashBattleLines(["b", "c"], mixed, "placement", charOf).map((l) => l.side), [null, null]);
  // The same arrangement, with the pair in the battle, writes all three.
  assert.deepEqual(
    smashBattleLines(["a", "b", "c"], mixed, "placement", charOf).map((l) => [l.playerId, l.side]),
    [["p0", "a"], ["p1", "a"], ["p2", "b"], ["p3", "c"]],
  );
});

// ---------- the older client's spelling ----------

test("per-player placements translate to a side order, dropping duplicates", () => {
  assert.deepEqual(
    smashOrderFromPlacements(
      [
        { playerId: "p2", placement: 1 },
        { playerId: "p3", placement: 1 },
        { playerId: "p0", placement: 2 },
        { playerId: "p1", placement: 2 },
      ],
      PAIRS,
    ),
    ["b", "a"],
  );
});

test("a solo night's placements translate to exactly its own order", () => {
  const solo = singletonSides(["p0", "p1", "p2", "p3"]);
  assert.deepEqual(
    smashOrderFromPlacements(
      [
        { playerId: "p1", placement: 1 },
        { playerId: "p3", placement: 2 },
        { playerId: "p0", placement: 3 },
        { playerId: "p2", placement: 4 },
      ],
      solo,
    ),
    ["b", "d", "a", "c"],
  );
});

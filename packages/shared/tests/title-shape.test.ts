// THE TITLE SETS THE SHAPE: tapping Euchre puts the table into pairs, tapping
// Hearts puts it back, and nobody has to know the feature exists.
//
// What is worth testing here is not the happy path (a title with a partnership
// default produces sides) but the two GUARDS, because both of them exist to
// stop the feature undoing the host's own work, and both fail silently if they
// are wrong: a table quietly reshuffled between two hands looks exactly like a
// table somebody rearranged on purpose.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTitleShape,
  currentTnSides,
  isPartnership,
  newTnState,
  recordTnGame,
  tnSideIdOf,
  type TitleNightConfig,
  type TnPlayer,
  type TnSessionState,
} from "../src/index.js";

const players = (n: number): TnPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, kind: "member" as const, userId: `u${i}`, name: `P${i}` }));

const CONFIG: TitleNightConfig = {
  titles: ["Euchre", "Spades", "Hearts", "Cribbage"],
  partnerships: { Euchre: 2, Spades: 2 },
  maxPlayers: 12,
  unit: "card game",
};

/** A fixed sequence, so a shuffled arrangement is an assertable one. */
const fixedRng = () => {
  let i = 0;
  const seq = [0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.3, 0.7];
  return () => seq[i++ % seq.length]!;
};

const sizes = (s: TnSessionState) => currentTnSides(s).map((x) => x.memberIds.length);

// ---------- the shape itself ----------

test("a partnership title puts a free-for-all table into pairs", () => {
  const s = newTnState({ roster: players(4) });
  assert.equal(isPartnership(s), false);

  const change = applyTitleShape(s, CONFIG, "Euchre", fixedRng());
  assert.ok(change);
  assert.equal(change.shape, 2);
  assert.deepEqual(sizes(s), [2, 2]);
  assert.equal(isPartnership(s), true);
  // The grain FOLLOWS THE SHAPE, the same rule newTnState uses.
  assert.equal(s.grain, "side");
  assert.equal(change.grain, "side");
});

test("a title with no partnership default puts pairs back to free-for-all", () => {
  const s = newTnState({ roster: players(4) });
  applyTitleShape(s, CONFIG, "Euchre", fixedRng());
  assert.deepEqual(sizes(s), [2, 2]);

  const change = applyTitleShape(s, CONFIG, "Hearts");
  assert.ok(change);
  assert.equal(change.shape, 1);
  assert.deepEqual(sizes(s), [1, 1, 1, 1]);
  assert.equal(s.grain, "player");
});

test("a free-typed title has no default and opens free-for-all", () => {
  const s = newTnState({ roster: players(4) });
  applyTitleShape(s, CONFIG, "Euchre", fixedRng());
  const change = applyTitleShape(s, CONFIG, "Somebody's House Rules");
  assert.ok(change);
  assert.equal(change.shape, 1);
  assert.deepEqual(sizes(s), [1, 1, 1, 1]);
});

test("the lookup is case and spacing insensitive, like every other title path", () => {
  const s = newTnState({ roster: players(4) });
  assert.equal(applyTitleShape(s, CONFIG, "  euchre ", fixedRng())?.shape, 2);
});

// ---------- GUARD 1: it fires only when the side count differs ----------

test("GUARD: naming the game you are already playing does not reshuffle the table", () => {
  // The failure this prevents: a host puts four people into two SPECIFIC pairs,
  // then taps Euchre to say what is out, and the app deals the table again.
  const s = newTnState({ roster: players(4) });
  applyTitleShape(s, CONFIG, "Euchre", fixedRng());
  const before = currentTnSides(s).map((x) => [...x.memberIds]);

  assert.equal(applyTitleShape(s, CONFIG, "Euchre", fixedRng()), null);
  assert.deepEqual(currentTnSides(s).map((x) => x.memberIds), before);
  // And no dead entry in the log either.
  assert.equal(s.sideSets.length, 1);
});

test("GUARD: a second partnership title of the same shape leaves the pairs alone", () => {
  const s = newTnState({ roster: players(4) });
  applyTitleShape(s, CONFIG, "Euchre", fixedRng());
  const before = currentTnSides(s).map((x) => [...x.memberIds]);
  assert.equal(applyTitleShape(s, CONFIG, "Spades", fixedRng()), null);
  assert.deepEqual(currentTnSides(s).map((x) => x.memberIds), before);
});

test("GUARD: a free-for-all title on a free-for-all table changes nothing", () => {
  const s = newTnState({ roster: players(5) });
  assert.equal(applyTitleShape(s, CONFIG, "Hearts"), null);
  assert.equal(applyTitleShape(s, CONFIG, "Cribbage"), null);
  assert.deepEqual(sizes(s), [1, 1, 1, 1, 1]);
});

test("GUARD: with two players, partnerships and free-for-all are one arrangement", () => {
  // Not special-cased anywhere: two singletons IS two sides, so the count guard
  // sees no difference and the table is left alone. Worth pinning because the
  // obvious implementation (shape > 1 means deal) would pair them up.
  const s = newTnState({ roster: players(2) });
  assert.equal(applyTitleShape(s, CONFIG, "Euchre", fixedRng()), null);
  assert.deepEqual(sizes(s), [1, 1]);
  assert.equal(isPartnership(s), false);
});

test("GUARD: a cleared title changes nothing, because between games is most of the night", () => {
  const s = newTnState({ roster: players(4) });
  applyTitleShape(s, CONFIG, "Euchre", fixedRng());
  assert.equal(applyTitleShape(s, CONFIG, null), null);
  assert.equal(applyTitleShape(s, CONFIG, ""), null);
  assert.equal(applyTitleShape(s, CONFIG, "   "), null);
  assert.deepEqual(sizes(s), [2, 2]);
});

// ---------- GUARD 2: back to free-for-all is deterministic ----------

test("GUARD: partnerships to free-for-all is roster order, not a shuffle", () => {
  const s = newTnState({ roster: players(6) });
  applyTitleShape(s, CONFIG, "Euchre", fixedRng());
  applyTitleShape(s, CONFIG, "Hearts");
  assert.deepEqual(
    currentTnSides(s).map((x) => x.memberIds),
    [["p0"], ["p1"], ["p2"], ["p3"], ["p4"], ["p5"]],
  );
});

test("GUARD: the same three taps twice give the same screen back", () => {
  // Hearts, Euchre, Hearts. The middle one is dealt at random, the outer two
  // must not be, so the arrangement a host lands back on is the one they left.
  const run = () => {
    const s = newTnState({ roster: players(5) });
    applyTitleShape(s, CONFIG, "Hearts");
    applyTitleShape(s, CONFIG, "Euchre", fixedRng());
    applyTitleShape(s, CONFIG, "Hearts");
    return currentTnSides(s).map((x) => x.memberIds);
  };
  assert.deepEqual(run(), run());
});

// ---------- an uneven roster, and the night around it ----------

test("an odd roster deals uneven rather than dropping anybody", () => {
  const s = newTnState({ roster: players(5) });
  applyTitleShape(s, CONFIG, "Euchre", fixedRng());
  assert.deepEqual(sizes(s).sort(), [2, 3]);
  assert.equal(currentTnSides(s).flatMap((x) => x.memberIds).length, 5);
});

test("games already recorded keep the sides they were played with", () => {
  // The whole reason sides are a LOG rather than a field. Two hands of Hearts,
  // then the host taps Euchre: the Hearts hands must still read as singles.
  const s = newTnState({ roster: players(4) });
  recordTnGame(s, "Hearts", ["p0", "p1", "p2", "p3"].map((id) => ({ sideId: tnSideIdOf(s, id)! })));

  applyTitleShape(s, CONFIG, "Euchre", fixedRng());
  assert.deepEqual(sizes(s), [2, 2]);
  assert.equal(s.games[0]!.sides.length, 4);
  assert.deepEqual(s.games[0]!.lines.map((l) => l.side), [null, null, null, null]);
  // The new arrangement starts from the next game, not from the first.
  assert.equal(s.sideSets.length, 2);
  assert.equal(s.sideSets[1]!.fromIdx, 1);
});

test("Board Game declares no partnerships, so nothing about it moves", () => {
  // The pack that shipped first must be untouched by a feature built for the
  // second. With no partnerships table, every title resolves to free-for-all
  // and the guard means every call is a no-op.
  const ffaOnly: TitleNightConfig = { titles: ["Catan", "Azul"], maxPlayers: 12, unit: "board game" };
  const s = newTnState({ roster: players(4) });
  assert.equal(applyTitleShape(s, ffaOnly, "Catan"), null);
  assert.equal(applyTitleShape(s, ffaOnly, "Azul"), null);
  assert.equal(applyTitleShape(s, ffaOnly, "Anything At All"), null);
  assert.equal(s.sideSets.length, 1);
  assert.deepEqual(sizes(s), [1, 1, 1, 1]);
});

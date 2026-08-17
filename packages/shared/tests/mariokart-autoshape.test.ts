// DOUBLE DASH PLUS EXACTLY FOUR PLAYERS OPENS IN PAIRS.
//
// The convenience is the whole point: nobody should have to know this exists.
// A crew taps Double Dash and the setup screen is already asking who is sharing
// a kart with whom. The alternative is four races recorded as a free-for-all
// and somebody noticing in the stats a month later.
//
// EVERY GUARD BELOW FAILS SILENTLY IF IT IS WRONG, which is why each one has a
// test with its own name rather than being folded into a table. A guard that
// stops working does not throw; it just rearranges a table somebody had already
// set, and the host assumes they mis-tapped.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOUBLE_DASH_TITLE_ID,
  KART_PAIRS_ROSTER_SIZE,
  MARIO_KART_TITLES,
  autoKartAssign,
} from "../src/index.js";

const SINGLES_4 = [[0], [1], [2], [3]];
const PAIRS_4 = [[0, 1], [2, 3]];

const onTitle = (titleId: string | null, rosterSize: number, assign: readonly (readonly number[])[], racesRecorded = 0) =>
  autoKartAssign({ titleId, rosterSize, assign, trigger: "title", racesRecorded });

const onRoster = (titleId: string | null, rosterSize: number, assign: readonly (readonly number[])[], racesRecorded = 0) =>
  autoKartAssign({ titleId, rosterSize, assign, trigger: "roster", racesRecorded });

// ---------- the rule itself ----------

test("the title id it fires on is a title the picker actually offers", () => {
  // Cheap, and it is the one way this whole feature can be silently dead: a
  // constant that does not match any title's id fires never and errors never.
  assert.ok(MARIO_KART_TITLES.some((t) => t.id === DOUBLE_DASH_TITLE_ID));
  assert.equal(MARIO_KART_TITLES.find((t) => t.id === DOUBLE_DASH_TITLE_ID)!.name, "Double Dash!!");
});

test("DOUBLE DASH WITH FOUR PLAYERS DEALS TWO KARTS OF TWO", () => {
  assert.deepEqual(onTitle(DOUBLE_DASH_TITLE_ID, 4, SINGLES_4), PAIRS_4);
});

test("EXACTLY FOUR, AND NOTHING ELSE", () => {
  // A deliberate line rather than a starting point. Every other arrangement is
  // available and is opt-in through the picker.
  assert.equal(onTitle(DOUBLE_DASH_TITLE_ID, 2, [[0], [1]]), null, "two players is a 1v1");
  assert.equal(onTitle(DOUBLE_DASH_TITLE_ID, 3, [[0], [1], [2]]), null, "three is not two even karts");
  assert.equal(onTitle(DOUBLE_DASH_TITLE_ID, 5, SINGLES_4), null);
  assert.equal(onTitle(DOUBLE_DASH_TITLE_ID, 6, [[0], [1], [2], [3], [4], [5]]), null, "not one console");
  assert.equal(onTitle(DOUBLE_DASH_TITLE_ID, 8, Array.from({ length: 8 }, (_, i) => [i])), null);
  assert.equal(KART_PAIRS_ROSTER_SIZE, 4);
});

test("DOUBLE DASH NEVER DISSOLVES A KART, even at a roster size it does not deal for", () => {
  // Reverting is justified by "no other title in the roster has a shared kart",
  // and Double Dash is the one that does. A five-player Double Dash night with
  // hand-built karts keeps them when the host taps the title again.
  assert.equal(onTitle(DOUBLE_DASH_TITLE_ID, 5, [[0, 1], [2, 3], [4]]), null);
  assert.equal(onTitle(DOUBLE_DASH_TITLE_ID, 6, [[0, 1], [2, 3], [4, 5]]), null);
});

test("no other title deals a shared kart, whatever the roster size", () => {
  for (const t of MARIO_KART_TITLES.filter((x) => x.id !== DOUBLE_DASH_TITLE_ID)) {
    assert.deepEqual(onTitle(t.id, 4, PAIRS_4), SINGLES_4, `${t.name} has no shared kart`);
  }
});

// ---------- guard 1: it fires only when the kart count differs ----------

test("GUARD 1: KARTS THE HOST ALREADY SET ARE NOT TOUCHED BY TAPPING DOUBLE DASH", () => {
  // The title wanted two karts and there are two karts, so there is nothing to
  // decide. Without this, naming the game you were already setting up would
  // silently reshuffle the table.
  assert.equal(onTitle(DOUBLE_DASH_TITLE_ID, 4, [[0, 2], [1, 3]]), null);
  assert.equal(onTitle(DOUBLE_DASH_TITLE_ID, 4, [[3, 1], [0, 2]]), null);
});

test("GUARD 1: free-for-all counts as ONE KART PER RACER", () => {
  // Which is why four singletons is a count of four and does differ from two.
  assert.deepEqual(onTitle(DOUBLE_DASH_TITLE_ID, 4, SINGLES_4), PAIRS_4);
  assert.equal(onTitle("mk8dx", 4, SINGLES_4), null, "already one kart per racer");
});

test("GUARD 1: a partly filled picker still counts its karts, not its people", () => {
  // Two empty karts on the screen is a count of two, so Double Dash leaves it
  // alone and the host finishes placing people. An auto-apply here would wipe
  // out a half-built table.
  assert.equal(onTitle(DOUBLE_DASH_TITLE_ID, 4, [[0], []]), null);
});

// ---------- guard 2: going the other way is deterministic ----------

test("GUARD 2: REVERTING IS SINGLETONS IN ROSTER ORDER, NEVER A SHUFFLE", () => {
  assert.deepEqual(onTitle("mk8dx", 4, PAIRS_4), SINGLES_4);
  assert.deepEqual(onTitle("mkworld", 6, [[0, 1], [2, 3], [4, 5]]), [[0], [1], [2], [3], [4], [5]]);
});

test("GUARD 2: DOUBLE DASH, MK8DX, DOUBLE DASH HANDS BACK THE SAME SCREEN", () => {
  // Both directions are deterministic, which is the reason the pairing is
  // roster order rather than a random deal. A host who taps around the title
  // list and comes back gets what they had, not a new deal.
  let assign: readonly (readonly number[])[] = SINGLES_4;
  assign = onTitle(DOUBLE_DASH_TITLE_ID, 4, assign) ?? assign;
  assert.deepEqual(assign, PAIRS_4);
  assign = onTitle("mk8dx", 4, assign) ?? assign;
  assert.deepEqual(assign, SINGLES_4);
  assign = onTitle(DOUBLE_DASH_TITLE_ID, 4, assign) ?? assign;
  assert.deepEqual(assign, PAIRS_4);
});

test("GUARD 2: it is stable under repetition, not just under a round trip", () => {
  const once = onTitle(DOUBLE_DASH_TITLE_ID, 4, SINGLES_4)!;
  assert.equal(onTitle(DOUBLE_DASH_TITLE_ID, 4, once), null, "the second tap has nothing to do");
});

// ---------- guard 3: setup only ----------

test("GUARD 3: ONCE A RACE HAS BEEN LOGGED, NOTHING AUTO-APPLIES", () => {
  // After that, changing the arrangement is a reshuffle with a fromIdx and it
  // is a deliberate host action. An auto-apply between two races would change
  // what the night was raced under and look exactly like a host doing it on
  // purpose.
  assert.equal(onTitle(DOUBLE_DASH_TITLE_ID, 4, SINGLES_4, 1), null);
  assert.equal(onTitle("mk8dx", 4, PAIRS_4, 1), null);
  assert.equal(onRoster(DOUBLE_DASH_TITLE_ID, 4, SINGLES_4, 9), null);
});

// ---------- the roster trigger ----------

test("A ROSTER CHANGE PUTS KARTS TOGETHER: adding the fourth racer opens pairs", () => {
  assert.deepEqual(onRoster(DOUBLE_DASH_TITLE_ID, 4, [[0], [1], [2], [3]]), PAIRS_4);
});

test("A ROSTER CHANGE NEVER TAKES KARTS APART", () => {
  // The half that is not in the Euchre precedent, because a title night has no
  // roster-change trigger. Without it, a host who hand-built karts for a
  // five-player MK8 Deluxe night and then added a sixth racer would watch their
  // karts dissolve, which is the feature undoing the host's work.
  assert.equal(onRoster("mk8dx", 6, [[0, 1], [2, 3], [4, 5]]), null);
  assert.equal(onRoster(DOUBLE_DASH_TITLE_ID, 5, PAIRS_4), null, "no longer exactly four");
  assert.equal(onRoster("mk8dx", 4, PAIRS_4), null);
});

// ---------- edges ----------

test("a roster too small to race leaves the picker alone", () => {
  assert.equal(onTitle("mk8dx", 0, [[], []]), null);
  assert.equal(onTitle("mk8dx", 1, [[0], []]), null);
});

test("an unknown or missing title is treated as any other title", () => {
  assert.deepEqual(onTitle(null, 4, PAIRS_4), SINGLES_4);
  assert.deepEqual(onTitle("not-a-title", 4, PAIRS_4), SINGLES_4);
});

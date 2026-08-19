// Tests for the Beerio TV crowd label row (crowdSplit in web/src/beerio/crowd.ts).
//
// Written before the component changed, because a test written after a
// refactor pins whatever the refactor broke.
//
// THE THING BEING PROTECTED IS A FIT RULE, not a number format. The Grand Prix
// board passes one option per racer and seats twelve, with names long enough
// that scripts/tv-fit.mjs uses them as its worst case ("Player Nameiskindalong
// N"). An uncapped row wraps, a wrapped row is taller, and a taller row on a
// television that already fits 1080p exactly is a fit regression wearing a
// typography costume. The cap is tested here; the nowrap and ellipsis that
// back it up are in beerio.css and are what tv-fit.mjs measures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { crowdSplit, MAX_SHARES } from "../../web/src/beerio/crowd.js";

/** Options in board order, which is the order ties must keep. */
const opts = (...labels: string[]) =>
  labels.map((label) => ({ label, value: label, color: "#" + label.slice(0, 3) }));

/** The colour a label is given above, so expectations read as one thing. */
const col = (label: string) => "#" + label.slice(0, 3);

test("nobody has voted", () => {
  // PredictionBar returns null before it ever asks, but the helper answers
  // rather than leaving the caller to remember that.
  assert.deepEqual(crowdSplit(opts("Ann", "Ben"), {}), { kind: "agreed", total: 0 });
});

test("ONE VOTE READS AS A VOTE COUNT, NEVER AS 100%", () => {
  // The photographed screen had four bars all saying 100% on 1 vote each. A
  // percentage on an unopposed vote is the bar restated, and the copy it
  // replaces ("1 vote") is the only thing on that row carrying new information.
  assert.deepEqual(crowdSplit(opts("Ann", "Ben"), { Ann: 1 }), { kind: "agreed", total: 1 });
});

test("a unanimous crowd stays a vote count however big it gets", () => {
  assert.deepEqual(crowdSplit(opts("Ann", "Ben"), { Ann: 9 }), { kind: "agreed", total: 9 });
});

test("A TWO-WAY SPLIT IS THE CASE THE PERCENTAGES EXIST FOR", () => {
  // The bracket board's shape: exactly two options, and the one card in the fit
  // harness where the two spectators disagree.
  assert.deepEqual(crowdSplit(opts("Ann", "Ben"), { Ann: 1, Ben: 2 }), {
    kind: "split",
    shares: [
      { label: "Ben", pct: 67, color: col("Ben") },
      { label: "Ann", pct: 33, color: col("Ann") },
    ],
    overflow: 0,
  });
});

test("shares are sorted descending, not left in board order", () => {
  assert.deepEqual(crowdSplit(opts("Ann", "Ben", "Cal"), { Ann: 1, Ben: 5, Cal: 3 }), {
    kind: "split",
    shares: [
      { label: "Ben", pct: 56, color: col("Ben") },
      { label: "Cal", pct: 33, color: col("Cal") },
      { label: "Ann", pct: 11, color: col("Ann") },
    ],
    overflow: 0,
  });
});

test("AN EVEN THREE-WAY SPLIT READS 33/33/33 AND SUMS TO 99, ON PURPOSE", () => {
  // Not a rounding bug, and NOT to be "fixed" with largest-remainder. Three
  // identical vote counts must print three identical numbers: 34/33/33 shows a
  // room two equal things as unequal, which reads as broken. The sum was never
  // an invariant anyway, because the cap below means three shares out of twelve
  // options never summed to 100.
  assert.deepEqual(crowdSplit(opts("Ann", "Ben", "Cal"), { Ann: 1, Ben: 1, Cal: 1 }), {
    kind: "split",
    shares: [
      { label: "Ann", pct: 33, color: col("Ann") },
      { label: "Ben", pct: 33, color: col("Ben") },
      { label: "Cal", pct: 33, color: col("Cal") },
    ],
    overflow: 0,
  });
});

test("and the other direction, where independent rounding sums to 101", () => {
  // 4/6 and 1/6 twice: 67 + 17 + 17. Pinned for the same reason as the 99 case,
  // so neither is ever read as the bug that justifies reconciling them.
  const r = crowdSplit(opts("Ann", "Ben", "Cal"), { Ann: 4, Ben: 1, Cal: 1 });
  assert.deepEqual(r, {
    kind: "split",
    shares: [
      { label: "Ann", pct: 67, color: col("Ann") },
      { label: "Ben", pct: 17, color: col("Ben") },
      { label: "Cal", pct: 17, color: col("Cal") },
    ],
    overflow: 0,
  });
  assert.equal(
    r.kind === "split" && r.shares.reduce((n, s) => n + s.pct, 0),
    101,
    "the sum is 101 and that is the pinned behaviour, not a defect to reconcile",
  );
});

test("TWELVE OPTIONS WITH A LONG TAIL CAP AT THREE AND COUNT THE REST", () => {
  // The Grand Prix board at a full field, which is the call site the cap exists
  // for. Nine tail options become "+9 more" rather than nine more segments of
  // text on a row that has to stay one line.
  const labels = Array.from({ length: 12 }, (_, i) => "Player Nameiskindalong " + (i + 1));
  const counts: Record<string, number> = {};
  labels.forEach((l, i) => (counts[l] = i < 3 ? 10 - i : 1));
  const r = crowdSplit(opts(...labels), counts);
  assert.equal(r.kind, "split");
  assert.equal(r.kind === "split" && r.shares.length, MAX_SHARES);
  assert.equal(r.kind === "split" && r.overflow, 9);
  assert.deepEqual(
    r.kind === "split" && r.shares.map((s) => s.label),
    ["Player Nameiskindalong 1", "Player Nameiskindalong 2", "Player Nameiskindalong 3"],
  );
});

test("an option nobody picked is dropped, not shown at 0%", () => {
  // Twelve racers with two voters would otherwise print ten zeroes.
  assert.deepEqual(crowdSplit(opts("Ann", "Ben", "Cal"), { Ann: 1, Cal: 1 }), {
    kind: "split",
    shares: [
      { label: "Ann", pct: 50, color: col("Ann") },
      { label: "Cal", pct: 50, color: col("Cal") },
    ],
    overflow: 0,
  });
});

test("equal shares keep the caller's order, so the row cannot reshuffle itself", () => {
  // Board order, and it must be the same on every render: two options tied at
  // the same count swapping places between refetches is the flicker the TV
  // resolver's tiebreak exists to prevent, one screen along.
  const board = opts("Ann", "Ben", "Cal", "Dee");
  const tally = { Ann: 2, Ben: 2, Cal: 2, Dee: 1 };
  const first = crowdSplit(board, tally);
  assert.deepEqual(first, {
    kind: "split",
    shares: [
      { label: "Ann", pct: 29, color: col("Ann") },
      { label: "Ben", pct: 29, color: col("Ben") },
      { label: "Cal", pct: 29, color: col("Cal") },
    ],
    overflow: 1,
  });
  assert.deepEqual(crowdSplit(board, tally), first);
});

test("EVERY SHARE CARRIES ITS OWN COLOUR, because the row and the bar are sorted differently", () => {
  // THE REGRESSION THIS PINS, found by rendering the real screen rather than by
  // reading the code. The bar draws its segments in BOARD order and this row is
  // sorted by SHARE, so on any lopsided card the two disagree: measured on a
  // 1-2 card, the row read "Player 8 67% · Player 1 33%" while the bar painted
  // Player 1's red on the LEFT at 294px and Player 8's orange on the right at
  // 589px. While the percentage lived inside the segment that mismatch was
  // invisible, because the number sat on the fill it described. Taking the text
  // out of the bar cut that tie and left a name with no way to say which colour
  // it meant.
  //
  // The fix is the swatch, NOT re-ordering either side. Sorting the bar by share
  // would make segments swap sides as votes land, and board order is what the
  // match rows and the alive board above already use.
  const board = [
    { label: "Ann", value: "A", color: "#E10600" },
    { label: "Ben", value: "B", color: "#FF7A00" },
  ];
  const r = crowdSplit(board, { A: 1, B: 2 });
  assert.deepEqual(r, {
    kind: "split",
    shares: [
      { label: "Ben", pct: 67, color: "#FF7A00" },
      { label: "Ann", pct: 33, color: "#E10600" },
    ],
    overflow: 0,
  });
  // The row leads with Ben and the bar leads with Ann's colour. That is allowed,
  // and it is exactly why each share has to carry its own colour.
  assert.notEqual(
    r.kind === "split" && r.shares[0]!.label,
    board[0]!.label,
    "this fixture must actually be lopsided, or it pins nothing",
  );
});

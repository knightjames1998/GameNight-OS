// Tests for the editable voter nickname (web/src/beerio/specname.ts).
//
// THE INVARIANT UNDER TEST is the one the request named: a voter can change
// their nickname and their results do not move. That holds because predictions
// are keyed by `sid`, a per-device id, and the name is one field on the entry.
// Nothing anywhere keys on the name, so the tests below are about the two ways
// an editable name could still go wrong: being cleared to nothing, and taking
// the picks with it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSpecName, renameInPreds, SPEC_NAME_MAX } from "../../web/src/beerio/specname.js";

const crowd = () => ({
  s1: { name: "Ann", picks: { "M:W1M0": "A", "M:W1M1": "B" } },
  s2: { name: "Ben", picks: { "M:W1M0": "B" } },
});

test("an ordinary name is kept as typed", () => {
  assert.equal(cleanSpecName("Ann"), "Ann");
});

test("surrounding whitespace is trimmed", () => {
  assert.equal(cleanSpecName("  Ann  "), "Ann");
});

test("A NAME CANNOT BE CLEARED TO NOTHING, which is the guard that matters", () => {
  // A voter holding backspace would otherwise show as "Mystery fan" on the
  // board and, worse, look to themselves like somebody else, which is the exact
  // confusion the per-device sid exists to prevent.
  assert.equal(cleanSpecName(""), null);
  assert.equal(cleanSpecName("   "), null);
  assert.equal(cleanSpecName("\t\n "), null);
});

test("a non-string is not a name", () => {
  assert.equal(cleanSpecName(undefined), null);
  assert.equal(cleanSpecName(null), null);
  assert.equal(cleanSpecName(42), null);
});

test("a long name is capped rather than rejected", () => {
  const long = "Bartholomew Fitzgerald the Third";
  const out = cleanSpecName(long);
  assert.equal(out, long.slice(0, SPEC_NAME_MAX));
  assert.equal(out!.length, SPEC_NAME_MAX);
});

test("capping happens after trimming, so trailing spaces do not eat the budget", () => {
  assert.equal(cleanSpecName("   Ann   "), "Ann");
});

test("RENAMING CHANGES THE NAME AND NOTHING ELSE", () => {
  const before = crowd();
  const after = renameInPreds(before, "s1", "Annie");
  assert.equal(after.s1!.name, "Annie");
  assert.deepEqual(after.s1!.picks, before.s1.picks, "the picks moved");
  assert.equal(after.s1!.picks, before.s1.picks, "the picks were rebuilt rather than carried");
});

test("THE VOTER KEEPS THEIR KEY, so the board cannot show them twice", () => {
  // If a rename ever created a new entry the crowd count would tick up, the old
  // score would sit there orphaned under the old name, and the voter would see
  // themselves twice.
  const after = renameInPreds(crowd(), "s1", "Annie");
  assert.deepEqual(Object.keys(after), ["s1", "s2"]);
  assert.equal(Object.keys(after).length, 2);
});

test("nobody else is touched", () => {
  const before = crowd();
  const after = renameInPreds(before, "s1", "Annie");
  assert.deepEqual(after.s2, before.s2);
  assert.equal(after.s2, before.s2);
});

test("renaming a voter the crowd has never seen changes nothing", () => {
  // A voter who has typed a name but never cast a pick has no server entry yet.
  // Inventing one here would put an empty score on the board before they have
  // actually joined.
  const before = crowd();
  assert.equal(renameInPreds(before, "s9", "Nobody"), before);
});

test("renaming twice is not cumulative and does not compound", () => {
  const before = crowd();
  const once = renameInPreds(before, "s1", "Annie");
  const twice = renameInPreds(once, "s1", "Ann-Marie");
  assert.equal(twice.s1!.name, "Ann-Marie");
  assert.deepEqual(twice.s1!.picks, before.s1.picks);
});

test("the input source is not mutated", () => {
  // The board renders from this map; mutating it in place would update some
  // views and not others depending on what React had already read.
  const before = crowd();
  renameInPreds(before, "s1", "Annie");
  assert.equal(before.s1.name, "Ann");
});

// THE SUMMARY RULE IS SPELLED TWICE AND THE TWO SPELLINGS MUST AGREE.
//
// `summaryKind` answers "is this row a summary, and of what kind" in
// TypeScript, row by row, for the aggregation, the crew leaderboard, the
// rivalry and the recap. `SUMMARY_LABELS` answers the same question in SQL,
// once, for partner stats, which aggregate inside the database and cannot call
// a function per row.
//
// TWO SPELLINGS OF ONE RULE IS EXACTLY HOW THE TWO DRIFT, and the failure is
// silent in the direction that matters: add a third summary kind to the
// classifier, forget the SQL list, and every partner record quietly counts the
// new summary on top of the rows it summarizes. Nothing errors. This file is
// written in partner-stats-baseline.test.ts's style and for its stated reason:
// pinning the JS spelling means the day somebody changes what a summary is,
// this fails and the SQL gets looked at too.
//
// Pure: the classifier and the list are both constants.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEERIO_TOURNAMENT_LABEL,
  isSeriesSummary,
  isSummaryRow,
  SERIES_LABEL,
  summaryKind,
  SUMMARY_LABELS,
} from "@gamenight/shared";

// ---------- the labels themselves ----------

test("both summary labels are the exact strings the ledger is written with", () => {
  // Pinned because these strings are what already-written rows carry. Changing
  // one would not error: it would make every past row of that kind stop being
  // recognised as a summary and start counting as a game again.
  assert.equal(SERIES_LABEL, "smashdown");
  assert.equal(BEERIO_TOURNAMENT_LABEL, "beerio_tournament");
});

test("the classifier names the kind, and everything else is an ordinary result", () => {
  assert.equal(summaryKind(SERIES_LABEL), "series");
  assert.equal(summaryKind(BEERIO_TOURNAMENT_LABEL), "tournament");
  assert.equal(summaryKind(null), null);
  assert.equal(summaryKind(undefined), null);
  assert.equal(summaryKind(""), null);
  // The labels that legitimately ARE their own unit must not be caught. The
  // first two are the regression a careless "skip labelled rows" fix causes;
  // the third is the one this session could plausibly have broken, because a
  // generic bracket wears the word this session is about.
  assert.equal(summaryKind("bo3"), null);
  assert.equal(summaryKind("bo7"), null);
  assert.equal(summaryKind("Tournament"), null, "a generic bracket is not a summary of anything");
  assert.equal(summaryKind("Rainbow Road"), null);
  assert.equal(summaryKind("Peach's Birthday Cake"), null);
  // Exact, lowercase, both of them.
  assert.equal(summaryKind("Smashdown"), null, "the label is lowercase, exactly");
  assert.equal(summaryKind("Beerio Kart"), null, "the game name is not the label");
  assert.equal(summaryKind("beerio_kart"), null, "nor is the pack key");
});

// ---------- the two spellings ----------

test("the SQL list and the JS classifier agree, in BOTH directions", () => {
  // Forwards: every label the SQL excludes is one the classifier calls a
  // summary. A stale entry here would exclude ordinary rows from partner stats.
  for (const label of SUMMARY_LABELS) {
    assert.notEqual(summaryKind(label), null, `SQL excludes ${label}, the classifier does not`);
  }
  // Backwards, and this is the direction that actually bites: every kind the
  // classifier knows must appear in the SQL list. A third kind added to
  // summaryKind and forgotten here inflates every partner record silently.
  for (const label of [SERIES_LABEL, BEERIO_TOURNAMENT_LABEL]) {
    assert.ok(SUMMARY_LABELS.includes(label), `the classifier knows ${label}, the SQL does not`);
  }
  assert.equal(SUMMARY_LABELS.length, 2, "two kinds; a third needs a line in both spellings");
});

test("the backward check can actually fail, and is not vacuously true", () => {
  // Negative control, in copy-rules.test.ts's style. The assertion above
  // passes, so a check that had quietly stopped working would look exactly
  // like the rule still holding.
  assert.equal(SUMMARY_LABELS.includes("a_third_kind_nobody_added_to_the_sql"), false);
  assert.equal(summaryKind("a_third_kind_nobody_added_to_the_sql"), null);
});

// ---------- the narrow predicate and the general one ----------

test("isSeriesSummary stayed narrow, and isSummaryRow is the general question", () => {
  // The whole point of keeping both. Smash's series standings ask the first;
  // everything that counts games asks the second. If these two ever agree on
  // a tournament row, a Beerio title has landed in somebody's Smashdown record.
  assert.equal(isSeriesSummary(SERIES_LABEL), true);
  assert.equal(isSeriesSummary(BEERIO_TOURNAMENT_LABEL), false, "a Beerio title is NOT a Smashdown series");
  assert.equal(isSummaryRow(SERIES_LABEL), true);
  assert.equal(isSummaryRow(BEERIO_TOURNAMENT_LABEL), true);
  assert.equal(isSummaryRow("bo3"), false);
  assert.equal(isSummaryRow(null), false);
});

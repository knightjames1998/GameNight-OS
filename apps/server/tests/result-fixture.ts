// One ResultRow builder, shared by every test that feeds the stats aggregation.
//
// NOT a *.test.ts file on purpose: the runner globs ./tests/*.test.ts, so this
// is imported rather than collected.
//
// It lived inside series-rows.test.ts until stats-agg.test.ts needed the same
// shape. Copying it would have been the obvious move and is the wrong one: two
// builders drift, and a fixture that drifts makes two test files disagree about
// what a ledger row even looks like while both stay green. Same reasoning as
// every other "this existed twice" entry in this repo's history.

import { SERIES_LABEL } from "@gamenight/shared";
import type { ResultRow } from "../src/stats.js";

let seq = 0;

/**
 * One ledger result, defaulted to a clean win so a test only has to state what
 * it is actually about. `matchId` and `playedAt` advance on every call, so rows
 * built in sequence are distinct and ordered without any test saying so.
 */
export function result(over: Partial<ResultRow> = {}): ResultRow {
  seq++;
  return {
    matchId: `m${seq}`,
    placement: 1,
    isWinner: true,
    gameName: "Smash Bros",
    character: "Fox",
    playedAt: new Date(2026, 6, 28, 20, seq),
    eventId: "e1",
    label: null,
    ...over,
  };
}

/** The summary row one finished series writes: no character, label set. */
export const seriesResult = (over: Partial<ResultRow> = {}): ResultRow =>
  result({ label: SERIES_LABEL, character: null, ...over });

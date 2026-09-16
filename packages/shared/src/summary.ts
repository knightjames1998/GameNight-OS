/**
 * SUMMARY ROWS: the ledger rows that describe other ledger rows.
 *
 * Almost every `matches` row in this app IS the unit its games produced. A
 * Best Of set, a Ping Pong match, a Mario Party board, a generic bracket: each
 * is the only row its play writes, so counting it counts that play exactly
 * once. A SUMMARY row is the exception, and it is dangerous in one specific
 * way: it sits in the same table, is selected by the same queries, and looks
 * like an ordinary result to anything that does not know better. Count it and
 * every player quietly gains a game, the winner gains a win, win rates shift,
 * and NOTHING ANYWHERE ERRORS. Nobody finds that by reading a screen.
 *
 * There have been two kinds since 2026-09-15 and there was one before that,
 * which is why this module exists at all. The rule used to be a single
 * equality against `SERIES_LABEL`, written out at six call sites. Two kinds
 * means the question every one of those sites is really asking has to be
 * asked out loud instead: "is this a summary?" is a different question from
 * "is this a Smashdown series?", and until now they had the same answer, so
 * nobody had to choose. Every caller now says which one it means.
 *
 * WHY THIS IS NOT IN `smash.ts`: Smashdown's series row is one kind of
 * summary, not the definition of the category. A module that every pack's
 * results flow through should not live inside one pack.
 *
 * THESE STRINGS ARE WRITTEN INTO SHIPPED ROWS AND ARE PERMANENT. Changing one
 * would not error; it would quietly make every past row of that kind stop
 * being recognised and start counting as a game again. `pack-identifiers.test.ts`
 * pins both for the same reason it pins every other ledger identifier.
 */

import { SERIES_LABEL } from "./smash.js";

/**
 * The label a finished Beerio Kart BRACKET night carries on its one summary
 * row, alongside the per-match rows the night also writes.
 *
 * NOT written by any code as of 2026-09-15: the label and the classifier
 * shipped a full session before anything could produce a row carrying it, so
 * the aggregation, the recap and the crew leaderboard all learned to handle it
 * while production was provably unaffected. The legacy nights already in the
 * ledger take it by a one-off UPDATE once those surfaces are live.
 *
 * BEERIO'S GRAND PRIX NIGHTS DO NOT GET THIS LABEL, ever, and that is the
 * distinction the whole constant rests on. A GP night writes ONE placement row
 * and no heat rows, so there is nothing underneath it for it to summarize: the
 * night IS the game unit, exactly as a Best Of set is. A bracket night writes a
 * row per decided 1v1 match AND this one, so this one is a description of rows
 * that are already there.
 */
export const BEERIO_TOURNAMENT_LABEL = "beerio_tournament";

/**
 * What kind of summary a row's label makes it, or null for an ordinary result.
 *
 * THE RETURN TYPE IS THE POINT. A boolean would let a caller keep treating the
 * two kinds as one, which is exactly the bug: a Smashdown series and a Beerio
 * tournament are both excluded from games played, and they feed COMPLETELY
 * DIFFERENT tallies afterwards. Making the caller name the kind means a third
 * kind arrives as a type error rather than as silently wrong numbers.
 */
export function summaryKind(label: string | null | undefined): "series" | "tournament" | null {
  if (label === SERIES_LABEL) return "series";
  if (label === BEERIO_TOURNAMENT_LABEL) return "tournament";
  return null;
}

/** True for a row of ANY summary kind: the question the game counters ask. */
export const isSummaryRow = (label: string | null | undefined): boolean => summaryKind(label) !== null;

/**
 * Every summary label, for the ONE place the rule has to be expressed in SQL
 * rather than in TypeScript: partner stats aggregate in the database and
 * cannot call `summaryKind` per row.
 *
 * TWO SPELLINGS OF ONE RULE IS HOW THE TWO DRIFT, and this array is what stops
 * that being silent. `summary-labels.test.ts` pins that this list and the
 * classifier agree in both directions, so adding a third kind to `summaryKind`
 * and forgetting the SQL fails a test instead of inflating partner records.
 */
export const SUMMARY_LABELS: readonly string[] = [SERIES_LABEL, BEERIO_TOURNAMENT_LABEL];

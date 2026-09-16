// The client's door onto the shared ledger-format registry.
//
// WHAT THIS FILE USED TO BE. A hand-maintained FORMAT_LABEL map plus a
// hand-maintained FORMAT_UNIT map, written here because three screens needed
// them (StatsPage, MyStatsPage and recap.tsx, where it was a third copy called
// FORMAT_NAME). Unifying those three was right and is why this file exists.
//
// WHAT IT MISSED, and why the tables have now moved again. There was a FOURTH
// copy of the same idea, on the other side of the wire: FORMAT_ORDER in
// apps/server/src/stats.ts, sorting the same keys this file was naming. Two
// tables over one set of strings, in two packages, with nothing connecting
// them, is the shape the pack registry already exists to kill, and both had
// drifted by the time anybody looked. See packages/shared/src/formats.ts.
//
// So the definitions live in packages/shared now and this file re-exports them.
// It stays rather than being deleted because six modules import `formatLabel`
// and `formatUnit` from "./formats" or "../formats", and a shim costs nothing
// next to touching six files to say the same thing.

import { summaryKind } from "@gamenight/shared";

export {
  FORMAT_ORDER,
  LEDGER_FORMATS,
  formatLabel,
  formatOrderIndex,
  formatUnit,
  type LedgerFormatDef,
} from "@gamenight/shared";

import { LEDGER_FORMATS } from "@gamenight/shared";

/**
 * The canonical display name for a stored format key.
 *
 * Derived from the registry rather than declared, so it cannot fall behind it.
 * Kept because it is a named export this file has always had; new code should
 * call `formatLabel`, which handles the unknown-key fallback.
 */
export const FORMAT_LABEL: Record<string, string> = Object.fromEntries(
  LEDGER_FORMATS.map((f) => [f.key, f.label]),
);

/**
 * What one recorded unit is CALLED in each format, plural. Only formats whose
 * ledger unit is not a game have an entry; the rest fall back to "games" inside
 * `formatUnit`.
 *
 * recap.tsx reads this map directly (it wants the plural noun without a count),
 * which is why it is still exported rather than folded into formatUnit alone.
 */
export const FORMAT_UNIT: Record<string, string> = Object.fromEntries(
  LEDGER_FORMATS.flatMap((f) => (f.unit ? [[f.key, f.unit]] : [])),
);

/**
 * A raw `matches.label` turned into something a person can read, or null when
 * there is nothing worth printing.
 *
 * ADDED 2026-09-15, AND IT EXISTS BECAUSE A LEDGER LABEL IS NOT COPY. Most
 * labels happen to read fine on a screen (a board name, a cup, bo3), which is
 * why several surfaces have always printed the field straight through. The
 * summary labels do not: `beerio_tournament` is an identifier, chosen to be
 * stable in a database forever, and the moment the one-off relabel ran, the
 * live event page would have printed "Beerio Kart - beerio_tournament" over
 * every old Beerio night.
 *
 * So the two kinds get answers rather than passthrough:
 *   - a TOURNAMENT says so, because "Tournament" is the true and useful word
 *     for what that night was, and it is what the night reads as everywhere
 *     else on the screen.
 *   - a SERIES returns null, because a series row is never a line of its own
 *     anywhere (the recap drops it into its battles), so anything that reaches
 *     this with one is asking about a row it should not be showing.
 */
export function ledgerLabelText(label: string | null | undefined): string | null {
  const kind = summaryKind(label);
  if (kind === "tournament") return "Tournament";
  if (kind === "series") return null;
  return label ?? null;
}

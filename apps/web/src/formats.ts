// One name per format, and one unit noun per format.
//
// This map existed THREE times: StatsPage, MyStatsPage and recap.tsx (as
// FORMAT_NAME), with the unit noun duplicated twice alongside it. They agreed
// today, which is exactly why it was worth fixing now: three copies that agree
// are one edit away from two copies that do not, and the symptom would be the
// same night described one way on the leaderboard and another on the recap
// card.
//
// SCOPE, deliberately: the TV views each compose their own title sentence
// ("Grand Prix · Cup 2 (3/4)", "King of the Hill · free play · 6 games") and
// those keep their own wording. They are not repetitions of this idea, they
// are pack-specific copy that happens to contain a format name, and flattening
// them into a lookup would lose the cup progress, the set count and the
// best-of length that make each one useful on a big screen.

/** The canonical display name for a stored format key. */
export const FORMAT_LABEL: Record<string, string> = {
  free: "Free Play",
  ffa: "Free-for-all",
  grandprix: "Grand Prix",
  bestof: "Best Of",
  koth: "King of the Hill",
  board: "Board night",
  other: "Other",
};

/** Display name, falling back to the raw key so an unknown format still reads. */
export const formatLabel = (f: string): string => FORMAT_LABEL[f] ?? f;

/**
 * What one recorded unit is CALLED in each format, which differs because the
 * ledger unit differs: a Grand Prix records races, a Best Of records sets, a
 * Mario Party night records boards. Plural; formatUnit singularizes.
 */
export const FORMAT_UNIT: Record<string, string> = {
  grandprix: "races",
  bestof: "sets",
  board: "boards",
  other: "results",
};

/** "3 races", "1 set", "8 games". */
export function formatUnit(f: string, n: number): string {
  const base = FORMAT_UNIT[f] ?? "games";
  return n === 1 ? base.replace(/s$/, "") : base;
}

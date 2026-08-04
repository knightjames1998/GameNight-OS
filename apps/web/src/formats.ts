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
  // Game-as-unit like ffa, so no FORMAT_UNIT entry: a Smashdown series records
  // one row per battle and the default "games" is the right noun for it.
  smashdown: "Smashdown",
  board: "Board night",
  // The whole casino group records one row per SESSION, so they share one
  // format key. The pack (games.name) is what tells blackjack from poker.
  cash: "Cash game",
  // One row per board game played, so the default "games" unit is right and
  // there is no FORMAT_UNIT entry. The TITLE is on matches.label, not here:
  // this pack has one format and many titles, which is the opposite of the
  // casino group's one format across many packs.
  boardgame: "Board game",
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
  // A cash night's unit is the night. "8 games of blackjack" would be a lie
  // about a ledger that holds one row per table.
  cash: "sessions",
  other: "results",
};

/** "3 races", "1 set", "8 games". */
export function formatUnit(f: string, n: number): string {
  const base = FORMAT_UNIT[f] ?? "games";
  return n === 1 ? base.replace(/s$/, "") : base;
}

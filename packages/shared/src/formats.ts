// ONE REGISTRY OF WHAT A LEDGER FORMAT IS. Both sides import it.
//
// THE PROBLEM THIS EXISTS TO KILL, which is the pack registry's problem again
// one level down. `matches.format` is written by twelve sites across nine pack
// files and read back by two tables that lived on opposite sides of the wire
// and knew nothing about each other:
//
//   apps/web/src/formats.ts     FORMAT_LABEL, the display name
//   apps/server/src/stats.ts    FORMAT_ORDER, the sort order on the crew stats
//                               screen's per-game format breakdown
//
// Both were hand-maintained, and both had drifted. FORMAT_LABEL was missing
// `casino_run` and `deduction`, so those two printed their raw database
// spelling on the crew leaderboard, on /me/stats and on the recap card, because
// formatLabel falls back to the key. FORMAT_ORDER was missing SIX of the twelve,
// and the consequence there was worse than an omission: `indexOf` returns -1 for
// a key it does not hold, so every missing format sorted AHEAD of `free` at
// index 0, and `other`, which the array plainly means as its trailing bucket,
// was beaten to the top by everything it did not list.
//
// Neither failure throws. The numbers were right the whole time. See
// AUDIT-2026-08.md, MUST FIX 2 and MUST FIX 3.
//
// ADDING A FORMAT: add one entry here, in the position it should sort. Its
// label, its sort position and its unit noun all come with it, and
// apps/server/tests/format-tables.test.ts fails the day a pack writes a format
// key with no entry, which is the day somebody is already in the file.
//
// WHAT MUST NEVER CHANGE is `key`. It is `matches.format` on rows already
// written, and it is what the crew leaderboard's format breakdown groups on, so
// renaming one splits that format's history in two with nothing erroring. The
// label, the order and the unit are DISPLAY and safe to change whenever: none
// of them is written to the database.

/** One format a pack can write to matches.format. */
export interface LedgerFormatDef {
  /** matches.format, exactly as written. PERMANENT; see the header. */
  key: string;
  /** Display name, everywhere a format is named. Safe to change. */
  label: string;
  /**
   * What one recorded unit is CALLED in this format, plural. Omitted means
   * "games", which is right for every format whose ledger unit really is one
   * game. formatUnit singularizes.
   */
  unit?: string;
}

/**
 * Every ledger format, IN DISPLAY ORDER. The array order IS the sort order, so
 * there is no second list to keep in step with this one.
 *
 * ORDER IS NOT SHIP ORDER here, unlike SESSION_PACKS, because nothing keys off
 * a format's position except this ordering: it is display only and reordering
 * it changes one screen's layout and nothing else. The grouping is the
 * multi-format packs first (in the order they already sorted), then the
 * one-format packs by group, then the bucket for everything untagged.
 */
export const LEDGER_FORMATS: LedgerFormatDef[] = [
  // The multi-format packs: Mario Kart, Smash and Ping Pong share these.
  { key: "free", label: "Free Play" },
  { key: "ffa", label: "Free-for-all" },
  { key: "grandprix", label: "Grand Prix", unit: "races" },
  { key: "bestof", label: "Best Of", unit: "sets" },
  { key: "koth", label: "King of the Hill" },
  // Game-as-unit like ffa, so no unit: a Smashdown series records one row per
  // battle and the default "games" is the right noun for it. The series SUMMARY
  // row carries this same format key and is excluded from the tallies by
  // isSeriesSummary, which is why one key covers both.
  { key: "smashdown", label: "Smashdown" },
  { key: "board", label: "Board night", unit: "boards" },
  // The title-night group. One row per titled game played, so the default
  // "games" unit is right for all three. The TITLE is on matches.label, not
  // here: these packs have one format and many titles, which is the opposite of
  // the casino group's one format across many packs.
  { key: "boardgame", label: "Board game" },
  { key: "cardtable", label: "Card game" },
  // "Deduction game", following Board game and Card game, because it is the
  // same pack shape: one row per titled game. Not "Deduction night", which
  // would be the same lie "8 games of blackjack" would be, in reverse.
  { key: "deduction", label: "Deduction game" },
  // The casino group records one row per SESSION, so they share one format key
  // and the pack (games.name) is what tells blackjack from roulette.
  { key: "cash", label: "Cash game", unit: "sessions" },
  // POKER IS THE EXCEPTION, AND IT IS ABOUT POKER'S OWN TWO FORMATS rather than
  // about telling it from blackjack. The pack ships a cash game now and a
  // tournament later, and those are genuinely different claims about a player:
  // a cash net and a finishing position are not the same skill and must not
  // share a leaderboard bucket. `games.name` cannot separate them because both
  // are Poker, which is deliberate (one `games` row, or lifetime history splits
  // across two tabs), so the FORMAT is what carries it. Namespaced rather than
  // bare `tourney`, because a bare key would read as "the tournament format" for
  // any pack and Smash has one queued.
  //
  // "poker:tourney" IS RESERVED AND NOT DECLARED HERE, on purpose: nothing
  // writes it yet, and a format in this table that no materializer produces is
  // an empty bucket on a stats screen. It joins this list on the commit that
  // ships the tournament format, next to this comment.
  { key: "poker:cash", label: "Poker cash game", unit: "sessions" },
  // The CO-OP one, which is genuinely not a cash game: one shared bank against
  // a target rather than per-player nets, so it has its own key. The label
  // matches the picker's format label for this pack, which is the wording a
  // host already chose it by.
  { key: "casino_run", label: "Co-op run" },
  // LAST, ALWAYS. The bucket a row with no format falls into, which today is
  // every bracket: brackets.ts inserts its matches row with no format column at
  // all, and stats.ts reads `r.format ?? "other"`.
  { key: "other", label: "Other", unit: "results" },
];

/** Ledger format key -> its definition. */
const BY_KEY: Record<string, LedgerFormatDef> = Object.fromEntries(
  LEDGER_FORMATS.map((f) => [f.key, f]),
);

/**
 * Every format key in display order. This is what the crew stats screen sorts
 * its per-game format buckets on.
 *
 * DERIVED, not restated. The bug this replaces was a second array that had
 * fallen six entries behind the first.
 */
export const FORMAT_ORDER: string[] = LEDGER_FORMATS.map((f) => f.key);

/**
 * Sort position for a format key. A key with no entry sorts LAST rather than
 * first, which is the half of the old bug that `indexOf` got backwards: an
 * unknown format is the least known thing on the screen and belongs at the
 * bottom, next to "Other", never above the format the list starts with.
 */
export const formatOrderIndex = (f: string): number => {
  const i = FORMAT_ORDER.indexOf(f);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

/** Display name, falling back to the raw key so an unknown format still reads. */
export const formatLabel = (f: string): string => BY_KEY[f]?.label ?? f;

/** "3 races", "1 set", "8 games". */
export function formatUnit(f: string, n: number): string {
  const base = BY_KEY[f]?.unit ?? "games";
  return n === 1 ? base.replace(/s$/, "") : base;
}

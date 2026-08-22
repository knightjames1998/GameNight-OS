// THE EVENT TV'S DENSITY LADDER, for /e/:id/tv.
//
// A television cannot be scrolled, so anything past 1080px is not "below the
// fold", it is GONE. This screen had no ladder and no harness case at all until
// 2026-08-22, and the first thing measuring it found was TWO FAILURES STACKED,
// which is why the fix is not just "make it smaller":
//
//   1. THE BETWEEN-GAMES SCREEN DID NOT FIT. 1232px in both themes, over by
//      152, measured against the lowest painted pixel.
//   2. IT WAS THE SAME 1232px AT EIGHT, TWELVE AND SIXTEEN PLAYERS, because
//      `recap.players.slice(0, 8)` and `recap.games.slice(-6)` are hard caps
//      with nothing behind them. A twelve-person night dropped four people off
//      the television and NOTHING ON SCREEN SAID SO. That is an overflow
//      arrived at from the other direction: the screen fits by discarding
//      people, and then does not even fit.
//
// So the cap is the bug and the ladder is the fix. The band decides how many
// rows fit, and when the roster is genuinely larger than the tightest band can
// hold, the screen SAYS how many it is not showing instead of silently
// shortening the list.
//
// IT IS NOT tv-band.ts AND MUST NOT BECOME IT. That file is the BRACKET TV's
// ladder, tuned against on-deck cards and an alive board. This screen is two
// stacked lists and a QR block. Same shape, own numbers, own attribute:
// `data-eband`, so the two ladders can never collide on `.gn-tv` even though
// both screens wear that class.
//
// -------------------------------------------------------------------------
// MEASURED at 1920x1080 against the lowest painted pixel, Arcade, base metrics:
//
//     page total at 8 rows                             1232px  (over by 152)
//     header (title, date line, QR block)               169px
//     the two columns                                   882px
//     one standings row (.gn-tvs)                        90px
//     one results row (.gn-tvr)                          73px
//     everything that is not the columns                350px
//     therefore the columns' budget                     730px
//
// THE STANDINGS COLUMN BINDS, always. The two columns sit SIDE BY SIDE in one
// grid row, so the screen costs max(left, right) rather than left + right, and
// a standings row is 90px against a results row's 73px. So the band is taken
// off the PLAYER count, and the results slice is then chosen to keep the right
// column inside whatever the left one already spent. A single scalar summing
// both would be wrong in both directions, which is the lesson tv-band.ts
// already wrote down about its own two columns.
//
// THE LOBBY STATE IS NOT THE BINDING ONE and was measured to make sure: the
// yes-RSVP chips WRAP rather than stack, so twenty of them still fit at base
// metrics. It gets a ceiling anyway, because "wraps today at twenty" is not the
// same claim as "wraps at any count", and a crew list has no cap.
// -------------------------------------------------------------------------

/** The bands, roomiest first. Same names as tv-band.ts, deliberately: one vocabulary. */
export type EventTvBand = "roomy" | "close" | "tight" | "packed";

/** Roomiest to tightest. Exported so a test can assert the ladder is ordered. */
export const ETV_BANDS: readonly EventTvBand[] = ["roomy", "close", "tight", "packed"] as const;

/**
 * THE TYPE FLOOR, and it is the SAME NUMBER tv-band.ts uses rather than a
 * second opinion. 2.2vmin is 23.8px on a 1080p screen, the size the casino
 * money board's tightest band puts a player's name at, settled 2026-08-02.
 *
 * NO BAND MAY PUT A PERSON'S NAME BELOW IT, here meaning `.gn-tvs__nm` (a
 * player in the standings) and `.gn-tv-name` (a chip in the lobby list). Counts,
 * averages, game titles and the date line may and do go smaller, because nobody
 * reads those from a couch, they recognise them.
 */
export const ETV_NAME_FLOOR_VMIN = 2.2;

/**
 * How many standings rows each band actually fits, measured rather than chosen.
 *
 * THIS REPLACES A HARDCODED 8 THAT WAS WRONG IN BOTH DIRECTIONS: it showed
 * eight rows on a screen whose base metrics only fit seven, and it hid the
 * ninth player and everybody after them.
 */
export const ETV_PLAYER_SLICE: Readonly<Record<EventTvBand, number>> = {
  roomy: 6,
  close: 8,
  tight: 10,
  packed: 12,
};

/**
 * How many results rows each band shows. The right column is the shorter one,
 * so these are set to stay inside the left column's spend rather than to fill
 * the screen: a results list that outgrew the standings would start driving a
 * band that is supposed to be about people.
 */
export const ETV_RESULT_SLICE: Readonly<Record<EventTvBand, number>> = {
  roomy: 5,
  close: 7,
  tight: 9,
  packed: 11,
};

/**
 * The QR block's pixel size per band. It is a PROP rather than a stylesheet
 * value (QRCodeSVG takes a number), so it cannot ride the CSS variables the
 * rest of the ladder spends and has to be named here.
 *
 * IT IS THE HEADER'S WHOLE HEIGHT. At base metrics the header is 169px and the
 * QR is 130 of it, so this is the cheapest chrome lever on the screen. It stops
 * at 88px because below that a phone camera starts having to be walked toward
 * the television, which defeats the point of putting it there.
 */
export const ETV_QR: Readonly<Record<EventTvBand, number>> = {
  roomy: 130,
  close: 112,
  tight: 96,
  packed: 88,
};

/** The largest roster this ladder was MEASURED against. */
export const ETV_MEASURED_TO = 24;

/** What is being asked of the screen. */
export interface EventTvLoad {
  /** Standings rows available. 0 in the lobby state. */
  players: number;
  /** Result rows available. 0 in the lobby state. */
  results: number;
  /** Yes-RSVP chips. Only the lobby state has these. */
  waiting: number;
}

/**
 * Player ceilings, measured against the column budget at each band's row height.
 * These ARE the slices above: a band is picked precisely when it can show
 * everybody, and the last one is the floor.
 */
const PLAYER_CEILINGS: readonly (readonly [EventTvBand, number])[] = [
  ["roomy", ETV_PLAYER_SLICE.roomy],
  ["close", ETV_PLAYER_SLICE.close],
  ["tight", ETV_PLAYER_SLICE.tight],
];

/**
 * Results ceilings. Deliberately LOOSER than the player ones at every rung: a
 * results row is 73px against a standings row's 90px, so a given band holds
 * more of them, and this column should never be what tightens the screen.
 */
const RESULT_CEILINGS: readonly (readonly [EventTvBand, number])[] = [
  ["roomy", ETV_RESULT_SLICE.roomy],
  ["close", ETV_RESULT_SLICE.close],
  ["tight", ETV_RESULT_SLICE.tight],
];

/**
 * Lobby ceilings, in CHIPS. The chip list wraps, so it grows in rows of several
 * rather than one row per person, which is why these numbers are so much larger
 * than the standings ones and why the lobby state was never the failing face.
 */
const LOBBY_CEILINGS: readonly (readonly [EventTvBand, number])[] = [
  ["roomy", 20],
  ["close", 28],
  ["tight", 36],
];

const rung = (b: EventTvBand) => ETV_BANDS.indexOf(b);
const tightest = ETV_BANDS[ETV_BANDS.length - 1]!;

/** Whichever of the two is tighter. */
const tighter = (a: EventTvBand, b: EventTvBand): EventTvBand => (rung(a) >= rung(b) ? a : b);

function pick(
  ceilings: readonly (readonly [EventTvBand, number])[],
  total: number,
): EventTvBand {
  for (const [band, ceiling] of ceilings) if (total <= ceiling) return band;
  return tightest;
}

/**
 * The band for an event TV carrying this load.
 *
 * PURE, and exported on its own rather than living as a ternary inside the
 * component, because the silent failure here is a ladder that exists in CSS and
 * is never applied: nothing errors, nothing logs, and the screen is exactly as
 * broken as it was before. That is not hypothetical on this screen, it is what
 * the hardcoded slices were.
 *
 * TOTAL BY CONSTRUCTION. A roster past what was measured, and anything that is
 * not a number at all, clamps to the TIGHTEST band rather than walking off the
 * end of the ceilings into a band nobody has metrics for. There is no cap on a
 * crew, so past-the-end is reachable here rather than defensive.
 */
export function eventTvBand(load: EventTvLoad): EventTvBand {
  const { players, results, waiting } = load;
  if (!Number.isFinite(players) || !Number.isFinite(results) || !Number.isFinite(waiting)) {
    return tightest;
  }
  const n = Math.max(0, Math.floor(players));
  const r = Math.max(0, Math.floor(results));
  const w = Math.max(0, Math.floor(waiting));
  if (n > ETV_MEASURED_TO || w > ETV_MEASURED_TO * 2) return tightest;

  // THE RESULTS COLUMN IS COSTED AT THE ROOMIEST SLICE, not at the raw count,
  // and this is the same reasoning tv-band.ts applies to its on-deck column.
  // The column can only ever DRAW the band's own slice, so the most it can ask
  // for is the roomiest one; asking the tighter question first would be
  // circular. Costing it at the raw count instead is a bug that was measured
  // rather than reasoned about: a fixture with fourteen games drove the band to
  // `packed` at FOUR PLAYERS, tightening a screen with four rows on it because
  // of a column it was never going to draw in full.
  const resultCost = Math.min(r, ETV_RESULT_SLICE.roomy);
  return tighter(
    tighter(pick(PLAYER_CEILINGS, n), pick(RESULT_CEILINGS, resultCost)),
    pick(LOBBY_CEILINGS, w),
  );
}

/**
 * How many rows are shown and how many are being held back, for one column.
 *
 * THE SECOND NUMBER IS THE POINT. Returning only the slice is what the screen
 * did before, and it is why four people could vanish off a television with
 * nothing to notice. A caller that has this pair cannot render the list without
 * being handed the fact that it is short.
 */
export function shown(
  total: number,
  slice: number,
  /**
   * Whether the caller renders a "+N more" line when the list is short. That
   * line COSTS HEIGHT, and a slice measured without it is a slice that fits
   * until the exact moment it is exceeded, which is the worst possible time to
   * find out. Measured: 12 rows fit at `packed`, and 12 rows PLUS the more-line
   * ran 18px over.
   */
  moreLine = false,
): { take: number; hidden: number } {
  const n = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const cap = Math.max(0, Math.floor(slice));
  if (n <= cap) return { take: n, hidden: 0 };
  // A WHOLE ROW IS RESERVED for a line that is about a third of one, which is
  // band.ts's rule for optional blocks applied here: a band one step too roomy
  // is content off the bottom of a television, and a band one step too tight is
  // one fewer name on a list that already says how many it is not showing.
  // Reserving rather than recomputing also keeps this non-circular: whether the
  // line appears is decided by the raw count against the raw slice, before any
  // row is given back.
  const take = moreLine ? Math.max(0, cap - 1) : cap;
  return { take, hidden: n - take };
}

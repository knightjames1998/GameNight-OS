// THE BRACKET TV'S DENSITY LADDER.
//
// A television cannot be scrolled, so anything past 1080px is not "below the
// fold", it is GONE. This screen has never fitted one. Measured on the real
// bundle at 1920x1080 the day anything first measured it (2026-08-15): 1676px
// before the alive board shipped and 1548px after, at eight entrants AND at
// sixteen, because both of its columns were capped lists whose height had
// nothing to do with the roster.
//
// The fix is the shape `apps/web/src/casino/band.ts` already uses for the money
// board: compute a BAND from what is being asked of the screen, put it on the
// element as a data attribute, and let CSS override the metrics. Nothing here
// knows about pixels; it knows how much is being asked of one screen.
//
// IT IS NOT band.ts AND MUST NOT BECOME IT. That file is the casino group's
// ladder, tuned against a money board's lines, and this screen is neither a
// casino pack nor built out of those blocks. Same shape, own numbers.
//
// -------------------------------------------------------------------------
// WHAT THE MEASUREMENTS CHANGED ABOUT THE PLAN, which is the part worth
// reading before touching the ceilings.
//
// THE TWO COLUMNS DO NOT ADD UP. On deck and the alive board sit SIDE BY SIDE
// in one grid row, so the screen costs max(left, right), not left + right, and
// a single scalar "load" summing them would be wrong in both directions. They
// also grow on completely different axes:
//
//     the alive board   grows with the ENTRANT COUNT and nothing else
//     the on-deck stack does not grow with the roster at all: it is a capped
//                       slice, so its height is set by the BAND, not the night
//
// So the band is the TIGHTER of two sub-ladders, one per column. Both are
// monotone in their own input, so the pair is monotone, which is the property
// that keeps a bigger night from ever buying a roomier screen.
//
// Measured at 1920x1080 against the lowest painted pixel, base metrics:
//
//     fixed chrome (padding, header, strip, headings)   434px
//     therefore a column has                            646px
//     one on-deck card                                  209px  (4 never fit)
//     the grand-final "needs 2" note on a card           70px  (about 1/3 card)
//     the alive board at  8 / 12 / 16 / 24 entrants    482 / 625 / 769 / 985px
//
// THE BOARD IS TUNED AGAINST THE WORST STATE A COUNT PASSES THROUGH, rather
// than against the state it is in right now. A night walks through two groups,
// then three, then back to two as people are knocked out, and the third group
// is worth a flat ~168px at every count measured. Taking the band off the live
// group count would mean the screen re-laying itself out mid-night, at the
// exact moment somebody is looking at it to see who just went out. Rounding UP
// to the worst state is band.ts's rule for optional blocks, applied to a block
// that turns itself on and off.
// -------------------------------------------------------------------------

/** The bands, roomiest first. */
export type TvBand = "roomy" | "close" | "tight" | "packed";

/** Roomiest to tightest. Exported so a test can assert the ladder is ordered. */
export const TV_BANDS: readonly TvBand[] = ["roomy", "close", "tight", "packed"] as const;

/**
 * THE TYPE FLOOR, and it is a number rather than a feeling.
 *
 * 2.2vmin is 23.8px on a 1080p screen. It is the size the casino money board's
 * TIGHTEST band puts a player's name at (`.cg-tv[data-band="full"] .cg-tv__nm`,
 * measured and shipped 2026-08-02), so this app already has a settled answer
 * for how small a NAME goes on a television and this screen uses the same one
 * rather than inventing a second.
 *
 * NO BAND MAY PUT A PERSON'S NAME BELOW IT: not an on-deck slot, not a chip on
 * the alive board. Round titles, counts and group labels may and do go smaller,
 * because nobody reads those from the couch, they recognise them. Asserted in
 * apps/server/tests/bracket-tv-fit.test.ts against the stylesheet itself, so a
 * band added later cannot quietly undercut it.
 */
export const TV_NAME_FLOOR_VMIN = 2.2;

/**
 * The on-deck slice per band: how many ready matchups the column shows.
 *
 * IT WAS 5 AND 5 NEVER FITTED, at any count, in any state: five cards is
 * 1114px into a 646px column. Four is the cap now, which is the cheapest lever
 * on this screen and the one that costs a person the least, because the
 * heading next to it always says how many are actually ready.
 */
export const TV_DECK_SLICE: Readonly<Record<TvBand, number>> = {
  roomy: 4,
  close: 4,
  tight: 4,
  packed: 3,
};

/**
 * THE LONGEST ENTRANT LABEL, in characters, that each band's chips can carry
 * before the alive board starts costing extra rows.
 *
 * THIS IS THE WHOLE FIX FOR THE SIXTEEN-PAIRS OVERFLOW and it is a different
 * axis from the entrant count, which is why the count-based ladder could not
 * see it. Measured 2026-08-17 and confirmed 2026-08-22: SIXTEEN SOLO FITS
 * UNCHANGED and EIGHT PAIRS FITS IN ALL FOUR STATES, so the board is not
 * failing on slot count. What fails is width: `.gn-tva` chips are auto-width
 * and `.gn-tv-alive__row` wraps, so a doubled label ("Ana Somebody + Ben
 * Someone-Else") makes every chip wider, fewer fit per row, sixteen of them
 * wrap onto more rows, and the board grows about 300px.
 *
 * A solo label is one display name (~24 chars at the harness's worst case); a
 * pair is two joined with " + " (~51). So the rungs sit either side of that.
 * A CREW WITH SHORT REAL NAMES DOES NOT PAY FOR THIS: "Ana + Ben" is 9
 * characters and stays at the roomiest chip rung, which is the ladder
 * responding to what is actually on the screen rather than to the format.
 */
/**
 * The entrant count at or below which chips are NEVER capped, whatever the
 * labels say. Eight pairs was measured fitting in all four states.
 */
const CHIP_CAP_FROM = 8;

const CHIP_CEILINGS: readonly (readonly [TvBand, number])[] = [
  ["roomy", 26],
  ["close", 34],
  ["tight", 44],
];

/** The largest roster this ladder was MEASURED against. */
export const TV_MEASURED_TO = 16;

/**
 * What the grand final's "needs 2" note costs, in on-deck card equivalents.
 *
 * 70px against a 209px card is a third, rounded UP to a whole one for band.ts's
 * reason: a band one step too roomy is content off the bottom of a television,
 * and a band one step too tight is slightly smaller text. It is a real block
 * rather than a hypothetical one, and it lands at the END of a night, when the
 * on-deck column is at its emptiest, which is why it rarely binds.
 */
const GF_NOTE_CARDS = 1;

/** What is on the screen. Both columns, because the band has to serve both. */
export interface TvLoad {
  /** Everyone in the bracket. Drives the alive board and nothing else. */
  entrants: number;
  /** Matchups ready to play. Only ever costs up to the band's slice. */
  ready: number;
  /** A grand final is on deck, so a card carries the "needs 2" note. */
  gfNote?: boolean;
  /**
   * The LONGEST entrant label on the board, in characters. A team entrant's is
   * its members joined, so this is what tells a doubles board from a solo one
   * WITHOUT the ladder having to know what a team is. Absent is treated as a
   * solo-length label, which is what every payload written before doubles
   * existed effectively had.
   */
  labelChars?: number;
}

/**
 * Entrant ceilings for the alive board, measured against the worst state each
 * count passes through (three groups populated).
 */
const BOARD_CEILINGS: readonly (readonly [TvBand, number])[] = [
  ["roomy", 6],
  ["close", 10],
  ["tight", TV_MEASURED_TO],
];

/**
 * Card-equivalent ceilings for the on-deck column. The slice is capped at 4, so
 * this only ever binds when the grand-final note is up.
 */
const DECK_CEILINGS: readonly (readonly [TvBand, number])[] = [
  // WAS ["roomy", 4] AND FOUR CARDS DO NOT FIT AT ROOMY. Corrected 2026-08-22
  // after tv-fit measured `bracket tv 4 fresh` at 1128px, over by 48, in both
  // themes. The ceiling had never been exercised: until the 2026-08-21 on-deck
  // placeholder work a four-entrant fresh bracket had TWO ready matches and the
  // column never held four cards at the one entrant count whose board ceiling
  // is roomy. The deck rule made a four-card deck reachable there and the
  // ladder had no measurement for it. Eight and up were never affected, because
  // their entrant count drags the band down through the board sub-ladder.
  ["roomy", 3],
  ["close", 5],
  ["tight", 5],
];

const rung = (b: TvBand) => TV_BANDS.indexOf(b);
const tightest = TV_BANDS[TV_BANDS.length - 1]!;

/** Whichever of the two is tighter. */
const tighter = (a: TvBand, b: TvBand): TvBand => (rung(a) >= rung(b) ? a : b);

function pick(
  ceilings: readonly (readonly [TvBand, number])[],
  total: number,
): TvBand {
  for (const [band, ceiling] of ceilings) if (total <= ceiling) return band;
  return tightest;
}

/**
 * The band for a bracket TV carrying this load.
 *
 * PURE, and exported on its own rather than living as a ternary inside the
 * component, because the silent failure here is a ladder that exists in CSS and
 * is never applied: nothing errors, nothing logs, and the screen is exactly as
 * broken as it was before.
 *
 * TOTAL BY CONSTRUCTION. A roster past what was measured, and anything that is
 * not a number at all, clamps to the TIGHTEST band rather than walking off the
 * end of the ceilings into a band nobody has metrics for. The shell's bracket
 * takes its entrants off the yes-RSVP list with NO CAP, so past-the-end is a
 * reachable state here rather than a defensive flourish: twenty-four still does
 * not fit a 1080p screen and is out of this ladder's contract, but it degrades
 * at the tightest metrics there are instead of at the roomiest.
 */
export function bracketTvBand(load: TvLoad): TvBand {
  const { entrants, ready, gfNote } = load;
  if (!Number.isFinite(entrants) || !Number.isFinite(ready)) return tightest;
  if (entrants > TV_MEASURED_TO) return tightest;

  const board = pick(BOARD_CEILINGS, Math.max(0, Math.floor(entrants)));
  // The deck can only ever show the band's own slice, and the slice shrinks as
  // the ladder tightens, so cost it at the ROOMIEST slice: that is the most it
  // can ask for, and asking the tighter question first would be circular.
  const shown = Math.min(Math.max(0, Math.floor(ready)), TV_DECK_SLICE.roomy);
  const deck = pick(DECK_CEILINGS, shown + (gfNote ? GF_NOTE_CARDS : 0));
  return tighter(board, deck);
}

/**
 * The CHIP rung, which is a separate answer from the band above and rides its
 * own attribute (`data-chip`) for a reason worth stating plainly.
 *
 * IT MUST NOT TIGHTEN THE WHOLE SCREEN. An early draft folded this into
 * `bracketTvBand` and it made SIXTEEN SOLO worse: that board already sits at
 * `tight` on entrant count, so the tight block's chip cap started ellipsising
 * 24-character solo names that had always rendered in full. Sixteen solo was
 * never the broken case, and a fix that truncates it to repair a doubles board
 * has traded one screen for another.
 *
 * So this decides ONE property, `--gn-tv-chip-max`, and nothing else. A solo
 * board keeps `100%` and is byte-identical to what shipped; a doubles board
 * caps its chips so a long joined label ellipsises instead of wrapping the
 * alive board onto rows that fall off a television.
 */
export function bracketChipBand(entrants: number, labelChars?: number): TvBand {
  if (!Number.isFinite(labelChars) || !Number.isFinite(entrants)) return TV_BANDS[0]!;
  // BELOW NINE ENTRANTS THE CAP IS NEVER APPLIED, and that is measured rather
  // than cautious. EIGHT PAIRS FITS IN ALL FOUR STATES with full-length joined
  // labels, because eight wide chips do not wrap into enough rows to matter.
  // An early draft keyed this on label length ALONE and it truncated eight
  // pairs to fix sixteen: the same mistake as folding it into the band, one
  // count over. A cap is a loss of information, so it is only spent on a board
  // that would otherwise lose whole rows off the bottom of a television.
  if (Math.floor(entrants) <= CHIP_CAP_FROM) return TV_BANDS[0]!;
  return pick(CHIP_CEILINGS, Math.max(0, Math.floor(labelChars as number)));
}

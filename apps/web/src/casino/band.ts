// THE MONEY BOARD'S DENSITY LADDER.
//
// A television cannot be scrolled, so anything past 1080px is not "below the
// fold", it is GONE. The board shipped with fixed vmin metrics per line, so its
// height was linear in the seat count while the screen was not, and it ran off
// the bottom from six players up (measured 2026-07-30, and again on 2026-08-02
// against the back button rather than the footer, which is 116px lower still).
//
// The fix is the same shape ModifierWall already uses for the same class of
// problem: compute a band, put it on the element as a data attribute, and let
// CSS override the metrics. Nothing here knows about pixels; it knows about
// how much is being asked of one screen.
//
// -------------------------------------------------------------------------
// WHY THIS TAKES MORE THAN THE SEAT COUNT, WHICH IS THE ONE THING MEASUREMENT
// CHANGED ABOUT THE PLAN.
//
// The board is not alone on the screen. Four blocks draw from the same
// vertical budget, and measured on the real bundle at 1920x1080 they cost:
//
//     one board line          161.6px
//     the craps hero          271.6px   (about 1.7 lines)
//     the balance warning     118.3px   (about 0.7)
//     the modifier wall        80.6px   (about 0.5, at its roomy density)
//
// against 445.7px of fixed chrome (header, footer, back button, padding) and
// 1080px of screen. So a bare board fits exactly four players, and a craps
// table with the tracker on, a house rule up and a table that does not balance
// overflows at TWO. A ladder keyed on the seat count alone would have to be
// tuned for that worst case at every count, which would shrink the name at
// four players to pay for a hero that four-player blackjack does not have, and
// James's one hard constraint was that four players must not get worse.
//
// So the input is the screen's LOAD, in board-line equivalents: the seats, plus
// what else is on. The optional blocks are rounded UP to whole lines
// deliberately, because a band that is one line too roomy is a footer off the
// bottom and a band that is one line too tight is slightly smaller text.
// -------------------------------------------------------------------------

/**
 * The bands, roomiest first. `roomy` is the metrics the board shipped with, so
 * the common night is untouched by all of this.
 */
export type BoardBand = "roomy" | "close" | "tight" | "packed" | "full";

/** Roomiest to tightest. Exported so a test can assert the ladder is ordered. */
export const BOARD_BANDS: readonly BoardBand[] = [
  "roomy",
  "close",
  "tight",
  "packed",
  "full",
] as const;

/** The casino table maximum. Twelve seats is the most any of these packs takes. */
export const MAX_SEATS = 12;

/**
 * What else is on the screen, competing with the board for the same 1080px.
 * All optional: a blackjack TV with no house rules passes none of them and
 * gets the roomy band at four players, which is the point.
 */
export interface BoardLoad {
  /** A pack's own headline above the board. Craps' shooter panel, today. */
  hero?: boolean;
  /**
   * What the hero costs, in board lines, when it is not the two a shooter panel
   * costs. Ignored unless `hero` is set.
   *
   * HERO_LINES WAS A CONSTANT UNTIL POKER, and a constant was right while craps
   * was the only pack with one: its shooter panel is a fixed two lines whatever
   * the night is doing. Poker's hero is a settlement that GROWS with the table,
   * a headline plus up to four payment rows plus an overflow line, so a flat two
   * understated it by three lines at a full table and the ladder handed an eight
   * seat board a band that does not fit it. Measured by tv-fit: eight seats came
   * back 73px over on `tight`, which is the rung a flat two lands it on.
   */
  heroLines?: number;
  /** The balance warning row. */
  warning?: boolean;
  /** Any house-rule cards on the wall. */
  rules?: boolean;
}

/**
 * What each optional block costs, in board lines. Measured, not chosen.
 *
 * The ratio is not constant across the ladder, because the blocks shrink at
 * different rates from the lines do: the hero runs 1.7 lines at `roomy` and
 * 2.4 at `full`, the warning 0.7 to 1.1, the wall 0.5 to 1.7. These are the
 * values that hold at every rung once the ceilings below are set against them,
 * which is the property that actually matters. They fall out of the roomiest
 * band exactly: at `roomy` the board fits 4 players bare, 3 with a warning, 3
 * with a house rule and 2 with the shooter panel, which IS 2/1/1.
 */
const HERO_LINES = 2;
const WARNING_LINES = 1;
const RULES_LINES = 1;

/**
 * The highest load each band can carry and still land inside 1080px, measured.
 * Anything past the last ceiling is `full`, which is the floor of the ladder.
 *
 * FIVE RUNGS RATHER THAN THREE because the load runs to 16 (a full craps table
 * with the tracker on, a house rule up and a table that does not balance) and
 * one band stretched over 12 through 16 would have to be tuned for 16, which
 * means twelve players at a blackjack table would read at the size a craps
 * table needs. Rungs are cheap; a name smaller than it has to be is not.
 */
const CEILINGS: readonly (readonly [BoardBand, number])[] = [
  ["roomy", 4],
  ["close", 6],
  ["tight", 10],
  ["packed", 13],
];

/**
 * The band for a screen carrying `seats` players plus whatever else is on.
 *
 * PURE, and exported on its own rather than living as a ternary inside the
 * component, so the ladder can be tested without a browser: that a ladder
 * exists in CSS and is never applied is the silent failure here, and nothing
 * would error.
 *
 * Total by construction. Anything past the table maximum, and anything that is
 * not a number at all, clamps to the TIGHTEST band rather than falling off the
 * end: the failure mode of guessing tight is small text, and the failure mode
 * of guessing roomy is a board with no footer under it. The clamp is explicit
 * rather than a consequence of the ceilings, because the ladder was only
 * MEASURED out to twelve seats: past that no band is known to fit, so the
 * honest answer is the smallest one there is.
 */
export function moneyBoardBand(seats: number, load: BoardLoad = {}): BoardBand {
  if (!Number.isFinite(seats)) return "full";
  if (seats > MAX_SEATS) return "full";
  const total =
    Math.max(0, Math.floor(seats)) +
    (load.hero ? Math.max(0, Math.floor(load.heroLines ?? HERO_LINES)) : 0) +
    (load.warning ? WARNING_LINES : 0) +
    (load.rules ? RULES_LINES : 0);
  for (const [band, ceiling] of CEILINGS) {
    if (total <= ceiling) return band;
  }
  return "full";
}

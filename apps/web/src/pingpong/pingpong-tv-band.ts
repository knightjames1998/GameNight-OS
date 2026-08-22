// PING PONG'S TV DENSITY LADDER.
//
// A television cannot be scrolled, so anything past 1080px is not below the
// fold, it is GONE. This screen has not fitted one past SIX PLAYERS and never
// has: measured 1126px at seven, over by 46, in both themes, with the back
// button already 3px into the rail under Arcade and 17px under Tabletop. It has
// been logged in BUGS since 2026-08-02, found by the Tabletop stage 4 pilot.
//
// THE BACK BUTTON IS THE REAL MEASURE HERE, more than on any other screen in
// this app, and it is why this ladder is the one worth doing first. The page
// runs 46px over; the button runs off at the SAME seat count. Standing rule 4
// puts a way back on every screen including a TV, so a fit that lands the
// content and loses the control has not fixed anything.
//
// IT IS NOT band.ts AND IT IS NOT tv-band.ts. The first is the casino group's,
// the second is the bracket TV's. This screen is a now-playing box over one
// standings panel. Same shape, own numbers, own attribute.
//
// -------------------------------------------------------------------------
// MEASURED at 1920x1080 against the lowest painted pixel, Arcade, base metrics:
//
//     six players    1080 (back button clear by 63)   fits
//     seven players  1126 (back button 3px into rail) OVER by 46
//
// ONE PANEL, ONE LINE PER PLAYER, so this screen grows on exactly one axis and
// needs only one sub-ladder. That is why it is the cheapest of the five and why
// it is commit 4 rather than commit 8.
// -------------------------------------------------------------------------

/** The bands, roomiest first. Same vocabulary as the other two ladders. */
export type PpTvBand = "roomy" | "close" | "tight" | "packed";

/** Roomiest to tightest. Exported so a test can assert the ladder is ordered. */
export const PP_TV_BANDS: readonly PpTvBand[] = ["roomy", "close", "tight", "packed"] as const;

/**
 * THE TYPE FLOOR, and it is the same 2.2vmin the money board settled on
 * 2026-08-02 and both other TV ladders use. `--pp-tv-line` carries a player's
 * NAME and never goes below it. The brand, the section heading and the
 * now-playing label all may, because those are recognised rather than read.
 */
export const PP_TV_NAME_FLOOR_VMIN = 2.2;

/** The largest roster this ladder was MEASURED against. */
export const PP_TV_MEASURED_TO = 16;

/** What is being asked of the screen. */
export interface PpTvLoad {
  /** Players in the standings panel. The only axis this screen grows on. */
  players: number;
}

/**
 * Player ceilings, measured against the panel's budget at each band's line
 * height. Six was the old ceiling at base metrics and it is the roomy rung.
 */
const PLAYER_CEILINGS: readonly (readonly [PpTvBand, number])[] = [
  ["roomy", 6],
  ["close", 9],
  ["tight", 12],
];

const tightest = PP_TV_BANDS[PP_TV_BANDS.length - 1]!;

/**
 * The band for a Ping Pong TV carrying this load.
 *
 * PURE, and exported rather than inlined as a ternary, because the failure mode
 * of a ladder is that it exists in CSS and is never applied: nothing errors,
 * nothing logs, and the screen is as broken as it was before.
 *
 * TOTAL BY CONSTRUCTION. A roster past what was measured, and anything that is
 * not a number, clamps to the TIGHTEST band rather than walking off the end of
 * the ceilings into a band nobody has metrics for.
 */
export function pingPongTvBand(load: PpTvLoad): PpTvBand {
  const { players } = load;
  if (!Number.isFinite(players)) return tightest;
  const n = Math.max(0, Math.floor(players));
  if (n > PP_TV_MEASURED_TO) return tightest;
  for (const [band, ceiling] of PLAYER_CEILINGS) if (n <= ceiling) return band;
  return tightest;
}

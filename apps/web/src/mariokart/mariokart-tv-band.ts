// MARIO KART'S TV DENSITY LADDER.
//
// A television cannot be scrolled, so anything past 1080px is not below the
// fold, it is GONE. This screen has never fitted one past EIGHT racers, and it
// was never in the fit harness at all until 2026-08-16, which is the same gap
// Board Game had: a pack with a TV and no case is a pack whose fit nobody owns.
//
//     eight racers    879px  (back button clear by 201)  fits
//     twelve racers  1179px  (back button 67px into rail) OVER by 99
//     sixteen racers 1447px  (back button 334px into rail) OVER by 367
//
// The server's roster cap is sixteen, so both failing counts are reachable
// rather than theoretical.
//
// IT IS NOT THE KARTS, AND THAT WAS MEASURED RATHER THAN ASSUMED. The 08-16
// pairs session checked out the PREVIOUS commit's TV component and ran the same
// payloads through it: 1447px, identical to the digit, in every case. Two
// reasons, both structural and both still true:
//
//   - the PLAYERS panel is one line per RACER whether or not karts are shared,
//     so it is the tall column either way and it is the one this ladder is for.
//   - the KARTS panel REPLACES the Racers panel rather than sitting beside it,
//     and karts are never more numerous than racers, so a pairs night is
//     bounded by what a solo night already measured at.
//
// So the kart work added zero pixels, and this ladder is about the roster.
//
// -------------------------------------------------------------------------
// TWO PANELS SIDE BY SIDE, so the screen costs max(left, right):
//
//   PLAYERS    one line per racer, UNCAPPED. Grows to the server's 16.
//   RACERS or  capped at 8 by the component (.slice(0, 8)), so it stops
//   KARTS      growing while the Players panel keeps going. It can never be
//              the binding column past eight, which is why the load below is
//              the roster and the cap is only there to be honest about it.
// -------------------------------------------------------------------------

/** The bands, roomiest first. Same vocabulary as every other ladder here. */
export type MkTvBand = "roomy" | "close" | "tight" | "packed";

/** Roomiest to tightest. Exported so a test can assert the ladder is ordered. */
export const MK_TV_BANDS: readonly MkTvBand[] = ["roomy", "close", "tight", "packed"] as const;

/**
 * THE TYPE FLOOR, 2.2vmin, the money board's and every other TV ladder's.
 * `--mk-tv-line` carries a racer's NAME and never goes below it. The brand, the
 * panel headings and the "(character)" tail all may, because those are
 * recognised rather than read.
 */
export const MK_TV_NAME_FLOOR_VMIN = 2.2;

/** The largest roster this ladder was MEASURED against, and the server's cap. */
export const MK_TV_MEASURED_TO = 16;

/** How many rows the Racers / Karts panel draws. The component's own cap. */
export const MK_TV_SIDE_SLICE = 8;

/** What is being asked of the screen. */
export interface MkTvLoad {
  /** Lines in the Players panel: one per racer. The axis that actually grows. */
  players: number;
  /** Lines in the Racers or Karts panel. Capped at MK_TV_SIDE_SLICE by the view. */
  sides: number;
}

/**
 * Line ceilings, measured against the panel budget at each band's line height.
 * Eight fitted at base metrics with 201px to spare, so it is the roomy rung.
 */
const LINE_CEILINGS: readonly (readonly [MkTvBand, number])[] = [
  ["roomy", 8],
  ["close", 11],
  ["tight", 14],
];

const tightest = MK_TV_BANDS[MK_TV_BANDS.length - 1]!;

/**
 * The band for a Mario Kart TV carrying this load.
 *
 * PURE, and exported rather than inlined, because a ladder's failure mode is
 * that it exists in CSS and is never applied.
 *
 * TOTAL BY CONSTRUCTION: past what was measured, or handed something that is
 * not a number, it clamps to the TIGHTEST band.
 */
export function marioKartTvBand(load: MkTvLoad): MkTvBand {
  const { players, sides } = load;
  if (!Number.isFinite(players) || !Number.isFinite(sides)) return tightest;
  // The side panel is capped by the view, so cost it AT the cap rather than at
  // its raw length: costing it raw would let a sixteen-kart payload tighten a
  // screen that draws eight of them. Same rule tv-band.ts applies to its deck.
  const shown = Math.min(Math.max(0, Math.floor(sides)), MK_TV_SIDE_SLICE);
  const n = Math.max(Math.max(0, Math.floor(players)), shown);
  if (n > MK_TV_MEASURED_TO) return tightest;
  for (const [band, ceiling] of LINE_CEILINGS) if (n <= ceiling) return band;
  return tightest;
}

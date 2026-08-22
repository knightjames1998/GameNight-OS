// THE TITLE-NIGHT TV'S DENSITY LADDER, shared by BOARD GAME and CARD TABLE.
//
// A television cannot be scrolled, so anything past 1080px is not below the
// fold, it is GONE. This screen has not fitted one at twelve players since
// Board Game shipped a TV on 2026-08-04, and it was logged in BUGS on 08-09,
// the day anything first measured it. BOTH packs seat twelve, so this is
// reachable rather than theoretical.
//
// ONE LADDER FOR TWO PACKS, which is the whole reason this was deferred rather
// than done twice: the two packs became ONE TV component in the 2026-08-09
// screens extraction, so a ladder built for Board Game and copied to Card Table
// would have been the same file twice, drifting from the day after.
//
// THE TWO PACKS ARE NOT THE SAME HEIGHT, and that was MEASURED on 2026-08-22
// rather than assumed. BUGS had said since 08-09 that this is one bug on two
// packs, and only Board Game had ever been measured at the failing count:
//
//     Board Game at 12    1256 Arcade,  1236 Tabletop   (over by 176 / 156)
//     Card Table at 12    1256 Arcade,  1256 Tabletop   (over by 176 / 176)
//
// Same component, DIFFERENT TOKENS on it, so under Tabletop the two differ by
// 20px and "same layout" was an assumption that a second measurement broke.
// THE LADDER IS TUNED AGAINST THE TALLER OF THE TWO, which is Card Table's, not
// Board Game's. Tuning against Board Game would have landed one pack and left
// the other 20px over, which is the failure this file's own history is full of.
//
// -------------------------------------------------------------------------
// TWO PANELS SIDE BY SIDE, so the screen costs max(left, right) rather than
// left + right, and both grow with the roster: the standings panel is one line
// per player, and the last-result panel is one line per player in that game. So
// the load is the LARGER of the two, and one sub-ladder serves both because
// their rows are the same `.tn-tv__line`.
// -------------------------------------------------------------------------

/** The bands, roomiest first. Same vocabulary as every other ladder here. */
export type TnTvBand = "roomy" | "close" | "tight" | "packed";

/** Roomiest to tightest. Exported so a test can assert the ladder is ordered. */
export const TN_TV_BANDS: readonly TnTvBand[] = ["roomy", "close", "tight", "packed"] as const;

/**
 * THE TYPE FLOOR, 2.2vmin, the money board's and every other TV ladder's.
 * `--tn-tv-line` carries a player's NAME and never goes below it. The brand,
 * the panel headings and the "on the table" label all may, because those are
 * recognised rather than read.
 */
export const TN_TV_NAME_FLOOR_VMIN = 2.2;

/** The largest roster this ladder was MEASURED against. Both packs seat 12. */
export const TN_TV_MEASURED_TO = 16;

/** What is being asked of the screen. */
export interface TnTvLoad {
  /** Lines in the standings panel: one per player with a record. */
  players: number;
  /** Lines in the last-result panel: one per player in that game. */
  lastLines: number;
}

/**
 * Line ceilings, measured against the panel budget at each band's line height.
 * Eight was already comfortable at base metrics (958 Arcade) and twelve was
 * 176px over, so the rungs are placed to land twelve at `tight` and leave
 * `packed` as the floor for a payload past the seat cap.
 */
const LINE_CEILINGS: readonly (readonly [TnTvBand, number])[] = [
  ["roomy", 6],
  ["close", 9],
  ["tight", 12],
];

const tightest = TN_TV_BANDS[TN_TV_BANDS.length - 1]!;

/**
 * The band for a title-night TV carrying this load.
 *
 * PURE, and exported rather than inlined, because a ladder's failure mode is
 * that it exists in CSS and is never applied: nothing errors and the screen is
 * exactly as broken as before.
 *
 * TOTAL BY CONSTRUCTION. Past what was measured, or handed something that is
 * not a number, it clamps to the TIGHTEST band rather than walking off the end
 * of the ceilings into a band nobody has metrics for.
 */
export function titleNightTvBand(load: TnTvLoad): TnTvBand {
  const { players, lastLines } = load;
  if (!Number.isFinite(players) || !Number.isFinite(lastLines)) return tightest;
  // THE LARGER OF THE TWO PANELS, because they sit side by side and the screen
  // costs whichever is taller. Summing them would tighten the screen for height
  // it never spends.
  const n = Math.max(Math.max(0, Math.floor(players)), Math.max(0, Math.floor(lastLines)));
  if (n > TN_TV_MEASURED_TO) return tightest;
  for (const [band, ceiling] of LINE_CEILINGS) if (n <= ceiling) return band;
  return tightest;
}

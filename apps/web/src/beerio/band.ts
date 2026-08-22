// BEERIO KART'S TV DENSITY LADDER.
//
// Same shape as the money board's (apps/web/src/casino/band.ts): compute a BAND
// from what is being asked of the screen, put it on the element as a data
// attribute, and let CSS override the metrics. Nothing here knows about pixels.
//
// IT IS NOT band.ts AND CANNOT BE. Beerio Kart is permanently exempt from the
// casino group's fit metrics (standing rule, BACKLOG), it is sized in vw rather
// than vmin, and its blocks are a wordmark, prediction bars and racer chips
// rather than money lines. Same shape, own file, own numbers.
//
// THIS FILE IS OURS. BeerioApp.tsx and beerio.ts are a vendored 1:1 port and are
// never edited; BeerioTvPage.tsx says in its own header that it is not part of
// that port, and this ladder belongs to the TV page rather than to the engine.
//
// -------------------------------------------------------------------------
// WHAT THE MEASUREMENTS SAID, at 1920x1080 on the real bundle, base metrics:
//
//     fixed chrome (padding, header, strip, headings)   561px
//     therefore a column has                            519px  (48% of the TV)
//     one Up next card WITH prediction bars              253px
//     the prediction bars alone, per card                 90px
//     the alive board at  4 /  8 / 12 / 16 racers    373 / 535 / 777 / 1182px
//
// THE HEADER IS ON THE LADDER, which is the thing this screen needed that the
// shell's did not. 561px of chrome on a 1080px screen is more than half the
// television spent before a single racer is drawn, and most of it is the
// BEERIO KART wordmark at 5.5vw with a QR beside it. The money board already
// shrinks `.cg-tv__brand` per band for exactly this reason, so it is a rung
// rather than a new idea.
//
// THE BOARD'S CLIFF IS THE CHIP WRAP, not the type. At sixteen racers with the
// longest name the pack allows (24 characters), a base-metrics chip is wider
// than half the column, so the flex row wraps to ONE chip per line and the
// board doubles. Getting two per line back is worth more than any font change,
// and it is why the tight band spends horizontal padding hard.
//
// PREDICTION BARS ARE A REAL BLOCK, NOT A GARNISH, for fit purposes: they are
// 90px on every on-deck card, and they are up on exactly the nights people are
// watching. A ladder tuned against a card with no votes would be wrong when it
// matters most.
// -------------------------------------------------------------------------

/** The bands, roomiest first. */
export type BeerioTvBand = "roomy" | "close" | "tight" | "packed";

/** Roomiest to tightest. Exported so a test can assert the ladder is ordered. */
export const BEERIO_TV_BANDS: readonly BeerioTvBand[] = [
  "roomy",
  "close",
  "tight",
  "packed",
] as const;

/**
 * THE TYPE FLOOR, in this screen's own unit.
 *
 * 1.25vw is 24px on a 1920x1080 television, which is the same physical size as
 * the shell bracket TV's 2.2vmin floor and therefore the same size the casino
 * money board's tightest band puts a player's name at. One floor across three
 * screens, set by measurement in the money-board session and reused rather than
 * re-argued.
 *
 * NO BAND MAY PUT A RACER'S NAME BELOW IT, on an Up next card or on a chip.
 * Round titles, vote counts and group labels may go smaller: they are
 * recognised from a couch rather than read.
 */
export const BEERIO_NAME_FLOOR_VW = 1.25;

/**
 * The Up next slice per band. It was 4 at every load and four cards with
 * prediction bars is 1069px into a 519px column, so the cheapest lever gets
 * spent first here too.
 */
export const BEERIO_DECK_SLICE: Readonly<Record<BeerioTvBand, number>> = {
  roomy: 4,
  close: 4,
  tight: 4,
  packed: 3,
};

/**
 * The QR code's pixel size per band. It is a React prop on <QRCodeSVG> rather
 * than a CSS property, so the ladder has to hand it over explicitly; a CSS
 * override cannot reach it. 96px still scans from across a room, which was
 * checked on the rendered page rather than assumed.
 */
export const BEERIO_QR_PX: Readonly<Record<BeerioTvBand, number>> = {
  roomy: 120,
  close: 108,
  tight: 96,
  packed: 96,
};

/** Beerio's MAX_PLAYERS, and the largest roster this ladder was measured to. */
export const BEERIO_MAX_RACERS = 16;

/**
 * What the prediction bars cost, in Up next card equivalents. 90px against a
 * 163px bare card is more than half, rounded UP to a whole one: a band one step
 * too roomy is content off the bottom of a television, one step too tight is
 * slightly smaller text.
 */
const PREDICTION_CARDS = 1;

export interface BeerioTvLoad {
  /** Racers with a name typed in. Drives the alive board. */
  entrants: number;
  /** Matchups ready to race. Only ever costs up to the band's slice. */
  ready: number;
  /** Anybody has voted, so the on-deck cards carry their crowd bars. */
  predictions?: boolean;
}

/** Racer ceilings for the alive board, measured against three populated groups. */
const BOARD_CEILINGS: readonly (readonly [BeerioTvBand, number])[] = [
  ["roomy", 6],
  ["close", 10],
  ["tight", BEERIO_MAX_RACERS],
];

/** Card-equivalent ceilings for the Up next column. */
const DECK_CEILINGS: readonly (readonly [BeerioTvBand, number])[] = [
  ["roomy", 3],
  ["close", 4],
  ["tight", 5],
];

const rung = (b: BeerioTvBand) => BEERIO_TV_BANDS.indexOf(b);
const tightest = BEERIO_TV_BANDS[BEERIO_TV_BANDS.length - 1]!;
const tighter = (a: BeerioTvBand, b: BeerioTvBand): BeerioTvBand =>
  rung(a) >= rung(b) ? a : b;

function pick(
  ceilings: readonly (readonly [BeerioTvBand, number])[],
  total: number,
): BeerioTvBand {
  for (const [band, ceiling] of ceilings) if (total <= ceiling) return band;
  return tightest;
}

/**
 * The band for a Beerio bracket TV carrying this load.
 *
 * PURE and exported, for the same reason the money board's is: the silent
 * failure is a ladder that exists in CSS and is never applied, which throws
 * nothing and renders the screen exactly as broken as before.
 *
 * TOTAL BY CONSTRUCTION. Past MAX_PLAYERS, and for anything that is not a
 * number, the answer is the tightest band there is rather than a walk off the
 * end of the ceilings. The pack caps its own roster at sixteen so past-the-end
 * is not reachable through the app, which is exactly why it must not be the
 * case nobody thought about.
 */
export function beerioTvBand(load: BeerioTvLoad): BeerioTvBand {
  const { entrants, ready, predictions } = load;
  if (!Number.isFinite(entrants) || !Number.isFinite(ready)) return tightest;
  if (entrants > BEERIO_MAX_RACERS) return tightest;

  const board = pick(BOARD_CEILINGS, Math.max(0, Math.floor(entrants)));
  // Costed at the ROOMIEST slice: it is the most the column can ask for, and
  // asking the band's own slice first would be circular.
  const shown = Math.min(Math.max(0, Math.floor(ready)), BEERIO_DECK_SLICE.roomy);
  const deck = pick(DECK_CEILINGS, shown + (predictions ? PREDICTION_CARDS : 0));
  return tighter(board, deck);
}


// ---------- GRAND PRIX ----------
//
// THE OTHER HALF OF /beerio/tv/:code, AND IT HAD NO LADDER AT ALL. `GpBoard`
// rendered Shell and Header at band="roomy" HARDCODED while the bracket board
// in the same file computed a band per payload, and the route had no fit case
// either: scripts/tv-fit.mjs only ever ran this address with format.mode
// "bracket". A screen with no case has no owner, and this one was the worst
// example in the app.
//
// MEASURED 2026-08-22, the first time anything measured it at all:
//
//     four racers    1148px  OVER by 68
//     eight racers   1717px  OVER by 637
//     twelve racers  2286px  OVER by 1206
//
// IT HAS NEVER FITTED A TELEVISION AT ANY COUNT. BUGS recorded only the twelve,
// found on 2026-08-19 from a photo of a real screen; measuring four and eight
// found the other two. That is the largest gap of the five overflows this
// session covers, and the only one with nothing to tighten.
//
// A GP ROW IS TALLER THAN A BRACKET CHIP and there is one per racer with no
// cap, so this grows on exactly one axis: the roster. Beerio's own MAX_PLAYERS
// is 16.

/** What a Grand Prix board is being asked to draw. */
export interface BeerioGpLoad {
  /** Racers in the standings. One row each, uncapped. */
  racers: number;
  /** The next-race prediction bar is up, which costs a block above the board. */
  predictions: boolean;
}

/**
 * Racer ceilings for the standings board, measured at each band's row height.
 * FOUR IS THE ROOMY RUNG AND IT STILL HAD TO MOVE: the base metrics were 68px
 * over at four racers, so even the roomiest rung here is tighter than what
 * shipped. That is unusual for a ladder in this repo and it is the honest
 * consequence of a screen that never fitted at any count.
 */
const GP_CEILINGS: readonly (readonly [BeerioTvBand, number])[] = [
  ["roomy", 4],
  ["close", 6],
  // `tight` and `packed` are also where the board goes TWO COLUMNS (see
  // --bt-gp-cols in beerio.css), which is what makes the counts above eight
  // reachable at all: a GP row carries a name and cannot shrink past this
  // pack's 1.25vw floor, and sixteen single-column rows at that floor do not
  // fit 1080p however tight the padding gets.
  ["tight", 12],
];

/** What the prediction bar costs, in racer-row equivalents. Rounded UP. */
const GP_PREDICTION_ROWS = 2;

/**
 * The band for a Grand Prix board carrying this load.
 *
 * PURE and exported for the same reason every other ladder here is: a ladder
 * that exists in CSS and is never applied throws nothing and logs nothing.
 * That is not hypothetical on this screen, it is precisely what band="roomy"
 * hardcoded in the component was.
 */
export function beerioGpBand(load: BeerioGpLoad): BeerioTvBand {
  const { racers, predictions } = load;
  if (!Number.isFinite(racers)) return tightest;
  const n = Math.max(0, Math.floor(racers));
  if (n > BEERIO_MAX_RACERS) return tightest;
  return pick(GP_CEILINGS, n + (predictions ? GP_PREDICTION_ROWS : 0));
}

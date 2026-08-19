// WHAT THE CROWD SAID, as the label row says it.
//
// THE PROBLEM THIS EXISTS TO KILL. The percentage used to be painted INSIDE
// each bar segment, in --ink, on the racer's own colour. Measured against the
// palette that actually ships (PALETTE, BeerioApp.tsx:156, 32 colours), ink on
// the fill clears 4.5:1 on only 17 of them: fifteen fail, and nine of the
// sixteen colours the app AUTO-ASSIGNS fail. That is not a number that can be
// tuned. Even the best possible per-segment switch, picking whichever of white
// or ink scores higher on each colour, still leaves #F50057 at 4.18 and
// #536DFE at 4.21, so a switch has a ceiling below the floor and cannot be a
// complete fix either.
//
// So the text leaves the bar. The bar becomes pure shape, and the signal moves
// up to the label row, which sits on --foam where contrast was never in
// question. TWO MORE REASONS, both independent of colour, in case the palette
// is ever re-picked and somebody reads the contrast note as the only obstacle:
// a segment narrower than its own text overflows into its neighbour, and at one
// vote every segment reads 100%, which is a number that says nothing the bar
// has not already said.
//
// THIS FILE IS OURS, in the same sense band.ts and racer.ts are: a new module
// beside the vendored port rather than an edit to its internals. BeerioTvPage
// is GameNight's own TV view for the pack, not part of the 1:1 replica.

/** One option's share of the vote, already rounded for display. */
export interface CrowdShare {
  label: string;
  pct: number;
  /** The racer's own colour, so the ROW can carry the colour coding the bar
   *  used to carry by having the number painted on the fill. See below. */
  color: string;
}

/**
 * What the right-hand side of the label row says.
 *
 * `agreed` is the case a percentage cannot improve on: everyone who voted
 * picked the same option, so the bar is one solid colour and the only news is
 * how many people said so. That is the copy the screen has always shown and it
 * is kept exactly.
 */
export type CrowdSplit =
  | { kind: "agreed"; total: number }
  | { kind: "split"; shares: CrowdShare[]; overflow: number };

/** At most this many shares on the row. See THE ROW NEVER WRAPS below. */
export const MAX_SHARES = 3;

/**
 * Turn the raw tally into the label row's model.
 *
 * THE ROW NEVER WRAPS, and that is a fit rule rather than a typography
 * preference. The Grand Prix board passes one option per racer and seats
 * twelve, with names long enough that the fit harness uses them as its worst
 * case, so an uncapped row would wrap, the row would get taller, and a taller
 * row on this screen is a fit regression. The cap is half of the enforcement
 * and `nowrap` plus an ellipsis in beerio.css is the other half: the cap keeps
 * the row sensible, the CSS keeps a pathological name from beating it.
 *
 * ROUNDED INDEPENDENTLY, AND DELIBERATELY NOT RECONCILED TO 100. An even
 * three-way split reads 33% / 33% / 33% and sums to 99, and that is correct
 * here. The alternative is largest-remainder, which would print 34% / 33% / 33%
 * and show two identical vote counts as two different numbers on a screen a
 * room is looking at, which reads as a bug. The sum is not an invariant anyway
 * once the cap is in play: three shares out of twelve options never summed to
 * 100 and were never going to.
 *
 * Zero-vote options are dropped rather than shown at 0%. Ties keep the caller's
 * order, because Array.sort is stable and the caller's order is the board's
 * order: reordering equal shares away from the order the racers are drawn in
 * would be motion for no information.
 *
 * EVERY SHARE CARRIES ITS COLOUR, and that is not decoration. The row is sorted
 * by SHARE and the bar is drawn in BOARD order, so on any lopsided card the two
 * disagree: a 2-1 card lists the leader first and paints the trailer's colour on
 * the left. While the percentage sat inside the segment that did not matter,
 * because the number was on the fill it described. Taking the text out of the
 * bar cut that tie, and the fix is a swatch beside each name rather than
 * re-ordering either one: sorting the bar by share would make segments swap
 * sides as votes land, and board order is what the match rows and the alive
 * board above it already use.
 */
export function crowdSplit(
  options: { label: string; value: string; color: string }[],
  counts: Record<string, number>,
): CrowdSplit {
  const voted = options
    .map((o) => ({ label: o.label, color: o.color, n: counts[o.value] ?? 0 }))
    .filter((o) => o.n > 0);
  const total = voted.reduce((n, o) => n + o.n, 0);

  // One option holding every vote, and the no-votes case, which the component
  // never renders (PredictionBar returns null at zero) but which this answers
  // rather than leaving to a caller to remember.
  if (voted.length <= 1) return { kind: "agreed", total };

  const ranked = [...voted].sort((a, b) => b.n - a.n);
  return {
    kind: "split",
    shares: ranked.slice(0, MAX_SHARES).map((o) => ({
      label: o.label,
      pct: Math.round((o.n / total) * 100),
      color: o.color,
    })),
    overflow: Math.max(0, ranked.length - MAX_SHARES),
  };
}

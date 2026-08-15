// ONE ANSWER TO "WHAT IS THIS RACER CALLED".
//
// THE PROBLEM THIS EXISTS TO KILL. The rule "a racer with no typed name is
// called Racer N" was written out by hand at eighteen sites across BeerioApp.tsx
// and BeerioTvPage.tsx, and those two files carry TWO DIFFERENT THINGS BOTH
// NAMED `seed`:
//
//   Player.seed       1-based. Built at BeerioApp.tsx:320 as `seed: i + 1`.
//                     Every bracket slot, champion and runner-up carries it.
//   GPStanding.seed   0-based. Built at BeerioApp.tsx:218 as an array index.
//                     So is every `names[...]` lookup and every map index.
//
// Both are legitimate and neither is going to change. What is not legitimate is
// that the display rule had to be re-derived from scratch at every site, and at
// four of them it was derived wrong: the champion chip, the champion modal, the
// runner-up chip and the TV's champion headline all render `Racer ${seed + 1}`
// for a 1-based Player, so a racer who never typed a name is called Racer 4 by
// the champion panel and Racer 3 by the bracket beside it. Nothing errors,
// nothing looks broken, and the two screens in one room simply disagree.
//
// THE SIGNATURE IS 1-BASED, DELIBERATELY. It is what a person reading a screen
// sees ("Racer 3" is the third racer), and it is what Player.seed already
// holds, so the bracket sites pass their seed straight through. The 0-based
// sites pass `index + 1`, which is then a BASE CONVERSION at the boundary
// rather than a display fudge buried in a template, and it reads as one.
//
// THIS FILE IS OURS, in the same sense band.ts is: it is a new module beside the
// vendored port rather than an edit to its internals, and BeerioTvPage.tsx
// already imports from both.

/**
 * What to call the racer at 1-based position `seed`.
 *
 * A name that is missing, null, empty or nothing but whitespace falls back to
 * the position. Empty and whitespace matter: the bracket engine stores an
 * untyped name as null, but the raw `names` array a Grand Prix and the TV read
 * from holds whatever was in the input box, which is "" before anybody types
 * and " " if they type a space and stop.
 */
export function racerLabel(seed: number, name?: string | null): string {
  return name?.trim() || `Racer ${seed}`;
}

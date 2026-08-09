// Every theme's text stays readable, and every theme is fully declared.
//
// WHY THIS IS A TEST AND NOT A REVIEW NOTE. A palette is the one kind of change
// where "looks fine to me" is actively misleading: the person checking it is
// looking at a calibrated laptop in a lit room, and the app is used on a phone
// at a game night and on a television across a room. Contrast is a number, so
// it belongs somewhere that fails a build rather than somewhere that depends on
// who is looking.
//
// It also catches the thing a screenshot never would. A second theme is a block
// of token overrides, and the failure mode of a block of token overrides is not
// a bad colour, it is a MISSING one: forget --gn-faint and Tabletop silently
// inherits Arcade's plum-grey onto walnut, which looks like a slightly odd
// colour rather than like a bug. The completeness test below is the one that
// would have caught that, and it is why it checks the token NAMES and not just
// the contrasts.
//
// THE NUMBERS ARE PARITY NUMBERS, NOT WCAG MINIMUMS. AA (4.5) is the floor and
// every pair clears it, but the real assertion is that Tabletop sits within a
// tolerance of Arcade for the SAME pair. A theme that is legible but noticeably
// flatter than the one it replaces is a regression that passes a WCAG check.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CSS = readFileSync(path.join(ROOT, "apps/web/src/index.css"), "utf8");
const HTML = readFileSync(path.join(ROOT, "apps/web/index.html"), "utf8");

// ---------------------------------------------------------------- colour

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

// ------------------------------------------------------------ the themes

/**
 * Parse a token block out of index.css. The stylesheet is the source of truth;
 * copying the values into this file would just create a second place to be
 * wrong, and the values here would keep passing after the real ones drifted.
 */
/** Comments blanked first, so a brace inside one cannot end a block early. */
const CSS_BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

function tokens(selector: string): Record<string, string> {
  const at = CSS_BARE.indexOf(selector + " {");
  assert.notEqual(at, -1, `no ${selector} block in index.css`);
  const open = CSS_BARE.indexOf("{", at);
  const close = CSS_BARE.indexOf("}", open);
  const body = CSS_BARE.slice(open + 1, close);
  const out: Record<string, string> = {};
  // EVERY token, not only the colours. Since stage 3 a theme also owns what a
  // surface is made of (its texture, glow, bevel, radius and display face), and
  // those are the tokens most likely to be forgotten because a missing one
  // looks like a design choice rather than a bug. The value runs to the
  // semicolon so multi-line values (the texture is two gradients) survive.
  for (const m of body.matchAll(/(--gn-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]!] = m[2]!.replace(/\s+/g, " ").trim();
  }
  return out;
}

/** Colour tokens are the ones the contrast maths can actually read. */
const isColour = (v: string) => /^#[0-9a-fA-F]{3,8}$/.test(v);

/**
 * A SURFACE MAY BE TRANSLUCENT NOW, AND COMPARING TWO SOLID COLOURS WOULD MISS
 * IT ENTIRELY. Tabletop's card material is `rgba(0,0,0,.5)`: a darkening of
 * whatever it is laid on, so that the weave and the lamp carry through and the
 * card belongs to the table instead of sitting on it like a plastic tile. What
 * a person reads text against is therefore a COMPOSITE, and this file would
 * happily go on passing against the flat token forever.
 *
 * THE BASE IS THE CROWN, NOT THE FELT, because the felt is not uniform: it is
 * brightest directly under the lamp, so a card near the top of a page sits on a
 * lighter background than one at the foot of a long list, and the lighter one is
 * the worse case for every text colour in this theme. Measuring against the
 * crown measures the card that is hardest to read.
 */
const rgba = (v: string) => v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/);
const toHex = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const composite = (fg: number[], alpha: number, bg: number[]) => fg.map((v, i) => v * alpha + bg[i]! * (1 - alpha));

/** The lamp at the strength index.css paints it, over the theme's own felt. */
function crown(theme: Record<string, string>): number[] {
  return composite(hexToRgb(value(theme, "--gn-felt-lit")), 0.85, hexToRgb(value(theme, "--gn-felt")));
}

/** A token as an opaque colour: itself, or its composite over the crown. */
function solid(theme: Record<string, string>, token: string): string {
  const v = value(theme, token);
  const m = rgba(v);
  if (!m) return v;
  return toHex(composite([+m[1]!, +m[2]!, +m[3]!], m[4] === undefined ? 1 : +m[4]!, crown(theme)));
}

const ARCADE = tokens(":root");
const TABLETOP = tokens(':root[data-theme="tabletop"]');

/** Resolve a token for a theme, falling back to Arcade the way the cascade does. */
const value = (theme: Record<string, string>, token: string) => theme[token] ?? ARCADE[token]!;

// ---------------------------------------------------------------- the packs
//
// A pack keeps its own tokens in its own stylesheet, on its own roots, because
// identity belongs to the pack and so does its re-treatment (DECISION LOG,
// stage 4). Ping Pong is the pilot and the only converted pack; each one that
// follows adds an entry here and a PACK_PAIRS block below.
const PP_CSS = readFileSync(path.join(ROOT, "apps/web/src/pingpong/pingpong.css"), "utf8");

function packTokens(css: string, selectorStart: string): Record<string, string> {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const at = bare.indexOf(selectorStart);
  assert.notEqual(at, -1, `no block starting "${selectorStart}" in the pack stylesheet`);
  const open = bare.indexOf("{", at);
  const close = bare.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const m of bare.slice(open + 1, close).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]!] = m[2]!.replace(/\s+/g, " ").trim();
  }
  return out;
}

const PP_ARCADE = packTokens(PP_CSS, ".pp-root,");
const PP_TABLETOP = packTokens(PP_CSS, ':root[data-theme="tabletop"] .pp-root,');

/**
 * Pairs that have to stay readable, as [foreground, background, floor?]. Text
 * against the two surfaces it actually sits on, and every -ink against the fill
 * it is printed on. The floor is WCAG AA (4.5) unless a pair says otherwise,
 * and a pair that says otherwise has to say why in a comment.
 */
const PAIRS: [string, string, number?][] = [
  ["--gn-ink", "--gn-bg"],
  ["--gn-ink", "--gn-surf"],
  ["--gn-dim", "--gn-bg"],
  ["--gn-dim", "--gn-surf"],
  ["--gn-place", "--gn-surf"],
  // 3.0, AND THIS IS A PRE-EXISTING ARCADE VALUE, NOT A TABLETOP CONCESSION.
  // --gn-faint has measured 4.33 against --gn-surf since it was named in stage
  // 1, and it was that colour (#8a7ca2, hardcoded in six places) for a long
  // time before that. Tabletop matches it at 4.37, which is marginally better.
  // It is the third text level, used for empty bracket slots and seed numbers,
  // which its own comment in index.css describes as "present but not read".
  // Raising it above 4.5 is a real improvement and a change to a SHIPPED Arcade
  // colour, so it is James's call and its own commit, not something a palette
  // session slips in. The floor is set here rather than the assertion softened
  // globally so that exactly one pair is exempt and it is obvious which.
  ["--gn-faint", "--gn-surf", 3.0],
  ["--gn-p1", "--gn-surf"],
  ["--gn-p2", "--gn-surf"],
  ["--gn-gold", "--gn-surf"],
  ["--gn-danger", "--gn-surf"],
  ["--gn-danger-hover", "--gn-surf"],
  ["--gn-yes", "--gn-surf"],
  ["--gn-no", "--gn-surf"],
  ["--gn-act", "--gn-surf"],
  ["--gn-act-ink", "--gn-surf"],
  ["--gn-p1-tint-ink", "--gn-surf"],
  // Each -ink on the fill it is printed on, not on the page background.
  ["--gn-p1-ink", "--gn-p1"],
  ["--gn-p2-ink", "--gn-p2"],
  ["--gn-yes-ink", "--gn-yes"],
];

/**
 * THE CLOTH. Since 2026-08-03 the shell paints a felt surface of its own rather
 * than the page's --gn-bg, so this is where the shell's body text actually
 * lands under Tabletop, and these pairs have to clear AA like any other.
 *
 * ONLY INK AND DIM, and the two that are missing are missing on purpose:
 * --gn-place is `.gn-input::placeholder` and --gn-faint is bracket slots and
 * seed numbers, and all of those sit inside an input or a card, which paints
 * ABOVE the texture layer (`.gn-app::before` is z-index 0, `.gn-app > *` is 1).
 * Asserting a pair that is never rendered on cloth sets the palette from a
 * screen nobody sees, and that mistake is not free in either direction: the
 * same list, applied to the tile generator, is what capped the weave's
 * amplitude until it was invisible.
 *
 * THEY ARE HELD APART FROM PAIRS BECAUSE PARITY DOES NOT APPLY. Arcade has no
 * cloth, so its --gn-felt is simply its background, and comparing "ink on the
 * plum page" with "ink on a green table" is comparing two different objects:
 * the gap is 6 points and every point of it is the table being a table. The AA
 * floor is the assertion that matters here; the parity assertion would only be
 * measuring that Tabletop grew a surface Arcade does not have.
 *
 * --gn-felt-lit is the crown at full strength, which is stricter than what the
 * screen paints (the lamp is laid at 85% and its centre sits above the top
 * edge), so passing here means passing everywhere on the cloth.
 */
const CLOTH_PAIRS: [string, string][] = [
  ["--gn-ink", "--gn-felt"],
  ["--gn-dim", "--gn-felt"],
  ["--gn-ink", "--gn-felt-lit"],
  ["--gn-dim", "--gn-felt-lit"],
];

const THEME_BLOCKS: [string, Record<string, string>][] = [
  ["arcade", ARCADE],
  ["tabletop", TABLETOP],
];

test("every theme clears WCAG AA on the pairs that carry text", () => {
  const failures: string[] = [];
  for (const [name, theme] of THEME_BLOCKS) {
    for (const [fg, bg, floor = 4.5] of [...PAIRS, ...CLOTH_PAIRS] as [string, string, number?][]) {
      const ratio = contrast(solid(theme, fg), solid(theme, bg));
      if (ratio < floor) failures.push(`${name}: ${fg} on ${bg} = ${ratio} (needs ${floor})`);
    }
  }
  assert.deepEqual(failures, [], "contrast below the floor:\n  " + failures.join("\n  "));
});

test("TABLETOP HOLDS CONTRAST PARITY WITH ARCADE, pair for pair", () => {
  // 2.0 is deliberately loose enough that a palette gets to be its own palette
  // and tight enough that a whole step of legibility cannot go missing. Felt
  // green is the widest gap in the shipped set at 1.26 below Arcade's teal,
  // which is the known, accepted cost of a green that is actually green.
  const TOLERANCE = 2.0;
  // AND A PROPORTIONAL ESCAPE FOR THE PAIRS SITTING VERY HIGH. Two points off a
  // pair at 4.6 is the difference between readable and not; two points off one
  // at 11.3 is invisible to anybody. A flat tolerance treats those as the same
  // event, and it started firing the day the card became translucent: --gn-p2
  // and --gn-gold went 9.97 to 7.64 and 11.26 to 9.01, both still nearly
  // double AA. So a pair has to breach BOTH the flat tolerance and a quarter of
  // its own Arcade value. This can only ever be more permissive than the flat
  // rule for pairs above 8, and the AA test below is what stops it becoming a
  // licence: nothing may cross the floor whatever this says.
  //
  // ONLY LOSSES COUNT. The stated job is that "a whole step of legibility
  // cannot go missing", and a pair that got MORE readable has not lost
  // anything. Lifting --gn-p1 for the lighter card took --gn-p1-ink on
  // --gn-p1 from 6.21 to 8.62, and failing a build over that is the test
  // working in the wrong direction.
  //
  // AND ONE NAMED EXEMPTION LIST, RATHER THAN A WIDER TOLERANCE. Tabletop's
  // card is rgba(0,0,0,.24), a darkening of lit cloth instead of an opaque
  // walnut panel, and it is a good deal lighter than the panel it replaced, so
  // every accent printed on a card loses ground. That is a real parity
  // regression by this test's own definition and it is an ACCEPTED one (James,
  // on the alpha): the material is the point, and the AA test above still holds
  // the floor for every pair here. It is written out pair by pair with the
  // numbers, exactly as --gn-faint's 3.0 floor is, so the cost is on the page
  // and so a tenth pair cannot join the list without somebody adding a line.
  // If the alpha ever goes back up, these come off.
  const CARD_COST = new Map([
    ["--gn-ink on --gn-surf", "14.45 -> 10.06"],
    ["--gn-p2 on --gn-surf", "9.97 -> 5.77"],
    ["--gn-gold on --gn-surf", "11.26 -> 6.81"],
    ["--gn-danger on --gn-surf", "8.19 -> 5.71"],
    ["--gn-danger-hover on --gn-surf", "10.06 -> 7.02"],
    ["--gn-yes on --gn-surf", "8.28 -> 4.85"],
    ["--gn-act on --gn-surf", "7.36 -> 4.76"],
    ["--gn-act-ink on --gn-surf", "9.74 -> 7.03"],
  ]);
  const drifted: string[] = [];
  for (const [fg, bg] of PAIRS) {
    const arcade = contrast(solid(ARCADE, fg), solid(ARCADE, bg));
    const tabletop = contrast(solid(TABLETOP, fg), solid(TABLETOP, bg));
    const delta = Math.round((tabletop - arcade) * 100) / 100;
    if (CARD_COST.has(`${fg} on ${bg}`)) continue;
    if (arcade - tabletop > TOLERANCE && (arcade - tabletop) / arcade > 0.25) {
      drifted.push(`${fg} on ${bg}: arcade ${arcade}, tabletop ${tabletop} (${delta})`);
    }
  }
  // The exemptions must stay live. A pair listed above that has since come back
  // inside the tolerance is a line nobody needs, and leaving it there would let
  // a future regression on that pair pass unnoticed.
  const stale: string[] = [];
  for (const [key] of CARD_COST) {
    const [fg, bg] = key.split(" on ") as [string, string];
    const arcade = contrast(solid(ARCADE, fg), solid(ARCADE, bg));
    const tabletop = contrast(solid(TABLETOP, fg), solid(TABLETOP, bg));
    if (!(arcade - tabletop > TOLERANCE && (arcade - tabletop) / arcade > 0.25)) {
      stale.push(`${key} is exempt but no longer drifts (arcade ${arcade}, tabletop ${tabletop}); delete the line`);
    }
  }
  assert.deepEqual(stale, [], "stale parity exemptions:\n  " + stale.join("\n  "));
  assert.deepEqual(drifted, [], "contrast parity lost:\n  " + drifted.join("\n  "));
});

test("A THEME DECLARES EVERY TOKEN IT NEEDS TO, or says why not", () => {
  // The failure mode of a token block is a MISSING token, not a wrong one: the
  // cascade quietly serves Arcade's value and the screen looks a bit off rather
  // than broken. Only the cabinet INKS may be inherited, and that is a decision
  // (DECISION LOG, 2026-08-02): identity belongs to the pack and does not change
  // with the theme, so Smash is red under Tabletop too.
  const inherited = Object.keys(ARCADE)
    .filter((t) => !(t in TABLETOP))
    .sort();
  // Two things are inherited on purpose, and both are decisions rather than
  // omissions. The cabinet INKS are pack identity: Smash is red under every
  // theme. --gn-radius-pill is theme-invariant because the things that read it
  // (toggles, chips, the live tag) genuinely ARE pills, and a squared chip is
  // just a small rectangle.
  const mayInherit = Object.keys(ARCADE)
    .filter((t) => /^--gn-cab-[a-z]+-ink$/.test(t) || t === "--gn-radius-pill")
    .sort();
  assert.deepEqual(
    inherited,
    mayInherit,
    "Tabletop inherits a token it should override, or overrides one it should inherit. " +
      "Only --gn-cab-*-ink and --gn-radius-pill may be inherited.",
  );
  // And the tokens really do exist to be inherited, so a rename that emptied
  // this list could not pass by matching nothing against nothing.
  assert.ok(mayInherit.length >= 7, `expected the inherited tokens, found ${mayInherit.length}`);
});

test("A THEME OWNS ITS MATERIAL, not just its palette", () => {
  // Stage 2 shipped Tabletop as a palette and it read as Arcade with a
  // different scheme, because a raster, a neon glow, a moulded bevel, a lozenge
  // and a cartoon face are structure rather than colour and none of them moved.
  // This asserts the structure tokens exist and that Tabletop actually says
  // something different with them, so a future theme cannot be only a palette
  // again without noticing.
  const STRUCTURE = [
    "--gn-texture",
    "--gn-texture-tv",
    "--gn-texture-opacity",
    // The four that turn a texture from a pattern into a MATERIAL. Arcade's
    // raster is a translucent overlay at its natural size and needs none of
    // them; felt is a greyscale tile that only becomes cloth once it is tinted
    // by the page colour and blended into it, at a size chosen so the weave
    // reads at arm's length on a phone and across a room on a television.
    "--gn-texture-tint",
    "--gn-texture-blend",
    "--gn-texture-size",
    "--gn-texture-size-tv",
    // The cloth and the light on it. A flat surface is a page; a surface with a
    // lamp over it is a table, and it is also what lifts the middle of the
    // screen enough for the weave to be visible at all.
    "--gn-felt",
    "--gn-felt-lit",
    "--gn-lamp-geom",
    "--gn-lamp-fade",
    "--gn-glow-title",
    "--gn-glow-h2",
    "--gn-glow-brand",
    "--gn-bevel",
    "--gn-bevel-press",
    "--gn-radius-card",
    "--gn-radius-tile",
    "--gn-font-display",
  ];
  const missing = STRUCTURE.filter((t) => !(t in ARCADE));
  assert.deepEqual(missing, [], `structure tokens missing from :root: ${missing.join(", ")}`);

  const unmoved = STRUCTURE.filter((t) => ARCADE[t] === TABLETOP[t]);
  assert.deepEqual(
    unmoved,
    [],
    "Tabletop declares these structure tokens but gives them Arcade's value, which is " +
      "the same as not theming them: " + unmoved.join(", "),
  );

  // The two that carry the most weight, stated outright rather than left to a
  // reader to infer from a diff.
  assert.equal(TABLETOP["--gn-glow-title"], "none", "Tabletop must not glow");
  assert.equal(TABLETOP["--gn-glow-h2"], "none", "Tabletop must not glow");
  assert.match(
    ARCADE["--gn-texture"]!,
    /repeating-linear-gradient\(to bottom/,
    "Arcade's texture is a horizontal raster; if that changed, Arcade moved",
  );
  assert.doesNotMatch(
    TABLETOP["--gn-texture"]!,
    /to bottom/,
    "Tabletop's texture is still a horizontal raster, which is a CRT whatever colour it is",
  );
});

test("A TABLE HAS AN EDGE AND AN ARCADE CABINET DOES NOT", () => {
  // The rail is the thing that made Tabletop read as a table rather than as a
  // dark page (James, 2026-08-03: shown a rail and no rail, he chose the rail
  // definitively), so it gets an assertion rather than a screenshot.
  //
  // What is actually being protected is that the rail is THEME-OWNED. Every
  // token below exists in :root so the shell rules can read it unconditionally,
  // and every one of them is inert there: zero width, no timber, transparent
  // colours. That inertness is the whole reason .gn-rail can sit in index.html
  // for every theme without Arcade growing furniture, and it is one careless
  // "sensible default" away from being lost.
  const INERT: [string, string][] = [
    ["--gn-rail-w", "0px"],
    ["--gn-rail-timber", "none"],
    ["--gn-rail-timber-v", "none"],
    ["--gn-rail-grain", "none"],
    ["--gn-rail-grain-v", "none"],
    ["--gn-rail-face", "none, none, none, none"],
    // currentcolor rather than transparent, and that is not a typo: it is the
    // initial value of outline-color, so Arcade computes exactly what it
    // computed before the stitch existed an outline at all.
    ["--gn-rail-stitch", "currentcolor"],
    ["--gn-rail-stitch-w", "0px"],
    ["--gn-rail-stitch-style", "none"],
    ["--gn-rail-stitch-inset", "0px"],
    ["--gn-rail-drop", "transparent"],
    ["--gn-rail-drop-blur", "0px"],
    ["--gn-rail-lip", "transparent"],
    ["--gn-rail-lip-y", "0px"],
    ["--gn-rail-lip-blur", "0px"],
    ["--gn-radius-rail", "0px"],
    ["--gn-radius-felt", "0px"],
  ];
  for (const [token, inert] of INERT) {
    assert.equal(ARCADE[token], inert, `${token} must be inert under Arcade: an arcade cabinet has no rail`);
    assert.ok(token in TABLETOP, `${token} is theme-owned and Tabletop must declare it`);
  }
  // And Tabletop's rail is actually drawn, in real units. "14px" rather than a
  // bare number is load-bearing: the rail rules use it as a background size and
  // as an inset, both of which silently invalidate on a unitless value.
  assert.match(TABLETOP["--gn-rail-w"]!, /^\d+(\.\d+)?px$/, "the rail width needs a unit");
  assert.notEqual(TABLETOP["--gn-rail-w"], "0px", "Tabletop's rail must have width");
  assert.notEqual(TABLETOP["--gn-rail-timber"], "none", "Tabletop's rail must have timber");

  // THE FOUR MATERIAL FIXES, each stated so that "tidying" one out fails here
  // rather than being noticed on a phone six weeks later. Each one is a thing
  // that made the shipped rail read as a window frame rather than furniture.
  assert.match(
    TABLETOP["--gn-rail-grain"]!,
    /^repeating-linear-gradient/,
    "the timber needs a grain stripe; one smooth gradient is moulded plastic",
  );
  assert.equal(
    TABLETOP["--gn-rail-stitch-style"],
    "dashed",
    "the stitch is DASHED; a solid hairline is a border, and a border is a window",
  );
  assert.match(
    TABLETOP["--gn-rail-stitch-inset"]!,
    /^-\d/,
    "the stitch sits IN from the cloth's edge, not flush against it",
  );
  assert.notEqual(TABLETOP["--gn-radius-rail"], "0px", "a table has rounded corners");
  assert.notEqual(TABLETOP["--gn-radius-felt"], "0px", "the cloth is rounded inside the timber");
  // The layer lists have to stay in step or the timbers land in the wrong
  // places, and the failure is silent: the frame simply draws wrong.
  const layers = (v: string) => v.split(",").length;
  assert.equal(layers(TABLETOP["--gn-rail-face"]!), layers(TABLETOP["--gn-rail-face-pos"]!));
  assert.equal(layers(TABLETOP["--gn-rail-face"]!), layers(TABLETOP["--gn-rail-face-repeat"]!));

  // The rail is FIXED, and that is a budget claim rather than a style one. The
  // money board, Ping Pong and Casino Run TV layouts are measured to the pixel
  // against 1080 and one of them is already over; a rail in flow would eat 28px
  // of that and push a back button off a television.
  const rail = CSS_BARE.match(/\.gn-rail\s*\{([^}]*)\}/);
  assert.ok(rail, "no .gn-rail rule in index.css");
  assert.match(rail![1]!, /position\s*:\s*fixed/, "the rail must not cost layout");
  assert.match(rail![1]!, /pointer-events\s*:\s*none/, "the rail must never eat a tap");
  // Pinned inside the safe area, or on a notched phone in landscape the timber
  // is under the cutout and the stitch line is under the home indicator.
  assert.match(rail![1]!, /env\(safe-area-inset-top/, "the rail must respect the safe area");
  assert.ok(
    HTML.includes('class="gn-rail"'),
    "the rail element lives in index.html, beside #root: see the comment there for why not React",
  );
});

test("THE FELT IS A REAL FILE, and only Tabletop names it", () => {
  // Stage 3 ruled an image asset out and James overturned it on 2026-08-03
  // ("felt is a grey texture plus a colour, so one tile serves every pack"), so
  // the cost that ruling was protecting is the thing to keep measured. The tile
  // is greyscale, tinted at use, and paid for exactly once.
  const url = TABLETOP["--gn-texture"]!.match(/url\("([^"]+)"\)/);
  assert.ok(url, `Tabletop's texture should be a url(): got ${TABLETOP["--gn-texture"]}`);
  const tile = path.join(ROOT, "apps/web/src", url![1]!.replace(/^\.\//, ""));
  const bytes = statSync(tile).size;
  // 64KB, raised from 48 on 2026-08-03 when the weave was allowed to be a
  // weave: noise is what costs bytes in a lossy codec, so the tile went from a
  // standard deviation of 4.6 at 33KB to 8.1 at 53KB. That is the trade being
  // made knowingly: it is one immutably-cached request, only under Tabletop,
  // and it is the theme's entire material. The headroom is for a regenerate
  // that changes the weave, not for a second thought about the format.
  assert.ok(bytes < 64 * 1024, `the felt tile is ${bytes} bytes, which is too much to ship on a phone`);

  // Arcade must not so much as mention it, or every Arcade session pays for a
  // tile it never paints. Asserted over the whole stylesheet minus the Tabletop
  // block, because the leak that matters is a stray rule, not a stray token.
  const at = CSS_BARE.indexOf(':root[data-theme="tabletop"] {');
  const end = CSS_BARE.indexOf("}", at);
  const outside = CSS_BARE.slice(0, at) + CSS_BARE.slice(end + 1);
  assert.doesNotMatch(
    outside,
    /textures\//,
    "an image asset is named outside the Tabletop block, so Arcade pays to download it",
  );
});

test("THE CARD BELONGS TO THE SURFACE IT SITS ON", () => {
  // Opaque walnut boxes on green felt read as holes cut in the table. The card
  // material is a DARKENING of whatever it is laid on, so the weave and the
  // lamp carry through it, and this asserts that rather than trusting a value
  // in a stylesheet to still mean that in six months.
  assert.ok(rgba(TABLETOP["--gn-surf"]!), "Tabletop's card must be translucent, not a flat colour");
  assert.ok(rgba(TABLETOP["--gn-raise"]!), "a raised control is the same material, lighter");
  assert.ok(!rgba(ARCADE["--gn-surf"]!), "Arcade's card is a solid colour and stays one");

  // A raised control darkens LESS than a card, which is the relationship these
  // two have always had and the one thing an alpha is easy to get backwards.
  const alpha = (v: string) => Number(rgba(v)![4]);
  assert.ok(
    alpha(TABLETOP["--gn-raise"]!) < alpha(TABLETOP["--gn-surf"]!),
    "a raised control must sit lighter than the card it is a variant of",
  );

  // AND THE OPAQUE COMPANION EXISTS AND IS ACTUALLY OPAQUE. Three places cannot
  // take a translucent surface (a cabinet gradient's far stop, a TV background
  // wash, a native <select> option) and neither can a pack that has not had its
  // Tabletop pass; they all read --gn-surf-solid. Under Arcade it is the same
  // colour as --gn-surf, which is what keeps that theme byte-identical.
  for (const [name, theme] of THEME_BLOCKS) {
    assert.ok(isColour(value(theme, "--gn-surf-solid")), `${name}: --gn-surf-solid must be opaque`);
  }
  assert.equal(
    ARCADE["--gn-surf-solid"],
    ARCADE["--gn-surf"],
    "under Arcade the solid companion IS the card, or the two can drift apart unnoticed",
  );
  assert.doesNotMatch(
    CSS_BARE,
    /var\(--gn-cab-[a-z]+-top\),\s*var\(--gn-surf\)/,
    "a cabinet gradient ends on the translucent card, so the tile fades out instead of settling",
  );
});

test("CONTENT STANDS BACK FROM THE RAIL, and Arcade pays nothing for it", () => {
  // The rail is a fixed frame, so content laid out to the viewport edge ends up
  // jammed against the timber and the last line of a page is sliced by the
  // stitch. The inset is a token so that the expressions using it collapse to
  // exactly their old values under Arcade.
  assert.equal(ARCADE["--gn-shell-inset"], "0px", "Arcade has no rail, so it stands back by nothing");
  assert.match(
    TABLETOP["--gn-shell-inset"]!,
    /var\(--gn-rail-w\)/,
    "the inset must be derived from the rail, or the two drift apart the first time the rail changes",
  );
  // Every use site has to fold it in, and one that forgets is invisible on a
  // desktop and obvious on a phone. The signed-out Home screen sets its padding
  // inline, which overrides the shell rule, and was exactly that miss.
  assert.match(
    CSS_BARE,
    /:where\(#root\) > \*\{[^}]*padding-top: calc\(env\(safe-area-inset-top, 0px\) \+ var\(--gn-shell-inset\)\)/,
    "the shell default must carry the inset",
  );
  const HOME = readFileSync(path.join(ROOT, "apps/web/src/pages/Home.tsx"), "utf8");
  const inline = HOME.match(/padding: "calc\(1\.5rem[^"]*"/);
  assert.ok(inline, "the signed-out Home screen no longer sets its padding inline; drop this check");
  assert.equal(
    (inline![0].match(/var\(--gn-shell-inset\)/g) || []).length,
    4,
    "all four sides of the signed-out Home padding must carry the shell inset",
  );
});

test("every theme has a pre-paint background in index.html", () => {
  // index.html sets the theme-color meta and the <html> background before the
  // stylesheet exists, so those two colours cannot be tokens and are mapped by
  // name in an inline script. A theme with a token block but no entry there
  // paints Arcade's plum for one frame and then corrects itself, which is a
  // flash nobody notices in review and everybody notices on a phone.
  const map = HTML.match(/var GN_BG = \{([^}]*)\}/);
  assert.ok(map, "no GN_BG map in apps/web/index.html");
  const mapped = [...map![1]!.matchAll(/([a-z][a-z0-9-]*)\s*:\s*"(#[0-9a-fA-F]{3,8})"/g)];
  const byName = Object.fromEntries(mapped.map((m) => [m[1]!, m[2]!]));

  for (const [name, theme] of THEME_BLOCKS) {
    assert.ok(name in byName, `theme "${name}" has no entry in the GN_BG pre-paint map`);
    // AGAINST THE FELT, NOT --gn-bg, and the difference is the whole point of
    // the check. The shell paints its cloth edge to edge over the page colour,
    // so the colour of the second frame IS the felt; mapping this to the walnut
    // underneath would put a frame of bare wood in front of every Tabletop
    // load. Arcade's felt is its background, so nothing changed there.
    assert.equal(
      byName[name]!.toLowerCase(),
      value(theme, "--gn-felt").toLowerCase(),
      `the pre-paint colour for "${name}" does not match the surface it paints, so the ` +
        `first frame is a different colour from the second`,
    );
  }
});

// ---------------------------------------------------------------------------
// THE PACKS. Ping Pong is the stage 4 pilot and the only converted pack; the
// remaining eight add a block here as they land.
//
// The pairs are TEXT pairs, the same shape the shell uses: ink on the surface
// it sits on, and each -ink on the fill it is printed on. Borders are not in
// the list for the same reason --gn-line is not in the shell's, and it matters
// more here: under Tabletop --pp-line stops being a lit green edge and becomes
// the table's painted white centre line, which moves its contrast against the
// felt from 3.07 to 10.9. That is the object being right, not a regression, and
// a parity assertion over it would be asserting that the theme did nothing.
const PP_PAIRS: [string, string][] = [
  ["--gn-ink", "--pp-felt"],
  ["--gn-dim", "--pp-felt"],
  ["--pp-accent", "--pp-felt"],
  ["--pp-accent-tint-ink", "--pp-felt"],
  ["--pp-err", "--pp-felt"],
  // Each -ink on its own fill. --pp-go-ink prints on the SHELL's confirm green,
  // because the Go button is the shell's action wearing pack paint.
  ["--pp-accent-ink", "--pp-accent"],
  ["--pp-go-ink", "--gn-p2"],
];

/** Pack tokens first, then the shell's, resolved for the given theme. */
function ppValue(themeShell: Record<string, string>, themePack: Record<string, string>, token: string) {
  return themePack[token] ?? PP_ARCADE[token] ?? themeShell[token] ?? ARCADE[token]!;
}

const PP_BLOCKS: [string, Record<string, string>, Record<string, string>][] = [
  ["arcade", ARCADE, PP_ARCADE],
  ["tabletop", TABLETOP, PP_TABLETOP],
];

test("PING PONG clears WCAG AA in both themes", () => {
  const failures: string[] = [];
  for (const [name, shell, pack] of PP_BLOCKS) {
    for (const [fg, bg] of PP_PAIRS) {
      const ratio = contrast(ppValue(shell, pack, fg), ppValue(shell, pack, bg));
      if (ratio < 4.5) failures.push(`${name}: ${fg} on ${bg} = ${ratio} (needs 4.5)`);
    }
  }
  assert.deepEqual(failures, [], "pack contrast below AA:\n  " + failures.join("\n  "));
});

test("PING PONG holds contrast parity between the themes", () => {
  // The felt was tuned against this, not picked and hoped for: the first
  // candidate (#143a3f) put the orange rubber at 4.72 against it, barely over
  // AA where Arcade reads 5.90, and it was darkened until the pair came back.
  const TOLERANCE = 2.0;
  const drifted: string[] = [];
  for (const [fg, bg] of PP_PAIRS) {
    const a = contrast(ppValue(ARCADE, PP_ARCADE, fg), ppValue(ARCADE, PP_ARCADE, bg));
    const t = contrast(ppValue(TABLETOP, PP_TABLETOP, fg), ppValue(TABLETOP, PP_TABLETOP, bg));
    const delta = Math.round((t - a) * 100) / 100;
    if (Math.abs(delta) > TOLERANCE) {
      drifted.push(`${fg} on ${bg}: arcade ${a}, tabletop ${t} (${delta})`);
    }
  }
  assert.deepEqual(drifted, [], "pack contrast parity lost:\n  " + drifted.join("\n  "));
});

test("PING PONG'S IDENTITY SURVIVES THE THEME, and its material does not", () => {
  // The rubber is the identity and identity does not change with the theme,
  // exactly as the shell's cabinet inks do not. If a later pass "tidies" the
  // accent into the Tabletop block, the pack stops being recognisable across a
  // room, which is what standing rule 3 is protecting.
  for (const t of ["--pp-accent", "--pp-accent-ink", "--pp-accent-sh", "--pp-accent-tint-ink"]) {
    assert.ok(t in PP_ARCADE, `${t} should be declared on the pack root`);
    assert.ok(
      !(t in PP_TABLETOP),
      `${t} is identity and must NOT be redeclared under Tabletop`,
    );
  }
  // And the material DOES change, or the pack is just a recolour of the shell.
  for (const t of ["--pp-felt", "--pp-edge", "--pp-line", "--pp-radius-card", "--pp-bevel"]) {
    assert.ok(t in PP_TABLETOP, `${t} is material and must be re-treated under Tabletop`);
    assert.notEqual(PP_ARCADE[t], PP_TABLETOP[t], `${t} carries Arcade's value under Tabletop`);
  }
});

// ---------------------------------------------------------------------------
// CARD TABLE, and the reason it gets a block here on the day it ships rather
// than when the Tabletop pass reaches it.
//
// EVERY OTHER PACK IN THIS APP HAS DARK CARDS. Card Table's are cream, because
// a card face is cream, and that inverts the assumption behind every shell
// colour that lands on one: --gn-danger is a pale pink tuned to print on a dark
// card and all but vanishes on paper, and the shell's confirm teal is a neon
// that fights it. Both were tokenised in the layer for this reason and both are
// measured below.
//
// The numbers here are WCAG AA (4.5) rather than the shell's parity numbers,
// because there is no shipped Arcade value to hold parity with: this pack has
// no history to protect yet.

const CT_CSS = readFileSync(path.join(ROOT, "apps/web/src/cardtable/cardtable.css"), "utf8");
const CT_ARCADE = packTokens(CT_CSS, ".ct-root,");
const CT_TABLETOP = packTokens(CT_CSS, ':root[data-theme="tabletop"] .ct-root,');

/**
 * Text against the surface it actually sits on, and every -ink against the fill
 * it is printed on.
 *
 * The two shell components are in here by name. --ct-go-ink prints on the
 * pack's own confirm fill, and the HOST TOGGLE is the shell's component wearing
 * this pack's paint: it draws its label in --gn-yes / --gn-no over a 16% tint
 * of the same colour, so its ink is measured against the plain card face. That
 * is a hair stricter than the truth (the tint darkens the cream slightly) and
 * stricter is the right side to be wrong on.
 */
const CT_PAIRS: [string, string][] = [
  ["--ct-ink", "--ct-face"],
  ["--ct-ink-dim", "--ct-face"],
  ["--ct-ink", "--ct-face-lit"],
  ["--ct-ink", "--ct-face-shade"],
  ["--ct-ink-dim", "--ct-face-shade"],
  ["--ct-red", "--ct-face"],
  ["--ct-danger", "--ct-face"],
  ["--ct-red-ink", "--ct-red"],
  ["--ct-black-ink", "--ct-black"],
  ["--ct-go-ink", "--ct-go"],
  // The brand lettering, on the table rather than on a card.
  ["--ct-face", "--ct-baize"],
  // The TV is a dark room again, so it is its own set.
  ["--ct-tv-ink", "--ct-baize-tv"],
  ["--ct-tv-muted", "--ct-baize-tv"],
  ["--ct-red-lit", "--ct-baize-tv"],
];

/** The host toggle's two inks, which the pack re-points on the toggle itself. */
const CT_TOGGLE = packTokens(CT_CSS, ".ct-root .gn-toggle");

function ctValue(themePack: Record<string, string>, token: string) {
  const raw = themePack[token] ?? CT_ARCADE[token]!;
  // The mapping layer is var(--ct-*) indirection; resolve one hop.
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(raw);
  return m ? themePack[m[1]!] ?? CT_ARCADE[m[1]!]! : raw;
}

const CT_BLOCKS: [string, Record<string, string>][] = [
  ["arcade", CT_ARCADE],
  ["tabletop", CT_TABLETOP],
];

test("CARD TABLE clears WCAG AA in both themes", () => {
  const failures: string[] = [];
  for (const [name, pack] of CT_BLOCKS) {
    for (const [fg, bg] of CT_PAIRS) {
      const ratio = contrast(ctValue(pack, fg), ctValue(pack, bg));
      if (ratio < 4.5) failures.push(`${name}: ${fg} on ${bg} = ${ratio} (needs 4.5)`);
    }
  }
  assert.deepEqual(failures, [], "pack contrast below AA:\n  " + failures.join("\n  "));
});

test("CARD TABLE'S HOST TOGGLE clears AA on a cream card, in both themes", () => {
  // The specific miss this exists for: the toggle is the SHELL's component and
  // reads --gn-yes / --gn-no directly, so it is invisible to a pack's own token
  // list. On cream those two shell values measure 3.4 and 3.1, under AA and
  // nothing errors. The pack re-points them on the toggle itself.
  const failures: string[] = [];
  for (const [name, pack] of CT_BLOCKS) {
    for (const token of ["--gn-yes", "--gn-no"]) {
      const raw = CT_TOGGLE[token];
      assert.ok(raw, `the toggle must re-point ${token} or it prints the shell's dark-card value`);
      const m = /^var\((--[a-z0-9-]+)\)$/.exec(raw);
      const fg = m ? pack[m[1]!] ?? CT_ARCADE[m[1]!]! : raw;
      const ratio = contrast(fg, ctValue(pack, "--ct-face"));
      if (ratio < 4.5) failures.push(`${name}: toggle ${token} on the card face = ${ratio} (needs 4.5)`);
    }
  }
  assert.deepEqual(failures, [], "toggle contrast below AA:\n  " + failures.join("\n  "));
});

test("CARD TABLE'S IDENTITY SURVIVES THE THEME, and its material does not", () => {
  // A deck of cards is a deck of cards under any light. The suit red and the
  // pips are identity and stay put; the TABLE under the cards is material and
  // stops being neutral black under Tabletop.
  for (const t of ["--ct-red", "--ct-red-ink", "--ct-red-sh", "--ct-red-lit", "--ct-ink", "--ct-black"]) {
    assert.ok(t in CT_ARCADE, `${t} should be declared on the pack root`);
    assert.ok(!(t in CT_TABLETOP), `${t} is identity and must NOT be redeclared under Tabletop`);
  }
  for (const t of ["--ct-baize", "--ct-baize-lit", "--ct-face", "--ct-edge"]) {
    assert.ok(t in CT_TABLETOP, `${t} is material and must be re-treated under Tabletop`);
    assert.notEqual(CT_ARCADE[t], CT_TABLETOP[t], `${t} carries Arcade's value under Tabletop`);
  }
});

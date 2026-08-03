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

const ARCADE = tokens(":root");
const TABLETOP = tokens(':root[data-theme="tabletop"]');

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

/** Resolve a token for a theme, falling back to Arcade the way the cascade does. */
const value = (theme: Record<string, string>, token: string) => theme[token] ?? ARCADE[token]!;

const THEME_BLOCKS: [string, Record<string, string>][] = [
  ["arcade", ARCADE],
  ["tabletop", TABLETOP],
];

test("every theme clears WCAG AA on the pairs that carry text", () => {
  const failures: string[] = [];
  for (const [name, theme] of THEME_BLOCKS) {
    for (const [fg, bg, floor = 4.5] of PAIRS) {
      const ratio = contrast(value(theme, fg), value(theme, bg));
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
  const drifted: string[] = [];
  for (const [fg, bg] of PAIRS) {
    const arcade = contrast(value(ARCADE, fg), value(ARCADE, bg));
    const tabletop = contrast(value(TABLETOP, fg), value(TABLETOP, bg));
    const delta = Math.round((tabletop - arcade) * 100) / 100;
    if (Math.abs(delta) > TOLERANCE) {
      drifted.push(`${fg} on ${bg}: arcade ${arcade}, tabletop ${tabletop} (${delta})`);
    }
  }
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
    ["--gn-rail-stitch", "transparent"],
    ["--gn-rail-stitch-w", "0px"],
    ["--gn-rail-drop", "transparent"],
    ["--gn-rail-drop-blur", "0px"],
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
  // 48KB. The shipped tile is 33KB; the headroom is for a regenerate that
  // changes the weave, not for a second thought about the format.
  assert.ok(bytes < 48 * 1024, `the felt tile is ${bytes} bytes, which is too much to ship on a phone`);

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
    assert.equal(
      byName[name]!.toLowerCase(),
      value(theme, "--gn-bg").toLowerCase(),
      `the pre-paint colour for "${name}" does not match its --gn-bg, so the first frame ` +
        `is a different colour from the second`,
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

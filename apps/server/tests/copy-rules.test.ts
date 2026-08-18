// Enforces two rules a stylesheet or a screen can break without erroring: no
// em dashes anywhere (PROJECT-INSTRUCTIONS.md), and no colour literal outside
// the token block in the shell stylesheet (the theming rule, below).
//
// Both are here because they are the same SHAPE of rule: a thing that is
// invisible when it rots. Nothing throws, nothing fails to compile, the page
// looks fine, and the damage only shows up somewhere far away.
//
// It drifted for several sessions and was swept on 2026-08-02: 291 of them
// across 65 source files. A rule that can rot that far unnoticed is a rule that
// needs something checking it, which is why this test exists rather than a note
// telling the next session to be careful.
//
// IT CHECKS FOUR ENCODINGS, and that is the whole reason it is worth writing.
// The sweep was done with a grep for the literal character and reported clean,
// and then a screenshot of a live screen showed an em dash sitting in the
// middle of a sentence: five of them were written as `&mdash;` in JSX, which no
// search for U+2014 can see. A rendered em dash and a typed one look identical
// to a reader and completely different to a grep, so the check has to know
// every way one can be spelled.
//
// THE EN DASH AND THE MIDDOT ARE ALLOWED. They are different characters doing a
// job an em dash cannot: an en dash is the empty-value placeholder on the TV
// boards, and a middot separates items in a line. The rule is about the em dash
// as PUNCTUATION IN PROSE, not about non-ASCII typography.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * The vendored Beerio Kart app is a 1:1 replica and is never edited, which is a
 * standing rule of its own and a bigger one than this. Its copy is upstream's.
 */
const EXEMPT = new Set([
  "apps/web/src/beerio/BeerioApp.tsx",
  // AND THIS FILE, which is the one place in the repo where all four spellings
  // are written on purpose: they are the patterns being searched for and the
  // samples proving those patterns bite. Excluding it costs nothing, because
  // the second test below checks the patterns against those samples directly,
  // so a check that had stopped matching would still fail loudly.
  "apps/server/tests/copy-rules.test.ts",
]);

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "build", "coverage"]);
const EXTS = [".ts", ".tsx", ".css", ".html"];

/** Every way an em dash can reach a screen or a comment. */
const FORMS: [string, RegExp][] = [
  ["the literal character", /—/],
  ["the HTML entity &mdash;", /&mdash;/i],
  ["the numeric entity &#8212;", /&#8212;/],
  ["the hex entity &#x2014;", /&#x2014;/i],
];

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

test("NO EM DASH REACHES A SCREEN OR A COMMENT, in any of its spellings", () => {
  const offenders: string[] = [];
  for (const full of sources(ROOT)) {
    const rel = path.relative(ROOT, full);
    if (EXEMPT.has(rel)) continue;
    const src = readFileSync(full, "utf8");
    for (const [label, re] of FORMS) {
      if (!re.test(src)) continue;
      const line = src.split("\n").findIndex((l) => re.test(l)) + 1;
      offenders.push(`${rel}:${line} (${label})`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "em dashes found. Rewrite to a colon, comma, full stop or parentheses as the sentence " +
      "wants; do NOT swap in a hyphen. For an empty-value placeholder use an en dash, and for " +
      "a separator a middot.\n  " + offenders.join("\n  "),
  );
});

// ---------------------------------------------------------------------------
// The theming rule: every colour in the shell stylesheet is a token.
//
// WHY. Arcade is one of at least two themes now (Tabletop is stage 2), and a
// theme swap moves the :root token block and nothing else. A colour written as
// a literal anywhere below that block does not follow the swap. It does not
// error and it does not look wrong under Arcade, because under Arcade it is
// the right colour: it only shows up as a half-changed screen the first time
// somebody picks the other theme, backgrounds moved and the borders, pills and
// chips sitting on them left behind.
//
// It had already happened once. When the sweep that added this test ran, there
// were 54 hex values and 50 rgba() literals outside :root in index.css, and
// several were a token spelled out by hand: #241a30 appeared eight times and
// is exactly --gn-surf. The theming decision (DECISION LOG, 2026-07-15) had
// been made a fortnight earlier and written down. Writing it down was not
// enough, which is the entire argument for this test existing.
//
// THE LIST GROWS ONE PACK AT A TIME. The pack stylesheets carry ~207 literals
// and MOST OF THOSE ARE LOAD BEARING: standing rule 3 puts every pack's TV in
// that pack's own design language, so smash.css being red is not drift. What
// stage 4 does per pack is move those literals into that pack's OWN token
// block, which is what makes them themeable without flattening the packs into
// each other. A pack joins this list on the commit that converts it; listing
// one before then just fails the build on work nobody has done yet.
const TOKENISED_CSS = [
  "apps/web/src/index.css",
  // Stage 4 adds one line here per pack AS IT CONVERTS. Adding all nine now
  // would fail the build on the eight that have not been done, which is a
  // broken build rather than a useful signal.
  "apps/web/src/pingpong/pingpong.css",
  // SOCIAL DEDUCTION joins on the commit that CREATED it rather than on a later
  // conversion pass, which is what stage 4 has been doing one pack at a time.
  // Writing a pack's stylesheet token-first costs nothing on the day and is the
  // only way the list ever finishes.
  "apps/web/src/deduction/deduction.css",
  // BOARD GAME joins on its conversion commit, which is what this list has
  // always said it would do. Its backdrop was two inline gradients with four
  // literals in them; they are now --bg-* tokens, which is what let the same
  // two rules serve both a walnut page gradient and a cloth.
  "apps/web/src/boardgame/boardgame.css",
  // THE TOURNAMENT SETUP SCREEN, which joins on the commit that created it for
  // the same reason Social Deduction did. It has no palette of its own on
  // purpose: a generic tournament is not a pack, so its block ALIASES the
  // shell's tokens under names that say what each is for, and every structural
  // rule reads var(). There is nothing for stage 4 to convert here.
  "apps/web/src/pages/tournament.css",
];

/** A hex colour, or an rgb()/rgba() literal. */
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/g;

/** Blank out a span, keeping its newlines so reported line numbers stay true. */
const blank = (s: string) => s.replace(/[^\n]/g, " ");

/**
 * Blank out the two places a colour literal is ALLOWED to appear: comments,
 * and the token blocks themselves.
 *
 * A TOKEN BLOCK IS RECOGNISED BY ITS SHAPE, not by a list of known selectors:
 * it is any rule whose declarations are ALL custom properties. That definition
 * is the honest one (a rule that sets only custom properties cannot paint
 * anything itself, so every literal in it IS a token value) and it is the one
 * that survives stage 4, where each pack adds two more token blocks on its own
 * roots. Matching `:root` and `[data-theme=...]` by name, as this used to,
 * would have meant editing this test nine more times, and the version before
 * that consumed the previous block's closing brace as a delimiter and silently
 * stopped recognising the SECOND block in a file the day Tabletop was added.
 *
 * A rule that mixes custom properties with real ones is NOT a token block and
 * its literals are still caught.
 *
 * Comments are exempt because the token block in index.css explains at length
 * what went wrong and quotes the literals it is talking about, and that
 * reasoning is worth more than making the grep simpler.
 */
function strippable(css: string): string {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, blank);
  return noComments.replace(/([^{}]*)\{([^{}]*)\}/g, (whole, _sel: string, body: string) => {
    const decls = body.split(";").map((d) => d.trim()).filter(Boolean);
    return decls.length && decls.every((d) => d.startsWith("--")) ? blank(whole) : whole;
  });
}

test("NO COLOUR LITERAL OUTSIDE THE TOKEN BLOCK in the themed stylesheets", () => {
  const offenders: string[] = [];
  for (const rel of TOKENISED_CSS) {
    const body = strippable(readFileSync(path.join(ROOT, rel), "utf8"));
    for (const [i, text] of body.split("\n").entries()) {
      for (const hit of text.matchAll(COLOR_LITERAL)) offenders.push(`${rel}:${i + 1} ${hit[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "colour literals found outside :root. If the value IS a token, use the var(). " +
      "If it is a token at an alpha, use color-mix(in srgb, var(--gn-x) N%, transparent). " +
      "If the token set genuinely does not have it, add a token named for what it is FOR " +
      "(--gn-shadow-depth, not --gn-dark-purple: a token named after its colour cannot " +
      "survive a light theme).\n  " + offenders.join("\n  "),
  );
});

test("the colour-literal check can actually see a literal, and knows where not to look", () => {
  // Same reason as the em dash samples below: a guard that scans for nothing
  // passes silently forever. These are the four shapes that matter.
  const caught = [
    ".gn-x{color:#241a30}",
    ".gn-x{color:#fff}",
    ".gn-x{background:rgba(255,90,95,.16)}",
    ".gn-x{background:rgb(255,90,95)}",
    // A themed COMPONENT rule that happens to carry the attribute is not a
    // token block, and its literals must still be caught.
    '.gn-x[data-theme="tabletop"]{color:#f0e6d2}',
    // A rule that MIXES a custom property with a real one is not a token block.
    ".pp-btn{--pp-x:#ff7a1a;background:#ff7a1a}",
  ];
  for (const sample of caught) {
    assert.ok(
      strippable(sample).match(COLOR_LITERAL),
      `a literal in ${JSON.stringify(sample)} was not caught`,
    );
  }
  const allowed = [
    ":root{--gn-surf:#241a30}",
    '[data-theme="tabletop"]{--gn-surf:#f0e6d2}',
    ':root[data-theme="tabletop"]{--gn-surf:#201a12}',
    // TWO BLOCKS BACK TO BACK, which is the shape that actually ships and the
    // one that broke: the first block's closing brace used to be consumed as
    // part of matching it, so the second was never recognised and reported its
    // whole palette as stray literals.
    ':root{--gn-surf:#241a30}\n:root[data-theme="tabletop"]{--gn-surf:#201a12}',
    ":root{--gn-surf:#241a30}:root[data-theme=x]{--gn-surf:#201a12}",
    // A PACK's token blocks, which is the shape stage 4 adds nine times over.
    // Neither selector is :root, so a check that matched on selector names
    // rather than on shape would report a pack's whole palette as stray.
    ".pp-root,\n.pp-tv{--pp-felt:#0c2a1d;--pp-accent:#ff7a1a}",
    ':root[data-theme="tabletop"] .pp-root{--pp-felt:#0d262b}',
    "/* #241a30 appears eight times and is exactly --gn-surf */",
    ".gn-x{background:color-mix(in srgb, var(--gn-p1) 45%, transparent)}",
    ".gn-x{border:2px solid var(--gn-line)}",
  ];
  for (const sample of allowed) {
    assert.equal(
      strippable(sample).match(COLOR_LITERAL),
      null,
      `${JSON.stringify(sample)} was wrongly flagged`,
    );
  }
});

test("the check can actually see all four spellings", () => {
  // A guard that scans for nothing passes silently forever, which is the one
  // failure mode a rule like this cannot afford. Prove each pattern bites.
  const samples = ["a — b", "a &mdash; b", "a &#8212; b", "a &#x2014; b"];
  for (const [i, [label, re]] of FORMS.entries()) {
    assert.ok(re.test(samples[i]!), `${label} pattern does not match its own sample`);
  }
  // And that the allowed characters are NOT caught.
  for (const ok of ["12 – 14", "one · two", "a - b", "a -- b"]) {
    for (const [label, re] of FORMS) {
      assert.ok(!re.test(ok), `${label} pattern wrongly flags ${JSON.stringify(ok)}`);
    }
  }
});

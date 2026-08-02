// Enforces the "no em dashes ever" standing rule (PROJECT-INSTRUCTIONS.md).
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

// The Beerio racer naming rule, pinned before phase 3 opens that file.
//
// TWO HALVES. The first is a unit test of racerLabel, which is the rule stated
// once. The second is a source scan asserting that no OTHER site states it
// again, and that half FAILS ON ARRIVAL: it is the characterization of
// AUDIT-2026-08.md MUST FIX 4, and phase 3 commit 3.6 flips it.
//
// WHY A SOURCE SCAN AND NOT A RENDER TEST. The defect is not in what any
// function returns, it is in eighteen hand-written copies of one sentence, four
// of which are wrong. A test of the helper alone would pass forever while the
// four wrong copies sat beside it untouched, which is exactly the situation
// that produced the bug. The rule that has to hold is "there is one copy", and
// that is a property of the source.
//
// THE AUDIT UNDERCOUNTED THIS BY ONE FILE. It named BeerioApp.tsx:2473, 2478
// and 2480. BeerioTvPage.tsx:412 renders the champion's name at 5vw on a
// television with the same `seed + 1`, and the bracket cards further down the
// same file (line 555, with a comment saying bracket seeds are 1-based) get it
// right. So the disagreement is not only between two files, it is between two
// panels of one screen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { racerLabel } from "../../web/src/beerio/racer.js";

const BEERIO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../web/src/beerio");

/**
 * The two files that name racers. racer.ts is excluded because it IS the one
 * legitimate copy; if it were scanned the rule could never be satisfied.
 */
const SCANNED = ["BeerioApp.tsx", "BeerioTvPage.tsx"];

// ---------- the rule, stated once ----------

test("a typed name is used as typed", () => {
  assert.equal(racerLabel(1, "Ann"), "Ann");
  assert.equal(racerLabel(7, "Ben"), "Ben");
});

test("THE SEED IS 1-BASED, so racer 3 is called Racer 3", () => {
  // The whole defect in one assertion. Player.seed is built as i + 1, so a
  // label that adds another one is naming the racer below them.
  assert.equal(racerLabel(1), "Racer 1");
  assert.equal(racerLabel(3), "Racer 3");
  assert.equal(racerLabel(16), "Racer 16");
});

test("a missing, null, empty or whitespace name falls back to the position", () => {
  // Four shapes because the two callers store an untyped name differently: the
  // bracket engine normalizes it to null (BeerioApp.tsx:320), while the raw
  // `names` array holds whatever was in the input box.
  assert.equal(racerLabel(4), "Racer 4");
  assert.equal(racerLabel(4, undefined), "Racer 4");
  assert.equal(racerLabel(4, null), "Racer 4");
  assert.equal(racerLabel(4, ""), "Racer 4");
  assert.equal(racerLabel(4, "   "), "Racer 4");
  assert.equal(racerLabel(4, "\t\n"), "Racer 4");
});

test("a name is TRIMMED, so a stray space does not become part of it", () => {
  assert.equal(racerLabel(2, "  Ann  "), "Ann");
  assert.equal(racerLabel(2, "Ann\n"), "Ann");
});

test("a name that is only punctuation is still a name", () => {
  // Trim removes whitespace, not content. Somebody who types "???" chose that.
  assert.equal(racerLabel(2, "???"), "???");
  assert.equal(racerLabel(2, "0"), "0", "a name of '0' is truthy after trim, unlike the number");
});

// ---------- and nowhere else ----------

test(
  "THE RACER NAMING RULE IS WRITTEN IN EXACTLY ONE PLACE",
  { todo: "fails on 18 hand-written copies, 4 of them wrong; flipped by phase 3 commit 3.6" },
  () => {
    const offenders: string[] = [];
    for (const file of SCANNED) {
      const text = readFileSync(path.join(BEERIO, file), "utf8");
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        // "Racer ${...}" anywhere in a template, not just at its start: one
        // site embeds it mid-sentence as `Taken by Racer ${owner+1} ...`, and a
        // pattern anchored on the backtick would walk straight past it. After
        // 3.6 every one of these is a racerLabel() call instead.
        if (/Racer \$\{/.test(line)) {
          offenders.push(`  ${file}:${i + 1}  ${line.trim().slice(0, 100)}`);
        }
      });
    }
    assert.equal(
      offenders.length,
      0,
      `${offenders.length} site(s) write the racer naming rule by hand instead of calling ` +
        `racerLabel(). Four of them add 1 to an already 1-based Player.seed, which names ` +
        `the wrong racer on the champion chip, the champion modal, the runner-up chip and ` +
        `the TV's champion headline:\n${offenders.join("\n")}`,
    );
  },
);

test("the scan can actually see a hand-written label", () => {
  // Negative control, in copy-rules.test.ts's style. A regex that has stopped
  // matching would turn the check above into one that passes by seeing nothing,
  // and it is marked todo, so nobody would notice it had gone quiet.
  assert.ok(/Racer \$\{/.test("  const label = `Racer ${champ.seed + 1}`;"), "misses a plain offender");
  assert.ok(/Racer \$\{/.test("title={`Taken by Racer ${owner+1} ok`}"), "misses a mid-sentence one");
  assert.equal(/Racer \$\{/.test("racerLabel(champ.seed, champ.name)"), false, "fires on the fix");
});

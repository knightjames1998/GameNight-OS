// Every format string the server WRITES to matches.format must have a display
// label and a place in the leaderboard's sort order.
//
// THE PROBLEM THIS EXISTS TO KILL. `matches.format` is written by twelve
// different sites across nine pack files, and when this test was written it was
// read back by two hand-maintained tables that had no connection to any of them
// or to each other: FORMAT_LABEL in apps/web/src/formats.ts and FORMAT_ORDER,
// a local const inside a route handler in apps/server/src/stats.ts.
//
// A pack that shipped a new format key got a working ledger, working stats and
// a working recap, and then printed its raw database spelling on a leaderboard,
// because `formatLabel` falls back to the key and `FORMAT_ORDER.indexOf`
// returns -1. Both failures are silent: nothing throws, no test goes red, and
// the numbers are correct the whole time. That was not hypothetical, it was the
// state of the tree the day this file was written, and this test failed on
// arrival on eight counts. See AUDIT-2026-08.md, MUST FIX 2 and MUST FIX 3.
//
// Commit 3.1 collapsed both tables into packages/shared/src/formats.ts, so
// there is one registry now and the label and the sort position of a format
// arrive together. THIS TEST IS STILL THE THING THAT KEEPS IT HONEST: a
// registry is only one source of truth while something checks it against the
// write sites, and nothing about merging two lists stops a thirteenth format
// being written by a pack that never touches the registry at all.
//
// THE EXPECTED SET IS DERIVED, NEVER HAND-LISTED, which is the whole point and
// the reason this is a source scan rather than a fixture. A hand-written list
// of formats would be a THIRD table to keep in step with the other two, and it
// would be wrong in exactly the same way and for exactly the same reason. So
// the test reads the write sites themselves: string literals assigned to a
// `format:` property, module constants those properties reference, and the
// members of the pack format union types the materializers take. A new pack's
// format key therefore fails this test the DAY IT LANDS, which is the day
// somebody is already in the file and can add two lines of copy.
//
// It is modelled on copy-rules.test.ts, including that file's discipline of
// negative-controlling its own scanner: a regex that has quietly stopped
// matching would otherwise turn this into a test that passes by seeing nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORMAT_LABEL } from "../../web/src/formats.js";
import { FORMAT_ORDER } from "@gamenight/shared";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = path.join(HERE, "../src");
const SHARED_SRC = path.join(HERE, "../../../packages/shared/src");

/**
 * Format union types that do NOT reach matches.format, by name.
 *
 * BracketFormat is the only one, and it is exempt on evidence rather than on
 * convenience: brackets.ts materialize() inserts its matches row (around line
 * 326) with groupId, bracketId, gameId, eventId, round, position and status,
 * and NO format column. So a bracket's ledger row carries null, which
 * stats.ts:90 buckets under "other" like every other untagged row. Adding
 * single_elim / double_elim / round_robin to the two display tables would put
 * three labels on screens that can never show them.
 */
const NON_LEDGER_FORMAT_TYPES = new Set(["BracketFormat"]);

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

interface Found {
  /** The format string itself. */
  format: string;
  /** Where it was read from, for a failure message somebody can act on. */
  where: string;
}

/**
 * Every format string that can reach matches.format, with its source.
 *
 * FOUR SHAPES, because the packs genuinely write it four ways and a scanner
 * that knew only the obvious one would miss half of them:
 *
 *   1. a literal            format: "board"          (marioparty.ts:94)
 *   2. a module constant    format: FORMAT           (deduction.ts:189)
 *   3. a union type         format: MkFormat         (mariokart.ts:78)
 *   4. the null bucket      r.format ?? "other"      (stats.ts:90)
 *
 * Shape 3 is why this scans packages/shared as well: the materializer's
 * signature names the type, and the type's members live in the pack's shared
 * module.
 */
function writtenFormats(): Found[] {
  const found: Found[] = [];
  const serverFiles = sources(SERVER_SRC);
  const sharedText = sources(SHARED_SRC)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  for (const file of serverFiles) {
    const rel = path.relative(path.join(HERE, "../../.."), file);
    const text = readFileSync(file, "utf8");
    const lineOf = (index: number) => text.slice(0, index).split("\n").length;

    // 1. format: "literal"
    for (const m of text.matchAll(/\bformat:\s*"([a-z_]+)"/g)) {
      found.push({ format: m[1]!, where: `${rel}:${lineOf(m.index!)}` });
    }

    // 2. format: IDENT, where IDENT resolves to a string constant in the same
    //    file. A type annotation (format: MkFormat) never resolves, so it falls
    //    through to shape 3 rather than being mistaken for a value here.
    for (const m of text.matchAll(/\bformat:\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,;]/g)) {
      const ident = m[1]!;
      const decl = text.match(new RegExp(`\\bconst\\s+${ident}\\s*=\\s*"([a-z_]+)"`));
      if (decl) found.push({ format: decl[1]!, where: `${rel}:${lineOf(m.index!)} (via ${ident})` });
    }

    // 3. format: SomeFormat, resolved against the shared union declaration.
    for (const m of text.matchAll(/\bformat:\s*([A-Z][A-Za-z0-9]*Format)\b/g)) {
      const typeName = m[1]!;
      if (NON_LEDGER_FORMAT_TYPES.has(typeName)) continue;
      const decl = sharedText.match(new RegExp(`\\btype\\s+${typeName}\\s*=\\s*([^;]+);`));
      assert.ok(
        decl,
        `${rel}:${lineOf(m.index!)} takes a format typed ${typeName}, but no ` +
          `\`type ${typeName} = ...\` was found in packages/shared/src. Either the ` +
          `type moved, or it belongs in NON_LEDGER_FORMAT_TYPES with a reason.`,
      );
      for (const lit of decl![1]!.matchAll(/"([a-z_]+)"/g)) {
        found.push({ format: lit[1]!, where: `${rel}:${lineOf(m.index!)} (via ${typeName})` });
      }
    }

    // 4. the bucket a null format falls into, which the display tables must
    //    also carry because it is what every bracket row reads as.
    for (const m of text.matchAll(/\.format\s*\?\?\s*"([a-z_]+)"/g)) {
      found.push({ format: m[1]!, where: `${rel}:${lineOf(m.index!)} (null bucket)` });
    }
  }

  return found;
}

/**
 * FORMAT_ORDER, imported.
 *
 * It was scanned out of the source when this file was written, because it was
 * then a local `const` inside the /groups/:id/stats handler with nothing to
 * import. Commit 3.1 moved it into packages/shared/src/formats.ts alongside the
 * labels, so importing it is now both possible and strictly better: a scan can
 * only ever check the text somebody wrote, and this checks the value the server
 * actually sorts on.
 */
const formatOrder = (): string[] => FORMAT_ORDER;

// ---------- the scanner's own negative control ----------

test("the format scanner can actually see all four shapes it looks for", () => {
  const found = writtenFormats();
  const byFormat = new Map(found.map((f) => [f.format, f.where]));

  // One anchor per shape, each a site that exists today. If a regex rots, the
  // shape it covers goes quiet and every assertion below would pass by seeing
  // less rather than by everything being right.
  assert.ok(byFormat.has("board"), "shape 1 (a bare literal) found nothing");
  assert.ok(byFormat.has("deduction"), "shape 2 (a module constant) found nothing");
  assert.ok(byFormat.has("grandprix"), "shape 3 (a union type member) found nothing");
  assert.ok(byFormat.has("other"), "shape 4 (the null bucket) found nothing");

  // And a floor on the whole set, so a scanner that finds four things and
  // nothing else cannot quietly satisfy the four checks above.
  assert.ok(
    new Set(found.map((f) => f.format)).size >= 12,
    `only ${new Set(found.map((f) => f.format)).size} distinct formats found; ` +
      `there were 13 when this test was written, and this number should only grow`,
  );
});

test("FORMAT_ORDER is readable and is not empty", () => {
  assert.ok(formatOrder().length >= 7, "FORMAT_ORDER scanned as shorter than it has ever been");
});

// ---------- the two rules ----------
//
// Both of these FAILED ON ARRIVAL and were marked todo, which is what they were
// written for: they are the characterization of MUST FIX 2 and MUST FIX 3, and
// they existed before the fix so the fix had something to flip. Commit 3.1
// removed the markers by making both true. They are ordinary tests now, and a
// pack that ships a new format key turns them red on the day it lands.

test("EVERY FORMAT THE SERVER WRITES HAS A DISPLAY LABEL", () => {
  const missing = [...new Map(writtenFormats().map((f) => [f.format, f.where]))]
    .filter(([format]) => !(format in FORMAT_LABEL))
    .map(([format, where]) => `  ${format}  written at ${where}`);

  assert.equal(
    missing.length,
    0,
    `${missing.length} format(s) reach matches.format with no entry in ` +
      `apps/web/src/formats.ts FORMAT_LABEL, so they render their raw database ` +
      `spelling on the crew leaderboard, /me/stats and the recap card:\n${missing.join("\n")}`,
  );
});

test("EVERY FORMAT THE SERVER WRITES HAS A PLACE IN THE SORT ORDER", () => {
  const order = formatOrder();
  const missing = [...new Map(writtenFormats().map((f) => [f.format, f.where]))]
    .filter(([format]) => !order.includes(format))
    .map(([format, where]) => `  ${format}  written at ${where}`);

  assert.equal(
    missing.length,
    0,
    `${missing.length} format(s) reach matches.format but are absent from ` +
      `FORMAT_ORDER. indexOf returns -1 for each, which sorts them AHEAD of ` +
      `the first listed format rather than after the last one:\n${missing.join("\n")}`,
  );
});

// ---------- the reverse direction ----------
//
// These pass today and exist so the fix cannot be made by pasting every string
// anybody ever thought of into both tables. A label for a format that is never
// written is dead copy, and an entry in the sort order for one is a slot in an
// ordering nothing can ever occupy.

test("no display label exists for a format the server never writes", () => {
  const written = new Set(writtenFormats().map((f) => f.format));
  const orphans = Object.keys(FORMAT_LABEL).filter((k) => !written.has(k));
  assert.deepEqual(
    orphans,
    [],
    `FORMAT_LABEL has ${orphans.length} entr(y/ies) for format(s) nothing writes: ${orphans.join(", ")}`,
  );
});

test("no sort-order entry exists for a format the server never writes", () => {
  const written = new Set(writtenFormats().map((f) => f.format));
  const orphans = formatOrder().filter((k) => !written.has(k));
  assert.deepEqual(
    orphans,
    [],
    `FORMAT_ORDER has ${orphans.length} entr(y/ies) for format(s) nothing writes: ${orphans.join(", ")}`,
  );
});

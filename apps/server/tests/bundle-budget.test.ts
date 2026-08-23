// WHAT A PHONE DOWNLOADS BEFORE IT CAN SHOW ANYTHING, with a ceiling on it.
//
// THE PROBLEM THIS EXISTS TO KILL is not a bug, it is a drift nobody is
// watching. The entry chunk was 214.73 kB raw and 67.51 kB gzipped on
// 2026-07-28 with four packs. By 2026-08-15 it was 244.57 / 77.68 with twelve,
// and nothing had gone wrong on any screen, so nobody looked for a month. When
// somebody finally did, almost the whole 10 kB of gzipped growth turned out to
// be three pack content catalogues (every Social Deduction title, faction and
// role; the full Smash fighter roster; the Casino Run modifier table) that no
// screen on the entry path reads, dragged in through a barrel import. That is
// AUDIT-2026-08.md MUST FIX 1, and commit 3.2 took it back out.
//
// The lesson is not "watch the barrel". It is that a number nothing asserts
// only ever moves one way, and the cost lands on whoever opens the app on a
// bad connection rather than on whoever wrote the import.
//
// GZIP, NOT RAW, because gzip is what actually crosses the network: the server
// compresses at the origin (see the compression dependency and its BACKLOG
// entry) and the raw figure overstates the cost of anything repetitive. Raw is
// reported in the failure message because it is the number a bundler prints,
// but the budget is on the compressed size.
//
// THE TRADEOFF, STATED RATHER THAN DISCOVERED. This test WILL need raising on
// legitimate growth, and that is the point rather than a flaw: raising it is a
// deliberate line in a diff with a number and a reason attached, which is
// exactly what the last 10 kB never got. The headroom below is set so ordinary
// feature work does not touch it and a new pack's catalogue landing in the
// entry chunk does. A budget with no headroom would be raised reflexively and
// would teach people to stop reading it, which is worse than not having one.
//
// IF THIS FAILS, THE FIRST QUESTION IS NOT "WHAT SHOULD THE NUMBER BE". It is
// whether something that belongs in a route chunk has landed in the entry one.
// The way to check is to grep the built chunk for a string only one pack could
// own, exactly as the audit did:
//
//     grep -c "Secret Hitler" apps/web/dist/assets/index-*.js
//
// A hit means a pack catalogue is in the entry chunk again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const INDEX_HTML = path.join(DIST, "index.html");

/**
 * The budgets, in GZIPPED BYTES.
 *
 * Measured on 2026-08-15 immediately after commit 3.2:
 *
 *     entry JS    224,863 raw   70,875 gzipped
 *     entry CSS    78,967 raw   14,229 gzipped
 *
 * Raising one of these is a normal thing to do. Doing it in the same commit as
 * the change that needed it, with the new measurement written above, is the
 * whole protocol.
 */
const BUDGET = {
  // RAISED 75_000 -> 78_000 on 2026-08-23 by the host check-in control, and the
  // number that matters is not the one this session spent.
  //
  // MEASURED, both sides, on the real built bundle: 72_428 gzipped before the
  // control and 73_013 after, so the check-in list costs 585 gzipped bytes.
  // THE BUDGET WAS ALREADY ALMOST GONE BEFORE THIS SESSION TOUCHED IT: 72_428
  // against 75_000 is 3.4% of headroom, and the floor below is 3%, so the next
  // 175 bytes to reach an entry-path screen were going to fail this gate
  // whatever they were for. That is the finding, rather than anything about
  // this control.
  //
  // WHY 78_000: the entry chunk went 70_875 (2026-08-15, when these budgets
  // were set) to 72_428 over the sessions since, about 1_550 bytes a week of
  // ordinary work on the five entry-path screens (Home, GroupPage, EventPage,
  // JoinPage, Login). 78_000 leaves 4_987 above today's measurement, which is
  // roughly three more sessions at that rate, and 6.4% of headroom against a 3%
  // floor. Sized against the observed growth rather than against the next byte,
  // which is the whole point of the headroom test below.
  //
  // NOTHING ELSE IN THIS SESSION LANDS HERE, and that was checked rather than
  // assumed: the two roster components go into nine LAZY pack screens, so they
  // land in a shared chunk, not the entry.
  js: 78_000,
  // RAISED 16_000 -> 18_000 on 2026-08-22, and the reason is written here
  // because the test below exists to make a raise argue for itself.
  //
  // WHAT HAPPENED: the TV session adds SIX density ladders (the event TV, Ping
  // Pong, the shared Board Game / Card Table component, Mario Kart, the
  // bracketed TV's chips, Beerio's Grand Prix). A ladder is a base variable
  // block plus three [data-band] diffs, and the first one measured cost ~380
  // gzipped bytes: 15_240 before it, 15_620 after.
  //
  // WHY ONCE RATHER THAN SIX TIMES: six raises of a few hundred bytes each is
  // exactly the reflex this test was written to stop, and each one would be
  // argued more weakly than the last. One raise, sized against six measured
  // ladders rather than against the next byte, is the honest shape. If the
  // session ships fewer ladders than planned, this number comes back down with
  // it rather than being left as free room.
  css: 18_000,
};

/**
 * The entry assets, read out of the built index.html rather than globbed.
 *
 * There is more than one `assets/index-*.js`: lazily loaded shared chunks get
 * that name too, and one of them is 16 kB while the entry is 225. A glob would
 * pick whichever sorted first and pass forever. index.html names exactly the
 * two files a browser fetches before it can paint.
 */
function entryAssets(): { js: string; css: string } | null {
  if (!existsSync(INDEX_HTML)) return null;
  const html = readFileSync(INDEX_HTML, "utf8");
  const js = html.match(/<script[^>]*src="\/assets\/([^"]+\.js)"/)?.[1];
  const css = html.match(/<link[^>]*rel="stylesheet"[^>]*href="\/assets\/([^"]+\.css)"/)?.[1];
  assert.ok(js, "no entry script found in the built index.html");
  assert.ok(css, "no entry stylesheet found in the built index.html");
  return { js: js!, css: css! };
}

const gzipped = (file: string): number =>
  gzipSync(readFileSync(path.join(DIST, "assets", file))).length;

const raw = (file: string): number => readFileSync(path.join(DIST, "assets", file)).length;

/**
 * Every assertion below needs a build. `pnpm build` runs before `pnpm test` in
 * this repo's gate and in Render's, so in practice it is always there; a bare
 * `pnpm test` on a fresh clone is not, and failing that would be a test about
 * the order somebody ran two commands in rather than about the bundle.
 */
const built = entryAssets();
const skip = built ? false : "no build in apps/web/dist; run pnpm build first";

test("THE ENTRY JS FITS ITS BUDGET", { skip }, () => {
  const { js } = built!;
  const size = gzipped(js);
  assert.ok(
    size <= BUDGET.js,
    `entry JS is ${size} gzipped bytes (${raw(js)} raw), over the ${BUDGET.js} budget by ` +
      `${size - BUDGET.js}. Before raising the number: check whether a pack catalogue has ` +
      `landed in the entry chunk again, with ` +
      `\`grep -c "Secret Hitler" apps/web/dist/assets/${js}\`. A hit there means an eager ` +
      `module is importing the shared barrel instead of a narrow subpath.`,
  );
});

test("THE ENTRY CSS FITS ITS BUDGET", { skip }, () => {
  const { css } = built!;
  const size = gzipped(css);
  assert.ok(
    size <= BUDGET.css,
    `entry CSS is ${size} gzipped bytes (${raw(css)} raw), over the ${BUDGET.css} budget by ` +
      `${size - BUDGET.css}. Roughly half of this file is Tailwind's own preflight and the ` +
      `utilities it generates from the WHOLE project, including lazily loaded pack pages, ` +
      `so growth here usually means new utility classes rather than new hand-written CSS.`,
  );
});

test("the budgets leave headroom rather than pinning today's number", { skip }, () => {
  // A budget equal to the current size fails on the next byte and gets raised
  // reflexively, which trains people to raise it without looking. A budget with
  // room only moves when something real happened. This asserts the room exists,
  // so a future edit that tightens a budget onto the current measurement has to
  // argue with this test first.
  const { js, css } = built!;
  const jsRoom = (BUDGET.js - gzipped(js)) / BUDGET.js;
  const cssRoom = (BUDGET.css - gzipped(css)) / BUDGET.css;
  assert.ok(jsRoom >= 0.03, `entry JS budget has only ${(jsRoom * 100).toFixed(1)}% headroom`);
  assert.ok(cssRoom >= 0.03, `entry CSS budget has only ${(cssRoom * 100).toFixed(1)}% headroom`);
});

test("the entry chunk carries no pack content catalogue", { skip }, () => {
  // The specific regression MUST FIX 1 was, asserted directly rather than only
  // through a size. A catalogue can arrive without breaking the budget, and the
  // size test would then pass while the actual defect was back.
  //
  // Each string belongs to exactly one pack's shared module and to no screen on
  // the entry path (Home, GroupPage, EventPage, JoinPage, Login).
  const text = readFileSync(path.join(DIST, "assets", built!.js), "utf8");
  const catalogues: [string, string][] = [
    ["Secret Hitler", "the Social Deduction title catalogue (shared/src/deduction.ts)"],
    ["Ice Climbers", "the Smash fighter roster (shared/src/smash.ts)"],
    ["Shave the target", "the Casino Run modifier table (shared/src/modifiers.ts)"],
  ];
  const found = catalogues.filter(([needle]) => text.includes(needle));
  assert.deepEqual(
    found.map(([, what]) => what),
    [],
    `the entry chunk contains pack content no entry-path screen reads. An eager module is ` +
      `importing "@gamenight/shared" instead of a narrow subpath such as ` +
      `"@gamenight/shared/packs"; see AUDIT-2026-08.md MUST FIX 1 and commit 3.2.`,
  );
});

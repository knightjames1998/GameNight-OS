// THE FIRST-VISIT CUE, AND THE THREE THINGS ABOUT IT THAT FAIL SILENTLY.
//
// 1. THE REDUCED-MOTION BRANCH KEEPS THE COLOUR. Every other reduced-motion rule
//    in this stylesheet kills its animation outright and is right to: .gn-pulse
//    and .gn-skel are loading indicators, where the motion says "working" and the
//    shape already says the rest. HERE THE MOTION IS THE MESSAGE, so dropping it
//    entirely is not a degradation, it is the feature not shipping for anybody
//    with a vestibular disorder. The next person to read three reduced-motion
//    blocks in one file will want to make them consistent. This is what stops
//    that being a quiet regression.
//
// 2. THE STATIC STATE IS THE ONLY ONE THE SWEEP CAN SEE, because theme-sweep
//    launches Chromium with --force-prefers-reduced-motion. Gold that lived only
//    inside @keyframes would be measured in neither theme.
//
// 3. THE DURATION IS IN TWO FILES. The CSS plays it and the TS decides when the
//    flag is written, and nothing connects them but arithmetic, so the
//    arithmetic is done here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `helpseen.ts` reuses the storage probe from `cache.ts`, and cache.ts reads
// `__BUILD_ID__`, which Vite defines at build time and node does not. Set before
// the dynamic imports below rather than importing helpseen statically, because a
// static import is hoisted above this line and would throw on load.
(globalThis as Record<string, unknown>).__BUILD_ID__ = "test";
const helpseen = () => import("../../web/src/helpseen.js");

const read = (rel: string) =>
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), rel), "utf8");
const css = () => read("../../web/src/index.css");
/** The stylesheet with comments removed: a rule about rules, not about prose. */
const rules = () => css().replace(/\/\*[\s\S]*?\*\//g, " ");

// ---------- the duration lives in two files ----------

test("THE CSS AND CUE_MS AGREE, multiplied out rather than eyeballed", async () => {
  const { CUE_MS } = await helpseen();
  const rule = rules().slice(rules().indexOf(".gn-cue{"), rules().indexOf("@keyframes gnhelpcue"));
  const m = rule.match(/animation:gnhelpcue\s+([\d.]+)s\s+[a-z-]+\s+(\d+)\s+both/);
  assert.ok(m, "the .gn-cue animation shorthand is not in the shape this test can read");
  const total = Math.round(parseFloat(m[1]!) * 1000) * Number(m[2]);
  assert.equal(
    total,
    CUE_MS,
    `the CSS plays for ${total}ms and helpseen.ts writes the flag after ${CUE_MS}ms`,
  );
});

test("IT IS BOUNDED AND IT SETTLES, rather than pulsing for ever", () => {
  // An endless pulse on a permanent header control is nagging, and `both` is
  // what leaves it resting on the static gold instead of snapping back to it.
  const rule = rules().slice(rules().indexOf(".gn-cue{"), rules().indexOf("@keyframes gnhelpcue"));
  assert.doesNotMatch(rule, /infinite/, "the cue must stop on its own");
  assert.match(rule, /\bboth\b/, "without a fill mode it snaps back when it ends");
});

// ---------- the reduced-motion branch ----------

test("REDUCED MOTION DROPS THE MOVEMENT AND KEEPS THE GOLD", () => {
  // The assertion is on what the block does NOT contain: anything beyond
  // `animation:none` here would be somebody taking the colour away too.
  const block = rules().match(/@media \(prefers-reduced-motion:reduce\)\{\.gn-cue\{([^}]*)\}\}/);
  assert.ok(block, "no reduced-motion rule for .gn-cue at all");
  assert.equal(
    block[1]!.trim().replace(/;$/, ""),
    "animation:none",
    "the reduced-motion branch must drop the movement and nothing else",
  );
});

test("THE GOLD IS IN THE RESTING RULE, or the sweep measures none of it", () => {
  // theme-sweep forces reduced motion, so the resting rule IS the swept state.
  const rule = rules().slice(rules().indexOf(".gn-cue{"), rules().indexOf("@keyframes gnhelpcue"));
  assert.match(rule, /--gn-gold/, "gold that lives only in @keyframes is never measured");
  assert.match(rule, /color:var\(--gn-gold\)/);
  assert.match(rule, /box-shadow:/);
});

test("THE CONTROL: the other two reduced-motion blocks really do kill theirs", () => {
  // Three of these scans pass by finding a difference, and a difference is only
  // meaningful if the thing it differs from is still there. If .gn-pulse ever
  // stops using `animation:none`, the comparison above stops meaning anything.
  const r = rules();
  assert.match(r, /@media \(prefers-reduced-motion:reduce\)\{\.gn-pulse\{animation:none\}\}/);
  assert.match(r, /@media \(prefers-reduced-motion:reduce\)\{\.gn-skel\{animation:none\}\}/);
});

// ---------- what moves, and what wins ----------

test("THE KEYFRAMES MOVE transform AND box-shadow AND NOTHING ELSE", () => {
  // The signed-in header was measured at 390px with 0px of slack. Anything
  // animating a box-model length reflows that row three times a second.
  const frames = rules().slice(rules().indexOf("@keyframes gnhelpcue"));
  const body = frames.slice(0, frames.indexOf("\n@media"));
  const props = [...body.matchAll(/^\s*([a-z-]+)\s*:/gm)].map((m) => m[1]!);
  const moved = [...new Set(props)].sort();
  assert.deepEqual(
    moved,
    ["box-shadow", "transform"],
    `the keyframes also animate ${moved.filter((p) => p !== "box-shadow" && p !== "transform").join(", ")}`,
  );
});

test("source order is the whole mechanism, so .gn-cue comes after both triggers", () => {
  // All three are single class selectors, so specificity is equal and nothing
  // but position lets the cue override the trigger's own colour and border.
  const r = rules();
  const cue = r.indexOf(".gn-cue{");
  assert.ok(cue > r.indexOf(".gn-textbtn{"), ".gn-cue must come after .gn-textbtn");
  assert.ok(cue > r.indexOf(".gn-helpbtn{"), ".gn-cue must come after .gn-helpbtn");
});

// ---------- the flags ----------

test("STORAGE THAT CANNOT BE WRITTEN MEANS ANIMATE, which is the un-reflexive default", async () => {
  // Behaviour, not a source scan. cache.ts probes localStorage because Safari
  // private mode HAS it and throws on write; in node there is no `window` at
  // all, so the probe returns null and this exercises the same branch.
  //
  // A private-mode visitor seeing a gold ring every visit is a small,
  // self-explaining annoyance. A first-timer never seeing it is the feature not
  // existing for them.
  const { shouldCueHelp } = await helpseen();
  assert.equal(shouldCueHelp("home"), true);
  assert.equal(shouldCueHelp("signedOut"), true);
});

test("THE KEYS ARE NOT IN THE CACHE'S NAMESPACE, which is swept every deploy", () => {
  // Everything under cache.ts's PREFIX is dropped on a deploy and on logout,
  // both right for cached payloads and both wrong for a once-ever flag: the cue
  // would replay after every deploy, which was explicitly deferred.
  const src = read("../../web/src/helpseen.ts");
  assert.match(src, /"gamenight\.seen\.help\.signedout"/);
  assert.match(src, /"gamenight\.seen\.help\.home"/);
  // Comments stripped first: this file EXPLAINS that it stays out of the cache's
  // PREFIX, so a scan of the raw text would match the explanation and fail on a
  // file that is correct.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  assert.doesNotMatch(code, /writeCache|readCache|PREFIX/, "these must not ride the cache namespace");
  // And it reuses the probe rather than writing a second one.
  assert.match(src, /import \{ probedStorage \} from "\.\/cache"/);
});

test("TWO SURFACES, TWO KEYS, and opening settles both", () => {
  // Somebody who saw it on the login screen has since typed a six-digit code and
  // landed somewhere that looks nothing like it. One flag would let the first
  // sighting silence the second.
  const src = read("../../web/src/helpseen.ts");
  assert.match(src, /signedOut:/);
  assert.match(src, /home:/);
  const all = src.slice(src.indexOf("export function markAllHelpSeen"));
  assert.match(all, /markHelpSeen\("signedOut"\)/);
  assert.match(all, /markHelpSeen\("home"\)/);
});

test("THE CUE IS DECIDED ONCE ON MOUNT, or every re-render restarts it", () => {
  // A lazy initializer runs on the first render and never again. Computing it
  // in the render body would re-apply the class on every re-render of Home, and
  // reading it at module scope would freeze it at whatever was true at boot,
  // which is the exact shape that has already bitten this app once.
  const src = read("../../web/src/HelpModal.tsx");
  assert.match(src, /useState\(\(\) => shouldCueHelp\(surface\)\)/);
  const top = src.slice(0, src.indexOf("export function HelpButton"));
  assert.doesNotMatch(top, /shouldCueHelp\(/, "the flag must not be read at module scope");
});

test("A TIMER RATHER THAN animationend, because that event never fires for some", () => {
  // Under reduced motion the rule is `animation: none`, so `animationend` never
  // fires. A flag written only on that event would leave the one group of people
  // who cannot be shown movement looking at the marker for ever.
  const src = read("../../web/src/HelpModal.tsx");
  assert.match(src, /setTimeout\(\(\) => markHelpSeen\(surface\), CUE_MS\)/);
  assert.doesNotMatch(src, /onAnimationEnd/);
  assert.match(src, /return \(\) => clearTimeout\(t\)/, "an unmounted button must not still write");
});

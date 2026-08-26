// THE FIELD, AND THE ONE DECISION THAT MATTERS MOST IN IT.
//
// FREE TEXT IS THE COMMON PATH, NOT THE FALLBACK. Most game nights are at
// somebody's house and a house is not in OpenStreetMap, so "use what I typed" is
// what most hosts will choose most of the time. That makes it a NORMAL ROW ON
// EVERY SEARCH, including the successful ones, styled exactly like the results
// above it. The way this ships wrong is subtle and would look reasonable in
// review: gate the row on `results.length === 0`, and it becomes an error state
// that appears only when the app has failed to help, which tells a host that
// typing "Dave's place" was a mistake. It is not. It is the answer.
//
// Source assertions, the same split live-status.test.ts uses: the behaviour is a
// browser one and was verified on-device against the built bundle in both themes
// (a hit, a miss, a pick, an unpick, the unavailable line, and two racing
// requests collapsing to one upstream query). What a test can hold still is that
// the pieces stay wired the way that run proved out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = () => read("../../web/src/PlaceSearch.tsx");

/**
 * The component with its comments removed.
 *
 * Needed because this component EXPLAINS the things it must not do ("no warning
 * colour", "no retry button"), so a scan of the raw text would match the
 * explanation and fail on a file that is correct. A test that cannot tell prose
 * from code is not testing the code.
 */
const code = () => src().replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

// ---------- free text is an equal option ----------

test("THE USE-AS-TYPED ROW IS BUILT UNCONDITIONALLY, not when the search fails", () => {
  const s = src();
  const rows = s.slice(s.indexOf("const rows:"), s.indexOf("const open ="));
  assert.match(rows, /\.\.\.results\.map/, "the results come first");
  assert.match(rows, /key: "as-typed"/, "and the typed row is always appended");
  // The shape that would turn it into an error state.
  assert.doesNotMatch(
    rows,
    /results\.length === 0|!results\.length|results\.length \?/,
    "the typed row must not be conditional on the search having failed",
  );
});

test("it is the same row component as a result, so it cannot read as a warning", () => {
  // Same class, same two lines, no danger token anywhere in the file.
  const s = src();
  assert.equal(
    (s.match(/className=\{`gn-places__row/g) ?? []).length,
    1,
    "there must be exactly one row renderer, shared by results and the typed row",
  );
  assert.doesNotMatch(code(), /gn-danger|--gn-no\b/, "nothing here may look like a failure");
});

// ---------- newest wins ----------

test("A SLOW EARLIER RESPONSE CANNOT OVERWRITE A NEWER ONE", () => {
  // Two mechanisms and both earn their place: the abort stops a stale request
  // arriving at all, the sequence number guarantees the order of what does.
  const s = src();
  assert.match(s, /const seq = useRef\(0\)/);
  assert.match(s, /const mine = \+\+seq\.current/);
  assert.equal(
    (s.match(/if \(mine !== seq\.current\) return;/g) ?? []).length,
    2,
    "both the success and the failure path must check the sequence",
  );
  assert.match(s, /inflight\.current\?\.abort\(\)/);
  assert.match(s, /new AbortController\(\)/);
  assert.match(s, /signal: controller\.signal/);
});

test("AN ABORT IS NOT A FAILURE, or a fast typist sees the unavailable line flash", () => {
  // The catch path runs on abort too. Without the sequence guard above it, every
  // superseded request would set `unavailable` and the field would flicker into
  // its degraded state while somebody was still typing.
  const s = src();
  const cat = s.slice(s.indexOf(".catch(("), s.indexOf("}, DEBOUNCE_MS)"));
  assert.match(cat, /if \(mine !== seq\.current\) return;/);
  assert.ok(
    cat.indexOf("if (mine !== seq.current) return;") < cat.indexOf("setUnavailable(true)"),
    "the sequence check must come before the field degrades",
  );
});

test("the debounce is a courtesy and the cleanup actually cancels it", () => {
  const s = src();
  assert.match(s, /const DEBOUNCE_MS = 300;/);
  assert.match(s, /return \(\) => clearTimeout\(timer\);/, "a timer nobody clears is not a debounce");
  assert.match(s, /useEffect\(\(\) => \(\) => inflight\.current\?\.abort\(\), \[\]\)/, "unmount must abort too");
});

test("a query under the floor never leaves the browser either", () => {
  // The server refuses it anyway; not sending it is what keeps the field quiet
  // while somebody is still typing the first word.
  const s = src();
  assert.match(s, /const MIN_QUERY = 3;/);
  assert.match(s, /query\.length >= MIN_QUERY/);
});

// ---------- degrade, never break ----------

test("UNAVAILABLE IS ONE QUIET LINE, with nothing to do about it", () => {
  const s = src();
  assert.match(s, /className="gn-hint"/);
  assert.match(s, /still works/, "it must say the field is not broken");
  assert.doesNotMatch(code(), /<button[^>]*>[^<]*(retry|try again)/i, "there is nothing for the host to retry");
  // And the list is not offered at all when search is not answering.
  assert.match(s, /const open = searchable && !dismissed && !unavailable;/);
});

test("the typed text is always the value, so ignoring the list changes nothing", () => {
  // This is a field with suggestions under it, not a picker that owns the field.
  // A host who never looks at the list gets exactly the input they had before.
  const s = src();
  assert.match(s, /value=\{value\}/);
  assert.match(s, /onChange\(e\.target\.value\)/);
});

// ---------- attribution ----------

test("OPENSTREETMAP IS CREDITED IN THE LIST, because ODbL requires it", () => {
  // A licence term rather than a nicety, and in the list because that is where
  // the data is. As a row, so a layout change cannot quietly drop a caption.
  const s = src();
  assert.match(s, /Places from OpenStreetMap contributors/);
  assert.match(s, /className="gn-places__attr"/);
  assert.ok(s.indexOf("gn-places__attr") > s.indexOf("<ul className=\"gn-places\""), "inside the list");
});

// ---------- the two client details that were already load-bearing ----------

test("the search box is still a .gn-input, which is the iOS zoom rule", () => {
  // Any focused text field under 16px makes iOS Safari zoom the page and often
  // not zoom back. .gn-input carries the 16px floor; a bespoke box would not.
  assert.match(src(), /className="gn-input"/);
});

test("THE LIST IS MADE OF THE FIELD'S TOKENS, not the card's", () => {
  // --gn-input-edge is --gn-line in Arcade and TRANSPARENT in Tabletop, where a
  // field is a sunk shadow against the felt and has no outline at all. A list
  // built from card tokens would read as attached to the input in one theme and
  // as a panel floating over the cloth in the other. Verified on-device: the
  // list's border resolves identically to the field's in both themes.
  const css = read("../../web/src/index.css");
  const block = css.slice(css.indexOf(".gn-places{"), css.indexOf(".gn-places__row{"));
  assert.match(block, /background:var\(--gn-input-fill\)/);
  assert.match(block, /border:2px solid var\(--gn-input-edge\)/);
  assert.match(block, /box-shadow:var\(--gn-input-sunk\)/);
  assert.doesNotMatch(block, /--gn-surf|--gn-card/, "card tokens would float it in Tabletop");
});

test("no hardcoded colour anywhere in the component", () => {
  // Standing rule: gn-* tokens only. A Tailwind colour utility here would be
  // invisible to the theme sweep's route pass and unthemed in Tabletop.
  const s = src();
  assert.doesNotMatch(s, /\b(bg|text|border)-(slate|gray|zinc|red|blue|green|amber|yellow|purple)-\d{2,3}\b/);
  assert.doesNotMatch(s, /#[0-9a-fA-F]{3,8}\b/, "no hex literals in a component");
});

// ---------- what the pick does ----------

test("PICKING FILLS THE LABEL, THE PIN AND THE LINK; typed fills only the label", () => {
  const page = read("../../web/src/pages/EventPage.tsx");
  const pick = page.slice(page.indexOf("onPick={(place)"), page.indexOf("onUnpick={"));
  assert.match(pick, /setLocDraft\(place\.name\)/);
  assert.match(pick, /setPicked\(place\)/);
  assert.match(pick, /setUrlDraft\(mapUrlFor\(place\.lat, place\.lng\)\)/, "the link comes off the pin");
  // The typed row touches nothing but the list's own visibility, so the three
  // place columns stay null exactly as free text requires.
  const s = src();
  const typed = s.slice(s.indexOf('key: "as-typed"'), s.indexOf("];"));
  assert.doesNotMatch(typed, /onPick|setUrlDraft/, "using what you typed must not invent a pin");
});

test("SAVE ALWAYS SENDS ALL THREE, or yesterday's pin outlives today's label", () => {
  // The route is partial by design, so omitting them would leave the pub's
  // coordinates attached to a night the host has renamed "Dave's place", and
  // nothing on screen would say so.
  const page = read("../../web/src/pages/EventPage.tsx");
  const save = page.slice(page.indexOf("async function saveWhere"), page.indexOf("Stop the series"));
  assert.match(save, /locationLat: picked\?\.lat \?\? null/);
  assert.match(save, /locationLng: picked\?\.lng \?\? null/);
  assert.match(save, /locationRef: picked\?\.ref \?\? null/);
});

test("unpicking gives a way back, and does not eat a hand-typed link", () => {
  const page = read("../../web/src/pages/EventPage.tsx");
  const un = page.slice(page.indexOf("onUnpick={"), page.indexOf("<textarea"));
  assert.match(
    un,
    /urlDraft === mapUrlFor\(picked\.lat, picked\.lng\)/,
    "only a link this app derived may be cleared on unpick",
  );
  assert.match(src(), />\s*change\s*<\/button>/, "a picked place with no way out is a trap");
});

test("THE READ VIEW IS UNTOUCHED, which was the explicit scope line", () => {
  // This feature changes how two fields get FILLED, not how they are shown.
  const page = read("../../web/src/pages/EventPage.tsx");
  assert.match(page, /rel="noopener noreferrer"/);
  assert.match(page, /isHttpsUrl\(event\.locationUrl\)/);
  assert.match(page, /className="gn-where"/);
  assert.match(page, /\{event\.location \|\| "Open map"\}/);
});

function read(rel: string): string {
  return readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), rel), "utf8");
}

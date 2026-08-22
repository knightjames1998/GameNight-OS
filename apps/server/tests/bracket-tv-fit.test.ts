// The two bracketed TVs' density ladders.
//
// THE BUG THESE GUARD: neither /tv/:id nor /beerio/tv/:code has ever fitted a
// 1080p television. Measured the first day anything measured them (2026-08-15),
// at 1920x1080 against the lowest painted pixel: the shell's ran 1548px and
// Beerio's 1662px at sixteen entrants, and both were over at EVERY count,
// because their columns were capped lists whose height had nothing to do with
// the roster. A TV cannot be scrolled, so past 1080 is gone rather than below
// the fold. Fixed by a band computed in apps/web/src/pages/tv-band.ts and
// apps/web/src/beerio/band.ts and spent as CSS variable overrides, the same
// shape the casino money board already uses.
//
// THREE KINDS OF CHECK LIVE HERE, and they cover the three ways this rots.
//
// 1. THE LADDERS THEMSELVES, pure functions, testable with no browser. That is
//    why they were pulled out of their components instead of being ternaries.
//
// 2. THAT THE COMPONENTS ACTUALLY EMIT THE ATTRIBUTE. The silent failure: a
//    ladder that exists in CSS and is never applied throws nothing, logs
//    nothing and renders a screen exactly as broken as before.
//
// 3. THAT NO BAND UNDERCUTS THE TYPE FLOOR, read off the stylesheets. The floor
//    is the one number in this whole pass that a person has to be trusted with,
//    so it is the one thing asserted mechanically: a future band tuned to make
//    something fit cannot buy the space out of a player's name.
//
// What is NOT here is the fit itself, deliberately, and for the same reason
// money-board-fit.test.ts says: whether sixteen racers land inside 1080px is a
// question about a rendered layout at a real font, and the only honest way to
// answer it is to drive a browser over the real built bundle. That is
// scripts/tv-fit.mjs, which measures both screens at 4, 8, 12 and 16 in four
// states and carries its own negative control.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TV_BANDS,
  TV_DECK_SLICE,
  TV_MEASURED_TO,
  TV_NAME_FLOOR_VMIN,
  bracketTvBand,
  type TvBand,
  type TvLoad,
  bracketChipBand,
} from "../../web/src/pages/tv-band.js";
import {
  BEERIO_DECK_SLICE,
  BEERIO_MAX_RACERS,
  BEERIO_NAME_FLOOR_VW,
  BEERIO_QR_PX,
  BEERIO_TV_BANDS,
  beerioTvBand,
  type BeerioTvBand,
  type BeerioTvLoad,
} from "../../web/src/beerio/band.js";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../web/src");
const read = (rel: string) => readFileSync(path.join(WEB, rel), "utf8");

const shellRung = (b: TvBand) => TV_BANDS.indexOf(b);
const beerioRung = (b: BeerioTvBand) => BEERIO_TV_BANDS.indexOf(b);

/** Every combination of optional blocks each screen can carry. */
const SHELL_EXTRAS: Partial<TvLoad>[] = [{}, { gfNote: true }];
const BEERIO_EXTRAS: Partial<BeerioTvLoad>[] = [{}, { predictions: true }];

// ---------- both ladders are ladders ----------

test("both ladders are ordered roomiest to tightest, and the names are distinct", () => {
  // The ordering is what every monotonicity check below is expressed in terms
  // of, so a reordered array would quietly invert all of them.
  assert.deepEqual([...TV_BANDS], ["roomy", "close", "tight", "packed"]);
  assert.deepEqual([...BEERIO_TV_BANDS], ["roomy", "close", "tight", "packed"]);
  assert.equal(new Set(TV_BANDS).size, TV_BANDS.length);
  assert.equal(new Set(BEERIO_TV_BANDS).size, BEERIO_TV_BANDS.length);
});

test("every load returns a band that is actually on the ladder", () => {
  for (const extra of SHELL_EXTRAS) {
    for (let entrants = 0; entrants <= 40; entrants++) {
      for (const ready of [0, 1, 4, 8, 20]) {
        const band = bracketTvBand({ entrants, ready, ...extra });
        assert.ok(TV_BANDS.includes(band), `${entrants}/${ready} gave ${band}`);
      }
    }
  }
  for (const extra of BEERIO_EXTRAS) {
    for (let entrants = 0; entrants <= 40; entrants++) {
      for (const ready of [0, 1, 4, 8, 20]) {
        const band = beerioTvBand({ entrants, ready, ...extra });
        assert.ok(BEERIO_TV_BANDS.includes(band), `${entrants}/${ready} gave ${band}`);
      }
    }
  }
});

test("an empty bracket still gets a band", () => {
  // A bracket with nothing in it is a real screen: it renders the waiting state
  // inside the same columns, so the attribute has to be there for the CSS to
  // have anything to hang off.
  assert.equal(bracketTvBand({ entrants: 0, ready: 0 }), "roomy");
  assert.equal(beerioTvBand({ entrants: 0, ready: 0 }), "roomy");
});

// ---------- monotonicity, which is the property that makes this safe ----------

test("THE LADDERS ARE MONOTONIC IN THE ROSTER: more people never buys a roomier band", () => {
  // A band that got roomier as the night got bigger would be content off the
  // bottom of a television, and it would only show at one specific count, which
  // is exactly the sort of thing nobody notices until sixteen people are round.
  for (const extra of SHELL_EXTRAS) {
    for (let n = 1; n <= 40; n++) {
      const prev = bracketTvBand({ entrants: n - 1, ready: 4, ...extra });
      const here = bracketTvBand({ entrants: n, ready: 4, ...extra });
      assert.ok(shellRung(here) >= shellRung(prev), `shell ${n - 1}->${n}: ${prev} -> ${here}`);
    }
  }
  for (const extra of BEERIO_EXTRAS) {
    for (let n = 1; n <= 40; n++) {
      const prev = beerioTvBand({ entrants: n - 1, ready: 4, ...extra });
      const here = beerioTvBand({ entrants: n, ready: 4, ...extra });
      assert.ok(beerioRung(here) >= beerioRung(prev), `beerio ${n - 1}->${n}: ${prev} -> ${here}`);
    }
  }
});

test("THE LADDERS ARE MONOTONIC IN THE ON-DECK COLUMN TOO", () => {
  for (let ready = 1; ready <= 20; ready++) {
    for (const n of [4, 8, 12, 16]) {
      const prev = bracketTvBand({ entrants: n, ready: ready - 1 });
      const here = bracketTvBand({ entrants: n, ready });
      assert.ok(shellRung(here) >= shellRung(prev), `shell ready ${ready - 1}->${ready} at ${n}`);
      const bp = beerioTvBand({ entrants: n, ready: ready - 1 });
      const bh = beerioTvBand({ entrants: n, ready });
      assert.ok(beerioRung(bh) >= beerioRung(bp), `beerio ready ${ready - 1}->${ready} at ${n}`);
    }
  }
});

test("turning an optional block on never buys a roomier band either", () => {
  // The grand-final note and the crowd bars draw on the same 1080px as
  // everything else, so switching one on can only ever tighten.
  for (const n of [0, 4, 8, 12, 16]) {
    for (const ready of [0, 2, 4, 8]) {
      assert.ok(
        shellRung(bracketTvBand({ entrants: n, ready, gfNote: true })) >=
          shellRung(bracketTvBand({ entrants: n, ready })),
        `shell gfNote made ${n}/${ready} roomier`,
      );
      assert.ok(
        beerioRung(beerioTvBand({ entrants: n, ready, predictions: true })) >=
          beerioRung(beerioTvBand({ entrants: n, ready })),
        `beerio predictions made ${n}/${ready} roomier`,
      );
    }
  }
});

// ---------- the boundaries that were measured ----------

test("THE SHELL'S BOUNDARIES LAND WHERE THEY WERE MEASURED: 4, 8, 12 and 16", () => {
  // A ladder proved at its endpoints and not in the middle is a ladder proved
  // nowhere, which is why the harness measures all four counts. These pin the
  // rungs those measurements were taken against.
  assert.equal(bracketTvBand({ entrants: 4, ready: 2 }), "roomy");
  assert.equal(bracketTvBand({ entrants: 8, ready: 4 }), "close");
  assert.equal(bracketTvBand({ entrants: 12, ready: 4 }), "tight");
  assert.equal(bracketTvBand({ entrants: 16, ready: 8 }), "tight");
});

test("BEERIO'S BOUNDARIES LAND WHERE THEY WERE MEASURED, with and without crowd bars", () => {
  // WITH THE BARS IS THE CASE THAT MATTERS: they are 90px on every card and
  // they are up on exactly the nights people are watching. A ladder tuned
  // against a card with no votes would be wrong when it matters most.
  assert.equal(beerioTvBand({ entrants: 4, ready: 2 }), "roomy");
  assert.equal(beerioTvBand({ entrants: 4, ready: 4, predictions: true }), "tight");
  assert.equal(beerioTvBand({ entrants: 8, ready: 4 }), "close");
  assert.equal(beerioTvBand({ entrants: 8, ready: 4, predictions: true }), "tight");
  assert.equal(beerioTvBand({ entrants: 16, ready: 8, predictions: true }), "tight");
});

test("a roster past what was measured clamps to the tightest band", () => {
  // Rather than walking off the end of the ceilings into a band nobody has
  // metrics for. THE SHELL'S BRACKET HAS NO ROSTER CAP: its entrants come off
  // the yes-RSVP list, so past-the-end is reachable through the app rather than
  // being a defensive flourish. Beerio caps itself at MAX_PLAYERS, which is
  // exactly why past-the-end must not be the case nobody thought about.
  const shellFloor = TV_BANDS[TV_BANDS.length - 1];
  const beerioFloor = BEERIO_TV_BANDS[BEERIO_TV_BANDS.length - 1];
  for (const n of [TV_MEASURED_TO + 1, 24, 64, 10000]) {
    assert.equal(bracketTvBand({ entrants: n, ready: 0 }), shellFloor, `shell at ${n}`);
  }
  for (const n of [BEERIO_MAX_RACERS + 1, 20, 10000]) {
    assert.equal(beerioTvBand({ entrants: n, ready: 0 }), beerioFloor, `beerio at ${n}`);
  }
});

test("garbage in still gets the tightest band, not a crash and not a roomy one", () => {
  const shellFloor = TV_BANDS[TV_BANDS.length - 1];
  const beerioFloor = BEERIO_TV_BANDS[BEERIO_TV_BANDS.length - 1];
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(bracketTvBand({ entrants: bad, ready: 4 }), shellFloor);
    assert.equal(bracketTvBand({ entrants: 8, ready: bad }), shellFloor);
    assert.equal(beerioTvBand({ entrants: bad, ready: 4 }), beerioFloor);
    assert.equal(beerioTvBand({ entrants: 8, ready: bad }), beerioFloor);
  }
  // Negative counts are nonsense but not dangerous: nothing renders.
  assert.equal(bracketTvBand({ entrants: -5, ready: -5 }), "roomy");
  assert.equal(beerioTvBand({ entrants: -5, ready: -5 }), "roomy");
});

// ---------- the slices ----------

test("the on-deck slice never grows as the ladder tightens, and never exceeds four", () => {
  // It was FIVE on the shell and five never fitted at any count in any state:
  // five cards is 1114px into a 646px column. Four is the cap, and the heading
  // beside the column always says how many are actually ready, so the count is
  // honest even when the list is cut.
  for (const bands of [TV_BANDS] as const) {
    for (let i = 1; i < bands.length; i++) {
      assert.ok(
        TV_DECK_SLICE[bands[i]!] <= TV_DECK_SLICE[bands[i - 1]!],
        `shell slice grew from ${bands[i - 1]} to ${bands[i]}`,
      );
    }
  }
  for (let i = 1; i < BEERIO_TV_BANDS.length; i++) {
    assert.ok(
      BEERIO_DECK_SLICE[BEERIO_TV_BANDS[i]!] <= BEERIO_DECK_SLICE[BEERIO_TV_BANDS[i - 1]!],
      `beerio slice grew from ${BEERIO_TV_BANDS[i - 1]} to ${BEERIO_TV_BANDS[i]}`,
    );
  }
  for (const b of TV_BANDS) assert.ok(TV_DECK_SLICE[b] >= 1 && TV_DECK_SLICE[b] <= 4);
  for (const b of BEERIO_TV_BANDS) assert.ok(BEERIO_DECK_SLICE[b] >= 1 && BEERIO_DECK_SLICE[b] <= 4);
});

test("the QR never grows as the ladder tightens, and never gets too small to scan", () => {
  // It is a React prop rather than a CSS property, so a CSS override cannot
  // reach it and the ladder has to hand it over. 96px was checked on the
  // rendered page rather than assumed.
  for (let i = 1; i < BEERIO_TV_BANDS.length; i++) {
    assert.ok(BEERIO_QR_PX[BEERIO_TV_BANDS[i]!] <= BEERIO_QR_PX[BEERIO_TV_BANDS[i - 1]!]);
  }
  for (const b of BEERIO_TV_BANDS) assert.ok(BEERIO_QR_PX[b] >= 96, `${b} QR is under 96px`);
});

// ---------- that the components apply it ----------

test("BOTH TVs COMPUTE A BAND AND PUT IT ON THE SCREEN", () => {
  const shell = read("pages/TvPage.tsx");
  assert.ok(shell.includes("bracketTvBand("), "TvPage.tsx does not call bracketTvBand");
  assert.ok(/data-band=\{/.test(shell), "TvPage.tsx computes a band but never renders data-band");
  const beerio = read("beerio/BeerioTvPage.tsx");
  assert.ok(beerio.includes("beerioTvBand("), "BeerioTvPage.tsx does not call beerioTvBand");
  assert.ok(/data-band=\{/.test(beerio), "BeerioTvPage.tsx computes a band but never renders data-band");
});

test("each band is fed BOTH columns' load, not just the roster", () => {
  // The measured finding these ladders turn on: the two columns sit side by
  // side and grow on different axes, so a band computed from the entrant count
  // alone fits the board and overflows the on-deck stack. If somebody
  // simplifies either call back down to one argument, the other column breaks
  // and nothing says so.
  const shellCall = /bracketTvBand\(\{([\s\S]*?)\n\s*\}\);/.exec(read("pages/TvPage.tsx"));
  assert.ok(shellCall, "could not find the bracketTvBand({...}) call in TvPage.tsx");
  for (const key of ["entrants", "ready", "gfNote"]) {
    assert.ok(shellCall[1]!.includes(key), `TvPage passes no ${key} to bracketTvBand`);
  }
  const beerioCall = /beerioTvBand\(\{([\s\S]*?)\n\s*\}\);/.exec(read("beerio/BeerioTvPage.tsx"));
  assert.ok(beerioCall, "could not find the beerioTvBand({...}) call in BeerioTvPage.tsx");
  for (const key of ["entrants", "ready", "predictions"]) {
    assert.ok(beerioCall[1]!.includes(key), `BeerioTvPage passes no ${key} to beerioTvBand`);
  }
});

test("the slice is spent, not just exported", () => {
  // A slice constant nothing reads is a five-card column with a comment
  // claiming it is four.
  assert.ok(read("pages/TvPage.tsx").includes("TV_DECK_SLICE[band]"));
  assert.ok(read("beerio/BeerioTvPage.tsx").includes("BEERIO_DECK_SLICE[band]"));
});

test("every band on both ladders has metrics in its stylesheet", () => {
  // The other half of the same silent failure: a band the TS can return and the
  // CSS has never heard of renders at the base metrics, which is the broken
  // screen. `roomy` is exempt on both: it IS the base block, by design.
  const css = read("index.css");
  for (const band of TV_BANDS) {
    if (band === "roomy") continue;
    assert.ok(
      css.includes(`.gn-tv[data-band="${band}"]`),
      `bracketTvBand can return "${band}" and index.css has no rules for it`,
    );
  }
  const beerio = read("beerio/beerio.css");
  for (const band of BEERIO_TV_BANDS) {
    if (band === "roomy") continue;
    assert.ok(
      beerio.includes(`.beerio-tv[data-band="${band}"]`),
      `beerioTvBand can return "${band}" and beerio.css has no rules for it`,
    );
  }
});

// ---------- the type floor ----------

/** Every value a custom property is given anywhere in a stylesheet. */
function declared(css: string, prop: string): number[] {
  const out: number[] = [];
  for (const m of css.matchAll(new RegExp(`${prop}\\s*:\\s*([0-9.]+)(vmin|vw)`, "g"))) {
    out.push(Number(m[1]));
  }
  return out;
}

test("NO BAND PUTS A PERSON'S NAME UNDER THE TYPE FLOOR", () => {
  // THE ONE NUMBER IN THIS PASS SOMEBODY HAS TO BE TRUSTED WITH, so it is the
  // one asserted mechanically. 2.2vmin is 23.8px on a 1080p screen and 1.25vw
  // is 24px on a 1920 one: the same physical size, and the size the casino
  // money board's tightest band has put a player's name at since 2026-08-02.
  // A future band tuned to make something fit must not buy the room out of a
  // name; there are gaps, paddings and a QR code to spend first.
  const css = read("index.css");
  for (const prop of ["--gn-tv-nm", "--gn-tv-chip"]) {
    const values = declared(css, prop);
    assert.ok(values.length >= TV_BANDS.length - 0, `${prop} is not declared in every band`);
    for (const v of values) {
      assert.ok(v >= TV_NAME_FLOOR_VMIN, `${prop}: ${v}vmin is under the ${TV_NAME_FLOOR_VMIN}vmin floor`);
    }
  }
  const beerio = read("beerio/beerio.css");
  for (const prop of ["--bt-nm", "--bt-chip"]) {
    const values = declared(beerio, prop);
    assert.ok(values.length >= BEERIO_TV_BANDS.length, `${prop} is not declared in every band`);
    for (const v of values) {
      assert.ok(v >= BEERIO_NAME_FLOOR_VW, `${prop}: ${v}vw is under the ${BEERIO_NAME_FLOOR_VW}vw floor`);
    }
  }
});

test("the floor check can actually see a violation", () => {
  // A guard that scans for nothing passes silently forever, which is this
  // repo's most-repeated lesson. These are the shapes that matter.
  assert.deepEqual(declared("x{--gn-tv-nm: 2.5vmin}", "--gn-tv-nm"), [2.5]);
  assert.deepEqual(declared("a{--bt-nm:1.9vw}b{--bt-nm: .9vw}", "--bt-nm"), [1.9, 0.9]);
  assert.ok(declared("a{--bt-nm: .9vw}", "--bt-nm").some((v) => v < BEERIO_NAME_FLOOR_VW));
  assert.ok(declared("a{--gn-tv-chip:2vmin}", "--gn-tv-chip").some((v) => v < TV_NAME_FLOOR_VMIN));
});

test("the floors on the two screens are the same physical size", () => {
  // One floor across three TVs rather than three arguments. On a 1920x1080
  // screen vmin is 10.8px and vw is 19.2px, so 2.2vmin is 23.76px and 1.25vw
  // is 24px. If somebody moves one, this says the other has drifted.
  const shellPx = TV_NAME_FLOOR_VMIN * 10.8;
  const beerioPx = BEERIO_NAME_FLOOR_VW * 19.2;
  assert.ok(
    Math.abs(shellPx - beerioPx) < 1,
    `the floors have drifted apart: ${shellPx.toFixed(1)}px vs ${beerioPx.toFixed(1)}px at 1920x1080`,
  );
});

// ---------- the chip cap, added 2026-08-22 with the sixteen-pairs fix ----------
//
// THE ALIVE BOARD'S OVERFLOW AT SIXTEEN PAIRS IS A WIDTH PROBLEM, not a slot
// count one, which is why it needed a THIRD answer rather than a tighter rung
// on the existing two. Measured: sixteen SOLO fits, eight PAIRS fits in all
// four states, sixteen PAIRS runs 229px over fresh and 297 mid and late.
//
// The tests below pin the two things that went wrong while building it, both
// caught by measuring rather than by reasoning, and both the same mistake:
// spending a cap on a board that did not need one.

test("the chip cap NEVER fires on a solo board, at any count", () => {
  // A solo label is one display name. Sixteen solo already sits at "tight" on
  // entrant count and was never the broken case: an early draft folded the chip
  // rung into bracketTvBand, and the tight block's cap started ellipsising
  // 24-character solo names to fix a screen they are not on.
  for (const n of [4, 8, 12, 16, 24]) {
    assert.equal(bracketChipBand(n, 24), "roomy", `${n} solo entrants should never cap chips`);
  }
});

test("the chip cap NEVER fires at eight entrants or fewer, however long the label", () => {
  // Eight pairs was MEASURED fitting in all four states. A second draft keyed
  // the cap on label length alone and truncated eight pairs to fix sixteen,
  // which is the same trade one count over.
  for (const n of [2, 4, 6, 8]) {
    assert.equal(bracketChipBand(n, 52), "roomy", `${n} entrants should never cap chips`);
  }
});

test("the chip cap DOES fire on a big doubles board, which is the case it exists for", () => {
  assert.notEqual(bracketChipBand(16, 52), "roomy");
  assert.notEqual(bracketChipBand(12, 52), "roomy");
});

test("the chip cap is monotonic in the label length", () => {
  // A longer label never buys a roomier cap.
  let prev = -1;
  for (const chars of [10, 20, 26, 30, 34, 40, 44, 60, 200]) {
    const i = TV_BANDS.indexOf(bracketChipBand(16, chars));
    assert.ok(i >= prev, `label of ${chars} chars loosened the cap`);
    prev = i;
  }
});

test("garbage label length gets the roomiest cap rather than a crash", () => {
  // Roomiest, not tightest, and that is deliberate: an unknown label length is
  // not evidence that a board is wide, and capping on no evidence truncates
  // names for nothing. The BAND still clamps tight on garbage; this one clamps
  // the other way because the failure it prevents is different.
  assert.equal(bracketChipBand(16, undefined), "roomy");
  assert.equal(bracketChipBand(16, NaN), "roomy");
  assert.equal(bracketChipBand(NaN, 52), "roomy");
});

test("TvPage emits data-chip, or the cap exists in CSS and is never applied", () => {
  const shell = read("pages/TvPage.tsx");
  assert.ok(shell.includes("bracketChipBand("), "TvPage.tsx does not call bracketChipBand");
  assert.ok(/data-chip=\{/.test(shell), "TvPage.tsx computes a chip band but never renders data-chip");
});

test("every chip rung the ladder can return has rules in index.css", () => {
  const css = read("index.css");
  for (const band of TV_BANDS) {
    // "roomy" is the base block's 100%, which is the whole point of it: a solo
    // board renders exactly as it did before this feature existed.
    if (band === "roomy") continue;
    assert.ok(
      css.includes(`.gn-tv[data-chip="${band}"]`),
      `bracketChipBand can return "${band}" and index.css has no rules for it`,
    );
  }
  assert.ok(css.includes("--gn-tv-chip-max"), "the chip cap variable is gone from index.css");
});

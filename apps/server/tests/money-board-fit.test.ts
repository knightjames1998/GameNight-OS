// The casino TV money board's density ladder.
//
// THE BUG THIS GUARDS: the board's height was linear in the seat count while a
// 1080p screen is not, so from six players up the footer, the back button and
// the bottom lines of the board were simply off the bottom of the television.
// A TV cannot be scrolled, so "below the fold" means gone. Fixed 2026-08-02 by
// a band computed in apps/web/src/casino/band.ts and spent as CSS overrides in
// casino.css, the same shape ModifierWall already uses.
//
// TWO DIFFERENT CHECKS LIVE HERE, and they cover the two ways this can rot.
//
// 1. THE LADDER ITSELF, which is a pure function and therefore testable with no
//    browser at all. That is why it was pulled out of the component instead of
//    being an inline ternary.
//
// 2. THAT THE COMPONENT ACTUALLY EMITS THE ATTRIBUTE. This is the silent
//    failure: a ladder that exists in CSS and is never applied throws nothing,
//    logs nothing and renders a board that is exactly as broken as before. A
//    source-shape assertion in the style of pack-screens.test.ts, and for the
//    same reason: it catches the regression on the day somebody refactors the
//    component rather than whenever a person next points a browser at a TV.
//
// What is NOT here is the fit itself, and that is deliberate. Whether 12 lines
// land inside 1080px is a question about a rendered layout at a real font, and
// the only honest way to answer it is to drive a browser over the real built
// bundle, which is what was done to derive every number in casino.css. Asserting
// it here would be asserting arithmetic about pixels this process cannot see.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOARD_BANDS,
  MAX_SEATS,
  moneyBoardBand,
  type BoardBand,
  type BoardLoad,
} from "../../web/src/casino/band.js";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../web/src");

/** Where a band sits on the ladder. Higher is tighter. */
const rung = (b: BoardBand) => BOARD_BANDS.indexOf(b);

/** Every combination of optional blocks a casino TV can carry. */
const LOADS: BoardLoad[] = [
  {},
  { hero: true },
  { warning: true },
  { rules: true },
  { hero: true, warning: true },
  { hero: true, rules: true },
  { warning: true, rules: true },
  { hero: true, warning: true, rules: true },
];

// ---------- the ladder ----------

test("every seat count from 0 to 12 and beyond returns a real band", () => {
  for (const load of LOADS) {
    for (let seats = 0; seats <= 40; seats++) {
      const band = moneyBoardBand(seats, load);
      assert.ok(
        BOARD_BANDS.includes(band),
        `${seats} seats with ${JSON.stringify(load)} returned ${band}, which is not on the ladder`,
      );
    }
  }
});

test("a board with no players at all still gets a band", () => {
  // The empty board is a real screen: it renders the "nobody at the table yet"
  // hint inside .cg-tv__board, so the attribute has to be there for the CSS to
  // have anything to hang off.
  assert.equal(moneyBoardBand(0), "roomy");
  assert.ok(BOARD_BANDS.includes(moneyBoardBand(0, { hero: true, warning: true, rules: true })));
});

test("THE LADDER IS MONOTONIC: more seats never buys a roomier band", () => {
  // The property that makes this safe. A band that got roomier as the board got
  // longer would be a footer off the bottom, and it would only show up at one
  // specific seat count, which is exactly the sort of thing nobody notices
  // until there are twelve people in the room.
  for (const load of LOADS) {
    for (let seats = 1; seats <= 40; seats++) {
      const prev = moneyBoardBand(seats - 1, load);
      const here = moneyBoardBand(seats, load);
      assert.ok(
        rung(here) >= rung(prev),
        `${seats - 1} seats gave ${prev} and ${seats} gave ${here}, which is roomier`,
      );
    }
  }
});

test("adding a block to the screen never buys a roomier band either", () => {
  // The same property on the other axis: the hero, the warning and the wall all
  // draw on the same 1080px, so turning one on can only ever tighten.
  for (let seats = 0; seats <= MAX_SEATS; seats++) {
    const bare = moneyBoardBand(seats, {});
    for (const load of LOADS) {
      assert.ok(
        rung(moneyBoardBand(seats, load)) >= rung(bare),
        `${seats} seats went from ${bare} to ${moneyBoardBand(seats, load)} on adding ${JSON.stringify(load)}`,
      );
    }
  }
});

test("a count past the table maximum clamps to the tightest band", () => {
  // Rather than falling off the end of the ceilings and returning undefined, or
  // walking off into a band nobody measured. Twelve is the table maximum and
  // the ladder was measured to exactly there.
  const tightest = BOARD_BANDS[BOARD_BANDS.length - 1];
  for (const seats of [MAX_SEATS + 1, 20, 100, 10000]) {
    for (const load of LOADS) {
      assert.equal(
        moneyBoardBand(seats, load),
        tightest,
        `${seats} seats should clamp to ${tightest}`,
      );
    }
  }
});

test("garbage in still gets the tightest band, not a crash and not a roomy one", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(moneyBoardBand(bad), BOARD_BANDS[BOARD_BANDS.length - 1]);
  }
  // A negative count is nonsense but it is not dangerous: nothing renders.
  assert.equal(moneyBoardBand(-5), "roomy");
});

test("FOUR PLAYERS ON A PLAIN BOARD STAY AT THE ROOMIEST BAND", () => {
  // James's one hard constraint on this fix: the common night must not get
  // worse. `roomy` is the metrics the board shipped with, so a four-player
  // blackjack or roulette TV reads exactly as large as it did before.
  assert.equal(moneyBoardBand(4), "roomy");
  assert.equal(moneyBoardBand(2), "roomy");
  // And a five-player one does not, which is where the old board started
  // hanging off the bottom.
  assert.notEqual(moneyBoardBand(5), "roomy");
});

test("the ladder reaches its floor at a full table carrying everything", () => {
  // 12 seats + the craps shooter panel + a balance warning + house rules is the
  // binding case the CSS was tuned against, and it must land on the band that
  // was tuned for it.
  assert.equal(
    moneyBoardBand(MAX_SEATS, { hero: true, warning: true, rules: true }),
    BOARD_BANDS[BOARD_BANDS.length - 1],
  );
});

// ---------- that the component applies it ----------

const read = (rel: string) => readFileSync(path.join(WEB, rel), "utf8");

test("MoneyBoard COMPUTES A BAND AND PUTS IT ON THE SCREEN", () => {
  const src = read("casino/MoneyBoard.tsx");
  assert.ok(
    src.includes("moneyBoardBand("),
    "MoneyBoard.tsx does not call moneyBoardBand. The ladder in casino.css would " +
      "then never match anything and the board is broken exactly as it was before.",
  );
  assert.ok(
    /data-band=\{/.test(src),
    "MoneyBoard.tsx computes a band but never renders data-band. The CSS ladder " +
      "keys off that attribute; without it every band selector is dead.",
  );
});

test("the band is fed the seat count AND the rest of the screen's load", () => {
  // The measured finding this fix turned on: the board is not alone on the
  // 1080px. The craps hero costs about two board lines and the balance warning
  // about one, so a band computed from the seat count alone fits a bare board
  // and overflows a craps table. If somebody simplifies this back down to
  // `moneyBoardBand(summary.players.length)`, craps breaks and nothing says so.
  const src = read("casino/MoneyBoard.tsx");
  const call = /moneyBoardBand\(([\s\S]*?)\n\s*\);/.exec(src);
  assert.ok(call, "could not find the moneyBoardBand(...) call in MoneyBoard.tsx");
  for (const key of ["players.length", "hero", "warning", "rules"]) {
    assert.ok(
      call[1]!.includes(key),
      `MoneyBoard passes no ${key} to moneyBoardBand. See band.ts for what each block costs.`,
    );
  }
});

test("every band on the ladder has metrics in casino.css", () => {
  // The other half of the same silent failure: a band the TS can return and the
  // CSS has never heard of renders at the base metrics, which is the broken
  // board. `roomy` is exempt: it IS the base metrics, by design.
  const css = read("casino/casino.css");
  for (const band of BOARD_BANDS) {
    if (band === "roomy") continue;
    assert.ok(
      css.includes(`[data-band="${band}"]`),
      `moneyBoardBand can return "${band}" and casino.css has no rules for it, so that ` +
        "band renders at the shipped metrics and runs off the bottom of a 1080p screen.",
    );
  }
});

test("the back button is on the ladder, because the fit is measured against it", () => {
  // The bottom of the LAST element is what has to be inside 1080, and that is
  // the back button under the footer, not the footer. Standing rule 4 wants a
  // way back on every screen, and one pushed off the bottom of a television is
  // the same as not having one. It carries a class rather than an inline style
  // so the band can trim its margin with everything else.
  const src = read("casino/MoneyBoard.tsx");
  assert.ok(
    src.includes('className="cg-tv__back"'),
    "the BackButton wrapper in MoneyBoard.tsx is not .cg-tv__back, so the ladder cannot reach it",
  );
  assert.ok(read("casino/casino.css").includes(".cg-tv__back"), "casino.css has no .cg-tv__back rule");
});

// ---------- a hero that GROWS with the table ----------
//
// Added 2026-08-17 with the poker pack. `HERO_LINES` was a flat 2 and that was
// right while craps was the only pack with a hero: a shooter panel is a fixed
// two lines whatever the night is doing. Poker's hero is a settlement that grows
// with the table, and a flat 2 understated it by three lines at a full one,
// which handed an eight-seat board a band that does not fit it (tv-fit measured
// it 73px over). So a pack whose hero grows now says how much it costs.

test("heroLines overrides the flat hero cost, and only when a hero is on", () => {
  // The default is untouched, which is what keeps craps and every other caller
  // on exactly the ladder they were measured against.
  assert.equal(moneyBoardBand(4, { hero: true }), moneyBoardBand(4, { hero: true, heroLines: 2 }));
  // A taller hero tightens the band, which is the whole point.
  assert.equal(moneyBoardBand(8, { hero: true }), "tight");
  assert.equal(moneyBoardBand(8, { hero: true, heroLines: 3 }), "packed");
  assert.equal(moneyBoardBand(8, { hero: true, heroLines: 6 }), "full");
  // And it is ignored without a hero, so it cannot tighten a board that is not
  // carrying one.
  assert.equal(moneyBoardBand(8, { heroLines: 9 }), moneyBoardBand(8));
});

test("A TALLER HERO CAN ONLY EVER TIGHTEN, never loosen", () => {
  // The same monotonicity the ladder already promises on its other two axes. A
  // hero declaring itself taller and getting a roomier band would be a footer
  // off the bottom of a television, and it would only show up at one seat count.
  for (let seats = 0; seats <= 16; seats++) {
    for (let lines = 1; lines <= 8; lines++) {
      const prev = moneyBoardBand(seats, { hero: true, heroLines: lines - 1 });
      const here = moneyBoardBand(seats, { hero: true, heroLines: lines });
      assert.ok(
        rung(here) >= rung(prev),
        `${seats} seats: a ${lines - 1}-line hero gave ${prev} and a ${lines}-line one gave ${here}`,
      );
    }
  }
});

test("a nonsense heroLines cannot make a board roomier than no hero at all", () => {
  // Total by construction, like the seat count above it: a negative or
  // fractional value clamps rather than subtracting lines off the load.
  for (const bad of [-5, -0.5, 0.4, NaN]) {
    const band = moneyBoardBand(8, { hero: true, heroLines: bad });
    assert.ok(BOARD_BANDS.includes(band), `heroLines ${bad} returned ${band}`);
    assert.ok(
      rung(band) >= rung(moneyBoardBand(8)),
      `heroLines ${bad} bought a roomier band than carrying no hero at all`,
    );
  }
});

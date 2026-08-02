// THE PLAYTEST: does each card actually change a run, and does its severity
// tell the truth about how much?
//
// casinorun-sim.test.ts asks whether the LADDERS are playable. This asks
// whether the DECK is. They are different claims and both are design claims
// that nothing else would ever check.
//
// ---------------------------------------------------------------------------
// THE APP STILL NEVER COMPUTES A CARD'S EFFECT. Humans apply modifiers at the
// table; that line has not moved and this file does not move it. What this
// does is model, at DESIGN time, what a table would plausibly do with each
// card, and measure the result. The alternative is a deck rated by feel, and
// the first pass at that was wrong for 21 of 36 cards, including a severity-1
// card that took the clear rate from 53% to zero, and two severity-3 cards
// that moved it by less than a point.
//
// WHAT AN EFFECT MEANS. Each card is expressed as what a human applying it
// would do to a leg's economics: a multiplier on wins or losses, a shift in
// the odds, a floor or a cap on the bet, a refund. These are approximations
// and they are allowed to be: the numbers that matter are RELATIVE, and the
// buckets are wide enough that a card would have to be badly mis-modelled to
// land in the wrong one.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { MODIFIERS, crunLadder, crunQuota, type Modifier } from "../src/index.js";

const WIN_PROB = 0.48;
const MAX_LEGS = 4000;
const START = 20_000; // P$200, the default a run opens with
const ANTE_PCT = 0.02;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Effect {
  /** Multiplier on a winning leg's payout. */
  winMult?: number;
  /** Multiplier on a losing leg's cost. */
  lossMult?: number;
  /** A fixed cost every leg, in antes. */
  perLeg?: number;
  /** A one-off at each stage start, in antes. Negative is a gain. */
  perStage?: number;
  /** The bet may not go under this many antes. */
  minWagerAntes?: number;
  /** ...or over this many. */
  maxWagerAntes?: number;
  /** Multiplier on the minimum ante. */
  anteMult?: number;
  /** The ante climbs on a clock. */
  escalating?: boolean;
  /** Shift in the chance of winning a leg. */
  edge?: number;
  /** Extra payout on a win following a win, as a fraction of the bet. */
  streakBonus?: number;
  /** One loss a stage is refunded. */
  perStageRefund?: boolean;
  /** One loss a RUN is halved. */
  once?: boolean;
}

/**
 * How a table would actually play each card.
 *
 * Every one of these is a judgement call and is meant to be read as one. Where
 * a card's effect depends on how often something comes up ("a correct call
 * pays extra"), the model assumes the middle case rather than the best.
 */
const EFFECTS: Record<string, Effect> = {
  // ---- any pool ----
  escalating_min: { escalating: true, perLeg: 0.3 },
  house_rake: { winMult: 0.9 },
  ante_surge: { anteMult: 2, perLeg: 0.5 },
  losses_double: { lossMult: 2 },
  min_bet_up: { minWagerAntes: 3 },
  pot_tithe: { winMult: 0.95 },
  rake_on_wins: { winMult: 0.8 },
  table_max: { maxWagerAntes: 4 },
  on_the_house: { perStageRefund: true },
  call_your_shot: { winMult: 1.25 },
  hot_streak: { streakBonus: 1 },
  free_round: { perStage: -1 },
  insurance: { once: true },
  bank_match: { winMult: 1.25 },
  house_gift: { perStage: -1 },
  no_pushes: { edge: -0.012 },
  // ---- cash tables ----
  leader_tax: { perLeg: 0.2 },
  everyone_antes: { perLeg: 0.5 },
  mercy_chip: { once: true },
  underdog_bonus: { winMult: 1.1 },
  // ---- roulette ----
  hot_colour: { winMult: 1.15 },
  hot_number: { winMult: 1.3 },
  neighbours_only: { edge: -0.02 },
  zero_pays_table: { edge: 0.027 },
  no_outside_bets: { edge: -0.03 },
  // ---- craps ----
  no_come_bets: { edge: -0.01 },
  pass_line_required: { edge: -0.005 },
  long_hand_bonus: { winMult: 1.1 },
  hard_ways_only: { edge: -0.02 },
  come_out_bonus: { winMult: 1.05 },
  no_odds: { edge: -0.012 },
  // ---- blackjack ----
  extra_card_up: { edge: 0.02 },
  no_splitting: { edge: -0.006 },
  blackjack_pays_double: { winMult: 1.12 },
  stands_all_17: { edge: 0.002 },
  no_doubling: { edge: -0.014 },
};

type Style = "bold" | "small";

/** One run under one card's effect. */
function play(eff: Effect, random: () => number, style: Style, start = START): boolean | null {
  const L = crunLadder("standard");
  const baseAnte = Math.round(start * ANTE_PCT);
  const quota = (i: number) => crunQuota(L, start, i);

  let bank = start;
  let stage = 0;
  let attempt = 1;
  let legsUsed = 0;
  let legCount = 0;
  let missed = 0;
  let lastWon = false;
  let onceLeft = eff.once ? 1 : 0;
  let refundedThisStage = false;

  const anteNow = () => {
    const raises = (eff.escalating ? Math.floor(legCount / 5) : 0) + missed;
    return Math.round(baseAnte * (eff.anteMult ?? 1) * (1 + 0.5 * raises));
  };

  if (eff.perStage) bank -= Math.round(anteNow() * eff.perStage);

  for (let n = 0; n < MAX_LEGS; n++) {
    const ante = anteNow();
    const floor = Math.round(ante * (eff.minWagerAntes ?? 1));
    const cap = eff.maxWagerAntes ? ante * eff.maxWagerAntes : Infinity;
    const need = quota(stage) - bank;
    const wager =
      style === "small"
        ? Math.min(floor, bank)
        : Math.min(Math.max(floor, Math.min(need, cap)), bank);

    const won = random() < WIN_PROB + (eff.edge ?? 0);
    if (won) {
      let gain = wager * (eff.winMult ?? 1);
      if (eff.streakBonus && lastWon) gain += wager * eff.streakBonus;
      bank += Math.round(gain);
    } else {
      let cost = wager * (eff.lossMult ?? 1);
      if (eff.perStageRefund && !refundedThisStage) {
        cost = 0;
        refundedThisStage = true;
      } else if (onceLeft > 0) {
        cost *= 0.5;
        onceLeft = 0;
      }
      bank -= Math.round(cost);
    }
    if (eff.perLeg) bank -= Math.round(ante * eff.perLeg);
    lastWon = won;
    legsUsed++;
    legCount++;

    if (bank <= 0) return false;
    if (bank >= quota(stage)) {
      stage++;
      attempt = 1;
      legsUsed = 0;
      refundedThisStage = false;
      if (stage >= L.stages) return true;
      if (eff.perStage) bank -= Math.round(anteNow() * eff.perStage);
      continue;
    }
    if (legsUsed >= L.legsPerStage) {
      missed++;
      if (attempt >= L.attemptsPerStage) return false;
      attempt++;
      legsUsed = 0;
    }
  }
  return null;
}

const RUNS = 8000;
const rate = (eff: Effect, style: Style, start = START) => {
  const random = rng(0x5eed);
  let cleared = 0;
  for (let i = 0; i < RUNS; i++) if (play(eff, random, style, start) === true) cleared++;
  return cleared / RUNS;
};

const BASE = { bold: rate({}, "bold"), small: rate({}, "small") };

/** The biggest swing a card produces, in percentage points, over both styles. */
function impact(id: string): number {
  const eff = EFFECTS[id]!;
  const bold = Math.abs(rate(eff, "bold") - BASE.bold);
  const small = Math.abs(rate(eff, "small") - BASE.small);
  return Math.max(bold, small) * 100;
}

// ---------- the assertions ----------

test("every card in the deck is modelled, so none can be added unmeasured", () => {
  for (const m of MODIFIERS) {
    assert.ok(EFFECTS[m.id], `${m.id} has no playtest model. Add one and re-measure its severity`);
  }
  for (const id of Object.keys(EFFECTS)) {
    assert.ok(MODIFIERS.some((m) => m.id === id), `${id} is modelled but not in the deck`);
  }
});

test("NO CARD IS DECORATION: every one moves a run's outcome", () => {
  // The bar is deliberately low (a severity-1 card is allowed to be small),
  // but a card that changes nothing at all is a sentence on a screen. Two
  // failed this before the 2026-08-02 pass and were replaced.
  const dead: string[] = [];
  for (const m of MODIFIERS) if (impact(m.id) < 0.35) dead.push(`${m.id} (${impact(m.id).toFixed(2)}pts)`);
  assert.deepEqual(dead, [], `cards with no measurable effect: ${dead.join(", ")}`);
});

test("SEVERITY TELLS THE TRUTH: the rating matches the measured swing", () => {
  // 12 points or more is a 3, four to twelve a 2, under four a 1. Before this
  // was asserted the ratings were guesses and 21 of 36 were wrong, including
  // a severity 1 that took the clear rate to zero.
  const bucket = (pts: number) => (pts >= 12 ? 3 : pts >= 4 ? 2 : 1);
  const wrong: string[] = [];
  for (const m of MODIFIERS) {
    const pts = impact(m.id);
    const want = bucket(pts);
    // One bucket of slack: these are modelled effects, not measurements of a
    // real table, and a card sitting on a boundary should not fail a build.
    if (Math.abs(m.severity - want) > 1) {
      wrong.push(`${m.id}: rated ${m.severity}, measured ${pts.toFixed(1)}pts (bucket ${want})`);
    }
  }
  assert.deepEqual(wrong, [], `severity does not match impact:\n  ${wrong.join("\n  ")}`);
});

test("a BANE hurts and a BOON helps, in the direction the card claims", () => {
  // The finding that made this necessary: three cards that raise the minimum
  // bet were classed as banes, and raising the minimum HELPS a table that has
  // to grow its bank. A card whose sign is wrong is worse than a weak one:
  // it is a lie on the screen.
  const wrongWay: string[] = [];
  for (const m of MODIFIERS) {
    const eff = EFFECTS[m.id]!;
    // BOTH styles, taking whichever moves more. Checking bold alone let three
    // "banes" through that did nothing to a committed table and actively
    // HELPED a grinding one: the sign was wrong and the test could not see it.
    const bold = rate(eff, "bold") - BASE.bold;
    const small = rate(eff, "small") - BASE.small;
    const delta = Math.abs(bold) >= Math.abs(small) ? bold : small;
    // Under a point either way is noise, not a direction.
    if (Math.abs(delta) < 0.01) continue;
    const helps = delta > 0;
    if (helps !== (m.kind === "boon")) {
      wrongWay.push(
        `${m.id} is a ${m.kind} but moves play ${(delta * 100).toFixed(1)}pts ` +
          `(bold ${(bold * 100).toFixed(1)}, small ${(small * 100).toFixed(1)})`,
      );
    }
  }
  assert.deepEqual(wrongWay, [], `cards pointing the wrong way:\n  ${wrongWay.join("\n  ")}`);
});

test("the game is SCALE-FREE: the size of the bank changes nothing", () => {
  // Everything (quotas, the ante, token prices) is a fraction of the
  // starting bank, so a P$20 run and a P$2000 run should play identically.
  // This is what lets the default move from P$100 to P$200 without retuning a
  // single number, and it would break silently if anything picked up a
  // hard-coded amount.
  for (const start of [2_000, 20_000, 200_000]) {
    const r = rate({}, "bold", start);
    assert.ok(
      Math.abs(r - BASE.bold) < 0.02,
      `a P$${start / 100} bank cleared ${(r * 100).toFixed(1)}% against ${(BASE.bold * 100).toFixed(1)}%`,
    );
  }
});

test("the deck's strongest cards are strong and its weakest are weak", () => {
  // A sanity check on the spread: if every card landed in the same band the
  // severity system would be pointless, and the escalating draw would have
  // nothing to escalate to.
  const pts = MODIFIERS.map((m) => impact(m.id));
  assert.ok(Math.max(...pts) > 15, `the deck's strongest card only moves ${Math.max(...pts).toFixed(1)}pts`);
  const heavy = MODIFIERS.filter((m) => m.severity === 3).length;
  const light = MODIFIERS.filter((m) => m.severity === 1).length;
  assert.ok(heavy >= 5, `only ${heavy} night-changing cards`);
  assert.ok(light >= 5, `only ${light} flavour cards`);
});

test("a table that plays SMALL is punished, which is the whole point", () => {
  // The attempt cap exists to end grinding. This confirms it did, and that no
  // card rescues a nibbling table back to a coin flip.
  assert.ok(BASE.small < 0.1, `grinding still clears ${(BASE.small * 100).toFixed(1)}%`);
  for (const m of MODIFIERS) {
    const r = rate(EFFECTS[m.id]!, "small");
    assert.ok(r < 0.35, `${m.id} makes grinding viable again at ${(r * 100).toFixed(1)}%`);
  }
});

/** Not an assertion: the table, printed, so a tuning pass has the numbers. */
test("REPORT: every card's measured impact", () => {
  const rows = MODIFIERS.map((m: Modifier) => {
    const eff = EFFECTS[m.id]!;
    return {
      id: m.id,
      sev: m.severity,
      kind: m.kind,
      bold: (rate(eff, "bold") - BASE.bold) * 100,
      small: (rate(eff, "small") - BASE.small) * 100,
    };
  }).sort((a, b) => Math.abs(b.bold) - Math.abs(a.bold));

  const lines = [
    `baseline: bold ${(BASE.bold * 100).toFixed(1)}%  small ${(BASE.small * 100).toFixed(1)}%`,
    ...rows.map(
      (r) =>
        `  [${r.sev}] ${r.kind === "boon" ? "+" : "-"} ${r.id.padEnd(22)} bold ${r.bold >= 0 ? "+" : ""}${r.bold.toFixed(1).padStart(5)}  small ${r.small >= 0 ? "+" : ""}${r.small.toFixed(1).padStart(5)}`,
    ),
  ];
  console.log(lines.join("\n"));
  assert.ok(rows.length === MODIFIERS.length);
});

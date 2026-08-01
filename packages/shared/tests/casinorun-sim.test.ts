// THE PLAYABILITY TEST for Casino Run's difficulty ladders.
//
// The app never computes a gambling outcome — humans type each leg's net
// change, and that line does not move. But CRUN_LADDERS makes a DESIGN CLAIM:
// that Casual is clearable most nights and Degenerate is not. That claim is
// checkable without the app ever simulating anything at runtime, and it is
// worth checking, because the alternative is four numbers chosen by feel that
// nobody finds out are wrong until a night is ruined by them.
//
// So this plays each ladder several thousand times against a house edge and
// asserts the clear rate lands inside the band the ladder was designed for.
//
// THE BANDS ARE THE DESIGN. THE NUMBERS SERVE THEM. If a ladder falls outside
// its band the fix is the ladder's escalation, stage count or leg budget —
// never a wider band. A band widened to make a failing ladder pass is a test
// that has been talked out of its own conclusion.
//
// ---------------------------------------------------------------------------
// THE MODEL, and what it is and is not
//
// A leg is one wager at slightly negative expected value: 48% to win even
// money, which is roughly where a real casino sits on the good bets.
//
// THE REFERENCE PLAYER BETS TOWARD THE QUOTA — it wagers exactly what it needs
// to clear the current stage, capped at the bank and floored at a table
// minimum. That is not a detail, it is the model's whole character, and the
// first draft got it wrong: betting a blind fraction of the bank ignores the
// quota entirely, which is a bizarre way to model a mode whose entire
// structure is quotas. It also happens to be Dubins-Savage BOLD PLAY, the
// provably optimal strategy for reaching a target in a subfair game, so the
// clear rates below are an upper bound on what a table can expect rather than
// an arbitrary point in the middle of strategy space. An upper bound is the
// right thing to design a difficulty ladder against.
//
// The table minimum exists to make the bank MORTAL: pure proportional betting
// can never reach zero, so without a floor every run is immortal and the whole
// exercise measures nothing. It is set at 2% of the starting bank, and it is
// not load-bearing — sweeping it from 1% to 10% moved the clear rate by about
// one point, which was checked before picking a number.
//
// What this is NOT is a claim about how a specific crew plays. A table that
// grinds minimum bets clears far less than this. The model is a reference
// player and the rates are conditional on it. What it buys is the ORDERING and
// the rough magnitude: that these four ladders are genuinely different nights,
// and that the hardest one really is a joke rather than merely a bit harder.
// ---------------------------------------------------------------------------
//
// SEEDED, so it cannot flake. A Monte Carlo test on Math.random is a test that
// fails once a month in CI for no reason and gets deleted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CRUN_LADDERS, crunQuota, type CrunLadder } from "../src/index.js";

// ---------- a deterministic rng ----------

/** mulberry32: small, fast, good enough for this, and reproducible forever. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- the model ----------

const START = 10_000; // $100.00 in cents. The unit does not matter, the ratios do.
const WIN_PROB = 0.48; // even money at roughly real casino odds
const MIN_STAKE = Math.round(START * 0.02);
/** A cap so a pathological run cannot spin forever; far above any real run. */
const MAX_LEGS = 4000;

/**
 * Play one run to its end. Returns true if the table cleared the last stage,
 * false if it busted, null if it never resolved (which must never happen and
 * is asserted separately rather than quietly counted as a loss).
 *
 * The progression mirrors crunProgress exactly, and deliberately: a missed
 * stage costs the attempt and nothing else, so the ONLY ways out are clearing
 * the final quota or dropping through the floor. That is the rule that makes
 * these numbers mean anything — with retries, a run's fate is whether the bank
 * can climb to the last quota before it dies.
 */
function playRun(ladder: CrunLadder, random: () => number): boolean | null {
  let bank = START;
  let stage = 0;
  let legsUsed = 0;

  for (let n = 0; n < MAX_LEGS; n++) {
    // Bet what it takes to clear: capped at the bank, floored at the table
    // minimum. See the header for why this beats a blind fraction.
    const need = crunQuota(ladder, START, stage) - bank;
    const wager = Math.min(Math.max(MIN_STAKE, need), bank);
    bank += random() < WIN_PROB ? wager : -wager;
    legsUsed++;

    if (bank <= 0) return false;
    if (bank >= crunQuota(ladder, START, stage)) {
      stage++;
      legsUsed = 0;
      if (stage >= ladder.stages) return true;
      continue;
    }
    if (legsUsed >= ladder.legsPerStage) legsUsed = 0;
  }
  return null;
}

function clearRate(ladder: CrunLadder, runs: number, seed: number): number {
  const random = rng(seed);
  let cleared = 0;
  for (let i = 0; i < runs; i++) if (playRun(ladder, random) === true) cleared++;
  return cleared / runs;
}

// ---------- the bands ----------

/**
 * What each ladder claims about itself, from the session brief. These are the
 * design targets; CRUN_LADDERS is tuned until it hits them.
 */
const BANDS: Record<string, [number, number]> = {
  casual: [0.7, 0.8],
  standard: [0.45, 0.55],
  highroller: [0.2, 0.3],
  degenerate: [0.05, 0.15],
};

const RUNS = 20_000;

for (const ladder of CRUN_LADDERS) {
  test(`${ladder.name} clears inside its design band`, () => {
    const [lo, hi] = BANDS[ladder.key]!;
    // A fixed seed per ladder, so a failure is reproducible by name.
    const rate = clearRate(ladder, RUNS, 0x5eed + ladder.key.length * 7919);
    assert.ok(
      rate >= lo && rate <= hi,
      `${ladder.name} (+${Math.round(ladder.escalation * 100)}%, ${ladder.stages} stages, ` +
        `${ladder.legsPerStage} legs) cleared ${(rate * 100).toFixed(1)}% of ${RUNS} runs, ` +
        `outside its ${lo * 100}-${hi * 100}% band. Tune the LADDER, never the band.`,
    );
  });
}

test("the ladders are strictly ordered by how hard they are", () => {
  // The property that actually matters to a host reading the picker: choosing
  // a harder one must genuinely be harder. A band check alone would pass with
  // two ladders that happened to overlap at the edges.
  const rates = CRUN_LADDERS.map((l) => clearRate(l, 4000, 0xc0ffee + l.escalation * 1000));
  for (let i = 1; i < rates.length; i++) {
    assert.ok(
      rates[i]! < rates[i - 1]!,
      `${CRUN_LADDERS[i]!.name} (${(rates[i]! * 100).toFixed(1)}%) is not harder than ` +
        `${CRUN_LADDERS[i - 1]!.name} (${(rates[i - 1]! * 100).toFixed(1)}%)`,
    );
  }
});

test("no run hits the safety cap, so the model has a real absorbing barrier", () => {
  // If this ever fires, the table minimum has stopped making the bank mortal
  // and every clear rate above is measuring the cap instead of the game.
  let unresolved = 0;
  for (const ladder of CRUN_LADDERS) {
    const random = rng(0xbeef);
    for (let i = 0; i < 3000; i++) if (playRun(ladder, random) === null) unresolved++;
  }
  assert.equal(unresolved, 0, `${unresolved} runs never resolved`);
});

test("the leg budget cannot move the clear rate, and that is on purpose", () => {
  // A missed stage costs the attempt and nothing else, so legsPerStage changes
  // only how often the table eats a forced bane. Pinned because it is exactly
  // the knob somebody will reach for when a ladder feels wrong, and it would
  // do nothing — this test tells them so instead of letting them wonder.
  const base = CRUN_LADDERS[1]!;
  const rates = [2, 3, 5, 12].map((legsPerStage) =>
    clearRate({ ...base, legsPerStage }, 3000, 0xd1ce),
  );
  for (const r of rates) assert.equal(r, rates[0], `legs budget moved the rate: ${rates.join(", ")}`);
});

test("the model itself is what it claims: a house edge, not a coin flip", () => {
  // Guards the premise. A model accidentally set to p = 0.5 would make every
  // ladder look clearable and the bands would then be tuned to a fair game.
  const random = rng(0x1234);
  let wins = 0;
  const N = 200_000;
  for (let i = 0; i < N; i++) if (random() < WIN_PROB) wins++;
  const p = wins / N;
  assert.ok(Math.abs(p - WIN_PROB) < 0.005, `drew ${p}, expected ~${WIN_PROB}`);
  assert.ok(WIN_PROB < 0.5, "the house has to have an edge or none of this means anything");
});

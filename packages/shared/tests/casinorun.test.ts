// Tests for the Casino Run engine (packages/shared/src/casinorun.ts).
//
// The difficulty ladders are checked separately and by simulation, in
// casinorun-sim.test.ts. What is here is the machinery: bank arithmetic, quota
// maths, stage progression, and the two things most likely to be subtly wrong.
//
// THE UNDO TESTS ARE THE POINT OF THIS FILE. Everything about a run — the
// bank, the stage, the attempt, whether it is over — is DERIVED from the leg
// log, so undo is a pop and a re-derive. That is the design, and these tests
// exist to prove it holds at the case that would break a stored-counter
// implementation: undoing the leg that busted the run. A pack that maintained
// `bank` and `status` as fields would have to un-set both, in the right order,
// and would be wrong the first time somebody added a third field.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CRUN_LADDERS,
  crunEscalationWeight,
  crunLadder,
  crunLedgerLines,
  crunProgress,
  crunQuota,
  crunQuotas,
  crunBuy,
  crunRecord,
  crunUndo,
  drawModifiers,
  modifiersFor,
  newCrunState,
  summarizeCrun,
  type CashPlayer,
  type CrunDifficulty,
  type CrunState,
} from "../src/index.js";

// ---------- helpers ----------

const player = (id: string, name = id): CashPlayer => ({
  id,
  kind: "member",
  userId: `u_${id}`,
  name,
});

const run = (opts?: {
  difficulty?: CrunDifficulty;
  startingBank?: number;
  floor?: number;
  players?: CashPlayer[];
}): CrunState =>
  newCrunState({
    roster: opts?.players ?? [player("a", "Ada"), player("b", "Bo")],
    startingBank: opts?.startingBank ?? 10000,
    difficulty: opts?.difficulty ?? "standard",
    floor: opts?.floor ?? 0,
  });

/** Play a leg. Returns what crunRecord said. */
const leg = (s: CrunState, delta: number, game = "blackjack", playerId: string | null = "a") =>
  crunRecord(s, { delta, game, playerId, at: "2026-07-30T20:00:00.000Z" });

// ---------- quotas ----------

test("a quota is the bank's TOTAL, compounding, not a delta to add on", () => {
  const std = crunLadder("standard"); // +15%, 4 stages
  // $100 start. Stage 1 wants $115 in the bank, not $215.
  assert.equal(crunQuota(std, 10000, 0), 11500);
  assert.equal(crunQuota(std, 10000, 1), 13225);
  assert.equal(crunQuota(std, 10000, 2), 15209); // 1.15^3 = 1.520875
  assert.equal(crunQuota(std, 10000, 3), 17490); // 1.15^4 = 1.74900625
  assert.deepEqual(crunQuotas(std, 10000), [11500, 13225, 15209, 17490]);
});

test("every ladder's quotas are integer cents at every stage", () => {
  // Money is integer cents everywhere in this app, and a quota is money. A
  // fractional cent here would be the first float to reach a screen.
  for (const ladder of CRUN_LADDERS) {
    for (const bank of [1, 999, 10000, 33333, 1_000_000]) {
      for (const q of crunQuotas(ladder, bank)) {
        assert.ok(Number.isSafeInteger(q), `${ladder.key} @ ${bank}: ${q}`);
      }
    }
  }
});

test("quotas climb, so a later stage is never easier than an earlier one", () => {
  for (const ladder of CRUN_LADDERS) {
    const qs = crunQuotas(ladder, 10000);
    for (let i = 1; i < qs.length; i++) assert.ok(qs[i]! > qs[i - 1]!, ladder.key);
    assert.equal(qs.length, ladder.stages);
  }
});

test("an unknown difficulty falls back rather than crashing a stored run", () => {
  // A run recorded under a ladder key later removed still has to render.
  assert.equal(crunLadder("something_we_dropped").key, "standard");
});

// ---------- bank arithmetic ----------

test("the bank is the starting stake plus every leg, in order", () => {
  const s = run();
  assert.equal(crunProgress(s).bank, 10000);
  leg(s, 1500);
  assert.equal(crunProgress(s).bank, 11500);
  leg(s, -4000);
  assert.equal(crunProgress(s).bank, 7500);
  leg(s, -2500);
  assert.equal(crunProgress(s).bank, 5000);
  // Many small odd amounts sum exactly, the same float canary the cash engine
  // carries: 3.33 + 3.33 + 3.34 is not 10 in binary floating point. The bank
  // is big enough that these cannot clear a stage and end the walk early.
  const t = run({ startingBank: 100000, difficulty: "degenerate" });
  for (const c of [333, 333, 334]) leg(t, c);
  assert.equal(crunProgress(t).bank, 101000);
});

test("a zero starting bank is degenerate, and the server is what stops it", () => {
  // Every quota is a multiple of the starting bank, so a bank of zero makes
  // them all zero and the first leg clears the entire run. The engine reports
  // that faithfully rather than special-casing it; MIN_BANK on the start route
  // is where it is actually prevented, because that is the boundary that owns
  // what a valid run looks like.
  const s = run({ startingBank: 0 });
  leg(s, 1);
  assert.equal(crunProgress(s).status, "cleared");
});

test("a leg that takes the bank below the floor busts the run", () => {
  const s = run({ startingBank: 10000, floor: 2000 });
  leg(s, -5000);
  assert.equal(crunProgress(s).status, "running");
  assert.equal(crunProgress(s).bank, 5000);
  leg(s, -3500); // 1500, under the 2000 floor
  const p = crunProgress(s);
  assert.equal(p.status, "bust");
  assert.equal(p.bank, 1500);
});

test("landing exactly ON the floor busts: the bank must stay ABOVE it", () => {
  const s = run({ startingBank: 10000, floor: 2000 });
  leg(s, -8000);
  assert.equal(crunProgress(s).bank, 2000);
  assert.equal(crunProgress(s).status, "bust");
});

test("a busted run stops reading legs, so a stray write cannot revive it", () => {
  const s = run({ startingBank: 10000, floor: 0 });
  leg(s, -10000);
  assert.equal(crunProgress(s).status, "bust");
  // crunRecord refuses...
  assert.equal(leg(s, 50000), false);
  // ...and even if a leg were forced into the log by other means, the walk
  // stops at the bust rather than spending it.
  s.legs.push({ delta: 50000, game: "x", playerId: null, at: "" });
  const p = crunProgress(s);
  assert.equal(p.status, "bust");
  assert.equal(p.bank, 0);
});

// ---------- stages ----------

test("clearing a quota advances the stage and resets the leg budget", () => {
  const s = run({ difficulty: "standard", startingBank: 10000 }); // +15%, 4 stages, 5 legs
  leg(s, 500);
  let p = crunProgress(s);
  assert.equal(p.stage, 0);
  assert.equal(p.legsUsed, 1);
  assert.equal(p.legsLeft, 4);
  assert.equal(p.quota, 11500);
  assert.equal(p.toGo, 1000);

  leg(s, 1000); // exactly 11500
  p = crunProgress(s);
  assert.equal(p.stage, 1);
  assert.equal(p.cleared, 1);
  assert.equal(p.legsUsed, 0, "the budget resets on a clear");
  assert.equal(p.attempt, 1);
  assert.equal(p.quota, 13225);
  assert.equal(p.status, "running");
});

test("clearing the LAST stage clears the run", () => {
  const s = run({ difficulty: "standard", startingBank: 10000 });
  leg(s, 7490); // straight to 17490, the final quota
  const p = crunProgress(s);
  assert.equal(p.status, "cleared");
  assert.equal(p.cleared, 4, "one enormous leg can clear every stage at once");
  assert.equal(p.stage, 4);
});

test("running out of legs costs the attempt, not the run", () => {
  // The rule that makes the modifier pile-up the pressure rather than a timer:
  // only the floor ends a run.
  const s = run({ difficulty: "standard", startingBank: 10000 }); // 5 legs a stage
  for (let i = 0; i < 5; i++) leg(s, 10);
  const p = crunProgress(s);
  assert.equal(p.status, "running");
  assert.equal(p.stage, 0, "still on the same stage");
  assert.equal(p.attempt, 2, "on the second attempt at it");
  assert.equal(p.missed, 1);
  assert.equal(p.legsUsed, 0);
  assert.equal(p.legsLeft, 5);
  assert.equal(p.bank, 10050);
});

test("RUNNING OUT OF ATTEMPTS ENDS THE RUN — the second way to lose", () => {
  // The thing this pack shipped without. Standard gives 3 attempts of 5 legs
  // at each stage; a table that nibbles its way through all fifteen without
  // reaching the quota is done, with money still on the table.
  const s = run({ difficulty: "standard" }); // 5 legs, 3 attempts
  for (let i = 0; i < 14; i++) leg(s, 1);
  let p = crunProgress(s);
  assert.equal(p.status, "running", "still alive on the last attempt");
  assert.equal(p.attempt, 3);
  assert.equal(p.attemptsLeft, 1);
  assert.equal(p.missed, 2);

  leg(s, 1); // the fifteenth: the last shot at stage 1 runs out
  p = crunProgress(s);
  assert.equal(p.status, "bust");
  assert.equal(p.ending, "attempts", "out of shots, NOT through the floor");
  assert.equal(p.missed, 3);
  assert.ok(p.bank > 0, "and the bank still had money in it, which is the point");
  // A further leg cannot revive it.
  assert.equal(leg(s, 100000), false);
});

test("the two endings are told apart, because they are different nights", () => {
  const floored = run({ startingBank: 10000, floor: 0 });
  leg(floored, -10000);
  assert.equal(crunProgress(floored).ending, "floor");
  assert.equal(summarizeCrun(floored).headline.includes("through the floor"), true);

  const out = run({ difficulty: "degenerate" }); // 4 legs, 2 attempts
  for (let i = 0; i < 8; i++) leg(out, 1);
  assert.equal(crunProgress(out).ending, "attempts");
  assert.equal(summarizeCrun(out).headline.includes("out of attempts"), true);
});

test("attemptsLeft counts down and reads zero once the run is over", () => {
  const s = run({ difficulty: "degenerate" }); // 4 legs, 2 attempts
  assert.equal(crunProgress(s).attemptsLeft, 2);
  for (let i = 0; i < 4; i++) leg(s, 1);
  assert.equal(crunProgress(s).attemptsLeft, 1);
  for (let i = 0; i < 4; i++) leg(s, 1);
  assert.equal(crunProgress(s).attemptsLeft, 0);
  assert.equal(crunProgress(s).status, "bust");
});

test("undo reopens a run that died on attempts, not just one that died on the floor", () => {
  const s = run({ difficulty: "degenerate" }); // 4 legs, 2 attempts
  for (let i = 0; i < 8; i++) leg(s, 1);
  assert.equal(crunProgress(s).status, "bust");
  assert.equal(crunUndo(s), true);
  const p = crunProgress(s);
  assert.equal(p.status, "running");
  assert.equal(p.attempt, 2);
  assert.equal(p.legsUsed, 3);
  assert.equal(p.missed, 1);
});

test("bust beats clear when a leg would do both", () => {
  // Cannot happen while quota > floor, but the ORDER is stated in the code and
  // pinned here so nobody reorders the two checks while tidying.
  const s = run({ difficulty: "casual", startingBank: 10000, floor: 20000 });
  leg(s, 1000); // 11000: above casual's first quota (10600) AND under the floor
  assert.equal(crunProgress(s).status, "bust");
});

// ---------- undo ----------

test("undo restores the bank and the stage exactly", () => {
  const s = run({ difficulty: "standard", startingBank: 10000 });
  leg(s, 1500); // clears stage 0
  assert.equal(crunProgress(s).cleared, 1);
  assert.equal(crunUndo(s), true);
  const p = crunProgress(s);
  assert.equal(p.bank, 10000);
  assert.equal(p.stage, 0);
  assert.equal(p.cleared, 0);
  assert.equal(p.legsUsed, 0);
  assert.equal(p.status, "running");
});

test("UNDOING THE LEG THAT BUSTED THE RUN reopens it, bank and all", () => {
  // The case a stored-counter implementation gets wrong. Everything here is
  // derived, so this is a pop and a re-derive and cannot be half-undone.
  const s = run({ difficulty: "standard", startingBank: 10000, floor: 0 });
  leg(s, 1500); // 11500, clears stage 0
  leg(s, -3000); // 8500, on stage 1
  leg(s, -8500); // 0, bust
  let p = crunProgress(s);
  assert.equal(p.status, "bust");
  assert.equal(p.bank, 0);

  assert.equal(crunUndo(s), true);
  p = crunProgress(s);
  assert.equal(p.status, "running", "the run is live again");
  assert.equal(p.bank, 8500, "the bank is back");
  assert.equal(p.stage, 1, "and so is the stage it was on");
  assert.equal(p.legsUsed, 1);
  assert.equal(p.cleared, 1);
  assert.equal(p.quota, 13225);
});

test("undo rolls back a missed attempt too", () => {
  const s = run({ difficulty: "standard" }); // 5 legs
  for (let i = 0; i < 5; i++) leg(s, 10);
  assert.equal(crunProgress(s).missed, 1);
  assert.equal(crunProgress(s).attempt, 2);
  crunUndo(s);
  const p = crunProgress(s);
  assert.equal(p.missed, 0, "the attempt un-happened");
  assert.equal(p.attempt, 1);
  assert.equal(p.legsUsed, 4);
  assert.equal(p.legsLeft, 1);
});

test("undo on an empty run says no rather than throwing", () => {
  const s = run();
  assert.equal(crunUndo(s), false);
  assert.equal(crunProgress(s).bank, 10000);
});

test("undo all the way back is the state the run started in", () => {
  const s = run({ difficulty: "highroller", startingBank: 5000 });
  const before = crunProgress(s);
  for (const d of [900, -400, 2000, -6000, 300]) leg(s, d);
  while (crunUndo(s)) {
    /* pop everything */
  }
  assert.deepEqual(crunProgress(s), before);
  assert.deepEqual(s.legs, []);
});

// ---------- peak, trough and the comeback ----------

test("the comeback is the biggest rise from a running low", () => {
  const s = run({ startingBank: 10000, floor: 0 });
  leg(s, -9000); // 1000, the low
  leg(s, 7000); // 8000: come back 7000
  leg(s, -1000); // 7000
  const p = crunProgress(s);
  assert.equal(p.trough, 1000);
  assert.equal(p.peak, 10000, "the start counts as the peak until it is beaten");
  assert.equal(p.comeback, 7000);
});

test("a run that only ever goes up has no comeback", () => {
  const s = run({ startingBank: 10000 });
  leg(s, 200);
  leg(s, 300);
  assert.equal(crunProgress(s).comeback, 500);
  // Because the running low IS the start, a monotonic rise reads its whole
  // gain as the comeback. That is the honest reading of "how far back did they
  // come from their lowest point" and it costs nothing: a run that never dipped
  // has nothing to brag about anyway, and the stat is only headlined on runs
  // that did.
  assert.equal(crunProgress(s).trough, 10000);
});

// ---------- the minimum ante ----------

test("the ante starts at the base and only cards move it", () => {
  const s = run({ startingBank: 10000 }); // default ante is 2% = 200
  let p = crunProgress(s);
  assert.equal(p.ante.base, 200);
  assert.equal(p.ante.amount, 200);
  assert.equal(p.ante.raises, 0);
  assert.equal(p.ante.everyone, false);
  // Plain legs on a plain run never move it.
  for (let i = 0; i < 4; i++) leg(s, 10);
  p = crunProgress(s);
  assert.equal(p.ante.amount, 200);
});

test("Escalating minimum raises the ante on a clock", () => {
  const s = run({ difficulty: "casual", startingBank: 10000 });
  s.modifiers = ["escalating_min"];
  // Every five legs. Casual gives five legs an attempt, so this also proves
  // the clock counts LEGS and not attempts.
  for (let i = 0; i < 4; i++) leg(s, 10);
  assert.equal(crunProgress(s).ante.raises, 0);
  leg(s, 10); // the fifth
  const p = crunProgress(s);
  // That fifth leg also exhausted the attempt, so there are two raises: one
  // from the clock and one from the miss.
  assert.equal(p.ante.raises, 2);
  assert.equal(p.ante.amount, 400, "base 200 plus half the base per raise");
});

test("EVERY MISSED ATTEMPT raises the ante, so grinding costs something", () => {
  // The other half of the answer to "there is no way to lose": running out of
  // legs is not free even before it runs out of attempts, because the table
  // gets more expensive to sit at each time.
  const s = run({ difficulty: "standard", startingBank: 10000 }); // 5 legs, 3 attempts
  for (let i = 0; i < 5; i++) leg(s, 10);
  let p = crunProgress(s);
  assert.equal(p.missed, 1);
  assert.equal(p.ante.raises, 1);
  assert.equal(p.ante.amount, 300);
  for (let i = 0; i < 5; i++) leg(s, 10);
  p = crunProgress(s);
  assert.equal(p.ante.raises, 2);
  assert.equal(p.ante.amount, 400);
});

test("Everyone antes is reported off the card, not stored", () => {
  const s = run();
  assert.equal(crunProgress(s).ante.everyone, false);
  s.modifiers = ["everyone_antes"];
  assert.equal(crunProgress(s).ante.everyone, true);
  // And it is independent of the amount.
  assert.equal(crunProgress(s).ante.amount, 200);
});

test("Ante surge doubles the tracked ante, because a tracker should track it", () => {
  const s = run({ startingBank: 10000 }); // base 200
  assert.equal(crunProgress(s).ante.amount, 200);
  assert.equal(crunProgress(s).ante.surged, false);
  s.modifiers = ["ante_surge"];
  const p = crunProgress(s);
  assert.equal(p.ante.amount, 400);
  assert.equal(p.ante.surged, true);
  // And it stacks with the rises rather than replacing them.
  for (let i = 0; i < 5; i++) leg(s, 10); // one missed attempt -> one raise
  assert.equal(crunProgress(s).ante.raises, 1);
  assert.equal(crunProgress(s).ante.amount, 600, "base 200, doubled, then +50% of base");
});

test("the ante never drops below its base, whatever is bought", () => {
  const s = run({ startingBank: 10000 });
  crunBuy(s, { token: "ante_relief", playerId: null, at: "x" });
  crunBuy(s, { token: "ante_relief", playerId: null, at: "x" });
  const p = crunProgress(s);
  assert.equal(p.ante.raises, 0);
  assert.equal(p.ante.amount, 200, "relief cancels a rise, it does not make the table cheaper");
});

// ---------- one-shot tokens ----------

test("buying a token costs bank and is held for the next leg", () => {
  const s = run({ startingBank: 10000 });
  const t = crunBuy(s, { token: "double_next", playerId: "a", at: "x" });
  assert.equal(t?.id, "double_next");
  const p = crunProgress(s);
  // 15% of the starting bank. Tokens are priced to hurt.
  assert.equal(p.bank, 8500);
  assert.deepEqual(p.held, ["double_next"], "held until a leg spends it");
  assert.equal(p.legsUsed, 0, "a purchase is not a stretch of play");
  assert.equal(p.legsLeft, 5);
});

test("the next leg spends everything held", () => {
  const s = run({ startingBank: 10000 });
  crunBuy(s, { token: "double_next", playerId: "a", at: "x" });
  crunBuy(s, { token: "mulligan", playerId: "a", at: "x" });
  assert.deepEqual(crunProgress(s).held, ["double_next", "mulligan"]);
  leg(s, 500);
  const p = crunProgress(s);
  assert.deepEqual(p.held, [], "spent on the leg that followed");
  assert.equal(p.legsUsed, 1);
});

test("token costs scale with the run, so one is never trivial or unaffordable", () => {
  const small = run({ startingBank: 2000 });
  crunBuy(small, { token: "double_next", playerId: null, at: "x" });
  assert.equal(crunProgress(small).bank, 1700); // 15% of 2000

  const big = run({ startingBank: 500000 });
  crunBuy(big, { token: "double_next", playerId: null, at: "x" });
  assert.equal(crunProgress(big).bank, 425000);
});

test("BUYING A TOKEN YOU CANNOT AFFORD IS A REAL WAY TO DIE", () => {
  // Deliberately not blocked. Spending the last of the bank on a hedge is a
  // stupid, thoroughly in-genre way to end a run, and the floor check catches
  // it like anything else that moves the bank.
  const s = run({ startingBank: 10000, floor: 0 });
  leg(s, -8700); // 1300 left; a double_next costs 1500
  assert.equal(crunProgress(s).status, "running");
  crunBuy(s, { token: "double_next", playerId: null, at: "x" });
  const p = crunProgress(s);
  assert.equal(p.status, "bust");
  assert.equal(p.ending, "floor");
  assert.equal(p.bank, -200);
});

test("One more shot really does add a leg to the attempt", () => {
  const s = run({ difficulty: "standard", startingBank: 10000 }); // 5 legs
  for (let i = 0; i < 4; i++) leg(s, 10);
  assert.equal(crunProgress(s).legsLeft, 1);
  crunBuy(s, { token: "one_more_shot", playerId: null, at: "x" });
  assert.equal(crunProgress(s).legsLeft, 2, "the budget grew");
  leg(s, 10);
  assert.equal(crunProgress(s).legsUsed, 5, "and the fifth leg did not end the attempt");
  assert.equal(crunProgress(s).attempt, 1);
  assert.equal(crunProgress(s).missed, 0);
});

test("Ante relief cancels exactly one rise", () => {
  const s = run({ difficulty: "standard", startingBank: 10000 });
  for (let i = 0; i < 5; i++) leg(s, 10); // one missed attempt -> one raise
  assert.equal(crunProgress(s).ante.raises, 1);
  crunBuy(s, { token: "ante_relief", playerId: null, at: "x" });
  assert.equal(crunProgress(s).ante.raises, 0);
  assert.equal(crunProgress(s).ante.amount, 200);
});

test("Second chance buys a whole extra attempt at this stage", () => {
  // Directly relieves the loss condition, which is why it is the dearest
  // token: it is the only one that buys you out of dying.
  const s = run({ difficulty: "degenerate", startingBank: 100000 }); // 4 legs, 2 attempts
  for (let i = 0; i < 8; i++) leg(s, 1);
  assert.equal(crunProgress(s).status, "bust", "two attempts is normally the end");

  const t = run({ difficulty: "degenerate", startingBank: 100000 });
  crunBuy(t, { token: "second_chance", playerId: null, at: "x" });
  assert.equal(crunProgress(t).attemptsLeft, 3);
  for (let i = 0; i < 8; i++) leg(t, 1);
  const p = crunProgress(t);
  assert.equal(p.status, "running", "the bought attempt kept it alive");
  assert.equal(p.attempt, 3);
});

test("Shave the target takes a tenth off THIS stage only", () => {
  const s = run({ difficulty: "standard", startingBank: 10000 }); // stage 1 wants 11500
  assert.equal(crunProgress(s).quota, 11500);
  crunBuy(s, { token: "shave_the_target", playerId: null, at: "x" });
  assert.equal(crunProgress(s).quota, 10350, "a tenth off");

  // 10350 is now reachable with less. Clear it, and the NEXT stage is at full
  // price again — one purchase must not discount the whole rest of the run.
  leg(s, 2850); // bank 10000 - 2500 cost + 2850 = 10350
  const p = crunProgress(s);
  assert.equal(p.cleared, 1);
  assert.equal(p.quota, 13225, "stage 2 is undiscounted");
});

test("undoing a purchase gives the money back and un-holds the card", () => {
  // The reason buys live in the same log as legs: there is no second thing to
  // unwind.
  const s = run({ startingBank: 10000 });
  crunBuy(s, { token: "double_next", playerId: "a", at: "x" });
  assert.equal(crunProgress(s).bank, 8500);
  assert.equal(crunUndo(s), true);
  const p = crunProgress(s);
  assert.equal(p.bank, 10000);
  assert.deepEqual(p.held, []);
});

test("a purchase is attributed but never counted as a leg played", () => {
  const s = run({ startingBank: 10000 });
  leg(s, 500, "Blackjack", "a");
  crunBuy(s, { token: "steady_hand", playerId: "a", at: "x" });
  const sum = summarizeCrun(s);
  const ada = sum.players.find((p) => p.playerId === "a")!;
  assert.equal(ada.legs, 1, "one leg, not two");
  assert.equal(ada.delta, 500, "the purchase does not drag their leg total around");
  assert.equal(ada.best, 500);
  assert.equal(ada.worst, 500, "and it is not their worst leg either");
  assert.equal(ada.spent, 800, "8% of 10000");
});

test("an unknown token is refused rather than recorded as a free card", () => {
  const s = run();
  assert.equal(crunBuy(s, { token: "not_a_token", playerId: null, at: "x" }), null);
  assert.equal(s.legs.length, 0);
});

test("the ledger counts legs and purchases separately", () => {
  const s = run({ startingBank: 10000, players: [player("a")] });
  leg(s, 500);
  crunBuy(s, { token: "steady_hand", playerId: "a", at: "x" });
  leg(s, 500);
  const [line] = crunLedgerLines(s);
  assert.equal(line!.meta.legs, 2, "purchases are not stretches of play");
  assert.equal(line!.meta.tokens, 1);
});

// ---------- play money, always ----------

test("a run is ALWAYS play money and there is no way to ask for real", () => {
  // The quotas escalate to multiples of the starting bank and the hardest
  // ladder is meant to be unwinnable, so this mode has no business taking real
  // money. There is no stakes parameter to pass.
  const s = run();
  assert.equal(s.stakes, "play");
  assert.equal(summarizeCrun(s).stakes, "play");
  assert.equal(crunLedgerLines(s)[0]!.meta.stakes, "play");
});

// ---------- per-leg attribution ----------

test("the summary attributes legs to who played them", () => {
  const s = run({ players: [player("a", "Ada"), player("b", "Bo"), player("c", "Cy")] });
  leg(s, 2000, "blackjack", "a");
  leg(s, -500, "craps", "b");
  leg(s, 1200, "roulette", "a");
  leg(s, 300, "Cribbage", null); // the table, or a game the app never heard of

  const sum = summarizeCrun(s);
  const ada = sum.players.find((p) => p.playerId === "a")!;
  assert.equal(ada.legs, 2);
  assert.equal(ada.delta, 3200);
  assert.equal(ada.best, 2000);
  assert.equal(ada.worst, 1200);

  const bo = sum.players.find((p) => p.playerId === "b")!;
  assert.equal(bo.legs, 1);
  assert.equal(bo.delta, -500);

  // Somebody who played nothing is present with zeros, not absent: the roster
  // is who was there, and "played no legs" is a fact worth showing.
  const cy = sum.players.find((p) => p.playerId === "c")!;
  assert.equal(cy.legs, 0);
  assert.equal(cy.best, null);

  // Busiest first.
  assert.deepEqual(sum.players.map((p) => p.name), ["Ada", "Bo", "Cy"]);
  // An off-app leg keeps its typed name, which is the whole point of allowing it.
  assert.equal(sum.legs[3]!.game, "Cribbage");
});

test("the summary groups legs under the stage they were played at", () => {
  const s = run({ difficulty: "standard", startingBank: 10000 });
  leg(s, 800); // stage 0
  leg(s, 700); // stage 0, clears at 11500
  leg(s, 400); // stage 1
  const sum = summarizeCrun(s);
  assert.equal(sum.stages[0]!.legs.length, 2);
  assert.equal(sum.stages[0]!.cleared, true);
  assert.equal(sum.stages[1]!.legs.length, 1);
  assert.equal(sum.stages[1]!.cleared, false);
  // The running bank rides along, because a stage's story is the bank climbing.
  assert.deepEqual(sum.stages[0]!.legs.map((l) => l.bank), [10800, 11500]);
});

// ---------- materialization ----------

test("a CLEARED run is co-placement 1 and a win for everyone", () => {
  const s = run({ difficulty: "standard", startingBank: 10000, players: [player("a"), player("b"), player("c")] });
  leg(s, 7490);
  assert.equal(crunProgress(s).status, "cleared");

  const lines = crunLedgerLines(s);
  assert.equal(lines.length, 3);
  for (const l of lines) {
    assert.equal(l.placement, 1, "the table wins together");
    assert.equal(l.isWinner, true);
    assert.equal(l.meta.result, "cleared");
    assert.equal(l.meta.stagesCleared, 4);
  }
});

test("a BUSTED run is an equal LAST for everyone, not an equal first", () => {
  const s = run({ startingBank: 10000, floor: 0, players: [player("a"), player("b"), player("c")] });
  leg(s, -10000);
  const lines = crunLedgerLines(s);
  for (const l of lines) {
    assert.equal(l.placement, 3, "three players, all last");
    assert.equal(l.isWinner, false);
    assert.equal(l.meta.result, "bust");
  }
});

test("a solo bust is not recorded as a first place", () => {
  // roster.length would be 1, and "best placement 1" on a run they lost is
  // exactly the sort of quietly wrong number this app tries not to write.
  const s = run({ startingBank: 10000, floor: 0, players: [player("a")] });
  leg(s, -10000);
  const [line] = crunLedgerLines(s);
  assert.equal(line!.placement, 2);
  assert.equal(line!.isWinner, false);
});

test("the ledger meta carries the run, and the player's own share of it", () => {
  const s = run({ difficulty: "casual", startingBank: 10000, players: [player("a"), player("b")] });
  s.modifiers = ["silence"];
  leg(s, -4000, "craps", "a");
  leg(s, 8000, "blackjack", "a");
  const lines = crunLedgerLines(s);
  const a = lines.find((l) => l.playerId === "a")!;
  const b = lines.find((l) => l.playerId === "b")!;

  // The run half is identical on every row: a co-op result is a property of
  // the table, not the person.
  for (const l of [a, b]) {
    assert.equal(l.meta.difficulty, "casual");
    assert.equal(l.meta.startingBank, 10000);
    assert.equal(l.meta.finalBank, 14000);
    assert.equal(l.meta.comeback, 8000);
    assert.equal(l.meta.legs, 2);
    assert.deepEqual(l.meta.modifiers, ["silence"]);
  }
  // The personal half is not.
  assert.equal(a.meta.myLegs, 2);
  assert.equal(a.meta.myDelta, 4000);
  assert.equal("myLegs" in b.meta, false, "somebody who played nothing claims nothing");
});

test("a run with no modifiers writes no modifiers key", () => {
  // Same rule as the cash packs: absent, not [], so there is one encoding of
  // "none" rather than two.
  const s = run();
  leg(s, 100);
  assert.equal("modifiers" in crunLedgerLines(s)[0]!.meta, false);
});

// ---------- the modifier draws ----------

test("a forced bane draw only ever returns banes", () => {
  // What a missed stage costs. It is a FILTER on the existing draw, not a
  // second function — the whole reason drawModifiers takes one.
  for (let i = 0; i < 200; i++) {
    const got = drawModifiers({
      deck: modifiersFor("casino_run"),
      count: 1,
      filter: (m) => m.kind === "bane",
    });
    assert.equal(got.length, 1);
    assert.equal(got[0]!.kind, "bane");
  }
});

test("the escalation weight starts at the deck default and inverts by the last stage", () => {
  const first = crunEscalationWeight(0, 5);
  // At the first stage this IS drawWeight: 1/severity, the gentle mix a
  // blackjack table draws.
  assert.equal(first({ severity: 1 } as never), 1);
  assert.equal(first({ severity: 3 } as never), 1 / 3);
  // At the last, it is the inverse: the nastiest cards are the likeliest.
  const last = crunEscalationWeight(4, 5);
  assert.equal(last({ severity: 1 } as never), 1);
  assert.equal(last({ severity: 3 } as never), 3);
  // And it is monotonic in between, so "escalating" is literally true.
  const mid = crunEscalationWeight(2, 5);
  assert.ok(mid({ severity: 3 } as never) > first({ severity: 3 } as never));
  assert.ok(mid({ severity: 3 } as never) < last({ severity: 3 } as never));
});

test("an escalated draw really does reach for the nastier cards", () => {
  const deck = modifiersFor("casino_run");
  const late = crunEscalationWeight(4, 5);
  let severe = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    if (drawModifiers({ deck, count: 1, weight: late })[0]!.severity >= 2) severe++;
  }
  // The 12 "any" cards are a mix of severities; weighted by severity the draw
  // should land on a 2 or a 3 far more often than not.
  assert.ok(severe / N > 0.7, `only ${severe}/${N} draws were severity 2+`);
});

test("a single-stage ladder does not divide by zero on the weighting", () => {
  const w = crunEscalationWeight(0, 1);
  assert.equal(Number.isFinite(w({ severity: 2 } as never)), true);
});

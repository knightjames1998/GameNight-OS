// Tests for the STAKES flag: real money vs play money.
//
// THE RULE THIS FILE EXISTS TO PIN: wins and placements UNIFY across stakes,
// only money SPLITS. A win is a win: you either finished the night up or you
// did not, and play money does not make that less true, while adding a $60
// real net to an 80-play-chip one produces a number that means nothing.
//
// Getting it the other way round would be silent in both directions. Splitting
// wins would quietly halve everyone's record the day they played a pretend
// night; mixing money would print one confident total that is arithmetic
// nonsense. So both halves are asserted, and so is the default: a night with no
// stakes value is REAL, because that is every night recorded before this
// shipped.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateCashNights,
  balanceWarning,
  cashLedgerLines,
  compareCashLifetime,
  formatCents,
  formatCentsShort,
  formatCentsSigned,
  money,
  newBlackjackState,
  newCrapsState,
  newRouletteState,
  settleCash,
  stakesLabel,
  stakesPrefix,
  summarizeBlackjack,
  type CashEntry,
  type CashNight,
  type CashPlayer,
} from "../src/index.js";

const player = (id: string, name = id): CashPlayer => ({ id, kind: "member", userId: `u_${id}`, name });
const entry = (playerId: string, buyIn: number, cashOut: number | null): CashEntry => ({
  playerId,
  buyIn,
  rebuys: [],
  cashOut,
  at: cashOut === null ? null : "2026-07-30T02:00:00.000Z",
});

const night = (o: Partial<CashNight> & { net: number }): CashNight => ({
  at: 0,
  totalIn: 2000,
  rebuys: 0,
  minutes: null,
  banker: false,
  ...o,
});

// ---------- formatting ----------

test("play money is prefixed, real money is not", () => {
  assert.equal(formatCents(1234, "real"), "$12.34");
  assert.equal(formatCents(1234, "play"), "P$12.34");
  assert.equal(formatCentsSigned(5000, "play"), "+P$50.00");
  assert.equal(formatCentsSigned(-5000, "play"), "-P$50.00");
  assert.equal(formatCentsSigned(0, "play"), "P$0.00");
  assert.equal(formatCentsShort(4000, "play"), "P$40");
  assert.equal(formatCentsShort(4050, "play"), "P$40.50");
  assert.equal(stakesPrefix("play"), "P$");
  assert.equal(stakesLabel("play"), "Play money");
});

test("an absent stakes value formats as real, so nothing recorded before this changed", () => {
  // Every existing call site passes no second argument. If this ever regressed,
  // every dollar figure in the app would silently gain a P.
  assert.equal(formatCents(1234), "$12.34");
  assert.equal(formatCentsSigned(-1550), "-$15.50");
  assert.equal(formatCentsShort(2000), "$20");
  assert.equal(formatCents(1234, undefined), "$12.34");
  assert.equal(stakesPrefix(undefined), "$");
  assert.equal(stakesLabel(undefined), "Real money");
});

test("the bound helper formats every shape in one stakes", () => {
  const m = money("play");
  assert.equal(m.isPlay, true);
  assert.equal(m.fmt(1000), "P$10.00");
  assert.equal(m.signed(1000), "+P$10.00");
  assert.equal(m.short(1000), "P$10");
  const r = money();
  assert.equal(r.isPlay, false);
  assert.equal(r.stakes, "real");
  assert.equal(r.fmt(1000), "$10.00");
});

test("the balance warning speaks the table's own currency", () => {
  const off = { checked: true, balanced: false, delta: 1725 };
  assert.ok(balanceWarning(off, "play")?.includes("P$17.25"));
  assert.ok(balanceWarning(off, "real")?.includes("$17.25"));
  assert.ok(!balanceWarning(off, "real")?.includes("P$"));
});

// ---------- the session carries it ----------

test("every casino pack takes stakes at start and defaults to real", () => {
  const roster = [player("a"), player("b")];
  for (const make of [newBlackjackState, newRouletteState, newCrapsState]) {
    const play = make({ bank: "casino", bankerId: null, stakes: "play", roster, defaultBuyIn: 2000 });
    assert.equal(play.stakes, "play");
    const dflt = make({ bank: "casino", bankerId: null, roster, defaultBuyIn: 2000 });
    assert.equal(dflt.stakes, "real", "an unspecified table is real money");
  }
});

test("the summary carries stakes, so no screen can render an amount without it", () => {
  const state = newBlackjackState({
    bank: "player",
    bankerId: "a",
    stakes: "play",
    roster: [player("a", "Ada"), player("b", "Bo")],
    defaultBuyIn: 2000,
  });
  assert.equal(summarizeBlackjack(state).stakes, "play");
  // And a session shape with no stakes at all still summarizes as real, which is
  // what a row written before this shipped looks like on read.
  const legacy = { ...state } as Record<string, unknown>;
  delete legacy.stakes;
  assert.equal(summarizeBlackjack(legacy as typeof state).stakes, "real");
});

test("stakes reaches the ledger meta on every row", () => {
  const core = {
    bank: "casino" as const,
    bankerId: null,
    stakes: "play" as const,
    roster: [player("a"), player("b")],
    entries: [entry("a", 2000, 5000), entry("b", 2000, 0)],
  };
  const lines = cashLedgerLines(settleCash(core, { final: true }), {
    bank: "casino",
    bankerId: null,
    stakes: "play",
  });
  for (const l of lines) assert.equal(l.meta.stakes, "play");
  // The money itself is untouched: stakes changes what a number MEANS, never
  // what it is.
  assert.equal(lines.find((l) => l.playerId === "a")!.meta.net, 3000);
});

// ---------- the split: money only ----------

test("money splits by stakes and the two totals never mix", () => {
  const agg = aggregateCashNights([
    night({ net: 6000, totalIn: 2000, stakes: "real" }),
    night({ net: -8000, totalIn: 4000, stakes: "play" }),
  ]);
  // The brief's own example: up $60 lifetime, down P$80 lifetime.
  assert.equal(agg.money.real.net, 6000);
  assert.equal(agg.money.play.net, -8000);
  assert.equal(agg.money.real.sessions, 1);
  assert.equal(agg.money.play.sessions, 1);
  assert.equal(agg.money.real.staked, 2000);
  assert.equal(agg.money.play.staked, 4000);
  // There is deliberately NO combined net anywhere on the aggregate: a number
  // that adds those two would be nonsense, so it does not exist to be rendered
  // by accident.
  assert.equal("net" in agg, false);
});

test("WINS UNIFY: nights, win rate and streaks count across both stakes", () => {
  const agg = aggregateCashNights([
    night({ at: 1, net: 100, stakes: "real" }),
    night({ at: 2, net: 100, stakes: "play" }),
    night({ at: 3, net: 100, stakes: "real" }),
  ]);
  assert.equal(agg.sessions, 3);
  assert.equal(agg.upNights, 3);
  assert.equal(agg.winRate, 1);
  // The play-money night in the middle does NOT break the run. That is the
  // whole call: a win is a win.
  assert.equal(agg.streak, 3);
  assert.equal(agg.bestStreak, 3);
});

test("a losing play-money night breaks a real-money streak, because it is still a night", () => {
  const agg = aggregateCashNights([
    night({ at: 1, net: 500, stakes: "real" }),
    night({ at: 2, net: -500, stakes: "play" }),
    night({ at: 3, net: 500, stakes: "real" }),
  ]);
  assert.equal(agg.bestStreak, 1);
  assert.equal(agg.streak, 1);
  assert.equal(agg.upNights, 2);
});

test("rebuys, hours and nights banked count once across stakes", () => {
  const agg = aggregateCashNights([
    night({ at: 1, net: 100, rebuys: 2, minutes: 60, banker: true, stakes: "real" }),
    night({ at: 2, net: 100, rebuys: 1, minutes: 30, stakes: "play" }),
  ]);
  assert.equal(agg.rebuys, 3);
  assert.equal(agg.rebuyRate, 1);
  assert.equal(agg.minutes, 90);
  assert.equal(agg.banked, 1);
});

test("averages, ROI, best, worst and net-per-hour are per stakes", () => {
  const agg = aggregateCashNights([
    night({ at: 1, net: 4000, totalIn: 2000, minutes: 60, stakes: "real" }),
    night({ at: 2, net: -1000, totalIn: 2000, minutes: 60, stakes: "real" }),
    night({ at: 3, net: 9000, totalIn: 3000, minutes: 30, stakes: "play" }),
  ]);
  const r = agg.money.real;
  assert.equal(r.net, 3000);
  assert.equal(r.avgNet, 1500);
  assert.equal(r.avgBuyIn, 2000);
  assert.equal(r.roi, 3000 / 4000);
  assert.equal(r.best, 4000);
  assert.equal(r.worst, -1000);
  assert.equal(r.netPerHour, 1500); // 3000 cents over 120 minutes

  const p = agg.money.play;
  assert.equal(p.net, 9000);
  assert.equal(p.roi, 3);
  assert.equal(p.best, 9000);
  assert.equal(p.worst, 9000);
  assert.equal(p.netPerHour, 18000); // 9000 cents over 30 minutes
});

test("a stakes nobody has played is empty rather than a row of zeros to render", () => {
  const agg = aggregateCashNights([night({ net: 5000, stakes: "real" })]);
  assert.equal(agg.money.play.sessions, 0);
  assert.equal(agg.money.play.net, 0);
  assert.equal(agg.money.play.roi, null);
  assert.equal(agg.money.play.best, null);
  assert.equal(agg.money.play.netPerHour, null);
});

test("a night with NO stakes value counts as real money", () => {
  // Every row written before play money existed. If this defaulted the other
  // way, a crew's whole real-money history would move into play overnight.
  const agg = aggregateCashNights([night({ net: 5000, totalIn: 2000 })]);
  assert.equal(agg.money.real.sessions, 1);
  assert.equal(agg.money.real.net, 5000);
  assert.equal(agg.money.play.sessions, 0);
});

test("the streak walk uses the timestamps, not the array order", () => {
  const agg = aggregateCashNights([
    night({ at: 3, net: 100 }),
    night({ at: 1, net: 100 }),
    night({ at: 2, net: -100 }),
  ]);
  // Oldest first is up, down, up -> the CURRENT run is 1, the best is 1.
  assert.equal(agg.streak, 1);
  assert.equal(agg.bestStreak, 1);
});

test("an empty history is all zeros and no divide by zero", () => {
  const agg = aggregateCashNights([]);
  assert.equal(agg.sessions, 0);
  assert.equal(agg.winRate, 0);
  assert.equal(agg.rebuyRate, 0);
  assert.equal(agg.money.real.roi, null);
  assert.equal(agg.money.play.roi, null);
});

// ---------- ordering ----------

test("real money outranks play money on the leaderboard, always", () => {
  const bigPlay = aggregateCashNights([night({ net: 500000, stakes: "play" })]);
  const smallReal = aggregateCashNights([night({ net: 100, stakes: "real" })]);
  // A five-thousand-dollar play night must not outrank a one-dollar real one.
  assert.ok(compareCashLifetime(smallReal, bigPlay) < 0);
  assert.ok(compareCashLifetime(bigPlay, smallReal) > 0);
});

test("play money breaks the tie between people who have never played for real", () => {
  const a = aggregateCashNights([night({ net: 9000, stakes: "play" })]);
  const b = aggregateCashNights([night({ net: 100, stakes: "play" })]);
  assert.ok(compareCashLifetime(a, b) < 0);
});

test("two players level on real money are ordered by their real net, not their play net", () => {
  const a = aggregateCashNights([night({ net: 5000, stakes: "real" }), night({ net: 1, stakes: "play" })]);
  const b = aggregateCashNights([night({ net: 9000, stakes: "real" }), night({ net: 900000, stakes: "play" })]);
  assert.ok(compareCashLifetime(b, a) < 0);
});

// Tests for the roulette pack's own rules (packages/shared/src/roulette.ts).
//
// The MONEY is not retested here (buy-ins, rebuys, net, placement, the
// derived banker and the balance check all live in the shared engine and are
// covered exhaustively in cashgame.test.ts). That split IS the point of the
// casino group: a second pack does not get a second copy of the money rules,
// so it does not need a second copy of the money tests either. What is left
// is roulette's two detail stats, and the two of them are deliberately
// different in kind.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROULETTE_BETS,
  betLabel,
  detailFromSpins,
  isRouletteBet,
  newRouletteState,
  rlDetail,
  settleCash,
  spinPayout,
  summarizeRoulette,
  type CashPlayer,
  type RlSpin,
} from "../src/index.js";

const player = (id: string, name = id): CashPlayer => ({
  id,
  kind: "member",
  userId: `u_${id}`,
  name,
});

const AT = "2026-07-29T02:00:00.000Z";
const spin = (playerId: string, bet: string, stake: number, won: boolean): RlSpin => ({
  playerId,
  bet,
  stake,
  won,
  at: AT,
});

const table = () =>
  newRouletteState({
    bank: "player",
    bankerId: "bank",
    roster: [player("bank", "Dealer"), player("a", "Ada"), player("b", "Bo")],
    defaultBuyIn: 2000,
    buyIns: { bank: 30000 },
    tracker: true,
  });

// ---------- payouts ----------

test("a spin pays the bet's odds on the stake, and nothing when it misses", () => {
  // Even money on the outside, 35:1 on a single number.
  assert.equal(spinPayout({ bet: "red", stake: 1000, won: true }), 1000);
  assert.equal(spinPayout({ bet: "dozen", stake: 1000, won: true }), 2000);
  assert.equal(spinPayout({ bet: "straight", stake: 100, won: true }), 3500);
  assert.equal(spinPayout({ bet: "red", stake: 1000, won: false }), 0);
  // An unknown bet type pays nothing rather than throwing: the server
  // validates, and a legacy row must never crash a read.
  assert.equal(spinPayout({ bet: "nonsense", stake: 1000, won: true }), 0);
});

test("payouts stay integer cents at every odds", () => {
  for (const b of ROULETTE_BETS) {
    const paid = spinPayout({ bet: b.id, stake: 333, won: true });
    assert.equal(Number.isSafeInteger(paid), true, b.id);
    assert.equal(paid, 333 * b.to1, b.id);
  }
});

test("the bet list is self-consistent and safe to look up", () => {
  const ids = ROULETTE_BETS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate bet id");
  for (const b of ROULETTE_BETS) {
    assert.ok(b.to1 >= 1, b.id);
    assert.equal(isRouletteBet(b.id), true, b.id);
    assert.equal(betLabel(b.id), b.label, b.id);
  }
  assert.equal(isRouletteBet("roulette"), false);
  assert.equal(isRouletteBet(null), false);
  assert.equal(isRouletteBet(7), false);
  // An unknown id still renders as something rather than blank.
  assert.equal(betLabel("mystery"), "mystery");
  assert.equal(betLabel(null), "");
});

// ---------- the streak: tracker-only, on purpose ----------

test("the winning streak is the longest RUN, not the total wins", () => {
  const spins = [
    spin("a", "red", 500, true),
    spin("a", "red", 500, true),
    spin("a", "black", 500, false),
    spin("a", "red", 500, true),
    spin("a", "red", 500, true),
    spin("a", "red", 500, true),
    spin("a", "red", 500, false),
  ];
  const d = detailFromSpins(spins, "a");
  assert.equal(d.bestStreak, 3); // five wins, best run of three
});

test("another player's spins never join your streak", () => {
  // Interleaved, which is what a real table looks like: without the
  // per-player filter this would read as a run of four.
  const spins = [
    spin("a", "red", 500, true),
    spin("b", "red", 500, true),
    spin("a", "red", 500, false),
    spin("b", "red", 500, true),
  ];
  assert.equal(detailFromSpins(spins, "a").bestStreak, 1);
  assert.equal(detailFromSpins(spins, "b").bestStreak, 2);
});

test("a streak with no tracker is ABSENT, never zero", () => {
  // The group's rule: a stat that cannot be reconstructed after the fact is
  // missing rather than invented. Zero would claim the player never won twice
  // running; null admits nobody was counting.
  const state = table();
  state.tracker = false;
  state.spins = [];
  assert.equal(rlDetail(state, "a").bestStreak, null);
  assert.equal(summarizeRoulette(state).players[0]!.detail.bestStreak, null);
});

test("there is no typed streak, so a host cannot guess one into the ledger", () => {
  const state = table();
  state.spins = [spin("a", "red", 500, true), spin("a", "red", 500, true)];
  // Even if a detail bag arrives carrying one, the read ignores it: the
  // streak comes from the spins or it is null.
  (state.detail as Record<string, unknown>).a = { favouriteBet: "red", bestStreak: 99 };
  assert.equal(rlDetail(state, "a").bestStreak, 2);
});

// ---------- the favourite bet: typed OR derived ----------

test("the favourite bet is the most-played one", () => {
  const spins = [
    spin("a", "red", 500, true),
    spin("a", "red", 500, false),
    spin("a", "straight", 100, false),
  ];
  assert.equal(detailFromSpins(spins, "a").favouriteBet, "red");
});

test("a tie on count falls to whoever was staked more, then to board order", () => {
  // Two each; black carried more money, so it is the honest answer.
  const staked = [
    spin("a", "red", 100, false),
    spin("a", "red", 100, false),
    spin("a", "black", 900, false),
    spin("a", "black", 900, false),
  ];
  assert.equal(detailFromSpins(staked, "a").favouriteBet, "black");

  // Dead tie on both: the board's own order decides, so the answer is stable
  // rather than depending on which spin happened to be recorded first.
  const dead = [spin("a", "black", 500, false), spin("a", "red", 500, false)];
  assert.equal(detailFromSpins(dead, "a").favouriteBet, "red");
  assert.equal(detailFromSpins([...dead].reverse(), "a").favouriteBet, "red");
});

test("a typed favourite beats the tracker, and the streak survives it", () => {
  const state = table();
  state.spins = [
    spin("a", "red", 500, true),
    spin("a", "red", 500, true),
    spin("a", "black", 500, false),
  ];
  state.detail.a = { favouriteBet: "straight" };
  const d = rlDetail(state, "a");
  assert.equal(d.favouriteBet, "straight"); // the host corrected it
  assert.equal(d.bestStreak, 2); // and did not wipe what the tracker knew
});

test("a player the tracker never saw has no detail at all", () => {
  const spins = [spin("a", "red", 500, true)];
  assert.deepEqual(detailFromSpins(spins, "b"), { favouriteBet: null, bestStreak: null });
});

// ---------- the shared engine, reached through roulette ----------

test("a roulette night settles exactly like a blackjack one", () => {
  // Not a re-test of the money rules, a test that this pack is WIRED to them:
  // per-player buy-ins, a derived banker, placement by net.
  const state = table();
  state.entries = [
    { playerId: "bank", buyIn: 30000, rebuys: [], cashOut: 26500, at: AT },
    { playerId: "a", buyIn: 2000, rebuys: [2000], cashOut: 9000, at: AT }, // +50.00
    { playerId: "b", buyIn: 2000, rebuys: [], cashOut: 500, at: AT }, // -15.00
  ];
  const sum = summarizeRoulette(state);
  assert.deepEqual(sum.players.map((p) => p.name), ["Ada", "Bo", "Dealer"]);
  assert.deepEqual(sum.players.map((p) => p.net), [5000, -1500, -3500]);
  assert.deepEqual(sum.players.map((p) => p.placement), [1, 2, 3]);
  assert.equal(sum.players[2]!.derived, true);
  assert.equal(sum.balance.checked, true);
  assert.equal(sum.balance.balanced, true);
  assert.equal(sum.warning, null);
  // And the whole table sums to zero, the property the check exists for.
  assert.equal(settleCash(state, { final: true }).lines.reduce((t, l) => t + (l.net ?? 0), 0), 0);
});

test("per-player buy-ins survive from setup into the settlement", () => {
  // The banker's float is nearly always different from everyone else's, which
  // is the case per-player amounts exist for.
  const state = table();
  assert.equal(state.entries.find((e) => e.playerId === "bank")!.buyIn, 30000);
  assert.equal(state.entries.find((e) => e.playerId === "a")!.buyIn, 2000);
  assert.equal(state.entries.find((e) => e.playerId === "b")!.buyIn, 2000);
  const sum = summarizeRoulette(state);
  assert.equal(sum.totalIn, 34000);
  assert.equal(sum.players.find((p) => p.isBanker)!.buyIn, 30000);
});

test("the summary counts spins per player and across the table", () => {
  const state = table();
  state.spins = [spin("a", "red", 500, true), spin("a", "red", 500, false), spin("b", "odd", 500, true)];
  const sum = summarizeRoulette(state);
  assert.equal(sum.events, 3);
  assert.equal(sum.players.find((p) => p.name === "Ada")!.events, 2);
  assert.equal(sum.players.find((p) => p.name === "Bo")!.events, 1);
  assert.equal(sum.players.find((p) => p.isBanker)!.events, 0);
});

test("a fresh roulette session has the tracker OFF and no spins", () => {
  const state = newRouletteState({
    bank: "casino",
    bankerId: null,
    roster: [player("a")],
    defaultBuyIn: 2000,
  });
  assert.equal(state.tracker, false);
  assert.deepEqual(state.spins, []);
  assert.deepEqual(state.detail, {});
  assert.equal(state.bankerId, null);
  assert.equal(state.openScoring, false);
});

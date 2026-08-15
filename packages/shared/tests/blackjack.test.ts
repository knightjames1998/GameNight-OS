// Blackjack's own layer on top of the shared cash engine: what a hand PAYS,
// and how a night's three details are derived when the tracker was on and
// respected when the host typed them by hand.
//
// It had no test file. cashgame.test.ts and stakes.test.ts cover the money
// engine underneath, which is where buy-ins, rebuys, cash-outs and settlement
// live. What is untested is the part that is blackjack's alone, and it is the
// part with the arithmetic in it: a 3:2 payout on an odd bet, in integer cents,
// with no float anywhere.
//
// EVERY NUMBER HERE IS CENTS. A float creeping into this file would not throw,
// it would put a fraction of a cent into a lifetime money stat and round
// differently on two screens.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handPayout,
  detailFromHands,
  bjDetail,
  handCount,
  newBlackjackState,
  EMPTY_DETAIL,
  DEFAULT_BUY_IN,
  type BjHand,
  type BjSessionState,
} from "../src/index.js";

const hand = (playerId: string, bet: number, result: BjHand["result"]): BjHand => ({
  playerId,
  bet,
  result,
  at: new Date(2026, 6, 28, 20, 0).toISOString(),
});

function state(over: Partial<BjSessionState> = {}): BjSessionState {
  return {
    ...newBlackjackState({
      bank: "chips",
      bankerId: null,
      roster: [
        { id: "p0", kind: "member", userId: "u0", name: "Ann" },
        { id: "p1", kind: "member", userId: "u1", name: "Ben" },
      ],
      defaultBuyIn: DEFAULT_BUY_IN,
      tracker: true,
    }),
    ...over,
  };
}

// ---------- what a hand pays ----------

test("a win pays even money and a loss or push pays nothing", () => {
  assert.equal(handPayout({ bet: 500, result: "win" }), 500);
  assert.equal(handPayout({ bet: 500, result: "lose" }), 0);
  assert.equal(handPayout({ bet: 500, result: "push" }), 0, "a push returns the bet, it does not PAY");
});

test("a blackjack pays 3:2", () => {
  assert.equal(handPayout({ bet: 200, result: "blackjack" }), 300);
  assert.equal(handPayout({ bet: 1000, result: "blackjack" }), 1500);
});

test("A 3:2 PAYOUT IS FLOORED, because a house pays in chips it has", () => {
  // 250 cents on a blackjack is 375. 251 is 376.5, and the table pays 376.
  // Rounding up would invent money; a float would put half a cent into a
  // lifetime total and render differently on two screens.
  assert.equal(handPayout({ bet: 251, result: "blackjack" }), 376);
  assert.equal(handPayout({ bet: 1, result: "blackjack" }), 1);
  assert.equal(handPayout({ bet: 3, result: "blackjack" }), 4);
  assert.ok(Number.isInteger(handPayout({ bet: 333, result: "blackjack" })));
});

test("a negative or fractional bet is clamped and truncated before it pays", () => {
  assert.equal(handPayout({ bet: -100, result: "win" }), 0, "a negative bet cannot pay out");
  assert.equal(handPayout({ bet: 10.9, result: "win" }), 10);
  assert.equal(handPayout({ bet: 0, result: "blackjack" }), 0);
});

// ---------- the derived details ----------

test("a player with no tracked hands has UNKNOWN details, not zeroes", () => {
  // The whole reason every field is nullable. A zero biggest-bet would drag a
  // lifetime average down with a night that simply was not measured.
  assert.deepEqual(detailFromHands([], "p0"), EMPTY_DETAIL);
  assert.deepEqual(detailFromHands([hand("p1", 500, "win")], "p0"), EMPTY_DETAIL);
});

test("the details come from THIS player's hands only", () => {
  const hands = [hand("p0", 200, "win"), hand("p1", 9000, "blackjack"), hand("p0", 500, "lose")];
  assert.deepEqual(detailFromHands(hands, "p0"), {
    biggestBet: 500,
    biggestWin: 200,
    blackjacks: 0,
  });
});

test("biggest WIN is what was paid, which is not what was bet", () => {
  // A 400 bet that wins pays 400; a 300 bet on a blackjack pays 450. The
  // bigger bet is not the bigger win, which is exactly why they are two fields.
  const hands = [hand("p0", 400, "win"), hand("p0", 300, "blackjack")];
  assert.deepEqual(detailFromHands(hands, "p0"), {
    biggestBet: 400,
    biggestWin: 450,
    blackjacks: 1,
  });
});

test("a player who only ever lost has a biggest bet and NO biggest win", () => {
  const hands = [hand("p0", 700, "lose"), hand("p0", 200, "push")];
  assert.deepEqual(detailFromHands(hands, "p0"), {
    biggestBet: 700,
    biggestWin: null,
    blackjacks: 0,
  });
});

test("blackjacks are counted even when the bet was zero", () => {
  const hands = [hand("p0", 0, "blackjack")];
  const d = detailFromHands(hands, "p0");
  assert.equal(d.blackjacks, 1);
  assert.equal(d.biggestWin, null, "it paid nothing, so there is no win to report");
  assert.equal(d.biggestBet, 0, "a zero bet is a known bet, unlike a missing one");
});

// ---------- typed beats derived, PER FIELD ----------

test("what the host typed wins, and the tracker fills only the gaps", () => {
  // Per field rather than per player, which is the point: a host correcting the
  // biggest bet on the cash-out form must not silently discard the blackjack
  // count the tracker spent the night keeping.
  const s = state({
    hands: [hand("p0", 400, "win"), hand("p0", 300, "blackjack")],
    detail: { p0: { biggestBet: 9999, biggestWin: null, blackjacks: null } },
  });
  assert.deepEqual(bjDetail(s, "p0"), {
    biggestBet: 9999,
    biggestWin: 450,
    blackjacks: 1,
  });
});

test("a typed ZERO is a real answer and is not overwritten by the tracker", () => {
  // ?? and not ||. A host who types 0 blackjacks is stating something, and a
  // truthiness check would throw that away and substitute the derived count.
  const s = state({
    hands: [hand("p0", 300, "blackjack")],
    detail: { p0: { biggestBet: null, biggestWin: null, blackjacks: 0 } },
  });
  assert.equal(bjDetail(s, "p0").blackjacks, 0);
});

test("with the tracker off, only what the host typed exists", () => {
  const s = state({ hands: [], detail: { p0: { biggestBet: 500, biggestWin: null, blackjacks: null } } });
  assert.deepEqual(bjDetail(s, "p0"), { biggestBet: 500, biggestWin: null, blackjacks: null });
});

test("a player nobody typed or tracked reads as all unknown", () => {
  assert.deepEqual(bjDetail(state(), "p0"), EMPTY_DETAIL);
});

// ---------- hand counts ----------

test("handCount counts this player's hands and is zero when the tracker was off", () => {
  const s = state({ hands: [hand("p0", 100, "win"), hand("p1", 100, "win"), hand("p0", 100, "lose")] });
  assert.equal(handCount(s, "p0"), 2);
  assert.equal(handCount(s, "p1"), 1);
  assert.equal(handCount(s, "nobody"), 0);
  assert.equal(handCount(state(), "p0"), 0);
});

// ---------- the table default ----------

test("the default buy-in is twenty dollars, in cents", () => {
  // Pinned because everything in the cash group is cents and a stray 20 here
  // would be a twenty-cent table that nobody would notice until settlement.
  assert.equal(DEFAULT_BUY_IN, 2000);
  assert.ok(Number.isInteger(DEFAULT_BUY_IN));
});

test("EMPTY_DETAIL is all nulls, and callers must not mutate the shared one", () => {
  assert.deepEqual(EMPTY_DETAIL, { biggestBet: null, biggestWin: null, blackjacks: null });
  // detailFromHands returns a COPY on the empty path, so a caller writing to
  // its result cannot poison every future read.
  const got = detailFromHands([], "p0");
  got.blackjacks = 99;
  assert.equal(EMPTY_DETAIL.blackjacks, null);
});

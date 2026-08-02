// Blackjack pack: shared types and pure session logic. The first pack on the
// shared cash-game engine (cashgame.ts), which owns everything about money:
// buy-ins, rebuys, cash-outs, net, placement by net rank, and the zero-sum
// balance check. This file owns only what is blackjack.
//
// TWO INPUT PATHS, and the default is the quiet one.
//
//   1. The CASH-OUT SCREEN (default, and what most nights use). Two
//      interactions per player per night: a buy-in at the start, a short
//      cash-out form at the end. Everything in the "free stats" list (net,
//      win rate, ROI, biggest night, rebuy rate, streaks) falls out of those
//      two numbers with no further input.
//   2. The LIVE TRACKER (opt-in, OFF by default, flipped on mid-session by
//      the host). Per hand: the bet and how it went. That is what turns
//      biggest bet, biggest win and blackjacks hit into things the app knows
//      rather than things somebody has to remember.
//
// THE RULE BETWEEN THEM: the tracker being off must never lose a stat the
// cash-out form could have captured. So the three blackjack details are BOTH
// derivable from the tracker AND typeable on the cash-out form, and the form
// prefills from the tracker when it was running. Nothing is only reachable
// through the tracker, because nothing here is un-reconstructable (unlike a
// roulette streak or a craps roll length, which genuinely are).

import {
  newCashState,
  summarizeCash,
  type CashBank,
  type CashStakes,
  type CashEntry,
  type CashPackState,
  type CashPlayer,
  type CashSummary,
} from "./cashgame.js";

/** How one tracked hand finished. */
export type BjHandResult = "win" | "lose" | "push" | "blackjack";

/** One hand, recorded only while the live tracker is on. */
export interface BjHand {
  playerId: string;
  /** cents */
  bet: number;
  result: BjHandResult;
  at: string;
}

/**
 * The three blackjack details, per player. Every field is nullable and
 * "unknown" is a real answer: a night played with the tracker off and the
 * optional boxes left empty simply has no biggest bet, rather than a zero
 * that would drag a lifetime average down.
 */
export interface BjDetail {
  /** cents */
  biggestBet: number | null;
  /** cents */
  biggestWin: number | null;
  blackjacks: number | null;
}

export const EMPTY_DETAIL: BjDetail = { biggestBet: null, biggestWin: null, blackjacks: null };

export interface BjSessionState extends CashPackState {
  /** Empty unless the tracker has been on at some point. */
  hands: BjHand[];
  /** playerId -> whatever the host typed on the cash-out form. */
  detail: Record<string, BjDetail>;
}

/** A sensible table default: $20, in cents, because everything is in cents. */
export const DEFAULT_BUY_IN = 2000;

export function newBlackjackState(opts: {
  bank: CashBank;
  bankerId: string | null;
  stakes?: CashStakes;
  roster: CashPlayer[];
  defaultBuyIn: number;
  buyIns?: Record<string, number>;
  tracker?: boolean;
  modifiers?: string[];
}): BjSessionState {
  return { ...newCashState(opts), hands: [], detail: {} };
}

/**
 * What a hand PAID, in cents, which is not the same as what was bet.
 *
 * A win pays even money, a blackjack pays 3:2, a push pays nothing and a loss
 * pays nothing. The 3:2 is floored rather than rounded, because a house pays
 * out in chips it has: a $2.50 bet on a blackjack pays $3.75, and an odd-cent
 * bet pays the lower whole cent. Integer in, integer out, no float anywhere.
 */
export function handPayout(hand: { bet: number; result: BjHandResult }): number {
  const bet = Math.max(0, Math.trunc(hand.bet));
  switch (hand.result) {
    case "win":
      return bet;
    case "blackjack":
      return Math.floor((bet * 3) / 2);
    default:
      return 0;
  }
}

/** Derive the three details from the tracked hands alone. */
export function detailFromHands(hands: BjHand[], playerId: string): BjDetail {
  let biggestBet: number | null = null;
  let biggestWin: number | null = null;
  let blackjacks = 0;
  let any = false;
  for (const h of hands) {
    if (h.playerId !== playerId) continue;
    any = true;
    const bet = Math.max(0, Math.trunc(h.bet));
    if (biggestBet === null || bet > biggestBet) biggestBet = bet;
    const won = handPayout(h);
    if (won > 0 && (biggestWin === null || won > biggestWin)) biggestWin = won;
    if (h.result === "blackjack") blackjacks++;
  }
  return any ? { biggestBet, biggestWin, blackjacks } : { ...EMPTY_DETAIL };
}

/**
 * A player's details as they should be READ: whatever the host typed wins,
 * and the tracker fills the gaps.
 *
 * Typed beats derived per field rather than per player, so a host who
 * corrects the biggest bet on the cash-out form does not silently throw away
 * the blackjack count the tracker was keeping.
 */
export function bjDetail(state: BjSessionState, playerId: string): BjDetail {
  const typed = state.detail[playerId];
  const derived = state.hands.length ? detailFromHands(state.hands, playerId) : EMPTY_DETAIL;
  return {
    biggestBet: typed?.biggestBet ?? derived.biggestBet,
    biggestWin: typed?.biggestWin ?? derived.biggestWin,
    blackjacks: typed?.blackjacks ?? derived.blackjacks,
  };
}

/** How many hands the tracker recorded for one player. 0 when it was off. */
export function handCount(state: BjSessionState, playerId: string): number {
  let n = 0;
  for (const h of state.hands) if (h.playerId === playerId) n++;
  return n;
}

// ---------- the night, as every screen reads it ----------

export type BjSummary = CashSummary<BjDetail>;

/** The whole night in one object, for the pack page, the TV board and the payload. */
export function summarizeBlackjack(state: BjSessionState): BjSummary {
  return summarizeCash<BjDetail>(state, {
    of: (id) => bjDetail(state, id),
    events: (id) => handCount(state, id),
    total: state.hands.length,
  });
}

/** The entry for one player, created on demand so a late arrival is cheap. */
export function entryFor(state: BjSessionState, playerId: string): CashEntry {
  let e = state.entries.find((x) => x.playerId === playerId);
  if (!e) {
    e = { playerId, buyIn: state.defaultBuyIn, rebuys: [], cashOut: null, at: null };
    state.entries.push(e);
  }
  return e;
}

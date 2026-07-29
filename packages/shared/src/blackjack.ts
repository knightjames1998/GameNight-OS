// Blackjack pack: shared types and pure session logic. The first pack on the
// shared cash-game engine (cashgame.ts), which owns everything about money —
// buy-ins, rebuys, cash-outs, net, placement by net rank, and the zero-sum
// balance check. This file owns only what is blackjack.
//
// TWO INPUT PATHS, and the default is the quiet one.
//
//   1. The CASH-OUT SCREEN (default, and what most nights use). Two
//      interactions per player per night: a buy-in at the start, a short
//      cash-out form at the end. Everything in the "free stats" list — net,
//      win rate, ROI, biggest night, rebuy rate, streaks — falls out of those
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
  balanceWarning,
  settleCash,
  type CashBank,
  type CashEntry,
  type CashPlayer,
  type CashSessionCore,
  type CashSettlement,
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

export interface BjSessionState extends CashSessionCore {
  /**
   * Unique per session start, exactly as every other pack uses it: the ledger
   * key is blackjack:{eventId}:{sessionKey}:0, so a second night on the same
   * recurring event cannot collide with the first and get dropped as a
   * duplicate.
   */
  sessionKey: string;
  bank: CashBank;
  bankerId: string | null;
  /** ISO. Start of play, so net-per-hour is derivable at completion. */
  startedAt: string;
  /** cents. Prefilled on the buy-in and rebuy controls; not a rule. */
  defaultBuyIn: number;
  /** The live tracker. OFF by default; the host may flip it mid-session. */
  tracker: boolean;
  /** Standing rule 1: only owners/admins record unless the host opens it. */
  openScoring: boolean;
  roster: CashPlayer[];
  entries: CashEntry[];
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
  roster: CashPlayer[];
  defaultBuyIn: number;
  buyIns?: Record<string, number>;
  tracker?: boolean;
}): BjSessionState {
  const buy = Math.max(0, Math.trunc(opts.defaultBuyIn));
  return {
    sessionKey: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    bank: opts.bank,
    bankerId: opts.bank === "player" ? opts.bankerId : null,
    startedAt: new Date().toISOString(),
    defaultBuyIn: buy,
    tracker: opts.tracker ?? false,
    openScoring: false,
    roster: opts.roster,
    entries: opts.roster.map((p) => ({
      playerId: p.id,
      buyIn: Math.max(0, Math.trunc(opts.buyIns?.[p.id] ?? buy)),
      rebuys: [],
      cashOut: null,
      at: null,
    })),
    hands: [],
    detail: {},
  };
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

export interface BjPlayerRow {
  playerId: string;
  name: string;
  kind: "member" | "guest";
  isBanker: boolean;
  /** cents */
  buyIn: number;
  rebuys: number;
  /** cents */
  rebuyTotal: number;
  /** cents */
  totalIn: number;
  /** cents; null while still at the table */
  cashOut: number | null;
  cashedOut: boolean;
  /** cents; null while still at the table (the banker's is always known) */
  net: number | null;
  /** True when this net was derived from the rest of the table. */
  derived: boolean;
  placement: number | null;
  hands: number;
  detail: BjDetail;
}

export interface BjSummary {
  bank: CashBank;
  bankerId: string | null;
  /** Sorted: up first, down last, still-at-the-table after both. */
  players: BjPlayerRow[];
  /** cents */
  totalIn: number;
  /** cents */
  totalOut: number;
  /** cents still in play */
  onTable: number;
  stillIn: number;
  cashedOut: number;
  hands: number;
  balance: CashSettlement["balance"];
  /** Null unless the table is player-banked AND does not balance. */
  warning: string | null;
}

/**
 * The whole night in one object, for the pack page, the TV board and the
 * session payload. Derived on every read rather than maintained, for the same
 * reason Smashdown's burn board is: a maintained total and an undone rebuy
 * drift apart silently, and money that drifts is the worst kind.
 */
export function summarizeBlackjack(state: BjSessionState): BjSummary {
  const settlement = settleCash(state);
  const nameOf = new Map(state.roster.map((p) => [p.id, p]));
  const players: BjPlayerRow[] = settlement.lines.map((l) => {
    const slot = nameOf.get(l.playerId);
    return {
      playerId: l.playerId,
      name: slot?.name ?? "",
      kind: slot?.kind ?? "guest",
      isBanker: state.bank === "player" && state.bankerId === l.playerId,
      buyIn: l.buyIn,
      rebuys: l.rebuys,
      rebuyTotal: l.rebuyTotal,
      totalIn: l.totalIn,
      cashOut: l.cashOut,
      cashedOut: l.cashedOut,
      net: l.net,
      derived: l.derived,
      placement: l.placement,
      hands: handCount(state, l.playerId),
      detail: bjDetail(state, l.playerId),
    };
  });

  return {
    bank: state.bank,
    bankerId: state.bankerId,
    players,
    totalIn: settlement.totalIn,
    totalOut: settlement.totalOut,
    onTable: settlement.onTable,
    stillIn: settlement.stillIn,
    cashedOut: players.length - settlement.stillIn,
    hands: state.hands.length,
    balance: settlement.balance,
    // Null until the banker has counted their own rack, which is the moment
    // there is anything to disagree with. See settleCash's balance rules.
    warning: balanceWarning(settlement.balance),
  };
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

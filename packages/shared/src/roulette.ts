// Roulette pack: shared types and pure session logic. The SECOND pack on the
// cash-game engine (cashgame.ts), and deliberately thin — the engine owns
// every number that involves money, so this file owns only what is roulette.
//
// Compare it with blackjack.ts: same shape, same length, and neither one
// re-implements a buy-in, a net, a placement or the balance check. That is the
// whole point of the group's design, and it is what makes craps and poker
// cheap.
//
// TWO DETAIL STATS, and they are deliberately different in kind:
//
//   - FAVOURITE BET TYPE is reconstructable after the fact. Anyone can say
//     "I was on red all night", so it is a typed field on the cash-out form
//     AND derived from the tracker when it ran.
//   - MAX CONSECUTIVE WINNING SPINS is NOT. A streak is an ordering fact, and
//     nobody remembers it honestly at 1am, so it REQUIRES the tracker and is
//     simply ABSENT on a night the tracker was off. That is the group's rule
//     working as intended: absent beats invented.

import {
  newCashState,
  summarizeCash,
  type CashBank,
  type CashPackState,
  type CashPlayer,
  type CashSummary,
} from "./cashgame.js";

/**
 * The bets a friend-group roulette night actually names, with the payout the
 * table pays on each. Ordered outside-in, which is how a board reads.
 *
 * Payouts are the standard ones and are held here rather than in the UI so
 * the tracker can report what a spin paid without the screen doing money
 * arithmetic. `to1` is the multiple of the stake the WIN pays, on top of the
 * stake coming back.
 */
export interface RlBetDef {
  id: string;
  label: string;
  /** Wins pay stake * to1. Red pays 1:1, a straight number pays 35:1. */
  to1: number;
}

export const ROULETTE_BETS: RlBetDef[] = [
  { id: "red", label: "Red", to1: 1 },
  { id: "black", label: "Black", to1: 1 },
  { id: "odd", label: "Odd", to1: 1 },
  { id: "even", label: "Even", to1: 1 },
  { id: "low", label: "1–18", to1: 1 },
  { id: "high", label: "19–36", to1: 1 },
  { id: "dozen", label: "Dozen", to1: 2 },
  { id: "column", label: "Column", to1: 2 },
  { id: "line", label: "Line (6)", to1: 5 },
  { id: "corner", label: "Corner (4)", to1: 8 },
  { id: "street", label: "Street (3)", to1: 11 },
  { id: "split", label: "Split (2)", to1: 17 },
  { id: "straight", label: "Straight up", to1: 35 },
];

const BET_BY_ID = new Map(ROULETTE_BETS.map((b) => [b.id, b]));

/** A bet's display label, falling back to the raw id so nothing renders blank. */
export const betLabel = (id: string | null | undefined): string =>
  (id ? BET_BY_ID.get(id)?.label : undefined) ?? (id ?? "");

/** Is this a bet type the pack knows? The server validates with it. */
export const isRouletteBet = (id: unknown): id is string =>
  typeof id === "string" && BET_BY_ID.has(id);

/** One spin, recorded only while the live tracker is on. */
export interface RlSpin {
  playerId: string;
  /** A ROULETTE_BETS id. */
  bet: string;
  /** cents */
  stake: number;
  won: boolean;
  at: string;
}

/**
 * What a spin PAID, in cents: the stake times the bet's odds, or nothing.
 *
 * The stake itself coming back is not a payout, so a winning even-money bet
 * pays the stake once, not twice. Integer in, integer out.
 */
export function spinPayout(spin: { bet: string; stake: number; won: boolean }): number {
  if (!spin.won) return 0;
  const def = BET_BY_ID.get(spin.bet);
  if (!def) return 0;
  return Math.max(0, Math.trunc(spin.stake)) * def.to1;
}

export interface RlDetail {
  /** A ROULETTE_BETS id, or null when nobody said and nothing was tracked. */
  favouriteBet: string | null;
  /**
   * Max consecutive winning spins. TRACKER ONLY: null when the tracker was
   * off, because a streak cannot be reconstructed from a cash-out, and a zero
   * would claim the player never won twice in a row rather than admitting
   * nobody was counting.
   */
  bestStreak: number | null;
}

export const EMPTY_RL_DETAIL: RlDetail = { favouriteBet: null, bestStreak: null };

export interface RlSessionState extends CashPackState {
  /** Empty unless the tracker has been on at some point. */
  spins: RlSpin[];
  /** playerId -> whatever the host typed on the cash-out form. */
  detail: Record<string, { favouriteBet: string | null }>;
}

export function newRouletteState(opts: {
  bank: CashBank;
  bankerId: string | null;
  roster: CashPlayer[];
  defaultBuyIn: number;
  buyIns?: Record<string, number>;
  tracker?: boolean;
}): RlSessionState {
  return { ...newCashState(opts), spins: [], detail: {} };
}

/**
 * Derive both details from the tracked spins alone.
 *
 * FAVOURITE is most-played, with ties broken by total stake and then by the
 * board's own order, so the answer is stable rather than depending on which
 * spin happened to be recorded first. STREAK is the longest run of wins in
 * spin order, which is why it needs the tracker at all.
 */
export function detailFromSpins(spins: RlSpin[], playerId: string): RlDetail {
  const count = new Map<string, { n: number; staked: number }>();
  let best = 0;
  let run = 0;
  let any = false;

  for (const s of spins) {
    if (s.playerId !== playerId) continue;
    any = true;
    const e = count.get(s.bet) ?? { n: 0, staked: 0 };
    e.n++;
    e.staked += Math.max(0, Math.trunc(s.stake));
    count.set(s.bet, e);
    if (s.won) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  if (!any) return { ...EMPTY_RL_DETAIL };

  let favouriteBet: string | null = null;
  let bestEntry = { n: 0, staked: 0 };
  for (const def of ROULETTE_BETS) {
    const e = count.get(def.id);
    if (!e) continue;
    if (e.n > bestEntry.n || (e.n === bestEntry.n && e.staked > bestEntry.staked)) {
      bestEntry = e;
      favouriteBet = def.id;
    }
  }
  return { favouriteBet, bestStreak: best };
}

/**
 * A player's details as they should be READ.
 *
 * A typed favourite beats a derived one, because the host is correcting the
 * tracker rather than adding to it. The STREAK has no typed counterpart at
 * all: it comes from the spins or it is null, and there is deliberately no box
 * on the cash-out form to put one in.
 */
export function rlDetail(state: RlSessionState, playerId: string): RlDetail {
  const derived = state.spins.length ? detailFromSpins(state.spins, playerId) : EMPTY_RL_DETAIL;
  return {
    favouriteBet: state.detail[playerId]?.favouriteBet ?? derived.favouriteBet,
    bestStreak: derived.bestStreak,
  };
}

/** How many spins the tracker recorded for one player. 0 when it was off. */
export function spinCount(state: RlSessionState, playerId: string): number {
  let n = 0;
  for (const s of state.spins) if (s.playerId === playerId) n++;
  return n;
}

export type RlSummary = CashSummary<RlDetail>;

/** The whole night in one object, for the pack page, the TV board and the payload. */
export function summarizeRoulette(state: RlSessionState): RlSummary {
  return summarizeCash<RlDetail>(state, {
    of: (id) => rlDetail(state, id),
    events: (id) => spinCount(state, id),
    total: state.spins.length,
  });
}

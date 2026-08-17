// Poker pack: shared types and pure session logic. The fourth pack on the
// shared cash-game engine (cashgame.ts), which owns everything about money.
// This file owns only what is poker.
//
// ---------------------------------------------------------------------------
// WHAT THIS PACK IS FOR, and it is not a leaderboard.
//
// The single most useful thing an app can do for a home poker night is end the
// "we are forty dollars short" argument: say so, say by exactly how much, and
// say it while everyone is still in the room. That is `bank: "table"` in the
// cash engine, and the pack's screens are built around it rather than around
// the standings. The standings are free anyway, because placement falls out of
// net rank like every other cash pack.
//
// NO HAND-TO-HAND TRACKING (James, 2026-08-17). Buy-ins and final stacks only.
// Blackjack has a live tracker because a bet and a result are two taps and they
// buy three stats nothing else can reconstruct; a poker hand is not two taps,
// nobody is going to log one at 1am, and a tracker that gets used for the first
// nine hands and abandoned produces worse data than no tracker at all. So
// `tracker` is inherited from CashPackState and pinned false, and the pack's
// repeatable interaction is the DEALER'S CHOICE ROTATION instead, which is a
// thing a poker night actually does between hands.
//
// THE VARIANT RIDES nowPlaying, on the title-night pattern, NOT on the Casino
// Run modifier system. modifiers.ts is a boon-and-bane deck: things that change
// how a night is scored and get DISPLAYED and RECORDED but never computed.
// Hold'em versus Omaha is not a house rule laid on top of a game, it is which
// game is being played, and Board Game already answers "what did you play" with
// `nowPlaying` plus a log of what has been played. Same question, same shape,
// and it satisfies standing rule 10 without inventing a third pattern.
// ---------------------------------------------------------------------------

import {
  newCashState,
  summarizeCash,
  type CashEntry,
  type CashPackState,
  type CashPlayer,
  type CashStakes,
  type CashSummary,
} from "./cashgame.js";

/**
 * The starter list the picker offers. Free typing is still allowed, exactly as
 * Board Game's title list is a starting point rather than a menu: a crew that
 * plays Pineapple should not have to argue with an app about it.
 *
 * Deliberately short. A list of forty variants is a scroll, and a home game
 * plays five of these.
 */
export const POKER_VARIANTS = [
  "Texas Hold'em",
  "Omaha",
  "Omaha Hi-Lo",
  "Seven-Card Stud",
  "Five-Card Draw",
  "Razz",
] as const;

/**
 * One typed variant name, reduced to the form the app stores and compares.
 *
 * SAME RULE AS BOARD GAME'S TITLES, and it exists for the same reason: "hold
 * em", "Hold'em" and "HOLD EM" are one game, and a lifetime stat that splits
 * them into three is worse than useless because it looks right. Whitespace is
 * collapsed, case is preserved for display, and comparison happens on the
 * folded form.
 */
export function canonicalVariant(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 60);
}

/** The comparison key: case and punctuation folded, so "Hold em" matches "Hold'em". */
export function variantKey(raw: string): string {
  return canonicalVariant(raw).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** One game of one variant, as it was dealt. */
export interface PokerGame {
  /** The canonical display name. */
  variant: string;
  /** Roster slot of whoever dealt it, or null when the rotation is off. */
  dealerId: string | null;
  at: string;
}

/**
 * The pack's per-player detail. Money is the engine's; this is what is poker's.
 *
 * ONE FIELD, and it is a count rather than anything hand-shaped, because the
 * session records no hands. It is here at all because dealer's choice makes it
 * free: the rotation already knows who dealt, so "you dealt four of tonight's
 * eleven games" costs nothing and is the kind of thing a crew reads out.
 */
export interface PokerDetail {
  dealt: number;
}

export const EMPTY_PK_DETAIL: PokerDetail = { dealt: 0 };

export interface PokerSessionState extends CashPackState {
  /**
   * NARROWED TO "table" ON PURPOSE. Every other cash pack lets the host choose
   * who banks; poker has no house by definition, and offering the choice would
   * be offering a wrong answer. `newPokerState` pins it and the server never
   * reads a bank off the request.
   */
  bank: "table";
  /** The variant on the table right now, or null between games. */
  nowPlaying: string | null;
  /** Every game dealt tonight, in order. */
  games: PokerGame[];
  /**
   * Dealer's choice: whether the deal rotates, and whose turn it is.
   *
   * The index is into `roster`, not a player id, because the rotation is
   * positional: it is the seat to the left of the last dealer, and a player who
   * leaves does not make the seat order wrong. Out-of-range is normalised on
   * read rather than guarded on write, so a roster that shrinks mid-night
   * cannot wedge the rotation.
   */
  dealersChoice: boolean;
  dealerIdx: number;
}

/** A sensible table default: $20, in cents, because everything is in cents. */
export const POKER_DEFAULT_BUY_IN = 2000;

export function newPokerState(opts: {
  stakes?: CashStakes;
  roster: CashPlayer[];
  defaultBuyIn: number;
  buyIns?: Record<string, number>;
  dealersChoice?: boolean;
  /** The variant to open on, if the host picked one at setup. */
  nowPlaying?: string | null;
}): PokerSessionState {
  const core = newCashState({
    // Pinned, not passed. See the field's note: a poker table has no house.
    bank: "table",
    bankerId: null,
    stakes: opts.stakes,
    roster: opts.roster,
    defaultBuyIn: opts.defaultBuyIn,
    buyIns: opts.buyIns,
    // No live tracker: this pack records no hands. See the header.
    tracker: false,
    modifiers: [],
  });
  return {
    ...core,
    bank: "table",
    nowPlaying: opts.nowPlaying ? canonicalVariant(opts.nowPlaying) : null,
    games: [],
    dealersChoice: opts.dealersChoice ?? false,
    dealerIdx: 0,
  };
}

/** Whoever is due to deal, or null when the rotation is off or the table is empty. */
export function pokerCurrentDealer(state: PokerSessionState): CashPlayer | null {
  if (!state.dealersChoice || state.roster.length === 0) return null;
  // Normalised on READ. A roster that shrank after the index was written must
  // not wedge the rotation, and a modulo here is cheaper than a guard on every
  // path that can remove a seat.
  const idx = ((state.dealerIdx % state.roster.length) + state.roster.length) % state.roster.length;
  return state.roster[idx] ?? null;
}

/**
 * Put a variant on the table. Returns the canonical name actually stored.
 *
 * This does NOT log a game. A host who picks Omaha and then changes their mind
 * has not played a hand of Omaha, and a log that filled up with corrections
 * would make "what did we play tonight" a worse answer than no log at all.
 * `pokerRecordGame` is what writes history, and it is a deliberate second action.
 */
export function pokerSetVariant(state: PokerSessionState, raw: string): string {
  const name = canonicalVariant(raw);
  state.nowPlaying = name || null;
  return state.nowPlaying ?? "";
}

/**
 * Log the variant on the table as played, and advance the deal.
 *
 * The dealer is stamped at the moment it is recorded rather than derived later,
 * because the rotation moves and history must not move with it.
 */
export function pokerRecordGame(state: PokerSessionState, at: string): PokerGame | null {
  const variant = state.nowPlaying;
  if (!variant) return null;
  const dealer = pokerCurrentDealer(state);
  const game: PokerGame = { variant, dealerId: dealer?.id ?? null, at };
  state.games.push(game);
  if (state.dealersChoice && state.roster.length > 0) {
    state.dealerIdx = (state.dealerIdx + 1) % state.roster.length;
  }
  return game;
}

/** Undo the last logged game, and step the deal back with it. */
export function pokerUndoGame(state: PokerSessionState): PokerGame | null {
  const game = state.games.pop() ?? null;
  if (game && state.dealersChoice && state.roster.length > 0) {
    state.dealerIdx = (state.dealerIdx - 1 + state.roster.length) % state.roster.length;
  }
  return game;
}

/** How many of tonight's games this player dealt. */
export function dealtBy(state: PokerSessionState, playerId: string): number {
  let n = 0;
  for (const g of state.games) if (g.dealerId === playerId) n++;
  return n;
}

/**
 * The distinct variants played tonight, in the order they were first dealt,
 * with a count each. What the TV puts under "tonight".
 */
export function variantsPlayed(state: PokerSessionState): { variant: string; games: number }[] {
  const order: string[] = [];
  const counts = new Map<string, { variant: string; games: number }>();
  for (const g of state.games) {
    const key = variantKey(g.variant);
    const row = counts.get(key);
    if (row) row.games++;
    else {
      counts.set(key, { variant: g.variant, games: 1 });
      order.push(key);
    }
  }
  return order.map((k) => counts.get(k)!);
}

// ---------- the night, as every screen reads it ----------

export type PokerSummary = CashSummary<PokerDetail>;

/** The whole night in one object, for the pack page, the TV board and the payload. */
export function summarizePoker(state: PokerSessionState): PokerSummary {
  return summarizeCash<PokerDetail>(state, {
    of: (id) => ({ dealt: dealtBy(state, id) }),
    events: (id) => dealtBy(state, id),
    total: state.games.length,
  });
}

/** The entry for one player, created on demand so a late arrival is cheap. */
export function pokerEntryFor(state: PokerSessionState, playerId: string): CashEntry {
  let e = state.entries.find((x) => x.playerId === playerId);
  if (!e) {
    e = { playerId, buyIn: state.defaultBuyIn, rebuys: [], cashOut: null, at: null };
    state.entries.push(e);
  }
  return e;
}

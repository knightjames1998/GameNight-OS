// Craps pack: shared types and pure session logic. The THIRD cash pack, and
// the thinnest of the three, because everything about money already lives in
// cashgame.ts and everything about the money SCREENS already lives in
// apps/web/src/casino/.
//
// THE ONE IDEA THIS FILE OWNS IS THE SHOOTER'S HAND. Longest roll — how many
// rolls a shooter survives before sevening out — is the iconic craps bragging
// right, and it is the reason this pack's tracker earns its keep: a hand
// length is an ordering fact that cannot be reconstructed from a cash-out, and
// a craps table already has everyone watching the shooter, so tapping Roll is
// natural rather than a chore.
//
// HANDS ARE DERIVED FROM AN EVENT LOG, NEVER MAINTAINED. That is the whole
// design, and it is the same call Smashdown's burn board made for the same
// reason: the alternative is a counter that undo has to unwind by hand, and
// "undo a seven-out" has to reopen a closed hand AND hand the dice back, which
// is exactly the kind of two-step that is right until it isn't. Here undo pops
// one event and re-derives, so it cannot leave the board disagreeing with the
// log. The only thing carried alongside the log is `shooterId`, because after
// a seven-out the dice have passed to somebody who has no events yet — and
// even that is restored from the popped event rather than guessed.

import {
  newCashState,
  summarizeCash,
  type CashBank,
  type CashPackState,
  type CashPlayer,
  type CashSummary,
} from "./cashgame.js";

/**
 * What the host taps. Three actions at the table plus one for handing the dice
 * on without sevening out, which happens and would otherwise leave a hand
 * looking like it never ended.
 *
 * A SEVEN-OUT IS NOT A ROLL. "Rolls survived before sevening out" is the
 * bragging right, so Roll is tapped for every roll that is not the seven-out
 * and a shooter who sevens out immediately has a hand of zero. That is honest
 * rather than harsh: they survived nothing.
 */
export type CrEventKind = "roll" | "point" | "sevenOut" | "pass";

export interface CrEvent {
  /** The shooter at the time. Stored, so a replay cannot re-rotate the dice. */
  playerId: string;
  kind: CrEventKind;
  at: string;
}

/** One shooter's hand, derived from the log. Never stored. */
export interface CrHand {
  playerId: string;
  /** Rolls survived. Excludes the seven-out itself. */
  rolls: number;
  /** Points made during this hand. */
  points: number;
  /** How it ended, or null while the dice are still in their hand. */
  ended: "sevenOut" | "pass" | null;
  /** ISO of the end, or null while open. */
  at: string | null;
}

export interface CrDetail {
  /**
   * Longest CLOSED hand, in rolls. Typed on the cash-out form when the tracker
   * was off — unlike roulette's win streak, a hand length is genuinely
   * something a table remembers and argues about, so a typed box is a fair
   * record rather than an invitation to guess.
   */
  longestRoll: number | null;
  points: number | null;
  /** cents. Typed only: this pack's tracker follows the dice, not the bets. */
  biggestBet: number | null;
  /** cents. Typed only, same reason. */
  biggestWin: number | null;
}

export const EMPTY_CR_DETAIL: CrDetail = {
  longestRoll: null,
  points: null,
  biggestBet: null,
  biggestWin: null,
};

export interface CrSessionState extends CashPackState {
  /** Empty unless the tracker has been on. The hands are derived from it. */
  events: CrEvent[];
  /** Whose dice it is. Null when nobody at the table can shoot. */
  shooterId: string | null;
  /** playerId -> whatever the host typed on the cash-out form. */
  detail: Record<string, Partial<CrDetail>>;
}

export function newCrapsState(opts: {
  bank: CashBank;
  bankerId: string | null;
  roster: CashPlayer[];
  defaultBuyIn: number;
  buyIns?: Record<string, number>;
  tracker?: boolean;
}): CrSessionState {
  const base = newCashState(opts);
  return {
    ...base,
    events: [],
    // The dice start with the first person at the table. On a player-banked
    // night that is usually the banker, and the host can hand them on.
    shooterId: base.roster[0]?.id ?? null,
    detail: {},
  };
}

// ---------- the derivation ----------

/**
 * Every hand the log describes, in order.
 *
 * A hand is a run of consecutive events by one shooter. It CLOSES on a
 * seven-out or a pass; the final run is open when neither ended it. The
 * playerId change is handled defensively too, so a log written by an older
 * build that passed the dice without logging it still derives sane hands.
 */
export function crapsHands(events: CrEvent[]): CrHand[] {
  const out: CrHand[] = [];
  let cur: CrHand | null = null;
  for (const e of events) {
    if (!cur || cur.playerId !== e.playerId) {
      if (cur) out.push(cur);
      cur = { playerId: e.playerId, rolls: 0, points: 0, ended: null, at: null };
    }
    if (e.kind === "roll") cur.rolls++;
    else if (e.kind === "point") cur.points++;
    else {
      cur.ended = e.kind;
      cur.at = e.at;
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** The hand in progress, or null when the dice are between shooters. */
export function openHand(events: CrEvent[]): CrHand | null {
  const hands = crapsHands(events);
  const last = hands[hands.length - 1];
  return last && last.ended === null ? last : null;
}

/**
 * Who gets the dice after `afterId` sevens out or passes.
 *
 * Rotation is by ROSTER order over the players still at the table, which is
 * what makes a cash-out mid-session behave: somebody who has cashed out is
 * skipped, and a shooter who cashes out still hands the dice to whoever is
 * sitting after them rather than to the top of the list. Null when nobody left
 * can shoot, which the tracker says out loud rather than silently doing
 * nothing.
 */
export function nextShooter(state: CrSessionState, afterId: string | null): string | null {
  const stillIn = new Set(state.entries.filter((e) => e.cashOut === null).map((e) => e.playerId));
  const eligible = state.roster.filter((p) => stillIn.has(p.id));
  if (eligible.length === 0) return null;
  if (!afterId) return eligible[0]!.id;
  const from = state.roster.findIndex((p) => p.id === afterId);
  if (from < 0) return eligible[0]!.id;
  for (let k = 1; k <= state.roster.length; k++) {
    const cand = state.roster[(from + k) % state.roster.length];
    if (cand && stillIn.has(cand.id)) return cand.id;
  }
  // Only the current shooter is left, so the dice come back to them — which is
  // what happens at a real table with one person still playing.
  return eligible[0]!.id;
}

/**
 * Record one tap. Mutates state; returns false when there is nobody holding
 * the dice, so the caller can say so rather than writing a shooterless event.
 *
 * A seven-out or a pass is the ONLY thing that moves the dice, and it moves
 * them here rather than at the call site, so the two can never disagree.
 */
export function crapsRecord(state: CrSessionState, kind: CrEventKind, at: string): boolean {
  const playerId = state.shooterId;
  if (!playerId) return false;
  state.events.push({ playerId, kind, at });
  if (kind === "sevenOut" || kind === "pass") {
    state.shooterId = nextShooter(state, playerId);
  }
  return true;
}

/**
 * Undo the last tap.
 *
 * THE CASE THAT MATTERS: undoing a seven-out must REOPEN that hand and give
 * the dice back to whoever sevened out, not merely decrement something. It is
 * correct here by construction rather than by care — the hands are derived
 * from the log, so dropping the event reopens the hand on its own, and the
 * shooter is read straight off the event that was popped. Same for a pass.
 * Undoing a roll or a point leaves the dice exactly where they are.
 */
export function crapsUndo(state: CrSessionState): CrEvent | null {
  const last = state.events.pop();
  if (!last) return null;
  if (last.kind === "sevenOut" || last.kind === "pass") state.shooterId = last.playerId;
  return last;
}

/** Hand the dice to anybody at the table. The rotation is a default, not a rule. */
export function crapsSetShooter(state: CrSessionState, playerId: string, at: string): boolean {
  if (!state.roster.some((p) => p.id === playerId)) return false;
  if (state.shooterId === playerId) return true;
  // A shooter who gives up the dice has FINISHED a hand, so it is logged as a
  // pass: their rolls count towards longest roll even though they never
  // sevened out, which is how anyone at the table would describe it.
  if (state.shooterId && openHand(state.events)) {
    state.events.push({ playerId: state.shooterId, kind: "pass", at });
  }
  state.shooterId = playerId;
  return true;
}

// ---------- the detail stats ----------

/**
 * Derive longest roll and points from the log alone.
 *
 * `includeOpen` is the difference between the live screen and the ledger. Live,
 * the longest is over CLOSED hands, so the TV's "to beat" number is a real
 * target rather than whatever the current shooter is on. At completion the
 * night is over, so the hand in progress is a hand that happened and counts.
 */
export function detailFromEvents(
  events: CrEvent[],
  playerId: string,
  opts?: { includeOpen?: boolean },
): { longestRoll: number | null; points: number | null } {
  let longest: number | null = null;
  let points = 0;
  let any = false;
  for (const h of crapsHands(events)) {
    if (h.playerId !== playerId) continue;
    if (h.ended === null && !opts?.includeOpen) continue;
    any = true;
    if (longest === null || h.rolls > longest) longest = h.rolls;
    points += h.points;
  }
  return any ? { longestRoll: longest, points } : { longestRoll: null, points: null };
}

/**
 * A player's details as they should be READ: whatever the host typed wins, per
 * FIELD, and the tracker fills the gaps. Biggest bet and biggest win are
 * typed-only, because this pack's tracker follows the dice rather than the
 * betting — they are kept for consistency with blackjack and roulette.
 */
export function crDetail(
  state: CrSessionState,
  playerId: string,
  opts?: { includeOpen?: boolean },
): CrDetail {
  const typed = state.detail[playerId];
  const derived = state.events.length
    ? detailFromEvents(state.events, playerId, opts)
    : { longestRoll: null, points: null };
  return {
    longestRoll: typed?.longestRoll ?? derived.longestRoll,
    points: typed?.points ?? derived.points,
    biggestBet: typed?.biggestBet ?? null,
    biggestWin: typed?.biggestWin ?? null,
  };
}

/** How many taps the tracker recorded for one player. 0 when it was off. */
export function eventCountFor(state: CrSessionState, playerId: string): number {
  let n = 0;
  for (const e of state.events) if (e.playerId === playerId) n++;
  return n;
}

// ---------- the night ----------

/** The live shooter, for the TV's hero panel and the tracker's own header. */
export interface CrShooter {
  playerId: string;
  name: string;
  /** Rolls in the hand in progress. 0 when they have just taken the dice. */
  rolls: number;
  points: number;
}

export interface CrSummary extends CashSummary<CrDetail> {
  /** Null when nobody holds the dice (everyone cashed out, or an empty table). */
  shooter: CrShooter | null;
  /**
   * The longest CLOSED hand of the night and who held it, which is the number
   * the current shooter is chasing. Null until a hand has finished.
   */
  longest: { playerId: string; name: string; rolls: number } | null;
}

export function summarizeCraps(state: CrSessionState): CrSummary {
  const base = summarizeCash<CrDetail>(state, {
    of: (id) => crDetail(state, id),
    events: (id) => eventCountFor(state, id),
    total: state.events.length,
  });

  const nameOf = new Map(state.roster.map((p) => [p.id, p.name]));
  const open = openHand(state.events);
  const shooter: CrShooter | null = state.shooterId
    ? {
        playerId: state.shooterId,
        name: nameOf.get(state.shooterId) ?? "",
        // The open hand only belongs to the shooter when it is theirs; right
        // after a seven-out they are on nothing yet.
        rolls: open && open.playerId === state.shooterId ? open.rolls : 0,
        points: open && open.playerId === state.shooterId ? open.points : 0,
      }
    : null;

  let longest: CrSummary["longest"] = null;
  for (const h of crapsHands(state.events)) {
    if (h.ended === null) continue;
    if (!longest || h.rolls > longest.rolls) {
      longest = { playerId: h.playerId, name: nameOf.get(h.playerId) ?? "", rolls: h.rolls };
    }
  }

  return { ...base, shooter, longest };
}

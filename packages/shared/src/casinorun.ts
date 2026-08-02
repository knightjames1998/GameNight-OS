// CASINO RUN: the crew against the house, sharing one bank.
//
// The fifth casino pack and the only co-op one. A run is a sequence of STAGES;
// each stage has a QUOTA the bank must reach and a budget of LEGS to reach it
// in; under all of them sits the FLOOR, the balance the bank must stay above.
// Clear the last stage and the table wins together. Drop through the floor and
// the table loses together.
//
// ---------------------------------------------------------------------------
// WHY THIS IS ITS OWN MODULE AND NOT A FLAG ON cashgame.ts
//
// `settleCash` is built on one assumption: each player has a net, and on a
// player-banked table those nets sum to zero against the banker. That is what
// makes the balance check meaningful and placement-by-net honest. A co-op run
// inverts it — there is ONE pot measured against a target, nobody has a
// personal net, and per-player buy-in and cash-out do not exist here at all.
// Serving both from one engine would put a branch through every function four
// packs depend on, in service of the one caller that disagrees with its
// central assumption.
//
// What IS reused, because it is genuinely shared: integer cents everywhere,
// parseCents / formatCents and the stakes-aware money() formatter, the modifier
// deck and its draw, the roster slot shape, and the --cg-* screen tokens.
// ---------------------------------------------------------------------------
//
// NAMING, because one word was doing two jobs. The backlog used "floor" for
// the bank minimum. So the LEVELS of a run are STAGES, never floors. A stage
// has a quota and a leg budget; the floor is the single bust threshold under
// the whole run. Both words appear in the UI and they never trade places.
//
// EVERYTHING IS DERIVED FROM THE LEG LOG. bank, stage, attempt, status, the
// clear count, the peak and the comeback — none of them are stored. This is
// the same call craps made for its hands and Smashdown made for its burn
// board, for the same reason: the alternative is a pile of counters that undo
// has to unwind by hand, and "undo the leg that busted the run" has to restore
// the bank AND reopen the stage AND un-end the run. Here undo pops one leg and
// re-derives, so it cannot leave the screen disagreeing with the log.

import type { Modifier } from "./modifiers.js";
import type { CashPlayer, CashStakes } from "./cashgame.js";

/** The roster slot shape is genuinely shared with the cash packs. */
export type { CashPlayer };

// ---------- the ladders ----------

export type CrunDifficulty = "casual" | "standard" | "highroller" | "degenerate";

export interface CrunLadder {
  key: CrunDifficulty;
  name: string;
  /** Per-stage escalation as a fraction: 0.15 is +15%. */
  escalation: number;
  /** How many stages a full run has. */
  stages: number;
  /** Legs allowed per attempt at a stage. */
  legsPerStage: number;
  /**
   * How many attempts a stage allows before the run is over.
   *
   * THIS IS THE LOSS CONDITION, and the pack shipped without it. Originally a
   * missed stage cost the attempt and nothing else, so the only way to lose
   * was dropping through the floor — which a bank that hovers can dodge
   * indefinitely. The result was a mode you could not actually fail, just
   * grind, which is not a game. Now you get a fixed number of shots at each
   * stage and running out ends the run exactly as the floor does.
   */
  attemptsPerStage: number;
  /** One line for the setup screen. */
  blurb: string;
}

/**
 * The four difficulties, as one choice at setup that produces the whole curve.
 *
 * HOST PICKS A LADDER, NOT NUMBERS. Typing a quota per stage is four decisions
 * nobody has a basis for making before the first hand, and the interesting
 * question is only ever "how hard should tonight be".
 *
 * THESE NUMBERS ARE SIMULATED, NOT FELT. Every escalation and stage count
 * below is pinned by a Monte Carlo test (tests/casinorun-sim.test.ts) that
 * plays 20,000 runs of each ladder against a house edge and asserts the clear
 * rate lands in the band the ladder claims. The bands are the design; the
 * numbers serve them. If a ladder drifts out of its band the test fails, and
 * the fix is the ladder — never the band.
 *
 * TWO DRAFTS HAVE BEEN WRONG, both caught by the simulation rather than by a
 * ruined night:
 *   1. +15/+25/+40/+60% cleared 37/28/10/4%, so "casual" lost the bank two
 *      nights in three.
 *   2. With unlimited attempts, `legsPerStage` could not move the clear rate
 *      AT ALL and the only loss condition was the floor — a run you could not
 *      fail, only grind. `attemptsPerStage` fixed that, and in doing so made
 *      the leg budget a real lever for the first time: legs x attempts is the
 *      total number of shots a stage gets.
 */
export const CRUN_LADDERS: CrunLadder[] = [
  {
    key: "casual",
    name: "Casual",
    escalation: 0.06,
    stages: 4,
    legsPerStage: 5,
    attemptsPerStage: 4,
    blurb: "Most nights clear it. Good for a first run or a table that wants to finish.",
  },
  {
    key: "standard",
    name: "Standard",
    escalation: 0.15,
    stages: 4,
    legsPerStage: 5,
    attemptsPerStage: 3,
    blurb: "A coin flip. The bank gets low and comes back, or it doesn't.",
  },
  {
    key: "highroller",
    name: "High roller",
    escalation: 0.3,
    stages: 5,
    legsPerStage: 4,
    attemptsPerStage: 3,
    blurb: "Most runs die. Clearing one is worth talking about.",
  },
  {
    key: "degenerate",
    name: "Degenerate",
    escalation: 0.5,
    stages: 5,
    legsPerStage: 4,
    attemptsPerStage: 2,
    blurb: "You will almost certainly lose the bank. That is the joke.",
  },
];

const LADDER_BY_KEY = new Map(CRUN_LADDERS.map((l) => [l.key, l]));

/** A ladder by key, falling back to Standard so a bad row still renders. */
export function crunLadder(key: string): CrunLadder {
  return LADDER_BY_KEY.get(key as CrunDifficulty) ?? CRUN_LADDERS[1]!;
}

/**
 * The bank total stage `index` (0-based) demands, in integer cents.
 *
 * THE QUOTA IS THE BANK'S TOTAL, not a delta to add on top of it. Stage 1 of a
 * +25% ladder on a $100 bank wants $125 in the bank, not $225. Compounding is
 * what makes the later stages hard without any extra rule: the fourth stage of
 * that ladder wants 1.25^4, which is two and a half times the starting stake.
 */
export function crunQuota(ladder: CrunLadder, startingBank: number, index: number): number {
  return Math.round(startingBank * Math.pow(1 + ladder.escalation, index + 1));
}

/** Every stage's quota, for the setup screen's preview of what it is signing up for. */
export function crunQuotas(ladder: CrunLadder, startingBank: number): number[] {
  return Array.from({ length: ladder.stages }, (_, i) => crunQuota(ladder, startingBank, i));
}

// ---------- one-shot tokens the table can buy ----------

/**
 * A ONE-TIME-USE CARD, bought out of the bank and spent on the next leg.
 *
 * The pressure valve. Modifiers are dealt TO you and last the run; a token is
 * something you choose and burn, and it costs bank — which is the interesting
 * part, because spending bank moves you away from the quota you are chasing.
 * "Do we buy a hedge and fall further behind, or run the next leg naked" is a
 * real decision, and it is the only one in the pack that costs money to make.
 *
 * MOST TOKENS ARE DECLARATIVE, exactly like modifiers: "the next leg is played
 * at double stakes" is a thing the humans do at the table, and the app only
 * records that it was bought. The two exceptions touch bookkeeping the app
 * ALREADY owns — the leg budget and the minimum ante — and `effect` says which
 * is which rather than leaving a reader to guess.
 */
export type CrunTokenEffect = "declare" | "extra_leg" | "ante_relief";

export interface CrunToken {
  /** NEVER change once shipped: it is written into the ledger. */
  id: string;
  name: string;
  rule: string;
  /**
   * Cost as a FRACTION OF THE STARTING BANK, not a flat amount, so a token is
   * as expensive on a $20 run as on a $500 one. A flat price would be free at
   * the top of the range and unaffordable at the bottom.
   */
  cost: number;
  effect: CrunTokenEffect;
}

export const CRUN_TOKENS: CrunToken[] = [
  { id: "double_next", name: "Double or nothing", rule: "The next leg is played at double stakes, win or lose.", cost: 0.1, effect: "declare" },
  { id: "half_next", name: "Hedge", rule: "The next leg is played at half stakes, win or lose.", cost: 0.06, effect: "declare" },
  { id: "mulligan", name: "Mulligan", rule: "Replay one losing hand during the next leg.", cost: 0.15, effect: "declare" },
  { id: "one_more_shot", name: "One more shot", rule: "Adds one leg to this stage attempt.", cost: 0.12, effect: "extra_leg" },
  { id: "ante_relief", name: "Ante relief", rule: "Cancels one rise in the minimum ante.", cost: 0.08, effect: "ante_relief" },
];

const TOKEN_BY_ID = new Map(CRUN_TOKENS.map((t) => [t.id, t]));

/** One token by id, or undefined. A retired id still has history in the ledger. */
export const crunToken = (id: string): CrunToken | undefined => TOKEN_BY_ID.get(id);

/** The name for a recorded id, falling back to the id, same rule as modifiers. */
export const crunTokenName = (id: string): string => TOKEN_BY_ID.get(id)?.name ?? id;

/** What a token costs on this run, in integer cents. */
export function crunTokenCost(token: CrunToken, startingBank: number): number {
  return Math.max(1, Math.round(startingBank * token.cost));
}

// ---------- state ----------

/**
 * One leg: a stretch of play at one game, recorded as what it did to the bank.
 *
 * THE APP NEVER COMPUTES THIS NUMBER. A human plays a hand of blackjack, or a
 * shoe of it, and types what the bank is up or down. Same line the modifier
 * deck holds: the app records what happened, it does not referee it.
 *
 * `game` is free text on purpose. The setup screen offers the casino packs by
 * name, but a crew playing something this app has never heard of should still
 * be able to run a Casino Run, and allowing that costs one string.
 */
export interface CrunLeg {
  /** cents, SIGNED: what this leg did to the bank. */
  delta: number;
  /** What was played. A pack name, or anything the crew typed. */
  game: string;
  /** Roster slot id of whoever played it, or null for "the table". */
  playerId: string | null;
  at: string;
  /**
   * "leg" (a stretch of play) or "buy" (a token bought out of the bank).
   *
   * OPTIONAL, AND ABSENT MEANS "leg". Runs recorded before tokens existed have
   * no `kind`, and upgrading them on read costs one `??` rather than a data
   * migration — the same trick parseEntrants uses for legacy bracket rosters.
   */
  kind?: "leg" | "buy";
  /** The token bought. Only on a "buy". */
  token?: string;
}

/** True for a stretch of play, false for a purchase. Legacy rows are legs. */
export const isLeg = (e: CrunLeg): boolean => (e.kind ?? "leg") === "leg";

export interface CrunState {
  /** Unique per run; namespaces the ledger key. */
  sessionKey: string;
  startedAt: string;
  /**
   * ALWAYS "play". Casino Run is play money only and has no stakes selector.
   *
   * The field stays because every money screen in the casino group is built
   * around the stakes-aware formatter, and threading a special case through
   * them to save one constant would be worse than the constant. It is also the
   * honest design: this mode is about losing a shared bank on purpose, the
   * quotas escalate to multiples of it, and nobody should put real money on a
   * ladder whose hardest rung is meant to be unwinnable.
   */
  stakes: CashStakes;
  /** Active modifier ids. Grows during a run, unlike the cash packs. */
  modifiers: string[];
  /** Standing rule 1: only owners/admins record unless the host opens it. */
  openScoring: boolean;
  roster: CashPlayer[];
  /** cents. The crew's shared stake, set once by the host. */
  startingBank: number;
  difficulty: CrunDifficulty;
  /** cents. The bank must stay ABOVE this. Defaults to zero. */
  floor: number;
  /**
   * cents. The table's opening minimum ante — what it costs to sit in a round.
   *
   * The BASE only; what the minimum actually is right now is DERIVED, because
   * cards raise it and a bought token can cancel a rise. See crunAnte.
   */
  ante: number;
  /** Every leg AND purchase in order. Everything else is derived from it. */
  legs: CrunLeg[];
}

/** The default opening ante: 2% of the bank, which is a plausible table minimum. */
export const defaultAnte = (startingBank: number) =>
  Math.max(1, Math.round(startingBank * 0.02));

export function newCrunState(opts: {
  roster: CashPlayer[];
  startingBank: number;
  difficulty: CrunDifficulty;
  floor?: number;
  ante?: number;
  modifiers?: string[];
}): CrunState {
  const startingBank = Math.max(0, Math.trunc(opts.startingBank));
  return {
    sessionKey: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    // Not a parameter. See the field comment: this mode is play money, always.
    stakes: "play",
    modifiers: opts.modifiers ?? [],
    openScoring: false,
    roster: opts.roster,
    startingBank,
    difficulty: opts.difficulty,
    floor: Math.max(0, Math.trunc(opts.floor ?? 0)),
    ante: Math.max(1, Math.trunc(opts.ante ?? defaultAnte(startingBank))),
    legs: [],
  };
}

// ---------- the derivation ----------

export type CrunStatus = "running" | "cleared" | "bust";

export interface CrunProgress {
  /** cents, after every leg played. */
  bank: number;
  /** 0-based stage being played now. Equals ladder.stages once cleared. */
  stage: number;
  /** 1-based attempt at the CURRENT stage. Rises each time a budget runs out. */
  attempt: number;
  /** Legs spent in the current attempt. */
  legsUsed: number;
  /** cents. The current stage's target, or the last one's once the run ended. */
  quota: number;
  /** cents still needed, floored at zero. */
  toGo: number;
  /** Legs left in this attempt, INCLUDING any bought with a token. */
  legsLeft: number;
  /** Attempts left at this stage, this one included. Zero means the run died. */
  attemptsLeft: number;
  status: CrunStatus;
  /** How the run ended, once it has. Null while it is still going. */
  ending: "cleared" | "floor" | "attempts" | null;
  /** Stages fully cleared. */
  cleared: number;
  /** How many stage attempts ran out of legs. Each one forces a bane. */
  missed: number;
  /** The table's minimum ante right now, and why. */
  ante: CrunAnte;
  /** Tokens bought since the last leg, waiting to be spent on the next one. */
  held: string[];
  /** cents, the highest the bank ever stood. */
  peak: number;
  /** cents, the lowest it ever stood. */
  trough: number;
  /**
   * cents: the largest rise from a running low to a later high. "We were down
   * to eleven dollars and finished on ninety" is the story a run is told as.
   */
  comeback: number;
}

/** The table's minimum ante, derived from the base plus what the cards did. */
export interface CrunAnte {
  /** cents, what it costs to sit in a round right now. */
  amount: number;
  /** cents, where it started. */
  base: number;
  /** How many times it has gone up, net of any Ante relief bought. */
  raises: number;
  /** True when a card says EVERY player antes each round, not just the blinds. */
  everyone: boolean;
}

/** A raise adds half the BASE, so the climb is linear and a table can predict it. */
const ANTE_STEP = 0.5;
/** Escalating minimum raises the ante every this many legs. */
const ANTE_EVERY = 5;

/**
 * Walk the log and report where the run stands. THE one derivation; every
 * screen, the ledger and the tests read this and nothing else.
 *
 * ORDER WITHIN A LEG IS LOAD-BEARING: apply the delta, then check the floor,
 * then check the quota, then check the budget. Bust wins ties because a run
 * that dropped through the floor is over even if the same leg would have
 * cleared the stage — which cannot happen while quota > floor, but stating the
 * order means nobody has to work it out again.
 *
 * THERE ARE TWO WAYS TO LOSE, and there used to be one. Dropping through the
 * floor, and running out of ATTEMPTS at a stage. The second is new and it is
 * the whole reason this pack is a game: originally a missed stage just handed
 * out a fresh set of legs forever, so a bank that hovered could grind
 * indefinitely and the only real fail state was a bank that hit zero. Now a
 * stage gives `attemptsPerStage` shots and running out ends the run.
 *
 * A BUY IS NOT A LEG. Purchases move the bank (and so can bust a run — buying
 * a token you cannot afford is a real way to die) but they do not consume the
 * leg budget, because a token is not a stretch of play.
 */
export function crunProgress(state: CrunState): CrunProgress {
  const ladder = crunLadder(state.difficulty);
  const start = state.startingBank;

  let bank = start;
  let stage = 0;
  let attempt = 1;
  let legsUsed = 0;
  let legsThisStage = 0;
  let missed = 0;
  let status: CrunStatus = "running";
  let ending: CrunProgress["ending"] = null;
  let peak = start;
  let trough = start;
  let runningLow = start;
  let comeback = 0;
  // Legs bought with One more shot, and ante rises cancelled with Ante relief.
  let boughtLegs = 0;
  let anteRelief = 0;
  let legCount = 0;
  let held: string[] = [];

  for (const entry of state.legs) {
    if (status !== "running") break;
    bank += Math.trunc(entry.delta);

    if (bank > peak) peak = bank;
    if (bank < trough) trough = bank;
    if (bank < runningLow) runningLow = bank;
    if (bank - runningLow > comeback) comeback = bank - runningLow;

    // A purchase can still kill the run, which is what makes a token a real
    // decision rather than free value.
    if (bank <= state.floor) {
      status = "bust";
      ending = "floor";
      break;
    }

    if (!isLeg(entry)) {
      const effect = crunToken(entry.token ?? "")?.effect;
      if (effect === "extra_leg") boughtLegs++;
      if (effect === "ante_relief") anteRelief++;
      if (entry.token) held.push(entry.token);
      continue;
    }

    legsUsed++;
    legsThisStage++;
    legCount++;
    // Whatever was bought since the last leg is spent on this one.
    held = [];

    // A WHILE, NOT AN IF. Quotas are cumulative bank totals, so one big leg can
    // satisfy several at once and must clear all of them. Advancing only one
    // would leave the bank sitting ABOVE the current stage's quota while still
    // on that stage — an incoherent state, and worse than incoherent: the next
    // leg would then clear it no matter what that leg actually did.
    let advanced = false;
    while (stage < ladder.stages && bank >= crunQuota(ladder, start, stage)) {
      stage++;
      advanced = true;
    }
    if (advanced) {
      attempt = 1;
      legsUsed = 0;
      legsThisStage = 0;
      boughtLegs = 0;
      if (stage >= ladder.stages) {
        status = "cleared";
        ending = "cleared";
        break;
      }
      continue;
    }
    if (legsUsed >= ladder.legsPerStage + boughtLegs) {
      // The budget ran out short of the quota.
      missed++;
      if (attempt >= ladder.attemptsPerStage) {
        // And that was the last shot at this stage. THE SECOND LOSS CONDITION.
        status = "bust";
        ending = "attempts";
        break;
      }
      attempt++;
      legsUsed = 0;
      boughtLegs = 0;
    }
  }

  // Once the run has ended, `stage` points past the last one on a clear, so the
  // quota shown is the final target rather than an out-of-range read.
  const quotaIndex = Math.min(stage, ladder.stages - 1);
  const quota = crunQuota(ladder, start, quotaIndex);

  // THE ANTE, from the base plus what the cards did to it. Escalating minimum
  // raises it on a clock; every missed attempt raises it too, which is what
  // makes grinding cost something instead of being free. Ante relief cancels a
  // rise, and the whole thing is floored at the base — a token can never make
  // the table cheaper than it started.
  const escalating = state.modifiers.includes("escalating_min");
  const rawRaises = (escalating ? Math.floor(legCount / ANTE_EVERY) : 0) + missed;
  const raises = Math.max(0, rawRaises - anteRelief);
  const base = Math.max(1, Math.trunc(state.ante));

  return {
    bank,
    stage,
    attempt,
    legsUsed,
    quota,
    toGo: Math.max(0, quota - bank),
    legsLeft: Math.max(0, ladder.legsPerStage + boughtLegs - legsUsed),
    attemptsLeft: Math.max(0, ladder.attemptsPerStage - attempt + (status === "running" ? 1 : 0)),
    status,
    ending,
    cleared: stage,
    missed,
    ante: {
      amount: Math.round(base * (1 + ANTE_STEP * raises)),
      base,
      raises,
      everyone: state.modifiers.includes("everyone_antes"),
    },
    held,
    peak,
    trough,
    comeback,
  };
}

/**
 * Would this leg exhaust the stage budget without clearing it?
 *
 * The server asks BEFORE recording, so it knows whether to draw a forced bane
 * for the attempt that just failed. Derived from the same walk rather than
 * re-deduced, so the answer cannot disagree with what the record then does.
 */
export function crunLegOutcome(
  state: CrunState,
  delta: number,
): { status: CrunStatus; clearedStage: boolean; missedStage: boolean } {
  const before = crunProgress(state);
  const after = crunProgress({ ...state, legs: [...state.legs, leg(delta)] });
  return {
    status: after.status,
    clearedStage: after.cleared > before.cleared,
    missedStage: after.missed > before.missed,
  };
}

const leg = (delta: number): CrunLeg => ({ delta, game: "", playerId: null, at: "", kind: "leg" });

// ---------- recording ----------

/** Add a leg. Returns false when the run is already over. */
export function crunRecord(
  state: CrunState,
  entry: { delta: number; game: string; playerId: string | null; at: string },
): boolean {
  if (crunProgress(state).status !== "running") return false;
  state.legs.push({
    delta: Math.trunc(entry.delta),
    game: entry.game.slice(0, 32),
    playerId: entry.playerId,
    at: entry.at,
    kind: "leg",
  });
  return true;
}

/**
 * Buy a one-shot token out of the bank.
 *
 * Recorded in the SAME log as legs, which is what keeps undo honest: a
 * purchase is just another entry that moved the bank, so popping it gives the
 * money back and un-holds the card with no separate bookkeeping to unwind.
 *
 * The cost is NOT checked against the bank here. Buying a token you cannot
 * really afford is a legitimate, stupid, thoroughly in-genre way to end a run,
 * and the walk will bust it on the floor check like anything else would. What
 * IS refused is buying after the run is over.
 */
export function crunBuy(
  state: CrunState,
  entry: { token: string; playerId: string | null; at: string },
): CrunToken | null {
  if (crunProgress(state).status !== "running") return null;
  const token = crunToken(entry.token);
  if (!token) return null;
  state.legs.push({
    delta: -crunTokenCost(token, state.startingBank),
    game: token.name,
    playerId: entry.playerId,
    at: entry.at,
    kind: "buy",
    token: token.id,
  });
  return token;
}

/**
 * Drop the last leg. Returns false when there is nothing to undo.
 *
 * There is deliberately no restoring to do. The bank, the stage, the attempt
 * and whether the run is over are all re-derived from the shortened log, so
 * undoing the leg that busted a run puts the table back exactly where it was
 * one leg earlier — including its modifiers, which are recorded separately and
 * never rolled back, because the cards WERE drawn and the table played under
 * them.
 */
export function crunUndo(state: CrunState): boolean {
  if (state.legs.length === 0) return false;
  state.legs.pop();
  return true;
}

// ---------- modifier escalation ----------

/**
 * The weighting a stage-clear draw uses, reaching for nastier cards as the run
 * climbs. Returns a `weight` function for `drawModifiers`.
 *
 * It literally interpolates between the deck's default weighting and its
 * inverse: severity^k where k runs from -1 at the first stage to +1 at the
 * last. At k = -1 this IS `drawWeight` (1/severity), so an early run draws the
 * same gentle mix as a blackjack table does. At k = +1 a severity-3 card is
 * three times as likely as a severity-1 one. No new draw code — this is the
 * `weight` argument `drawModifiers` already takes, which is why it takes one.
 */
export function crunEscalationWeight(stage: number, stages: number): (m: Modifier) => number {
  const span = Math.max(1, stages - 1);
  const t = Math.min(1, Math.max(0, stage / span));
  const k = -1 + 2 * t;
  return (m: Modifier) => Math.pow(m.severity, k);
}

// ---------- the summary every screen reads ----------

/** One player's part in the run. Per-leg attribution is required, not optional. */
export interface CrunPlayerRow {
  playerId: string;
  name: string;
  kind: "member" | "guest";
  /** How many legs they played. */
  legs: number;
  /** cents, signed: what their legs did to the bank in total. */
  delta: number;
  /** cents, their best single leg, or null if they have played none. */
  best: number | null;
  /** cents, their worst single leg, or null. */
  worst: number | null;
  /** cents they have spent on one-shot tokens. */
  spent: number;
}

/** One stage, as the TV and the recap tell the story of the run. */
export interface CrunStageRow {
  index: number;
  /** cents */
  quota: number;
  cleared: boolean;
  /** Attempts spent here; more than one means a budget ran out. */
  attempts: number;
  /** The legs played at this stage, in order, with the running bank. */
  legs: (CrunLeg & { bank: number })[];
}

export interface CrunSummary extends CrunProgress {
  stakes: CashStakes;
  modifiers: string[];
  difficulty: CrunDifficulty;
  ladder: CrunLadder;
  /** cents */
  startingBank: number;
  /** cents */
  floor: number;
  players: CrunPlayerRow[];
  stages: CrunStageRow[];
  /** Every leg with the bank after it, newest last. */
  legs: (CrunLeg & { bank: number; stage: number })[];
  /** The pack's own noun for what happened, for headlines. */
  headline: string;
}

export function summarizeCrun(state: CrunState): CrunSummary {
  const ladder = crunLadder(state.difficulty);
  const progress = crunProgress(state);

  // The same walk again, this time keeping the per-leg trail the screens need.
  // Deliberately a second pass over crunProgress rather than one function that
  // returns both: the progress walk is the one every correctness test pins, and
  // threading display bookkeeping through it would make it harder to read for
  // no gain on a log this short.
  const stages: CrunStageRow[] = Array.from({ length: ladder.stages }, (_, i) => ({
    index: i,
    quota: crunQuota(ladder, state.startingBank, i),
    cleared: i < progress.cleared,
    attempts: 1,
    legs: [],
  }));
  const legs: (CrunLeg & { bank: number; stage: number })[] = [];

  {
    let bank = state.startingBank;
    let stage = 0;
    let attempt = 1;
    let legsUsed = 0;
    let boughtLegs = 0;
    let done = false;
    for (const l of state.legs) {
      if (done) break;
      bank += Math.trunc(l.delta);
      const row = { ...l, bank, stage: Math.min(stage, ladder.stages - 1) };
      legs.push(row);
      stages[row.stage]!.legs.push({ ...l, bank });
      if (bank <= state.floor) {
        done = true;
        continue;
      }
      // A buy moves the bank and shows in the log, but spends no leg budget.
      if (!isLeg(l)) {
        if (crunToken(l.token ?? "")?.effect === "extra_leg") boughtLegs++;
        continue;
      }
      legsUsed++;
      if (bank >= crunQuota(ladder, state.startingBank, stage)) {
        // Same while-not-if as crunProgress; the two walks have to agree.
        while (stage < ladder.stages && bank >= crunQuota(ladder, state.startingBank, stage)) {
          stage++;
        }
        attempt = 1;
        legsUsed = 0;
        boughtLegs = 0;
        if (stage >= ladder.stages) done = true;
      } else if (legsUsed >= ladder.legsPerStage + boughtLegs) {
        const at = Math.min(stage, ladder.stages - 1);
        if (attempt >= ladder.attemptsPerStage) {
          done = true;
        } else {
          attempt++;
          legsUsed = 0;
          boughtLegs = 0;
          if (stages[at]) stages[at]!.attempts++;
        }
      }
    }
  }

  const byPlayer = new Map<string, CrunPlayerRow>(
    state.roster.map((p) => [
      p.id,
      { playerId: p.id, name: p.name, kind: p.kind, legs: 0, delta: 0, best: null, worst: null, spent: 0 },
    ]),
  );
  for (const l of state.legs) {
    if (!l.playerId) continue;
    const row = byPlayer.get(l.playerId);
    if (!row) continue;
    if (!isLeg(l)) {
      // A purchase is attributed but is not a leg played, and it must not drag
      // somebody's best/worst leg around — buying a token is not a bad hand.
      row.spent += -Math.trunc(l.delta);
      continue;
    }
    row.legs++;
    row.delta += Math.trunc(l.delta);
    if (row.best === null || l.delta > row.best) row.best = Math.trunc(l.delta);
    if (row.worst === null || l.delta < row.worst) row.worst = Math.trunc(l.delta);
  }

  return {
    ...progress,
    stakes: state.stakes,
    modifiers: state.modifiers,
    difficulty: state.difficulty,
    ladder,
    startingBank: state.startingBank,
    floor: state.floor,
    // Busiest first, so the person carrying the run is at the top.
    players: [...byPlayer.values()].sort((a, b) => b.legs - a.legs || b.delta - a.delta),
    stages,
    legs,
    headline:
      progress.ending === "cleared"
        ? `Run cleared — all ${ladder.stages} stages`
        : progress.ending === "floor"
        ? `Bust on stage ${Math.min(progress.stage + 1, ladder.stages)} — through the floor`
        : progress.ending === "attempts"
        ? `Bust on stage ${Math.min(progress.stage + 1, ladder.stages)} — out of attempts`
        : `Stage ${progress.stage + 1} of ${ladder.stages}`,
  };
}

// ---------- the lifetime read ----------
//
// Deliberately NOT aggregateCashNights or aggregateByModifier, close as they
// look. Those define a win as a night finishing with a positive net, and here
// a win is a CLEARED RUN — which is not the same thing: a run recorded while
// still going has the bank above its starting stake and is still a loss for
// everyone. Reusing the cash aggregate would have produced a number that was
// right most of the time, which is the worst kind.

/** One recorded run, as the lifetime read describes it. */
export interface CrunRunRow {
  cleared: boolean;
  difficulty: string;
  stagesCleared: number;
  stagesTotal: number;
  /** cents */
  comeback: number;
  missed: number;
  legs: number;
  /** How it ended. Absent on runs recorded before there were two ways to lose. */
  ending?: "cleared" | "floor" | "attempts" | null;
  /** One-shot tokens bought during the run. */
  tokens?: number;
  modifiers?: string[];
}

export interface CrunLifetimeAgg {
  runs: number;
  cleared: number;
  clearRate: number;
  /** Most stages cleared in a single run. */
  deepest: number;
  /** Runs that ended without clearing. */
  busts: number;
  /** Of those, how many lost the bank rather than running out of attempts. */
  lostBank: number;
  /** ...and how many ran out of shots at a stage with money still on the table. */
  ranOut: number;
  /** One-shot tokens bought across every run. */
  tokens: number;
  /** cents, the biggest single comeback across every run. */
  bestComeback: number;
  /** Stage attempts lost across every run: how much the house has taxed them. */
  missed: number;
  legs: number;
}

export function aggregateCrunRuns(rows: CrunRunRow[]): CrunLifetimeAgg {
  let cleared = 0;
  let deepest = 0;
  let bestComeback = 0;
  let missed = 0;
  let legs = 0;
  let lostBank = 0;
  let ranOut = 0;
  let tokens = 0;
  for (const r of rows) {
    if (r.cleared) cleared++;
    if (r.stagesCleared > deepest) deepest = r.stagesCleared;
    if (r.comeback > bestComeback) bestComeback = r.comeback;
    missed += r.missed;
    legs += r.legs;
    tokens += r.tokens ?? 0;
    if (r.ending === "floor") lostBank++;
    else if (r.ending === "attempts") ranOut++;
  }
  return {
    runs: rows.length,
    cleared,
    clearRate: rows.length ? cleared / rows.length : 0,
    deepest,
    busts: rows.length - cleared,
    lostBank,
    ranOut,
    tokens,
    bestComeback,
    missed,
    legs,
  };
}

/** Clear rate per house rule. Crew-wide, because a co-op result IS crew-wide. */
export interface CrunModifierAgg {
  id: string;
  runs: number;
  cleared: number;
  clearRate: number;
}

/**
 * How runs went with each card live.
 *
 * CREW-WIDE here, unlike the cash packs' per-modifier read, and for a reason
 * that is the mirror image of theirs: money had to be per player because a
 * player-banked table is zero-sum, so a crew total is always zero. A co-op
 * clear is the opposite — it is a property of the TABLE, identical for
 * everyone on it, so a per-player split would just be the same number copied
 * once per seat.
 *
 * Takes RUNS, not participant rows. The caller dedupes; this cannot know that
 * five rows with the same ids are one run rather than five.
 */
export function aggregateCrunModifiers(rows: CrunRunRow[]): CrunModifierAgg[] {
  const byId = new Map<string, CrunModifierAgg>();
  for (const r of rows) {
    for (const id of r.modifiers ?? []) {
      const agg = byId.get(id) ?? { id, runs: 0, cleared: 0, clearRate: 0 };
      agg.runs++;
      if (r.cleared) agg.cleared++;
      byId.set(id, agg);
    }
  }
  const out = [...byId.values()];
  for (const a of out) a.clearRate = a.runs ? a.cleared / a.runs : 0;
  // Ties broken by id rather than left to Map order, so the panel does not
  // reshuffle itself between two reads of the same data.
  return out.sort((a, b) => b.runs - a.runs || a.id.localeCompare(b.id));
}

// ---------- the ledger ----------

export interface CrunLedgerLine {
  playerId: string;
  placement: number;
  isWinner: boolean;
  meta: Record<string, unknown>;
}

/**
 * One row per player, and EVERY PLAYER GETS THE SAME RESULT.
 *
 * That is the whole point of a co-op mode and it is a deliberate departure
 * from how the rest of the app ranks: there is no per-player net here to sort
 * by, because there is no per-player money. A cleared run is co-placement 1
 * and a win for everyone at the table; a busted run is an equal LAST for
 * everyone. Ties are competition ranking exactly as elsewhere — it is just
 * that in this pack every player is always in the same tie.
 *
 * The bust placement is the roster size, so a busted run reads as last rather
 * than as first, with a floor of 2 for the solo case: a single player who
 * busted would otherwise be recorded at placement 1, and "best placement 1" on
 * a run they lost is exactly the sort of quietly wrong number this app tries
 * not to write.
 */
export function crunLedgerLines(
  state: CrunState,
  opts?: { extraMeta?: (playerId: string) => Record<string, unknown> },
): CrunLedgerLine[] {
  const summary = summarizeCrun(state);
  const cleared = summary.status === "cleared";
  const placement = cleared ? 1 : Math.max(2, state.roster.length);

  return state.roster.map((p) => {
    const own = summary.players.find((r) => r.playerId === p.id);
    const meta: Record<string, unknown> = {
      // The run, identical on every row: these are what the lifetime panel
      // reads, and a co-op result is a property of the table, not the person.
      result: summary.status,
      difficulty: state.difficulty,
      stagesCleared: summary.cleared,
      stagesTotal: summary.ladder.stages,
      startingBank: state.startingBank,
      finalBank: summary.bank,
      peakBank: summary.peak,
      comeback: summary.comeback,
      missed: summary.missed,
      // Legs only. Purchases live in the same log but are not stretches of
      // play, and counting them would inflate every "legs played" stat.
      legs: state.legs.filter(isLeg).length,
      // WHICH way it ended, not just that it did: "we ran out of attempts on
      // stage 4" and "we lost the bank on stage 1" are different nights.
      ending: summary.ending,
      tokens: state.legs.filter((l) => !isLeg(l)).length,
      stakes: state.stakes,
    };
    if (state.modifiers.length) meta.modifiers = [...state.modifiers];
    // Per-leg attribution, the half that IS personal: how much of the run this
    // player actually played, so "who carried it" survives the night.
    if (own && own.legs > 0) {
      meta.myLegs = own.legs;
      meta.myDelta = own.delta;
    }
    const extra = opts?.extraMeta?.(p.id);
    if (extra) for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined) meta[k] = v;
    return { playerId: p.id, placement, isWinner: cleared, meta };
  });
}

// TV board derivations for a bracketed night.
//
// TWO TVs IN THIS APP RENDER A BRACKET: the shell's /tv/:id and Beerio Kart's
// /beerio/tv/:code. They are built from different engines (bracket.ts here,
// and the vendored 1:1 port in apps/web/src/beerio/BeerioApp.tsx) and they
// speak different design languages, but they answer the SAME three questions
// about the night: what order do the rounds go in, who is still alive, and
// where has the night got to. Those rules live here once, so the two boards
// can never disagree and a third bracketed TV inherits them rather than
// re-deriving them.
//
// PURE, and deliberately NOT part of the engine: nothing here derives a
// match, a bye, a reset or a placement. Everything reads what a compute()
// already produced, reduced to seeds. bracket.ts's behaviour is untouched.

import type { BracketSide } from "./bracket.js";

// ---------- Round order ----------

/**
 * Everything the round comparator is allowed to look at: which side of the
 * bracket a round is on, and how deep it sits within that side (1-based).
 *
 * Deliberately no ids, titles or match counts. Both TVs can map into this:
 * the shell's from the round metadata its payload already carries, Beerio's
 * from a parse of its group key. Neither can accidentally sort by something
 * the other cannot see.
 */
export interface RoundOrder {
  side: BracketSide;
  depth: number;
}

/** W before L before GF at equal depth. */
const SIDE_RANK: Record<BracketSide, number> = { W: 0, L: 1, GF: 2 };

/**
 * The grand final is last whatever depth it claims. Its own depth counts
 * sets (GF, then the reset), not rounds of the night, so it must not be
 * compared against a winners or losers round on that number.
 */
const GF_DEPTH = Number.MAX_SAFE_INTEGER;

/**
 * Order two rounds the way a TV should read them: DEPTH first, side second.
 *
 * That reads winners R1, losers R1, winners R2, losers R2 and so on, with
 * the grand final last. Sorting by side first would put the whole winners
 * bracket above the whole losers bracket, which is `buildBracket`'s
 * insertion order and looks right only at the start of a night: mid-bracket
 * it floats a winners round 2 matchup above a losers round 1 one that has
 * been waiting longer, and the losers path reads as an afterthought.
 *
 * Returns 0 for two rounds at the same coordinates, so `Array.sort` leaves
 * matches within one round in the order the engine emitted them.
 */
export function compareRoundOrder(x: RoundOrder, y: RoundOrder): number {
  const dx = x.side === "GF" ? GF_DEPTH : x.depth;
  const dy = y.side === "GF" ? GF_DEPTH : y.depth;
  return dx - dy || SIDE_RANK[x.side] - SIDE_RANK[y.side];
}

/**
 * Read a round's coordinates off a group key of the shape both engines use:
 * `W{r}`, `L{r}` or `GF`.
 *
 * Beerio's `MatchDef.grp` is exactly these strings, and its losers rounds are
 * numbered the same way this package's are (a drop-in round and a
 * consolidation round per winners round), so the depth read off `L{r}` is the
 * same quantity `buildDoubleElim` counts rather than merely looking like it.
 *
 * Returns null for anything else, so a caller can decide what an unknown key
 * means rather than being handed a silent 0.
 */
export function roundOrderFromKey(key: string): RoundOrder | null {
  if (key === "GF") return { side: "GF", depth: 1 };
  const m = /^([WL])(\d+)$/.exec(key);
  if (!m) return null;
  const depth = Number(m[2]);
  if (!Number.isFinite(depth) || depth < 1) return null;
  return { side: m[1] === "W" ? "W" : "L", depth };
}

// ---------- Who is still alive ----------

export type BoardFormat = "single_elim" | "double_elim";

/**
 * One match, reduced to the only thing the alive board needs from it.
 *
 * `loser` is a seed, or null when nobody lost anything a person played: an
 * undecided match, or a bye slot. Callers that have a loser to hand (Beerio's
 * `MatchResult` carries one) pass it straight through; callers that do not
 * (the shell's `BracketMatchView` carries a, b and winner) go through
 * `loserSeedOf` below.
 */
export interface BoardMatch {
  decided: boolean;
  /** Decided by a bye walkover rather than by a played result. */
  auto: boolean;
  loser: number | null;
}

/**
 * Whichever of a/b the winner is not, by seed. Null when the match has no
 * winner yet, or when the other slot was not a real entrant.
 */
export function loserSeedOf(
  a: number | null,
  b: number | null,
  winner: number | null,
): number | null {
  if (winner === null) return null;
  if (a === winner) return b;
  if (b === winner) return a;
  return null;
}

export interface AliveBoard {
  format: BoardFormat;
  /** Zero losses. On single elim this is the whole "Still in" group. */
  unbeaten: number[];
  /** Exactly one loss. ALWAYS EMPTY on single elim, where one loss is out. */
  oneLoss: number[];
  /** Out, in the order they were eliminated. */
  out: number[];
  /** unbeaten + oneLoss, i.e. the "8" in "8 of 8". */
  stillIn: number;
  entrants: number;
}

/**
 * Split the entrants into who is unbeaten, who is one loss from out, and who
 * is already out.
 *
 * A LOSS IS A MATCH THAT WAS DECIDED AND NOT `auto`. Skipping `auto` is what
 * keeps a bye walkover from counting as a loss, and it does that without
 * special-casing the bye slot: the engines already mark exactly the walkovers
 * that way.
 *
 * SINGLE ELIM IS A DIFFERENT BOARD, not a degenerate double one. One loss is
 * out, so `oneLoss` is empty and the caller renders two groups rather than
 * three. Beerio's bracket is always double elim; the shell's is whichever the
 * bracket was created as.
 *
 * ELIMINATION ORDER is the order the eliminating losses appear in `matches`,
 * which callers pass in structural order (round by round). That is the same
 * approximation the "latest results" column has always leaned on: later
 * rounds sit later in the list, so it reads as recency closely enough. IT IS
 * NOT A TIMESTAMP and nothing here has one: two people knocked out in the
 * same round appear in bracket order, not in the order the races finished.
 */
export function aliveBoard(
  entrants: readonly number[],
  matches: readonly BoardMatch[],
  format: BoardFormat,
): AliveBoard {
  const limit = format === "double_elim" ? 2 : 1;
  const losses = new Map<number, number>();
  for (const seed of entrants) losses.set(seed, 0);

  const out: number[] = [];
  for (const m of matches) {
    if (!m.decided || m.auto || m.loser === null) continue;
    const prior = losses.get(m.loser);
    if (prior === undefined) continue; // not an entrant we were asked about
    const next = prior + 1;
    losses.set(m.loser, next);
    if (next === limit) out.push(m.loser);
  }

  const unbeaten: number[] = [];
  const oneLoss: number[] = [];
  for (const seed of entrants) {
    const n = losses.get(seed) ?? 0;
    if (n === 0) unbeaten.push(seed);
    else if (n < limit) oneLoss.push(seed);
  }

  return {
    format,
    unbeaten,
    oneLoss,
    out,
    stillIn: unbeaten.length + oneLoss.length,
    entrants: entrants.length,
  };
}

// ---------- The round strip ----------

/** One round, as the strip needs it. */
export interface StripRound extends RoundOrder {
  key: string;
  title: string;
  /** Matches in this round that have a result, byes included. */
  decided: number;
  /** Matches in this round at all (engine bookkeeping already dropped). */
  total: number;
  /** Matches in this round that could be played right now. */
  playable: number;
}

export type StripState = "done" | "now" | "next";

export interface StripCell {
  key: string;
  title: string;
  decided: number;
  total: number;
  state: StripState;
}

/**
 * The night's shape, one cell per round, in the SAME order the on-deck list
 * uses. Same comparator, so the strip and the on-deck stack can never
 * disagree about what comes next.
 *
 * MORE THAN ONE ROUND IS "NOW" AND THAT IS NORMAL: in double elim a winners
 * round and a losers round are routinely both open, which is exactly what the
 * strip is for. A round is "now" when it holds anything playable, "done" when
 * every match in it has a result, and "next" otherwise (its feeders have not
 * finished).
 */
export function roundStrip(rounds: readonly StripRound[]): StripCell[] {
  return [...rounds]
    .sort(compareRoundOrder)
    .map(({ key, title, decided, total, playable }) => ({
      key,
      title,
      decided,
      total,
      state: (playable > 0 ? "now" : total > 0 && decided >= total ? "done" : "next") as StripState,
    }));
}

// ---------- The on-deck list ----------

export type DeckState = "ready" | "pending";

/**
 * One undecided match, reduced to the only things the deck rule looks at.
 * Deliberately no names, no ids, no slots: both TVs reduce into this, so
 * neither can qualify a match on something the other cannot see.
 */
export interface DeckCandidate extends RoundOrder {
  /** A result is recorded, byes included. Decided matches are never on deck. */
  decided: boolean;
  /** Seats holding a REAL entrant: 2, 1 or 0. A bye seat is not real. */
  known: 0 | 1 | 2;
  /**
   * Every match this one is still waiting on is playable RIGHT NOW. Only
   * consulted at known === 0, where it is the whole difference between the
   * losers round about to happen and one four rounds out.
   */
  feedersLive: boolean;
}

/**
 * Which class of card this match is, or null when it does not belong on deck.
 *
 * THE OLD RULE WAS "both seats filled", and the ordering was never the
 * problem: compareRoundOrder already sorts losers R1 above winners R2. The
 * losers R1 CARD did not exist yet. So with a bye in play the room read a
 * winners R2 matchup at the top of the column while the next race was a
 * losers R1 one whose entrants were still being decided, and nobody in that
 * match knew they were up.
 *
 * Three classes, and the third is the one worth arguing about:
 *
 *   ready    both seats real. What the board has always shown.
 *   pending, one seat known    exactly one seat holds a real entrant. Always
 *            eligible: somebody already knows they are playing next and the
 *            board should say so.
 *   pending, blank vs blank    neither seat known. Eligible ONLY when every
 *            feeder it waits on is playable right now.
 *
 * THAT LAST CONDITION IS DELIBERATELY LOCAL AND NON-RECURSIVE, and it is the
 * one a later session is most likely to want to "improve". It is the crisp
 * reading of "next round": the matches that decide this one are on the table
 * NOW. Follow the chain any further and every match in the bracket qualifies
 * on day one, which is a list of the whole night rather than a list of what
 * is next. Kept local, it is exactly what puts losers R1 on the screen at the
 * start of a night with both seats reading "Loser of Ana vs Ben" and "Loser
 * of Cal vs Dee", which is the most warning this board can honestly give.
 */
export function deckStateOf(c: DeckCandidate): DeckState | null {
  if (c.decided) return null;
  if (c.known === 2) return "ready";
  if (c.known === 1) return "pending";
  return c.feedersLive ? "pending" : null;
}

/**
 * The eligible candidates, tagged with their class, in true play order.
 *
 * ONE MERGED LIST, NOT READY-FIRST. A pending losers R1 card sitting above a
 * ready winners R2 card, and pushing a fourth ready card off the bottom of a
 * sliced column, is the CORRECT outcome: that is the order the night is
 * actually played in, and a board that hides it to protect a ready card is
 * lying about what comes next. The "N ready" heading keeps counting ready
 * matches only, so nothing is concealed by the reordering.
 *
 * Generic over T so each TV keeps its own row shape and gets `deck` added.
 */
export function buildDeck<T extends DeckCandidate>(
  cands: readonly T[],
): (T & { deck: DeckState })[] {
  const out: (T & { deck: DeckState })[] = [];
  for (const c of cands) {
    const deck = deckStateOf(c);
    if (deck) out.push({ ...c, deck });
  }
  return out.sort(compareRoundOrder);
}

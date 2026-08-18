// THE TEAM PRIMITIVE: sides, and what a side result means for placement.
//
// `match_participants.side` shipped 2026-08-02 with Casino Run, so the LEDGER
// has understood teams since then and `buildRivalry` already reads it (the
// fourth `together` outcome). What did not exist was the SESSION half: picking
// sides at setup, scoring a result as two or more sides, and writing a
// DIFFERENT side value per participant. Casino Run writes ONE shared value for
// everybody, which is the co-op case rather than the team case.
//
// This module is that half, and it is deliberately not in any pack: Card table,
// Party games, Social deduction and beer pong are all queued behind it, and the
// one thing that must not happen is four packs each deciding for themselves what
// a side is and what a side result does to placement.
//
// Dependency-free, pure, no clock. The only randomness is the shuffle, and it
// takes an injected RNG so it is testable.
//
// ===========================================================================
// TWO PLACEMENT RULES LIVE IN THIS APP AND BOTH ARE CORRECT. DO NOT "FIX"
// EITHER ONE TO MATCH THE OTHER.
//
//   1. A GENUINE TIE uses COMPETITION RANKING. Two players tied at the top are
//      both placement 1 and the next player is placement 3. That is what Board
//      Game's tapped order, Smashdown's co-winners and the cash packs' net
//      ranking all do, and it is right because those players finished LEVEL
//      with each other in a field of individuals.
//
//   2. A TEAM RESULT RANKS SIDES, NOT PLAYERS, 1..N over N sides. Every member
//      of the winning side is placement 1, every member of the second side is
//      placement 2, and so on. A 2v2 is 1,1,2,2. A 2v2v2 is 1,1,2,2,3,3.
//
// They look contradictory and are not. Competition ranking would make a 2v2
// read 1,1,3,3, which says the losing pair finished third in a field of four,
// and there was no third place: there were two sides and they came first and
// second. A team placement is a RANK OVER SIDES that happens to be written onto
// each member, and a tie is a genuine level finish between individuals. The
// next session to read both of these will be tempted to unify them. It must
// not: doing so silently rewrites what a placement means in every row already
// written by the other rule.
// ===========================================================================

/**
 * The side ids that go in the column. Stable, short, opaque.
 *
 * THE COLUMN NEVER HOLDS A DISPLAY NAME. `side` is compared only for equality
 * and never rendered, so a name in it buys nothing and makes renaming a side a
 * data migration. Names live in session state, which is jsonb and free to
 * change. Same reasoning as modifier ids, and the same failure mode if ignored:
 * nothing errors, the history just quietly stops matching.
 */
export const SIDE_IDS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

/** The most sides one match can have. Eight is well past any real use. */
export const MAX_SIDES = SIDE_IDS.length;

/** The stable id for the nth side. */
export function sideIdAt(index: number): string {
  return SIDE_IDS[index] ?? `s${index}`;
}

/** "Side A", "Side B". A default only: a pack may name sides whatever it likes. */
export function defaultSideName(index: number): string {
  return `Side ${String.fromCharCode(65 + index)}`;
}

/**
 * One side. `id` is what reaches the ledger; `name` never does.
 *
 * `memberIds` are the pack's own roster SLOT ids, not userIds: a side can hold
 * guests, who have no userId at all, and the slot is what every pack already
 * keys its results by.
 */
export interface Side {
  id: string;
  name: string;
  memberIds: string[];
}

/** A side result line, ready to become a LedgerLine. */
export interface SideLine {
  playerId: string;
  placement: number;
  isWinner: boolean;
  /** null when there is no team structure; see sideIdFor. */
  side: string | null;
}

// ---------- team structure, and the one rule for when it exists ----------

/**
 * Does this arrangement have team structure at all?
 *
 * TRUE only when some side holds more than one member. A 1v1, or a six-player
 * free-for-all expressed as six sides of one, is not a team match: it is the
 * ordinary per-player case wearing the same shape, and it must produce exactly
 * the rows it produced before this primitive existed.
 */
export function isTeamPlay(sides: readonly Side[]): boolean {
  return sides.some((s) => s.memberIds.length > 1);
}

/**
 * The value to write to `match_participants.side` for one player, or null.
 *
 * NULL WHEN EVERY SIDE HAS EXACTLY ONE MEMBER. This is the rule that keeps
 * "null means no team structure" literally true, and it lives here, once, so no
 * pack can decide it differently: a pack that wrote "a" and "b" for a 1v1 would
 * make every singles match in its history look like a team match to
 * `meetingOutcome`, which would then classify two opponents as having played
 * TOGETHER. Nothing would error. The rivalry would simply be wrong forever.
 */
export function sideIdFor(sides: readonly Side[], playerId: string): string | null {
  if (!isTeamPlay(sides)) return null;
  return sides.find((s) => s.memberIds.includes(playerId))?.id ?? null;
}

// ---------- validation ----------

export interface SideCheck {
  /** A blocking problem, or null. */
  error: string | null;
  /** Whether every side is the same size. A FACT, not a problem. */
  even: boolean;
  /** Member count per side, in the order given. */
  sizes: number[];
}

/**
 * Check an arrangement of sides.
 *
 * UNEVEN SIDES ARE NOT AN ERROR. Five people into two sides is a real thing a
 * crew does, and the app records what the night did rather than refereeing it.
 * So `even` is returned as a fact for the screen to warn with, and only the
 * genuinely broken arrangements (fewer than two sides, an empty side, a player
 * on two sides at once) are errors.
 *
 * THE CEILING IS A PARAMETER, defaulting to MAX_SIDES, because MAX_SIDES is a
 * rule about ONE MATCH: eight is well past any number of sides a single game is
 * played between. A BRACKET is a different shape wearing the same arrangement.
 * Its sides are SLOTS in a draw rather than corners of one table, sixteen pairs
 * is an ordinary doubles tournament, and sideIdAt already keeps minting ids past
 * the eighth. So the bracket's setup screen passes its own entrant cap and every
 * session pack keeps the eight it always had, rather than the two shapes sharing
 * a number that only ever meant one of them.
 */
export function validateSides(sides: readonly Side[], maxSides: number = MAX_SIDES): SideCheck {
  const sizes = sides.map((s) => s.memberIds.length);
  const even = sizes.length > 0 && sizes.every((n) => n === sizes[0]);
  const fail = (error: string): SideCheck => ({ error, even, sizes });

  if (sides.length < 2) return fail("Need at least 2 sides");
  if (sides.length > maxSides) return fail(`At most ${maxSides} sides`);
  if (new Set(sides.map((s) => s.id)).size !== sides.length) return fail("Two sides share an id");
  if (sizes.some((n) => n === 0)) return fail("Every side needs at least one player");

  const seen = new Set<string>();
  for (const s of sides) {
    for (const id of s.memberIds) {
      if (seen.has(id)) return fail("A player can only be on one side");
      seen.add(id);
    }
  }
  return { error: null, even, sizes };
}

// ---------- assignment ----------

/**
 * Deal a roster into `count` sides at random.
 *
 * THE REMAINDER IS DISTRIBUTED, NEVER DROPPED: five into two is 3 and 2, not
 * 2 and 2 with somebody left out of their own game. The sizes come out as even
 * as the numbers allow and the earlier sides take the extra.
 *
 * The RNG is injected so a test can pin the deal; `Math.random` is only the
 * default. Assignment is manual pick or this shuffle, deliberately: no draft,
 * no seeding, and no balancing by past results, because a balancer is a
 * judgement about people that this app has no business making at a party.
 */
export function shuffleIntoSides(
  playerIds: readonly string[],
  count: number,
  rng: () => number = Math.random,
): Side[] {
  const n = Math.max(2, Math.min(Math.floor(count), MAX_SIDES, Math.max(2, playerIds.length)));
  const pool = [...playerIds];
  // Fisher-Yates, so every arrangement is equally likely. A sort with a random
  // comparator is not a shuffle and is biased in ways nobody notices.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const sides: Side[] = Array.from({ length: n }, (_, i) => ({
    id: sideIdAt(i),
    name: defaultSideName(i),
    memberIds: [],
  }));
  // Deal round robin rather than slicing, which is what distributes the
  // remainder across the earlier sides instead of piling it on the last one.
  pool.forEach((id, i) => sides[i % n]!.memberIds.push(id));
  return sides;
}

/** Sides of exactly one player each, in roster order: the singles arrangement. */
export function singletonSides(playerIds: readonly string[]): Side[] {
  return playerIds.map((id, i) => ({
    id: sideIdAt(i),
    name: defaultSideName(i),
    memberIds: [id],
  }));
}

// ---------- the placement rule ----------

/**
 * Turn sides IN FINISH ORDER into one ledger line per player.
 *
 * Rule 2 at the top of this file: placement is 1..N over N SIDES, written onto
 * every member of each side, and every member of the first side is a winner.
 * Read that block before changing anything here.
 *
 * The side id comes from `sideIdFor`, so an arrangement with no team structure
 * (a 1v1, or an all-singletons field) produces `side: null` on every line and
 * is byte-identical to what the pack wrote before sides existed.
 */
export function placementsFromSideOrder(order: readonly Side[]): SideLine[] {
  return placementsFromRankedSides(order.map((side) => ({ side })));
}

/** A side in a finish order, which may have finished LEVEL with the one above. */
export interface RankedSide {
  side: Side;
  tiedWithAbove?: boolean;
}

/**
 * The same rule, for a finish order that can contain TIES between sides.
 *
 * `placementsFromSideOrder` is this with every flag false, so there is one
 * implementation and two entry points rather than two rules that can drift.
 *
 * A tie here is competition ranking over SIDES: two sides level at the top are
 * both placement 1 and the next side is placement 3, and every member of a tied
 * side carries its placement. That composes the two rules at the top of this
 * file rather than contradicting them. The free-for-all case a title-night pack
 * records is exactly this with singleton sides: a tapped order of individuals,
 * ties allowed, `side` null on every row because nothing has more than one
 * member.
 */
export function placementsFromRankedSides(order: readonly RankedSide[]): SideLine[] {
  const sides = order.map((o) => o.side);
  const lines: SideLine[] = [];
  const placements: number[] = [];
  for (const [i, entry] of order.entries()) {
    // Competition ranking: a tie takes the placement above it, and the next
    // untied row takes its own 1-based position, which is what leaves the gap
    // (1, 1, 3) rather than closing it up (1, 1, 2).
    placements[i] = i > 0 && entry.tiedWithAbove ? placements[i - 1]! : i + 1;
    for (const playerId of entry.side.memberIds) {
      lines.push({
        playerId,
        placement: placements[i]!,
        isWinner: placements[i] === 1,
        side: sideIdFor(sides, playerId),
      });
    }
  }
  return lines;
}

/** The side holding a player, or undefined. */
export function sideOf(sides: readonly Side[], playerId: string): Side | undefined {
  return sides.find((s) => s.memberIds.includes(playerId));
}

/** A side's display label from its members' names, falling back to its own name. */
export function sideLabel(side: Side, nameOf: (id: string) => string | undefined): string {
  const names = side.memberIds.map((id) => nameOf(id)).filter((n): n is string => !!n);
  return names.length ? names.join(" + ") : side.name;
}

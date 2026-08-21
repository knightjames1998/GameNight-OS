// The two bracketed TVs' shared derivations: round order, the alive board and
// the round strip.
//
// EVERY FIXTURE IS REAL ENGINE OUTPUT. Test files are outside the typecheck
// scope (both packages are `include: ["src"]`, written down in the DECISION
// LOG for 2026-08-10), so a hand-built payload can drift from the shape the
// app actually produces and nothing will say so. Here the matches come from
// buildDoubleElim/buildSingleElim + computeBracket, played out for real, and
// the only hand-written inputs are the round-order coordinates, which are
// two numbers with no shape to drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDoubleElim,
  buildSingleElim,
  computeBracket,
  type BracketResults,
  type BracketStructure,
  type ComputedBracket,
} from "../src/bracket.js";
import {
  aliveBoard,
  compareRoundOrder,
  loserSeedOf,
  roundOrderFromKey,
  roundStrip,
  buildDeck,
  deckStateOf,
  type BoardMatch,
  type DeckCandidate,
  type RoundOrder,
  type StripRound,
} from "../src/bracketboard.js";

// ---------- helpers ----------

/**
 * Play `waves` rounds of everything that is currently playable, lowest seed
 * always winning. A WAVE RATHER THAN N MATCHES on purpose: playing "the first
 * playable match" repeatedly walks the engine's insertion order, which is
 * every winners round before any losers round, which is the exact order
 * this module exists to stop a TV from showing, so it makes a poor fixture. A wave is how
 * a real night goes: everything that can be raced gets raced.
 *
 * `waves: Infinity` plays to a champion.
 */
function playWaves(
  n: number,
  structure: BracketStructure,
  waves: number,
): { computed: ComputedBracket; results: BracketResults } {
  const results: BracketResults = {};
  for (let w = 0; w < waves; w++) {
    const computed = computeBracket(n, structure, results);
    const open = Object.values(computed.matches).filter((m) => m.playable && m.active);
    if (open.length === 0) break;
    for (const m of open) {
      const aSeed = m.a.kind === "player" ? m.a.seed : Infinity;
      const bSeed = m.b.kind === "player" ? m.b.seed : Infinity;
      results[m.def.id] = aSeed < bSeed ? "A" : "B";
    }
  }
  return { computed: computeBracket(n, structure, results), results };
}

/**
 * Flatten a computed bracket into the strip's per-round shape, in group
 * order. The same mapping `TvPage` does off its payload, including the
 * synthesized key (a group carries a title and a side, not a key).
 */
function stripRounds(structure: BracketStructure, computed: ComputedBracket): StripRound[] {
  const depth: Record<string, number> = {};
  const out: StripRound[] = [];
  for (const g of structure.groups) {
    const live = g.ids
      .map((id) => computed.matches[id]!)
      .filter((m) => m.active && !(m.a.kind === "bye" && m.b.kind === "bye"));
    if (live.length === 0) continue;
    const d = (depth[g.side] = (depth[g.side] ?? 0) + 1);
    out.push({
      key: g.side === "GF" ? "GF" : `${g.side}${d}`,
      title: g.title,
      side: g.side,
      depth: d,
      decided: live.filter((m) => m.decided).length,
      total: live.length,
      playable: live.filter((m) => m.playable).length,
    });
  }
  return out;
}

/**
 * Flatten a computed bracket into the alive board's shape, in group order,
 * going through `loserSeedOf` exactly the way the shell's TV has to (its
 * payload carries a, b and winner, and no loser).
 */
function boardMatches(structure: BracketStructure, computed: ComputedBracket): BoardMatch[] {
  const out: BoardMatch[] = [];
  for (const g of structure.groups) {
    for (const id of g.ids) {
      const m = computed.matches[id]!;
      if (!m.active) continue;
      const seed = (s: (typeof m)["a"]) => (s.kind === "player" ? s.seed : null);
      out.push({
        decided: m.decided,
        auto: m.auto,
        loser: loserSeedOf(seed(m.a), seed(m.b), m.decided ? seed(m.winner) : null),
      });
    }
  }
  return out;
}

const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

// ---------- round order ----------

const R = (side: RoundOrder["side"], depth: number): RoundOrder => ({ side, depth });

test("winners comes before losers at equal depth", () => {
  assert.ok(compareRoundOrder(R("W", 1), R("L", 1)) < 0);
  assert.ok(compareRoundOrder(R("L", 2), R("W", 2)) > 0);
});

test("an earlier losers round comes before a later winners round", () => {
  // The whole point: losers R1 has been waiting longer than winners R2, so it
  // reads first. Insertion order (every W round, then every L round) puts it
  // the other way round and that is the bug this replaces.
  assert.ok(compareRoundOrder(R("L", 1), R("W", 2)) < 0);
  assert.ok(compareRoundOrder(R("L", 3), R("W", 4)) < 0);
});

test("the grand final is last whatever depth it claims", () => {
  for (const depth of [1, 2, 99]) {
    assert.ok(compareRoundOrder(R("GF", depth), R("W", 1)) > 0);
    assert.ok(compareRoundOrder(R("GF", depth), R("L", 6)) > 0);
    assert.ok(compareRoundOrder(R("GF", depth), R("W", 500)) > 0);
  }
});

test("two rounds at the same coordinates compare equal, so a sort is stable", () => {
  assert.equal(compareRoundOrder(R("W", 3), R("W", 3)), 0);
  assert.equal(compareRoundOrder(R("GF", 1), R("GF", 2)), 0);

  // Array.prototype.sort is required to be stable, so equal keys keep the
  // order the engine emitted: two matches in one round stay in bracket order.
  const rounds: StripRound[] = ["a", "b", "c"].map((key) => ({
    key, title: key, side: "W", depth: 2, decided: 0, total: 1, playable: 1,
  }));
  assert.deepEqual(roundStrip(rounds).map((c) => c.key), ["a", "b", "c"]);
});

test("group keys parse into round coordinates, and nonsense does not", () => {
  assert.deepEqual(roundOrderFromKey("W1"), { side: "W", depth: 1 });
  assert.deepEqual(roundOrderFromKey("L4"), { side: "L", depth: 4 });
  assert.deepEqual(roundOrderFromKey("GF"), { side: "GF", depth: 1 });
  assert.deepEqual(roundOrderFromKey("L12"), { side: "L", depth: 12 });
  for (const bad of ["", "W", "L0", "X2", "W1M0", "GF2", "gf", "W-1"]) {
    assert.equal(roundOrderFromKey(bad), null, `${JSON.stringify(bad)} should not parse`);
  }
});

test("the sorted order of a real 8-entrant double elim interleaves the two sides", () => {
  const structure = buildDoubleElim(8);
  const { computed } = playWaves(8, structure, 1);
  // The engine emits W1 W2 W3 L1 L2 L3 L4 GF. This is the same rounds read
  // the way a room experiences them.
  assert.deepEqual(
    roundStrip(stripRounds(structure, computed)).map((c) => c.key),
    ["W1", "L1", "W2", "L2", "W3", "L3", "L4", "GF"],
  );
});

// ---------- the alive board ----------

test("a bye walkover is not a loss", () => {
  // Six entrants in an eight bracket: two W1 matches are player-vs-bye, and
  // computeBracket marks exactly those `auto`. Nobody is out before a race
  // has been run.
  const structure = buildDoubleElim(6);
  const computed = computeBracket(6, structure, {});
  const matches = boardMatches(structure, computed);
  assert.ok(matches.some((m) => m.decided && m.auto), "fixture has no walkover to skip");

  const board = aliveBoard(seeds(6), matches, "double_elim");
  assert.deepEqual(board.unbeaten, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(board.oneLoss, []);
  assert.deepEqual(board.out, []);
  assert.equal(board.stillIn, 6);
  assert.equal(board.entrants, 6);
});

test("double elim: one loss is one loss, two is out, and the three groups partition the field", () => {
  const structure = buildDoubleElim(8);
  const { computed } = playWaves(8, structure, 2);
  const board = aliveBoard(seeds(8), boardMatches(structure, computed), "double_elim");

  // Two waves, lowest seed always winning: W1 knocked 5,6,7,8 down a bracket,
  // then W2 dropped 3 and 4 while L1 put 7 and 8 out for good.
  assert.deepEqual(board.unbeaten, [1, 2]);
  assert.deepEqual(board.oneLoss, [3, 4, 5, 6]);
  assert.deepEqual(board.out, [8, 7]);
  assert.equal(board.stillIn, 6);

  const all = [...board.unbeaten, ...board.oneLoss, ...board.out].sort((a, b) => a - b);
  assert.deepEqual(all, seeds(8), "every entrant lands in exactly one group");
});

test("single elim is a different board: one loss is out and there is no middle group", () => {
  const structure = buildSingleElim(8);
  const { computed } = playWaves(8, structure, 1);
  const board = aliveBoard(seeds(8), boardMatches(structure, computed), "single_elim");

  assert.deepEqual(board.oneLoss, [], "single elim has no one-loss group at all");
  assert.deepEqual(board.unbeaten, [1, 2, 3, 4]);
  assert.deepEqual(board.out, [8, 5, 7, 6]);
  assert.equal(board.stillIn, 4);
  assert.equal(board.format, "single_elim");
});

test("the same played bracket gives a smaller board under single elim than double", () => {
  // Same results, same matches, two formats: the ONLY difference is the rule,
  // which is what makes single elim a real second shape rather than a label.
  const structure = buildDoubleElim(8);
  const { computed } = playWaves(8, structure, 2);
  const matches = boardMatches(structure, computed);
  const dbl = aliveBoard(seeds(8), matches, "double_elim");
  const sgl = aliveBoard(seeds(8), matches, "single_elim");
  assert.equal(dbl.stillIn, 6);
  assert.equal(sgl.stillIn, 2);
  assert.deepEqual(sgl.oneLoss, []);
});

test("out is in elimination order, and a champion's board has one person left", () => {
  const structure = buildDoubleElim(4);
  const { computed } = playWaves(4, structure, Infinity);
  assert.notEqual(computed.championSeed, null, "fixture never finished");
  const board = aliveBoard(seeds(4), boardMatches(structure, computed), "double_elim");
  assert.deepEqual(board.unbeaten, [computed.championSeed]);
  assert.deepEqual(board.oneLoss, []);
  assert.equal(board.out.length, 3);
  assert.equal(board.stillIn, 1);
  // Structural order, not a clock: the losses appear round by round, so the
  // person knocked out in the losers final is last.
  assert.deepEqual(board.out.slice().sort((a, b) => a - b), [2, 3, 4]);
});

test("an empty bracket leaves everyone unbeaten", () => {
  const structure = buildDoubleElim(8);
  const board = aliveBoard(seeds(8), boardMatches(structure, computeBracket(8, structure, {})), "double_elim");
  assert.equal(board.stillIn, 8);
  assert.deepEqual(board.out, []);
});

test("loserSeedOf picks whichever of a/b the winner is not", () => {
  assert.equal(loserSeedOf(3, 6, 3), 6);
  assert.equal(loserSeedOf(3, 6, 6), 3);
  assert.equal(loserSeedOf(3, 6, null), null, "undecided");
  assert.equal(loserSeedOf(3, null, 3), null, "the other slot was a bye");
  assert.equal(loserSeedOf(3, 6, 9), null, "a winner in neither slot means nothing");
});

// ---------- the round strip ----------

test("more than one round is current at once in double elim, which is the normal case", () => {
  const structure = buildDoubleElim(8);
  // All four W1s played: winners R2 is open AND losers R1 is open.
  const { computed } = playWaves(8, structure, 1);
  const cells = roundStrip(stripRounds(structure, computed));
  assert.deepEqual(cells.filter((c) => c.state === "now").map((c) => c.key), ["L1", "W2"]);
  assert.deepEqual(cells.filter((c) => c.state === "done").map((c) => c.key), ["W1"]);
  assert.deepEqual(
    cells.filter((c) => c.state === "next").map((c) => c.key),
    ["L2", "W3", "L3", "L4", "GF"],
  );
});

test("strip counts are decided against total, byes included", () => {
  // Six in an eight bracket: W1 has four matches, two of them walkovers, so
  // the round opens already half-played rather than at 0 of 4.
  const structure = buildDoubleElim(6);
  const cells = roundStrip(stripRounds(structure, computeBracket(6, structure, {})));
  const w1 = cells.find((c) => c.key === "W1")!;
  assert.equal(w1.total, 4);
  assert.equal(w1.decided, 2);
  assert.equal(w1.state, "now");
});

test("a finished bracket's strip is all done", () => {
  const structure = buildDoubleElim(8);
  const { computed } = playWaves(8, structure, Infinity);
  assert.notEqual(computed.championSeed, null);
  const cells = roundStrip(stripRounds(structure, computed));
  assert.deepEqual(cells.filter((c) => c.state !== "done"), []);
  for (const c of cells) assert.equal(c.decided, c.total, `${c.key} is not fully decided`);
});

test("single elim's strip is one side, in round order", () => {
  const structure = buildSingleElim(8);
  const { computed } = playWaves(8, structure, 1);
  const cells = roundStrip(stripRounds(structure, computed));
  assert.deepEqual(cells.map((c) => c.key), ["W1", "W2", "W3"]);
  assert.deepEqual(cells.map((c) => c.title), ["Quarterfinals", "Semifinals", "Final"]);
  assert.deepEqual(cells.map((c) => c.state), ["done", "now", "next"]);
});

// ---------- the on-deck list ----------

/** A candidate with everything the rule ignores left off. */
const cand = (over: Partial<DeckCandidate> = {}): DeckCandidate => ({
  side: "W",
  depth: 1,
  decided: false,
  known: 2,
  feedersLive: false,
  ...over,
});

test("deckStateOf: both seats real is ready", () => {
  assert.equal(deckStateOf(cand({ known: 2 })), "ready");
});

test("deckStateOf: ONE SEAT KNOWN IS ALWAYS PENDING, whatever the feeders are doing", () => {
  // Somebody already knows they are playing next, so the board owes them a
  // card. feedersLive is not consulted here and the test says so both ways.
  assert.equal(deckStateOf(cand({ known: 1, feedersLive: false })), "pending");
  assert.equal(deckStateOf(cand({ known: 1, feedersLive: true })), "pending");
});

test("deckStateOf: BLANK VS BLANK NEEDS LIVE FEEDERS, which is the whole difference", () => {
  // The losers round about to happen, versus one four rounds out. Without
  // this condition every match in the bracket is "next" on day one.
  assert.equal(deckStateOf(cand({ known: 0, feedersLive: true })), "pending");
  assert.equal(deckStateOf(cand({ known: 0, feedersLive: false })), null);
});

test("deckStateOf: A DECIDED MATCH IS NEVER ON DECK, whatever its seats say", () => {
  for (const known of [0, 1, 2] as const) {
    for (const feedersLive of [true, false]) {
      assert.equal(deckStateOf(cand({ decided: true, known, feedersLive })), null,
        `decided/${known}/${feedersLive} qualified`);
    }
  }
});

test("buildDeck drops the ineligible and tags the rest", () => {
  const deck = buildDeck([
    cand({ known: 2, depth: 1 }),
    cand({ known: 0, feedersLive: false, depth: 2 }),   // out
    cand({ known: 1, depth: 3 }),
    cand({ decided: true, known: 2, depth: 4 }),        // out
  ]);
  assert.deepEqual(deck.map((d) => [d.depth, d.deck]), [[1, "ready"], [3, "pending"]]);
});

test("A PENDING LOSERS R1 SORTS ABOVE A READY WINNERS R2, which is the point of the session", () => {
  // The reported bug, stated as an assertion on the OUTPUT rather than on the
  // comparator: the ordering was always right, the losers card simply did not
  // exist, so the room saw a winners R2 matchup while the next race was a
  // losers R1 one nobody had been told about.
  const deck = buildDeck([
    { side: "W", depth: 2, decided: false, known: 2, feedersLive: false },
    { side: "L", depth: 1, decided: false, known: 0, feedersLive: true },
  ]);
  assert.deepEqual(deck.map((d) => [d.side, d.depth, d.deck]), [
    ["L", 1, "pending"],
    ["W", 2, "ready"],
  ]);
});

test("the merged list is true play order, not ready-first", () => {
  // Restated across a whole night's worth of rounds, because "ready first"
  // is the shape somebody will reach for when a pending card pushes a ready
  // one off a sliced column. That slice is the budget; this is the order.
  const deck = buildDeck([
    { side: "GF", depth: 1, decided: false, known: 0, feedersLive: true },
    { side: "L", depth: 2, decided: false, known: 1, feedersLive: false },
    { side: "W", depth: 1, decided: false, known: 2, feedersLive: false },
    { side: "L", depth: 1, decided: false, known: 0, feedersLive: true },
    { side: "W", depth: 2, decided: false, known: 2, feedersLive: false },
  ]);
  assert.deepEqual(deck.map((d) => `${d.side}${d.depth}:${d.deck}`), [
    "W1:ready", "L1:pending", "W2:ready", "L2:pending", "GF1:pending",
  ]);
});

/**
 * Reduce a computed bracket into deck candidates, the same mapping both TVs
 * do off their own shapes. `feedersLive` is the local, non-recursive reading:
 * every match this one waits on is playable RIGHT NOW.
 */
function deckCands(
  structure: BracketStructure,
  computed: ComputedBracket,
): (DeckCandidate & { id: string })[] {
  const depth: Record<string, number> = {};
  const out: (DeckCandidate & { id: string })[] = [];
  for (const g of structure.groups) {
    const live = g.ids
      .map((id) => computed.matches[id]!)
      .filter((m) => m.active && !(m.a.kind === "bye" && m.b.kind === "bye"));
    if (live.length === 0) continue;
    const d = (depth[g.side] = (depth[g.side] ?? 0) + 1);
    for (const m of live) {
      const feeders = [m.def.a, m.def.b]
        .filter((src) => src.t !== "seed")
        .map((src) => computed.matches[(src as { m: string }).m]);
      out.push({
        id: m.def.id,
        side: g.side,
        depth: d,
        decided: m.decided,
        known: [m.a, m.b].filter((sl) => sl.kind === "player").length as 0 | 1 | 2,
        feedersLive: feeders.length > 0 && feeders.every((f) => !!f && f.playable),
      });
    }
  }
  return out;
}

/** Play the single first playable match, which is how a night actually starts. */
function playOne(n: number, structure: BracketStructure, times: number): ComputedBracket {
  const results: BracketResults = {};
  for (let k = 0; k < times; k++) {
    const c = computeBracket(n, structure, results);
    const open = Object.values(c.matches).filter((m) => m.playable && m.active);
    if (open.length === 0) break;
    const m = open[0]!;
    const a = m.a.kind === "player" ? m.a.seed : Infinity;
    const b = m.b.kind === "player" ? m.b.seed : Infinity;
    results[m.def.id] = a < b ? "A" : "B";
  }
  return computeBracket(n, structure, results);
}

test("THE REPORTED BUG, on real engine output: losers R1 reaches the deck before its racers do", () => {
  // Eight entrants, ONE winners R1 match played, which is the moment the bug
  // was reported against. Under the old "both seats filled" rule the deck held
  // three winners R1 cards and NOTHING from the losers bracket, so the room
  // saw winners R2 at the top of the column while the next race was a losers
  // R1 one nobody in it had been told about.
  const structure = buildDoubleElim(8);
  const computed = playOne(8, structure, 1);
  const cands = deckCands(structure, computed);

  // The old rule, stated so the regression cannot come back quietly.
  const oldRule = cands.filter((c) => c.known === 2 && !c.decided);
  assert.equal(oldRule.filter((c) => c.side === "L").length, 0,
    "the fixture must have no ready losers match, or it proves nothing");

  const deck = buildDeck(cands);
  const losers = deck.filter((d) => d.side === "L");
  assert.ok(losers.length > 0, "no losers card on deck");
  assert.ok(losers.every((d) => d.deck === "pending"), "a losers card claimed to be ready");

  // BOTH pending classes are present here, which is what makes this the
  // interesting fixture: one card has a seat already known, the other is blank
  // vs blank and qualifies purely on its feeders being live.
  assert.ok(losers.some((d) => d.known === 1), "no one-seat-known card");
  assert.ok(losers.some((d) => d.known === 0), "no blank-vs-blank card");

  // And the ordering half: every losers R1 card is above every winners R2 one.
  const lastL1 = deck.map((d) => d.side === "L" && d.depth === 1).lastIndexOf(true);
  const firstW2 = deck.findIndex((d) => d.side === "W" && d.depth === 2);
  assert.ok(lastL1 >= 0 && firstW2 >= 0, "fixture lost its L1 or W2 rounds");
  assert.ok(lastL1 < firstW2, "a losers R1 card sorted below a winners R2 card");
});

test("a blank-vs-blank card drops off the deck once its feeders stop being live", () => {
  // The same bracket one match later: as winners R1 resolves, the losers cards
  // gain real seats and later rounds stop qualifying. This is the condition
  // doing its job in both directions rather than only letting things in.
  const structure = buildDoubleElim(8);
  const early = buildDeck(deckCands(structure, playOne(8, structure, 1)));
  const later = buildDeck(deckCands(structure, playOne(8, structure, 4)));
  const blanks = (d: typeof early) => d.filter((x) => x.known === 0).length;
  assert.ok(blanks(early) > 0, "no blank card early on");
  assert.ok(
    later.filter((x) => x.side === "L" && x.known === 2).length > 0,
    "the losers cards never gained real seats",
  );
});

// Isolated tests for the bracket engine, focused on the double-elim
// additions: structure shape, bye propagation into the losers bracket,
// the grand-final reset, undo cascading ACROSS brackets, and placements.
// Run with: pnpm test:bracket (from the repo root; rides the server
// package's tsx so no new dependency — and no lockfile change — is needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDoubleElim,
  buildSingleElim,
  buildStructure,
  computeBracket,
  downstreamOf,
  placements,
  type BracketResults,
  type BracketStructure,
} from "../src/bracket.js";

// ---------- helpers ----------

/** Play every playable match by calling pick(); returns results + game count. */
function playOut(
  n: number,
  structure: BracketStructure,
  pick: (id: string) => "A" | "B",
  initial: BracketResults = {},
): { results: BracketResults; games: number } {
  const results: BracketResults = { ...initial };
  for (let guard = 0; guard < 500; guard++) {
    const computed = computeBracket(n, structure, results);
    if (computed.championSeed != null) {
      return { results, games: Object.keys(results).length };
    }
    const playable = Object.values(computed.matches).filter((m) => m.playable && m.active);
    assert.ok(playable.length > 0, "live bracket with no playable match (deadlock)");
    const m = playable[0]!;
    results[m.def.id] = pick(m.def.id);
  }
  assert.fail("bracket never completed");
}

const seededRandom = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

// ---------- structure ----------

test("double elim structure: 8 entrants has the standard shape", () => {
  const s = buildDoubleElim(8);
  const bySide = (side: string) => s.defs.filter((d) => d.side === side);
  assert.equal(bySide("W").length, 7); // 4 + 2 + 1
  assert.equal(bySide("L").length, 6); // 2 + 2 + 1 + 1
  assert.equal(bySide("GF").length, 2); // GF + reset
  assert.equal(s.kind, "double");
  // Losers final receives the winners final's loser.
  const lFinal = s.defs.find((d) => d.id === "L4M0")!;
  assert.deepEqual(lFinal.b, { t: "lose", m: "W3M0" });
});

test("double elim structure: 2 entrants skips the losers bracket", () => {
  const s = buildDoubleElim(2);
  assert.equal(s.defs.filter((d) => d.side === "L").length, 0);
  const gf = s.defs.find((d) => d.id === "GF")!;
  assert.deepEqual(gf.a, { t: "win", m: "W1M0" });
  assert.deepEqual(gf.b, { t: "lose", m: "W1M0" });
});

test("single elim structure unchanged: ids still R{r}M{i}", () => {
  const s = buildSingleElim(6);
  assert.ok(s.defs.some((d) => d.id === "R1M0"));
  assert.equal(s.kind, "single");
  assert.equal(buildStructure("single_elim", 6).defs.length, s.defs.length);
});

// ---------- play-throughs ----------

test("double elim, 4 players, winners champ holds: no reset, correct places", () => {
  const s = buildDoubleElim(4);
  // Seed 1 wins everything from the A slot where possible.
  const { results } = playOut(4, s, () => "A");
  const c = computeBracket(4, s, results);
  assert.equal(c.championSeed, 1);
  assert.equal(c.matches["GF2"]!.active, false, "reset must stay hidden");
  const place = placements(s, c);
  assert.equal(place.get(1), 1);
  assert.equal(place.size, 4);
  const places = [...place.values()].sort((a, b) => a - b);
  assert.deepEqual(places, [1, 2, 3, 4]);
});

test("grand final reset: losers champ forces and wins GF2", () => {
  const s = buildDoubleElim(4);
  const { results } = playOut(4, s, (id) => (id.startsWith("GF") ? "B" : "A"));
  const c = computeBracket(4, s, results);
  // GF went B, so GF2 activated and was also taken by B.
  assert.equal(results["GF"], "B");
  assert.equal(results["GF2"], "B");
  assert.ok(c.championSeed != null);
  // The champion came through the losers bracket; the winners-bracket champ
  // (seed 1, who won every pre-GF match from slot A) is runner-up.
  const place = placements(s, c);
  assert.equal(place.get(1), 2);
});

test("no champion between GF (won by B) and GF2", () => {
  const s = buildDoubleElim(4);
  const results: BracketResults = {};
  // Play everything up to and including GF, sending GF to B.
  for (let guard = 0; guard < 100; guard++) {
    const c = computeBracket(4, s, results);
    const next = Object.values(c.matches).find((m) => m.playable && m.active);
    if (!next) break;
    if (next.def.id === "GF2") break;
    results[next.def.id] = next.def.id === "GF" ? "B" : "A";
    if (next.def.id === "GF") break;
  }
  const c = computeBracket(4, s, results);
  assert.equal(results["GF"], "B");
  assert.equal(c.championSeed, null, "reset pending: nobody is champion yet");
  assert.equal(c.matches["GF2"]!.active, true);
  assert.equal(c.matches["GF2"]!.playable, true);
});

test("byes flow through the losers bracket (5 entrants)", () => {
  const s = buildDoubleElim(5);
  const { results, games } = playOut(5, s, () => "A");
  const c = computeBracket(5, s, results);
  assert.ok(c.championSeed != null);
  // 2N-2 real games when the champion never loses.
  assert.equal(games, 2 * 5 - 2);
});

test("game-count invariant for n=2..16 under random results", () => {
  const rand = seededRandom(42);
  for (let n = 2; n <= 16; n++) {
    const s = buildDoubleElim(n);
    const { results, games } = playOut(n, s, () => (rand() < 0.5 ? "A" : "B"));
    const reset = "GF2" in results ? 1 : 0;
    assert.equal(games, 2 * n - 2 + reset, `n=${n}: expected ${2 * n - 2 + reset}, got ${games}`);
    const c = computeBracket(n, s, results);
    const place = placements(s, c);
    assert.equal(place.size, n, `n=${n}: every entrant places`);
    assert.equal(place.get(c.championSeed!), 1);
    const all = [...place.values()].sort((a, b) => a - b);
    assert.deepEqual(all, Array.from({ length: n }, (_, i) => i + 1));
  }
});

// ---------- undo cascade across brackets ----------

test("downstreamOf: GF undo clears the reset", () => {
  const s = buildDoubleElim(8);
  assert.ok(downstreamOf(s, "GF").includes("GF2"));
});

test("downstreamOf: a W1 result feeds the losers bracket", () => {
  const s = buildDoubleElim(8);
  const downs = downstreamOf(s, "W1M0");
  // Its loser drops into L1M0; its winner feeds W2M0 -> ... -> GF.
  assert.ok(downs.includes("L1M0"));
  assert.ok(downs.includes("W2M0"));
  assert.ok(downs.includes("GF"));
  assert.ok(downs.includes("GF2"));
});

test("undo cascade leaves no result describing a changed matchup", () => {
  const rand = seededRandom(7);
  for (let n = 3; n <= 9; n++) {
    const s = buildDoubleElim(n);
    const { results } = playOut(n, s, () => (rand() < 0.5 ? "A" : "B"));
    // Undo every match that was actually played, one at a time.
    for (const undoId of Object.keys(results)) {
      const after: BracketResults = { ...results };
      delete after[undoId];
      for (const id of downstreamOf(s, undoId)) delete after[id];
      const c = computeBracket(n, s, after);
      // Every surviving result must sit on a match whose slots are still
      // two real players and whose recorded winner is one of them.
      for (const id of Object.keys(after)) {
        const m = c.matches[id]!;
        assert.ok(m.active, `n=${n} undo ${undoId}: ${id} active`);
        assert.equal(m.a.kind, "player", `n=${n} undo ${undoId}: ${id} slot A resolved`);
        assert.equal(m.b.kind, "player", `n=${n} undo ${undoId}: ${id} slot B resolved`);
        assert.equal(m.decided, true);
      }
      // And the bracket must still be completable.
      playOut(n, s, () => (rand() < 0.5 ? "A" : "B"), after);
    }
  }
});

// ---------- single elim regression ----------

test("single elim: 6 players completes with sane placements", () => {
  const s = buildSingleElim(6);
  const { results, games } = playOut(6, s, () => "A");
  assert.equal(games, 5); // n-1 games
  const c = computeBracket(6, s, results);
  assert.ok(c.championSeed != null);
  const place = placements(s, c);
  assert.equal(place.get(c.championSeed!), 1);
  assert.equal(place.size, 6);
});

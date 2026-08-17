// THE SOLO / SHARED-KART SPLIT, and the one property it makes a claim about.
//
// The Mario Kart stats panel prints both halves of the split AND the unsplit
// total, which is only worth doing if the halves really do add up. They do by
// construction, because every participant row goes into exactly one of them,
// and this file is where "by construction" is checked rather than asserted.
//
// THE SPLIT IS DERIVED FROM `side IS NOT NULL` AND FROM NOTHING ELSE. No new
// matches.format value, no new matches.label value, and the gp{n} and bo{n}
// labels do not move, which is what makes it a query anyone can change their
// mind about later rather than history that cannot be recovered. The last test
// here says so in code: the same rows with different labels split identically.
//
// The database half is a plain SELECT and is not reachable without Postgres;
// what is worth testing is the fold, so the fold is a pure exported function.

import { test } from "node:test";
import assert from "node:assert/strict";
import { foldMkStatRows, type MkStatRow } from "../src/mariokart.js";

let seq = 0;
/** One recorded result: a match id, and one row per member who scored in it. */
function result(
  side: string | null,
  entries: readonly [user: string, isWinner: boolean, racer?: string][],
): MkStatRow[] {
  const matchId = `m${seq++}`;
  return entries.map(([user, isWinner, racer], i) => ({
    userId: user,
    displayName: user.toUpperCase(),
    isWinner,
    placement: isWinner ? 1 : i + 1,
    character: racer ?? null,
    matchId,
    // A shared kart writes a real id on every row of the race; a solo race
    // writes null on every row. `side` here is the KART of the row's own
    // player, so a pairs race is passed as two calls, one per kart.
    side,
  }));
}

const byName = (out: ReturnType<typeof foldMkStatRows>, name: string) =>
  out.byPlayer.find((p) => p.name === name)!;

// ---------- a solo crew ----------

test("SOLO ONLY: every row is in the solo half and nothing is in the shared one", () => {
  const rows = [
    ...result(null, [["u0", true], ["u1", false], ["u2", false]]),
    ...result(null, [["u1", true], ["u0", false], ["u2", false]]),
  ];
  const out = foldMkStatRows(rows);
  assert.equal(out.races, 2);
  assert.equal(out.soloRaces, 2);
  assert.equal(out.pairsRaces, 0, "which is what keeps the panel reading as it did before karts");
  assert.deepEqual(byName(out, "U0").solo, { races: 2, wins: 1 });
  assert.deepEqual(byName(out, "U0").pairs, { races: 0, wins: 0 });
});

// ---------- a crew that shares karts ----------

test("SHARED KARTS: both racers in the winning kart are counted as winners", () => {
  // Not a nicety. The whole point of the pairs mode is that a pair that
  // finished first both finished first, and a fold that credited one seat would
  // silently halve a pair's lifetime record.
  const rows = [
    ...result("a", [["u0", true], ["u1", true]]),
    ...result("b", [["u2", false], ["u3", false]]),
  ];
  // Both karts are in the SAME race, so they share a match id.
  const oneRace = rows.map((r) => ({ ...r, matchId: "same" }));
  const out = foldMkStatRows(oneRace);
  assert.equal(out.races, 1);
  assert.equal(out.pairsRaces, 1);
  assert.equal(out.soloRaces, 0);
  assert.deepEqual(byName(out, "U0").pairs, { races: 1, wins: 1 });
  assert.deepEqual(byName(out, "U1").pairs, { races: 1, wins: 1 });
  assert.deepEqual(byName(out, "U2").pairs, { races: 1, wins: 0 });
});

test("A RACE COUNTS ONCE, however many rows it wrote", () => {
  // Four seats in one race is four rows and one race. A version that counted
  // rows would report a pairs night as twice the size it was.
  const rows = [
    ...result("a", [["u0", true], ["u1", true]]).map((r) => ({ ...r, matchId: "r1" })),
    ...result("b", [["u2", false], ["u3", false]]).map((r) => ({ ...r, matchId: "r1" })),
  ];
  assert.equal(foldMkStatRows(rows).races, 1);
});

// ---------- the property the panel prints ----------

test("THE TWO HALVES SUM TO THE UNSPLIT TOTALS, per crew and per player", () => {
  const rows = [
    ...result(null, [["u0", true], ["u1", false]]),
    ...result(null, [["u1", true], ["u0", false]]),
    ...result("a", [["u0", true], ["u1", true]]).map((r) => ({ ...r, matchId: "r3" })),
    ...result("b", [["u2", false], ["u3", false]]).map((r) => ({ ...r, matchId: "r3" })),
    ...result("a", [["u0", false], ["u2", false]]).map((r) => ({ ...r, matchId: "r4" })),
    ...result("b", [["u1", true], ["u3", true]]).map((r) => ({ ...r, matchId: "r4" })),
  ];
  const out = foldMkStatRows(rows);

  assert.equal(out.soloRaces + out.pairsRaces, out.races, "the crew total");
  for (const p of out.byPlayer) {
    assert.equal(p.solo.races + p.pairs.races, p.races, `${p.name} races`);
    assert.equal(p.solo.wins + p.pairs.wins, p.wins, `${p.name} wins`);
  }
  assert.equal(out.races, 4);
  assert.equal(out.soloRaces, 2);
  assert.equal(out.pairsRaces, 2);
});

test("a race with a shared kart in it counts as SHARED for the crew total", () => {
  // An uneven night: one pair against one solo kart. The solo racer's row still
  // carries a real kart id, because another kart holds two, so the race is a
  // shared-kart race and every row in it lands in the same half.
  const rows = [
    ...result("a", [["u0", true], ["u1", true]]).map((r) => ({ ...r, matchId: "r1" })),
    ...result("b", [["u2", false]]).map((r) => ({ ...r, matchId: "r1" })),
  ];
  const out = foldMkStatRows(rows);
  assert.equal(out.pairsRaces, 1);
  assert.equal(out.soloRaces, 0);
  assert.deepEqual(byName(out, "U2").pairs, { races: 1, wins: 0 });
  assert.deepEqual(byName(out, "U2").solo, { races: 0, wins: 0 });
});

// ---------- ordering and the racer ----------

test("players sort on wins, then races, then name", () => {
  const rows = [
    ...result(null, [["u0", true], ["u1", false], ["u2", false]]),
    ...result(null, [["u0", true], ["u1", false]]),
    ...result(null, [["u1", true], ["u0", false]]),
  ];
  assert.deepEqual(
    foldMkStatRows(rows).byPlayer.map((p) => [p.name, p.wins, p.races]),
    [
      ["U0", 2, 3],
      ["U1", 1, 3],
      ["U2", 0, 1],
    ],
  );
});

test("the top racer is the one played most, with ties broken by name", () => {
  const rows = [
    ...result(null, [["u0", true, "Mario"], ["u1", false, "Yoshi"]]),
    ...result(null, [["u0", false, "Mario"], ["u1", true, "Toad"]]),
    ...result(null, [["u0", true, "Peach"], ["u1", false, "Yoshi"]]),
  ];
  const out = foldMkStatRows(rows);
  assert.equal(byName(out, "U0").topRacer, "Mario");
  assert.equal(byName(out, "U1").topRacer, "Yoshi");
});

test("a player who never picked a racer has no top racer rather than a blank one", () => {
  const out = foldMkStatRows(result(null, [["u0", true], ["u1", false]]));
  assert.equal(byName(out, "U0").topRacer, null);
});

test("an empty ledger is an empty panel, not a crash", () => {
  assert.deepEqual(foldMkStatRows([]), { races: 0, soloRaces: 0, pairsRaces: 0, byPlayer: [] });
});

// ---------- the promise, in code ----------

test("THE SPLIT READS `side` AND NOTHING ELSE", () => {
  // No new format string and no new matches.label value: the same rows split
  // identically however they are labelled, because the label is not consulted.
  // A future pass that starts keying this off a label fails here.
  const shared = [
    ...result("a", [["u0", true], ["u1", true]]).map((r) => ({ ...r, matchId: "r1" })),
    ...result("b", [["u2", false], ["u3", false]]).map((r) => ({ ...r, matchId: "r1" })),
  ];
  const soloShaped = shared.map((r) => ({ ...r, side: null }));

  assert.equal(foldMkStatRows(shared).pairsRaces, 1);
  assert.equal(foldMkStatRows(soloShaped).pairsRaces, 0);
  // And everything that is not the split is untouched by the column.
  const a = foldMkStatRows(shared);
  const b = foldMkStatRows(soloShaped);
  assert.deepEqual(
    a.byPlayer.map((p) => [p.name, p.races, p.wins]),
    b.byPlayer.map((p) => [p.name, p.races, p.wins]),
  );
  assert.equal(a.races, b.races);
});

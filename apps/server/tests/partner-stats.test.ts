// The partner-stats derivations: best, most played with, worst.
//
// `partnersFor` is one SQL self-join plus this arithmetic, and the split is
// deliberate. The join is what needs a database and is therefore checked by
// reading it; `derivePartners` is what is easy to get quietly wrong (an
// off-by-one on the floor, a tiebreak that makes the answer depend on row
// order) and is therefore pure and tested here with no database near it.
//
// WHAT A WRONG ANSWER COSTS: nothing errors. Somebody's profile just says the
// wrong person is who they win with, forever, on a screen people screenshot.
// That is the same reason rivalry.test.ts exists.

import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePartners, PARTNER_MIN_GAMES, type PartnerRow } from "../src/stats.js";

const p = (displayName: string, played: number, wins: number): PartnerRow => ({
  userId: `u-${displayName.toLowerCase()}`,
  displayName,
  played,
  wins,
  winRate: played ? wins / played : 0,
});

test("the floor is 3 and it is the constant, not a literal", () => {
  assert.equal(PARTNER_MIN_GAMES, 3);
});

// ---------- most played with ----------

test("most played with is the highest count, with NO floor", () => {
  // A count of one is honestly a count of one, so this view is allowed to
  // report a single game. It is the rates that need protecting, not the count.
  const out = derivePartners([p("Ana", 1, 1)]);
  assert.equal(out.mostPlayedWith?.displayName, "Ana");
  assert.equal(out.mostPlayedWith?.played, 1);
});

test("most played with beats a better win rate", () => {
  const out = derivePartners([p("Ana", 12, 4), p("Ben", 4, 4)]);
  assert.equal(out.mostPlayedWith?.displayName, "Ana");
  // ...and Ben is still the best partner, which is the point of having both.
  assert.equal(out.bestPartner?.displayName, "Ben");
});

// ---------- the floor ----------

test("a partner UNDER the floor is never best or worst, but is still listed", () => {
  // The exact case from the manual test list: two games together.
  const out = derivePartners([p("Ana", 2, 2), p("Ben", 5, 3)]);
  assert.equal(out.bestPartner?.displayName, "Ben", "Ana is 100% over two games and must not win this");
  assert.equal(out.partners.length, 2, "still on the full list, which is what prints the sample");
  assert.equal(out.partners.find((x) => x.displayName === "Ana")?.played, 2);
});

test("exactly at the floor is eligible: the test is >=, not >", () => {
  const out = derivePartners([p("Ana", 3, 3), p("Ben", 9, 3)]);
  assert.equal(out.bestPartner?.displayName, "Ana");
  assert.equal(out.worstPartner?.displayName, "Ben");
});

test("everyone under the floor means no best and no worst, but a most-played-with", () => {
  const out = derivePartners([p("Ana", 2, 2), p("Ben", 1, 0)]);
  assert.equal(out.bestPartner, null);
  assert.equal(out.worstPartner, null);
  assert.equal(out.mostPlayedWith?.displayName, "Ana");
});

// ---------- best and worst ----------

test("best is the highest rate over the floor, worst the lowest", () => {
  const out = derivePartners([p("Ana", 10, 8), p("Ben", 10, 5), p("Cal", 10, 1)]);
  assert.equal(out.bestPartner?.displayName, "Ana");
  assert.equal(out.worstPartner?.displayName, "Cal");
});

test("a tie on rate goes to the bigger sample, in BOTH directions", () => {
  // Two people you win 50% with: twelve games together is the more honest
  // answer than three, whether the label reads best or worst.
  const tied = [p("Ana", 4, 2), p("Ben", 12, 6), p("Cal", 3, 3), p("Dee", 8, 8)];
  const out = derivePartners(tied);
  assert.equal(out.bestPartner?.displayName, "Dee", "100% over 8 beats 100% over 3");
  assert.equal(out.worstPartner?.displayName, "Ben", "50% over 12 beats 50% over 4");
});

test("ONE eligible partner is not both your best and your worst", () => {
  // Printing the same person on two lines reads as a bug rather than as a
  // small sample, so worst is withheld until there is somebody to be worse
  // than. Best still stands: "who you win with" is answerable with one name.
  const out = derivePartners([p("Ana", 6, 4), p("Ben", 2, 0)]);
  assert.equal(out.bestPartner?.displayName, "Ana");
  assert.equal(out.worstPartner, null);
});

// ---------- the empty case, which is today's common one ----------

test("no partners at all is empty and null, never a throw", () => {
  // Most crews have very few non-null side rows: only doubles ping pong,
  // Mario Kart pairs, Casino Run, Smash pairs and bracket team entrants write
  // them. A profile with none is the DEFAULT, not an edge case.
  const out = derivePartners([]);
  assert.deepEqual(out.partners, []);
  assert.equal(out.mostPlayedWith, null);
  assert.equal(out.bestPartner, null);
  assert.equal(out.worstPartner, null);
  assert.equal(out.minGames, 3);
});

test("a partner you have never won with is a 0 rate, not a missing one", () => {
  const out = derivePartners([p("Ana", 4, 0), p("Ben", 4, 2)]);
  assert.equal(out.worstPartner?.displayName, "Ana");
  assert.equal(out.worstPartner?.winRate, 0);
});

// ---------- ordering ----------

test("the sort is total, so the same rows always give the same answer", () => {
  // Postgres is under no obligation to return groups in a stable order, so
  // two equally-played partners must not be able to swap "most played with"
  // between two requests. Same rows, two orders, one answer.
  const rows = [p("Cal", 5, 2), p("Ana", 5, 2), p("Ben", 5, 2)];
  const a = derivePartners(rows).partners.map((x) => x.displayName);
  const b = derivePartners([...rows].reverse()).partners.map((x) => x.displayName);
  assert.deepEqual(a, ["Ana", "Ben", "Cal"]);
  assert.deepEqual(a, b);
});

test("the full list comes back sorted by games together, for a client that wants more than three rows", () => {
  const out = derivePartners([p("Ana", 2, 1), p("Ben", 9, 5), p("Cal", 5, 5)]);
  assert.deepEqual(
    out.partners.map((x) => [x.displayName, x.played]),
    [
      ["Ben", 9],
      ["Cal", 5],
      ["Ana", 2],
    ],
  );
});

test("derivePartners does not mutate the rows it is given", () => {
  const rows = [p("Cal", 1, 0), p("Ana", 9, 9)];
  const before = rows.map((x) => x.displayName);
  derivePartners(rows);
  assert.deepEqual(rows.map((x) => x.displayName), before);
});

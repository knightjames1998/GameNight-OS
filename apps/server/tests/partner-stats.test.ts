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

// ---------- what a `side` actually MEANS, added 2026-08-22 ----------
//
// THE BUG THIS EXISTS TO PREVENT SHIPPED ONCE AND WAS CAUGHT BY REVIEW, not by
// a test, which is why there are tests now. `side` means THREE different things
// in this ledger and only one of them is "who you win with":
//
//   Ping Pong doubles        a competitive TEAM              2 sides
//   Mario Kart Double Dash   a competitive TEAM              2 to 8 sides
//   Bracket team entrants    a competitive TEAM              2 per match
//   Casino Run               ONE co-op team, whole table     1 side
//   Social Deduction         a FACTION, mostly dealt         2+ sides
//
// Counted naively, one eight-person Casino Run yields 28 partner pairings with
// identical outcomes and one twelve-player Werewolf yields 36 villager pairings
// PER GAME, so "who you win with" silently becomes "who else turns up to
// Werewolf and Casino Run" and doubles ping pong disappears into the noise.
// Nothing errors. That is the exact silent-failure shape this repo keeps a
// decision log for.
//
// These assert against the SOURCE, the same way bracket-tv-fit.test.ts asserts
// that TvPage actually emits its data attribute: the failure being guarded
// against is a filter being deleted, and a filter that is gone throws nothing.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SESSION_PACKS } from "@gamenight/shared";

const statsSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "stats.ts"),
  "utf8",
);

test("the co-op exclusion is by SHAPE, so the next co-op pack is covered without being named", () => {
  // "keep this match only if somebody on it was NOT on my side". Casino Run
  // puts the whole table on one side, so nothing satisfies it and the match
  // drops; doubles ping pong has opponents, so it stays. Pandemic on Board
  // Game is already in FEATURES and will be caught by this without an edit.
  assert.match(statsSrc, /exists \(/, "the co-op shape filter is gone from partnersFor");
  assert.match(
    statsSrc,
    /o\.side is distinct from/,
    "the shape filter must use `is distinct from`: a null side on the other row is still not-my-side, and `null <> 'a'` is null",
  );
});

test("the faction exclusion is by PACK, and the key comes off the registry", () => {
  // Social Deduction's factions are genuinely multi-side, so the shape filter
  // above cannot see them. This one has to name the pack, and naming it via
  // SESSION_PACKS means renaming the pack moves the filter with it.
  assert.match(statsSrc, /SESSION_PACKS\.deduction\.ledger/, "the deduction ledger key is typed rather than taken from the registry");
  assert.doesNotMatch(
    statsSrc.slice(statsSrc.indexOf("async function partnersFor")),
    /"deduction"/,
    "partnersFor contains a hardcoded pack string",
  );
  assert.equal(SESSION_PACKS.deduction.ledger, "deduction");
});

test("BOTH EXCLUSIONS DEFAULT TO OFF, and flipping either is one visible line", () => {
  // The decision is "headline partner figures count competitive team sides
  // only". It is a default rather than a law: these constants exist so that
  // changing it is a one-line, reviewable edit rather than a rewrite, and this
  // test exists so it cannot be changed silently.
  assert.match(statsSrc, /const PARTNER_COUNTS_COOP_RUNS = false;/);
  assert.match(statsSrc, /const PARTNER_COUNTS_FACTION_GAMES = false;/);
});

test("the exclusions sit in partnersFor and nowhere near the shared aggregation", () => {
  // The whole safety argument for this feature is that feedAgg / finishAgg /
  // ResultRow / resultCols are untouched, so the crew leaderboard cannot move.
  // A filter that leaked into feedAgg would change every player's lifetime
  // totals, which is a much larger blast radius than this feature has.
  const agg = statsSrc.slice(statsSrc.indexOf("export function feedAgg"), statsSrc.indexOf("type Db ="));
  assert.doesNotMatch(agg, /PARTNER_COUNTS_/, "a partner exclusion has leaked into the aggregation block");
  assert.doesNotMatch(agg, /is distinct from/);
});

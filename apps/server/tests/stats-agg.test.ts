// THE SHARED AGGREGATION, pinned. newAgg / feedAgg / finishAgg in stats.ts.
//
// WHY THIS IS THE HIGHEST-VALUE TEST IN THE REPOSITORY. Five surfaces read this
// one implementation: the crew leaderboard, its per-game panels, a member
// profile, /me/stats, a friend's profile and both sides of a rivalry. They were
// unified onto it precisely so two screens could not disagree about the same
// player, which means a change here is a change to every one of them at once,
// and the failure mode is not an error. It is a number that is quietly wrong on
// six screens, consistently, forever, which is the hardest kind to notice
// because the screens still agree with each other.
//
// WHAT WAS ALREADY COVERED, so this file does not repeat it. series-rows.test.ts
// pins the Smashdown series-summary exclusion from both directions and is the
// reason feedAgg is exported at all. rivalry.test.ts pins meetingOutcome and
// meetingStreaks, which is where `side` and the fourth `together` outcome live.
// pack-runtime.test.ts pins participantRows, which is where guests are skipped
// and counted. This file is everything else: the tallies themselves.
//
// WHAT IS DELIBERATELY OUT OF SCOPE. finishAggDeep costs two queries
// (countLastPlace, resolveBestNight) and cannot be reached without Postgres.
// finishAgg is sync and query-free, so it is tested directly and nothing is
// stubbed. The four placement BUCKETS are computed by feedAgg but only rendered
// through finishAggDeep, so they are asserted on the Agg itself, which is the
// value feedAgg actually writes.
//
// A NOTE ON WHAT "A TIE" MEANS HERE. An Agg is ONE player's, so a tie is not a
// relation between two rows in it: it is a single row whose placement somebody
// else also holds. From this side that is just a placement, which is exactly
// why the co-placement cases below are worth pinning rather than obvious.

import { test } from "node:test";
import assert from "node:assert/strict";
import { newAgg, feedAgg, finishAgg, type ResultRow } from "../src/stats.js";
import { result } from "./result-fixture.js";

/** Feed a list of rows into a fresh aggregate. */
function agg(rows: ResultRow[]) {
  const a = newAgg();
  for (const r of rows) feedAgg(a, r);
  return a;
}

const won = (over: Partial<ResultRow> = {}) => result({ isWinner: true, placement: 1, ...over });
const lost = (over: Partial<ResultRow> = {}) => result({ isWinner: false, placement: 2, ...over });

// ---------- nothing at all ----------

test("an empty aggregate is zeroes and nulls, never NaN", () => {
  const out = finishAgg(newAgg());
  assert.equal(out.played, 0);
  assert.equal(out.wins, 0);
  // Zero, not NaN: 0/0 would render as "NaN%" on the Home card and on every
  // profile of anybody who has never played.
  assert.equal(out.winRate, 0);
  // Null rather than 0, because "no average" and "averaged first place" are
  // opposite claims and a 0 here would draw the flattering one.
  assert.equal(out.avgPlacement, null);
  assert.equal(out.best, null);
  assert.deepEqual(out.byGame, []);
  assert.equal(out.nightsPlayed, 0);
  assert.deepEqual(out.series, { wins: 0, played: 0 });
  assert.equal(out.characters.distinctCharacters, 0);
  assert.equal(out.characters.mostPlayed, null);
  assert.equal(out.characters.best, null);
  assert.deepEqual(out.form.last5, []);
  assert.equal(out.form.tracked, 0);
  assert.equal(out.form.currentStreak, 0);
});

// ---------- wins, losses and the rate ----------

test("wins and losses tally, and the rate is wins over games PLAYED", () => {
  const out = finishAgg(agg([won(), won(), lost(), lost(), lost()]));
  assert.equal(out.played, 5);
  assert.equal(out.wins, 2);
  assert.equal(out.winRate, 2 / 5);
});

test("a win with NO placement still counts as a win and a game", () => {
  // Packs that do not rank (Beerio's own reporting, the cash group) write
  // isWinner with a null placement. Those must reach played and wins, and must
  // NOT reach anything placement-shaped.
  const a = agg([won({ placement: null }), lost({ placement: null })]);
  const out = finishAgg(a);
  assert.equal(out.played, 2);
  assert.equal(out.wins, 1);
  assert.equal(out.best, null, "an unranked win is not a first place");
  assert.equal(out.avgPlacement, null);
  assert.equal(a.placed, 0);
  assert.equal(a.firsts + a.seconds + a.thirds + a.fourthPlus, 0);
});

test("a placement WITHOUT isWinner still fills its bucket", () => {
  // A co-placement can flag one player and not another. The buckets describe
  // where you finished, not whether the pack called you a winner.
  const a = agg([lost({ placement: 1 })]);
  assert.equal(a.firsts, 1);
  assert.equal(a.wins, 0);
  assert.equal(finishAgg(a).best, 1);
});

// ---------- placements ----------

test("best is the LOWEST placement ever reached, not the most recent", () => {
  const out = finishAgg(agg([lost({ placement: 4 }), won({ placement: 1 }), lost({ placement: 3 })]));
  assert.equal(out.best, 1);
});

test("avgPlacement divides by RANKED results, not by games played", () => {
  // Two ranked (2 and 4) plus one unranked. The average is 3, not 2.
  const out = finishAgg(agg([lost({ placement: 2 }), lost({ placement: 4 }), won({ placement: null })]));
  assert.equal(out.played, 3);
  assert.equal(out.avgPlacement, 3);
});

test("the four buckets are 1st, 2nd, 3rd and FOURTH-OR-WORSE", () => {
  const a = agg([
    won({ placement: 1 }),
    lost({ placement: 2 }),
    lost({ placement: 3 }),
    lost({ placement: 4 }),
    lost({ placement: 8 }),
  ]);
  assert.equal(a.firsts, 1);
  assert.equal(a.seconds, 1);
  assert.equal(a.thirds, 1);
  assert.equal(a.fourthPlus, 2, "8th is fourth-or-worse, not its own bucket");
  assert.equal(a.placed, 5);
});

test("AN UNRANKED RESULT IS IN NONE OF THE FOUR, not silently last", () => {
  // The whole reason the four counts exist separately from `played`. Folding a
  // null placement into fourthPlus would make every cash night look like a last
  // place finish, for everybody, including whoever won it.
  const a = agg([won({ placement: null }), lost({ placement: null }), won({ placement: 1 })]);
  assert.equal(a.played, 3);
  assert.equal(a.placed, 1);
  assert.equal(a.firsts, 1);
  assert.equal(a.seconds + a.thirds + a.fourthPlus, 0);
});

test("placement 0 is treated as unranked, exactly like null", () => {
  // feedAgg reads `r.placement ?? 0` and then tests `>= 1`, so a zero and a
  // null are the same answer. Pinned because the two branches look different in
  // the source and are not.
  const a = agg([won({ placement: 0 })]);
  assert.equal(a.played, 1);
  assert.equal(a.placed, 0);
  assert.equal(a.best, null);
});

// ---------- a field of one ----------

test("a single-player result is a game, a win and a first place", () => {
  // Quick play with nobody else, or a night where one person recorded a solo
  // run. It is still a played game; the ledger has no concept of a field size.
  const out = finishAgg(agg([won()]));
  assert.equal(out.played, 1);
  assert.equal(out.wins, 1);
  assert.equal(out.winRate, 1);
  assert.equal(out.best, 1);
  assert.equal(out.avgPlacement, 1);
  assert.equal(out.form.currentStreak, 1);
});

// ---------- per game ----------

test("byGame buckets on the game NAME and counts wins within each", () => {
  const out = finishAgg(
    agg([
      won({ gameName: "Smash Bros" }),
      lost({ gameName: "Smash Bros" }),
      won({ gameName: "Mario Kart" }),
      won({ gameName: "Smash Bros" }),
    ]),
  );
  assert.deepEqual(out.byGame, [
    { name: "Smash Bros", played: 3, wins: 2 },
    { name: "Mario Kart", played: 1, wins: 1 },
  ]);
});

test("a result with no game name buckets under Unknown rather than vanishing", () => {
  // matches.gameId is nullable and the join is a LEFT join, so this is
  // reachable. Dropping the row would make played disagree with the sum of
  // byGame, which is the kind of small inconsistency nobody ever tracks down.
  const out = finishAgg(agg([won({ gameName: null })]));
  assert.deepEqual(out.byGame, [{ name: "Unknown", played: 1, wins: 1 }]);
  assert.equal(out.played, 1);
});

test("byGame orders by games played, and has NO secondary tiebreak", () => {
  // Characterizing, not endorsing. finishAgg sorts byGame on `played` alone
  // while finishCharacters sorts on three keys, so an equal-played pair here
  // keeps insertion order (Array.sort is stable). If a later pass unifies the
  // two comparators that is a real output change and this test should be the
  // thing that says so.
  const out = finishAgg(agg([won({ gameName: "Craps" }), won({ gameName: "Blackjack" })]));
  assert.deepEqual(out.byGame.map((g) => g.name), ["Craps", "Blackjack"]);
});

// ---------- per character ----------

test("byCharacter unifies on NAME across different games", () => {
  // The standing rule: a character is one line even when played under two
  // titles, because "good with Fox" is a claim about a person, not about a box.
  const out = finishAgg(
    agg([
      won({ character: "Fox", gameName: "Smash Bros" }),
      lost({ character: "Fox", gameName: "Smash Ultimate" }),
    ]),
  );
  assert.equal(out.characters.distinctCharacters, 1);
  assert.deepEqual(out.characters.byCharacter[0], {
    name: "Fox",
    played: 2,
    wins: 1,
    winRate: 0.5,
    bestPlacement: 1,
    avgPlacement: 1.5,
  });
});

test("a null, empty or whitespace character is not a character", () => {
  // Every pack without characters writes null here. An empty string is what a
  // client sends when somebody clears the field, and " " is what it sends when
  // they type a space, so all three have to land in the same place.
  const out = finishAgg(
    agg([won({ character: null }), won({ character: "" }), won({ character: "   " })]),
  );
  assert.equal(out.characters.distinctCharacters, 0);
  assert.equal(out.characters.mostPlayed, null);
  assert.equal(out.played, 3, "the games themselves still count");
});

test("a character name is TRIMMED before it is keyed", () => {
  // Otherwise "Fox" and "Fox " are two mains.
  const out = finishAgg(agg([won({ character: "Fox" }), won({ character: " Fox " })]));
  assert.equal(out.characters.distinctCharacters, 1);
  assert.equal(out.characters.byCharacter[0]!.played, 2);
});

test("mostPlayed is the character with the most games, ties going to more wins", () => {
  const out = finishAgg(
    agg([
      won({ character: "Fox" }),
      lost({ character: "Fox" }),
      won({ character: "Kirby" }),
      won({ character: "Kirby" }),
    ]),
  );
  assert.equal(out.characters.mostPlayed, "Kirby", "same games, more wins");
});

test("BEST CHARACTER NEEDS A FLOOR OF GAMES, so one lucky win cannot win it", () => {
  const a = newAgg();
  const floor = finishAgg(a).characters.minGamesForBest;
  assert.ok(floor >= 2, "a floor of 0 or 1 would defeat the point of having one");

  // A perfect record on a single game, against a real main just under 100%.
  feedAgg(a, won({ character: "Jigglypuff" }));
  for (let i = 0; i < floor; i++) feedAgg(a, won({ character: "Fox" }));
  feedAgg(a, lost({ character: "Fox" }));

  const out = finishAgg(a);
  assert.equal(out.characters.best, "Fox");
  assert.equal(out.characters.mostPlayed, "Fox");
});

test("nobody clears the floor means no best character, not the least bad one", () => {
  const out = finishAgg(agg([won({ character: "Fox" }), won({ character: "Kirby" })]));
  assert.equal(out.characters.best, null);
  assert.equal(out.characters.mostPlayed, "Fox", "most-played has no floor; best does");
});

test("a character's own placement fields ignore its unranked results", () => {
  const out = finishAgg(
    agg([
      won({ character: "Fox", placement: 1 }),
      lost({ character: "Fox", placement: 3 }),
      won({ character: "Fox", placement: null }),
    ]),
  );
  const fox = out.characters.byCharacter[0]!;
  assert.equal(fox.played, 3, "the unranked game is still a game with Fox");
  assert.equal(fox.avgPlacement, 2, "but it is not a placement of 0");
  assert.equal(fox.bestPlacement, 1);
});

// ---------- nights ----------

test("nightsPlayed counts DISTINCT events, however many games each held", () => {
  const out = finishAgg(
    agg([
      won({ eventId: "night-a" }),
      won({ eventId: "night-a" }),
      lost({ eventId: "night-a" }),
      won({ eventId: "night-b" }),
    ]),
  );
  assert.equal(out.played, 4);
  assert.equal(out.nightsPlayed, 2);
});

test("a result with no event does not invent a night", () => {
  // matches.eventId is nullable. Counting a null as a night would give every
  // eventless row its own entry and inflate the count without limit.
  const a = agg([won({ eventId: null }), won({ eventId: "night-a" })]);
  assert.equal(finishAgg(a).nightsPlayed, 1);
  assert.equal(a.byEvent.size, 1);
  assert.deepEqual(a.byEvent.get("night-a"), { played: 1, wins: 1 });
});

test("byEvent records the wins per night, which is what best-night is picked on", () => {
  const a = agg([
    won({ eventId: "night-a" }),
    lost({ eventId: "night-a" }),
    won({ eventId: "night-b" }),
    won({ eventId: "night-b" }),
  ]);
  assert.deepEqual(a.byEvent.get("night-a"), { played: 2, wins: 1 });
  assert.deepEqual(a.byEvent.get("night-b"), { played: 2, wins: 2 });
});

// ---------- form ----------

test("the current streak is the run ENDING at the newest result", () => {
  const out = finishAgg(agg([won(), won(), lost(), won(), won(), won()]));
  assert.equal(out.form.currentStreak, 3);
  assert.equal(out.form.longestStreak, 3);
  assert.equal(out.form.currentLossStreak, 0);
});

test("the longest streak is a high-water mark the current one can be below", () => {
  const out = finishAgg(agg([won(), won(), won(), won(), lost(), won()]));
  assert.equal(out.form.longestStreak, 4);
  assert.equal(out.form.currentStreak, 1);
});

test("a LOSS STREAK is 'did not win', which is most of a four-player field", () => {
  const out = finishAgg(agg([won(), lost(), lost(), lost()]));
  assert.equal(out.form.currentLossStreak, 3);
  assert.equal(out.form.longestLossStreak, 3);
  assert.equal(out.form.currentStreak, 0);
});

test("last5 is the five newest, NEWEST FIRST", () => {
  const rows = [1, 2, 3, 4, 5, 6, 7].map((n) =>
    result({ placement: n, isWinner: n === 1, playedAt: new Date(2026, 6, 28, 20, n) }),
  );
  const out = finishAgg(agg(rows));
  assert.deepEqual(out.form.last5.map((f) => f.placement), [7, 6, 5, 4, 3]);
  assert.equal(out.form.tracked, 7);
});

test("AN UNDATED RESULT IS LEFT OUT OF THE ORDER RATHER THAN GUESSED AT", () => {
  // matches.playedAt is NOT NULL today, so this is the legacy-row path. A row
  // with no time cannot be placed in a sequence, and putting it at either end
  // would invent a streak that did not happen. `tracked` is how the client
  // tells "no wins yet" apart from "nothing timestamped yet".
  const a = agg([won({ playedAt: null }), won(), won()]);
  const out = finishAgg(a);
  assert.equal(out.played, 3, "it is still a game played");
  assert.equal(out.form.tracked, 2, "but only two could be ordered");
  assert.equal(out.form.currentStreak, 2);
  assert.equal(out.form.last5.length, 2);
});

test("form reads results in TIME order, not the order the rows arrived", () => {
  // The query has no ORDER BY, so arrival order is whatever Postgres returns.
  // A streak computed on that would change between two identical requests.
  const early = result({ isWinner: false, placement: 2, playedAt: new Date(2026, 6, 28, 20, 1) });
  const late = result({ isWinner: true, placement: 1, playedAt: new Date(2026, 6, 28, 20, 9) });
  const out = finishAgg(agg([late, early]));
  assert.equal(out.form.currentStreak, 1, "the WIN is the newest, whatever order it arrived in");
  assert.deepEqual(out.form.last5.map((f) => f.isWinner), [true, false]);
});

// ---------- the side-blindness rule ----------

test("FEEDAGG IS BLIND TO `side`, and that is deliberate rather than an oversight", () => {
  // stats.ts says it in prose at the rivalry query: a teammate game is still a
  // game you played, so it belongs in both players' lifetime totals exactly as
  // it does today. What `side` changes is only how two people are recorded
  // AGAINST EACH OTHER, which is meetingOutcome's job and rivalry.test.ts's.
  //
  // ResultRow has no `side` field at all, which is the structural half of that
  // guarantee. This pins the behavioural half: a co-op row, which is what
  // Casino Run writes for everybody on the run, is an ordinary played game.
  const coop = { ...won(), side: "run" } as ResultRow;
  const plain = { ...won() } as ResultRow;

  const withSide = finishAgg(agg([coop]));
  const withoutSide = finishAgg(agg([plain]));

  assert.equal(withSide.played, 1);
  assert.equal(withSide.wins, 1);
  assert.deepEqual(
    { ...withSide, form: null, byGame: null },
    { ...withoutSide, form: null, byGame: null },
    "an identical row with a side must aggregate identically",
  );
});

test("every player on a co-op run gets the same totals, because the rows are the same", () => {
  // Casino Run writes an IDENTICAL row for everybody: same placement, same
  // isWinner, same side. Two players' aggregates must therefore be equal, which
  // is the property that made the old rivalry code score them as a mutual draw.
  const shared = () => won({ placement: 1, character: null, eventId: "run-night" });
  const me = finishAgg(agg([shared()]));
  const them = finishAgg(agg([shared()]));
  assert.equal(me.played, them.played);
  assert.equal(me.wins, them.wins);
  assert.equal(me.winRate, them.winRate);
  assert.equal(me.nightsPlayed, them.nightsPlayed);
});

// ---------- the whole thing at once ----------

test("a realistic mixed history adds up across every surface", () => {
  // One crew night: three Smash games with Fox, two Mario Kart races unranked,
  // and a second night with one more Smash game.
  const out = finishAgg(
    agg([
      won({ gameName: "Smash Bros", character: "Fox", placement: 1, eventId: "n1" }),
      lost({ gameName: "Smash Bros", character: "Fox", placement: 3, eventId: "n1" }),
      lost({ gameName: "Smash Bros", character: "Kirby", placement: 2, eventId: "n1" }),
      won({ gameName: "Mario Kart", character: null, placement: null, eventId: "n1" }),
      lost({ gameName: "Mario Kart", character: null, placement: null, eventId: "n1" }),
      won({ gameName: "Smash Bros", character: "Fox", placement: 1, eventId: "n2" }),
    ]),
  );

  assert.equal(out.played, 6);
  assert.equal(out.wins, 3);
  assert.equal(out.winRate, 0.5);
  assert.equal(out.nightsPlayed, 2);
  assert.equal(out.best, 1);
  // Ranked results are 1, 3, 2, 1. The two unranked races are not in it.
  assert.equal(out.avgPlacement, 7 / 4);
  assert.deepEqual(out.byGame, [
    { name: "Smash Bros", played: 4, wins: 2 },
    { name: "Mario Kart", played: 2, wins: 1 },
  ]);
  assert.equal(out.characters.distinctCharacters, 2);
  assert.equal(out.characters.mostPlayed, "Fox");
  assert.equal(out.form.tracked, 6);
  assert.deepEqual(out.series, { wins: 0, played: 0 });
});

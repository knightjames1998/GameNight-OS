// The best-of-N series primitive, which Smash and Mario Kart both run on.
//
// It had no test file of its own. What it decides is small and entirely silent
// when wrong: which of two people won a set, how many games each took off the
// other, and whether an abandoned set counts at all. None of those throw, and
// all of them are written straight into the ledger, where a best-of series is
// ONE matches row with a winner at placement 1 and a loser at 2. A series
// awarded to the wrong side is a permanent wrong result that looks exactly like
// a right one.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seriesNeededWins,
  seriesGameWins,
  newSeries,
  recordSeriesGame,
  seriesGameTally,
  finalizeSeries,
  summarizeSeriesLog,
  type Series,
  type SeriesBestOf,
} from "../src/index.js";

const A = "pA";
const B = "pB";

/** A live series with the given game winners already recorded. */
function played(bestOf: SeriesBestOf, winners: string[]): Series {
  const s = newSeries(A, B)!;
  for (const w of winners) recordSeriesGame(s, bestOf, w);
  return s;
}

// ---------- the needed-wins table ----------

test("a best-of-N needs a strict majority of N", () => {
  assert.equal(seriesNeededWins(3), 2);
  assert.equal(seriesNeededWins(5), 3);
  assert.equal(seriesNeededWins(7), 4);
});

// ---------- creating one ----------

test("a series needs two DISTINCT slots", () => {
  assert.ok(newSeries(A, B));
  assert.equal(newSeries(A, A), null, "somebody cannot play themselves");
  assert.equal(newSeries(A, null), null);
  assert.equal(newSeries(null, B), null);
  assert.equal(newSeries(null, null), null);
  // Empty string is falsy and is what an unfilled slot serializes to.
  assert.equal(newSeries("", B), null);
});

test("a fresh series is live, unplayed and has no idx yet", () => {
  const s = newSeries(A, B)!;
  assert.equal(s.idx, -1, "-1 is 'live'; the caller assigns idx when it completes");
  assert.deepEqual(s.games, []);
  assert.equal(s.winnerId, null);
  assert.equal(s.at, null);
});

// ---------- recording games ----------

test("a bo3 completes at two wins, not at three games", () => {
  const s = newSeries(A, B)!;
  assert.deepEqual(recordSeriesGame(s, 3, A), { completed: false });
  assert.deepEqual(recordSeriesGame(s, 3, A), { completed: true });
  assert.equal(s.winnerId, A);
  assert.equal(s.games.length, 2, "a decided series does not play a dead rubber");
  assert.ok(s.at, "completion stamps a time");
});

test("a bo5 that goes the distance is decided by the fifth game", () => {
  const s = played(5, [A, B, A, B]);
  assert.equal(s.winnerId, null, "2-2 is not decided");
  assert.deepEqual(recordSeriesGame(s, 5, B), { completed: true });
  assert.equal(s.winnerId, B);
});

test("A GAME FOR SOMEBODY NOT IN THE SERIES IS REFUSED, not recorded", () => {
  // The slot ids come off a roster the client sends back, so a stale client can
  // name a player who has since been removed. Pushing that game would leave a
  // series whose tally does not add up to its game count.
  const s = newSeries(A, B)!;
  assert.deepEqual(recordSeriesGame(s, 3, "someone-else"), { completed: false });
  assert.deepEqual(s.games, []);
});

test("recording after completion cannot flip the winner", () => {
  const s = played(3, [A, A]);
  assert.equal(s.winnerId, A);
  recordSeriesGame(s, 3, B);
  recordSeriesGame(s, 3, B);
  assert.equal(s.winnerId, A, "the series was already won; later taps do not re-award it");
});

// ---------- the tallies ----------

test("game wins count per side and ignore anything else", () => {
  const s = played(7, [A, A, B]);
  assert.deepEqual(seriesGameWins(s), { a: 2, b: 1 });
});

test("the per-slot tally gives BOTH sides a played count for every game", () => {
  // This is what rides on match_participants.meta as the lifetime game-win
  // stat, so a loser must show games played rather than nothing at all.
  const s = played(5, [A, A, B]);
  const tally = seriesGameTally(s);
  assert.deepEqual(tally.get(A), { wins: 2, played: 3 });
  assert.deepEqual(tally.get(B), { wins: 1, played: 3 });
});

test("an unplayed series tallies nothing rather than zero rows", () => {
  assert.equal(seriesGameTally(newSeries(A, B)!).size, 0);
});

// ---------- calling the night ----------

test("finalizing an in-progress series awards it to whoever LEADS", () => {
  const s = played(7, [A, B, A]);
  assert.equal(finalizeSeries(s), true);
  assert.equal(s.winnerId, A);
  assert.ok(s.at);
});

test("AN EXACT GAME TIE HAS NO FAIR WINNER AND STAYS UNRECORDED", () => {
  // The alternative is inventing a tiebreak the night never played. An
  // unfinalized series is simply not materialized, which is the honest answer.
  const s = played(5, [A, B]);
  assert.equal(finalizeSeries(s), false);
  assert.equal(s.winnerId, null);
  assert.equal(s.at, null);
});

test("finalizing nothing is false rather than a crash", () => {
  assert.equal(finalizeSeries(null), false);
  assert.equal(finalizeSeries(newSeries(A, B)!), false, "no games played is not a 0-0 win");
});

// ---------- the night's standings ----------

test("standings split SERIES wins from GAME wins, which is the sets-vs-games rule", () => {
  const log = [
    { ...played(3, [A, A]), idx: 0 },
    { ...played(3, [B, A, A]), idx: 1 },
  ];
  const out = summarizeSeriesLog(log);
  const a = out.get(A)!;
  const b = out.get(B)!;
  assert.equal(a.seriesWins, 2);
  assert.equal(a.seriesPlayed, 2);
  assert.equal(a.gameWins, 4, "two in the first set, two in the second");
  assert.equal(a.gamesPlayed, 5);
  assert.equal(b.seriesWins, 0);
  assert.equal(b.seriesPlayed, 2, "losing a set is still playing one");
  assert.equal(b.gameWins, 1);
  assert.equal(b.gamesPlayed, 5);
});

test("a LIVE series is not in the standings until it completes", () => {
  const live = played(5, [A]);
  assert.equal(live.winnerId, null);
  assert.equal(summarizeSeriesLog([live]).size, 0);
});

test("a series streak counts consecutive SETS and a loss resets it", () => {
  const log = [played(3, [A, A]), played(3, [A, A]), played(3, [B, B]), played(3, [A, A])];
  const out = summarizeSeriesLog(log);
  assert.equal(out.get(A)!.bestStreak, 2);
  assert.equal(out.get(A)!.currentStreak, 1, "the loss in between reset it");
  assert.equal(out.get(B)!.currentStreak, 0, "and their own win was reset by A's");
});

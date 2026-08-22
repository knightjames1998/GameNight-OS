// Characterization tests, written and run BEFORE partner stats were added.
//
// WHY THIS FILE EXISTS AND WHY IT IS DATED: a test written AFTER a change pins
// whatever that change broke. Everything below was captured by running the
// UNMODIFIED aggregation, so it describes the code as it was on 2026-08-22,
// before `partnersFor` existed. That is what makes it evidence rather than
// decoration.
//
// THE RISK IT COVERS is not that partner stats are wrong. It is that adding
// them quietly moves something ELSE. Two things are load-bearing here:
//
//   1. `finishAgg` IS THE CREW LEADERBOARD. It is called once per player by
//      /groups/:id/stats and it is sync and query-free precisely because of
//      that. Partner stats cost a query, so they must land beside
//      `finishAggDeep` and never inside `finishAgg`. The pin below is
//      BYTE-IDENTICAL rather than a field-by-field check, because the failure
//      being guarded against is a field appearing, a field vanishing, or a key
//      order shifting, none of which a spot-check of five numbers would
//      notice, and all of which change what every crew's leaderboard renders.
//
//   2. `meetingOutcome`'s `together` IS THE DEFINITION OF A TEAMMATE, and
//      partner stats are about to depend on the same rule expressed a second
//      time, in SQL, as a self-join on a matching non-null side. Two spellings
//      of one rule is exactly how the two drift. Pinning the JS spelling here
//      means the day somebody changes what a shared side means, this file
//      fails and the SQL gets looked at too.
//
// No database anywhere near this file: both halves are pure once their input
// is in hand, the same split rivalry.test.ts and tv-resolve.test.ts use.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SERIES_LABEL } from "@gamenight/shared";
import {
  feedAgg,
  finishAgg,
  meetingOutcome,
  meetingStreaks,
  newAgg,
  type MeetingOutcome,
  type MeetingSide,
  type ResultRow,
} from "../src/stats.js";

// ---------- part 1: finishAgg, pinned byte for byte ----------

// Rows are written out in full rather than built with the shared `result()`
// fixture ON PURPOSE. That builder advances a module-level counter, so the
// matchIds and timestamps it produces depend on how many rows every OTHER test
// file in the run happened to build first. A byte-identical pin cannot rest on
// that: this fixture has to produce the same JSON whether it runs first, last,
// or alone.
const row = (o: Partial<ResultRow> & { matchId: string }): ResultRow => ({
  placement: null,
  isWinner: false,
  gameName: "Smash Bros",
  character: null,
  playedAt: null,
  eventId: "e1",
  label: null,
  ...o,
});

/**
 * Deliberately not a clean sweep. It carries every branch finishAgg has:
 * three games so byGame sorts, two characters either side of MIN_CHAR_GAMES,
 * a placement-less co-op row (so avgPlacement divides by `placed` and not by
 * `played`), a loss streak longer than the win streak, four distinct nights,
 * and one Smashdown series summary that must count as a series and NOT as a
 * game.
 */
const FIXTURE: ResultRow[] = [
  row({ matchId: "m1", placement: 1, isWinner: true, character: "Fox", playedAt: new Date("2026-07-01T20:00:00.000Z"), eventId: "e1" }),
  row({ matchId: "m2", placement: 3, isWinner: false, character: "Fox", playedAt: new Date("2026-07-01T21:00:00.000Z"), eventId: "e1" }),
  row({ matchId: "m3", placement: 2, isWinner: false, character: "Fox", playedAt: new Date("2026-07-08T20:00:00.000Z"), eventId: "e2" }),
  row({ matchId: "m4", placement: 1, isWinner: true, character: "Kirby", playedAt: new Date("2026-07-08T21:00:00.000Z"), eventId: "e2" }),
  row({ matchId: "m5", placement: 5, isWinner: false, character: "Kirby", playedAt: new Date("2026-07-15T20:00:00.000Z"), eventId: "e3" }),
  row({ matchId: "m6", placement: 1, isWinner: true, gameName: "Ping Pong", playedAt: new Date("2026-07-15T21:00:00.000Z"), eventId: "e3" }),
  row({ matchId: "m7", placement: 2, isWinner: false, gameName: "Ping Pong", playedAt: new Date("2026-07-22T20:00:00.000Z"), eventId: "e4" }),
  row({ matchId: "m8", placement: null, isWinner: true, gameName: "Casino Run", playedAt: new Date("2026-07-22T21:00:00.000Z"), eventId: "e4" }),
  row({ matchId: "m9", placement: 1, isWinner: true, label: SERIES_LABEL, playedAt: new Date("2026-07-22T22:00:00.000Z"), eventId: "e4" }),
];

const fed = () => {
  const a = newAgg();
  for (const r of FIXTURE) feedAgg(a, r);
  return a;
};

/**
 * Captured 2026-08-22 by running the unmodified `finishAgg` over FIXTURE.
 *
 * IF THIS STRING NEEDS EDITING, STOP AND READ THE DIFF. It is not a snapshot
 * to be refreshed until it goes green: every crew leaderboard row in the app
 * comes out of this function, so a change here is a change to what every
 * member of every crew reads about themselves. Update it only with a reason
 * written down in the commit message.
 */
const PINNED_FINISH_AGG =
  '{"played":8,"wins":4,"best":1,"winRate":0.5,"avgPlacement":2.142857142857143,' +
  '"byGame":[{"name":"Smash Bros","played":5,"wins":2},{"name":"Ping Pong","played":2,"wins":1},' +
  '{"name":"Casino Run","played":1,"wins":1}],' +
  '"characters":{"byCharacter":[' +
  '{"name":"Fox","played":3,"wins":1,"winRate":0.3333333333333333,"bestPlacement":1,"avgPlacement":2},' +
  '{"name":"Kirby","played":2,"wins":1,"winRate":0.5,"bestPlacement":1,"avgPlacement":3}],' +
  '"mostPlayed":"Fox","best":"Fox","minGamesForBest":3,"distinctCharacters":2},' +
  '"form":{"currentStreak":1,"longestStreak":1,"currentLossStreak":0,"longestLossStreak":2,' +
  '"last5":[{"isWinner":true,"placement":null},{"isWinner":false,"placement":2},' +
  '{"isWinner":true,"placement":1},{"isWinner":false,"placement":5},{"isWinner":true,"placement":1}],' +
  '"tracked":8},' +
  '"series":{"wins":1,"played":1},' +
  '"nightsPlayed":4}';

test("finishAgg over a fed Agg is byte-identical to the pin (the crew leaderboard did not move)", () => {
  assert.equal(JSON.stringify(finishAgg(fed())), PINNED_FINISH_AGG);
});

test("finishAgg stays sync: it returns a value, never a promise", () => {
  // The one structural property that keeps the crew leaderboard cheap. It is
  // called once per player there, so the day this returns a thenable is the
  // day a twelve-person crew costs twelve round trips per render.
  const out = finishAgg(fed()) as unknown as { then?: unknown };
  assert.equal(typeof out.then, "undefined");
});

test("the series summary is one series and zero games, not a ninth game", () => {
  // Stated separately from the pin so the failure names itself. Partner stats
  // run their own SQL over the same rows and have to exclude the same label;
  // if this rule ever moves, both spellings need to move together.
  const out = finishAgg(fed());
  assert.equal(out.played, 8, "nine rows, one of them a series summary");
  assert.deepEqual(out.series, { wins: 1, played: 1 });
});

// ---------- part 2: what a shared side means ----------

const solo = (p: number | null, w = false): MeetingSide => ({ p, w, side: null });
const on = (side: string, p: number | null, w = false): MeetingSide => ({ p, w, side });

test("two matching non-null sides is `together`, ahead of any placement comparison", () => {
  // The rule partner stats are about to re-express in SQL as
  //   them.side = mine.side and them.user_id <> mine.user_id
  assert.equal(meetingOutcome(on("A", 1, true), on("A", 1, true)), "together");
  assert.equal(meetingOutcome(on("A", 1, true), on("A", 2)), "together");
  assert.equal(meetingOutcome(on("blue", null, false), on("blue", null, false)), "together");
});

test("different sides, or any null side, is NOT together", () => {
  // The SQL join has to agree with all three of these or it counts opponents
  // as partners.
  assert.equal(meetingOutcome(on("A", 1, true), on("B", 2)), "win");
  assert.equal(meetingOutcome(on("A", 2), on("B", 1, true)), "loss");
  // A null side never matches, INCLUDING another null. Every free-for-all row
  // in the ledger has one, so this is the case that keeps a Smash night from
  // reading as eight people all partnered with each other.
  assert.equal(meetingOutcome(solo(1, true), solo(2)), "win");
  assert.equal(meetingOutcome(solo(2), solo(2)), "tie");
  assert.equal(meetingOutcome(on("A", 1, true), solo(2)), "win");
  assert.equal(meetingOutcome(solo(1, true), on("A", 2)), "win");
});

test("a `together` game neither extends a streak nor breaks one", () => {
  const run = (os: MeetingOutcome[]) => meetingStreaks(os);
  // Three wins, a night played together, then a fourth win is a streak of 4.
  assert.deepEqual(run(["win", "win", "win", "together", "win"]), {
    run: 4,
    myLongest: 4,
    theirLongest: 0,
  });
  // And it does not rescue a run either: a loss still breaks it.
  assert.deepEqual(run(["win", "win", "together", "loss"]), {
    run: -1,
    myLongest: 2,
    theirLongest: 1,
  });
  // Nothing but teammate games means nothing happened between these two.
  assert.deepEqual(run(["together", "together", "together"]), {
    run: 0,
    myLongest: 0,
    theirLongest: 0,
  });
});

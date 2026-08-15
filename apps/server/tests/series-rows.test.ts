// The Smashdown SERIES row, and the one rule that makes it safe.
//
// A series row is a SUMMARY of battles that are already in the ledger. Every
// other match-as-unit row in this app (a Best Of set, a Ping Pong match) is the
// ONLY row its games produce, so counting it counts each game once. This one is
// different, and if anything that counts games forgets to skip it the damage is
// entirely silent: every player quietly gains a game per series, the winner
// gains a win, win rates shift, and nothing anywhere errors. Nobody would find
// that by reading a screen: the numbers would just be slightly wrong forever.
//
// So what is pinned here is the exclusion, from both directions:
//   - a series row must not reach played / wins / byGame / characters / form,
//   - it must reach series.wins and series.played, and nothing else must,
//   - a bo{N} label must still count normally, which is the regression that a
//     careless "skip labelled rows" fix would cause,
//   - the recap rollup must not fold it into the unit its battles form, since
//     it deliberately shares their sessionKey,
//   - its ledger key must be unable to collide with a battle's, whatever the
//     battle count does.
//
// Pure over rows in hand. No database and no Drizzle stub; getDb() is lazy, so
// importing the routers here opens no connection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SERIES_LABEL, isSeriesSummary } from "@gamenight/shared";
import { newAgg, feedAgg, finishAgg } from "../src/stats.js";
import { rollupRecap, type RecapRow } from "../src/events.js";
import { smashRuntime } from "../src/smash.js";
// The builder moved to result-fixture.ts when stats-agg.test.ts needed the same
// shape. Two copies of a fixture drift, and two test files that disagree about
// what a ledger row looks like can both stay green while doing it.
import { result, seriesResult } from "./result-fixture.js";

// ---------- the label itself ----------

test("the series label is the exact string the ledger is written with", () => {
  // Pinned, because this string is what already-written rows carry: changing
  // it would not error, it would just make every past series stop being
  // recognised as one and start counting as a game again.
  assert.equal(SERIES_LABEL, "smashdown");
  assert.equal(isSeriesSummary("smashdown"), true);
  assert.equal(isSeriesSummary(null), false);
  assert.equal(isSeriesSummary(undefined), false);
  assert.equal(isSeriesSummary(""), false);
  // The formats that legitimately ARE their own unit must not be caught.
  assert.equal(isSeriesSummary("bo3"), false);
  assert.equal(isSeriesSummary("bo7"), false);
  assert.equal(isSeriesSummary("Rainbow Road"), false);
  assert.equal(isSeriesSummary("Smashdown"), false, "the label is lowercase, exactly");
});

// ---------- the exclusion ----------

test("a five-battle series counts as five games and ONE series", () => {
  const a = newAgg();
  // Three battles won, two lost, then the series row that says they won it.
  for (let i = 0; i < 3; i++) feedAgg(a, result({ isWinner: true, placement: 1 }));
  for (let i = 0; i < 2; i++) feedAgg(a, result({ isWinner: false, placement: 2 }));
  feedAgg(a, seriesResult({ isWinner: true, placement: 1 }));

  const out = finishAgg(a);
  assert.equal(out.played, 5, "the series row is not a sixth game");
  assert.equal(out.wins, 3, "and not a fourth win");
  assert.equal(out.winRate, 3 / 5);
  assert.deepEqual(out.series, { wins: 1, played: 1 });
});

test("losing a series is a series played, not a series won", () => {
  const a = newAgg();
  feedAgg(a, result({ isWinner: false, placement: 2 }));
  feedAgg(a, seriesResult({ isWinner: false, placement: 2 }));
  const out = finishAgg(a);
  assert.equal(out.played, 1);
  assert.equal(out.wins, 0);
  assert.deepEqual(out.series, { wins: 0, played: 1 });
});

test("a series row reaches NONE of the per-game tallies", () => {
  const a = newAgg();
  feedAgg(a, seriesResult({ isWinner: true, placement: 1 }));
  const out = finishAgg(a);
  assert.equal(out.played, 0);
  assert.equal(out.wins, 0);
  assert.equal(out.best, null, "placement 1 on a summary is not a best finish");
  assert.equal(out.avgPlacement, null);
  assert.deepEqual(out.byGame, [], "and not a game played in Smash Bros");
  assert.deepEqual(out.characters.byCharacter, []);
  assert.equal(out.form.tracked, 0, "nor a result in the form timeline");
  assert.equal(out.nightsPlayed, 0, "a series alone is not a night played");
});

test("a series row cannot inflate a placement distribution or a streak", () => {
  // Two real losses with a series win between them. Without the exclusion the
  // series row would break the losing run into two, invent a 1st place, and
  // report a current win streak of zero off a middle row that never happened.
  const a = newAgg();
  feedAgg(a, result({ isWinner: false, placement: 2, playedAt: new Date(2026, 6, 28, 20, 1) }));
  feedAgg(a, seriesResult({ isWinner: true, placement: 1, playedAt: new Date(2026, 6, 28, 20, 2) }));
  feedAgg(a, result({ isWinner: false, placement: 2, playedAt: new Date(2026, 6, 28, 20, 3) }));
  const out = finishAgg(a);
  assert.equal(out.played, 2);
  assert.equal(out.form.tracked, 2);
  assert.equal(out.form.longestStreak, 0, "no phantom win in the middle of the run");
  assert.equal(out.form.currentLossStreak, 2, "the losing run is unbroken");
  assert.deepEqual(out.form.last5, [
    { isWinner: false, placement: 2 },
    { isWinner: false, placement: 2 },
  ]);
});

test("a Best Of set still counts as a game, which is the regression to avoid", () => {
  // bo3 is match-as-unit: the games inside it are NEVER materialized, so this
  // row IS the result and must count. A fix that skipped every labelled row
  // would silently delete Best Of and Mario Party from everyone's stats.
  const a = newAgg();
  feedAgg(a, result({ label: "bo3", isWinner: true, placement: 1 }));
  feedAgg(a, result({ label: "Rainbow Road", isWinner: false, placement: 3 }));
  const out = finishAgg(a);
  assert.equal(out.played, 2);
  assert.equal(out.wins, 1);
  assert.deepEqual(out.series, { wins: 0, played: 0 });
});

test("a crew that has never played Smashdown reports a zeroed series stat", () => {
  // Nested and always present, so a client can decide to hide it; the point is
  // that it is 0/0 rather than absent, which would make every consumer guard.
  const a = newAgg();
  feedAgg(a, result());
  assert.deepEqual(finishAgg(a).series, { wins: 0, played: 0 });
});

// ---------- the ledger key ----------

test("the series key is a literal, so no battle can ever collide with it", () => {
  const key = smashRuntime.ledgerKey("e1", "sk1", "series");
  assert.equal(key, "smash:e1:sk1:series");
  // Whatever the battle count does, a battle's tail is a number.
  for (const idx of [0, 1, 5, 21, 85]) {
    assert.notEqual(smashRuntime.ledgerKey("e1", "sk1", idx), key);
  }
  // Two sessions on one event keep their own series rows, which is what makes
  // "one series per sessionKey" true and the deferred backfill possible.
  assert.notEqual(smashRuntime.ledgerKey("e1", "sk2", "series"), key);
  // The battle keys are untouched by the widened parameter.
  assert.equal(smashRuntime.ledgerKey("e1", "sk1", 0), "smash:e1:sk1:0");
});

test("the series key still groups with its battles by sessionKey", () => {
  // The recap and the deferred backfill both split the key on ":" and read
  // index 2 as the session. The series row has to sit in the same group as the
  // battles it summarizes, or a future backfill cannot find them together.
  const battle = smashRuntime.ledgerKey("e1", "sk1", 3).split(":");
  const series = smashRuntime.ledgerKey("e1", "sk1", "series").split(":");
  assert.equal(battle.length, 4);
  assert.equal(series.length, 4);
  assert.equal(series[2], battle[2]);
});

// ---------- the recap ----------

let rseq = 0;
function recapRow(over: Partial<RecapRow> = {}): RecapRow {
  rseq++;
  return {
    matchId: `rm${rseq}`,
    position: rseq,
    label: null,
    format: "smashdown",
    externalKey: `smash:e1:sk1:${rseq}`,
    gameName: "Smash Bros",
    pack: "smash",
    userId: "u1",
    displayName: "Ari",
    placement: 1,
    isWinner: true,
    ...over,
  };
}

test("the recap does not fold a series row into the unit its battles form", () => {
  const battles = [
    recapRow({ userId: "u1", displayName: "Ari", isWinner: true }),
    recapRow({ userId: "u1", displayName: "Ari", isWinner: true }),
    recapRow({ userId: "u2", displayName: "Bo", isWinner: true }),
  ];
  const withSeries = [
    ...battles,
    recapRow({
      label: SERIES_LABEL,
      externalKey: "smash:e1:sk1:series",
      userId: "u1",
      displayName: "Ari",
      isWinner: true,
    }),
  ];

  const plain = rollupRecap(battles);
  const withIt = rollupRecap(withSeries);

  // Same night, same numbers: the summary changes nothing it describes.
  assert.equal(withIt.totalGames, plain.totalGames);
  assert.equal(withIt.totalGames, 3);
  assert.equal(withIt.sessions.length, 1, "still one thing played, not two");
  assert.equal(withIt.sessions[0]!.matches, 3, "won 2 of 3, never 2 of 4");
  assert.deepEqual(
    withIt.players.map((p) => [p.name, p.wins, p.games]),
    plain.players.map((p) => [p.name, p.wins, p.games]),
  );
  assert.equal(withIt.players.find((p) => p.name === "Ari")!.wins, 2);
});

test("a night that is ONLY a series row reads as nothing played", () => {
  // The degenerate case: if the exclusion were a filter on the units map alone,
  // this would still report a game and an MVP for a night with no games in it.
  const r = rollupRecap([recapRow({ label: SERIES_LABEL, externalKey: "smash:e1:sk1:series" })]);
  assert.equal(r.totalGames, 0);
  assert.deepEqual(r.games, []);
  assert.deepEqual(r.players, []);
  assert.equal(r.mvp, null);
});

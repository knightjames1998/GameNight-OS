// Characterization tests, written and run BEFORE the stats layer learned what a
// TOURNAMENT row is.
//
// WHY THIS FILE EXISTS AND WHY IT IS DATED. Everything pinned below was
// captured by running the UNMODIFIED code, so it describes `stats.ts` and
// `events.ts` as they stood on 2026-09-15, before `BEERIO_TOURNAMENT_LABEL`
// existed and before any row anywhere could carry it. A test written after a
// change pins whatever that change broke; this one is evidence.
//
// THE RISK IT COVERS is not that tournament rows will be wrong. It is that
// teaching the aggregation a SECOND kind of summary row quietly moves the
// FIRST, or moves the ordinary rows that are neither. `stats.ts` is the shared
// aggregation layer: every crew leaderboard row, every profile, `/me`, every
// rivalry page and the night recap come out of it, so a field appearing, a
// field vanishing or a key order shifting changes what every member of every
// crew reads about themselves. That is why the pins below are byte-identical
// JSON rather than spot-checks of a few numbers.
//
// WHAT IS PINNED BY RUNNING THE REAL FUNCTION, and what is not, stated plainly
// rather than left for a reader to work out:
//
//   - `feedAgg` / `finishAgg`      REAL. Exported, pure, run here.
//   - `rollupRecap`                REAL. Exported, pure, run here.
//   - `meetingOutcome` / streaks   REAL. Exported, pure, run here.
//   - the FORMAT BUCKETS and the PER-GAME COUNTS  REAL, from part 8 down.
//     They were NOT when this file was first written: both were loops inside
//     the crew-stats route handler, so neither could be called without a
//     database, and the pin was the skip DECISION instead. They were extracted
//     to `formatBuckets` and `countResults` later in the same session, once the
//     surfaces commit had changed both of them more than anything else in the
//     file with no test to change alongside. Part 8 says so in full.
//   - the rivalry's MEETING MAP is still a loop inside a route handler and is
//     still not directly callable. What it decides, row by row, is one
//     question: "is this row a summary, and therefore skipped?" That predicate
//     IS exported and IS run here over every row of the fixture, so the pin is
//     the DECISION, and `SKIP_DECISIONS` below is the table of it. The pairing
//     and outcome halves either side of that decision ARE run, in part 3.
//
// No database anywhere near this file: every pinned value is pure once its
// input is in hand, the same split partner-stats-baseline.test.ts uses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BEERIO_TOURNAMENT_LABEL, isSeriesSummary, isSummaryRow } from "@gamenight/shared";
import {
  countResults,
  feedAgg,
  finishAgg,
  formatBuckets,
  meetingOutcome,
  meetingStreaks,
  newAgg,
  rankPlayers,
  type CountRow,
  type CrewRow,
  type Rankable,
} from "../src/stats.js";
import { rollupRecap } from "../src/events.js";
import {
  asMeetingSide,
  asRecap,
  asResult,
  LEDGER,
  LEDGER_RELABELED,
  type LedgerRow,
} from "./result-fixture.js";

const rowsFor = (userId: string) => LEDGER.filter((r) => r.userId === userId);

const fed = (userId: string) => {
  const a = newAgg();
  for (const r of rowsFor(userId)) feedAgg(a, asResult(r));
  return a;
};

// ---------- part 1: the aggregation, pinned byte for byte ----------

/**
 * ALL THREE CAPTURED 2026-09-15 by running the unmodified `finishAgg` over the
 * fixture. Printed and pasted, never typed: a first draft of this file guessed
 * three of these by hand and got all three wrong, which is the whole argument
 * for the rule.
 *
 * IF ONE OF THESE STRINGS NEEDS EDITING, STOP AND READ THE DIFF. Every crew
 * leaderboard row, every profile and every `/me` in the app comes out of this
 * function, so a change here is a change to what every member of every crew
 * reads about themselves. Update one only with a reason in the commit message.
 *
 * EDITED ONCE, ON 2026-09-15, AND THE DIFF WAS READ RATHER THAN REFRESHED
 * UNTIL GREEN. All three gained the key
 * `"tournaments":{"titles":0,"played":0,"best":null,"avgPlacement":null}` and
 * nothing else: each was compared field by field against the string captured
 * before `finishAgg` learned the word, and the comparison found one key added,
 * none removed, none changed, and the order of every existing key preserved.
 * Zeroes on all three because no row in `LEDGER` carries the label. The
 * counters actually move in `LEDGER_RELABELED`, below.
 *
 * ARI plays all five nights. Eight games and one series is the claim: the
 * series summary counts as a series and not as a ninth game, and BOTH Beerio
 * nights count as games, because on 2026-09-15 nothing in the ledger says
 * otherwise. The second half is what this session changes; the first is what
 * it must not.
 */
const PINNED_ARI =
  '{"played":8,"wins":4,"best":1,"winRate":0.5,"avgPlacement":1.5,"byGame":[{"name":"Smash Bros","played":3,"wins":2},{"name":"Beerio Kart","played":2,"wins":1},{"name":"Mario Kart 8","played":1,"wins":0},{"name":"Ping Pong","played":1,"wins":1},{"name":"Mario Party","played":1,"wins":0}],"characters":{"byCharacter":[{"name":"Fox","played":3,"wins":2,"winRate":0.6666666666666666,"bestPlacement":1,"avgPlacement":1.3333333333333333}],"mostPlayed":"Fox","best":"Fox","minGamesForBest":3,"distinctCharacters":1},"form":{"currentStreak":0,"longestStreak":1,"currentLossStreak":1,"longestLossStreak":1,"last5":[{"isWinner":false,"placement":2},{"isWinner":true,"placement":1},{"isWinner":false,"placement":2},{"isWinner":true,"placement":1},{"isWinner":false,"placement":2}],"tracked":8},"series":{"wins":1,"played":1},"tournaments":{"titles":0,"played":0,"best":null,"avgPlacement":null},"nightsPlayed":5}';

test("BASELINE: finishAgg over the fixture ledger is byte-identical to the pin", () => {
  assert.equal(JSON.stringify(finishAgg(fed("u1"))), PINNED_ARI);
});

/**
 * BO loses the series and wins the Grand Prix, so the two summary-shaped rows
 * point in opposite directions and a fix that confused them shows up here
 * rather than cancelling out.
 */
const PINNED_BO =
  '{"played":8,"wins":4,"best":1,"winRate":0.5,"avgPlacement":1.5,"byGame":[{"name":"Smash Bros","played":3,"wins":1},{"name":"Beerio Kart","played":2,"wins":1},{"name":"Mario Kart 8","played":1,"wins":1},{"name":"Ping Pong","played":1,"wins":0},{"name":"Mario Party","played":1,"wins":1}],"characters":{"byCharacter":[{"name":"Kirby","played":3,"wins":1,"winRate":0.3333333333333333,"bestPlacement":1,"avgPlacement":1.6666666666666667}],"mostPlayed":"Kirby","best":"Kirby","minGamesForBest":3,"distinctCharacters":1},"form":{"currentStreak":1,"longestStreak":1,"currentLossStreak":0,"longestLossStreak":1,"last5":[{"isWinner":true,"placement":1},{"isWinner":false,"placement":2},{"isWinner":true,"placement":1},{"isWinner":false,"placement":2},{"isWinner":true,"placement":1}],"tracked":8},"series":{"wins":0,"played":1},"tournaments":{"titles":0,"played":0,"best":null,"avgPlacement":null},"nightsPlayed":5}';

test("BASELINE: the same for the player whose two summary-shaped rows point the other way", () => {
  assert.equal(JSON.stringify(finishAgg(fed("u2"))), PINNED_BO);
});

/**
 * CY IS THE ACCEPTANCE WITNESS FOR THE WHOLE SESSION, and is in the fixture for
 * that one job. Cy played the two Beerio nights and nothing else, so Cy's
 * entire record is Beerio: two games, no wins, best finish 3rd, two nights.
 *
 * After the closeout SQL relabels the BRACKET night, Cy's `played` drops to
 * ONE (the Grand Prix, which is not relabeled) and the bracket night has to
 * reappear as a TOURNAMENT rather than vanish. A player whose profile goes
 * blank is the failure this session is most likely to ship, and Cy is the
 * cheapest way to see it.
 */
const PINNED_CY =
  '{"played":2,"wins":0,"best":3,"winRate":0,"avgPlacement":3,"byGame":[{"name":"Beerio Kart","played":2,"wins":0}],"characters":{"byCharacter":[],"mostPlayed":null,"best":null,"minGamesForBest":3,"distinctCharacters":0},"form":{"currentStreak":0,"longestStreak":0,"currentLossStreak":2,"longestLossStreak":2,"last5":[{"isWinner":false,"placement":3},{"isWinner":false,"placement":3}],"tracked":2},"series":{"wins":0,"played":0},"tournaments":{"titles":0,"played":0,"best":null,"avgPlacement":null},"nightsPlayed":2}';

test("BASELINE: the player whose whole record is Beerio nights", () => {
  assert.equal(JSON.stringify(finishAgg(fed("u3"))), PINNED_CY);
});

test("BASELINE: finishAgg stays sync and query-free", () => {
  // The structural property that keeps the crew leaderboard cheap: it is called
  // once per player there. Anything needing a query belongs in finishAggDeep.
  const out = finishAgg(fed("u1")) as unknown as { then?: unknown };
  assert.equal(typeof out.then, "undefined");
});

// ---------- part 2: what every reader decides about every row ----------
//
// The format buckets, the per-game counts, the meeting map and the recap each
// ask one question of each row before counting it: is this a summary of rows
// already in the ledger? They all ask it through the same classifier, which is
// what makes this table the honest pin for the one of the four that is still
// only reachable through a route (the meeting map). The other three are run
// directly, in parts 4 and 8.

/** matchId -> is this row skipped by the four tallies that live outside feedAgg. */
const SKIP_DECISIONS: [string, boolean][] = [
  ["m1", false], // a Smash battle
  ["m2", false],
  ["m3", false],
  ["m4", true], //  THE SERIES SUMMARY, the only skipped row on 2026-09-15
  ["m5", false], // a generic bracket, labelled "Tournament" and still a game
  ["m6", false], // a legacy Beerio BRACKET night: a game today, a tournament later
  ["m7", false], // a legacy Beerio GRAND PRIX night: a game today AND after
  ["m8", false], // Ping Pong, bo3
  ["m9", false], // Mario Party, a board
];

test("BASELINE: exactly one row in the fixture is skipped by the tallies outside feedAgg", () => {
  const byMatch = new Map(LEDGER.map((r) => [r.matchId, r]));
  for (const [matchId, expected] of SKIP_DECISIONS) {
    const row = byMatch.get(matchId)!;
    assert.equal(isSeriesSummary(row.label), expected, `${matchId} (label ${JSON.stringify(row.label)})`);
  }
  // And nothing outside the table: a new row shape added to the fixture
  // without a decision recorded for it is the gap this guards.
  assert.equal(SKIP_DECISIONS.length, new Set(LEDGER.map((r) => r.matchId)).size);
  assert.equal(SKIP_DECISIONS.filter(([, skipped]) => skipped).length, 1);
});

test("BASELINE: the Beerio rows are indistinguishable from ordinary rows today", () => {
  // Stated separately so the failure names itself. This is the ENTIRE reason
  // the closeout SQL is needed: nothing on a legacy Beerio row says what it is.
  for (const r of LEDGER.filter((x) => x.pack === "beerio_kart")) {
    assert.equal(r.label, null, "a legacy Beerio row carries no label");
    assert.equal(r.format, null, "and no format");
    assert.equal(isSeriesSummary(r.label), false, "so nothing skips it");
  }
});

// ---------- part 3: the meeting map ----------

const meetingsBetween = (meId: string, themId: string) => {
  // The same pairing the rivalry route builds in memory, over the same rows,
  // with the same exclusion applied before the pair is formed.
  const byMatch = new Map<string, { mine?: LedgerRow; theirs?: LedgerRow }>();
  for (const r of LEDGER) {
    if (r.userId !== meId && r.userId !== themId) continue;
    if (isSeriesSummary(r.label)) continue;
    const m = byMatch.get(r.matchId) ?? {};
    if (r.userId === meId) m.mine = r;
    else m.theirs = r;
    byMatch.set(r.matchId, m);
  }
  return [...byMatch.entries()]
    .filter(([, m]) => m.mine && m.theirs)
    .map(([matchId, m]) => [matchId, meetingOutcome(asMeetingSide(m.mine!), asMeetingSide(m.theirs!))] as const);
};

test("BASELINE: eight meetings between the two regulars, and both Beerio nights are among them", () => {
  // Captured by running meetingOutcome over the fixture. The two Beerio lines
  // are the ones this session deliberately removes in commit 5: a placement
  // comparison across a whole NIGHT is not a head-to-head, and saying so is
  // the point. Everything else here must survive that change untouched.
  assert.deepEqual(meetingsBetween("u1", "u2"), [
    ["m1", "win"],
    ["m2", "loss"],
    ["m3", "win"],
    ["m5", "loss"],
    ["m6", "win"], // the legacy Beerio BRACKET night
    ["m7", "loss"], // the legacy Beerio GRAND PRIX night
    ["m8", "win"],
    ["m9", "loss"],
  ]);
});

test("BASELINE: the meeting streaks those eight produce", () => {
  const outcomes = meetingsBetween("u1", "u2").map(([, o]) => o);
  assert.deepEqual(meetingStreaks(outcomes), { run: -1, myLongest: 1, theirLongest: 1 });
});

test("BASELINE: two players who have only ever shared Beerio nights have TWO meetings", () => {
  // Captured, and it is the number commit 5 takes to ZERO. Ari and Cy have
  // never played anything but the two Beerio nights together, so today their
  // rivalry page is built entirely out of placement comparisons across whole
  // nights. That is the thing this session says is not a head-to-head.
  assert.deepEqual(meetingsBetween("u1", "u3"), [
    ["m6", "win"],
    ["m7", "win"],
  ]);
});

// ---------- part 4: the recap ----------

/**
 * Captured 2026-09-15 by running the unmodified `rollupRecap` over the Smash
 * night plus the Beerio bracket night, which is the pair the recap has to keep
 * straight: one summary row that must NOT become its own line, and one legacy
 * Beerio row that must.
 */
const RECAP_NIGHT = LEDGER.filter((r) => r.eventId === "e1" || r.eventId === "e3").map(asRecap);

test("BASELINE: the recap folds the series into its battles and gives Beerio its own line", () => {
  const r = rollupRecap(RECAP_NIGHT);
  assert.equal(r.totalGames, 4, "three battles and one Beerio night; the series is not a game");
  assert.deepEqual(r.sessions.map((s) => [s.gameName, s.matches]), [
    ["Beerio Kart", 1],
    ["Smash Bros", 3],
  ]);
  assert.deepEqual(
    r.players.map((p) => [p.name, p.wins, p.games]),
    [
      ["Ari", 3, 4],
      ["Bo", 1, 4],
      ["Cy", 0, 1],
    ],
  );
  assert.equal(r.mvp?.name, "Ari");
});

test("BASELINE: all five nights rolled up at once", () => {
  // Captured. The two Beerio nights are TWO separate lines even though both are
  // "Beerio Kart": each legacy row falls back to `legacy:b|...` / `legacy:g|...`
  // for its session key, so they never merge. Pinned because the recap is the
  // surface this session is most likely to change by accident.
  const all = rollupRecap(LEDGER.map(asRecap));
  assert.equal(all.totalGames, 8);
  assert.deepEqual(all.sessions.map((s) => [s.gameName, s.matches]), [
    ["Beerio Kart", 1],
    ["Beerio Kart", 1],
    ["Smash Bros", 3],
    ["Mario Kart 8", 1],
    ["Ping Pong", 1],
    ["Mario Party", 1],
  ]);
  assert.deepEqual(all.players.map((p) => [p.name, p.wins, p.games]), [
    ["Ari", 4, 8],
    ["Bo", 4, 8],
    ["Cy", 0, 2],
  ]);
});

test("BASELINE: the Beerio night is its own recap line, not folded into anything", () => {
  // A legacy Beerio row has no sessionKey in its externalKey (`b|...` splits
  // into two parts, not four), so `sessionKeyOf` falls back to `legacy:b|...`
  // and the night stands alone. Pinned because commit 5 must not move it: a
  // tournament row still renders as its own line, exactly as it does today.
  const beerio = rollupRecap(LEDGER.filter((r) => r.eventId === "e3").map(asRecap));
  assert.equal(beerio.totalGames, 1);
  assert.equal(beerio.sessions.length, 1);
  assert.equal(beerio.sessions[0]!.gameName, "Beerio Kart");
  assert.equal(beerio.sessions[0]!.matches, 1);
});

// ---------- part 5: the same ledger after the one-off relabel ----------
//
// `LEDGER_RELABELED` is `LEDGER` with the closeout SQL applied: the BRACKET
// night's three rows carry `beerio_tournament` and every other row, the Grand
// Prix night included, is untouched. Derived from `LEDGER` rather than written
// out again, so the two can never drift into describing different nights.
//
// THIS IS THE SESSION'S ACCEPTANCE TEST, and every value below was captured by
// running the code rather than reasoned about.

const fedAfter = (userId: string) => {
  const a = newAgg();
  for (const r of LEDGER_RELABELED.filter((x) => x.userId === userId)) feedAgg(a, asResult(r));
  return a;
};

/**
 * ARI after the relabel: the bracket night leaves `played` and arrives in
 * `tournaments` as a title, and the Grand Prix night stays a game because it
 * is not relabeled.
 */
const AFTER_ARI =
  '{"played":7,"wins":3,"best":1,"winRate":0.42857142857142855,"avgPlacement":1.5714285714285714,"byGame":[{"name":"Smash Bros","played":3,"wins":2},{"name":"Mario Kart 8","played":1,"wins":0},{"name":"Beerio Kart","played":1,"wins":0},{"name":"Ping Pong","played":1,"wins":1},{"name":"Mario Party","played":1,"wins":0}],"characters":{"byCharacter":[{"name":"Fox","played":3,"wins":2,"winRate":0.6666666666666666,"bestPlacement":1,"avgPlacement":1.3333333333333333}],"mostPlayed":"Fox","best":"Fox","minGamesForBest":3,"distinctCharacters":1},"form":{"currentStreak":0,"longestStreak":1,"currentLossStreak":1,"longestLossStreak":2,"last5":[{"isWinner":false,"placement":2},{"isWinner":true,"placement":1},{"isWinner":false,"placement":2},{"isWinner":false,"placement":2},{"isWinner":true,"placement":1}],"tracked":7},"series":{"wins":1,"played":1},"tournaments":{"titles":1,"played":1,"best":1,"avgPlacement":1},"nightsPlayed":5}';

test("AFTER: the bracket night becomes a title and the Grand Prix stays a game", () => {
  assert.equal(JSON.stringify(finishAgg(fedAfter("u1"))), AFTER_ARI);
});

/** BO came second at the bracket: no title, and the placement is kept anyway. */
const AFTER_BO =
  '{"played":7,"wins":4,"best":1,"winRate":0.5714285714285714,"avgPlacement":1.4285714285714286,"byGame":[{"name":"Smash Bros","played":3,"wins":1},{"name":"Mario Kart 8","played":1,"wins":1},{"name":"Beerio Kart","played":1,"wins":1},{"name":"Ping Pong","played":1,"wins":0},{"name":"Mario Party","played":1,"wins":1}],"characters":{"byCharacter":[{"name":"Kirby","played":3,"wins":1,"winRate":0.3333333333333333,"bestPlacement":1,"avgPlacement":1.6666666666666667}],"mostPlayed":"Kirby","best":"Kirby","minGamesForBest":3,"distinctCharacters":1},"form":{"currentStreak":1,"longestStreak":2,"currentLossStreak":0,"longestLossStreak":1,"last5":[{"isWinner":true,"placement":1},{"isWinner":false,"placement":2},{"isWinner":true,"placement":1},{"isWinner":true,"placement":1},{"isWinner":false,"placement":2}],"tracked":7},"series":{"wins":0,"played":1},"tournaments":{"titles":0,"played":1,"best":2,"avgPlacement":2},"nightsPlayed":5}';

test("AFTER: a runner-up keeps the placement, which is what a podium history IS", () => {
  const out = finishAgg(fedAfter("u2"));
  assert.equal(JSON.stringify(out), AFTER_BO);
  assert.deepEqual(out.tournaments, { titles: 0, played: 1, best: 2, avgPlacement: 2 });
});

/**
 * CY IS THE ACCEPTANCE WITNESS, and this is the assertion the whole session was
 * for. Cy played nothing but the two Beerio nights, so Cy is the member whose
 * profile a careless relabel empties.
 */
const AFTER_CY =
  '{"played":1,"wins":0,"best":3,"winRate":0,"avgPlacement":3,"byGame":[{"name":"Beerio Kart","played":1,"wins":0}],"characters":{"byCharacter":[],"mostPlayed":null,"best":null,"minGamesForBest":3,"distinctCharacters":0},"form":{"currentStreak":0,"longestStreak":0,"currentLossStreak":1,"longestLossStreak":1,"last5":[{"isWinner":false,"placement":3}],"tracked":1},"series":{"wins":0,"played":0},"tournaments":{"titles":0,"played":1,"best":3,"avgPlacement":3},"nightsPlayed":2}';

test("AFTER: the player whose whole record is Beerio does not go blank", () => {
  const out = finishAgg(fedAfter("u3"));
  assert.equal(JSON.stringify(out), AFTER_CY);
  assert.equal(out.nightsPlayed, 2, "NEITHER night disappeared");
  assert.equal(out.tournaments.played, 1, "the bracket night is a tournament now");
  assert.equal(out.tournaments.best, 3, "and it still remembers where Cy finished");
  assert.equal(out.byGame.find((g) => g.name === "Beerio Kart")?.played, 1, "the GP night is still a game");
});

test("AFTER: a title never lands in the series counters, nor a series in the titles", () => {
  // The one thing that must never happen, asserted on its own so the failure
  // names itself. Ari won a Smashdown series AND a Beerio bracket, so a merge
  // of the two tallies shows up here and nowhere else.
  const ari = finishAgg(fedAfter("u1"));
  assert.deepEqual(ari.series, { wins: 1, played: 1 }, "one Smashdown set, and only that");
  assert.deepEqual(ari.tournaments, { titles: 1, played: 1, best: 1, avgPlacement: 1 });
  assert.deepEqual(finishAgg(fedAfter("u2")).series, { wins: 0, played: 1 });
});

test("AFTER: finishAgg is still sync and query-free", () => {
  const out = finishAgg(fedAfter("u1")) as unknown as { then?: unknown };
  assert.equal(typeof out.then, "undefined");
});

// ---------- part 6: what the relabel costs, captured rather than claimed ----------

const meetingsAfter = (meId: string, themId: string) => {
  const byMatch = new Map<string, { mine?: LedgerRow; theirs?: LedgerRow }>();
  for (const r of LEDGER_RELABELED) {
    if (r.userId !== meId && r.userId !== themId) continue;
    if (isSummaryRow(r.label)) continue;
    const m = byMatch.get(r.matchId) ?? {};
    if (r.userId === meId) m.mine = r;
    else m.theirs = r;
    byMatch.set(r.matchId, m);
  }
  return [...byMatch.entries()]
    .filter(([, m]) => m.mine && m.theirs)
    .map(([matchId, m]) => [matchId, meetingOutcome(asMeetingSide(m.mine!), asMeetingSide(m.theirs!))] as const);
};

test("AFTER: old bracket nights stop producing meetings, and that is the intended trade", () => {
  // DELIBERATE, NOT A REGRESSION, and captured here so nobody has to take it on
  // trust. Comparing two racers' placements across a whole NIGHT is not a
  // head-to-head: they may never have raced each other at all. Eight meetings
  // become seven, the one that goes is the bracket night, and the Grand Prix
  // night stays because a GP genuinely IS one ranked result.
  //
  // New Beerio nights get REAL meetings, one per 1v1 match actually raced, from
  // program session 2. That is the whole point of the trade.
  assert.deepEqual(meetingsAfter("u1", "u2"), [
    ["m1", "win"],
    ["m2", "loss"],
    ["m3", "win"],
    ["m5", "loss"],
    ["m7", "loss"],
    ["m8", "win"],
    ["m9", "loss"],
  ]);
  assert.deepEqual(meetingStreaks(meetingsAfter("u1", "u2").map(([, o]) => o)), {
    run: -1,
    myLongest: 1,
    theirLongest: 2,
  });
});

test("AFTER: two players who only ever shared Beerio nights keep the GP meeting", () => {
  // Their two meetings become ONE rather than none, which is the distinction
  // the `b|%` filter in the closeout SQL exists to draw.
  assert.deepEqual(meetingsAfter("u1", "u3"), [["m7", "win"]]);
});

test("AFTER: the recap keeps every Beerio night, and differs ONLY by the raw label", () => {
  // The surface the acceptance criterion is sharpest about. A relabeled night
  // renders exactly as it did: its own line, its own row, nothing folded and
  // nothing dropped.
  const before = rollupRecap(LEDGER.map(asRecap));
  const after = rollupRecap(LEDGER_RELABELED.map(asRecap));

  assert.equal(after.totalGames, before.totalGames);
  assert.equal(after.totalGames, 8, "the relabel costs the night nothing");
  assert.deepEqual(after.players, before.players);
  assert.deepEqual(after.mvp, before.mvp);
  assert.equal(after.sessions.filter((x) => x.gameName === "Beerio Kart").length, 2);
  assert.deepEqual(
    after.sessions.map(({ label, ...rest }) => rest),
    before.sessions.map(({ label, ...rest }) => rest),
    "every field but the label is identical",
  );

  // AND THE ONE FIELD THAT DOES MOVE, asserted rather than waved past. The
  // rollup passes `matches.label` straight through, so a relabeled night now
  // carries the raw ledger string where it used to carry null. That is correct
  // of the ROLLUP, which reports rows as they are; it is a problem for any
  // SURFACE that prints the field without asking what it is, and finding that
  // is the job of the commit after this one.
  const beerio = after.sessions.filter((x) => x.gameName === "Beerio Kart");
  assert.deepEqual(
    beerio.map((x) => x.label),
    [BEERIO_TOURNAMENT_LABEL, null],
    "the bracket night carries the label, the Grand Prix night does not",
  );
});

// ---------- part 7: the order the crew leaderboard puts them in ----------
//
// `rankPlayers` is exported for the same reason `feedAgg` is: the failure is
// silent. A leaderboard in the wrong order still renders, still looks like a
// leaderboard, and nothing errors anywhere.

const ranked = (rows: Rankable[]) => rankPlayers(rows.map((r, i) => ({ ...r, id: `p${i}` }))).map((r) => r.id);

test("RANK: a tab with no games at all is ordered by titles, not by insertion", () => {
  // THE CASE THAT MADE THIS NECESSARY. Every Beerio crew that only ever ran
  // brackets looks exactly like this after the relabel: wins, winRate and
  // played all zero for everybody, so the three comparisons that used to be
  // the whole comparator all tie and the order was whatever the aggregation
  // map happened to iterate. A two-time champion listed third for no reason.
  const zero = { wins: 0, winRate: 0, played: 0 };
  assert.deepEqual(
    ranked([
      { ...zero, tournaments: { titles: 0, played: 3, best: 3 } }, // p0, Cal
      { ...zero, tournaments: { titles: 2, played: 3, best: 1 } }, // p1, Ann
      { ...zero, tournaments: { titles: 1, played: 3, best: 1 } }, // p2, Ben
    ]),
    ["p1", "p2", "p0"],
  );
});

test("RANK: equal titles break on tournaments entered, then on best finish", () => {
  const zero = { wins: 0, winRate: 0, played: 0 };
  assert.deepEqual(
    ranked([
      { ...zero, tournaments: { titles: 1, played: 2, best: 1 } },
      { ...zero, tournaments: { titles: 1, played: 9, best: 1 } },
    ]),
    ["p1", "p0"],
    "more entered is a longer record at the same title count",
  );
  assert.deepEqual(
    ranked([
      { ...zero, tournaments: { titles: 0, played: 4, best: 4 } },
      { ...zero, tournaments: { titles: 0, played: 4, best: 2 } },
    ]),
    ["p1", "p0"],
    "best finish is ASCENDING: #2 beats #4",
  );
  assert.deepEqual(
    ranked([
      { ...zero, tournaments: { titles: 0, played: 4, best: null } },
      { ...zero, tournaments: { titles: 0, played: 4, best: 4 } },
    ]),
    ["p1", "p0"],
    "never placed sorts behind anyone who has",
  );
});

test("RANK: a row with games is ordered exactly as it was before", () => {
  // The regression guard. The tournament tail is only reached once the first
  // three comparisons tie, so a leaderboard with any games in it must come out
  // in the same order it always did, tournaments present or not.
  const rows: Rankable[] = [
    { wins: 1, winRate: 0.2, played: 5 },
    { wins: 4, winRate: 0.4, played: 10, tournaments: { titles: 0, played: 1, best: 4 } },
    { wins: 4, winRate: 0.8, played: 5 },
    { wins: 2, winRate: 0.5, played: 4, tournaments: { titles: 9, played: 9, best: 1 } },
  ];
  assert.deepEqual(ranked(rows), ["p2", "p1", "p3", "p0"]);
  // And the same list with every tournament stripped comes out identically,
  // which is the claim stated as an experiment rather than as a sentence.
  assert.deepEqual(
    ranked(rows.map(({ tournaments, ...rest }) => rest)),
    ranked(rows),
    "the tail cannot reorder rows whose first three fields differ",
  );
});

// ---------- part 8: the two tallies that live outside feedAgg ----------
//
// ADDED 2026-09-15, AFTER THE REST OF THIS FILE, AND THE REASON IS WORTH
// RECORDING RATHER THAN TIDYING AWAY. The brief for this session asked for the
// per-format buckets and the per-game counts to be captured by RUNNING the
// code, like everything else here. They could not be: both were loops INSIDE
// the crew-stats route handler, so the only way to exercise either was to stand
// up a database, and the baseline settled for pinning the skip DECISION each
// loop makes on each row instead.
//
// That was honest but thin, and it aged badly inside the same session: the
// commit that fixed the surfaces changed those two loops more than anything
// else in the file, and neither had a test to change with them. So they are
// `formatBuckets` and `countResults` now, pure and exported for exactly the
// reason `feedAgg` is, and what follows is what they actually print.

const asCrew = (r: LedgerRow): CrewRow => ({
  matchId: r.matchId,
  userId: r.userId,
  displayName: r.displayName,
  gameName: r.gameName,
  format: r.format,
  label: r.label,
  isWinner: r.isWinner,
});

/** One row per MATCH, the way the completed-matches query returns them. */
const asCounts = (rows: readonly LedgerRow[]): CountRow[] => {
  const seen = new Map<string, CountRow>();
  for (const r of rows) if (!seen.has(r.matchId)) seen.set(r.matchId, { gameName: r.gameName, label: r.label });
  return [...seen.values()];
};

const fmtJson = (rows: readonly LedgerRow[]) => JSON.stringify([...formatBuckets(rows.map(asCrew)).entries()]);
const cntJson = (rows: readonly LedgerRow[]) => {
  const c = countResults(asCounts(rows));
  return JSON.stringify({
    resultsByGame: [...c.resultsByGame.entries()],
    heldByGame: [...c.heldByGame.entries()],
    results: c.results,
    held: c.held,
  });
};

/**
 * Captured by running `formatBuckets` over the fixture. NOTE WHAT IS NOT IN IT:
 * Smash Bros reads 3 in its smashdown bucket, not 4. The series summary carries
 * that same format by design, so a bucket that forgot to skip it would count
 * the series as a fourth battle and hand its winner a third win.
 */
const PINNED_FORMATS_BEFORE = '[["Smash Bros",[{"format":"smashdown","played":3,"players":[{"name":"Ari","wins":2,"played":3},{"name":"Bo","wins":1,"played":3}]}]],["Mario Kart 8",[{"format":"other","played":1,"players":[{"name":"Bo","wins":1,"played":1},{"name":"Ari","wins":0,"played":1}]}]],["Beerio Kart",[{"format":"other","played":2,"players":[{"name":"Ari","wins":1,"played":2},{"name":"Bo","wins":1,"played":2},{"name":"Cy","wins":0,"played":2}]}]],["Ping Pong",[{"format":"bestof","played":1,"players":[{"name":"Ari","wins":1,"played":1},{"name":"Bo","wins":0,"played":1}]}]],["Mario Party",[{"format":"board","played":1,"players":[{"name":"Bo","wins":1,"played":1},{"name":"Ari","wins":0,"played":1}]}]]]';

test("BASELINE: the crew leaderboard's per-format buckets", () => {
  assert.equal(fmtJson(LEDGER), PINNED_FORMATS_BEFORE);
});

/** Captured by running `countResults` over the same rows. */
const PINNED_COUNTS_BEFORE = '{"resultsByGame":[["Smash Bros",3],["Mario Kart 8",1],["Beerio Kart",2],["Ping Pong",1],["Mario Party",1]],"heldByGame":[],"results":8,"held":0}';

test("BASELINE: the per-game result counts, with no tournament anywhere yet", () => {
  assert.equal(cntJson(LEDGER), PINNED_COUNTS_BEFORE);
});

/**
 * After the relabel. Beerio's "other" bucket goes 2 to 1: the bracket night
 * leaves, the Grand Prix night stays. THE BUCKET DOES NOT VANISH HERE, and this
 * fixture is the kinder case on purpose. A crew with a GP night keeps it; a crew
 * whose Beerio history is nothing but brackets loses it entirely, and that is
 * right rather than a loss: the section it feeds is headed "Wins by format" and
 * a tournament is not a format. The client gates that section on a non-empty
 * list, so it disappears instead of rendering empty, and the count below is
 * what reports the tournaments.
 */
const PINNED_FORMATS_AFTER = '[["Smash Bros",[{"format":"smashdown","played":3,"players":[{"name":"Ari","wins":2,"played":3},{"name":"Bo","wins":1,"played":3}]}]],["Mario Kart 8",[{"format":"other","played":1,"players":[{"name":"Bo","wins":1,"played":1},{"name":"Ari","wins":0,"played":1}]}]],["Beerio Kart",[{"format":"other","played":1,"players":[{"name":"Bo","wins":1,"played":1},{"name":"Ari","wins":0,"played":1},{"name":"Cy","wins":0,"played":1}]}]],["Ping Pong",[{"format":"bestof","played":1,"players":[{"name":"Ari","wins":1,"played":1},{"name":"Bo","wins":0,"played":1}]}]],["Mario Party",[{"format":"board","played":1,"players":[{"name":"Bo","wins":1,"played":1},{"name":"Ari","wins":0,"played":1}]}]]]';

test("AFTER: the bracket night leaves the format buckets and the GP night stays", () => {
  assert.equal(fmtJson(LEDGER_RELABELED), PINNED_FORMATS_AFTER);
  // Also as its own assertion, so a failure names the bucket rather than
  // pointing at a long string.
  const beerio = formatBuckets(LEDGER_RELABELED.map(asCrew)).get("Beerio Kart")!;
  assert.deepEqual(beerio.map((f) => [f.format, f.played]), [["other", 1]]);
});

/**
 * AND THE COUNT THAT KEEPS THE TAB FROM READING ZERO. Beerio's results go 2 to
 * 1 and its held count 0 to 1, so the header has something true to print. The
 * totals move together: 8 results and 0 held becomes 7 and 1.
 */
const PINNED_COUNTS_AFTER = '{"resultsByGame":[["Smash Bros",3],["Mario Kart 8",1],["Beerio Kart",1],["Ping Pong",1],["Mario Party",1]],"heldByGame":[["Beerio Kart",1]],"results":7,"held":1}';

test("AFTER: a relabeled night moves from results to tournaments held, not into nothing", () => {
  assert.equal(cntJson(LEDGER_RELABELED), PINNED_COUNTS_AFTER);
  const c = countResults(asCounts(LEDGER_RELABELED));
  assert.equal(c.results + c.held, 8, "no night was lost, only recategorised");
  assert.equal(c.heldByGame.get("Beerio Kart"), 1);
  assert.equal(c.resultsByGame.get("Beerio Kart"), 1, "the Grand Prix night is still a result");
});

test("a series summary is in NEITHER count, and its battles are in the first", () => {
  // Deliberate, and stated because "neither" reads like an omission. The
  // battles are already counted as results, so the night is represented, and
  // the Smash panel reports series separately off its own rows. A series that
  // landed in `held` would put a Smashdown set on the tournament line.
  const c = countResults(asCounts(LEDGER));
  assert.equal(c.resultsByGame.get("Smash Bros"), 3, "three battles, not four");
  assert.equal(c.heldByGame.has("Smash Bros"), false);
});

test("both tallies handle an EMPTY ledger, which had never been asked", () => {
  // Negative control. Neither of these could be called at all until they were
  // extracted, so "what does it do with nothing" was an open question.
  assert.equal(formatBuckets([]).size, 0);
  const c = countResults([]);
  assert.deepEqual([c.results, c.held, c.resultsByGame.size, c.heldByGame.size], [0, 0, 0, 0]);
});

// GRAND PRIX WITH TWO PEOPLE IN A KART, and the promise that nothing scoring
// it was touched.
//
// `cupStandings` accumulates PER PLAYER off each race's lines, and a race with
// karts writes one line per racer with the kart's placement on it. So both
// members of a kart that finished first receive 15, and the cup table needs no
// change at all. That is the whole story, and the reason it still gets a test
// file is that "needs no change" is a claim, and a claim about a screen that
// shows a scoring dispute when it is wrong deserves evidence.
//
// THE ACCEPTED DOUBLE COUNT, written down rather than discovered. A four-race
// cup between two karts of two puts 60 points into the table twice over,
// because four people scored. Per player that is correct and the standings
// table is per player: two people on a kart that finished first both genuinely
// finished first, which is the same call Ping Pong took on reign credit. A
// per-KART cup view is a separate decision about what a cup means and is not
// taken here.
//
// DO NOT MODIFY cupStandings OR mkPoints to make anything below read
// differently. The last test in this file is the one that says so in code: the
// cup arithmetic cannot see `side` at all, and it is fed two race logs that
// differ only in that column to prove it.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cupStandings,
  mkPoints,
  mkRaceLines,
  mkSides,
  newMkKartState,
  type MkGame,
  type MkSessionState,
  type Side,
  type SmashPlayer,
} from "../src/index.js";

const roster = (n: number): SmashPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    kind: "member" as const,
    userId: `u${i}`,
    name: `P${i}`,
    character: null,
  }));

const kart = (id: string, ...memberIds: string[]): Side => ({
  id,
  name: `Kart ${id.toUpperCase()}`,
  memberIds,
});

const gp = (players: number, sides?: Side[], raceCount = 4): MkSessionState =>
  newMkKartState({
    format: "grandprix",
    assignment: "self",
    resultDetail: "placement",
    roster: roster(players),
    raceCount,
    sides,
  });

/** Run one race, in the given kart order, into the session. */
function run(state: MkSessionState, order: readonly string[]): MkGame {
  const game: MkGame = {
    idx: state.games.length,
    mode: "ffa",
    at: `2026-08-16T20:0${state.games.length}:00.000Z`,
    lines: mkRaceLines(order, mkSides(state), state.resultDetail, () => null),
  };
  state.games.push(game);
  return game;
}

const table = (state: MkSessionState) =>
  cupStandings(state).standings.map((s) => [s.name, s.points, s.wins, s.races]);

// ---------- pairs ----------

test("GP PAIRS: both racers in a kart receive the KART's points", () => {
  const s = gp(4, [kart("a", "p0", "p1"), kart("b", "p2", "p3")]);
  run(s, ["a", "b"]);
  assert.deepEqual(table(s), [
    ["P0", 15, 1, 1],
    ["P1", 15, 1, 1],
    ["P2", 12, 0, 1],
    ["P3", 12, 0, 1],
  ]);
});

test("GP PAIRS: a full four-race cup, and the standings are still PER PLAYER", () => {
  const s = gp(4, [kart("a", "p0", "p1"), kart("b", "p2", "p3")]);
  run(s, ["a", "b"]);
  run(s, ["b", "a"]);
  run(s, ["a", "b"]);
  run(s, ["a", "b"]);
  const out = cupStandings(s);
  assert.equal(out.cupNo, 1);
  assert.equal(out.racesDone, 4);
  assert.equal(out.complete, true);
  assert.deepEqual(
    out.standings.map((x) => [x.name, x.points, x.wins]),
    [
      ["P0", 57, 3],
      ["P1", 57, 3],
      ["P2", 51, 1],
      ["P3", 51, 1],
    ],
  );
  // The accepted double count, stated as a number rather than as prose: four
  // races between two karts put 4 * (15 + 12) into the table for each SEAT.
  assert.equal(
    out.standings.reduce((n, x) => n + x.points, 0),
    (15 + 12) * 4 * 2,
  );
});

test("GP PAIRS: three karts of two score 15, 12 and 10 down the seats", () => {
  const s = gp(6, [kart("a", "p0", "p1"), kart("b", "p2", "p3"), kart("c", "p4", "p5")]);
  run(s, ["c", "a", "b"]);
  assert.deepEqual(table(s), [
    ["P4", 15, 1, 1],
    ["P5", 15, 1, 1],
    ["P0", 12, 0, 1],
    ["P1", 12, 0, 1],
    ["P2", 10, 0, 1],
    ["P3", 10, 0, 1],
  ]);
});

// ---------- uneven ----------

test("GP UNEVEN: a winning pair takes 15 each and the solo in second takes 12", () => {
  // Named in the session scope as consequence 4 of uneven karts, and it needs
  // no code: the solo racer's kart came second, so the solo racer scores what
  // second pays.
  const s = gp(3, [kart("a", "p0", "p1"), kart("b", "p2")]);
  run(s, ["a", "b"]);
  assert.deepEqual(table(s), [
    ["P0", 15, 1, 1],
    ["P1", 15, 1, 1],
    ["P2", 12, 0, 1],
  ]);
});

test("GP UNEVEN: a winning solo takes 15 and the pair takes 12 each", () => {
  const s = gp(3, [kart("a", "p0", "p1"), kart("b", "p2")]);
  run(s, ["b", "a"]);
  assert.deepEqual(table(s), [
    ["P2", 15, 1, 1],
    ["P0", 12, 0, 1],
    ["P1", 12, 0, 1],
  ]);
});

// ---------- a solo cup has not moved ----------

test("GP SOLO: a four-racer cup scores exactly what it scored before karts", () => {
  // The same four races as the pinned run in mariokart-baseline.test.ts, put
  // through the kart path this time. Same totals, so the path is the same rule.
  const s = gp(4);
  run(s, ["a", "b", "c", "d"]);
  run(s, ["b", "a", "d", "c"]);
  run(s, ["a", "c", "b", "d"]);
  run(s, ["c", "a", "b", "d"]);
  assert.deepEqual(table(s), [
    ["P0", 54, 2, 4],
    ["P1", 47, 1, 4],
    ["P2", 46, 1, 4],
    ["P3", 37, 0, 4],
  ]);
});

test("GP: the cup boundary is unaffected by karts", () => {
  const s = gp(4, [kart("a", "p0", "p1"), kart("b", "p2", "p3")], 2);
  run(s, ["a", "b"]);
  run(s, ["a", "b"]);
  assert.deepEqual(
    [cupStandings(s).cupNo, cupStandings(s).complete],
    [1, true],
    "the cup that just filled is shown, not the empty next one",
  );
  run(s, ["b", "a"]);
  const out = cupStandings(s);
  assert.equal(out.cupNo, 2);
  assert.equal(out.racesDone, 1);
  assert.deepEqual(
    out.standings.map((x) => [x.name, x.points]),
    [
      ["P2", 15],
      ["P3", 15],
      ["P0", 12],
      ["P1", 12],
    ],
    "cup 1's points are not carried forward",
  );
});

test("GP: undoing a race just recomputes, karts or not", () => {
  // There is no stored cup pointer, which was the point of chunking. Popping
  // the last race is the whole undo.
  const s = gp(4, [kart("a", "p0", "p1"), kart("b", "p2", "p3")]);
  run(s, ["a", "b"]);
  run(s, ["b", "a"]);
  s.games.pop();
  assert.deepEqual(table(s), [
    ["P0", 15, 1, 1],
    ["P1", 15, 1, 1],
    ["P2", 12, 0, 1],
    ["P3", 12, 0, 1],
  ]);
});

// ---------- the promise, in code ----------

test("THE POINTS TABLE IS UNTOUCHED, top of the table down", () => {
  assert.deepEqual([1, 2, 3, 4, 12].map(mkPoints), [15, 12, 10, 9, 1]);
  assert.deepEqual([0, 13, -1].map(mkPoints), [0, 0, 0]);
});

test("CUPSTANDINGS CANNOT SEE `side` AT ALL", () => {
  // The strongest form of "it was not modified for this": two race logs that
  // differ ONLY in the side column produce identical standings. If a future
  // pass ever teaches the cup about karts, this fails and the reader is sent
  // back to the double-count paragraph at the top of this file.
  const withSides = gp(4, [kart("a", "p0", "p1"), kart("b", "p2", "p3")]);
  run(withSides, ["a", "b"]);
  run(withSides, ["b", "a"]);

  const stripped = gp(4, [kart("a", "p0", "p1"), kart("b", "p2", "p3")]);
  stripped.games = withSides.games.map((g) => ({
    ...g,
    lines: g.lines.map((l) => ({ ...l, side: null })),
  }));

  assert.deepEqual(cupStandings(stripped), cupStandings(withSides));
});

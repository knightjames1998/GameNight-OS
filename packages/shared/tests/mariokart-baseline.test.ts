// WHAT MARIO KART DOES TODAY, captured by RUNNING the unmodified engine.
//
// This file is written BEFORE the pairs work starts and it contains no
// assertion about pairs at all. That is the whole point of it. The pairs
// session changes MkSessionState, forks the KOTH rotation onto side ids, and
// puts a side log in the middle of a pack that has never had one, and the risk
// in every one of those is not that it breaks loudly. It is that a SOLO night,
// which is every Mario Kart night this crew has ever played, comes out
// fractionally different and nobody notices for a month.
//
// So the numbers below were produced by the shipped code, not reasoned out by
// hand, and they cover all four formats: Free Play and Grand Prix (an FFA race
// with placements), Best Of (a 1v1 series) and King of the Hill (the throne
// rebuilt by replay). Every one of them must still read exactly this way after
// the pairs work lands, with the same roster, in the same order.
//
// The Grand Prix cup arithmetic already has mariokart.test.ts and is not
// duplicated here; what IS here is the cup a whole solo night produces, because
// commit 4's promise is that cupStandings and mkPoints are not touched.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cupStandings,
  kothAdvance,
  newMkKartState,
  openSmashKoth,
  sideOf,
  singletonSides,
  newSeries,
  recordSeriesGame,
  seriesGameTally,
  summarizeNight,
  summarizeSeriesLog,
  type MkFormat,
  type MkSessionState,
  type SmashPlayer,
  type SmashSessionState,
} from "../src/index.js";

const ROSTER: SmashPlayer[] = [
  { id: "p0", kind: "member", userId: "u0", name: "Ann", character: "Mario" },
  { id: "p1", kind: "member", userId: "u1", name: "Ben", character: "Yoshi" },
  { id: "p2", kind: "member", userId: "u2", name: "Cal", character: "Peach" },
  { id: "p3", kind: "guest", userId: null, name: "Dee", character: "Toad" },
];

const state = (format: MkFormat, raceCount = 4): MkSessionState =>
  newMkKartState({
    format,
    assignment: "self",
    resultDetail: "placement",
    roster: ROSTER.map((p) => ({ ...p })),
    bestOf: 3,
    raceCount,
  });

/** One recorded race, finishing in the given slot order. Racers off the roster. */
function race(idx: number, order: readonly string[]) {
  const charOf = new Map(ROSTER.map((p) => [p.id, p.character]));
  return {
    idx,
    mode: "ffa" as const,
    at: `2026-08-16T20:0${idx}:00.000Z`,
    lines: order.map((playerId, i) => ({
      playerId,
      character: charOf.get(playerId) ?? null,
      placement: i + 1,
      isWinner: i === 0,
    })),
  };
}

// ---------- the session a start produces ----------

test("BASELINE: a fresh Mario Kart session has exactly these fields", () => {
  // The field list is the thing that moves when a pack takes a new sub-state,
  // and a field appearing is harmless while a field DISAPPEARING is a live
  // night reading undefined. Sorted so the assertion does not depend on the
  // order the spread happens to produce.
  //
  // `sideSets` was ADDED on 2026-08-16 when karts arrived, and that is the only
  // edit this file has taken. Nothing was removed, which is the half that
  // matters: a session persisted before that deploy still has every field the
  // code reads, and normalizeMkState fills in the one it does not.
  const s = state("free");
  assert.deepEqual(Object.keys(s).sort(), [
    "assignment",
    "bestOf",
    "format",
    "games",
    "grandPrix",
    "koth",
    "mode",
    "openScoring",
    "resultDetail",
    "roster",
    "series",
    "seriesLog",
    "sessionKey",
    "sideSets",
    "titleId",
  ]);
  assert.equal(s.mode, "ffa");
  assert.equal(s.koth, null);
  assert.equal(s.series, null);
  assert.deepEqual(s.seriesLog, []);
  assert.deepEqual(s.games, []);
  assert.equal(s.grandPrix.raceCount, 4);
});

test("BASELINE: a KOTH session is still mode koth with an empty games log", () => {
  const s = state("koth");
  assert.equal(s.mode, "koth");
  assert.equal(s.format, "koth");
});

// ---------- Free Play: the night summary ----------

test("BASELINE: FREE PLAY, two races, the night summary reads exactly this", () => {
  const s = state("free");
  s.games.push(race(0, ["p0", "p1", "p2", "p3"]), race(1, ["p1", "p0", "p3", "p2"]));

  const summary = summarizeNight(s as unknown as SmashSessionState);
  assert.deepEqual(summary.characters, [
    { character: "Mario", played: 2, wins: 1 },
    { character: "Yoshi", played: 2, wins: 1 },
    { character: "Peach", played: 2, wins: 0 },
    { character: "Toad", played: 2, wins: 0 },
  ]);
  assert.deepEqual(summary.players, [
    { playerId: "p0", name: "Ann", played: 2, wins: 1, mainCharacter: "Mario", wonWith: 1 },
    { playerId: "p1", name: "Ben", played: 2, wins: 1, mainCharacter: "Yoshi", wonWith: 1 },
    { playerId: "p2", name: "Cal", played: 2, wins: 0, mainCharacter: "Peach", wonWith: 0 },
    { playerId: "p3", name: "Dee", played: 2, wins: 0, mainCharacter: "Toad", wonWith: 0 },
  ]);
});

test("BASELINE: a race somebody sat out counts only the racers on it", () => {
  const s = state("free");
  s.games.push(race(0, ["p0", "p1", "p2", "p3"]), race(1, ["p1", "p0"]));
  const summary = summarizeNight(s as unknown as SmashSessionState);
  const byId = new Map(summary.players.map((p) => [p.playerId, p]));
  assert.equal(byId.get("p0")!.played, 2);
  assert.equal(byId.get("p2")!.played, 1);
  assert.equal(byId.get("p3")!.played, 1);
});

// ---------- Grand Prix: a whole cup ----------

test("BASELINE: GRAND PRIX, a full four-race cup scores exactly this", () => {
  // Pinned because commit 4's promise is that cupStandings and mkPoints are not
  // touched by the pairs work. 15/12/10/9 down the table, four races.
  const s = state("grandprix", 4);
  s.games.push(
    race(0, ["p0", "p1", "p2", "p3"]),
    race(1, ["p1", "p0", "p3", "p2"]),
    race(2, ["p0", "p2", "p1", "p3"]),
    race(3, ["p2", "p0", "p1", "p3"]),
  );
  const out = cupStandings(s);
  assert.equal(out.cupNo, 1);
  assert.equal(out.racesDone, 4);
  assert.equal(out.complete, true);
  assert.deepEqual(
    out.standings.map((x) => [x.name, x.points, x.wins, x.races]),
    [
      ["Ann", 54, 2, 4],
      ["Ben", 47, 1, 4],
      ["Cal", 46, 1, 4],
      ["Dee", 37, 0, 4],
    ],
  );
});

test("BASELINE: the fifth race opens cup 2 and carries nothing forward", () => {
  const s = state("grandprix", 4);
  for (let i = 0; i < 5; i++) s.games.push(race(i, ["p0", "p1", "p2", "p3"]));
  const out = cupStandings(s);
  assert.equal(out.cupNo, 2);
  assert.equal(out.racesDone, 1);
  assert.deepEqual(
    out.standings.map((x) => [x.name, x.points]),
    [
      ["Ann", 15],
      ["Ben", 12],
      ["Cal", 10],
      ["Dee", 9],
    ],
  );
});

// ---------- Best Of: a 1v1 series ----------

test("BASELINE: BEST OF, a bo3 that goes the distance records exactly this", () => {
  const ser = newSeries("p0", "p1")!;
  assert.equal(recordSeriesGame(ser, 3, "p0").completed, false);
  assert.equal(recordSeriesGame(ser, 3, "p1").completed, false);
  assert.equal(recordSeriesGame(ser, 3, "p0").completed, true);

  assert.equal(ser.winnerId, "p0");
  assert.deepEqual(ser.games, [{ winnerId: "p0" }, { winnerId: "p1" }, { winnerId: "p0" }]);
  assert.deepEqual(
    [...seriesGameTally(ser)],
    [
      ["p0", { wins: 2, played: 3 }],
      ["p1", { wins: 1, played: 3 }],
    ],
  );

  ser.idx = 0;
  assert.deepEqual(
    [...summarizeSeriesLog([ser]).values()],
    [
      { slotId: "p0", seriesWins: 1, seriesPlayed: 1, gameWins: 2, gamesPlayed: 3, currentStreak: 1, bestStreak: 1 },
      { slotId: "p1", seriesWins: 0, seriesPlayed: 1, gameWins: 1, gamesPlayed: 3, currentStreak: 0, bestStreak: 0 },
    ],
  );
});

// ---------- King of the Hill: the throne, rebuilt by replay ----------

/** The solo arrangement: one kart per racer, in roster order. */
const KARTS = singletonSides(ROSTER.map((p) => p.id));
/** The one racer a singleton kart holds, so every step below reads in racers. */
const racerIn = (sideId: string | null | undefined): string | null =>
  KARTS.find((s) => s.id === sideId)?.memberIds[0] ?? null;

/**
 * The throne rebuild EXACTLY as apps/server/src/mariokart.ts does it on undo
 * today: start from the roster order and replay every remaining race through
 * kothAdvance. Copied here rather than imported because the server route is not
 * a function, and this is the sequence the side-keyed rotation has to reproduce
 * for a solo night.
 *
 * AMENDED 2026-09-05. `kothAdvance` was keyed on player ids when this fixture
 * was captured; the Smash team-battles session moved it onto SIDES, which is
 * what `mkKothAdvance` had already forked to do and is now the same function.
 * So the fold runs over the singleton arrangement and maps each kart back to
 * the one racer it holds. NOT ONE ASSERTED VALUE BELOW CHANGED, which is the
 * point: this fixture is why that move was safe to make.
 */
function replayThrone(winners: readonly [string, string][]) {
  const kartFor = (playerId: string) => sideOf(KARTS, playerId)!;
  let koth = openSmashKoth(KARTS);
  const steps: { kingId: string | null; queue: (string | null)[]; streak: number }[] = [];
  for (const [winnerId, loserId] of winners) {
    koth = kothAdvance(koth, kartFor(winnerId), kartFor(loserId));
    steps.push({ kingId: racerIn(koth.kingSideId), queue: koth.queue.map(racerIn), streak: koth.streak });
  }
  return { koth, steps };
}

test("BASELINE: KOTH, the winner holds and the loser goes to the BACK", () => {
  // Ann is king, Ben challenges and loses, so the line becomes Cal, Dee, Ben.
  const { steps } = replayThrone([["p0", "p1"]]);
  assert.deepEqual(steps[0], { kingId: "p0", queue: ["p2", "p3", "p1"], streak: 1 });
});

test("BASELINE: KOTH, a full ladder replays to exactly this throne and queue", () => {
  const { koth, steps } = replayThrone([
    ["p0", "p1"], // Ann defends
    ["p0", "p2"], // Ann defends again
    ["p3", "p0"], // Dee takes it
    ["p3", "p1"], // Dee defends
  ]);
  assert.deepEqual(steps, [
    { kingId: "p0", queue: ["p2", "p3", "p1"], streak: 1 },
    { kingId: "p0", queue: ["p3", "p1", "p2"], streak: 2 },
    { kingId: "p3", queue: ["p1", "p2", "p0"], streak: 1 },
    { kingId: "p3", queue: ["p2", "p0", "p1"], streak: 2 },
  ]);
  // bestStreak names the KART and carries its members; on a solo night that is
  // the one racer, which is the same fact the pre-pairs `{ playerId, streak }`
  // held.
  assert.deepEqual({ memberIds: koth.bestStreak!.memberIds, streak: koth.bestStreak!.streak }, {
    memberIds: ["p0"],
    streak: 2,
  });
});

test("BASELINE: KOTH, undoing the last race is the replay of what is left", () => {
  // The whole reason the throne is rebuilt rather than unwound. Replaying the
  // first three of four races has to give the same answer as the third step of
  // replaying all four, and it is the property the side-keyed rotation inherits.
  const full = replayThrone([["p0", "p1"], ["p0", "p2"], ["p3", "p0"], ["p3", "p1"]]);
  const short = replayThrone([["p0", "p1"], ["p0", "p2"], ["p3", "p0"]]);
  assert.deepEqual(short.steps, full.steps.slice(0, 3));
  assert.deepEqual({ kingId: racerIn(short.koth.kingSideId), queue: short.koth.queue.map(racerIn) }, {
    kingId: "p3",
    queue: ["p1", "p2", "p0"],
  });
});

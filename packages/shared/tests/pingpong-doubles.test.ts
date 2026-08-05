// Ping Pong with sides: the half that did not exist before.
//
// The singles fixtures next door prove the conversion changed nothing that was
// already there. This file proves the new behaviour is the behaviour that was
// asked for, and it leans hardest on the three things that would be silent if
// wrong: the placement a doubles match writes, the side value on each row, and
// what a reshuffle does to a ladder that is REBUILT rather than maintained.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentSides,
  finalizeCurrent,
  isDoubles,
  matchGameTally,
  newPingPongState,
  normalizePpState,
  ppMatchLines,
  recordGame,
  reshuffleSides,
  startFfaMatch,
  summarizePingPong,
  undoLast,
  type PpPlayer,
  type PpSessionState,
  type Side,
} from "../src/index.js";

const players = (n: number): PpPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    kind: "member" as const,
    userId: `u${i}`,
    name: `P${i}`,
  }));

const pair = (id: string, ...memberIds: string[]): Side => ({
  id,
  name: `Side ${id.toUpperCase()}`,
  memberIds,
});

/** p0+p1 against p2+p3. */
const DOUBLES: Side[] = [pair("a", "p0", "p1"), pair("b", "p2", "p3")];

const doublesFree = (): PpSessionState =>
  newPingPongState({ format: "free", mode: "ffa", bestOf: 1, roster: players(4), sides: DOUBLES });

const doublesKoth = (sides: Side[], roster = players(6)): PpSessionState =>
  newPingPongState({ format: "koth", mode: "koth", bestOf: 1, roster, sides });

// ---------- the rows a doubles match writes ----------

test("DOUBLES: a 2v2 writes 1,1,2,2 and a side on every row", () => {
  const s = doublesFree();
  assert.equal(isDoubles(s), true);
  startFfaMatch(s, "a", "b");
  const { completed } = recordGame(s, "a", 18);
  assert.deepEqual(ppMatchLines(completed!), [
    { playerId: "p0", placement: 1, isWinner: true, score: 0, meta: { gameWins: 1, gamesPlayed: 1 }, side: "a" },
    { playerId: "p1", placement: 1, isWinner: true, score: 0, meta: { gameWins: 1, gamesPlayed: 1 }, side: "a" },
    { playerId: "p2", placement: 2, isWinner: false, score: 18, meta: { gameWins: 0, gamesPlayed: 1 }, side: "b" },
    { playerId: "p3", placement: 2, isWinner: false, score: 18, meta: { gameWins: 0, gamesPlayed: 1 }, side: "b" },
  ]);
});

test("DOUBLES: partners share a side value and opponents do not", () => {
  // That equality is the entire contract of the column, and it is what
  // meetingOutcome reads to classify two partners as having played TOGETHER.
  const s = doublesFree();
  startFfaMatch(s, "a", "b");
  const { completed } = recordGame(s, "b", 12);
  const bySide = new Map(ppMatchLines(completed!).map((l) => [l.playerId, l.side]));
  assert.equal(bySide.get("p0"), bySide.get("p1"));
  assert.equal(bySide.get("p2"), bySide.get("p3"));
  assert.notEqual(bySide.get("p0"), bySide.get("p2"));
});

test("DOUBLES: POINTS GO ON EVERY MEMBER OF THE LOSING SIDE", () => {
  // James's call. Both players on a side that lost 18-21 carry 18: it is what
  // each of them scored as a side, and it reads the way a singles row does.
  const s = doublesFree();
  startFfaMatch(s, "a", "b");
  const { completed } = recordGame(s, "a", 18);
  const scores = new Map(ppMatchLines(completed!).map((l) => [l.playerId, l.score]));
  assert.equal(scores.get("p2"), 18);
  assert.equal(scores.get("p3"), 18);
  // And the winning side carries 0, not the loser's number.
  assert.equal(scores.get("p0"), 0);
});

test("DOUBLES: a bo3's points sum per SIDE across the games it lost", () => {
  const s = newPingPongState({ format: "bestof", mode: "ffa", bestOf: 3, roster: players(4), sides: DOUBLES });
  startFfaMatch(s, "a", "b");
  recordGame(s, "a", 19); // b lost with 19
  recordGame(s, "b", 21); // a lost with 21
  const { completed } = recordGame(s, "a", 17); // b lost with 17
  const lines = ppMatchLines(completed!);
  const scores = new Map(lines.map((l) => [l.playerId, l.score]));
  assert.equal(scores.get("p2"), 36); // 19 + 17
  assert.equal(scores.get("p3"), 36);
  assert.equal(scores.get("p0"), 21);
  assert.equal(scores.get("p1"), 21);
  // Game wins are per player and credit both members of the side.
  assert.deepEqual(matchGameTally(completed!).get("p1"), { wins: 2, played: 3 });
  assert.deepEqual(matchGameTally(completed!).get("p3"), { wins: 1, played: 3 });
});

test("DOUBLES: uneven sides still rank by side", () => {
  // Three against two, which is a real thing a crew does and is warned about
  // rather than blocked.
  const s = newPingPongState({
    format: "free",
    mode: "ffa",
    bestOf: 1,
    roster: players(5),
    sides: [pair("a", "p0", "p1", "p2"), pair("b", "p3", "p4")],
  });
  startFfaMatch(s, "a", "b");
  const { completed } = recordGame(s, "b", 9);
  assert.deepEqual(ppMatchLines(completed!).map((l) => l.placement), [1, 1, 2, 2, 2]);
  assert.deepEqual(ppMatchLines(completed!).map((l) => l.side), ["b", "b", "a", "a", "a"]);
});

test("DOUBLES: an abandoned set finalizes to the leading SIDE", () => {
  const s = newPingPongState({ format: "bestof", mode: "ffa", bestOf: 5, roster: players(4), sides: DOUBLES });
  startFfaMatch(s, "a", "b");
  recordGame(s, "a", 14);
  recordGame(s, "b", 15);
  recordGame(s, "a", 16);
  const finalized = finalizeCurrent(s)!;
  assert.equal(finalized.winnerSideId, "a");
  assert.deepEqual(ppMatchLines(finalized).filter((l) => l.isWinner).map((l) => l.playerId), ["p0", "p1"]);
});

// ---------- standings ----------

test("DOUBLES: both members of a winning pair get the win", () => {
  const s = doublesFree();
  startFfaMatch(s, "a", "b");
  recordGame(s, "a", 11);
  recordGame(s, "a", 12);
  const { players: rows } = summarizePingPong(s);
  const by = new Map(rows.map((r) => [r.playerId, r]));
  for (const id of ["p0", "p1"]) {
    assert.equal(by.get(id)!.wins, 2, id);
    assert.equal(by.get(id)!.matches, 2, id);
    assert.equal(by.get(id)!.currentStreak, 2, id);
  }
  for (const id of ["p2", "p3"]) {
    assert.equal(by.get(id)!.wins, 0, id);
    assert.equal(by.get(id)!.matches, 2, id);
  }
});

// ---------- KOTH with pairs ----------

const THREE_PAIRS = [pair("a", "p0", "p1"), pair("b", "p2", "p3"), pair("c", "p4", "p5")];

test("DOUBLES KOTH: THE WINNING PAIR STAYS, THE LOSING PAIR GOES TO THE BACK TOGETHER", () => {
  const s = doublesKoth(THREE_PAIRS);
  assert.deepEqual(s.koth, { kingSideId: "a", queue: ["b", "c"], reign: 0, bestReign: null });
  recordGame(s, "a", 12);
  assert.deepEqual(s.koth!.kingSideId, "a");
  assert.deepEqual(s.koth!.queue, ["c", "b"]);
  // The whole pair rotates, not one of its members.
  assert.deepEqual(s.current!.a.memberIds, ["p0", "p1"]);
  assert.deepEqual(s.current!.b.memberIds, ["p4", "p5"]);
});

test("DOUBLES KOTH: the reign record names the PAIR and credits both members", () => {
  // James's call: the record is both things at once.
  const s = doublesKoth(THREE_PAIRS);
  recordGame(s, "a", 1); // a beats b, queue [c, b], a vs c next
  recordGame(s, "a", 2); // a beats c, queue [b, c], a vs b next
  recordGame(s, "b", 3); // b takes the table off a
  assert.deepEqual(s.koth!.bestReign, { sideId: "a", memberIds: ["p0", "p1"], reign: 2 });

  const summary = summarizePingPong(s);
  assert.deepEqual(summary.bestReign, { sideId: "a", memberIds: ["p0", "p1"], reign: 2 });
  const by = new Map(summary.players.map((r) => [r.playerId, r]));
  assert.equal(by.get("p0")!.longestReign, 2);
  assert.equal(by.get("p1")!.longestReign, 2);
  // The pair that just took it has a reign of one, both members.
  assert.equal(by.get("p2")!.longestReign, 1);
  assert.equal(by.get("p3")!.longestReign, 1);
  // The pair that has only ever lost has none.
  assert.equal(by.get("p4")!.longestReign, 0);
});

test("DOUBLES KOTH: a side that is not at the table cannot be recorded as winning", () => {
  // The mistake that wrote the test above wrong the first time, so it is worth
  // an assertion of its own: recordGame ignores a winner that is not in the
  // match rather than inventing a result.
  const s = doublesKoth(THREE_PAIRS);
  recordGame(s, "a", 1);
  recordGame(s, "a", 2); // a vs b is now teed up; c is in the queue
  assert.equal(recordGame(s, "c", 3).completed, null);
  assert.equal(s.matches.length, 2);
});

test("DOUBLES KOTH: undo rebuilds the ladder in pairs", () => {
  const s = doublesKoth(THREE_PAIRS);
  recordGame(s, "a", 1);
  recordGame(s, "c", 2);
  assert.equal(s.koth!.kingSideId, "c");
  assert.deepEqual(undoLast(s), { unmaterializeIdx: 1 });
  assert.deepEqual(s.koth, {
    kingSideId: "a",
    queue: ["c", "b"],
    reign: 1,
    bestReign: { sideId: "a", memberIds: ["p0", "p1"], reign: 1 },
  });
});

// ---------- the reshuffle, and the boundary it creates ----------

test("RESHUFFLE: takes effect from the next match and leaves history alone", () => {
  const s = doublesFree();
  startFfaMatch(s, "a", "b");
  recordGame(s, "a", 10);
  // p0 swaps partners.
  assert.equal(reshuffleSides(s, [pair("a", "p0", "p2"), pair("b", "p1", "p3")]), null);
  assert.deepEqual(s.sideSets.map((x) => x.fromIdx), [0, 1]);
  // The match already played still knows who was actually on it.
  assert.deepEqual(s.matches[0]!.a.memberIds, ["p0", "p1"]);
  startFfaMatch(s, "a", "b");
  const { completed } = recordGame(s, "a", 13);
  assert.deepEqual(completed!.a.memberIds, ["p0", "p2"]);
});

test("RESHUFFLE: refuses mid-match and refuses a bad arrangement", () => {
  const s = newPingPongState({ format: "bestof", mode: "ffa", bestOf: 3, roster: players(4), sides: DOUBLES });
  startFfaMatch(s, "a", "b");
  recordGame(s, "a", 11);
  assert.match(reshuffleSides(s, [pair("a", "p0", "p2"), pair("b", "p1", "p3")])!, /Finish the match/);
  // And the validation from the primitive is not re-implemented here.
  const fresh = doublesFree();
  assert.match(reshuffleSides(fresh, [pair("a", "p0", "p1")])!, /at least 2 sides/);
  assert.match(reshuffleSides(fresh, [pair("a", "p0"), pair("b", "p0")])!, /one side/);
  assert.match(reshuffleSides(fresh, [pair("a", "ghost"), pair("b", "p1")])!, /not in this session/);
});

test("RESHUFFLE: changing your mind twice does not stack dead arrangements", () => {
  const s = doublesFree();
  assert.equal(reshuffleSides(s, [pair("a", "p0", "p2"), pair("b", "p1", "p3")]), null);
  assert.equal(reshuffleSides(s, [pair("a", "p0", "p3"), pair("b", "p1", "p2")]), null);
  assert.equal(s.sideSets.length, 1);
  assert.deepEqual(currentSides(s)[0]!.memberIds, ["p0", "p3"]);
});

test("RESHUFFLE: KOTH restarts the ladder from the new arrangement", () => {
  const s = doublesKoth(THREE_PAIRS);
  recordGame(s, "a", 1);
  recordGame(s, "a", 2);
  assert.equal(s.koth!.reign, 2);
  assert.equal(reshuffleSides(s, [pair("a", "p0", "p2"), pair("b", "p1", "p3"), pair("c", "p4", "p5")]), null);
  // A queue of sides that no longer exist is not a queue.
  assert.deepEqual(s.koth, { kingSideId: "a", queue: ["b", "c"], reign: 0, bestReign: null });
  assert.deepEqual(s.current!.a.memberIds, ["p0", "p2"]);
});

test("RESHUFFLE: UNDOING BACK PAST IT RESTORES THE OLD ARRANGEMENT", () => {
  // The case that makes the side set a LOG rather than a field. Without it the
  // rebuild replays old matches under new sides, and the throne ends up held by
  // a pair that never played.
  const s = doublesKoth(THREE_PAIRS);
  recordGame(s, "a", 1);
  assert.equal(reshuffleSides(s, [pair("a", "p0", "p2"), pair("b", "p1", "p3"), pair("c", "p4", "p5")]), null);
  assert.equal(s.sideSets.length, 2);
  undoLast(s);
  assert.equal(s.sideSets.length, 1);
  assert.deepEqual(currentSides(s)[0]!.memberIds, ["p0", "p1"]);
  assert.deepEqual(s.koth, { kingSideId: "a", queue: ["b", "c"], reign: 0, bestReign: null });
});

// ---------- legacy state ----------

test("LEGACY: a session persisted before sides loads and resolves", () => {
  // The exact shape that is sitting in game_sessions right now: aId/bId on a
  // match, winnerId on a game, a kingId and a queue of PLAYER ids on koth, and
  // no sideSets at all.
  const legacy = {
    sessionKey: "abc123",
    format: "koth",
    mode: "koth",
    bestOf: 1,
    openScoring: false,
    roster: players(3),
    matches: [
      {
        idx: 0,
        aId: "p0",
        bId: "p1",
        games: [{ winnerId: "p0", loserPoints: 17 }],
        winnerId: "p0",
        at: "2026-08-04T20:00:00.000Z",
      },
    ],
    current: { idx: -1, aId: "p0", bId: "p2", games: [], winnerId: null, at: null },
    koth: { kingId: "p0", queue: ["p2", "p1"], reign: 1, bestReign: { playerId: "p0", reign: 1 } },
  } as unknown as PpSessionState;

  const s = normalizePpState(legacy);
  assert.deepEqual(s.sideSets, [
    {
      fromIdx: 0,
      sides: [
        { id: "a", name: "Side A", memberIds: ["p0"] },
        { id: "b", name: "Side B", memberIds: ["p1"] },
        { id: "c", name: "Side C", memberIds: ["p2"] },
      ],
    },
  ]);
  assert.equal(s.koth!.kingSideId, "a");
  assert.deepEqual(s.koth!.queue, ["c", "b"]);
  assert.deepEqual(s.koth!.bestReign, { sideId: "a", memberIds: ["p0"], reign: 1 });
  assert.deepEqual(s.current!.a.memberIds, ["p0"]);
  assert.deepEqual(s.current!.b.memberIds, ["p2"]);

  // AND THE OLD MATCH STILL WRITES THE ROWS IT ALWAYS WROTE, side null, which
  // is what makes an in-flight night survive the deploy.
  assert.deepEqual(ppMatchLines(s.matches[0]!), [
    { playerId: "p0", placement: 1, isWinner: true, score: 0, meta: { gameWins: 1, gamesPlayed: 1 }, side: null },
    { playerId: "p1", placement: 2, isWinner: false, score: 17, meta: { gameWins: 0, gamesPlayed: 1 }, side: null },
  ]);
});

test("LEGACY: normalizing is idempotent and leaves a converted session alone", () => {
  const s = doublesFree();
  startFfaMatch(s, "a", "b");
  recordGame(s, "a", 10);
  const once = normalizePpState(s);
  const twice = normalizePpState(once);
  assert.deepEqual(twice, once);
  assert.deepEqual(twice.sideSets, s.sideSets);
});

test("LEGACY: a session with no matches at all normalizes cleanly", () => {
  const legacy = {
    sessionKey: "k",
    format: "free",
    mode: "ffa",
    bestOf: 1,
    openScoring: false,
    roster: players(2),
    matches: [],
    current: null,
    koth: null,
  } as unknown as PpSessionState;
  const s = normalizePpState(legacy);
  assert.equal(s.sideSets.length, 1);
  assert.equal(s.sideSets[0]!.sides.length, 2);
  assert.equal(s.current, null);
  assert.equal(s.koth, null);
  assert.equal(isDoubles(s), false);
});

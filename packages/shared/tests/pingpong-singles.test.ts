// SINGLES, PINNED. This file exists to fail if the side conversion changes what
// a singles Ping Pong night does, in any way, anywhere.
//
// WHY IT IS WRITTEN BEFORE THE CONVERSION AND NOT AFTER. A test written after a
// refactor can only tell you the refactor agrees with itself: it canonises
// whatever the new code happens to do, including the bug. So every expected
// value below was captured by RUNNING THE UNMODIFIED ENGINE and transcribing
// what it produced, and the file was confirmed green on the untouched tree
// before a single line of the conversion was written. That is the same
// discipline the pack-runtime refactor used on its four ledgerKey functions,
// and for the same reason: the failure here is silent. A singles match that
// starts writing a `side` value, or renumbers a placement, or loses a game
// tally out of meta, does not error. It just quietly disagrees with every
// singles row already in the database.
//
// The three things pinned, because these are the three that reach the ledger or
// a screen:
//   - ppMatchLines: the exact participant rows one completed match writes,
//   - summarizePingPong: the night standings the page and TV render,
//   - the KOTH throne and queue, including the rebuild that undo depends on.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  finalizeCurrent,
  gameWins,
  matchGameTally,
  neededWins,
  newPingPongState,
  ppMatchLabel,
  ppMatchLines,
  ppModeBestOf,
  recordGame,
  startFfaMatch,
  summarizePingPong,
  undoLast,
  currentSides,
  type PpPlayer,
  type PpSessionState,
} from "../src/index.js";

// The engine speaks in SIDE ids now, and a singles session is one side per
// player in roster order, so p0 sits on side "a", p1 on "b" and so on. These
// two helpers are the whole translation: every EXPECTED VALUE below is
// unchanged from what the pre-conversion engine produced.
const S = ["a", "b", "c", "d"];
/** The members of the two sides teed up right now, as player ids. */
const teed = (state: PpSessionState) =>
  state.current ? [state.current.a.memberIds, state.current.b.memberIds] : null;
/**
 * The KOTH throne and queue in MEMBER terms.
 *
 * The koth STATE SHAPE changed by design in this conversion (kingId became
 * kingSideId, the queue holds side ids, and the reign record names a side), so
 * a deepEqual against the old shape could not survive it. Reading it through
 * members instead says exactly what the old assertions said: for a singles
 * night, side "a" IS p0, so `king: ["p0"]` is the same claim `kingId: "p0"`
 * was. Every expected value below is unchanged.
 */
const kothMembers = (state: PpSessionState) => {
  const k = state.koth!;
  const members = (id: string | null) =>
    id ? currentSides(state.sideSets).find((s) => s.id === id)?.memberIds ?? null : null;
  return {
    king: members(k.kingSideId),
    queue: k.queue.map(members),
    reign: k.reign,
    best: k.bestReign ? { members: k.bestReign.memberIds, reign: k.bestReign.reign } : null,
  };
};

const players = (...names: string[]): PpPlayer[] =>
  names.map((name, i) => ({ id: `p${i}`, kind: "member", userId: `u${i}`, name }));

const ROSTER = players("Ann", "Ben", "Cal", "Dee");

/** A free-play singles session: mode ffa, bestOf 1. */
const freePlay = (): PpSessionState =>
  newPingPongState({ format: "free", mode: "ffa", bestOf: 1, roster: ROSTER });

/** A best-of-N singles session. */
const bestOf = (n: 3 | 5 | 7): PpSessionState =>
  newPingPongState({ format: "bestof", mode: "ffa", bestOf: n, roster: ROSTER });

/** A KOTH session: p0 opens on the throne, p1 challenges. */
const koth = (): PpSessionState =>
  newPingPongState({ format: "koth", mode: "koth", bestOf: 1, roster: ROSTER });

/** Strip a summary to the fields worth pinning, in roster order. */
const standings = (state: PpSessionState) =>
  summarizePingPong(state).players.map((p) => ({
    playerId: p.playerId,
    matches: p.matches,
    wins: p.wins,
    gameWins: p.gameWins,
    gamesPlayed: p.gamesPlayed,
    currentStreak: p.currentStreak,
    bestStreak: p.bestStreak,
    longestReign: p.longestReign,
  }));

// ---------- the format expansion ----------

test("SINGLES: the format expansion is unchanged", () => {
  assert.deepEqual(ppModeBestOf("free", 1), { mode: "ffa", bestOf: 1 });
  assert.deepEqual(ppModeBestOf("bestof", 5), { mode: "ffa", bestOf: 5 });
  // A bestof session that somehow arrives with length 1 is bumped to 3, since
  // "best of 1" is free play under another name.
  assert.deepEqual(ppModeBestOf("bestof", 1), { mode: "ffa", bestOf: 3 });
  assert.deepEqual(ppModeBestOf("koth", 7), { mode: "koth", bestOf: 1 });
  assert.deepEqual([1, 3, 5, 7].map(neededWins as (n: 1 | 3 | 5 | 7) => number), [1, 2, 3, 4]);
});

// ---------- free play ----------

test("SINGLES: one free-play game writes exactly two rows, and NO side", () => {
  const s = freePlay();
  assert.ok(startFfaMatch(s, S[0]!, S[1]!));
  const { completed } = recordGame(s, S[0]!, 18);
  assert.ok(completed);

  assert.equal(ppMatchLabel(s), "bo1");
  assert.deepEqual(ppMatchLines(completed!), [
    { playerId: "p0", placement: 1, isWinner: true, score: 0, meta: { gameWins: 1, gamesPlayed: 1 }, side: null },
    { playerId: "p1", placement: 2, isWinner: false, score: 18, meta: { gameWins: 0, gamesPlayed: 1 }, side: null },
  ]);
});

test("SINGLES: with no points typed anywhere, score is NULL and not zero", () => {
  const s = freePlay();
  startFfaMatch(s, S[0]!, S[1]!);
  const { completed } = recordGame(s, S[1]!, null);
  assert.deepEqual(ppMatchLines(completed!), [
    { playerId: "p1", placement: 1, isWinner: true, score: null, meta: { gameWins: 1, gamesPlayed: 1 }, side: null },
    { playerId: "p0", placement: 2, isWinner: false, score: null, meta: { gameWins: 0, gamesPlayed: 1 }, side: null },
  ]);
});

test("SINGLES: free play keeps the same two teed up", () => {
  const s = freePlay();
  startFfaMatch(s, S[0]!, S[1]!);
  recordGame(s, S[0]!, 15);
  assert.deepEqual(teed(s), [["p0"], ["p1"]]);
  assert.equal(s.current?.games.length, 0);
  assert.equal(s.matches.length, 1);
});

test("SINGLES: a free-play night's standings", () => {
  const s = freePlay();
  startFfaMatch(s, S[0]!, S[1]!);
  recordGame(s, S[0]!, 12);
  recordGame(s, S[0]!, 9);
  recordGame(s, S[1]!, 20);
  assert.deepEqual(standings(s), [
    { playerId: "p0", matches: 3, wins: 2, gameWins: 2, gamesPlayed: 3, currentStreak: 0, bestStreak: 2, longestReign: 0 },
    { playerId: "p1", matches: 3, wins: 1, gameWins: 1, gamesPlayed: 3, currentStreak: 1, bestStreak: 1, longestReign: 0 },
    { playerId: "p2", matches: 0, wins: 0, gameWins: 0, gamesPlayed: 0, currentStreak: 0, bestStreak: 0, longestReign: 0 },
    { playerId: "p3", matches: 0, wins: 0, gameWins: 0, gamesPlayed: 0, currentStreak: 0, bestStreak: 0, longestReign: 0 },
  ]);
});

// ---------- best of ----------

test("SINGLES: a bo3 materializes once, on the deciding game", () => {
  const s = bestOf(3);
  startFfaMatch(s, S[0]!, S[1]!);
  assert.equal(recordGame(s, S[0]!, 19).completed, null);
  assert.equal(recordGame(s, S[1]!, 21).completed, null);
  const { completed } = recordGame(s, S[0]!, 17);
  assert.ok(completed);
  assert.equal(s.matches.length, 1);
  // The set is over, so nothing is teed up.
  assert.equal(s.current, null);

  assert.equal(ppMatchLabel(s), "bo3");
  assert.deepEqual(gameWins(completed!), { a: 2, b: 1 });
  // Per-player game wins ride meta, which is what makes lifetime single-game
  // totals possible from a ledger that holds only the match.
  assert.deepEqual(ppMatchLines(completed!), [
    { playerId: "p0", placement: 1, isWinner: true, score: 21, meta: { gameWins: 2, gamesPlayed: 3 }, side: null },
    { playerId: "p1", placement: 2, isWinner: false, score: 36, meta: { gameWins: 1, gamesPlayed: 3 }, side: null },
  ]);
});

test("SINGLES: matchGameTally counts both players every game", () => {
  const s = bestOf(5);
  startFfaMatch(s, S[2]!, S[3]!);
  recordGame(s, S[2]!, 10);
  recordGame(s, S[3]!, 11);
  recordGame(s, S[2]!, 12);
  const { completed } = recordGame(s, S[2]!, 13);
  const tally = matchGameTally(completed!);
  assert.deepEqual(tally.get("p2"), { wins: 3, played: 4 });
  assert.deepEqual(tally.get("p3"), { wins: 1, played: 4 });
});

test("SINGLES: an abandoned bo5 finalizes to the game leader", () => {
  const s = bestOf(5);
  startFfaMatch(s, S[0]!, S[1]!);
  recordGame(s, S[0]!, 14);
  recordGame(s, S[1]!, 15);
  recordGame(s, S[0]!, 16);
  const finalized = finalizeCurrent(s);
  assert.ok(finalized);
  // Same claim as the old `winnerId === "p0"`: side "a" is p0 in a singles night.
  assert.deepEqual(currentSides(s.sideSets).find((x) => x.id === finalized!.winnerSideId)?.memberIds, ["p0"]);
  assert.equal(finalized!.idx, 0);
  assert.deepEqual(ppMatchLines(finalized!), [
    { playerId: "p0", placement: 1, isWinner: true, score: 15, meta: { gameWins: 2, gamesPlayed: 3 }, side: null },
    { playerId: "p1", placement: 2, isWinner: false, score: 30, meta: { gameWins: 1, gamesPlayed: 3 }, side: null },
  ]);
});

test("SINGLES: a dead-level abandoned set stays unrecorded", () => {
  const s = bestOf(5);
  startFfaMatch(s, S[0]!, S[1]!);
  recordGame(s, S[0]!, 14);
  recordGame(s, S[1]!, 15);
  assert.equal(finalizeCurrent(s), null);
  assert.equal(s.matches.length, 0);
});

test("SINGLES: startFfaMatch refuses to clobber a set in progress", () => {
  const s = bestOf(3);
  assert.equal(startFfaMatch(s, S[0]!, S[1]!), true);
  recordGame(s, S[0]!, 11);
  assert.equal(startFfaMatch(s, S[2]!, S[3]!), false);
  assert.deepEqual(teed(s), [["p0"], ["p1"]]);
  // And it refuses nonsense pairings.
  const fresh = bestOf(3);
  assert.equal(startFfaMatch(fresh, S[0]!, S[0]!), false);
  assert.equal(startFfaMatch(fresh, S[0]!, "ghost"), false);
});

// ---------- king of the hill ----------

test("SINGLES KOTH: the opening throne and queue", () => {
  const s = koth();
  assert.deepEqual(kothMembers(s), { king: ["p0"], queue: [["p1"], ["p2"], ["p3"]], reign: 0, best: null });
  assert.deepEqual(teed(s), [["p0"], ["p1"]]);
});

test("SINGLES KOTH: winner stays, loser goes to the back", () => {
  const s = koth();
  recordGame(s, S[0]!, 12);
  assert.deepEqual(kothMembers(s), {
    king: ["p0"],
    queue: [["p2"], ["p3"], ["p1"]],
    reign: 1,
    best: { members: ["p0"], reign: 1 },
  });
  assert.deepEqual(teed(s), [["p0"], ["p2"]]);
});

test("SINGLES KOTH: the throne changes hands and the reign resets to 1", () => {
  const s = koth();
  recordGame(s, S[0]!, 12); // p0 beats p1
  recordGame(s, S[0]!, 13); // p0 beats p2
  recordGame(s, S[3]!, 14); // p3 takes the throne
  assert.deepEqual(kothMembers(s), {
    king: ["p3"],
    queue: [["p1"], ["p2"], ["p0"]],
    reign: 1,
    best: { members: ["p0"], reign: 2 },
  });
});

test("SINGLES KOTH: a KOTH night's standings, longestReign included", () => {
  const s = koth();
  recordGame(s, S[0]!, 12);
  recordGame(s, S[0]!, 13);
  recordGame(s, S[3]!, 14);
  recordGame(s, S[3]!, 15);
  // Transcribed from the unmodified engine, and the first draft of this
  // expectation was WRONG in three places because it was reasoned out by hand
  // instead: the queue rotation puts p1 back in at match 4, so p1 plays twice
  // and p2 only once, and the sort puts p3 above p0 on win rate. That is the
  // argument for capturing a fixture by running the thing.
  assert.deepEqual(standings(s), [
    { playerId: "p3", matches: 2, wins: 2, gameWins: 2, gamesPlayed: 2, currentStreak: 2, bestStreak: 2, longestReign: 2 },
    { playerId: "p0", matches: 3, wins: 2, gameWins: 2, gamesPlayed: 3, currentStreak: 0, bestStreak: 2, longestReign: 2 },
    { playerId: "p1", matches: 2, wins: 0, gameWins: 0, gamesPlayed: 2, currentStreak: 0, bestStreak: 0, longestReign: 0 },
    { playerId: "p2", matches: 1, wins: 0, gameWins: 0, gamesPlayed: 1, currentStreak: 0, bestStreak: 0, longestReign: 0 },
  ]);
});

test("SINGLES KOTH: a match writes the same two rows as any other", () => {
  const s = koth();
  const { completed } = recordGame(s, S[1]!, 19);
  assert.equal(ppMatchLabel(s), "bo1");
  assert.deepEqual(ppMatchLines(completed!), [
    { playerId: "p1", placement: 1, isWinner: true, score: 0, meta: { gameWins: 1, gamesPlayed: 1 }, side: null },
    { playerId: "p0", placement: 2, isWinner: false, score: 19, meta: { gameWins: 0, gamesPlayed: 1 }, side: null },
  ]);
});

// ---------- undo ----------

test("SINGLES: undo mid-set drops one game and materializes nothing", () => {
  const s = bestOf(3);
  startFfaMatch(s, S[0]!, S[1]!);
  recordGame(s, S[0]!, 11);
  recordGame(s, S[1]!, 12);
  assert.deepEqual(undoLast(s), { unmaterializeIdx: null });
  assert.equal(s.current?.games.length, 1);
  assert.equal(s.matches.length, 0);
});

test("SINGLES: undo of a completed match reports its idx", () => {
  const s = freePlay();
  startFfaMatch(s, S[0]!, S[1]!);
  recordGame(s, S[0]!, 11);
  recordGame(s, S[0]!, 12);
  // The current match has no games, so undo pops the last COMPLETED one.
  assert.deepEqual(undoLast(s), { unmaterializeIdx: 1 });
  assert.equal(s.matches.length, 1);
});

test("SINGLES KOTH: undo REBUILDS the throne rather than unwinding it", () => {
  const s = koth();
  recordGame(s, S[0]!, 12);
  recordGame(s, S[0]!, 13);
  recordGame(s, S[3]!, 14);
  assert.deepEqual(kothMembers(s).king, ["p3"]);
  assert.deepEqual(undoLast(s), { unmaterializeIdx: 2 });
  // Back to exactly the state after two matches, queue and reign included.
  assert.deepEqual(kothMembers(s), {
    king: ["p0"],
    queue: [["p3"], ["p1"], ["p2"]],
    reign: 2,
    best: { members: ["p0"], reign: 2 },
  });
  assert.deepEqual(teed(s), [["p0"], ["p3"]]);
});

test("SINGLES KOTH: undoing every match returns to the opening arrangement", () => {
  const s = koth();
  recordGame(s, S[0]!, 1);
  recordGame(s, S[2]!, 2);
  recordGame(s, S[2]!, 3);
  undoLast(s);
  undoLast(s);
  undoLast(s);
  assert.deepEqual(kothMembers(s), { king: ["p0"], queue: [["p1"], ["p2"], ["p3"]], reign: 0, best: null });
  assert.equal(s.matches.length, 0);
  assert.deepEqual(undoLast(s), { unmaterializeIdx: null });
});

// ---------- the session envelope ----------

test("SINGLES: a fresh session's shape", () => {
  const s = freePlay();
  assert.equal(s.format, "free");
  assert.equal(s.mode, "ffa");
  assert.equal(s.bestOf, 1);
  assert.equal(s.openScoring, false);
  assert.equal(s.matches.length, 0);
  assert.equal(s.current, null);
  assert.equal(s.koth, null);
  assert.equal(s.roster.length, 4);
  assert.ok(s.sessionKey.length > 0);
});

test("SINGLES: two sessions do not share a sessionKey", () => {
  // Without it a second session on one event restarts idx at 0 and collides,
  // and the dedupe check silently drops every new match.
  assert.notEqual(freePlay().sessionKey, freePlay().sessionKey);
});

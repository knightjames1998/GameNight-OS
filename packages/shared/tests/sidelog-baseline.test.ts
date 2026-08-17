// THE SIDE LOG, captured off the unmodified Ping Pong engine.
//
// `sidelog.ts` is about to be extracted out of pingpong.ts because Mario Kart
// is the second consumer of it, and the conversion has to be provably
// behaviour-free. So the log's behaviour gets pinned HERE FIRST, through Ping
// Pong's own public surface, with numbers this file did not reason out: they
// were printed by running the shipped engine.
//
// The four scenarios are the ones the extraction can plausibly break, and each
// one is silent when broken:
//
//   A DOUBLES NIGHT      the arrangement in force, and that it stays put.
//   A SINGLES NIGHT      one side per player, which must keep writing NULL to
//                        match_participants.side (see teams.ts sideIdFor).
//   A MID-NIGHT RESHUFFLE  a SECOND entry with a fromIdx, not an overwrite,
//                        because KOTH's throne is rebuilt by replay and a
//                        replay that cannot tell which stretch was played
//                        under which arrangement hands the throne to a pair
//                        that never played.
//   AN UNDO BACK PAST IT the entry is truncated and the PREVIOUS arrangement
//                        comes back, which is the half that has no other test.
//
// After the extraction every assertion below still runs against Ping Pong,
// unchanged, because Ping Pong's behaviour is what is being preserved. Only the
// spelling of `currentSides` moves (it takes the log rather than the state),
// and that is a compile error rather than a silent one.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newPingPongState,
  ppMatchLines,
  recordGame,
  reshuffleSides,
  startFfaMatch,
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

const side = (id: string, ...memberIds: string[]): Side => ({
  id,
  name: `Side ${id.toUpperCase()}`,
  memberIds,
});

/** The log, flattened to the two things that matter: where it starts and who is on it. */
const shape = (state: PpSessionState) =>
  state.sideSets.map((entry) => ({ fromIdx: entry.fromIdx, members: entry.sides.map((s) => s.memberIds) }));

const throne = (state: PpSessionState) => ({
  kingSideId: state.koth?.kingSideId ?? null,
  queue: [...(state.koth?.queue ?? [])],
  reign: state.koth?.reign ?? 0,
});

// ---------- a doubles night ----------

test("SIDELOG: a doubles night opens with ONE entry, from match 0", () => {
  const s = newPingPongState({
    format: "free",
    mode: "ffa",
    bestOf: 1,
    roster: players(4),
    sides: [side("a", "p0", "p1"), side("b", "p2", "p3")],
  });
  assert.deepEqual(shape(s), [{ fromIdx: 0, members: [["p0", "p1"], ["p2", "p3"]] }]);
});

test("SIDELOG: playing matches does not touch the log", () => {
  const s = newPingPongState({
    format: "free",
    mode: "ffa",
    bestOf: 1,
    roster: players(4),
    sides: [side("a", "p0", "p1"), side("b", "p2", "p3")],
  });
  startFfaMatch(s, "a", "b");
  recordGame(s, "a", 15);
  recordGame(s, "b", 19);
  assert.equal(s.matches.length, 2);
  assert.deepEqual(shape(s), [{ fromIdx: 0, members: [["p0", "p1"], ["p2", "p3"]] }]);
});

// ---------- a singles night ----------

test("SIDELOG: a singles night is one side per player, in ROSTER ORDER", () => {
  const s = newPingPongState({ format: "free", mode: "ffa", bestOf: 1, roster: players(4) });
  assert.deepEqual(shape(s), [{ fromIdx: 0, members: [["p0"], ["p1"], ["p2"], ["p3"]] }]);
});

test("SIDELOG: a singles match still writes NULL side on every row", () => {
  // The equivalence the whole primitive rests on. Restated here because the
  // extraction moves the code that decides which arrangement is in force, and
  // an arrangement read wrong is how a singles row starts claiming a side.
  const s = newPingPongState({ format: "free", mode: "ffa", bestOf: 1, roster: players(2) });
  startFfaMatch(s, "a", "b");
  const { completed } = recordGame(s, "a", 17);
  assert.deepEqual(
    ppMatchLines(completed!).map((l) => ({ playerId: l.playerId, placement: l.placement, side: l.side })),
    [
      { playerId: "p0", placement: 1, side: null },
      { playerId: "p1", placement: 2, side: null },
    ],
  );
});

// ---------- a KOTH night with a reshuffle in the middle of it ----------

/** Three pairs, KOTH, two matches played, then the pairs are swapped around. */
function reshuffledKothNight(): PpSessionState {
  const s = newPingPongState({
    format: "koth",
    mode: "koth",
    bestOf: 1,
    roster: players(6),
    sides: [side("a", "p0", "p1"), side("b", "p2", "p3"), side("c", "p4", "p5")],
  });
  recordGame(s, "a", null); // A defends against B
  recordGame(s, "c", null); // C takes the table off A
  const err = reshuffleSides(s, [side("a", "p0", "p2"), side("b", "p1", "p3"), side("c", "p4", "p5")]);
  assert.equal(err, null, "a reshuffle between matches is allowed");
  return s;
}

test("SIDELOG: a KOTH night rotates the LOSING side to the back, together", () => {
  const s = newPingPongState({
    format: "koth",
    mode: "koth",
    bestOf: 1,
    roster: players(6),
    sides: [side("a", "p0", "p1"), side("b", "p2", "p3"), side("c", "p4", "p5")],
  });
  assert.deepEqual(throne(s), { kingSideId: "a", queue: ["b", "c"], reign: 0 });
  recordGame(s, "a", null);
  assert.deepEqual(throne(s), { kingSideId: "a", queue: ["c", "b"], reign: 1 });
  recordGame(s, "c", null);
  assert.deepEqual(throne(s), { kingSideId: "c", queue: ["b", "a"], reign: 1 });
});

test("SIDELOG: A RESHUFFLE STACKS A SECOND ENTRY, keyed to the match it starts at", () => {
  const s = reshuffledKothNight();
  assert.deepEqual(shape(s), [
    { fromIdx: 0, members: [["p0", "p1"], ["p2", "p3"], ["p4", "p5"]] },
    { fromIdx: 2, members: [["p0", "p2"], ["p1", "p3"], ["p4", "p5"]] },
  ]);
  // The two matches already played keep the sides they were played with.
  assert.deepEqual(
    s.matches.map((m) => [m.idx, m.a.memberIds, m.b.memberIds, m.winnerSideId]),
    [
      [0, ["p0", "p1"], ["p2", "p3"], "a"],
      [1, ["p0", "p1"], ["p4", "p5"], "c"],
    ],
  );
  // And the ladder restarts from the new arrangement, because a queue of sides
  // that no longer exist is not a queue.
  assert.deepEqual(throne(s), { kingSideId: "a", queue: ["b", "c"], reign: 0 });
});

test("SIDELOG: reshuffling TWICE with nothing played between REPLACES rather than stacks", () => {
  // Changing your mind must not leave a dead entry for the rebuild to walk past.
  const s = newPingPongState({
    format: "free",
    mode: "ffa",
    bestOf: 1,
    roster: players(4),
    sides: [side("a", "p0", "p1"), side("b", "p2", "p3")],
  });
  startFfaMatch(s, "a", "b");
  recordGame(s, "a", 15);
  reshuffleSides(s, [side("a", "p0", "p2"), side("b", "p1", "p3")]);
  reshuffleSides(s, [side("a", "p0", "p3"), side("b", "p1", "p2")]);
  assert.deepEqual(shape(s), [
    { fromIdx: 0, members: [["p0", "p1"], ["p2", "p3"]] },
    { fromIdx: 1, members: [["p0", "p3"], ["p1", "p2"]] },
  ]);
});

// ---------- undoing back past the reshuffle ----------

test("SIDELOG: undoing a match played AFTER the reshuffle leaves the log alone", () => {
  const s = reshuffledKothNight();
  recordGame(s, "b", null); // match 2, under the new arrangement
  assert.deepEqual(throne(s), { kingSideId: "b", queue: ["c", "a"], reign: 1 });

  assert.deepEqual(undoLast(s), { unmaterializeIdx: 2 });
  assert.deepEqual(shape(s), [
    { fromIdx: 0, members: [["p0", "p1"], ["p2", "p3"], ["p4", "p5"]] },
    { fromIdx: 2, members: [["p0", "p2"], ["p1", "p3"], ["p4", "p5"]] },
  ]);
  assert.deepEqual(throne(s), { kingSideId: "a", queue: ["b", "c"], reign: 0 });
});

test("UNDOING BACK PAST A RESHUFFLE TRUNCATES IT AND RESTORES THE OLD ARRANGEMENT", () => {
  // The half with no other test, and the reason the log carries a fromIdx at
  // all. Without the truncation the rebuild replays match 0 under sides that
  // did not exist when it was played.
  const s = reshuffledKothNight();
  recordGame(s, "b", null);
  undoLast(s); // back to two matches, still under the new arrangement
  assert.deepEqual(undoLast(s), { unmaterializeIdx: 1 });

  assert.deepEqual(shape(s), [{ fromIdx: 0, members: [["p0", "p1"], ["p2", "p3"], ["p4", "p5"]] }]);
  // The throne is what replaying match 0 alone gives, under the ORIGINAL pairs.
  assert.deepEqual(throne(s), { kingSideId: "a", queue: ["c", "b"], reign: 1 });
  assert.deepEqual(s.koth!.bestReign, { sideId: "a", memberIds: ["p0", "p1"], reign: 1 });
});

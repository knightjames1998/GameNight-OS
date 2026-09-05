// King of the Hill with a throne held by a SIDE, and the reshuffle around it.
//
// The rules here are the ones that go wrong QUIETLY, which is why they are the
// ones asserted:
//
//   - THE LOSING SIDE ROTATES TOGETHER. Half a pair going to the back of the
//     queue and half staying on the throne is not an error anywhere; it is just
//     a ladder nobody played.
//   - bestStreak NAMES THE SIDE AND CARRIES ITS MEMBERS. After a reshuffle the
//     side id "a" belongs to a different pair, so a record that stored only the
//     id would credit the run to whoever holds that letter now.
//   - THE LADDER RESTARTS AT A RESHUFFLE, and the rebuild SKIPS the rounds
//     played before it. Replaying them under an arrangement they were not
//     played under hands the throne to a pair that never won it, and nothing
//     errors.
//   - UNDOING BACK PAST A RESHUFFLE puts the old arrangement back FIRST and
//     rebuilds the throne SECOND. The other order is silently wrong.
//
// A solo night is sides of one all the way through, and its ladder is pinned in
// smash-baseline.test.ts rather than repeated here.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  kothNextPair,
  newSmashState,
  rebuildSmashKoth,
  reshuffleSmashSides,
  smashBattleLines,
  smashSides,
  undoSmashGame,
  type Side,
  type SmashGame,
  type SmashPlayer,
  type SmashSessionState,
} from "../src/index.js";

const NAMES = ["Ann", "Ben", "Cal", "Dee", "Eve", "Fin"];
const ROSTER: SmashPlayer[] = NAMES.map((name, i) => ({
  id: `p${i}`,
  kind: "member",
  userId: `u${i}`,
  name,
  character: null,
}));

const side = (id: string, ...memberIds: string[]): Side => ({ id, name: `Side ${id.toUpperCase()}`, memberIds });

/** Three pairs, so there is a throne, a challenger and somebody queued behind. */
const THREE_PAIRS = (): Side[] => [side("a", "p0", "p1"), side("b", "p2", "p3"), side("c", "p4", "p5")];

function kothState(sides: Side[] = THREE_PAIRS()): SmashSessionState {
  return newSmashState({
    format: "koth",
    mode: "koth",
    assignment: "self",
    resultDetail: "winner",
    roster: ROSTER.map((p) => ({ ...p })),
    sides,
  });
}

/** Record one round: the given side wins, the other loses. Mirrors the route. */
function round(state: SmashSessionState, winnerSideId: string): SmashGame {
  const sides = smashSides(state);
  const pair = kothNextPair(state.koth, sides)!;
  const winner = winnerSideId === pair.king.id ? pair.king : pair.challenger;
  const loser = winner.id === pair.king.id ? pair.challenger : pair.king;
  const game: SmashGame = {
    idx: state.games.length,
    mode: "koth",
    lines: smashBattleLines([winner.id, loser.id], sides, "placement", () => null),
    at: `2026-09-05T21:0${state.games.length}:00.000Z`,
  };
  state.games.push(game);
  rebuildSmashKoth(state);
  return game;
}

const throne = (s: SmashSessionState) => ({ king: s.koth!.kingSideId, queue: [...s.koth!.queue], streak: s.koth!.streak });

// ---------- the ladder ----------

test("the opening ladder puts the first side on the throne and queues the rest", () => {
  const s = kothState();
  assert.deepEqual(throne(s), { king: "a", queue: ["b", "c"], streak: 0 });
  const pair = kothNextPair(s.koth, smashSides(s))!;
  assert.deepEqual([pair.king.id, pair.challenger.id], ["a", "b"]);
});

test("the LOSING SIDE goes to the back together, both members with it", () => {
  const s = kothState();
  round(s, "a");
  assert.deepEqual(throne(s), { king: "a", queue: ["c", "b"], streak: 1 });
  // Both of the losing pair are on the round, both on placement 2, both on
  // side b. Half a pair rotating is the failure this pins.
  const lines = s.games[0]!.lines;
  assert.deepEqual(
    lines.map((l) => [l.playerId, l.placement, l.side]),
    [["p0", 1, "a"], ["p1", 1, "a"], ["p2", 2, "b"], ["p3", 2, "b"]],
  );
});

test("a pair taking the throne resets the streak and queues the old holder", () => {
  const s = kothState();
  round(s, "a"); // a defends, b to the back
  round(s, "a"); // a defends against c, c to the back
  assert.deepEqual(throne(s), { king: "a", queue: ["b", "c"], streak: 2 });
  round(s, "b"); // b takes it
  assert.deepEqual(throne(s), { king: "b", queue: ["c", "a"], streak: 1 });
});

test("bestStreak names the SIDE and carries its members", () => {
  const s = kothState();
  round(s, "a");
  round(s, "a");
  round(s, "b");
  assert.deepEqual(s.koth!.bestStreak, { sideId: "a", memberIds: ["p0", "p1"], streak: 2 });
});

// ---------- the reshuffle ----------

test("a reshuffle RESTARTS the ladder and applies from the next battle on", () => {
  const s = kothState();
  round(s, "a");
  round(s, "a");
  assert.equal(s.games.length, 2);

  const swapped = [side("a", "p0", "p2"), side("b", "p1", "p3"), side("c", "p4", "p5")];
  assert.equal(reshuffleSmashSides(s, swapped), null);

  // The log records the boundary rather than overwriting: everything from the
  // third battle on was played like this.
  assert.deepEqual(s.sideSets.map((e) => e.fromIdx), [0, 2]);
  // The ladder is open again, because a queue of sides that no longer exist is
  // not a queue.
  assert.deepEqual(throne(s), { king: "a", queue: ["b", "c"], streak: 0 });
  // And the two rounds already recorded keep the sides they were played under.
  assert.deepEqual(
    s.games.map((g) => g.lines.map((l) => l.side)),
    [["a", "a", "b", "b"], ["a", "a", "c", "c"]],
  );
});

test("the rebuild SKIPS rounds played before the reshuffle", () => {
  const s = kothState();
  round(s, "a");
  round(s, "a");
  reshuffleSmashSides(s, [side("a", "p0", "p2"), side("b", "p1", "p3"), side("c", "p4", "p5")]);
  round(s, "b"); // the first round under the new arrangement
  // Only that one round counts: streak 1, not 3, and the throne is b's.
  assert.deepEqual(throne(s), { king: "b", queue: ["c", "a"], streak: 1 });
  assert.deepEqual(s.koth!.bestStreak, { sideId: "b", memberIds: ["p1", "p3"], streak: 1 });
});

test("a reshuffle that has had no rounds under it REPLACES rather than stacks", () => {
  const s = kothState();
  round(s, "a");
  reshuffleSmashSides(s, [side("a", "p0", "p2"), side("b", "p1", "p3"), side("c", "p4", "p5")]);
  reshuffleSmashSides(s, [side("a", "p0", "p4"), side("b", "p1", "p5"), side("c", "p2", "p3")]);
  assert.deepEqual(s.sideSets.map((e) => e.fromIdx), [0, 1]);
  assert.deepEqual(smashSides(s).map((x) => x.memberIds), [["p0", "p4"], ["p1", "p5"], ["p2", "p3"]]);
});

test("a reshuffle is refused when it is not an arrangement, or not this roster", () => {
  const s = kothState();
  assert.equal(reshuffleSmashSides(s, [side("a", "p0", "p1")]), "Need at least 2 sides");
  assert.equal(
    reshuffleSmashSides(s, [side("a", "p0", "p1"), side("b", "p0", "p2")]),
    "A player can only be on one side",
  );
  assert.equal(
    reshuffleSmashSides(s, [side("a", "p0", "zz"), side("b", "p1", "p2")]),
    "Somebody on a side is not in this session",
  );
  // Uneven is NOT one of them: it is a fact the screen warns about.
  assert.equal(
    reshuffleSmashSides(s, [side("a", "p0", "p1", "p2"), side("b", "p3"), side("c", "p4", "p5")]),
    null,
  );
});

test("a Best Of set in progress BLOCKS the reshuffle", () => {
  const s = newSmashState({
    format: "bestof",
    mode: "ffa",
    assignment: "self",
    resultDetail: "winner",
    roster: ROSTER.map((p) => ({ ...p })),
    sides: THREE_PAIRS(),
  });
  s.series = { idx: -1, aId: "a", bId: "b", games: [{ winnerId: "a" }], winnerId: null, at: null };
  assert.equal(
    reshuffleSmashSides(s, [side("a", "p0", "p2"), side("b", "p1", "p3"), side("c", "p4", "p5")]),
    "Finish the set in progress first",
  );
  // An untouched set is not "in progress": it is dropped and the reshuffle runs.
  s.series = { idx: -1, aId: "a", bId: "b", games: [], winnerId: null, at: null };
  assert.equal(
    reshuffleSmashSides(s, [side("a", "p0", "p2"), side("b", "p1", "p3"), side("c", "p4", "p5")]),
    null,
  );
  assert.equal(s.series, null);
});

// ---------- undo across the boundary ----------

test("undoing back PAST a reshuffle restores the old arrangement AND its throne", () => {
  const s = kothState();
  round(s, "a");
  round(s, "a");
  const before = smashSides(s).map((x) => x.memberIds);
  reshuffleSmashSides(s, [side("a", "p0", "p2"), side("b", "p1", "p3"), side("c", "p4", "p5")]);
  round(s, "b");

  // ONE undo takes back the ROUND, not the reshuffle. The arrangement took
  // effect from battle 2 and battle 2 is exactly what is now next, so it is
  // still PENDING rather than dead and stays in force. truncateSideLog draws
  // that line on purpose (`fromIdx > unitCount`), and getting it wrong the
  // other way would silently un-reshuffle a host who had only mistapped a
  // winner.
  assert.deepEqual(undoSmashGame(s), { unmaterializeIdx: 2 });
  assert.deepEqual(s.sideSets.map((e) => e.fromIdx), [0, 2]);
  assert.deepEqual(smashSides(s).map((x) => x.memberIds), [["p0", "p2"], ["p1", "p3"], ["p4", "p5"]]);
  // Nothing has been played under it, so the ladder is back at its opening.
  assert.deepEqual(throne(s), { king: "a", queue: ["b", "c"], streak: 0 });

  // ONE MORE undo goes back past the boundary, and now the arrangement is one
  // nothing was ever played under. It is dropped, the old pairs come back, and
  // the throne is replayed under the arrangement the surviving round was
  // actually played under.
  assert.deepEqual(undoSmashGame(s), { unmaterializeIdx: 1 });
  assert.deepEqual(s.sideSets.map((e) => e.fromIdx), [0]);
  assert.deepEqual(smashSides(s).map((x) => x.memberIds), before);
  assert.deepEqual(throne(s), { king: "a", queue: ["c", "b"], streak: 1 });
});

test("undo on an empty log is a no-op rather than a throw", () => {
  const s = kothState();
  assert.deepEqual(undoSmashGame(s), { unmaterializeIdx: null });
  assert.deepEqual(throne(s), { king: "a", queue: ["b", "c"], streak: 0 });
});

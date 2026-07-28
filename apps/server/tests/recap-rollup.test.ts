// Tests for the night-recap rollup (rollupRecap in src/events.ts).
//
// It was inline in the recap route until the event TV needed the same answer
// for its between-games screen. Two callers now share it, which is exactly why
// it is worth pinning down: the failure this prevents is the TV and the recap
// card quoting different numbers for the same night, in the same room, at the
// same time.
//
// The ORDER of `players` is load-bearing beyond the card: the TV reads index 0
// as "who is leading tonight" and puts a crown on it, so the MVP rule is not a
// display detail here.
//
// Pure over rows in hand. No database and no Drizzle stub.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rollupRecap, type RecapRow } from "../src/events.js";

let seq = 0;
/** One participant line, with only the fields a case cares about spelled out. */
function row(over: Partial<RecapRow> = {}): RecapRow {
  return {
    matchId: `m${seq}`,
    position: seq++,
    label: null,
    format: "ffa",
    externalKey: null,
    gameName: "Smash Bros",
    pack: "smash",
    userId: "u1",
    displayName: "Ari",
    placement: 1,
    isWinner: true,
    ...over,
  };
}

test("nothing played rolls up to an empty night", () => {
  const r = rollupRecap([]);
  assert.equal(r.totalGames, 0);
  assert.deepEqual(r.games, []);
  assert.deepEqual(r.players, []);
  assert.equal(r.mvp, null);
});

test("one game counts once, however many players were in it", () => {
  const r = rollupRecap([
    row({ matchId: "m1", position: 0, userId: "u1", displayName: "Ari", placement: 1, isWinner: true }),
    row({ matchId: "m1", position: 0, userId: "u2", displayName: "Bo", placement: 2, isWinner: false }),
    row({ matchId: "m1", position: 0, userId: "u3", displayName: "Cy", placement: 3, isWinner: false }),
  ]);
  assert.equal(r.totalGames, 1);
  assert.equal(r.games.length, 1);
  assert.equal(r.games[0]!.winnerName, "Ari");
  assert.equal(r.players.length, 3);
});

test("wins and games per player accumulate across matches", () => {
  const r = rollupRecap([
    row({ matchId: "m1", position: 0, userId: "u1", displayName: "Ari", placement: 1, isWinner: true }),
    row({ matchId: "m1", position: 0, userId: "u2", displayName: "Bo", placement: 2, isWinner: false }),
    row({ matchId: "m2", position: 1, userId: "u1", displayName: "Ari", placement: 2, isWinner: false }),
    row({ matchId: "m2", position: 1, userId: "u2", displayName: "Bo", placement: 1, isWinner: true }),
    row({ matchId: "m3", position: 2, userId: "u1", displayName: "Ari", placement: 1, isWinner: true }),
    row({ matchId: "m3", position: 2, userId: "u2", displayName: "Bo", placement: 2, isWinner: false }),
  ]);
  assert.equal(r.totalGames, 3);
  const ari = r.players.find((p) => p.userId === "u1")!;
  assert.equal(ari.wins, 2);
  assert.equal(ari.games, 3);
  assert.equal(ari.avgPlacement, (1 + 2 + 1) / 3);
  // Most wins leads, so the TV's crown lands on Ari.
  assert.equal(r.players[0]!.userId, "u1");
  assert.deepEqual(r.mvp, { userId: "u1", name: "Ari" });
});

test("equal wins break on the better average finish", () => {
  const r = rollupRecap([
    // Bo wins one and comes 2nd in the other; Cy wins one and comes 4th.
    row({ matchId: "m1", position: 0, userId: "u2", displayName: "Bo", placement: 1, isWinner: true }),
    row({ matchId: "m1", position: 0, userId: "u3", displayName: "Cy", placement: 4, isWinner: false }),
    row({ matchId: "m2", position: 1, userId: "u2", displayName: "Bo", placement: 2, isWinner: false }),
    row({ matchId: "m2", position: 1, userId: "u3", displayName: "Cy", placement: 1, isWinner: true }),
  ]);
  assert.equal(r.players[0]!.name, "Bo");
  assert.deepEqual(r.mvp, { userId: "u2", name: "Bo" });
});

test("a player with no ranked placement sorts last on the tiebreak, not first", () => {
  // A pack that records only a winner leaves placement null; that must not read
  // as a perfect average and jump the leader.
  const r = rollupRecap([
    row({ matchId: "m1", position: 0, userId: "u1", displayName: "Ari", placement: 2, isWinner: false }),
    row({ matchId: "m1", position: 0, userId: "u2", displayName: "Bo", placement: null, isWinner: false }),
  ]);
  assert.equal(r.players[0]!.name, "Ari");
  assert.equal(r.players.find((p) => p.userId === "u2")!.avgPlacement, null);
});

test("games come back in play order, so the TV's latest-first slice is really the latest", () => {
  const r = rollupRecap([
    row({ matchId: "m3", position: 2, gameName: "Third" }),
    row({ matchId: "m1", position: 0, gameName: "First" }),
    row({ matchId: "m2", position: 1, gameName: "Second" }),
  ]);
  assert.deepEqual(r.games.map((g) => g.gameName), ["First", "Second", "Third"]);
});

test("a game with no recorded winner still lists its players, and the top of the ranking is still the mvp", () => {
  // Documenting existing behaviour rather than proposing new: once ANY game
  // exists the mvp is whoever leads the ranking, even on zero wins. The TV
  // inherits that, so its crown can sit on a 0W row on a night where nothing
  // has been won yet. Worth knowing before someone "fixes" one of the two.
  const r = rollupRecap([
    row({ matchId: "m1", position: 0, userId: "u1", displayName: "Ari", placement: null, isWinner: false }),
  ]);
  assert.equal(r.totalGames, 1);
  assert.equal(r.players.length, 1);
  assert.equal(r.players[0]!.wins, 0);
  assert.deepEqual(r.mvp, { userId: "u1", name: "Ari" });
});

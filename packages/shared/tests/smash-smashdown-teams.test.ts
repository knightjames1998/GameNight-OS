// Smashdown played by SIDES, and the one measured bug that forced its shape.
//
// MERCY SILENTLY STOPS WORKING WHEN STANDINGS ARE PER PLAYER, and this file
// exists mostly to hold that down. `smashdownStatus` computes:
//
//     leaders.length === 1 && standings.every(s => s.playerId === leaders[0].playerId
//                                               || top > s.wins + battlesLeft)
//
// `leaders` is everybody on the top win total. Every member of a winning side
// is a winner, so in a 2v2 with fixed sides BOTH members of the leading side
// always share that total, `leaders.length` is 2, and `clinched` is false
// forever. Mercy would never fire, the series would always run its full length,
// and nothing anywhere would error. The first test below asserts that failure
// against the per-player function directly, so the reason for the sibling
// cannot be deleted as "an obvious refactor".
//
// The rest is the sibling being right: standings per side, the clinch and mercy
// arithmetic over sides, placements 1,1,2,2 on the per-player rows rather than
// competition ranking's 1,1,3,3, and winnerIds naming every member of the
// winning side so the series row credits both.
//
// WHAT DOES NOT CHANGE is asserted too, because the BACKLOG entry for this
// feature said "do not assume; ask": smashdownCap stays keyed on PLAYERS and
// burnedFrom still burns one fighter per LINE, so a 2v2 burns four fighters per
// battle exactly as four solo players do.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  burnedFrom,
  newSmashState,
  smashBattleLines,
  smashdownCap,
  smashdownSideStatus,
  smashdownStatus,
  singletonSides,
  type Side,
  type SmashGame,
  type SmashPlayer,
  type SmashSessionState,
} from "../src/index.js";

const NAMES = ["Ann", "Ben", "Cal", "Dee"];
const ROSTER: SmashPlayer[] = NAMES.map((name, i) => ({
  id: `p${i}`,
  kind: "member",
  userId: `u${i}`,
  name,
  character: null,
}));

const side = (id: string, ...memberIds: string[]): Side => ({ id, name: `Side ${id.toUpperCase()}`, memberIds });
const PAIRS = (): Side[] => [side("a", "p0", "p1"), side("b", "p2", "p3")];

function series(battleCount: number, mercy: boolean, sides: Side[]): SmashSessionState {
  return newSmashState({
    format: "smashdown",
    mode: "ffa",
    assignment: "self",
    resultDetail: "winner",
    roster: ROSTER.map((p) => ({ ...p })),
    battleCount,
    mercy,
    sides,
  });
}

/** One battle: the given side wins, everybody on their own fighter. */
function battle(state: SmashSessionState, winnerSideId: string, fighters: Record<string, string>): SmashGame {
  const sides = state.sideSets[state.sideSets.length - 1]!.sides;
  const order = [winnerSideId, ...sides.map((s) => s.id).filter((id) => id !== winnerSideId)];
  const g: SmashGame = {
    idx: state.games.length,
    mode: "ffa",
    lines: smashBattleLines(order, sides, "winner", (id) => fighters[id] ?? null),
    at: `2026-09-05T22:0${state.games.length}:00.000Z`,
  };
  state.games.push(g);
  state.burned = burnedFrom(state.games);
  return g;
}

const F = (a: string, b: string, c: string, d: string) => ({ p0: a, p1: b, p2: c, p3: d });

// ---------- the bug, asserted rather than described ----------

test("THE BUG: per-player standings can NEVER clinch a 2v2, so mercy never fires", () => {
  // Side A wins all three of a four-battle series. That is unassailable: side B
  // cannot reach three by winning the one battle left. The per-player function
  // says otherwise, and says it silently.
  const s = series(4, true, PAIRS());
  battle(s, "a", F("Mario", "Fox", "Kirby", "Link"));
  battle(s, "a", F("Yoshi", "Pikachu", "Samus", "Ness"));
  battle(s, "a", F("Peach", "Zelda", "Sheik", "Marth"));

  const perPlayer = smashdownStatus(s);
  assert.deepEqual(
    perPlayer.standings.map((x) => [x.playerId, x.wins]),
    [["p0", 3], ["p1", 3], ["p2", 0], ["p3", 0]],
    "both members of the winning side share the top total, which is the whole problem",
  );
  assert.equal(perPlayer.clinched, false, "leaders.length is 2, so clinched is false");
  assert.equal(perPlayer.over, false, "and mercy therefore never ends the series");

  // The sibling, on the same state, gets it right.
  const perSide = smashdownSideStatus(s);
  assert.equal(perSide.clinched, true);
  assert.equal(perSide.over, true);
});

// ---------- the sibling ----------

test("standings are per SIDE, one win per battle rather than one per winner line", () => {
  const s = series(3, false, PAIRS());
  battle(s, "a", F("Mario", "Fox", "Kirby", "Link"));
  battle(s, "b", F("Yoshi", "Pikachu", "Samus", "Ness"));
  battle(s, "a", F("Peach", "Zelda", "Sheik", "Marth"));

  const status = smashdownSideStatus(s);
  assert.deepEqual(
    status.sideStandings.map((x) => [x.sideId, x.name, x.wins, x.played, x.placement]),
    [
      ["a", "Ann + Ben", 2, 3, 1],
      ["b", "Cal + Dee", 1, 3, 2],
    ],
  );
});

test("the per-player rows carry the SIDE's placement: 1,1,2,2 not 1,1,3,3", () => {
  const s = series(3, false, PAIRS());
  battle(s, "a", F("Mario", "Fox", "Kirby", "Link"));
  battle(s, "b", F("Yoshi", "Pikachu", "Samus", "Ness"));
  battle(s, "a", F("Peach", "Zelda", "Sheik", "Marth"));

  const status = smashdownSideStatus(s);
  assert.deepEqual(
    status.standings.map((x) => [x.playerId, x.placement, x.side, x.wins]),
    [
      ["p0", 1, "a", 2],
      ["p1", 1, "a", 2],
      ["p2", 2, "b", 1],
      ["p3", 2, "b", 1],
    ],
  );
  // Competition ranking would have said 1,1,3,3 here, which claims the losing
  // pair finished third in a field of four. There was no third: two sides.
  assert.deepEqual(
    smashdownStatus(s).standings.map((x) => x.placement),
    [1, 1, 3, 3],
  );
});

test("winnerIds names every member of the winning side, and carries the side", () => {
  const s = series(2, false, PAIRS());
  battle(s, "a", F("Mario", "Fox", "Kirby", "Link"));
  battle(s, "a", F("Yoshi", "Pikachu", "Samus", "Ness"));
  const status = smashdownSideStatus(s);
  assert.equal(status.over, true);
  assert.deepEqual(status.winnerIds, ["p0", "p1"]);
  assert.deepEqual(status.standings.filter((x) => x.placement === 1).map((x) => x.side), ["a", "a"]);
});

test("two sides level at the top is a CO-WIN, and both sides' members win", () => {
  const s = series(2, false, PAIRS());
  battle(s, "a", F("Mario", "Fox", "Kirby", "Link"));
  battle(s, "b", F("Yoshi", "Pikachu", "Samus", "Ness"));
  const status = smashdownSideStatus(s);
  assert.deepEqual(status.sideStandings.map((x) => [x.sideId, x.wins, x.placement]), [["a", 1, 1], ["b", 1, 1]]);
  assert.equal(status.clinched, false);
  assert.equal(status.over, true);
  assert.deepEqual([...status.winnerIds].sort(), ["p0", "p1", "p2", "p3"]);
});

test("mercy does NOT fire when the trailing side can still DRAW LEVEL", () => {
  // 2-1 to side A with one battle left. Side B winning it makes 2-2, which is a
  // co-win here and not a formality, so the series is still live. Strictly
  // greater, exactly as in the per-player version.
  const s = series(4, true, PAIRS());
  battle(s, "a", F("Mario", "Fox", "Kirby", "Link"));
  battle(s, "a", F("Yoshi", "Pikachu", "Samus", "Ness"));
  battle(s, "b", F("Peach", "Zelda", "Sheik", "Marth"));
  const status = smashdownSideStatus(s);
  assert.deepEqual({ played: status.battlesPlayed, left: status.battlesLeft }, { played: 3, left: 1 });
  assert.deepEqual(status.sideStandings.map((x) => [x.sideId, x.wins]), [["a", 2], ["b", 1]]);
  assert.equal(status.clinched, false);
  assert.equal(status.over, false);

  // One more to side A and the same series IS clinched: 3-1 with one left.
  battle(s, "a", F("Ike", "Lucina", "Robin", "Shulk"));
  s.battleCount = 5;
  assert.equal(smashdownSideStatus(s).clinched, true);
});

test("a clinch is reported with mercy OFF, and only mercy acts on it", () => {
  const build = (mercy: boolean) => {
    const s = series(4, mercy, PAIRS());
    battle(s, "a", F("Mario", "Fox", "Kirby", "Link"));
    battle(s, "a", F("Yoshi", "Pikachu", "Samus", "Ness"));
    battle(s, "a", F("Peach", "Zelda", "Sheik", "Marth"));
    return smashdownSideStatus(s);
  };
  const off = build(false);
  assert.deepEqual({ clinched: off.clinched, over: off.over, winnerIds: off.winnerIds }, {
    clinched: true,
    over: false,
    winnerIds: [],
  });
  const on = build(true);
  assert.deepEqual({ clinched: on.clinched, over: on.over, winnerIds: on.winnerIds }, {
    clinched: true,
    over: true,
    winnerIds: ["p0", "p1"],
  });
});

test("nobody has clinched before a battle is played", () => {
  const status = smashdownSideStatus(series(4, true, PAIRS()));
  assert.equal(status.clinched, false);
  assert.equal(status.over, false);
});

test("a 2v1 series ranks two sides, not three players", () => {
  const s = series(2, false, [side("a", "p0", "p1"), side("b", "p2")]);
  s.roster = s.roster.slice(0, 3);
  battle(s, "b", { p0: "Mario", p1: "Fox", p2: "Kirby" });
  battle(s, "b", { p0: "Yoshi", p1: "Pikachu", p2: "Samus" });
  const status = smashdownSideStatus(s);
  assert.deepEqual(status.sideStandings.map((x) => [x.sideId, x.wins, x.placement]), [["b", 2, 1], ["a", 0, 2]]);
  assert.deepEqual(status.winnerIds, ["p2"]);
});

// ---------- what does NOT change ----------

test("the battle cap stays keyed on PLAYERS, and a 2v2 burns four per battle", () => {
  // Read off burnedFrom rather than assumed: it burns per LINE, and each player
  // picks their own fighter in a team battle.
  const s = series(3, false, PAIRS());
  battle(s, "a", F("Mario", "Fox", "Kirby", "Link"));
  assert.deepEqual(s.burned, ["Mario", "Fox", "Kirby", "Link"]);
  battle(s, "b", F("Yoshi", "Pikachu", "Samus", "Ness"));
  assert.equal(s.burned.length, 8, "two 2v2 battles burn eight fighters, exactly as four solo players would");

  // So the cap for four people is the same number whether they play as four
  // individuals or as two pairs. This is the sentence the setup screen prints.
  assert.equal(smashdownCap(86, 4), 21);
  assert.equal(smashdownCap(12, 4), 3);
});

test("a SOLO Smashdown series is the per-player function, untouched", () => {
  // The sibling is never called for an arrangement with no team structure, and
  // this is the equivalence that lets that be true: on singletons the two agree
  // on everything the ledger and the screens read.
  const s = series(2, false, singletonSides(ROSTER.map((p) => p.id)));
  battle(s, "a", F("Mario", "Fox", "Kirby", "Link"));
  battle(s, "a", F("Yoshi", "Pikachu", "Samus", "Ness"));
  const solo = smashdownStatus(s);
  const viaSides = smashdownSideStatus(s);
  assert.deepEqual(
    viaSides.standings.map((x) => [x.playerId, x.wins, x.placement, x.side]),
    solo.standings.map((x) => [x.playerId, x.wins, x.placement, x.side]),
  );
  assert.deepEqual(
    { clinched: viaSides.clinched, over: viaSides.over, winnerIds: viaSides.winnerIds },
    { clinched: solo.clinched, over: solo.over, winnerIds: solo.winnerIds },
  );
  assert.deepEqual(solo.standings.map((x) => x.side), [null, null, null, null]);
});

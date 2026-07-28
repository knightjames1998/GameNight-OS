// Smashdown: the pure rules, tested where they live.
//
// Everything asserted here is a rule that fails SILENTLY if it breaks, which
// is why these are the five things covered rather than a general sweep:
//
//   - THE BURN BOARD. A fighter that fails to burn is simply available again,
//     and the format quietly becomes an FFA night. Undo is the sharp edge: it
//     has to put back EXACTLY the battle it undid and nothing else, so the
//     server re-derives the board from the remaining log rather than
//     subtracting from it, and that derivation is what is asserted.
//   - THE BATTLE CAP. floor(fighters / players) is not a rounding detail: the
//     same four players get 21 battles in Ultimate and 3 in Smash 64, so a cap
//     computed loosely means a host sets up a series the roster cannot feed and
//     nobody finds out until the fighters run out mid-night.
//   - EXCLUSION. Every assignment mode (self, random, host) has to exclude both
//     the burn board and the picks already made for the current battle. A
//     random assignment that hands out a burned fighter un-strikes it.
//   - MERCY. The boundary is the whole test: it must fire when the lead is
//     unassailable and must NOT fire when the best a chaser can do is draw
//     level, because a draw is a co-win here and not a formality.
//   - THE WINNER. Competition ranking, so a tie produces co-winners on
//     placement 1 and the next player is 3, never 2.
//
// Pure logic only, no database and no stub: these functions take a session
// object and return an answer.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  smashdownCap,
  smashdownStatus,
  burnedFrom,
  availableFighters,
  currentPicks,
  randomFighter,
  assignRandomFighters,
  newSmashState,
  rosterForTitle,
  SMASH_TITLES,
  type SmashGame,
  type SmashPlayer,
  type SmashSessionState,
} from "../src/index.js";

// ---------- builders ----------

const player = (id: string, name = id): SmashPlayer => ({
  id,
  kind: "member",
  userId: `u_${id}`,
  name,
  character: null,
});

/** One recorded battle: [playerId, fighter] pairs, first one is the winner. */
function battle(idx: number, pairs: [string, string][]): SmashGame {
  return {
    idx,
    mode: "ffa",
    lines: pairs.map(([playerId, character], i) => ({
      playerId,
      character,
      placement: i === 0 ? 1 : 2,
      isWinner: i === 0,
    })),
    at: new Date(2026, 6, 28, 20, idx).toISOString(),
  };
}

function series(opts: {
  players: string[];
  titleId?: string;
  battleCount: number;
  mercy?: boolean;
  games?: SmashGame[];
}): SmashSessionState {
  const state = newSmashState({
    format: "smashdown",
    titleId: opts.titleId ?? "ultimate",
    mode: "ffa",
    assignment: "self",
    resultDetail: "winner",
    roster: opts.players.map((p) => player(p)),
    battleCount: opts.battleCount,
    mercy: opts.mercy ?? false,
  });
  state.games = opts.games ?? [];
  state.burned = burnedFrom(state.games);
  return state;
}

/** What the server's undo does, in the two lines that matter. */
function undoLast(state: SmashSessionState): SmashGame | undefined {
  const last = state.games.pop();
  state.burned = burnedFrom(state.games);
  if (last) {
    const usedBy = new Map(last.lines.map((l) => [l.playerId, l.character]));
    for (const p of state.roster) p.character = usedBy.get(p.id) ?? null;
  }
  return last;
}

// ---------- the burn board ----------

test("burn accumulates across battles, in the order fighters went out", () => {
  const games = [
    battle(0, [["a", "Fox"], ["b", "Kirby"]]),
    battle(1, [["b", "Link"], ["a", "Samus"]]),
    battle(2, [["a", "Ness"], ["b", "Yoshi"]]),
  ];
  assert.deepEqual(burnedFrom(games), ["Fox", "Kirby", "Link", "Samus", "Ness", "Yoshi"]);
});

test("the burn board is deduped and skips lines with no fighter", () => {
  const games = [
    battle(0, [["a", "Fox"], ["b", "Kirby"]]),
    // Neither of these can happen through the Smashdown routes (the record
    // path rejects a repeat and requires a fighter for everyone), but the
    // board must not double-count or emit a null if legacy state ever carries
    // one: a repeated entry would silently overstate how much of the roster
    // is gone.
    { ...battle(1, [["a", "Fox"], ["b", "Link"]]), lines: [
      { playerId: "a", character: "Fox", placement: 1, isWinner: true },
      { playerId: "b", character: null, placement: 2, isWinner: false },
    ] },
  ];
  assert.deepEqual(burnedFrom(games as SmashGame[]), ["Fox", "Kirby"]);
});

test("undo unburns EXACTLY the undone battle's fighters and hands them back", () => {
  const state = series({
    players: ["a", "b"],
    battleCount: 4,
    games: [
      battle(0, [["a", "Fox"], ["b", "Kirby"]]),
      battle(1, [["b", "Link"], ["a", "Samus"]]),
      battle(2, [["a", "Ness"], ["b", "Yoshi"]]),
    ],
  });
  assert.equal(state.burned.length, 6);

  undoLast(state);

  // The undone battle's two fighters, and only those two, are back.
  assert.deepEqual(state.burned, ["Fox", "Kirby", "Link", "Samus"]);
  assert.equal(state.burned.includes("Ness"), false);
  assert.equal(state.burned.includes("Yoshi"), false);
  // ...and they are back ON the players who used them, so the battle can just
  // be replayed rather than reassigned from scratch.
  assert.equal(state.roster.find((p) => p.id === "a")!.character, "Ness");
  assert.equal(state.roster.find((p) => p.id === "b")!.character, "Yoshi");
  // The standings drop the undone battle too.
  const st = smashdownStatus(state);
  assert.equal(st.battlesPlayed, 2);
  assert.equal(st.standings.find((s) => s.playerId === "a")!.wins, 1);
});

test("undoing every battle empties the board and leaves a fresh series", () => {
  const state = series({
    players: ["a", "b"],
    battleCount: 3,
    games: [battle(0, [["a", "Fox"], ["b", "Kirby"]])],
  });
  undoLast(state);
  assert.deepEqual(state.burned, []);
  assert.deepEqual(smashdownStatus(state).burned, []);
  assert.equal(smashdownStatus(state).battlesPlayed, 0);
  // Undo on an empty log is a no-op rather than a crash.
  assert.equal(undoLast(state), undefined);
  assert.deepEqual(state.burned, []);
});

// ---------- the battle cap ----------

test("the battle cap is floor(fighters / players), per title", () => {
  const ultimate = rosterForTitle(SMASH_TITLES, "ultimate").length;
  const smash64 = rosterForTitle(SMASH_TITLES, "smash64").length;
  const melee = rosterForTitle(SMASH_TITLES, "melee").length;

  // The two rosters the format lives between: 86 fighters and 12.
  assert.equal(ultimate, 86);
  assert.equal(smash64, 12);

  // Ultimate: a 4-player series is 21 battles, and nobody thinks about a cap.
  assert.equal(smashdownCap(ultimate, 2), 43);
  assert.equal(smashdownCap(ultimate, 4), 21);
  assert.equal(smashdownCap(ultimate, 8), 10);

  // Smash 64: the same four players get THREE. This is the case the setup
  // screen exists to say out loud.
  assert.equal(smashdownCap(smash64, 2), 6);
  assert.equal(smashdownCap(smash64, 3), 4);
  assert.equal(smashdownCap(smash64, 4), 3);
  assert.equal(smashdownCap(smash64, 8), 1);

  assert.equal(smashdownCap(melee, 4), Math.floor(melee / 4));
});

test("a cap of 0 is a real answer, not an error", () => {
  // More players than fighters: not even one battle is possible, and the caller
  // (the setup screen, the start route) says so rather than rounding up to 1.
  assert.equal(smashdownCap(6, 8), 0);
  assert.equal(smashdownCap(0, 4), 0);
  assert.equal(smashdownCap(12, 0), 0);
  assert.equal(smashdownCap(12, -1), 0);
});

// ---------- exclusion ----------

test("availableFighters excludes the burn board and the current battle's picks", () => {
  const pool = ["Fox", "Kirby", "Link", "Samus", "Ness"];
  assert.deepEqual(availableFighters(pool, ["Fox"], ["Link"]), ["Kirby", "Samus", "Ness"]);
  // Nulls in the taken list (a player who has not picked yet) are ignored.
  assert.deepEqual(availableFighters(pool, [], [null, undefined, "Ness"]), ["Fox", "Kirby", "Link", "Samus"]);
  // A fighter in both lists is excluded once, not twice.
  assert.deepEqual(availableFighters(pool, ["Fox"], ["Fox"]), ["Kirby", "Link", "Samus", "Ness"]);
});

test("currentPicks reports the other players' fighters, never the slot's own", () => {
  const roster = [
    { ...player("a"), character: "Fox" },
    { ...player("b"), character: "Kirby" },
    { ...player("c"), character: null },
  ];
  assert.deepEqual(currentPicks(roster), ["Fox", "Kirby"]);
  // Excluding the slot being edited is what lets a player keep the fighter
  // they already have selected without it appearing to be taken by someone.
  assert.deepEqual(currentPicks(roster, "a"), ["Kirby"]);
});

test("random assignment never returns a burned fighter or one already taken", () => {
  const pool = rosterForTitle(SMASH_TITLES, "smash64"); // 12, so collisions are likely
  const burned = ["Mario", "Donkey Kong", "Link", "Samus", "Yoshi", "Kirby"];
  const takenNow = ["Fox"];
  const avail = availableFighters(pool, burned, takenNow);
  const forbidden = new Set([...burned, ...takenNow]);

  // Randomness means this has to be exercised, not reasoned about: 500 draws
  // out of a 5-fighter pool would surface a leak immediately.
  for (let i = 0; i < 500; i++) {
    const f = randomFighter([], avail);
    assert.equal(forbidden.has(f), false, `${f} should not be assignable`);
    assert.equal(avail.includes(f), true);
  }
});

test("a random battle assignment is distinct and drawn only from what is left", () => {
  const pool = rosterForTitle(SMASH_TITLES, "smash64");
  const roster = ["a", "b", "c", "d"].map((id) => player(id));

  // Two battles in: eight of the twelve are gone, four remain for four
  // players, which is exactly the tightest a legal series can get.
  const burned = ["Mario", "Donkey Kong", "Link", "Samus", "Yoshi", "Kirby", "Fox", "Pikachu"];
  const avail = availableFighters(pool, burned);
  assert.equal(avail.length, 4);

  for (let i = 0; i < 200; i++) {
    const assigned = assignRandomFighters(roster, avail);
    const chars = assigned.map((p) => p.character!);
    assert.equal(new Set(chars).size, roster.length, "two players must never share a fighter");
    for (const c of chars) assert.equal(burned.includes(c), false, `${c} is burned`);
  }
});

// ---------- mercy ----------

test("mercy clinches when no chaser can catch the leader", () => {
  // 5 battles, 3 played, so 2 left. a has 3 wins, b has 0: 3 > 0 + 2.
  const state = series({
    players: ["a", "b"],
    battleCount: 5,
    mercy: true,
    games: [
      battle(0, [["a", "Fox"], ["b", "Kirby"]]),
      battle(1, [["a", "Link"], ["b", "Samus"]]),
      battle(2, [["a", "Ness"], ["b", "Yoshi"]]),
    ],
  });
  const st = smashdownStatus(state);
  assert.equal(st.battlesLeft, 2);
  assert.equal(st.clinched, true);
  assert.equal(st.over, true);
  assert.deepEqual(st.winnerIds, ["a"]);
});

test("mercy does NOT fire when the best a chaser can do is DRAW LEVEL", () => {
  // 4 battles, 2 played, 2 left. a has 2, b has 0: b can reach 2 and TIE,
  // which is a co-win here, so the series is still live. This is the boundary
  // the rule turns on and the one an "at least" comparison would get wrong.
  const state = series({
    players: ["a", "b"],
    battleCount: 4,
    mercy: true,
    games: [
      battle(0, [["a", "Fox"], ["b", "Kirby"]]),
      battle(1, [["a", "Link"], ["b", "Samus"]]),
    ],
  });
  const st = smashdownStatus(state);
  assert.equal(st.battlesLeft, 2);
  assert.equal(st.clinched, false);
  assert.equal(st.over, false);
  assert.deepEqual(st.winnerIds, []);
});

test("mercy needs the leader clear of EVERY chaser, not just the second-placed one", () => {
  // 6 battles, 4 played, 2 left. a 3, b 1, c 0. b can still reach 3 and tie,
  // so nothing is clinched even though a is clear of c.
  const state = series({
    players: ["a", "b", "c"],
    battleCount: 6,
    mercy: true,
    games: [
      battle(0, [["a", "Fox"], ["b", "Kirby"], ["c", "Link"]]),
      battle(1, [["a", "Samus"], ["b", "Ness"], ["c", "Yoshi"]]),
      battle(2, [["a", "Pikachu"], ["b", "Luigi"], ["c", "Zelda"]]),
      battle(3, [["b", "Marth"], ["a", "Roy"], ["c", "Peach"]]),
    ],
  });
  assert.equal(smashdownStatus(state).clinched, false);
  assert.equal(smashdownStatus(state).over, false);
});

test("a clinch is reported even with mercy OFF, but does not end the series", () => {
  const games = [
    battle(0, [["a", "Fox"], ["b", "Kirby"]]),
    battle(1, [["a", "Link"], ["b", "Samus"]]),
    battle(2, [["a", "Ness"], ["b", "Yoshi"]]),
  ];
  const off = smashdownStatus(series({ players: ["a", "b"], battleCount: 5, mercy: false, games }));
  assert.equal(off.clinched, true, "the screen still says the lead is unbeatable");
  assert.equal(off.over, false, "but every battle gets played");
  assert.deepEqual(off.winnerIds, []);
});

test("nobody has clinched before a single battle is played", () => {
  const st = smashdownStatus(series({ players: ["a", "b"], battleCount: 3, mercy: true }));
  assert.equal(st.clinched, false);
  assert.equal(st.over, false);
  assert.equal(st.battlesLeft, 3);
});

// ---------- the winner ----------

test("a clean winner takes the series once every battle is played", () => {
  const state = series({
    players: ["a", "b", "c"],
    battleCount: 3,
    games: [
      battle(0, [["a", "Fox"], ["b", "Kirby"], ["c", "Link"]]),
      battle(1, [["a", "Samus"], ["b", "Ness"], ["c", "Yoshi"]]),
      battle(2, [["b", "Pikachu"], ["a", "Luigi"], ["c", "Zelda"]]),
    ],
  });
  const st = smashdownStatus(state);
  assert.equal(st.over, true);
  assert.equal(st.battlesLeft, 0);
  assert.deepEqual(st.winnerIds, ["a"]);
  assert.deepEqual(
    st.standings.map((s) => [s.playerId, s.wins, s.placement]),
    [["a", 2, 1], ["b", 1, 2], ["c", 0, 3]],
  );
});

test("a tie at the top is CO-WINNERS, ranked by competition ranking", () => {
  // a and b both win two; c wins none. Both are placement 1, and the next
  // player is 3 — never 2, which is the whole point of competition ranking.
  const state = series({
    players: ["a", "b", "c"],
    battleCount: 4,
    games: [
      battle(0, [["a", "Fox"], ["b", "Kirby"], ["c", "Link"]]),
      battle(1, [["a", "Samus"], ["b", "Ness"], ["c", "Yoshi"]]),
      battle(2, [["b", "Pikachu"], ["a", "Luigi"], ["c", "Zelda"]]),
      battle(3, [["b", "Marth"], ["a", "Roy"], ["c", "Peach"]]),
    ],
  });
  const st = smashdownStatus(state);
  assert.equal(st.over, true);
  assert.deepEqual(st.winnerIds.slice().sort(), ["a", "b"]);
  assert.deepEqual(
    st.standings.map((s) => [s.playerId, s.wins, s.placement]),
    [["a", 2, 1], ["b", 2, 1], ["c", 0, 3]],
  );
});

test("a three-way tie makes everyone a winner rather than picking one", () => {
  const state = series({
    players: ["a", "b", "c"],
    battleCount: 3,
    games: [
      battle(0, [["a", "Fox"], ["b", "Kirby"], ["c", "Link"]]),
      battle(1, [["b", "Samus"], ["a", "Ness"], ["c", "Yoshi"]]),
      battle(2, [["c", "Pikachu"], ["a", "Luigi"], ["b", "Zelda"]]),
    ],
  });
  const st = smashdownStatus(state);
  assert.deepEqual(st.winnerIds.slice().sort(), ["a", "b", "c"]);
  assert.deepEqual(st.standings.map((s) => s.placement), [1, 1, 1]);
});

test("the series is not over, and has no winner, while battles remain", () => {
  const state = series({
    players: ["a", "b"],
    battleCount: 3,
    games: [battle(0, [["a", "Fox"], ["b", "Kirby"]])],
  });
  const st = smashdownStatus(state);
  assert.equal(st.over, false);
  assert.deepEqual(st.winnerIds, []);
  assert.equal(st.battlesLeft, 2);
});

// ---------- the status envelope ----------

test("status counts the fighters left against the chosen title, not Ultimate", () => {
  const state = series({
    players: ["a", "b"],
    titleId: "smash64",
    battleCount: 6,
    games: [battle(0, [["a", "Fox"], ["b", "Kirby"]])],
  });
  const st = smashdownStatus(state);
  assert.equal(st.poolSize, 12);
  assert.equal(st.fightersLeft, 10);
  assert.equal(st.burned.length, 2);
});

test("a player who has sat out every battle still appears, on zero", () => {
  // The roster is the series, so the standings list everyone from the start
  // rather than only players who have a recorded line.
  const st = smashdownStatus(series({ players: ["a", "b", "c"], battleCount: 3 }));
  assert.equal(st.standings.length, 3);
  assert.deepEqual(st.standings.map((s) => s.wins), [0, 0, 0]);
  assert.deepEqual(st.standings.map((s) => s.placement), [1, 1, 1]);
});

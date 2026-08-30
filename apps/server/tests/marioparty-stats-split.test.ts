// THE SOLO / TAG SPLIT ON MARIO PARTY'S LIFETIME STATS, and the property it
// makes a claim about.
//
// Tag Battle shares Orbs, Stars and coins, so a tag board has ONE star total
// per SIDE and that total is written to EVERY member of the side. An unsplit
// read of the star column therefore OVERSTATES a pair's night: two rows, one
// achievement. The panel prints both halves and the unsplit total, which is
// only worth doing if the halves really do add up. They do by construction,
// because every participant row goes into exactly one of them, and this file
// is where "by construction" is checked rather than asserted.
//
// THE SPLIT IS DERIVED FROM `side IS NOT NULL` AND FROM NOTHING ELSE. Tag
// Battle minted no matches.format key: tag rows stay format "board", the way
// Double Dash's pairs races stay their own format. The last test here says so
// in code.
//
// The database half is a plain SELECT and is not reachable without Postgres;
// what is worth testing is the fold, so the fold is a pure exported function.

import { test } from "node:test";
import assert from "node:assert/strict";
import { foldMpStatRows, type MpStatRow } from "../src/marioparty.js";

let seq = 0;
/** One recorded board: a match id, and one row per player who scored in it. */
function board(
  entries: readonly [user: string, stars: number, isWinner: boolean, side: string | null][],
  opts: { map?: string; bonus?: Record<string, string[]> } = {},
): MpStatRow[] {
  const matchId = `m${seq++}`;
  return entries.map(([user, stars, isWinner, side]) => ({
    userId: user,
    displayName: user.toUpperCase(),
    character: null,
    isWinner,
    stars,
    meta: opts.bonus?.[user] ? { bonusStars: opts.bonus[user] } : null,
    matchId,
    map: opts.map ?? "Grand Canal",
    side,
  }));
}

const byName = (out: ReturnType<typeof foldMpStatRows>, name: string) =>
  out.byPlayer.find((p) => p.name === name)!;

// ---------- a solo crew ----------

test("SOLO ONLY: every row lands in the solo half and the tag half stays empty", () => {
  const rows = [
    ...board([["u0", 10, true, null], ["u1", 6, false, null], ["u2", 3, false, null]]),
    ...board([["u1", 9, true, null], ["u0", 4, false, null], ["u2", 2, false, null]]),
  ];
  const out = foldMpStatRows(rows);
  assert.equal(out.games, 2);
  assert.equal(out.soloGames, 2);
  assert.equal(out.tagGames, 0);
  const u0 = byName(out, "U0");
  assert.equal(u0.solo.games, 2);
  assert.equal(u0.solo.totalStars, 14);
  assert.equal(u0.tag.games, 0);
  assert.equal(u0.tag.totalStars, 0);
  assert.equal(u0.totalStars, 14);
});

test("A BOARD RECORDED BEFORE TAG BATTLE, WITH side NULL, IS SOLO", () => {
  // Which is the same NULL the column has held since the pack shipped. No
  // backfill and no migration: an old board simply is a solo board.
  const out = foldMpStatRows(board([["u0", 7, true, null], ["u1", 1, false, null]]));
  assert.equal(byName(out, "U0").solo.games, 1);
  assert.equal(byName(out, "U0").tag.games, 0);
});

// ---------- the double count the split exists to prevent ----------

test("A TAG BOARD'S TOTAL IS ON BOTH MEMBERS AND STAYS OUT OF THE SOLO HALF", () => {
  // The side finished on 11. Both members carry 11, because that is what the
  // side scored and neither of them scored half of it. The solo column is
  // untouched, so a pair cannot outrank a solo player on one shared haul.
  const rows = board([
    ["u0", 11, true, "a"],
    ["u1", 11, true, "a"],
    ["u2", 5, false, "b"],
    ["u3", 5, false, "b"],
  ]);
  const out = foldMpStatRows(rows);
  assert.equal(out.games, 1);
  assert.equal(out.tagGames, 1);
  assert.equal(out.soloGames, 0);
  for (const n of ["U0", "U1"]) {
    assert.equal(byName(out, n).tag.totalStars, 11, `${n} carries the side's total`);
    assert.equal(byName(out, n).solo.totalStars, 0, `${n} contributes nothing to solo`);
    assert.equal(byName(out, n).wins, 1, `${n} genuinely won that board`);
  }
});

test("THE TWO HALVES SUM TO THE UNSPLIT TOTALS, on a mixed night", () => {
  // The property the panel's layout depends on. Checked over every player
  // rather than a chosen one, and over every figure the panel prints.
  const rows = [
    ...board([["u0", 10, true, null], ["u1", 6, false, null], ["u2", 3, false, null]]),
    ...board([["u0", 12, true, "a"], ["u1", 12, true, "a"], ["u2", 4, false, "b"], ["u3", 4, false, "b"]]),
    ...board([["u0", 2, false, null], ["u3", 8, true, null]]),
  ];
  const out = foldMpStatRows(rows);
  for (const p of out.byPlayer) {
    assert.equal(p.solo.games + p.tag.games, p.games, `${p.name} games`);
    assert.equal(p.solo.wins + p.tag.wins, p.wins, `${p.name} wins`);
    assert.equal(p.solo.totalStars + p.tag.totalStars, p.totalStars, `${p.name} stars`);
  }
  assert.equal(out.soloGames + out.tagGames, out.games);
  assert.equal(out.games, 3);
  assert.equal(out.tagGames, 1);
});

test("each half's average is over ITS OWN boards, not over all of them", () => {
  // Averaging a tag total across a player's solo boards would be a number
  // describing nothing.
  const rows = [
    ...board([["u0", 10, true, null], ["u1", 2, false, null]]),
    ...board([["u0", 4, false, null], ["u1", 9, true, null]]),
    ...board([["u0", 15, true, "a"], ["u1", 15, true, "a"], ["u2", 1, false, "b"], ["u3", 1, false, "b"]]),
  ];
  const u0 = byName(foldMpStatRows(rows), "U0");
  assert.equal(u0.solo.games, 2);
  assert.equal(u0.solo.avgStars, 7);
  assert.equal(u0.tag.games, 1);
  assert.equal(u0.tag.avgStars, 15);
  // And the unsplit average is still over all three, which is why it is
  // reported beside the halves rather than instead of them.
  assert.equal(u0.avgStars, 29 / 3);
});

test("a player with no boards on one side of the split gets a zero average, not NaN", () => {
  const out = foldMpStatRows(board([["u0", 5, true, null], ["u1", 1, false, null]]));
  assert.equal(byName(out, "U0").tag.avgStars, 0);
  assert.equal(byName(out, "U0").tag.games, 0);
});

// ---------- bonus stars, where the split bites hardest ----------

test("A PAIR'S SHARED BONUS STAR DOES NOT OUTRANK A SOLO PLAYER'S TWO TO ONE", () => {
  // The sharpest case for splitting. One Minigame Star was awarded on the tag
  // board and written to both members. Counted unsplit, that pair would show
  // two Minigame Stars against the solo winner's one and take the lead on a
  // star their side won once.
  const rows = [
    ...board([["u0", 9, true, null], ["u1", 3, false, null]], {
      map: "Pagoda Peak",
      bonus: { u0: ["Minigame Star"] },
    }),
    ...board([["u2", 12, true, "a"], ["u3", 12, true, "a"], ["u0", 5, false, "b"], ["u1", 5, false, "b"]], {
      map: "Neon Heights",
      bonus: { u2: ["Minigame Star"], u3: ["Minigame Star"] },
    }),
  ];
  const out = foldMpStatRows(rows);
  const minigame = out.bonusLeaders.find((b) => b.star === "Minigame")!;
  assert.equal(minigame.name, "U0");
  assert.equal(minigame.count, 1);
  // The pair's copies are not lost, they are reported per player as tag.
  assert.deepEqual(byName(out, "U2").bonusStarsTag, { Minigame: 1 });
  assert.deepEqual(byName(out, "U2").bonusStarsSolo, {});
  assert.deepEqual(byName(out, "U0").bonusStarsSolo, { Minigame: 1 });
  // And the unsplit per-player map still holds everything.
  assert.deepEqual(byName(out, "U2").bonusStars, { Minigame: 1 });
});

test("bonus stars still fold onto their FAMILY across titles, split or not", () => {
  // MP7's Running Star and Superstars' Sightseer Star are one achievement.
  const rows = [
    ...board([["u0", 9, true, null], ["u1", 3, false, null]], { bonus: { u0: ["Running Star"] } }),
    ...board([["u1", 9, true, null], ["u0", 3, false, null]], { bonus: { u1: ["Sightseer Star"] } }),
  ];
  const out = foldMpStatRows(rows);
  assert.equal(out.bonusLeaders.length, 1);
  assert.equal(out.bonusLeaders[0]!.star, "Walked farthest");
  assert.equal(out.bonusLeaders[0]!.count, 1);
});

test("an MP6 board recorded as an Event Star still folds onto Happening", () => {
  // MP6 offers "Happening Star" since 2026-08-30, but rows written before that
  // say "Event Star" in meta verbatim. The family map is read-side, so both
  // spellings land on the same family and one crew's history stays one tally.
  const rows = [
    ...board([["u0", 9, true, null], ["u1", 3, false, null]], { bonus: { u0: ["Event Star"] } }),
    ...board([["u1", 9, true, null], ["u0", 3, false, null]], { bonus: { u1: ["Happening Star"] } }),
  ];
  const out = foldMpStatRows(rows);
  assert.equal(out.bonusLeaders.length, 1);
  assert.equal(out.bonusLeaders[0]!.star, "Happening");
});

// ---------- what the split is NOT derived from ----------

test("THE SPLIT READS side AND NOTHING ELSE: the board label does not move it", () => {
  // Tag Battle minted no matches.format key and no label convention. If the
  // split ever started depending on either, this goes red: the same rows under
  // different board names must split identically.
  const a = foldMpStatRows(
    board([["u0", 9, true, "a"], ["u1", 9, true, "a"], ["u2", 2, false, "b"], ["u3", 2, false, "b"]], {
      map: "Pyramid Park",
    }),
  );
  const b = foldMpStatRows(
    board([["u0", 9, true, "a"], ["u1", 9, true, "a"], ["u2", 2, false, "b"], ["u3", 2, false, "b"]], {
      map: "Custom board",
    }),
  );
  assert.equal(a.tagGames, b.tagGames);
  assert.deepEqual(
    a.byPlayer.map((p) => [p.name, p.tag.totalStars, p.solo.totalStars]),
    b.byPlayer.map((p) => [p.name, p.tag.totalStars, p.solo.totalStars]),
  );
});

test("an empty crew folds to zeroes rather than throwing", () => {
  // The route's early return goes through this same function, so the shape a
  // crew with no boards gets back cannot drift from the shape everyone else
  // gets. That drift is exactly what an inline literal would allow.
  const out = foldMpStatRows([]);
  assert.equal(out.games, 0);
  assert.equal(out.soloGames, 0);
  assert.equal(out.tagGames, 0);
  assert.deepEqual(out.byPlayer, []);
  assert.deepEqual(out.bonusLeaders, []);
});

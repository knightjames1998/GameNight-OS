// CARD TABLE, the pack that is a config file.
//
// The engine, the screens and the routes are all shared with Board Game and are
// tested where they live. What is left to test here is the config itself, which
// is the entire pack, and the two things about it that reach the ledger and the
// screen: which titles open with partnerships, and that the shared identifiers
// stayed the ones that were picked.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTitleShape,
  CARD_TABLE_CONFIG,
  CARD_TABLE_MAX_PLAYERS,
  CARD_TABLE_TITLES,
  currentTnSides,
  defaultShapeForTitle,
  newCtState,
  recordTnGame,
  summarizeCtNight,
  tnSideIdOf,
  validateTnOrder,
  SESSION_PACKS,
  type CtPlayer,
} from "../src/index.js";

const players = (n: number): CtPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, kind: "member" as const, userId: `u${i}`, name: `P${i}` }));

test("the curated list, exactly as it shipped", () => {
  // Not just a count: a title quietly dropped or renamed splits that title's
  // history from itself, because the per-title stats group on matches.label.
  assert.deepEqual(CARD_TABLE_TITLES, [
    "Euchre",
    "Spades",
    "Hearts",
    "Cribbage",
    "Rummy",
    "Gin",
    "Uno",
    "President",
  ]);
});

test("Euchre and Spades are partnership games; everything else is not", () => {
  assert.equal(defaultShapeForTitle(CARD_TABLE_CONFIG, "Euchre"), 2);
  assert.equal(defaultShapeForTitle(CARD_TABLE_CONFIG, "Spades"), 2);
  for (const t of ["Hearts", "Cribbage", "Rummy", "Gin", "Uno", "President"]) {
    assert.equal(defaultShapeForTitle(CARD_TABLE_CONFIG, t), 1, `${t} should open free-for-all`);
  }
  // And a free-typed title has no default, because there is nothing to look up.
  assert.equal(defaultShapeForTitle(CARD_TABLE_CONFIG, "Whatever We Made Up"), 1);
});

test("CRIBBAGE IS FREE-FOR-ALL ON PURPOSE, and two-handed proves it costs nothing", () => {
  // Four-handed cribbage IS partnership and two-handed is the game most people
  // mean, so a default of 2 would be wrong more often than right. With exactly
  // two players the two shapes are the same arrangement anyway.
  const two = newCtState({ roster: players(2) });
  assert.equal(applyTitleShape(two, CARD_TABLE_CONFIG, "Cribbage"), null);
  assert.deepEqual(currentTnSides(two).map((s) => s.memberIds), [["p0"], ["p1"]]);
});

test("a Euchre night opens in pairs and records one result for the pair", () => {
  const s = newCtState({ roster: players(4) });
  assert.ok(applyTitleShape(s, CARD_TABLE_CONFIG, "Euchre"));
  const sides = currentTnSides(s);
  assert.deepEqual(sides.map((x) => x.memberIds.length), [2, 2]);

  const g = recordTnGame(s, "Euchre", [{ sideId: sides[0]!.id }, { sideId: sides[1]!.id }]);
  // FOUR ledger rows, because four people played, and the SIDE is on each of
  // them: the placement ranks sides, so both partners share a placement.
  assert.equal(g.lines.length, 4);
  assert.deepEqual(g.lines.map((l) => l.placement), [1, 1, 2, 2]);
  assert.deepEqual(g.lines.map((l) => l.isWinner), [true, true, false, false]);
  assert.deepEqual(new Set(g.lines.map((l) => l.side)), new Set([sides[0]!.id, sides[1]!.id]));
});

test("a Hearts night records four separate finishes", () => {
  const s = newCtState({ roster: players(4) });
  const g = recordTnGame(
    s,
    "Hearts",
    ["p0", "p1", "p2", "p3"].map((id) => ({ sideId: tnSideIdOf(s, id)! })),
  );
  assert.deepEqual(g.lines.map((l) => l.placement), [1, 2, 3, 4]);
  // SIDE IS NULL when every side holds one player: the column means "there was
  // a team structure", and on a free-for-all night there was not.
  assert.deepEqual(g.lines.map((l) => l.side), [null, null, null, null]);
});

test("the standings count a partnership win for both partners", () => {
  const s = newCtState({ roster: players(4) });
  applyTitleShape(s, CARD_TABLE_CONFIG, "Euchre");
  const sides = currentTnSides(s);
  recordTnGame(s, "Euchre", [{ sideId: sides[0]!.id }, { sideId: sides[1]!.id }]);

  const summary = summarizeCtNight(s);
  const winners = sides[0]!.memberIds;
  for (const p of summary.players) {
    assert.equal(p.wins, winners.includes(p.playerId) ? 1 : 0, `${p.playerId}`);
  }
});

test("the cap is 12, and the validation copy says card game", () => {
  assert.equal(CARD_TABLE_MAX_PLAYERS, 12);
  assert.equal(CARD_TABLE_CONFIG.maxPlayers, 12);
  const s = newCtState({ roster: players(4) });
  const one = validateTnOrder([{ sideId: tnSideIdOf(s, "p0")! }], s, CARD_TABLE_CONFIG);
  assert.match(one!, /card game/);
});

test("the identifiers are the ones that were picked, and they must not move", () => {
  // The five that fail SILENTLY. Pinned here as well as in packs.test.ts
  // because this is the file somebody edits when they change the pack.
  const p = SESSION_PACKS.cardtable;
  assert.equal(p.ledger, "cardtable");
  assert.equal(p.gameName, "Card Table");
  assert.equal(p.keyPrefix, "ct");
  assert.equal(p.route, "cardtable");
  assert.equal(p.wsType, "cardtable_updated");
  assert.equal(p.table, "game_sessions");
});

test("the ledger key shape is ct:{eventId}:{sessionKey}:{idx}", () => {
  const key = (eventId: string, sessionKey: string, idx: number) =>
    `${SESSION_PACKS.cardtable.keyPrefix}:${eventId}:${sessionKey}:${idx}`;
  assert.equal(key("E1", "sess1", 0), "ct:E1:sess1:0");
  // And it cannot collide with Board Game's, which is the whole point of the
  // prefix being per pack.
  assert.notEqual(SESSION_PACKS.cardtable.keyPrefix, SESSION_PACKS.boardgame.keyPrefix);
});

test("Poker is deliberately not a card table title", () => {
  // It is money, it settles, and it belongs to the casino group's engine. A
  // poker night recorded here would produce placements with no money attached,
  // which is the wrong record of the evening.
  assert.ok(!CARD_TABLE_TITLES.some((t) => /poker/i.test(t)));
});

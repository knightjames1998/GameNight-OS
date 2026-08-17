// CHARACTERIZATION TESTS FOR THE CASH ENGINE, captured BEFORE the poker session
// widened `CashBank` from two members to three.
//
// WHY A SECOND FILE RATHER THAN MORE CASES IN cashgame.test.ts. That file
// asserts what the engine SHOULD do, case by case, and it is the right place
// for a new rule. This one asserts what the engine ALREADY DID on the day the
// third bank type was added, over whole settlements rather than one field at a
// time, and its only job is to fail if adding `"table"` moved a player-banked or
// casino-banked table by so much as a cent. That is a different question from
// "is this rule correct", and mixing the two makes it impossible to tell a
// deliberate change from an accidental one when a later diff turns something
// red.
//
// The same shape as mariokart-baseline.test.ts and sidelog-baseline.test.ts,
// and for the same reason both of those exist: the fixtures were captured off
// the unmodified engine FIRST, so a conversion that claims to change nothing
// has something to prove it against.
//
// WHAT IS PINNED IS THE WHOLE SETTLEMENT OBJECT, deliberately. A test that
// checks three fields cannot see a fourth one moving, and `settleCash` returns
// six top-level values plus a line per player with twelve fields each. Deep
// equality over the lot is the only assertion that actually means "nothing
// moved".

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balanceWarning,
  cashLedgerLines,
  settleCash,
  summarizeCash,
  type CashEntry,
  type CashPlayer,
  type CashSessionCore,
} from "../src/index.js";

const player = (id: string, kind: "member" | "guest" = "member"): CashPlayer => ({
  id,
  kind,
  userId: kind === "member" ? `u_${id}` : null,
  name: id,
});

const entry = (playerId: string, buyIn: number, rebuys: number[], cashOut: number | null): CashEntry => ({
  playerId,
  buyIn,
  rebuys,
  cashOut,
  at: cashOut === null ? null : "2026-08-17T02:00:00.000Z",
});

const core = (
  bank: CashSessionCore["bank"],
  bankerId: string | null,
  entries: CashEntry[],
  kinds: Record<string, "member" | "guest"> = {},
): CashSessionCore => ({
  bank,
  bankerId,
  roster: entries.map((e) => player(e.playerId, kinds[e.playerId] ?? "member")),
  entries,
});

// ---------- the fixtures ----------
//
// Four tables that between them reach every branch in settleCash: a banker who
// has counted, a banker who has not, a table that does not balance, and a
// casino table where nobody is derived at all.

const BANKED_BALANCED = core("player", "ana", [
  // ana's typed count is 19000, which is exactly what the other three imply,
  // so this table balances. That took one correction: the first draft of this
  // fixture was hand-arithmetic and came out 2000 short, which is precisely the
  // mistake the balance check exists to catch on a real night.
  entry("ana", 20000, [], 19000),
  entry("bo", 5000, [2000], 9000),
  entry("cass", 5000, [], 2000),
  entry("dev", 4000, [1000], 7000),
]);

const BANKED_LIVE = core("player", "ana", [
  entry("ana", 20000, [], null),
  entry("bo", 5000, [2000], 9000),
  entry("cass", 5000, [], null),
]);

const BANKED_OFF = core("player", "ana", [
  entry("ana", 20000, [], 16000),
  entry("bo", 5000, [2000], 9000),
  entry("cass", 5000, [], 2000),
  entry("dev", 4000, [1000], 7000),
]);

const CASINO = core("casino", null, [
  entry("ana", 10000, [5000], 22000),
  entry("bo", 10000, [], 0),
  entry("cass", 8000, [2000], null),
]);

test("PINNED: a player-banked table that balances", () => {
  assert.deepEqual(settleCash(BANKED_BALANCED), {
    lines: [
      { playerId: "bo", buyIn: 5000, rebuys: 1, rebuyTotal: 2000, totalIn: 7000, cashOut: 9000, cashedOut: true, net: 2000, derived: false, placement: 1, isWinner: true },
      { playerId: "dev", buyIn: 4000, rebuys: 1, rebuyTotal: 1000, totalIn: 5000, cashOut: 7000, cashedOut: true, net: 2000, derived: false, placement: 1, isWinner: true },
      { playerId: "ana", buyIn: 20000, rebuys: 0, rebuyTotal: 0, totalIn: 20000, cashOut: 19000, cashedOut: true, net: -1000, derived: true, placement: 3, isWinner: false },
      { playerId: "cass", buyIn: 5000, rebuys: 0, rebuyTotal: 0, totalIn: 5000, cashOut: 2000, cashedOut: true, net: -3000, derived: false, placement: 4, isWinner: false },
    ],
    balance: { checked: true, balanced: true, delta: 0 },
    totalIn: 37000,
    totalOut: 37000,
    onTable: 0,
    stillIn: 0,
  });
  assert.equal(balanceWarning(settleCash(BANKED_BALANCED).balance), null);
});

test("PINNED: a live player-banked table derives from whoever has counted", () => {
  const s = settleCash(BANKED_LIVE);
  assert.deepEqual(s.lines.map((l) => [l.playerId, l.net, l.derived, l.placement]), [
    ["bo", 2000, false, 1],
    ["ana", -2000, true, 2],
    ["cass", null, false, null],
  ]);
  assert.deepEqual(s.balance, { checked: false, balanced: true, delta: 0 });
  assert.equal(s.stillIn, 2);
  assert.equal(s.onTable, 32000 - 9000);
});

test("PINNED: a player-banked table that does not balance reports the exact delta", () => {
  const s = settleCash(BANKED_OFF);
  assert.deepEqual(s.balance, { checked: true, balanced: false, delta: -3000 });
  assert.equal(
    balanceWarning(s.balance),
    "The table does not balance, off by $30.00. Less was cashed out than was bought in, so a cash-out is too low or one is missing.",
  );
  // The banker's LINE still carries the derived net, not their typed count.
  assert.equal(s.lines.find((l) => l.playerId === "ana")?.net, -1000);
});

test("PINNED: a casino table derives nobody and checks nothing", () => {
  const s = settleCash(CASINO);
  assert.deepEqual(s.lines.map((l) => [l.playerId, l.net, l.derived]), [
    ["ana", 7000, false],
    ["bo", -10000, false],
    ["cass", null, false],
  ]);
  assert.deepEqual(s.balance, { checked: false, balanced: true, delta: 0 });
  assert.equal(balanceWarning(s.balance), null);
});

test("PINNED: final forces an absent cash-out to zero, on every bank type", () => {
  for (const [name, c] of [["banked", BANKED_LIVE], ["casino", CASINO]] as const) {
    const s = settleCash(c, { final: true });
    assert.equal(s.stillIn, name === "banked" ? 2 : 1, `${name}: stillIn counts uncounted seats either way`);
    for (const l of s.lines) assert.notEqual(l.net, null, `${name}: every net is a number once final`);
  }
});

test("PINNED: the ledger meta bag for both existing bank types", () => {
  const banked = cashLedgerLines(settleCash(BANKED_BALANCED, { final: true }), {
    bank: "player",
    bankerId: "ana",
    stakes: "real",
  });
  assert.deepEqual(banked.find((l) => l.playerId === "ana")!.meta, {
    bank: "player",
    stakes: "real",
    buyIn: 20000,
    rebuys: 0,
    rebuyTotal: 0,
    totalIn: 20000,
    cashOut: 19000,
    net: -1000,
    banker: true,
    derivedNet: true,
  });
  assert.deepEqual(banked.find((l) => l.playerId === "bo")!.meta, {
    bank: "player",
    stakes: "real",
    buyIn: 5000,
    rebuys: 1,
    rebuyTotal: 2000,
    totalIn: 7000,
    cashOut: 9000,
    net: 2000,
  });

  const casino = cashLedgerLines(settleCash(CASINO, { final: true }), {
    bank: "casino",
    bankerId: null,
    stakes: "play",
  });
  // Nobody is a banker on a casino table, so no row carries those two keys.
  for (const l of casino) {
    assert.equal("banker" in l.meta, false);
    assert.equal("derivedNet" in l.meta, false);
    assert.equal(l.meta.bank, "casino");
    assert.equal(l.meta.stakes, "play");
  }
});

test("PINNED: summarizeCash's shape for a player-banked table", () => {
  const s = summarizeCash(BANKED_BALANCED, { of: () => null, events: () => 0, total: 0 });
  assert.equal(s.bank, "player");
  assert.equal(s.bankerId, "ana");
  assert.equal(s.stakes, "real");
  assert.equal(s.cashedOut, 4);
  assert.equal(s.stillIn, 0);
  assert.equal(s.warning, null);
  assert.deepEqual(
    s.players.map((p) => [p.playerId, p.isBanker, p.net, p.derived]),
    [
      ["bo", false, 2000, false],
      ["dev", false, 2000, false],
      ["ana", true, -1000, true],
      ["cass", false, -3000, false],
    ],
  );
});

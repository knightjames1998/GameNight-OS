// Tests for the craps pack's own rules (packages/shared/src/craps.ts).
//
// The MONEY is not retested here, for the same reason roulette's suite does not
// retest it: buy-ins, rebuys, net, placement, the derived banker and the
// balance check all live in the shared engine and are covered exhaustively in
// cashgame.test.ts. What is left is THE SHOOTER'S HAND, and the case the
// session brief singled out as the easiest thing to get subtly wrong: undo of a
// seven-out has to REOPEN the closed hand and hand the dice back, not merely
// decrement a counter.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crDetail,
  crapsHands,
  crapsRecord,
  crapsSetShooter,
  crapsUndo,
  detailFromEvents,
  newCrapsState,
  nextShooter,
  openHand,
  summarizeCraps,
  type CashPlayer,
  type CrSessionState,
} from "../src/index.js";

const player = (id: string, name = id): CashPlayer => ({
  id,
  kind: "member",
  userId: `u_${id}`,
  name,
});

const AT = "2026-07-29T02:00:00.000Z";

/** A three-player table, dice with the first player, tracker on. */
const table = (): CrSessionState =>
  newCrapsState({
    bank: "player",
    bankerId: "a",
    roster: [player("a", "Ada"), player("b", "Bo"), player("c", "Cy")],
    defaultBuyIn: 2000,
    buyIns: { a: 30000 },
    tracker: true,
  });

const roll = (s: CrSessionState, n = 1) => {
  for (let i = 0; i < n; i++) assert.equal(crapsRecord(s, "roll", AT), true);
};
const point = (s: CrSessionState) => assert.equal(crapsRecord(s, "point", AT), true);
const sevenOut = (s: CrSessionState) => assert.equal(crapsRecord(s, "sevenOut", AT), true);

// ---------- hand accumulation ----------

test("rolls accumulate into the hand in progress", () => {
  const s = table();
  roll(s, 5);
  const open = openHand(s.events);
  assert.equal(open?.playerId, "a");
  assert.equal(open?.rolls, 5);
  assert.equal(open?.ended, null);
  // Nothing is CLOSED yet, so there is no record to beat.
  assert.equal(summarizeCraps(s).longest, null);
});

test("a point made does NOT close the hand, it just counts", () => {
  const s = table();
  roll(s, 3);
  point(s);
  roll(s, 2);
  point(s);
  const open = openHand(s.events);
  assert.equal(open?.rolls, 5); // a point is not a roll
  assert.equal(open?.points, 2);
  assert.equal(open?.ended, null);
  assert.equal(s.shooterId, "a"); // and the dice have not moved
});

test("a seven-out closes the hand and passes the dice", () => {
  const s = table();
  roll(s, 7);
  point(s);
  sevenOut(s);
  assert.equal(openHand(s.events), null);
  const hands = crapsHands(s.events);
  assert.equal(hands.length, 1);
  assert.deepEqual(
    { ...hands[0]!, at: null },
    { playerId: "a", rolls: 7, points: 1, ended: "sevenOut", at: null },
  );
  assert.equal(s.shooterId, "b");
});

test("the seven-out is not counted as a roll survived", () => {
  // "Rolls survived BEFORE sevening out" is the bragging right, so a shooter
  // who sevens out on the first throw survived nothing. Zero is the honest
  // answer, not one.
  const s = table();
  sevenOut(s);
  assert.equal(crapsHands(s.events)[0]!.rolls, 0);
  assert.equal(summarizeCraps(s).longest?.rolls, 0);
});

test("nothing can be recorded when nobody holds the dice", () => {
  const s = table();
  s.shooterId = null;
  assert.equal(crapsRecord(s, "roll", AT), false);
  assert.deepEqual(s.events, []);
});

// ---------- longest hand, per player and across the table ----------

test("longest roll is the max CLOSED hand per player, over several hands", () => {
  const s = table();
  roll(s, 4); // Ada: 4
  sevenOut(s);
  roll(s, 11); // Bo: 11
  sevenOut(s);
  roll(s, 2); // Cy: 2
  sevenOut(s);
  roll(s, 9); // Ada again: 9, so her best is 9
  sevenOut(s);

  assert.equal(detailFromEvents(s.events, "a").longestRoll, 9);
  assert.equal(detailFromEvents(s.events, "b").longestRoll, 11);
  assert.equal(detailFromEvents(s.events, "c").longestRoll, 2);

  // And the night's record names who holds it.
  const sum = summarizeCraps(s);
  assert.deepEqual(sum.longest, { playerId: "b", name: "Bo", rolls: 11 });
});

test("a shorter later hand never lowers the record", () => {
  const s = table();
  roll(s, 12);
  sevenOut(s);
  crapsSetShooter(s, "a", AT);
  roll(s, 1);
  sevenOut(s);
  assert.equal(detailFromEvents(s.events, "a").longestRoll, 12);
});

test("points made total across a player's hands", () => {
  const s = table();
  point(s);
  point(s);
  sevenOut(s);
  crapsSetShooter(s, "a", AT);
  point(s);
  sevenOut(s);
  assert.equal(detailFromEvents(s.events, "a").points, 3);
});

test("the hand in progress is excluded live and counted at completion", () => {
  // Live, the TV's "to beat" number must be a real target rather than whatever
  // the current shooter happens to be on. At completion the night is over, so
  // the hand that was in progress is a hand that happened.
  const s = table();
  roll(s, 3);
  sevenOut(s);
  crapsSetShooter(s, "a", AT);
  roll(s, 20); // still going
  assert.equal(crDetail(s, "a").longestRoll, 3);
  assert.equal(crDetail(s, "a", { includeOpen: true }).longestRoll, 20);
  assert.equal(summarizeCraps(s).longest?.rolls, 3);
  assert.equal(summarizeCraps(s).shooter?.rolls, 20);
});

test("a player the tracker never saw has no detail at all", () => {
  const s = table();
  roll(s, 3);
  sevenOut(s);
  assert.deepEqual(detailFromEvents(s.events, "c"), { longestRoll: null, points: null });
  // Absent, not zero: nobody was counting for them.
  assert.equal(crDetail(s, "c").longestRoll, null);
  assert.equal(crDetail(s, "c").points, null);
});

// ---------- undo: the case the brief singled out ----------

test("undoing a seven-out REOPENS the hand and gives the dice back", () => {
  const s = table();
  roll(s, 6);
  point(s);
  sevenOut(s);
  assert.equal(s.shooterId, "b");
  assert.equal(openHand(s.events), null);
  assert.equal(summarizeCraps(s).longest?.rolls, 6);

  const undone = crapsUndo(s);
  assert.equal(undone?.kind, "sevenOut");
  // The dice are back with whoever sevened out...
  assert.equal(s.shooterId, "a");
  // ...the hand is open again, with everything it had...
  const open = openHand(s.events);
  assert.equal(open?.playerId, "a");
  assert.equal(open?.rolls, 6);
  assert.equal(open?.points, 1);
  // ...and it is no longer a record, because it has not finished.
  assert.equal(summarizeCraps(s).longest, null);

  // The hand carries on from exactly where it was.
  roll(s, 2);
  assert.equal(openHand(s.events)?.rolls, 8);
});

test("undoing a roll leaves the dice exactly where they are", () => {
  const s = table();
  roll(s, 4);
  const undone = crapsUndo(s);
  assert.equal(undone?.kind, "roll");
  assert.equal(s.shooterId, "a");
  assert.equal(openHand(s.events)?.rolls, 3);
});

test("undoing a point takes back the point, not a roll", () => {
  const s = table();
  roll(s, 2);
  point(s);
  crapsUndo(s);
  assert.equal(openHand(s.events)?.rolls, 2);
  assert.equal(openHand(s.events)?.points, 0);
});

test("undo walks all the way back through several shooters", () => {
  const s = table();
  roll(s, 2);
  sevenOut(s); // -> Bo
  roll(s, 3);
  sevenOut(s); // -> Cy
  assert.equal(s.shooterId, "c");

  crapsUndo(s); // Bo's seven-out
  assert.equal(s.shooterId, "b");
  assert.equal(openHand(s.events)?.rolls, 3);
  crapsUndo(s); // Bo's third roll
  crapsUndo(s);
  crapsUndo(s); // Bo has no events left
  assert.equal(s.shooterId, "b");
  crapsUndo(s); // Ada's seven-out
  assert.equal(s.shooterId, "a");
  assert.equal(openHand(s.events)?.rolls, 2);
  crapsUndo(s);
  crapsUndo(s);
  assert.deepEqual(s.events, []);
  assert.equal(crapsUndo(s), null); // and it stops rather than throwing
  assert.equal(s.shooterId, "a");
});

test("undo cannot leave the board disagreeing with the log", () => {
  // The property that makes the whole design worth it: whatever sequence of
  // taps and undos happens, the hands are a pure function of the log.
  const s = table();
  const script = ["roll", "roll", "point", "sevenOut", "roll", "sevenOut", "roll", "point"] as const;
  for (const k of script) crapsRecord(s, k, AT);
  for (let i = 0; i < 4; i++) crapsUndo(s);
  assert.deepEqual(crapsHands(s.events), crapsHands([...s.events]));
  assert.equal(s.events.length, 4);
  assert.deepEqual(
    crapsHands(s.events).map((h) => [h.playerId, h.rolls, h.points, h.ended]),
    [["a", 2, 1, "sevenOut"]],
  );
});

// ---------- passing the dice ----------

test("handing the dice on CLOSES the hand without a seven-out", () => {
  // Somebody who gives up the dice after twelve rolls held them for twelve
  // rolls, which is how anyone at the table would describe it.
  const s = table();
  roll(s, 12);
  assert.equal(crapsSetShooter(s, "c", AT), true);
  assert.equal(s.shooterId, "c");
  const hands = crapsHands(s.events);
  assert.equal(hands.length, 1);
  assert.equal(hands[0]!.ended, "pass");
  assert.equal(detailFromEvents(s.events, "a").longestRoll, 12);
});

test("undoing a pass gives the dice back and reopens that hand", () => {
  const s = table();
  roll(s, 5);
  crapsSetShooter(s, "b", AT);
  const undone = crapsUndo(s);
  assert.equal(undone?.kind, "pass");
  assert.equal(s.shooterId, "a");
  assert.equal(openHand(s.events)?.rolls, 5);
});

test("setting the shooter to whoever already has the dice is a no-op", () => {
  const s = table();
  roll(s, 3);
  assert.equal(crapsSetShooter(s, "a", AT), true);
  assert.equal(s.events.length, 3); // no stray pass logged
  assert.equal(openHand(s.events)?.rolls, 3);
});

test("the dice cannot be handed to somebody who is not at the table", () => {
  const s = table();
  assert.equal(crapsSetShooter(s, "nobody", AT), false);
  assert.equal(s.shooterId, "a");
});

// ---------- rotation, including a cash-out mid-session ----------

test("the dice rotate in roster order", () => {
  const s = table();
  assert.equal(nextShooter(s, "a"), "b");
  assert.equal(nextShooter(s, "b"), "c");
  assert.equal(nextShooter(s, "c"), "a"); // and wrap
});

test("a player who has cashed out is skipped", () => {
  const s = table();
  s.entries.find((e) => e.playerId === "b")!.cashOut = 4000;
  assert.equal(nextShooter(s, "a"), "c");
  // And through the real action, not just the helper.
  roll(s, 1);
  sevenOut(s);
  assert.equal(s.shooterId, "c");
});

test("a shooter who cashes out still hands the dice to the next seat", () => {
  // Not to the top of the list: Bo cashing out mid-hand must not send the dice
  // back to Ada, because Cy is who is sitting next.
  const s = table();
  crapsSetShooter(s, "b", AT);
  s.entries.find((e) => e.playerId === "b")!.cashOut = 0;
  roll(s, 2);
  sevenOut(s);
  assert.equal(s.shooterId, "c");
});

test("the last player still in keeps the dice", () => {
  const s = table();
  for (const id of ["b", "c"]) s.entries.find((e) => e.playerId === id)!.cashOut = 0;
  roll(s, 1);
  sevenOut(s);
  assert.equal(s.shooterId, "a");
});

test("nobody left in means nobody holds the dice, and the screen can say so", () => {
  const s = table();
  for (const e of s.entries) e.cashOut = 0;
  roll(s, 1);
  sevenOut(s);
  assert.equal(s.shooterId, null);
  assert.equal(summarizeCraps(s).shooter, null);
  // Recoverable: somebody sits back down and the host hands them the dice.
  s.entries.find((e) => e.playerId === "c")!.cashOut = null;
  assert.equal(crapsSetShooter(s, "c", AT), true);
  assert.equal(summarizeCraps(s).shooter?.name, "Cy");
});

// ---------- typed vs derived ----------

test("a typed detail beats the tracker per FIELD", () => {
  const s = table();
  roll(s, 4);
  point(s);
  sevenOut(s);
  // The host corrects the hand length and leaves the rest alone: the points
  // the tracker counted must survive.
  s.detail.a = { longestRoll: 21 };
  const d = crDetail(s, "a");
  assert.equal(d.longestRoll, 21);
  assert.equal(d.points, 1);
});

test("biggest bet and biggest win are typed only, because the tracker follows the dice", () => {
  const s = table();
  roll(s, 3);
  sevenOut(s);
  assert.equal(crDetail(s, "a").biggestBet, null);
  s.detail.a = { biggestBet: 5000, biggestWin: 12000 };
  assert.equal(crDetail(s, "a").biggestBet, 5000);
  assert.equal(crDetail(s, "a").biggestWin, 12000);
  // And the derived halves still come from the log.
  assert.equal(crDetail(s, "a").longestRoll, 3);
});

test("with the tracker off, the form's numbers are the whole record", () => {
  const s = table();
  s.tracker = false;
  s.events = [];
  s.detail.a = { longestRoll: 17, points: 4, biggestBet: 2500, biggestWin: 9000 };
  assert.deepEqual(crDetail(s, "a"), {
    longestRoll: 17,
    points: 4,
    biggestBet: 2500,
    biggestWin: 9000,
  });
  const sum = summarizeCraps(s);
  assert.equal(sum.events, 0);
  assert.equal(sum.longest, null); // the session record needs the tracker
});

// ---------- wired to the shared engine ----------

test("a craps night settles exactly like the other two cash packs", () => {
  const s = table();
  s.entries = [
    { playerId: "a", buyIn: 30000, rebuys: [], cashOut: 26500, at: AT },
    { playerId: "b", buyIn: 2000, rebuys: [2000], cashOut: 9000, at: AT }, // +50.00
    { playerId: "c", buyIn: 2000, rebuys: [], cashOut: 500, at: AT }, // -15.00
  ];
  const sum = summarizeCraps(s);
  assert.deepEqual(sum.players.map((p) => p.name), ["Bo", "Cy", "Ada"]);
  assert.deepEqual(sum.players.map((p) => p.net), [5000, -1500, -3500]);
  assert.deepEqual(sum.players.map((p) => p.placement), [1, 2, 3]);
  assert.equal(sum.players[2]!.derived, true); // the banker
  assert.equal(sum.balance.checked, true);
  assert.equal(sum.balance.balanced, true);
  assert.equal(sum.totalIn, 36000);
});

test("a fresh craps session has the tracker off and the dice with the first seat", () => {
  const s = newCrapsState({
    bank: "casino",
    bankerId: "a",
    roster: [player("a"), player("b")],
    defaultBuyIn: 2000,
  });
  assert.equal(s.tracker, false);
  assert.deepEqual(s.events, []);
  assert.equal(s.shooterId, "a");
  assert.equal(s.bankerId, null); // casino-banked clears it
  assert.equal(s.openScoring, false);
});

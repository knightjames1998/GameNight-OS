// Tests for the shared cash-game engine (packages/shared/src/cashgame.ts) and
// the blackjack rules that sit on it.
//
// Pure logic only, no Drizzle stub, no database, which is the point of the
// engine being pure in the first place. Everything money-shaped in the four
// casino packs funnels through the functions asserted here, so this is the
// file that stops a wrong number reaching a leaderboard.
//
// THE FLOAT TEST IS THE IMPORTANT ONE. `many small odd amounts sum exactly`
// below is written to FAIL if anybody ever reintroduces a JS number holding
// dollars: 3.33 + 3.33 + 3.34 is 10.000000000000002 in binary floating point,
// so a table that is perfectly correct would report a balance delta of two
// ten-billionths of a cent and send the host hunting a mistake that does not
// exist. In cents it is 333 + 333 + 334 = 1000, exactly, always.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateByModifier,
  balanceWarning,
  cashLedgerLines,
  detailFromHands,
  formatCents,
  formatCentsSigned,
  handPayout,
  netOf,
  newBlackjackState,
  parseCents,
  rankByNet,
  settleCash,
  settleTransfers,
  summarizeBlackjack,
  totalIn,
  type BjHand,
  type CashBalance,
  type CashEntry,
  type CashNight,
  type CashPlayer,
  type CashSessionCore,
} from "../src/index.js";

// ---------- helpers ----------

const player = (id: string, name = id): CashPlayer => ({
  id,
  kind: "member",
  userId: `u_${id}`,
  name,
});

const entry = (playerId: string, buyIn: number, rebuys: number[], cashOut: number | null): CashEntry => ({
  playerId,
  buyIn,
  rebuys,
  cashOut,
  at: cashOut === null ? null : "2026-07-29T02:00:00.000Z",
});

const table = (
  bank: "player" | "casino",
  bankerId: string | null,
  entries: CashEntry[],
): CashSessionCore => ({
  bank,
  bankerId,
  roster: entries.map((e) => player(e.playerId)),
  entries,
});

const lineFor = (s: ReturnType<typeof settleCash>, id: string) => {
  const l = s.lines.find((x) => x.playerId === id);
  assert.ok(l, `no line for ${id}`);
  return l;
};

// ---------- net ----------

test("net is cash-out minus everything that went in", () => {
  // No rebuys: in for $20, out with $35.
  assert.equal(netOf(entry("a", 2000, [], 3500)), 1500);
  // Down: in for $20, out with $4.50.
  assert.equal(netOf(entry("a", 2000, [], 450)), -1550);
  // Even.
  assert.equal(netOf(entry("a", 2000, [], 2000)), 0);
  // Busted out for nothing.
  assert.equal(netOf(entry("a", 2000, [], 0)), -2000);
});

test("net counts every rebuy, not just the buy-in", () => {
  // $20 in, two $20 rebuys, cashed out $100: in for $60, up $40.
  const e = entry("a", 2000, [2000, 2000], 10000);
  assert.equal(totalIn(e), 6000);
  assert.equal(netOf(e), 4000);
});

test("rebuys are not all the same size, and the list is what makes that true", () => {
  // A $20 buy-in, a $20 rebuy and a $50 rebuy is $90 in, not "three buy-ins".
  const e = entry("a", 2000, [2000, 5000], 4000);
  assert.equal(totalIn(e), 9000);
  assert.equal(netOf(e), -5000);
});

test("a player still at the table has no net yet", () => {
  // Not -totalIn: their chips are on the table and reporting a loss would be
  // a lie that reads as a bad night.
  assert.equal(netOf(entry("a", 2000, [], null)), null);
});

// ---------- placement ----------

test("placement ranks by net, descending", () => {
  const ranked = rankByNet([
    { id: "a", net: -1000 },
    { id: "b", net: 4000 },
    { id: "c", net: 500 },
  ]);
  assert.deepEqual(
    ranked.map((r) => [r.id, r.placement]),
    [
      ["b", 1],
      ["c", 2],
      ["a", 3],
    ],
  );
  assert.deepEqual(ranked.map((r) => r.isWinner), [true, false, false]);
});

test("ties are co-placements at competition ranking: two on 1, next on 3", () => {
  const ranked = rankByNet([
    { id: "a", net: 2500 },
    { id: "b", net: 2500 },
    { id: "c", net: -100 },
  ]);
  assert.deepEqual(
    ranked.map((r) => [r.id, r.placement]),
    [
      ["a", 1],
      ["b", 1],
      ["c", 3],
    ],
  );
  // Both co-leaders win; this is the same convention Smashdown uses.
  assert.deepEqual(ranked.map((r) => r.isWinner), [true, true, false]);
});

test("a three-way tie for first is followed by fourth", () => {
  const ranked = rankByNet([
    { id: "a", net: 0 },
    { id: "b", net: 0 },
    { id: "c", net: 0 },
    { id: "d", net: -1 },
  ]);
  assert.deepEqual(ranked.map((r) => r.placement), [1, 1, 1, 4]);
});

test("a tie in the middle of the table still advances the next placement", () => {
  const ranked = rankByNet([
    { id: "a", net: 900 },
    { id: "b", net: 100 },
    { id: "c", net: 100 },
    { id: "d", net: -50 },
  ]);
  assert.deepEqual(ranked.map((r) => r.placement), [1, 2, 2, 4]);
});

test("players still at the table rank nowhere and sort last", () => {
  const ranked = rankByNet([
    { id: "a", net: null },
    { id: "b", net: -900 },
    { id: "c", net: 100 },
  ]);
  assert.deepEqual(
    ranked.map((r) => [r.id, r.placement]),
    [
      ["c", 1],
      ["b", 2],
      ["a", null],
    ],
  );
});

// ---------- the derived banker ----------

test("the banker's net is the exact inverse of the rest of the table", () => {
  const s = settleCash(
    table("player", "bank", [
      entry("bank", 20000, [], 17000), // the float, and what came back
      entry("a", 2000, [], 5000), // +30.00
      entry("b", 2000, [2000], 500), // -35.00
      entry("c", 5000, [], 5500), // +5.00
    ]),
    { final: true },
  );

  assert.equal(lineFor(s, "a").net, 3000);
  assert.equal(lineFor(s, "b").net, -3500);
  assert.equal(lineFor(s, "c").net, 500);
  // -(3000 + -3500 + 500) = 0
  assert.equal(lineFor(s, "bank").net, 0);
  assert.equal(lineFor(s, "bank").derived, true);
  assert.equal(lineFor(s, "a").derived, false);
});

test("the derived banker net makes the whole table sum to exactly zero", () => {
  const s = settleCash(
    table("player", "bank", [
      entry("bank", 50000, [], 41250),
      entry("a", 2500, [2500], 12000),
      entry("b", 4000, [], 0),
      entry("c", 1000, [1000, 1000], 250),
    ]),
    { final: true },
  );
  const sum = s.lines.reduce((a, l) => a + (l.net ?? 0), 0);
  assert.equal(sum, 0);
  // And the banker is the one carrying it, derived rather than typed.
  const others = s.lines.filter((l) => l.playerId !== "bank").reduce((a, l) => a + (l.net ?? 0), 0);
  assert.equal(lineFor(s, "bank").net, -others);
});

test("the banker's typed cash-out never reaches the ledger, the derived net does", () => {
  // The banker miscounts their own rack by $10. The players' numbers are the
  // truth, so the derived net is unmoved and the delta is what gets reported.
  const s = settleCash(
    table("player", "bank", [
      entry("bank", 10000, [], 8000), // typed net -20.00
      entry("a", 2000, [], 3000), // +10.00
    ]),
    { final: true },
  );
  assert.equal(lineFor(s, "bank").net, -1000); // derived: -(+1000)
  assert.equal(s.balance.checked, true);
  assert.equal(s.balance.balanced, false);
  assert.equal(s.balance.delta, -1000); // typed -2000 vs derived -1000
});

test("a live table derives the banker from whoever has already cashed out", () => {
  // Two players out, one still holding chips. The banker's realised position
  // is the inverse of the settled players only; the player still in has no
  // net at all yet.
  const s = settleCash(
    table("player", "bank", [
      entry("bank", 20000, [], null),
      entry("a", 2000, [], 4000), // +20.00, done
      entry("b", 2000, [], 1000), // -10.00, done
      entry("c", 2000, [], null), // still playing
    ]),
  );
  assert.equal(lineFor(s, "c").net, null);
  assert.equal(lineFor(s, "bank").net, -1000);
  assert.equal(s.stillIn, 2); // c and the banker
  assert.equal(s.onTable, 26000 - 5000);
});

// ---------- the balance check ----------

test("a correct table passes the balance check", () => {
  const s = settleCash(
    table("player", "bank", [
      entry("bank", 30000, [], 27000), // banker down 30.00
      entry("a", 2000, [], 5000), // +30.00
      entry("b", 2000, [], 2000), // even
    ]),
    { final: true },
  );
  assert.equal(s.balance.checked, true);
  assert.equal(s.balance.balanced, true);
  assert.equal(s.balance.delta, 0);
  assert.equal(balanceWarning(s.balance), null);
});

test("a wrong table reports the exact delta, signed the way the host needs it", () => {
  // Somebody's cash-out is $17.25 too high: more came off the table than went
  // onto it.
  const s = settleCash(
    table("player", "bank", [
      entry("bank", 30000, [], 27000), // banker counted -30.00
      entry("a", 2000, [], 5000), // +30.00
      entry("b", 2000, [], 3725), // +17.25 that nobody paid for
    ]),
    { final: true },
  );
  assert.equal(s.balance.checked, true);
  assert.equal(s.balance.balanced, false);
  assert.equal(s.balance.delta, 1725);
  const warn = balanceWarning(s.balance);
  assert.ok(warn?.includes("$17.25"), warn ?? "no warning");
  assert.ok(warn?.includes("too high"), warn ?? "no warning");

  // And the other direction reads the other way round.
  const under = settleCash(
    table("player", "bank", [
      entry("bank", 30000, [], 27000),
      entry("a", 2000, [], 5000),
      entry("b", 2000, [], 275), // $17.25 short
    ]),
    { final: true },
  );
  assert.equal(under.balance.delta, -1725);
  assert.ok(balanceWarning(under.balance)?.includes("too low"));
});

test("the check is skipped, not failed, until the banker counts their own rack", () => {
  // Without this rule every table where the players finished up would report
  // as broken, because an absent count would be read as a count of zero.
  const s = settleCash(
    table("player", "bank", [
      entry("bank", 30000, [], null),
      entry("a", 2000, [], 5000),
    ]),
  );
  assert.equal(s.balance.checked, false);
  assert.equal(s.balance.delta, 0);
  assert.equal(balanceWarning(s.balance), null);
  // The banker's net is still derived and still correct.
  assert.equal(lineFor(s, "bank").net, -3000);
});

// ---------- casino-banked tables ----------

test("a casino-banked session has no derived player and no balance check", () => {
  const s = settleCash(
    table("casino", null, [
      entry("a", 10000, [5000], 30000), // +150.00
      entry("b", 10000, [], 0), // -100.00
    ]),
    { final: true },
  );
  assert.equal(s.balance.checked, false);
  assert.equal(s.balance.balanced, true);
  assert.equal(s.balance.delta, 0);
  assert.equal(balanceWarning(s.balance), null);
  // Nobody's net is derived, and the table does NOT sum to zero, correctly:
  // the missing money went to a building.
  assert.deepEqual(s.lines.map((l) => l.derived), [false, false]);
  assert.equal(s.lines.reduce((a, l) => a + (l.net ?? 0), 0), 5000);
});

test("bankerId is ignored on a casino table even if one is left set", () => {
  // A host who starts player-banked, changes their mind, and leaves a stale
  // bankerId behind must not get a derived line anyway.
  const s = settleCash(
    { ...table("casino", "a", [entry("a", 10000, [], 12000), entry("b", 10000, [], 8000)]) },
    { final: true },
  );
  assert.deepEqual(s.lines.map((l) => l.derived), [false, false]);
  assert.equal(lineFor(s, "a").net, 2000);
  assert.equal(s.balance.checked, false);
});

// ---------- integer cents ----------

test("many small odd amounts sum exactly (this is the float canary)", () => {
  // In dollars-as-floats: 3.33 + 3.33 + 3.34 === 10.000000000000002, so this
  // table would report a balance delta and a host would go looking for a
  // cash-out that is not wrong. In cents it is exact.
  const s = settleCash(
    table("player", "bank", [
      entry("bank", 1000, [], 0), // put up $10, handed all of it out
      entry("a", 0, [], 333),
      entry("b", 0, [], 333),
      entry("c", 0, [], 334),
    ]),
    { final: true },
  );
  assert.equal(s.balance.checked, true);
  assert.equal(s.balance.delta, 0);
  assert.equal(s.balance.balanced, true);
  assert.equal(lineFor(s, "bank").net, -1000);

  // The same shape one level up: seven odd thirds of a dollar landing on a
  // round total, plus a longer run of penny amounts.
  const odd = [333, 333, 334, 1, 2, 3, 7, 11, 13, 17, 19, 23, 29, 31, 37];
  const sum = odd.reduce((a, b) => a + b, 0);
  assert.equal(Number.isSafeInteger(sum), true);
  assert.equal(sum, 1193);
  const s2 = settleCash(
    table("player", "bank", [
      entry("bank", sum, [], 0),
      ...odd.map((c, i) => entry(`p${i}`, 0, [], c)),
    ]),
    { final: true },
  );
  assert.equal(s2.balance.delta, 0);
  assert.equal(lineFor(s2, "bank").net, -sum);
});

test("parseCents is exact for the amounts a float would round", () => {
  assert.equal(parseCents("3.33"), 333);
  assert.equal(parseCents("0.07"), 7);
  assert.equal(parseCents("0.1"), 10);
  assert.equal(parseCents("10"), 1000);
  assert.equal(parseCents("$1,234.56"), 123456);
  assert.equal(parseCents(" 20 "), 2000);
  assert.equal(parseCents("-12.5"), -1250);
  assert.equal(parseCents(".5"), 50);
  // Every one of these is an integer, which is the property that matters.
  for (const t of ["3.33", "0.07", "8.15", "29.99", "1.11"]) {
    const c = parseCents(t);
    assert.ok(c !== null && Number.isSafeInteger(c), t);
  }
});

test("parseCents rejects what is not an amount rather than guessing", () => {
  assert.equal(parseCents(""), null);
  assert.equal(parseCents("abc"), null);
  assert.equal(parseCents("1.2.3"), null);
  // A third decimal is a typo far more often than an intent, so it is
  // refused rather than silently truncated to two.
  assert.equal(parseCents("10.005"), null);
  assert.equal(parseCents("."), null);
});

test("formatting happens at the edge and reads the way money reads", () => {
  assert.equal(formatCents(0), "$0.00");
  assert.equal(formatCents(333), "$3.33");
  assert.equal(formatCents(123456), "$1,234.56");
  assert.equal(formatCents(-1550), "-$15.50");
  assert.equal(formatCentsSigned(1500), "+$15.00");
  assert.equal(formatCentsSigned(-1500), "-$15.00");
  assert.equal(formatCentsSigned(0), "$0.00");
  // Round-trip: every amount the parser accepts formats back to itself.
  for (const t of ["0.07", "3.33", "20.00", "1234.56"]) {
    assert.equal(formatCents(parseCents(t)!), `$${Number(t).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  }
});

// ---------- ledger lines ----------

test("ledger lines carry the money in meta and the placement from net rank", () => {
  const s = settleCash(
    table("player", "bank", [
      entry("bank", 20000, [], 17000),
      entry("a", 2000, [2000], 8000), // +40.00
      entry("b", 2000, [], 1000), // -10.00
    ]),
    { final: true },
  );
  // The options-object signature arrived with the stakes flag; `stakes` is
  // written to every row so the lifetime read can split the money.
  const lines = cashLedgerLines(s, { bank: "player", bankerId: "bank", stakes: "real" });
  const a = lines.find((l) => l.playerId === "a")!;
  assert.equal(a.placement, 1);
  assert.equal(a.isWinner, true);
  assert.deepEqual(a.meta, {
    bank: "player",
    stakes: "real",
    buyIn: 2000,
    rebuys: 1,
    rebuyTotal: 2000,
    totalIn: 4000,
    cashOut: 8000,
    net: 4000,
  });

  const banker = lines.find((l) => l.playerId === "bank")!;
  assert.equal(banker.meta.banker, true);
  assert.equal(banker.meta.derivedNet, true);
  assert.equal(banker.meta.net, -3000);

  // Pack-specific detail rides alongside, and nulls are left out entirely
  // rather than written as zeros a lifetime average would then believe.
  const withDetail = cashLedgerLines(s, {
    bank: "player",
    bankerId: "bank",
    stakes: "real",
    extraMeta: (id) => (id === "a" ? { biggestBet: 5000, biggestWin: null } : {}),
  });
  const a2 = withDetail.find((l) => l.playerId === "a")!;
  assert.equal(a2.meta.biggestBet, 5000);
  assert.equal("biggestWin" in a2.meta, false);
});

test("a player who never cashed out is recorded as busting, but only once final", () => {
  const core = table("casino", null, [entry("a", 2000, [], null), entry("b", 2000, [], 4000)]);
  assert.equal(lineFor(settleCash(core), "a").net, null);
  const final = settleCash(core, { final: true });
  assert.equal(lineFor(final, "a").net, -2000);
  assert.equal(lineFor(final, "a").cashOut, 0);
  assert.equal(lineFor(final, "a").placement, 2);
});

// ---------- modifiers on the ledger ----------
//
// The deck itself is tested in modifiers.test.ts. What is asserted here is the
// RECORDING: which row the ids land on, and that a night without any is
// byte-for-byte what it was before modifiers existed.

test("the active house rules land on EVERY participant, not once on the session", () => {
  const s = settleCash(
    table("casino", null, [entry("a", 2000, [], 5000), entry("b", 2000, [], 0)]),
    { final: true },
  );
  const lines = cashLedgerLines(s, {
    bank: "casino",
    bankerId: null,
    stakes: "real",
    modifiers: ["silence", "no_splitting"],
  });
  // Per participant is the grain the stat needs: win rate per modifier is per
  // PLAYER, so the ids have to sit beside that player's own net. There is also
  // nowhere else for them to go without a schema change: matches has `label`
  // (one display string, already Mario Party's) and no generic meta column.
  assert.equal(lines.length, 2);
  for (const l of lines) {
    assert.deepEqual(l.meta.modifiers, ["silence", "no_splitting"]);
  }
});

test("a night with no house rules writes no modifiers key at all", () => {
  // Absent, not []. Every row recorded before modifiers existed is absent, so
  // making a plain night write an empty array would create two encodings of
  // the same fact for the read layer to disagree about.
  const s = settleCash(table("casino", null, [entry("a", 2000, [], 5000)]), { final: true });
  const none = cashLedgerLines(s, { bank: "casino", bankerId: null, stakes: "real" });
  assert.equal("modifiers" in none[0]!.meta, false);
  const empty = cashLedgerLines(s, {
    bank: "casino",
    bankerId: null,
    stakes: "real",
    modifiers: [],
  });
  assert.equal("modifiers" in empty[0]!.meta, false);
});

test("the ids the host picked survive from setup to the money board", () => {
  const state = newBlackjackState({
    bank: "casino",
    bankerId: null,
    roster: [player("a")],
    defaultBuyIn: 2000,
    modifiers: ["silence"],
  });
  assert.deepEqual(state.modifiers, ["silence"]);
  // Carried onto the summary rather than threaded through every screen, the
  // same way stakes is: the TV and the table both read it off one object.
  assert.deepEqual(summarizeBlackjack(state).modifiers, ["silence"]);
  // And a session opened without any has an empty list, never undefined, so no
  // screen has to guard before mapping over it.
  const plain = newBlackjackState({
    bank: "casino",
    bankerId: null,
    roster: [player("a")],
    defaultBuyIn: 2000,
  });
  assert.deepEqual(plain.modifiers, []);
  assert.deepEqual(summarizeBlackjack(plain).modifiers, []);
});

// ---------- reading them back: win rate and net per house rule ----------

const night = (
  net: number,
  modifiers: string[],
  opts?: { stakes?: "real" | "play"; at?: number },
): CashNight => ({
  at: opts?.at ?? 0,
  net,
  totalIn: 2000,
  rebuys: 0,
  minutes: null,
  banker: false,
  stakes: opts?.stakes ?? "real",
  modifiers,
});

test("win rate and net are counted per player per house rule", () => {
  const rows = aggregateByModifier([
    {
      userId: "u_a",
      name: "Ada",
      nights: [
        night(4000, ["silence"]),
        night(-1000, ["silence", "loser_buys"]),
        night(2000, []), // a plain night belongs to no card
      ],
    },
    { userId: "u_b", name: "Bo", nights: [night(-500, ["silence"])] },
  ]);

  const silence = rows.find((r) => r.id === "silence")!;
  // PLAYER-nights: three people-nights across two people.
  assert.equal(silence.nights, 3);
  assert.equal(silence.up, 1);
  assert.equal(silence.winRate, 1 / 3);
  // Busiest player first.
  assert.deepEqual(silence.players.map((p) => p.name), ["Ada", "Bo"]);
  assert.equal(silence.players[0]!.money.real.net, 3000);
  assert.equal(silence.players[0]!.upNights, 1);
  assert.equal(silence.players[0]!.sessions, 2);
  assert.equal(silence.players[1]!.money.real.net, -500);

  // The second card on that one night is its own row, with only that night in
  // it: a card is not credited with nights it was not on.
  const loser = rows.find((r) => r.id === "loser_buys")!;
  assert.equal(loser.nights, 1);
  assert.equal(loser.players[0]!.money.real.net, -1000);

  // Busiest card first, so the rows with something to say lead.
  assert.deepEqual(rows.map((r) => r.id), ["silence", "loser_buys"]);
});

test("a card nobody has played with is absent rather than an empty row", () => {
  const rows = aggregateByModifier([
    { userId: "u_a", name: "Ada", nights: [night(100, ["silence"]), night(100, [])] },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["silence"]);
  assert.deepEqual(aggregateByModifier([{ userId: "u_a", name: "Ada", nights: [] }]), []);
});

test("a retired id still aggregates, because its history is real", () => {
  // The deck is display data; the ledger is not. A card dropped from
  // MODIFIERS still has rows, and the panel renders them by id.
  const rows = aggregateByModifier([
    { userId: "u_a", name: "Ada", nights: [night(1000, ["a_card_we_dropped"])] },
  ]);
  assert.equal(rows[0]!.id, "a_card_we_dropped");
  assert.equal(rows[0]!.nights, 1);
});

test("per-modifier money splits by stakes like everything else does", () => {
  // Adding a real net to a play net produces a number that means nothing, and
  // that rule does not stop applying because the slice is narrower.
  const rows = aggregateByModifier([
    {
      userId: "u_a",
      name: "Ada",
      nights: [
        night(4000, ["silence"], { stakes: "real" }),
        night(-9000, ["silence"], { stakes: "play" }),
      ],
    },
  ]);
  const p = rows[0]!.players[0]!;
  assert.equal(p.money.real.net, 4000);
  assert.equal(p.money.real.sessions, 1);
  assert.equal(p.money.play.net, -9000);
  assert.equal(p.money.play.sessions, 1);
  // The counts stay UNIFIED: a win is a win whatever the chips were worth.
  assert.equal(p.sessions, 2);
  assert.equal(p.upNights, 1);
});

test("a night recorded before modifiers existed counts towards no card", () => {
  const legacy: CashNight = {
    at: 0,
    net: 5000,
    totalIn: 2000,
    rebuys: 0,
    minutes: null,
    banker: false,
  };
  assert.deepEqual(aggregateByModifier([{ userId: "u_a", name: "Ada", nights: [legacy] }]), []);
});

// ---------- blackjack on top of the engine ----------

test("blackjack pays 3:2 and floors the odd cent", () => {
  assert.equal(handPayout({ bet: 1000, result: "win" }), 1000);
  assert.equal(handPayout({ bet: 1000, result: "lose" }), 0);
  assert.equal(handPayout({ bet: 1000, result: "push" }), 0);
  assert.equal(handPayout({ bet: 1000, result: "blackjack" }), 1500);
  // $2.50 on a blackjack pays $3.75 exactly.
  assert.equal(handPayout({ bet: 250, result: "blackjack" }), 375);
  // An odd-cent bet floors rather than inventing a fraction of a cent.
  assert.equal(handPayout({ bet: 333, result: "blackjack" }), 499);
  assert.equal(Number.isSafeInteger(handPayout({ bet: 333, result: "blackjack" })), true);
});

test("the tracker derives biggest bet, biggest win and blackjacks", () => {
  const at = "2026-07-29T02:00:00.000Z";
  const hands: BjHand[] = [
    { playerId: "a", bet: 1000, result: "win", at },
    { playerId: "a", bet: 2500, result: "lose", at },
    { playerId: "a", bet: 2000, result: "blackjack", at },
    { playerId: "b", bet: 500, result: "blackjack", at },
    { playerId: "a", bet: 1500, result: "push", at },
  ];
  const a = detailFromHands(hands, "a");
  assert.equal(a.biggestBet, 2500); // the biggest BET, even though it lost
  assert.equal(a.biggestWin, 3000); // 2000 at 3:2
  assert.equal(a.blackjacks, 1);

  const b = detailFromHands(hands, "b");
  assert.deepEqual(b, { biggestBet: 500, biggestWin: 750, blackjacks: 1 });

  // A player the tracker never saw has no detail at all, rather than zeros.
  assert.deepEqual(detailFromHands(hands, "c"), {
    biggestBet: null,
    biggestWin: null,
    blackjacks: null,
  });
});

test("a typed detail beats the tracker per FIELD, not per player", () => {
  const state = newBlackjackState({
    bank: "casino",
    bankerId: null,
    roster: [player("a")],
    defaultBuyIn: 2000,
  });
  state.hands = [
    { playerId: "a", bet: 1000, result: "blackjack", at: "2026-07-29T02:00:00.000Z" },
    { playerId: "a", bet: 4000, result: "lose", at: "2026-07-29T02:00:00.000Z" },
  ];
  // The host corrects the biggest bet on the cash-out form and leaves the
  // rest alone: the blackjack count the tracker kept must survive.
  state.detail.a = { biggestBet: 6000, biggestWin: null, blackjacks: null };
  const row = summarizeBlackjack(state).players[0]!;
  assert.equal(row.detail.biggestBet, 6000);
  assert.equal(row.detail.biggestWin, 1500);
  assert.equal(row.detail.blackjacks, 1);
  // `events`, not `hands`: the summary is generic now so roulette counts
  // spins and craps counts rolls through the same field.
  assert.equal(row.events, 2);
});

test("the tracker being off loses nothing the cash-out form can capture", () => {
  const state = newBlackjackState({
    bank: "casino",
    bankerId: null,
    roster: [player("a")],
    defaultBuyIn: 2000,
  });
  assert.equal(state.tracker, false); // OFF by default, every pack, every time
  assert.deepEqual(state.hands, []);
  state.detail.a = { biggestBet: 5000, biggestWin: 7500, blackjacks: 3 };
  const row = summarizeBlackjack(state).players[0]!;
  assert.deepEqual(row.detail, { biggestBet: 5000, biggestWin: 7500, blackjacks: 3 });
  assert.equal(row.events, 0);
});

test("a blackjack session summarizes into a money board the TV can sort", () => {
  const roster = [player("bank", "Dealer"), player("a", "Ada"), player("b", "Bo"), player("c", "Cy")];
  const state = newBlackjackState({
    bank: "player",
    bankerId: "bank",
    roster,
    defaultBuyIn: 2000,
  });
  state.entries = [
    entry("bank", 20000, [], null),
    entry("a", 2000, [2000], 9000), // +50.00
    entry("b", 2000, [], 500), // -15.00
    entry("c", 2000, [], null), // still playing
  ];

  const sum = summarizeBlackjack(state);
  assert.equal(sum.bank, "player");
  assert.equal(sum.stillIn, 2);
  assert.equal(sum.cashedOut, 2);
  assert.equal(sum.totalIn, 28000);
  assert.equal(sum.totalOut, 9500);
  assert.equal(sum.onTable, 18500);
  // Up first, down after, still-at-the-table last.
  assert.deepEqual(sum.players.map((p) => p.name), ["Ada", "Bo", "Dealer", "Cy"]);
  assert.equal(sum.players[0]!.net, 5000);
  assert.equal(sum.players[2]!.net, -3500); // the banker, derived
  assert.equal(sum.players[2]!.derived, true);
  assert.equal(sum.players[2]!.isBanker, true);
  assert.equal(sum.players[3]!.net, null);
  assert.equal(sum.warning, null); // the banker has not counted their rack
});

test("the money board warns the moment the banker's count disagrees", () => {
  const roster = [player("bank"), player("a")];
  const state = newBlackjackState({ bank: "player", bankerId: "bank", roster, defaultBuyIn: 2000 });
  state.entries = [entry("bank", 10000, [], 9000), entry("a", 2000, [], 4000)];
  const sum = summarizeBlackjack(state);
  assert.equal(sum.balance.checked, true);
  assert.equal(sum.balance.balanced, false);
  assert.equal(sum.balance.delta, 1000);
  assert.ok(sum.warning?.includes("$10.00"));
});

test("a new session starts every player on the default buy-in, in cents", () => {
  const state = newBlackjackState({
    bank: "player",
    bankerId: "bank",
    roster: [player("bank"), player("a"), player("b")],
    defaultBuyIn: 2500,
    buyIns: { b: 10000 },
  });
  assert.equal(state.entries.find((e) => e.playerId === "a")!.buyIn, 2500);
  assert.equal(state.entries.find((e) => e.playerId === "b")!.buyIn, 10000);
  for (const e of state.entries) {
    assert.equal(Number.isSafeInteger(e.buyIn), true);
    assert.deepEqual(e.rebuys, []);
    assert.equal(e.cashOut, null);
  }
  assert.equal(state.bankerId, "bank");
  assert.equal(state.openScoring, false);
});

test("choosing a casino bank clears the banker rather than remembering one", () => {
  const state = newBlackjackState({
    bank: "casino",
    bankerId: "bank",
    roster: [player("bank"), player("a")],
    defaultBuyIn: 2000,
  });
  assert.equal(state.bankerId, null);
  assert.equal(summarizeBlackjack(state).balance.checked, false);
});

// ---------- the no-banker poker table ----------
//
// The third CashBank. Nobody is the house, everybody types their own cash-out,
// nobody is derived, and the table must sum to exactly zero once the room has
// finished counting. See the union's own comment in cashgame.ts for why neither
// of the other two fits.

const pokerTable = (entries: CashEntry[], kinds: Record<string, "member" | "guest"> = {}): CashSessionCore => ({
  bank: "table",
  bankerId: null,
  roster: entries.map((e) => ({
    id: e.playerId,
    kind: kinds[e.playerId] ?? "member",
    userId: (kinds[e.playerId] ?? "member") === "member" ? `u_${e.playerId}` : null,
    name: e.playerId,
  })),
  entries,
});

test("a poker table derives nobody, however the nets fall", () => {
  const s = settleCash(
    pokerTable([
      entry("ana", 5000, [], 12000),
      entry("bo", 5000, [5000], 3000),
      entry("cass", 5000, [], 0),
    ]),
  );
  for (const l of s.lines) assert.equal(l.derived, false, `${l.playerId} must not be derived`);
  assert.equal(lineFor(s, "ana").net, 7000);
  assert.equal(lineFor(s, "bo").net, -7000);
  assert.equal(lineFor(s, "cass").net, -5000);
});

test("the check waits for the WHOLE room, not for one banker", () => {
  // Two of three counted. A banked table would already be checking against the
  // banker; a poker table has nothing to check against until the last stack is
  // counted, and saying "you are $50 short" while chips are still on the felt
  // would train everybody to ignore the warning that matters.
  const partial = settleCash(
    pokerTable([entry("ana", 5000, [], 12000), entry("bo", 5000, [], 3000), entry("cass", 5000, [], null)]),
  );
  assert.deepEqual(partial.balance, { checked: false, balanced: true, delta: 0 });
  assert.equal(balanceWarning(partial.balance, "real", "table"), null);

  const full = settleCash(
    pokerTable([entry("ana", 5000, [], 12000), entry("bo", 5000, [], 3000), entry("cass", 5000, [], 0)]),
  );
  assert.equal(full.balance.checked, true);
  assert.equal(full.balance.balanced, true);
  assert.equal(full.balance.delta, 0);
});

test("a poker table that does not add up says so, and by exactly how much", () => {
  // 150 on the table, 190 counted off it: forty dollars that does not exist.
  const s = settleCash(
    pokerTable([entry("ana", 5000, [], 12000), entry("bo", 5000, [], 4000), entry("cass", 5000, [], 3000)]),
  );
  assert.deepEqual(s.balance, { checked: true, balanced: false, delta: 4000 });
  assert.equal(
    balanceWarning(s.balance, "real", "table"),
    "The table does not balance, off by $40.00. More money came off the table than went onto it, so somebody's count is too high.",
  );
});

test("the poker wording is its own, and the banked wording is untouched", () => {
  const short: CashBalance = { checked: true, balanced: false, delta: -2500 };
  assert.match(balanceWarning(short, "real", "table")!, /chips are still unaccounted for/);
  assert.match(balanceWarning(short, "real", "player")!, /a cash-out is too low or one is missing/);
  // No bank argument at all is the banked sentence, which is what keeps every
  // call site written before poker existed reading exactly as it did.
  assert.equal(balanceWarning(short, "real"), balanceWarning(short, "real", "player"));
});

test("an empty table is not a balanced table", () => {
  // "The sum of no nets is zero" is true and useless. A table nobody has opened
  // must not report itself as reconciled.
  assert.deepEqual(settleCash(pokerTable([])).balance, { checked: false, balanced: true, delta: 0 });
});

test("a poker night records with no banker keys in any meta bag", () => {
  const lines = cashLedgerLines(
    settleCash(pokerTable([entry("ana", 5000, [], 9000), entry("bo", 5000, [], 1000)]), { final: true }),
    { bank: "table", bankerId: null, stakes: "real" },
  );
  for (const l of lines) {
    assert.equal("banker" in l.meta, false);
    assert.equal("derivedNet" in l.meta, false);
    assert.equal(l.meta.bank, "table");
  }
  assert.equal(lines.find((l) => l.playerId === "ana")!.meta.net, 4000);
});

// ---------- who pays whom ----------

const transfersOf = (entries: CashEntry[], kinds?: Record<string, "member" | "guest">) =>
  settleTransfers(settleCash(pokerTable(entries, kinds)));

test("an unbalanced table returns NO transfer list rather than an approximate one", () => {
  // The whole point: a list derived from a wrong number is the app inventing a
  // debt between two friends, which is worse than showing nothing.
  const t = transfersOf([entry("ana", 5000, [], 12000), entry("bo", 5000, [], 4000), entry("cass", 5000, [], 3000)]);
  assert.equal(t, null);
});

test("an unfinished table returns no list either, because it has not been checked", () => {
  const t = transfersOf([entry("ana", 5000, [], 12000), entry("bo", 5000, [], 3000), entry("cass", 5000, [], null)]);
  assert.equal(t, null);
});

test("two players is one payment, in the direction the money actually moves", () => {
  const t = transfersOf([entry("ana", 5000, [], 8000), entry("bo", 5000, [], 2000)]);
  assert.deepEqual(t, [{ fromId: "bo", toId: "ana", cents: 3000 }]);
});

test("a squared table with nobody up or down owes nothing at all", () => {
  // Everybody broke even. An empty list, not a list of zeroes: a row saying
  // "bo pays ana $0.00" is noise on a screen whose job is to be acted on.
  const t = transfersOf([entry("ana", 5000, [], 5000), entry("bo", 5000, [], 5000)]);
  assert.deepEqual(t, []);
});

test("a four-hander settles in three payments, largest debt to largest credit", () => {
  // in: 50 each, 200 total. out: ana 120, dev 80, bo 0, cass 0.
  // nets: ana +70, dev +30, bo -50, cass -50.
  const t = transfersOf([
    entry("ana", 5000, [], 12000),
    entry("bo", 5000, [], 0),
    entry("cass", 5000, [], 0),
    entry("dev", 5000, [], 8000),
  ]);
  assert.ok(t);
  assert.ok(t!.length <= 3, `at most n-1 payments, got ${t!.length}`);
  assert.deepEqual(t, [
    { fromId: "bo", toId: "ana", cents: 5000 },
    { fromId: "cass", toId: "ana", cents: 2000 },
    { fromId: "cass", toId: "dev", cents: 3000 },
  ]);
});

test("TIED NETS RESOLVE THE SAME WAY ON EVERY DEVICE", () => {
  // bo and cass are both down exactly $50 and ana and dev are both up exactly
  // $50. Greedy has a free choice at every step, and two phones choosing
  // differently would show two different sets of debts for one table over live
  // sync. The playerId tie-break is what removes the choice.
  const entries = [
    entry("dev", 5000, [], 10000),
    entry("cass", 5000, [], 0),
    entry("bo", 5000, [], 0),
    entry("ana", 5000, [], 10000),
  ];
  const first = transfersOf(entries);
  // The same table with the roster typed in a different order is the same table.
  const shuffled = transfersOf([entries[2]!, entries[0]!, entries[3]!, entries[1]!]);
  assert.deepEqual(first, shuffled);
  // Both creditors and both debtors are level, so the id tie-break decides all
  // four slots: ana before dev, bo before cass, on both sides of the ledger.
  assert.deepEqual(first, [
    { fromId: "bo", toId: "ana", cents: 5000 },
    { fromId: "cass", toId: "dev", cents: 5000 },
  ]);
});

test("A GUEST IS IN THE TRANSFER LIST, because money does not care about the ledger", () => {
  // The ledger skips guests, since a guest carries no lifetime stats. Skipping
  // one HERE would leave the table unsquared and quietly stiff whoever they owe.
  const t = transfersOf(
    [entry("ana", 5000, [], 10000), entry("visitor", 5000, [], 0)],
    { visitor: "guest" },
  );
  assert.deepEqual(t, [{ fromId: "visitor", toId: "ana", cents: 5000 }]);
});

test("every payment is positive and the list sums to what the winners are owed", () => {
  const entries = [
    entry("ana", 10000, [5000], 30000),
    entry("bo", 10000, [], 12500),
    entry("cass", 10000, [], 0),
    entry("dev", 10000, [], 12500),
    entry("eve", 10000, [], 0),
  ];
  const t = transfersOf(entries)!;
  assert.ok(t);
  for (const x of t) assert.ok(x.cents > 0, "a zero or negative payment is a bug, not a row");
  const owed = settleCash(pokerTable(entries)).lines.filter((l) => (l.net ?? 0) > 0).reduce((a, l) => a + l.net!, 0);
  assert.equal(t.reduce((a, x) => a + x.cents, 0), owed);
  assert.ok(t.length <= entries.length - 1, "at most n-1 payments");
});

test("a banked table can produce a transfer list too, once it balances", () => {
  // Nothing in settleTransfers looks at the bank type: it reads signed nets and
  // the balance flag, both of which a player-banked table also produces. That is
  // deliberate rather than incidental, so a banked blackjack night can show the
  // same "who pays whom" without a second implementation.
  const banked: CashSessionCore = {
    bank: "player",
    bankerId: "ana",
    roster: ["ana", "bo", "cass"].map((id) => ({ id, kind: "member" as const, userId: `u_${id}`, name: id })),
    entries: [entry("ana", 10000, [], 8000), entry("bo", 5000, [], 8000), entry("cass", 5000, [], 4000)],
  };
  const s = settleCash(banked);
  assert.equal(s.balance.balanced, true);
  assert.deepEqual(settleTransfers(s), [{ fromId: "ana", toId: "bo", cents: 2000 }, { fromId: "cass", toId: "bo", cents: 1000 }]);
});

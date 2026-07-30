// Tests for the one pack runtime (src/pack-runtime.ts) and the four pack
// configs built on it.
//
// WRITTEN BEFORE THE REFACTOR, and the expected strings below were transcribed
// out of the four pack files by hand and confirmed green against the ORIGINAL
// code before pack-runtime.ts existed. That ordering is the whole point: a test
// written afterwards only canonises whatever the change happened to do, which
// for a ledger key would mean canonising an orphaning bug.
//
// What is covered here is exactly what this refactor could break SILENTLY:
//
//   - ledgerKey. A changed key does not error. The insert succeeds, the
//     dedup SELECT stops matching, and the leaderboard quietly stops agreeing
//     with history. So the assertions are on exact strings, both the modern
//     {prefix}:{eventId}:{sessionKey}:{idx} shape and the legacy no-sessionKey
//     shape, and including idx 0, which is where an off-by-one hides.
//   - The four configs. wsType kills live sync if typo'd (the client never
//     matches the message and screens stop updating), gameName is the join key
//     for the crew leaderboard tabs so a rename splits a pack's history across
//     two tabs, and `table` is the Smash/shared split that must not be
//     "simplified" into a data migration.
//   - The pure decision logic inside materialize*: which roster slot maps to
//     which userId, what placement each line gets, guest versus member, and a
//     guest carrying a linkMap entry.
//
// No database and no Drizzle stub. Stubbing Drizzle would test the stub;
// anything genuinely needing Postgres is verified on-device instead. getDb() is
// a lazy singleton, so importing the pack modules here never opens a connection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { participantRows, type RosterSlot, type LedgerLine } from "../src/pack-runtime.js";
import { smashRuntime } from "../src/smash.js";
import { marioKartRuntime } from "../src/mariokart.js";
import { marioPartyRuntime } from "../src/marioparty.js";
import { pingPongRuntime } from "../src/pingpong.js";
import { blackjackRuntime } from "../src/blackjack.js";
import { rouletteRuntime } from "../src/roulette.js";
import { crapsRuntime } from "../src/craps.js";

// ---------- the four configs ----------

// Copied by hand out of the pack files BEFORE they were touched. Changing any
// value here without changing production is the point of the test; changing
// both to match a typo is the failure this cannot catch, which is why each
// field's blast radius is spelled out above.
const PACKS = [
  {
    runtime: smashRuntime,
    pack: "smash",
    keyPrefix: "smash",
    gameName: "Smash Bros",
    wsType: "smash_updated",
    table: "smash_sessions",
  },
  {
    runtime: marioKartRuntime,
    pack: "mario_kart",
    keyPrefix: "mk",
    gameName: "Mario Kart",
    wsType: "mario_kart_updated",
    table: "game_sessions",
  },
  {
    runtime: marioPartyRuntime,
    pack: "mario_party",
    keyPrefix: "mp",
    gameName: "Mario Party",
    wsType: "mario_party_updated",
    table: "game_sessions",
  },
  {
    runtime: pingPongRuntime,
    pack: "pingpong",
    keyPrefix: "pp",
    gameName: "Ping Pong",
    wsType: "ping_pong_updated",
    table: "game_sessions",
  },
  {
    runtime: blackjackRuntime,
    pack: "blackjack",
    keyPrefix: "blackjack",
    gameName: "Blackjack",
    wsType: "blackjack_updated",
    table: "game_sessions",
  },
  {
    runtime: rouletteRuntime,
    pack: "roulette",
    keyPrefix: "roulette",
    gameName: "Roulette",
    wsType: "roulette_updated",
    table: "game_sessions",
  },
  {
    runtime: crapsRuntime,
    pack: "craps",
    keyPrefix: "craps",
    gameName: "Craps",
    wsType: "craps",
    table: "game_sessions",
  },
] as const;

for (const p of PACKS) {
  test(`${p.pack}: config is unchanged`, () => {
    assert.equal(p.runtime.pack, p.pack);
    assert.equal(p.runtime.keyPrefix, p.keyPrefix);
    assert.equal(p.runtime.gameName, p.gameName);
    assert.equal(p.runtime.wsType, p.wsType);
    assert.equal(p.runtime.table, p.table);
  });
}

test("Smash keeps its own table and every other pack shares game_sessions", () => {
  // Not a restatement of the loop above: this is the constraint itself, so it
  // fails loudly if a later pass "simplifies" Smash onto the shared table.
  assert.equal(smashRuntime.table, "smash_sessions");
  for (const p of [marioKartRuntime, marioPartyRuntime, pingPongRuntime, blackjackRuntime, rouletteRuntime, crapsRuntime]) {
    assert.equal(p.table, "game_sessions");
  }
});

test("every pack has a distinct ledger namespace and ws type", () => {
  // Two packs sharing a keyPrefix would collide in the ledger on the same
  // event; two sharing a wsType would refetch each other's screens.
  assert.equal(new Set(PACKS.map((p) => p.runtime.keyPrefix)).size, PACKS.length);
  assert.equal(new Set(PACKS.map((p) => p.runtime.wsType)).size, PACKS.length);
  assert.equal(new Set(PACKS.map((p) => p.runtime.gameName)).size, PACKS.length);
});

// ---------- ledger keys ----------

const EVENT = "11111111-2222-3333-4444-555555555555";
const SK = "s7x9q2";

for (const p of PACKS) {
  test(`${p.pack}: modern ledger key`, () => {
    assert.equal(p.runtime.ledgerKey(EVENT, SK, 3), `${p.keyPrefix}:${EVENT}:${SK}:3`);
  });

  test(`${p.pack}: legacy ledger key (session predates sessionKey)`, () => {
    assert.equal(p.runtime.ledgerKey(EVENT, undefined, 3), `${p.keyPrefix}:${EVENT}:3`);
  });

  test(`${p.pack}: idx 0 keeps its 0 in both shapes`, () => {
    // idx 0 is falsy, so this is where an off-by-one or a truthiness check
    // hides. A dropped 0 would collide every session's first unit.
    assert.equal(p.runtime.ledgerKey(EVENT, SK, 0), `${p.keyPrefix}:${EVENT}:${SK}:0`);
    assert.equal(p.runtime.ledgerKey(EVENT, undefined, 0), `${p.keyPrefix}:${EVENT}:0`);
  });

  test(`${p.pack}: an empty sessionKey falls back to the legacy shape`, () => {
    // Legacy rows read back as undefined, but an empty string is the same
    // "no namespace" case and must not produce a double colon.
    assert.equal(p.runtime.ledgerKey(EVENT, "", 0), `${p.keyPrefix}:${EVENT}:0`);
  });

  test(`${p.pack}: two sessions on one event never collide`, () => {
    // The bug this shape exists to prevent: idx restarts at 0 every session,
    // so without the namespace a replayed event silently stopped recording.
    assert.notEqual(p.runtime.ledgerKey(EVENT, "aaa", 0), p.runtime.ledgerKey(EVENT, "bbb", 0));
  });
}

// ---------- the pure half of materialize ----------

const member = (id: string, userId: string, name = id): RosterSlot => ({
  id,
  kind: "member",
  userId,
  name,
});
const guest = (id: string, name: string): RosterSlot => ({ id, kind: "guest", userId: null, name });

const line = (playerId: string, placement: number, isWinner: boolean): LedgerLine => ({
  playerId,
  placement,
  isWinner,
});

const ARGS = { groupId: "g1", matchId: "m1" };

test("all members: one row each, placement and winner preserved", () => {
  const roster = [member("p0", "u-alice"), member("p1", "u-bob"), member("p2", "u-cara")];
  const { rows, guests } = participantRows({
    ...ARGS,
    roster,
    lines: [line("p1", 1, true), line("p0", 2, false), line("p2", 3, false)],
  });

  assert.equal(guests, 0);
  assert.equal(rows.length, 3);
  // Row order follows the LINES, not the roster: the winner was listed first.
  assert.deepEqual(
    rows.map((r) => [r.userId, r.placement, r.isWinner]),
    [
      ["u-bob", 1, true],
      ["u-alice", 2, false],
      ["u-cara", 3, false],
    ],
  );
  for (const r of rows) assert.equal(r.groupId, "g1");
  for (const r of rows) assert.equal(r.matchId, "m1");
});

test("all guests: nothing is written and every one is counted", () => {
  // Guests carry no lifetime stats, but silently dropping them was a real bug.
  // The count is what the route reports back to the host.
  const roster = [guest("p0", "Dave"), guest("p1", "Erin")];
  const { rows, guests } = participantRows({
    ...ARGS,
    roster,
    lines: [line("p0", 1, true), line("p1", 2, false)],
  });

  assert.equal(rows.length, 0);
  assert.equal(guests, 2);
});

test("a mix: members are written, guests are counted, placements are untouched", () => {
  const roster = [member("p0", "u-alice"), guest("p1", "Dave"), member("p2", "u-cara")];
  const { rows, guests } = participantRows({
    ...ARGS,
    roster,
    lines: [line("p1", 1, true), line("p0", 2, false), line("p2", 3, false)],
  });

  assert.equal(guests, 1);
  // The guest WON, and the members keep placements 2 and 3 rather than being
  // renumbered. The night's real finishing order is what reaches the ledger.
  assert.deepEqual(
    rows.map((r) => [r.userId, r.placement]),
    [
      ["u-alice", 2],
      ["u-cara", 3],
    ],
  );
});

test("a linked guest resolves to the member, which is the whole backfill", () => {
  const roster = [guest("p0", "Dave"), member("p1", "u-bob")];
  const linkMap = new Map([["Dave", "u-dave"]]);
  const { rows, guests } = participantRows({
    ...ARGS,
    roster,
    lines: [line("p0", 1, true), line("p1", 2, false)],
    linkMap,
  });

  assert.equal(guests, 0);
  assert.deepEqual(
    rows.map((r) => [r.userId, r.placement, r.isWinner]),
    [
      ["u-dave", 1, true],
      ["u-bob", 2, false],
    ],
  );
});

test("a link map that does not name this guest leaves them a guest", () => {
  const roster = [guest("p0", "Dave"), member("p1", "u-bob")];
  const { rows, guests } = participantRows({
    ...ARGS,
    roster,
    lines: [line("p0", 1, true), line("p1", 2, false)],
    linkMap: new Map([["Someone Else", "u-x"]]),
  });

  assert.equal(guests, 1);
  assert.deepEqual(rows.map((r) => r.userId), ["u-bob"]);
});

test("a link map never overrides a real member's own userId", () => {
  // Name collision between a member and a linked guest name. The member slot
  // carries a userId, so the link map must not touch it.
  const roster = [member("p0", "u-alice", "Dave"), guest("p1", "Dave")];
  const { rows, guests } = participantRows({
    ...ARGS,
    roster,
    lines: [line("p0", 1, true), line("p1", 2, false)],
    linkMap: new Map([["Dave", "u-dave"]]),
  });

  assert.equal(guests, 0);
  assert.deepEqual(
    rows.map((r) => [r.userId, r.placement]),
    [
      ["u-alice", 1],
      ["u-dave", 2],
    ],
  );
});

test("two slots resolving to the same userId produce ONE row, first occurrence winning", () => {
  // Reachable in real life: two guest slots typed with the same name both link
  // to one member. A single INSERT carrying (matchId, userId) twice is not
  // something the conflict target can be relied on to sort out, so the dedupe
  // happens here. The old sequential loop had the same effect by accident, and
  // miscounted: it reported 2 recorded when the second insert wrote nothing.
  const roster = [guest("p0", "Dave"), guest("p1", "Dave"), member("p2", "u-bob")];
  const { rows, guests } = participantRows({
    ...ARGS,
    roster,
    lines: [line("p0", 1, true), line("p1", 3, false), line("p2", 2, false)],
    linkMap: new Map([["Dave", "u-dave"]]),
  });

  assert.equal(guests, 0);
  assert.equal(rows.length, 2);
  // First occurrence wins: placement 1 (the win), not the later placement 3.
  assert.deepEqual(
    rows.map((r) => [r.userId, r.placement, r.isWinner]),
    [
      ["u-dave", 1, true],
      ["u-bob", 2, false],
    ],
  );
});

test("a line naming a slot that is not in the roster is counted as a guest", () => {
  // Defensive: a malformed session should never write a row it cannot attribute.
  const { rows, guests } = participantRows({
    ...ARGS,
    roster: [member("p0", "u-alice")],
    lines: [line("p0", 1, true), line("ghost", 2, false)],
  });

  assert.equal(guests, 1);
  assert.deepEqual(rows.map((r) => r.userId), ["u-alice"]);
});

test("character, score and meta ride through only when the pack supplies them", () => {
  // Smash and Mario Kart set character; Mario Party sets score (stars) and meta
  // (bonus stars); Ping Pong sets score (points) and meta (game wins) and no
  // character at all. A pack that omits one must not have it written as null by
  // this function's own doing.
  const roster = [member("p0", "u-alice"), member("p1", "u-bob")];
  const { rows } = participantRows({
    ...ARGS,
    roster,
    lines: [
      { playerId: "p0", placement: 1, isWinner: true, character: "Kirby", score: 42, meta: { bonusStars: ["Coin Star"] } },
      { playerId: "p1", placement: 2, isWinner: false },
    ],
  });

  assert.equal(rows[0]!.character, "Kirby");
  assert.equal(rows[0]!.score, 42);
  assert.deepEqual(rows[0]!.meta, { bonusStars: ["Coin Star"] });
  assert.equal("character" in rows[1]!, false);
  assert.equal("score" in rows[1]!, false);
  assert.equal("meta" in rows[1]!, false);
});

test("an explicit null character is written as null, not skipped", () => {
  // A pack that HAS characters but where nobody picked one must still write
  // null, which is what `character: line.character ?? null` means at the call
  // sites. Distinct from the pack that never sets the field at all.
  const { rows } = participantRows({
    ...ARGS,
    roster: [member("p0", "u-alice")],
    lines: [{ playerId: "p0", placement: 1, isWinner: true, character: null }],
  });

  assert.equal("character" in rows[0]!, true);
  assert.equal(rows[0]!.character, null);
});

test("no lines writes nothing rather than an empty insert", () => {
  const { rows, guests } = participantRows({ ...ARGS, roster: [member("p0", "u-alice")], lines: [] });
  assert.equal(rows.length, 0);
  assert.equal(guests, 0);
});

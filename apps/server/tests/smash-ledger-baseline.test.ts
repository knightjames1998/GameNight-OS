// THE ROWS A SOLO SMASH NIGHT WRITES, captured before the team-battles work.
//
// The engine fixtures next door pin what the SESSION does. This file pins what
// reaches `match_participants`, which is the half that cannot be undone: a
// session shape can be renormalized on read, and a ledger row that went in
// wrong is history.
//
// The one thing it exists to hold still is `side`. Smash writes no side today,
// and after the team work a SOLO night must still put NULL in that column,
// because a non-null side on a row means "this match had team structure"
// everywhere else in the app: buildRivalry reads it to decide whether two
// people played together or against each other, and a solo Smash night that
// started claiming team structure would make every rivalry it touches wrong,
// forever, with nothing erroring. See teams.ts sideIdFor.
//
// The assertion is on the COLUMN VALUE (`row.side ?? null`) rather than on the
// presence of the key, deliberately. `participantRows` omits `side` entirely
// when a line does not carry one and writes null when a line carries null, and
// those two produce the same NULL in Postgres. Pinning the key would fail on a
// change that is genuinely nothing, which is how a fixture gets deleted.
//
// THE SECOND THING IT PINS IS THE KEY SHAPE AND THE FORMAT STRING. A team
// battle writes the same `format` as a solo one and the same ledger key
// namespace; a new format string would split this pack's history across two
// leaderboard buckets and nothing would error. So both are asserted here,
// per format, before anything moves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { participantRows, type LedgerLine, type RosterSlot } from "../src/pack-runtime.js";
import {
  SERIES_LABEL,
  SESSION_PACKS,
  isSeriesSummary,
  newSmashState,
  type SmashFormat,
  type SmashMode,
} from "@gamenight/shared";

const ROSTER: RosterSlot[] = [
  { id: "p0", kind: "member", userId: "u0", name: "Ann" },
  { id: "p1", kind: "member", userId: "u1", name: "Ben" },
  { id: "p2", kind: "member", userId: "u2", name: "Cal" },
  { id: "p3", kind: "guest", userId: null, name: "Dee" },
];

const CHARS: Record<string, string> = { p0: "Mario", p1: "Fox", p2: "Kirby", p3: "Link" };

/**
 * The mapping apps/server/src/smash.ts materializeGame does today: a recorded
 * game's lines straight through, with the fighter on `character` and nothing
 * else. Written out here because the server's version is inline in an async
 * database function and cannot be called without one.
 */
const gameLines = (lines: readonly { playerId: string; placement: number; isWinner: boolean }[]): LedgerLine[] =>
  lines.map((l) => ({
    playerId: l.playerId,
    placement: l.placement,
    isWinner: l.isWinner,
    character: CHARS[l.playerId] ?? null,
  }));

const placementOrder = (order: readonly string[]) =>
  order.map((playerId, i) => ({ playerId, placement: i + 1, isWinner: i === 0 }));

const winnerOnly = (winnerId: string) =>
  ROSTER.map((p) => ({ playerId: p.id, placement: p.id === winnerId ? 1 : 2, isWinner: p.id === winnerId }));

const rowsFor = (lines: LedgerLine[]) =>
  participantRows({ groupId: "g1", matchId: "m1", roster: ROSTER, lines });

// ---------- FFA ----------

test("BASELINE LEDGER: an FFA game writes one row per member, placement in order", () => {
  const { rows, guests } = rowsFor(gameLines(placementOrder(["p0", "p1", "p2", "p3"])));

  assert.equal(guests, 1, "Dee is a guest and is skipped, and COUNTED rather than dropped");
  assert.deepEqual(
    rows.map((r) => ({
      userId: r.userId,
      placement: r.placement,
      isWinner: r.isWinner,
      character: r.character,
      side: r.side ?? null,
    })),
    [
      { userId: "u0", placement: 1, isWinner: true, character: "Mario", side: null },
      { userId: "u1", placement: 2, isWinner: false, character: "Fox", side: null },
      { userId: "u2", placement: 3, isWinner: false, character: "Kirby", side: null },
    ],
  );
});

test("BASELINE LEDGER: FFA winner-only detail is one 1 and the rest on 2", () => {
  const { rows } = rowsFor(gameLines(winnerOnly("p2")));
  assert.deepEqual(
    rows.map((r) => [r.userId, r.placement, r.isWinner, r.character, r.side ?? null]),
    [
      ["u0", 2, false, "Mario", null],
      ["u1", 2, false, "Fox", null],
      ["u2", 1, true, "Kirby", null],
    ],
  );
});

test("BASELINE LEDGER: NO SIDE REACHES THE COLUMN ON A SOLO NIGHT", () => {
  // Stated on its own so the failure message says what actually broke rather
  // than pointing at a diff of five fields. Every format, one assertion.
  const ffa = rowsFor(gameLines(placementOrder(["p2", "p0", "p1"])));
  const koth = rowsFor(gameLines([
    { playerId: "p1", placement: 1, isWinner: true },
    { playerId: "p0", placement: 2, isWinner: false },
  ]));
  const bestof = rowsFor([
    { playerId: "p0", placement: 1, isWinner: true, character: "Mario", meta: { gameWins: 3, gamesPlayed: 5 } },
    { playerId: "p1", placement: 2, isWinner: false, character: "Fox", meta: { gameWins: 2, gamesPlayed: 5 } },
  ]);
  const smashdown = rowsFor(gameLines(winnerOnly("p0")));
  for (const [label, { rows }] of Object.entries({ ffa, koth, bestof, smashdown })) {
    // The row count is asserted too, so an empty result cannot pass this
    // vacuously, which is the shape of every test in this repo that turned out
    // to be unable to fail.
    assert.ok(rows.length > 0, `${label} produced no rows at all`);
    assert.deepEqual(rows.map((r) => r.side ?? null), rows.map(() => null), label);
  }
});

// ---------- King of the Hill ----------

test("BASELINE LEDGER: a KOTH round writes exactly the two who played", () => {
  const { rows, guests } = rowsFor(gameLines([
    { playerId: "p1", placement: 1, isWinner: true },
    { playerId: "p0", placement: 2, isWinner: false },
  ]));
  assert.equal(guests, 0);
  assert.deepEqual(
    rows.map((r) => [r.userId, r.placement, r.isWinner, r.character, r.side ?? null]),
    [
      ["u1", 1, true, "Fox", null],
      ["u0", 2, false, "Mario", null],
    ],
  );
});

// ---------- Best Of ----------

test("BASELINE LEDGER: a best-of set writes winner 1, loser 2, with game counts", () => {
  // materializeSeries's shape: two rows, meta carrying the per-player game
  // tally, the fighter on character, and again no side.
  const { rows, guests } = rowsFor([
    { playerId: "p0", placement: 1, isWinner: true, character: "Mario", meta: { gameWins: 3, gamesPlayed: 5 } },
    { playerId: "p1", placement: 2, isWinner: false, character: "Fox", meta: { gameWins: 2, gamesPlayed: 5 } },
  ]);
  assert.equal(guests, 0);
  assert.deepEqual(
    rows.map((r) => ({ userId: r.userId, placement: r.placement, isWinner: r.isWinner, meta: r.meta, side: r.side ?? null })),
    [
      { userId: "u0", placement: 1, isWinner: true, meta: { gameWins: 3, gamesPlayed: 5 }, side: null },
      { userId: "u1", placement: 2, isWinner: false, meta: { gameWins: 2, gamesPlayed: 5 }, side: null },
    ],
  );
});

// ---------- Smashdown ----------

test("BASELINE LEDGER: a Smashdown battle is an FFA row with the fighter on it", () => {
  const { rows } = rowsFor(gameLines(winnerOnly("p1")));
  assert.deepEqual(
    rows.map((r) => [r.userId, r.placement, r.isWinner, r.character, r.side ?? null]),
    [
      ["u0", 2, false, "Mario", null],
      ["u1", 1, true, "Fox", null],
      ["u2", 2, false, "Kirby", null],
    ],
  );
});

test("BASELINE LEDGER: the Smashdown SERIES row carries no fighter and no side", () => {
  // syncSeriesRow's shape: competition-ranked standings, battle counts in meta,
  // character null because a series is not played with one fighter.
  const { rows } = rowsFor([
    { playerId: "p0", placement: 1, isWinner: true, character: null, meta: { battleWins: 2, battles: 3 } },
    { playerId: "p1", placement: 2, isWinner: false, character: null, meta: { battleWins: 1, battles: 3 } },
    { playerId: "p2", placement: 3, isWinner: false, character: null, meta: { battleWins: 0, battles: 3 } },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.userId, r.placement, r.isWinner, r.character, r.side ?? null]),
    [
      ["u0", 1, true, null, null],
      ["u1", 2, false, null, null],
      ["u2", 3, false, null, null],
    ],
  );
});

// ---------- the key shape and the format string ----------

/**
 * ledgerKey, copied from pack-runtime's own closure so this fixture can assert
 * the STRING rather than the function. A team battle must land in the same key
 * space and the same format bucket as a solo one; a new format string would
 * split this pack's history in two and nothing would error.
 */
const ledgerKey = (eventId: string, sessionKey: string | undefined, unit: number | string): string =>
  sessionKey
    ? `${SESSION_PACKS.smash.keyPrefix}:${eventId}:${sessionKey}:${unit}`
    : `${SESSION_PACKS.smash.keyPrefix}:${eventId}:${unit}`;

test("BASELINE LEDGER: the key shape is smash:{eventId}:{sessionKey}:{unit}", () => {
  assert.equal(ledgerKey("e1", "sk1", 0), "smash:e1:sk1:0");
  assert.equal(ledgerKey("e1", "sk1", 7), "smash:e1:sk1:7");
  // The Smashdown series row's literal tail, so its key can never collide with
  // a battle's however the counts move.
  assert.equal(ledgerKey("e1", "sk1", "series"), "smash:e1:sk1:series");
  // A session started before sessionKey existed keeps the old shape.
  assert.equal(ledgerKey("e1", undefined, 0), "smash:e1:0");
});

test("BASELINE LEDGER: the format string per row, and the series label", () => {
  // materializeGame passes `state.format` straight through as the row's
  // `format`, so what a session CARRIES is what reaches the column. Read off
  // the engine rather than restated, because these are leaderboard bucket keys
  // and a team battle has to land in the same bucket as a solo one.
  const formatOf = (format: SmashFormat, mode: SmashMode) =>
    newSmashState({
      format,
      mode,
      assignment: "self",
      resultDetail: "winner",
      roster: [
        { id: "p0", kind: "member", userId: "u0", name: "Ann", character: null },
        { id: "p1", kind: "member", userId: "u1", name: "Ben", character: null },
      ],
    }).format;

  assert.deepEqual(
    {
      ffa: formatOf("ffa", "ffa"),
      koth: formatOf("koth", "koth"),
      bestof: formatOf("bestof", "ffa"),
      smashdown: formatOf("smashdown", "ffa"),
    },
    { ffa: "ffa", koth: "koth", bestof: "bestof", smashdown: "smashdown" },
  );
  // The Best Of label is bo{N} off the session's own bestOf; the Smashdown
  // SUMMARY label is its own constant, and everything that counts games skips
  // it.
  const bo = newSmashState({
    format: "bestof",
    mode: "ffa",
    assignment: "self",
    resultDetail: "winner",
    roster: [
      { id: "p0", kind: "member", userId: "u0", name: "Ann", character: null },
      { id: "p1", kind: "member", userId: "u1", name: "Ben", character: null },
    ],
    bestOf: 5,
  });
  assert.equal(`bo${bo.bestOf}`, "bo5");
  assert.equal(SERIES_LABEL, "smashdown");
  assert.equal(isSeriesSummary(SERIES_LABEL), true);
  assert.equal(isSeriesSummary("bo5"), false);
});

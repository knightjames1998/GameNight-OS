// THE ROWS A SOLO MARIO KART NIGHT WRITES, captured before the pairs work.
//
// The engine fixtures next door pin what the SESSION does. This file pins what
// reaches `match_participants`, which is the half that cannot be undone: a
// session shape can be renormalized on read, and a ledger row that went in
// wrong is history.
//
// The one thing it exists to hold still is `side`. Mario Kart writes no side
// today, and after the pairs work a SOLO night must still put NULL in that
// column, because a non-null side on a row means "this match had team
// structure" everywhere else in the app: buildRivalry reads it to decide
// whether two people played together or against each other, and a solo race
// night that started claiming team structure would make every rivalry it
// touches wrong, forever, with nothing erroring. See teams.ts sideIdFor.
//
// The assertion is on the COLUMN VALUE (`row.side ?? null`) rather than on the
// presence of the key, deliberately. `participantRows` omits `side` entirely
// when a line does not carry one and writes null when a line carries null, and
// those two produce the same NULL in Postgres. Pinning the key would fail on a
// change that is genuinely nothing, which is how a fixture gets deleted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { participantRows, type LedgerLine, type RosterSlot } from "../src/pack-runtime.js";

const ROSTER: RosterSlot[] = [
  { id: "p0", kind: "member", userId: "u0", name: "Ann" },
  { id: "p1", kind: "member", userId: "u1", name: "Ben" },
  { id: "p2", kind: "member", userId: "u2", name: "Cal" },
  { id: "p3", kind: "guest", userId: null, name: "Dee" },
];

/**
 * The mapping apps/server/src/mariokart.ts materializeGame does today: a
 * recorded race's lines straight through, with the racer on `character` and
 * nothing else. Written out here because the server's version is inline in an
 * async database function and cannot be called without one.
 */
const raceLines = (order: readonly string[], charOf: Record<string, string | null>): LedgerLine[] =>
  order.map((playerId, i) => ({
    playerId,
    placement: i + 1,
    isWinner: i === 0,
    character: charOf[playerId] ?? null,
  }));

const CHARS = { p0: "Mario", p1: "Yoshi", p2: "Peach", p3: "Toad" };

test("BASELINE LEDGER: a solo race writes one row per member, placement in order", () => {
  const { rows, guests } = participantRows({
    groupId: "g1",
    matchId: "m1",
    roster: ROSTER,
    lines: raceLines(["p0", "p1", "p2", "p3"], CHARS),
  });

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
      { userId: "u1", placement: 2, isWinner: false, character: "Yoshi", side: null },
      { userId: "u2", placement: 3, isWinner: false, character: "Peach", side: null },
    ],
  );
});

test("BASELINE LEDGER: NO SIDE REACHES THE COLUMN ON A SOLO NIGHT", () => {
  // Stated on its own so the failure message says what actually broke rather
  // than pointing at a diff of five fields.
  const { rows } = participantRows({
    groupId: "g1",
    matchId: "m1",
    roster: ROSTER,
    lines: raceLines(["p2", "p0", "p1"], CHARS),
  });
  assert.deepEqual(
    rows.map((r) => r.side ?? null),
    [null, null, null],
  );
});

test("BASELINE LEDGER: a best-of set writes winner 1, loser 2, with game counts", () => {
  // materializeSeries's shape: two rows, meta carrying the per-player game
  // tally, and again no side.
  const lines: LedgerLine[] = [
    { playerId: "p0", placement: 1, isWinner: true, character: "Mario", meta: { gameWins: 2, gamesPlayed: 3 } },
    { playerId: "p1", placement: 2, isWinner: false, character: "Yoshi", meta: { gameWins: 1, gamesPlayed: 3 } },
  ];
  const { rows, guests } = participantRows({ groupId: "g1", matchId: "m1", roster: ROSTER, lines });
  assert.equal(guests, 0);
  assert.deepEqual(
    rows.map((r) => ({ userId: r.userId, placement: r.placement, isWinner: r.isWinner, meta: r.meta, side: r.side ?? null })),
    [
      { userId: "u0", placement: 1, isWinner: true, meta: { gameWins: 2, gamesPlayed: 3 }, side: null },
      { userId: "u1", placement: 2, isWinner: false, meta: { gameWins: 1, gamesPlayed: 3 }, side: null },
    ],
  );
});

test("BASELINE LEDGER: a KOTH race writes exactly the two who raced", () => {
  const lines: LedgerLine[] = [
    { playerId: "p1", placement: 1, isWinner: true, character: "Yoshi" },
    { playerId: "p0", placement: 2, isWinner: false, character: "Mario" },
  ];
  const { rows } = participantRows({ groupId: "g1", matchId: "m1", roster: ROSTER, lines });
  assert.deepEqual(
    rows.map((r) => [r.userId, r.placement, r.isWinner, r.side ?? null]),
    [
      ["u1", 1, true, null],
      ["u0", 2, false, null],
    ],
  );
});

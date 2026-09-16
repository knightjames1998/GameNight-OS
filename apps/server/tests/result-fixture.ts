// One ResultRow builder, shared by every test that feeds the stats aggregation.
//
// NOT a *.test.ts file on purpose: the runner globs ./tests/*.test.ts, so this
// is imported rather than collected.
//
// It lived inside series-rows.test.ts until stats-agg.test.ts needed the same
// shape. Copying it would have been the obvious move and is the wrong one: two
// builders drift, and a fixture that drifts makes two test files disagree about
// what a ledger row even looks like while both stay green. Same reasoning as
// every other "this existed twice" entry in this repo's history.

import { BEERIO_LEDGER, BEERIO_TOURNAMENT_LABEL, SERIES_LABEL } from "@gamenight/shared";
import type { ResultRow } from "../src/stats.js";

let seq = 0;

/**
 * One ledger result, defaulted to a clean win so a test only has to state what
 * it is actually about. `matchId` and `playedAt` advance on every call, so rows
 * built in sequence are distinct and ordered without any test saying so.
 */
export function result(over: Partial<ResultRow> = {}): ResultRow {
  seq++;
  return {
    matchId: `m${seq}`,
    placement: 1,
    isWinner: true,
    gameName: "Smash Bros",
    character: "Fox",
    playedAt: new Date(2026, 6, 28, 20, seq),
    eventId: "e1",
    label: null,
    ...over,
  };
}

/** The summary row one finished series writes: no character, label set. */
export const seriesResult = (over: Partial<ResultRow> = {}): ResultRow =>
  result({ label: SERIES_LABEL, character: null, ...over });

// ---------- the ledger fixture the Beerio program's baselines run on ----------
//
// Added 2026-09-15, for the session that taught `stats.ts` about a SECOND kind
// of summary row. Everything above builds ONE player's `ResultRow`s, which is
// all the series-row tests ever needed. The tournament work has to hold four
// different readers to the same rows at once (the aggregation, the crew
// leaderboard's format buckets, the meeting map and the recap) and each reads
// COLUMNS the others do not.
//
// So `LedgerRow` is the row as the crew-stats query actually selects it, and
// the three narrowing helpers below hand each reader its own view of the SAME
// fixture. One fixture, four readers, no chance of the four disagreeing about
// what night they are describing.

/**
 * One completed ledger row with every column any of the four readers needs.
 *
 * Superset of `ResultRow` rather than a parallel type: `asResult` narrows to
 * exactly `ResultRow`, so the compiler refuses the day `ResultRow` gains a
 * field this does not carry.
 */
export interface LedgerRow extends ResultRow {
  userId: string;
  displayName: string;
  /** matches.format. Null on brackets and on every legacy Beerio row. */
  format: string | null;
  /** games.pack, the LEDGER spelling a row carries when read back. */
  pack: string | null;
  /** matches.externalKey. `b|...` and `g|...` are Beerio's two night kinds. */
  externalKey: string | null;
  /** matches.position, which the recap orders by. */
  position: number | null;
  /** match_participants.side. Null everywhere in this fixture: no team rows. */
  side: string | null;
}

/** Deliberately explicit: no counter, so this fixture is order-independent. */
export function ledgerRow(o: Partial<LedgerRow> & { matchId: string; userId: string }): LedgerRow {
  return {
    displayName: o.userId === "u1" ? "Ari" : o.userId === "u2" ? "Bo" : "Cy",
    placement: null,
    isWinner: false,
    gameName: "Smash Bros",
    character: null,
    playedAt: null,
    eventId: "e1",
    label: null,
    format: null,
    pack: "smash",
    externalKey: null,
    position: null,
    side: null,
    ...o,
  };
}

/** The aggregation's view: exactly `ResultRow`, nothing more. */
export const asResult = (r: LedgerRow): ResultRow => ({
  matchId: r.matchId,
  placement: r.placement,
  isWinner: r.isWinner,
  gameName: r.gameName,
  character: r.character,
  playedAt: r.playedAt,
  eventId: r.eventId,
  label: r.label,
});

/** The recap's view. `RecapRow` is structurally what this returns. */
export const asRecap = (r: LedgerRow) => ({
  matchId: r.matchId,
  position: r.position,
  label: r.label,
  format: r.format,
  externalKey: r.externalKey,
  gameName: r.gameName,
  pack: r.pack,
  userId: r.userId,
  displayName: r.displayName,
  placement: r.placement,
  isWinner: r.isWinner,
});

/** The rivalry's view of one side of a meeting. */
export const asMeetingSide = (r: LedgerRow) => ({ p: r.placement, w: r.isWinner, side: r.side });

// ---------- the five-night fixture ledger ----------
//
// One crew's completed ledger across five nights, carrying every row shape the
// tournament work has to keep straight. Written out in full rather than built
// with the counter-based `result()` builder, for the reason
// partner-stats-baseline.test.ts gives: that builder advances a module-level
// counter, so its matchIds and timestamps depend on how many rows every OTHER
// file in the run happened to build first, and a byte-identical pin cannot
// rest on that. This fixture produces the same JSON whether it runs first,
// last, or alone.
//
// The five nights, and what each is here to prove:
//
//   e1  SMASH, three battles plus the series SUMMARY row. The summary shares
//       its battles' sessionKey and format by design, so it is the existing
//       trap and the shape the new one is modelled on.
//   e2  A GENERIC BRACKET. label "Tournament", format null. THE ROW MOST
//       LIKELY TO BE CAUGHT BY A CARELESS FIX: a bracket genuinely IS the
//       only row its games produce, so it must keep counting as a game even
//       though the word on it is "Tournament".
//   e3  A LEGACY BEERIO BRACKET NIGHT: label NULL, format NULL, externalKey
//       `b|...`, one row per racer placed 1..N. This is what the closeout SQL
//       relabels, and what must not disappear from any screen afterwards.
//   e4  A LEGACY BEERIO GRAND PRIX NIGHT: the same shape but `g|...`. NOT
//       relabeled, ever: with no heats underneath it the night IS the game
//       unit, so it has to stay indistinguishable from an ordinary row here.
//   e5  TWO OTHER PACKS on one night, Ping Pong and Mario Party, so the
//       per-game and per-format splits have something to split.
export const LEDGER: LedgerRow[] = [
  // e1. Smash: three battles, then the series summary. Ari wins the series 2-1.
  ledgerRow({ matchId: "m1", userId: "u1", placement: 1, isWinner: true, character: "Fox", format: "smashdown", externalKey: "smash:e1:sk1:1", position: 1, playedAt: new Date("2026-08-01T20:00:00.000Z") }),
  ledgerRow({ matchId: "m1", userId: "u2", placement: 2, character: "Kirby", format: "smashdown", externalKey: "smash:e1:sk1:1", position: 1, playedAt: new Date("2026-08-01T20:00:00.000Z") }),
  ledgerRow({ matchId: "m2", userId: "u1", placement: 2, character: "Fox", format: "smashdown", externalKey: "smash:e1:sk1:2", position: 2, playedAt: new Date("2026-08-01T20:30:00.000Z") }),
  ledgerRow({ matchId: "m2", userId: "u2", placement: 1, isWinner: true, character: "Kirby", format: "smashdown", externalKey: "smash:e1:sk1:2", position: 2, playedAt: new Date("2026-08-01T20:30:00.000Z") }),
  ledgerRow({ matchId: "m3", userId: "u1", placement: 1, isWinner: true, character: "Fox", format: "smashdown", externalKey: "smash:e1:sk1:3", position: 3, playedAt: new Date("2026-08-01T21:00:00.000Z") }),
  ledgerRow({ matchId: "m3", userId: "u2", placement: 2, character: "Kirby", format: "smashdown", externalKey: "smash:e1:sk1:3", position: 3, playedAt: new Date("2026-08-01T21:00:00.000Z") }),
  ledgerRow({ matchId: "m4", userId: "u1", placement: 1, isWinner: true, label: "smashdown", format: "smashdown", externalKey: "smash:e1:sk1:series", position: 4, playedAt: new Date("2026-08-01T21:30:00.000Z") }),
  ledgerRow({ matchId: "m4", userId: "u2", placement: 2, label: "smashdown", format: "smashdown", externalKey: "smash:e1:sk1:series", position: 4, playedAt: new Date("2026-08-01T21:30:00.000Z") }),

  // e2. a generic bracket. The word "Tournament" is on the label and it is
  // still an ordinary game row: nothing else in the ledger describes it.
  ledgerRow({ matchId: "m5", userId: "u1", eventId: "e2", gameName: "Mario Kart 8", pack: "generic", label: "Tournament", placement: 2, position: 1, playedAt: new Date("2026-08-08T20:00:00.000Z") }),
  ledgerRow({ matchId: "m5", userId: "u2", eventId: "e2", gameName: "Mario Kart 8", pack: "generic", label: "Tournament", placement: 1, isWinner: true, position: 1, playedAt: new Date("2026-08-08T20:00:00.000Z") }),

  // e3. a legacy Beerio BRACKET night. label NULL, format NULL, `b|...`.
  ledgerRow({ matchId: "m6", userId: "u1", eventId: "e3", gameName: "Beerio Kart", pack: "beerio_kart", externalKey: "b|s1|2026-08-15|3p|5h", placement: 1, isWinner: true, position: 0, playedAt: new Date("2026-08-15T20:00:00.000Z") }),
  ledgerRow({ matchId: "m6", userId: "u2", eventId: "e3", gameName: "Beerio Kart", pack: "beerio_kart", externalKey: "b|s1|2026-08-15|3p|5h", placement: 2, position: 0, playedAt: new Date("2026-08-15T20:00:00.000Z") }),
  ledgerRow({ matchId: "m6", userId: "u3", eventId: "e3", gameName: "Beerio Kart", pack: "beerio_kart", externalKey: "b|s1|2026-08-15|3p|5h", placement: 3, position: 0, playedAt: new Date("2026-08-15T20:00:00.000Z") }),

  // e4. a legacy Beerio GRAND PRIX night. Same shape, `g|...`, never relabeled.
  ledgerRow({ matchId: "m7", userId: "u1", eventId: "e4", gameName: "Beerio Kart", pack: "beerio_kart", externalKey: "g|s2|2026-08-22|3p|12h", placement: 2, position: 0, playedAt: new Date("2026-08-22T20:00:00.000Z") }),
  ledgerRow({ matchId: "m7", userId: "u2", eventId: "e4", gameName: "Beerio Kart", pack: "beerio_kart", externalKey: "g|s2|2026-08-22|3p|12h", placement: 1, isWinner: true, position: 0, playedAt: new Date("2026-08-22T20:00:00.000Z") }),
  ledgerRow({ matchId: "m7", userId: "u3", eventId: "e4", gameName: "Beerio Kart", pack: "beerio_kart", externalKey: "g|s2|2026-08-22|3p|12h", placement: 3, position: 0, playedAt: new Date("2026-08-22T20:00:00.000Z") }),

  // e5. two other packs on one night.
  ledgerRow({ matchId: "m8", userId: "u1", eventId: "e5", gameName: "Ping Pong", pack: "pingpong", format: "bestof", label: "bo3", externalKey: "pp:e5:sk2:1", placement: 1, isWinner: true, position: 1, playedAt: new Date("2026-08-29T20:00:00.000Z") }),
  ledgerRow({ matchId: "m8", userId: "u2", eventId: "e5", gameName: "Ping Pong", pack: "pingpong", format: "bestof", label: "bo3", externalKey: "pp:e5:sk2:1", placement: 2, position: 1, playedAt: new Date("2026-08-29T20:00:00.000Z") }),
  ledgerRow({ matchId: "m9", userId: "u1", eventId: "e5", gameName: "Mario Party", pack: "mario_party", format: "board", label: "Peach's Birthday Cake", externalKey: "mp:e5:sk3:1", placement: 2, position: 2, playedAt: new Date("2026-08-29T21:00:00.000Z") }),
  ledgerRow({ matchId: "m9", userId: "u2", eventId: "e5", gameName: "Mario Party", pack: "mario_party", format: "board", label: "Peach's Birthday Cake", externalKey: "mp:e5:sk3:1", placement: 1, isWinner: true, position: 2, playedAt: new Date("2026-08-29T21:00:00.000Z") }),
];

/**
 * THE SAME LEDGER AFTER THE ONE-OFF RELABEL, and nothing else about it changed.
 *
 * Exactly what `UPDATE matches SET label = 'beerio_tournament' WHERE pack =
 * 'beerio_kart' AND external_key LIKE 'b|%' AND label IS NULL` does, applied in
 * TypeScript: the BRACKET night's three rows take the label and every other row
 * in the fixture is untouched, including the Grand Prix night, which is what
 * the `b|%` in that WHERE clause is for.
 *
 * DERIVED FROM `LEDGER` RATHER THAN WRITTEN OUT AGAIN, on purpose. The whole
 * claim of the after-baselines is "these rows are the same rows"; two
 * hand-maintained lists could drift and the tests would still pass while
 * comparing two different nights.
 */
export const LEDGER_RELABELED: LedgerRow[] = LEDGER.map((r) =>
  r.pack === BEERIO_LEDGER && r.externalKey?.startsWith("b|") && r.label === null
    ? { ...r, label: BEERIO_TOURNAMENT_LABEL }
    : r,
);

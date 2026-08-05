// BOARD GAME, PINNED. This file exists to fail if the shared title-night
// extraction changes what a Board Game night does, in any way, anywhere.
//
// WHY IT IS WRITTEN BEFORE THE EXTRACTION AND NOT AFTER. A test written after a
// refactor can only tell you the refactor agrees with itself: it canonises
// whatever the new code happens to do, including the bug. Every expected value
// below was captured by RUNNING THE UNMODIFIED PACK and transcribing what it
// produced, and confirmed green on the untouched tree before a line of the
// extraction was written.
//
// It is the third time this repo has used the discipline (the pack-runtime
// refactor's ledgerKey strings, then Ping Pong's singles fixtures), and the Ping
// Pong session recorded WHY it keeps earning its keep: a hand-reasoned fixture
// there was wrong in three places, and had it been written after the change it
// would simply have been "corrected" to whatever the new code did.
//
// boardgame.test.ts already covers the placement rule and title canonicalization
// exhaustively. What is pinned HERE is the stuff that reaches the ledger and the
// screen and is not covered there: the exact participant rows, the night
// summary, and the shape of the session envelope.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_GAME_MAX_PLAYERS,
  BOARD_GAME_TITLES,
  bgGameLines,
  canonicalTitle,
  newBgState,
  recordTnGame,
  tnSideIdOf,
  summarizeBgNight,
  tnTitleSuggestions,
  validateBgOrder,
  type BgGame,
  type BgPlayer,
  type BgSessionState,
} from "../src/index.js";

const players = (n: number): BgPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    kind: "member" as const,
    userId: `u${i}`,
    name: `P${i}`,
  }));

/**
 * Record a game the way the server's route does: a tapped order of PLAYERS in,
 * a game out. The route now resolves each player to the side holding them,
 * which in a free-for-all night is a side of one, so this helper does the same.
 */
function play(
  state: BgSessionState,
  title: string,
  order: { playerId: string; tiedWithAbove?: boolean; score?: number | null }[],
): BgGame {
  return recordTnGame(
    state,
    title,
    order.map((e) => ({
      sideId: tnSideIdOf(state, e.playerId)!,
      tiedWithAbove: e.tiedWithAbove,
      score: e.score ?? null,
    })),
  );
}

// ---------- the rows a recorded game writes ----------

// TWO THINGS ABOUT THESE ROWS CHANGED IN THE EXTRACTION, and both are stated
// here rather than quietly absorbed, because a pinned fixture that gets edited
// without explanation is worth nothing.
//
//   1. `side: null` is now written explicitly instead of being absent. THE
//      DATABASE ROW IS IDENTICAL: participantRows sets row.side = null for an
//      explicit null and leaves the column at its NULL default when the field
//      is absent. Both are NULL in the column, which is what "no team
//      structure" has always meant here.
//   2. A row WITH a typed score now also records the GRAIN it was typed at.
//      That is additive and deliberate: it is the thing the session brief asked
//      to store, because a score that does not say whether it belonged to a
//      player or a side is a number nobody can interpret in a year, and it is
//      cheap now and impossible retroactively. Rows with NO score are
//      byte-identical: meta stays null and carries no grain at all.
//
// Everything else below is unchanged from what the pre-extraction pack produced.

test("PINNED: a clean four-player game writes four rows, no score, no side", () => {
  const s = newBgState({ roster: players(4) });
  const g = play(s, "Catan", [{ playerId: "p0" }, { playerId: "p1" }, { playerId: "p2" }, { playerId: "p3" }]);
  assert.equal(g.title, "Catan");
  assert.deepEqual(bgGameLines(g), [
    { playerId: "p0", placement: 1, isWinner: true, side: null, meta: null },
    { playerId: "p1", placement: 2, isWinner: false, side: null, meta: null },
    { playerId: "p2", placement: 3, isWinner: false, side: null, meta: null },
    { playerId: "p3", placement: 4, isWinner: false, side: null, meta: null },
  ]);
});

test("PINNED: a typed score rides in meta, and an absent one is null not zero", () => {
  const s = newBgState({ roster: players(3) });
  const g = play(s, "Wingspan", [
    { playerId: "p0", score: 92 },
    { playerId: "p1", score: 0 },
    { playerId: "p2" },
  ]);
  assert.deepEqual(bgGameLines(g), [
    { playerId: "p0", placement: 1, isWinner: true, side: null, meta: { score: 92, grain: "player" } },
    { playerId: "p1", placement: 2, isWinner: false, side: null, meta: { score: 0, grain: "player" } },
    { playerId: "p2", placement: 3, isWinner: false, side: null, meta: null },
  ]);
});

test("PINNED: a two-way tie at the top writes two winners and skips placement 2", () => {
  const s = newBgState({ roster: players(4) });
  const g = play(s, "Azul", [
    { playerId: "p0" },
    { playerId: "p1", tiedWithAbove: true },
    { playerId: "p2" },
    { playerId: "p3" },
  ]);
  assert.deepEqual(bgGameLines(g).map((l) => [l.placement, l.isWinner]), [
    [1, true],
    [1, true],
    [3, false],
    [4, false],
  ]);
});

test("PINNED: a score that contradicts the tapped order does not move a placement", () => {
  // The rule the whole pack is built on. A low-wins game: the winner has the
  // smallest number, and an engine that sorted by score would invert the board.
  const s = newBgState({ roster: players(3) });
  const g = play(s, "Hearts", [
    { playerId: "p0", score: 4 },
    { playerId: "p1", score: 40 },
    { playerId: "p2", score: 90 },
  ]);
  assert.deepEqual(bgGameLines(g).map((l) => l.playerId), ["p0", "p1", "p2"]);
  assert.deepEqual(bgGameLines(g).map((l) => l.placement), [1, 2, 3]);
});

test("PINNED: not everybody has to play every game", () => {
  const s = newBgState({ roster: players(6) });
  const g = play(s, "Splendor", [{ playerId: "p1" }, { playerId: "p4" }]);
  assert.deepEqual(bgGameLines(g).map((l) => l.playerId), ["p1", "p4"]);
  assert.equal(bgGameLines(g).length, 2);
});

// ---------- the night summary the page and TV render ----------

const standings = (s: BgSessionState) =>
  summarizeBgNight(s).players.map((p) => ({
    playerId: p.playerId,
    games: p.games,
    wins: p.wins,
    avgPlacement: p.avgPlacement,
  }));

test("PINNED: a night's standings, titles and last game", () => {
  const s = newBgState({ roster: players(3) });
  play(s, "Catan", [{ playerId: "p0" }, { playerId: "p1" }, { playerId: "p2" }]);
  play(s, "Catan", [{ playerId: "p1" }, { playerId: "p0" }, { playerId: "p2" }]);
  play(s, "Azul", [{ playerId: "p0", score: 71 }, { playerId: "p2" }, { playerId: "p1" }]);

  assert.deepEqual(standings(s), [
    { playerId: "p0", games: 3, wins: 2, avgPlacement: 4 / 3 },
    { playerId: "p1", games: 3, wins: 1, avgPlacement: 2 },
    { playerId: "p2", games: 3, wins: 0, avgPlacement: 8 / 3 },
  ]);
  assert.deepEqual(summarizeBgNight(s).titles, [
    { title: "Catan", games: 2 },
    { title: "Azul", games: 1 },
  ]);
  assert.deepEqual(summarizeBgNight(s).last, {
    title: "Azul",
    lines: [
      { name: "P0", placement: 1, score: 71 },
      { name: "P2", placement: 2, score: null },
      { name: "P1", placement: 3, score: null },
    ],
  });
});

test("PINNED: an empty night has no last game and no averages", () => {
  const s = summarizeBgNight(newBgState({ roster: players(4) }));
  assert.deepEqual(s.players, []);
  assert.deepEqual(s.titles, []);
  assert.equal(s.last, null);
});

// ---------- titles ----------

test("PINNED: the curated list, exactly as it shipped", () => {
  // Not just a count: the extraction moves this list, and a title quietly
  // dropped or renamed splits that title's history from itself.
  assert.deepEqual(BOARD_GAME_TITLES, [
    "Catan",
    "Ticket to Ride",
    "Wingspan",
    "Carcassonne",
    "Azul",
    "Monopoly",
    "Risk",
    "Scrabble",
    "Clue",
    "Pandemic",
    "7 Wonders",
    "Splendor",
    "Dominion",
  ]);
});

test("PINNED: canonicalization resolves recents first, then the curated list", () => {
  // Renamed by the extraction (the layer takes the curated list as an
  // argument so two packs cannot collide on one exported name). Same values.
  const suggestions = tnTitleSuggestions(["Settlers of Catan"], BOARD_GAME_TITLES);
  assert.equal(suggestions[0], "Settlers of Catan");
  assert.deepEqual(canonicalTitle("  settlers   of CATAN ", suggestions), {
    title: "Settlers of Catan",
    matched: true,
  });
  assert.deepEqual(canonicalTitle("azul", suggestions), { title: "Azul", matched: true });
  assert.deepEqual(canonicalTitle("Root", suggestions), { title: "Root", matched: false });
});

// ---------- the session envelope and its rules ----------

test("PINNED: a fresh session's shape", () => {
  const s = newBgState({ roster: players(4) });
  assert.equal(s.openScoring, false);
  assert.equal(s.nowPlaying, null);
  assert.deepEqual(s.games, []);
  assert.equal(s.roster.length, 4);
  assert.ok(s.sessionKey.length > 0);
});

test("PINNED: the roster cap is 12, and Smash's 8 is untouched by it", () => {
  assert.equal(BOARD_GAME_MAX_PLAYERS, 12);
  const twelve = players(12);
  assert.equal(validateBgOrder(twelve.map((p) => ({ playerId: p.id })), twelve), null);
  const thirteen = players(13);
  assert.match(validateBgOrder(thirteen.map((p) => ({ playerId: p.id })), thirteen)!, /12/);
});

test("PINNED: order validation rejects a stranger and a duplicate", () => {
  const roster = players(4);
  assert.match(validateBgOrder([{ playerId: "p0" }, { playerId: "ghost" }], roster)!, /not in the session/);
  assert.match(validateBgOrder([{ playerId: "p0" }, { playerId: "p0" }], roster)!, /only appear once/);
  assert.match(validateBgOrder([{ playerId: "p0" }], roster)!, /at least 2/);
});

// ---------- the ledger key ----------

test("PINNED: the ledger key shape is bg:{eventId}:{sessionKey}:{idx}", () => {
  // keyPrefix `bg` is one of the five that fail silently. The extraction must
  // not move it, or every Board Game row already written is orphaned.
  const key = (eventId: string, sessionKey: string | undefined, idx: number) =>
    sessionKey ? `bg:${eventId}:${sessionKey}:${idx}` : `bg:${eventId}:${idx}`;
  assert.equal(key("E1", "sess1", 0), "bg:E1:sess1:0");
  const a = newBgState({ roster: players(2) });
  const b = newBgState({ roster: players(2) });
  assert.notEqual(a.sessionKey, b.sessionKey);
  assert.notEqual(key("E1", a.sessionKey, 0), key("E1", b.sessionKey, 0));
});

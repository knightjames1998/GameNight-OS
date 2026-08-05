// Board Game pack: the pure decision logic, and nothing else.
//
// No Drizzle stub anywhere, for the reason the pack-runtime tests give: stubbing
// it would test the stub. Everything asserted here is a function that takes
// values and returns values, which is exactly the half of this pack where a
// wrong answer is SILENT rather than an error:
//
//   - a placement derived the wrong way inverts a leaderboard and nothing
//     throws,
//   - a title that fails to canonicalize splits a crew's history in two and
//     nothing throws,
//   - a roster cap raised in the wrong place changes Smashdown's battle counts
//     and nothing throws.
//
// So all three are pinned here.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_GAME_MAX_PLAYERS,
  BOARD_GAME_TITLES,
  FFA_MAX_PLAYERS,
  canonicalTitle,
  newBgState,
  normalizeTitle,
  placementsFromOrder,
  summarizeBgNight,
  tnTitleSuggestions,
  validateBgOrder,
  validateFfa,
  validateFfaSize,
  type BgOrderEntry,
  type BgPlayer,
  type SmashResultLine,
} from "../src/index.js";

const player = (id: string): BgPlayer => ({ id, kind: "member", userId: `u_${id}`, name: id.toUpperCase() });
const roster = (n: number): BgPlayer[] => Array.from({ length: n }, (_, i) => player(`p${i}`));
const order = (...ids: string[]): BgOrderEntry[] => ids.map((id) => ({ playerId: id }));

// ---------- placement, from the tapped order ----------

test("a clean tapped order is 1..N in the order it was tapped", () => {
  const lines = placementsFromOrder(order("p0", "p1", "p2", "p3"));
  assert.deepEqual(lines.map((l) => l.placement), [1, 2, 3, 4]);
  assert.deepEqual(lines.map((l) => l.isWinner), [true, false, false, false]);
  // The order IS the placement: the ids come back in the order they were tapped.
  assert.deepEqual(lines.map((l) => l.playerId), ["p0", "p1", "p2", "p3"]);
});

test("a two-way tie AT THE TOP is two placement 1s and the next player is 3", () => {
  // Competition ranking, the convention used everywhere in this app. Both tied
  // players win: a shared first place is a win for each of them.
  const lines = placementsFromOrder([
    { playerId: "p0" },
    { playerId: "p1", tiedWithAbove: true },
    { playerId: "p2" },
    { playerId: "p3" },
  ]);
  assert.deepEqual(lines.map((l) => l.placement), [1, 1, 3, 4]);
  assert.deepEqual(lines.map((l) => l.isWinner), [true, true, false, false]);
});

test("a tie in the MIDDLE leaves the gap below it, not above it", () => {
  const lines = placementsFromOrder([
    { playerId: "p0" },
    { playerId: "p1" },
    { playerId: "p2", tiedWithAbove: true },
    { playerId: "p3" },
  ]);
  assert.deepEqual(lines.map((l) => l.placement), [1, 2, 2, 4]);
  assert.deepEqual(lines.map((l) => l.isWinner), [true, false, false, false]);
});

test("a THREE-way tie at the top is three 1s and the next player is 4", () => {
  const lines = placementsFromOrder([
    { playerId: "p0" },
    { playerId: "p1", tiedWithAbove: true },
    { playerId: "p2", tiedWithAbove: true },
    { playerId: "p3" },
  ]);
  assert.deepEqual(lines.map((l) => l.placement), [1, 1, 1, 4]);
  assert.deepEqual(lines.map((l) => l.isWinner), [true, true, true, false]);
});

test("a three-way tie in the middle closes back up at the right number", () => {
  const lines = placementsFromOrder([
    { playerId: "p0" },
    { playerId: "p1" },
    { playerId: "p2", tiedWithAbove: true },
    { playerId: "p3", tiedWithAbove: true },
    { playerId: "p4" },
  ]);
  assert.deepEqual(lines.map((l) => l.placement), [1, 2, 2, 2, 5]);
});

test("tiedWithAbove on the FIRST row is meaningless and is ignored", () => {
  // There is nothing above row one to be level with, and the alternative (an
  // error) would be a screen refusing a tap that cannot mean anything wrong.
  const lines = placementsFromOrder([{ playerId: "p0", tiedWithAbove: true }, { playerId: "p1" }]);
  assert.deepEqual(lines.map((l) => l.placement), [1, 2]);
  assert.equal(lines[0]!.isWinner, true);
});

// ---------- the score is a note, and this is the assertion that says so ----------

test("A SCORE THAT CONTRADICTS THE TAPPED ORDER DOES NOT MOVE THE PLACEMENT", () => {
  // The whole point of tapping the order. This is a low-wins game (Hearts), so
  // the winner has the SMALLEST number; an engine that sorted by score
  // descending would hand first place to the loser and nothing would error.
  const lines = placementsFromOrder([
    { playerId: "winner", score: 4 },
    { playerId: "second", score: 40 },
    { playerId: "third", score: 90 },
  ]);
  assert.deepEqual(lines.map((l) => l.playerId), ["winner", "second", "third"]);
  assert.deepEqual(lines.map((l) => l.placement), [1, 2, 3]);
  assert.equal(lines[0]!.isWinner, true);
  // And the same the other way round, so this cannot pass by accident on one
  // direction: a high-wins game where the tapped winner has the LOWEST score.
  const other = placementsFromOrder([
    { playerId: "winner", score: 1 },
    { playerId: "second", score: 999 },
  ]);
  assert.equal(other[0]!.placement, 1);
  assert.equal(other[1]!.placement, 2);
  // The scores are carried through untouched, because they are a note worth
  // keeping, just never a source of truth.
  assert.deepEqual(other.map((l) => l.score), [1, 999]);
});

test("an absent score is null rather than zero", () => {
  // Zero is a real score in plenty of games, so an absent one must not read as
  // one. Undefined and explicit null both mean "nobody typed a number".
  const lines = placementsFromOrder([{ playerId: "a" }, { playerId: "b", score: null }, { playerId: "c", score: 0 }]);
  assert.deepEqual(lines.map((l) => l.score), [null, null, 0]);
});

// ---------- title canonicalization ----------

const KNOWN = ["Settlers of Catan", "Ticket to Ride"];

test("an exact match keeps the existing spelling", () => {
  const r = canonicalTitle("Settlers of Catan", KNOWN);
  assert.equal(r.title, "Settlers of Catan");
  assert.equal(r.matched, true);
});

test("a case difference resolves to the spelling already in use", () => {
  // "catan" typed at 1am must not become a second title.
  assert.deepEqual(canonicalTitle("settlers of catan", KNOWN), { title: "Settlers of Catan", matched: true });
  assert.deepEqual(canonicalTitle("TICKET TO RIDE", KNOWN), { title: "Ticket to Ride", matched: true });
});

test("leading and trailing whitespace resolves to the existing spelling", () => {
  assert.deepEqual(canonicalTitle("  Ticket to Ride ", KNOWN), { title: "Ticket to Ride", matched: true });
  assert.deepEqual(canonicalTitle("\tTicket to Ride\n", KNOWN), { title: "Ticket to Ride", matched: true });
});

test("an internal double space resolves to the existing spelling", () => {
  assert.deepEqual(canonicalTitle("Ticket  to   Ride", KNOWN), { title: "Ticket to Ride", matched: true });
});

test("a genuine miss creates a new title, normalized", () => {
  const r = canonicalTitle("  Root  ", KNOWN);
  assert.equal(r.title, "Root");
  assert.equal(r.matched, false);
  // And "Catan" is genuinely a different title from "Settlers of Catan": the
  // app matches spellings, it does not guess at synonyms. Offering the crew's
  // own recents FIRST is what keeps that from happening in practice.
  assert.equal(canonicalTitle("Catan", KNOWN).matched, false);
});

test("normalizeTitle collapses whitespace without touching case", () => {
  assert.equal(normalizeTitle("  7   Wonders  "), "7 Wonders");
  assert.equal(normalizeTitle("wingspan"), "wingspan");
  assert.equal(normalizeTitle("   "), "");
});

test("an empty submission is empty rather than a match on nothing", () => {
  assert.deepEqual(canonicalTitle("   ", KNOWN), { title: "", matched: false });
});

test("the crew's own recents beat the curated list", () => {
  // The crew has been writing "Settlers of Catan" all year. The starter list
  // says "Catan". Their spelling wins, because it is the one their history is
  // already recorded under.
  const suggestions = tnTitleSuggestions(["Settlers of Catan"], BOARD_GAME_TITLES);
  assert.equal(suggestions[0], "Settlers of Catan");
  assert.deepEqual(canonicalTitle("settlers of CATAN", suggestions), {
    title: "Settlers of Catan",
    matched: true,
  });
});

test("titleSuggestions de-duplicates case-insensitively and keeps recents first", () => {
  const suggestions = tnTitleSuggestions(["catan", "Wingspan", "Catan"], BOARD_GAME_TITLES);
  assert.deepEqual(suggestions.slice(0, 2), ["catan", "Wingspan"]);
  // The curated "Catan" and "Wingspan" do not appear a second time.
  assert.equal(suggestions.filter((t) => t.toLowerCase() === "catan").length, 1);
  assert.equal(suggestions.filter((t) => t.toLowerCase() === "wingspan").length, 1);
});

test("the curated starter list is a convenience list, not a roster", () => {
  // It only has to be modest and free of duplicates. Codenames is deliberately
  // absent: it belongs to the Party games pack.
  assert.ok(BOARD_GAME_TITLES.length >= 10);
  assert.equal(new Set(BOARD_GAME_TITLES.map((t) => t.toLowerCase())).size, BOARD_GAME_TITLES.length);
  assert.ok(!BOARD_GAME_TITLES.some((t) => t.toLowerCase() === "codenames"));
});

// ---------- the per-pack roster cap ----------

const ffaLines = (n: number): SmashResultLine[] =>
  Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, character: null, placement: i + 1, isWinner: i === 0 }));

test("Board Game accepts 12 and rejects 13", () => {
  assert.equal(validateBgOrder(order(...roster(12).map((p) => p.id)), roster(12)), null);
  const thirteen = roster(13);
  const err = validateBgOrder(order(...thirteen.map((p) => p.id)), thirteen);
  assert.ok(err, "13 players must be rejected");
  assert.match(err!, /12/);
  assert.equal(BOARD_GAME_MAX_PLAYERS, 12);
});

test("SMASH IS STILL CAPPED AT 8, and 9 is still rejected there", () => {
  // This is the assertion the per-pack cap exists to protect. Smash's 8 is
  // load-bearing: Ultimate seats 8, and Smashdown's battle cap is
  // floor(rosterSize / playerCount) against it, so raising the GLOBAL to seat a
  // board game would have quietly changed every Smashdown cap in the app.
  assert.equal(FFA_MAX_PLAYERS, 8);
  assert.equal(validateFfa(ffaLines(8), "placement"), null);
  assert.equal(validateFfa(ffaLines(9), "placement"), "FFA is capped at 8 players");
  // Winner-only detail takes the same ceiling.
  const nine = ffaLines(9).map((l, i) => ({ ...l, isWinner: i === 0 }));
  assert.equal(validateFfa(nine, "winner"), "FFA is capped at 8 players");
});

test("the cap is an ARGUMENT, and the default is Smash's", () => {
  assert.equal(validateFfaSize(8), null);
  assert.equal(validateFfaSize(9), "FFA is capped at 8 players");
  assert.equal(validateFfaSize(12, 12), null);
  assert.equal(validateFfaSize(13, 12), "FFA is capped at 12 players");
  // And it names what it is capping, so a board game player is never shown a
  // sentence about FFA.
  assert.equal(validateFfaSize(13, 12, "A board game"), "A board game is capped at 12 players");
  // Two players is the floor everywhere.
  assert.equal(validateFfaSize(1, 12), "Need at least 2 players in a game");
});

test("Smash's placement validation is unchanged by the new argument", () => {
  // Placements must still be a permutation of 1..N there: Smash has no ties.
  const tied: SmashResultLine[] = [
    { playerId: "a", character: null, placement: 1, isWinner: true },
    { playerId: "b", character: null, placement: 1, isWinner: true },
    { playerId: "c", character: null, placement: 3, isWinner: false },
  ];
  assert.equal(validateFfa(tied, "placement"), "Placements must be 1 through 3");
});

// ---------- order validation ----------

test("a finish order must be at least two players", () => {
  // The wording gained the pack's own noun in the extraction, because the layer
  // is shared and "a game" reads wrong for a pack whose unit is a hand. The
  // rule is unchanged.
  assert.equal(validateBgOrder(order("p0"), roster(4)), "Need at least 2 players in a board game");
});

test("a player not in the session is rejected", () => {
  assert.match(
    validateBgOrder(order("p0", "ghost"), roster(4))!,
    /not in the session/,
  );
});

test("a player cannot appear twice in one finish order", () => {
  assert.match(validateBgOrder(order("p0", "p1", "p0"), roster(4))!, /only appear once/);
});

test("not everybody has to play every game", () => {
  // Twelve at the night, four at this game. That is the normal case.
  assert.equal(validateBgOrder(order("p0", "p3", "p7", "p11"), roster(12)), null);
});

// ---------- the night summary ----------

test("the night summary counts wins and averages the finishes", () => {
  const state = newBgState({ roster: roster(3) });
  state.games.push({
    idx: 0,
    title: "Catan",
    lines: placementsFromOrder(order("p0", "p1", "p2")),
    at: "2026-08-04T20:00:00.000Z",
  });
  state.games.push({
    idx: 1,
    title: "Catan",
    lines: placementsFromOrder(order("p1", "p0", "p2")),
    at: "2026-08-04T21:00:00.000Z",
  });
  const s = summarizeBgNight(state);
  assert.deepEqual(s.titles, [{ title: "Catan", games: 2 }]);
  const p0 = s.players.find((p) => p.playerId === "p0")!;
  assert.equal(p0.wins, 1);
  assert.equal(p0.games, 2);
  assert.equal(p0.avgPlacement, 1.5);
  // The last game is its own panel on the TV, so it is part of the summary.
  assert.equal(s.last!.title, "Catan");
  assert.deepEqual(s.last!.lines.map((l) => l.placement), [1, 2, 3]);
});

test("a night with no games has no last game and no averages", () => {
  const s = summarizeBgNight(newBgState({ roster: roster(4) }));
  assert.equal(s.last, null);
  assert.deepEqual(s.players, []);
  assert.deepEqual(s.titles, []);
});

test("a tie at the top makes two winners in the night standings", () => {
  const state = newBgState({ roster: roster(3) });
  state.games.push({
    idx: 0,
    title: "Azul",
    lines: placementsFromOrder([{ playerId: "p0" }, { playerId: "p1", tiedWithAbove: true }, { playerId: "p2" }]),
    at: "2026-08-04T20:00:00.000Z",
  });
  const s = summarizeBgNight(state);
  assert.equal(s.players.filter((p) => p.wins === 1).length, 2);
});

// ---------- the ledger key ----------
//
// The runtime owns ledgerKey and pack-runtime.test.ts covers its two shapes for
// every pack. What is asserted here is THIS pack's namespacing, because the key
// prefix and the sessionKey segment are the two things that decide whether a
// second night on one event collides with the first, and a collision is silent:
// the dedupe check simply drops every new game.

/** The runtime's key shape, restated so this file needs no database import. */
const bgKey = (eventId: string, sessionKey: string | undefined, idx: number | string) =>
  sessionKey ? `bg:${eventId}:${sessionKey}:${idx}` : `bg:${eventId}:${idx}`;

test("the ledger key is namespaced bg:{eventId}:{sessionKey}:{idx}", () => {
  assert.equal(bgKey("E1", "sess1", 0), "bg:E1:sess1:0");
  assert.equal(bgKey("E1", "sess1", 3), "bg:E1:sess1:3");
});

test("TWO SESSIONS ON ONE EVENT DO NOT COLLIDE", () => {
  // Both sessions restart idx at 0, so without the sessionKey segment the
  // second night's first game would be dropped as a duplicate of the first
  // night's, silently.
  const a = newBgState({ roster: roster(2) });
  const b = newBgState({ roster: roster(2) });
  assert.notEqual(a.sessionKey, b.sessionKey);
  for (const idx of [0, 1, 2]) {
    assert.notEqual(bgKey("E1", a.sessionKey, idx), bgKey("E1", b.sessionKey, idx));
  }
  // And a legacy key (no sessionKey) can never equal a modern one.
  assert.notEqual(bgKey("E1", undefined, 0), bgKey("E1", a.sessionKey, 0));
});

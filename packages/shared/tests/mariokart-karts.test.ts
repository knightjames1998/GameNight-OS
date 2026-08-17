// TWO PLAYERS, ONE KART: what a race, a set and an arrangement do.
//
// mariokart-baseline.test.ts is the other half and is the one that matters
// most: it was written against the engine BEFORE any of this and still passes
// unedited, so a solo night has not moved. This file is the new behaviour, and
// it leans hardest on the things that are silent when wrong.
//
// THE SILENT ONE IS `side`. A non-null side means "this match had team
// structure" everywhere else in the app, and buildRivalry reads it to decide
// whether two people played together or against each other. A solo race that
// started writing a side would make every rivalry it touches wrong forever with
// nothing erroring, and a 2v1 whose SOLO racer wrote null would make the pair
// and the solo read as having raced together. Both are asserted below, by name.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isKartPairs,
  mkOrderFromPlacements,
  mkRaceLines,
  mkSeriesLines,
  mkSides,
  mkSidesAtIdx,
  mkUnitCount,
  newMkKartState,
  newSeries,
  recordSeriesGame,
  reshuffleMkSides,
  singletonSides,
  validateMkRaceOrder,
  type MkSessionState,
  type Side,
  type SmashPlayer,
} from "../src/index.js";

const roster = (n: number): SmashPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    kind: "member" as const,
    userId: `u${i}`,
    name: `P${i}`,
    character: `Racer${i}`,
  }));

const kart = (id: string, ...memberIds: string[]): Side => ({
  id,
  name: `Kart ${id.toUpperCase()}`,
  memberIds,
});

const RACER_OF = (playerId: string) => `Racer${playerId.slice(1)}`;

/** p0+p1 in one kart, p2+p3 in the other. */
const PAIRS = [kart("a", "p0", "p1"), kart("b", "p2", "p3")];
/** p0+p1 share; p2 drives alone. */
const UNEVEN = [kart("a", "p0", "p1"), kart("b", "p2")];

const session = (opts: { format?: "free" | "grandprix" | "bestof" | "koth"; players?: number; sides?: Side[] } = {}): MkSessionState =>
  newMkKartState({
    format: opts.format ?? "free",
    assignment: "self",
    resultDetail: "placement",
    roster: roster(opts.players ?? 4),
    sides: opts.sides,
  });

const rows = (lines: readonly { playerId: string; placement: number; isWinner: boolean; side: string | null }[]) =>
  lines.map((l) => [l.playerId, l.placement, l.isWinner, l.side]);

// ---------- a solo night has not moved ----------

test("SOLO: a race writes exactly the lines it wrote before karts existed", () => {
  const s = session({ players: 4 });
  assert.equal(isKartPairs(s), false);
  const lines = mkRaceLines(["a", "b", "c", "d"], mkSides(s), "placement", RACER_OF);
  assert.deepEqual(lines, [
    { playerId: "p0", character: "Racer0", placement: 1, isWinner: true, side: null },
    { playerId: "p1", character: "Racer1", placement: 2, isWinner: false, side: null },
    { playerId: "p2", character: "Racer2", placement: 3, isWinner: false, side: null },
    { playerId: "p3", character: "Racer3", placement: 4, isWinner: false, side: null },
  ]);
});

test("SOLO: NO SIDE REACHES A LINE, whatever the finish order", () => {
  const s = session({ players: 4 });
  for (const order of [["a", "b", "c", "d"], ["d", "c", "b", "a"], ["b", "d"]]) {
    assert.deepEqual(
      mkRaceLines(order, mkSides(s), "placement", RACER_OF).map((l) => l.side),
      order.map(() => null),
    );
  }
});

test("SOLO: winner-only detail is still 1 for the winner and 2 for everybody else", () => {
  const s = session({ players: 4 });
  assert.deepEqual(
    rows(mkRaceLines(["c", "a", "b", "d"], mkSides(s), "winner", RACER_OF)),
    [
      ["p2", 1, true, null],
      ["p0", 2, false, null],
      ["p1", 2, false, null],
      ["p3", 2, false, null],
    ],
  );
});

test("SOLO: the per-racer form a shipped client sends translates to the same race", () => {
  // The old wire is per-player placements. On a solo night a kart holds one
  // racer, so the two spellings carry the same information and the older one
  // keeps working rather than being refused.
  const s = session({ players: 4 });
  const sides = mkSides(s);
  const order = mkOrderFromPlacements(
    [
      { playerId: "p2", placement: 1 },
      { playerId: "p0", placement: 2 },
      { playerId: "p3", placement: 3 },
      { playerId: "p1", placement: 4 },
    ],
    sides,
  );
  assert.deepEqual(order, ["c", "a", "d", "b"]);
  assert.deepEqual(
    rows(mkRaceLines(order, sides, "placement", RACER_OF)),
    [
      ["p2", 1, true, null],
      ["p0", 2, false, null],
      ["p3", 3, false, null],
      ["p1", 4, false, null],
    ],
  );
});

test("a race somebody sat out is a race between the karts that ran", () => {
  const s = session({ players: 4 });
  const order = mkOrderFromPlacements([{ playerId: "p1", placement: 1 }, { playerId: "p3", placement: 2 }], mkSides(s));
  assert.deepEqual(order, ["b", "d"]);
  assert.deepEqual(rows(mkRaceLines(order, mkSides(s), "placement", RACER_OF)), [
    ["p1", 1, true, null],
    ["p3", 2, false, null],
  ]);
});

// ---------- two karts of two ----------

test("PAIRS: two karts of two is 1,1,2,2 with a kart id on every row", () => {
  const s = session({ sides: PAIRS });
  assert.equal(isKartPairs(s), true);
  assert.deepEqual(rows(mkRaceLines(["b", "a"], mkSides(s), "placement", RACER_OF)), [
    ["p2", 1, true, "b"],
    ["p3", 1, true, "b"],
    ["p0", 2, false, "a"],
    ["p1", 2, false, "a"],
  ]);
});

test("PAIRS: BOTH MEMBERS OF THE WINNING KART ARE WINNERS", () => {
  // Not a nicety. isWinner is what the crew leaderboard counts, and a version
  // of this that credited one seat would silently halve a pair's record.
  const s = session({ sides: PAIRS });
  const lines = mkRaceLines(["a", "b"], mkSides(s), "placement", RACER_OF);
  assert.deepEqual(lines.filter((l) => l.isWinner).map((l) => l.playerId), ["p0", "p1"]);
});

test("PAIRS: each racer keeps their OWN racer, not the kart's", () => {
  const s = session({ sides: PAIRS });
  assert.deepEqual(
    mkRaceLines(["a", "b"], mkSides(s), "placement", RACER_OF).map((l) => [l.playerId, l.character]),
    [
      ["p0", "Racer0"],
      ["p1", "Racer1"],
      ["p2", "Racer2"],
      ["p3", "Racer3"],
    ],
  );
});

test("PAIRS: three karts of two is 1,1,2,2,3,3", () => {
  const s = session({
    players: 6,
    sides: [kart("a", "p0", "p1"), kart("b", "p2", "p3"), kart("c", "p4", "p5")],
  });
  assert.deepEqual(
    mkRaceLines(["c", "a", "b"], mkSides(s), "placement", RACER_OF).map((l) => l.placement),
    [1, 1, 2, 2, 3, 3],
  );
});

test("PAIRS: winner-only detail over karts is 1,1,2,2,2,2", () => {
  const s = session({
    players: 6,
    sides: [kart("a", "p0", "p1"), kart("b", "p2", "p3"), kart("c", "p4", "p5")],
  });
  assert.deepEqual(
    mkRaceLines(["a", "b", "c"], mkSides(s), "winner", RACER_OF).map((l) => l.placement),
    [1, 1, 2, 2, 2, 2],
  );
});

// ---------- uneven karts, which are a real night ----------

test("UNEVEN: a 2v1 is allowed at all, and the arrangement is not narrowed", () => {
  const s = session({ players: 3, sides: UNEVEN });
  assert.equal(isKartPairs(s), true);
  assert.deepEqual(mkSides(s).map((x) => x.memberIds), [["p0", "p1"], ["p2"]]);
});

test("UNEVEN: THE SOLO RACER GETS A REAL KART ID, NEVER NULL", () => {
  // The failure this is here to stop: a null side on this row would make
  // meetingOutcome read the pair and the solo as having raced TOGETHER, and the
  // rivalry would be wrong forever with nothing erroring. isTeamPlay is true
  // because ANOTHER kart holds two, so sideIdFor does not take its
  // null-when-every-side-is-one branch.
  const s = session({ players: 3, sides: UNEVEN });
  assert.deepEqual(rows(mkRaceLines(["a", "b"], mkSides(s), "placement", RACER_OF)), [
    ["p0", 1, true, "a"],
    ["p1", 1, true, "a"],
    ["p2", 2, false, "b"],
  ]);
});

test("UNEVEN: a winning solo is 1,2,2 and a winning pair is 1,1,2", () => {
  // Karts are ranked 1..N over N karts, so a 2v1 has TWO places to finish and
  // three participant rows. Competition ranking is for genuine ties between
  // individuals and is not reached for here.
  const s = session({ players: 3, sides: UNEVEN });
  assert.deepEqual(
    mkRaceLines(["b", "a"], mkSides(s), "placement", RACER_OF).map((l) => [l.playerId, l.placement]),
    [
      ["p2", 1],
      ["p0", 2],
      ["p1", 2],
    ],
  );
});

test("UNEVEN: THE LOSING SOLO IS SECOND OF THREE ROWS AND IS NEVER LAST", () => {
  // countLastPlace compares a placement against the participant count, so a
  // placement of 2 among 3 participants never qualifies. In a two-kart race
  // there is a loser, not a last, which is the 2026-08-05 decision applied
  // rather than a new one.
  const s = session({ players: 3, sides: UNEVEN });
  const lines = mkRaceLines(["a", "b"], mkSides(s), "placement", RACER_OF);
  assert.equal(lines.length, 3, "three participant rows");
  const solo = lines.find((l) => l.playerId === "p2")!;
  assert.equal(solo.placement, 2);
  assert.notEqual(solo.placement, lines.length);
});

test("UNEVEN: A RACE BETWEEN TWO SOLO KARTS HAS NO TEAM STRUCTURE IN IT", () => {
  // The side is decided over the karts that RACED, not over the whole
  // arrangement, because that is the only reading under which "null means no
  // team structure" stays true on the row buildRivalry is looking at.
  const s = session({
    players: 4,
    sides: [kart("a", "p0", "p1"), kart("b", "p2"), kart("c", "p3")],
  });
  assert.equal(isKartPairs(s), true, "the night has a pair in it");
  assert.deepEqual(rows(mkRaceLines(["b", "c"], mkSides(s), "placement", RACER_OF)), [
    ["p2", 1, true, null],
    ["p3", 2, false, null],
  ]);
});

// ---------- what a race order may be ----------

test("a race needs at least two karts, and a kart can only finish once", () => {
  const sides = PAIRS;
  assert.equal(validateMkRaceOrder(["a", "b"], sides), null);
  assert.equal(validateMkRaceOrder(["a"], sides), "At least 2 karts have to race");
  assert.equal(validateMkRaceOrder(["a", "a"], sides), "A kart can only finish once");
  assert.equal(validateMkRaceOrder(["a", "z"], sides), "That kart is not in this session");
});

test("EIGHT KARTS SITS EXACTLY AT THE CAP", () => {
  // MAX_SIDES is eight and this pack's roster cap is sixteen, so eight karts of
  // two is the widest night it offers and there is nothing to reconcile.
  const sides = singletonSides(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"]);
  const order = sides.map((s) => s.id);
  assert.equal(validateMkRaceOrder(order, sides), null);
  assert.equal(validateMkRaceOrder([...order, "i"], sides), "At most 8 karts");
});

// ---------- a best-of set between two karts ----------

test("BEST OF: a set between two karts writes 1,1,2,2 with the kart's game tally on each member", () => {
  const s = session({ format: "bestof", sides: PAIRS });
  const ser = newSeries("a", "b")!;
  recordSeriesGame(ser, 3, "a");
  recordSeriesGame(ser, 3, "b");
  recordSeriesGame(ser, 3, "a");
  assert.equal(ser.winnerId, "a");

  assert.deepEqual(mkSeriesLines(ser, mkSides(s), RACER_OF), [
    { playerId: "p0", character: "Racer0", placement: 1, isWinner: true, meta: { gameWins: 2, gamesPlayed: 3 }, side: "a" },
    { playerId: "p1", character: "Racer1", placement: 1, isWinner: true, meta: { gameWins: 2, gamesPlayed: 3 }, side: "a" },
    { playerId: "p2", character: "Racer2", placement: 2, isWinner: false, meta: { gameWins: 1, gamesPlayed: 3 }, side: "b" },
    { playerId: "p3", character: "Racer3", placement: 2, isWinner: false, meta: { gameWins: 1, gamesPlayed: 3 }, side: "b" },
  ]);
});

test("BEST OF SOLO: the same set writes the two rows it always wrote, side null", () => {
  const s = session({ format: "bestof", players: 2 });
  const ser = newSeries("a", "b")!;
  recordSeriesGame(ser, 3, "a");
  recordSeriesGame(ser, 3, "b");
  recordSeriesGame(ser, 3, "a");
  assert.deepEqual(mkSeriesLines(ser, mkSides(s), RACER_OF), [
    { playerId: "p0", character: "Racer0", placement: 1, isWinner: true, meta: { gameWins: 2, gamesPlayed: 3 }, side: null },
    { playerId: "p1", character: "Racer1", placement: 2, isWinner: false, meta: { gameWins: 1, gamesPlayed: 3 }, side: null },
  ]);
});

test("BEST OF: an unfinished set writes nothing", () => {
  const s = session({ format: "bestof", sides: PAIRS });
  const ser = newSeries("a", "b")!;
  recordSeriesGame(ser, 3, "a");
  assert.deepEqual(mkSeriesLines(ser, mkSides(s), RACER_OF), []);
});

// ---------- rearranging the karts ----------

test("RESHUFFLE: the new arrangement takes effect from the NEXT race", () => {
  const s = session({ sides: PAIRS });
  s.games.push({ idx: 0, mode: "ffa", at: "2026-08-16T20:00:00.000Z", lines: mkRaceLines(["a", "b"], mkSides(s), "placement", RACER_OF) });
  assert.equal(mkUnitCount(s), 1);
  assert.equal(reshuffleMkSides(s, [kart("a", "p0", "p2"), kart("b", "p1", "p3")]), null);
  assert.deepEqual(
    s.sideSets.map((e) => [e.fromIdx, e.sides.map((x) => x.memberIds)]),
    [
      [0, [["p0", "p1"], ["p2", "p3"]]],
      [1, [["p0", "p2"], ["p1", "p3"]]],
    ],
  );
});

test("RESHUFFLE: the race already recorded keeps the karts it was raced under", () => {
  const s = session({ sides: PAIRS });
  s.games.push({ idx: 0, mode: "ffa", at: "2026-08-16T20:00:00.000Z", lines: mkRaceLines(["a", "b"], mkSides(s), "placement", RACER_OF) });
  reshuffleMkSides(s, [kart("a", "p0", "p2"), kart("b", "p1", "p3")]);
  assert.deepEqual(mkSidesAtIdx(s, 0).map((x) => x.memberIds), [["p0", "p1"], ["p2", "p3"]]);
  assert.deepEqual(mkSidesAtIdx(s, 1).map((x) => x.memberIds), [["p0", "p2"], ["p1", "p3"]]);
  // And the row that went to the ledger still says which kart it was.
  assert.deepEqual(s.games[0]!.lines.map((l) => [l.playerId, l.side]), [
    ["p0", "a"],
    ["p1", "a"],
    ["p2", "b"],
    ["p3", "b"],
  ]);
});

test("RESHUFFLE: somebody who is not in this session is refused", () => {
  const s = session({ sides: PAIRS });
  assert.equal(
    reshuffleMkSides(s, [kart("a", "p0", "ghost"), kart("b", "p2", "p3")]),
    "Somebody in a kart is not in this session",
  );
});

test("RESHUFFLE: a broken arrangement is refused by the PRIMITIVE, not by this pack", () => {
  const s = session({ sides: PAIRS });
  assert.equal(reshuffleMkSides(s, [kart("a", "p0", "p1")]), "Need at least 2 sides");
  assert.equal(reshuffleMkSides(s, [kart("a", "p0"), kart("b")]), "Every side needs at least one player");
});

test("RESHUFFLE: uneven karts are NOT refused", () => {
  const s = session({ players: 3, sides: singletonSides(["p0", "p1", "p2"]) });
  assert.equal(reshuffleMkSides(s, [kart("a", "p0", "p1"), kart("b", "p2")]), null);
  assert.deepEqual(mkSides(s).map((x) => x.memberIds), [["p0", "p1"], ["p2"]]);
});

// ---------- the two index spaces ----------

test("THE SIDE LOG IS KEYED ON THIS FORMAT'S OWN UNIT COUNT", () => {
  // Free Play, Grand Prix and King of the Hill record RACES; Best Of records
  // SETS. A reshuffle keyed to the wrong counter puts its fromIdx in the wrong
  // place and the arrangement a recorded unit is reported under drifts, which
  // nothing errors about.
  const free = session({ format: "free", sides: PAIRS });
  free.games.push({ idx: 0, mode: "ffa", at: "t", lines: [] }, { idx: 1, mode: "ffa", at: "t", lines: [] });
  assert.equal(mkUnitCount(free), 2);

  const bo = session({ format: "bestof", sides: PAIRS });
  bo.games.push({ idx: 0, mode: "ffa", at: "t", lines: [] });
  const ser = newSeries("a", "b")!;
  ser.idx = 0;
  bo.seriesLog.push(ser);
  assert.equal(mkUnitCount(bo), 1, "a Best Of session counts sets, never races");
});

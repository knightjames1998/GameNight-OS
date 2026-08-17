// The Mario Kart pack's own derivations: the points table, the cup chunking,
// and the racer catalogue's title scoping.
//
// It had no test file. THE CUP IS THE PART THAT MATTERS, and it is the part
// that looks trivial: Grand Prix has no stored cup pointer, so which cup you are
// in is DERIVED from the games log by chunking it. That was a deliberate call
// (an undo just recomputes instead of having to unwind a pointer), and the
// price is that the chunking arithmetic is now load-bearing on a screen and on
// a TV. Off by one there does not error, it shows the wrong cup's standings
// mid-race with everybody's points slightly wrong, which reads as a scoring
// dispute rather than as a bug.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkPoints,
  cupNoForRace,
  cupStandings,
  newMkKartState,
  isRacer,
  MARIO_KART_RACERS,
  MARIO_KART_TITLES,
  rosterForTitle,
  type MkSessionState,
  type SmashPlayer,
} from "../src/index.js";

const roster: SmashPlayer[] = [
  { id: "p0", kind: "member", userId: "u0", name: "Ann", character: "Mario" },
  { id: "p1", kind: "member", userId: "u1", name: "Ben", character: "Yoshi" },
  { id: "p2", kind: "guest", userId: null, name: "Cal", character: null },
];

function gpState(raceCount: number): MkSessionState {
  return newMkKartState({
    format: "grandprix",
    assignment: "self",
    resultDetail: "placement",
    roster,
    raceCount,
  });
}

/** One recorded race, finishing in the given slot order. */
function race(idx: number, order: string[]) {
  return {
    idx,
    mode: "ffa" as const,
    at: new Date(2026, 6, 28, 20, idx).toISOString(),
    lines: order.map((playerId, i) => ({
      playerId,
      character: null,
      placement: i + 1,
      isWinner: i === 0,
    })),
  };
}

// ---------- the points table ----------

test("the points table is Mario Kart 8's, top of the table down", () => {
  assert.equal(mkPoints(1), 15);
  assert.equal(mkPoints(2), 12);
  assert.equal(mkPoints(3), 10);
  assert.equal(mkPoints(12), 1);
});

test("a placement off the table scores nothing rather than something negative", () => {
  // Twelve is the table's length. A thirteenth racer is not a shape this pack
  // offers, and 0 is the honest answer rather than an extrapolation.
  assert.equal(mkPoints(13), 0);
  assert.equal(mkPoints(0), 0);
  assert.equal(mkPoints(-1), 0);
});

test("fewer racers just use the TOP of the table, keeping the spread", () => {
  // Four racers score 15, 12, 10, 9. Rescaling to the field size would make a
  // win in a three-player race worth the same as a win in a twelve-player one,
  // which is the opposite of what a points cup is for.
  assert.deepEqual([1, 2, 3, 4].map(mkPoints), [15, 12, 10, 9]);
});

// ---------- which cup a race belongs to ----------

test("cup numbers are 1-based and chunk on the race count", () => {
  assert.equal(cupNoForRace(0, 4), 1);
  assert.equal(cupNoForRace(3, 4), 1, "the fourth race is still cup 1");
  assert.equal(cupNoForRace(4, 4), 2, "the fifth starts cup 2");
  assert.equal(cupNoForRace(7, 4), 2);
  assert.equal(cupNoForRace(8, 4), 3);
});

// ---------- the derived cup standings ----------

test("an empty night shows cup 1, waiting, rather than cup 0", () => {
  const out = cupStandings(gpState(4));
  assert.equal(out.cupNo, 1);
  assert.equal(out.racesDone, 0);
  assert.equal(out.complete, false);
  assert.deepEqual(out.standings, []);
});

test("a partial cup shows the cup IN PROGRESS and only its own races", () => {
  const s = gpState(4);
  s.games.push(race(0, ["p0", "p1", "p2"]), race(1, ["p1", "p0", "p2"]));
  const out = cupStandings(s);
  assert.equal(out.cupNo, 1);
  assert.equal(out.racesDone, 2);
  assert.equal(out.complete, false);
  // 15 + 12 each for the two who traded wins, 10 + 10 for third both times.
  assert.deepEqual(
    out.standings.map((x) => [x.name, x.points, x.wins, x.races]),
    [
      ["Ann", 27, 1, 2],
      ["Ben", 27, 1, 2],
      ["Cal", 20, 0, 2],
    ],
  );
});

test("ON AN EXACT BOUNDARY THE CUP THAT JUST FILLED IS SHOWN, not the empty next one", () => {
  // The whole reason cupStandings has three branches. After the fourth race of
  // a four-race cup, showing cup 2 with nothing in it would blank the screen at
  // exactly the moment the cup was won.
  const s = gpState(4);
  s.games.push(race(0, ["p0", "p1"]), race(1, ["p0", "p1"]), race(2, ["p0", "p1"]), race(3, ["p0", "p1"]));
  const out = cupStandings(s);
  assert.equal(out.cupNo, 1);
  assert.equal(out.racesDone, 4);
  assert.equal(out.complete, true);
  assert.equal(out.standings[0]!.points, 60, "four wins at 15");
});

test("the race AFTER a boundary opens the next cup with only that race in it", () => {
  const s = gpState(2);
  s.games.push(race(0, ["p0", "p1"]), race(1, ["p0", "p1"]), race(2, ["p1", "p0"]));
  const out = cupStandings(s);
  assert.equal(out.cupNo, 2);
  assert.equal(out.racesDone, 1);
  assert.equal(out.complete, false);
  assert.deepEqual(
    out.standings.map((x) => [x.name, x.points]),
    [
      ["Ben", 15],
      ["Ann", 12],
    ],
    "cup 1's thirty points are not carried forward",
  );
});

test("standings order on points, then on wins", () => {
  const s = gpState(4);
  // Ann and Ben both take 27 over two races; Ann won the first, Ben the second,
  // so they stay level on both keys and the pack does not invent a third.
  s.games.push(race(0, ["p0", "p1", "p2"]), race(1, ["p1", "p0", "p2"]));
  const out = cupStandings(s);
  assert.equal(out.standings[2]!.name, "Cal", "fewest points is last whatever else happens");
});

test("a racer who arrives mid-cup is counted only from the races they ran", () => {
  const s = gpState(4);
  s.games.push(race(0, ["p0", "p1"]), race(1, ["p0", "p1", "p2"]));
  const cal = cupStandings(s).standings.find((x) => x.name === "Cal")!;
  assert.equal(cal.races, 1);
  assert.equal(cal.points, 10);
});

test("a race count is clamped to something a cup can actually be", () => {
  assert.equal(gpState(1).grandPrix.raceCount, 2, "one race is not a cup");
  assert.equal(gpState(99).grandPrix.raceCount, 12);
  assert.equal(gpState(4).grandPrix.raceCount, 4);
});

// ---------- the racer catalogue ----------

test("isRacer is exact, because it gates what reaches the ledger", () => {
  assert.equal(isRacer("Mario"), true);
  assert.equal(isRacer("mario"), false, "case matters; stats unify by exact name");
  assert.equal(isRacer("Mario "), false);
  assert.equal(isRacer("Sonic"), false);
  assert.equal(isRacer(null), false);
  assert.equal(isRacer(42), false);
});

test("ISRACER ACCEPTS EVERY RACER ANY TITLE OFFERS", () => {
  // THE RULE THIS IS ABOUT. A title scopes the picker and the random pool
  // (standing rule, character packs), so a host on a Double Dash night is
  // offered that title's roster. `isRacer` is the gate a submitted racer runs
  // through on the way to the ledger, and it used to check the MK8DX master
  // list ALONE. A racer a title offers but the master list does not contain was
  // therefore pickable and then unrecognised, and the failure was the silent
  // kind: the name replaced with null rather than refused.
  //
  // GREEN SINCE 2026-08-16. It was a todo for one day, on the ground that both
  // gates had something rescuing them (see AUDIT-2026-08.md NOTED 9), and the
  // pairs session removed one of those rescues: the record route no longer
  // falls back to the slot's stored racer, because a race now takes its racers
  // from the roster rather than from the request. That is precisely the "a pass
  // that tidies away the fallback makes it live" case this test was written
  // for, so it was fixed in the same session that reached it. `isRacer` now
  // checks the UNION of every title's roster.
  const offered = new Set(MARIO_KART_TITLES.flatMap((t) => t.roster));
  const rejected = [...offered].filter((name) => !isRacer(name));
  assert.deepEqual(
    rejected,
    [],
    `${rejected.length} racer(s) are offered by a title but rejected by isRacer, ` +
      `so they reach the ledger as null: ${rejected.join(", ")}`,
  );
});

test("PARATROOPA, by name, because it is the one that was broken", () => {
  // A regression test rather than a duplicate: the union check above passes the
  // moment the sets agree, and this says which racer the bug was about, so a
  // future pass that narrows the gate back to the master list fails with the
  // answer already in the message.
  assert.equal(isRacer("Paratroopa"), true);
  assert.equal(MARIO_KART_RACERS.includes("Paratroopa"), false, "and it is still NOT an MK8 Deluxe racer");
});

test("the master racer list is the default title's roster, exactly", () => {
  // Unchanged by the Paratroopa fix, and deliberately so: widening
  // MARIO_KART_RACERS would have put Paratroopa in the MK8 Deluxe picker, where
  // the character does not exist. The union lives behind isRacer instead.
  assert.deepEqual(MARIO_KART_TITLES[0]!.roster, MARIO_KART_RACERS);
});

test("a racer no title offers is still refused", () => {
  // The gate got wider, not open. Widening it to "any string" would put
  // arbitrary text on a lifetime character stat with nothing to catch it.
  assert.equal(isRacer("Sonic"), false);
  assert.equal(isRacer("Paratroopa "), false, "exact, because stats unify by exact name");
});

test("the default title is the widest one, and an unknown title falls back to it", () => {
  assert.equal(MARIO_KART_TITLES[0]!.id, "mk8dx");
  assert.deepEqual(rosterForTitle(MARIO_KART_TITLES, null), MARIO_KART_RACERS);
  assert.deepEqual(rosterForTitle(MARIO_KART_TITLES, "not-a-title"), MARIO_KART_RACERS);
  assert.ok(rosterForTitle(MARIO_KART_TITLES, "mkwii").includes("Funky Kong"));
  assert.equal(rosterForTitle(MARIO_KART_TITLES, "mkworld").includes("Funky Kong"), false);
});

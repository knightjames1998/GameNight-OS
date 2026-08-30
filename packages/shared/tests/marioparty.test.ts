// Mario Party's ranking rule, which is the only pack that ranks on a TYPED
// NUMBER rather than on a tapped order.
//
// It had no test file. rankMpLines is the whole risk in the pack: it is the one
// place a host's typed star counts become permanent placements, it refuses
// rather than guesses in four different situations, and its competition ranking
// deliberately treats the winner differently from everybody else. That last
// part looks like an off-by-one and is not, which is precisely why it needs
// something asserting it rather than a comment asking to be believed.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rankMpLines,
  bonusFamilyOf,
  boardsForTitle,
  bonusStarsForTitle,
  MARIO_PARTY_TITLES,
  MP_BONUS_FAMILIES,
  MP_CUSTOM_BOARD,
  rankMpSides,
  newMpState,
  normalizeMpState,
  summarizeMpNight,
  singletonSides,
  hasTeamStructure,
  currentSides,
  sidesAtIdx,
  reshuffle,
  truncateSideLog,
  type MpRawEntry,
  type MpSideEntry,
  type MpSessionState,
  type MpGame,
  type SmashPlayer,
  type Side,
} from "../src/index.js";

const entry = (playerId: string, stars: number, bonusStars: string[] = []): MpRawEntry => ({
  playerId,
  character: null,
  stars,
  bonusStars,
});

/** Just the [playerId, placement, isWinner] triples, which is what ranks. */
const shape = (lines: { playerId: string; placement: number; isWinner: boolean }[]) =>
  lines.map((l) => [l.playerId, l.placement, l.isWinner]);

// ---------- refusals ----------

test("a board needs at least two players and at most four", () => {
  assert.equal(rankMpLines([entry("a", 5)], null).error, "Need at least 2 players in a game");
  assert.equal(rankMpLines([], null).error, "Need at least 2 players in a game");
  const five = ["a", "b", "c", "d", "e"].map((id) => entry(id, 1));
  assert.equal(rankMpLines(five, null).error, "Mario Party is up to 4 players");
});

test("a missing or negative star count is refused rather than read as zero", () => {
  // The host types these. A blank box arriving as NaN and being scored 0 would
  // hand somebody last place for a form they had not finished filling in.
  assert.ok(rankMpLines([entry("a", NaN), entry("b", 3)], null).error);
  assert.ok(rankMpLines([entry("a", Infinity), entry("b", 3)], null).error);
  assert.ok(rankMpLines([entry("a", -1), entry("b", 3)], null).error);
});

test("ONE BONUS STAR CANNOT SIT ON TWO PLAYERS in the same board", () => {
  // Each bonus star is awarded once per game by the game itself, so two players
  // holding the same one is a data-entry mistake rather than a possible night.
  const out = rankMpLines(
    [entry("a", 5, ["Minigame Star"]), entry("b", 4, ["Minigame Star"])],
    "a",
  );
  assert.equal(out.lines.length, 0);
  assert.match(out.error!, /Only one player can get the Minigame Star/);
});

test("two players holding DIFFERENT bonus stars is fine", () => {
  const out = rankMpLines([entry("a", 5, ["Minigame Star"]), entry("b", 4, ["Coin Star"])], null);
  assert.equal(out.error, null);
  assert.deepEqual(out.lines[0]!.bonusStars, ["Minigame Star"]);
});

// ---------- the winner ----------

test("a clear star lead wins with no host input needed", () => {
  const out = rankMpLines([entry("a", 7), entry("b", 4), entry("c", 2)], null);
  assert.equal(out.error, null);
  assert.deepEqual(shape(out.lines), [
    ["a", 1, true],
    ["b", 2, false],
    ["c", 3, false],
  ]);
});

test("A TIE AT THE TOP IS REFUSED UNTIL THE HOST TAPS A WINNER", () => {
  // Coins are the real tiebreak in Mario Party and this app deliberately does
  // not track them, so there is nothing to break the tie WITH. Picking one
  // arbitrarily would write a permanent wrong result; asking costs one tap.
  const tied = [entry("a", 6), entry("b", 6), entry("c", 1)];
  assert.equal(rankMpLines(tied, null).error, "Two players are tied on stars. Tap who won.");
  const resolved = rankMpLines(tied, "b");
  assert.equal(resolved.error, null);
  assert.equal(resolved.lines[0]!.playerId, "b");
});

test("the host cannot hand the win to somebody who is not on the most stars", () => {
  const out = rankMpLines([entry("a", 7), entry("b", 4)], "b");
  assert.equal(out.lines.length, 0);
  assert.equal(out.error, "The winner must have the most stars");
});

test("a winnerId naming nobody in the game falls back to the star lead", () => {
  // A stale client can send a slot that has since been removed. With a clear
  // leader there is still a right answer, so it is used rather than erroring.
  const out = rankMpLines([entry("a", 7), entry("b", 4)], "ghost");
  assert.equal(out.error, null);
  assert.equal(out.lines[0]!.playerId, "a");
});

// ---------- competition ranking, and the winner's exception ----------

test("non-winners tied on stars SHARE a placement, leaving a gap", () => {
  // 1, 2, 2, 4. Competition ranking, the same rule the team primitive uses.
  const out = rankMpLines([entry("a", 9), entry("b", 5), entry("c", 5), entry("d", 1)], null);
  assert.deepEqual(shape(out.lines), [
    ["a", 1, true],
    ["b", 2, false],
    ["c", 2, false],
    ["d", 4, false],
  ]);
});

test("A NON-WINNER LEVEL WITH THE WINNER GETS 2, NOT A SHARED 1", () => {
  // This looks like an off-by-one in the loop (it starts at index 2, not 1) and
  // is the pack's actual rule: a player level on stars with the winner LOST the
  // coin tiebreak inside the game, so second is the true result. Sharing first
  // would claim the board ended in a draw, which Mario Party cannot do.
  const out = rankMpLines([entry("a", 6), entry("b", 6), entry("c", 2)], "a");
  assert.deepEqual(shape(out.lines), [
    ["a", 1, true],
    ["b", 2, false],
    ["c", 3, false],
  ]);
});

test("three players level below the winner all share second", () => {
  const out = rankMpLines([entry("a", 9), entry("b", 4), entry("c", 4), entry("d", 4)], null);
  assert.deepEqual(shape(out.lines), [
    ["a", 1, true],
    ["b", 2, false],
    ["c", 2, false],
    ["d", 2, false],
  ]);
});

test("everybody on zero stars still produces a winner and a ranking", () => {
  // A short board where nobody bought a star is a real night, not an error.
  const out = rankMpLines([entry("a", 0), entry("b", 0)], "a");
  assert.equal(out.error, null);
  assert.deepEqual(shape(out.lines), [
    ["a", 1, true],
    ["b", 2, false],
  ]);
});

test("exactly one player is ever flagged as the winner", () => {
  const out = rankMpLines([entry("a", 5), entry("b", 5), entry("c", 5), entry("d", 5)], "c");
  assert.equal(out.lines.filter((l) => l.isWinner).length, 1);
  assert.equal(out.lines[0]!.playerId, "c");
});

test("the character and the bonus stars ride through untouched", () => {
  const out = rankMpLines(
    [
      { playerId: "a", character: "Bowser", stars: 5, bonusStars: ["Coin Star"] },
      { playerId: "b", character: null, stars: 2, bonusStars: [] },
    ],
    null,
  );
  assert.equal(out.lines[0]!.character, "Bowser");
  assert.deepEqual(out.lines[0]!.bonusStars, ["Coin Star"]);
  assert.equal(out.lines[1]!.character, null);
});

// ---------- the catalogues ----------

test("BONUS STARS FOLD ONTO A FAMILY, because each title renames the same idea", () => {
  // Lifetime stats unify by family. Super Mario Party's "Minigame Star" and
  // Jamboree's "Minigame Bonus" are one achievement with two box-arts' wording,
  // and keeping them apart would split one player's tally in half silently.
  assert.equal(bonusFamilyOf("Minigame Star"), "Minigame");
  assert.equal(bonusFamilyOf("Minigame Bonus"), "Minigame");
  assert.equal(bonusFamilyOf("Coin Star"), "Coins");
  assert.equal(bonusFamilyOf("Rich Bonus"), "Coins");
  assert.equal(bonusFamilyOf("Happening Star"), bonusFamilyOf("Eventful Bonus"));
});

test("an uncurated bonus star keeps its own name rather than being dropped", () => {
  // The honest fallback: a star nobody has mapped is its own family of one,
  // which still tallies, instead of vanishing into an "Other" bucket.
  assert.equal(bonusFamilyOf("Some Star Nobody Curated"), "Some Star Nobody Curated");
  assert.equal(bonusFamilyOf(""), "");
});

test("EVERY BONUS STAR A TITLE OFFERS HAS AN EXPLICIT FAMILY ENTRY", () => {
  // THIS REPLACED AN ASSERTION THAT COULD NOT FAIL. It used to read
  // `bonusFamilyOf(star).length > 0`, which the fallback satisfies for every
  // non-empty string, so it was green on any curation gap at all: a title
  // could ship a star nothing mapped and this test would pass while that
  // star split its own lifetime tally off the family it belongs to.
  // hasOwnProperty is the whole point: it asks the MAP, not the function.
  for (const t of MARIO_PARTY_TITLES) {
    for (const star of bonusStarsForTitle(t.id)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(MP_BONUS_FAMILIES, star),
        `${t.id} offers "${star}" and MP_BONUS_FAMILIES has no entry for it, so it would ` +
          `tally under its own name instead of folding onto a family`,
      );
    }
  }
});

// ---------- Mario Party 7, added 2026-08-30 ----------

test("MARIO PARTY 7 RESOLVES: six boards, six bonus stars, twelve characters", () => {
  // Pinned against Super Mario Wiki and StrategyWiki rather than memory.
  assert.deepEqual(boardsForTitle("mp7"), [
    "Grand Canal", "Pagoda Peak", "Pyramid Park", "Neon Heights", "Windmillville",
    "Bowser's Enchanted Inferno",
  ]);
  assert.deepEqual(bonusStarsForTitle("mp7"), [
    "Minigame Star", "Action Star", "Orb Star", "Shopping Star", "Red Star", "Running Star",
  ]);
  const mp7 = MARIO_PARTY_TITLES.find((t) => t.id === "mp7")!;
  assert.equal(mp7.roster.length, 12);
  // The two absences are the interesting half of this roster, and both are
  // easy to add back by reflex from another title in the list.
  assert.equal(mp7.roster.includes("Donkey Kong"), false);
  assert.equal(mp7.roster.includes("Koopa Kid"), false);
  assert.ok(mp7.roster.includes("Dry Bones"));
  assert.ok(mp7.roster.includes("Birdo"));
});

test("MP7 SITS BETWEEN Super Mario Party AND MP6, because the list is newest first", () => {
  // The order is what the title selector renders, so it is a real behaviour
  // rather than tidiness. MP7 is 2005 against MP6's 2004.
  const ids = MARIO_PARTY_TITLES.map((t) => t.id);
  assert.equal(ids.indexOf("mp7"), ids.indexOf("smp") + 1);
  assert.equal(ids.indexOf("mp6"), ids.indexOf("mp7") + 1);
});

test("MP7'S THREE NEW STARS FOLD ONTO THE FAMILIES THEY BELONG TO", () => {
  // The actual risk in adding a title: an unmapped name still "works", it just
  // splits the lifetime bonus leaders in half with nothing erroring. Asserted
  // as equality with the star each one shares an achievement with, rather than
  // against a family string, so the pairing is what is pinned.
  assert.equal(bonusFamilyOf("Running Star"), bonusFamilyOf("Sightseer Star"));
  assert.equal(bonusFamilyOf("Action Star"), bonusFamilyOf("Eventful Star"));
  assert.equal(bonusFamilyOf("Red Star"), bonusFamilyOf("Unlucky Star"));
  // And none of the three is its own fallback, which is what "unmapped" looks
  // like from the outside.
  for (const s of ["Running Star", "Action Star", "Red Star"]) {
    assert.notEqual(bonusFamilyOf(s), s, `${s} is falling back to its own name`);
  }
});

test("MP6 OFFERS TOAD AND NOT DONKEY KONG", () => {
  // The shipped roster had this exactly backwards, with a comment asserting the
  // opposite of the truth. Safe to correct because `character` is a display
  // string on match_participants rather than a ledger-permanent identifier, and
  // the roster is only validated on WRITE.
  const mp6 = MARIO_PARTY_TITLES.find((t) => t.id === "mp6")!;
  assert.ok(mp6.roster.includes("Toad"));
  assert.equal(mp6.roster.includes("Donkey Kong"), false);
  assert.equal(mp6.roster.length, 11);
  // Donkey Kong is still playable elsewhere, so no lifetime character history
  // is orphaned by taking him out of this one.
  const withDk = MARIO_PARTY_TITLES.filter((t) => t.roster.includes("Donkey Kong"));
  assert.ok(withDk.length >= 3, "Donkey Kong should survive in other titles' rosters");
});

test("MP6 OFFERS THE HAPPENING STAR, AND \"Event Star\" STILL RESOLVES ANYWAY", () => {
  // The whole reason the rename is safe. Bonus star names are written VERBATIM
  // into match_participants.meta, so an MP6 board recorded before 2026-08-30
  // still says "Event Star" in the ledger. No title offers it any more and it
  // must still fold onto Happening, or those rows silently start a family of
  // their own. Asserted directly so a tidy-up that deletes the entry goes red.
  assert.deepEqual(bonusStarsForTitle("mp6"), ["Minigame Star", "Orb Star", "Happening Star"]);
  const offeredAnywhere = MARIO_PARTY_TITLES.some((t) => t.bonusStars.includes("Event Star"));
  assert.equal(offeredAnywhere, false, "no title should still offer Event Star");
  assert.equal(bonusFamilyOf("Event Star"), "Happening");
  assert.equal(bonusFamilyOf("Event Star"), bonusFamilyOf("Happening Star"));
});

test("an unknown title falls back to the default title's boards and stars", () => {
  const first = MARIO_PARTY_TITLES[0]!;
  assert.deepEqual(boardsForTitle(null), first.boards);
  assert.deepEqual(boardsForTitle("not-a-title"), first.boards);
  assert.deepEqual(bonusStarsForTitle(null), first.bonusStars);
});

test("THE CUSTOM-BOARD SENTINEL IS NOT ALSO A REAL BOARD NAME", () => {
  // MP_CUSTOM_BOARD is not in any title's `boards`: the client appends it as an
  // extra option and swaps the select for a text box when it is chosen
  // (MarioPartyPage.tsx:423). What would break that is a title shipping a real
  // board called "Custom board", which would silently turn a legitimate pick
  // into the free-text path.
  for (const t of MARIO_PARTY_TITLES) {
    assert.equal(
      boardsForTitle(t.id).includes(MP_CUSTOM_BOARD),
      false,
      `${t.id} lists "${MP_CUSTOM_BOARD}" as a real board, which collides with the sentinel`,
    );
  }
});

// ---------- TAG BATTLE: ranking by side (2026-08-30) ----------
//
// Mario Party 7's Tag Battle shares Orbs, Stars and coins, so a tag board has
// ONE star total per SIDE. The pack's model is a star count per PLAYER, so the
// shared value is written to every member and the read layer splits solo from
// tag off `side`. These pin both halves of that.
//
// The fixtures the all-singletons regression compares against were captured by
// running the UNMODIFIED engine before rankMpSides was written, not typed out
// by hand. Hand-written fixtures have been wrong three times in this repo.

const side = (id: string, memberIds: string[]): Side => ({
  id,
  name: `Side ${id.toUpperCase()}`,
  memberIds,
});
const sEntry = (sideId: string, stars: number, bonusStars: string[] = []): MpSideEntry => ({
  sideId,
  stars,
  bonusStars,
});

test("A 2v2 IS 1,1,2,2 AND NEVER 1,1,3,3", () => {
  // Placement rule 2 in teams.ts, and the comment block there explains why it
  // is not the tie rule: competition ranking would say the losing pair came
  // THIRD in a field of four, and there was no third place. There were two
  // sides, and they came first and second.
  const sides = [side("a", ["p1", "p2"]), side("b", ["p3", "p4"])];
  const out = rankMpSides(sides, [sEntry("a", 12), sEntry("b", 7)], null);
  assert.equal(out.error, null);
  assert.deepEqual(
    out.lines.map((l) => [l.playerId, l.placement, l.isWinner]),
    [
      ["p1", 1, true],
      ["p2", 1, true],
      ["p3", 2, false],
      ["p4", 2, false],
    ],
  );
});

test("every line in a 2v2 carries a side, and teammates share it", () => {
  const sides = [side("a", ["p1", "p2"]), side("b", ["p3", "p4"])];
  const { lines } = rankMpSides(sides, [sEntry("a", 12), sEntry("b", 7)], null);
  assert.ok(lines.every((l) => l.side !== null && l.side !== undefined));
  const bySide = new Map(lines.map((l) => [l.playerId, l.side]));
  assert.equal(bySide.get("p1"), bySide.get("p2"));
  assert.equal(bySide.get("p3"), bySide.get("p4"));
  assert.notEqual(bySide.get("p1"), bySide.get("p3"));
});

test("BOTH MEMBERS OF A SIDE CARRY THE SAME STAR TOTAL AND THE SAME BONUS STARS", () => {
  // The locked decision, asserted rather than described: the shared value goes
  // on EVERY member. Not on one row, which is arbitrary and breaks every
  // per-player read, and not halved, which invents a number an odd total cannot
  // produce. 11 is deliberately odd for exactly that reason.
  const sides = [side("a", ["p1", "p2"]), side("b", ["p3", "p4"])];
  const { lines } = rankMpSides(
    sides,
    [sEntry("a", 11, ["Minigame Star", "Orb Star"]), sEntry("b", 4, ["Red Star"])],
    null,
  );
  const of = (id: string) => lines.find((l) => l.playerId === id)!;
  assert.equal(of("p1").stars, 11);
  assert.equal(of("p2").stars, 11);
  assert.deepEqual(of("p1").bonusStars, ["Minigame Star", "Orb Star"]);
  assert.deepEqual(of("p2").bonusStars, ["Minigame Star", "Orb Star"]);
  assert.deepEqual(of("p3").bonusStars, ["Red Star"]);
  // Separate arrays, so a screen mutating one member's list cannot reach into
  // their partner's row.
  assert.notEqual(of("p1").bonusStars, of("p2").bonusStars);
});

test("AN ALL-SINGLETONS FIELD IS BYTE-IDENTICAL TO rankMpLines", () => {
  // THE REGRESSION THAT MATTERS MOST. The ordinary four-player Battle Royale
  // board must be untouched by any of this: same order, same placements, same
  // null side. Compared against the other function's live output rather than
  // against a transcription of it, so the two cannot drift apart quietly.
  const cases: [number[], string | null][] = [
    [[9, 5, 3, 1], null],
    [[9, 5, 5, 1], null],
    [[6, 6, 2], "a"],
    [[7, 4], null],
    [[0, 0], "a"],
  ];
  for (const [stars, winner] of cases) {
    const ids = stars.map((_, i) => `p${i}`);
    const sides = singletonSides(ids);
    const perPlayer = rankMpLines(
      stars.map((n, i) => entry(ids[i]!, n)),
      winner ? sides[["a", "b", "c", "d"].indexOf(winner)]!.memberIds[0] : null,
    );
    const perSide = rankMpSides(
      sides,
      stars.map((n, i) => sEntry(sides[i]!.id, n)),
      winner,
    );
    assert.equal(perSide.error, perPlayer.error, `error differs on ${stars.join(",")}`);
    assert.deepEqual(perSide.lines, perPlayer.lines, `lines differ on ${stars.join(",")}`);
    assert.ok(perSide.lines.every((l) => l.side === null));
  }
});

test("A 1v1 IS side: null ON BOTH, not \"a\" and \"b\"", () => {
  // sideIdFor's rule, and the reason it lives in teams.ts once. A pack writing
  // "a"/"b" for a 1v1 would make meetingOutcome classify two OPPONENTS as
  // having played together, and the rivalry would be wrong forever with
  // nothing erroring.
  const sides = [side("a", ["p1"]), side("b", ["p2"])];
  const { lines, error } = rankMpSides(sides, [sEntry("a", 8), sEntry("b", 3)], null);
  assert.equal(error, null);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.side === null));
});

test("a 2v1 is allowed, because uneven sides are a fact rather than an error", () => {
  // validateSides returns `even` for the screen to warn with; a 2v1 is a real
  // thing a crew does and the app records what the night did.
  const sides = [side("a", ["p1", "p2"]), side("b", ["p3"])];
  const out = rankMpSides(sides, [sEntry("a", 5), sEntry("b", 9)], null);
  assert.equal(out.error, null);
  assert.equal(out.lines.find((l) => l.playerId === "p3")!.placement, 1);
  assert.equal(out.lines.find((l) => l.playerId === "p1")!.placement, 2);
});

// ---------- tag battle refusals ----------

test("fewer than two sides, or a side with nobody on it, is refused", () => {
  assert.equal(rankMpSides([side("a", ["p1", "p2"])], [sEntry("a", 5)], null).error, "Need at least 2 sides");
  const empty = [side("a", ["p1", "p2"]), side("b", [])];
  assert.equal(
    rankMpSides(empty, [sEntry("a", 5), sEntry("b", 2)], null).error,
    "Every side needs at least one player",
  );
});

test("a missing or negative side total is refused rather than read as zero", () => {
  const sides = [side("a", ["p1", "p2"]), side("b", ["p3", "p4"])];
  assert.ok(rankMpSides(sides, [sEntry("a", NaN), sEntry("b", 3)], null).error);
  assert.ok(rankMpSides(sides, [sEntry("a", -1), sEntry("b", 3)], null).error);
  assert.ok(rankMpSides(sides, [sEntry("a", Infinity), sEntry("b", 3)], null).error);
  // And a side with no entry at all, which is the blank-box case one level up.
  assert.equal(
    rankMpSides(sides, [sEntry("a", 5)], null).error,
    "Enter a star count for every side",
  );
});

test("ONE BONUS STAR CANNOT SIT ON TWO SIDES", () => {
  // The per-player rule raised one level. Within a side it IS shared, which is
  // what Tag Battle means, so only the cross-side case is a mistake.
  const sides = [side("a", ["p1", "p2"]), side("b", ["p3", "p4"])];
  const out = rankMpSides(
    sides,
    [sEntry("a", 9, ["Minigame Star"]), sEntry("b", 4, ["Minigame Star"])],
    null,
  );
  assert.equal(out.lines.length, 0);
  assert.match(out.error!, /Only one side can get the Minigame Star/);
});

test("A TIE AT THE TOP IS REFUSED UNTIL THE HOST TAPS A SIDE", () => {
  const sides = [side("a", ["p1", "p2"]), side("b", ["p3", "p4"])];
  const tied = [sEntry("a", 6), sEntry("b", 6)];
  assert.equal(rankMpSides(sides, tied, null).error, "Two sides are tied on stars. Tap who won.");
  const resolved = rankMpSides(sides, tied, "b");
  assert.equal(resolved.error, null);
  assert.equal(resolved.lines[0]!.playerId, "p3");
  assert.equal(resolved.lines[0]!.isWinner, true);
});

test("the host cannot hand the win to a side that is not on the most stars", () => {
  const sides = [side("a", ["p1", "p2"]), side("b", ["p3", "p4"])];
  const out = rankMpSides(sides, [sEntry("a", 9), sEntry("b", 4)], "b");
  assert.equal(out.lines.length, 0);
  assert.equal(out.error, "The winning side must have the most stars");
});

test("characters stay PER PLAYER in Tag Battle", () => {
  // Each player still picks their own; only the stars are shared.
  const sides = [side("a", ["p1", "p2"]), side("b", ["p3", "p4"])];
  const { lines } = rankMpSides(sides, [sEntry("a", 9), sEntry("b", 4)], null, {
    p1: "Dry Bones",
    p2: "Birdo",
  });
  const of = (id: string) => lines.find((l) => l.playerId === id)!;
  assert.equal(of("p1").character, "Dry Bones");
  assert.equal(of("p2").character, "Birdo");
  assert.equal(of("p3").character, null);
});

// ---------- the night summary, and the double count it must not do ----------

const player = (id: string, name: string): SmashPlayer =>
  ({ id, name, userId: null, isGuest: true }) as unknown as SmashPlayer;

test("summarizeMpNight REPORTS SOLO AND TAG STARS APART AND DOES NOT DOUBLE COUNT", () => {
  // A mixed night: one ordinary board, then one tag board. Summing l.stars over
  // both would credit the pair twice for the side's single total and put them
  // ahead of a solo player two to one.
  const roster = [player("p1", "Ann"), player("p2", "Bo"), player("p3", "Cy"), player("p4", "Di")];
  const state = newMpState({ titleId: "mp7", assignment: "self", roster });
  const solo = rankMpLines(
    [entry("p1", 10), entry("p2", 6), entry("p3", 4), entry("p4", 2)],
    null,
  );
  const sides = [side("a", ["p1", "p2"]), side("b", ["p3", "p4"])];
  const tag = rankMpSides(sides, [sEntry("a", 11), sEntry("b", 5)], null);
  state.games = [
    { idx: 0, map: "Grand Canal", lines: solo.lines, at: "2026-08-30T20:00:00.000Z" },
    { idx: 1, map: "Pagoda Peak", lines: tag.lines, at: "2026-08-30T21:00:00.000Z" },
  ];

  const { players } = summarizeMpNight(state);
  const of = (id: string) => players.find((p) => p.playerId === id)!;

  // Ann: 10 solo stars, and 11 tag stars that are the SIDE's, kept apart.
  assert.equal(of("p1").totalStars, 10);
  assert.equal(of("p1").tagStars, 11);
  assert.equal(of("p2").totalStars, 6);
  assert.equal(of("p2").tagStars, 11);
  // The side's total appears once per member and is never added into the solo
  // column, which is the actual double count this split exists to prevent.
  assert.equal(of("p1").totalStars + of("p2").totalStars, 16);

  // Games and wins are NOT split: a player played the board either way, and
  // both members of a winning side genuinely won it.
  for (const id of ["p1", "p2", "p3", "p4"]) {
    assert.equal(of(id).games, 2, `${id} played two boards`);
    assert.equal(of(id).tagGames, 1, `${id} played one of them in a tag`);
  }
  assert.equal(of("p1").wins, 2);
  assert.equal(of("p2").wins, 1);
  assert.equal(of("p3").wins, 0);
});

test("a night with no tag boards reports zero tag stars and games", () => {
  // The ordinary night, unchanged: the tag columns exist and stay empty.
  const roster = [player("p1", "Ann"), player("p2", "Bo")];
  const state = newMpState({ titleId: "mp6", assignment: "self", roster });
  const { lines } = rankMpLines([entry("p1", 7), entry("p2", 3)], null);
  state.games = [{ idx: 0, map: "Faire Square", lines, at: "2026-08-30T20:00:00.000Z" }];
  const { players } = summarizeMpNight(state);
  assert.equal(players[0]!.totalStars, 7);
  assert.equal(players[0]!.tagStars, 0);
  assert.equal(players[0]!.tagGames, 0);
});

test("A LINE RECORDED BEFORE TAG BATTLE, WITH NO side KEY AT ALL, COUNTS AS SOLO", () => {
  // Boards already in jsonb have no `side` on their lines. The coalesce in the
  // summary is load-bearing rather than defensive: without it those stars fall
  // into neither column and a finished night reads as zero.
  const roster = [player("p1", "Ann"), player("p2", "Bo")];
  const state = newMpState({ titleId: "mp2", assignment: "self", roster });
  const legacy = [
    { playerId: "p1", character: null, stars: 8, bonusStars: [], placement: 1, isWinner: true },
    { playerId: "p2", character: null, stars: 2, bonusStars: [], placement: 2, isWinner: false },
  ];
  state.games = [{ idx: 0, map: "Pirate Land", lines: legacy, at: "2026-08-30T20:00:00.000Z" }];
  const { players } = summarizeMpNight(state);
  assert.equal(players.find((p) => p.playerId === "p1")!.totalStars, 8);
  assert.equal(players.find((p) => p.playerId === "p1")!.tagStars, 0);
});

// ---------- the side log ----------

test("a new session opens with singleton sides, which is NO team structure", () => {
  const roster = [player("p1", "Ann"), player("p2", "Bo"), player("p3", "Cy")];
  const state = newMpState({ titleId: "mp7", assignment: "self", roster });
  assert.equal(state.sideLog.length, 1);
  assert.equal(state.sideLog[0]!.fromIdx, 0);
  assert.equal(hasTeamStructure(state.sideLog), false);
  assert.deepEqual(currentSides(state.sideLog).map((s) => s.memberIds), [["p1"], ["p2"], ["p3"]]);
});

test("normalizeMpState BACKFILLS A SESSION WRITTEN BEFORE THE LOG EXISTED", () => {
  // Read out of jsonb with no sideLog key at all. The upgrade is exact: every
  // board this pack ever recorded was played by individuals.
  const roster = [player("p1", "Ann"), player("p2", "Bo")];
  const legacy = { ...newMpState({ assignment: "self", roster }) } as Record<string, unknown>;
  delete legacy.sideLog;
  const out = normalizeMpState(legacy as unknown as MpSessionState);
  assert.equal(out.sideLog.length, 1);
  assert.equal(hasTeamStructure(out.sideLog), false);
  // And it is a no-op on a session that already has one, rather than resetting
  // a live night's pairs on every read.
  const teamed = newMpState({ assignment: "self", roster, sides: [side("a", ["p1", "p2"])] });
  assert.equal(normalizeMpState(teamed), teamed);
});

test("UNDO ACROSS A RESHUFFLE PUTS THE OLD PAIRS BACK", () => {
  // The reason the arrangement is a LOG. Two boards under one pairing, a
  // reshuffle, a third board, then an undo back past the boundary: the
  // arrangement in force must be the ORIGINAL one again, not the new one.
  const roster = [player("p1", "Ann"), player("p2", "Bo"), player("p3", "Cy"), player("p4", "Di")];
  const state = newMpState({
    titleId: "mp7",
    assignment: "self",
    roster,
    sides: [side("a", ["p1", "p2"]), side("b", ["p3", "p4"])],
  });
  const board = (idx: number): MpGame => ({ idx, map: "Neon Heights", lines: [], at: "" });
  state.games = [board(0), board(1)];

  assert.equal(reshuffle(state.sideLog, [side("a", ["p1", "p3"]), side("b", ["p2", "p4"])], 2), null);
  state.games.push(board(2));
  assert.deepEqual(currentSides(state.sideLog).map((s) => s.memberIds), [["p1", "p3"], ["p2", "p4"]]);
  // The boards played before the boundary still read under the OLD pairing,
  // which is the whole point: a reshuffle is not retroactive.
  assert.deepEqual(sidesAtIdx(state.sideLog, 1).map((s) => s.memberIds), [["p1", "p2"], ["p3", "p4"]]);

  // UNDOING THE BOARD PLAYED UNDER THE NEW PAIRS DOES NOT UNDO THE RESHUFFLE,
  // and that boundary is exact rather than approximate. With two boards left,
  // an entry in force from board index 2 is still the arrangement the NEXT
  // board will be played under, so it stays.
  state.games.pop();
  assert.equal(truncateSideLog(state.sideLog, state.games.length), false);
  assert.deepEqual(currentSides(state.sideLog).map((s) => s.memberIds), [["p1", "p3"], ["p2", "p4"]]);

  // Undoing back PAST the boundary is what restores the old pairs, which is
  // the whole reason the arrangement is a log rather than a field.
  state.games.pop();
  assert.equal(truncateSideLog(state.sideLog, state.games.length), true);
  assert.deepEqual(currentSides(state.sideLog).map((s) => s.memberIds), [["p1", "p2"], ["p3", "p4"]]);
});

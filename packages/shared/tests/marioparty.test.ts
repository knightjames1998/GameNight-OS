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
  type MpRawEntry,
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

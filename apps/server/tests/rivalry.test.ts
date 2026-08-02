// Tests for the head-to-head rules (meetingOutcome / meetingStreaks in src/stats.ts).
//
// These decide what one shared match MEANS between two people, and a wrong
// answer is never an error: it is a rivalry record that is quietly wrong
// forever, on a page somebody screenshots. Pure once the two rows are in hand,
// so there is no database and no Drizzle stub anywhere near this file, the
// same split tv-resolve.test.ts uses.
//
// THE BUG THAT MADE THE FOURTH OUTCOME NECESSARY: Casino Run is co-op, so it
// writes an IDENTICAL participant row for everyone on the run. Two people who
// cleared a run together had the same placement and the same isWinner, so the
// three-way classification called it a TIE, and a crew that played five co-op
// nights read as five draws between every pair of them. `side` is the fix and
// it is a property of the MATCH, not of the pack, because the same two people
// are teammates in one game and opponents in the next.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  meetingOutcome,
  meetingStreaks,
  type MeetingOutcome,
  type MeetingSide,
} from "../src/stats.js";

/** A row with no team structure: what every pack except Casino Run writes. */
const solo = (p: number | null, w = false): MeetingSide => ({ p, w, side: null });
/** A row on a named side. */
const on = (side: string, p: number | null, w = false): MeetingSide => ({ p, w, side });

// ---------- the four outcomes ----------

test("a better placement is a win, a worse one is a loss", () => {
  assert.equal(meetingOutcome(solo(1, true), solo(2)), "win");
  assert.equal(meetingOutcome(solo(2), solo(1, true)), "loss");
  assert.equal(meetingOutcome(solo(3), solo(7)), "win");
});

test("equal placements with neither winning is a tie", () => {
  assert.equal(meetingOutcome(solo(1), solo(1)), "tie");
  assert.equal(meetingOutcome(solo(1, true), solo(1, true)), "tie");
  assert.equal(meetingOutcome(solo(null), solo(null)), "tie");
});

test("isWinner breaks an equal-placement pair", () => {
  // The rare case: a pack that ranks nobody but still names a winner.
  assert.equal(meetingOutcome(solo(null, true), solo(null, false)), "win");
  assert.equal(meetingOutcome(solo(null, false), solo(null, true)), "loss");
  assert.equal(meetingOutcome(solo(4, true), solo(4, false)), "win");
});

test("a null placement loses to any real one", () => {
  assert.equal(meetingOutcome(solo(2), solo(null)), "win");
  assert.equal(meetingOutcome(solo(null), solo(2)), "loss");
});

test("TWO MATCHING SIDES IS TOGETHER, and it beats every placement rule", () => {
  // The whole point. A cleared Casino Run writes placement 1 + isWinner for
  // BOTH of these rows, which used to classify as a tie.
  assert.equal(meetingOutcome(on("crew", 1, true), on("crew", 1, true)), "together");
  // And a busted run writes an equal LAST for both, which also used to tie.
  assert.equal(meetingOutcome(on("crew", 4), on("crew", 4)), "together");
  // Even rows that would otherwise be a clean win are still teammates: the
  // side is checked FIRST, so a pack that ranks within a team cannot leak a
  // head-to-head result out of a game the two people were on the same side of.
  assert.equal(meetingOutcome(on("crew", 1, true), on("crew", 3)), "together");
});

test("DIFFERENT non-null sides are opponents, classified normally", () => {
  // What doubles will write: two values per match. Nothing here is built for
  // it yet, but the primitive has to mean this or it means nothing.
  assert.equal(meetingOutcome(on("a", 1, true), on("b", 2)), "win");
  assert.equal(meetingOutcome(on("a", 2), on("b", 1, true)), "loss");
  assert.equal(meetingOutcome(on("a", 1), on("b", 1)), "tie");
});

test("a null side is never a teammate, not even of another null", () => {
  // Null means "no team structure", which is every row written before the
  // column existed and every free-for-all result forever. Two nulls are
  // RIVALS, and treating them as teammates would silently rewrite the entire
  // history of the app.
  assert.equal(meetingOutcome(solo(1, true), solo(2)), "win");
  assert.equal(meetingOutcome(solo(1), solo(1)), "tie");
  // One side named and the other not is not a match either, so it falls
  // through to placements. That state should not occur, but it is the shape a
  // half-written pack would produce, and inventing a team out of it would be
  // worse than reading it as an ordinary game.
  assert.equal(meetingOutcome(on("crew", 1, true), solo(2)), "win");
  assert.equal(meetingOutcome(solo(2), on("crew", 1, true)), "loss");
});

test("A NULL-SIDE MATCH CLASSIFIES EXACTLY AS IT DID BEFORE `side` EXISTED", () => {
  // The regression guard for the whole change. Every case below is a row pair
  // that could already be in the database, and the answer has to be the one
  // the three-way rule always gave.
  const before = (mine: MeetingSide, theirs: MeetingSide): MeetingOutcome => {
    const mp = mine.p ?? Infinity;
    const tp = theirs.p ?? Infinity;
    if (mp < tp || (mp === tp && mine.w && !theirs.w)) return "win";
    if (tp < mp || (mp === tp && theirs.w && !mine.w)) return "loss";
    return "tie";
  };
  const places: (number | null)[] = [null, 1, 2, 3, 8];
  for (const mp of places) {
    for (const tp of places) {
      for (const mw of [true, false]) {
        for (const tw of [true, false]) {
          const mine = solo(mp, mw);
          const theirs = solo(tp, tw);
          assert.equal(
            meetingOutcome(mine, theirs),
            before(mine, theirs),
            `null-side pair ${mp}/${mw} vs ${tp}/${tw} changed meaning`,
          );
        }
      }
    }
  }
});

// ---------- the streak ----------

test("a run of wins is a positive streak, a run of losses negative", () => {
  assert.deepEqual(meetingStreaks(["win", "win", "win"]), {
    run: 3,
    myLongest: 3,
    theirLongest: 0,
  });
  assert.deepEqual(meetingStreaks(["loss", "loss"]), {
    run: -2,
    myLongest: 0,
    theirLongest: 2,
  });
});

test("a tie breaks both streaks", () => {
  assert.deepEqual(meetingStreaks(["win", "win", "tie", "win"]), {
    run: 1,
    myLongest: 2,
    theirLongest: 0,
  });
});

test("A TEAMMATE GAME NEITHER EXTENDS NOR BREAKS A STREAK", () => {
  // Both failure modes matter and they pull in opposite directions.
  //
  // Counting it as a win would read a co-op night as an unbeaten run, which is
  // the loudest version of the bug `side` exists to fix: a crew that plays
  // Casino Run every week would have one player "on a 12-game streak" against
  // somebody they have never beaten.
  //
  // Breaking it is wrong for the same reason a teammate game is not a tie:
  // nothing happened between these two that night, so ending a run on it
  // claims something that did not occur.
  assert.deepEqual(meetingStreaks(["win", "win", "win", "together", "win"]), {
    run: 4,
    myLongest: 4,
    theirLongest: 0,
  });
  // A whole night of co-op moves nothing at all.
  assert.deepEqual(meetingStreaks(["together", "together", "together"]), {
    run: 0,
    myLongest: 0,
    theirLongest: 0,
  });
  // And it does not rescue a broken streak either.
  assert.deepEqual(meetingStreaks(["win", "tie", "together", "win"]), {
    run: 1,
    myLongest: 1,
    theirLongest: 0,
  });
});

test("the longest streaks are the high-water marks, not the final run", () => {
  assert.deepEqual(meetingStreaks(["win", "win", "win", "loss", "loss", "win"]), {
    run: 1,
    myLongest: 3,
    theirLongest: 2,
  });
});

test("no meetings at all is a streak of nothing", () => {
  assert.deepEqual(meetingStreaks([]), { run: 0, myLongest: 0, theirLongest: 0 });
});

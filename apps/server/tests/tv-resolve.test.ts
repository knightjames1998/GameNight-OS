// Tests for the event TV resolution rule (resolveNow in src/tv.ts).
//
// This is the rule that decides WHICH pack's TV view a whole night's screen
// shows, and it is the half of the feature that can break silently: a wrong
// answer here is not an error anywhere, it is a TV quietly showing the wrong
// game, or flipping between two of them, with nobody standing next to it.
//
// The rule is pure once the rows are in hand, which is exactly why the row
// reading and the deciding are separate functions. No database and no Drizzle
// stub: stubbing Drizzle would test the stub. The query half is verified
// on-device instead, the same split the pack-runtime tests use.
//
// BRACKETS ARE A LIST, and every case below carries one because of what an
// event can now hold: a night can run a SECOND tournament once the first is
// completed, so two bracket rows on one event is an ordinary state rather than
// an impossible one. The read that feeds this used to be `.limit(1)` with no
// `orderBy`, which was only ever safe because the creation guard made a second
// row impossible. Relaxing that guard without this change would have handed the
// resolver the COMPLETED bracket, had it filtered as completed, and sat the TV
// on the lobby while a live tournament was being scored, with nothing erroring.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveNow, type TvCandidates } from "../src/tv.js";

/** Timestamps as plain offsets, so "newer" is obvious at the call site. */
const t = (ms: number) => new Date(ms);

const NOTHING: TvCandidates = { packs: [], brackets: [], beerio: null };

test("nothing live at all resolves to the lobby", () => {
  assert.equal(resolveNow(NOTHING), null);
  assert.equal(
    resolveNow({ ...NOTHING, beerio: { code: null, completedAt: null, updatedAt: null } }),
    null,
  );
});

test("one live pack session wins", () => {
  assert.deepEqual(
    resolveNow({ ...NOTHING, packs: [{ pack: "smash", status: "live", updatedAt: t(1000) }] }),
    { kind: "pack", pack: "smash", status: "live" },
  );
});

test("a setup session counts as showable, and carries its status through", () => {
  // "setup" is a real thing to put on the screen: the pack's own TV view says
  // it is waiting for the host, which beats a lobby that says nothing started.
  assert.deepEqual(
    resolveNow({ ...NOTHING, packs: [{ pack: "pingpong", status: "setup", updatedAt: t(5) }] }),
    { kind: "pack", pack: "pingpong", status: "setup" },
  );
});

test("two live sessions: the more recently touched wins", () => {
  const c: TvCandidates = {
    ...NOTHING,
    packs: [
      { pack: "mariokart", status: "live", updatedAt: t(2000) },
      { pack: "smash", status: "live", updatedAt: t(3000) },
    ],
  };
  assert.deepEqual(resolveNow(c), { kind: "pack", pack: "smash", status: "live" });
  // Order in the array must not matter; only the timestamp does.
  assert.deepEqual(resolveNow({ ...c, packs: [...c.packs].reverse() }), {
    kind: "pack",
    pack: "smash",
    status: "live",
  });
});

test("a bracket being scored beats a session started later but left alone", () => {
  // The whole reason brackets gained updatedAt: ranking on creation time would
  // hand the screen to the abandoned Ping Pong session.
  assert.deepEqual(
    resolveNow({
      packs: [{ pack: "pingpong", status: "live", updatedAt: t(1000) }],
      brackets: [{ bracketId: "b1", status: "live", updatedAt: t(9000) }],
      beerio: null,
    }),
    { kind: "bracket", bracketId: "b1", status: "live" },
  );
});

test("A COMPLETED BRACKET DOES NOT HIDE THE LIVE ONE BESIDE IT", () => {
  // The second tournament of the night, and the case the whole list change is
  // for. The completed one is newer here on purpose: it finished at 21:30 and
  // the live one has not been scored since 21:10, so anything that ranked
  // before it filtered would pick the wrong row and then show nothing.
  assert.deepEqual(
    resolveNow({
      ...NOTHING,
      brackets: [
        { bracketId: "b1", status: "completed", updatedAt: t(9000) },
        { bracketId: "b2", status: "live", updatedAt: t(8000) },
      ],
    }),
    { kind: "bracket", bracketId: "b2", status: "live" },
  );
  // Array order is not the answer: the query behind this has no ORDER BY.
  assert.deepEqual(
    resolveNow({
      ...NOTHING,
      brackets: [
        { bracketId: "b2", status: "live", updatedAt: t(8000) },
        { bracketId: "b1", status: "completed", updatedAt: t(9000) },
      ],
    }),
    { kind: "bracket", bracketId: "b2", status: "live" },
  );
});

test("two completed brackets and nothing else is the lobby", () => {
  // Both tournaments are over, so the night falls back to the night-so-far
  // board. Not "the most recent bracket", which is what a limit-1 read would
  // have offered: completed is completed however new it is.
  assert.equal(
    resolveNow({
      ...NOTHING,
      brackets: [
        { bracketId: "b1", status: "completed", updatedAt: t(1000) },
        { bracketId: "b2", status: "completed", updatedAt: t(9999) },
      ],
    }),
    null,
  );
});

test("an empty bracket list is not a bracket", () => {
  // The shape a night with no tournament arrives in, stated on its own because
  // it is the one the previous signature spelled as null.
  assert.equal(resolveNow({ ...NOTHING, brackets: [] }), null);
});

test("two brackets sharing a millisecond resolve on bracketId, not on row order", () => {
  // This rule makes two non-completed brackets impossible (see
  // canStartBracket), so this is the impossible-anyway case, and it is worth a
  // test because the failure mode is the worst-looking one this file has: both
  // rows carry the "bracket" tiebreak key, so without a final comparison the
  // TV would flip between two screens on consecutive refetches and read as a
  // broken television.
  const same = t(7000);
  const two = [
    { bracketId: "b9", status: "live" as const, updatedAt: same },
    { bracketId: "b2", status: "live" as const, updatedAt: same },
  ];
  assert.deepEqual(resolveNow({ ...NOTHING, brackets: two }), {
    kind: "bracket",
    bracketId: "b2",
    status: "live",
  });
  assert.deepEqual(resolveNow({ ...NOTHING, brackets: [...two].reverse() }), {
    kind: "bracket",
    bracketId: "b2",
    status: "live",
  });
});

test("a completed session never wins, even when it is the most recent thing", () => {
  assert.deepEqual(
    resolveNow({
      packs: [
        { pack: "smash", status: "completed", updatedAt: t(9999) },
        { pack: "marioparty", status: "live", updatedAt: t(10) },
      ],
      brackets: [],
      beerio: null,
    }),
    { kind: "pack", pack: "marioparty", status: "live" },
  );
});

test("completing the only session falls back to the lobby", () => {
  assert.equal(
    resolveNow({
      packs: [{ pack: "smash", status: "completed", updatedAt: t(9999) }],
      brackets: [{ bracketId: "b1", status: "completed", updatedAt: t(9999) }],
      beerio: null,
    }),
    null,
  );
});

test("beerio with a completion stamp and no newer state does not win", () => {
  assert.equal(
    resolveNow({
      ...NOTHING,
      beerio: { code: "AB12", completedAt: t(5000), updatedAt: t(4000) },
    }),
    null,
  );
  // Exactly equal is still "not newer": the completion write is the last word.
  assert.equal(
    resolveNow({
      ...NOTHING,
      beerio: { code: "AB12", completedAt: t(5000), updatedAt: t(5000) },
    }),
    null,
  );
});

test("beerio whose room state is newer than the completion stamp DOES win", () => {
  // A crew running a second tournament on the same code: the vendored engine
  // writes state, updatedAt moves past the stamp, the room is live again. No
  // time window and no guessing at the opaque state blob.
  assert.deepEqual(
    resolveNow({
      ...NOTHING,
      beerio: { code: "AB12", completedAt: t(5000), updatedAt: t(5001) },
    }),
    { kind: "beerio", code: "AB12" },
  );
});

test("beerio with no completion stamp at all is live", () => {
  assert.deepEqual(
    resolveNow({ ...NOTHING, beerio: { code: "AB12", completedAt: null, updatedAt: t(3) } }),
    { kind: "beerio", code: "AB12" },
  );
});

test("a beerio code with no room row is not a room, and never wins", () => {
  // The code is registered on the event but beerio_sessions has nothing, so
  // there is no board to draw; showing it would put a spinner on the TV.
  assert.equal(
    resolveNow({ ...NOTHING, beerio: { code: "AB12", completedAt: null, updatedAt: null } }),
    null,
  );
});

test("identical timestamps resolve to the declared tiebreak order", () => {
  // Deterministic, and NOT left to row order: an unstable answer here would
  // make the TV flicker between two packs on consecutive refetches, which
  // reads as a broken screen.
  const same = t(7000);
  const all: TvCandidates = {
    packs: [
      { pack: "pingpong", status: "live", updatedAt: same },
      { pack: "marioparty", status: "live", updatedAt: same },
      { pack: "mariokart", status: "live", updatedAt: same },
      { pack: "smash", status: "live", updatedAt: same },
    ],
    brackets: [{ bracketId: "b1", status: "live", updatedAt: same }],
    beerio: { code: "AB12", completedAt: null, updatedAt: same },
  };
  assert.deepEqual(resolveNow(all), { kind: "bracket", bracketId: "b1", status: "live" });

  // Same tie, bracket removed: beerio is next in the declared order.
  assert.deepEqual(resolveNow({ ...all, brackets: [] }), { kind: "beerio", code: "AB12" });

  // Then the packs, in their declared order, whatever order they arrive.
  assert.deepEqual(resolveNow({ ...all, brackets: [], beerio: null }), {
    kind: "pack",
    pack: "smash",
    status: "live",
  });
  assert.deepEqual(
    resolveNow({ ...all, brackets: [], beerio: null, packs: [...all.packs].reverse() }),
    { kind: "pack", pack: "smash", status: "live" },
  );
});

test("a missing timestamp sorts oldest rather than winning by accident", () => {
  assert.deepEqual(
    resolveNow({
      ...NOTHING,
      packs: [
        { pack: "smash", status: "live", updatedAt: null },
        { pack: "pingpong", status: "live", updatedAt: t(1) },
      ],
    }),
    { kind: "pack", pack: "pingpong", status: "live" },
  );
});

// ---------------------------------------------------------------------------
// tvHolder: is something ELSE holding the screen right now?
//
// The question behind the prompt. A write that would take the television off a
// live session asks first, and this is the rule that decides whether to ask. It
// calls resolveNow rather than reimplementing the comparison, so the two
// answers cannot drift, and these tests are here beside resolveNow's own for
// the same reason.
//
// THE THREE CONSEQUENCES ARE ASSERTED RATHER THAN DESCRIBED, because each of
// them is the difference between one dialog a night and a dialog on every tap:
// no incumbent is no prompt, holding the screen yourself is no prompt, and a
// completed session is not an incumbent (which resolveNow's first rule already
// gives, so it is free and stays free only if something checks).

import { tvHolder, type TvSelf } from "../src/tv.js";

const SELF_SMASH: TvSelf = { kind: "pack", pack: "smash" };
const SELF_MK: TvSelf = { kind: "pack", pack: "mariokart" };

test("HOLDER: nothing live at all is nobody to ask about", () => {
  // Taking the screen off the LOBBY is not a steal, so the night's first write
  // is never interrupted.
  assert.equal(tvHolder(NOTHING, SELF_SMASH), null);
  assert.equal(tvHolder({ ...NOTHING, beerio: { code: null, completedAt: null, updatedAt: null } }, SELF_MK), null);
});

test("HOLDER: you are never asked about a screen you already hold", () => {
  // This is what makes the prompt fire on HAND-OVER rather than on every
  // result. A host who confirms once then scores that pack all night sees one
  // dialog, and this assertion is the whole reason that is true.
  const c: TvCandidates = {
    ...NOTHING,
    packs: [{ pack: "smash", status: "live", updatedAt: t(5000) }],
  };
  // resolveNow still says Smash is on the screen...
  assert.deepEqual(resolveNow(c), { kind: "pack", pack: "smash", status: "live" });
  // ...and precisely because that is Smash, Smash is not asked.
  assert.equal(tvHolder(c, SELF_SMASH), null);
});

test("HOLDER: another pack holding the screen is the incumbent", () => {
  const c: TvCandidates = {
    ...NOTHING,
    packs: [
      { pack: "smash", status: "live", updatedAt: t(9000) },
      { pack: "mariokart", status: "live", updatedAt: t(1000) },
    ],
  };
  // Mario Kart is the abandoned one; writing to it would take the screen off
  // Smash, which is the reported bug exactly.
  assert.deepEqual(tvHolder(c, SELF_MK), { kind: "pack", pack: "smash", status: "live" });
  // And the other way round there is nothing to ask: Smash already holds it.
  assert.equal(tvHolder(c, SELF_SMASH), null);
});

test("HOLDER: a bracket holds the screen against a pack write", () => {
  // The reported reproduction: a tournament being scored, a Mario Kart session
  // abandoned earlier in the evening, and a stray write from a phone on the
  // sofa. The stray write raises a dialog nobody answers.
  const c: TvCandidates = {
    packs: [{ pack: "mariokart", status: "live", updatedAt: t(1000) }],
    brackets: [{ bracketId: "b1", status: "live", updatedAt: t(9000) }],
    beerio: null,
  };
  assert.deepEqual(tvHolder(c, SELF_MK), { kind: "bracket", bracketId: "b1", status: "live" });
});

test("HOLDER: a pack holds the screen against a bracket write", () => {
  const c: TvCandidates = {
    packs: [{ pack: "pingpong", status: "live", updatedAt: t(9000) }],
    brackets: [{ bracketId: "b1", status: "live", updatedAt: t(1000) }],
    beerio: null,
  };
  assert.deepEqual(tvHolder(c, { kind: "bracket", bracketId: "b1" }), {
    kind: "pack",
    pack: "pingpong",
    status: "live",
  });
});

test("HOLDER: one bracket is an incumbent to the OTHER bracket", () => {
  // A night can run two tournaments, so "bracket" is not one thing. Writing to
  // the older one would take the screen off the one being scored.
  const c: TvCandidates = {
    packs: [],
    brackets: [
      { bracketId: "b1", status: "live", updatedAt: t(1000) },
      { bracketId: "b2", status: "live", updatedAt: t(9000) },
    ],
    beerio: null,
  };
  assert.deepEqual(tvHolder(c, { kind: "bracket", bracketId: "b1" }), {
    kind: "bracket",
    bracketId: "b2",
    status: "live",
  });
  assert.equal(tvHolder(c, { kind: "bracket", bracketId: "b2" }), null);
});

test("HOLDER: a live BEERIO room is an incumbent, though it never asks itself", () => {
  // Beerio is out of scope as a writer (no discrete write to gate; see BACKLOG)
  // and perfectly able to be the holder. TvSelf has no beerio variant, so this
  // asymmetry is in the type rather than in a comment.
  const c: TvCandidates = {
    ...NOTHING,
    packs: [{ pack: "smash", status: "live", updatedAt: t(1000) }],
    beerio: { code: "ABCD", completedAt: null, updatedAt: t(9000) },
  };
  assert.deepEqual(tvHolder(c, SELF_SMASH), { kind: "beerio", code: "ABCD" });
});

test("HOLDER: every other candidate completed means there is no incumbent", () => {
  // Free, and it stays free only because something checks: resolveNow's first
  // rule drops a completed session, so ending the night between games needs no
  // prompt and no code here.
  const c: TvCandidates = {
    packs: [
      { pack: "smash", status: "completed", updatedAt: t(9000) },
      { pack: "mariokart", status: "live", updatedAt: t(1000) },
    ],
    brackets: [{ bracketId: "b1", status: "completed", updatedAt: t(9500) }],
    beerio: null,
  };
  assert.equal(tvHolder(c, SELF_MK), null);
});

test("HOLDER: the millisecond tie over-prompts, and that is the accepted cost", () => {
  // The check runs BEFORE the write, so self's updatedAt here is still its old
  // value. On an exact tie TIEBREAK decides, and "bracket" outranks every pack,
  // so the bracket reads as the incumbent and the host is asked. The write is
  // about to stamp a fresh timestamp that would very likely have taken the
  // screen anyway; modelling this case would mean predicting the write's own
  // clock inside a pure function. Asserted so the behaviour is a decision on
  // the record rather than a surprise.
  const c: TvCandidates = {
    packs: [{ pack: "smash", status: "live", updatedAt: t(4242) }],
    brackets: [{ bracketId: "b1", status: "live", updatedAt: t(4242) }],
    beerio: null,
  };
  assert.deepEqual(tvHolder(c, SELF_SMASH), { kind: "bracket", bracketId: "b1", status: "live" });
});

test("HOLDER: a setup session is a real incumbent, exactly as resolveNow says", () => {
  // "setup" is showable (the pack's own TV view says it is waiting for the
  // host), so it can be stolen from and the prompt has to cover it.
  const c: TvCandidates = {
    ...NOTHING,
    packs: [
      { pack: "pingpong", status: "setup", updatedAt: t(9000) },
      { pack: "smash", status: "live", updatedAt: t(10) },
    ],
  };
  assert.deepEqual(tvHolder(c, SELF_SMASH), { kind: "pack", pack: "pingpong", status: "setup" });
});

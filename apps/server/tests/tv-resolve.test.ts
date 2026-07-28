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

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveNow, type TvCandidates } from "../src/tv.js";

/** Timestamps as plain offsets, so "newer" is obvious at the call site. */
const t = (ms: number) => new Date(ms);

const NOTHING: TvCandidates = { packs: [], bracket: null, beerio: null };

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
      bracket: { bracketId: "b1", status: "live", updatedAt: t(9000) },
      beerio: null,
    }),
    { kind: "bracket", bracketId: "b1", status: "live" },
  );
});

test("a completed session never wins, even when it is the most recent thing", () => {
  assert.deepEqual(
    resolveNow({
      packs: [
        { pack: "smash", status: "completed", updatedAt: t(9999) },
        { pack: "marioparty", status: "live", updatedAt: t(10) },
      ],
      bracket: null,
      beerio: null,
    }),
    { kind: "pack", pack: "marioparty", status: "live" },
  );
});

test("completing the only session falls back to the lobby", () => {
  assert.equal(
    resolveNow({
      packs: [{ pack: "smash", status: "completed", updatedAt: t(9999) }],
      bracket: { bracketId: "b1", status: "completed", updatedAt: t(9999) },
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
    bracket: { bracketId: "b1", status: "live", updatedAt: same },
    beerio: { code: "AB12", completedAt: null, updatedAt: same },
  };
  assert.deepEqual(resolveNow(all), { kind: "bracket", bracketId: "b1", status: "live" });

  // Same tie, bracket removed: beerio is next in the declared order.
  assert.deepEqual(resolveNow({ ...all, bracket: null }), { kind: "beerio", code: "AB12" });

  // Then the four packs, in their declared order, whatever order they arrive.
  assert.deepEqual(resolveNow({ ...all, bracket: null, beerio: null }), {
    kind: "pack",
    pack: "smash",
    status: "live",
  });
  assert.deepEqual(
    resolveNow({ ...all, bracket: null, beerio: null, packs: [...all.packs].reverse() }),
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

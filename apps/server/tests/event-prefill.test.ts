// THE PREFILL CHAIN, and the adapter table it reads its top rung through.
//
// THE CHAIN: last session's roster on this event, then who SHOWED, then who said
// YES. Each rung is used only when the one above it yields nobody. Until now
// every setup screen in the app opened on the yes list alone, which is the
// weakest of the three and the only one anybody was using: an RSVP is an
// intention from Tuesday, attendance is what happened, and the roster from the
// game that just finished is what the host built by hand twenty minutes ago.
//
// THE PART THAT IS EASY TO GET WRONG is not the order, it is the CREW FILTER.
// Somebody who has left the crew can be sitting in ALL THREE rungs (a session
// roster from a night they played, an attendance row, an RSVP nobody deleted),
// and a prefill that brings them back puts a person who is gone into a game and
// then into the ledger. Guests are not memberships and are kept.
//
// The chain is pure over four lists, so it is tested as one. The reading half
// (which session ran last, through resolveNow) is verified on-device, the same
// split pack-runtime and tv-resolve use.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SESSION_PACKS, SESSION_PACK_KEYS, BEERIO_LEDGER, GENERIC_LEDGER } from "@gamenight/shared";
import { prefillChain, recentGuestNames, type ChainInput } from "../src/event-prefill.js";
import { ROSTER_ADAPTERS, rosterOfBracket, rosterOfPingPong } from "../src/roster-adapters.js";
import type { RosterSlot } from "../src/pack-runtime.js";

const CREW = new Map([
  ["u1", "Ann"],
  ["u2", "Ben"],
  ["u3", "Cal"],
]);

const member = (id: string, name: string): RosterSlot => ({
  id: `s-${id}`,
  kind: "member",
  userId: id,
  name,
});
const guest = (name: string): RosterSlot => ({ id: `g-${name}`, kind: "guest", userId: null, name });

const input = (over: Partial<ChainInput> = {}): ChainInput => ({
  lastSession: null,
  showed: [],
  yes: [],
  crew: CREW,
  ...over,
});

// ---------- the three rungs, in order ----------

test("rung 1: the last session's roster wins, and says which pack it came from", () => {
  const r = prefillChain(
    input({
      lastSession: { slots: [member("u2", "Ben"), guest("Mike")], label: "Ping Pong" },
      showed: [{ userId: "u1", name: "Ann" }],
      yes: [{ userId: "u1", name: "Ann" }, { userId: "u3", name: "Cal" }],
    }),
  );
  assert.equal(r.source, "session");
  assert.equal(r.sourceLabel, "Ping Pong");
  assert.deepEqual(r.slots, [
    { userId: "u2", name: "Ben" },
    { userId: null, name: "Mike" },
  ]);
});

test("rung 2: with no session, who SHOWED beats who said yes", () => {
  const r = prefillChain(
    input({
      showed: [{ userId: "u3", name: "Cal" }],
      yes: [{ userId: "u1", name: "Ann" }, { userId: "u2", name: "Ben" }],
    }),
  );
  assert.equal(r.source, "attendance");
  assert.equal(r.sourceLabel, "");
  assert.deepEqual(r.slots, [{ userId: "u3", name: "Cal" }]);
});

test("rung 3: the yes list, which is where every screen used to start", () => {
  const r = prefillChain(input({ yes: [{ userId: "u1", name: "Ann" }] }));
  assert.equal(r.source, "rsvp");
  assert.deepEqual(r.slots, [{ userId: "u1", name: "Ann" }]);
});

test("a brand-new night with nothing on it at all is an empty yes list", () => {
  // Not an error and not a special case: a host on a night with no RSVPs builds
  // the roster from the crew, exactly as they do today.
  const r = prefillChain(input());
  assert.equal(r.source, "rsvp");
  assert.deepEqual(r.slots, []);
});

// ---------- falling through ----------

test("an EMPTY session roster falls through rather than winning with nobody", () => {
  const r = prefillChain(
    input({
      lastSession: { slots: [], label: "Beerio Kart" },
      showed: [{ userId: "u1", name: "Ann" }],
    }),
  );
  assert.equal(r.source, "attendance");
});

test("a session roster of people who have ALL left falls through to attendance", () => {
  // The filter runs BEFORE the rung is judged empty, which is the ordering that
  // matters: judging first would hand back an empty roster and stop.
  const r = prefillChain(
    input({
      lastSession: { slots: [member("gone1", "Zed"), member("gone2", "Yan")], label: "Smash Bros" },
      showed: [{ userId: "u1", name: "Ann" }],
    }),
  );
  assert.equal(r.source, "attendance");
  assert.deepEqual(r.slots, [{ userId: "u1", name: "Ann" }]);
});

// ---------- the crew filter ----------

test("somebody who left the crew does not come back on a carried roster", () => {
  const r = prefillChain(
    input({
      lastSession: {
        slots: [member("u1", "Ann"), member("gone", "Zed"), guest("Mike")],
        label: "Board Game",
      },
    }),
  );
  assert.deepEqual(r.slots, [
    { userId: "u1", name: "Ann" },
    { userId: null, name: "Mike" },
  ]);
});

test("the crew filter applies to the attendance and RSVP rungs too", () => {
  const showed = prefillChain(
    input({ showed: [{ userId: "gone", name: "Zed" }, { userId: "u2", name: "Ben" }] }),
  );
  assert.deepEqual(showed.slots, [{ userId: "u2", name: "Ben" }]);
  const yes = prefillChain(
    input({ yes: [{ userId: "gone", name: "Zed" }, { userId: "u2", name: "Ben" }] }),
  );
  assert.deepEqual(yes.slots, [{ userId: "u2", name: "Ben" }]);
});

test("a rung emptied ENTIRELY by the filter still falls through", () => {
  const r = prefillChain(
    input({
      showed: [{ userId: "gone", name: "Zed" }],
      yes: [{ userId: "u1", name: "Ann" }],
    }),
  );
  assert.equal(r.source, "rsvp");
});

test("names come from the CREW, so a renamed member carries over renamed", () => {
  // The stored roster keeps the name that was typed the night it was built, and
  // the bracket adapter deliberately stores no name at all, so the crew is the
  // only source that is right for both.
  const r = prefillChain(
    input({ lastSession: { slots: [{ ...member("u1", "Annie"), name: "" }], label: "Poker" } }),
  );
  assert.deepEqual(r.slots, [{ userId: "u1", name: "Ann" }]);
});

// ---------- guest chips ----------

test("recent guest names are newest first, deduped case-insensitively", () => {
  const names = recentGuestNames(
    [
      [guest("Mike D"), member("u1", "Ann")],
      [guest("mike"), guest("Sam")],
      [guest("MIKE"), guest("sam"), guest("Jo")],
    ],
    12,
  );
  assert.deepEqual(names, ["Mike D", "mike", "Sam", "Jo"]);
});

test("the MOST RECENT spelling is the one shown, not the first ever typed", () => {
  // The chips exist to stop three spellings of one person from being three
  // people, and the spelling to offer is the one the host last chose.
  assert.deepEqual(recentGuestNames([[guest("mike")], [guest("Mike")]], 12), ["mike"]);
});

test("A PERSONAL CREW GETS NO CHIPS, because quick play is a deferred question", () => {
  // Quick play runs through a hidden personal crew where everybody except the
  // host is a typed guest, so guest name memory THERE is not a small extra: it
  // would be the main way a quick play roster gets built. Guest linking for
  // personal crews is an open decision (DEFERRED), and shipping the chips into
  // quick play would have answered it by accident.
  assert.deepEqual(
    recentGuestNames([[guest("Mike")], [guest("Sam")]], 12, { personalCrew: true }),
    [],
  );
  // And a real crew is unaffected, which is the half that has to keep working.
  assert.deepEqual(
    recentGuestNames([[guest("Mike")], [guest("Sam")]], 12, { personalCrew: false }),
    ["Mike", "Sam"],
  );
});

test("the cap holds, and blank names never become a chip", () => {
  const many = Array.from({ length: 20 }, (_, i) => [guest(`G${i}`)]);
  assert.equal(recentGuestNames(many, 12).length, 12);
  assert.deepEqual(recentGuestNames([[guest("  "), guest("Jo")]], 12), ["Jo"]);
});

// ---------- the adapter table ----------

test("EVERY PACK HAS A ROSTER ADAPTER, derived from the registry", () => {
  // The failure this makes loud: a new pack with no adapter is skipped by the
  // carry-over silently, with the chain quietly falling to the rung below and
  // nothing erroring anywhere. Derived from SESSION_PACK_KEYS rather than
  // listed, so a pack added tomorrow joins this requirement without anybody
  // remembering the file exists.
  const missing = SESSION_PACK_KEYS.map((k) => SESSION_PACKS[k].ledger).filter(
    (ledger) => !ROSTER_ADAPTERS[ledger],
  );
  assert.deepEqual(missing, [], `packs with no rosterOf adapter: ${missing.join(", ")}`);
  // The two ledger packs that are not session packs, which the carry-over reads
  // just as much: a bracket's entrants, and Beerio's deliberate nothing.
  assert.ok(ROSTER_ADAPTERS[GENERIC_LEDGER], "no adapter for the generic bracket");
  assert.ok(ROSTER_ADAPTERS[BEERIO_LEDGER], "no adapter for Beerio");
});

test("a pack adapter reads that pack's own roster field", () => {
  const roster = [member("u1", "Ann"), guest("Mike")];
  assert.deepEqual(rosterOfPingPong({ roster } as never), roster);
  // A state with no roster at all returns empty rather than throwing, because
  // an old row from before a field existed is a real thing to meet.
  assert.deepEqual(rosterOfPingPong({} as never), []);
});

test("the bracket adapter walks TEAM entrants into people", () => {
  // A doubles bracket stores ONE entrant holding two members, and a carry-over
  // wants the two people. A version that read entrants without flattening would
  // carry over half a tournament and look correct.
  const slots = rosterOfBracket([
    { kind: "member", userId: "u1" },
    { kind: "team", name: "The Twins", members: [{ kind: "member", userId: "u2" }, { kind: "guest", name: "Mike" }] },
    { kind: "guest", name: "Sam" },
  ]);
  assert.deepEqual(
    slots.map((s) => [s.kind, s.userId, s.name]),
    [
      ["member", "u1", ""],
      ["member", "u2", ""],
      ["guest", null, "Mike"],
      ["guest", null, "Sam"],
    ],
  );
  // Legacy rows stored bare userId strings; parseEntrants upgrades them on read.
  assert.deepEqual(rosterOfBracket(["u1", "u2"]).map((s) => s.userId), ["u1", "u2"]);
  assert.deepEqual(rosterOfBracket(null), []);
});

test("BEERIO'S ADAPTER RETURNS NOTHING, on purpose and not by omission", () => {
  // Its session blob is the vendored engine's opaque shape, keyed by a reusable
  // room code with no link to an event. The entry exists so that a deliberate
  // empty and a forgotten pack do not look the same from the call site.
  assert.deepEqual(ROSTER_ADAPTERS[BEERIO_LEDGER]!({ players: [{ name: "Ann" }] }), []);
});

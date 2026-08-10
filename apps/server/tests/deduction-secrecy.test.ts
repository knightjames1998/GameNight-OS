// THE TEST THIS SESSION EXISTS FOR: a role must never reach the session payload
// of a live game.
//
// Social Deduction is the first pack in this app whose session state contains a
// secret. Every other pack's state is public by nature (fighters, scores,
// standings, money), so `createPackRuntime`'s `sessionView` has NO VIEWER
// ARGUMENT: one payload goes to everybody, and `viewOf` builds it by spreading
// the whole state. Standing rule 2 says members join the host's live session,
// so a role in that state reaches every player at the table the moment they
// open the page. Nothing errors. The game is simply over, and nothing anywhere
// reports it.
//
// WHY IT IS A PAYLOAD TEST RATHER THAN A ROUTE TEST. What must hold is a
// property of the object `viewOf` produces, and `viewOf` is pure: it takes a
// row and a state and returns the payload with no database in the way. So this
// runs the REAL pack runtime over the REAL state a real night produces, and
// scans what a player's phone would actually receive.
//
// IT IS NEGATIVE-CONTROLLED, the same discipline copy-rules.test.ts uses for
// the em dash spellings. A scan that has quietly stopped matching passes
// forever and is worse than no scan at all, so one test below deliberately
// leaks a role into the state and asserts the scan goes red on it. The leak was
// also reintroduced by hand in the pack's own code during the session that
// wrote this, and confirmed to fail there too.
//
// No database and no Drizzle stub. Stubbing Drizzle would test the stub;
// getDb() is a lazy singleton, so importing the pack modules never opens a
// connection.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dealRoles,
  newSdState,
  recordSdGame,
  sdTitleDef,
  suggestComposition,
  PACK_BY_LEDGER,
  SESSION_PACKS,
  type SdPlayer,
  type SdSessionState,
} from "@gamenight/shared";
import { deductionRuntime, DEDUCTION_PACK } from "../src/deduction.js";
import { DEDUCTION_SECRET_PACK } from "../src/deduction-secret.js";

const players = (n: number): SdPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    kind: "member" as const,
    userId: `u${i}`,
    name: `P${i}`,
  }));

/** The payload a player's phone receives, built by the pack's real runtime. */
const payloadFor = (state: SdSessionState) =>
  deductionRuntime.viewOf({
    row: { eventId: "e1", groupId: "g1", status: "live", state },
    state,
  });

/**
 * The payload as a string, with THE ONE PLACE A ROLE ID BELONGS blanked out.
 *
 * `deal.composition` is the setup the moderator says out loud ("two wolves, a
 * seer"), so it carries role ids on purpose and a scan that flagged it would be
 * flagging the feature. Everything else in the payload is scanned, which is
 * what makes this catch a role arriving in a field nobody thought to check
 * rather than only in the fields somebody remembered to name.
 */
function scannable(state: SdSessionState): string {
  const payload = payloadFor(state) as { session: Record<string, unknown> | null };
  const session = payload.session;
  // A fresh object rather than a mutation: `viewOf` spreads the state, so
  // `session.deal` is the very object the caller passed in.
  if (session?.deal) session.deal = { ...(session.deal as object), composition: "<public setup>" };
  return JSON.stringify(payload);
}

/** Which of these strings a payload gives away. */
function leaks(json: string, needles: readonly string[]): string[] {
  return needles.filter((n) => n.length > 0 && json.includes(n));
}

/** A live night: nine players, dealt, mid-game, nothing recorded yet. */
function liveNight() {
  const def = sdTitleDef("Werewolf");
  const roster = players(9);
  const state = newSdState({ roster });
  const composition = suggestComposition(def, 9);
  // A pinned deal, so the needles below are exactly what was dealt.
  const roles = dealRoles(composition, roster.map((p) => p.id), () => 0.5);
  state.nowPlaying = "Werewolf";
  state.deal = { dealNo: 1, title: "Werewolf", at: "2026-08-10T20:00:00.000Z", composition };
  return { def, roster, state, roles };
}

// ---------- the rule ----------

test("NO ROLE REACHES THE SESSION PAYLOAD OF A LIVE GAME", () => {
  const { state, roles } = liveNight();
  const json = scannable(state);

  // Every dealt role id. If one of these strings is anywhere in the payload
  // outside the announced setup, a phone at the table can read the table.
  const dealt = [...new Set(Object.values(roles))];
  assert.deepEqual(
    leaks(json, dealt),
    [],
    "a role reached the session payload of a live game. This ends the game and nothing " +
      "anywhere reports it: read the header of apps/server/src/deduction-secret.ts before " +
      "putting anything back.",
  );

  // And no player is mapped to a role by any route through the object. The
  // check above would miss a mapping whose role string arrived some other way,
  // so this asserts the MAPPING is absent rather than the words, and it scans
  // the WHOLE payload including the setup.
  const full = JSON.stringify(payloadFor(state));
  for (const [playerId, roleId] of Object.entries(roles)) {
    assert.equal(
      full.includes(`"${playerId}":"${roleId}"`),
      false,
      `${playerId} is mapped to ${roleId} in the live payload`,
    );
  }
});

test("the redaction scan can actually see a leaked role", () => {
  // THE NEGATIVE CONTROL. A scan that has stopped matching passes forever, so
  // prove it bites: put the deal into state the way a future session might
  // reasonably be tempted to, and confirm the same check goes red.
  const { state, roles } = liveNight();
  const leaky = { ...state, roles } as unknown as SdSessionState;
  assert.ok(
    leaks(scannable(leaky), [...new Set(Object.values(roles))]).length > 0,
    "the scan did not catch a role sitting in plain sight",
  );

  const full = JSON.stringify(payloadFor(leaky));
  const [playerId, roleId] = Object.entries(roles)[0]!;
  assert.ok(full.includes(`"${playerId}":"${roleId}"`), "the mapping check did not catch a mapping");

  // And the blanked-out setup is the ONLY thing the scan forgives: a role id
  // moved anywhere else, even one field along, is still caught.
  const sneaky = { ...state, deal: { ...state.deal!, note: "p3 is the werewolf" } } as unknown as SdSessionState;
  assert.deepEqual(leaks(scannable(sneaky), ["werewolf"]), ["werewolf"]);
});

test("THE PUBLIC STATE HAS EXACTLY THESE KEYS, so a new field is a deliberate act", () => {
  // The other half of "public-safe by construction". `viewOf` spreads the whole
  // state, so a field added to SdSessionState is a field on every player's
  // phone. Pinning the key list means adding one fails here rather than in a
  // living room.
  const { state } = liveNight();
  const session = payloadFor(state).session!;
  assert.deepEqual(Object.keys(session).sort(), [
    "deal",
    "games",
    "groupId",
    "nowPlaying",
    "openScoring",
    "roster",
    "sessionKey",
    "status",
    "summary",
  ]);
});

test("the public deal summary says the SETUP and never who has it", () => {
  // The composition is public on purpose: every game in this genre opens with
  // the moderator saying it out loud, and a screen that hid it would be hiding
  // something the room already knows. What must not be there is the mapping.
  const { state } = liveNight();
  const deal = (payloadFor(state).session as { deal: Record<string, unknown> }).deal;
  assert.deepEqual(Object.keys(deal).sort(), ["at", "composition", "dealNo", "title"]);
  assert.deepEqual(deal.composition, [
    { roleId: "villager", count: 7 },
    { roleId: "werewolf", count: 2 },
  ]);
});

test("REVEAL PUBLISHES: a recorded game carries the roles, and that is correct", () => {
  // The rule is about a game that is still being played. Once a game is
  // recorded the room has been told, and a record that did not say who was the
  // wolf would be a record of nothing anybody remembers.
  const { def, state, roles } = liveNight();
  recordSdGame(
    state,
    "Werewolf",
    [
      { factionId: "wolves", memberIds: Object.keys(roles).filter((id) => roles[id] === "werewolf") },
      { factionId: "village", memberIds: Object.keys(roles).filter((id) => roles[id] === "villager") },
    ],
    def,
    roles,
    "2026-08-10T20:40:00.000Z",
  );

  const session = payloadFor(state).session as { games: { lines: { roleId: string | null }[] }[]; deal: unknown };
  assert.equal(session.games.length, 1);
  assert.ok(session.games[0]!.lines.every((l) => l.roleId !== null));
  // And the game that just ended is no longer on the table, so the summary
  // does not go on announcing a setup nobody is playing.
  assert.equal(session.deal, null);
});

test("a session with no deal leaks nothing and says nothing", () => {
  const state = newSdState({ roster: players(9) });
  const session = payloadFor(state).session as { deal: unknown; games: unknown[] };
  assert.equal(session.deal, null);
  assert.deepEqual(session.games, []);
});

// ---------- the store the secret actually lives in ----------

test("the secret row is stored under a pack value NOTHING can resolve", () => {
  // This is what keeps the secret row invisible to everything that reads
  // game_sessions generically. The event TV resolver and the event detail
  // payload both look the pack up in PACK_BY_LEDGER and DROP a row they cannot
  // resolve, so a secret row cannot become a tile, a TV screen or a "live now"
  // line. Give this value a registry entry and all three of those change.
  assert.equal(DEDUCTION_SECRET_PACK, "deduction_secret");
  assert.equal(PACK_BY_LEDGER[DEDUCTION_SECRET_PACK], undefined);
  assert.notEqual(DEDUCTION_SECRET_PACK, DEDUCTION_PACK);
  for (const key of Object.keys(SESSION_PACKS)) {
    assert.notEqual(
      SESSION_PACKS[key as keyof typeof SESSION_PACKS].ledger,
      DEDUCTION_SECRET_PACK,
      `${key} claims the secret store's pack value`,
    );
  }
});

test("the pack's own identifiers are the ones the ledger already has", () => {
  // Same discipline as pack-runtime.test.ts: these fail SILENTLY when changed.
  assert.equal(deductionRuntime.pack, "deduction");
  assert.equal(deductionRuntime.gameName, "Social Deduction");
  assert.equal(deductionRuntime.keyPrefix, "sd");
  assert.equal(deductionRuntime.wsType, "deduction_updated");
  assert.equal(deductionRuntime.table, "game_sessions");
  assert.equal(deductionRuntime.ledgerKey("e1", "sk1", 0), "sd:e1:sk1:0");
  assert.equal(deductionRuntime.ledgerKey("e1", undefined, 3), "sd:e1:3");
});

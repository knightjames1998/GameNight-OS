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
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compositionOf,
  dealRoles,
  newSdBoard,
  newSdState,
  recordSdGame,
  sdDefWith,
  sdSetOut,
  sdTitleDef,
  sdTvView,
  suggestComposition,
  typedRole,
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
  //
  // `extraRoles` and `extraFactions` are blanked for the SAME REASON as the
  // composition: they are the announced setup for a role the catalogue does not
  // have yet, so they carry role ids on purpose. They are a CATALOGUE rather
  // than a mapping, and the key-list test asserts separately that no player id
  // appears in either, which is the property that actually matters.
  if (session?.deal) {
    session.deal = {
      ...(session.deal as object),
      composition: "<public setup>",
      extraRoles: "<public setup>",
      extraFactions: "<public setup>",
    };
  }
  return JSON.stringify(payload);
}

/** Which of these strings a payload gives away. */
function leaks(json: string, needles: readonly string[]): string[] {
  return needles.filter((n) => n.length > 0 && json.includes(n));
}

/**
 * A live night: nine players, dealt, mid-game, nothing recorded yet.
 *
 * THE DEAL IS BUILT THE WAY THE DEAL ROUTE BUILDS IT, field for field, and that
 * matters more than it looks: these test files are NOT in the typecheck scope
 * (`include: ["src"]`), so a hand-written deal literal that quietly omits a new
 * field makes the key-list assertion below pass against a shape the server
 * never serves. That happened once, on the pass that added typed roles.
 *
 * `extra` adds a typed role, which is the shape a host reaches for when the
 * catalogue is missing one.
 */
function liveNight(extra?: { name: string; solo: boolean }) {
  const curated = sdTitleDef("Werewolf");
  const made = extra ? typedRole(curated, extra.name, null, extra.solo) : null;
  const def = made ? sdDefWith(curated, [made.role], made.faction ? [made.faction] : []) : curated;
  const roster = players(9);
  const state = newSdState({ roster });
  const composition = made
    ? [{ roleId: def.baselineTown, count: 6 }, { roleId: def.baselineEvil, count: 2 }, { roleId: made.role.id, count: 1 }]
    : suggestComposition(def, 9);
  // A pinned deal, so the needles below are exactly what was dealt.
  const roles = dealRoles(composition, roster.map((p) => p.id), () => 0.5);
  state.nowPlaying = "Werewolf";
  state.deal = {
    dealNo: 1,
    title: "Werewolf",
    at: "2026-08-10T20:00:00.000Z",
    composition: compositionOf(def, roles),
    extraRoles: made ? [made.role] : [],
    extraFactions: made?.faction ? [made.faction] : [],
  };
  state.boardEnabled = true;
  state.board = newSdBoard(roster, "2026-08-10T20:00:00.000Z");
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
    // The live moderator board, added in part B. EVERYTHING IN IT IS PUBLIC:
    // alive and dead is what the room can see across the table, the day count
    // is what the moderator says out loud, and a revealed role is one the room
    // has already been told. That is why it may sit here while the deal cannot.
    "board",
    "boardEnabled",
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
  assert.deepEqual(Object.keys(deal).sort(), [
    "at",
    "composition",
    "dealNo",
    // The roles the host TYPED, and any faction they needed. Public for exactly
    // the same reason the composition is: "there is a Witch in this one" is part
    // of the setup the moderator announces. Neither carries a player.
    "extraFactions",
    "extraRoles",
    "title",
  ]);
  // And neither of them mentions anybody: they are a catalogue, not a mapping.
  const rosterIds = state.roster.map((p) => p.id);
  const json = JSON.stringify([deal.extraRoles, deal.extraFactions]);
  for (const id of rosterIds) assert.equal(json.includes(id), false, `${id} appears in the typed-role list`);
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

// ===========================================================================
// THE TV, which is the likelier leak of the two.
//
// The session payload goes to authenticated members of the crew. The TV route
// is PUBLIC, UUID-KEYED AND UNAUTHENTICATED: anybody with the link can open it,
// including a player sitting at the table on their own phone, and its whole job
// is showing the table. So it gets the same three probes the session payload
// gets, and the same negative control.
//
// An unrevealed role must be ABSENT FROM THE PAYLOAD. Not hidden by CSS, not
// rendered face down with the value in the DOM, not filtered on the client.
// ===========================================================================

/** A live night with the board on, mid-game, nothing revealed. */
function tvNight() {
  const def = sdTitleDef("Werewolf");
  const roster = players(9);
  const state = newSdState({ roster });
  const composition = suggestComposition(def, 9);
  const roles = dealRoles(composition, roster.map((p) => p.id), () => 0.5);
  state.nowPlaying = "Werewolf";
  state.deal = {
    dealNo: 1,
    title: "Werewolf",
    at: "2026-08-10T20:00:00.000Z",
    composition: compositionOf(def, roles),
    extraRoles: [],
    extraFactions: [],
  };
  state.boardEnabled = true;
  state.board = newSdBoard(roster, "2026-08-10T20:00:00.000Z");
  return { def, roster, state, roles };
}

/**
 * TWO KINDS OF NEEDLE, and keeping them apart is what makes this scan precise
 * rather than noisy.
 *
 * A role ID ("werewolf", "villager") is an internal slug and appears NOWHERE in
 * a correct TV payload: the projection resolves every role through the
 * catalogue and emits display names. So an id anywhere is a leak, full stop,
 * with nothing to blank out first.
 *
 * A role NAME ("Werewolf", "Villager") legitimately appears twice: in the
 * announced setup, and on a player who has been revealed. It also COLLIDES with
 * other public strings by design, because these games are named after their
 * roles: the title is "Werewolf", the faction is "Werewolves", and both are
 * things the room already knows. So names are scanned only where a leak would
 * actually land, which is the board.
 */
function roleIds(roles: Record<string, string>): string[] {
  return [...new Set(Object.values(roles))];
}

function roleNames(def: { roles: readonly { id: string; name: string }[] }, roles: Record<string, string>): string[] {
  return roleIds(roles)
    .map((id) => def.roles.find((r) => r.id === id)?.name)
    .filter((n): n is string => !!n);
}

/**
 * The board as a string, with the one field a role name belongs in blanked.
 *
 * `revealed` is a role the room has already been shown. Every other field on
 * every player is scanned, which is what catches a role arriving somewhere
 * nobody thought to check.
 */
function boardScannable(state: SdSessionState): string {
  const tv = sdTvView(state) as Record<string, any>;
  if (!tv.board) return "";
  return JSON.stringify(tv.board.players.map((p: any) => ({ ...p, revealed: "<revealed on death>" })));
}

test("NO UNREVEALED ROLE REACHES THE PUBLIC TV PAYLOAD", () => {
  const { def, state, roles } = tvNight();
  const complaint =
    "a role reached the PUBLIC TV payload before its reveal. Anybody with the event link can " +
    "read that, including a player at the table. Read the header of sdTvView in " +
    "packages/shared/src/deduction.ts before putting anything back.";

  // A role ID anywhere in the payload is a leak with nothing to forgive: the
  // projection emits display names, so an id has no legitimate home here.
  assert.deepEqual(leaks(JSON.stringify(sdTvView(state)), roleIds(roles)), [], complaint);
  // And no role NAME on the board outside the revealed slot.
  assert.deepEqual(leaks(boardScannable(state), roleNames(def, roles)), [], complaint);
});

test("the TV maps no player to a role, by any route through the object", () => {
  const { state, roles } = tvNight();
  const full = JSON.stringify(sdTvView(state));
  for (const [playerId, roleId] of Object.entries(roles)) {
    assert.equal(full.includes(`"${playerId}":"${roleId}"`), false, `${playerId} is mapped to ${roleId}`);
  }
  // And per player: an unrevealed player's own object must mention no role at
  // all, which is the check that survives the payload being reshaped.
  const tv = sdTvView(state);
  const needles = [...roleIds(roles), ...roleNames(sdTitleDef("Werewolf"), roles)];
  for (const p of tv.board!.players) {
    assert.deepEqual(leaks(JSON.stringify(p), needles), [], `${p.playerId}'s TV row gives their role away`);
  }
});

test("THE TV PROJECTION IS A WHITELIST, so a field added to state never reaches the screen", () => {
  // Found by writing the negative control below and watching it fail to leak.
  // `sdTvView` does not spread the board, it REBUILDS each player out of seven
  // named fields, so a role planted on the session state is dropped on the way
  // out rather than filtered on the way in. That is the difference between this
  // screen and the session payload, which DOES spread state (hence the key-list
  // test above), and it is worth asserting rather than relying on.
  const { state, roles } = tvNight();
  const planted = {
    ...state,
    board: { ...state.board!, players: state.board!.players.map((p) => ({ ...p, roleId: roles[p.playerId] })) },
  } as unknown as SdSessionState;
  assert.deepEqual(leaks(JSON.stringify(sdTvView(planted)), roleIds(roles)), []);
});

test("the TV redaction scan can actually see a leaked role", () => {
  // THE NEGATIVE CONTROL, and it plants the leak where a leak could actually
  // come from: the PROJECTION'S OUTPUT. A future session edits `sdTvView` to
  // "just include the role so the TV can colour the tiles", and every other
  // test in this file stays green. These are the three shapes that edit takes.
  const { def, state, roles } = tvNight();
  const ids = roleIds(roles);
  const names = roleNames(def, roles);
  const tv = sdTvView(state) as Record<string, any>;

  // 1. The whole deal, hung off the payload.
  const whole = { ...tv, roles };
  assert.ok(leaks(JSON.stringify(whole), ids).length > 0, "the scan did not catch the whole deal");

  // 2. One player, in the internal id form.
  const oneId = {
    ...tv,
    board: { ...tv.board, players: tv.board.players.map((p: any, i: number) => (i === 3 ? { ...p, roleId: roles[p.playerId] } : p)) },
  };
  assert.ok(leaks(JSON.stringify(oneId), ids).length > 0, "the scan did not catch a single planted role id");

  // 3. One player, in the DISPLAY form, which the id scan cannot see and the
  //    board name scan must. This is what a pre-rendered role tile looks like.
  const oneName = tv.board.players.map((p: any, i: number) =>
    i === 3 ? { ...p, revealed: "<revealed on death>", hint: def.roles.find((r) => r.id === roles[p.playerId])!.name } : { ...p, revealed: "<revealed on death>" },
  );
  assert.ok(leaks(JSON.stringify(oneName), names).length > 0, "the board name scan did not bite");

  // And the mapping probe bites on the same plant.
  assert.ok(JSON.stringify(whole).includes(`"${state.roster[3]!.id}":"${roles[state.roster[3]!.id]}"`));
});

test("REVEAL PUBLISHES ON THE TV, and only for the player revealed", () => {
  // The one-way transition. Everybody else on the board is untouched by it,
  // which is the property that makes reveal-on-death safe to show at all.
  const { def, state, roles } = tvNight();
  const victim = state.roster[3]!.id;
  sdSetOut(state.board!, victim, "voted", roles[victim]);

  const tv = sdTvView(state);
  const shown = tv.board!.players.find((p) => p.playerId === victim)!;
  assert.equal(shown.alive, false);
  assert.equal(shown.revealed, def.roles.find((r) => r.id === roles[victim])!.name);
  assert.ok(shown.alignment);

  // Everybody else still says nothing, and both scans still pass.
  for (const p of tv.board!.players) {
    if (p.playerId === victim) continue;
    assert.equal(p.revealed, null, `${p.playerId} was revealed by somebody else's death`);
  }
  assert.deepEqual(leaks(JSON.stringify(sdTvView(state)), roleIds(roles)), []);
  assert.deepEqual(leaks(boardScannable(state), roleNames(def, roles)), []);
});

test("the TV carries no recorded game's lines, only the count and the standings", () => {
  // A recorded game's roles ARE public, so this is not a secrecy rule: it is a
  // payload-size and surface rule. The fewer places a role can appear, the
  // fewer places the scans above have to reason about.
  const { def, state, roles } = tvNight();
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
  const tv = sdTvView(state);
  assert.equal(tv.games, 1);
  assert.equal(tv.board, null, "recording clears the board, so the TV stops showing a finished table");
  assert.equal(Object.prototype.hasOwnProperty.call(tv, "lines"), false);
});

// ===========================================================================
// PART A'S RESIDUAL RISK, closed.
//
// The secret store's safety rests on a real but until now UNPINNED invariant:
// no GENERIC reader of game_sessions ever selects the `state` column. Today
// none does. events.ts and tv.ts both read by eventId ALONE, across every
// pack's row including the secret one, and both project
// `{ pack, status, updatedAt }` and drop a row PACK_BY_LEDGER cannot resolve.
//
// But a future session adding `state` to either select would hand the deal to
// the event detail payload, and EVERY OTHER TEST IN THIS FILE WOULD STAY GREEN,
// because they all scan the pack's own payloads. This is the cheap check that
// makes it "safe by construction" rather than "safe until somebody edits a
// select".
// ===========================================================================

test("NO GENERIC READER OF game_sessions SELECTS THE state COLUMN", () => {
  const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");

  /**
   * The files allowed to read `state`, ALL OF WHICH KEY BY PACK as well as by
   * event or group, so none can reach a row belonging to something else:
   *   - pack-runtime.ts, which is how every pack loads its own session,
   *   - deduction-secret.ts, which is the secret store itself,
   *   - event-prefill.ts, which reads across packs to answer "which session ran
   *     last on this night" and therefore CANNOT name one pack, so it restricts
   *     to a registry-derived allowlist instead. The secret store's pack value
   *     is claimed by no registry entry, so it can never be in that list. The
   *     test below is what makes that a checked property rather than a promise:
   *     an exemption on this list has to earn itself.
   * Any OTHER file reading game_sessions is reading across packs.
   */
  const KEYED_BY_PACK = new Set([
    "pack-runtime.ts",
    "deduction-secret.ts",
    "event-prefill.ts",
  ]);

  const offenders: string[] = [];
  for (const name of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(path.join(SRC, name), "utf8");
    if (!src.includes(".from(gameSessions)")) continue;
    if (KEYED_BY_PACK.has(name)) continue;

    // Every read in this file, with the projection that precedes it. Searched
    // BACKWARD from each `.from(gameSessions)` to the NEAREST `.select(`,
    // because a forward lazy match starts at the first select in the file and
    // swallows everything in between, which made this report a comment three
    // hundred lines away as a state read the first time it ran.
    //
    // A bare `.select()` is the dangerous one: it means ALL COLUMNS, which
    // includes state, and it is exactly what somebody writes for "the row".
    for (const hit of [...src.matchAll(/\.from\(gameSessions\)/g)]) {
      const before = src.slice(0, hit.index);
      const open = before.lastIndexOf(".select(");
      if (open < 0) {
        offenders.push(`${name}: reads game_sessions with no .select() this check can find`);
        continue;
      }
      const projection = before.slice(open + ".select(".length).replace(/\)\s*$/, "").trim();
      if (projection === "") offenders.push(`${name}: bare .select() reads every column, including state`);
      else if (/\bstate\b/.test(projection)) offenders.push(`${name}: selects state across packs`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "a generic reader of game_sessions would pull the SECRET STORE'S ROW along with every " +
      "pack's. The secret row is keyed under a pack value no registry entry claims, which " +
      "keeps it out of every payload precisely because nothing selects its state.\n  " +
      offenders.join("\n  "),
  );
});

test("THE PREFILL'S CROSS-PACK READS CARRY THE REGISTRY ALLOWLIST", () => {
  // event-prefill.ts is on the exemption list above because it genuinely cannot
  // name one pack: it is asking which session ran last, across all of them. What
  // makes that safe is that both of its game_sessions reads restrict `pack` to a
  // list DERIVED from the registry, so the secret store's `deduction_secret` row
  // (a pack value no registry entry claims) can never come back.
  //
  // WITHOUT THIS TEST the exemption above would be a hole: the file could drop
  // the filter tomorrow and the check would still pass, because the check only
  // asks who is on the list.
  const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");
  const src = readFileSync(path.join(SRC, "event-prefill.ts"), "utf8");

  const reads = [...src.matchAll(/\.from\(gameSessions\)([\s\S]{0,400})/g)];
  assert.ok(reads.length >= 2, "event-prefill.ts should read game_sessions twice");
  for (const [i, r] of reads.entries()) {
    assert.match(
      r[1]!,
      /inArray\(gameSessions\.pack, READABLE_LEDGERS\)/,
      `game_sessions read ${i + 1} in event-prefill.ts is not restricted by pack`,
    );
  }
  // And the allowlist is derived, not typed out: a hand-written list is one
  // paste away from including a pack value that should not be readable.
  assert.match(
    src,
    /const READABLE_LEDGERS = SESSION_PACK_KEYS\.map\(\(k\) => SESSION_PACKS\[k\]\.ledger\)/,
    "READABLE_LEDGERS must come from the registry",
  );
  // As a VALUE, not as a word: the file's own comment explains which row the
  // allowlist keeps out, and explaining it is the point. A quoted spelling of it
  // would mean the file had started naming the secret pack in a query.
  assert.doesNotMatch(
    src,
    /["']deduction_secret["']/,
    "the secret pack must never appear as a string literal here",
  );
});

test("the state-column check can actually see a select that reads state", () => {
  // Same discipline as the redaction scans: prove the pattern bites, or it
  // passes forever the day the code shape moves under it. The samples are the
  // three shapes that matter, including a file with an EARLIER unrelated select
  // in it, which is the case the first version of this check got wrong.
  const projectionOf = (src: string): string | null => {
    const i = src.indexOf(".from(gameSessions)");
    if (i < 0) return null;
    const open = src.slice(0, i).lastIndexOf(".select(");
    return open < 0 ? null : src.slice(0, i).slice(open + ".select(".length).replace(/\)\s*$/, "").trim();
  };
  const noise = "const other = db.select({ id: events.id, state: events.state }).from(events);\n  ";
  assert.ok(/\bstate\b/.test(projectionOf(noise + ".select({ state: gameSessions.state })\n.from(gameSessions)")!));
  assert.equal(
    /\bstate\b/.test(projectionOf(noise + ".select({ pack: gameSessions.pack })\n.from(gameSessions)")!),
    false,
    "an unrelated select on another table was dragged in",
  );
  assert.equal(projectionOf(".select()\n.from(gameSessions)"), "", "a bare select was not caught");
});

// ---------- a typed role is still a role ----------

test("A TYPED ROLE IS STILL A SECRET, on the session payload and on the TV", () => {
  // The catalogue gap this session closed is about the RECORD being true, not
  // about the role being less hidden. A host who types "Cult Leader" has dealt
  // exactly one, and which player has it is as secret as any curated role.
  const { def, state, roles } = liveNight({ name: "Cult Leader", solo: true });
  assert.ok(Object.values(roles).includes("cultleader"), "the fixture must actually deal the typed role");

  // The session payload: no role id anywhere outside the announced setup.
  assert.deepEqual(
    leaks(scannable(state), [...new Set(Object.values(roles))]),
    [],
    "a typed role reached the session payload of a live game",
  );
  const full = JSON.stringify(payloadFor(state));
  for (const [playerId, roleId] of Object.entries(roles)) {
    assert.equal(full.includes(`"${playerId}":"${roleId}"`), false, `${playerId} is mapped to ${roleId}`);
  }

  // The public TV: same two probes the curated roles get.
  assert.deepEqual(leaks(JSON.stringify(sdTvView(state)), roleIds(roles)), [], "a typed role reached the TV payload");
  assert.deepEqual(leaks(boardScannable(state), roleNames(def, roles)), []);
});

test("a typed role reaches the TV under its own NAME once revealed, not as an id", () => {
  // The other half: the merge point has to reach the projection, or the one
  // player who has it is shown a raw slug on the big screen.
  const { state, roles } = liveNight({ name: "Cult Leader", solo: true });
  const cultist = Object.keys(roles).find((id) => roles[id] === "cultleader")!;
  sdSetOut(state.board!, cultist, "voted", "cultleader");

  const shown = sdTvView(state).board!.players.find((p) => p.playerId === cultist)!;
  assert.equal(shown.revealed, "Cult Leader");
  assert.equal(shown.alignment, "solo");
  // And the announced setup names it too, which is public.
  assert.ok(sdTvView(state).composition!.some((c) => c.name === "Cult Leader"));
});

test("the typed-role secrecy scan can actually see a leak", () => {
  // Negative control, planted in the projection's output the way the others are.
  const { def, state, roles } = liveNight({ name: "Cult Leader", solo: true });
  const tv = sdTvView(state) as Record<string, any>;
  const leaky = { ...tv, roles };
  assert.ok(leaks(JSON.stringify(leaky), roleIds(roles)).length > 0, "the id scan did not bite");
  assert.ok(
    JSON.stringify(leaky).includes(`"${Object.keys(roles)[0]}":"${Object.values(roles)[0]}"`),
    "the mapping probe did not bite",
  );
  // And the DISPLAY form, planted on the board outside the `revealed` slot,
  // which is the shape the id scan cannot see.
  const nameLeak = tv.board.players.map((p: any, i: number) => ({
    ...p,
    revealed: "<revealed on death>",
    ...(i === 0 ? { hint: def.roles.find((r) => r.id === roles[p.playerId])!.name } : {}),
  }));
  assert.ok(leaks(JSON.stringify(nameLeak), roleNames(def, roles)).length > 0, "the name scan did not bite");
});

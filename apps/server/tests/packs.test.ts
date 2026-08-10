// Tests for the pack registry (packages/shared/src/packs.ts).
//
// The registry exists because every pack had TWO spellings: the server's
// games.pack (smash / mario_kart / mario_party / pingpong) and the client's
// route segment (smash / mariokart / marioparty / pingpong), with nothing
// mapping between them. They agree for two packs and disagree for two, which
// is the worst arrangement: every consumer touched only one side, so nothing
// ever failed loudly enough to reveal that two lists existed.
//
// TWO KINDS OF ASSERTION HERE, and the distinction matters.
//
// 1. THE SHIPPED VALUES. ledger, gameName and keyPrefix are pinned to the
//    exact strings already written into the production database. These are
//    transcribed from the pack files as they stood BEFORE this refactor, the
//    same discipline the pack-runtime tests used, because all three fail
//    SILENTLY when changed: nothing errors, the rows simply stop matching and
//    the leaderboard quietly disagrees with history. A test that only checked
//    the registry against itself would be worthless for exactly this.
//
// 2. THE INVARIANTS. Uniqueness and completeness across the map, which is what
//    stops a NEW pack being registered with a duplicate or missing identifier.
//
// No database, no Drizzle stub.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_PACKS,
  SESSION_PACK_KEYS,
  PACK_BY_LEDGER,
  PACK_WS_TYPES,
  packEmoji,
  packDisplayName,
  BEERIO_LEDGER,
  GENERIC_LEDGER,
} from "@gamenight/shared";

// ---------- 1. the shipped values ----------

// Transcribed by hand from the four pack files as they were before the
// registry existed. Changing production without changing these is the point;
// changing BOTH to match a typo is the failure this cannot catch, which is why
// each field's blast radius is spelled out above.
const SHIPPED = {
  smash: { ledger: "smash", gameName: "Smash Bros", keyPrefix: "smash", wsType: "smash_updated", table: "smash_sessions", route: "smash" },
  mariokart: { ledger: "mario_kart", gameName: "Mario Kart", keyPrefix: "mk", wsType: "mario_kart_updated", table: "game_sessions", route: "mariokart" },
  marioparty: { ledger: "mario_party", gameName: "Mario Party", keyPrefix: "mp", wsType: "mario_party_updated", table: "game_sessions", route: "marioparty" },
  pingpong: { ledger: "pingpong", gameName: "Ping Pong", keyPrefix: "pp", wsType: "ping_pong_updated", table: "game_sessions", route: "pingpong" },
  // Pinned the day it shipped (2026-07-29), the same discipline as the four
  // above: from here on, changing any of these without changing production
  // orphans blackjack's history silently.
  blackjack: { ledger: "blackjack", gameName: "Blackjack", keyPrefix: "blackjack", wsType: "blackjack_updated", table: "game_sessions", route: "blackjack" },
  roulette: { ledger: "roulette", gameName: "Roulette", keyPrefix: "roulette", wsType: "roulette_updated", table: "game_sessions", route: "roulette" },
  // Craps' wsType is BARE, with no _updated suffix, unlike every other pack.
  // Pinned here so it is a deliberate value rather than something a later pass
  // "tidies": both sides read it from the registry, so it works, but it is
  // the odd one out and the test should say so out loud.
  craps: { ledger: "craps", gameName: "Craps", keyPrefix: "craps", wsType: "craps", table: "game_sessions", route: "craps" },
  // The co-op pack. Pinned the day it shipped (2026-07-30). Note the ledger is
  // snake_case (`casino_run`) while the route is not (`casinorun`), and that is
  // the same split Mario Kart has, and the registry exists precisely so the
  // two spellings can differ without anything drifting.
  casinorun: { ledger: "casino_run", gameName: "Casino Run", keyPrefix: "casinorun", wsType: "casino_run", table: "game_sessions", route: "casinorun" },
  // The tabletop one. Pinned the day it shipped (2026-08-04). Note gameName is
  // "Board Game" SINGULAR and there is exactly one of these rows per crew: the
  // per-title breakdown lives on matches.label, and a games row per title would
  // split this pack into a leaderboard tab per board game.
  boardgame: { ledger: "boardgame", gameName: "Board Game", keyPrefix: "bg", wsType: "boardgame_updated", table: "game_sessions", route: "boardgame" },
  // The other title-night one. Pinned the day it shipped (2026-08-09). It runs
  // on Board Game's engine, screens and routes and is still its OWN pack: a
  // separate ledger and a separate games row, because "good at board games" and
  // "good at card games" are different claims and one row per pack is what
  // keeps a leaderboard tab meaningful.
  cardtable: { ledger: "cardtable", gameName: "Card Table", keyPrefix: "ct", wsType: "cardtable_updated", table: "game_sessions", route: "cardtable" },
  // The SECRET one. Pinned the day its server half shipped (2026-08-10). It is
  // a title night in shape and deliberately NOT on the title-night layer, and
  // the same one-games-row-per-pack rule applies: the title (Werewolf, Secret
  // Hitler, ...) is a label on the result, never a games row of its own.
  deduction: { ledger: "deduction", gameName: "Social Deduction", keyPrefix: "sd", wsType: "deduction_updated", table: "game_sessions", route: "deduction" },
} as const;

test("every pack's shipped identifiers are unchanged", () => {
  for (const [key, want] of Object.entries(SHIPPED)) {
    const got = SESSION_PACKS[key as keyof typeof SESSION_PACKS];
    assert.ok(got, `no registry entry for ${key}`);
    // ledger: games.pack + game_sessions.pack. A change orphans every row.
    assert.equal(got.ledger, want.ledger, `${key}.ledger`);
    // gameName: games.name, the crew leaderboard's join key. A change splits
    // the pack's history across two tabs.
    assert.equal(got.gameName, want.gameName, `${key}.gameName`);
    // keyPrefix: leads matches.externalKey. A change orphans dedupe and undo.
    assert.equal(got.keyPrefix, want.keyPrefix, `${key}.keyPrefix`);
    // wsType: a change kills live sync with no error anywhere.
    assert.equal(got.wsType, want.wsType, `${key}.wsType`);
    // table: the Smash/shared split, which must not be "simplified".
    assert.equal(got.table, want.table, `${key}.table`);
    // route: the URL segment AND the quickplay route the server registers.
    assert.equal(got.route, want.route, `${key}.route`);
  }
});

test("the registry holds exactly the session packs, in order", () => {
  // ORDER IS SHIP ORDER, and it is asserted rather than incidental: this list
  // feeds the event TV's tiebreak, so a new pack inserted ABOVE a live one
  // would silently re-rank the live one. Append; never insert.
  assert.deepEqual(SESSION_PACK_KEYS, ["smash", "mariokart", "marioparty", "pingpong", "blackjack", "roulette", "craps", "casinorun", "boardgame", "cardtable", "deduction"]);
});

test("Ping Pong's ledger key is pingpong, not ping_pong", () => {
  // The specific mistake this registry was built after: the event TV resolver
  // and the event detail payload each hand-wrote a ledger->client table
  // keyed "ping_pong", a spelling that exists nowhere. Both lookups missed, so
  // a live Ping Pong session was invisible to the TV and never showed "live
  // now" on its tile, silently, because a missing key is just undefined.
  assert.equal(SESSION_PACKS.pingpong.ledger, "pingpong");
  assert.equal(PACK_BY_LEDGER["pingpong"], "pingpong");
  assert.equal(PACK_BY_LEDGER["ping_pong"], undefined);
});

// ---------- 2. the invariants ----------

test("every identifier that is used as a key is unique across packs", () => {
  const fields = ["ledger", "gameName", "keyPrefix", "route", "wsType"] as const;
  for (const f of fields) {
    const values = SESSION_PACK_KEYS.map((k) => SESSION_PACKS[k][f] as string);
    assert.equal(
      new Set(values).size,
      values.length,
      `${f} is not unique across packs: ${values.join(", ")}`,
    );
  }
});

test("PACK_BY_LEDGER round-trips every pack", () => {
  // The lookup the server does on every game_sessions row it reads.
  for (const key of SESSION_PACK_KEYS) {
    assert.equal(PACK_BY_LEDGER[SESSION_PACKS[key].ledger], key, key);
  }
  assert.equal(Object.keys(PACK_BY_LEDGER).length, SESSION_PACK_KEYS.length);
});

test("PACK_WS_TYPES covers every pack, in registry order", () => {
  // The event TV subscribes with exactly this list. A pack missing from it
  // does not error; the TV simply never re-resolves for that game.
  assert.deepEqual(PACK_WS_TYPES, SESSION_PACK_KEYS.map((k) => SESSION_PACKS[k].wsType));
});

test("every pack has a non-empty display name and emoji", () => {
  for (const key of SESSION_PACK_KEYS) {
    const p = SESSION_PACKS[key];
    assert.ok(p.name.length > 0, `${key}.name`);
    assert.ok(p.emoji.length > 0, `${key}.emoji`);
    assert.ok(p.quickTitle.length > 0, `${key}.quickTitle`);
  }
});

// ---------- display lookups, keyed the way the database answers ----------

test("packEmoji resolves every value games.pack can hold", () => {
  // Keyed by the LEDGER spelling, because that is what a row read back out of
  // the database carries. The recap card's hand-written table got this wrong
  // for Beerio and nobody saw it, because a wrong emoji does not throw.
  assert.equal(packEmoji("smash"), "\u{1F94A}"); // 🥊
  assert.equal(packEmoji("mario_kart"), "\u{1F3CE}\u{FE0F}"); // 🏎️
  // Mario Party gave the die up to craps on 2026-07-30 and took a star. Safe,
  // because emoji is DERIVED from the registry and never stored.
  assert.equal(packEmoji("mario_party"), "\u{2B50}"); // ⭐
  assert.equal(packEmoji("craps"), "\u{1F3B2}"); // 🎲
  assert.equal(packEmoji("pingpong"), "\u{1F3D3}"); // 🏓
  assert.equal(packEmoji("blackjack"), "\u{1F0CF}"); // 🃏
  assert.equal(packEmoji("roulette"), "\u{1F3A1}"); // 🎡
  assert.equal(packEmoji("boardgame"), "\u{265F}\u{FE0F}"); // ♟️
  assert.equal(packEmoji(BEERIO_LEDGER), "\u{1F37A}"); // 🍺
  assert.equal(packEmoji(GENERIC_LEDGER), "\u{1F3C6}"); // 🏆
});

test("beerio's ledger key is beerio_kart, which is what the recap card used to miss", () => {
  assert.equal(BEERIO_LEDGER, "beerio_kart");
  // The old table was keyed "beerio", so every Beerio night drew the fallback.
  assert.notEqual(packEmoji("beerio_kart"), packEmoji("beerio"));
  assert.equal(packEmoji("beerio"), "\u{1F3C6}"); // an unknown key IS the trophy
});

test("an unknown or missing pack falls back rather than throwing", () => {
  assert.equal(packEmoji("air_hockey"), "\u{1F3C6}"); // 🏆
  assert.equal(packEmoji(null), "\u{1F3C6}");
  assert.equal(packEmoji(undefined), "\u{1F3C6}");
  assert.equal(packDisplayName("air_hockey"), "Game");
  assert.equal(packDisplayName(null), "Game");
});

test("packDisplayName agrees with the registry for every session pack", () => {
  for (const key of SESSION_PACK_KEYS) {
    assert.equal(packDisplayName(SESSION_PACKS[key].ledger), SESSION_PACKS[key].name, key);
  }
});

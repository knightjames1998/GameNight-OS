// One registry of what a pack IS. Both sides import it.
//
// THE PROBLEM THIS EXISTS TO KILL. Every pack had two spellings and nothing
// reconciled them. The server's key (games.pack, and half of the game_sessions
// primary key) reads smash / mario_kart / mario_party / pingpong; the client's
// route segment and picker key read smash / mariokart / marioparty / pingpong.
// They agree for two packs and disagree for the other two, which is the worst
// possible arrangement: every consumer only ever touched one side, so it all
// worked, and nothing anywhere pointed out that the two lists existed.
//
// The next pack was a coin flip. Call it airhockey on both sides and nothing
// happens. Call it air_hockey on the server and airhockey on the client
// (following Mario Kart's own example) and everything compiles, the picker
// works, the session runs, and the recap card silently draws a blank emoji
// while the stats tab shows nothing, because two string literals in different
// files disagree and no type connects them.
//
// That is not hypothetical. The recap card's emoji table was keyed "beerio"
// while Beerio writes games.pack = "beerio_kart", so every Beerio night on
// every recap card has been drawing the fallback trophy instead of its beer.
// Nobody noticed, because a wrong emoji does not throw. This file is what
// makes that class of mistake a compile error instead.
//
// ADDING A PACK: add one entry here. Every derived table in the app updates
// with it, and the places that genuinely cannot be data-driven (the lazy route
// imports in App.tsx, which Vite needs as static literals to split chunks, and
// the router mount order in server/index.ts, where public TV routers must come
// before the authed ones) will fail to compile or are named in the checklist.
//
// WHAT MUST NEVER CHANGE for an existing pack, because both are silent:
//   - `ledger`. It is games.pack and game_sessions.pack. Changing it orphans
//     every row already written under the old value: nothing errors, the
//     leaderboard just quietly stops matching history.
//   - `gameName`. It is games.name, which is the JOIN KEY for the crew
//     leaderboard tabs. Renaming it splits a pack's history across two tabs.
//   - `keyPrefix`. It leads matches.externalKey, so a change orphans the
//     dedupe and undo paths the same silent way.
// All three are asserted against their shipped values in the tests.

/** Everything the app needs to know to identify one session pack. */
export interface SessionPackDef {
  /** games.pack + game_sessions.pack. The LEDGER key. Never change it. */
  ledger: string;
  /** games.name. The crew leaderboard join key. Never change it. */
  gameName: string;
  /** matches.externalKey prefix. Never change it. */
  keyPrefix: string;
  /** The client route segment: /smash, and /api/quickplay/smash. */
  route: string;
  /** The live-sync message type this pack broadcasts. */
  wsType: string;
  /** Which table the live session row lives in. */
  table: "game_sessions" | "smash_sessions";
  /** Display name in the picker and on the event page. */
  name: string;
  /** Display emoji, everywhere one is shown. */
  emoji: string;
  /** Event title when this pack is started from quick play. */
  quickTitle: string;
}

/**
 * The packs that run a server-side session, keyed by their CLIENT route
 * segment, because that is the spelling that appears in a URL a person can
 * see. The server spelling is the `ledger` field, so the two can never drift
 * apart again without one of them failing to compile.
 */
export const SESSION_PACKS = {
  smash: {
    ledger: "smash",
    gameName: "Smash Bros",
    keyPrefix: "smash",
    route: "smash",
    wsType: "smash_updated",
    // Smash predates the shared table and keeps its own, keyed by eventId
    // alone. Collapsing that is a data migration, not a refactor.
    table: "smash_sessions",
    name: "Smash Bros",
    emoji: "\u{1F94A}", // 🥊
    quickTitle: "Smash Night",
  },
  mariokart: {
    ledger: "mario_kart",
    gameName: "Mario Kart",
    keyPrefix: "mk",
    route: "mariokart",
    wsType: "mario_kart_updated",
    table: "game_sessions",
    name: "Mario Kart",
    emoji: "\u{1F3CE}\u{FE0F}", // 🏎️
    quickTitle: "Mario Kart",
  },
  marioparty: {
    ledger: "mario_party",
    gameName: "Mario Party",
    keyPrefix: "mp",
    route: "marioparty",
    wsType: "mario_party_updated",
    table: "game_sessions",
    name: "Mario Party",
    // ⭐ rather than 🎲: craps has the stronger claim on the die, and stars ARE
    // Mario Party's scoring unit. Safe to change because emoji is DERIVED from
    // this registry and never written to the database. Only ledger, gameName
    // and keyPrefix are permanent.
    emoji: "\u{2B50}", // ⭐
    quickTitle: "Mario Party",
  },
  pingpong: {
    ledger: "pingpong",
    gameName: "Ping Pong",
    keyPrefix: "pp",
    route: "pingpong",
    wsType: "ping_pong_updated",
    table: "game_sessions",
    name: "Ping Pong",
    emoji: "\u{1F3D3}", // 🏓
    quickTitle: "Ping Pong",
  },
  // The CASINO GROUP (blackjack, roulette, craps, poker). Four separate packs
  // on purpose, each with its own ledger key, because a blackjack net and a
  // poker net are different skills and belong on different leaderboard tabs.
  // They share one engine (packages/shared/src/cashgame.ts), so each pack file
  // stays thin.
  //
  // ORDER IS SHIP ORDER, and it is not decorative: SESSION_PACK_KEYS feeds the
  // event TV's TIEBREAK, so inserting a new pack ABOVE one that is already
  // live would silently re-rank the live one on an exact-millisecond tie.
  // Append; never insert.
  blackjack: {
    ledger: "blackjack",
    gameName: "Blackjack",
    keyPrefix: "blackjack",
    route: "blackjack",
    wsType: "blackjack_updated",
    table: "game_sessions",
    name: "Blackjack",
    emoji: "\u{1F0CF}", // 🃏
    quickTitle: "Blackjack night",
  },
  roulette: {
    ledger: "roulette",
    gameName: "Roulette",
    keyPrefix: "roulette",
    route: "roulette",
    wsType: "roulette_updated",
    table: "game_sessions",
    name: "Roulette",
    emoji: "\u{1F3A1}", // 🎡
    quickTitle: "Roulette night",
  },
  craps: {
    ledger: "craps",
    gameName: "Craps",
    keyPrefix: "craps",
    route: "craps",
    // Bare, not "craps_updated". The other packs carry the suffix; this one is
    // as the session brief specified it. It works because both sides read the
    // string from THIS entry, which is the whole point of the registry, but
    // it is the odd one out, and changing it is a one-line edit (wsType is not
    // written to the database).
    wsType: "craps",
    table: "game_sessions",
    name: "Craps",
    emoji: "\u{1F3B2}", // 🎲
    quickTitle: "Craps night",
  },
  // The CO-OP one. In the casino group and sharing its screens' tokens, but
  // NOT its engine: one shared bank against a target instead of per-player
  // nets, so it runs on packages/shared/src/casinorun.ts. Its own ledger key
  // is the accepted cost: a co-op leg played at blackjack lands here, not
  // under Blackjack, because those rows do not obey a per-player net stat.
  casinorun: {
    ledger: "casino_run",
    gameName: "Casino Run",
    keyPrefix: "casinorun",
    route: "casinorun",
    wsType: "casino_run",
    table: "game_sessions",
    name: "Casino Run",
    emoji: "\u{1F3B0}", // 🎰
    quickTitle: "Casino Run",
  },
  // THE TABLETOP ONE. A crew plays board games on a night and each board game
  // played is one recorded result: title on matches.label (Mario Party's
  // pattern for its board), placement from the tapped finish order, one games
  // row for the whole pack.
  //
  // ONE `games` ROW, NEVER ONE PER TITLE. Per-title stats derive from the
  // label, and a row per title would split this pack into a leaderboard tab per
  // board game, which is exactly what the gameName warning at the top of this
  // file exists to prevent.
  boardgame: {
    ledger: "boardgame",
    gameName: "Board Game",
    keyPrefix: "bg",
    route: "boardgame",
    wsType: "boardgame_updated",
    table: "game_sessions",
    name: "Board Game",
    emoji: "\u{265F}\u{FE0F}", // ♟️
    quickTitle: "Board game night",
  },
  // THE OTHER TITLE-NIGHT ONE. Same evening as Board Game with a different box
  // on the table, and it runs on the same engine, the same screens and the same
  // routes (packages/shared/src/titlenight.ts,
  // apps/server/src/titlenight-runtime.ts).
  //
  // A SEPARATE PACK RATHER THAN A BOARD GAME FORMAT, deliberately: "good at
  // board games" and "good at card games" are different claims about a person,
  // and one `games` row per pack is what keeps a leaderboard tab meaningful.
  // Half its titles are partnership games, which is what the team primitive and
  // the title-driven default shape were built for.
  cardtable: {
    ledger: "cardtable",
    gameName: "Card Table",
    keyPrefix: "ct",
    route: "cardtable",
    wsType: "cardtable_updated",
    table: "game_sessions",
    name: "Card Table",
    emoji: "\u{2660}\u{FE0F}", // ♠️
    quickTitle: "Card table night",
  },
} as const satisfies Record<string, SessionPackDef>;

/**
 * Every session pack, as a union. Derived from the map, so a pack without an
 * entry is a compile error at every site that switches on a pack rather than
 * a blank space on a screen.
 */
export type SessionPackKey = keyof typeof SESSION_PACKS;

/** Every session pack key, in registry order. */
export const SESSION_PACK_KEYS = Object.keys(SESSION_PACKS) as SessionPackKey[];

/**
 * The live-sync types a session pack may broadcast, derived rather than
 * restated. A typo'd wsType kills live sync SILENTLY: the client never
 * matches the message and screens stop updating until someone refreshes,
 * so there must be exactly one place these strings exist.
 */
export type PackWsType = (typeof SESSION_PACKS)[SessionPackKey]["wsType"];

/** Every pack ws type, for a client that wants to listen to all of them. */
export const PACK_WS_TYPES = SESSION_PACK_KEYS.map((k) => SESSION_PACKS[k].wsType) as PackWsType[];

/**
 * Ledger spelling -> pack key. This is the lookup that used to be written by
 * hand, differently, in three files (the event TV resolver, the event detail
 * payload, and the recap card's emoji table).
 */
export const PACK_BY_LEDGER: Record<string, SessionPackKey> = Object.fromEntries(
  SESSION_PACK_KEYS.map((k) => [SESSION_PACKS[k].ledger, k]),
) as Record<string, SessionPackKey>;

/** The two ledger packs that are not session packs, so have no route or wsType. */
export const BEERIO_LEDGER = "beerio_kart";
export const GENERIC_LEDGER = "generic";

/**
 * Display name and emoji for ANY value that can appear in games.pack, which is
 * every session pack plus Beerio and the generic bracket. Keyed by the
 * LEDGER spelling, because that is what a row read back out of the database
 * carries.
 */
export const LEDGER_PACK_DISPLAY: Record<string, { name: string; emoji: string }> = {
  ...Object.fromEntries(
    SESSION_PACK_KEYS.map((k) => [SESSION_PACKS[k].ledger, { name: SESSION_PACKS[k].name, emoji: SESSION_PACKS[k].emoji }]),
  ),
  [BEERIO_LEDGER]: { name: "Beerio Kart", emoji: "\u{1F37A}" }, // 🍺
  [GENERIC_LEDGER]: { name: "Tournament", emoji: "\u{1F3C6}" }, // 🏆
};

/** Emoji for a games.pack value; the trophy is the honest fallback for an unknown one. */
export const packEmoji = (ledgerKey: string | null | undefined): string =>
  (ledgerKey ? LEDGER_PACK_DISPLAY[ledgerKey]?.emoji : undefined) ?? "\u{1F3C6}"; // 🏆

/** Display name for a games.pack value. */
export const packDisplayName = (ledgerKey: string | null | undefined): string =>
  (ledgerKey ? LEDGER_PACK_DISPLAY[ledgerKey]?.name : undefined) ?? "Game";

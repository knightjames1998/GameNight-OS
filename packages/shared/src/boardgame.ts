// Board Game pack: its config, its titles, and its names for the shared
// title-night layer.
//
// WHAT THIS FILE USED TO BE: the whole pack. The engine that lived here was
// extracted into titlenight.ts on 2026-08-05, when Card table arrived as the
// second example of the same idea. That is deliberately the same moment the
// casino group's shared screens were extracted: blackjack shipped alone and its
// money board and money routes were pulled out when ROULETTE turned up, rather
// than guessed at from one pack. One example is a pack; two is a layer.
//
// WHAT IS LEFT is what a pack genuinely owns: its curated title list, its
// partnership defaults, its cap, and the noun it calls one recorded unit. Card
// table is this file with different values, which is the whole argument for two
// packs sharing one implementation rather than one pack with a toggle: "good at
// board games" and "good at card games" are different claims, and one `games`
// row per pack is what keeps a leaderboard tab meaningful.
//
// THE TYPE ALIASES BELOW ARE DELIBERATE. The pack keeps its own vocabulary
// (BgGame, BgSessionState) pointing at the layer's types, so every consumer
// still reads in the pack's terms and the extraction did not turn into a rename
// of forty call sites.

import {
  canonicalTitle,
  currentTnSides,
  newTnState,
  summarizeTnNight,
  tnGameLines,
  tnPlacements,
  validateTnOrder,
  type ScoreGrain,
  type TitleNightConfig,
  type TnGame,
  type TnLedgerLine,
  type TnLine,
  type TnNightSummary,
  type TnOrderEntry,
  type TnPlayer,
  type TnPlayerStat,
  type TnSessionState,
} from "./titlenight.js";
import { singletonSides, type Side } from "./teams.js";

/**
 * How many people can sit at one board game.
 *
 * PER PACK, and that matters: `validateFfa` caps at 8, and that 8 IS
 * LOAD-BEARING FOR SMASH (Ultimate seats 8, and Smashdown's
 * `floor(rosterSize / playerCount)` battle cap is arithmetic against it), so
 * raising the global would have quietly changed Smashdown's caps.
 */
export const BOARD_GAME_MAX_PLAYERS = 12;

/**
 * A convenience list, NOT a roster. It exists so a crew's first night is not a
 * blank text box, and free text is always allowed on top of it. The real
 * defence against a split history is the crew's OWN recents, offered first.
 *
 * Codenames is deliberately absent: it belongs to the Party games pack.
 *
 * PANDEMIC IS IN THIS LIST AND IS FULLY CO-OPERATIVE, which the team primitive
 * does not model (`validateSides` requires at least two sides), so this pack
 * still opens it free-for-all and records a finish order for a game where
 * everybody wins or loses together. That is wrong, it is known, and it is
 * logged in BACKLOG under co-operative titles rather than bodged here.
 */
export const BOARD_GAME_TITLES: readonly string[] = [
  "Catan",
  "Ticket to Ride",
  "Wingspan",
  "Carcassonne",
  "Azul",
  "Monopoly",
  "Risk",
  "Scrabble",
  "Clue",
  "Pandemic",
  "7 Wonders",
  "Splendor",
  "Dominion",
];

/**
 * The pack, as the shared layer needs it.
 *
 * NO PARTNERSHIP DEFAULTS, and that is a judgement rather than an omission:
 * none of the thirteen titles above is a partnership game by default. The
 * capability is here the moment one is (Card table uses it heavily), and the
 * backlog carries the item to revisit this list.
 */
export const BOARD_GAME_CONFIG: TitleNightConfig = {
  titles: BOARD_GAME_TITLES,
  maxPlayers: BOARD_GAME_MAX_PLAYERS,
  unit: "board game",
};

// ---------- the pack's vocabulary over the layer's types ----------

export type BgPlayer = TnPlayer;
export type BgOrderEntry = TnOrderEntry;
export type BgLine = TnLine;
export type BgGame = TnGame;
export type BgSessionState = TnSessionState;
export type BgLedgerLine = TnLedgerLine;
export type BgNightSummary = TnNightSummary;
export type BgPlayerStat = TnPlayerStat;

export function newBgState(opts: { roster: BgPlayer[]; sides?: Side[]; grain?: ScoreGrain }): BgSessionState {
  return newTnState(opts);
}

export const summarizeBgNight = summarizeTnNight;
export const bgGameLines = tnGameLines;

/**
 * Placement from a tapped order of PLAYERS, which is the free-for-all shape
 * this pack records by default.
 *
 * Kept as the pack's own entry point so a caller does not have to build
 * singleton sides to say "a board game night". It is a thin call onto the
 * layer, so the ranking rule itself still lives in exactly one place, and with
 * singleton sides `sideIdFor` writes null on every row: byte-identical to what
 * this pack wrote before the layer existed.
 */
export function placementsFromOrder(
  order: { playerId: string; tiedWithAbove?: boolean; score?: number | null }[],
): BgLine[] {
  const sides = singletonSides(order.map((e) => e.playerId));
  return tnPlacements(
    order.map((e, i) => ({ sideId: sides[i]!.id, tiedWithAbove: e.tiedWithAbove, score: e.score ?? null })),
    sides,
    "side",
  );
}

/** Validate a tapped order of players against the session roster. */
export function validateBgOrder(order: { playerId: string }[], roster: BgPlayer[]): string | null {
  const known = new Set(roster.map((p) => p.id));
  const seen = new Set<string>();
  for (const e of order) {
    if (!known.has(e.playerId)) return "Somebody in the finish order is not in the session";
    if (seen.has(e.playerId)) return "A player can only appear once in the finish order";
    seen.add(e.playerId);
  }
  // The SIZE rule is the layer's, so this pack cannot drift from Card table on
  // what fits in one game.
  const sides = singletonSides(order.map((e) => e.playerId));
  const state: BgSessionState = { ...newTnState({ roster }), sideSets: [{ fromIdx: 0, sides }] };
  return validateTnOrder(
    sides.map((s) => ({ sideId: s.id })),
    state,
    BOARD_GAME_CONFIG,
  );
}

export { canonicalTitle, currentTnSides as currentBgSides };
export { normalizeTitle } from "./titlenight.js";

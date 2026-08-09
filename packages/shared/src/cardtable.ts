// Card Table pack: its config, its titles, its partnership defaults, and its
// names for the shared title-night layer.
//
// This file is Board Game's config file with different values, and that is the
// whole argument the extraction was for. The engine is titlenight.ts, the
// screens are apps/web/src/titlenight/, the routes are titlenight-runtime.ts,
// and what a pack owns is what a pack should: what it is called, what it seats,
// what it suggests, and which of its titles are partnership games.
//
// WHY IT IS NOT A BOARD GAME FORMAT. "Good at board games" and "good at card
// games" are different claims about a person, and one `games` row per pack is
// what keeps a leaderboard tab meaningful. Two packs sharing one implementation
// is the cheap version of that; one pack with a toggle is not.

import {
  canonicalTitle,
  currentTnSides,
  newTnState,
  summarizeTnNight,
  tnGameLines,
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
import type { Side } from "./teams.js";

/**
 * How many people can sit at one card game.
 *
 * TWELVE, the same as Board Game and for the same reason: it is a per-pack cap,
 * and `validateFfa`'s 8 IS LOAD-BEARING FOR SMASH (Ultimate seats 8, and
 * Smashdown's `floor(rosterSize / playerCount)` battle cap is arithmetic
 * against it), so nothing here goes near the global.
 *
 * Twelve is generous for the titles below and that is fine: the cap exists to
 * catch a mis-tap, not to referee a kitchen table. President with ten is a real
 * evening.
 */
export const CARD_TABLE_MAX_PLAYERS = 12;

/**
 * A convenience list, NOT a roster. It exists so a crew's first night is not a
 * blank text box, and free text is always allowed on top of it. The real
 * defence against a split history is the crew's OWN recents, offered first.
 *
 * Poker is deliberately absent. It is money, it settles, and it belongs to the
 * casino group's engine (cashgame.ts) rather than to a pack that records a
 * finish order. A poker night recorded here would produce placements with no
 * money attached, which is the wrong record of the evening.
 */
export const CARD_TABLE_TITLES: readonly string[] = [
  "Euchre",
  "Spades",
  "Hearts",
  "Cribbage",
  "Rummy",
  "Gin",
  "Uno",
  "President",
];

/**
 * Which titles open with sides already on, and how many.
 *
 * EUCHRE AND SPADES ARE PARTNERSHIP GAMES AND SHOULD OPEN THAT WAY; the rest
 * should not. A DEFAULT IS A STARTING POSITION, NEVER A RULE (James,
 * 2026-08-05): three-handed euchre exists and partnership rummy exists, so the
 * host overrides in one tap and the app never referees somebody's kitchen
 * table. A free-typed title has no default and opens free-for-all, because
 * there is nothing to look it up in.
 *
 * Cribbage is the interesting omission. Four-handed cribbage IS partnership
 * and two-handed is the game most people mean, so a default of 2 would be
 * wrong more often than right; it stays free-for-all and the host puts the
 * pairs on when they are playing four. With exactly two players the two shapes
 * are the same arrangement anyway, so the common cribbage night costs nothing
 * either way.
 */
export const CARD_TABLE_PARTNERSHIPS: Readonly<Record<string, number>> = {
  Euchre: 2,
  Spades: 2,
};

export const CARD_TABLE_CONFIG: TitleNightConfig = {
  titles: CARD_TABLE_TITLES,
  partnerships: CARD_TABLE_PARTNERSHIPS,
  maxPlayers: CARD_TABLE_MAX_PLAYERS,
  // What one recorded result is called. It reaches the crew in the layer's
  // validation copy ("Need at least 2 players in a card game"), which is why it
  // is a noun a person would say out loud rather than "unit" or "result".
  unit: "card game",
};

// ---------- the pack's vocabulary over the layer's types ----------

export type CtPlayer = TnPlayer;
export type CtOrderEntry = TnOrderEntry;
export type CtLine = TnLine;
export type CtGame = TnGame;
export type CtSessionState = TnSessionState;
export type CtLedgerLine = TnLedgerLine;
export type CtNightSummary = TnNightSummary;
export type CtPlayerStat = TnPlayerStat;

export function newCtState(opts: { roster: CtPlayer[]; sides?: Side[]; grain?: ScoreGrain }): CtSessionState {
  return newTnState(opts);
}

export const summarizeCtNight = summarizeTnNight;
export const ctGameLines = tnGameLines;

export { canonicalTitle, currentTnSides as currentCtSides };

// Board Game pack server routes: its identity, and nothing else.
//
// WHAT THIS FILE USED TO BE: 570 lines of routing, validation and two stats
// queries. All of it moved to titlenight-runtime.ts on 2026-08-09, when Card
// Table arrived as the second example of the same idea, and for the same
// reason the casino group's money routes moved when roulette turned up: one
// pack is a pack, two is a group. Nothing about what those routes DO changed,
// which is what packages/shared/tests/boardgame-pinned.test.ts exists to prove.
//
// The pack is still its own everything that matters to a crew: one session per
// night on the shared game_sessions table keyed (eventId, "boardgame"), the
// LEDGER UNIT IS THE GAME rather than the night, and one `games` row for the
// pack so "good at board games" stays one leaderboard tab.
//
//   - the TITLE goes on matches.label, which is Mario Party's pattern for its
//     board,
//   - placement comes from the tapped finish order, with ties as
//     co-placements (competition ranking),
//   - an optional per-player score rides on match_participants.meta and is a
//     NOTE: it never derives, adjusts, validates or corrects the placement.
//
// THE ONE REAL RISK IN THIS PACK IS STILL THE TITLE, and the defence is still
// in two places, both now in the runtime: the crew's own recents are offered
// first, and every submitted title is canonicalized on the way in, server-side,
// so a stale client cannot write a third spelling of "Catan".

import { BOARD_GAME_CONFIG } from "@gamenight/shared";
import { createTitleNightPack } from "./titlenight-runtime.js";
import type { GuestCreditResult } from "./guest-link-util.js";

const pack = createTitleNightPack({
  key: "boardgame",
  // matches.format for every row this pack writes. Fixed, forever: it is what
  // the crew leaderboard's format breakdown groups on.
  format: "boardgame",
  config: BOARD_GAME_CONFIG,
});

export const boardGameRouter = pack.router;
export const boardGameTvRouter = pack.tvRouter;
export const boardGameRuntime = pack.runtime;

/** Distinct guest display names across this crew's Board Game sessions. */
export const guestNamesBoardGame = (groupId: string): Promise<string[]> => pack.guestNames(groupId);

/** Credit (or preview) every recoverable board game the guest played. */
export const creditGuestBoardGame = (
  groupId: string,
  guestName: string,
  memberId: string,
  dryRun: boolean,
): Promise<GuestCreditResult> => pack.creditGuest(groupId, guestName, memberId, dryRun);

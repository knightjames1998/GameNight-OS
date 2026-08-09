// Card Table pack server routes: its identity, and nothing else.
//
// Every route is the title-night runtime's (titlenight-runtime.ts), the same
// ten Board Game serves, because the two packs have one data model: a night is
// a sequence of named games with a tapped finish order. What is below is the
// registry key, the format string and the config, which is the entire
// difference between the two packs on the server.
//
// This file existing at fifty lines rather than five hundred is the whole
// return on the extraction, and it is the same return the casino group already
// pays: roulette's pack file is thirty lines of identity on top of blackjack's
// money routes.
//
// PARTNERSHIPS ARE WHY THIS PACK MATTERS to everything queued behind it. Euchre
// and Spades open with sides already on, which makes Card Table the first pack
// to use the team primitive and the title-driven default shape together, and
// the proof that Social deduction and Party games can be config files too.

import { CARD_TABLE_CONFIG } from "@gamenight/shared";
import { createTitleNightPack } from "./titlenight-runtime.js";
import type { GuestCreditResult } from "./guest-link-util.js";

const pack = createTitleNightPack({
  key: "cardtable",
  // matches.format for every row this pack writes. Fixed, forever: it is what
  // the crew leaderboard's format breakdown groups on, and a change orphans
  // every row already written.
  format: "cardtable",
  config: CARD_TABLE_CONFIG,
});

export const cardTableRouter = pack.router;
export const cardTableTvRouter = pack.tvRouter;
export const cardTableRuntime = pack.runtime;

/** Distinct guest display names across this crew's Card Table sessions. */
export const guestNamesCardTable = (groupId: string): Promise<string[]> => pack.guestNames(groupId);

/** Credit (or preview) every recoverable card game the guest played. */
export const creditGuestCardTable = (
  groupId: string,
  guestName: string,
  memberId: string,
  dryRun: boolean,
): Promise<GuestCreditResult> => pack.creditGuest(groupId, guestName, memberId, dryRun);

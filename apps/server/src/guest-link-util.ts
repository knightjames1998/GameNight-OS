// Shared helpers for the one-time guest -> member stat backfill.
//
// Guests are never written into the ledger (match_participants.userId is NOT
// NULL), so crediting a guest's past results means RE-MATERIALIZING each of
// their completed games from the pack's stored jsonb, this time stamped with
// the linked member's userId. Each recoverable pack (generic brackets, Smash,
// Mario Kart, Mario Party, Ping Pong) exports a guestNames* and a creditGuest*
// adapter that this module's types describe; guest-link.ts orchestrates them.
// Beerio is not recoverable (opaque vendored state) and is excluded.
//
// This lives in its own module so the pack materializers can import the shared
// helper without a cycle back through the orchestrating router.

import { getDb, matches, matchParticipants, and, eq } from "@gamenight/db";

// One row the backfill would credit (dry run) or did credit to the member.
export interface GuestCreditItem {
  pack: string; // "bracket" | "smash" | "mario_kart" | "mario_party" | "pingpong"
  packLabel: string; // human-friendly pack name, e.g. "Smash Bros"
  eventId: string;
  label: string; // the game / board / round / format, human-readable
  date: string | null; // ISO of the game when the pack records one, else null
  placement: number | null;
  isWinner: boolean;
}

// What a pack's creditGuest adapter returns.
export interface GuestCreditResult {
  items: GuestCreditItem[]; // rows that WOULD be credited (dry run) or were
  written: number; // rows actually written (0 on a dry run)
}

/**
 * External keys within one event where the member ALREADY has a participant
 * row. The backfill skips any unit whose key is in here, so re-running the
 * same link is a no-op and existing rows are never disturbed. One query per
 * event, then in-memory lookups.
 */
export async function memberCreditedKeys(
  eventId: string,
  memberId: string,
): Promise<Set<string>> {
  const rows = await getDb()
    .select({ key: matches.externalKey })
    .from(matches)
    .innerJoin(matchParticipants, eq(matchParticipants.matchId, matches.id))
    .where(and(eq(matches.eventId, eventId), eq(matchParticipants.userId, memberId)));
  const out = new Set<string>();
  for (const r of rows) if (r.key) out.add(r.key);
  return out;
}

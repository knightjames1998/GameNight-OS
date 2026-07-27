// One place to write participant rows into the lifetime ledger.
//
// Every pack's materialize* used to loop over its result lines and await one
// insert per line, so an eight-player Smash FFA game was eight sequential
// round trips and a twelve-racer Beerio grand prix was twelve. They are all
// the same statement with different values, so they go in one.
//
// ON CONFLICT (matchId, userId) DO NOTHING behaves identically for a
// multi-row insert, so the guest-link backfill stays idempotent: re-running
// it over a match the member already has still writes nothing.
//
// Callers must hand over rows already deduplicated by userId. A single
// statement carrying the same (matchId, userId) twice is not something the
// conflict target can be relied on to sort out, and it is reachable in real
// life: two guest slots typed with the same name both resolve to one member
// through the link map.

import { getDb, matchParticipants } from "@gamenight/db";

type Db = ReturnType<typeof getDb>;
type ParticipantRow = typeof matchParticipants.$inferInsert;

/** Insert every participant row for one match. No-op on an empty list. */
export async function insertParticipants(db: Db, rows: ParticipantRow[]): Promise<void> {
  if (!rows.length) return;
  await db.insert(matchParticipants).values(rows).onConflictDoNothing();
}

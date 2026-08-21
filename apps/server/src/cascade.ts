// THE ONE CASCADE LIST IN THE APP.
//
// This schema has NO `ON DELETE CASCADE` anywhere: every foreign key is a plain
// `references()`. That is deliberate and logged (DECISION LOG, 2026-08-20), so
// deleting a crew or an event means deleting its children by hand, in an order
// no foreign key can refuse.
//
// WHY IT IS ONE MODULE RATHER THAN TWO LISTS IN TWO HANDLERS. It used to be
// two, and the two had already drifted: `groups.ts` deleted `games` and
// `memberships` that `events.ts` had no business touching, which is fine, but
// NEITHER of them had ever heard of `smash_sessions`, and neither learned about
// `game_sessions` when it shipped on 2026-07-16 as an "additive" table. Both
// declare `event_id ... notNull().references(() => events.id)`, so Postgres
// refused the `DELETE FROM events` in both handlers the moment a crew had ever
// STARTED a session pack, which twelve of the fourteen tiles do at setup,
// before a single result is recorded. Neither handler was in a transaction, so
// by the time that line raised, `match_participants`, `matches`, `brackets`,
// `rsvps` and `event_attendance` were already committed and gone. The user got
// a 500, the crew was still there, and its whole recorded history was not.
//
// The root cause was never "somebody forgot two tables". It was a
// hand-maintained list that was not derived from, or checked against, the
// schema it was supposed to cover. So: one list, and
// `apps/server/tests/cascade-integrity.test.ts` derives the required set and
// the required ORDER from `packages/db/src/schema.ts` and scans this file
// against them. A new table carrying `group_id` or `event_id` fails that test
// until it is added here.
//
// `beerio_sessions` and `beerio_hof` are CORRECTLY ABSENT and must stay absent.
// Both are keyed by a text room code and carry neither `group_id` nor
// `event_id`, so neither can block a delete, and neither holds lifetime stats
// (Beerio materializes its results into `matches`/`match_participants` like
// every other pack). The test derives its requirement from the foreign key
// graph, so it does not ask for them: adding them here would delete another
// crew's room and would fail the test's "deletes a table that does not
// reference this root" half.
//
// BOTH FUNCTIONS RUN INSIDE A TRANSACTION and take the transaction handle, not
// the database. That is what turns the failure above from data loss into an
// honest 500: drizzle-orm/node-postgres over a real pg.Pool pins one connection
// for the callback, issues a genuine BEGIN, and ROLLBACKs the whole sequence if
// any statement raises, so a cascade that cannot finish deletes nothing at all.
// Nothing in here may reach for getDb(): a statement on the pool is a statement
// on a DIFFERENT connection, outside the transaction, and it would commit on its
// own while the rest rolled back.
//
// Auth, lookup and broadcast all stay OUT of here and out of the transaction
// wrapping it. Auth and lookup are read-only and hold nothing worth holding a
// transaction open across; broadcasting inside one would tell every connected
// phone about a deletion that can still roll back.

import {
  getDb,
  brackets,
  eventAttendance,
  events,
  gameSessions,
  games,
  groups,
  matches,
  matchParticipants,
  memberships,
  rsvps,
  smashSessions,
  eq,
} from "@gamenight/db";

type Db = ReturnType<typeof getDb>;

/**
 * The real transaction handle, derived from the driver rather than named, so it
 * cannot drift from whatever `db.transaction()` actually hands its callback.
 */
export type CascadeTx = Parameters<Parameters<Db["transaction"]>[0]>[0];


/**
 * Delete a crew and everything under it: events, RSVPs, attendance, games,
 * brackets, every recorded match, every live session, and the memberships.
 * Children first, so no foreign key is ever pointing at a row that has gone.
 */
export async function deleteGroupCascade(tx: CascadeTx, groupId: string): Promise<void> {
  await tx.delete(matchParticipants).where(eq(matchParticipants.groupId, groupId));
  await tx.delete(matches).where(eq(matches.groupId, groupId));
  await tx.delete(brackets).where(eq(brackets.groupId, groupId));
  await tx.delete(rsvps).where(eq(rsvps.groupId, groupId));
  await tx.delete(eventAttendance).where(eq(eventAttendance.groupId, groupId));
  await tx.delete(gameSessions).where(eq(gameSessions.groupId, groupId));
  await tx.delete(smashSessions).where(eq(smashSessions.groupId, groupId));
  await tx.delete(events).where(eq(events.groupId, groupId));
  await tx.delete(games).where(eq(games.groupId, groupId));
  await tx.delete(memberships).where(eq(memberships.groupId, groupId));
  await tx.delete(groups).where(eq(groups.id, groupId));
}

/**
 * Delete one event and everything under it. Same order as the crew cascade
 * minus the three things that outlive an event: the crew's games, its
 * memberships, and the crew row itself.
 */
export async function deleteEventCascade(tx: CascadeTx, eventId: string): Promise<void> {
  const eventMatches = await tx
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.eventId, eventId));
  for (const m of eventMatches) {
    await tx.delete(matchParticipants).where(eq(matchParticipants.matchId, m.id));
  }
  await tx.delete(matches).where(eq(matches.eventId, eventId));
  await tx.delete(brackets).where(eq(brackets.eventId, eventId));
  await tx.delete(rsvps).where(eq(rsvps.eventId, eventId));
  await tx.delete(eventAttendance).where(eq(eventAttendance.eventId, eventId));
  await tx.delete(gameSessions).where(eq(gameSessions.eventId, eventId));
  await tx.delete(smashSessions).where(eq(smashSessions.eventId, eventId));
  await tx.delete(events).where(eq(events.id, eventId));
}

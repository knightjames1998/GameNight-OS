// WHAT A SETUP SCREEN OPENS WITH, for every pack, from one place.
//
// THE CHAIN, in order, each rung used only when the one above it yields nobody:
//   1. THE LAST SESSION'S ROSTER ON THIS EVENT. A night that runs three packs
//      builds the same roster three times today, by hand, off a list the app
//      already knows is out of date.
//   2. WHO SHOWED. `event_attendance` records who actually turned up, and since
//      a host can now check people in it is a real list rather than whoever
//      remembered to open the app.
//   3. WHO SAID YES. The weakest of the three and the only one used before this,
//      which is the whole point: an RSVP is an intention from Tuesday.
//
// THE SOURCE IS ALWAYS REPORTED, and that is part of the feature rather than
// decoration. Nine setup screens change behaviour here; a host who is not told
// where a roster came from has been handed a list they did not build and cannot
// explain, and `rsvpSlots` always rides along so the screen can offer the yes
// list back in one tap.
//
// ONE RESOLVER, NOT TWO. Which session ran last is the same question the event
// TV answers, and two rules that can disagree about what is happening on a night
// is a worse bug than either rule being wrong. So this calls `resolveNow` from
// tv.ts rather than ranking sessions itself. It calls it REPEATEDLY, removing
// the winner each time, which turns the TV's one answer into the TV's ordering:
// a session that yields no roster (a Beerio room, a bracket with no entrants
// yet) steps aside for the next one rather than ending the rung. And because
// `resolveNow` filters completed sessions out by design, finished sessions get a
// SECOND pass of the same rule afterwards, which is what makes "the pack you
// just finished" a carry-over source at all.
//
// THE KNOWN LIMITATION IS INHERITED ON PURPOSE, and is logged OPEN in BUGS: a
// late write to an abandoned session wins on touch recency. It is acceptable
// here and strictly better than the RSVP list.

import {
  getDb,
  brackets,
  groups,
  eventAttendance,
  gameSessions,
  memberships,
  rsvps,
  smashSessions,
  users,
  and,
  eq,
  desc,
  inArray,
} from "@gamenight/db";
import {
  LEDGER_PACK_DISPLAY,
  PACK_BY_LEDGER,
  SESSION_PACKS,
  SESSION_PACK_KEYS,
  GENERIC_LEDGER,
} from "@gamenight/shared";
import { ROSTER_ADAPTERS } from "./roster-adapters.js";
import { resolveNow, type PackCandidate, type BracketCandidate, type TvCandidates } from "./tv.js";
import type { RosterSlot } from "./pack-runtime.js";

/** One prefilled slot. `userId: null` is a guest, as in every pack roster. */
export interface PrefillSlot {
  userId: string | null;
  name: string;
}

export type PrefillSource = "session" | "attendance" | "rsvp";

export interface EventPrefill {
  /** The chain's answer: what the setup screen should open with. */
  slots: PrefillSlot[];
  source: PrefillSource;
  /** The pack's display name when the source is a session, else "". */
  sourceLabel: string;
  /** Always the yes list, so a screen can offer it back whatever won. */
  rsvpSlots: PrefillSlot[];
  /** Guest names typed on this crew before, newest first. */
  recentGuests: string[];
}

/** How many past guest names a setup screen offers as chips. */
export const RECENT_GUEST_CAP = 12;

/** How many of a crew's sessions the guest-name scan reaches back through. */
const GUEST_SCAN_SESSIONS = 25;

/**
 * EVERY `game_sessions` READ IN THIS FILE IS KEYED BY PACK, and this is the key.
 *
 * The reason is the SOCIAL DEDUCTION SECRET STORE: it keeps the dealt roles in a
 * `game_sessions` row under `deduction_secret`, a pack value no registry entry
 * claims, and its safety rests on the invariant that no generic reader of that
 * table ever selects the `state` column. This file has to read state across
 * packs (it does not know which pack ran last until it has ranked them), so it
 * restricts by pack instead, DERIVED from the registry so a new pack joins the
 * allowlist and the secret store can never be in it. deduction-secrecy.test.ts
 * checks this list is actually on both reads.
 */
const READABLE_LEDGERS = SESSION_PACK_KEYS.map((k) => SESSION_PACKS[k].ledger);

// ---------- the pure half ----------

export interface ChainInput {
  /** The last session's roster and the pack it came from, or null for none. */
  lastSession: { slots: RosterSlot[]; label: string } | null;
  /** Members recorded as having showed, in the order they were recorded. */
  showed: PrefillSlot[];
  /** Yes-RSVPs, in the order they answered. */
  yes: PrefillSlot[];
  /** Display name by userId for everybody CURRENTLY in the crew. */
  crew: Map<string, string>;
}

/**
 * The chain, as a pure function over four lists.
 *
 * THE CREW FILTER APPLIES TO EVERY RUNG, not only to the carried roster.
 * Somebody who has left the crew must not come back on a prefill, and they can
 * be sitting in any of the three: a stale session roster, an attendance row from
 * a night they were still in, or an RSVP nobody deleted. Guests carry no userId
 * and are kept, because a guest is not a membership.
 *
 * NAMES ARE RESOLVED FROM THE CREW, not from the stored roster, so a member who
 * changed their display name comes back under the new one. That also covers the
 * bracket adapter, whose member slots deliberately carry no name at all.
 */
export function prefillChain(input: ChainInput): {
  slots: PrefillSlot[];
  source: PrefillSource;
  sourceLabel: string;
} {
  const { crew } = input;
  const keep = (list: PrefillSlot[]) =>
    list.filter((s) => s.userId === null || crew.has(s.userId));
  const named = (list: PrefillSlot[]) =>
    list.map((s) => (s.userId ? { userId: s.userId, name: crew.get(s.userId) ?? s.name } : s));

  if (input.lastSession) {
    const carried = named(
      keep(input.lastSession.slots.map((s) => ({ userId: s.userId, name: s.name }))),
    );
    if (carried.length) {
      return { slots: carried, source: "session", sourceLabel: input.lastSession.label };
    }
  }
  const showed = named(keep(input.showed));
  if (showed.length) return { slots: showed, source: "attendance", sourceLabel: "" };
  return { slots: named(keep(input.yes)), source: "rsvp", sourceLabel: "" };
}

/**
 * Guest names, newest first, deduplicated case-insensitively with the MOST
 * RECENT spelling kept, because that is the one the host last chose.
 *
 * Pure, and separate from the reading, for the same reason the chain is: the
 * rule ("Mike" and "mike" are one person and the newer wins) is the part worth
 * pinning.
 *
 * A PERSONAL CREW GETS NOTHING, and that is a deferral being honoured rather
 * than a limitation. Quick play runs through a hidden personal crew where
 * everybody except the host is a typed guest, so guest name memory there is not
 * a small extra: it would be the main way a quick play roster gets built, and
 * "guest name memory for quick play personal crews" is deliberately unanswered
 * while guest LINKING for personal crews is still an open decision (see
 * DEFERRED). Shipping the chips there would have answered it by accident. The
 * roster carry-over is untouched by this: carrying one night's players into the
 * next game on the same night is not memory across a crew.
 */
export function recentGuestNames(
  rosters: readonly RosterSlot[][],
  cap: number,
  opts: { personalCrew: boolean } = { personalCrew: false },
): string[] {
  if (opts.personalCrew) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const roster of rosters) {
    for (const slot of roster) {
      if (slot.kind !== "guest") continue;
      const name = slot.name.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

// ---------- the reading half ----------

/** The event row this needs, which every caller already has in hand. */
export interface PrefillEvent {
  id: string;
  groupId: string;
  beerioCode: string | null;
  beerioCompletedAt: Date | null;
}

/**
 * The whole payload for one event's setup screen.
 *
 * `excludeLedger` is the pack being launched: a Ping Pong setup screen must not
 * offer "same players as Ping Pong" off the session it is about to replace.
 */
export async function eventPrefill(
  event: PrefillEvent,
  opts: { excludeLedger?: string } = {},
): Promise<EventPrefill> {
  const db = getDb();

  const [crewRows, yesRows, showedRows, packRows, smashRows, bracketRows, guestRows, groupRows] =
    await Promise.all([
      db
        .select({ userId: memberships.userId, displayName: users.displayName })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(eq(memberships.groupId, event.groupId)),
      db
        .select({ userId: rsvps.userId, displayName: users.displayName })
        .from(rsvps)
        .innerJoin(users, eq(rsvps.userId, users.id))
        .where(and(eq(rsvps.eventId, event.id), eq(rsvps.status, "yes")))
        .orderBy(rsvps.respondedAt),
      db
        .select({ userId: eventAttendance.userId, displayName: users.displayName })
        .from(eventAttendance)
        .innerJoin(users, eq(eventAttendance.userId, users.id))
        .where(and(eq(eventAttendance.eventId, event.id), eq(eventAttendance.showed, true)))
        .orderBy(eventAttendance.markedAt),
      db
        .select({
          pack: gameSessions.pack,
          status: gameSessions.status,
          updatedAt: gameSessions.updatedAt,
          state: gameSessions.state,
        })
        .from(gameSessions)
        .where(
          and(
            eq(gameSessions.eventId, event.id),
            inArray(gameSessions.pack, READABLE_LEDGERS),
          ),
        ),
      db
        .select({
          status: smashSessions.status,
          updatedAt: smashSessions.updatedAt,
          state: smashSessions.state,
        })
        .from(smashSessions)
        .where(eq(smashSessions.eventId, event.id))
        .limit(1),
      db
        .select({
          id: brackets.id,
          status: brackets.status,
          updatedAt: brackets.updatedAt,
          entrants: brackets.entrants,
        })
        .from(brackets)
        .where(eq(brackets.eventId, event.id)),
      // The crew's recent guest names. Capped in the query rather than in
      // memory: a crew's whole session history is not needed to answer "who did
      // we type in lately", and this read happens on every setup screen.
      db
        .select({ pack: gameSessions.pack, state: gameSessions.state })
        .from(gameSessions)
        .where(
          and(
            eq(gameSessions.groupId, event.groupId),
            inArray(gameSessions.pack, READABLE_LEDGERS),
          ),
        )
        .orderBy(desc(gameSessions.updatedAt))
        .limit(GUEST_SCAN_SESSIONS),
      // Only to answer "is this quick play", which decides whether the guest
      // chips are offered at all. See recentGuestNames.
      db
        .select({ isPersonal: groups.isPersonal })
        .from(groups)
        .where(eq(groups.id, event.groupId))
        .limit(1),
    ]);

  const crew = new Map(crewRows.map((m) => [m.userId, m.displayName] as const));

  // Every session on the night, with the state beside the candidate, so the
  // ordering below never needs a second read.
  const packs: PackCandidate[] = [];
  const stateByKey = new Map<string, { ledger: string; state: unknown }>();
  for (const s of packRows) {
    const key = PACK_BY_LEDGER[s.pack];
    if (!key || s.pack === opts.excludeLedger) continue;
    packs.push({ pack: key, status: s.status, updatedAt: s.updatedAt });
    stateByKey.set(`pack:${key}`, { ledger: s.pack, state: s.state });
  }
  const smashLedger = SESSION_PACKS.smash.ledger;
  if (smashRows[0] && opts.excludeLedger !== smashLedger) {
    packs.push({ pack: "smash", status: smashRows[0].status, updatedAt: smashRows[0].updatedAt });
    stateByKey.set("pack:smash", { ledger: smashLedger, state: smashRows[0].state });
  }
  const brackets_: BracketCandidate[] = [];
  for (const b of bracketRows) {
    if (opts.excludeLedger === GENERIC_LEDGER) continue;
    brackets_.push({ bracketId: b.id, status: b.status, updatedAt: b.updatedAt });
    stateByKey.set(`bracket:${b.id}`, { ledger: GENERIC_LEDGER, state: b.entrants });
  }
  // NO BEERIO CANDIDATE AND NO beerio_sessions READ. A Beerio room has no
  // readable roster at all (see rosterOfBeerio: its blob is the vendored
  // engine's, keyed by a room code with no link to an event), so a room can only
  // ever lose this rung. Offering it one and reading a row for it to lose with
  // would be a round trip spent on a foregone conclusion. The ordering below
  // still handles the beerio case, because the day that blob becomes readable
  // this should be the only line that has to change.
  const lastSession = firstRosterInOrder(
    { packs, brackets: brackets_, beerio: null },
    stateByKey,
  );

  return {
    ...prefillChain({
      lastSession,
      showed: showedRows.map((r) => ({ userId: r.userId, name: r.displayName })),
      yes: yesRows.map((r) => ({ userId: r.userId, name: r.displayName })),
      crew,
    }),
    rsvpSlots: yesRows.map((r) => ({ userId: r.userId, name: r.displayName })),
    recentGuests: recentGuestNames(
      guestRows.map((r) => ROSTER_ADAPTERS[r.pack]?.(r.state) ?? []),
      RECENT_GUEST_CAP,
      { personalCrew: !!groupRows[0]?.isPersonal },
    ),
  };
}

/**
 * The most recently touched session on the night THAT HAS A ROSTER, using the
 * TV's rule to order them and this table to read them.
 *
 * TWO PASSES, because `resolveNow` drops completed sessions by design: the first
 * over what is still going, the second over what has finished, re-labelled live
 * so the same function ranks them. That second pass is what makes the pack a
 * crew just finished a carry-over source, which is the common case the feature
 * is about. Within each pass the winner is removed and the rule asked again, so
 * a session with no readable roster steps aside instead of ending the rung.
 */
function firstRosterInOrder(
  c: TvCandidates,
  stateByKey: Map<string, { ledger: string; state: unknown }>,
): { slots: RosterSlot[]; label: string } | null {
  const live = {
    packs: c.packs.filter((p) => p.status !== "completed"),
    brackets: c.brackets.filter((b) => b.status !== "completed"),
    beerio: c.beerio,
  };
  const done: TvCandidates = {
    packs: c.packs.filter((p) => p.status === "completed").map((p) => ({ ...p, status: "live" })),
    brackets: c.brackets
      .filter((b) => b.status === "completed")
      .map((b) => ({ ...b, status: "live" })),
    beerio: null,
  };

  for (const pass of [live, done]) {
    let packs = pass.packs;
    let bracketList = pass.brackets;
    let beerio = pass.beerio;
    for (let guard = packs.length + bracketList.length + 1; guard > 0; guard--) {
      const now = resolveNow({ packs, brackets: bracketList, beerio });
      if (!now) break;
      if (now.kind === "pack") {
        const hit = stateByKey.get(`pack:${now.pack}`);
        const slots = hit ? (ROSTER_ADAPTERS[hit.ledger]?.(hit.state) ?? []) : [];
        if (slots.length) return { slots, label: labelFor(hit!.ledger) };
        packs = packs.filter((p) => p.pack !== now.pack);
      } else if (now.kind === "bracket") {
        const hit = stateByKey.get(`bracket:${now.bracketId}`);
        const slots = hit ? (ROSTER_ADAPTERS[hit.ledger]?.(hit.state) ?? []) : [];
        if (slots.length) return { slots, label: labelFor(GENERIC_LEDGER) };
        bracketList = bracketList.filter((b) => b.bracketId !== now.bracketId);
      } else {
        // A Beerio room, which has no readable roster. Stepping aside rather
        // than ending the rung is the whole reason this loop exists.
        beerio = null;
      }
    }
  }
  return null;
}

const labelFor = (ledger: string) => LEDGER_PACK_DISPLAY[ledger]?.name ?? "the last game";

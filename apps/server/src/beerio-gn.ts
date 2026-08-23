// GameNight binding for the Beerio Kart pack (Session B of the port).
// Split from beerio.ts deliberately: these are the only beerio routes
// that require login, and keeping them in their own file keeps the
// public 1:1 contract file untouched.

import { Router } from "express";
import {
  getDb,
  events,
  games,
  matches,
  matchParticipants,
  memberships,
  users,
  and,
  eq,
  isNotNull,
} from "@gamenight/db";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { insertParticipants } from "./participants.js";
import { broadcast } from "./ws.js";
import { eventPrefill } from "./event-prefill.js";
import { BEERIO_LEDGER } from "@gamenight/shared";
import { memberCreditedKeys, type GuestCreditResult } from "./guest-link-util.js";

export const beerioGnRouter = Router();

/** One racer's final standing, as the vendored pack reports it. */
interface BeerioPlacement {
  name: string;
  place: number;
}

/**
 * Write participant rows for a finished Beerio tournament.
 *
 * Shared by the live completion route and the guest -> member backfill so the
 * two can never drift on how a name becomes a credited player. A racer is
 * credited when their name resolves through EITHER map (both keyed by the
 * lowercased name): `byName` is the crew's current members, `linkMap` is the
 * guest names an admin has explicitly linked. Anyone who resolves through
 * neither is a guest and is counted, not written.
 *
 * Every insert is ON CONFLICT DO NOTHING against (matchId, userId), so calling
 * this twice on the same match credits nothing new.
 */
export async function creditBeerioPlacements(
  groupId: string,
  matchId: string,
  placements: BeerioPlacement[],
  byName: Map<string, string>,
  linkMap?: Map<string, string>,
): Promise<{ recorded: number; guests: number }> {
  const db = getDb();
  const rows = new Map<string, typeof matchParticipants.$inferInsert>();
  let guests = 0;
  for (const p of placements) {
    const userId = byName.get(p.name.toLowerCase()) ?? linkMap?.get(p.name.toLowerCase());
    if (!userId) {
      guests++;
      continue;
    }
    // Two racers typed with the same name resolve to one member, so this
    // dedupes before the single insert. First placement listed wins, which
    // is the row the old sequential loop wrote.
    if (rows.has(userId)) continue;
    rows.set(userId, {
      groupId,
      matchId,
      userId,
      placement: p.place,
      isWinner: p.place === 1,
    });
  }
  await insertParticipants(db, [...rows.values()]);
  return { recorded: rows.size, guests };
}

/** The crew's current members, keyed by lowercased display name. */
async function membersByName(groupId: string): Promise<Map<string, string>> {
  const members = await getDb()
    .select({ userId: users.id, displayName: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.groupId, groupId));
  return new Map(members.map((m) => [m.displayName.trim().toLowerCase(), m.userId]));
}

/**
 * Launch context: the yes-RSVP list for prefilling the setup screen.
 * Names come back in RSVP order, same seeding spirit as the generic
 * bracket.
 */
beerioGnRouter.get("/beerio-context/:eventId", requireAuth, async (req: AuthedRequest, res) => {
  const db = getDb();
  const event = (
    await db.select().from(events).where(eq(events.id, String(req.params.eventId))).limit(1)
  )[0];
  if (!event || !(await isMember(event.groupId, req.user!.id))) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  // THE SAME CHAIN AS EVERY OTHER LAUNCHER, taking NAMES ONLY. Beerio's roster
  // is typed into the vendored app, which has no idea what a userId is, so this
  // is the one launcher that gets less out of the chain than the others: the
  // people are right, the crediting still happens later off the standings
  // snapshot exactly as it did. Nothing here invents an id it cannot use.
  const [prefill, role] = await Promise.all([
    eventPrefill(event, { excludeLedger: BEERIO_LEDGER }),
    roleOf(event.groupId, req.user!.id),
  ]);
  res.json({
    groupId: event.groupId,
    prefill: prefill.slots.map((s) => s.name),
    prefillSource: prefill.source,
    prefillLabel: prefill.sourceLabel,
    rsvpPrefill: prefill.rsvpSlots.map((s) => s.name),
    recentGuests: prefill.recentGuests,
    sessionCode: event.beerioCode,
    canHost: role === "owner" || role === "admin",
  });
});

/**
 * The host opens the room and registers it on the event. Everyone else
 * joins THIS code, so the whole crew watches one night instead of each
 * starting a private tournament. Owner/admin only.
 */
beerioGnRouter.post("/events/:eventId/beerio-session", async (req: AuthedRequest, res) => {
  const db = getDb();
  const code = String(req.body?.code ?? "").trim().toUpperCase().slice(0, 12);
  if (!code) {
    res.status(400).json({ error: "code required" });
    return;
  }
  const event = (
    await db.select().from(events).where(eq(events.id, String(req.params.eventId))).limit(1)
  )[0];
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const role = await roleOf(event.groupId, req.user!.id);
  if (role !== "owner" && role !== "admin") {
    res.status(403).json({ error: "Only crew owners and admins can start a game" });
    return;
  }
  // Clearing the completion stamp is what reopens the pack: a new room on an
  // event whose last tournament finished must count as live again, and the
  // stamp is the only thing that would say otherwise.
  await db
    .update(events)
    .set({ beerioCode: code, beerioCompletedAt: null })
    .where(eq(events.id, event.id));
  broadcast({ type: "event_session_changed", eventId: event.id }, req.get("x-gn-client"));
  res.json({ ok: true });
});

/**
 * A completed Beerio tournament reports final standings. Names match to
 * crew members case-insensitively; unmatched names are guests and simply
 * aren't recorded (logged decision). One matches row per tournament,
 * participant rows per matched member, deduped by the pack's own
 * completion key.
 *
 * The FULL standings list, guests included, is also stored verbatim on
 * matches.rawResult. Unlike every other pack, Beerio keeps no usable
 * server-side record of who played (its session blob is the vendored
 * engine's opaque shape, keyed by a reusable live-session code with no link
 * to the finished match), so discarding the guest names here left nothing
 * for the guest -> member backfill to reopen later. This snapshot is what
 * makes Beerio linkable, from this deploy forward.
 */
beerioGnRouter.post("/beerio-complete", requireAuth, async (req: AuthedRequest, res) => {
  const db = getDb();
  const eventId = String(req.body?.eventId ?? "");
  const key = String(req.body?.key ?? "").slice(0, 120);
  const placements = req.body?.placements;
  if (!eventId || !key || !Array.isArray(placements) || placements.length === 0) {
    res.status(400).json({ error: "eventId, key, and placements are required" });
    return;
  }

  const event = (await db.select().from(events).where(eq(events.id, eventId)).limit(1))[0];
  if (!event || !(await isMember(event.groupId, req.user!.id))) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const dupe = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.eventId, eventId), eq(matches.externalKey, key)))
    .limit(1);
  if (dupe[0]) {
    res.json({ ok: true, deduped: true });
    return;
  }

  // One "Beerio Kart" game per group, created on first use.
  let game = (
    await db
      .select()
      .from(games)
      .where(and(eq(games.groupId, event.groupId), eq(games.pack, "beerio_kart")))
      .limit(1)
  )[0];
  if (!game) {
    game = (
      await db
        .insert(games)
        .values({ groupId: event.groupId, name: "Beerio Kart", pack: "beerio_kart" })
        .returning()
    )[0]!;
  }

  // Normalize once, then use the SAME list for the stored snapshot and the
  // credit pass, so what a later backfill reads is exactly what was scored.
  const clean: BeerioPlacement[] = [];
  for (const p of placements.slice(0, 32)) {
    const name = String(p?.name ?? "").trim();
    const place = Number(p?.place);
    if (!name || !Number.isInteger(place) || place < 1) continue;
    clean.push({ name, place });
  }

  const match = (
    await db
      .insert(matches)
      .values({
        groupId: event.groupId,
        gameId: game.id,
        eventId,
        externalKey: key,
        round: 1,
        position: 0,
        status: "completed",
        rawResult: { placements: clean },
      })
      .returning()
  )[0]!;

  const { recorded, guests } = await creditBeerioPlacements(
    event.groupId,
    match.id,
    clean,
    await membersByName(event.groupId),
  );

  // Beerio's completion marker, the equivalent of the other four packs
  // reaching status "completed": it is what lets a finished room age out of
  // the event TV resolver instead of staying "open" forever. A crew starting
  // a second tournament on the same code needs nothing here: the engine
  // writes state, beerio_sessions.updatedAt moves past this stamp, and the
  // resolver counts the room live again on its own.
  await db.update(events).set({ beerioCompletedAt: new Date() }).where(eq(events.id, eventId));
  broadcast({ type: "event_session_changed", eventId }, req.get("x-gn-client"));

  res.json({ ok: true, recorded, guests });
});

// ---------- guest -> member backfill adapters ----------
//
// These read matches.rawResult, the full standings snapshot written at
// completion; a night without one contributes nothing. Nothing is
// reconstructed from beerio_sessions.state: it is the vendored engine's opaque
// shape, keyed by a reusable live-session code with no link to a finished
// match, so guessing at it would invent credits rather than recover them.

/** Every completed Beerio match in the crew that carries a stored snapshot. */
async function beerioSnapshots(groupId: string) {
  return getDb()
    .select({
      id: matches.id,
      eventId: matches.eventId,
      externalKey: matches.externalKey,
      rawResult: matches.rawResult,
      scheduledFor: events.scheduledFor,
    })
    .from(matches)
    .innerJoin(games, eq(matches.gameId, games.id))
    .innerJoin(events, eq(matches.eventId, events.id))
    .where(
      and(
        eq(matches.groupId, groupId),
        eq(games.pack, "beerio_kart"),
        eq(matches.status, "completed"),
        isNotNull(matches.rawResult),
      ),
    );
}

/**
 * The completion key looks like `b|s3|2026-07-27|4p|6h` (bracket) or
 * `g|...` (Grand Prix), so it carries both the format and the night's date.
 */
function beerioLabel(key: string | null): string {
  if (key?.startsWith("b|")) return "Bracket";
  if (key?.startsWith("g|")) return "Grand Prix";
  return "Beerio Kart";
}

function beerioDate(key: string | null, scheduledFor: Date | null): string | null {
  const part = key?.split("|")[2];
  if (part && /^\d{4}-\d{2}-\d{2}$/.test(part)) return new Date(`${part}T00:00:00.000Z`).toISOString();
  return scheduledFor ? scheduledFor.toISOString() : null;
}

/** Names on stored Beerio standings that match no current crew member. */
export async function guestNamesBeerio(groupId: string): Promise<string[]> {
  const [rows, byName] = await Promise.all([beerioSnapshots(groupId), membersByName(groupId)]);
  const names = new Set<string>();
  for (const r of rows) {
    for (const p of r.rawResult?.placements ?? []) {
      const name = p?.name?.trim();
      if (name && !byName.has(name.toLowerCase())) names.add(name);
    }
  }
  return [...names];
}

/** Credit (or preview) every stored Beerio night the guest raced in. */
export async function creditGuestBeerio(
  groupId: string,
  guestName: string,
  memberId: string,
  dryRun: boolean,
): Promise<GuestCreditResult> {
  const rows = await beerioSnapshots(groupId);
  const items: GuestCreditResult["items"] = [];
  const wanted = guestName.trim().toLowerCase();
  // Only the linked guest may be credited, so the member map stays EMPTY:
  // confirm writes exactly the rows preview promised, and a member who
  // joined the crew after that night is never quietly credited too.
  const linkMap = new Map([[wanted, memberId]]);
  const noMembers = new Map<string, string>();
  const creditedPerEvent = new Map<string, Set<string>>();
  let written = 0;

  for (const r of rows) {
    if (!r.eventId) continue;
    const line = (r.rawResult?.placements ?? []).find((p) => p?.name?.trim().toLowerCase() === wanted);
    if (!line) continue;

    let credited = creditedPerEvent.get(r.eventId);
    if (!credited) {
      credited = await memberCreditedKeys(r.eventId, memberId);
      creditedPerEvent.set(r.eventId, credited);
    }
    if (r.externalKey && credited.has(r.externalKey)) continue; // already has this night

    items.push({
      pack: "beerio",
      packLabel: "Beerio Kart",
      eventId: r.eventId,
      label: beerioLabel(r.externalKey),
      date: beerioDate(r.externalKey, r.scheduledFor),
      placement: line.place,
      isWinner: line.place === 1,
    });

    if (!dryRun) {
      // Reopen the match that already exists; never create one.
      const res = await creditBeerioPlacements(groupId, r.id, [line], noMembers, linkMap);
      written += res.recorded;
    }
  }
  return { items, written };
}

async function isMember(groupId: string, userId: string): Promise<boolean> {
  return !!(await roleOf(groupId, userId));
}

async function roleOf(
  groupId: string,
  userId: string,
): Promise<"owner" | "admin" | "member" | undefined> {
  const rows = await getDb()
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, userId)))
    .limit(1);
  return rows[0]?.role;
}

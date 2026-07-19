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
  rsvps,
  users,
  and,
  eq,
} from "@gamenight/db";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { broadcast } from "./ws.js";

export const beerioGnRouter = Router();

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
  const yes = await db
    .select({ displayName: users.displayName })
    .from(rsvps)
    .innerJoin(users, eq(rsvps.userId, users.id))
    .where(and(eq(rsvps.eventId, event.id), eq(rsvps.status, "yes")))
    .orderBy(rsvps.respondedAt);

  const role = await roleOf(event.groupId, req.user!.id);
  res.json({
    groupId: event.groupId,
    prefill: yes.map((r) => r.displayName),
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
  await db.update(events).set({ beerioCode: code }).where(eq(events.id, event.id));
  broadcast({ type: "event_session_changed", eventId: event.id }, req.get("x-gn-client"));
  res.json({ ok: true });
});

/**
 * A completed Beerio tournament reports final standings. Names match to
 * crew members case-insensitively; unmatched names are guests and simply
 * aren't recorded (logged decision). One matches row per tournament,
 * participant rows per matched member, deduped by the pack's own
 * completion key.
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
      })
      .returning()
  )[0]!;

  const members = await db
    .select({ userId: users.id, displayName: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.groupId, event.groupId));
  const byName = new Map(members.map((m) => [m.displayName.trim().toLowerCase(), m.userId]));

  let recorded = 0;
  let guests = 0;
  for (const p of placements.slice(0, 32)) {
    const name = String(p?.name ?? "").trim();
    const place = Number(p?.place);
    if (!name || !Number.isInteger(place) || place < 1) continue;
    const userId = byName.get(name.toLowerCase());
    if (!userId) {
      guests++;
      continue;
    }
    await db
      .insert(matchParticipants)
      .values({
        groupId: event.groupId,
        matchId: match.id,
        userId,
        placement: place,
        isWinner: place === 1,
      })
      .onConflictDoNothing();
    recorded++;
  }

  res.json({ ok: true, recorded, guests });
});

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

import { Router } from "express";
import {
  getDb,
  events,
  groups,
  games,
  rsvps,
  eventAttendance,
  memberships,
  users,
  brackets,
  matches,
  matchParticipants,
  and,
  eq,
  desc,
} from "@gamenight/db";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { broadcast } from "./ws.js";

// Schedule module. Events belong to a group; RSVPs belong to an event.
// Every route verifies group membership before touching anything.

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

/** Create a game night. Any member can; keeping roles loose until it matters. */
eventsRouter.post("/groups/:groupId/events", async (req: AuthedRequest, res) => {
  const groupId = String(req.params.groupId);
  if (!(await isMember(groupId, req.user!.id))) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const title = String(req.body?.title ?? "").trim();
  if (title.length < 1 || title.length > 80) {
    res.status(400).json({ error: "Title must be 1-80 characters" });
    return;
  }

  let scheduledFor: Date | null = null;
  if (req.body?.scheduledFor) {
    scheduledFor = new Date(String(req.body.scheduledFor));
    if (isNaN(scheduledFor.getTime())) {
      res.status(400).json({ error: "Invalid date" });
      return;
    }
  }

  const event = (
    await getDb()
      .insert(events)
      .values({
        groupId,
        title,
        scheduledFor,
        status: scheduledFor ? "scheduled" : "draft",
        createdBy: req.user!.id,
      })
      .returning()
  )[0]!;

  broadcast({ type: "group_events_changed", groupId }, req.get("x-gn-client"));
  res.json(event);
});

/**
 * Delete an event and everything hanging off it: RSVPs, brackets, and the
 * stats rows those brackets wrote. Only the creator or a group owner/admin
 * can. Deliberately destructive and irreversible; the UI confirms first.
 */
eventsRouter.delete("/events/:id", async (req: AuthedRequest, res) => {
  const db = getDb();
  const found = (
    await db.select().from(events).where(eq(events.id, String(req.params.id))).limit(1)
  )[0];
  if (!found) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const mine = (
    await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.groupId, found.groupId), eq(memberships.userId, req.user!.id)))
      .limit(1)
  )[0];
  if (!mine) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const allowed =
    found.createdBy === req.user!.id || mine.role === "owner" || mine.role === "admin";
  if (!allowed) {
    res.status(403).json({ error: "Only the event creator or a crew admin can delete this" });
    return;
  }

  // Children first: FKs point inward.
  const eventMatches = await db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.eventId, found.id));
  for (const m of eventMatches) {
    await db.delete(matchParticipants).where(eq(matchParticipants.matchId, m.id));
  }
  await db.delete(matches).where(eq(matches.eventId, found.id));
  await db.delete(brackets).where(eq(brackets.eventId, found.id));
  await db.delete(rsvps).where(eq(rsvps.eventId, found.id));
  await db.delete(eventAttendance).where(eq(eventAttendance.eventId, found.id));
  await db.delete(events).where(eq(events.id, found.id));

  const origin = req.get("x-gn-client");
  broadcast({ type: "event_deleted", eventId: found.id, groupId: found.groupId }, origin);
  broadcast({ type: "group_events_changed", groupId: found.groupId }, origin);
  res.json({ ok: true });
});

/**
 * Change an event's date (or clear it). Same permission as delete: the
 * creator or a crew owner/admin. Status follows the date between draft and
 * scheduled; live/completed/cancelled are never touched from here.
 */
eventsRouter.patch("/events/:id", async (req: AuthedRequest, res) => {
  const db = getDb();
  const found = (
    await db.select().from(events).where(eq(events.id, String(req.params.id))).limit(1)
  )[0];
  if (!found) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const mine = (
    await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.groupId, found.groupId), eq(memberships.userId, req.user!.id)))
      .limit(1)
  )[0];
  if (!mine) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const allowed =
    found.createdBy === req.user!.id || mine.role === "owner" || mine.role === "admin";
  if (!allowed) {
    res.status(403).json({ error: "Only the event creator or a crew admin can change the date" });
    return;
  }

  if (!("scheduledFor" in (req.body ?? {}))) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }
  let scheduledFor: Date | null = null;
  if (req.body.scheduledFor) {
    scheduledFor = new Date(String(req.body.scheduledFor));
    if (isNaN(scheduledFor.getTime())) {
      res.status(400).json({ error: "Invalid date" });
      return;
    }
  }

  const status =
    found.status === "draft" || found.status === "scheduled"
      ? scheduledFor
        ? "scheduled"
        : "draft"
      : found.status;
  await db.update(events).set({ scheduledFor, status }).where(eq(events.id, found.id));

  const origin = req.get("x-gn-client");
  broadcast({ type: "event_updated", eventId: found.id, groupId: found.groupId }, origin);
  broadcast({ type: "group_events_changed", groupId: found.groupId }, origin);
  res.json(await eventDetail({ ...found, scheduledFor, status }, req.user!.id));
});

/** List a group's events, newest first, with RSVP summary and my status. */
eventsRouter.get("/groups/:groupId/events", async (req: AuthedRequest, res) => {
  const groupId = String(req.params.groupId);
  if (!(await isMember(groupId, req.user!.id))) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const db = getDb();
  const list = await db
    .select()
    .from(events)
    .where(eq(events.groupId, groupId))
    .orderBy(desc(events.createdAt));

  const allRsvps = await db.select().from(rsvps).where(eq(rsvps.groupId, groupId));

  res.json(
    list.map((e) => {
      const forEvent = allRsvps.filter((r) => r.eventId === e.id);
      return {
        ...e,
        counts: {
          yes: forEvent.filter((r) => r.status === "yes").length,
          maybe: forEvent.filter((r) => r.status === "maybe").length,
          no: forEvent.filter((r) => r.status === "no").length,
        },
        myStatus: forEvent.find((r) => r.userId === req.user!.id)?.status ?? null,
      };
    }),
  );
});

/**
 * The full event-detail payload the client renders. Shared by the GET and
 * every mutation on this router, so a mutation's response IS the updated
 * state — the client applies it directly instead of refetching.
 */
async function eventDetail(found: NonNullable<Awaited<ReturnType<typeof loadEventForMember>>>, userId: string) {
  const db = getDb();
  const responses = await db
    .select({
      userId: rsvps.userId,
      status: rsvps.status,
      displayName: users.displayName,
    })
    .from(rsvps)
    .innerJoin(users, eq(rsvps.userId, users.id))
    .where(eq(rsvps.eventId, found.id));

  const members = await db
    .select({ userId: users.id, displayName: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.groupId, found.groupId));

  const answered = new Set(responses.map((r) => r.userId));

  const bracket = (
    await db
      .select({ id: brackets.id, status: brackets.status })
      .from(brackets)
      .where(eq(brackets.eventId, found.id))
      .limit(1)
  )[0];

  const myRole = (
    await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.groupId, found.groupId), eq(memberships.userId, userId)))
      .limit(1)
  )[0]?.role;

  const attendance = (
    await db
      .select({ showed: eventAttendance.showed })
      .from(eventAttendance)
      .where(and(eq(eventAttendance.eventId, found.id), eq(eventAttendance.userId, userId)))
      .limit(1)
  )[0];

  // groupName + inviteCode ride along so the event page can build a share
  // link (through the existing invite/join flow) without a second request.
  const group = (
    await db
      .select({ name: groups.name, inviteCode: groups.inviteCode })
      .from(groups)
      .where(eq(groups.id, found.groupId))
      .limit(1)
  )[0];

  return {
    ...found,
    bracket: bracket ?? null,
    myRole,
    groupName: group?.name ?? "",
    inviteCode: group?.inviteCode ?? "",
    rsvps: responses,
    noResponse: members.filter((m) => !answered.has(m.userId)),
    myStatus: responses.find((r) => r.userId === userId)?.status ?? null,
    myAttendance: attendance ? attendance.showed : null,
  };
}

// MVP of the night rule (documented in BACKLOG decision log): most wins,
// tiebreak by best (lowest) average placement. A player with no ranked
// placement sorts last on the tiebreak; a remaining exact tie falls to
// alphabetical name only so the pick stays stable.
function rankMvp(
  a: { wins: number; avgPlacement: number | null; name: string },
  b: { wins: number; avgPlacement: number | null; name: string },
): number {
  if (b.wins !== a.wins) return b.wins - a.wins;
  const ap = a.avgPlacement ?? Infinity;
  const bp = b.avgPlacement ?? Infinity;
  if (ap !== bp) return ap - bp;
  return a.name.localeCompare(b.name);
}

/**
 * Night recap: every completed game under this event across every pack,
 * rolled up. The materialized ledger (matches/match_participants) is the one
 * cross-pack source, so Beerio, Smash, Mario Kart, Mario Party and brackets
 * all land here through the same query. Guests are not in the ledger (they're
 * never materialized), so the recap is members only.
 */
eventsRouter.get("/events/:id/recap", async (req: AuthedRequest, res) => {
  const found = await loadEventForMember(String(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const db = getDb();

  const groupName =
    (
      await db
        .select({ name: groups.name })
        .from(groups)
        .where(eq(groups.id, found.groupId))
        .limit(1)
    )[0]?.name ?? "";

  const rows = await db
    .select({
      matchId: matchParticipants.matchId,
      position: matches.position,
      label: matches.label,
      gameName: games.name,
      pack: games.pack,
      userId: matchParticipants.userId,
      displayName: users.displayName,
      placement: matchParticipants.placement,
      isWinner: matchParticipants.isWinner,
    })
    .from(matches)
    .innerJoin(matchParticipants, eq(matchParticipants.matchId, matches.id))
    .innerJoin(users, eq(matchParticipants.userId, users.id))
    .leftJoin(games, eq(matches.gameId, games.id))
    .where(and(eq(matches.eventId, found.id), eq(matches.status, "completed")));

  // One entry per match (a game/board/race), in play order.
  const byMatch = new Map<
    string,
    { position: number; label: string | null; gameName: string; pack: string; winnerName: string | null }
  >();
  // Per-player rollup across every game.
  const byUser = new Map<
    string,
    { userId: string; name: string; games: number; wins: number; placedSum: number; placed: number }
  >();

  for (const r of rows) {
    let g = byMatch.get(r.matchId);
    if (!g) {
      g = {
        position: r.position ?? 0,
        label: r.label,
        gameName: r.gameName ?? "Game",
        pack: r.pack ?? "generic",
        winnerName: null,
      };
      byMatch.set(r.matchId, g);
    }
    if (r.isWinner) g.winnerName = r.displayName;

    let p = byUser.get(r.userId);
    if (!p) {
      p = { userId: r.userId, name: r.displayName, games: 0, wins: 0, placedSum: 0, placed: 0 };
      byUser.set(r.userId, p);
    }
    p.games++;
    if (r.isWinner) p.wins++;
    if (r.placement && r.placement >= 1) {
      p.placedSum += r.placement;
      p.placed++;
    }
  }

  const gamesList = [...byMatch.values()]
    .sort((a, b) => a.position - b.position)
    .map((g) => ({ gameName: g.gameName, label: g.label, pack: g.pack, winnerName: g.winnerName }));

  const players = [...byUser.values()]
    .map((p) => ({
      userId: p.userId,
      name: p.name,
      games: p.games,
      wins: p.wins,
      avgPlacement: p.placed ? p.placedSum / p.placed : null,
    }))
    .sort(rankMvp);

  res.json({
    eventId: found.id,
    title: found.title,
    scheduledFor: found.scheduledFor,
    groupName,
    totalGames: byMatch.size,
    games: gamesList,
    players,
    mvp: gamesList.length && players[0] ? { userId: players[0].userId, name: players[0].name } : null,
  });
});

/** Event detail: full RSVP breakdown with names, plus who hasn't answered. */
eventsRouter.get("/events/:id", async (req: AuthedRequest, res) => {
  const found = await loadEventForMember(String(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(await eventDetail(found, req.user!.id));
});

/** Set or change my RSVP. Upsert: tapping a different answer just switches it. */
eventsRouter.post("/events/:id/rsvp", async (req: AuthedRequest, res) => {
  const found = await loadEventForMember(String(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const status = String(req.body?.status ?? "");
  if (!["yes", "no", "maybe"].includes(status)) {
    res.status(400).json({ error: "RSVP must be yes, no, or maybe" });
    return;
  }

  await getDb()
    .insert(rsvps)
    .values({
      groupId: found.groupId,
      eventId: found.id,
      userId: req.user!.id,
      status: status as "yes" | "no" | "maybe",
      respondedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [rsvps.eventId, rsvps.userId],
      set: { status: status as "yes" | "no" | "maybe", respondedAt: new Date() },
    });

  broadcast({ type: "event_rsvp_changed", eventId: found.id }, req.get("x-gn-client"));
  res.json(await eventDetail(found, req.user!.id));
});

/**
 * Record whether I actually showed up. Separate from RSVP intent so flake
 * tracking can compare the two. Locked until the event's date arrives —
 * you can't confirm arrival at something that hasn't started.
 */
eventsRouter.post("/events/:id/attendance", async (req: AuthedRequest, res) => {
  const found = await loadEventForMember(String(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  if (typeof req.body?.showed !== "boolean") {
    res.status(400).json({ error: "showed must be true or false" });
    return;
  }
  if (!found.scheduledFor || found.scheduledFor.getTime() > Date.now()) {
    res.status(400).json({ error: "Attendance opens once the event starts" });
    return;
  }

  await getDb()
    .insert(eventAttendance)
    .values({
      groupId: found.groupId,
      eventId: found.id,
      userId: req.user!.id,
      showed: req.body.showed,
      markedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [eventAttendance.eventId, eventAttendance.userId],
      set: { showed: req.body.showed, markedAt: new Date() },
    });

  broadcast(
    { type: "event_updated", eventId: found.id, groupId: found.groupId },
    req.get("x-gn-client"),
  );
  res.json(await eventDetail(found, req.user!.id));
});

// ---------- Helpers ----------

async function isMember(groupId: string, userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, userId)))
    .limit(1);
  return !!rows[0];
}

/** Load an event only if the caller is a member of its group. */
async function loadEventForMember(eventId: string, userId: string) {
  const db = getDb();
  const found = (await db.select().from(events).where(eq(events.id, eventId)).limit(1))[0];
  if (!found) return undefined;
  if (!(await isMember(found.groupId, userId))) return undefined;
  return found;
}

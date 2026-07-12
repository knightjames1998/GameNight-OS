import { Router } from "express";
import { getDb, events, rsvps, memberships, users, and, eq, desc } from "@gamenight/db";
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

  res.json(event);
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

/** Event detail: full RSVP breakdown with names, plus who hasn't answered. */
eventsRouter.get("/events/:id", async (req: AuthedRequest, res) => {
  const found = await loadEventForMember(String(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

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

  res.json({
    ...found,
    rsvps: responses,
    noResponse: members.filter((m) => !answered.has(m.userId)),
    myStatus: responses.find((r) => r.userId === req.user!.id)?.status ?? null,
  });
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

  broadcast({ type: "event_rsvp_changed", eventId: found.id });
  res.json({ ok: true, status });
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

import { Router } from "express";
import crypto from "node:crypto";
import {
  getDb,
  brackets,
  events,
  games,
  groups,
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

export const groupsRouter = Router();
groupsRouter.use(requireAuth);

/** Create a group. Creator becomes owner. */
groupsRouter.post("/", async (req: AuthedRequest, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (name.length < 1 || name.length > 50) {
    res.status(400).json({ error: "Group name must be 1-50 characters" });
    return;
  }

  const db = getDb();
  const group = (
    await db
      .insert(groups)
      .values({
        name,
        slug: `${slugify(name)}-${randomCode(4)}`,
        inviteCode: randomCode(8),
      })
      .returning()
  )[0]!;

  await db.insert(memberships).values({
    groupId: group.id,
    userId: req.user!.id,
    role: "owner",
  });

  res.json(group);
});

/** List the caller's crews. Personal (quick play) groups are hidden. */
groupsRouter.get("/", async (req: AuthedRequest, res) => {
  const db = getDb();
  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      slug: groups.slug,
      inviteCode: groups.inviteCode,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(groups, eq(memberships.groupId, groups.id))
    .where(and(eq(memberships.userId, req.user!.id), eq(groups.isPersonal, false)));
  res.json(rows);
});

/**
 * Promote a member to admin, or demote an admin back to member. Owner only.
 * Admins can run game nights (start brackets and Beerio rooms) and remove
 * plain members; they can't delete the crew or change roles.
 */
groupsRouter.patch("/:id/members/:userId/role", async (req: AuthedRequest, res) => {
  const db = getDb();
  const groupId = String(req.params.id);
  const targetId = String(req.params.userId);
  const role = String(req.body?.role ?? "");
  if (role !== "admin" && role !== "member") {
    res.status(400).json({ error: "role must be admin or member" });
    return;
  }

  const rows = await db
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.groupId, groupId));
  const me = rows.find((m) => m.userId === req.user!.id);
  const target = rows.find((m) => m.userId === targetId);
  if (!me) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  if (me.role !== "owner") {
    res.status(403).json({ error: "Only the crew owner can change roles" });
    return;
  }
  if (!target) {
    res.status(404).json({ error: "That person isn't in this crew" });
    return;
  }
  if (target.role === "owner") {
    res.status(400).json({ error: "The owner's role can't be changed" });
    return;
  }

  await db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, targetId)));
  broadcast({ type: "group_members_changed", groupId });
  res.json({ ok: true });
});

/**
 * Delete an entire crew and everything in it: events, RSVPs, brackets,
 * recorded stats, memberships. Owner only, irreversible, UI confirms hard.
 */
groupsRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const db = getDb();
  const groupId = String(req.params.id);
  const mine = (
    await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, req.user!.id)))
      .limit(1)
  )[0];
  if (!mine) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  if (mine.role !== "owner") {
    res.status(403).json({ error: "Only the crew owner can delete the crew" });
    return;
  }

  // Children first: foreign keys point inward.
  await db.delete(matchParticipants).where(eq(matchParticipants.groupId, groupId));
  await db.delete(matches).where(eq(matches.groupId, groupId));
  await db.delete(brackets).where(eq(brackets.groupId, groupId));
  await db.delete(rsvps).where(eq(rsvps.groupId, groupId));
  await db.delete(events).where(eq(events.groupId, groupId));
  await db.delete(games).where(eq(games.groupId, groupId));
  await db.delete(memberships).where(eq(memberships.groupId, groupId));
  await db.delete(groups).where(eq(groups.id, groupId));

  broadcast({ type: "group_members_changed", groupId });
  res.json({ ok: true });
});

/**
 * Leave a crew. Owners can't walk out on a crew that still has people in
 * it (no ownership transfer exists yet); they remove the others first, or
 * hand over ownership once that ships.
 */
groupsRouter.delete("/:id/members/me", async (req: AuthedRequest, res) => {
  const db = getDb();
  const groupId = String(req.params.id);
  const rows = await db
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.groupId, groupId));

  const me = rows.find((m) => m.userId === req.user!.id);
  if (!me) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  if (me.role === "owner" && rows.length > 1) {
    res.status(400).json({
      error: "Owners can't leave a crew with members in it. Remove them first.",
    });
    return;
  }

  await db
    .delete(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, req.user!.id)));
  broadcast({ type: "group_members_changed", groupId });
  res.json({ ok: true });
});

/** Group detail with member list. Members only. */
groupsRouter.get("/:id", async (req: AuthedRequest, res) => {
  const db = getDb();
  const groupId = String(req.params.id);

  const mine = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, req.user!.id)))
    .limit(1);
  if (!mine[0]) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const group = (await db.select().from(groups).where(eq(groups.id, groupId)).limit(1))[0]!;
  const members = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      role: memberships.role,
      joinedAt: memberships.joinedAt,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.groupId, groupId));

  res.json({ ...group, members, myRole: mine[0].role });
});

/**
 * Remove a member. Owners can remove anyone but themselves; admins can
 * remove plain members. Removal revokes access going forward only: the
 * person's RSVPs and bracket history stay, because a finished bracket
 * should remember who actually played in it.
 */
groupsRouter.delete("/:id/members/:userId", async (req: AuthedRequest, res) => {
  const db = getDb();
  const groupId = String(req.params.id);
  const targetId = String(req.params.userId);

  const rows = await db
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.groupId, groupId));

  const me = rows.find((m) => m.userId === req.user!.id);
  const target = rows.find((m) => m.userId === targetId);
  if (!me) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  if (!target) {
    res.status(404).json({ error: "That person isn't in this group" });
    return;
  }
  if (targetId === req.user!.id) {
    res.status(400).json({ error: "You can't remove yourself" });
    return;
  }
  const allowed =
    (me.role === "owner") ||
    (me.role === "admin" && target.role === "member");
  if (!allowed) {
    res.status(403).json({ error: "You don't have permission to remove this member" });
    return;
  }

  await db
    .delete(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, targetId)));
  broadcast({ type: "group_members_changed", groupId });
  res.json({ ok: true });
});

// ---------- Join flow (separate router: preview must work pre-auth) ----------

export const joinRouter = Router();

/** Public peek at a group name so the join page can say what you're joining. */
joinRouter.get("/:code/preview", async (req, res) => {
  const group = await findByCode(String(req.params.code));
  if (!group) {
    res.status(404).json({ error: "Invalid invite code" });
    return;
  }
  res.json({ name: group.name });
});

/** Join a group via invite code. Idempotent: already a member is a success. */
joinRouter.post("/:code", requireAuth, async (req: AuthedRequest, res) => {
  const group = await findByCode(String(req.params.code));
  if (!group) {
    res.status(404).json({ error: "Invalid invite code" });
    return;
  }
  const db = getDb();
  await db
    .insert(memberships)
    .values({ groupId: group.id, userId: req.user!.id, role: "member" })
    .onConflictDoNothing();
  broadcast({ type: "group_members_changed", groupId: group.id });
  res.json({ groupId: group.id });
});

async function findByCode(code: string) {
  if (!code) return undefined;
  const rows = await getDb().select().from(groups).where(eq(groups.inviteCode, code)).limit(1);
  return rows[0];
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "crew";
}

/** Unambiguous charset: no 0/O or 1/I/L, so codes survive being read aloud. */
function randomCode(len: number): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(len), (b) => chars[b % chars.length]).join("");
}

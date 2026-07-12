import { Router } from "express";
import crypto from "node:crypto";
import { getDb, groups, memberships, users, and, eq } from "@gamenight/db";
import { requireAuth, type AuthedRequest } from "./auth.js";

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

/** List the caller's groups. */
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
    .where(eq(memberships.userId, req.user!.id));
  res.json(rows);
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

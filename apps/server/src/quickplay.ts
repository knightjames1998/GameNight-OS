// Quick play (Option B): running a game mode without a crew.
//
// Rather than a parallel, statless bracket system, a solo user gets a
// PERSONAL crew created on demand. Everything downstream (scoring, TV
// view, recap card, and eventually lifetime stats) works unchanged,
// because it's all still group-scoped. Entrants can be typed-in guests;
// guests carry no stats until someone links them to a member (backlog:
// guest linking in crew settings).

import { Router } from "express";
import crypto from "node:crypto";
import {
  getDb,
  brackets,
  events,
  games,
  groups,
  memberships,
  and,
  eq,
} from "@gamenight/db";
import type { Entrant } from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";

export const quickPlayRouter = Router();
quickPlayRouter.use(requireAuth);

function randomCode(len: number): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(len), (b) => chars[b % chars.length]).join("");
}

/** The caller's personal crew, created the first time it's needed. */
async function ensurePersonalGroup(userId: string, displayName: string) {
  const db = getDb();
  const mine = await db
    .select({ id: groups.id })
    .from(memberships)
    .innerJoin(groups, eq(memberships.groupId, groups.id))
    .where(and(eq(memberships.userId, userId), eq(groups.isPersonal, true)))
    .limit(1);
  if (mine[0]) return mine[0].id;

  const group = (
    await db
      .insert(groups)
      .values({
        name: `${displayName}'s games`,
        slug: `solo-${randomCode(8).toLowerCase()}`,
        inviteCode: randomCode(8),
        isPersonal: true,
      })
      .returning()
  )[0]!;
  await db.insert(memberships).values({ groupId: group.id, userId, role: "owner" });
  return group.id;
}

/**
 * Start a bracket with typed names, no crew or event required. Names that
 * match a crew member aren't special-cased here: quick play is explicitly
 * guest-based. Playing inside a real crew (the event flow) is what earns
 * stats.
 */
quickPlayRouter.post("/quickplay/bracket", async (req: AuthedRequest, res) => {
  const rawNames = Array.isArray(req.body?.names) ? req.body.names : [];
  const names: string[] = rawNames
    .map((n: unknown) => String(n ?? "").trim().slice(0, 24))
    .filter((n: string) => n.length > 0)
    .slice(0, 32);

  if (names.length < 2) {
    res.status(400).json({ error: "Enter at least 2 player names" });
    return;
  }

  const gameName = String(req.body?.gameName ?? "").trim().slice(0, 50) || "Quick Play";
  const db = getDb();
  const groupId = await ensurePersonalGroup(req.user!.id, req.user!.displayName);

  const event = (
    await db
      .insert(events)
      .values({
        groupId,
        title: gameName,
        scheduledFor: new Date(),
        status: "live",
        createdBy: req.user!.id,
      })
      .returning()
  )[0]!;

  const game = (
    await db.insert(games).values({ groupId, name: gameName, pack: "generic" }).returning()
  )[0]!;

  const entrants: Entrant[] = names.map((name) => ({ kind: "guest", name }));

  const bracket = (
    await db
      .insert(brackets)
      .values({
        groupId,
        eventId: event.id,
        gameId: game.id,
        format: "single_elim",
        status: "live",
        entrants,
        results: {},
      })
      .returning()
  )[0]!;

  res.json({ id: bracket.id });
});

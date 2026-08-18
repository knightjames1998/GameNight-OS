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
  rsvps,
  and,
  eq,
} from "@gamenight/db";
import { SESSION_PACKS, SESSION_PACK_KEYS, type BracketFormat, type Entrant } from "@gamenight/shared";
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
 * DEPRECATED, AND KEPT ON PURPOSE. Nothing in the app calls this any more.
 *
 * Replaced 2026-08-18 by POST /quickplay/tournament below, which mints the
 * crew and the event and stops there, exactly like every session pack's quick
 * play route, and then hands off to the SHARED setup screen
 * (/tournament?event=...). The screen this endpoint was built for
 * (QuickPlayPage.tsx, four typed name boxes) was a SECOND entrant
 * implementation, which is why quick play silently missed crew-member
 * entrants, the member/guest distinction, seeding shuffle, team entrants,
 * normalizeEntrants and the entrant cap when those shipped on 08-17. It has
 * been deleted; this has not.
 *
 * IT STAYS BECAUSE OF THE CACHE, not because it is still a design. This is an
 * installed PWA and a phone runs whatever bundle it last cached for as long as
 * it likes, so deleting the endpoint means a host whose start button 404s in
 * front of the room. Same reasoning as the yes-RSVP fallback on the crew
 * bracket route. Do not build on it, and do not port anything into it.
 *
 * Its behaviour is frozen at what it always did: every typed name is a guest,
 * so nothing it creates reaches anybody's lifetime stats.
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
  const format: BracketFormat =
    req.body?.format === "double_elim" ? "double_elim" : "single_elim";
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
        format,
        status: "live",
        entrants,
        results: {},
      })
      .returning()
  )[0]!;

  res.json({ id: bracket.id });
});

/**
 * THE WHOLE OF QUICK PLAY: a personal crew, a live event, and the host said
 * yes. Every quick play route in this file is this function and a title.
 *
 * That is the design rather than an implementation detail. A quick play route
 * mints context and stops; the caller then opens the pack's OWN screen at
 * ?event=<id>, so quick play runs the identical setup, scoring and
 * materializer a crew night runs. A feature added to a pack is in quick play
 * the moment it ships, and nobody has to remember to port it. The tournament
 * did NOT work this way until 2026-08-18 and it is the only place the app has
 * ever had a quick play parity gap.
 *
 * THE HOST IS AUTO-RSVP'D YES, added 2026-08-18. Prefill everywhere in this app
 * is the yes list, so without this every setup screen opens with an empty
 * roster on a night whose one known player is the person looking at it. It is
 * one insert here and it fixes that cold start for all thirteen tiles at once.
 *
 * A yes on a personal crew CANNOT inflate anybody's flake rate, and that was
 * checked rather than assumed: attendanceFor() counts a past dated yes with no
 * check-in as a flake, and all three of its callers exclude personal crews
 * (/api/me/stats builds realCrewIds from isPersonal = false, the rivalry uses
 * sharedGroupIds which filters the same way, and the crew profile takes an
 * explicit groupId that the crew list in groups.ts never surfaces for a
 * personal crew).
 */
async function quickEvent(req: AuthedRequest, fallbackTitle: string): Promise<string> {
  const db = getDb();
  const groupId = await ensurePersonalGroup(req.user!.id, req.user!.displayName);
  const title = String(req.body?.title ?? "").trim().slice(0, 50) || fallbackTitle;
  const event = (
    await db
      .insert(events)
      .values({ groupId, title, scheduledFor: new Date(), status: "live", createdBy: req.user!.id })
      .returning()
  )[0]!;
  await db.insert(rsvps).values({
    groupId,
    eventId: event.id,
    userId: req.user!.id,
    status: "yes",
  });
  return event.id;
}

/**
 * Quick play for the TOURNAMENT, which is not a pack and so is not in the loop
 * below: it has no registry entry, for the same reason pack-screens.test.ts
 * lists BracketPage.tsx explicitly. It is what a pack-less night runs on.
 *
 * Identical in shape to every pack's route, which is the entire point of this
 * commit: mint the context, return the event id, and let the client open the
 * SHARED setup screen. What quick play offers is now whatever that screen
 * offers, permanently, with nothing to keep in step.
 *
 * NOTE WHAT IS NOT HERE: no bracket, no entrants, no game row. The setup
 * screen POSTs /api/events/:id/bracket, the same endpoint the crew path uses,
 * which is what keeps games.name at "Tournament" and games.pack at "generic"
 * so a lifetime history cannot split across typed names.
 */
quickPlayRouter.post("/quickplay/tournament", async (req: AuthedRequest, res) => {
  res.json({ eventId: await quickEvent(req, "Tournament") });
});

// One route per session pack, registered from the registry rather than typed
// out four times. The route segment and the fallback title both come from the
// pack's entry, so a new pack gets its quick-play route by existing, and
// cannot get one whose spelling disagrees with the page that calls it, since
// the client builds the same url from the same entry.
for (const key of SESSION_PACK_KEYS) {
  const pack = SESSION_PACKS[key];
  quickPlayRouter.post(`/quickplay/${pack.route}`, async (req: AuthedRequest, res) => {
    res.json({ eventId: await quickEvent(req, pack.quickTitle) });
  });
}

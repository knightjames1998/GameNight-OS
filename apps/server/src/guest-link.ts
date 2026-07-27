// One-time guest -> member stat backfill.
//
// Flow (owner/admin only, per group):
//   GET  /groups/:id/guest-names          -> distinct past guest names
//   POST /groups/:id/guest-link/preview   -> dry run: exactly what would be
//                                            credited, nothing written
//   POST /groups/:id/guest-link/confirm   -> writes it, additive + idempotent
//
// Nothing here can be runtime-tested in CI, so the preview is the safety net:
// the admin sees every game that would move before anything is written. Each
// insert reuses the pack's own materializer with ON CONFLICT DO NOTHING, so a
// re-run is a no-op and existing rows are never disturbed.
//
// Beerio links off matches.rawResult, the full standings snapshot stored at
// completion. It keeps no usable session record otherwise, so a night with no
// rawResult has no guest names to match and simply contributes nothing.

import { Router } from "express";
import { getDb, events, memberships, and, eq, inArray } from "@gamenight/db";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { broadcast } from "./ws.js";
import type { GuestCreditItem } from "./guest-link-util.js";
import { guestNamesBracket, creditGuestBracket } from "./brackets.js";
import { guestNamesSmash, creditGuestSmash } from "./smash.js";
import { guestNamesMarioKart, creditGuestMarioKart } from "./mariokart.js";
import { guestNamesMarioParty, creditGuestMarioParty } from "./marioparty.js";
import { guestNamesPingPong, creditGuestPingPong } from "./pingpong.js";
import { guestNamesBeerio, creditGuestBeerio } from "./beerio-gn.js";

export const guestLinkRouter = Router();

const nameAdapters = [
  guestNamesBracket,
  guestNamesSmash,
  guestNamesMarioKart,
  guestNamesMarioParty,
  guestNamesPingPong,
  guestNamesBeerio,
];

const creditAdapters: {
  key: string;
  credit: (g: string, name: string, member: string, dry: boolean) => Promise<{ items: GuestCreditItem[]; written: number }>;
}[] = [
  { key: "bracket", credit: creditGuestBracket },
  { key: "smash", credit: creditGuestSmash },
  { key: "mario_kart", credit: creditGuestMarioKart },
  { key: "mario_party", credit: creditGuestMarioParty },
  { key: "pingpong", credit: creditGuestPingPong },
  { key: "beerio", credit: creditGuestBeerio },
];

async function roleOf(groupId: string, userId: string): Promise<string | undefined> {
  const rows = await getDb()
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, userId)))
    .limit(1);
  return rows[0]?.role;
}

/** Map each event id to a display title, for the preview list. */
async function eventTitles(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: events.id, title: events.title })
    .from(events)
    .where(inArray(events.id, ids));
  return new Map(rows.map((r) => [r.id, r.title]));
}

// Names + members, gated to owner/admin.
guestLinkRouter.get("/groups/:id/guest-names", requireAuth, async (req: AuthedRequest, res) => {
  const groupId = String(req.params.id);
  const role = await roleOf(groupId, req.user!.id);
  if (role !== "owner" && role !== "admin") {
    res.status(403).json({ error: "Owner or admin only" });
    return;
  }
  const names = new Set<string>();
  for (const fn of nameAdapters) for (const n of await fn(groupId)) names.add(n);
  res.json({ names: [...names].sort((a, b) => a.localeCompare(b)) });
});

async function scan(
  groupId: string,
  guestName: string,
  memberId: string,
  dryRun: boolean,
): Promise<{ items: (GuestCreditItem & { eventTitle: string })[]; written: number; byPack: Record<string, number> }> {
  const items: GuestCreditItem[] = [];
  const byPack: Record<string, number> = {};
  let written = 0;
  for (const a of creditAdapters) {
    const r = await a.credit(groupId, guestName, memberId, dryRun);
    items.push(...r.items);
    written += r.written;
    byPack[a.key] = dryRun ? r.items.length : r.written;
  }
  const titles = await eventTitles([...new Set(items.map((i) => i.eventId))]);
  const enriched = items.map((i) => ({ ...i, eventTitle: titles.get(i.eventId) ?? "a game night" }));
  return { items: enriched, written, byPack };
}

// Shared validation for preview + confirm.
async function guard(req: AuthedRequest, res: import("express").Response): Promise<{ groupId: string; guestName: string; memberId: string } | null> {
  const groupId = String(req.params.id);
  const role = await roleOf(groupId, req.user!.id);
  if (role !== "owner" && role !== "admin") {
    res.status(403).json({ error: "Owner or admin only" });
    return null;
  }
  const guestName = String(req.body?.guestName ?? "").trim();
  const memberId = String(req.body?.memberId ?? "").trim();
  if (!guestName || !memberId) {
    res.status(400).json({ error: "guestName and memberId are required" });
    return null;
  }
  // The target must be a member of THIS crew (never credit an outsider).
  if (!(await roleOf(groupId, memberId))) {
    res.status(400).json({ error: "That person is not a member of this crew" });
    return null;
  }
  return { groupId, guestName, memberId };
}

guestLinkRouter.post("/groups/:id/guest-link/preview", requireAuth, async (req: AuthedRequest, res) => {
  const g = await guard(req, res);
  if (!g) return;
  const { items } = await scan(g.groupId, g.guestName, g.memberId, true);
  res.json({ items, total: items.length });
});

guestLinkRouter.post("/groups/:id/guest-link/confirm", requireAuth, async (req: AuthedRequest, res) => {
  const g = await guard(req, res);
  if (!g) return;
  const { items, written, byPack } = await scan(g.groupId, g.guestName, g.memberId, false);
  // Nudge any open live view for a touched event to refetch its leaderboard.
  if (written > 0) {
    const origin = req.get("x-gn-client");
    for (const eventId of new Set(items.map((i) => i.eventId))) {
      broadcast({ type: "leaderboard_updated", eventId }, origin);
    }
  }
  res.json({ written, byPack });
});

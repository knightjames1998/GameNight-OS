// THE SECRET STORE: where a deduction deal lives, and the only two routes that
// can read it.
//
// ===========================================================================
// WHY THIS IS A SEPARATE STORE AND NOT A FIELD ON THE SESSION.
//
// `createPackRuntime`'s `sessionView(eventId, preloaded)` takes NO VIEWER
// ARGUMENT. Every pack returns one payload to everybody, and `viewOf` builds it
// by SPREADING THE WHOLE STATE (`...loaded.state`), which is exactly right for
// nine packs whose state is public by nature. Standing rule 2 says members join
// the host's live session, so a `roles` field on `SdSessionState` would be
// handed to every player at the table the moment they opened the page. Nothing
// would error. The game would simply be over.
//
// The rejected alternative was making sessionView viewer-aware. It touches the
// plumbing all ten packs sit on and it makes every future pack responsible for
// remembering to redact, which is a rule that holds right up until somebody
// adds a field. So: the secret lives HERE, in its own row, and the session
// payload is public-safe BY CONSTRUCTION rather than by filtering. Same
// instinct as `sideIdFor` holding the null rule in one place.
//
// THE WEBSOCKET HUB IS NOT A SECOND LEAK VECTOR, which was checked rather than
// assumed: packs broadcast `{ type, eventId }` only, a ping that triggers a
// refetch, so fixing the one function fixes the wire with it.
// ===========================================================================
//
// NO SCHEMA CHANGE. `game_sessions` is keyed (eventId, pack) with a free-text
// pack column, so the deal is a second row on the same event under a pack value
// no registry entry claims. That value is deliberately NOT in `SESSION_PACKS`,
// which is what keeps it invisible to everything that reads the table
// generically: the event TV resolver and the event detail payload both look the
// pack up in `PACK_BY_LEDGER` and DROP a row they cannot resolve, so the secret
// row cannot become a tile, a TV screen or a "live now" line. Asserted in
// tests/deduction-secrecy.test.ts.
//
// THE ROW IS DELETED RATHER THAN EMPTIED when a game is recorded or the night
// ends. A secret with no further use should not be sitting in a database.

import { getDb, gameSessions, and, eq } from "@gamenight/db";
import {
  sdFaction,
  sdRole,
  sdTitleDef,
  SESSION_PACKS,
  type SdAlignment,
  type SdRoleAssignment,
  type SdSessionState,
} from "@gamenight/shared";
import type { Router } from "express";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { isHostRole, roleOf, type PackRuntime } from "./pack-runtime.js";

/**
 * The pack value the secret row is stored under.
 *
 * Derived from the registry's ledger spelling so the two can never drift, and
 * suffixed so it is a DIFFERENT primary key from the pack's own session row.
 * It must never gain a `SESSION_PACKS` entry of its own: an entry is what would
 * make it resolvable, and a resolvable secret row is one the event TV would try
 * to render.
 */
export const DEDUCTION_SECRET_PACK = `${SESSION_PACKS.deduction.ledger}_secret`;

/** One dealt game. The whole of it is secret until reveal. */
export interface SdDeal {
  /** Matches `SdSessionState.deal.dealNo`, which is how a stale deal is caught. */
  dealNo: number;
  title: string;
  at: string;
  /** playerId -> roleId. THE SECRET. */
  roles: SdRoleAssignment;
}

const where = (eventId: string) =>
  and(eq(gameSessions.eventId, eventId), eq(gameSessions.pack, DEDUCTION_SECRET_PACK));

/** The deal in force on this event, or null. */
export async function loadDeal(eventId: string): Promise<SdDeal | null> {
  const row = (await getDb().select().from(gameSessions).where(where(eventId)).limit(1))[0];
  if (!row) return null;
  const state = row.state as unknown as Partial<SdDeal>;
  if (!state || typeof state.dealNo !== "number" || !state.roles) return null;
  return {
    dealNo: state.dealNo,
    title: String(state.title ?? ""),
    at: String(state.at ?? ""),
    roles: state.roles,
  };
}

/** Store a deal, replacing whatever this event had. */
export async function saveDeal(eventId: string, groupId: string, deal: SdDeal): Promise<void> {
  const value = deal as unknown as Record<string, unknown>;
  await getDb()
    .insert(gameSessions)
    .values({ eventId, pack: DEDUCTION_SECRET_PACK, groupId, status: "live", state: value })
    .onConflictDoUpdate({
      target: [gameSessions.eventId, gameSessions.pack],
      set: { groupId, status: "live", state: value, updatedAt: new Date() },
    });
}

/**
 * Forget the deal. Called on reveal, on undo, when a night ends and when a new
 * night starts on the same event, so a secret never outlives the game it
 * belonged to.
 */
export async function clearDeal(eventId: string): Promise<void> {
  await getDb().delete(gameSessions).where(where(eventId));
}

// ---------- the two routes, and there are only two ----------

/** What one viewer is told about themselves. Never about anybody else. */
export interface MyRoleView {
  dealNo: number | null;
  title: string | null;
  /** The caller's own roster slot, or null when they are not playing tonight. */
  playerId: string | null;
  role: { id: string; name: string; factionId: string; factionName: string; alignment: SdAlignment } | null;
}

/** One line of the host's full deal. */
export interface DealLine {
  playerId: string;
  name: string;
  roleId: string;
  roleName: string;
  factionId: string;
  factionName: string;
  alignment: SdAlignment;
}

/**
 * A dealt role, resolved against the title it was dealt under. Returns null for
 * a role the catalogue no longer has, which is survivable: the screen says
 * nothing rather than inventing a role.
 */
function describe(title: string, roleId: string | undefined) {
  if (!roleId) return null;
  const def = sdTitleDef(title);
  const r = sdRole(def, roleId);
  if (!r) return null;
  const f = sdFaction(def, r.factionId);
  return {
    id: r.id,
    name: r.name,
    factionId: r.factionId,
    factionName: f?.name ?? r.factionId,
    alignment: (f?.alignment ?? "solo") as SdAlignment,
  };
}

/**
 * Mount the per-viewer route and the host-gated route.
 *
 * TWO ROUTES AND NO OTHERS. Everything else about this pack goes through the
 * ordinary public session payload, so the surface a role can escape through is
 * these two handlers, both of which are read-only, both authed, and both
 * `no-store` because a secret must not sit in an intermediary's cache.
 */
export function registerSecretRoutes(router: Router, rt: PackRuntime<SdSessionState>): void {
  const route = SESSION_PACKS.deduction.route;

  /**
   * YOUR OWN ROLE, AND ONLY YOURS.
   *
   * The response is one role or null. It is deliberately not "the deal, filtered
   * to you": there is no code path here that has the other players' roles in a
   * variable it could accidentally serialize, which is the difference between a
   * rule and a rule with a mechanism.
   *
   * A member who is not in tonight's roster gets `playerId: null` rather than a
   * 403. Watching a game you are not in is normal, and it is not an error.
   */
  router.get(`/${route}/:eventId/my-role`, requireAuth, async (req: AuthedRequest, res) => {
    const eventId = String(req.params.eventId);
    const loaded = await rt.loadState(eventId);
    if (!loaded) {
      res.status(404).json({ error: "No session" });
      return;
    }
    // Membership, not hosting: every player at the table needs their own role.
    if (!(await roleOf(loaded.row.groupId, req.user!.id))) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");

    const slot = loaded.state.roster.find((p) => p.userId === req.user!.id);
    const deal = slot ? await loadDeal(eventId) : null;
    // A deal from a game that has already been recorded is not this game's
    // deal. The dealNo check is what stops a stale row telling somebody they
    // are the wolf in a game that finished an hour ago.
    const live = deal && loaded.state.deal && deal.dealNo === loaded.state.deal.dealNo ? deal : null;

    const view: MyRoleView = {
      dealNo: live?.dealNo ?? null,
      title: live?.title ?? null,
      playerId: slot?.id ?? null,
      role: live && slot ? describe(live.title, live.roles[slot.id]) : null,
    };
    res.json(view);
  });

  /**
   * THE WHOLE DEAL, for the moderator.
   *
   * Host-gated SERVER-SIDE, which is the only place gating counts: a member who
   * guessed the URL is refused here rather than merely not being shown a button.
   */
  router.get(`/${route}/:eventId/deal`, requireAuth, async (req: AuthedRequest, res) => {
    const eventId = String(req.params.eventId);
    const loaded = await rt.loadState(eventId);
    if (!loaded) {
      res.status(404).json({ error: "No session" });
      return;
    }
    const role = await roleOf(loaded.row.groupId, req.user!.id);
    if (!role) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!isHostRole(role)) {
      res.status(403).json({ error: "Only the host sees the whole deal" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");

    const deal = await loadDeal(eventId);
    const live = deal && loaded.state.deal && deal.dealNo === loaded.state.deal.dealNo ? deal : null;
    if (!live) {
      res.json({ dealNo: null, title: null, lines: [] });
      return;
    }
    const nameOf = new Map(loaded.state.roster.map((p) => [p.id, p.name]));
    const lines: DealLine[] = [];
    for (const p of loaded.state.roster) {
      const d = describe(live.title, live.roles[p.id]);
      if (!d) continue;
      lines.push({
        playerId: p.id,
        name: nameOf.get(p.id) ?? "?",
        roleId: d.id,
        roleName: d.name,
        factionId: d.factionId,
        factionName: d.factionName,
        alignment: d.alignment,
      });
    }
    res.json({ dealNo: live.dealNo, title: live.title, lines });
  });
}

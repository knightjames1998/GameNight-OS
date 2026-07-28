// One pack runtime for every session pack.
//
// smash.ts, mariokart.ts, marioparty.ts and pingpong.ts were each adapted from
// the one before, so until this file existed they carried the same plumbing
// four times over: roleOf, isHostRole, loadState, saveState, ensureGame,
// ledgerKey, deleteMaterialized, the launch-context endpoint, the guest-name
// scan, the "find or insert the matches row" half of every materializer, and
// the sessionView/respondState pair. roleOf alone existed six times, counting
// guest-link.ts and brackets.ts. Adding a pack meant editing fourteen files and
// hand-copying roughly five hundred lines, and four more packs are queued.
//
// What is parameterised here is plumbing only. What genuinely differs between
// packs stays in the pack file:
//   - its routes and its request validation,
//   - its state shape,
//   - its materialize*, because the LEDGER UNIT really is different
//     (game-as-unit for Smash FFA and Mario Kart races, match-as-unit for a
//     best-of series or a ping pong match, board-as-unit for Mario Party),
//   - the extra fields its sessionView adds on top of the shared envelope.
//
// Two constraints this file exists to hold still, both of which fail SILENTLY
// if broken, which is why they are stated here and asserted in
// tests/pack-runtime.test.ts:
//
//   1. TABLES. Smash reads smash_sessions, keyed by eventId alone. The other
//      three read game_sessions, keyed (eventId, pack). Collapsing Smash onto
//      game_sessions would be a data migration wearing a refactor costume, and
//      it is not what this file is for.
//   2. LEDGER KEYS. ledgerKey output must stay identical character for
//      character, for both the modern {prefix}:{eventId}:{sessionKey}:{idx}
//      shape and the legacy no-sessionKey shape. A changed key orphans the
//      existing ledger rows without erroring: the leaderboard just quietly
//      stops matching history.
//
// The wsType strings are fixed constants for the same reason. A typo'd one
// kills live sync without an error anywhere, because the client never matches
// the message and screens stop updating until someone refreshes, which is the
// one thing standing rule 6 says must never happen.

import type { Response } from "express";
import {
  getDb,
  events,
  games,
  gameSessions,
  matches,
  matchParticipants,
  memberships,
  rsvps,
  smashSessions,
  users,
  and,
  eq,
} from "@gamenight/db";
import { SESSION_PACKS, type PackWsType, type SessionPackKey } from "@gamenight/shared";
import { insertParticipants } from "./participants.js";
import { broadcast } from "./ws.js";

type Db = ReturnType<typeof getDb>;
type ParticipantRow = typeof matchParticipants.$inferInsert;
export type SessionStatus = "setup" | "live" | "completed";

/**
 * The live-sync message types a session pack may broadcast, re-exported from
 * the shared pack registry, which is now the ONE place these strings exist.
 * A typo'd wsType kills live sync SILENTLY: the client never matches the
 * message, screens stop updating, and nothing errors anywhere until someone
 * refreshes, which is the one thing standing rule 6 says must never happen.
 * Deriving it from the registry means a new pack cannot have one at all
 * without declaring it once, in the place every other consumer reads.
 */
export type { PackWsType };

// ---------- membership, shared by every router in the server ----------

/**
 * The caller's role in a crew, or undefined if they are not a member. Six
 * copies of this query existed before it lived here; brackets.ts and
 * guest-link.ts import it too, so a change to how membership is read can no
 * longer land in four places and miss two.
 */
export async function roleOf(
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

/** Standing rule 1: owners and admins host, members watch. */
export const isHostRole = (r: string | undefined) => r === "owner" || r === "admin";

// ---------- the per-pack configuration ----------

export interface PackRuntimeConfig<S> {
  /** games.pack and, for the shared table, the second half of the key. */
  pack: string;
  /**
   * games.name. This is the JOIN KEY for the crew leaderboard tabs: renaming
   * it splits a pack's history across two tabs, so these are fixed strings.
   */
  gameName: string;
  /** The broadcast message type the pack's client hook listens for. */
  wsType: PackWsType;
  /** The ledger externalKey namespace, e.g. "mk" -> mk:{eventId}:{sk}:{idx}. */
  keyPrefix: string;
  /** Smash predates the shared table and keeps its own. */
  table: "game_sessions" | "smash_sessions";
  /** Everything the pack's session payload adds on top of the envelope. */
  extras: (state: S) => Record<string, unknown>;
}

/**
 * The identity half of a pack's config, read straight from the shared
 * registry. A pack file now supplies only its `extras`, which is the part that
 * genuinely differs; the five strings that MUST match the client (and must
 * never change for an existing pack, because ledger keys and game names orphan
 * history silently) are no longer retyped per pack.
 */
export function packConfig(key: SessionPackKey): Omit<PackRuntimeConfig<unknown>, "extras"> {
  const d = SESSION_PACKS[key];
  return {
    pack: d.ledger,
    gameName: d.gameName,
    wsType: d.wsType,
    keyPrefix: d.keyPrefix,
    table: d.table,
  };
}

/** The columns every session row has, whichever table it came from. */
export interface SessionRow {
  eventId: string;
  groupId: string;
  status: SessionStatus;
  state: Record<string, unknown>;
}

export interface Loaded<S> {
  row: SessionRow;
  state: S;
}

/** A roster slot, as every pack stores it in its session jsonb. */
export interface RosterSlot {
  id: string;
  kind: "member" | "guest";
  userId: string | null;
  name: string;
}

/**
 * One result line, reduced to what the ledger cares about. Each pack maps its
 * own line shape onto this; score and meta are the two columns packs use
 * differently (Mario Party stars and bonus stars, Ping Pong points and game
 * wins), and undefined leaves them out of the row entirely.
 */
export interface LedgerLine {
  playerId: string;
  placement: number | null;
  isWinner: boolean;
  character?: string | null;
  score?: number | null;
  meta?: unknown;
}

// ---------- the pure half of materialize ----------

/**
 * Decide which participant rows one recorded unit produces. Pure: no database,
 * no clock, no randomness, so it is exhaustively testable and the database call
 * downstream is a thin insert of an already-checked array.
 *
 * Two rules live here and are the reason this is worth separating:
 *
 *   - Guests carry no lifetime stats, so a slot with no userId is SKIPPED and
 *     COUNTED. Silently dropping guests was a real bug; callers report the
 *     count. A guest whose name appears in linkMap resolves to that member,
 *     which is the entire mechanism behind the guest-link backfill.
 *   - Rows are keyed by userId so one INSERT can never carry the same
 *     (matchId, userId) twice. That is reachable in real life: two guest slots
 *     typed with the same name both resolve to one member through the link
 *     map. First occurrence wins, matching the sequential loop this replaced,
 *     where the second insert hit ON CONFLICT and wrote nothing.
 */
export function participantRows(args: {
  groupId: string;
  matchId: string;
  roster: RosterSlot[];
  lines: LedgerLine[];
  /** guest display name -> member userId, present only on a backfill. */
  linkMap?: Map<string, string>;
}): { rows: ParticipantRow[]; guests: number } {
  const { groupId, matchId, roster, lines, linkMap } = args;
  const slotById = new Map(roster.map((p) => [p.id, p]));
  const byUser = new Map<string, ParticipantRow>();
  let guests = 0;

  for (const line of lines) {
    const slot = slotById.get(line.playerId);
    const userId = slot ? (slot.kind === "guest" ? linkMap?.get(slot.name) : slot.userId) : undefined;
    if (!userId) {
      guests++;
      continue;
    }
    if (byUser.has(userId)) continue;
    const row: ParticipantRow = {
      groupId,
      matchId,
      userId,
      placement: line.placement,
      isWinner: line.isWinner,
    };
    if (line.character !== undefined) row.character = line.character ?? null;
    if (line.score !== undefined) row.score = line.score;
    if (line.meta !== undefined) row.meta = line.meta as ParticipantRow["meta"];
    byUser.set(userId, row);
  }

  return { rows: [...byUser.values()], guests };
}

// ---------- the runtime ----------

export interface PackRuntime<S> extends PackRuntimeConfig<S> {
  loadState(eventId: string): Promise<Loaded<S> | null>;
  /**
   * Persist, broadcast, and hand back the session payload. Returning the view
   * is what lets a mutation handler answer from the state it already holds
   * instead of re-SELECTing the row it just wrote.
   */
  saveState(loaded: Loaded<S>, status: SessionStatus, origin?: string): Promise<SessionPayload>;
  /** Create the session row, or replace it (start / confirm-and-replace). */
  startSession(eventId: string, groupId: string, state: S, origin?: string): Promise<SessionPayload>;
  ensureGame(groupId: string): Promise<string>;
  ledgerKey(eventId: string, sessionKey: string | undefined, idx: number): string;
  deleteMaterialized(eventId: string, sessionKey: string | undefined, idx: number): Promise<void>;
  sessionView(eventId: string, preloaded?: Loaded<S> | null): Promise<SessionPayload>;
  respondState(eventId: string, res: Response, preloaded?: Loaded<S> | null): Promise<void>;
  /** The session payload for a row already in hand. No query. */
  viewOf(loaded: Loaded<S> | null): SessionPayload;
  launchContext(eventId: string, userId: string): Promise<LaunchContext | null>;
  /** Every distinct guest display name across this crew's sessions. */
  guestNames(groupId: string, rosterOf: (state: S) => RosterSlot[] | undefined): Promise<string[]>;
  /** Every (eventId, state) pair for this crew, for the guest backfill. */
  sessionsForGroup(groupId: string): Promise<{ eventId: string; state: S }[]>;
  /**
   * Find or create the matches row for one recorded unit, then write its
   * participants. Returns nothing to do when the unit is already materialized
   * and there is no link map, which is the live path's idempotency.
   */
  materializeUnit(args: MaterializeArgs): Promise<{ recorded: number; guests: number }>;
  broadcastPack(eventId: string, origin?: string): void;
}

export interface SessionPayload {
  session: null | ({ status: SessionStatus; groupId: string } & Record<string, unknown>);
}

export interface LaunchContext {
  groupId: string;
  canHost: boolean;
  viewerId: string;
  prefill: { userId: string; name: string }[];
  members: { userId: string; name: string }[];
  live: boolean;
}

export interface MaterializeArgs {
  groupId: string;
  eventId: string;
  gameId: string;
  /** The unit's index within the session; becomes matches.position. */
  idx: number;
  sessionKey: string | undefined;
  /** matches.label: the board, the cup, bo{N}, or null. */
  label?: string | null;
  /** matches.format: the pack's format for this unit. */
  format: string;
  roster: RosterSlot[];
  lines: LedgerLine[];
  linkMap?: Map<string, string>;
}

export function createPackRuntime<S>(config: PackRuntimeConfig<S>): PackRuntime<S> {
  const { pack, gameName, wsType, keyPrefix, table, extras } = config;
  const ownTable = table === "smash_sessions";

  /**
   * The predicate that identifies one pack's session row. Smash's table has one
   * row per event and no pack column at all; the shared table is keyed
   * (eventId, pack) so several packs coexist on the same event.
   */
  const whereSession = (eventId: string) =>
    ownTable
      ? eq(smashSessions.eventId, eventId)
      : and(eq(gameSessions.eventId, eventId), eq(gameSessions.pack, pack));

  const broadcastPack = (eventId: string, origin?: string) => {
    broadcast({ type: wsType, eventId }, origin);
  };

  /**
   * "Something about WHICH game is on changed", as opposed to "the score
   * changed". Two screens need it and neither was getting it: the event page,
   * which listens for exactly this type and so never noticed a host starting
   * Smash (smash_updated fired, and EventPage does not listen for that), and
   * the event TV route, which has to re-resolve what it is showing when a
   * session starts or ends. Before this it was broadcast from exactly ONE
   * place in the server, beerio-gn's room-open route.
   */
  const broadcastSessionChanged = (eventId: string, origin?: string) => {
    broadcast({ type: "event_session_changed", eventId }, origin);
  };

  function viewOf(loaded: Loaded<S> | null): SessionPayload {
    if (!loaded) return { session: null };
    return {
      session: {
        status: loaded.row.status,
        groupId: loaded.row.groupId,
        ...(loaded.state as Record<string, unknown>),
        ...extras(loaded.state),
      },
    };
  }

  async function loadState(eventId: string): Promise<Loaded<S> | null> {
    const db = getDb();
    const row = ownTable
      ? (await db.select().from(smashSessions).where(whereSession(eventId)).limit(1))[0]
      : (await db.select().from(gameSessions).where(whereSession(eventId)).limit(1))[0];
    if (!row) return null;
    return { row, state: row.state as unknown as S };
  }

  async function saveState(
    loaded: Loaded<S>,
    status: SessionStatus,
    origin?: string,
  ): Promise<SessionPayload> {
    const db = getDb();
    const set = {
      state: loaded.state as unknown as Record<string, unknown>,
      status,
      updatedAt: new Date(),
    };
    if (ownTable) {
      await db.update(smashSessions).set(set).where(whereSession(loaded.row.eventId));
    } else {
      await db.update(gameSessions).set(set).where(whereSession(loaded.row.eventId));
    }
    broadcastPack(loaded.row.eventId, origin);
    // Ending the night changes what is live on this event, not just what the
    // scoreboard says, so the event page and the event TV both need telling.
    // Only on the transition: a completed session saved again is not news.
    if (status === "completed" && loaded.row.status !== "completed") {
      broadcastSessionChanged(loaded.row.eventId, origin);
    }
    // The caller's row object still carries the pre-write status, and the
    // payload must describe what was just stored, so reflect it back before
    // building the view.
    loaded.row.status = status;
    return viewOf(loaded);
  }

  async function startSession(
    eventId: string,
    groupId: string,
    state: S,
    origin?: string,
  ): Promise<SessionPayload> {
    const db = getDb();
    const value = state as unknown as Record<string, unknown>;
    if (ownTable) {
      await db
        .insert(smashSessions)
        .values({ eventId, groupId, status: "live", state: value })
        .onConflictDoUpdate({
          target: smashSessions.eventId,
          set: { groupId, status: "live", state: value, updatedAt: new Date() },
        });
    } else {
      await db
        .insert(gameSessions)
        .values({ eventId, pack, groupId, status: "live", state: value })
        .onConflictDoUpdate({
          target: [gameSessions.eventId, gameSessions.pack],
          set: { groupId, status: "live", state: value, updatedAt: new Date() },
        });
    }
    broadcastPack(eventId, origin);
    broadcastSessionChanged(eventId, origin);
    return viewOf({ row: { eventId, groupId, status: "live", state: value }, state });
  }

  /** The crew's single game row for this pack, created on first use. */
  async function ensureGame(groupId: string): Promise<string> {
    const db = getDb();
    const existing = (
      await db
        .select({ id: games.id })
        .from(games)
        .where(and(eq(games.groupId, groupId), eq(games.pack, pack)))
        .limit(1)
    )[0];
    if (existing) return existing.id;
    const created = (
      await db.insert(games).values({ groupId, name: gameName, pack }).returning()
    )[0]!;
    return created.id;
  }

  /**
   * The ledger externalKey for one recorded unit. Namespaced by the session's
   * sessionKey so a later session on the same event (idx restarts at 0) cannot
   * collide with an earlier session's keys and get dropped as a duplicate.
   * Legacy sessions started before sessionKey existed fall back to the old
   * shape, which never collides with a new one.
   */
  function ledgerKey(eventId: string, sessionKey: string | undefined, idx: number): string {
    return sessionKey ? `${keyPrefix}:${eventId}:${sessionKey}:${idx}` : `${keyPrefix}:${eventId}:${idx}`;
  }

  async function findMatch(db: Db, eventId: string, key: string): Promise<string | undefined> {
    return (
      await db
        .select({ id: matches.id })
        .from(matches)
        .where(and(eq(matches.eventId, eventId), eq(matches.externalKey, key)))
        .limit(1)
    )[0]?.id;
  }

  async function deleteMaterialized(
    eventId: string,
    sessionKey: string | undefined,
    idx: number,
  ): Promise<void> {
    const db = getDb();
    const id = await findMatch(db, eventId, ledgerKey(eventId, sessionKey, idx));
    if (!id) return;
    await db.delete(matchParticipants).where(eq(matchParticipants.matchId, id));
    await db.delete(matches).where(eq(matches.id, id));
  }

  async function materializeUnit(args: MaterializeArgs): Promise<{ recorded: number; guests: number }> {
    const db = getDb();
    const key = ledgerKey(args.eventId, args.sessionKey, args.idx);
    const existing = await findMatch(db, args.eventId, key);
    // Live path: already materialized and nothing to link, so nothing to do. A
    // guest backfill instead reuses the existing row and adds the participant
    // that was skipped, keyed the same, ON CONFLICT DO NOTHING.
    if (existing && !args.linkMap?.size) return { recorded: 0, guests: 0 };

    const matchId =
      existing ??
      (
        await db
          .insert(matches)
          .values({
            groupId: args.groupId,
            gameId: args.gameId,
            eventId: args.eventId,
            externalKey: key,
            label: args.label ?? null,
            format: args.format,
            round: 1,
            position: args.idx,
            status: "completed",
          })
          .returning()
      )[0]!.id;

    const { rows, guests } = participantRows({
      groupId: args.groupId,
      matchId,
      roster: args.roster,
      lines: args.lines,
      linkMap: args.linkMap,
    });
    await insertParticipants(db, rows);
    return { recorded: rows.length, guests };
  }

  async function sessionView(eventId: string, preloaded?: Loaded<S> | null): Promise<SessionPayload> {
    // A caller that already holds the row and state passes it in rather than
    // making this re-SELECT what it just read or wrote. `null` is a real answer
    // (no session), so the check is for `undefined`, not falsiness.
    return viewOf(preloaded !== undefined ? preloaded : await loadState(eventId));
  }

  async function respondState(eventId: string, res: Response, preloaded?: Loaded<S> | null) {
    res.json(await sessionView(eventId, preloaded));
  }

  /**
   * The launcher's setup payload: yes-RSVP prefill (standing rule 8), the
   * crew's members for roster building, whether the viewer can host, and the
   * viewer's own userId so the client knows which slot is "you".
   *
   * Role, RSVPs, members and any live session all depend only on the event row,
   * so they go out together: 5 sequential round trips become 2. The role gate
   * still runs before anything is returned; the other three reads are discarded
   * when it fails, which costs nothing on a 404.
   */
  async function launchContext(eventId: string, userId: string): Promise<LaunchContext | null> {
    const db = getDb();
    const event = (await db.select().from(events).where(eq(events.id, eventId)).limit(1))[0];
    if (!event) return null;

    const [role, yes, members, existing] = await Promise.all([
      roleOf(event.groupId, userId),
      db
        .select({ userId: rsvps.userId, displayName: users.displayName })
        .from(rsvps)
        .innerJoin(users, eq(rsvps.userId, users.id))
        .where(and(eq(rsvps.eventId, event.id), eq(rsvps.status, "yes")))
        .orderBy(rsvps.respondedAt),
      db
        .select({ userId: memberships.userId, displayName: users.displayName })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(eq(memberships.groupId, event.groupId)),
      loadState(event.id),
    ]);
    if (!role) return null;

    return {
      groupId: event.groupId,
      canHost: isHostRole(role),
      viewerId: userId,
      prefill: yes.map((r) => ({ userId: r.userId, name: r.displayName })),
      members: members.map((m) => ({ userId: m.userId, name: m.displayName })),
      live: !!existing && existing.row.status !== "completed",
    };
  }

  async function sessionsForGroup(groupId: string): Promise<{ eventId: string; state: S }[]> {
    const db = getDb();
    const rows = ownTable
      ? await db
          .select({ eventId: smashSessions.eventId, state: smashSessions.state })
          .from(smashSessions)
          .where(eq(smashSessions.groupId, groupId))
      : await db
          .select({ eventId: gameSessions.eventId, state: gameSessions.state })
          .from(gameSessions)
          .where(and(eq(gameSessions.groupId, groupId), eq(gameSessions.pack, pack)));
    return rows.map((r) => ({ eventId: r.eventId, state: r.state as unknown as S }));
  }

  async function guestNames(
    groupId: string,
    rosterOf: (state: S) => RosterSlot[] | undefined,
  ): Promise<string[]> {
    const names = new Set<string>();
    for (const { state } of await sessionsForGroup(groupId)) {
      for (const p of rosterOf(state) ?? []) {
        if (p.kind === "guest" && p.name) names.add(p.name);
      }
    }
    return [...names];
  }

  return {
    ...config,
    loadState,
    saveState,
    startSession,
    ensureGame,
    ledgerKey,
    deleteMaterialized,
    sessionView,
    respondState,
    viewOf,
    launchContext,
    guestNames,
    sessionsForGroup,
    materializeUnit,
    broadcastPack,
  };
}

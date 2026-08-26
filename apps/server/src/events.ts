import { Router } from "express";
import {
  getDb,
  events,
  groups,
  games,
  rsvps,
  eventAttendance,
  eventSeries,
  gameSessions,
  memberships,
  smashSessions,
  users,
  brackets,
  matches,
  matchParticipants,
  and,
  eq,
  inArray,
  desc,
} from "@gamenight/db";
import {
  PACK_BY_LEDGER,
  GENERIC_LEDGER,
  isSeriesSummary,
  dueOccurrence,
  isSeriesKind,
  MAX_INTERVAL_WEEKS,
  type SeriesKind,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { deleteEventCascade } from "./cascade.js";
import { broadcast } from "./ws.js";
import { decideAttendance, isRefusal } from "./attendance-rule.js";
import { eventPrefill } from "./event-prefill.js";
import { parseEventDetails } from "./event-details.js";

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

  // The three detail fields are OPTIONAL on create and this is what makes
  // DUPLICATE need no route of its own: it is a create carrying the same title
  // and place with no date, and the status line below already turns a dateless
  // create into a draft.
  const details = parseEventDetails(req.body);
  if (!details.ok) {
    res.status(400).json({ error: details.error });
    return;
  }

  // A REPEAT NEEDS A DATE, because the date IS the anchor: "every week" with no
  // week to start from has nothing to compute. A repeat sent without one is
  // refused rather than quietly dropped, so a host cannot think they set one.
  const repeat = parseRepeat(req.body?.repeat, scheduledFor);
  if (!repeat.ok) {
    res.status(400).json({ error: repeat.error });
    return;
  }

  const db = getDb();
  const event = await db.transaction(async (tx) => {
    let seriesId: string | null = null;
    if (repeat.rule) {
      // The series first, so the occurrence can point at it. One transaction:
      // a series with no occurrence is an invisible rule, and an occurrence
      // pointing at a series that does not exist is a foreign key violation.
      const [row] = await tx
        .insert(eventSeries)
        .values({
          groupId,
          createdBy: req.user!.id,
          title,
          kind: repeat.rule.kind,
          intervalWeeks: repeat.rule.intervalWeeks,
          anchorAt: scheduledFor!,
          timeZone: repeat.rule.timeZone,
        })
        .returning();
      seriesId = row!.id;
    }
    const [created] = await tx
      .insert(events)
      .values({
        groupId,
        title,
        scheduledFor,
        status: scheduledFor ? "scheduled" : "draft",
        createdBy: req.user!.id,
        ...details.fields,
        seriesId,
        // The seed IS index 0, which is what every later occurrence is measured
        // from. See dueOccurrence.
        seriesIndex: seriesId ? 0 : null,
      })
      .returning();
    return created!;
  });

  broadcast({ type: "group_events_changed", groupId }, req.get("x-gn-client"));
  // A SUMMARY, NOT THE ROW, and this is a fix rather than tidiness: the crew
  // page writes this response straight into its CACHED LIST (see
  // duplicateEvent in GroupPage.tsx), so a response missing `counts` is a
  // crash written to localStorage. See event-summary.test.ts.
  //
  // A night that was created a millisecond ago has no RSVPs, so the counts are
  // zero and nobody has answered; and a series is created active, so a night
  // that has one belongs to a running series by construction.
  res.json(
    eventSummary(
      event,
      [],
      req.user!.id,
      new Set(event.seriesId ? [event.seriesId] : []),
    ),
  );
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

  // The ordered list lives in cascade.ts, checked against the schema by
  // cascade-integrity.test.ts. It is NOT repeated here: two copies drift, and
  // these two had, which is what cost a crew its history.
  //
  // ONE TRANSACTION, same reasoning as the crew delete: either the whole event
  // goes or none of it does, and the 500 stops lying about what survived. The
  // broadcasts below stay outside it, after it commits, because telling every
  // connected phone an event is gone while the delete can still roll back is
  // worse than telling them late.
  // THE SCOPE DEFAULTS TO THIS NIGHT ONLY, so an old client (or a stray script)
  // that knows nothing about series cannot stop one by accident. Stopping is
  // opt-in and explicit.
  const stopSeries = req.body?.scope === "series" && !!found.seriesId;

  await db.transaction(async (tx) => {
    // ONE TRANSACTION, AND THIS IS THE HAZARD OF THE WHOLE FEATURE. Generation
    // runs for every ACTIVE series with no un-passed occurrence. If the delete
    // commits and the `active = false` does not, the very next load of the crew
    // page regenerates the night the host just deleted, with the same title, in
    // the same slot: to the host the delete silently failed, and to the code
    // everything succeeded.
    //
    // THE SERIES IS STOPPED FIRST on purpose. The atomicity is what matters, but
    // if something did tear here, a stopped series with its night intact is
    // recoverable by hand; a live series with its night deleted regenerates on
    // its own and nobody ever finds out.
    if (stopSeries) {
      await tx.update(eventSeries).set({ active: false }).where(eq(eventSeries.id, found.seriesId!));
    }
    await deleteEventCascade(tx, found.id);
  });

  const origin = req.get("x-gn-client");
  broadcast({ type: "event_deleted", eventId: found.id, groupId: found.groupId }, origin);
  broadcast({ type: "group_events_changed", groupId: found.groupId }, origin);
  res.json({ ok: true });
});

/**
 * Change an event's date, where it is, or what to bring. Same permission as
 * delete: the creator or a crew owner/admin. Status follows the DATE between
 * draft and scheduled; live/completed/cancelled are never touched from here,
 * and none of the detail fields moves the status at all.
 *
 * PARTIAL BY CONSTRUCTION: only the keys present in the body are written, so a
 * body carrying one field cannot blank the other three. An empty string clears
 * a detail field, which is how a host removes a location they no longer want.
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
    // No longer "change the date": this route carries four fields now, and an
    // error that names one of them is an error that describes the route it used
    // to be.
    res.status(403).json({ error: "Only the event creator or a crew admin can change this night" });
    return;
  }

  const details = parseEventDetails(req.body);
  if (!details.ok) {
    res.status(400).json({ error: details.error });
    return;
  }

  // STOP REPEATING, WITHOUT TOUCHING THIS NIGHT. Same gate as the date and the
  // details, which is the same gate as the delete: creator, owner or admin.
  // It rides PATCH rather than taking a route of its own because it is an edit
  // to the night's arrangements like any other, and because a separate route
  // would need the same three permission reads to say the same thing.
  const stopRepeating = req.body?.stopRepeating === true && !!found.seriesId;
  if (stopRepeating) {
    await db.update(eventSeries).set({ active: false }).where(eq(eventSeries.id, found.seriesId!));
  }

  // ONLY THE KEYS ACTUALLY SENT ARE WRITTEN, which is what makes a PATCH
  // carrying just `notes` leave the location alone. The old guard tested for
  // `scheduledFor` by name and the old update wrote it unconditionally, so any
  // widening that missed this would have silently blanked the date on every
  // notes edit.
  const patch: Partial<typeof found> = { ...details.fields };
  if ("scheduledFor" in (req.body ?? {})) {
    let scheduledFor: Date | null = null;
    if (req.body.scheduledFor) {
      scheduledFor = new Date(String(req.body.scheduledFor));
      if (isNaN(scheduledFor.getTime())) {
        res.status(400).json({ error: "Invalid date" });
        return;
      }
    }
    patch.scheduledFor = scheduledFor;
    // Status follows the date between draft and scheduled; live, completed and
    // cancelled are never touched from here, and none of the three detail
    // fields moves it at all.
    patch.status =
      found.status === "draft" || found.status === "scheduled"
        ? scheduledFor
          ? "scheduled"
          : "draft"
        : found.status;
  }

  if (Object.keys(patch).length === 0 && !stopRepeating) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  if (Object.keys(patch).length > 0) {
    await db.update(events).set(patch).where(eq(events.id, found.id));
  }

  const origin = req.get("x-gn-client");
  broadcast({ type: "event_updated", eventId: found.id, groupId: found.groupId }, origin);
  broadcast({ type: "group_events_changed", groupId: found.groupId }, origin);
  res.json(await eventDetail({ ...found, ...patch }, req.user!.id));
});

/** List a group's events, newest first, with RSVP summary and my status. */
eventsRouter.get("/groups/:groupId/events", async (req: AuthedRequest, res) => {
  const groupId = String(req.params.groupId);
  if (!(await isMember(groupId, req.user!.id))) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const db = getDb();
  // The series read rides the existing pair rather than going first: a crew
  // with no active series pays exactly one extra indexed query and no writes,
  // which is the common case and has to stay cheap.
  const [list, allRsvps, series] = await Promise.all([
    db.select().from(events).where(eq(events.groupId, groupId)).orderBy(desc(events.createdAt)),
    db.select().from(rsvps).where(eq(rsvps.groupId, groupId)),
    db
      .select()
      .from(eventSeries)
      .where(and(eq(eventSeries.groupId, groupId), eq(eventSeries.active, true))),
  ]);

  // LAZY GENERATION, ON A READ. There is no scheduler in this app: the only
  // cron is the keep-warm Action pinging /api/health, whose whole job is
  // preventing a cold start, and creating rows from an unauthenticated ping
  // would be wrong. So a series materialises its next night the first time
  // anybody opens the crew page after the last one has passed. That turns this
  // GET into a write path, which is the architectural cost of the feature and
  // is why it is written down here rather than discovered later.
  const born = await generateDueOccurrences(db, series, list, req.get("x-gn-client"));
  if (born.length) list.unshift(...born);

  // Which series are still running, so a tile can tell "this night repeats and
  // the series is live" from "this night was part of a series somebody already
  // stopped". Only the first has anything left to stop.
  const activeSeries = new Set(series.map((x) => x.id));

  res.json(
    list.map((e) =>
      eventSummary(
        e,
        allRsvps.filter((r) => r.eventId === e.id),
        req.user!.id,
        activeSeries,
      ),
    ),
  );
});

/**
 * ONE NIGHT AS THE CREW PAGE'S LIST SEES IT. One definition, because TWO
 * ENDPOINTS RETURN THIS SHAPE and the client cannot tell them apart.
 *
 * WHAT WENT WRONG WITHOUT IT: the list built this inline and `POST
 * /groups/:groupId/events` returned the bare `events` row. The two are the same
 * thing to the client, which writes a create response straight into its cached
 * list, so "run it again" cached a night with no `counts`, the tile rendered
 * `e.counts.yes` on the next visit, and the crew page threw into its error
 * boundary. The cached array is read back during the FIRST render, so the
 * screen's own Reload button could not clear it: the page was dead until the
 * next deploy changed the cache namespace. A summary the two routes share
 * cannot drift like that again.
 */
export function eventSummary(
  row: typeof events.$inferSelect,
  forEvent: (typeof rsvps.$inferSelect)[],
  userId: string,
  activeSeries: ReadonlySet<string>,
) {
  return {
    ...row,
    seriesActive: !!row.seriesId && activeSeries.has(row.seriesId),
    counts: {
      yes: forEvent.filter((r) => r.status === "yes").length,
      maybe: forEvent.filter((r) => r.status === "maybe").length,
      no: forEvent.filter((r) => r.status === "no").length,
    },
    myStatus: forEvent.find((r) => r.userId === userId)?.status ?? null,
  };
}

/**
 * The full event-detail payload the client renders. Shared by the GET and
 * every mutation on this router, so a mutation's response IS the updated
 * state: the client applies it directly instead of refetching.
 */
async function eventDetail(found: NonNullable<Awaited<ReturnType<typeof loadEventForMember>>>, userId: string) {
  const db = getDb();
  // All six only need the already-loaded event row and the userId, so they
  // are independent of each other and go out together. Run in series this
  // was six sequential Neon round trips on the event page load AND on every
  // RSVP, attendance and date mutation response, which all end here.
  const [
    responses,
    members,
    bracketRows,
    myRoleRows,
    attendanceRows,
    groupRows,
    seriesRows,
    sharedSessions,
    smashRows,
  ] = await Promise.all([
    db
      .select({
        userId: rsvps.userId,
        status: rsvps.status,
        displayName: users.displayName,
      })
      .from(rsvps)
      .innerJoin(users, eq(rsvps.userId, users.id))
      .where(eq(rsvps.eventId, found.id))
      // ANSWER ORDER, and it is load bearing rather than cosmetic since
      // 2026-08-17: the tournament setup screen prefills its roster from the
      // yes list and the roster's order IS the seeding, so "first in, top seed"
      // is only true if this comes back ordered. Without it Postgres is free to
      // return the rows however it likes. The RSVP lists on the event page get
      // a stable order out of the same change.
      .orderBy(rsvps.respondedAt),

    db
      .select({ userId: users.id, displayName: users.displayName })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.groupId, found.groupId)),

    // EVERY bracket on the night, not one. A night can run a second tournament
    // once the first is completed, and this read used to be `.limit(1)` with no
    // `orderBy`, which was only safe because the creation guard made a second
    // row impossible. Which of them the tile should describe is decided below,
    // in code, rather than left to whichever row Postgres felt like returning.
    // Indexed on event_id.
    db
      .select({ id: brackets.id, status: brackets.status, updatedAt: brackets.updatedAt })
      .from(brackets)
      .where(eq(brackets.eventId, found.id)),

    db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.groupId, found.groupId), eq(memberships.userId, userId)))
      .limit(1),

    // EVERY attendance row on the night, not only the caller's. The host
    // check-in control needs to show who is already checked in, and `myStatus`
    // is now derived from this list rather than costing a second read.
    db
      .select({ userId: eventAttendance.userId, showed: eventAttendance.showed })
      .from(eventAttendance)
      .where(eq(eventAttendance.eventId, found.id)),

    // groupName + inviteCode ride along so the event page can build a share
    // link (through the existing invite/join flow) without a second request.
    db
      .select({ name: groups.name, inviteCode: groups.inviteCode })
      .from(groups)
      .where(eq(groups.id, found.groupId))
      .limit(1),

    // The series this night belongs to, if any. The page needs `active` as much
    // as the rule itself: a stopped series has nothing left to stop, so the
    // screen falls back to what it showed before recurrence existed.
    found.seriesId
      ? db
          .select({
            id: eventSeries.id,
            kind: eventSeries.kind,
            intervalWeeks: eventSeries.intervalWeeks,
            active: eventSeries.active,
          })
          .from(eventSeries)
          .where(eq(eventSeries.id, found.seriesId))
          .limit(1)
      : Promise.resolve([]),

    // The four session packs. The payload carried `bracket` and `beerioCode`
    // and nothing else, so those were the only two tiles in the game picker
    // that could say "live now": a night already running Mario Kart looked
    // idle. Two more parallel reads on a Promise.all already running six.
    db
      .select({ pack: gameSessions.pack, status: gameSessions.status })
      .from(gameSessions)
      .where(eq(gameSessions.eventId, found.id)),

    db
      .select({ status: smashSessions.status })
      .from(smashSessions)
      .where(eq(smashSessions.eventId, found.id))
      .limit(1),
  ]);

  const answered = new Set(responses.map((r) => r.userId));
  // THE ONE THE TILE SHOULD TALK ABOUT: the tournament still going if there is
  // one, and there is at most one by the start rule (see canStartBracket).
  // Otherwise the most recently touched COMPLETED one, so a crew that just
  // finished their second tournament is offered THAT final bracket rather than
  // an arbitrary earlier night's. Ties fall to the id, for the same reason the
  // TV resolver's do: two phones must not be told two different things.
  const newer = (a: (typeof bracketRows)[number], b: (typeof bracketRows)[number]) => {
    const at = (r: typeof a) => (r.updatedAt ? r.updatedAt.getTime() : 0);
    if (at(a) !== at(b)) return at(a) > at(b);
    return a.id < b.id;
  };
  let bracket: (typeof bracketRows)[number] | undefined;
  for (const row of bracketRows) {
    if (!bracket) {
      bracket = row;
      continue;
    }
    const running = row.status !== "completed";
    const haveRunning = bracket.status !== "completed";
    if (running !== haveRunning ? running : newer(row, bracket)) bracket = row;
  }
  const myRole = myRoleRows[0]?.role;
  const attendance = attendanceRows.find((a) => a.userId === userId);
  const group = groupRows[0];

  // Only what is still going: a completed session is history, and the picker
  // would be lying if it offered to "rejoin" one.
  const sessions: { pack: string; status: "setup" | "live" }[] = [];
  for (const s of sharedSessions) {
    // From the one registry. The hand-written copy this replaced mapped
    // "ping_pong", which is not Ping Pong's ledger key ("pingpong"), so the
    // lookup missed and a live Ping Pong session never showed "live now" on
    // its tile. Same typo, same silence, as the event TV resolver's copy.
    const pack = PACK_BY_LEDGER[s.pack];
    if (pack && s.status !== "completed") sessions.push({ pack, status: s.status });
  }
  if (smashRows[0] && smashRows[0].status !== "completed") {
    sessions.push({ pack: "smash", status: smashRows[0].status });
  }

  return {
    ...found,
    // PROJECTED, not spread: updatedAt was added to the select for the choice
    // above and has no business on the wire. The payload shape is byte-for-byte
    // what it was, so apps/web/src/api.ts needs nothing.
    bracket: bracket ? { id: bracket.id, status: bracket.status } : null,
    sessions,
    myRole,
    groupName: group?.name ?? "",
    inviteCode: group?.inviteCode ?? "",
    rsvps: responses,
    noResponse: members.filter((m) => !answered.has(m.userId)),
    myStatus: responses.find((r) => r.userId === userId)?.status ?? null,
    myAttendance: attendance ? attendance.showed : null,
    // Checked in by anybody, including by a host on somebody else's behalf.
    attendance: attendanceRows,
    series: seriesRows[0] ?? null,
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

/** One participant row of one completed game under an event, as the recap reads it. */
export interface RecapRow {
  matchId: string;
  position: number | null;
  label: string | null;
  format: string | null;
  externalKey: string | null;
  gameName: string | null;
  pack: string | null;
  userId: string;
  displayName: string;
  placement: number | null;
  isWinner: boolean;
}

/**
 * Roll the ledger rows up into the night recap.
 *
 * PURE: no database, no clock. Separated from the query because two very
 * different callers need the same answer: the authed recap card, and the
 * PUBLIC event TV lobby, which shows the night so far between games. Two
 * rollups would drift, and the failure mode is the worst kind: the TV and the
 * recap card quoting different numbers for the same night, in the same room,
 * at the same time.
 */
export function rollupRecap(rows: RecapRow[]) {
  // One entry per match (a game/board/race), in play order.
  const byMatch = new Map<
    string,
    { position: number; label: string | null; format: string | null; gameName: string; pack: string; winnerName: string | null }
  >();
  // Per-player rollup across every game.
  const byUser = new Map<
    string,
    { userId: string; name: string; games: number; wins: number; placedSum: number; placed: number }
  >();

  // Session units: group matches into the thing that was actually played (one
  // Best Of session, one KOTH run, one Grand Prix cup), so the recap shows a
  // line per format-run instead of one per race. The sessionKey lives in the
  // externalKey ({pack}:{eventId}:{sessionKey}:{idx}); Grand Prix additionally
  // splits by its cup label so each cup is its own row.
  const sessionKeyOf = (externalKey: string | null, matchId: string): string => {
    if (!externalKey) return `m:${matchId}`;
    const parts = externalKey.split(":");
    return parts.length >= 4 ? parts[2]! : `legacy:${parts[0]}`;
  };
  const units = new Map<
    string,
    {
      pack: string;
      format: string | null;
      gameName: string;
      label: string | null;
      order: number;
      matchIds: Set<string>;
      wins: Map<string, { name: string; wins: number }>;
    }
  >();

  for (const r of rows) {
    // A Smashdown SERIES row summarizes battles that are in this very list, and
    // it shares their sessionKey by design, so it would land in their unit and
    // report "won 4 of 6 games" for a five-battle series someone won three of.
    // It is dropped from the recap entirely rather than shown as its own line:
    // the series already IS the line, since all its battles group into one.
    if (isSeriesSummary(r.label)) continue;
    let g = byMatch.get(r.matchId);
    if (!g) {
      g = {
        position: r.position ?? 0,
        label: r.label,
        format: r.format,
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

    const sk = sessionKeyOf(r.externalKey, r.matchId);
    const unitKey = `${r.pack}|${r.format}|${sk}` + (r.format === "grandprix" ? `|${r.label ?? ""}` : "");
    let u = units.get(unitKey);
    if (!u) {
      u = {
        pack: r.pack ?? "generic",
        format: r.format,
        gameName: r.gameName ?? "Game",
        label: r.label,
        order: r.position ?? 0,
        matchIds: new Set(),
        wins: new Map(),
      };
      units.set(unitKey, u);
    }
    u.matchIds.add(r.matchId);
    u.order = Math.min(u.order, r.position ?? 0);
    if (r.isWinner) {
      const w = u.wins.get(r.userId) ?? { name: r.displayName, wins: 0 };
      w.wins++;
      u.wins.set(r.userId, w);
    }
  }

  const gamesList = [...byMatch.values()]
    .sort((a, b) => a.position - b.position)
    .map((g) => ({ gameName: g.gameName, label: g.label, format: g.format, pack: g.pack, winnerName: g.winnerName }));

  // One row per thing played, with its top winner and how dominant (won X of Y).
  const sessions = [...units.values()]
    .sort((a, b) => a.order - b.order)
    .map((u) => {
      let top: { name: string; wins: number } | null = null;
      for (const w of u.wins.values()) if (!top || w.wins > top.wins) top = w;
      return {
        gameName: u.gameName,
        pack: u.pack,
        format: u.format,
        label: u.label,
        matches: u.matchIds.size,
        winnerName: top?.name ?? null,
        winnerWins: top?.wins ?? 0,
      };
    });

  const players = [...byUser.values()]
    .map((p) => ({
      userId: p.userId,
      name: p.name,
      games: p.games,
      wins: p.wins,
      avgPlacement: p.placed ? p.placedSum / p.placed : null,
    }))
    .sort(rankMvp);

  return {
    totalGames: byMatch.size,
    games: gamesList,
    sessions,
    players,
    mvp: gamesList.length && players[0] ? { userId: players[0].userId, name: players[0].name } : null,
  };
}

/**
 * Night recap: every completed game under this event across every pack,
 * rolled up. The materialized ledger (matches/match_participants) is the one
 * cross-pack source, so Beerio, Smash, Mario Kart, Mario Party and brackets
 * all land here through the same query. Guests are not in the ledger (they're
 * never materialized), so the recap is members only.
 */
export async function eventRecap(
  event: { id: string; title: string; scheduledFor: Date | null },
  groupName: string,
) {
  const rows = await getDb()
    .select({
      matchId: matchParticipants.matchId,
      position: matches.position,
      label: matches.label,
      format: matches.format,
      externalKey: matches.externalKey,
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
    .where(and(eq(matches.eventId, event.id), eq(matches.status, "completed")));

  return {
    eventId: event.id,
    title: event.title,
    scheduledFor: event.scheduledFor,
    groupName,
    ...rollupRecap(rows),
  };
}

eventsRouter.get("/events/:id/recap", async (req: AuthedRequest, res) => {
  const found = await loadEventForMember(String(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const groupName =
    (
      await getDb()
        .select({ name: groups.name })
        .from(groups)
        .where(eq(groups.id, found.groupId))
        .limit(1)
    )[0]?.name ?? "";
  res.json(await eventRecap(found, groupName));
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
 * Record whether somebody actually showed up. Separate from RSVP intent so flake
 * tracking can compare the two. Locked until the event's date arrives, you can't
 * confirm arrival at something that hasn't started.
 *
 * WITH NO `userId` IN THE BODY THIS IS BYTE-FOR-BYTE THE ROUTE IT HAS ALWAYS
 * BEEN: any member marking themselves, both answers, no role required. `userId`
 * is the host check-in, and every rule about it lives in `decideAttendance` so
 * it can be read and tested in one place. `showed: null` clears the row.
 */
eventsRouter.post("/events/:id/attendance", async (req: AuthedRequest, res) => {
  const found = await loadEventForMember(String(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const callerId = req.user!.id;
  const rawTarget = req.body?.userId;
  const targetId = rawTarget == null ? callerId : String(rawTarget);
  // ONE ROUND TRIP FOR BOTH ROLES, and only one row's worth of work when the
  // caller is marking themselves, which is the ordinary path.
  const roleRows = await getDb()
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.groupId, found.groupId),
        inArray(memberships.userId, targetId === callerId ? [callerId] : [callerId, targetId]),
      ),
    );
  const roleFor = (id: string) => roleRows.find((r) => r.userId === id)?.role;

  const decision = decideAttendance({
    callerId,
    targetId: rawTarget == null ? null : targetId,
    showed: req.body?.showed,
    role: roleFor(callerId),
    targetRole: roleFor(targetId),
  });
  if (isRefusal(decision)) {
    res.status(decision.status).json({ error: decision.error });
    return;
  }

  // The date gate is unchanged, and it applies to a host's tap exactly as it
  // applies to your own: nobody checks anybody in to a night that has not begun.
  if (!found.scheduledFor || found.scheduledFor.getTime() > Date.now()) {
    res.status(400).json({ error: "Attendance opens once the event starts" });
    return;
  }

  if (decision.kind === "clear") {
    // A DELETE rather than a third column value: unanswered is the absence of a
    // row everywhere else in this app, and stats.ts already reads it that way.
    await getDb()
      .delete(eventAttendance)
      .where(
        and(
          eq(eventAttendance.eventId, found.id),
          eq(eventAttendance.userId, decision.userId),
        ),
      );
  } else {
    await getDb()
      .insert(eventAttendance)
      .values({
        groupId: found.groupId,
        eventId: found.id,
        userId: decision.userId,
        showed: decision.showed,
        markedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [eventAttendance.eventId, eventAttendance.userId],
        set: { showed: decision.showed, markedAt: new Date() },
      });
  }

  broadcast(
    { type: "event_updated", eventId: found.id, groupId: found.groupId },
    req.get("x-gn-client"),
  );
  res.json(await eventDetail(found, callerId));
});

/**
 * THE TOURNAMENT'S LAUNCHER, and the third of the three that had its own prefill
 * expression. The bracket setup screen took the yes list off the event payload
 * on the client, which made it the one launcher whose prefill lived in a
 * different language from the other two. It now asks the same helper the pack
 * runtimes ask, on its own route rather than on the event payload, because
 * EventPage fetches that payload on every RSVP and has no use for any of this.
 */
eventsRouter.get("/events/:id/prefill", async (req: AuthedRequest, res) => {
  const found = await loadEventForMember(String(req.params.id), req.user!.id);
  if (!found) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(await eventPrefill(found, { excludeLedger: GENERIC_LEDGER }));
});

/**
 * Read an optional repeat rule off a create body.
 *
 * A REPEAT NEEDS A DATE, because the date IS the anchor. "Every week" with no
 * week to start from cannot be computed, and silently dropping the repeat would
 * leave a host believing they had set one.
 *
 * THE TIME ZONE COMES FROM THE DEVICE THAT CREATED IT and is required, because
 * the contract is same time of day rather than same elapsed hours. See the
 * column's comment in the schema: this server runs in UTC, where the clocks
 * never change, so it cannot work the crew's zone out for itself.
 */
export function parseRepeat(
  raw: unknown,
  scheduledFor: Date | null,
):
  | { ok: true; rule: { kind: SeriesKind; intervalWeeks: number | null; timeZone: string } | null }
  | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, rule: null };
  const r = raw as Record<string, unknown>;
  if (r.kind === undefined || r.kind === null || r.kind === "none") return { ok: true, rule: null };
  if (!isSeriesKind(r.kind)) return { ok: false, error: "Unknown repeat" };
  if (!scheduledFor) return { ok: false, error: "A repeating night needs a date to repeat from" };

  const timeZone = typeof r.timeZone === "string" ? r.timeZone.trim() : "";
  if (!timeZone) return { ok: false, error: "A repeating night needs a time zone" };
  try {
    // The zone has to be one Intl knows, or every occurrence after the first
    // throws inside a request that is only trying to render a crew page.
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    return { ok: false, error: "Unknown time zone" };
  }

  let intervalWeeks: number | null = null;
  if (r.kind === "custom_weeks") {
    const n = Math.trunc(Number(r.intervalWeeks));
    if (!Number.isFinite(n) || n < 1 || n > MAX_INTERVAL_WEEKS) {
      return { ok: false, error: `Repeat every 1 to ${MAX_INTERVAL_WEEKS} weeks` };
    }
    intervalWeeks = n;
  }
  return { ok: true, rule: { kind: r.kind, intervalWeeks, timeZone } };
}

/**
 * Materialise the next night for every active series that is owed one.
 *
 * OWED MEANS: no occurrence of that series is still un-passed. Exactly one live
 * night per series at a time, by requirement, so this creates at most one row
 * per series per call and usually none at all.
 *
 * THE INDEX COMES FROM THE SERIES, NEVER FROM COUNTING ROWS AND NEVER FROM THE
 * PREVIOUS NIGHT'S DATE. `max(series_index) + 1` and then `nextOccurrence` off
 * the anchor: a night somebody MOVED cannot drag the ones after it, and a night
 * somebody DELETED cannot renumber them either.
 */
async function generateDueOccurrences(
  db: ReturnType<typeof getDb>,
  series: (typeof eventSeries.$inferSelect)[],
  existing: (typeof events.$inferSelect)[],
  origin: string | undefined,
): Promise<(typeof events.$inferSelect)[]> {
  if (series.length === 0) return [];
  const now = Date.now();
  const born: (typeof events.$inferSelect)[] = [];

  for (const s of series) {
    const mine = existing.filter((e) => e.seriesId === s.id);
    const due = dueOccurrence(
      { anchor: s.anchorAt, kind: s.kind, intervalWeeks: s.intervalWeeks, timeZone: s.timeZone },
      mine,
      now,
    );
    if (!due) continue;

    // WHERE IT IS AND WHAT TO BRING COME FROM THE LAST OCCURRENCE, not from the
    // series, which carries only the title: a crew that moved their night to a
    // new house last month should not be sent back to the old one. Copies
    // NOTHING else: no RSVPs, no attendance, no beerioCode, no sessions.
    const latest = mine.reduce<(typeof mine)[number] | null>(
      (best, e) => (!best || (e.seriesIndex ?? 0) > (best.seriesIndex ?? 0) ? e : best),
      null,
    );

    const [row] = await db
      .insert(events)
      .values({
        groupId: s.groupId,
        title: s.title,
        scheduledFor: due.when,
        status: "scheduled",
        createdBy: s.createdBy,
        location: latest?.location ?? null,
        locationUrl: latest?.locationUrl ?? null,
        notes: latest?.notes ?? null,
        // THE PIN TRAVELS WITH THE PLACE, all three together or none, the same
        // rule the write enforces. A generated occurrence that carried the label
        // and dropped the coordinates would look identical on screen and be
        // useless to anything that reads a coordinate.
        locationLat: latest?.locationLat ?? null,
        locationLng: latest?.locationLng ?? null,
        locationRef: latest?.locationRef ?? null,
        seriesId: s.id,
        seriesIndex: due.index,
      })
      // THE RACE GUARD. Two phones opening the crew page at the same moment both
      // reach here; the unique index on (series_id, series_index) makes the
      // loser a no-op instead of a duplicate night. Established pattern here,
      // not a new one.
      .onConflictDoNothing()
      .returning();
    if (row) born.push(row);
  }

  if (born.length) {
    // So a second phone already sitting on the crew page sees the new night
    // without a refresh. The generating tab skips its own echo as usual.
    broadcast({ type: "group_events_changed", groupId: series[0]!.groupId }, origin);
  }
  return born;
}

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

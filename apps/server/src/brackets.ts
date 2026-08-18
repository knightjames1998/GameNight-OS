import { Router } from "express";
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
  inArray,
} from "@gamenight/db";
import {
  buildStructure,
  computeBracket,
  downstreamOf,
  entrantLabel,
  entrantMembers,
  normalizeEntrants,
  parseEntrants,
  placements,
  type BracketFormat,
  type BracketResults,
  type BracketStructure,
  type Entrant,
  type Slot,
  type SoloEntrant,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { insertParticipants } from "./participants.js";
import { roleOf } from "./pack-runtime.js";
import { broadcast } from "./ws.js";
import { type GuestCreditResult } from "./guest-link-util.js";

export const bracketsRouter = Router();
bracketsRouter.use(requireAuth);

/**
 * Public read-only spectator/TV view. No login: typing passwords on a TV
 * is misery, so the bracket's unguessable UUID acts as the access key,
 * same idea as invite links. Read-only data, no permissions attached.
 */
export const tvRouter = Router();
tvRouter.get("/:id", async (req, res) => {
  const db = getDb();
  const rows = await db
    .select({
      id: brackets.id,
      eventId: brackets.eventId,
      groupId: brackets.groupId,
      status: brackets.status,
      openScoring: brackets.openScoring,
      gameId: brackets.gameId,
      format: brackets.format,
      entrants: brackets.entrants,
      results: brackets.results,
      gameName: games.name,
      groupName: groups.name,
    })
    .from(brackets)
    .innerJoin(games, eq(brackets.gameId, games.id))
    .innerJoin(groups, eq(brackets.groupId, groups.id))
    .where(eq(brackets.id, String(req.params.id)))
    .limit(1);
  const b = rows[0];
  if (!b) {
    res.status(404).json({ error: "Bracket not found" });
    return;
  }
  const view = await deriveView({ ...b, entrants: parseEntrants(b.entrants), myRole: "member" });
  res.json({ ...view, canScore: false, canManage: false });
});

/**
 * Start a tournament for an event.
 *
 * ENTRANTS COME FROM THE BODY, built on the setup screen (/tournament). The
 * list is the SEEDING: first in the array is the top seed, which is why the
 * screen prefills in RSVP answer order and offers a shuffle rather than
 * sorting anything here.
 *
 * A REQUEST WITH NO `entrants` KEY FALLS BACK TO THE YES LIST, which is exactly
 * what this endpoint did before the setup screen existed. That is deliberate
 * and it is not a supported path: an installed PWA can be running a cached
 * bundle on a game night, and the failure mode of deleting the fallback is a
 * host who cannot start a tournament at all. The current client always sends
 * entrants.
 */
bracketsRouter.post("/events/:eventId/bracket", async (req: AuthedRequest, res) => {
  const db = getDb();
  const event = await loadEventForMember(String(req.params.eventId), req.user!.id);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const role = await roleOf(event.groupId, req.user!.id);
  if (role !== "owner" && role !== "admin") {
    res.status(403).json({ error: "Only crew owners and admins can start a game" });
    return;
  }

  const existing = await db
    .select({ id: brackets.id })
    .from(brackets)
    .where(eq(brackets.eventId, event.id))
    .limit(1);
  if (existing[0]) {
    res.status(409).json({ error: "This event already has a bracket", bracketId: existing[0].id });
    return;
  }

  let entrants: Entrant[];
  if (req.body?.entrants === undefined) {
    // The fallback. Same query, same order (first to answer is the top seed),
    // same shape it has written since this endpoint shipped.
    const yesList = await db
      .select({ userId: rsvps.userId })
      .from(rsvps)
      .where(and(eq(rsvps.eventId, event.id), eq(rsvps.status, "yes")))
      .orderBy(rsvps.respondedAt);
    entrants = yesList.map((r) => ({ kind: "member" as const, userId: r.userId }));
  } else {
    // THE CREW, not the yes list: the whole point of the setup screen is that
    // somebody who never opened the app is still addable by the host. Membership
    // is checked server-side, and an id outside this crew is REJECTED rather
    // than quietly downgraded to a guest (see normalizeEntrants).
    const crew = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.groupId, event.groupId));
    const normalized = normalizeEntrants(req.body.entrants, new Set(crew.map((m) => m.userId)));
    if (typeof normalized === "string") {
      res.status(400).json({ error: normalized });
      return;
    }
    entrants = normalized;
  }

  // NOT "need 2 yes RSVPs" any more, which was the bug: needing an RSVP to be
  // in a tournament is what locked half a crew out of their own game night.
  if (entrants.length < 2) {
    res.status(400).json({ error: "Need at least 2 entrants to start a bracket" });
    return;
  }

  const gameName = String(req.body?.gameName ?? "").trim() || "Tournament";
  const format: BracketFormat =
    req.body?.format === "double_elim" ? "double_elim" : "single_elim";
  const game = (
    await db
      .insert(games)
      .values({ groupId: event.groupId, name: gameName.slice(0, 50), pack: "generic" })
      .returning()
  )[0]!;

  const bracket = (
    await db
      .insert(brackets)
      .values({
        groupId: event.groupId,
        eventId: event.id,
        gameId: game.id,
        format,
        status: "live",
        entrants,
        results: {},
      })
      .returning()
  )[0]!;

  const origin = req.get("x-gn-client");
  broadcast({ type: "bracket_updated", bracketId: bracket.id }, origin);
  // A tournament starting is a change to what this NIGHT is playing, which is
  // a different topic from the bracket's own scoreboard: bracket_updated is
  // keyed by bracketId, and the event page and the event TV both watch by
  // eventId. Without this the TV would never notice the bracket exists.
  broadcast({ type: "event_session_changed", eventId: event.id }, origin);
  res.json({ id: bracket.id });
});

/** Full derived bracket state, ready to render. */
bracketsRouter.get("/brackets/:id", async (req: AuthedRequest, res) => {
  const loaded = await loadBracketForMember(String(req.params.id), req.user!.id);
  if (!loaded) {
    res.status(404).json({ error: "Bracket not found" });
    return;
  }
  res.json(await deriveView(loaded));
});

/**
 * Record a winner. Only playable matches (both slots real, undecided)
 * accept a result; everything downstream recomputes on read.
 */
bracketsRouter.post("/brackets/:id/matches/:matchId/result", async (req: AuthedRequest, res) => {
  const loaded = await loadBracketForMember(String(req.params.id), req.user!.id);
  if (!loaded) {
    res.status(404).json({ error: "Bracket not found" });
    return;
  }

  if (!canScore(loaded)) {
    res.status(403).json({ error: "Scoring is locked to group admins for this bracket" });
    return;
  }

  const winner = String(req.body?.winner ?? "");
  if (winner !== "A" && winner !== "B") {
    res.status(400).json({ error: "winner must be A or B" });
    return;
  }

  const matchId = String(req.params.matchId);
  const structure = buildStructure(loaded.format, loaded.entrants.length);
  const computed = computeBracket(loaded.entrants.length, structure, loaded.results);
  const match = computed.matches[matchId];
  if (!match) {
    res.status(404).json({ error: "No such match" });
    return;
  }
  if (!match.playable) {
    res.status(409).json({ error: "Match is not ready or already decided" });
    return;
  }

  const results: BracketResults = { ...loaded.results, [matchId]: winner };
  const after = computeBracket(loaded.entrants.length, structure, results);
  // updatedAt is the event TV's ranking key: it is what lets a bracket being
  // scored all night beat a session someone started later and abandoned.
  await getDb()
    .update(brackets)
    .set({ results, status: after.championSeed ? "completed" : "live", updatedAt: new Date() })
    .where(eq(brackets.id, loaded.id));

  if (after.championSeed) {
    await materialize({ ...loaded, results }, structure);
  }

  const origin = req.get("x-gn-client");
  broadcast({ type: "bracket_updated", bracketId: loaded.id }, origin);
  // Every score, not just the one that ends it. A recorded result moves this
  // bracket to the front of "most recently touched", so the event TV has to
  // re-resolve or the ranking would only ever be observed by accident.
  broadcast({ type: "event_session_changed", eventId: loaded.eventId }, origin);
  res.json(await deriveView({ ...loaded, results, status: after.championSeed ? "completed" : "live" }));
});

/**
 * Undo a recorded result. Cascades: any downstream results that depended
 * on this match's winner are cleared too, since they no longer describe
 * the same matchup.
 */
bracketsRouter.delete("/brackets/:id/matches/:matchId/result", async (req: AuthedRequest, res) => {
  const loaded = await loadBracketForMember(String(req.params.id), req.user!.id);
  if (!loaded) {
    res.status(404).json({ error: "Bracket not found" });
    return;
  }

  if (!canScore(loaded)) {
    res.status(403).json({ error: "Scoring is locked to group admins for this bracket" });
    return;
  }

  const matchId = String(req.params.matchId);
  if (!(matchId in loaded.results)) {
    res.status(409).json({ error: "No recorded result to undo" });
    return;
  }

  const structure = buildStructure(loaded.format, loaded.entrants.length);
  const results: BracketResults = { ...loaded.results };
  delete results[matchId];
  for (const id of downstreamOf(structure, matchId)) {
    delete results[id];
  }

  const db2 = getDb();
  await db2
    .update(brackets)
    .set({ results, status: "live", updatedAt: new Date() })
    .where(eq(brackets.id, loaded.id));

  // The bracket is no longer finished, so its recorded results must go.
  const stale = await db2
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.bracketId, loaded.id));
  for (const m of stale) {
    await db2.delete(matchParticipants).where(eq(matchParticipants.matchId, m.id));
  }
  await db2.delete(matches).where(eq(matches.bracketId, loaded.id));

  const origin = req.get("x-gn-client");
  broadcast({ type: "bracket_updated", bracketId: loaded.id }, origin);
  // An undo can bring a COMPLETED bracket back to life, which the event TV
  // must notice: the bracket goes from filtered-out to the freshest thing on
  // the night.
  broadcast({ type: "event_session_changed", eventId: loaded.eventId }, origin);
  res.json(await deriveView({ ...loaded, results, status: "live" }));
});

/** Owner/admin toggle: open scoring for everyone, or lock it down. */
bracketsRouter.patch("/brackets/:id/settings", async (req: AuthedRequest, res) => {
  const loaded = await loadBracketForMember(String(req.params.id), req.user!.id);
  if (!loaded) {
    res.status(404).json({ error: "Bracket not found" });
    return;
  }
  if (loaded.myRole !== "owner" && loaded.myRole !== "admin") {
    res.status(403).json({ error: "Only group admins can change bracket settings" });
    return;
  }
  const openScoring = req.body?.openScoring;
  if (typeof openScoring !== "boolean") {
    res.status(400).json({ error: "openScoring must be true or false" });
    return;
  }
  await getDb().update(brackets).set({ openScoring }).where(eq(brackets.id, loaded.id));
  broadcast({ type: "bracket_updated", bracketId: loaded.id }, req.get("x-gn-client"));
  res.json(await deriveView({ ...loaded, openScoring }));
});

/**
 * Write a completed bracket into the cross-game stats ledger: one matches
 * row for the tournament, one match_participants row per MEMBER entrant
 * with their finishing place. Guests are skipped (they have no identity to
 * credit yet; linking guests to members is a backlog item). Idempotent by
 * bracketId.
 */
async function materialize(
  loaded: LoadedBracket,
  structure: BracketStructure,
  linkMap?: Map<string, string>, // guest display name -> member userId (backfill)
) {
  const db = getDb();
  const existing = (
    await db
      .select({ id: matches.id })
      .from(matches)
      .where(eq(matches.bracketId, loaded.id))
      .limit(1)
  )[0];
  // Live path: already materialized and nothing to link. A guest backfill
  // reuses the existing row and adds the participant that was skipped.
  if (existing && !linkMap?.size) return;

  const computed = computeBracket(loaded.entrants.length, structure, loaded.results);
  if (!computed.championSeed) return;

  // Finishing place per seed: champion 1, then by how late each player was
  // eliminated. The engine knows what "eliminated" means per format (in
  // double elim a winners-bracket loss just drops you down).
  const place = placements(structure, computed);

  const matchId = existing
    ? existing.id
    : (
        await db
          .insert(matches)
          .values({
            groupId: loaded.groupId,
            bracketId: loaded.id,
            gameId: loaded.gameId,
            eventId: loaded.eventId,
            round: 1,
            position: 0,
            status: "completed",
          })
          .returning()
      )[0]!.id;

  const rows = new Map<string, typeof matchParticipants.$inferInsert>();
  for (const [seed, p] of place) {
    const e = loaded.entrants[seed - 1];
    if (!e) continue;
    // ONE ROW PER CREDITING HUMAN IN THE SLOT. entrantMembers flattens all
    // three kinds, so a solo entrant is a list of one and a pair is a list of
    // two, and every member of the slot takes the SLOT's placement.
    for (const m of entrantMembers(e)) {
      // Members always credit; a guest credits only when linked (backfill).
      const userId = m.kind === "member" ? m.userId : linkMap?.get(m.name);
      if (!userId) continue;
      // Two guest entrants typed with the same name link to one member, so
      // dedupe before the single insert. `place` is built champion-first and
      // then by finishing order, so the first write is the BEST placement,
      // which is the row to keep.
      if (rows.has(userId)) continue;
      rows.set(userId, {
        groupId: loaded.groupId,
        matchId,
        userId,
        seed,
        placement: p,
        isWinner: p === 1,
      });
    }
  }
  await insertParticipants(db, [...rows.values()]);
}

// ---------- guest -> member backfill (see guest-link.ts) ----------

/** Distinct guest display names across this crew's completed brackets. */
export async function guestNamesBracket(groupId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ entrants: brackets.entrants })
    .from(brackets)
    .where(and(eq(brackets.groupId, groupId), eq(brackets.status, "completed")));
  const names = new Set<string>();
  for (const r of rows) {
    for (const e of parseEntrants(r.entrants)) if (e.kind === "guest" && e.name) names.add(e.name);
  }
  return [...names];
}

/**
 * Credit (or preview) the guest's finishing place in every completed bracket
 * they entered. Reuses the same materializer the live completion uses: it
 * reopens the already-materialized match and adds the member's row.
 */
export async function creditGuestBracket(
  groupId: string,
  guestName: string,
  memberId: string,
  dryRun: boolean,
): Promise<GuestCreditResult> {
  const db = getDb();
  const rows = await db
    .select({
      id: brackets.id,
      eventId: brackets.eventId,
      gameId: brackets.gameId,
      format: brackets.format,
      entrants: brackets.entrants,
      results: brackets.results,
      gameName: games.name,
      scheduledFor: events.scheduledFor,
    })
    .from(brackets)
    .innerJoin(games, eq(brackets.gameId, games.id))
    .innerJoin(events, eq(brackets.eventId, events.id))
    .where(and(eq(brackets.groupId, groupId), eq(brackets.status, "completed")));
  const items: GuestCreditResult["items"] = [];
  const linkMap = new Map([[guestName, memberId]]);
  let written = 0;

  for (const b of rows) {
    const entrants = parseEntrants(b.entrants);
    const seedIdx = entrants.findIndex((e) => e.kind === "guest" && e.name === guestName);
    if (seedIdx < 0) continue;
    // A completed bracket materializes exactly one match, keyed by bracketId.
    const m = (
      await db.select({ id: matches.id }).from(matches).where(eq(matches.bracketId, b.id)).limit(1)
    )[0];
    if (!m) continue;
    const already = (
      await db
        .select({ id: matchParticipants.id })
        .from(matchParticipants)
        .where(and(eq(matchParticipants.matchId, m.id), eq(matchParticipants.userId, memberId)))
        .limit(1)
    )[0];
    if (already) continue; // member already has a row in this tournament

    const structure = buildStructure(b.format, entrants.length);
    const computed = computeBracket(entrants.length, structure, b.results as BracketResults);
    const placement = placements(structure, computed).get(seedIdx + 1);
    if (placement == null) continue; // guest never placed (e.g. bye only)

    items.push({
      pack: "bracket",
      packLabel: "Tournament",
      eventId: b.eventId,
      label: b.gameName ?? "Tournament",
      date: b.scheduledFor ? b.scheduledFor.toISOString() : null,
      placement,
      isWinner: placement === 1,
    });

    if (!dryRun) {
      await materialize(
        {
          id: b.id,
          eventId: b.eventId,
          groupId,
          gameName: b.gameName ?? "",
          groupName: "",
          status: "completed",
          format: b.format,
          openScoring: false,
          gameId: b.gameId,
          entrants,
          results: b.results as BracketResults,
          myRole: "owner",
        },
        structure,
        linkMap,
      );
      written++;
    }
  }
  return { items, written: dryRun ? 0 : written };
}

// ---------- Derivation for the client ----------

async function deriveView(loaded: LoadedBracket) {
  const db = getDb();
  // Walks INTO team entrants, so a pair's names resolve the same way a solo
  // entrant's does.
  const memberIds = loaded.entrants
    .flatMap(entrantMembers)
    .filter((m): m is { kind: "member"; userId: string } => m.kind === "member")
    .map((m) => m.userId);
  const entrantRows = memberIds.length
    ? await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, memberIds))
    : [];
  const nameOf = new Map(entrantRows.map((u) => [u.id, u.displayName]));

  const personOf = (m: SoloEntrant) =>
    m.kind === "guest"
      ? { userId: null, displayName: m.name }
      : { userId: m.userId, displayName: nameOf.get(m.userId) ?? "Unknown" };

  /**
   * What one slot is called, and who is actually in it.
   *
   * EVERY SLOT CARRIES `members`, including a solo one, where it is a list of
   * one holding the same userId and displayName the slot itself carries. That
   * is what makes the change invisible to every existing consumer: BracketPage,
   * TvPage, the recap card and the TV harnesses all read `displayName`, and a
   * solo entrant's `userId` and `displayName` are exactly what they were.
   *
   * A TEAM SLOT HAS userId: null, because it is not one person, the team label
   * in `displayName`, and its people in `members`.
   */
  const labelOf = (
    seed: number,
  ): { userId: string | null; displayName: string; members: { userId: string | null; displayName: string }[] } => {
    const e = loaded.entrants[seed - 1];
    if (!e) return { userId: null, displayName: "Unknown", members: [] };
    return {
      userId: e.kind === "member" ? e.userId : null,
      displayName: entrantLabel(e, (id) => nameOf.get(id)),
      members: entrantMembers(e).map(personOf),
    };
  };

  const structure = buildStructure(loaded.format, loaded.entrants.length);
  const computed = computeBracket(loaded.entrants.length, structure, loaded.results);

  const slotView = (s: Slot) =>
    s.kind === "player"
      ? { kind: "player" as const, seed: s.seed, ...labelOf(s.seed) }
      : { kind: s.kind };

  return {
    id: loaded.id,
    eventId: loaded.eventId,
    groupId: loaded.groupId,
    gameName: loaded.gameName,
    groupName: loaded.groupName,
    status: loaded.status,
    format: loaded.format,
    openScoring: loaded.openScoring,
    canScore: canScore(loaded),
    canManage: loaded.myRole === "owner" || loaded.myRole === "admin",
    entrantCount: loaded.entrants.length,
    rounds: structure.groups
      .map((g) => ({
        title: g.title,
        side: g.side,
        matches: g.ids
          .map((id) => computed.matches[id]!)
          // Phantom bye-vs-bye matches and a grand-final reset that isn't
          // needed are engine bookkeeping; hide them.
          .filter((m) => m.active && !(m.a.kind === "bye" && m.b.kind === "bye"))
          .map((m) => ({
            id: m.def.id,
            a: slotView(m.a),
            b: slotView(m.b),
            winner: m.decided ? slotView(m.winner) : null,
            decided: m.decided,
            auto: m.auto,
            playable: m.playable,
            undoable: m.def.id in loaded.results,
            reset: !!m.def.resetOf,
          })),
      }))
      // A losers round can be all-phantom when byes outnumber players.
      .filter((g) => g.matches.length > 0),
    champion: computed.championSeed
      ? slotView({ kind: "player", seed: computed.championSeed })
      : null,
  };
}

// ---------- Loaders ----------

interface LoadedBracket {
  id: string;
  eventId: string;
  groupId: string;
  gameName: string;
  groupName: string;
  status: "setup" | "live" | "completed";
  format: BracketFormat;
  openScoring: boolean;
  gameId: string;
  entrants: Entrant[];
  results: BracketResults;
  myRole: "owner" | "admin" | "member";
}

async function loadBracketForMember(
  bracketId: string,
  userId: string,
): Promise<LoadedBracket | undefined> {
  const db = getDb();
  const rows = await db
    .select({
      id: brackets.id,
      eventId: brackets.eventId,
      groupId: brackets.groupId,
      status: brackets.status,
      openScoring: brackets.openScoring,
      gameId: brackets.gameId,
      format: brackets.format,
      entrants: brackets.entrants,
      results: brackets.results,
      gameName: games.name,
      groupName: groups.name,
    })
    .from(brackets)
    .innerJoin(games, eq(brackets.gameId, games.id))
    .innerJoin(groups, eq(brackets.groupId, groups.id))
    .where(eq(brackets.id, bracketId))
    .limit(1);
  const b = rows[0];
  if (!b) return undefined;
  const role = await roleOf(b.groupId, userId);
  if (!role) return undefined;
  return { ...b, entrants: parseEntrants(b.entrants), myRole: role };
}

async function loadEventForMember(eventId: string, userId: string) {
  const db = getDb();
  const found = (await db.select().from(events).where(eq(events.id, eventId)).limit(1))[0];
  if (!found) return undefined;
  if (!(await isMember(found.groupId, userId))) return undefined;
  return found;
}

async function isMember(groupId: string, userId: string): Promise<boolean> {
  return !!(await roleOf(groupId, userId));
}

function canScore(b: LoadedBracket): boolean {
  return b.openScoring || b.myRole === "owner" || b.myRole === "admin";
}

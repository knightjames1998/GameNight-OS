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
  parseEntrants,
  placements,
  type BracketFormat,
  type BracketResults,
  type BracketStructure,
  type Entrant,
  type Slot,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { broadcast } from "./ws.js";

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
 * Start a tournament for an event. Entrants = the RSVP yes-list in the
 * order they answered (first in, top seed: reward the committed).
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

  const yesList = await db
    .select({ userId: rsvps.userId })
    .from(rsvps)
    .where(and(eq(rsvps.eventId, event.id), eq(rsvps.status, "yes")))
    .orderBy(rsvps.respondedAt);

  if (yesList.length < 2) {
    res.status(400).json({ error: "Need at least 2 yes RSVPs to start a bracket" });
    return;
  }

  const gameName = String(req.body?.gameName ?? "").trim() || "Game Night";
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
        entrants: yesList.map((r) => ({ kind: "member" as const, userId: r.userId })),
        results: {},
      })
      .returning()
  )[0]!;

  broadcast({ type: "bracket_updated", bracketId: bracket.id });
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
  await getDb()
    .update(brackets)
    .set({ results, status: after.championSeed ? "completed" : "live" })
    .where(eq(brackets.id, loaded.id));

  if (after.championSeed) {
    await materialize({ ...loaded, results }, structure);
  }

  broadcast({ type: "bracket_updated", bracketId: loaded.id });
  res.json({ ok: true });
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
  await db2.update(brackets).set({ results, status: "live" }).where(eq(brackets.id, loaded.id));

  // The bracket is no longer finished, so its recorded results must go.
  const stale = await db2
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.bracketId, loaded.id));
  for (const m of stale) {
    await db2.delete(matchParticipants).where(eq(matchParticipants.matchId, m.id));
  }
  await db2.delete(matches).where(eq(matches.bracketId, loaded.id));

  broadcast({ type: "bracket_updated", bracketId: loaded.id });
  res.json({ ok: true });
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
  broadcast({ type: "bracket_updated", bracketId: loaded.id });
  res.json({ ok: true });
});

/**
 * Write a completed bracket into the cross-game stats ledger: one matches
 * row for the tournament, one match_participants row per MEMBER entrant
 * with their finishing place. Guests are skipped (they have no identity to
 * credit yet; linking guests to members is a backlog item). Idempotent by
 * bracketId.
 */
async function materialize(loaded: LoadedBracket, structure: BracketStructure) {
  const db = getDb();
  const existing = await db
    .select({ id: matches.id })
    .from(matches)
    .where(eq(matches.bracketId, loaded.id))
    .limit(1);
  if (existing[0]) return;

  const computed = computeBracket(loaded.entrants.length, structure, loaded.results);
  if (!computed.championSeed) return;

  // Finishing place per seed: champion 1, then by how late each player was
  // eliminated. The engine knows what "eliminated" means per format (in
  // double elim a winners-bracket loss just drops you down).
  const place = placements(structure, computed);

  const match = (
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
  )[0]!;

  for (const [seed, p] of place) {
    const e = loaded.entrants[seed - 1];
    if (!e || e.kind !== "member") continue; // guests carry no stats
    await db
      .insert(matchParticipants)
      .values({
        groupId: loaded.groupId,
        matchId: match.id,
        userId: e.userId,
        seed,
        placement: p,
        isWinner: p === 1,
      })
      .onConflictDoNothing();
  }
}

// ---------- Derivation for the client ----------

async function deriveView(loaded: LoadedBracket) {
  const db = getDb();
  const memberIds = loaded.entrants
    .filter((e): e is { kind: "member"; userId: string } => e.kind === "member")
    .map((e) => e.userId);
  const entrantRows = memberIds.length
    ? await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, memberIds))
    : [];
  const nameOf = new Map(entrantRows.map((u) => [u.id, u.displayName]));

  const labelOf = (seed: number): { userId: string | null; displayName: string } => {
    const e = loaded.entrants[seed - 1];
    if (!e) return { userId: null, displayName: "Unknown" };
    if (e.kind === "guest") return { userId: null, displayName: e.name };
    return { userId: e.userId, displayName: nameOf.get(e.userId) ?? "Unknown" };
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

async function roleOf(
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

function canScore(b: LoadedBracket): boolean {
  return b.openScoring || b.myRole === "owner" || b.myRole === "admin";
}

// Mario Party pack server routes.
//
// Session-based like Smash/Mario Kart (one server-side session per event on
// the generic game_sessions table keyed by (eventId, pack), members join the
// host's session, live sync on every write), but a game is one BOARD with a
// total-star count per player, so it records more than an FFA placement:
//   - the board goes on matches.label,
//   - total stars go on match_participants.score,
//   - the character on match_participants.character,
//   - bonus stars on match_participants.meta ({ bonusStars: [...] }).
// The winner is the most stars; a top tie is resolved by the host.
//
// Two new nullable columns back this: matches.label and
// match_participants.meta. Both are additive; ship the idempotent SQL with
// the deploy and confirm the drizzle push applied.

import { Router } from "express";
import {
  getDb,
  events,
  games,
  matches,
  matchParticipants,
  users,
  and,
  eq,
} from "@gamenight/db";
import {
  newMpState,
  normalizeMpState,
  assignRandomFighters,
  rankMpLines,
  rankMpSides,
  summarizeMpNight,
  MARIO_PARTY_TITLES,
  bonusStarsForTitle,
  bonusFamilyOf,
  rosterForTitle,
  validateSides,
  singletonSides,
  sideIdAt,
  defaultSideName,
  currentSides,
  hasTeamStructure,
  reshuffle,
  truncateSideLog,
  type MpSessionState,
  type MpGame,
  type MpRawEntry,
  type MpSideEntry,
  type Side,
  type SmashPlayer,
  SESSION_PACKS,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { createPackRuntime, packConfig, roleOf, isHostRole, type LedgerLine } from "./pack-runtime.js";
import { broadcast } from "./ws.js";
import { memberCreditedKeys, type GuestCreditResult } from "./guest-link-util.js";

/** This pack's registry entry, the one place its identifiers exist. */
const DEF = SESSION_PACKS.marioparty;

export const marioPartyRouter = Router();
export const marioPartyTvRouter = Router();

export const marioPartyRuntime = createPackRuntime<MpSessionState>({
  ...packConfig("marioparty"),
  extras: (state) => ({ summary: summarizeMpNight(state) }),
  // Sessions written before Tag Battle have no sideLog at all. THE ONE PLACE
  // that is repaired, rather than defaulting it inline at a dozen read sites.
  normalize: normalizeMpState,
});

const rt = marioPartyRuntime;

// ---------- ledger ----------

/**
 * Materialize one recorded BOARD. The board goes on matches.label, total stars
 * on match_participants.score, the character on match_participants.character,
 * and bonus stars on meta ({ bonusStars: [...] }), null when a player took
 * none. The winner is the most stars, already decided by rankMpLines.
 */
async function materializeGame(
  groupId: string,
  eventId: string,
  gameId: string,
  game: MpGame,
  roster: SmashPlayer[],
  sessionKey: string,
  linkMap?: Map<string, string>, // guest display name -> member userId (backfill)
): Promise<{ recorded: number; guests: number }> {
  const lines: LedgerLine[] = game.lines.map((line) => ({
    playerId: line.playerId,
    placement: line.placement,
    isWinner: line.isWinner,
    character: line.character ?? null,
    score: line.stars,
    meta: line.bonusStars.length ? { bonusStars: line.bonusStars } : null,
    // Which SIDE. Null on every row of a Battle Royale board, which is the
    // same NULL the column has held since this pack shipped: teams.ts sideIdFor
    // owns the rule, and a board whose sides all hold one player has no team
    // structure. A board recorded before Tag Battle existed has no `side` on
    // its line at all, hence the coalesce rather than a bare read.
    side: line.side ?? null,
  }));

  return rt.materializeUnit({
    groupId,
    eventId,
    gameId,
    idx: game.idx,
    sessionKey,
    label: game.map,
    format: "board",
    roster,
    lines,
    linkMap,
  });
}

// ---------- guest -> member backfill (see guest-link.ts) ----------

/** Distinct guest display names across this crew's Mario Party sessions. */
export async function guestNamesMarioParty(groupId: string): Promise<string[]> {
  return rt.guestNames(groupId, (state) => state.roster);
}

/** Credit (or preview) every recoverable Mario Party board the guest played. */
export async function creditGuestMarioParty(
  groupId: string,
  guestName: string,
  memberId: string,
  dryRun: boolean,
): Promise<GuestCreditResult> {
  const rows = await rt.sessionsForGroup(groupId);
  const items: GuestCreditResult["items"] = [];
  const linkMap = new Map([[guestName, memberId]]);
  let gameId: string | null = null;

  for (const { eventId, state } of rows) {
    const guestSlots = new Set(
      (state.roster ?? []).filter((p) => p.kind === "guest" && p.name === guestName).map((p) => p.id),
    );
    if (guestSlots.size === 0) continue;
    const credited = await memberCreditedKeys(eventId, memberId);

    for (const g of state.games ?? []) {
      const line = g.lines.find((l) => guestSlots.has(l.playerId));
      if (!line) continue;
      if (credited.has(rt.ledgerKey(eventId, state.sessionKey, g.idx))) continue;
      items.push({
        pack: DEF.ledger,
        packLabel: DEF.name,
        eventId,
        label: g.map,
        date: g.at ?? null,
        placement: line.placement,
        isWinner: line.isWinner,
      });
    }

    if (!dryRun) {
      gameId = gameId ?? (await rt.ensureGame(groupId));
      for (const g of state.games ?? []) {
        if (g.lines.some((l) => guestSlots.has(l.playerId))) {
          await materializeGame(groupId, eventId, gameId, g, state.roster, state.sessionKey, linkMap);
        }
      }
    }
  }
  return { items, written: dryRun ? 0 : items.length };
}

// ---------- sides off the wire ----------

// Side ids and names are MINTED SERVER-SIDE in both parsers below, never taken
// from the body: `side` is compared for equality and never rendered, so letting
// a client choose it buys nothing and lets a typo split one side in two.

/**
 * Sides at START, where the wire carries ROSTER INDICES.
 *
 * The setup screen has never seen a slot id, because the server mints them in
 * this very request, so it sends positions into the roster it just posted.
 * Follows Ping Pong, which shipped this shape with the primitive. An index that
 * names nobody is dropped rather than guessed at, and the caller checks that
 * everybody ended up placed.
 */
function sidesFromIndices(raw: unknown, roster: SmashPlayer[]): Side[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((members: unknown, i: number): Side => ({
    id: sideIdAt(i),
    name: defaultSideName(i),
    memberIds: [
      ...new Set(
        (Array.isArray(members) ? members : [])
          .map((n: unknown) => roster[Number(n)]?.id)
          .filter((id: string | undefined): id is string => !!id),
      ),
    ],
  }));
}

/**
 * Sides at RESHUFFLE, where the session is live and the wire carries slot IDS.
 *
 * Filtered to this session's own roster, so a stale slot from a replaced
 * session cannot smuggle a player in. Everything else is left to validateSides,
 * which owns what is acceptable.
 */
function sidesFromIds(raw: unknown, roster: SmashPlayer[]): Side[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const slotIds = new Set(roster.map((p) => p.id));
  return raw.map((s: any, i: number): Side => ({
    id: sideIdAt(i),
    name: defaultSideName(i),
    memberIds: [
      ...new Set<string>(
        ((Array.isArray(s?.memberIds) ? s.memberIds : []) as unknown[])
          .map((x) => String(x))
          .filter((id) => slotIds.has(id)),
      ),
    ],
  }));
}

// ---------- launch context ----------

marioPartyRouter.get("/marioparty-context/:eventId", requireAuth, async (req: AuthedRequest, res) => {
  const ctx = await rt.launchContext(String(req.params.eventId), req.user!.id);
  if (!ctx) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(ctx);
});

// ---------- read live state ----------

marioPartyRouter.get("/marioparty/:eventId", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (loaded && !(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Reuse the row the role check just read instead of selecting it twice.
  await rt.respondState(eventId, res, loaded);
});

// Public big-screen read. Event UUID is the access key. Mounted before the
// bare /api authed routers.
marioPartyTvRouter.get("/marioparty/:eventId", async (req, res) => {
  await rt.respondState(String(req.params.eventId), res);
});

// ---------- host: start / configure ----------

marioPartyRouter.post("/events/:eventId/marioparty", requireAuth, async (req: AuthedRequest, res) => {
  const db = getDb();
  const eventId = String(req.params.eventId);
  const event = (await db.select().from(events).where(eq(events.id, eventId)).limit(1))[0];
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const role = await roleOf(event.groupId, req.user!.id);
  if (!isHostRole(role)) {
    res.status(403).json({ error: "Only crew owners and admins can start a game" });
    return;
  }

  const assignment = req.body?.assignment;
  if (!["self", "random", "host"].includes(assignment)) {
    res.status(400).json({ error: "invalid assignment" });
    return;
  }

  // Don't clobber a session already in progress (standing rule 8) unless the
  // host confirmed a replace (client resends force after a 409).
  //
  // The force check was MISSING here, and only here. The other three packs
  // have always had it, so Mario Party was the one pack where an in-progress
  // session could never be replaced at all: the host got a raw 409 error on
  // the setup screen with no way forward, and the only escape was to complete
  // or abandon the night. Found while unifying the four pack shells, which is
  // exactly the sort of drift a fourth hand-copied implementation hides.
  const existing = await rt.loadState(eventId);
  if (
    !req.body?.force &&
    existing &&
    existing.row.status !== "completed" &&
    existing.state.games.length > 0
  ) {
    res.status(409).json({ error: "A session is already in progress for this event" });
    return;
  }

  const titleId = MARIO_PARTY_TITLES.some((t) => t.id === req.body?.titleId)
    ? String(req.body.titleId)
    : MARIO_PARTY_TITLES[0]!.id;
  const pool = rosterForTitle(MARIO_PARTY_TITLES, titleId);

  const rawRoster = Array.isArray(req.body?.roster) ? req.body.roster : [];
  const roster: SmashPlayer[] = rawRoster
    .map((p: any, i: number): SmashPlayer => {
      const name = String(p?.name ?? "").trim().slice(0, 24);
      const userId = typeof p?.userId === "string" ? p.userId : null;
      return {
        id: `p${i}_${Math.random().toString(36).slice(2, 8)}`,
        kind: userId ? "member" : "guest",
        userId,
        name,
        character: pool.includes(p?.character) ? p.character : null,
      };
    })
    .filter((p: SmashPlayer) => p.name.length > 0)
    .slice(0, 4);

  if (roster.length < 2) {
    res.status(400).json({ error: "Add at least 2 players" });
    return;
  }

  // TAG BATTLE, optional and available on ANY title. MP2, MP6 and MP7 all have
  // team modes, and gating this to one title would need a per-title capability
  // flag that goes stale the moment a title's data is edited. The app records
  // what the night did rather than refereeing it, which is the principle
  // already written at validateSides.
  const sides = sidesFromIndices(req.body?.sides, roster);
  if (sides) {
    // maxSides 2 because Tag Battle is 2v2. MP7's 4-Team Battle is deferred:
    // four sides changes what the record screen IS, rather than being a bigger
    // version of this.
    const check = validateSides(sides, 2);
    if (check.error) {
      res.status(400).json({ error: check.error });
      return;
    }
    // UNEVEN IS NOT AN ERROR. validateSides returns `even` as a fact and a 2v1
    // is a real thing a crew does; the screen warns rather than blocking.
    //
    // A PLAYER LEFT OFF EVERY SIDE IS a different matter and IS refused: a
    // roster slot with no side would be invisible to the record screen, which
    // renders one star box per side. Reject rather than guess. Follows Ping
    // Pong's doubles start.
    const placed = new Set(sides.flatMap((x) => x.memberIds));
    if (placed.size !== roster.length) {
      res.status(400).json({ error: "Every player needs to be on a side" });
      return;
    }
  }

  let state = newMpState({ titleId, assignment, roster, sides: sides ?? undefined });
  if (assignment === "random") state.roster = assignRandomFighters(state.roster, pool);

  res.json(await rt.startSession(eventId, event.groupId, state, req.get("x-gn-client")));
});

// ---------- assignment ----------

marioPartyRouter.post("/marioparty/:eventId/character", requireAuth, async (req: AuthedRequest, res) => {
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
  const playerId = String(req.body?.playerId ?? "");
  const character = req.body?.character;
  const titlePool = rosterForTitle(MARIO_PARTY_TITLES, loaded.state.titleId);
  if (character !== null && !titlePool.includes(character)) {
    res.status(400).json({ error: "That character isn't in this game" });
    return;
  }
  const slot = loaded.state.roster.find((p) => p.id === playerId);
  if (!slot) {
    res.status(404).json({ error: "Player not in session" });
    return;
  }
  const owns = slot.userId && slot.userId === req.user!.id;
  if (!isHostRole(role) && !owns) {
    res.status(403).json({ error: "You can only set your own character" });
    return;
  }
  if (!isHostRole(role) && loaded.state.assignment !== "self") {
    res.status(403).json({ error: "The host is assigning characters this session" });
    return;
  }
  slot.character = character ?? null;
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

marioPartyRouter.post("/marioparty/:eventId/randomize", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  if (!isHostRole(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Host only" });
    return;
  }
  loaded.state.roster = assignRandomFighters(
    loaded.state.roster,
    rosterForTitle(MARIO_PARTY_TITLES, loaded.state.titleId),
  );
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

// ---------- host: reshuffle the sides ----------

marioPartyRouter.post("/marioparty/:eventId/reshuffle", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  if (!isHostRole(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Host only" });
    return;
  }
  const { state } = loaded;
  const sides = sidesFromIds(req.body?.sides, state.roster) ?? singletonSides(state.roster.map((p) => p.id));
  const check = validateSides(sides, 2);
  if (check.error) {
    res.status(400).json({ error: check.error });
    return;
  }
  // FROM THE NEXT BOARD ON, never retroactively: reshuffle takes the unit
  // count and records the boundary. Its error string is returned rather than
  // this route deciding for itself that an arrangement is acceptable.
  const error = reshuffle(state.sideLog, sides, state.games.length);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

// ---------- record a board ----------

marioPartyRouter.post("/marioparty/:eventId/record", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  const { state, row } = loaded;
  const role = await roleOf(row.groupId, req.user!.id);
  if (!role) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!isHostRole(role) && !state.openScoring) {
    res.status(403).json({ error: "Only the host records results (open scoring is off)" });
    return;
  }

  const map = String(req.body?.map ?? "").trim().slice(0, 60);
  if (!map) {
    res.status(400).json({ error: "Pick a board" });
    return;
  }

  const slotIds = new Set(state.roster.map((p) => p.id));
  const charOf = new Map(state.roster.map((p) => [p.id, p.character]));
  const allowedBonus = new Set(bonusStarsForTitle(state.titleId));

  /** Clamp and sanitize one typed star total. Shared by both body shapes. */
  const cleanStars = (n: unknown) => Math.max(0, Math.min(99, Math.floor(Number(n) || 0)));
  /** Only stars this title actually offers, deduped. Shared by both shapes. */
  const cleanBonus = (raw: unknown): string[] =>
    Array.isArray(raw)
      ? [...new Set<string>((raw as unknown[]).map((x) => String(x)))].filter((b) => allowedBonus.has(b))
      : [];

  const raw = Array.isArray(req.body?.lines) ? req.body.lines : [];

  // TWO BODY SHAPES, ONE PER SIDE OR ONE PER PLAYER, chosen by what the session
  // is actually set up as rather than by what the client claims to be sending.
  // A tag board carries ONE star total per SIDE, because Tag Battle shares
  // Orbs, Stars and coins.
  const teamPlay = hasTeamStructure(state.sideLog);
  const { lines, error } = teamPlay
    ? rankMpSides(
        currentSides(state.sideLog),
        raw.map((l: any): MpSideEntry => ({
          sideId: String(l?.sideId ?? ""),
          stars: cleanStars(l?.stars),
          bonusStars: cleanBonus(l?.bonusStars),
        })),
        req.body?.winnerSideId ? String(req.body.winnerSideId) : null,
        Object.fromEntries(state.roster.map((p) => [p.id, p.character ?? null])),
      )
    : rankMpLines(
        raw
          .filter((l: any) => slotIds.has(String(l?.playerId)))
          .map((l: any): MpRawEntry => ({
            playerId: String(l.playerId),
            character: charOf.get(String(l.playerId)) ?? null,
            stars: cleanStars(l?.stars),
            bonusStars: cleanBonus(l?.bonusStars),
          })),
        req.body?.winnerId ? String(req.body.winnerId) : null,
      );
  if (error) {
    res.status(400).json({ error });
    return;
  }

  const game: MpGame = {
    idx: state.games.length,
    map,
    lines,
    at: new Date().toISOString(),
  };
  state.games.push(game);

  const gameId = await rt.ensureGame(row.groupId);
  const report = await materializeGame(row.groupId, eventId, gameId, game, state.roster, state.sessionKey);

  const origin = req.get("x-gn-client");
  const view = await rt.saveState(loaded, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json({ ...view, ...report });
});

marioPartyRouter.post("/marioparty/:eventId/undo", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  const { state, row } = loaded;
  if (!isHostRole(await roleOf(row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Host only" });
    return;
  }
  const last = state.games.pop();
  if (!last) {
    res.json({ ...rt.viewOf(loaded), empty: true });
    return;
  }
  await rt.deleteMaterialized(eventId, state.sessionKey, last.idx);
  // Drop any arrangement the undo went back past, so undoing across a
  // reshuffle puts the OLD pairs back on the screen rather than leaving an
  // arrangement in force that nothing was ever played under.
  truncateSideLog(state.sideLog, state.games.length);
  const origin = req.get("x-gn-client");
  const view = await rt.saveState(loaded, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json(view);
});

marioPartyRouter.post("/marioparty/:eventId/open-scoring", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  if (!isHostRole(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Host only" });
    return;
  }
  loaded.state.openScoring = !!req.body?.open;
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

marioPartyRouter.post("/marioparty/:eventId/complete", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  if (!isHostRole(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Host only" });
    return;
  }
  res.json(await rt.saveState(loaded, "completed", req.get("x-gn-client")));
});

// ---------- lifetime Mario Party stats ----------
// Everything the pack tracks, read from the ledger: wins/win rate, total &
// average stars, wins by board, bonus-star breakdown, character stats.
marioPartyRouter.get("/groups/:id/marioparty-stats", requireAuth, async (req: AuthedRequest, res) => {
  const db = getDb();
  const groupId = String(req.params.id);
  if (!(await roleOf(groupId, req.user!.id))) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const game = (
    await db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.groupId, groupId), eq(games.pack, DEF.ledger)))
      .limit(1)
  )[0];
  if (!game) {
    res.json(foldMpStatRows([]));
    return;
  }

  const rows = await db
    .select({
      userId: matchParticipants.userId,
      displayName: users.displayName,
      character: matchParticipants.character,
      isWinner: matchParticipants.isWinner,
      stars: matchParticipants.score,
      meta: matchParticipants.meta,
      matchId: matchParticipants.matchId,
      map: matches.label,
      side: matchParticipants.side,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(users, eq(matchParticipants.userId, users.id))
    .where(and(eq(matches.groupId, groupId), eq(matches.gameId, game.id), eq(matches.status, "completed")));

  res.json(foldMpStatRows(rows));
});

export interface MpStatRow {
  userId: string;
  displayName: string;
  character: string | null;
  isWinner: boolean;
  stars: number | null;
  meta: unknown;
  matchId: string;
  map: string | null;
  /** NULL means the board had no team structure. See teams.ts sideIdFor. */
  side: string | null;
}

/** Boards, wins and stars for one half of the split. */
export interface MpTally {
  games: number;
  wins: number;
  totalStars: number;
  avgStars: number;
}

/**
 * Fold participant rows into the stats panel's shape. Pure, following
 * foldMkStatRows, so the one property that matters can actually be asserted:
 * THE TWO HALVES SUM TO THE UNSPLIT TOTALS, by construction, because every row
 * goes into exactly one of them.
 *
 * WHY THE SPLIT EXISTS AT ALL. A tag board's star total belongs to the SIDE and
 * is written to every member, so an unsplit sum credits a pair twice for one
 * total. Bonus stars split for the same reason and it bites harder there: a
 * pair both credited with the one Minigame Star their side won would outrank a
 * solo player two to one on the lifetime bonus leaders.
 */
export function foldMpStatRows(rows: readonly MpStatRow[]) {
  const matchIds = new Set<string>();
  const tagMatchIds = new Set<string>();
  const newHalf = () => ({ games: 0, wins: 0, totalStars: 0 });
  const players = new Map<
    string,
    {
      userId: string;
      name: string;
      games: number;
      wins: number;
      totalStars: number;
      solo: ReturnType<typeof newHalf>;
      tag: ReturnType<typeof newHalf>;
      charCounts: Map<string, number>;
      bonus: Map<string, number>;
      bonusSolo: Map<string, number>;
      bonusTag: Map<string, number>;
    }
  >();
  const chars = new Map<string, { character: string; played: number; wins: number }>();
  const maps = new Map<string, { map: string; games: number; winners: Map<string, number> }>();
  const bonusByType = new Map<string, Map<string, number>>(); // star -> name -> count

  for (const r of rows) {
    matchIds.add(r.matchId);
    if (r.side) tagMatchIds.add(r.matchId);
    const p =
      players.get(r.userId) ??
      {
        userId: r.userId,
        name: r.displayName,
        games: 0,
        wins: 0,
        totalStars: 0,
        solo: newHalf(),
        tag: newHalf(),
        charCounts: new Map<string, number>(),
        bonus: new Map<string, number>(),
        bonusSolo: new Map<string, number>(),
        bonusTag: new Map<string, number>(),
      };
    // A board recorded before Tag Battle shipped has NULL here, and so does
    // every Battle Royale board recorded after it. Both are solo.
    const half = r.side ? p.tag : p.solo;
    p.games++;
    if (r.isWinner) p.wins++;
    p.totalStars += r.stars ?? 0;
    half.games++;
    if (r.isWinner) half.wins++;
    half.totalStars += r.stars ?? 0;
    if (r.character) p.charCounts.set(r.character, (p.charCounts.get(r.character) ?? 0) + 1);

    if (r.character) {
      const c = chars.get(r.character) ?? { character: r.character, played: 0, wins: 0 };
      c.played++;
      if (r.isWinner) c.wins++;
      chars.set(r.character, c);
    }

    if (r.map) {
      const m = maps.get(r.map) ?? { map: r.map, games: 0, winners: new Map<string, number>() };
      // count games per map once (via winner row), but rows are per player,
      // so track distinct matches per map separately below.
      if (r.isWinner) m.winners.set(r.displayName, (m.winners.get(r.displayName) ?? 0) + 1);
      maps.set(r.map, m);
    }

    const bonus = (r.meta as { bonusStars?: unknown } | null)?.bonusStars;
    if (Array.isArray(bonus)) {
      for (const b of bonus) {
        // Titles rename the same award (Coin Star / Rich Star / Rich
        // Bonus), so lifetime totals aggregate by family.
        const star = bonusFamilyOf(String(b));
        p.bonus.set(star, (p.bonus.get(star) ?? 0) + 1);
        const half = r.side ? p.bonusTag : p.bonusSolo;
        half.set(star, (half.get(star) ?? 0) + 1);
        // THE LEADERBOARD COUNTS SOLO ONLY, and this is the sharpest case for
        // the split. A tag board's bonus stars belong to the SIDE and are
        // written to both members, so counting them here would let a pair
        // outrank a solo player two to one on a star their side won once. The
        // tag counts are reported per player instead, under bonusStarsTag.
        if (!r.side) {
          const byName = bonusByType.get(star) ?? new Map<string, number>();
          byName.set(r.displayName, (byName.get(r.displayName) ?? 0) + 1);
          bonusByType.set(star, byName);
        }
      }
    }
    players.set(r.userId, p);
  }

  // distinct games per map (count unique matchIds per map)
  const mapGameCounts = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.map) continue;
    const s = mapGameCounts.get(r.map) ?? new Set<string>();
    s.add(r.matchId);
    mapGameCounts.set(r.map, s);
  }

  const byPlayer = [...players.values()]
    .map((p) => {
      let main: string | null = null;
      let max = 0;
      for (const [c, n] of p.charCounts) if (n > max) ((max = n), (main = c));
      const half = (h: { games: number; wins: number; totalStars: number }): MpTally => ({
        games: h.games,
        wins: h.wins,
        totalStars: h.totalStars,
        avgStars: h.games ? h.totalStars / h.games : 0,
      });
      return {
        userId: p.userId,
        name: p.name,
        games: p.games,
        wins: p.wins,
        winRate: p.games ? p.wins / p.games : 0,
        // THE UNSPLIT FIGURES ARE STILL REPORTED, and the panel prints them
        // beside both halves, so a reader who does not trust that the halves
        // sum to the total can check it on the screen. They OVERSTATE a pair's
        // night on their own, which is why they never appear alone.
        totalStars: p.totalStars,
        avgStars: p.games ? p.totalStars / p.games : 0,
        solo: half(p.solo),
        tag: half(p.tag),
        main,
        variety: p.charCounts.size,
        bonusStars: Object.fromEntries(p.bonus),
        bonusStarsSolo: Object.fromEntries(p.bonusSolo),
        bonusStarsTag: Object.fromEntries(p.bonusTag),
      };
    })
    .sort((a, b) => b.wins - a.wins || b.totalStars - a.totalStars);

  const byMap = [...maps.values()]
    .map((m) => {
      let topName: string | null = null;
      let topWins = 0;
      for (const [name, w] of m.winners) if (w > topWins) ((topWins = w), (topName = name));
      return {
        map: m.map,
        games: mapGameCounts.get(m.map)?.size ?? 0,
        topWinner: topName,
        topWinnerWins: topWins,
      };
    })
    .sort((a, b) => b.games - a.games);

  const byCharacter = [...chars.values()]
    .map((c) => ({ ...c, winRate: c.played ? c.wins / c.played : 0 }))
    .sort((a, b) => b.wins - a.wins || b.played - a.played);

  const bonusLeaders = [...bonusByType.entries()].map(([star, byName]) => {
    let leader: string | null = null;
    let count = 0;
    for (const [name, n] of byName) if (n > count) ((count = n), (leader = name));
    return { star, name: leader, count };
  });

  return {
    games: matchIds.size,
    tagGames: tagMatchIds.size,
    soloGames: matchIds.size - tagMatchIds.size,
    byPlayer,
    byMap,
    byCharacter,
    bonusLeaders,
  };
}

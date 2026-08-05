// Board Game pack server routes.
//
// The cheapest pack in the app, deliberately. One session per night on the
// shared game_sessions table keyed (eventId, "boardgame"), exactly like the
// other non-Smash session packs, and the LEDGER UNIT IS THE GAME, not the
// night: a night with four board games produces four matches rows sharing one
// sessionKey.
//
//   - the TITLE goes on matches.label, which is Mario Party's pattern for its
//     board,
//   - placement comes from the tapped finish order, with ties as
//     co-placements (competition ranking),
//   - an optional per-player score rides on match_participants.meta and is a
//     NOTE: it never derives, adjusts, validates or corrects the placement.
//
// No new engine, and no settlement function. Everything below is routing,
// validation and the two queries the per-title stats need.
//
// THE ONE REAL RISK IN THIS PACK IS THE TITLE. Per-title stats read
// matches.label, so the label space is unbounded free text and "Catan",
// "Settlers of Catan" and "catan" would be three titles that silently split a
// crew's history. The defence is in two places and both are here: the crew's
// own recents are offered first (see crewTitles), and every submitted title is
// canonicalized on the way in (see the record route), server-side, so a stale
// client cannot write a third spelling.
//
// No schema change: label, meta and the shared session table all already exist.

import { Router } from "express";
import {
  getDb,
  events,
  games,
  matches,
  matchParticipants,
  users,
  and,
  desc,
  eq,
} from "@gamenight/db";
import {
  BOARD_GAME_MAX_PLAYERS,
  bgGameLines,
  canonicalTitle,
  newBgState,
  recordTnGame,
  tnSideIdOf,
  validateTnOrder,
  currentTnSides,
  BOARD_GAME_CONFIG,
  summarizeBgNight,
  tnTitleSuggestions,
  type BgGame,
  type BgOrderEntry,
  type BgPlayer,
  type BgSessionState,
  SESSION_PACKS,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { createPackRuntime, packConfig, roleOf, isHostRole, type LedgerLine } from "./pack-runtime.js";
import { broadcast } from "./ws.js";
import { memberCreditedKeys, type GuestCreditResult } from "./guest-link-util.js";

/** The ledger spelling, from the one registry (packages/shared/src/packs.ts). */
const PACK = SESSION_PACKS.boardgame.ledger;

/** matches.format for every row this pack writes. */
const FORMAT = "boardgame";

export const boardGameRouter = Router();
export const boardGameTvRouter = Router();

export const boardGameRuntime = createPackRuntime<BgSessionState>({
  ...packConfig("boardgame"),
  extras: (state) => ({ summary: summarizeBgNight(state) }),
});

const rt = boardGameRuntime;

// ---------- titles the crew has already used ----------

/**
 * Distinct titles this crew has recorded, most recent first.
 *
 * This is the path most nights take and it is what keeps spelling stable, so it
 * is read in two places: the launch context (so the picker can offer them) and
 * the record route (so a submitted title is matched against them before it is
 * allowed to become a new one).
 */
async function crewTitles(groupId: string): Promise<string[]> {
  const db = getDb();
  const game = (
    await db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.groupId, groupId), eq(games.pack, PACK)))
      .limit(1)
  )[0];
  if (!game) return [];

  const rows = await db
    .select({ label: matches.label, playedAt: matches.playedAt })
    .from(matches)
    .where(and(eq(matches.groupId, groupId), eq(matches.gameId, game.id)))
    .orderBy(desc(matches.playedAt));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (!r.label || seen.has(r.label)) continue;
    seen.add(r.label);
    out.push(r.label);
  }
  return out;
}

// ---------- ledger ----------

/**
 * Materialize one recorded BOARD GAME. The title goes on matches.label,
 * placement and isWinner come straight off the tapped order, and a typed score
 * rides in meta as { score } when there is one.
 *
 * The score is deliberately NOT written to match_participants.score. That
 * column is a ranking input where packs use it (Mario Party's stars decide the
 * winner), and this one is a note that must never be mistaken for one.
 */
async function materializeGame(
  groupId: string,
  eventId: string,
  gameId: string,
  game: BgGame,
  roster: BgPlayer[],
  sessionKey: string,
  linkMap?: Map<string, string>, // guest display name -> member userId (backfill)
): Promise<{ recorded: number; guests: number }> {
  // The row shape is a PURE function in the shared module (bgGameLines), so what
  // a game writes can be pinned by a fixture with no database in the way. This
  // file keeps the insert and nothing else.
  const lines: LedgerLine[] = bgGameLines(game);

  return rt.materializeUnit({
    groupId,
    eventId,
    gameId,
    idx: game.idx,
    sessionKey,
    label: game.title,
    format: FORMAT,
    roster,
    lines,
    linkMap,
  });
}

// ---------- guest -> member backfill (see guest-link.ts) ----------

/** Distinct guest display names across this crew's Board Game sessions. */
export async function guestNamesBoardGame(groupId: string): Promise<string[]> {
  return rt.guestNames(groupId, (state) => state.roster);
}

/** Credit (or preview) every recoverable board game the guest played. */
export async function creditGuestBoardGame(
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
        pack: PACK,
        packLabel: SESSION_PACKS.boardgame.name,
        eventId,
        label: g.title,
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

// ---------- launch context ----------

// The shared context, plus the crew's own title history. That list is this
// pack's main defence against a split history, so the setup screen has to have
// it before the first game is recorded, not after.
boardGameRouter.get("/boardgame-context/:eventId", requireAuth, async (req: AuthedRequest, res) => {
  const ctx = await rt.launchContext(String(req.params.eventId), req.user!.id);
  if (!ctx) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json({ ...ctx, recentTitles: await crewTitles(ctx.groupId) });
});

// ---------- read live state ----------

boardGameRouter.get("/boardgame/:eventId", requireAuth, async (req: AuthedRequest, res) => {
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
boardGameTvRouter.get("/boardgame/:eventId", async (req, res) => {
  await rt.respondState(String(req.params.eventId), res);
});

// ---------- host: start ----------

boardGameRouter.post("/events/:eventId/boardgame", requireAuth, async (req: AuthedRequest, res) => {
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

  // Don't clobber a session already in progress (standing rule 8) unless the
  // host confirmed a replace (client resends force after a 409).
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

  const rawRoster = Array.isArray(req.body?.roster) ? req.body.roster : [];
  const roster: BgPlayer[] = rawRoster
    .map((p: any, i: number): BgPlayer => {
      const name = String(p?.name ?? "").trim().slice(0, 24);
      const userId = typeof p?.userId === "string" ? p.userId : null;
      return { id: `p${i}_${Math.random().toString(36).slice(2, 8)}`, kind: userId ? "member" : "guest", userId, name };
    })
    .filter((p: BgPlayer) => p.name.length > 0)
    // Board Game seats up to 12, which is this pack's own cap and not a change
    // to anybody else's: see BOARD_GAME_MAX_PLAYERS.
    .slice(0, BOARD_GAME_MAX_PLAYERS);

  if (roster.length < 2) {
    res.status(400).json({ error: "Add at least 2 players" });
    return;
  }

  res.json(await rt.startSession(eventId, event.groupId, newBgState({ roster }), req.get("x-gn-client")));
});

// ---------- what is on the table now ----------

// One tap when the box comes out. It is what the TV shows large, and it is why
// the TV has something to say during the long gaps between results, which is
// where a board game night actually lives.
boardGameRouter.post("/boardgame/:eventId/now-playing", requireAuth, async (req: AuthedRequest, res) => {
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
  if (!isHostRole(role) && !loaded.state.openScoring) {
    res.status(403).json({ error: "Only the host sets what is on the table (open scoring is off)" });
    return;
  }

  const raw = String(req.body?.title ?? "").slice(0, 60);
  if (!raw.trim()) {
    loaded.state.nowPlaying = null;
  } else {
    // Canonicalized here too, not only on record: whatever the TV shows for the
    // next hour is the spelling everybody in the room reads, and if it differs
    // from the one that lands in the ledger the crew has been shown a lie.
    const known = tnTitleSuggestions(await crewTitles(loaded.row.groupId), BOARD_GAME_CONFIG.titles);
    loaded.state.nowPlaying = canonicalTitle(raw, known).title;
  }
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

// ---------- record a game ----------

boardGameRouter.post("/boardgame/:eventId/record", requireAuth, async (req: AuthedRequest, res) => {
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

  const rawTitle = String(req.body?.title ?? "").slice(0, 60);
  if (!rawTitle.trim()) {
    res.status(400).json({ error: "Pick what you played" });
    return;
  }
  // CANONICALIZATION ON ENTRY, server-side. The crew's own recents come first,
  // then the curated starter list, so an existing spelling always wins and only
  // a genuine miss creates a new title.
  const known = tnTitleSuggestions(await crewTitles(row.groupId), BOARD_GAME_CONFIG.titles);
  const { title } = canonicalTitle(rawTitle, known);

  // The client taps PLAYERS in a free-for-all night and SIDES in a partnership
  // one. Both arrive as an order over sides here, because a free-for-all
  // session's sides are one player each, so there is one code path rather than
  // two that can disagree about what a placement means.
  const num = (v: unknown) => {
    const n = Number(v);
    return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
  };
  const raw = Array.isArray(req.body?.order) ? req.body.order : [];
  const order: BgOrderEntry[] = raw
    .map((e: any) => {
      // A player id is accepted and resolved to the side holding them, which is
      // what every client sent before sides existed here.
      const sideId = e?.sideId ? String(e.sideId) : tnSideIdOf(state, String(e?.playerId ?? ""));
      if (!sideId) return null;
      const memberScores: Record<string, number | null> = {};
      if (e?.memberScores && typeof e.memberScores === "object") {
        for (const [k, v] of Object.entries(e.memberScores)) memberScores[String(k)] = num(v);
      }
      return {
        sideId,
        tiedWithAbove: !!e?.tiedWithAbove,
        // A score is optional, and an absent one is absent rather than zero:
        // storing 0 would claim somebody scored nothing.
        score: num(e?.score),
        ...(Object.keys(memberScores).length ? { memberScores } : {}),
      } as BgOrderEntry;
    })
    .filter((e: BgOrderEntry | null): e is BgOrderEntry => e !== null);

  const err = validateTnOrder(order, state, BOARD_GAME_CONFIG);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }

  // The tapped order IS the placement. Nothing here sorts by score; the
  // reasoning lives at the top of titlenight.ts.
  const game: BgGame = recordTnGame(state, title, order);

  const gameId = await rt.ensureGame(row.groupId);
  const report = await materializeGame(row.groupId, eventId, gameId, game, state.roster, state.sessionKey);

  const origin = req.get("x-gn-client");
  const view = await rt.saveState(loaded, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json({ ...view, ...report });
});

boardGameRouter.post("/boardgame/:eventId/undo", requireAuth, async (req: AuthedRequest, res) => {
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
  // Undoing a mis-tapped result puts the box back on the table, which is where
  // it was a moment ago and where the host is about to re-enter it from.
  state.nowPlaying = last.title;
  const origin = req.get("x-gn-client");
  const view = await rt.saveState(loaded, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json(view);
});

boardGameRouter.post("/boardgame/:eventId/open-scoring", requireAuth, async (req: AuthedRequest, res) => {
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

boardGameRouter.post("/boardgame/:eventId/complete", requireAuth, async (req: AuthedRequest, res) => {
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
  loaded.state.nowPlaying = null;
  res.json(await rt.saveState(loaded, "completed", req.get("x-gn-client")));
});

// ---------- lifetime Board Game stats ----------
// Everything the pack tracks, read from the ledger. The per-title breakdown
// derives from matches.label, which is exactly why the label is canonicalized
// on the way in: these groupings ARE the spelling.
boardGameRouter.get("/groups/:id/boardgame-stats", requireAuth, async (req: AuthedRequest, res) => {
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
      .where(and(eq(games.groupId, groupId), eq(games.pack, PACK)))
      .limit(1)
  )[0];
  if (!game) {
    res.json({ games: 0, titles: 0, byPlayer: [], byTitle: [], mostPlayed: null });
    return;
  }

  const rows = await db
    .select({
      userId: matchParticipants.userId,
      displayName: users.displayName,
      isWinner: matchParticipants.isWinner,
      placement: matchParticipants.placement,
      matchId: matchParticipants.matchId,
      title: matches.label,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(users, eq(matchParticipants.userId, users.id))
    .where(and(eq(matches.groupId, groupId), eq(matches.gameId, game.id), eq(matches.status, "completed")));

  const matchIds = new Set<string>();
  const players = new Map<
    string,
    { userId: string; name: string; games: number; wins: number; placeSum: number; placed: number; titles: Set<string> }
  >();
  // title -> { distinct matches, winner name -> wins }
  const titles = new Map<string, { title: string; matchIds: Set<string>; winners: Map<string, number> }>();

  for (const r of rows) {
    matchIds.add(r.matchId);
    const p =
      players.get(r.userId) ??
      { userId: r.userId, name: r.displayName, games: 0, wins: 0, placeSum: 0, placed: 0, titles: new Set<string>() };
    p.games++;
    if (r.isWinner) p.wins++;
    // Average finish counts results that actually carried a placement, which is
    // the definition the profiles and the crew leaderboard already share.
    if (r.placement !== null) {
      p.placeSum += r.placement;
      p.placed++;
    }
    if (r.title) p.titles.add(r.title);
    players.set(r.userId, p);

    if (r.title) {
      const t = titles.get(r.title) ?? { title: r.title, matchIds: new Set<string>(), winners: new Map<string, number>() };
      t.matchIds.add(r.matchId);
      if (r.isWinner) t.winners.set(r.displayName, (t.winners.get(r.displayName) ?? 0) + 1);
      titles.set(r.title, t);
    }
  }

  const byPlayer = [...players.values()]
    .map((p) => ({
      userId: p.userId,
      name: p.name,
      games: p.games,
      wins: p.wins,
      winRate: p.games ? p.wins / p.games : 0,
      avgPlacement: p.placed ? p.placeSum / p.placed : null,
      titles: p.titles.size,
    }))
    .sort((a, b) => b.wins - a.wins || b.games - a.games);

  const byTitle = [...titles.values()]
    .map((t) => {
      const winners = [...t.winners.entries()]
        .map(([name, wins]) => ({ name, wins }))
        .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
      // The HOUSE CHAMPION: who has won this title most. Crew-wide, which is
      // the record shape craps' longest roll established. A tie on wins keeps
      // the first alphabetically rather than inventing a tiebreak.
      const champion = winners[0] ?? null;
      return {
        title: t.title,
        games: t.matchIds.size,
        winners,
        champion: champion?.name ?? null,
        championWins: champion?.wins ?? 0,
      };
    })
    .sort((a, b) => b.games - a.games || a.title.localeCompare(b.title));

  res.json({
    games: matchIds.size,
    titles: byTitle.length,
    byPlayer,
    byTitle,
    mostPlayed: byTitle[0] ? { title: byTitle[0].title, games: byTitle[0].games } : null,
  });
});

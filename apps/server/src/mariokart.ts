// Mario Kart pack server routes: "general tracking" = FFA races.
//
// Same shape as the Smash pack (one server-side session per event so
// members join the host's session, each recorded race materializes into
// matches/match_participants with the racer as the character, live sync on
// every write), but FFA-only and backed by the generic game_sessions table
// keyed by (eventId, pack) so it can coexist with a Smash session or a
// bracket on the same event. The pure session logic is shared with Smash
// (packages/shared): a race is exactly an FFA game with a placement per
// racer, winner-only or full order.
//
// Beerio Kart is the OTHER Mario Kart format and is a separate branded pack
// (apps/server/src/beerio.ts); this file is only the general tracker.

import { Router } from "express";
import { getDb, events, eq } from "@gamenight/db";
import {
  newMkKartState,
  cupStandings,
  cupNoForRace,
  assignRandomFighters,
  validateFfa,
  isRacer,
  summarizeNight,
  kothAdvance,
  newSeries,
  recordSeriesGame,
  finalizeSeries,
  seriesGameTally,
  summarizeSeriesLog,
  MARIO_KART_TITLES,
  rosterForTitle,
  type MkSessionState,
  type MkFormat,
  type SmashPlayer,
  type SmashResultDetail,
  type SmashResultLine,
  type SmashGame,
  type Series,
  type SeriesBestOf,
  SESSION_PACKS,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { createPackRuntime, packConfig, roleOf, isHostRole, type LedgerLine } from "./pack-runtime.js";
import { broadcast } from "./ws.js";
import { memberCreditedKeys, type GuestCreditResult } from "./guest-link-util.js";

/** The ledger spelling, from the one registry (packages/shared/src/packs.ts). */
const PACK = SESSION_PACKS.mariokart.ledger;

export const marioKartRouter = Router();
export const marioKartTvRouter = Router();

export const marioKartRuntime = createPackRuntime<MkSessionState>({
  ...packConfig("mariokart"),
  extras: (state) => ({
    // summarizeNight only reads roster + games; MK's wider format union is
    // irrelevant to it, so the cast is safe.
    summary: summarizeNight(state as unknown as import("@gamenight/shared").SmashSessionState),
    cup: state.format === "grandprix" ? cupStandings(state) : null,
    seriesStandings: state.format === "bestof" ? seriesStandings(state) : [],
  }),
});

const rt = marioKartRuntime;

// ---------- ledger ----------

/** Materialize one recorded RACE (game-as-unit): a placement per racer. */
async function materializeGame(
  groupId: string,
  eventId: string,
  gameId: string,
  game: SmashGame,
  roster: SmashPlayer[],
  sessionKey: string,
  label: string | null,
  format: MkFormat,
  linkMap?: Map<string, string>, // guest display name -> member userId (backfill)
): Promise<{ recorded: number; guests: number }> {
  const lines: LedgerLine[] = game.lines.map((line) => ({
    playerId: line.playerId,
    placement: line.placement,
    isWinner: line.isWinner,
    character: line.character ?? null,
  }));

  return rt.materializeUnit({
    groupId,
    eventId,
    gameId,
    idx: game.idx,
    sessionKey,
    label,
    format,
    roster,
    lines,
    linkMap,
  });
}

/**
 * Materialize one completed best-of SERIES (match-as-unit): one matches row
 * labeled bo{N}, winner placement 1 / loser 2, each racer on character,
 * per-player game wins/played in meta. Same ledger key space as races; a
 * bestof session only produces series so idx never collides within it.
 */
async function materializeSeries(
  groupId: string,
  eventId: string,
  gameId: string,
  series: Series,
  bestOf: SeriesBestOf,
  roster: SmashPlayer[],
  sessionKey: string,
  linkMap?: Map<string, string>, // guest display name -> member userId (backfill)
): Promise<{ recorded: number; guests: number }> {
  if (!series.winnerId) return { recorded: 0, guests: 0 };

  const tally = seriesGameTally(series);
  const loserId = series.winnerId === series.aId ? series.bId : series.aId;
  const charOf = new Map(roster.map((p) => [p.id, p.character ?? null]));
  const lines: LedgerLine[] = [series.winnerId, loserId].map((slotId) => {
    const g = tally.get(slotId) ?? { wins: 0, played: 0 };
    return {
      playerId: slotId,
      placement: slotId === series.winnerId ? 1 : 2,
      isWinner: slotId === series.winnerId,
      character: charOf.get(slotId) ?? null,
      meta: { gameWins: g.wins, gamesPlayed: g.played },
    };
  });

  return rt.materializeUnit({
    groupId,
    eventId,
    gameId,
    idx: series.idx,
    sessionKey,
    label: `bo${bestOf}`,
    format: "bestof",
    roster,
    lines,
    linkMap,
  });
}

/** Per-player best-of standings with names, for the live page + TV. */
function seriesStandings(state: MkSessionState) {
  const nameOf = new Map(state.roster.map((p) => [p.id, p.name]));
  return [...summarizeSeriesLog(state.seriesLog ?? []).values()]
    .filter((s) => s.seriesPlayed > 0)
    .map((s) => ({ ...s, name: nameOf.get(s.slotId) ?? "?" }))
    .sort((a, b) => b.seriesWins - a.seriesWins || b.gameWins - a.gameWins || b.seriesPlayed - a.seriesPlayed);
}

// ---------- guest -> member backfill (see guest-link.ts) ----------

/** Distinct guest display names across this crew's Mario Kart sessions. */
export async function guestNamesMarioKart(groupId: string): Promise<string[]> {
  return rt.guestNames(groupId, (state) => state.roster);
}

/** Credit (or preview) every recoverable Mario Kart result the guest played. */
export async function creditGuestMarioKart(
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
    const raceLabel = state.format === "grandprix" ? "Grand Prix race" : state.format === "koth" ? "King of the Hill" : "Race";

    for (const g of state.games ?? []) {
      const line = g.lines.find((l) => guestSlots.has(l.playerId));
      if (!line) continue;
      if (credited.has(rt.ledgerKey(eventId, state.sessionKey, g.idx))) continue;
      items.push({
        pack: "mario_kart",
        packLabel: "Mario Kart",
        eventId,
        label: raceLabel,
        date: g.at ?? null,
        placement: line.placement,
        isWinner: line.isWinner,
      });
    }
    for (const ser of state.seriesLog ?? []) {
      if (!ser.winnerId || !(guestSlots.has(ser.aId) || guestSlots.has(ser.bId))) continue;
      if (credited.has(rt.ledgerKey(eventId, state.sessionKey, ser.idx))) continue;
      const won = guestSlots.has(ser.winnerId);
      items.push({
        pack: "mario_kart",
        packLabel: "Mario Kart",
        eventId,
        label: `Best of ${state.bestOf}`,
        date: ser.at ?? null,
        placement: won ? 1 : 2,
        isWinner: won,
      });
    }

    if (!dryRun) {
      gameId = gameId ?? (await rt.ensureGame(groupId));
      for (const g of state.games ?? []) {
        if (g.lines.some((l) => guestSlots.has(l.playerId))) {
          // label is only used when a match is created; a backfill reuses the
          // existing row, so null here never reaches the ledger.
          await materializeGame(groupId, eventId, gameId, g, state.roster, state.sessionKey, null, state.format, linkMap);
        }
      }
      for (const ser of state.seriesLog ?? []) {
        if (ser.winnerId && (guestSlots.has(ser.aId) || guestSlots.has(ser.bId))) {
          await materializeSeries(groupId, eventId, gameId, ser, state.bestOf, state.roster, state.sessionKey, linkMap);
        }
      }
    }
  }
  return { items, written: dryRun ? 0 : items.length };
}

// ---------- launch context ----------

marioKartRouter.get("/mariokart-context/:eventId", requireAuth, async (req: AuthedRequest, res) => {
  const ctx = await rt.launchContext(String(req.params.eventId), req.user!.id);
  if (!ctx) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(ctx);
});

// ---------- read live state ----------

marioKartRouter.get("/mariokart/:eventId", requireAuth, async (req: AuthedRequest, res) => {
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
marioKartTvRouter.get("/mariokart/:eventId", async (req, res) => {
  await rt.respondState(String(req.params.eventId), res);
});

// ---------- host: start / configure ----------

marioKartRouter.post("/events/:eventId/mariokart", requireAuth, async (req: AuthedRequest, res) => {
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

  const rawFormat = req.body?.format;
  const format: MkFormat =
    rawFormat === "free" || rawFormat === "grandprix" || rawFormat === "bestof" || rawFormat === "koth"
      ? rawFormat
      : "free";
  const bestOf: SeriesBestOf = [3, 5, 7].includes(Number(req.body?.bestOf))
    ? (Number(req.body.bestOf) as SeriesBestOf)
    : 3;
  const raceCount = Number(req.body?.raceCount) || 4;
  const assignment = req.body?.assignment;
  const resultDetail = (req.body?.resultDetail ?? "winner") as SmashResultDetail;
  if (!["self", "random", "host"].includes(assignment)) {
    res.status(400).json({ error: "invalid assignment" });
    return;
  }

  // Don't clobber a session already in progress (standing rule 8) unless the
  // host confirmed a replace (client resends force after a 409). In progress =
  // has recorded races (free/gp/koth) or series (bestof).
  const existing = await rt.loadState(eventId);
  const inProgress =
    !!existing &&
    existing.row.status !== "completed" &&
    (existing.state.games.length > 0 || (existing.state.seriesLog?.length ?? 0) > 0);
  if (!req.body?.force && inProgress) {
    res.status(409).json({ error: "A session is already in progress for this event" });
    return;
  }

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
        character: isRacer(p?.character) ? p.character : null,
      };
    })
    .filter((p: SmashPlayer) => p.name.length > 0)
    .slice(0, 16);

  if (roster.length < 2) {
    res.status(400).json({ error: "Add at least 2 players" });
    return;
  }

  const titleId = MARIO_KART_TITLES.some((t) => t.id === req.body?.titleId)
    ? String(req.body.titleId)
    : MARIO_KART_TITLES[0]!.id;
  const pool = rosterForTitle(MARIO_KART_TITLES, titleId);

  let state = newMkKartState({ format, titleId, assignment, resultDetail, roster, bestOf, raceCount });
  if (assignment === "random") state.roster = assignRandomFighters(state.roster, pool);

  res.json(await rt.startSession(eventId, event.groupId, state, req.get("x-gn-client")));
});

// ---------- assignment ----------

marioKartRouter.post("/mariokart/:eventId/character", requireAuth, async (req: AuthedRequest, res) => {
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
  const titlePool = rosterForTitle(MARIO_KART_TITLES, loaded.state.titleId);
  if (character !== null && !titlePool.includes(character)) {
    res.status(400).json({ error: "That racer isn't in this game" });
    return;
  }
  const slot = loaded.state.roster.find((p) => p.id === playerId);
  if (!slot) {
    res.status(404).json({ error: "Player not in session" });
    return;
  }
  const owns = slot.userId && slot.userId === req.user!.id;
  if (!isHostRole(role) && !owns) {
    res.status(403).json({ error: "You can only set your own racer" });
    return;
  }
  if (!isHostRole(role) && loaded.state.assignment !== "self") {
    res.status(403).json({ error: "The host is assigning racers this session" });
    return;
  }
  slot.character = character ?? null;
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

marioKartRouter.post("/mariokart/:eventId/randomize", requireAuth, async (req: AuthedRequest, res) => {
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
    rosterForTitle(MARIO_KART_TITLES, loaded.state.titleId),
  );
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

// ---------- record a race ----------

marioKartRouter.post("/mariokart/:eventId/record", requireAuth, async (req: AuthedRequest, res) => {
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

  const origin = req.get("x-gn-client");

  // Best Of: record one game into the current 1v1 series; the series (not the
  // game) is the ledger unit, materializing when the set is won.
  if (state.format === "bestof") {
    if (!state.series) {
      res.status(409).json({ error: "Pick two players and start a set first" });
      return;
    }
    const winnerId = String(req.body?.winnerId ?? "");
    if (winnerId !== state.series.aId && winnerId !== state.series.bId) {
      res.status(400).json({ error: "Winner must be one of the two playing" });
      return;
    }
    const { completed } = recordSeriesGame(state.series, state.bestOf, winnerId);
    let report: { recorded: number; guests: number } | null = null;
    if (completed) {
      const done = state.series;
      done.idx = state.seriesLog.length;
      state.seriesLog.push(done);
      state.series = null;
      const gameId = await rt.ensureGame(row.groupId);
      report = await materializeSeries(row.groupId, eventId, gameId, done, state.bestOf, state.roster, state.sessionKey);
    }
    const view = await rt.saveState(loaded, "live", origin);
    if (completed) broadcast({ type: "leaderboard_updated", eventId }, origin);
    res.json({ ...view, ...(report ?? {}) });
    return;
  }

  const charOf = new Map(state.roster.map((p) => [p.id, p.character]));
  let lines: SmashResultLine[];
  let label: string | null = null;

  if (state.format === "koth") {
    // Winner stays on; the pair comes from state. One tap on the winner.
    const koth = state.koth!;
    const pair = koth.kingId && koth.queue[0] ? [koth.kingId, koth.queue[0]] : null;
    if (!pair) {
      res.status(400).json({ error: "Not enough players queued" });
      return;
    }
    const winnerId = String(req.body?.winnerId ?? "");
    if (!pair.includes(winnerId)) {
      res.status(400).json({ error: "Winner must be one of the two playing" });
      return;
    }
    const loserId = pair.find((id) => id !== winnerId)!;
    lines = [
      { playerId: winnerId, character: charOf.get(winnerId) ?? null, placement: 1, isWinner: true },
      { playerId: loserId, character: charOf.get(loserId) ?? null, placement: 2, isWinner: false },
    ];
    state.koth = kothAdvance(koth, winnerId, loserId);
  } else {
    // Free Play or Grand Prix: an FFA race with placements. Grand Prix tags
    // each race with its cup id (derived by chunking); cups advance
    // automatically every raceCount races.
    if (state.format === "grandprix") {
      label = `gp${cupNoForRace(state.games.length, state.grandPrix.raceCount)}`;
    }
    const slotIds = new Set(state.roster.map((p) => p.id));
    const raw = Array.isArray(req.body?.lines) ? req.body.lines : [];
    lines = raw
      .filter((l: any) => slotIds.has(String(l?.playerId)))
      .map((l: any) => ({
        playerId: String(l.playerId),
        character: isRacer(l?.character) ? l.character : (charOf.get(String(l.playerId)) ?? null),
        placement: Number(l?.placement) || 0,
        isWinner: !!l?.isWinner,
      }));
    if (state.resultDetail === "winner") {
      for (const l of lines) l.placement = l.isWinner ? 1 : 2;
    } else {
      for (const l of lines) l.isWinner = l.placement === 1;
    }
    const err = validateFfa(lines, state.resultDetail);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
  }

  const game: SmashGame = {
    idx: state.games.length,
    mode: state.mode,
    lines,
    at: new Date().toISOString(),
  };
  state.games.push(game);

  const gameId = await rt.ensureGame(row.groupId);
  const report = await materializeGame(row.groupId, eventId, gameId, game, state.roster, state.sessionKey, label, state.format);

  const view = await rt.saveState(loaded, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json({ ...view, ...report });
});

// ---------- best of: start the next set (host picks two players) ----------

marioKartRouter.post("/mariokart/:eventId/start-series", requireAuth, async (req: AuthedRequest, res) => {
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
    res.status(403).json({ error: "Only the host starts sets (open scoring is off)" });
    return;
  }
  if (state.format !== "bestof") {
    res.status(400).json({ error: "Not a Best Of session" });
    return;
  }
  if (state.series && state.series.games.length > 0) {
    res.status(409).json({ error: "Finish the current set first" });
    return;
  }
  const ids = new Set(state.roster.map((p) => p.id));
  const aId = String(req.body?.aId ?? "");
  const bId = String(req.body?.bId ?? "");
  const s = newSeries(aId, bId);
  if (!ids.has(aId) || !ids.has(bId) || !s) {
    res.status(400).json({ error: "Pick two different players" });
    return;
  }
  state.series = s;
  res.json(await rt.saveState(loaded, "live", req.get("x-gn-client")));
});


marioKartRouter.post("/mariokart/:eventId/undo", requireAuth, async (req: AuthedRequest, res) => {
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
  const origin = req.get("x-gn-client");

  // Best Of: drop the last game of the in-progress set, or un-record the last
  // completed set (drop its ledger rows) and re-open it to replay.
  if (state.format === "bestof") {
    if (state.series && state.series.games.length > 0) {
      state.series.games.pop();
      res.json(await rt.saveState(loaded, "live", origin));
      return;
    }
    const lastSet = state.seriesLog.pop();
    if (!lastSet) {
      res.json({ ...rt.viewOf(loaded), empty: true });
      return;
    }
    await rt.deleteMaterialized(eventId, state.sessionKey, lastSet.idx);
    lastSet.winnerId = null;
    lastSet.at = null;
    lastSet.idx = -1;
    state.series = lastSet;
    const view = await rt.saveState(loaded, "live", origin);
    broadcast({ type: "leaderboard_updated", eventId }, origin);
    res.json(view);
    return;
  }

  const last = state.games.pop();
  if (!last) {
    res.json({ ...rt.viewOf(loaded), empty: true });
    return;
  }
  await rt.deleteMaterialized(eventId, state.sessionKey, last.idx);

  // KOTH: replay the throne from the opening order so it can't drift. Grand
  // Prix cups are derived from the games log, so undo needs no cup fixup.
  if (state.format === "koth") {
    let koth = {
      kingId: state.roster[0]?.id ?? null,
      queue: state.roster.slice(1).map((p) => p.id),
      streak: 0,
      bestStreak: null as { playerId: string; streak: number } | null,
    };
    for (const g of state.games) {
      const w = g.lines.find((l) => l.isWinner);
      const lo = g.lines.find((l) => !l.isWinner);
      if (w && lo) koth = kothAdvance(koth, w.playerId, lo.playerId);
    }
    state.koth = koth;
  }

  const view = await rt.saveState(loaded, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json(view);
});

marioKartRouter.post("/mariokart/:eventId/open-scoring", requireAuth, async (req: AuthedRequest, res) => {
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

marioKartRouter.post("/mariokart/:eventId/complete", requireAuth, async (req: AuthedRequest, res) => {
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
  const { state, row } = loaded;
  const origin = req.get("x-gn-client");
  // Best Of: finalize an in-progress set to the game leader so its games reach
  // the ledger (a dead tie stays unrecorded).
  let finalized = false;
  if (state.format === "bestof" && finalizeSeries(state.series)) {
    const done = state.series!;
    done.idx = state.seriesLog.length;
    state.seriesLog.push(done);
    state.series = null;
    const gameId = await rt.ensureGame(row.groupId);
    await materializeSeries(row.groupId, eventId, gameId, done, state.bestOf, state.roster, state.sessionKey);
    finalized = true;
  }
  const view = await rt.saveState(loaded, "completed", origin);
  if (finalized) broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json(view);
});

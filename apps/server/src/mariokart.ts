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
  isRacer,
  summarizeNight,
  isKartPairs,
  mkKothAdvance,
  mkKothPair,
  mkOrderFromPlacements,
  mkRaceLines,
  mkSeriesLines,
  mkSides,
  mkSidesAtIdx,
  reshuffleMkSides,
  undoMkRace,
  sideIdAt,
  sideLabel,
  shuffleIntoSides,
  singletonSides,
  truncateSideLog,
  validateMkRaceOrder,
  validateSides,
  newSeries,
  recordSeriesGame,
  finalizeSeries,
  summarizeSeriesLog,
  MARIO_KART_TITLES,
  rosterForTitle,
  type MkGame,
  type MkResultLine,
  type MkSessionState,
  type MkFormat,
  type Side,
  type SmashPlayer,
  type SmashResultDetail,
  type Series,
  type SeriesBestOf,
  SESSION_PACKS,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { createPackRuntime, packConfig, roleOf, isHostRole, type LedgerLine } from "./pack-runtime.js";
import { broadcast } from "./ws.js";
import { memberCreditedKeys, type GuestCreditResult } from "./guest-link-util.js";

/** This pack's registry entry, the one place its identifiers exist. */
const DEF = SESSION_PACKS.mariokart;

export const marioKartRouter = Router();
export const marioKartTvRouter = Router();

export const marioKartRuntime = createPackRuntime<MkSessionState>({
  ...packConfig("mariokart"),
  extras: (state) => ({
    // summarizeNight only reads roster + games, and MkResultLine is the Smash
    // line plus a `side`, so the cast is over a SUPERSET and MK's wider format
    // union is irrelevant to it.
    summary: summarizeNight(state as unknown as import("@gamenight/shared").SmashSessionState),
    cup: state.format === "grandprix" ? cupStandings(state) : null,
    seriesStandings: state.format === "bestof" ? seriesStandings(state) : [],
    // The arrangement of karts in force, flattened for the screen, plus the one
    // boolean every panel on it branches on. A solo night is karts of one and
    // `pairs` is false, which is what keeps its screens reading as they did.
    sides: mkSides(state),
    pairs: isKartPairs(state),
  }),
});

const rt = marioKartRuntime;

// ---------- ledger ----------

/** Materialize one recorded RACE (game-as-unit): a placement per racer. */
async function materializeGame(
  groupId: string,
  eventId: string,
  gameId: string,
  game: MkGame,
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
    // Which KART. Null on every row of a solo race, which is the same NULL the
    // column has held since this pack shipped: teams.ts sideIdFor owns the rule
    // and a race whose karts all hold one racer has no team structure. A
    // legacy race recorded before pairs existed has no `side` on its line at
    // all, hence the coalesce rather than a bare read.
    side: line.side ?? null,
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
  /** The arrangement of karts THIS set was raced under, not the current one. */
  sides: readonly Side[],
  linkMap?: Map<string, string>, // guest display name -> member userId (backfill)
): Promise<{ recorded: number; guests: number }> {
  if (!series.winnerId) return { recorded: 0, guests: 0 };

  const charOf = new Map(roster.map((p) => [p.id, p.character ?? null]));
  const lines: LedgerLine[] = mkSeriesLines(series, sides, (id) => charOf.get(id) ?? null);
  if (lines.length === 0) return { recorded: 0, guests: 0 };

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

/**
 * Per-KART best-of standings with names, for the live page + TV.
 *
 * `summarizeSeriesLog` keys on whatever ids the series carried, and those are
 * kart ids now, so a row is a kart. The label comes from the kart's MEMBERS, so
 * a solo night reads exactly as it did (a kart of one is labelled with that
 * racer's name) and a pairs night reads "Ann + Ben". The field is still called
 * `slotId` because that is what the primitive calls it and the client keys on
 * it; the client never renders it.
 */
function seriesStandings(state: MkSessionState) {
  const nameOf = new Map(state.roster.map((p) => [p.id, p.name]));
  const sides = mkSides(state);
  const label = (sideId: string) => {
    const side = sides.find((s) => s.id === sideId);
    return side ? sideLabel(side, (id) => nameOf.get(id)) : "?";
  };
  return [...summarizeSeriesLog(state.seriesLog ?? []).values()]
    .filter((s) => s.seriesPlayed > 0)
    .map((s) => ({ ...s, name: label(s.slotId) }))
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
        pack: DEF.ledger,
        packLabel: DEF.name,
        eventId,
        label: raceLabel,
        date: g.at ?? null,
        placement: line.placement,
        isWinner: line.isWinner,
      });
    }
    // A set is between two KARTS, so "did the guest play in it" is a question
    // about the kart's members under the arrangement THAT set was raced under,
    // not about a slot id sitting on the series. A legacy set still carrying
    // player ids answers the same way, because normalizeMkState has already
    // mapped it onto the kart holding that player.
    const guestInSide = (state2: MkSessionState, idx: number, sideId: string) =>
      mkSidesAtIdx(state2, idx).find((s) => s.id === sideId)?.memberIds.some((id) => guestSlots.has(id)) ?? false;

    for (const ser of state.seriesLog ?? []) {
      if (!ser.winnerId) continue;
      if (!guestInSide(state, ser.idx, ser.aId) && !guestInSide(state, ser.idx, ser.bId)) continue;
      if (credited.has(rt.ledgerKey(eventId, state.sessionKey, ser.idx))) continue;
      const won = guestInSide(state, ser.idx, ser.winnerId);
      items.push({
        pack: DEF.ledger,
        packLabel: DEF.name,
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
        if (ser.winnerId && (guestInSide(state, ser.idx, ser.aId) || guestInSide(state, ser.idx, ser.bId))) {
          await materializeSeries(
            groupId,
            eventId,
            gameId,
            ser,
            state.bestOf,
            state.roster,
            state.sessionKey,
            mkSidesAtIdx(state, ser.idx),
            linkMap,
          );
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

  // KARTS AT SETUP. The client expresses them as ROSTER INDICES, because slot
  // ids are minted here and it has never seen them: `sides: [[0,1],[2,3]]` is
  // "Ann and Ben share a kart, Cal and Dee share the other". Absent means one
  // kart per racer, which is a solo night and exactly what every client sent
  // before this existed. Same wire shape as Ping Pong's, deliberately: two
  // packs with one setup screen between them should not need two spellings.
  const rawSides = Array.isArray(req.body?.sides) ? req.body.sides : null;
  let sides: Side[];
  if (rawSides) {
    sides = rawSides.map((members: unknown, i: number): Side => ({
      id: sideIdAt(i),
      name: `Kart ${String.fromCharCode(65 + i)}`,
      memberIds: (Array.isArray(members) ? members : [])
        .map((n: unknown) => roster[Number(n)]?.id)
        .filter((id: string | undefined): id is string => !!id),
    }));
    const check = validateSides(sides);
    if (check.error) {
      res.status(400).json({ error: check.error });
      return;
    }
    // Anybody the host left out of a kart is not racing, and a roster slot in
    // no kart would be invisible to every screen. Reject rather than guess.
    const placed = new Set(sides.flatMap((x) => x.memberIds));
    if (placed.size !== roster.length) {
      res.status(400).json({ error: "Every racer has to be in a kart" });
      return;
    }
  } else if (Number(req.body?.sideCount) >= 2) {
    sides = shuffleIntoSides(roster.map((p) => p.id), Number(req.body.sideCount));
  } else {
    sides = singletonSides(roster.map((p) => p.id));
  }

  let state = newMkKartState({ format, titleId, assignment, resultDetail, roster, bestOf, raceCount, sides });
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
      res.status(409).json({ error: "Pick two karts and start a set first" });
      return;
    }
    // The client sends a KART id. On a solo night that is the kart holding the
    // one racer, so the tap is unchanged from the outside.
    const winnerId = String(req.body?.winnerSideId ?? "");
    if (winnerId !== state.series.aId && winnerId !== state.series.bId) {
      res.status(400).json({ error: "Winner must be one of the two karts racing" });
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
      report = await materializeSeries(
        row.groupId,
        eventId,
        gameId,
        done,
        state.bestOf,
        state.roster,
        state.sessionKey,
        mkSidesAtIdx(state, done.idx),
      );
    }
    const view = await rt.saveState(loaded, "live", origin);
    if (completed) broadcast({ type: "leaderboard_updated", eventId }, origin);
    res.json({ ...view, ...(report ?? {}) });
    return;
  }

  // A race is a tapped finish order of KARTS, and the placement rule lives in
  // the primitive (teams.ts), so nothing here decides what a result means.
  const charOf = new Map(state.roster.map((p) => [p.id, p.character ?? null]));
  const racerOf = (playerId: string) => charOf.get(playerId) ?? null;
  const sides = mkSides(state);
  let lines: MkResultLine[];
  let label: string | null = null;

  if (state.format === "koth") {
    // Winning kart holds the table; the two racing come from state. One tap.
    const koth = state.koth!;
    const pair = mkKothPair(state);
    if (!pair) {
      res.status(400).json({ error: "Not enough karts queued" });
      return;
    }
    const { king, challenger } = pair;
    const winnerSideId = String(req.body?.winnerSideId ?? "");
    if (winnerSideId !== king.id && winnerSideId !== challenger.id) {
      res.status(400).json({ error: "Winner must be one of the two karts racing" });
      return;
    }
    const winner = winnerSideId === king.id ? king : challenger;
    const loser = winnerSideId === king.id ? challenger : king;
    // Two karts, so the order IS the result and the detail setting cannot
    // change it: one kart finished first and one finished second.
    lines = mkRaceLines([winner.id, loser.id], sides, "placement", racerOf);
    state.koth = mkKothAdvance(koth, winner, loser);
  } else {
    // Free Play or Grand Prix: a race with a finish order. Grand Prix tags each
    // race with its cup id (derived by chunking); cups advance automatically
    // every raceCount races.
    if (state.format === "grandprix") {
      label = `gp${cupNoForRace(state.games.length, state.grandPrix.raceCount)}`;
    }
    // `sides` is the kart order a pairs screen taps. `lines` is the per-racer
    // form a solo screen has always sent, and it is TRANSLATED rather than
    // refused: on a solo night a kart holds one racer, so the two spellings
    // carry the same information and the older one keeps working.
    const rawOrder = Array.isArray(req.body?.sides) ? req.body.sides.map((s: unknown) => String(s)) : null;
    const order =
      rawOrder ??
      mkOrderFromPlacements(
        (Array.isArray(req.body?.lines) ? req.body.lines : []).map((l: any) => ({
          playerId: String(l?.playerId ?? ""),
          placement: Number(l?.placement) || 0,
        })),
        sides,
      );
    const err = validateMkRaceOrder(order, sides);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
    lines = mkRaceLines(order, sides, state.resultDetail, racerOf);
  }

  const game: MkGame = {
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
  // Two KARTS, not two players. `series.ts` is generic over opaque slot ids, so
  // this is a change of what the ids mean and not a change to the primitive.
  const ids = new Set(mkSides(state).map((s) => s.id));
  const aId = String(req.body?.aId ?? "");
  const bId = String(req.body?.bId ?? "");
  const s = newSeries(aId, bId);
  if (!ids.has(aId) || !ids.has(bId) || !s) {
    res.status(400).json({ error: "Pick two different karts" });
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
    // Undoing back PAST a reshuffle restores the arrangement of karts that was
    // in force before it. Without this the set being re-opened would be raced
    // by karts that did not exist when it was raced the first time.
    truncateSideLog(state.sideSets, state.seriesLog.length);
    const view = await rt.saveState(loaded, "live", origin);
    broadcast({ type: "leaderboard_updated", eventId }, origin);
    res.json(view);
    return;
  }

  // Popping the race, restoring the arrangement of karts it was raced under,
  // and replaying the throne so it cannot drift, in that order and for the
  // reason spelled out on undoMkRace. Grand Prix cups are derived from the
  // games log, so undo needs no cup fixup.
  const { unmaterializeIdx } = undoMkRace(state);
  if (unmaterializeIdx === null) {
    res.json({ ...rt.viewOf(loaded), empty: true });
    return;
  }
  await rt.deleteMaterialized(eventId, state.sessionKey, unmaterializeIdx);

  const view = await rt.saveState(loaded, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json(view);
});

// ---------- host: rearrange the karts mid-night ----------
//
// Karts are FIXED for the night by default, with an explicit host action to
// change them. Races already recorded keep the `side` written on their lines,
// so the night's history stays true; in King of the Hill the ladder restarts,
// because a queue of karts that no longer exist is not a queue.

marioKartRouter.post("/mariokart/:eventId/sides", requireAuth, async (req: AuthedRequest, res) => {
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
  // Here the client HAS seen the roster, so karts come as slot ids.
  const ids = loaded.state.roster.map((p) => p.id);
  const known = new Set(ids);
  const rawSides = Array.isArray(req.body?.sides) ? req.body.sides : null;
  const sides: Side[] = rawSides
    ? rawSides.map((s: any, i: number): Side => ({
        id: sideIdAt(i),
        name: `Kart ${String.fromCharCode(65 + i)}`,
        memberIds: (Array.isArray(s?.memberIds) ? s.memberIds : [])
          .map((id: unknown) => String(id))
          .filter((id: string) => known.has(id)),
      }))
    : shuffleIntoSides(ids, Math.max(2, Number(req.body?.sideCount) || 2));

  const placed = new Set(sides.flatMap((x) => x.memberIds));
  if (placed.size !== ids.length) {
    res.status(400).json({ error: "Every racer has to be in a kart" });
    return;
  }
  const err = reshuffleMkSides(loaded.state, sides);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
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
    await materializeSeries(
      row.groupId,
      eventId,
      gameId,
      done,
      state.bestOf,
      state.roster,
      state.sessionKey,
      mkSidesAtIdx(state, done.idx),
    );
    finalized = true;
  }
  const view = await rt.saveState(loaded, "completed", origin);
  if (finalized) broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json(view);
});

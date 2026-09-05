// Smash pack server routes (Session A: FFA Night + King of the Hill).
//
// The live session is one server-side row per event (smash_sessions),
// so every member joins the HOST's session instead of a local copy
// (standing rule 2). Each completed game materializes into
// matches/match_participants with the fighter recorded on each
// participant, so lifetime "wins with <fighter>" survives the night
// (standing rule 5). Live sync rides the shared WebSocket hub: every
// write calls broadcast(), nobody refreshes (standing rule 6).
//
// Two routers are exported: smashRouter (authed, per-route) for play, and
// smashTvRouter (public, read-only) for the big screen. The TV router
// MUST mount before the bare /api authed routers (standing environment
// rule: router-level auth 401s before fall-through).

import { Router } from "express";
import { getDb, events, games, matches, matchParticipants, users, and, eq } from "@gamenight/db";
import {
  newSmashState,
  assignRandomFighters,
  SMASH_TITLES,
  rosterForTitle,
  kothAdvance,
  kothNextPair,
  normalizeSmashState,
  openSmashKoth,
  isTeamBattle,
  defaultSideName,
  shuffleIntoSides,
  sideIdAt,
  singletonSides,
  validateSides,
  smashSides,
  smashBattleLines,
  smashOrderFromPlacements,
  validateSmashBattleOrder,
  sideOf,
  validateFfa,
  isFighter,
  summarizeNight,
  smashdownCap,
  smashdownStatus,
  burnedFrom,
  availableFighters,
  currentPicks,
  isSeriesSummary,
  SERIES_LABEL,
  newSeries,
  recordSeriesGame,
  finalizeSeries,
  seriesGameTally,
  summarizeSeriesLog,
  SESSION_PACKS,
  type SmashSessionState,
  type SmashPlayer,
  type SmashMode,
  type SmashFormat,
  type SmashAssignment,
  type SmashResultDetail,
  type SmashResultLine,
  type SmashGame,
  type Series,
  type SeriesBestOf,
  type Side,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";

/** This pack's registry entry, the one place its identifiers exist. */
const DEF = SESSION_PACKS.smash;
import { createPackRuntime, packConfig, roleOf, isHostRole, type LedgerLine } from "./pack-runtime.js";
import { broadcast } from "./ws.js";
import { memberCreditedKeys, type GuestCreditResult } from "./guest-link-util.js";

export const smashRouter = Router();
export const smashTvRouter = Router();

// Smash predates the shared game_sessions table and keeps smash_sessions,
// keyed by eventId alone. That is deliberate and stays: moving it would be a
// data migration, not a refactor.
export const smashRuntime = createPackRuntime<SmashSessionState>({
  ...packConfig("smash"),
  // Sessions written before sides existed load through this at the two points
  // where jsonb becomes state, so a night already in progress when this deploys
  // keeps working and the guest backfill can still read finished ones. Smash
  // had no normalize hook at all until 2026-09-05, which is the whole reason
  // this line is called out: the pack did not need one before it had a second
  // state shape.
  normalize: normalizeSmashState,
  extras: (state) => ({
    summary: summarizeNight(state),
    // The arrangement of sides in force, flattened for the screen, plus the one
    // boolean every panel on it branches on. A solo night is sides of one and
    // `teamPlay` is false, which is what keeps its screens reading as they did.
    sides: smashSides(state),
    teamPlay: isTeamBattle(state),
    seriesStandings: state.format === "bestof" ? seriesStandings(state) : [],
    // The burn board, standings, remaining battles and whether the series is
    // over, derived server-side so the pack page, the TV and this file cannot
    // reach three different answers about who won.
    smashdown: state.format === "smashdown" ? smashdownStatus(state) : null,
  }),
});

const rt = smashRuntime;

// ---------- ledger ----------

/**
 * Materialize one recorded GAME (game-as-unit): one match_participants row
 * per member with placement, winner flag, and the fighter played, so lifetime
 * "wins with <fighter>" survives the night.
 */
async function materializeGame(
  groupId: string,
  eventId: string,
  gameId: string,
  game: SmashGame,
  roster: SmashPlayer[],
  sessionKey: string,
  format: SmashFormat,
  linkMap?: Map<string, string>, // guest display name -> member userId (backfill)
): Promise<{ recorded: number; guests: number }> {
  // `side` goes straight through. It is null on every line a solo night writes,
  // which is the same NULL the column has always held for this pack, and it is
  // the side id on a team battle. Nothing else in the ledger path moves: same
  // format string, same label, same key prefix.
  const lines: LedgerLine[] = game.lines.map((line) => ({
    playerId: line.playerId,
    placement: line.placement,
    isWinner: line.isWinner,
    character: line.character ?? null,
    side: line.side ?? null,
  }));

  return rt.materializeUnit({
    groupId,
    eventId,
    gameId,
    idx: game.idx,
    sessionKey,
    format,
    roster,
    lines,
    linkMap,
  });
}

/**
 * Materialize one completed best-of SERIES (match-as-unit, like Ping Pong):
 * one matches row labeled bo{N}, winner placement 1 / loser 2, each player's
 * fighter on character, per-player game wins/played in meta. Shares the same
 * sessionKey-namespaced ledger key space as games; a bestof session only
 * produces series (no games) so idx never collides within it.
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

/** The externalKey tail for the series row: a literal, never a battle index. */
const SERIES_KEY_UNIT = "series";

/**
 * Make the ledger's Smashdown SERIES row match reality, whatever just changed.
 *
 * RECONCILE, NEVER PATCH. `over` can flip in three different places: the
 * battle that completes the count, an undo that takes it back, and the mercy
 * toggle, which can end a series without anything being played. A "write
 * it when the last battle lands" rule silently misses two of them. So every
 * one of those routes calls this, and it asks one question: does the ledger
 * agree with smashdownStatus right now? Both halves are idempotent
 * (materializeUnit no-ops on an existing row, deleteMaterialized no-ops on a
 * missing one), so calling it twice, or on a format that is not Smashdown,
 * costs a lookup and changes nothing.
 *
 * The row is a SUMMARY of battles already in the ledger, not a replacement for
 * them, which is why it carries label SERIES_LABEL and why everything that
 * counts games has to skip that label (see the shared constant). Character is
 * left null: a series is not played with one fighter, that is the format.
 * Co-winners are real here, so every tied leader gets placement 1.
 *
 * An ABANDONED series writes nothing. The host ending a format early leaves
 * `over` false, and unlike a Best Of set (where abandoning would lose the
 * games inside it, which is why that one finalizes), every Smashdown battle is
 * already recorded, so there is nothing to rescue and no honest winner to name.
 */
async function syncSeriesRow(
  groupId: string,
  eventId: string,
  state: SmashSessionState,
  linkMap?: Map<string, string>, // guest display name -> member userId (backfill)
): Promise<void> {
  if (state.format !== "smashdown") return;
  const status = smashdownStatus(state);
  if (!status.over) {
    // A backfill only ever ADDS a participant to a row that already exists, so
    // it must never reach the retract branch: passing a link map means "credit
    // this person", not "re-decide whether this series happened".
    if (!linkMap) await rt.deleteMaterialized(eventId, state.sessionKey, SERIES_KEY_UNIT);
    return;
  }
  const winners = new Set(status.winnerIds);
  const gameId = await rt.ensureGame(groupId);
  await rt.materializeUnit({
    groupId,
    eventId,
    gameId,
    // Sorts immediately after the last battle of the night it summarizes.
    idx: state.games.length,
    keyUnit: SERIES_KEY_UNIT,
    sessionKey: state.sessionKey,
    label: SERIES_LABEL,
    format: "smashdown",
    roster: state.roster,
    lines: status.standings.map((s) => ({
      playerId: s.playerId,
      placement: s.placement,
      isWinner: winners.has(s.playerId),
      character: null,
      meta: { battleWins: s.wins, battles: status.battlesPlayed },
    })),
    linkMap,
  });
}


/** Per-player best-of standings with names, for the live page + TV. */
function seriesStandings(state: SmashSessionState) {
  const nameOf = new Map(state.roster.map((p) => [p.id, p.name]));
  return [...summarizeSeriesLog(state.seriesLog ?? []).values()]
    .filter((s) => s.seriesPlayed > 0)
    .map((s) => ({ ...s, name: nameOf.get(s.slotId) ?? "?" }))
    .sort((a, b) => b.seriesWins - a.seriesWins || b.gameWins - a.gameWins || b.seriesPlayed - a.seriesPlayed);
}

// ---------- guest -> member backfill (see guest-link.ts) ----------

/** Distinct guest display names across this crew's Smash sessions. */
export async function guestNamesSmash(groupId: string): Promise<string[]> {
  return rt.guestNames(groupId, (state) => state.roster);
}

/**
 * Credit (or, when dryRun, preview) every recoverable Smash result the guest
 * played to the member. Reuses the same materializers the live path uses; the
 * dry run reads the stored lines and skips units the member already has.
 */
export async function creditGuestSmash(
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
        // Format first: a Smashdown battle is stored with mode "ffa" (it runs
        // on the FFA engine), so reading the mode alone would preview every
        // burned-fighter battle as "Free For All".
        label:
          state.format === "smashdown"
            ? "Smashdown"
            : g.mode === "koth"
            ? "King of the Hill"
            : "Free For All",
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
        pack: DEF.ledger,
        packLabel: DEF.name,
        eventId,
        label: `Best of ${state.bestOf}`,
        date: ser.at ?? null,
        placement: won ? 1 : 2,
        isWinner: won,
      });
    }
    // A finished Smashdown SERIES the guest played in. Credited as its own
    // item because it is its own row: without this the linked member would
    // pick up every battle and none of the series wins those battles add up
    // to, which is the sort of half-credit the preview promise rules out.
    const sd = state.format === "smashdown" ? smashdownStatus(state) : null;
    if (sd?.over && !credited.has(rt.ledgerKey(eventId, state.sessionKey, SERIES_KEY_UNIT))) {
      const stand = sd.standings.find((s) => guestSlots.has(s.playerId));
      if (stand) {
        items.push({
          pack: DEF.ledger,
          packLabel: DEF.name,
          eventId,
          label: `Smashdown series (${sd.battlesPlayed} battles)`,
          date: state.games[state.games.length - 1]?.at ?? null,
          placement: stand.placement,
          isWinner: sd.winnerIds.includes(stand.playerId),
        });
      }
    }

    if (!dryRun) {
      gameId = gameId ?? (await rt.ensureGame(groupId));
      for (const g of state.games ?? []) {
        if (g.lines.some((l) => guestSlots.has(l.playerId))) {
          await materializeGame(groupId, eventId, gameId, g, state.roster, state.sessionKey, state.format, linkMap);
        }
      }
      for (const ser of state.seriesLog ?? []) {
        if (ser.winnerId && (guestSlots.has(ser.aId) || guestSlots.has(ser.bId))) {
          await materializeSeries(groupId, eventId, gameId, ser, state.bestOf, state.roster, state.sessionKey, linkMap);
        }
      }
      // Additive: reuses the series row that already exists and inserts the
      // participant that was skipped when the guest had no identity.
      await syncSeriesRow(groupId, eventId, state, linkMap);
    }
  }
  return { items, written: dryRun ? 0 : items.length };
}

// ---------- launch context ----------

smashRouter.get("/smash-context/:eventId", requireAuth, async (req: AuthedRequest, res) => {
  const ctx = await rt.launchContext(String(req.params.eventId), req.user!.id);
  if (!ctx) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(ctx);
});

// ---------- read live state ----------

smashRouter.get("/smash/:eventId", requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (loaded && !(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Reuse the row the role check just read instead of selecting it twice.
  await rt.respondState(eventId, res, loaded);
});

// Public big-screen read. Event UUID is the access key, same model as the
// bracket TV view. Mounted before authed routers so it is reachable
// without a session.
smashTvRouter.get("/smash/:eventId", async (req, res) => {
  await rt.respondState(String(req.params.eventId), res);
});

// ---------- host: start / configure ----------

smashRouter.post("/events/:eventId/smash", requireAuth, async (req: AuthedRequest, res) => {
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

  // New clients send an explicit format; older ones send mode. bestof is a
  // 1v1 series (mode is ffa under the hood, the series path drives it).
  const rawFormat = req.body?.format;
  let format: SmashFormat;
  let mode: SmashMode;
  if (rawFormat === "ffa" || rawFormat === "koth" || rawFormat === "bestof" || rawFormat === "smashdown") {
    format = rawFormat;
    // Smashdown runs on the FFA engine (a battle is an FFA game the whole
    // roster plays), so it is 1v1 and 2-8 player series through one path.
    mode = format === "koth" ? "koth" : "ffa";
  } else {
    mode = req.body?.mode as SmashMode;
    if (mode !== "ffa" && mode !== "koth") {
      res.status(400).json({ error: "format must be ffa, koth, bestof, or smashdown" });
      return;
    }
    format = mode;
  }
  const bestOf: SeriesBestOf = [3, 5, 7].includes(Number(req.body?.bestOf))
    ? (Number(req.body.bestOf) as SeriesBestOf)
    : 3;
  const assignment = req.body?.assignment as SmashAssignment;
  const resultDetail = (req.body?.resultDetail ?? "winner") as SmashResultDetail;
  if (!["self", "random", "host"].includes(assignment)) {
    res.status(400).json({ error: "invalid assignment" });
    return;
  }

  // Don't clobber a session already in progress (standing rule 8) unless the
  // host confirmed a replace (client resends force after a 409). A session is
  // "in progress" if it has recorded games (ffa/koth) or series (bestof).
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
        character: isFighter(p?.character) ? p.character : null,
      };
    })
    .filter((p: SmashPlayer) => p.name.length > 0)
    .slice(0, 16);

  if (roster.length < 2) {
    res.status(400).json({ error: "Add at least 2 players" });
    return;
  }
  // Every player is in every Smashdown battle (that is what makes the cap
  // arithmetic true), and a battle is an FFA game, which validateFfa caps at
  // eight. So the roster IS the battle, and it is capped at eight here rather
  // than silently producing a series nobody can record.
  if (format === "smashdown" && roster.length > 8) {
    res.status(400).json({ error: "Smashdown is capped at 8 players (everyone plays every battle)" });
    return;
  }

  const titleId = SMASH_TITLES.some((t) => t.id === req.body?.titleId)
    ? String(req.body.titleId)
    : SMASH_TITLES[0]!.id;
  const pool = rosterForTitle(SMASH_TITLES, titleId);

  // Smashdown: the battle count is fixed at the start and can never exceed
  // what the chosen title's roster can feed. Clamped rather than rejected, so
  // a host who typed 10 for a four-player Smash 64 series gets the three
  // battles that are actually possible instead of a validation error.
  let battleCount = 0;
  if (format === "smashdown") {
    const cap = smashdownCap(pool.length, roster.length);
    if (cap < 1) {
      const title = SMASH_TITLES.find((t) => t.id === titleId)!;
      res.status(400).json({
        error: `${title.name} only has ${pool.length} fighters, which is not enough for ${roster.length} players to play a battle`,
      });
      return;
    }
    battleCount = Math.min(Math.max(Math.floor(Number(req.body?.battleCount) || 1), 1), cap);
  }
  const mercy = format === "smashdown" && !!req.body?.mercy;

  // SIDES AT SETUP. The client expresses them as ROSTER INDICES, because slot
  // ids are minted here and it has never seen them: `sides: [[0,1],[2,3]]` is
  // "p0 and p1 against p2 and p3". Absent means one side per player, which is a
  // solo night and exactly what every client sent before sides existed.
  //
  // `sideCount` with no `sides` is the random deal, done server-side so the
  // arrangement everybody sees is the one that was actually stored.
  const rawSides = Array.isArray(req.body?.sides) ? req.body.sides : null;
  let sides: Side[];
  if (rawSides) {
    sides = rawSides.map((members: unknown, i: number): Side => ({
      id: sideIdAt(i),
      name: defaultSideName(i),
      memberIds: (Array.isArray(members) ? members : [])
        .map((n: unknown) => roster[Number(n)]?.id)
        .filter((id: string | undefined): id is string => !!id),
    }));
    const check = validateSides(sides);
    if (check.error) {
      res.status(400).json({ error: check.error });
      return;
    }
    // Anybody the host left off a side is not playing, and a roster slot with
    // no side would be invisible to every screen. Reject rather than guess.
    const placed = new Set(sides.flatMap((x) => x.memberIds));
    if (placed.size !== roster.length) {
      res.status(400).json({ error: "Every player has to be on a side" });
      return;
    }
  } else if (Number(req.body?.sideCount) >= 2) {
    sides = shuffleIntoSides(roster.map((p) => p.id), Number(req.body.sideCount));
  } else {
    sides = singletonSides(roster.map((p) => p.id));
  }

  let state = newSmashState({
    format, titleId, mode, assignment, resultDetail, roster, bestOf, battleCount, mercy, sides,
  });
  if (assignment === "random") state.roster = assignRandomFighters(state.roster, pool);

  res.json(await rt.startSession(eventId, event.groupId, state, req.get("x-gn-client")));
});

// ---------- assignment ----------

// Set one player's fighter. Self-select: a member sets THEIR OWN slot.
// Host may set any slot. Guests are always host-set.
smashRouter.post("/smash/:eventId/character", requireAuth, async (req: AuthedRequest, res) => {
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
  const titlePool = rosterForTitle(SMASH_TITLES, loaded.state.titleId);
  if (character !== null && !titlePool.includes(character)) {
    res.status(400).json({ error: "That fighter isn't in this game" });
    return;
  }
  const slot = loaded.state.roster.find((p) => p.id === playerId);
  if (!slot) {
    res.status(404).json({ error: "Player not in session" });
    return;
  }
  const owns = slot.userId && slot.userId === req.user!.id;
  if (!isHostRole(role) && !owns) {
    res.status(403).json({ error: "You can only set your own fighter" });
    return;
  }
  if (!isHostRole(role) && loaded.state.assignment !== "self") {
    res.status(403).json({ error: "The host is assigning fighters this session" });
    return;
  }
  // Smashdown: a fighter is gone once it has been used, and two players cannot
  // share one inside a battle. Checked here as well as on the client because
  // every assignment mode funnels through this route and the burn board is the
  // whole format: a burned pick slipping through would silently un-strike it.
  if (loaded.state.format === "smashdown" && character) {
    const left = availableFighters(
      titlePool,
      burnedFrom(loaded.state.games),
      currentPicks(loaded.state.roster, slot.id),
    );
    if (!left.includes(character)) {
      res.status(400).json({ error: `${character} is out of this series` });
      return;
    }
  }
  slot.character = character ?? null;
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

// Host re-rolls random fighters for everyone.
smashRouter.post("/smash/:eventId/randomize", requireAuth, async (req: AuthedRequest, res) => {
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
  // Smashdown re-rolls out of what is LEFT, never the whole title roster.
  // assignRandomFighters already keeps the picks distinct within one call, so
  // passing the available pool covers both exclusions the format needs.
  const pool = rosterForTitle(SMASH_TITLES, loaded.state.titleId);
  loaded.state.roster = assignRandomFighters(
    loaded.state.roster,
    loaded.state.format === "smashdown"
      ? availableFighters(pool, burnedFrom(loaded.state.games))
      : pool,
  );
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

// ---------- best of: start the next set (host picks two players) ----------

smashRouter.post("/smash/:eventId/start-series", requireAuth, async (req: AuthedRequest, res) => {
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
  if (!ids.has(aId) || !ids.has(bId) || aId === bId) {
    res.status(400).json({ error: "Pick two different players" });
    return;
  }
  const s = newSeries(aId, bId);
  if (!s) {
    res.status(400).json({ error: "Pick two different players" });
    return;
  }
  state.series = s;
  res.json(await rt.saveState(loaded, "live", req.get("x-gn-client")));
});

// ---------- record a game / round ----------

smashRouter.post("/smash/:eventId/record", requireAuth, async (req: AuthedRequest, res) => {
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

  // Best Of: record one game into the current 1v1 series. The series (not the
  // game) is the ledger unit, so it materializes only when the set is won.
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
    const origin = req.get("x-gn-client");
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

  const slotIds = new Set(state.roster.map((p) => p.id));
  const charOf = new Map(state.roster.map((p) => [p.id, p.character]));
  let lines: SmashResultLine[];

  // Smashdown: one battle, the WHOLE roster, every fighter struck out
  // afterwards. It borrows the FFA ledger unit (one battle = one matches row)
  // and adds three rules the other formats do not have: everybody plays,
  // everybody needs a fighter, and no fighter may be reused or shared.
  if (state.format === "smashdown") {
    const status = smashdownStatus(state);
    if (status.over) {
      res.status(409).json({ error: "This series is finished" });
      return;
    }
    const missing = state.roster.filter((p) => !p.character);
    if (missing.length > 0) {
      res.status(400).json({
        error: `Pick a fighter for ${missing.map((p) => p.name).join(", ")} first`,
      });
      return;
    }
    const burned = new Set(status.burned);
    const seen = new Set<string>();
    for (const p of state.roster) {
      const c = p.character!;
      if (burned.has(c)) {
        res.status(400).json({ error: `${c} has already been used this series` });
        return;
      }
      if (seen.has(c)) {
        res.status(400).json({ error: `Two players are both on ${c}` });
        return;
      }
      seen.add(c);
    }

    if (state.resultDetail === "placement") {
      const raw = Array.isArray(req.body?.lines) ? req.body.lines : [];
      const given = new Map<string, number>(
        raw
          .filter((l: any) => slotIds.has(String(l?.playerId)))
          .map((l: any): [string, number] => [String(l.playerId), Number(l?.placement) || 0]),
      );
      lines = state.roster.map((p) => ({
        playerId: p.id,
        character: p.character,
        placement: given.get(p.id) ?? 0,
        isWinner: (given.get(p.id) ?? 0) === 1,
        side: null,
      }));
    } else {
      const winnerId = String(req.body?.winnerId ?? "");
      if (!slotIds.has(winnerId)) {
        res.status(400).json({ error: "Tap the winner of the battle" });
        return;
      }
      lines = state.roster.map((p) => ({
        playerId: p.id,
        character: p.character,
        placement: p.id === winnerId ? 1 : 2,
        isWinner: p.id === winnerId,
        side: null,
      }));
    }
    const err = validateFfa(lines, state.resultDetail);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }

    const battle: SmashGame = {
      idx: state.games.length,
      mode: "ffa",
      lines,
      at: new Date().toISOString(),
    };
    state.games.push(battle);
    // One derivation, always from the log, so undo can only ever put back
    // exactly the fighters the undone battle took out.
    state.burned = burnedFrom(state.games);

    // Those fighters are gone, so nobody can still be holding one. Clearing is
    // what makes the next battle a fresh pick, and a random-assignment session
    // rolls the next set straight away out of what is left so the host does not
    // have to tap for it. Only while the series is still running: on the last
    // battle the picks stay put, so every screen can still show what the series
    // finished on, and an undo puts them back anyway.
    const after = smashdownStatus(state);
    if (!after.over) {
      for (const p of state.roster) p.character = null;
      if (state.assignment === "random") {
        const avail = availableFighters(rosterForTitle(SMASH_TITLES, state.titleId), state.burned);
        if (avail.length >= state.roster.length) {
          state.roster = assignRandomFighters(state.roster, avail);
        }
      }
    }

    // Safe after the reshuffle above: the ledger reads each fighter off the
    // BATTLE's lines, and the roster is only used to resolve a slot to a user.
    const gameId = await rt.ensureGame(row.groupId);
    const report = await materializeGame(
      row.groupId, eventId, gameId, battle, state.roster, state.sessionKey, state.format,
    );
    // Writes the series row if that battle ended the series; a no-op otherwise.
    await syncSeriesRow(row.groupId, eventId, state);
    const origin = req.get("x-gn-client");
    const view = await rt.saveState(loaded, "live", origin);
    broadcast({ type: "leaderboard_updated", eventId }, origin);
    res.json({ ...view, ...report });
    return;
  }

  if (state.mode === "koth") {
    // Round input is just the winner id; the pair is derived from state. The
    // throne is held by a SIDE now, so the two playing are resolved through the
    // arrangement in force. Every side holds exactly one player until the team
    // work lands, so the tapped player IS the side and this reads as it always
    // did; the side tap arrives with the team screens.
    const sides = smashSides(state);
    const pair = kothNextPair(state.koth, sides);
    if (!pair) {
      res.status(400).json({ error: "Not enough players queued" });
      return;
    }
    const winnerId = String(req.body?.winnerId ?? "");
    const tapped = sideOf(sides, winnerId);
    const winnerSide = tapped && (tapped.id === pair.king.id || tapped.id === pair.challenger.id) ? tapped : null;
    if (!winnerSide) {
      res.status(400).json({ error: "Winner must be one of the two playing" });
      return;
    }
    const loserSide = winnerSide.id === pair.king.id ? pair.challenger : pair.king;
    const loserId = loserSide.memberIds[0]!;
    lines = [
      { playerId: winnerId, character: charOf.get(winnerId) ?? null, placement: 1, isWinner: true, side: null },
      { playerId: loserId, character: charOf.get(loserId) ?? null, placement: 2, isWinner: false, side: null },
    ];
    state.koth = kothAdvance(state.koth!, winnerSide, loserSide);
  } else if (isTeamBattle(state) || Array.isArray(req.body?.sides)) {
    // FFA, TEAM BATTLE: a tapped finish order of SIDES. A SPLIT, not a boolean
    // threaded through the path below, because the two entry shapes are
    // genuinely different: one ranks sides and one ranks players. Mario Kart's
    // record route splits the same way.
    //
    // The side order is what a team screen taps. A client that has not been
    // updated still sends per-player placements, and on a night with sides in
    // force those carry the same information (each player is on exactly one
    // side), so they are TRANSLATED rather than refused.
    const sides = smashSides(state);
    const rawOrder = Array.isArray(req.body?.sides)
      ? req.body.sides.map((x: unknown) => String(x))
      : smashOrderFromPlacements(
          (Array.isArray(req.body?.lines) ? req.body.lines : []).map((l: any) => ({
            playerId: String(l?.playerId ?? ""),
            placement: Number(l?.placement) || 0,
          })),
          sides,
        );
    const err = validateSmashBattleOrder(rawOrder, sides);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
    lines = smashBattleLines(rawOrder, sides, state.resultDetail, (id) => charOf.get(id) ?? null);
  } else {
    // FFA, NO TEAM STRUCTURE: client sends the full line set. Untouched, so a
    // solo night writes exactly the rows it wrote before sides existed.
    const raw = Array.isArray(req.body?.lines) ? req.body.lines : [];
    lines = raw
      .filter((l: any) => slotIds.has(String(l?.playerId)))
      .map((l: any) => ({
        playerId: String(l.playerId),
        character: isFighter(l?.character) ? l.character : (charOf.get(String(l.playerId)) ?? null),
        placement: Number(l?.placement) || 0,
        isWinner: !!l?.isWinner,
        // Null by construction, not by choice: this branch only runs when no
        // side in force holds more than one player, which is exactly when
        // sideIdFor writes null. See teams.ts.
        side: null,
      }));
    if (state.resultDetail === "winner") {
      // Winner-only: everyone else is placement 2 (tied second), one winner.
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
  const report = await materializeGame(row.groupId, eventId, gameId, game, state.roster, state.sessionKey, state.format);

  const origin = req.get("x-gn-client");
  const view = await rt.saveState(loaded, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json({ ...view, ...report });
});

// Undo the last recorded game (host only): drop the ledger rows and replay
// KOTH state from scratch so the throne/queue can't drift.
smashRouter.post("/smash/:eventId/undo", requireAuth, async (req: AuthedRequest, res) => {
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

  // Best Of: drop the last game of the in-progress set, or if none, un-record
  // the last completed set (drop its ledger rows).
  if (state.format === "bestof") {
    const origin = req.get("x-gn-client");
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
    // Re-open the undone set so its games can be replayed, matching how the
    // KOTH undo leaves the state ready to continue.
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

  // Smashdown: unburn exactly the undone battle's fighters and hand them back
  // to the players who used them, so the battle can simply be replayed. The
  // burn board is re-derived from the remaining log rather than having the
  // fighters subtracted from it, which is the same reason KOTH replays its
  // throne below: a state that is recomputed cannot drift, and a state that is
  // patched eventually does.
  if (state.format === "smashdown") {
    state.burned = burnedFrom(state.games);
    const usedBy = new Map(last.lines.map((l) => [l.playerId, l.character]));
    for (const p of state.roster) p.character = usedBy.get(p.id) ?? null;
    // Undoing the battle that ended the series retracts the series row too,
    // so the ledger never claims a winner for a series that is live again.
    await syncSeriesRow(row.groupId, eventId, state);
  }

  if (state.mode === "koth") {
    // Rebuild from the opening throne by replaying the survivors. The winning
    // and losing SIDE are recovered from each round's lines through the
    // arrangement rather than read off them, because a solo night writes `side`
    // null on every line by design and the side is still perfectly well
    // defined: one player, one side.
    const sides = smashSides(state);
    let koth = openSmashKoth(sides);
    for (const g of state.games) {
      const w = g.lines.find((l) => l.isWinner);
      const lo = g.lines.find((l) => !l.isWinner);
      const winner: Side | undefined = w ? sideOf(sides, w.playerId) : undefined;
      const loser: Side | undefined = lo ? sideOf(sides, lo.playerId) : undefined;
      if (winner && loser && winner.id !== loser.id) koth = kothAdvance(koth, winner, loser);
    }
    state.koth = koth;
  }
  const origin = req.get("x-gn-client");
  const view = await rt.saveState(loaded, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json(view);
});

// Host toggles open scoring (members may record when on). Defaults off.
smashRouter.post("/smash/:eventId/open-scoring", requireAuth, async (req: AuthedRequest, res) => {
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

// Host toggles the Smashdown mercy rule mid-series. Defaults OFF at start:
// most crews want the battles they signed up for, and ending a night early is
// the surprising option, so it is opt-in and reversible rather than a setting
// buried at setup that nobody can change once the burn board is going.
smashRouter.post("/smash/:eventId/mercy", requireAuth, async (req: AuthedRequest, res) => {
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
  if (loaded.state.format !== "smashdown") {
    res.status(400).json({ error: "Not a Smashdown series" });
    return;
  }
  loaded.state.mercy = !!req.body?.on;
  // Turning mercy ON over an already-unbeatable lead ENDS the series, and
  // turning it back off resumes it, so the ledger has to follow the toggle.
  // This is the case a "write the row when the last battle lands" rule misses.
  const origin = req.get("x-gn-client");
  await syncSeriesRow(loaded.row.groupId, eventId, loaded.state);
  const view = await rt.saveState(loaded, loaded.row.status, origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json(view);
});

// Host ends the night.
smashRouter.post("/smash/:eventId/complete", requireAuth, async (req: AuthedRequest, res) => {
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
  // Best Of: an in-progress set would lose its games when the night ends;
  // finalize it to the game leader so those results reach the ledger (a dead
  // tie has no fair winner and stays unrecorded).
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
  // Smashdown: the last chance to reconcile. Nothing to do on a series that
  // already wrote its row, and nothing to write for one abandoned early, but
  // it is what catches a series that finished on a build that predates the
  // series row existing at all.
  if (state.format === "smashdown") {
    await syncSeriesRow(row.groupId, eventId, state);
    finalized = true;
  }
  const view = await rt.saveState(loaded, "completed", origin);
  if (finalized) broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json(view);
});

// ---------- lifetime character stats ----------
// The Smash-specific stat view: wins by fighter and each member's main,
// read from the materialized ledger (pack "smash"). Kept separate from the
// generic stats endpoint so the character focus doesn't bloat it.
smashRouter.get("/groups/:id/smash-stats", requireAuth, async (req: AuthedRequest, res) => {
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
    res.json({ games: 0, byCharacter: [], byPlayer: [] });
    return;
  }

  const rows = await db
    .select({
      userId: matchParticipants.userId,
      displayName: users.displayName,
      character: matchParticipants.character,
      isWinner: matchParticipants.isWinner,
      placement: matchParticipants.placement,
      matchId: matchParticipants.matchId,
      eventId: matches.eventId,
      position: matches.position,
      label: matches.label,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(users, eq(matchParticipants.userId, users.id))
    .where(and(eq(matches.groupId, groupId), eq(matches.gameId, game.id), eq(matches.status, "completed")));

  const chars = new Map<string, { character: string; played: number; wins: number }>();
  const players = new Map<
    string,
    {
      userId: string;
      name: string;
      played: number;
      wins: number;
      counts: Map<string, number>;
      /**
       * Distinct fighters this player has WON with. Derived from rows the
       * ledger already carries (character + isWinner), never a stored column:
       * Smashdown makes it the point of the format, since a fighter can only
       * be used once in a series, and it is a fair read of any Smash night.
       */
      wonWith: Set<string>;
      /** Smashdown series won / played, off the summary rows only. */
      seriesWins: number;
      seriesPlayed: number;
    }
  >();
  const matchIds = new Set<string>();

  // Series summary rows are split off BEFORE anything counts games. They
  // summarize battles that are already in this same result set, so leaving
  // them in would add a phantom game per series to every player, hand the
  // series winner an extra win, and put a null character through the fighter
  // tallies. They feed one thing: series won.
  const seriesRows = rows.filter((r) => isSeriesSummary(r.label));
  const gameRows = rows.filter((r) => !isSeriesSummary(r.label));

  for (const r of gameRows) {
    matchIds.add(r.matchId);
    if (r.character) {
      const c = chars.get(r.character) ?? { character: r.character, played: 0, wins: 0 };
      c.played++;
      if (r.isWinner) c.wins++;
      chars.set(r.character, c);
    }
    const p =
      players.get(r.userId) ??
      {
        userId: r.userId,
        name: r.displayName,
        played: 0,
        wins: 0,
        counts: new Map<string, number>(),
        wonWith: new Set<string>(),
        seriesWins: 0,
        seriesPlayed: 0,
      };
    p.played++;
    if (r.isWinner) p.wins++;
    if (r.character) {
      p.counts.set(r.character, (p.counts.get(r.character) ?? 0) + 1);
      if (r.isWinner) p.wonWith.add(r.character);
    }
    players.set(r.userId, p);
  }

  // Best win streak: longest run of consecutive wins within a single night,
  // ordering each player's games by position. This is the KOTH "king on a
  // roll" stat, and it reads sensibly for FFA too (games won in a row).
  const streakBest = new Map<string, number>();
  const byUserEvent = new Map<string, { position: number; isWinner: boolean }[]>();
  for (const r of gameRows) {
    const key = `${r.userId}|${r.eventId ?? ""}`;
    (byUserEvent.get(key) ?? byUserEvent.set(key, []).get(key)!).push({
      position: r.position ?? 0,
      isWinner: r.isWinner,
    });
  }
  for (const [key, list] of byUserEvent) {
    const userId = key.split("|")[0]!;
    list.sort((a, b) => a.position - b.position);
    let run = 0;
    let best = 0;
    for (const g of list) {
      run = g.isWinner ? run + 1 : 0;
      if (run > best) best = run;
    }
    streakBest.set(userId, Math.max(streakBest.get(userId) ?? 0, best));
  }

  // Series won: the one thing the summary rows are for. A player who has only
  // ever played FFA never appears here, so the stat hides itself rather than
  // showing a column of zeroes.
  for (const r of seriesRows) {
    const p = players.get(r.userId);
    if (!p) continue;
    p.seriesPlayed++;
    if (r.isWinner) p.seriesWins++;
  }

  // Head-to-head: for every match two members shared, the better placement
  // wins the meeting. Ties (equal placement, e.g. both non-winners in a
  // winner-only FFA) count as a meeting with no edge, so records stay honest.
  const byMatch = new Map<string, { userId: string; placement: number | null }[]>();
  for (const r of gameRows) {
    (byMatch.get(r.matchId) ?? byMatch.set(r.matchId, []).get(r.matchId)!).push({
      userId: r.userId,
      placement: r.placement,
    });
  }
  const nameOf = new Map([...players.values()].map((p) => [p.userId, p.name]));
  const h2h = new Map<string, { a: string; b: string; aWins: number; bWins: number; meetings: number }>();
  for (const parts of byMatch.values()) {
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const [x, y] = [parts[i]!, parts[j]!];
        const a = x.userId < y.userId ? x : y;
        const b = x.userId < y.userId ? y : x;
        const key = `${a.userId}|${b.userId}`;
        const rec = h2h.get(key) ?? { a: a.userId, b: b.userId, aWins: 0, bWins: 0, meetings: 0 };
        rec.meetings++;
        const ap = a.placement ?? 99;
        const bp = b.placement ?? 99;
        if (ap < bp) rec.aWins++;
        else if (bp < ap) rec.bWins++;
        h2h.set(key, rec);
      }
    }
  }

  const byPlayer = [...players.values()].map((p) => {
    let main: string | null = null;
    const variety = p.counts.size;
    let max = 0;
    for (const [c, n] of p.counts) if (n > max) ((max = n), (main = c));
    return {
      userId: p.userId,
      name: p.name,
      played: p.played,
      wins: p.wins,
      winRate: p.played ? p.wins / p.played : 0,
      main,
      variety,
      wonWith: p.wonWith.size,
      seriesWins: p.seriesWins,
      seriesPlayed: p.seriesPlayed,
      bestStreak: streakBest.get(p.userId) ?? 0,
    };
  });

  const headToHead = [...h2h.values()]
    .filter((r) => r.aWins + r.bWins > 0)
    .map((r) => ({
      aUserId: r.a,
      bUserId: r.b,
      aName: nameOf.get(r.a) ?? "?",
      bName: nameOf.get(r.b) ?? "?",
      aWins: r.aWins,
      bWins: r.bWins,
      meetings: r.meetings,
    }))
    .sort((x, y) => y.meetings - x.meetings || y.aWins + y.bWins - (x.aWins + x.bWins));

  res.json({
    games: matchIds.size,
    byCharacter: [...chars.values()]
      .map((c) => ({ ...c, winRate: c.played ? c.wins / c.played : 0 }))
      .sort((a, b) => b.wins - a.wins || b.played - a.played),
    byPlayer: byPlayer.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate),
    headToHead,
  });
});

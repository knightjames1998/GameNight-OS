// SOCIAL DEDUCTION pack server routes.
//
// The pack's identity, its routes, and the one thing no other pack in this app
// has: a REVEAL, where a secret stops being one and moves onto the record.
//
// WHAT LIVES WHERE, because this pack is split across three files on purpose:
//   - packages/shared/src/deduction.ts  the faction model, the deal, the pure
//                                       result path. No database, no clock.
//   - src/deduction-secret.ts           the secret store and its two routes.
//                                       Read its header before touching roles.
//   - this file                         the pack's routes and its ledger unit.
//
// THE LEDGER UNIT IS ONE GAME. One game is one `matches` row: the title on
// `matches.label` (Board Game's pattern), the winning faction taking placement
// 1 so every player on it wins together, the faction id on
// `match_participants.side`, and the faction, its alignment and the revealed
// role in `match_participants.meta`. ONE `games` ROW FOR THE PACK, never one
// per title, which would split it into a leaderboard tab per box on the shelf.
//
// NO SCHEMA CHANGE: game_sessions, matches.label, match_participants.meta and
// match_participants.side all already exist.
//
// WHAT IS NOT HERE, AND IS PART B: the live moderator board (alive/dead, who
// was voted out first), the TV view, and the picker tile. The board is opt-in
// and off by default, and the split that comes with that is not negotiable:
// the FACTION is captured by the result form, so win rate as village versus as
// wolf is free with the board off; survival and first-voted-out need the board
// and are ABSENT rather than zero without it, with deliberately no box to type
// them into. See SdLine in the shared module.

import { Router } from "express";
import {
  getDb,
  events,
  games,
  matches,
  and,
  desc,
  eq,
} from "@gamenight/db";
import {
  canonicalTitle,
  compositionOf,
  dealRoles,
  newSdBoard,
  newSdState,
  normalizeSdState,
  recordSdGame,
  sdAdvancePhase,
  sdGameLines,
  sdDefWith,
  sdSetOut,
  sdTitleDef,
  sdTvView,
  summarizeSdNight,
  tnTitleSuggestions,
  typedRole,
  validateComposition,
  validateSdResult,
  validateTypedRole,
  SD_MAX_PLAYERS,
  SD_TITLES,
  SESSION_PACKS,
  type SdCustomFaction,
  type SdCustomRole,
  type SdFactionEntry,
  type SdGame,
  type SdOutKind,
  type SdPlayer,
  type SdRoleCount,
  type SdSessionState,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { createPackRuntime, packConfig, roleOf, isHostRole, type LedgerLine } from "./pack-runtime.js";
import { clearDeal, loadDeal, registerSecretRoutes, saveDeal } from "./deduction-secret.js";
import { broadcast } from "./ws.js";
import { memberCreditedKeys, type GuestCreditResult } from "./guest-link-util.js";

const reg = SESSION_PACKS.deduction;
/** The ledger spelling, from the one registry (packages/shared/src/packs.ts). */
export const DEDUCTION_PACK = reg.ledger;
const route = reg.route;

/**
 * matches.format for every row this pack writes. Fixed, forever: it is what the
 * crew leaderboard's format breakdown groups on, and a change orphans every row
 * already written.
 */
const FORMAT = "deduction";

export const deductionRouter = Router();

/**
 * The public big-screen read. Event UUID is the access key, the same idea as an
 * invite link, because typing a password on a television is misery.
 *
 * MOUNTED WITH THE OTHER /api/tv ROUTERS, ABOVE the bare /api ones. Those apply
 * requireAuth at ROUTER level, which runs for every request entering them even
 * without a route match, so a TV router mounted below would 401 the whole
 * public view with nothing to show for it.
 */
export const deductionTvRouter = Router();

export const deductionRuntime = createPackRuntime<SdSessionState>({
  ...packConfig("deduction"),
  /**
   * Everything the pack's payload adds on top of the state.
   *
   * READ THE SECRET STORE'S HEADER BEFORE ADDING ANYTHING HERE. `viewOf`
   * spreads the whole state and then this, and the result goes to every player
   * at the table. Nothing that maps a player to a role may appear in either.
   */
  extras: (state) => ({ summary: summarizeSdNight(state) }),
  // Part A shipped without a board, so every session row already in the
  // database lacks `boardEnabled`, `board` and `days`. This runs at the two
  // points where raw jsonb becomes state, which is the whole reason the hook
  // exists: doing it at the call sites means getting all of them.
  normalize: normalizeSdState,
});

const rt = deductionRuntime;

// ---------- titles the crew has already used ----------

/**
 * Distinct titles this crew has recorded under this pack, most recent first.
 *
 * The same defence against a split history the title-night packs have, and it
 * matters for the same reason: per-title stats read `matches.label`, so
 * "Werewolf" and "werewolf " would be two histories and nothing would error.
 */
async function crewTitles(groupId: string): Promise<string[]> {
  const db = getDb();
  const game = (
    await db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.groupId, groupId), eq(games.pack, DEDUCTION_PACK)))
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

/** Everything a submitted title is matched against, in precedence order. */
const known = async (groupId: string) => tnTitleSuggestions(await crewTitles(groupId), SD_TITLES);

// ---------- ledger ----------

/**
 * Materialize one recorded game.
 *
 * The row shape is a PURE function in the shared module (`sdGameLines`), so
 * what a game writes can be pinned by a fixture with no database in the way.
 * This function keeps the insert and nothing else.
 */
async function materializeGame(
  groupId: string,
  eventId: string,
  gameId: string,
  game: SdGame,
  roster: SdPlayer[],
  sessionKey: string,
  linkMap?: Map<string, string>, // guest display name -> member userId (backfill)
): Promise<{ recorded: number; guests: number }> {
  const lines: LedgerLine[] = sdGameLines(game);
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

// ---------- the secret store's two routes ----------
// Mounted from here so the pack has ONE router, and defined over there so the
// only code that can read a deal is in one file with one header explaining why.
registerSecretRoutes(deductionRouter, rt);

// ---------- launch context ----------

deductionRouter.get(`/${route}-context/:eventId`, requireAuth, async (req: AuthedRequest, res) => {
  const ctx = await rt.launchContext(String(req.params.eventId), req.user!.id);
  if (!ctx) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json({ ...ctx, recentTitles: await crewTitles(ctx.groupId) });
});

// ---------- the public TV ----------

/**
 * THE ONE SCREEN IN THIS APP WITH A SECRECY CONSTRAINT.
 *
 * It is public, UUID-keyed and unauthenticated, so anybody with the link can
 * open it, including a player at the table on their own phone. It therefore
 * does NOT serve the ordinary session payload: it serves `sdTvView`, a
 * PROJECTION whose only reachable roles are the ones somebody has revealed and
 * the ones on a game already recorded. Read that function's header before
 * changing anything here, and note what this handler does not do: it never
 * touches the secret store, so there is no code path with an unrevealed role in
 * a variable it could accidentally serialize.
 */
deductionTvRouter.get(`/${route}/:eventId`, async (req, res) => {
  const loaded = await rt.loadState(String(req.params.eventId));
  res.json({ session: loaded ? sdTvView(loaded.state) : null });
});

// ---------- read live state ----------

deductionRouter.get(`/${route}/:eventId`, requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (loaded && !(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Reuse the row the role check just read instead of selecting it twice.
  await rt.respondState(eventId, res, loaded);
});

// ---------- host: start ----------

deductionRouter.post(`/events/:eventId/${route}`, requireAuth, async (req: AuthedRequest, res) => {
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
  const roster: SdPlayer[] = rawRoster
    .map((p: any, i: number): SdPlayer => {
      const name = String(p?.name ?? "").trim().slice(0, 24);
      const userId = typeof p?.userId === "string" ? p.userId : null;
      return { id: `p${i}_${Math.random().toString(36).slice(2, 8)}`, kind: userId ? "member" : "guest", userId, name };
    })
    .filter((p: SdPlayer) => p.name.length > 0)
    .slice(0, SD_MAX_PLAYERS);

  if (roster.length < 3) {
    // THREE, not two. Every game in this genre needs somebody to hide among,
    // and a two-player deduction game is one person guessing at one other.
    res.status(400).json({ error: "Add at least 3 players" });
    return;
  }

  // A new night must not inherit the last one's secret. Nothing reads a deal
  // whose dealNo does not match the session, but a stale secret sitting in the
  // database is not something to leave lying around either.
  await clearDeal(eventId);
  res.json(await rt.startSession(eventId, event.groupId, newSdState({ roster }), req.get("x-gn-client")));
});

// ---------- what is on the table now ----------

deductionRouter.post(`/${route}/:eventId/now-playing`, requireAuth, async (req: AuthedRequest, res) => {
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
  // Canonicalized here as well as on record: whatever the room reads for the
  // next hour is the spelling everybody uses, and if it differs from the one
  // that lands in the ledger the crew has been shown a lie.
  loaded.state.nowPlaying = raw.trim() ? canonicalTitle(raw, await known(loaded.row.groupId)).title : null;
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

// ---------- host: deal ----------

/**
 * Deal the roles.
 *
 * HOST ONLY, and not merely "host unless open scoring is on": open scoring lets
 * a member RECORD a result, which is a claim about a game everybody watched.
 * Dealing is different in kind, because whoever calls this route is the one
 * person who could learn the whole table by doing it.
 *
 * The response is the ordinary public session payload. The deal itself goes to
 * the secret store, and the caller reads it back through the host-gated route
 * like anybody else would, so there is no path where a deal rides out on a
 * mutation response.
 */
deductionRouter.post(`/${route}/:eventId/deal`, requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  const { state, row } = loaded;
  if (!isHostRole(await roleOf(row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Only the host deals" });
    return;
  }

  const rawTitle = String(req.body?.title ?? state.nowPlaying ?? "").slice(0, 60);
  if (!rawTitle.trim()) {
    res.status(400).json({ error: "Pick what you are playing" });
    return;
  }
  const { title } = canonicalTitle(rawTitle, await known(row.groupId));
  const curated = sdTitleDef(title);

  // ROLES THE HOST TYPED, canonicalized SERVER-SIDE against this title's
  // catalogue. That is where it has to happen: the id is what reaches
  // `meta.role` forever, so a client that minted its own would be one refactor
  // away from splitting a player's history in two. `typedRole` returns the
  // curated id when the typed name already names a curated role, so typing
  // "Alpha Werewolf" cannot create a second Alpha Werewolf.
  const rawTyped = Array.isArray(req.body?.typedRoles) ? req.body.typedRoles : [];
  const extraRoles: SdCustomRole[] = [];
  const extraFactions: SdCustomFaction[] = [];
  for (const t of rawTyped.slice(0, SD_MAX_PLAYERS)) {
    const name = String(t?.name ?? "").slice(0, 40);
    const solo = !!t?.soloFaction;
    const factionId = typeof t?.factionId === "string" ? t.factionId : null;
    const bad = validateTypedRole(curated, name, factionId, solo);
    if (bad) {
      res.status(400).json({ error: bad });
      return;
    }
    const made = typedRole(curated, name, factionId, solo);
    if (!made) continue;
    extraRoles.push(made.role);
    if (made.faction) extraFactions.push(made.faction);
  }

  // ONE MERGE POINT: everything downstream takes a def and does not know that
  // typed roles exist.
  const def = sdDefWith(curated, extraRoles, extraFactions);

  const rawComposition = Array.isArray(req.body?.composition) ? req.body.composition : [];
  const composition: SdRoleCount[] = rawComposition
    .map((c: any) => ({ roleId: String(c?.roleId ?? ""), count: Number(c?.count) }))
    .filter((c: SdRoleCount) => c.roleId.length > 0 && Number.isFinite(c.count) && c.count > 0);

  const err = validateComposition(def, composition, state.roster.length);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }

  const at = new Date().toISOString();
  const dealNo = (state.deal?.dealNo ?? 0) + 1;
  const roles = dealRoles(composition, state.roster.map((p) => p.id));
  await saveDeal(eventId, row.groupId, { dealNo, title, at, roles });

  // The SUMMARY is public and is supposed to be: every game in this genre opens
  // with the moderator saying the setup out loud. What is secret is who has
  // what, and that is the object above, which never touches this state.
  state.nowPlaying = title;
  // Only the typed roles that were actually DEALT ride along: a host who typed
  // a Witch and then set her count back to zero did not play with one, and a
  // summary that announced her would be describing a game nobody is playing.
  const dealtRoleIds = new Set(Object.values(roles));
  state.deal = {
    dealNo,
    title,
    at,
    composition: compositionOf(def, roles),
    extraRoles: extraRoles.filter((r) => dealtRoleIds.has(r.id)),
    extraFactions: extraFactions.filter((f) => extraRoles.some((r) => r.factionId === f.id && dealtRoleIds.has(r.id))),
  };
  // A DEAL OPENS A FRESH BOARD when the host has the board on, so nobody has to
  // re-flip a toggle between games. The preference outlives a game; the board
  // does not, because it belongs to the game it was tracking.
  state.board = state.boardEnabled ? newSdBoard(state.roster, at) : null;
  res.json(await rt.saveState(loaded, "live", req.get("x-gn-client")));
});

/** Take the deal back without recording anything. A mis-tapped setup. */
deductionRouter.post(`/${route}/:eventId/undeal`, requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  if (!isHostRole(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Only the host deals" });
    return;
  }
  await clearDeal(eventId);
  loaded.state.deal = null;
  loaded.state.board = null;
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

// ---------- the live moderator board ----------
//
// OPT-IN AND OFF BY DEFAULT (James, 2026-08-10: "we always lead with low
// friction tracking"). Blackjack's tracker is the precedent and the rule comes
// with it: the board being off never loses a stat the result form could have
// captured. A night moderated entirely on paper still records the title, the
// factions and the winner, which is everything win rate as village versus as
// wolf needs. What the board buys on top is SURVIVAL and FIRST VOTED OUT, and
// those are absent rather than zero without it, with deliberately no box to
// type them into.
//
// EVERY ROUTE BELOW IS HOST ONLY, and not "host unless open scoring is on".
// Open scoring lets a member record a RESULT, which is a claim about a game
// everybody watched. The board is the moderator's instrument: it is the thing
// they are holding while they run the game, and reveal reaches the secret store.

/** Flip the board on or off. It flips mid-session, in both directions. */
deductionRouter.post(`/${route}/:eventId/board`, requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  const { state, row } = loaded;
  if (!isHostRole(await roleOf(row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Only the host runs the board" });
    return;
  }

  state.boardEnabled = !!req.body?.on;
  if (!state.boardEnabled) {
    // OFF DISCARDS NOTHING ALREADY RECORDED. Every finished game baked its
    // outcomes onto its own lines at the moment it was recorded, so this only
    // ends tracking for the game in progress.
    state.board = null;
  } else if (!state.board && state.deal) {
    // ON PARTWAY THROUGH INVENTS NO HISTORY: a board started at day three opens
    // at Night 1 with everybody alive, because the app was not watching and has
    // nothing truthful to say about what it missed. The moderator taps the
    // people who are already out.
    state.board = newSdBoard(state.roster, new Date().toISOString());
  }
  res.json(await rt.saveState(loaded, loaded.row.status, req.get("x-gn-client")));
});

/** Night 1, Day 1, Night 2, Day 2. One tap. */
deductionRouter.post(`/${route}/:eventId/phase`, requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  if (!isHostRole(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Only the host runs the board" });
    return;
  }
  if (!loaded.state.board) {
    res.status(409).json({ error: "The board is off" });
    return;
  }
  sdAdvancePhase(loaded.state.board);
  res.json(await rt.saveState(loaded, "live", req.get("x-gn-client")));
});

/**
 * Put somebody out, bring them back, and REVEAL.
 *
 * ===========================================================================
 * THE REVEAL IS THE ONE PLACE A ROLE CROSSES OUT OF THE SECRET STORE.
 *
 * Everywhere else in this pack the secret is read by exactly two routes and
 * handed to exactly one viewer. Here it is read and written into SHARED,
 * PUBLIC state, where the TV will show it to the room, and that is correct:
 * revealing on death is what the game does out loud.
 *
 * Two things make it safe rather than merely intended:
 *   1. THE CLIENT NEVER NAMES THE ROLE. It sends `reveal: true` and the server
 *      looks the role up. A client that could name it could reveal a role that
 *      was never dealt, and a client that had to name it would have to know it.
 *   2. IT IS ONE WAY, per player. Bringing a mis-tapped player back does not
 *      un-reveal, because the room has already read it off the big screen.
 * ===========================================================================
 */
deductionRouter.post(`/${route}/:eventId/out`, requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (!loaded) {
    res.status(404).json({ error: "No session" });
    return;
  }
  const { state, row } = loaded;
  if (!isHostRole(await roleOf(row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Only the host runs the board" });
    return;
  }
  if (!state.board) {
    res.status(409).json({ error: "The board is off" });
    return;
  }

  const playerId = String(req.body?.playerId ?? "");
  const raw = req.body?.kind;
  const kind: SdOutKind | null = raw === "voted" ? "voted" : raw === "night" ? "night" : null;

  let revealRoleId: string | null = null;
  if (req.body?.reveal) {
    // Read here, from the store, never from the request. A deal from a game
    // already recorded is not this game's deal, so the dealNo has to match.
    const stored = await loadDeal(eventId);
    if (stored && state.deal && stored.dealNo === state.deal.dealNo) {
      revealRoleId = stored.roles[playerId] ?? null;
    }
  }

  const err = sdSetOut(state.board, playerId, kind, revealRoleId);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }
  res.json(await rt.saveState(loaded, "live", req.get("x-gn-client")));
});

// ---------- record a game: THE REVEAL ----------

deductionRouter.post(`/${route}/:eventId/record`, requireAuth, async (req: AuthedRequest, res) => {
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

  const rawTitle = String(req.body?.title ?? state.deal?.title ?? state.nowPlaying ?? "").slice(0, 60);
  if (!rawTitle.trim()) {
    res.status(400).json({ error: "Pick what you played" });
    return;
  }
  const { title } = canonicalTitle(rawTitle, await known(row.groupId));
  // The MERGED def, so a faction the host typed can be ranked like any other.
  const def = sdDefWith(sdTitleDef(title), state.deal?.extraRoles, state.deal?.extraFactions);

  const raw = Array.isArray(req.body?.order) ? req.body.order : [];
  const order: SdFactionEntry[] = raw
    .map((e: any) => ({
      factionId: String(e?.factionId ?? ""),
      memberIds: (Array.isArray(e?.memberIds) ? e.memberIds : []).map(String),
      tiedWithAbove: !!e?.tiedWithAbove,
    }))
    .filter((e: SdFactionEntry) => e.factionId.length > 0);

  const err = validateSdResult(order, state, def);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }

  // THE REVEAL. The game is over, the room has been told, and this is the one
  // point at which a role legitimately crosses into shared state. A deal from
  // an earlier game is not this game's deal, so the dealNo has to match; a
  // night moderated on paper has no deal at all and records the faction alone,
  // which is what the headline stat needs.
  const stored = await loadDeal(eventId);
  const roles = stored && state.deal && stored.dealNo === state.deal.dealNo ? stored.roles : null;

  const game = recordSdGame(state, title, order, def, roles, new Date().toISOString());
  await clearDeal(eventId);

  const gameId = await rt.ensureGame(row.groupId);
  const report = await materializeGame(row.groupId, eventId, gameId, game, state.roster, state.sessionKey);

  const origin = req.get("x-gn-client");
  const view = await rt.saveState(loaded, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json({ ...view, ...report });
});

deductionRouter.post(`/${route}/:eventId/undo`, requireAuth, async (req: AuthedRequest, res) => {
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
  // Undoing a mis-tapped result puts the game back on the table, which is where
  // it was a moment ago. THE DEAL DOES NOT COME BACK, and that is deliberate:
  // it was cleared at reveal, the room has already seen who was what, and
  // re-dealing the same game is the only honest way to play it again.
  state.nowPlaying = last.title;
  const origin = req.get("x-gn-client");
  const view = await rt.saveState(loaded, "live", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json(view);
});

// ---------- host controls ----------

deductionRouter.post(`/${route}/:eventId/open-scoring`, requireAuth, async (req: AuthedRequest, res) => {
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

deductionRouter.post(`/${route}/:eventId/complete`, requireAuth, async (req: AuthedRequest, res) => {
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
  // The night is over, so the secret has nothing left to protect and no reason
  // to stay in the database.
  await clearDeal(eventId);
  loaded.state.nowPlaying = null;
  loaded.state.deal = null;
  loaded.state.board = null;
  res.json(await rt.saveState(loaded, "completed", req.get("x-gn-client")));
});

// ---------- guest -> member backfill (see guest-link.ts) ----------

/** Distinct guest display names across this crew's Social Deduction sessions. */
export const guestNamesDeduction = (groupId: string): Promise<string[]> =>
  rt.guestNames(groupId, (state) => state.roster);

/** Credit (or preview) every recoverable game the guest played. */
export async function creditGuestDeduction(
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
        pack: DEDUCTION_PACK,
        packLabel: reg.name,
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

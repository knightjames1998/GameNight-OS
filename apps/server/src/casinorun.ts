// Casino Run pack server routes.
//
// The fifth casino pack and the one that does NOT go through
// casino-runtime.ts, because it has no buy-ins, no rebuys and no cash-outs to
// share. One shared bank, a leg log, and a settlement that gives every player
// the same result. See packages/shared/src/casinorun.ts for why that is its
// own engine rather than a flag on the cash one.
//
// THE LEDGER UNIT IS THE RUN: one finished run is one matches row plus one
// match_participants row per player, all at the same placement. No schema
// change.
//
// EVERY AMOUNT HERE IS INTEGER CENTS, through the same cents() boundary the
// cash packs use: a float is rejected rather than rounded, so a client that
// started doing dollar arithmetic fails loudly instead of quietly.

import { Router } from "express";
import { getDb, and, eq, events, games, matches, matchParticipants, users } from "@gamenight/db";
import {
  aggregateCrunModifiers,
  aggregateCrunRuns,
  CRUN_LADDERS,
  crunBuy,
  crunEscalationWeight,
  claimCrunDraw,
  crunLadder,
  crunLedgerLines,
  crunProgress,
  crunRecord,
  crunUndo,
  drawModifiers,
  modifiersFor,
  newCrunState,
  sanitizeModifierIds,
  summarizeCrun,
  SESSION_PACKS,
  type CashPlayer,
  type CrunDifficulty,
  type CrunRunRow,
  type CrunState,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import {
  createPackRuntime,
  isHostRole,
  packConfig,
  roleOf,
  type LedgerLine,
  type Loaded,
} from "./pack-runtime.js";
import { cents } from "./casino-runtime.js";
import { broadcast } from "./ws.js";
import { memberCreditedKeys, type GuestCreditResult } from "./guest-link-util.js";

/** The ledger spelling, from the one registry. */
export const CASINO_RUN_PACK = SESSION_PACKS.casinorun.ledger;
const DEF = SESSION_PACKS.casinorun;
const SEG = DEF.route;

/** A crew bigger than this stops being a crew and starts being a typo. */
const MAX_PLAYERS = 12;
/**
 * A run needs a real stake. Every quota is a multiple of the starting bank, so
 * a bank of zero makes them all zero and the first leg clears the whole run,
 * this is the boundary that owns what a valid run looks like, so it is stopped
 * here rather than special-cased in the engine.
 */
const MIN_BANK = 100; // $1.00
/** How many cards a run opens with. */
const OPENING_DRAW = 1;

export const casinoRunRouter = Router();
export const casinoRunTvRouter = Router();

export const casinoRunRuntime = createPackRuntime<CrunState>({
  ...packConfig("casinorun"),
  extras: (state) => ({ summary: summarizeCrun(state) }),
});

const rt = casinoRunRuntime;

// ---------- guards ----------

interface Ok {
  loaded: Loaded<CrunState>;
  origin: string | undefined;
}

/** Load + "may record" check. Standing rule 1 unless the host opened it up. */
async function scorer(req: AuthedRequest, res: import("express").Response): Promise<Ok | null> {
  const loaded = await rt.loadState(String(req.params.eventId));
  if (!loaded) {
    res.status(404).json({ error: "No run" });
    return null;
  }
  const role = await roleOf(loaded.row.groupId, req.user!.id);
  if (!role) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  if (!isHostRole(role) && !loaded.state.openScoring) {
    res.status(403).json({ error: "Only the host records the run (open scoring is off)" });
    return null;
  }
  if (loaded.row.status === "completed") {
    res.status(409).json({ error: "That run has already been recorded" });
    return null;
  }
  return { loaded, origin: req.get("x-gn-client") };
}

async function host(req: AuthedRequest, res: import("express").Response): Promise<Ok | null> {
  const loaded = await rt.loadState(String(req.params.eventId));
  if (!loaded) {
    res.status(404).json({ error: "No run" });
    return null;
  }
  if (!isHostRole(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(403).json({ error: "Host only" });
    return null;
  }
  return { loaded, origin: req.get("x-gn-client") };
}

// ---------- the modifier draws ----------
//
// FIVE DRAW PATHS, ONE FUNCTION. All of them are drawModifiers with different
// arguments, which is exactly why it takes a deck, a count, a filter and a
// weighting rather than knowing about "setup". Nothing new is written here.

/** Cards this run can still draw: the pack's pool minus what is already on. */
const available = (state: CrunState) =>
  modifiersFor(DEF.ledger).filter((m) => !state.modifiers.includes(m.id));

/** Add drawn ids to the run. Returns the ids added, for the response. */
function addDrawn(state: CrunState, drawn: { id: string }[]): string[] {
  const ids = drawn.map((m) => m.id);
  // Kept in deck order, so the same cards always read the same way on the
  // strip, the TV and the ledger.
  state.modifiers = sanitizeModifierIds([...state.modifiers, ...ids], DEF.ledger);
  return ids;
}

/**
 * The draw a cleared stage earns, ESCALATING: the weighting reaches for higher
 * severities as the run climbs, so the last stage's reward is meaner than the
 * first's. A weight override, not a second function.
 */
function drawOnClear(state: CrunState, clearIndex: number): string[] {
  if (!claimCrunDraw(state, "clear", clearIndex)) return [];
  const ladder = crunLadder(state.difficulty);
  const p = crunProgress(state);
  return addDrawn(
    state,
    drawModifiers({
      deck: available(state),
      count: 1,
      weight: crunEscalationWeight(p.stage, ladder.stages),
    }),
  );
}

/** The forced BANE a missed stage costs. A filter, not a second function. */
function drawOnMiss(state: CrunState, missIndex: number): string[] {
  if (!claimCrunDraw(state, "miss", missIndex)) return [];
  return addDrawn(
    state,
    drawModifiers({ deck: available(state), count: 1, filter: (m) => m.kind === "bane" }),
  );
}

// ---------- reads ----------

casinoRunRouter.get(`/${SEG}-context/:eventId`, requireAuth, async (req: AuthedRequest, res) => {
  const ctx = await rt.launchContext(String(req.params.eventId), req.user!.id);
  if (!ctx) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(ctx);
});

casinoRunRouter.get(`/${SEG}/:eventId`, requireAuth, async (req: AuthedRequest, res) => {
  const eventId = String(req.params.eventId);
  const loaded = await rt.loadState(eventId);
  if (loaded && !(await roleOf(loaded.row.groupId, req.user!.id))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await rt.respondState(eventId, res, loaded);
});

// Public big-screen read. Event UUID is the access key.
casinoRunTvRouter.get(`/${SEG}/:eventId`, async (req, res) => {
  await rt.respondState(String(req.params.eventId), res);
});

// ---------- host: open the run ----------

casinoRunRouter.post(`/events/:eventId/${SEG}`, requireAuth, async (req: AuthedRequest, res) => {
  const db = getDb();
  const eventId = String(req.params.eventId);
  const event = (await db.select().from(events).where(eq(events.id, eventId)).limit(1))[0];
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (!isHostRole(await roleOf(event.groupId, req.user!.id))) {
    res.status(403).json({ error: "Only crew owners and admins can start a run" });
    return;
  }

  // Standing rule 8: never clobber a run in progress unless the host confirmed
  // a replace. "In progress" means legs have been played.
  const existing = await rt.loadState(eventId);
  if (!req.body?.force && existing && existing.row.status !== "completed" && existing.state.legs.length > 0) {
    res.status(409).json({ error: "A run is already in progress for this event" });
    return;
  }

  const startingBank = cents(req.body?.startingBank);
  if (startingBank === null || startingBank < MIN_BANK) {
    res.status(400).json({ error: "Set a starting bank of at least $1" });
    return;
  }
  const floor = cents(req.body?.floor) ?? 0;
  if (floor >= startingBank) {
    res.status(400).json({ error: "The floor has to be below the starting bank" });
    return;
  }

  const difficulty: CrunDifficulty =
    (CRUN_LADDERS.find((l) => l.key === req.body?.difficulty)?.key as CrunDifficulty) ?? "standard";
  // NO STAKES PARAMETER. Casino Run is play money, always. See the field
  // comment on CrunState. A body that sends one is ignored rather than
  // honoured, so a stale client cannot open a real-money run.
  const ante = cents(req.body?.ante);

  const rawRoster = Array.isArray(req.body?.roster) ? req.body.roster : [];
  const roster: CashPlayer[] = rawRoster
    .map((p: any, i: number): CashPlayer => {
      const name = String(p?.name ?? "").trim().slice(0, 24);
      const userId = typeof p?.userId === "string" ? p.userId : null;
      return { id: `p${i}_${Math.random().toString(36).slice(2, 8)}`, kind: userId ? "member" : "guest", userId, name };
    })
    .filter((p: CashPlayer) => p.name.length > 0)
    .slice(0, MAX_PLAYERS);
  if (roster.length < 1) {
    res.status(400).json({ error: "Add at least 1 player" });
    return;
  }

  const state = newCrunState({
    roster,
    startingBank,
    difficulty,
    floor,
    ante: ante && ante > 0 ? ante : undefined,
    modifiers: sanitizeModifierIds(req.body?.modifiers, DEF.ledger),
  });

  // THE OPENING DRAW, unless the host picked their own cards. A run that
  // started with nothing on would spend its first stage feeling like a
  // spreadsheet, and the deck is the reason this mode has texture.
  if (state.modifiers.length === 0 && req.body?.draw !== false) {
    addDrawn(state, drawModifiers({ deck: available(state), count: OPENING_DRAW }));
  }

  res.json(await rt.startSession(eventId, event.groupId, state, req.get("x-gn-client")));
});

// ---------- playing the run ----------

/**
 * Record a leg: what the bank did, at which game, played by whom.
 *
 * The response carries `drew` so the client can say what the table just picked
 * up. Draws happen HERE rather than on the client because they are part of the
 * recorded state: a card drawn on one phone has to appear on every other one
 * and on the TV, which is what makes them the server's business.
 */
casinoRunRouter.post(`/${SEG}/:eventId/leg`, requireAuth, async (req: AuthedRequest, res) => {
  const g = await scorer(req, res);
  if (!g) return;
  const state = g.loaded.state;

  const delta = cents(req.body?.delta, { allowNegative: true });
  if (delta === null) {
    res.status(400).json({ error: "Enter what the bank is up or down" });
    return;
  }
  const game = String(req.body?.game ?? "").trim().slice(0, 32);
  if (!game) {
    res.status(400).json({ error: "Name the game that leg was played at" });
    return;
  }
  // Attribution is REQUIRED to be recorded, but "the table" is a real answer:
  // a leg everybody played together is not the same as an unattributed one.
  const rawPlayer = req.body?.playerId;
  const playerId = rawPlayer === null || rawPlayer === undefined || rawPlayer === "" ? null : String(rawPlayer);
  if (playerId !== null && !state.roster.some((p) => p.id === playerId)) {
    res.status(404).json({ error: "That player is not on the run" });
    return;
  }

  const before = crunProgress(state);
  if (!crunRecord(state, { delta, game, playerId, at: new Date().toISOString() })) {
    res.status(409).json({ error: "That run is over" });
    return;
  }
  const after = crunProgress(state);

  // Two of the five draw paths, decided from the walk rather than re-deduced.
  // Each is CLAIMED against the transition it belongs to (this run's 3rd clear,
  // its 2nd miss) rather than against the leg that caused it, so undoing the
  // leg and entering a corrected one cannot deal a second card for the same
  // clear, and a retried request cannot either. See claimCrunDraw.
  let drew: string[] = [];
  if (after.cleared > before.cleared && after.status === "running") {
    drew = drawOnClear(state, after.cleared);
  } else if (after.missed > before.missed) {
    drew = drawOnMiss(state, after.missed);
  }

  res.json({ ...(await rt.saveState(g.loaded, "live", g.origin)), drew });
});

/**
 * Buy a one-shot token out of the bank.
 *
 * Not a leg: it moves the bank but spends no leg budget, and it is recorded in
 * the same log so undo gives the money back with nothing else to unwind. The
 * cost is deliberately NOT checked against the bank, because spending your last chips
 * on a hedge is a legitimate way to end a run, and the floor check catches it
 * like anything else.
 */
casinoRunRouter.post(`/${SEG}/:eventId/buy`, requireAuth, async (req: AuthedRequest, res) => {
  const g = await scorer(req, res);
  if (!g) return;
  const state = g.loaded.state;
  const rawPlayer = req.body?.playerId;
  const playerId = rawPlayer === null || rawPlayer === undefined || rawPlayer === "" ? null : String(rawPlayer);
  if (playerId !== null && !state.roster.some((p) => p.id === playerId)) {
    res.status(404).json({ error: "That player is not on the run" });
    return;
  }
  const token = crunBuy(state, {
    token: String(req.body?.token ?? ""),
    playerId,
    at: new Date().toISOString(),
  });
  if (!token) {
    res.status(400).json({ error: "No such card, or the run is over" });
    return;
  }
  res.json({ ...(await rt.saveState(g.loaded, "live", g.origin)), bought: token.id });
});

/** The host can correct the opening ante; the rises on top of it stay derived. */
casinoRunRouter.post(`/${SEG}/:eventId/ante`, requireAuth, async (req: AuthedRequest, res) => {
  const g = await host(req, res);
  if (!g) return;
  const amount = cents(req.body?.amount);
  if (amount === null || amount < 1) {
    res.status(400).json({ error: "Enter an ante" });
    return;
  }
  g.loaded.state.ante = amount;
  res.json(await rt.saveState(g.loaded, g.loaded.row.status, g.origin));
});

casinoRunRouter.post(`/${SEG}/:eventId/undo-leg`, requireAuth, async (req: AuthedRequest, res) => {
  const g = await scorer(req, res);
  if (!g) return;
  if (!crunUndo(g.loaded.state)) {
    res.json({ ...rt.viewOf(g.loaded), empty: true });
    return;
  }
  // THE MODIFIERS ARE NOT ROLLED BACK, on purpose. The cards were drawn and the
  // table played under them; un-drawing one would rewrite what the night was.
  // Undo fixes a mistyped number, and the host can take a card off by hand.
  res.json(await rt.saveState(g.loaded, "live", g.origin));
});

// ---------- host: the modifier controls ----------

/** The host override: turn any card on or off at any point. */
casinoRunRouter.post(`/${SEG}/:eventId/modifiers`, requireAuth, async (req: AuthedRequest, res) => {
  const g = await host(req, res);
  if (!g) return;
  g.loaded.state.modifiers = sanitizeModifierIds(req.body?.modifiers, DEF.ledger);
  res.json(await rt.saveState(g.loaded, g.loaded.row.status, g.origin));
});

/**
 * DRAFT MODE: deal a hand and let the table pick one.
 *
 * Two calls, deliberately stateless in between: this deals a hand and returns
 * it WITHOUT storing anything, and the table's pick comes back through the
 * override route above. Storing an undecided hand would mean a fourth run
 * state ("waiting on a draft") that undo, completion and the TV would all have
 * to know about, to save one round trip.
 */
casinoRunRouter.post(`/${SEG}/:eventId/draft`, requireAuth, async (req: AuthedRequest, res) => {
  const g = await host(req, res);
  if (!g) return;
  const state = g.loaded.state;
  const count = Math.max(1, Math.min(5, Number(req.body?.count) || 3));
  const ladder = crunLadder(state.difficulty);
  const hand = drawModifiers({
    deck: available(state),
    count,
    weight: crunEscalationWeight(crunProgress(state).stage, ladder.stages),
  });
  res.json({ hand: hand.map((m) => m.id) });
});

casinoRunRouter.post(`/${SEG}/:eventId/open-scoring`, requireAuth, async (req: AuthedRequest, res) => {
  const g = await host(req, res);
  if (!g) return;
  g.loaded.state.openScoring = !!req.body?.open;
  res.json(await rt.saveState(g.loaded, g.loaded.row.status, g.origin));
});

// ---------- end the run ----------

async function materialize(
  groupId: string,
  eventId: string,
  gameId: string,
  state: CrunState,
  linkMap?: Map<string, string>,
): Promise<{ recorded: number; guests: number }> {
  const start = Date.parse(state.startedAt);
  const minutes = Number.isFinite(start) ? Math.round((Date.now() - start) / 60000) : null;
  const lines: LedgerLine[] = crunLedgerLines(state, {
    extraMeta: () => ({ minutes: minutes && minutes > 0 ? minutes : null }),
  }).map((l) => ({
    playerId: l.playerId,
    placement: l.placement,
    isWinner: l.isWinner,
    meta: l.meta,
    // Everybody on a run is on one team, so every row carries the same side.
    // This is the ONLY writer of the column today; see match_participants.side.
    side: l.side,
  }));

  return rt.materializeUnit({
    groupId,
    eventId,
    gameId,
    idx: 0,
    sessionKey: state.sessionKey,
    // The label is the RUN's own headline, which is what matches.label is for:
    // one display string. The modifier ids are not in here; they are on every
    // participant row, where the per-player stat can actually read them.
    label: summarizeCrun(state).headline,
    format: "casino_run",
    roster: state.roster,
    lines,
    linkMap,
  });
}

/**
 * Record the run. Unlike the cash packs there is no balance to check: a co-op
 * bank cannot disagree with itself, because there is only one of it.
 *
 * A run that is still RUNNING can be recorded (a night ends when people go
 * home, not when the maths resolves), but the host is warned first, because
 * an unfinished run materializes as a loss. 409-then-force, the same shape the
 * cash packs use for a table that does not balance.
 */
casinoRunRouter.post(`/${SEG}/:eventId/complete`, requireAuth, async (req: AuthedRequest, res) => {
  const g = await host(req, res);
  if (!g) return;
  const { loaded, origin } = g;
  const eventId = loaded.row.eventId;
  const state = loaded.state;
  const summary = summarizeCrun(state);

  if (!req.body?.force && summary.status === "running") {
    res.status(409).json({
      error: `That run is still going: stage ${summary.stage + 1} of ${summary.ladder.stages}. Recording it now counts as a bust for everyone.`,
      summary,
    });
    return;
  }

  const gameId = await rt.ensureGame(loaded.row.groupId);
  const report = await materialize(loaded.row.groupId, eventId, gameId, state);
  const view = await rt.saveState(loaded, "completed", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json({ ...view, ...report, summary });
});

// ---------- lifetime crew stats ----------

interface CrunMeta {
  result?: string;
  difficulty?: string;
  stagesCleared?: number;
  stagesTotal?: number;
  comeback?: number;
  missed?: number;
  legs?: number;
  modifiers?: string[];
  myLegs?: number;
  myDelta?: number;
  [k: string]: unknown;
}

const runRow = (m: CrunMeta): CrunRunRow => ({
  cleared: m.result === "cleared",
  difficulty: typeof m.difficulty === "string" ? m.difficulty : "standard",
  stagesCleared: m.stagesCleared ?? 0,
  stagesTotal: m.stagesTotal ?? 0,
  comeback: m.comeback ?? 0,
  missed: m.missed ?? 0,
  legs: m.legs ?? 0,
  modifiers: Array.isArray(m.modifiers) ? m.modifiers.filter((x): x is string => typeof x === "string") : [],
});

casinoRunRouter.get(`/groups/:id/${SEG}-stats`, requireAuth, async (req: AuthedRequest, res) => {
  const groupId = String(req.params.id);
  if (!(await roleOf(groupId, req.user!.id))) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const db = getDb();
  const game = (
    await db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.groupId, groupId), eq(games.pack, DEF.ledger)))
      .limit(1)
  )[0];
  if (!game) {
    res.json({ runs: 0, byPlayer: [], byModifier: [], best: null });
    return;
  }

  const rows = await db
    .select({
      userId: matchParticipants.userId,
      displayName: users.displayName,
      meta: matchParticipants.meta,
      matchId: matchParticipants.matchId,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(users, eq(matchParticipants.userId, users.id))
    .where(and(eq(matches.groupId, groupId), eq(matches.gameId, game.id), eq(matches.status, "completed")));

  const byUser = new Map<string, { userId: string; name: string; runs: CrunRunRow[]; legs: number }>();
  // DEDUPED BY MATCH: every player on a run carries an identical copy of the
  // run's meta, so counting participant rows would report a four-player run as
  // four runs and make a crew look far busier than it is.
  const perRun = new Map<string, CrunRunRow>();

  for (const r of rows) {
    const m = (r.meta as CrunMeta | null) ?? {};
    const run = runRow(m);
    perRun.set(r.matchId, run);
    const p = byUser.get(r.userId) ?? { userId: r.userId, name: r.displayName, runs: [], legs: 0 };
    p.runs.push(run);
    p.legs += m.myLegs ?? 0;
    byUser.set(r.userId, p);
  }

  const byPlayer = [...byUser.values()]
    .map((p) => ({ userId: p.userId, name: p.name, myLegs: p.legs, ...aggregateCrunRuns(p.runs) }))
    .sort((a, b) => b.cleared - a.cleared || b.deepest - a.deepest || b.runs - a.runs);

  // The crew's best comeback, named. It is the number this pack is actually
  // about ("we were down to eleven dollars"), so it gets a headline.
  let best: { name: string; comeback: number } | null = null;
  for (const p of byUser.values()) {
    for (const r of p.runs) {
      if (r.comeback > 0 && (!best || r.comeback > best.comeback)) {
        best = { name: p.name, comeback: r.comeback };
      }
    }
  }

  res.json({
    runs: perRun.size,
    byPlayer,
    byModifier: aggregateCrunModifiers([...perRun.values()]),
    best,
  });
});

// ---------- guest -> member backfill (see guest-link.ts) ----------

export const guestNamesCasinoRun = (groupId: string) =>
  rt.guestNames(groupId, (state) => state.roster);

export async function creditGuestCasinoRun(
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
    const slots = new Set(
      (state.roster ?? []).filter((p) => p.kind === "guest" && p.name === guestName).map((p) => p.id),
    );
    if (slots.size === 0) continue;
    const credited = await memberCreditedKeys(eventId, memberId);
    if (credited.has(rt.ledgerKey(eventId, state.sessionKey, 0))) continue;

    const summary = summarizeCrun(state);
    items.push({
      pack: DEF.ledger,
      packLabel: DEF.name,
      eventId,
      label: summary.headline,
      date: state.startedAt ?? null,
      placement: summary.status === "cleared" ? 1 : Math.max(2, state.roster.length),
      isWinner: summary.status === "cleared",
    });

    if (!dryRun) {
      gameId = gameId ?? (await rt.ensureGame(groupId));
      await materialize(groupId, eventId, gameId, state, linkMap);
    }
  }
  return { items, written: dryRun ? 0 : items.length };
}

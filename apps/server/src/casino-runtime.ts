// The CASINO GROUP's server runtime: every route that is about MONEY.
//
// Blackjack, roulette, craps and poker take the same buy-ins, the same rebuys
// and the same cash-outs, seat the same late arrivals, and settle the same
// way, because they share one engine (packages/shared/src/cashgame.ts). So
// they share one set of routes too, and a pack file is left with the two or
// three things that are actually its own.
//
// DOES THIS CONTRADICT pack-runtime.ts, WHICH SAYS ROUTES STAY PER-PACK? No,
// and the distinction is worth stating because the earlier decision was
// deliberate. That call was about Smash vs Mario Kart vs Ping Pong, whose
// bodies genuinely differ — a fighter pick, a race result, a game winner —
// and where a shared validator really would drift into a lowest common
// denominator. The casino packs are a sub-family with ONE data model: the
// body of a rebuy is { playerId } in all four, and it is not going to stop
// being. Sharing here is sharing one idea, not flattening four.
//
// WHAT STAYS IN THE PACK FILE, on purpose:
//   - the TRACKER routes, which are the one place the packs genuinely differ
//     (a blackjack hand is a bet and a result, a roulette spin is a bet type
//     and won/lost, a craps roll is neither),
//   - the pack's detail stats and how the cash-out form writes them,
//   - its lifetime-stats extras on top of the shared money ones.
//
// EVERY AMOUNT HERE IS INTEGER CENTS. cents() below is the boundary that makes
// that true of the SERVER rather than merely true of the client: a float is
// REJECTED rather than rounded, because rounding would hide a client that had
// started doing dollar arithmetic, which is the exact regression the whole
// design guards against.

import type { Response, Router } from "express";
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
  cashLedgerLines,
  formatCentsSigned,
  settleCash,
  SESSION_PACKS,
  type CashBank,
  type CashPackState,
  type CashPlayer,
  type CashSummary,
  type SessionPackKey,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import {
  isHostRole,
  roleOf,
  type LedgerLine,
  type Loaded,
  type PackRuntime,
} from "./pack-runtime.js";
import { broadcast } from "./ws.js";
import { memberCreditedKeys, type GuestCreditResult } from "./guest-link-util.js";

/** A table bigger than this stops being a game and starts being a typo. */
const MAX_PLAYERS = 12;
/** $100,000 in cents. A ceiling, not a rule: it exists to catch a fat finger. */
const MAX_AMOUNT = 10_000_000;
/** Past this, the host wants to correct the buy-in rather than tap again. */
const MAX_REBUYS = 100;

/**
 * Coerce a request field to integer cents, or null if it is not one.
 *
 * The client sends cents already (it parses the typed dollars with the shared
 * parseCents), so this is the boundary that makes "money is integer cents"
 * true of the server. A float arriving here is rejected outright.
 */
export function cents(raw: unknown, opts?: { allowNegative?: boolean }): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (Math.abs(n) > MAX_AMOUNT) return null;
  if (n < 0 && !opts?.allowNegative) return null;
  return n;
}

export interface CasinoConfig<S extends CashPackState> {
  key: SessionPackKey;
  runtime: PackRuntime<S>;
  router: Router;
  /** Build a fresh session. The pack adds its own tracker log and detail map. */
  newState(opts: {
    bank: CashBank;
    bankerId: string | null;
    roster: CashPlayer[];
    defaultBuyIn: number;
    buyIns: Record<string, number>;
    tracker: boolean;
  }): S;
  summarize(state: S): CashSummary<unknown>;
  /**
   * The pack's per-player detail for the LEDGER row. Nulls are dropped by
   * cashLedgerLines, so an unanswered stat stays absent rather than becoming a
   * zero that would drag a lifetime average down.
   */
  ledgerMeta(state: S, playerId: string): Record<string, unknown>;
  /**
   * Write whatever the cash-out form carried for this pack. Called only with
   * the raw body; the pack decides which keys it owns and must leave a field
   * the form did not send alone, so a cash-out edit cannot wipe what the
   * tracker knows.
   */
  applyDetail(state: S, playerId: string, body: Record<string, unknown>): void;
  /** How many tracked events the whole session holds; drives one hint. */
  eventCount(state: S): number;
}

/** Everything a mutation route needs once the guard has passed. */
export interface Ok<S> {
  loaded: Loaded<S>;
  origin: string | undefined;
}

export interface CasinoRoutes<S extends CashPackState> {
  /** Load + "may record the money" check. */
  scorer(req: AuthedRequest, res: Response): Promise<Ok<S> | null>;
  /** Load + host-only check, for the controls that are never opened up. */
  host(req: AuthedRequest, res: Response): Promise<Ok<S> | null>;
  /** The roster slot for a posted playerId, or null (404 already sent). */
  slotOf(state: S, raw: unknown, res: Response): CashPlayer | null;
  /** Materialize the whole session as one ledger row set. */
  materialize(
    groupId: string,
    eventId: string,
    gameId: string,
    state: S,
    linkMap?: Map<string, string>,
  ): Promise<{ recorded: number; guests: number }>;
  guestNames(groupId: string): Promise<string[]>;
  creditGuest(groupId: string, guestName: string, memberId: string, dryRun: boolean): Promise<GuestCreditResult>;
}

/**
 * Register every money route for a cash pack and hand back the pieces its own
 * routes need.
 */
export function registerCasinoRoutes<S extends CashPackState>(
  cfg: CasinoConfig<S>,
): CasinoRoutes<S> {
  const { runtime: rt, router, key } = cfg;
  const def = SESSION_PACKS[key];
  const seg = def.route;

  // ---------- ledger ----------

  /** Minutes of play, from the session's own clock. Null if it makes no sense. */
  function sessionMinutes(state: S): number | null {
    const start = Date.parse(state.startedAt);
    if (!Number.isFinite(start)) return null;
    const mins = Math.round((Date.now() - start) / 60000);
    return mins > 0 ? mins : null;
  }

  /**
   * Materialize the whole SESSION as one recorded unit.
   *
   * idx 0 plus the sessionKey makes the key {prefix}:{eventId}:{sessionKey}:0,
   * so a second night on the same recurring event gets its own key rather than
   * being dropped as a duplicate of the first.
   *
   * Placement comes from settleCash, which ranks by net descending with
   * co-placements at competition ranking. `final: true` is what turns a player
   * who never cashed out into a bust — live, that is deliberately "unknown".
   */
  async function materialize(
    groupId: string,
    eventId: string,
    gameId: string,
    state: S,
    linkMap?: Map<string, string>,
  ): Promise<{ recorded: number; guests: number }> {
    const settlement = settleCash(state, { final: true });
    const minutes = sessionMinutes(state);
    // `character` is left undefined rather than null, which keeps the column
    // out of the insert entirely: it stays null for every casino pack.
    const lines: LedgerLine[] = cashLedgerLines(settlement, state.bank, state.bankerId, (playerId) => ({
      ...cfg.ledgerMeta(state, playerId),
      // Net per hour needs the night's LENGTH, and matches.playedAt is only
      // the end of it. Stored per row so the read layer never has to guess.
      minutes,
    }));

    return rt.materializeUnit({
      groupId,
      eventId,
      gameId,
      idx: 0,
      sessionKey: state.sessionKey,
      label: null,
      format: "cash",
      roster: state.roster,
      lines,
      linkMap,
    });
  }

  // ---------- guest -> member backfill (see guest-link.ts) ----------

  const guestNames = (groupId: string) => rt.guestNames(groupId, (state) => state.roster);

  /**
   * One night is one row, so unlike the game-as-unit packs there is exactly
   * one item per session. A session that never completed wrote nothing and has
   * nothing to credit; materializeUnit reopens the row that exists rather than
   * creating one.
   */
  async function creditGuest(
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

      const settlement = settleCash(state, { final: true });
      const line = settlement.lines.find((l) => slots.has(l.playerId));
      if (!line) continue;

      items.push({
        pack: def.ledger,
        packLabel: def.name,
        eventId,
        // formatCentsSigned, not hand-rolled division: dollars exist only at
        // the edges, and this string IS an edge.
        label: `net ${formatCentsSigned(line.net ?? 0)}`,
        date: state.entries.find((e) => slots.has(e.playerId))?.at ?? null,
        placement: line.placement,
        isWinner: line.isWinner,
      });

      if (!dryRun) {
        gameId = gameId ?? (await rt.ensureGame(groupId));
        await materialize(groupId, eventId, gameId, state, linkMap);
      }
    }
    return { items, written: dryRun ? 0 : items.length };
  }

  // ---------- guards ----------

  async function scorer(req: AuthedRequest, res: Response): Promise<Ok<S> | null> {
    const loaded = await rt.loadState(String(req.params.eventId));
    if (!loaded) {
      res.status(404).json({ error: "No session" });
      return null;
    }
    const role = await roleOf(loaded.row.groupId, req.user!.id);
    if (!role) {
      res.status(404).json({ error: "Not found" });
      return null;
    }
    if (!isHostRole(role) && !loaded.state.openScoring) {
      res.status(403).json({ error: "Only the host records the money (open scoring is off)" });
      return null;
    }
    if (loaded.row.status === "completed") {
      res.status(409).json({ error: "That session has already been recorded" });
      return null;
    }
    return { loaded, origin: req.get("x-gn-client") };
  }

  async function host(req: AuthedRequest, res: Response): Promise<Ok<S> | null> {
    const loaded = await rt.loadState(String(req.params.eventId));
    if (!loaded) {
      res.status(404).json({ error: "No session" });
      return null;
    }
    if (!isHostRole(await roleOf(loaded.row.groupId, req.user!.id))) {
      res.status(403).json({ error: "Host only" });
      return null;
    }
    return { loaded, origin: req.get("x-gn-client") };
  }

  function slotOf(state: S, raw: unknown, res: Response): CashPlayer | null {
    const slot = state.roster.find((p) => p.id === String(raw ?? ""));
    if (!slot) {
      res.status(404).json({ error: "Player not in session" });
      return null;
    }
    return slot;
  }

  // ---------- launch context + reads ----------

  router.get(`/${seg}-context/:eventId`, requireAuth, async (req: AuthedRequest, res) => {
    const ctx = await rt.launchContext(String(req.params.eventId), req.user!.id);
    if (!ctx) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.json(ctx);
  });

  router.get(`/${seg}/:eventId`, requireAuth, async (req: AuthedRequest, res) => {
    const eventId = String(req.params.eventId);
    const loaded = await rt.loadState(eventId);
    if (loaded && !(await roleOf(loaded.row.groupId, req.user!.id))) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Reuse the row the role check just read instead of selecting it twice.
    await rt.respondState(eventId, res, loaded);
  });

  // ---------- host: open the table ----------

  router.post(`/events/:eventId/${seg}`, requireAuth, async (req: AuthedRequest, res) => {
    const db = getDb();
    const eventId = String(req.params.eventId);
    const event = (await db.select().from(events).where(eq(events.id, eventId)).limit(1))[0];
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    if (!isHostRole(await roleOf(event.groupId, req.user!.id))) {
      res.status(403).json({ error: "Only crew owners and admins can start a game" });
      return;
    }

    // Don't clobber a session already in progress (standing rule 8) unless the
    // host confirmed a replace (client resends force after a 409). "In
    // progress" for a cash game means money is on the table, so any recorded
    // buy-in counts, not just a cash-out.
    const existing = await rt.loadState(eventId);
    if (!req.body?.force && existing && existing.row.status !== "completed" && existing.state.entries.length > 0) {
      res.status(409).json({ error: "A session is already in progress for this event" });
      return;
    }

    const bank: CashBank = req.body?.bank === "casino" ? "casino" : "player";
    const defaultBuyIn = cents(req.body?.defaultBuyIn) ?? 2000;

    const rawRoster = Array.isArray(req.body?.roster) ? req.body.roster : [];
    const roster: CashPlayer[] = rawRoster
      .map((p: any, i: number): CashPlayer => {
        const name = String(p?.name ?? "").trim().slice(0, 24);
        const userId = typeof p?.userId === "string" ? p.userId : null;
        return { id: `p${i}_${Math.random().toString(36).slice(2, 8)}`, kind: userId ? "member" : "guest", userId, name };
      })
      .filter((p: CashPlayer) => p.name.length > 0)
      .slice(0, MAX_PLAYERS);

    // A player-banked table needs at least two people (the banker and somebody
    // to play against); a casino-banked one needs one, because the house is
    // not on the roster.
    const minPlayers = bank === "player" ? 2 : 1;
    if (roster.length < minPlayers) {
      res.status(400).json({
        error:
          bank === "player"
            ? "A player-banked table needs the banker plus at least one player"
            : "Add at least 1 player",
      });
      return;
    }

    // The banker arrives as an INDEX into the roster the client just sent,
    // because the slot ids are minted here and the client has not seen them.
    let bankerId: string | null = null;
    if (bank === "player") {
      const idx = Number(req.body?.bankerIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= roster.length) {
        res.status(400).json({ error: "Pick who is banking" });
        return;
      }
      bankerId = roster[idx]!.id;
    }

    // PER-PLAYER OPENING BUY-INS, keyed by index for the same reason. Only the
    // seats the host deliberately overrode arrive here; everyone else takes
    // the table default, so changing that default before starting still moves
    // them. A table where the banker puts up $300 and everyone else sits down
    // with $20 is the normal case, not an edge one.
    const buyIns: Record<string, number> = {};
    const rawBuyIns = req.body?.buyIns;
    if (rawBuyIns && typeof rawBuyIns === "object") {
      for (const [k, v] of Object.entries(rawBuyIns as Record<string, unknown>)) {
        const idx = Number(k);
        const amount = cents(v);
        if (Number.isInteger(idx) && idx >= 0 && idx < roster.length && amount !== null) {
          buyIns[roster[idx]!.id] = amount;
        }
      }
    }

    const state = cfg.newState({
      bank,
      bankerId,
      roster,
      defaultBuyIn,
      buyIns,
      tracker: !!req.body?.tracker,
    });
    res.json(await rt.startSession(eventId, event.groupId, state, req.get("x-gn-client")));
  });

  // ---------- money in ----------

  // Correct an opening buy-in. Separate from a rebuy on purpose: a rebuy is a
  // second amount on the table, this is "I typed 20 and it was 40".
  router.post(`/${seg}/:eventId/buy-in`, requireAuth, async (req: AuthedRequest, res) => {
    const g = await scorer(req, res);
    if (!g) return;
    const slot = slotOf(g.loaded.state, req.body?.playerId, res);
    if (!slot) return;
    const amount = cents(req.body?.amount);
    if (amount === null) {
      res.status(400).json({ error: "Enter a buy-in amount" });
      return;
    }
    const entry = g.loaded.state.entries.find((e) => e.playerId === slot.id);
    if (entry) entry.buyIn = amount;
    else g.loaded.state.entries.push({ playerId: slot.id, buyIn: amount, rebuys: [], cashOut: null, at: null });
    res.json(await rt.saveState(g.loaded, "live", g.origin));
  });

  // One tap adds another buy-in amount. The amount is optional and defaults to
  // the table's, which is what makes it one tap at a card table.
  router.post(`/${seg}/:eventId/rebuy`, requireAuth, async (req: AuthedRequest, res) => {
    const g = await scorer(req, res);
    if (!g) return;
    const slot = slotOf(g.loaded.state, req.body?.playerId, res);
    if (!slot) return;
    const amount = cents(req.body?.amount) ?? g.loaded.state.defaultBuyIn;
    const entry = g.loaded.state.entries.find((e) => e.playerId === slot.id);
    if (!entry) {
      res.status(409).json({ error: "That player has not bought in yet" });
      return;
    }
    if (entry.rebuys.length >= MAX_REBUYS) {
      res.status(400).json({ error: "That is a lot of rebuys. Correct the buy-in instead." });
      return;
    }
    entry.rebuys.push(amount);
    res.json(await rt.saveState(g.loaded, "live", g.origin));
  });

  // A mis-tapped rebuy. Drops the LAST one, because that is the one just
  // tapped and the only one anyone can identify without a list.
  router.post(`/${seg}/:eventId/undo-rebuy`, requireAuth, async (req: AuthedRequest, res) => {
    const g = await scorer(req, res);
    if (!g) return;
    const slot = slotOf(g.loaded.state, req.body?.playerId, res);
    if (!slot) return;
    const entry = g.loaded.state.entries.find((e) => e.playerId === slot.id);
    if (!entry || entry.rebuys.length === 0) {
      res.json({ ...rt.viewOf(g.loaded), empty: true });
      return;
    }
    entry.rebuys.pop();
    res.json(await rt.saveState(g.loaded, "live", g.origin));
  });

  // A late arrival. Cash games are not fixed rosters: somebody turns up at
  // eleven and sits down, and a pack that could not take them would push the
  // host into a second session for one person.
  router.post(`/${seg}/:eventId/add-player`, requireAuth, async (req: AuthedRequest, res) => {
    const g = await scorer(req, res);
    if (!g) return;
    const state = g.loaded.state;
    if (state.roster.length >= MAX_PLAYERS) {
      res.status(400).json({ error: `A table tops out at ${MAX_PLAYERS} players` });
      return;
    }
    const name = String(req.body?.name ?? "").trim().slice(0, 24);
    if (!name) {
      res.status(400).json({ error: "Enter a name" });
      return;
    }
    const userId = typeof req.body?.userId === "string" ? req.body.userId : null;
    if (userId && state.roster.some((p) => p.userId === userId)) {
      res.status(409).json({ error: "That player is already at the table" });
      return;
    }
    const id = `p${state.roster.length}_${Math.random().toString(36).slice(2, 8)}`;
    state.roster.push({ id, kind: userId ? "member" : "guest", userId, name });
    state.entries.push({
      playerId: id,
      buyIn: cents(req.body?.buyIn) ?? state.defaultBuyIn,
      rebuys: [],
      cashOut: null,
      at: null,
    });
    res.json(await rt.saveState(g.loaded, "live", g.origin));
  });

  // ---------- money out ----------

  router.post(`/${seg}/:eventId/cash-out`, requireAuth, async (req: AuthedRequest, res) => {
    const g = await scorer(req, res);
    if (!g) return;
    const state = g.loaded.state;
    const slot = slotOf(state, req.body?.playerId, res);
    if (!slot) return;
    const amount = cents(req.body?.cashOut);
    if (amount === null) {
      res.status(400).json({ error: "Enter what they cashed out for (0 if they busted)" });
      return;
    }
    const entry = state.entries.find((e) => e.playerId === slot.id);
    if (!entry) {
      res.status(409).json({ error: "That player has not bought in yet" });
      return;
    }
    entry.cashOut = amount;
    entry.at = new Date().toISOString();
    cfg.applyDetail(state, slot.id, (req.body ?? {}) as Record<string, unknown>);
    res.json(await rt.saveState(g.loaded, "live", g.origin));
  });

  // Somebody sat back down. Clears the cash-out so their chips are on the
  // table again; nothing was materialized, so there is nothing to retract.
  router.post(`/${seg}/:eventId/reopen`, requireAuth, async (req: AuthedRequest, res) => {
    const g = await scorer(req, res);
    if (!g) return;
    const slot = slotOf(g.loaded.state, req.body?.playerId, res);
    if (!slot) return;
    const entry = g.loaded.state.entries.find((e) => e.playerId === slot.id);
    if (!entry) {
      res.status(404).json({ error: "Player not in session" });
      return;
    }
    entry.cashOut = null;
    entry.at = null;
    res.json(await rt.saveState(g.loaded, "live", g.origin));
  });

  // ---------- host toggles ----------

  router.post(`/${seg}/:eventId/tracker`, requireAuth, async (req: AuthedRequest, res) => {
    const g = await host(req, res);
    if (!g) return;
    // Flipping the tracker off KEEPS the events already recorded: they are
    // what the pack's details are derived from, and deleting them would
    // silently lose stats the host had already collected.
    g.loaded.state.tracker = !!req.body?.on;
    res.json(await rt.saveState(g.loaded, g.loaded.row.status, g.origin));
  });

  router.post(`/${seg}/:eventId/open-scoring`, requireAuth, async (req: AuthedRequest, res) => {
    const g = await host(req, res);
    if (!g) return;
    g.loaded.state.openScoring = !!req.body?.open;
    res.json(await rt.saveState(g.loaded, g.loaded.row.status, g.origin));
  });

  router.post(`/${seg}/:eventId/default-buy-in`, requireAuth, async (req: AuthedRequest, res) => {
    const g = await host(req, res);
    if (!g) return;
    const amount = cents(req.body?.amount);
    if (amount === null) {
      res.status(400).json({ error: "Enter an amount" });
      return;
    }
    g.loaded.state.defaultBuyIn = amount;
    res.json(await rt.saveState(g.loaded, g.loaded.row.status, g.origin));
  });

  // ---------- end the night ----------

  /**
   * THE BALANCE CHECK IS A WARNING, NOT A VETO. On a player-banked table the
   * host is told the exact figure the table is off by and can still record it,
   * because this app records what a home game did rather than refereeing one.
   * What it must never do is materialize numbers it already knows disagree
   * WITHOUT saying so, hence the 409-then-force.
   */
  router.post(`/${seg}/:eventId/complete`, requireAuth, async (req: AuthedRequest, res) => {
    const g = await host(req, res);
    if (!g) return;
    const { loaded, origin } = g;
    const eventId = loaded.row.eventId;
    const state = loaded.state;

    const settlement = settleCash(state, { final: true });
    if (!req.body?.force && settlement.balance.checked && !settlement.balance.balanced) {
      res.status(409).json({
        error: "The table does not balance",
        balance: settlement.balance,
        summary: cfg.summarize(state),
      });
      return;
    }

    const gameId = await rt.ensureGame(loaded.row.groupId);
    const report = await materialize(loaded.row.groupId, eventId, gameId, state);
    const view = await rt.saveState(loaded, "completed", origin);
    broadcast({ type: "leaderboard_updated", eventId }, origin);
    res.json({ ...view, ...report, balance: settlement.balance });
  });

  // ---------- lifetime crew stats ----------

  router.get(`/groups/:id/${seg}-stats`, requireAuth, async (req: AuthedRequest, res) => {
    const groupId = String(req.params.id);
    if (!(await roleOf(groupId, req.user!.id))) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    res.json(await cashLifetimeStats(groupId, def.ledger));
  });

  return { scorer, host, slotOf, materialize, guestNames, creditGuest };
}

// ---------- the free stats, shared by all four packs ----------
//
// Every number here is derived from the BUY-IN AND THE CASH-OUT ALONE, which
// is the design promise of the whole group: a night played the minimal-input
// way, with the tracker off, still produces all of it. The pack's own detail
// stats are the only extras, and each is absent rather than zero when nobody
// answered.

export interface CashMeta {
  net?: number;
  buyIn?: number;
  totalIn?: number;
  cashOut?: number;
  rebuys?: number;
  bank?: string;
  banker?: boolean;
  minutes?: number;
  [k: string]: unknown;
}

export interface CashLifetimeRow {
  userId: string;
  name: string;
  sessions: number;
  net: number;
  staked: number;
  avgBuyIn: number;
  avgNet: number;
  winRate: number;
  upNights: number;
  roi: number | null;
  rebuys: number;
  rebuyRate: number;
  best: number | null;
  worst: number | null;
  streak: number;
  bestStreak: number;
  minutes: number;
  netPerHour: number | null;
  banked: number;
  /** Every meta bag this player's rows carried, for the pack's own extras. */
  metas: CashMeta[];
}

export async function cashLifetimeStats(
  groupId: string,
  ledgerKey: string,
): Promise<{ sessions: number; byPlayer: CashLifetimeRow[] }> {
  const db = getDb();
  const game = (
    await db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.groupId, groupId), eq(games.pack, ledgerKey)))
      .limit(1)
  )[0];
  if (!game) return { sessions: 0, byPlayer: [] };

  const rows = await db
    .select({
      userId: matchParticipants.userId,
      displayName: users.displayName,
      meta: matchParticipants.meta,
      matchId: matchParticipants.matchId,
      playedAt: matches.playedAt,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(users, eq(matchParticipants.userId, users.id))
    .where(and(eq(matches.groupId, groupId), eq(matches.gameId, game.id), eq(matches.status, "completed")));

  const sessionIds = new Set<string>();
  const byUser = new Map<
    string,
    { userId: string; name: string; nights: { at: number; meta: CashMeta }[]; banked: number }
  >();

  for (const r of rows) {
    sessionIds.add(r.matchId);
    const m = (r.meta as CashMeta | null) ?? {};
    const p = byUser.get(r.userId) ?? { userId: r.userId, name: r.displayName, nights: [], banked: 0 };
    p.nights.push({ at: r.playedAt ? new Date(r.playedAt).getTime() : 0, meta: m });
    if (m.banker) p.banked++;
    byUser.set(r.userId, p);
  }

  const byPlayer = [...byUser.values()]
    .map((p) => {
      // Oldest first, so the streak walk below ends on the CURRENT run.
      const nights = [...p.nights].sort((a, b) => a.at - b.at);
      const sessions = nights.length;
      let net = 0;
      let staked = 0;
      let rebuys = 0;
      let nightsWithRebuy = 0;
      let up = 0;
      let minutes = 0;
      let best: number | null = null;
      let worst: number | null = null;
      let streak = 0;
      let bestStreak = 0;
      for (const n of nights) {
        const v = n.meta.net ?? 0;
        net += v;
        staked += n.meta.totalIn ?? n.meta.buyIn ?? 0;
        rebuys += n.meta.rebuys ?? 0;
        if ((n.meta.rebuys ?? 0) > 0) nightsWithRebuy++;
        if (v > 0) {
          up++;
          streak++;
          if (streak > bestStreak) bestStreak = streak;
        } else {
          // A break-even night ends a winning streak: the streak counts nights
          // finishing UP, and even is not up.
          streak = 0;
        }
        if (best === null || v > best) best = v;
        if (worst === null || v < worst) worst = v;
        if (n.meta.minutes) minutes += n.meta.minutes;
      }
      return {
        userId: p.userId,
        name: p.name,
        sessions,
        net,
        staked,
        avgBuyIn: sessions ? Math.round(staked / sessions) : 0,
        avgNet: sessions ? Math.round(net / sessions) : 0,
        winRate: sessions ? up / sessions : 0,
        upNights: up,
        // ROI as net over everything ever put on the table. Null rather than a
        // divide-by-zero when somebody has only ever played for nothing.
        roi: staked ? net / staked : null,
        rebuys,
        rebuyRate: sessions ? nightsWithRebuy / sessions : 0,
        best,
        worst,
        streak,
        bestStreak,
        minutes,
        // Cents per hour. Null when no night recorded a length, which is every
        // night played before the pack started storing one.
        netPerHour: minutes ? Math.round((net * 60) / minutes) : null,
        banked: p.banked,
        metas: nights.map((n) => n.meta),
      };
    })
    .sort((a, b) => b.net - a.net || b.sessions - a.sessions);

  return { sessions: sessionIds.size, byPlayer };
}

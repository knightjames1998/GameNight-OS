// Blackjack pack server routes. The first pack of the CASINO GROUP
// (blackjack, roulette, craps, poker), and the one that proves the shared
// cash-game engine.
//
// The plumbing (session load/save, ledger keys, game row, launch context,
// broadcast) comes from pack-runtime.ts. The MONEY comes from
// packages/shared/src/cashgame.ts, which is pure and fully unit tested; this
// file validates requests, holds the session together and writes the ledger.
//
// THE LEDGER UNIT IS THE SESSION, not the hand. One completed night writes ONE
// matches row and one match_participants row per player, with placement
// derived by ranking net descending. That is the whole reason this pack needs
// no schema change and no change to stats.ts: a cash night looks exactly like
// any other night to every reader in the app. Money rides in
// match_participants.meta; `character` stays null.
//
// EVERY AMOUNT IN THIS FILE IS INTEGER CENTS. The client parses typed dollars
// into cents before it posts, and cents() below refuses anything else, so a
// float can never reach the state jsonb or the ledger. See the header of
// cashgame.ts for why that matters more here than it sounds.

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
  bjDetail,
  cashLedgerLines,
  formatCentsSigned,
  handPayout,
  newBlackjackState,
  settleCash,
  summarizeBlackjack,
  type BjHand,
  type BjHandResult,
  type BjSessionState,
  type CashBank,
  type CashPlayer,
  SESSION_PACKS,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { createPackRuntime, packConfig, roleOf, isHostRole, type LedgerLine } from "./pack-runtime.js";
import { broadcast } from "./ws.js";
import { memberCreditedKeys, type GuestCreditResult } from "./guest-link-util.js";

/** The ledger spelling, from the one registry (packages/shared/src/packs.ts). */
const PACK = SESSION_PACKS.blackjack.ledger;

/** A table that big stops being a game and starts being a data-entry error. */
const MAX_PLAYERS = 12;
/** $100,000 in cents. A ceiling, not a rule: it exists to catch a fat finger. */
const MAX_AMOUNT = 10_000_000;

export const blackjackRouter = Router();
export const blackjackTvRouter = Router();

export const blackjackRuntime = createPackRuntime<BjSessionState>({
  ...packConfig("blackjack"),
  extras: (state) => ({ summary: summarizeBlackjack(state) }),
});

const rt = blackjackRuntime;

/**
 * Coerce a request field to integer cents, or null if it is not one.
 *
 * The client sends cents already (it parses the typed dollars with the shared
 * parseCents), so this is the boundary that makes "money is integer cents"
 * true of the SERVER rather than merely true of the client. A float arriving
 * here is rejected outright rather than rounded: rounding would hide a client
 * that had started doing dollar arithmetic, which is precisely the regression
 * the whole design is guarding against.
 */
function cents(raw: unknown, opts?: { allowNegative?: boolean }): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (Math.abs(n) > MAX_AMOUNT) return null;
  if (n < 0 && !opts?.allowNegative) return null;
  return n;
}

// ---------- ledger ----------

/**
 * Materialize the whole SESSION as one recorded unit.
 *
 * idx 0 and the sessionKey together make the key
 * blackjack:{eventId}:{sessionKey}:0, so a second blackjack night on the same
 * recurring event gets its own key rather than being dropped as a duplicate
 * of the first.
 *
 * Placement comes from settleCash, which ranks by net descending with
 * co-placements at competition ranking. `final: true` is what turns a player
 * who never cashed out into a bust (cash-out zero) — live, that is deliberately
 * "unknown", and only recording the night forces the answer.
 */
async function materializeSession(
  groupId: string,
  eventId: string,
  gameId: string,
  state: BjSessionState,
  linkMap?: Map<string, string>, // guest display name -> member userId (backfill)
): Promise<{ recorded: number; guests: number }> {
  const settlement = settleCash(state, { final: true });
  const minutes = sessionMinutes(state);

  // `character` is left undefined rather than null, which keeps the column out
  // of the insert entirely: it stays null for every casino pack, because
  // nobody plays blackjack as Fox.
  const lines: LedgerLine[] = cashLedgerLines(settlement, state.bank, state.bankerId, (playerId) => {
    const d = bjDetail(state, playerId);
    return {
      biggestBet: d.biggestBet,
      biggestWin: d.biggestWin,
      blackjacks: d.blackjacks,
      hands: state.hands.length ? state.hands.filter((h) => h.playerId === playerId).length : null,
      // Net per hour needs the night's LENGTH, and matches.playedAt is only
      // the end of it. Stored per row so the read layer never has to guess.
      minutes,
    };
  });

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

/** Minutes of play, from the session's own clock. Null if it makes no sense. */
function sessionMinutes(state: BjSessionState): number | null {
  const start = Date.parse(state.startedAt);
  if (!Number.isFinite(start)) return null;
  const mins = Math.round((Date.now() - start) / 60000);
  return mins > 0 ? mins : null;
}

// ---------- guest -> member backfill (see guest-link.ts) ----------

/** Distinct guest display names across this crew's blackjack sessions. */
export async function guestNamesBlackjack(groupId: string): Promise<string[]> {
  return rt.guestNames(groupId, (state) => state.roster);
}

/**
 * Credit (or preview) every completed blackjack night the guest played.
 *
 * One night is one row, so unlike the game-as-unit packs there is exactly one
 * item per session. A session that never completed wrote nothing and has
 * nothing to credit, which is why the state's own cash-outs are not enough on
 * their own — the existence of the ledger row is the test, and materializeUnit
 * reopens the row that exists rather than creating one.
 */
export async function creditGuestBlackjack(
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
      pack: PACK,
      packLabel: SESSION_PACKS.blackjack.name,
      eventId,
      // formatCentsSigned, not hand-rolled division: dollars exist only at the
      // edges, and this string IS an edge.
      label: `net ${formatCentsSigned(line.net ?? 0)}`,
      date: state.entries.find((e) => slots.has(e.playerId))?.at ?? null,
      placement: line.placement,
      isWinner: line.isWinner,
    });

    if (!dryRun) {
      gameId = gameId ?? (await rt.ensureGame(groupId));
      await materializeSession(groupId, eventId, gameId, state, linkMap);
    }
  }
  return { items, written: dryRun ? 0 : items.length };
}

// ---------- launch context ----------

blackjackRouter.get("/blackjack-context/:eventId", requireAuth, async (req: AuthedRequest, res) => {
  const ctx = await rt.launchContext(String(req.params.eventId), req.user!.id);
  if (!ctx) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(ctx);
});

// ---------- read live state ----------

blackjackRouter.get("/blackjack/:eventId", requireAuth, async (req: AuthedRequest, res) => {
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
blackjackTvRouter.get("/blackjack/:eventId", async (req, res) => {
  await rt.respondState(String(req.params.eventId), res);
});

// ---------- host: start ----------

blackjackRouter.post("/events/:eventId/blackjack", requireAuth, async (req: AuthedRequest, res) => {
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
  // host confirmed a replace (client resends force after a 409). "In progress"
  // for a cash game means money is on the table, so any recorded buy-in
  // counts, not just a cash-out.
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

  // A player-banked table needs at least two people (the banker and someone
  // to play against); a casino-banked one only needs one player, because the
  // house is not on the roster.
  const minPlayers = bank === "player" ? 2 : 1;
  if (roster.length < minPlayers) {
    res.status(400).json({
      error: bank === "player" ? "A player-banked table needs the banker plus at least one player" : "Add at least 1 player",
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

  // Per-player opening buy-ins, also keyed by index for the same reason.
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

  const state = newBlackjackState({
    bank,
    bankerId,
    roster,
    defaultBuyIn,
    buyIns,
    tracker: !!req.body?.tracker,
  });
  res.json(await rt.startSession(eventId, event.groupId, state, req.get("x-gn-client")));
});

// ---------- shared guards ----------

type Ok = { loaded: NonNullable<Awaited<ReturnType<typeof rt.loadState>>>; origin: string | undefined };

/** Load + role check for a route that anyone allowed to score may call. */
async function scorer(req: AuthedRequest, res: import("express").Response): Promise<Ok | null> {
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

/** Load + host-only check, for the controls that are never opened up. */
async function host(req: AuthedRequest, res: import("express").Response): Promise<Ok | null> {
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

/** The roster slot for a posted playerId, or null (and a 404 already sent). */
function slotOf(state: BjSessionState, raw: unknown, res: import("express").Response) {
  const slot = state.roster.find((p) => p.id === String(raw ?? ""));
  if (!slot) {
    res.status(404).json({ error: "Player not in session" });
    return null;
  }
  return slot;
}

// ---------- money in ----------

// Correct an opening buy-in. Separate from a rebuy on purpose: a rebuy is a
// second amount on the table, this is "I typed 20 and it was 40".
blackjackRouter.post("/blackjack/:eventId/buy-in", requireAuth, async (req: AuthedRequest, res) => {
  const g = await scorer(req, res);
  if (!g) return;
  const { loaded, origin } = g;
  const slot = slotOf(loaded.state, req.body?.playerId, res);
  if (!slot) return;
  const amount = cents(req.body?.amount);
  if (amount === null) {
    res.status(400).json({ error: "Enter a buy-in amount" });
    return;
  }
  const entry = loaded.state.entries.find((e) => e.playerId === slot.id);
  if (entry) entry.buyIn = amount;
  else loaded.state.entries.push({ playerId: slot.id, buyIn: amount, rebuys: [], cashOut: null, at: null });
  res.json(await rt.saveState(loaded, "live", origin));
});

// One tap adds another buy-in amount. The amount is optional and defaults to
// the table's, which is what makes it one tap on a phone at a card table.
blackjackRouter.post("/blackjack/:eventId/rebuy", requireAuth, async (req: AuthedRequest, res) => {
  const g = await scorer(req, res);
  if (!g) return;
  const { loaded, origin } = g;
  const slot = slotOf(loaded.state, req.body?.playerId, res);
  if (!slot) return;
  const amount = cents(req.body?.amount) ?? loaded.state.defaultBuyIn;
  const entry = loaded.state.entries.find((e) => e.playerId === slot.id);
  if (!entry) {
    res.status(409).json({ error: "That player has not bought in yet" });
    return;
  }
  if (entry.rebuys.length >= 100) {
    res.status(400).json({ error: "That is a lot of rebuys. Correct the buy-in instead." });
    return;
  }
  entry.rebuys.push(amount);
  res.json(await rt.saveState(loaded, "live", origin));
});

// A mis-tapped rebuy. Drops the LAST one, because that is the one that was
// just tapped and the only one anyone can identify without a list.
blackjackRouter.post("/blackjack/:eventId/undo-rebuy", requireAuth, async (req: AuthedRequest, res) => {
  const g = await scorer(req, res);
  if (!g) return;
  const { loaded, origin } = g;
  const slot = slotOf(loaded.state, req.body?.playerId, res);
  if (!slot) return;
  const entry = loaded.state.entries.find((e) => e.playerId === slot.id);
  if (!entry || entry.rebuys.length === 0) {
    res.json({ ...rt.viewOf(loaded), empty: true });
    return;
  }
  entry.rebuys.pop();
  res.json(await rt.saveState(loaded, "live", origin));
});

// A late arrival. Cash games are not fixed rosters: somebody turns up at
// eleven and sits down, and a pack that could not take them would push the
// host into a second session for one person.
blackjackRouter.post("/blackjack/:eventId/add-player", requireAuth, async (req: AuthedRequest, res) => {
  const g = await scorer(req, res);
  if (!g) return;
  const { loaded, origin } = g;
  const state = loaded.state;
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
  res.json(await rt.saveState(loaded, "live", origin));
});

// ---------- money out ----------

/**
 * Cash a player out. The three blackjack details are optional numbers here
 * and prefilled from the tracker on the client when it was running, which is
 * the rule from the group design: the tracker being off must never lose a
 * stat the cash-out form could have captured.
 *
 * `null` on a detail means "not answered" and is stored as such rather than
 * as a zero, because a zero would drag a lifetime average down with a number
 * nobody entered.
 */
blackjackRouter.post("/blackjack/:eventId/cash-out", requireAuth, async (req: AuthedRequest, res) => {
  const g = await scorer(req, res);
  if (!g) return;
  const { loaded, origin } = g;
  const state = loaded.state;
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

  // Only overwrite a detail the form actually carried, so a cash-out edit
  // that leaves a box empty does not wipe what the tracker knows.
  const has = (k: string) => Object.prototype.hasOwnProperty.call(req.body ?? {}, k);
  if (has("biggestBet") || has("biggestWin") || has("blackjacks")) {
    const prev = state.detail[slot.id] ?? { biggestBet: null, biggestWin: null, blackjacks: null };
    const bj = req.body?.blackjacks;
    const bjn = bj === null || bj === undefined || bj === "" ? null : Number(bj);
    state.detail[slot.id] = {
      biggestBet: has("biggestBet") ? cents(req.body?.biggestBet) : prev.biggestBet,
      biggestWin: has("biggestWin") ? cents(req.body?.biggestWin) : prev.biggestWin,
      blackjacks: has("blackjacks")
        ? bjn !== null && Number.isInteger(bjn) && bjn >= 0 && bjn <= 999
          ? bjn
          : null
        : prev.blackjacks,
    };
  }

  res.json(await rt.saveState(loaded, "live", origin));
});

// Somebody sat back down. Clears the cash-out so their chips are on the table
// again; nothing was materialized, so there is nothing to retract.
blackjackRouter.post("/blackjack/:eventId/reopen", requireAuth, async (req: AuthedRequest, res) => {
  const g = await scorer(req, res);
  if (!g) return;
  const { loaded, origin } = g;
  const slot = slotOf(loaded.state, req.body?.playerId, res);
  if (!slot) return;
  const entry = loaded.state.entries.find((e) => e.playerId === slot.id);
  if (!entry) {
    res.status(404).json({ error: "Player not in session" });
    return;
  }
  entry.cashOut = null;
  entry.at = null;
  res.json(await rt.saveState(loaded, "live", origin));
});

// ---------- the live tracker (opt-in, off by default) ----------

blackjackRouter.post("/blackjack/:eventId/tracker", requireAuth, async (req: AuthedRequest, res) => {
  const g = await host(req, res);
  if (!g) return;
  const { loaded, origin } = g;
  // Flipping the tracker off keeps the hands already recorded: they are what
  // the biggest bet and blackjack count are derived from, and deleting them
  // would silently lose stats the host had already collected.
  loaded.state.tracker = !!req.body?.on;
  res.json(await rt.saveState(loaded, loaded.row.status, origin));
});

const HAND_RESULTS: BjHandResult[] = ["win", "lose", "push", "blackjack"];

blackjackRouter.post("/blackjack/:eventId/hand", requireAuth, async (req: AuthedRequest, res) => {
  const g = await scorer(req, res);
  if (!g) return;
  const { loaded, origin } = g;
  const state = loaded.state;
  if (!state.tracker) {
    res.status(409).json({ error: "The live tracker is off" });
    return;
  }
  const slot = slotOf(state, req.body?.playerId, res);
  if (!slot) return;
  const bet = cents(req.body?.bet);
  if (bet === null) {
    res.status(400).json({ error: "Enter the bet" });
    return;
  }
  const result = String(req.body?.result ?? "") as BjHandResult;
  if (!HAND_RESULTS.includes(result)) {
    res.status(400).json({ error: "result must be win, lose, push or blackjack" });
    return;
  }
  const hand: BjHand = { playerId: slot.id, bet, result, at: new Date().toISOString() };
  state.hands.push(hand);
  res.json({ ...(await rt.saveState(loaded, "live", origin)), payout: handPayout(hand) });
});

blackjackRouter.post("/blackjack/:eventId/undo-hand", requireAuth, async (req: AuthedRequest, res) => {
  const g = await scorer(req, res);
  if (!g) return;
  const { loaded, origin } = g;
  if (loaded.state.hands.length === 0) {
    res.json({ ...rt.viewOf(loaded), empty: true });
    return;
  }
  loaded.state.hands.pop();
  res.json(await rt.saveState(loaded, "live", origin));
});

// ---------- host toggles ----------

blackjackRouter.post("/blackjack/:eventId/open-scoring", requireAuth, async (req: AuthedRequest, res) => {
  const g = await host(req, res);
  if (!g) return;
  const { loaded, origin } = g;
  loaded.state.openScoring = !!req.body?.open;
  res.json(await rt.saveState(loaded, loaded.row.status, origin));
});

blackjackRouter.post("/blackjack/:eventId/default-buy-in", requireAuth, async (req: AuthedRequest, res) => {
  const g = await host(req, res);
  if (!g) return;
  const { loaded, origin } = g;
  const amount = cents(req.body?.amount);
  if (amount === null) {
    res.status(400).json({ error: "Enter an amount" });
    return;
  }
  loaded.state.defaultBuyIn = amount;
  res.json(await rt.saveState(loaded, loaded.row.status, origin));
});

// ---------- end the night ----------

/**
 * Settle and record.
 *
 * THE BALANCE CHECK IS A WARNING, NOT A VETO. On a player-banked table the
 * host is told the exact figure the table is off by and can still record it,
 * because this app records what a home game did — it does not referee one.
 * What it must never do is materialize numbers it already knows are wrong
 * WITHOUT saying so, which is why the first attempt answers 409 with the
 * delta and only a deliberate `force` writes.
 */
blackjackRouter.post("/blackjack/:eventId/complete", requireAuth, async (req: AuthedRequest, res) => {
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
      summary: summarizeBlackjack(state),
    });
    return;
  }

  const gameId = await rt.ensureGame(loaded.row.groupId);
  const report = await materializeSession(loaded.row.groupId, eventId, gameId, state);
  const view = await rt.saveState(loaded, "completed", origin);
  broadcast({ type: "leaderboard_updated", eventId }, origin);
  res.json({ ...view, ...report, balance: settlement.balance });
});

// ---------- lifetime crew stats ----------
//
// Everything here is derived from the buy-in and the cash-out alone, which is
// the design promise of the whole casino group: a night played with the
// tracker off, the minimal-input way, still produces every number below. The
// three blackjack details are the only extras, and each is null when nobody
// answered rather than zero.

interface CashMeta {
  net?: number;
  buyIn?: number;
  totalIn?: number;
  cashOut?: number;
  rebuys?: number;
  bank?: string;
  banker?: boolean;
  biggestBet?: number;
  biggestWin?: number;
  blackjacks?: number;
  minutes?: number;
}

blackjackRouter.get("/groups/:id/blackjack-stats", requireAuth, async (req: AuthedRequest, res) => {
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
    res.json({ sessions: 0, byPlayer: [] });
    return;
  }

  const rows = await db
    .select({
      userId: matchParticipants.userId,
      displayName: users.displayName,
      isWinner: matchParticipants.isWinner,
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
    { userId: string; name: string; nights: { at: number; net: number; totalIn: number; rebuys: number; minutes: number | null }[]; banked: number; biggestBet: number | null; biggestWin: number | null; blackjacks: number }
  >();

  for (const r of rows) {
    sessionIds.add(r.matchId);
    const m = (r.meta as CashMeta | null) ?? {};
    const p =
      byUser.get(r.userId) ??
      { userId: r.userId, name: r.displayName, nights: [], banked: 0, biggestBet: null, biggestWin: null, blackjacks: 0 };
    p.nights.push({
      at: r.playedAt ? new Date(r.playedAt).getTime() : 0,
      net: m.net ?? 0,
      totalIn: m.totalIn ?? m.buyIn ?? 0,
      rebuys: m.rebuys ?? 0,
      minutes: m.minutes ?? null,
    });
    if (m.banker) p.banked++;
    if (m.biggestBet != null && (p.biggestBet === null || m.biggestBet > p.biggestBet)) p.biggestBet = m.biggestBet;
    if (m.biggestWin != null && (p.biggestWin === null || m.biggestWin > p.biggestWin)) p.biggestWin = m.biggestWin;
    p.blackjacks += m.blackjacks ?? 0;
    byUser.set(r.userId, p);
  }

  const byPlayer = [...byUser.values()]
    .map((p) => {
      // Oldest first, so the streak walk below ends on the current run.
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
        net += n.net;
        staked += n.totalIn;
        rebuys += n.rebuys;
        if (n.rebuys > 0) nightsWithRebuy++;
        if (n.net > 0) {
          up++;
          streak++;
          if (streak > bestStreak) bestStreak = streak;
        } else {
          // A break-even night ends a winning streak: the streak is "nights
          // finishing UP", and even is not up.
          streak = 0;
        }
        if (best === null || n.net > best) best = n.net;
        if (worst === null || n.net < worst) worst = n.net;
        if (n.minutes) minutes += n.minutes;
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
        // ROI as net over everything ever put on the table. Null rather than
        // a divide-by-zero when somebody has only ever played for nothing.
        roi: staked ? net / staked : null,
        rebuys,
        rebuyRate: sessions ? nightsWithRebuy / sessions : 0,
        best,
        worst,
        streak,
        bestStreak,
        minutes,
        // Cents per hour, rounded to the cent. Null when no night recorded a
        // length, which is every night played before this shipped.
        netPerHour: minutes ? Math.round((net * 60) / minutes) : null,
        banked: p.banked,
        biggestBet: p.biggestBet,
        biggestWin: p.biggestWin,
        blackjacks: p.blackjacks,
      };
    })
    .sort((a, b) => b.net - a.net || b.sessions - a.sessions);

  res.json({ sessions: sessionIds.size, byPlayer });
});

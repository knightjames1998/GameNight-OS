// Blackjack pack server routes.
//
// Every route about MONEY — open the table, buy in, rebuy, seat a late
// arrival, cash out, reopen, the toggles, end the night, and the lifetime
// stats — lives in casino-runtime.ts and is shared with roulette (and craps
// and poker when they land). What is left here is what is actually blackjack:
// its state shape, its two tracker routes, its three detail stats, and the
// per-player meta its ledger row carries.
//
// The MONEY itself comes from packages/shared/src/cashgame.ts, which is pure
// and fully unit tested. THE LEDGER UNIT IS THE SESSION: one completed night
// is one matches row plus one match_participants row per player, placement
// derived by ranking net descending. That is why this pack needed no schema
// change and no change to stats.ts.

import { Router } from "express";
import {
  bjDetail,
  handPayout,
  newBlackjackState,
  summarizeBlackjack,
  type BjHand,
  type BjHandResult,
  type BjSessionState,
  SESSION_PACKS,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { createPackRuntime, packConfig } from "./pack-runtime.js";
import { cents, registerCasinoRoutes } from "./casino-runtime.js";

/** The ledger spelling, from the one registry (packages/shared/src/packs.ts). */
export const BLACKJACK_PACK = SESSION_PACKS.blackjack.ledger;

export const blackjackRouter = Router();
export const blackjackTvRouter = Router();

export const blackjackRuntime = createPackRuntime<BjSessionState>({
  ...packConfig("blackjack"),
  extras: (state) => ({ summary: summarizeBlackjack(state) }),
});

const rt = blackjackRuntime;

const casino = registerCasinoRoutes<BjSessionState>({
  key: "blackjack",
  runtime: rt,
  router: blackjackRouter,
  newState: (o) => newBlackjackState(o),
  summarize: (s) => summarizeBlackjack(s),
  ledgerMeta: (state, playerId) => {
    const d = bjDetail(state, playerId);
    return {
      biggestBet: d.biggestBet,
      biggestWin: d.biggestWin,
      blackjacks: d.blackjacks,
      hands: state.hands.length ? state.hands.filter((h) => h.playerId === playerId).length : null,
    };
  },
  /**
   * Only overwrite a detail the cash-out form actually CARRIED, so an edit
   * that leaves a box empty does not wipe what the tracker knows. And a typed
   * null still falls through to the derived value in bjDetail, which is what
   * makes "typed beats derived PER FIELD" true.
   */
  applyDetail: (state, playerId, body) => {
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
    if (!has("biggestBet") && !has("biggestWin") && !has("blackjacks")) return;
    const prev = state.detail[playerId] ?? { biggestBet: null, biggestWin: null, blackjacks: null };
    const bj = body.blackjacks;
    const bjn = bj === null || bj === undefined || bj === "" ? null : Number(bj);
    state.detail[playerId] = {
      biggestBet: has("biggestBet") ? cents(body.biggestBet) : prev.biggestBet,
      biggestWin: has("biggestWin") ? cents(body.biggestWin) : prev.biggestWin,
      blackjacks: has("blackjacks")
        ? bjn !== null && Number.isInteger(bjn) && bjn >= 0 && bjn <= 999
          ? bjn
          : null
        : prev.blackjacks,
    };
  },
  eventCount: (state) => state.hands.length,
});

// Public big-screen read. Event UUID is the access key. Mounted before the
// bare /api authed routers.
blackjackTvRouter.get("/blackjack/:eventId", async (req, res) => {
  await rt.respondState(String(req.params.eventId), res);
});

// ---------- the live tracker (opt-in, off by default) ----------
//
// The one genuinely pack-specific pair of routes: a blackjack hand is a bet
// and how it went, which is nothing like a roulette spin or a craps roll.

const HAND_RESULTS: BjHandResult[] = ["win", "lose", "push", "blackjack"];

blackjackRouter.post("/blackjack/:eventId/hand", requireAuth, async (req: AuthedRequest, res) => {
  const g = await casino.scorer(req, res);
  if (!g) return;
  const state = g.loaded.state;
  if (!state.tracker) {
    res.status(409).json({ error: "The live tracker is off" });
    return;
  }
  const slot = casino.slotOf(state, req.body?.playerId, res);
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
  res.json({ ...(await rt.saveState(g.loaded, "live", g.origin)), payout: handPayout(hand) });
});

blackjackRouter.post("/blackjack/:eventId/undo-hand", requireAuth, async (req: AuthedRequest, res) => {
  const g = await casino.scorer(req, res);
  if (!g) return;
  if (g.loaded.state.hands.length === 0) {
    res.json({ ...rt.viewOf(g.loaded), empty: true });
    return;
  }
  g.loaded.state.hands.pop();
  res.json(await rt.saveState(g.loaded, "live", g.origin));
});

// ---------- guest -> member backfill (see guest-link.ts) ----------

export const guestNamesBlackjack = casino.guestNames;
export const creditGuestBlackjack = casino.creditGuest;

// Roulette pack server routes.
//
// Read blackjack.ts next to this and the point of the casino group is the
// whole file: every money route is shared (casino-runtime.ts), every money
// RULE is shared and unit tested (packages/shared/src/cashgame.ts), and what
// is left is a state shape, two tracker routes and two detail stats.
//
// THE LEDGER UNIT IS THE SESSION, exactly as for blackjack: one completed
// night is one matches row plus one match_participants row per player, with
// placement derived by ranking net descending. No schema change, no change to
// stats.ts, and a roulette night reads as an ordinary night to the leaderboard,
// the rivalry pages and the recap card.

import { Router } from "express";
import {
  isRouletteBet,
  newRouletteState,
  rlDetail,
  spinPayout,
  summarizeRoulette,
  type RlSessionState,
  type RlSpin,
  SESSION_PACKS,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { createPackRuntime, packConfig } from "./pack-runtime.js";
import { cents, registerCasinoRoutes } from "./casino-runtime.js";

/** The ledger spelling, from the one registry (packages/shared/src/packs.ts). */
export const ROULETTE_PACK = SESSION_PACKS.roulette.ledger;

export const rouletteRouter = Router();
export const rouletteTvRouter = Router();

export const rouletteRuntime = createPackRuntime<RlSessionState>({
  ...packConfig("roulette"),
  extras: (state) => ({ summary: summarizeRoulette(state) }),
});

const rt = rouletteRuntime;

const casino = registerCasinoRoutes<RlSessionState>({
  key: "roulette",
  runtime: rt,
  router: rouletteRouter,
  newState: (o) => newRouletteState(o),
  summarize: (s) => summarizeRoulette(s),
  ledgerMeta: (state, playerId) => {
    const d = rlDetail(state, playerId);
    return {
      favouriteBet: d.favouriteBet,
      // Null when the tracker was off, and that is the honest answer: a
      // streak cannot be reconstructed from a cash-out, so it is absent
      // rather than a zero claiming the player never won twice running.
      bestStreak: d.bestStreak,
      spins: state.spins.length ? state.spins.filter((s) => s.playerId === playerId).length : null,
    };
  },
  /**
   * Only the favourite is typeable. There is deliberately NO box for the
   * streak: it is the group's one genuinely un-reconstructable stat, so
   * offering somewhere to type it would invite a guess into the ledger.
   */
  applyDetail: (state, playerId, body) => {
    if (!Object.prototype.hasOwnProperty.call(body, "favouriteBet")) return;
    const raw = body.favouriteBet;
    state.detail[playerId] = { favouriteBet: isRouletteBet(raw) ? raw : null };
  },
  eventCount: (state) => state.spins.length,
});

// Public big-screen read. Event UUID is the access key. Mounted before the
// bare /api authed routers.
rouletteTvRouter.get("/roulette/:eventId", async (req, res) => {
  await rt.respondState(String(req.params.eventId), res);
});

// ---------- the live tracker (opt-in, off by default) ----------
//
// A spin is a bet type, a stake and whether it came in. That is enough for
// both details AND for the screen to report what the spin paid, since the
// payout is a property of the bet type rather than something to type.

rouletteRouter.post("/roulette/:eventId/spin", requireAuth, async (req: AuthedRequest, res) => {
  const g = await casino.scorer(req, res);
  if (!g) return;
  const state = g.loaded.state;
  if (!state.tracker) {
    res.status(409).json({ error: "The live tracker is off" });
    return;
  }
  const slot = casino.slotOf(state, req.body?.playerId, res);
  if (!slot) return;
  const stake = cents(req.body?.stake);
  if (stake === null) {
    res.status(400).json({ error: "Enter the stake" });
    return;
  }
  const bet = req.body?.bet;
  if (!isRouletteBet(bet)) {
    res.status(400).json({ error: "Pick a bet type" });
    return;
  }
  const spin: RlSpin = {
    playerId: slot.id,
    bet,
    stake,
    won: !!req.body?.won,
    at: new Date().toISOString(),
  };
  state.spins.push(spin);
  res.json({ ...(await rt.saveState(g.loaded, "live", g.origin)), payout: spinPayout(spin) });
});

rouletteRouter.post("/roulette/:eventId/undo-spin", requireAuth, async (req: AuthedRequest, res) => {
  const g = await casino.scorer(req, res);
  if (!g) return;
  if (g.loaded.state.spins.length === 0) {
    res.json({ ...rt.viewOf(g.loaded), empty: true });
    return;
  }
  g.loaded.state.spins.pop();
  res.json(await rt.saveState(g.loaded, "live", g.origin));
});

// ---------- guest -> member backfill (see guest-link.ts) ----------

export const guestNamesRoulette = casino.guestNames;
export const creditGuestRoulette = casino.creditGuest;

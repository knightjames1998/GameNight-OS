// Poker pack server routes.
//
// Every route about MONEY (open the table, buy in, rebuy, seat a late arrival,
// cash out, reopen, the toggles, end the night, and the lifetime stats) lives
// in casino-runtime.ts and is shared with blackjack, roulette and craps. What
// is left here is what is actually poker: the variant on the table, the
// dealer's-choice rotation, and the per-player meta its ledger row carries.
//
// THE BANK IS PINNED, NOT CHOSEN. `fixedBank: "table"` means the open route
// ignores `bank` and `bankerIndex` on the request entirely. A poker table has
// no house, so a request that asked for a player-banked one would be asking the
// engine to derive somebody's net from the rest of the table, and the person it
// derived was never the other side of every hand. See the CashBank union.
//
// THE SETTLEMENT IS THE FEATURE. See packages/shared/src/poker.ts.

import { Router } from "express";
import {
  POKER_VARIANTS,
  SESSION_PACKS,
  canonicalVariant,
  dealtBy,
  newPokerState,
  pokerCurrentDealer,
  pokerRecordGame,
  pokerSetVariant,
  pokerUndoGame,
  settleCash,
  settleTransfers,
  summarizePoker,
  variantsPlayed,
  type PokerSessionState,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { createPackRuntime, packConfig } from "./pack-runtime.js";
import { registerCasinoRoutes } from "./casino-runtime.js";

/** The ledger spelling, from the one registry (packages/shared/src/packs.ts). */
export const POKER_PACK = SESSION_PACKS.poker.ledger;

export const pokerRouter = Router();
export const pokerTvRouter = Router();

/**
 * THE PAYLOAD CARRIES THE SETTLEMENT, not just the money board.
 *
 * `transfers` is null until the table balances, which is exactly the contract
 * settleTransfers has: a list derived from a wrong number would be the app
 * inventing a debt. Both screens read it and neither computes it, so a phone
 * and a television can never disagree about who owes whom.
 */
export const pokerRuntime = createPackRuntime<PokerSessionState>({
  ...packConfig("poker"),
  extras: (state) => ({
    summary: summarizePoker(state),
    dealer: pokerCurrentDealer(state),
    variants: variantsPlayed(state),
    transfers: settleTransfers(settleCash(state)),
  }),
});

const rt = pokerRuntime;

const casino = registerCasinoRoutes<PokerSessionState>({
  key: "poker",
  runtime: rt,
  router: pokerRouter,
  fixedBank: "table",
  // Not the shared "cash": see the format's note in packages/shared/src/formats.ts
  // for why poker's two formats have to be separable from each other.
  format: "poker:cash",
  newState: (o) =>
    newPokerState({
      stakes: o.stakes,
      roster: o.roster,
      defaultBuyIn: o.defaultBuyIn,
      buyIns: o.buyIns,
      // The shared open route has no poker fields on it, so the rotation starts
      // off and the host turns it on from the table. That is one fewer decision
      // on a setup screen for something that is changed mid-night anyway.
      dealersChoice: false,
    }),
  summarize: (s) => summarizePoker(s),
  /**
   * What a poker row carries beyond the money.
   *
   * The variants are the night's, not the player's, and they are on every
   * participant row for the same reason the modifier ids are: the lifetime read
   * groups by player, so "how do I do at Omaha" needs the variant beside the
   * player's net rather than joined back in from the match.
   */
  ledgerMeta: (state, playerId) => ({
    dealt: state.games.length ? dealtBy(state, playerId) : null,
    games: state.games.length || null,
    variants: state.games.length ? variantsPlayed(state).map((v) => v.variant) : null,
  }),
  // Nothing to type on the cash-out form: this pack records no per-player
  // detail a host could correct. The dealt count comes from the rotation.
  applyDetail: () => {},
  eventCount: (state) => state.games.length,
});

// Public big-screen read. Event UUID is the access key. Mounted before the
// bare /api authed routers.
pokerTvRouter.get("/poker/:eventId", async (req, res) => {
  await rt.respondState(String(req.params.eventId), res);
});

// ---------- the variant on the table, and the deal ----------
//
// The pack's own routes, and the whole of standing rule 9's answer for poker:
// a repeatable interaction specific to this game rather than a tournament
// format in a new skin.

pokerRouter.post("/poker/:eventId/variant", requireAuth, async (req: AuthedRequest, res) => {
  const g = await casino.scorer(req, res);
  if (!g) return;
  const raw = String(req.body?.variant ?? "");
  const name = canonicalVariant(raw);
  if (!name) {
    res.status(400).json({ error: "Pick or type a variant" });
    return;
  }
  pokerSetVariant(g.loaded.state, name);
  res.json(await rt.saveState(g.loaded, "live", g.origin));
});

pokerRouter.post("/poker/:eventId/game", requireAuth, async (req: AuthedRequest, res) => {
  const g = await casino.scorer(req, res);
  if (!g) return;
  const game = pokerRecordGame(g.loaded.state, new Date().toISOString());
  if (!game) {
    res.status(400).json({ error: "Put a variant on the table first" });
    return;
  }
  res.json(await rt.saveState(g.loaded, "live", g.origin));
});

pokerRouter.post("/poker/:eventId/undo-game", requireAuth, async (req: AuthedRequest, res) => {
  const g = await casino.scorer(req, res);
  if (!g) return;
  if (g.loaded.state.games.length === 0) {
    res.json({ ...rt.viewOf(g.loaded), empty: true });
    return;
  }
  pokerUndoGame(g.loaded.state);
  res.json(await rt.saveState(g.loaded, "live", g.origin));
});

pokerRouter.post("/poker/:eventId/dealers-choice", requireAuth, async (req: AuthedRequest, res) => {
  const g = await casino.scorer(req, res);
  if (!g) return;
  const state = g.loaded.state;
  state.dealersChoice = !!req.body?.on;
  // The rotation restarts at the top of the roster rather than resuming from
  // wherever it was left, because a host turning it back on mid-night means
  // "start passing the deal from here", not "remember an index nobody saw".
  if (state.dealersChoice) state.dealerIdx = 0;
  res.json(await rt.saveState(g.loaded, "live", g.origin));
});

/** The starter list the picker offers. Free typing is still allowed. */
pokerRouter.get("/poker/variants", requireAuth, async (_req, res) => {
  res.json({ variants: [...POKER_VARIANTS] });
});

// ---------- guest -> member backfill (see guest-link.ts) ----------

export const guestNamesPoker = casino.guestNames;
export const creditGuestPoker = casino.creditGuest;

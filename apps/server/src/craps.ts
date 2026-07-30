// Craps pack server routes.
//
// Every route about money is shared (casino-runtime.ts) and every money RULE is
// shared and unit tested (packages/shared/src/cashgame.ts), so what is here is
// the state shape, the shooter's four tracker routes, and four detail stats.
// This is the third pack on that stack and the shortest of the three.
//
// THE LEDGER UNIT IS THE SESSION, as for blackjack and roulette: one completed
// night is one matches row plus one match_participants row per player, with
// placement derived by ranking net descending. No schema change.

import { Router } from "express";
import {
  crDetail,
  crapsRecord,
  crapsSetShooter,
  crapsUndo,
  newCrapsState,
  summarizeCraps,
  type CrEventKind,
  type CrSessionState,
  SESSION_PACKS,
} from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { createPackRuntime, packConfig } from "./pack-runtime.js";
import { cents, registerCasinoRoutes } from "./casino-runtime.js";

/** The ledger spelling, from the one registry (packages/shared/src/packs.ts). */
export const CRAPS_PACK = SESSION_PACKS.craps.ledger;

export const crapsRouter = Router();
export const crapsTvRouter = Router();

export const crapsRuntime = createPackRuntime<CrSessionState>({
  ...packConfig("craps"),
  extras: (state) => ({ summary: summarizeCraps(state) }),
});

const rt = crapsRuntime;

/** A count off the cash-out form: a whole number, or null for "not answered". */
function count(raw: unknown, max = 9999): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

const casino = registerCasinoRoutes<CrSessionState>({
  key: "craps",
  runtime: rt,
  router: crapsRouter,
  newState: (o) => newCrapsState(o),
  summarize: (s) => summarizeCraps(s),
  ledgerMeta: (state, playerId) => {
    // includeOpen: the night is over, so the hand that was in progress is a
    // hand that happened. Live reads exclude it so the TV's "to beat" number
    // stays a real target — see crDetail.
    const d = crDetail(state, playerId, { includeOpen: true });
    return {
      longestRoll: d.longestRoll,
      points: d.points,
      biggestBet: d.biggestBet,
      biggestWin: d.biggestWin,
      rolls: state.events.length ? state.events.filter((e) => e.playerId === playerId).length : null,
    };
  },
  /**
   * Only overwrite a field the cash-out form actually CARRIED, so an edit that
   * leaves a box empty does not wipe what the tracker knows. A typed null still
   * falls through to the derived value in crDetail, which is what makes "typed
   * beats derived PER FIELD" true.
   */
  applyDetail: (state, playerId, body) => {
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
    const keys = ["longestRoll", "points", "biggestBet", "biggestWin"];
    if (!keys.some(has)) return;
    const prev = state.detail[playerId] ?? {};
    state.detail[playerId] = {
      longestRoll: has("longestRoll") ? count(body.longestRoll) : prev.longestRoll,
      points: has("points") ? count(body.points) : prev.points,
      biggestBet: has("biggestBet") ? cents(body.biggestBet) : prev.biggestBet,
      biggestWin: has("biggestWin") ? cents(body.biggestWin) : prev.biggestWin,
    };
  },
  eventCount: (state) => state.events.length,
});

// Public big-screen read. Event UUID is the access key. Mounted before the
// bare /api authed routers.
crapsTvRouter.get("/craps/:eventId", async (req, res) => {
  await rt.respondState(String(req.params.eventId), res);
});

// ---------- the live tracker: the shooter's hand ----------
//
// Three taps at the table (roll / point made / seven out) plus handing the dice
// on. The hands are DERIVED from this log, never maintained, which is what
// makes undo correct by construction: dropping the last event reopens a closed
// hand on its own and the shooter comes straight off the event that was popped.

const KINDS: CrEventKind[] = ["roll", "point", "sevenOut", "pass"];

crapsRouter.post("/craps/:eventId/tap", requireAuth, async (req: AuthedRequest, res) => {
  const g = await casino.scorer(req, res);
  if (!g) return;
  const state = g.loaded.state;
  if (!state.tracker) {
    res.status(409).json({ error: "The live tracker is off" });
    return;
  }
  const kind = String(req.body?.kind ?? "") as CrEventKind;
  if (!KINDS.includes(kind)) {
    res.status(400).json({ error: "kind must be roll, point, sevenOut or pass" });
    return;
  }
  if (!crapsRecord(state, kind, new Date().toISOString())) {
    res.status(409).json({ error: "Nobody has the dice. Hand them to a player first." });
    return;
  }
  res.json(await rt.saveState(g.loaded, "live", g.origin));
});

crapsRouter.post("/craps/:eventId/undo-tap", requireAuth, async (req: AuthedRequest, res) => {
  const g = await casino.scorer(req, res);
  if (!g) return;
  if (!crapsUndo(g.loaded.state)) {
    res.json({ ...rt.viewOf(g.loaded), empty: true });
    return;
  }
  res.json(await rt.saveState(g.loaded, "live", g.origin));
});

// The rotation is a default, not a rule: dice get declined, skipped and handed
// across a table, so the host can put them anywhere.
crapsRouter.post("/craps/:eventId/shooter", requireAuth, async (req: AuthedRequest, res) => {
  const g = await casino.scorer(req, res);
  if (!g) return;
  const slot = casino.slotOf(g.loaded.state, req.body?.playerId, res);
  if (!slot) return;
  if (!crapsSetShooter(g.loaded.state, slot.id, new Date().toISOString())) {
    res.status(400).json({ error: "That player is not at the table" });
    return;
  }
  res.json(await rt.saveState(g.loaded, "live", g.origin));
});

// ---------- guest -> member backfill (see guest-link.ts) ----------

export const guestNamesCraps = casino.guestNames;
export const creditGuestCraps = casino.creditGuest;

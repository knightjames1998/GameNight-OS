// ONE ROSTER READER PER PACK, enumerated, mirroring the `guestNames*` table in
// guest-link.ts. This is what the roster carry-over reads a previous session's
// players out of, and it is a TABLE rather than a generic reader on purpose.
//
// WHY NOT `state.roster` ON THE JSONB, which is the obvious version and the
// wrong one: most packs do carry a `roster` field, so a duck-typed reader looks
// like it works. Smash lives in its own table, a bracket carries `entrants`
// rather than a roster, and Beerio's blob is the vendored engine's opaque shape.
// A generic reader returns an EMPTY roster for those three and NOTHING ERRORS,
// which is this project's defining failure mode. Here a pack that renames its
// field fails to compile, because each adapter is typed against that pack's own
// state type.
//
// WHY THE ADAPTERS LIVE IN ONE FILE RATHER THAN BESIDE THEIR `guestNames*`
// SIBLING IN EACH PACK MODULE, which was the first plan and had to change: the
// carry-over is read inside `launchContext` in pack-runtime.ts, so a table that
// imported the pack modules would close a cycle (pack-runtime -> event-prefill
// -> pingpong.ts -> pack-runtime), and every pack module builds its runtime with
// a top-level `const`, which is exactly the shape that throws on a cycle rather
// than degrading. Every state type these adapters need is exported from
// @gamenight/shared, which is a leaf, so the table sits here with no cycle and
// no runtime import of any pack. The obligation on a new pack is unchanged and
// is in the ADDING A PACK checklist: a pack with no entry here is silently
// skipped by the carry-over.

import {
  SESSION_PACKS,
  BEERIO_LEDGER,
  GENERIC_LEDGER,
  parseEntrants,
  entrantMembers,
  type BjSessionState,
  type PokerSessionState,
  type RlSessionState,
  type CrSessionState,
  type CrunState,
  type BgSessionState,
  type CtSessionState,
  type SdSessionState,
  type MkSessionState,
  type MpSessionState,
  type PpSessionState,
  type SmashSessionState,
} from "@gamenight/shared";
import type { RosterSlot } from "./pack-runtime.js";

/**
 * A pack's session state, reduced to the players who were in it. Order is the
 * pack's own roster order, which is the order a host built and the order the
 * setup screen should hand back.
 */
export type RosterOf = (state: unknown) => RosterSlot[];

/** Every slot shape in this app is structurally a RosterSlot. Nothing casts. */
const slots = (roster: readonly RosterSlot[] | undefined): RosterSlot[] => [...(roster ?? [])];

// ---------- the cash four ----------
export const rosterOfBlackjack: RosterOf = (s) => slots((s as BjSessionState).roster);
export const rosterOfPoker: RosterOf = (s) => slots((s as PokerSessionState).roster);
export const rosterOfRoulette: RosterOf = (s) => slots((s as RlSessionState).roster);
export const rosterOfCraps: RosterOf = (s) => slots((s as CrSessionState).roster);

// ---------- the rest of the session packs ----------
export const rosterOfCasinoRun: RosterOf = (s) => slots((s as CrunState).roster);
export const rosterOfBoardGame: RosterOf = (s) => slots((s as BgSessionState).roster);
export const rosterOfCardTable: RosterOf = (s) => slots((s as CtSessionState).roster);
export const rosterOfDeduction: RosterOf = (s) => slots((s as SdSessionState).roster);
export const rosterOfMarioKart: RosterOf = (s) => slots((s as MkSessionState).roster);
export const rosterOfMarioParty: RosterOf = (s) => slots((s as MpSessionState).roster);
export const rosterOfPingPong: RosterOf = (s) => slots((s as PpSessionState).roster);
export const rosterOfSmash: RosterOf = (s) => slots((s as SmashSessionState).roster);

/**
 * A BRACKET's entrants, walked into people. A team entrant is ONE slot holding
 * two members, and a carry-over wants the PEOPLE, so this flattens exactly the
 * way `guestNamesBracket` does rather than inventing a second reading of the
 * same column.
 *
 * A MEMBER ENTRANT CARRIES NO NAME, deliberately, because `entrants` stores a
 * userId and names live in the users table (see entrantLabel's note). The slot
 * comes back with an empty name and the caller fills it in from the crew, which
 * it has to do anyway to drop anybody who has since left.
 */
export const rosterOfBracket: RosterOf = (raw) => {
  const out: RosterSlot[] = [];
  for (const e of parseEntrants(raw)) {
    for (const m of entrantMembers(e)) {
      if (m.kind === "guest") out.push({ id: `g:${m.name}`, kind: "guest", userId: null, name: m.name });
      else out.push({ id: m.userId, kind: "member", userId: m.userId, name: "" });
    }
  }
  return out;
};

/**
 * BEERIO HAS NO ROSTER TO READ, and that is a fact about the pack rather than a
 * gap here. Its session blob is the vendored engine's opaque shape, keyed by a
 * reusable room code with no link to an event, which is the same reason the
 * guest backfill had to snapshot standings onto `matches.rawResult` instead of
 * reading the session. It is in this table anyway, returning nothing, because a
 * missing entry and a deliberate empty one look identical from the call site and
 * only one of them is a decision. Beerio is still a CONSUMER of the chain: it
 * takes names, having no userIds to take.
 */
export const rosterOfBeerio: RosterOf = () => [];

/**
 * The table, keyed by the LEDGER spelling, which is what `game_sessions.pack`
 * holds and what the TV resolver and the guest backfill both key off. Retyping
 * those strings is how two tables drift apart, so they come from the registry.
 */
export const ROSTER_ADAPTERS: Record<string, RosterOf> = {
  [SESSION_PACKS.smash.ledger]: rosterOfSmash,
  [SESSION_PACKS.mariokart.ledger]: rosterOfMarioKart,
  [SESSION_PACKS.marioparty.ledger]: rosterOfMarioParty,
  [SESSION_PACKS.pingpong.ledger]: rosterOfPingPong,
  [SESSION_PACKS.blackjack.ledger]: rosterOfBlackjack,
  [SESSION_PACKS.roulette.ledger]: rosterOfRoulette,
  [SESSION_PACKS.craps.ledger]: rosterOfCraps,
  [SESSION_PACKS.poker.ledger]: rosterOfPoker,
  [SESSION_PACKS.casinorun.ledger]: rosterOfCasinoRun,
  [SESSION_PACKS.boardgame.ledger]: rosterOfBoardGame,
  [SESSION_PACKS.cardtable.ledger]: rosterOfCardTable,
  [SESSION_PACKS.deduction.ledger]: rosterOfDeduction,
  [GENERIC_LEDGER]: rosterOfBracket,
  [BEERIO_LEDGER]: rosterOfBeerio,
};

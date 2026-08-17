// Shared types for GameNight OS.
// These mirror the DB schema but are transport-friendly (plain strings/numbers).
// Keep this file dependency-free so both server and web can import it.

// The pack registry is the one place a pack's identifiers exist; WsEvent below
// derives its per-pack message types from it. `export *` re-exports names but
// does not bring them into this module's scope, hence the explicit import.
import type { PackWsType } from "./packs.js";

// ---------- Crew ----------

export type MemberRole = "owner" | "admin" | "member";

export interface Group {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface Member {
  userId: string;
  groupId: string;
  displayName: string;
  role: MemberRole;
  joinedAt: string;
}

// ---------- Schedule ----------

export type EventStatus = "draft" | "scheduled" | "live" | "completed" | "cancelled";
export type RsvpStatus = "yes" | "no" | "maybe";

export interface GameNightEvent {
  id: string;
  groupId: string;
  title: string;
  scheduledFor: string | null;
  status: EventStatus;
}

export interface Rsvp {
  eventId: string;
  userId: string;
  status: RsvpStatus;
  respondedAt: string;
}

// ---------- Play ----------

/**
 * A bracket entrant is either a crew member (stats accrue) or a typed-in
 * guest (no stats, linkable to a member later). Legacy rows stored bare
 * userId strings; parseEntrants() below upgrades them on read, so no data
 * migration was needed.
 */
export type Entrant =
  | { kind: "member"; userId: string }
  | { kind: "guest"; name: string };

export function parseEntrants(raw: unknown): Entrant[] {
  if (!Array.isArray(raw)) return [];
  const out: Entrant[] = [];
  for (const e of raw) {
    if (typeof e === "string") out.push({ kind: "member", userId: e });
    else if (e && typeof e === "object") {
      const o = e as Record<string, unknown>;
      if (o.kind === "guest" && typeof o.name === "string") out.push({ kind: "guest", name: o.name });
      else if (typeof o.userId === "string") out.push({ kind: "member", userId: o.userId });
    }
  }
  return out;
}
// A "game" is anything with participants and results. Packs layer on top.

export type BracketFormat = "single_elim" | "double_elim" | "round_robin";
export type MatchStatus = "pending" | "live" | "completed";

export interface Game {
  id: string;
  groupId: string;
  name: string;
  /** Which game pack drives rules/UI. "generic" is the fallback. */
  pack: string;
}

export interface Bracket {
  id: string;
  groupId: string;
  eventId: string;
  gameId: string;
  format: BracketFormat;
  status: "setup" | "live" | "completed";
}

export interface Match {
  id: string;
  groupId: string;
  bracketId: string;
  round: number;
  position: number;
  status: MatchStatus;
}

export interface MatchParticipant {
  matchId: string;
  userId: string;
  seed: number | null;
  score: number | null;
  placement: number | null;
}

// ---------- Broadcast (live TV sync) ----------
// WebSocket message envelope. Server broadcasts these to TV/spectator views.

type WsEvent =
  | { type: "event_rsvp_changed"; eventId: string }
  | { type: "group_events_changed"; groupId: string }
  | { type: "group_members_changed"; groupId: string }
  | { type: "event_deleted"; eventId: string; groupId: string }
  | { type: "event_updated"; eventId: string; groupId: string }
  | { type: "event_session_changed"; eventId: string }
  | { type: "bracket_updated"; bracketId: string }
  | { type: "match_updated"; matchId: string }
  | { type: "leaderboard_updated"; eventId: string }
  // The pack types are DERIVED from the pack registry rather than listed
  // here, so adding a pack cannot leave its broadcast type undeclared (which
  // fails silently: the client never matches the message and that pack's
  // screens simply stop updating).
  | { type: PackWsType; eventId: string }
  | { type: "ping" };

// origin: the per-tab client id of whoever caused the write (from the
// X-GN-Client request header). The acting tab already holds the mutation
// response, so it can skip refetching on its own echo; every other client
// treats the message normally.
export type WsMessage = WsEvent & { origin?: string };
export * from "./packs.js";
// The LEDGER FORMAT registry, beside the pack registry and for the same reason:
// matches.format was read back by a label map on the client and a sort order on
// the server, neither of which knew about the other, and both had drifted.
export * from "./formats.js";
export * from "./bracket.js";
// The bracketed TVs' shared derivations (round order, the alive board, the
// round strip). Beside the engine rather than in it: it reads what compute()
// produced and derives nothing about the bracket itself.
export * from "./bracketboard.js";
export * from "./series.js";
export * from "./smash.js";
export * from "./mariokart.js";
export * from "./marioparty.js";
export * from "./pingpong.js";
// The casino group: one shared engine, one thin module per pack.
export * from "./cashgame.js";
export * from "./blackjack.js";
export * from "./roulette.js";
export * from "./craps.js";
// The co-op one. Its own state module, deliberately not settleCash.
export * from "./casinorun.js";
// The TITLE-NIGHT LAYER, shared by every pack whose night is a sequence of
// named games with a tapped finish order. Extracted from Board Game when Card
// table arrived as the second example.
export * from "./titlenight.js";
export * from "./boardgame.js";
export * from "./cardtable.js";
// SOCIAL DEDUCTION. Its OWN state module, deliberately not the title-night
// layer: that layer keeps the sides in session state and re-deriving them per
// game would fight its reshuffle log, and roles must not be in session state at
// all. It still reuses the team primitive's placement rule and the three pure
// title functions.
export * from "./deduction.js";
// The team primitive: sides, and what a side result means for placement.
// Not a pack. Ping Pong is its first consumer; Card table, Party games and
// Social deduction are queued behind it.
export * from "./teams.js";
// The side LOG beside it: which arrangement was in force when, so a session
// that rebuilds derived state by replaying its units knows which stretch was
// played under which sides. Out of Ping Pong on 2026-08-16, when Mario Kart's
// pairs mode became the second consumer.
export * from "./sidelog.js";
export * from "./modifiers.js";

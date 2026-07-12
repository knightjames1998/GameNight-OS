// Shared types for GameNight OS.
// These mirror the DB schema but are transport-friendly (plain strings/numbers).
// Keep this file dependency-free so both server and web can import it.

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
// A "game" is anything with participants and results. Packs layer on top.

export type BracketFormat = "single_elim" | "round_robin";
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

export type WsMessage =
  | { type: "event_rsvp_changed"; eventId: string }
  | { type: "bracket_updated"; bracketId: string }
  | { type: "match_updated"; matchId: string }
  | { type: "leaderboard_updated"; eventId: string }
  | { type: "ping" };
export * from "./bracket.js";

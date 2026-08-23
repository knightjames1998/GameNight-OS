// Tiny fetch wrapper. Same-origin requests carry the session cookie
// automatically; this just centralizes JSON handling and errors.

import type { SessionPackKey } from "@gamenight/shared/packs";
// DEEP IMPORT, like the line above and for the same reason: this module is on
// the entry path, and pulling the barrel drags every pack's content catalogue
// into the entry chunk (cleanup phase 1, AUDIT-2026-08.md). Type-only either
// way, but the convention in this file is the deep path.
import type { SlotSource } from "@gamenight/shared/bracket";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Per-tab id sent with every request. The server stamps it onto the
// WebSocket broadcast a write causes, so the acting tab can recognize its
// own echo and skip the redundant refetch (it already has the mutation
// response). Other tabs and devices see a foreign origin and reload.
export const CLIENT_ID = crypto.randomUUID();

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-GN-Client": CLIENT_ID,
      ...options?.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  hasPassword?: boolean;
}

export interface GroupSummary {
  id: string;
  name: string;
  slug: string;
  inviteCode: string;
  role: "owner" | "admin" | "member";
}

export interface GroupDetail extends Omit<GroupSummary, "role"> {
  myRole: "owner" | "admin" | "member";
  members: {
    userId: string;
    displayName: string;
    role: "owner" | "admin" | "member";
    joinedAt: string;
  }[];
}

export type RsvpStatus = "yes" | "no" | "maybe";

export interface EventSummary {
  id: string;
  groupId: string;
  title: string;
  scheduledFor: string | null;
  status: "draft" | "scheduled" | "live" | "completed" | "cancelled";
  counts: { yes: number; maybe: number; no: number };
  myStatus: RsvpStatus | null;
}

export interface EventDetail {
  id: string;
  groupId: string;
  title: string;
  bracket: { id: string; status: "setup" | "live" | "completed" } | null;
  beerioCode: string | null;
  /**
   * The session packs still running on this night (never completed ones), so
   * every pack tile can show "live now" the way the Beerio and Tournament
   * tiles always could.
   */
  sessions: { pack: string; status: "setup" | "live" }[];
  myRole: "owner" | "admin" | "member";
  createdBy: string;
  groupName: string;
  inviteCode: string;
  scheduledFor: string | null;
  status: "draft" | "scheduled" | "live" | "completed" | "cancelled";
  rsvps: { userId: string; displayName: string; status: RsvpStatus }[];
  noResponse: { userId: string; displayName: string }[];
  myStatus: RsvpStatus | null;
  /** Did I actually show? null until answered; only asked once the event starts. */
  myAttendance: boolean | null;
  /**
   * Every check-in on the night, whoever recorded it. A host can now check
   * somebody else in, so this is no longer derivable from `myAttendance`, and
   * the prefill chain reads it as the rung above the yes list.
   */
  attendance: { userId: string; showed: boolean }[];
}

/**
 * What a setup screen opens with, from `GET /events/:id/prefill` and, in the
 * same shape, from every pack's own launch context. The chain is the last
 * session's roster on this night, then who showed, then who said yes; `source`
 * is which rung answered, because a screen that changes what it opens with has
 * to say so.
 */
export interface EventPrefill {
  slots: { userId: string | null; name: string }[];
  source: "session" | "attendance" | "rsvp";
  /** The pack's display name when the source is a session, else "". */
  sourceLabel: string;
  rsvpSlots: { userId: string | null; name: string }[];
  recentGuests: string[];
}

// Show-up record derived from RSVPs + event_attendance (flake tracking).
// tracked = answered check-ins + past yes-RSVPs gone silent (those silent
// ones are flakes: nobody opens the app to confess a no-show).
export interface AttendanceStats {
  tracked: number;
  showed: number;
  flaked: number;
  showRate: number | null;
  currentStreak: number;
  bestStreak: number;
}

// Anyone you share (or have shared) a real crew with.
export interface Friend {
  userId: string;
  displayName: string;
  crews: string[];
}

// Night recap: every completed game under an event, rolled up across packs.
// Members only; guests are never in the materialized ledger.
export interface EventRecap {
  eventId: string;
  title: string;
  scheduledFor: string | null;
  groupName: string;
  totalGames: number;
  games: { gameName: string; label: string | null; format: string | null; pack: string; winnerName: string | null }[];
  // One entry per thing actually played (a Best Of session, a KOTH run, a
  // Grand Prix cup), with its top winner and how many of its games they took.
  sessions: {
    gameName: string;
    pack: string;
    format: string | null;
    label: string | null;
    matches: number;
    winnerName: string | null;
    winnerWins: number;
  }[];
  players: { userId: string; name: string; games: number; wins: number; avgPlacement: number | null }[];
  mvp: { userId: string; name: string } | null;
}

// What /e/:id/tv resolves to: the night's one TV address, answering "what is
// being played right now" so the big screen can follow the night on its own.
// `now` is null before anyone starts anything, which is not an error. It is
// the normal state of the evening's first twenty minutes, and it renders the
// lobby.
export type EventTvNow =
  | { kind: "pack"; pack: SessionPackKey; status: "setup" | "live" }
  | { kind: "bracket"; bracketId: string; status: "setup" | "live" }
  | { kind: "beerio"; code: string }
  | null;

export interface EventTv {
  event: { id: string; title: string; scheduledFor: string | null; groupName: string };
  now: EventTvNow;
  /** Populated only when `now` is null; the lobby is the only thing that reads it. */
  lobby: {
    yes: string[];
    inviteCode: string;
    /**
     * The night so far, for the waiting screen BETWEEN games. Null until
     * something has been played, which is what splits the two lobby states:
     * nothing yet -> who's in, anything -> standings and what has been won.
     * The same rollup the recap card uses, so the two can never disagree.
     */
    recap: EventRecap | null;
    /**
     * The crew's lifetime standings, which the between-games screen alternates
     * with tonight's. Null when the crew has no completed games at all.
     *
     * SERVED FROM THIS PAYLOAD RATHER THAN /api/groups/:id/stats, and that is
     * not a duplication: the stats endpoint requires auth AND a membership, and
     * a television is the one screen in this app that is reliably signed out.
     * The server computes it through the same newAgg/feedAgg/finishAgg the crew
     * leaderboard uses, so the two cannot disagree about a person.
     */
    lifetime: LifetimeStanding[] | null;
  };
}

/** One crew member's lifetime record, shaped to render in the same row as a night standing. */
export interface LifetimeStanding {
  userId: string;
  name: string;
  games: number;
  wins: number;
  avgPlacement: number | null;
}

/** One person in a slot: a crew member, or a guest with no id to credit. */
export interface BracketPerson {
  userId: string | null;
  displayName: string;
}

/**
 * A slot on a bracket card.
 *
 * `members` is EVERY slot's people, and a solo entrant's is a list of one
 * carrying the same userId and displayName the slot itself does. A team slot
 * has userId null (it is not one person), the team's label in displayName, and
 * its people in members.
 */
export type BracketSlot =
  | {
      kind: "player";
      seed: number;
      userId: string | null;
      displayName: string;
      members: BracketPerson[];
    }
  | { kind: "bye" }
  | { kind: "tbd" };

/**
 * A slot's TEAM reading, or null when it holds one person (or nobody).
 *
 * `name` is only set when the slot carries a label that is not simply its
 * people joined, which is what a NAMED team has. An unnamed pair's label is
 * already "Ann + Ben", so repeating it under itself would be noise; the two
 * screens stack the people instead, which is both shorter per line and what a
 * room reads faster than one long joined string.
 */
export function slotTeam(
  slot: BracketSlot,
): { name: string | null; people: string[] } | null {
  if (slot.kind !== "player" || slot.members.length < 2) return null;
  const people = slot.members.map((m) => m.displayName);
  return { name: people.join(" + ") === slot.displayName ? null : slot.displayName, people };
}

export interface BracketMatchView {
  id: string;
  a: BracketSlot;
  b: BracketSlot;
  /** Where each seat comes from, so an empty one can name its feeder. */
  aFrom: SlotSource;
  bFrom: SlotSource;
  winner: BracketSlot | null;
  decided: boolean;
  auto: boolean;
  playable: boolean;
  undoable: boolean;
  /** Double elim only: this is the grand-final reset match. */
  reset?: boolean;
}

export interface BracketView {
  id: string;
  eventId: string;
  groupId: string;
  gameName: string;
  groupName: string;
  status: "setup" | "live" | "completed";
  format: "single_elim" | "double_elim" | "round_robin";
  openScoring: boolean;
  canScore: boolean;
  canManage: boolean;
  entrantCount: number;
  rounds: { title: string; side: "W" | "L" | "GF"; matches: BracketMatchView[] }[];
  champion: BracketSlot | null;
}

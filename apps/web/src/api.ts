// Tiny fetch wrapper. Same-origin requests carry the session cookie
// automatically; this just centralizes JSON handling and errors.

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

export type BracketSlot =
  | { kind: "player"; seed: number; userId: string; displayName: string }
  | { kind: "bye" }
  | { kind: "tbd" };

export interface BracketMatchView {
  id: string;
  a: BracketSlot;
  b: BracketSlot;
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

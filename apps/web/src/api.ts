// Tiny fetch wrapper. Same-origin requests carry the session cookie
// automatically; this just centralizes JSON handling and errors.

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
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
  scheduledFor: string | null;
  status: "draft" | "scheduled" | "live" | "completed" | "cancelled";
  rsvps: { userId: string; displayName: string; status: RsvpStatus }[];
  noResponse: { userId: string; displayName: string }[];
  myStatus: RsvpStatus | null;
  /** Did I actually show? null until answered; only asked once the event starts. */
  myAttendance: boolean | null;
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

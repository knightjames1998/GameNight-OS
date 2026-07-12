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
}

export interface GroupSummary {
  id: string;
  name: string;
  slug: string;
  inviteCode: string;
  role: "owner" | "admin" | "member";
}

export interface GroupDetail extends Omit<GroupSummary, "role"> {
  members: {
    userId: string;
    displayName: string;
    role: "owner" | "admin" | "member";
    joinedAt: string;
  }[];
}

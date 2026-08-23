// WHO MAY RECORD WHOSE ATTENDANCE, as a pure decision over four facts.
//
// The route that uses this is one of the few in the app where the AUTHORIZATION
// is the feature rather than plumbing, so it lives here, testable without a
// database, and the route stays a read, a decision and a write.
//
// WHY A HOST CAN CHECK SOMEBODY IN AT ALL. `attendanceFor` in stats.ts counts a
// flake TWO ways: an answered check-in with `showed: false`, AND SILENCE after a
// yes on a past dated event once FLAKE_GRACE_MS has passed. So somebody who said
// yes, drove over, played all night and never opened the app is ALREADY being
// recorded as a flake, silently, and it accumulates on their profile. This is a
// correctness fix for that, and the prefill chain that reads attendance is the
// smaller half of why it exists.
//
// WHY A HOST CANNOT MARK A NO-SHOW, which is the same fact read the other way:
// silence already produces the flake, so `showed: false` from a host buys
// nothing that not-checking-somebody-in does not already do, and it costs a
// social problem: one person able to put a flake on another person's profile.
// A host gets exactly two powers here, CHECK IN and CLEAR BACK TO UNANSWERED,
// and both of them are recoverable. Marking yourself keeps both answers, exactly
// as it has since event_attendance shipped.

import { isHostRole } from "./pack-runtime.js";

export type CrewRole = "owner" | "admin" | "member" | undefined;

export type AttendanceInput = {
  /** The signed-in caller. */
  callerId: string;
  /** The body's `userId`. Absent or null means the caller, which is the old shape. */
  targetId?: string | null;
  /** The body's `showed`: true, false, or null to clear the row. Unvalidated. */
  showed: unknown;
  /** The CALLER's role in the event's crew. */
  role: CrewRole;
  /** The TARGET's role in the same crew. undefined means they are not in it. */
  targetRole: CrewRole;
};

export type AttendanceAction =
  | { kind: "set"; userId: string; showed: boolean }
  | { kind: "clear"; userId: string };

export type AttendanceRefusal = { status: 400 | 403 | 404; error: string };

export const isRefusal = (d: AttendanceAction | AttendanceRefusal): d is AttendanceRefusal =>
  "status" in d;

/**
 * The whole rule. Order matters and is asserted in the tests: a member aiming at
 * somebody else is refused for WHO THEY ARE before anything looks at what they
 * sent, so the refusal never doubles as a way to probe another crew's members.
 */
export function decideAttendance(input: AttendanceInput): AttendanceAction | AttendanceRefusal {
  const { callerId, role, targetRole } = input;
  const targetId = input.targetId == null ? callerId : input.targetId;
  const self = targetId === callerId;

  if (input.showed !== true && input.showed !== false && input.showed !== null) {
    return { status: 400, error: "showed must be true or false" };
  }

  // Standing rule 1, enforced server-side rather than only in the UI: owners
  // and admins host, members watch.
  if (!self && !isHostRole(role)) {
    return { status: 403, error: "Only a host can check somebody else in" };
  }
  // Somebody who left the crew, or was never in it, is a 404 rather than a
  // silent no-op: a userId from another crew must not write a row here.
  if (!self && targetRole === undefined) {
    return { status: 404, error: "That person is not in this crew" };
  }
  if (!self && input.showed === false) {
    return { status: 400, error: "A host can check somebody in, not mark them absent" };
  }
  if (input.showed === null) {
    // Clearing DELETES the row and returns that person to unanswered. It is a
    // host power because it is the undo for a host's own tap; a member who
    // mis-tapped their own answer just taps the other one, which is why this
    // does not need to open up to members and why there is no third state.
    if (!isHostRole(role)) {
      return { status: 403, error: "Only a host can clear a check-in" };
    }
    return { kind: "clear", userId: targetId };
  }
  return { kind: "set", userId: targetId, showed: input.showed };
}

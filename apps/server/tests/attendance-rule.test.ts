// THE HOST CHECK-IN RULE, pinned as a pure decision.
//
// WHY THIS IS A CORRECTNESS FIX RATHER THAN A CONVENIENCE, which is the thing
// worth knowing before reading the cases: `attendanceFor` in stats.ts counts a
// flake TWO ways: an answered check-in with `showed: false`, and SILENCE after
// a yes on a past dated event once FLAKE_GRACE_MS has passed. Until this route
// took a `userId` there was no way for anybody to record anybody else, so a
// person who said yes, turned up, played all night and never opened the app was
// already accumulating flakes on their profile with nothing anywhere reporting
// it. The prefill chain reading attendance is the smaller half of why this
// exists.
//
// AND WHY THERE IS NO HOST NO-SHOW, which falls out of the same fact: silence
// already produces the flake, so `showed: false` from a host buys nothing that
// not checking somebody in does not already do, and it costs one person the
// ability to put a flake on another person's profile. Two host powers, CHECK IN
// and CLEAR, both recoverable.
//
// No database and no Drizzle stub, the same split tv-resolve.test.ts uses:
// stubbing Drizzle would test the stub. The two role lookups and the write are
// verified against the route's source at the bottom of this file, which is where
// a one-word edit would land.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decideAttendance, isRefusal, type AttendanceInput } from "../src/attendance-rule.js";

const HOST = "u-host";
const MEMBER = "u-member";
const OTHER = "u-other";

/** A caller marking themselves, which is every call the route took before this. */
const base = (over: Partial<AttendanceInput> = {}): AttendanceInput => ({
  callerId: MEMBER,
  targetId: null,
  showed: true,
  role: "member",
  targetRole: "member",
  ...over,
});

// ---------- marking yourself: unchanged, byte for byte ----------

test("a plain member still marks THEMSELVES, both answers, with no role required", () => {
  assert.deepEqual(decideAttendance(base({ showed: true })), {
    kind: "set",
    userId: MEMBER,
    showed: true,
  });
  // The no half is the one that must survive: it is a person saying they did
  // not make it, which is not the same act as a host saying it about them.
  assert.deepEqual(decideAttendance(base({ showed: false })), {
    kind: "set",
    userId: MEMBER,
    showed: false,
  });
});

test("naming yourself explicitly is the same call as omitting the userId", () => {
  assert.deepEqual(
    decideAttendance(base({ targetId: MEMBER, showed: false })),
    decideAttendance(base({ targetId: null, showed: false })),
  );
});

test("a bad showed is still a 400, and null is now a real answer rather than one", () => {
  for (const showed of [undefined, "yes", 1, {}, "true"]) {
    const d = decideAttendance(base({ showed }));
    assert.ok(isRefusal(d), `${JSON.stringify(showed)} should be refused`);
    assert.equal(d.status, 400);
  }
});

// ---------- a host, marking somebody else ----------

test("a host checks another member IN", () => {
  assert.deepEqual(
    decideAttendance(base({ callerId: HOST, role: "owner", targetId: MEMBER, showed: true })),
    { kind: "set", userId: MEMBER, showed: true },
  );
  // admin hosts too; standing rule 1 is owner-or-admin everywhere else as well.
  assert.deepEqual(
    decideAttendance(base({ callerId: HOST, role: "admin", targetId: MEMBER, showed: true })),
    { kind: "set", userId: MEMBER, showed: true },
  );
});

test("a host marking another member a NO-SHOW is refused", () => {
  const d = decideAttendance(
    base({ callerId: HOST, role: "owner", targetId: MEMBER, showed: false }),
  );
  assert.ok(isRefusal(d));
  assert.equal(d.status, 400);
  assert.match(d.error, /not mark them absent/);
});

test("a host CLEARS a check-in back to unanswered, which is a delete", () => {
  assert.deepEqual(
    decideAttendance(base({ callerId: HOST, role: "admin", targetId: MEMBER, showed: null })),
    { kind: "clear", userId: MEMBER },
  );
  // Including their own row: a host is a member of the crew like anyone else.
  assert.deepEqual(
    decideAttendance(base({ callerId: HOST, role: "owner", targetId: HOST, showed: null })),
    { kind: "clear", userId: HOST },
  );
});

test("a plain member cannot clear, not even their own row", () => {
  // Not an oversight: a member who mis-tapped taps the other answer, so nothing
  // traps them, and leaving clear to hosts keeps the undo where the new power
  // is. There is no third state to write either way.
  const d = decideAttendance(base({ showed: null }));
  assert.ok(isRefusal(d));
  assert.equal(d.status, 403);
});

// ---------- who may aim at somebody else at all ----------

test("a member marking ANOTHER member is refused, whatever they send", () => {
  for (const showed of [true, false, null]) {
    const d = decideAttendance(base({ targetId: OTHER, showed }));
    assert.ok(isRefusal(d), `showed=${String(showed)} should be refused`);
    assert.equal(d.status, 403);
    assert.match(d.error, /Only a host/);
  }
});

test("a target outside the crew is refused, and is refused as NOT FOUND", () => {
  const d = decideAttendance(
    base({ callerId: HOST, role: "owner", targetId: OTHER, targetRole: undefined }),
  );
  assert.ok(isRefusal(d));
  assert.equal(d.status, 404);
});

test("WHO the caller is is decided before WHAT they sent", () => {
  // A member aiming at a userId from another crew gets the role refusal, not
  // the not-in-this-crew one, so the endpoint cannot be used to ask whether a
  // given id is in a crew you are only a member of.
  const d = decideAttendance(base({ targetId: OTHER, targetRole: undefined }));
  assert.ok(isRefusal(d));
  assert.equal(d.status, 403);
});

test("a caller with no membership at all cannot host anybody", () => {
  // Belt and braces: the route already refuses a non-member with a 404 on the
  // event itself, so this is the rule not relying on that having happened.
  const d = decideAttendance(base({ role: undefined, targetId: OTHER }));
  assert.ok(isRefusal(d));
  assert.equal(d.status, 403);
});

// ---------- the route actually uses it ----------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const events = readFileSync(path.join(HERE, "..", "src", "events.ts"), "utf8");

test("the route decides before it writes, and writes to the DECIDED user", () => {
  assert.match(events, /decideAttendance\(\{/, "the route does not call the rule");
  assert.match(events, /if \(isRefusal\(decision\)\)/, "the route does not act on a refusal");
  // The bug this guards against is the one the route had by construction until
  // now: a hardcoded `userId: req.user!.id` on the write.
  assert.match(events, /userId: decision\.userId,/);
  assert.doesNotMatch(
    events.slice(events.indexOf("/events/:id/attendance")),
    /userId: req\.user!\.id,/,
  );
});

test("the date gate is still there, and still gates a host's tap too", () => {
  const route = events.slice(events.indexOf('eventsRouter.post("/events/:id/attendance"'));
  assert.match(route, /Attendance opens once the event starts/);
  assert.ok(
    route.indexOf("Attendance opens once the event starts") < route.indexOf("insert(eventAttendance)"),
    "the date gate must come before the write",
  );
});

test("clearing is a DELETE of the row, not a third state", () => {
  const route = events.slice(events.indexOf('eventsRouter.post("/events/:id/attendance"'));
  assert.match(route, /\.delete\(eventAttendance\)/);
});

test("the write still broadcasts event_updated, so the page live-syncs", () => {
  const route = events.slice(events.indexOf('eventsRouter.post("/events/:id/attendance"'));
  assert.match(route, /type: "event_updated"/);
});

// WHERE THE NIGHT IS AND WHAT TO BRING, and the one field in this app that
// becomes a link.
//
// TWO ROUTES SHARE THIS PARSER AND THAT IS THE POINT: create and PATCH both take
// these three fields, and a cap enforced on one and forgotten on the other is a
// cap that does not exist. The rule lives in one function so there is one place
// to test and one place to change.
//
// THE PARTIAL RULE IS THE ONE THAT WOULD HAVE BITTEN. PATCH used to take exactly
// one field (`scheduledFor`), test for it by name, and write it unconditionally.
// Widening a route shaped like that without separating ABSENT from SENT-AS-EMPTY
// gives you a notes edit that silently clears the date, which is invisible until
// somebody's game night loses its time the day before it happens.
//
// No database and no Drizzle stub, the same split tv-resolve and the attendance
// rule use; the route's use of the parser is asserted against its source at the
// bottom, which is where a one-word edit would land.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseEventDetails,
  EVENT_LOCATION_MAX,
  EVENT_LOCATION_URL_MAX,
  EVENT_NOTES_MAX,
} from "../src/event-details.js";
import { isHttpsUrl } from "@gamenight/shared";

const ok = (body: unknown) => {
  const r = parseEventDetails(body);
  assert.ok(r.ok, `expected a parse, got: ${r.ok ? "" : r.error}`);
  return r.fields;
};
const refused = (body: unknown) => {
  const r = parseEventDetails(body);
  assert.equal(r.ok, false, "expected a refusal");
  return r.ok ? "" : r.error;
};

// ---------- absent is not the same as empty ----------

test("A BODY WITH NONE OF THE THREE RETURNS NOTHING TO WRITE", () => {
  // Which is what keeps a date-only PATCH byte-for-byte the route it was, and
  // what lets a create with no details insert no details rather than three
  // empty strings.
  assert.deepEqual(ok({}), {});
  assert.deepEqual(ok({ scheduledFor: "2026-09-01T18:00:00.000Z" }), {});
  assert.deepEqual(ok(undefined), {});
  assert.deepEqual(ok(null), {});
});

test("a partial body carries ONLY the keys it was given", () => {
  // The whole partial rule in one assertion: notes present, location and map
  // link absent from the result entirely rather than present as null.
  const fields = ok({ notes: "Bring a chair" });
  assert.deepEqual(fields, { notes: "Bring a chair" });
  assert.equal("location" in fields, false);
  assert.equal("locationUrl" in fields, false);
});

test("EMPTY STRING AND NULL BOTH CLEAR, because they are the same intent", () => {
  // They arrive from different places: a client sending JSON null, and a host
  // emptying a text input. Refusing one would make clearing a field depend on
  // which screen you were on.
  assert.deepEqual(ok({ location: "" }), { location: null });
  assert.deepEqual(ok({ location: null }), { location: null });
  assert.deepEqual(ok({ notes: "   " }), { notes: null }, "whitespace only is empty");
  assert.deepEqual(ok({ locationUrl: "" }), { locationUrl: null });
  assert.deepEqual(ok({ locationUrl: null }), { locationUrl: null });
});

test("text is trimmed, because a pasted address arrives with a newline on it", () => {
  assert.deepEqual(ok({ location: "  Dave's place \n" }), { location: "Dave's place" });
});

// ---------- the caps ----------

test("each field has its own cap and says which one it broke", () => {
  assert.match(refused({ location: "x".repeat(EVENT_LOCATION_MAX + 1) }), /location/);
  assert.match(refused({ notes: "x".repeat(EVENT_NOTES_MAX + 1) }), /notes/);
  assert.match(
    refused({ locationUrl: "https://e.com/" + "x".repeat(EVENT_LOCATION_URL_MAX) }),
    /map link/,
  );
  // Exactly at the cap is fine: an off-by-one here is a host retyping an
  // address to find out which character the app objects to.
  assert.deepEqual(ok({ location: "x".repeat(EVENT_LOCATION_MAX) }).location?.length, EVENT_LOCATION_MAX);
  assert.deepEqual(ok({ notes: "x".repeat(EVENT_NOTES_MAX) }).notes?.length, EVENT_NOTES_MAX);
});

test("a non-string is refused rather than coerced", () => {
  // `String(42)` would have "worked" and put a number in a text column, and
  // `String({})` puts "[object Object]" on somebody's game night.
  assert.match(refused({ location: 42 }), /text/);
  assert.match(refused({ notes: { a: 1 } }), /text/);
  assert.match(refused({ locationUrl: 42 }), /text/);
});

// ---------- the link, which is the one that matters ----------

test("HTTPS ONLY, AND THE REFUSAL SAYS SO", () => {
  // An allowlist of one protocol rather than a blocklist of the schemes anybody
  // happened to think of. This is the only user-pasted string this app renders
  // as a navigable link.
  assert.deepEqual(ok({ locationUrl: "https://maps.app.goo.gl/abc" }), {
    locationUrl: "https://maps.app.goo.gl/abc",
  });
  for (const bad of [
    "http://maps.example.com/x",
    "javascript:alert(1)",
    // eslint-disable-next-line no-script-url
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "//evil.example.com",
    "maps.example.com",
    "not a url at all",
  ]) {
    const err = refused({ locationUrl: bad });
    assert.match(err, /https/, `${bad} should be refused with an https message`);
  }
});

test("the shared predicate is the one the client will also use", () => {
  // Exported from @gamenight/shared precisely so the render guard and the write
  // guard cannot drift. Two copies of a security rule drift; one does not.
  assert.equal(isHttpsUrl("https://example.com"), true);
  assert.equal(isHttpsUrl("http://example.com"), false);
  assert.equal(isHttpsUrl("javascript:alert(1)"), false);
  assert.equal(isHttpsUrl(""), false);
  assert.equal(isHttpsUrl(null), false);
  assert.equal(isHttpsUrl(undefined), false);
  assert.equal(isHttpsUrl(42), false);
  // A newline inside a scheme is the classic regex bypass, and is why this
  // parses with the URL constructor rather than matching a pattern.
  assert.equal(isHttpsUrl("java\nscript:alert(1)"), false);
});

// ---------- the routes actually use it ----------

const events = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "events.ts"),
  "utf8",
);

test("BOTH routes parse the details, and PATCH writes only what it was sent", () => {
  assert.equal(
    events.match(/parseEventDetails\(req\.body\)/g)?.length,
    2,
    "create and PATCH must both go through the parser",
  );
  // The bug this guards: the old PATCH wrote `{ scheduledFor, status }`
  // unconditionally, so a widened route that kept that line would blank the
  // date on every notes edit.
  assert.doesNotMatch(events, /\.set\(\{ scheduledFor, status \}\)/);
  assert.match(events, /await db\.update\(events\)\.set\(patch\)/);
  assert.match(events, /if \("scheduledFor" in \(req\.body \?\? \{\}\)\) \{/);
});

test("an empty PATCH is still a 400, and the 403 no longer names the date", () => {
  assert.match(events, /Nothing to update/);
  assert.match(events, /can change this night/);
  assert.doesNotMatch(events, /can change the date/);
});

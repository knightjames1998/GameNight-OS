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

// ---------------------------------------------------------------------------
// THE PLACE, WHICH IS ONE VALUE IN THREE COLUMNS.
//
// A latitude with no longitude is not a partial location, it is a row that means
// nothing, and a coordinate with no ref is a pin that can never be re-resolved.
// The client sends them together; "the client sends them together" is a habit
// rather than a constraint, and the write is where a habit becomes a rule.

test("A PLACE IS SET AS A TRIO, and comes back as one", () => {
  const f = ok({ locationLat: 41.9484, locationLng: -87.6553, locationRef: "W:3374814" });
  assert.equal(f.locationLat, 41.9484);
  assert.equal(f.locationLng, -87.6553);
  assert.equal(f.locationRef, "W:3374814");
});

test("THE TRIO IS ABSENT-ABLE, which is what keeps PATCH partial", () => {
  // The regression this whole file exists for, in its newest shape: a body
  // carrying only notes must not blank the coordinates of a night that has them.
  const f = ok({ notes: "Bring a chair" });
  assert.ok(!("locationLat" in f), "an unmentioned coordinate must not be written");
  assert.ok(!("locationLng" in f));
  assert.ok(!("locationRef" in f));
});

test("clearing clears all three, from either spelling of empty", () => {
  // null from a JSON client, "" from an emptied input: same intent.
  for (const blank of [null, ""]) {
    const f = ok({ locationLat: blank, locationLng: blank, locationRef: blank });
    assert.equal(f.locationLat, null);
    assert.equal(f.locationLng, null);
    assert.equal(f.locationRef, null);
  }
  // Mentioning only one of them, empty, still clears the whole place: there is
  // no coherent half of this value to keep.
  const one = ok({ locationRef: null });
  assert.equal(one.locationLat, null);
  assert.equal(one.locationLng, null);
  assert.equal(one.locationRef, null);
});

test("A LATITUDE WITH NO LONGITUDE IS REFUSED, not written half", () => {
  assert.match(refused({ locationLat: 41.9484 }), /latitude and a longitude/);
  assert.match(refused({ locationLng: -87.6553 }), /latitude and a longitude/);
  assert.match(
    refused({ locationLat: 41.9484, locationLng: -87.6553 }),
    /reference/,
    "a pin with no ref could never be re-resolved",
  );
});

test("a coordinate off the Earth is REFUSED rather than clamped", () => {
  // Clamping would write a plausible wrong answer into a column nothing else
  // validates, which is the failure mode this app keeps finding.
  const ref = { locationRef: "N:1" };
  assert.match(refused({ ...ref, locationLat: 91, locationLng: 0 }), /-90 and 90/);
  assert.match(refused({ ...ref, locationLat: -91, locationLng: 0 }), /-90 and 90/);
  assert.match(refused({ ...ref, locationLat: 0, locationLng: 181 }), /-180 and 180/);
  assert.match(refused({ ...ref, locationLat: 0, locationLng: -181 }), /-180 and 180/);
  // The poles and the date line are real places.
  assert.equal(ok({ ...ref, locationLat: 90, locationLng: 180 }).locationLat, 90);
});

test("a coordinate that is not a number is refused", () => {
  const ref = { locationRef: "N:1" };
  assert.match(refused({ ...ref, locationLat: "41.9", locationLng: -87.6 }), /latitude and a longitude/);
  assert.match(refused({ ...ref, locationLat: NaN, locationLng: -87.6 }), /latitude and a longitude/);
  assert.match(refused({ ...ref, locationLat: Infinity, locationLng: -87.6 }), /latitude and a longitude/);
});

test("zero is a real coordinate and must not read as absent", () => {
  // Null Island is not a game night, but 0 is falsy and this is exactly the
  // shape where a truthiness check silently drops a valid value.
  const f = ok({ locationLat: 0, locationLng: 0, locationRef: "N:1" });
  assert.equal(f.locationLat, 0);
  assert.equal(f.locationLng, 0);
});

test("a blank or oversized ref is refused", () => {
  const co = { locationLat: 41.9, locationLng: -87.6 };
  assert.match(refused({ ...co, locationRef: "   " }), /reference/);
  assert.match(refused({ ...co, locationRef: 12345 }), /reference/);
  assert.match(refused({ ...co, locationRef: "N:" + "9".repeat(80) }), /64 characters/);
});

test("THE TWO COPY PATHS CARRY THE PIN, or a duplicate looks right and is useless", () => {
  // Both paths already copied location and notes and would have silently
  // dropped the coordinates, producing a night that is identical on screen and
  // has no pin. Asserted at the source, since neither can run without a DB.
  const generated = events.slice(events.indexOf("async function generateDueOccurrences"));
  for (const field of ["locationLat", "locationLng", "locationRef"]) {
    assert.match(
      generated,
      new RegExp(`${field}: latest\\?\\.${field} \\?\\? null`),
      `the recurring generator drops ${field}`,
    );
  }
  const group = readSrc("../../web/src/pages/GroupPage.tsx");
  const dup = group.slice(group.indexOf("async function duplicateEvent"));
  for (const field of ["locationLat", "locationLng", "locationRef"]) {
    assert.match(dup, new RegExp(`${field}: e\\.${field}`), `run-it-again drops ${field}`);
  }
});

test("the summary carries the place, because run-it-again reads it off a tile", () => {
  // eventSummary spreads the row, so these ride along; what has to be true is
  // that the CLIENT's EventSummary declares them, or duplicateEvent would be
  // reading fields TypeScript does not know are there. This is the August crash
  // in miniature: a shape the list did not expect.
  const api = readSrc("../../web/src/api.ts");
  const summary = api.slice(api.indexOf("export interface EventSummary"), api.indexOf("export interface EventDetail"));
  for (const field of ["locationLat", "locationLng", "locationRef"]) {
    assert.match(summary, new RegExp(`${field}:`), `EventSummary is missing ${field}`);
  }
});

/** Read a source file relative to this test, for the wiring assertions above. */
function readSrc(rel: string): string {
  return readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), rel), "utf8");
}

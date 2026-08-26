// RECURRING NIGHTS: the request half, and the hazard that makes the delete
// worth a test of its own.
//
// THE HAZARD, first, because it is the reason this file exists. Generation runs
// for every ACTIVE series with no un-passed occurrence. So if a
// delete-and-stop-repeating deletes the night and does NOT stop the series, the
// very next load of the crew page regenerates the night the host just deleted,
// with the same title, in the same slot. To the host the delete silently
// failed. To the code everything succeeded. The two writes therefore have to be
// ONE TRANSACTION, and the series has to be stopped FIRST: if something did tear
// between them, a stopped series with its night intact is recoverable by hand,
// while a live series with its night gone repairs itself into the bug.
//
// The 2026-08-20 cascade session exists because delete handlers here ran
// sequential writes outside a transaction, so this is the same class of bug with
// a new table, checked the same way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRepeat } from "../src/events.js";
import { MAX_INTERVAL_WEEKS } from "@gamenight/shared";

const DATE = new Date("2026-09-10T19:00:00.000Z");
const ok = (raw: unknown, when: Date | null = DATE) => {
  const r = parseRepeat(raw, when);
  assert.ok(r.ok, `expected a parse, got: ${r.ok ? "" : r.error}`);
  return r.rule;
};
const refused = (raw: unknown, when: Date | null = DATE) => {
  const r = parseRepeat(raw, when);
  assert.equal(r.ok, false, "expected a refusal");
  return r.ok ? "" : r.error;
};

// ---------- no repeat is the default, and stays free ----------

test("a body with no repeat creates an ordinary night", () => {
  assert.equal(ok(undefined), null);
  assert.equal(ok(null), null);
  assert.equal(ok({}), null);
  assert.equal(ok({ kind: null }), null);
  assert.equal(ok({ kind: "none" }), null, "the picker's default sends this");
});

// ---------- a repeat needs a date and a zone ----------

test("A REPEAT WITHOUT A DATE IS REFUSED, not silently dropped", () => {
  // The date IS the anchor: "every week" with no week to start from cannot be
  // computed. Dropping it quietly would leave a host believing they set one.
  const err = refused({ kind: "weekly", timeZone: "America/Chicago" }, null);
  assert.match(err, /date/);
});

test("A REPEAT WITHOUT A TIME ZONE IS REFUSED, and that is the DST contract", () => {
  // Same time of day, not same elapsed hours. This server runs in UTC where the
  // clocks never change, so it cannot work out the crew's zone for itself, and
  // a series without one would drift by an hour twice a year.
  assert.match(refused({ kind: "weekly" }), /time zone/i);
  assert.match(refused({ kind: "weekly", timeZone: "   " }), /time zone/i);
  assert.match(refused({ kind: "weekly", timeZone: "Mars/Olympus" }), /Unknown time zone/);
  assert.match(refused({ kind: "weekly", timeZone: 42 }), /time zone/i);
});

test("an unknown kind is refused rather than treated as weekly", () => {
  assert.match(refused({ kind: "daily", timeZone: "UTC" }), /Unknown repeat/);
  assert.match(refused({ kind: "WEEKLY", timeZone: "UTC" }), /Unknown repeat/);
});

// ---------- the three kinds ----------

test("weekly and monthly carry no interval", () => {
  assert.deepEqual(ok({ kind: "weekly", timeZone: "America/Chicago" }), {
    kind: "weekly",
    intervalWeeks: null,
    timeZone: "America/Chicago",
  });
  assert.deepEqual(ok({ kind: "monthly", timeZone: "Europe/London" }), {
    kind: "monthly",
    intervalWeeks: null,
    timeZone: "Europe/London",
  });
  // An interval sent alongside weekly is ignored rather than stored, so a
  // stale field on a client cannot turn a weekly series into something else.
  assert.equal(ok({ kind: "weekly", intervalWeeks: 3, timeZone: "UTC" })!.intervalWeeks, null);
});

test("custom_weeks takes 1 to the cap, and refuses the rest", () => {
  assert.equal(ok({ kind: "custom_weeks", intervalWeeks: 2, timeZone: "UTC" })!.intervalWeeks, 2);
  assert.equal(
    ok({ kind: "custom_weeks", intervalWeeks: MAX_INTERVAL_WEEKS, timeZone: "UTC" })!.intervalWeeks,
    MAX_INTERVAL_WEEKS,
  );
  for (const bad of [0, -1, MAX_INTERVAL_WEEKS + 1, "many", null, undefined, NaN, Infinity]) {
    assert.match(
      refused({ kind: "custom_weeks", intervalWeeks: bad, timeZone: "UTC" }),
      /1 to /,
      `${String(bad)} weeks should be refused`,
    );
  }
  // A decimal truncates rather than storing something no schedule can express.
  assert.equal(ok({ kind: "custom_weeks", intervalWeeks: 2.9, timeZone: "UTC" })!.intervalWeeks, 2);
});

// ---------- the routes, asserted at the source ----------

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "events.ts"),
  "utf8",
);
const deleteRoute = src.slice(src.indexOf('eventsRouter.delete("/events/:id"'));
const deleteBody = deleteRoute.slice(0, deleteRoute.indexOf("\n});"));

test("DELETE-AND-STOP IS ONE TRANSACTION, AND THE SERIES STOPS FIRST", () => {
  // The hazard at the top of this file, pinned three ways: both writes are
  // inside the same transaction callback, and the update comes before the
  // cascade within it.
  const tx = deleteBody.slice(deleteBody.indexOf("db.transaction"));
  const stop = tx.indexOf("eventSeries).set({ active: false })");
  const cascade = tx.indexOf("deleteEventCascade(tx");
  assert.ok(stop > 0, "the series stop is not inside the delete transaction");
  assert.ok(cascade > 0, "the cascade is not inside the delete transaction");
  assert.ok(stop < cascade, "the series must be stopped BEFORE the night is deleted");
});

test("THE DELETE SCOPE DEFAULTS TO THIS NIGHT ONLY", () => {
  // So an old client, or a script that knows nothing about series, cannot stop
  // one by omission. Stopping is opt-in and explicit on both ends.
  assert.match(deleteBody, /req\.body\?\.scope === "series"/);
  assert.doesNotMatch(deleteBody, /scope !== "this"/, "an inverted default would opt everyone in");
});

test("generation inserts with the race guard rather than a lock", () => {
  // Two phones opening the crew page at the same moment both reach the insert.
  // The unique index on (series_id, series_index) makes the loser a no-op.
  const gen = src.slice(src.indexOf("async function generateDueOccurrences"));
  assert.match(gen, /\.onConflictDoNothing\(\)/);
  assert.match(gen, /dueOccurrence\(/, "the decision must go through the tested function");
  // And it must never compute a date from an event row.
  assert.doesNotMatch(gen, /scheduledFor\.getTime\(\) \+/);
});

test("the seed occurrence is index 0, which every later one is measured from", () => {
  assert.match(src, /seriesIndex: seriesId \? 0 : null/);
});

test("stopping a repeat leaves the night alone", () => {
  // The PATCH half: it updates the SERIES and never touches the event row on
  // that path, which is what the copy on the button promises.
  const patch = src.slice(src.indexOf('eventsRouter.patch("/events/:id"'));
  const body = patch.slice(0, patch.indexOf("\n});"));
  assert.match(body, /stopRepeating === true/);
  assert.match(body, /eventSeries\)\.set\(\{ active: false \}\)/);
  // A stop-only PATCH must not be refused as an empty body.
  assert.match(body, /Object\.keys\(patch\)\.length === 0 && !stopRepeating/);
});

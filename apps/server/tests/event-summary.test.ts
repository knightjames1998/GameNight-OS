// THE SHAPE TWO ENDPOINTS RETURN, and the crash that proved they were two.
//
// THE BUG THIS PINS, because it is worth stating in full: the crew page's
// "run it again" button POSTs to `/groups/:groupId/events` and writes the
// response STRAIGHT INTO ITS CACHED LIST, the same way the delete handler
// writes the shortened list. But that route returned the bare `events` row,
// while the list route built a summary with `counts`, `myStatus` and
// `seriesActive` inline. The two are indistinguishable to a client, so a
// duplicate landed in the cached array with no `counts` at all, the tile
// rendered `e.counts.yes` on the next visit, and the crew page threw into its
// route boundary.
//
// WHAT MADE IT PERMANENT RATHER THAN ANNOYING: the cached array is read back
// during the FIRST render (cache.ts returns it synchronously so the page paints
// without a spinner), so the throw happens before any revalidation can replace
// it. The boundary's own Reload button re-ran exactly the same first render off
// exactly the same localStorage entry. The page was dead until a deploy changed
// the cache namespace, which is why the report was "it KEEPS crashing".
//
// So the shape is ONE function now, and this file asserts both halves: what it
// answers, and that both routes go through it. The class of bug is the repo's
// recurring one, two spellings of the same thing with nothing reconciling them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eventSummary } from "../src/events.js";

type EventRow = Parameters<typeof eventSummary>[0];
type RsvpRow = Parameters<typeof eventSummary>[1][number];

const row = (over: Partial<EventRow> = {}) =>
  ({
    id: "e1",
    groupId: "g1",
    title: "Thursday Night",
    scheduledFor: null,
    status: "draft",
    createdBy: "u1",
    createdAt: new Date("2026-08-26T00:00:00.000Z"),
    location: null,
    locationUrl: null,
    notes: null,
    beerioCode: null,
    seriesId: null,
    seriesIndex: null,
    ...over,
  }) as unknown as EventRow;

const rsvp = (userId: string, status: string) =>
  ({ id: `r-${userId}`, eventId: "e1", groupId: "g1", userId, status }) as unknown as RsvpRow;

// ---------- what it answers ----------

test("A NIGHT WITH NO RSVPS STILL HAS COUNTS, which is the whole fix", () => {
  // The freshly created night. Every field the tile reads has to be PRESENT and
  // zero rather than absent: `{}` and `{ yes: 0 }` render identically and only
  // one of them survives `e.counts.yes`.
  const s = eventSummary(row(), [], "u1", new Set());
  assert.deepEqual(s.counts, { yes: 0, maybe: 0, no: 0 });
  assert.equal(s.myStatus, null);
  assert.equal(s.seriesActive, false);
});

test("it counts each answer once and reports mine", () => {
  const s = eventSummary(
    row(),
    [rsvp("u1", "yes"), rsvp("u2", "yes"), rsvp("u3", "maybe"), rsvp("u4", "no")],
    "u1",
    new Set(),
  );
  assert.deepEqual(s.counts, { yes: 2, maybe: 1, no: 1 });
  assert.equal(s.myStatus, "yes");
});

test("somebody who has not answered has no status, and that is not 'no'", () => {
  const s = eventSummary(row(), [rsvp("u2", "no")], "u1", new Set());
  assert.equal(s.myStatus, null, "silence is not a refusal");
  assert.deepEqual(s.counts, { yes: 0, maybe: 0, no: 1 });
});

test("the night keeps every column it arrived with", () => {
  // The client's EventSummary is the row PLUS three derived fields, so dropping
  // a column here would empty a tile rather than crash it: quieter and worse.
  const s = eventSummary(row({ title: "Poker", location: "Dave's" }), [], "u1", new Set());
  assert.equal(s.title, "Poker");
  assert.equal(s.location, "Dave's");
  assert.equal(s.id, "e1");
});

// ---------- whether a series is still running ----------

test("SERIES ACTIVE IS ABOUT THE SERIES, not about having one", () => {
  // The tile asks the three-outcome delete question only when there is
  // something left to stop. A night belonging to a series somebody already
  // stopped keeps the plain confirm it always had.
  assert.equal(eventSummary(row({ seriesId: "s1" }), [], "u1", new Set(["s1"])).seriesActive, true);
  assert.equal(eventSummary(row({ seriesId: "s1" }), [], "u1", new Set()).seriesActive, false);
  assert.equal(eventSummary(row(), [], "u1", new Set(["s1"])).seriesActive, false);
});

// ---------- both routes go through it ----------

test("THE CREATE ROUTE NO LONGER RETURNS THE BARE ROW", () => {
  // The exact regression. `res.json(event)` is what shipped the crash, and it
  // is what a future edit would reach for again, so it is named rather than
  // only implied by the positive assertion below.
  const src = read("../src/events.ts");
  assert.doesNotMatch(
    src,
    /res\.json\(event\);/,
    "the create route is returning the raw events row again; the crew page caches this",
  );
  assert.match(src, /res\.json\(\s*eventSummary\(/, "the create route must answer with a summary");
});

test("the list route builds its rows from the same function", () => {
  const src = read("../src/events.ts");
  assert.equal(
    src.match(/eventSummary\(/g)?.length,
    // The definition, the create route, the list route.
    3,
    "there must be exactly one definition of the summary and exactly two callers",
  );
  assert.doesNotMatch(
    src,
    /seriesActive: !!e\.seriesId/,
    "the list is building the summary inline again instead of calling eventSummary",
  );
});

test("THE CLIENT REALLY DOES CACHE THE CREATE RESPONSE, which is why all of this matters", () => {
  // The control. Every assertion above is about a shape whose only consumer is
  // this one line; if the write-through were ever removed the tests would keep
  // passing while guarding nothing, so the reason is asserted too rather than
  // only described in a comment.
  const group = read("../../web/src/pages/GroupPage.tsx");
  assert.match(
    group,
    /setEvents\(\[created, \.\.\.\(events \?\? \[\]\)\]\)/,
    "duplicateEvent no longer writes the create response into the cached list",
  );
  assert.match(group, /const created = await api<EventSummary>/);
});

function read(rel: string): string {
  return readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), rel), "utf8");
}

// THE RECURRENCE RULE, tested before anything calls it.
//
// THE PART THAT WILL BE WRONG IF IT IS NOT TESTED FIRST IS DAYLIGHT SAVING, and
// it is first in this file for that reason. The contract is SAME TIME OF DAY,
// NOT SAME ELAPSED HOURS: a 7pm Thursday game night in March is a 7pm game night
// in April. Adding 7 * 24 hours to an instant is the version everybody writes
// first and it moves the night by an hour the week the clocks change, which is
// precisely when somebody turns up an hour out and nothing anywhere errors.
//
// THE OTHER HALF OF THE DESIGN IS ANCHOR PLUS INDEX. Nothing here takes a
// "previous occurrence": if the next night were computed from the last night's
// actual date, moving ONE night from Thursday to Friday would make every night
// after it a Friday, and a one-off edit would have silently rewritten the rule.
// Every case below computes from the anchor and an index, which is the only
// input the real caller has either.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextOccurrence,
  describeSeries,
  ordinalOfMonth,
  isPastEvent,
  EVENT_PAST_MS,
  isSeriesKind,
  MAX_INTERVAL_WEEKS,
} from "../src/recurrence.js";

const CHI = "America/Chicago";
const LON = "Europe/London";

/** What a wall clock in `tz` reads at this instant, as "YYYY-MM-DD HH:mm Day". */
function wall(at: Date, tz: string): string {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")} ${g("weekday")}`;
}

/** A wall time in a zone, as the instant it names. Fixtures read as clocks. */
function at(tz: string, iso: string): Date {
  // Built by search rather than by hand so a fixture cannot encode the very
  // offset bug the tests exist to catch.
  const [d, t] = iso.split(" ");
  const [y, mo, da] = d!.split("-").map(Number);
  const [h, mi] = t!.split(":").map(Number);
  // The target is FIXED and the guess moves. Comparing the shown time against
  // the moving guess re-applies the zone offset every pass and walks away from
  // the answer; this helper had exactly that bug and so did the module it
  // tests, which is the argument for writing the fixtures by search rather than
  // by hand.
  const target = Date.UTC(y!, mo! - 1, da!, h!, mi!);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const shown = wall(new Date(guess), tz);
    const [sd, st] = shown.split(" ");
    const [sy, smo, sda] = sd!.split("-").map(Number);
    const [sh, smi] = st!.split(":").map(Number);
    const drift = Date.UTC(sy!, smo! - 1, sda!, sh!, smi!) - target;
    if (drift === 0) break;
    guess -= drift;
  }
  return new Date(guess);
}

// ---------- daylight saving, which is the whole reason for the time zone ----------

test("SPRING FORWARD: a 7pm Thursday in March is still 7pm in April", () => {
  // US DST begins 2026-03-08. A weekly night seeded the Thursday before it must
  // read 19:00 on every Thursday after it, not 18:00 or 20:00.
  const anchor = at(CHI, "2026-03-05 19:00");
  const rule = { anchor, kind: "weekly" as const, timeZone: CHI };
  assert.equal(wall(nextOccurrence(rule, 0), CHI), "2026-03-05 19:00 Thu");
  assert.equal(wall(nextOccurrence(rule, 1), CHI), "2026-03-12 19:00 Thu", "the week DST started");
  assert.equal(wall(nextOccurrence(rule, 5), CHI), "2026-04-09 19:00 Thu");
  // And the instant really did move by 167 hours across the boundary, not 168,
  // which is the arithmetic a UTC version gets wrong in the other direction.
  const hours = (nextOccurrence(rule, 1).getTime() - anchor.getTime()) / 3_600_000;
  assert.equal(hours, 167, "the elapsed time is 167h; it is the WALL CLOCK that is fixed");
});

test("FALL BACK: the same, in the other direction", () => {
  // US DST ends 2026-11-01.
  const rule = { anchor: at(CHI, "2026-10-29 19:00"), kind: "weekly" as const, timeZone: CHI };
  assert.equal(wall(nextOccurrence(rule, 1), CHI), "2026-11-05 19:00 Thu");
  const hours = (nextOccurrence(rule, 1).getTime() - rule.anchor.getTime()) / 3_600_000;
  assert.equal(hours, 169, "169h across the fall boundary, and still 19:00");
});

test("a zone with different DST dates is handled by the zone, not by a guess", () => {
  // The UK changes on 2026-03-29, three weeks after the US. A rule that hardcoded
  // American dates would be wrong here and right at home, which is the worst
  // shape of bug to own.
  const rule = { anchor: at(LON, "2026-03-19 19:30"), kind: "weekly" as const, timeZone: LON };
  assert.equal(wall(nextOccurrence(rule, 1), LON), "2026-03-26 19:30 Thu");
  assert.equal(wall(nextOccurrence(rule, 2), LON), "2026-04-02 19:30 Thu", "after BST began");
});

test("MONTHLY CROSSES DST TOO, and holds its wall time", () => {
  const rule = { anchor: at(CHI, "2026-02-19 19:00"), kind: "monthly" as const, timeZone: CHI };
  assert.equal(wall(nextOccurrence(rule, 0), CHI), "2026-02-19 19:00 Thu", "3rd Thursday");
  assert.equal(wall(nextOccurrence(rule, 1), CHI), "2026-03-19 19:00 Thu");
  assert.equal(wall(nextOccurrence(rule, 2), CHI), "2026-04-16 19:00 Thu", "still 19:00 in DST");
});

// ---------- weekly and custom ----------

test("weekly is the anchor plus seven days a time, forever", () => {
  const rule = { anchor: at(CHI, "2026-06-04 20:00"), kind: "weekly" as const, timeZone: CHI };
  assert.equal(wall(nextOccurrence(rule, 1), CHI), "2026-06-11 20:00 Thu");
  assert.equal(wall(nextOccurrence(rule, 4), CHI), "2026-07-02 20:00 Thu", "across a month end");
  assert.equal(wall(nextOccurrence(rule, 30), CHI), "2026-12-31 20:00 Thu", "across a year end");
});

test("custom_weeks is fortnightly, which is the case it exists for", () => {
  const rule = {
    anchor: at(CHI, "2026-06-04 20:00"),
    kind: "custom_weeks" as const,
    intervalWeeks: 2,
    timeZone: CHI,
  };
  assert.equal(wall(nextOccurrence(rule, 1), CHI), "2026-06-18 20:00 Thu");
  assert.equal(wall(nextOccurrence(rule, 2), CHI), "2026-07-02 20:00 Thu");
  // Three weeks, and a missing or nonsense interval falls back to one rather
  // than producing an occurrence in the same slot forever.
  const three = { ...rule, intervalWeeks: 3 };
  assert.equal(wall(nextOccurrence(three, 1), CHI), "2026-06-25 20:00 Thu");
  const broken = { ...rule, intervalWeeks: 0 };
  assert.equal(wall(nextOccurrence(broken, 1), CHI), "2026-06-11 20:00 Thu", "0 reads as 1");
  const missing = { anchor: rule.anchor, kind: "custom_weeks" as const, timeZone: CHI };
  assert.equal(wall(nextOccurrence(missing, 1), CHI), "2026-06-11 20:00 Thu");
});

// ---------- monthly, which is the ordinal weekday ----------

test("MONTHLY IS THE SAME WEEKDAY POSITION, not the same date", () => {
  // The decision: "third Thursday", not "the 17th". A same-date monthly has no
  // answer for the 29th through 31st in most months, and a monthly game night is
  // culturally an ordinal weekday anyway.
  const rule = { anchor: at(CHI, "2026-09-17 19:00"), kind: "monthly" as const, timeZone: CHI };
  assert.equal(ordinalOfMonth(17), 3);
  assert.equal(wall(nextOccurrence(rule, 1), CHI), "2026-10-15 19:00 Thu", "3rd Thu of October");
  assert.equal(wall(nextOccurrence(rule, 2), CHI), "2026-11-19 19:00 Thu");
  assert.equal(wall(nextOccurrence(rule, 3), CHI), "2026-12-17 19:00 Thu");
});

test("A FIFTH FRIDAY ANCHOR MEANS LAST FRIDAY, because most months have no fifth", () => {
  // 2026-01-30 is the fifth Friday of January. A series that insisted on a fifth
  // would skip February, March, April and most of the year.
  assert.equal(ordinalOfMonth(30), 5);
  const rule = { anchor: at(CHI, "2026-01-30 19:00"), kind: "monthly" as const, timeZone: CHI };
  assert.equal(wall(nextOccurrence(rule, 1), CHI), "2026-02-27 19:00 Fri", "last Fri of February");
  assert.equal(wall(nextOccurrence(rule, 2), CHI), "2026-03-27 19:00 Fri");
  assert.equal(wall(nextOccurrence(rule, 3), CHI), "2026-04-24 19:00 Fri");
  // May 2026 HAS a fifth Friday (the 29th), and last means last.
  assert.equal(wall(nextOccurrence(rule, 4), CHI), "2026-05-29 19:00 Fri");
});

test("a 31st anchor is just a weekday ordinal like any other", () => {
  // 2026-08-31 is a Monday and the fifth Monday of August, so it reads as last.
  assert.equal(ordinalOfMonth(31), 5);
  const rule = { anchor: at(CHI, "2026-08-31 18:00"), kind: "monthly" as const, timeZone: CHI };
  assert.equal(wall(nextOccurrence(rule, 1), CHI), "2026-09-28 18:00 Mon");
  assert.equal(wall(nextOccurrence(rule, 2), CHI), "2026-10-26 18:00 Mon");
});

test("FEBRUARY, including a leap year, and the year rolling over", () => {
  // First Sunday, through a February and across New Year.
  const rule = { anchor: at(CHI, "2026-11-01 17:00"), kind: "monthly" as const, timeZone: CHI };
  assert.equal(ordinalOfMonth(1), 1);
  assert.equal(wall(nextOccurrence(rule, 1), CHI), "2026-12-06 17:00 Sun");
  assert.equal(wall(nextOccurrence(rule, 2), CHI), "2027-01-03 17:00 Sun", "across the year");
  assert.equal(wall(nextOccurrence(rule, 3), CHI), "2027-02-07 17:00 Sun");
  // A leap February, reached from a fourth-Saturday anchor.
  const leap = { anchor: at(CHI, "2028-01-22 17:00"), kind: "monthly" as const, timeZone: CHI };
  assert.equal(ordinalOfMonth(22), 4);
  assert.equal(wall(nextOccurrence(leap, 1), CHI), "2028-02-26 17:00 Sat", "4th Sat of a leap Feb");
});

test("index 0 is the anchor itself, to the millisecond", () => {
  // The generator inserts the seed at index 0 and computes from there, so an
  // index that quietly shifted the anchor would move the night the host just
  // created.
  const anchor = at(CHI, "2026-06-04 20:00");
  for (const kind of ["weekly", "monthly", "custom_weeks"] as const) {
    assert.equal(nextOccurrence({ anchor, kind, intervalWeeks: 2, timeZone: CHI }, 0).getTime(), anchor.getTime());
  }
});

// ---------- the past test, which both ends now share ----------

test("A NIGHT IS PAST 24 HOURS AFTER ITS TIME, and one definition says so", () => {
  // The crew page has always sorted on this and the server now generates on it.
  // Two copies of the number drift, and the failure is a game night appearing a
  // week early or late with nothing erroring.
  const now = Date.UTC(2026, 5, 10, 12, 0);
  assert.equal(EVENT_PAST_MS, 24 * 60 * 60 * 1000);
  assert.equal(isPastEvent(new Date(now - EVENT_PAST_MS - 1), now), true);
  assert.equal(isPastEvent(new Date(now - EVENT_PAST_MS + 1), now), false, "inside the grace");
  assert.equal(isPastEvent(new Date(now + 86_400_000), now), false);
  // A DATELESS night is never past, which is what keeps a draft (and every
  // duplicate, which lands without a date) out of the past cabinet.
  assert.equal(isPastEvent(null, now), false);
  // ISO strings, because that is what crosses the wire.
  assert.equal(isPastEvent(new Date(now - EVENT_PAST_MS - 1).toISOString(), now), true);
  assert.equal(isPastEvent("not a date", now), false);
});

// ---------- the small guards ----------

test("the kind guard accepts exactly the three kinds", () => {
  for (const k of ["weekly", "monthly", "custom_weeks"]) assert.equal(isSeriesKind(k), true);
  for (const k of ["daily", "yearly", "", null, 3, "WEEKLY"]) assert.equal(isSeriesKind(k), false);
  assert.ok(MAX_INTERVAL_WEEKS >= 2, "fortnightly is the case custom exists for");
});

test("a series says what it is in words a host would use", () => {
  assert.equal(describeSeries("weekly"), "Repeats weekly");
  assert.equal(describeSeries("monthly"), "Repeats monthly");
  assert.equal(describeSeries("custom_weeks", 2), "Repeats every 2 weeks");
  assert.equal(describeSeries("custom_weeks", 3), "Repeats every 3 weeks");
});

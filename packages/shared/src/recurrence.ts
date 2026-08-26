// WHEN THE NEXT ONE IS. The whole of the recurrence rule, pure.
//
// TWO THINGS ABOUT THE SHAPE OF THIS, and both are the design rather than
// implementation detail:
//
// 1. AN OCCURRENCE IS COMPUTED FROM THE SERIES ANCHOR PLUS AN INDEX, NEVER FROM
//    THE PREVIOUS OCCURRENCE'S DATE. If the next night were `lastNight + 7 days`
//    then moving ONE night from Thursday to Friday would make every night after
//    it a Friday: a one-off edit would have silently rewritten the rule. Nothing
//    here reads any event's `scheduled_for`, so a moved occurrence cannot drift
//    the series it belongs to.
//
// 2. IT TAKES AN IANA TIME ZONE AND THE ARITHMETIC HAPPENS IN IT. This is not
//    optional and it is not gold plating. THE CONTRACT IS SAME TIME OF DAY, NOT
//    SAME ELAPSED HOURS: a 7pm Thursday game night in March is still a 7pm game
//    night in April. Adding 7 * 24 hours to an instant is the version everybody
//    writes first, and it moves the night to 6pm or 8pm the week the clocks
//    change, which is exactly when somebody turns up an hour out. UTC arithmetic
//    cannot express this, so the zone travels with the series.

/**
 * How long after its scheduled time a night counts as past.
 *
 * ONE DEFINITION, SHARED, and it lives here because BOTH ENDS NOW NEED IT: the
 * crew page has always used it to sort nights into upcoming and the past
 * cabinet, and the server needs the same test to decide whether a series is owed
 * a new occurrence. Two copies of this number drift, and the failure is a game
 * night appearing a week early or a week late with nothing erroring.
 *
 * 24 hours is the same grace window flake tracking uses.
 */
export const EVENT_PAST_MS = 24 * 60 * 60 * 1000;

/** A night is past once it is more than the grace beyond its scheduled time. */
export function isPastEvent(scheduledFor: Date | string | null, now: number): boolean {
  if (!scheduledFor) return false; // A dateless night is never past.
  const at = scheduledFor instanceof Date ? scheduledFor.getTime() : new Date(scheduledFor).getTime();
  return !Number.isNaN(at) && at < now - EVENT_PAST_MS;
}

export type SeriesKind = "weekly" | "monthly" | "custom_weeks";

export const SERIES_KINDS: readonly SeriesKind[] = ["weekly", "monthly", "custom_weeks"];

export const isSeriesKind = (v: unknown): v is SeriesKind =>
  typeof v === "string" && (SERIES_KINDS as readonly string[]).includes(v);

/** The most weeks a custom series may skip. A year is not a repeat. */
export const MAX_INTERVAL_WEEKS = 12;

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** What clock a wall in `timeZone` shows at this instant. */
function partsIn(at: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // hour12:false still yields "24" for midnight in some ICU versions.
  const hour = get("hour") % 24;
  return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute") };
}

/**
 * The instant at which `timeZone`'s wall clock reads these parts.
 *
 * TWO PASSES, because the offset depends on the answer: you cannot know whether
 * a wall time is in daylight or standard time until you know which instant it
 * is, and you cannot know the instant without the offset. Guess as if the parts
 * were UTC, read back what that instant actually shows in the zone, and correct
 * by the difference. A second pass settles the case where the correction itself
 * crosses the boundary.
 *
 * A WALL TIME THAT DOES NOT EXIST (the hour a spring-forward skips) settles on
 * the instant just after the jump, which is the same thing every calendar app
 * does and the only answer that is not a crash.
 */
function instantOf(parts: ZonedParts, timeZone: string): Date {
  // THE TARGET IS FIXED AND THE GUESS MOVES, and getting that backwards is the
  // bug this had on its first draft: comparing what the zone SHOWS against the
  // current guess (rather than against the wall time being solved for)
  // re-applies the offset on every pass, so each pass walks another six hours
  // away instead of converging. The unit tests caught it before anything called
  // this, which is why they were written first.
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let utc = target;
  for (let pass = 0; pass < 2; pass++) {
    const shown = partsIn(new Date(utc), timeZone);
    const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
    const drift = shownAsUtc - target;
    if (drift === 0) break;
    utc -= drift;
  }
  return new Date(utc);
}

/** The weekday of a calendar date, 0 = Sunday. Zone-independent by construction. */
const dowOf = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day)).getUTCDay();

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Which occurrence of its weekday a date is, 1-5.
 *
 * A DATE IN THE FIFTH WEEK IS TREATED AS THE LAST, per the monthly decision:
 * most months have no fifth Thursday, so a series seeded on one would skip more
 * months than it kept. `5` here means "last", and `occurrenceDate` reads it that
 * way rather than looking for a fifth that usually is not there.
 */
export function ordinalOfMonth(day: number): number {
  return Math.ceil(day / 7);
}

/** The date of the nth (or last) `dow` in a month; `ordinal` 5 means last. */
function occurrenceDate(year: number, month: number, dow: number, ordinal: number): number {
  const firstDow = dowOf(year, month, 1);
  const firstHit = 1 + ((dow - firstDow + 7) % 7);
  if (ordinal >= 5) {
    // Walk forward from the first hit to the last one that still fits.
    const last = daysInMonth(year, month);
    let day = firstHit;
    while (day + 7 <= last) day += 7;
    return day;
  }
  const day = firstHit + 7 * (ordinal - 1);
  // A month with only four of this weekday, asked for a fourth that lands past
  // its end, falls back to the last one rather than spilling into next month.
  return day <= daysInMonth(year, month) ? day : day - 7;
}

export interface OccurrenceRule {
  /** The seed occurrence. NEVER edited, and never read off an event row. */
  anchor: Date;
  kind: SeriesKind;
  /** custom_weeks only. Ignored, and may be null, for the other two. */
  intervalWeeks?: number | null;
  /** IANA zone the wall-clock time belongs to. See the note at the top. */
  timeZone: string;
}

/**
 * The `index`-th occurrence of a series. Index 0 IS the anchor.
 *
 * Weekly and custom_weeks add whole DAYS to the anchor's calendar date, not
 * hours to its instant, which is what keeps the wall-clock time fixed across a
 * daylight-saving boundary. Monthly holds the weekday and its ordinal position
 * instead, so "third Thursday" stays the third Thursday rather than becoming a
 * date that lands on a different day each month.
 */
export function nextOccurrence(rule: OccurrenceRule, index: number): Date {
  const { anchor, kind, timeZone } = rule;
  const a = partsIn(anchor, timeZone);
  if (index === 0) return new Date(anchor.getTime());

  if (kind === "monthly") {
    const dow = dowOf(a.year, a.month, a.day);
    const ordinal = ordinalOfMonth(a.day);
    const monthsOn = a.month - 1 + index;
    const year = a.year + Math.floor(monthsOn / 12);
    const month = (monthsOn % 12) + 1;
    const day = occurrenceDate(year, month, dow, ordinal);
    return instantOf({ year, month, day, hour: a.hour, minute: a.minute }, timeZone);
  }

  const weeks = kind === "custom_weeks" ? Math.max(1, Math.trunc(rule.intervalWeeks ?? 1)) : 1;
  // Days added to the calendar DATE. Date.UTC normalises an overflowing day
  // into the next month for us, which is why this needs no month arithmetic.
  const shifted = new Date(Date.UTC(a.year, a.month - 1, a.day + weeks * 7 * index));
  return instantOf(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: a.hour,
      minute: a.minute,
    },
    timeZone,
  );
}

/** How a series reads on a screen. */
export function describeSeries(kind: SeriesKind, intervalWeeks?: number | null): string {
  if (kind === "weekly") return "Repeats weekly";
  if (kind === "monthly") return "Repeats monthly";
  const n = Math.max(1, Math.trunc(intervalWeeks ?? 1));
  return n === 2 ? "Repeats every 2 weeks" : `Repeats every ${n} weeks`;
}

// ---------------------------------------------------------------------------

/** The only two things the due-check needs off an occurrence row. */
export interface OccurrenceRow {
  scheduledFor: Date | string | null;
  seriesIndex: number | null;
}

/**
 * Is this series owed a night, and if so which index and when?
 *
 * OWED MEANS NO OCCURRENCE OF IT IS STILL UN-PASSED. Exactly one live night per
 * series at a time, by requirement, so this answers at most one night per call
 * and usually none.
 *
 * THE INDEX COMES OFF THE ROWS, THE DATE COMES OFF THE ANCHOR, and keeping those
 * two apart is the whole point: `max(seriesIndex) + 1` survives a night being
 * deleted (the remaining rows still know where the series is) and the date never
 * consults any event's `scheduledFor`, so a night somebody MOVED cannot drag the
 * ones after it.
 *
 * IT CATCHES UP RATHER THAN MATERIALISING THE PAST: a crew that stops opening
 * the app for two months comes back to the NEXT night, not to eight dead ones.
 * The walk is bounded, because an anchor far enough in the past would otherwise
 * spin: at one step per week, 100 covers two years.
 */
export function dueOccurrence(
  rule: OccurrenceRule,
  rows: readonly OccurrenceRow[],
  now: number,
  maxCatchUp = 100,
): { index: number; when: Date } | null {
  if (rows.some((r) => !isPastEvent(r.scheduledFor, now))) return null;

  const highest = rows.reduce((max, r) => Math.max(max, r.seriesIndex ?? 0), 0);
  let index = highest + 1;
  let when = nextOccurrence(rule, index);
  for (let step = 0; step < maxCatchUp && isPastEvent(when, now); step++) {
    index += 1;
    when = nextOccurrence(rule, index);
  }
  return { index, when };
}

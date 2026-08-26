// GameNight OS schema. Rule: every domain table carries group_id.
// Multi-tenancy from day one. No singleton assumptions.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  doublePrecision,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

// ---------- Identity ----------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  // Optional password (scrypt hash). Null means magic-link-only account.
  // Added pre-v1 to cut login friction; magic links remain the fallback.
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Passwordless auth. One row backs BOTH ways in for a request: the emailed
// magic link (token) and a 6-digit code typed into the app. The code is the
// primary path because an installed iOS PWA has its own cookie jar: a link
// tapped in Mail logs Safari in, not the app, but a typed code never leaves
// the app so the session cookie lands in the right context. The link stays
// as a desktop fallback. Rows are consumed once, then dead.
export const magicLinkTokens = pgTable(
  "magic_link_tokens",
  {
    token: text("token").primaryKey(),
    email: text("email").notNull(),
    // 6-digit code (with leading zeros). Nullable because rows created
    // before this column existed have no code, and link-only flows never
    // need one.
    code: text("code"),
    // Wrong-code guesses against this row. Capped server-side so a code
    // can't be brute forced; hitting the cap marks the row used.
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("magic_link_tokens_email_code_idx").on(t.email, t.code)],
);


// A successful magic link verification creates a session; the session id
// lives in an httpOnly cookie. Logout or expiry kills the row.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ---------- Crew ----------

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // Invite code baked in from day one; join-via-link is the growth loop.
  inviteCode: text("invite_code").notNull().unique(),
  // A personal crew is auto-created the first time someone runs a game
  // mode without a crew (Option B: one system, not a parallel quick-play
  // path). Hidden from the crew list; upgradeable by inviting people.
  isPersonal: boolean("is_personal").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["owner", "admin", "member"] })
      .notNull()
      .default("member"),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_group_user_uq").on(t.groupId, t.userId),
    index("memberships_group_idx").on(t.groupId),
  ],
);

// ---------- Schedule ----------

/**
 * A REPEATING GAME NIGHT'S RULE, ON ITS OWN ROW.
 *
 * THE OBVIOUS VERSION PUTS THE RULE ON THE EVENT AND COPIES IT FORWARD, and it
 * fails twice, both silently:
 *   - DELETING A NIGHT KILLS THE SERIES, because the rule lived on the row that
 *     was deleted. A host tidying up one cancelled Thursday ends their weekly
 *     night and nothing errors.
 *   - MOVING ONE NIGHT DRAGS THE WHOLE SERIES, because the next occurrence would
 *     be computed from the previous event's actual `scheduled_for`. Shifting one
 *     week's game from Thursday to Friday would make every future night a
 *     Friday: a one-off edit rewriting the rule.
 * So the rule lives here, and occurrences are computed from `anchor_at` plus an
 * INDEX. Nothing reads an event's date to decide when the next one is.
 */
export const eventSeries = pgTable(
  "event_series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    title: text("title").notNull(),
    kind: text("kind", { enum: ["weekly", "monthly", "custom_weeks"] }).notNull(),
    /** custom_weeks only; null for the other two. */
    intervalWeeks: integer("interval_weeks"),
    /** The seed occurrence. NEVER edited: every other occurrence is derived. */
    anchorAt: timestamp("anchor_at").notNull(),
    /**
     * THE IANA ZONE THE WALL CLOCK BELONGS TO, and it is not optional.
     *
     * The contract is SAME TIME OF DAY, not same elapsed hours: a 7pm Thursday
     * night in March is still 7pm in April. That is unanswerable from an instant
     * alone, because "add a week" means adding 167, 168 or 169 hours depending
     * on whether the clocks changed in the crew's zone, and this server runs in
     * UTC where they never do. Captured from the creating device.
     */
    timeZone: text("time_zone").notNull(),
    /** A series runs until somebody turns it off. No end date, by decision. */
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("event_series_group_idx").on(t.groupId)],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    title: text("title").notNull(),
    scheduledFor: timestamp("scheduled_for"),
    status: text("status", {
      enum: ["draft", "scheduled", "live", "completed", "cancelled"],
    })
      .notNull()
      .default("draft"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    // The Beerio Kart live room for this event. Set by the host when the
    // room opens; members join THIS code instead of starting their own
    // local tournament (session codes used to live only in localStorage,
    // so every member got a private night).
    beerioCode: text("beerio_code"),
    // When the Beerio room on this event last finished a tournament. Beerio
    // is the one pack with no status column of its own (it reports results
    // fire-and-forget and its state blob is the vendored engine's opaque
    // shape), so without this a room stayed "open" forever once opened and
    // could never age out of the event TV resolver the way the other packs
    // do. Set at completion, cleared when a new room opens on this event.
    // A crew that runs a SECOND tournament on the same code comes back to
    // life on its own: the engine writes state, beerio_sessions.updatedAt
    // moves past this stamp, and the resolver counts it live again.
    beerioCompletedAt: timestamp("beerio_completed_at"),
    // WHERE THE NIGHT IS, AS TWO COLUMNS RATHER THAN ONE, and the split is the
    // whole decision: a pasted maps URL is unreadable as a label ("Dave's" is
    // what a crew calls it, not `https://maps.app.goo.gl/xK9...`), and a typed
    // address is not tappable. One column would have forced every crew to pick
    // which of the two they wanted. Both are optional and either can stand
    // alone. `location_url` is the only user-pasted string this app renders as
    // a navigable link, so it is validated https-only on write AND guarded
    // again at render.
    location: text("location"),
    locationUrl: text("location_url"),
    // PLAIN TEXT. No markdown, no link detection, no rendering surface: this is
    // "bring a chair" and "park on the street", and every one of those features
    // would be a new attack surface on a field any member can write.
    notes: text("notes"),
    /**
     * WHERE THE NIGHT ACTUALLY IS, when a host picked it out of place search
     * rather than typing it. All three are null for free text, which is the
     * COMMON case: most game nights are at somebody's house and a house is not
     * in OpenStreetMap.
     *
     * SET TOGETHER OR NOT AT ALL, enforced at the write. A latitude with no
     * longitude is not a partial location, it is a meaningless row, and a
     * coordinate with no `location_ref` could never be re-resolved.
     *
     * `double precision` rather than numeric: this is a pin on a map, not money,
     * and the float is what every geo consumer expects. Six decimal places is
     * about 11cm, which is far beyond what "the pub on the corner" needs.
     *
     * `location_ref` is the geocoder's own identity for the place, stored as
     * "{osm_type}:{osm_id}" (for example "N:1234567"), so a place can be
     * re-resolved later without this app keeping a second lookup table.
     *
     * THESE UNBLOCK THE GEOFENCED ARRIVAL IDEA, which could not be built at all
     * without a coordinate on the event. It stays blocked on the native wrapper;
     * this is the half of it that lives in the database.
     */
    locationLat: doublePrecision("location_lat"),
    locationLng: doublePrecision("location_lng"),
    locationRef: text("location_ref"),
    /**
     * The series this night is an occurrence of, and which occurrence it is.
     *
     * NULLABLE ON PURPOSE, and the SQL sets `ON DELETE SET NULL`: deleting a
     * series must NOT delete the nights that already happened, because they
     * carry recorded stats. A night whose series is gone is just a night.
     */
    seriesId: uuid("series_id").references(() => eventSeries.id),
    seriesIndex: integer("series_index"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("events_group_idx").on(t.groupId),
    /**
     * THE RACE GUARD. Generation happens lazily on a read of the crew page, so
     * two phones loading it at the same moment both try to create the next
     * occurrence. This index plus `onConflictDoNothing` makes the loser a no-op
     * instead of a duplicate night.
     */
    uniqueIndex("event_series_occurrence_uq").on(t.seriesId, t.seriesIndex),
  ],
);

export const rsvps = pgTable(
  "rsvps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    eventId: uuid("event_id").notNull().references(() => events.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    status: text("status", { enum: ["yes", "no", "maybe"] }).notNull(),
    respondedAt: timestamp("responded_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("rsvps_event_user_uq").on(t.eventId, t.userId),
    index("rsvps_group_idx").on(t.groupId),
  ],
);

// Attendance is separate from RSVP intent: an RSVP is "I plan to come",
// attendance is "I actually showed". Kept apart so flake tracking can
// compare the two, and so someone who never RSVP'd can still check in.
export const eventAttendance = pgTable(
  "event_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    eventId: uuid("event_id").notNull().references(() => events.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    showed: boolean("showed").notNull(),
    markedAt: timestamp("marked_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("event_attendance_event_user_uq").on(t.eventId, t.userId),
    index("event_attendance_group_idx").on(t.groupId),
  ],
);

// ---------- Play ----------
// A game is anything with participants and results. Pack = ruleset/UI layer.
// "mario_kart" is the first pack; "generic" is the fallback.

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    name: text("name").notNull(),
    pack: text("pack").notNull().default("generic"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("games_group_idx").on(t.groupId)],
);

// Bracket state follows the Beerio Kart pattern: entrants (userIds in seed
// order) and results ({matchId: "A"|"B"}) are the stored truth; the full
// bracket is derived from them by the shared engine on every read. The
// matches/match_participants tables below stay empty until a bracket
// completes; Legacy (Phase 5) materializes finished brackets into them
// for cross-game stats.
export const brackets = pgTable(
  "brackets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    eventId: uuid("event_id").notNull().references(() => events.id),
    gameId: uuid("game_id").notNull().references(() => games.id),
    // Text enum is TypeScript-level only (no CHECK constraint), so adding
    // a format is code-only: no schema push needed.
    format: text("format", { enum: ["single_elim", "double_elim", "round_robin"] })
      .notNull()
      .default("single_elim"),
    status: text("status", { enum: ["setup", "live", "completed"] })
      .notNull()
      .default("setup"),
    // When false, only group owners/admins can record or undo results.
    openScoring: boolean("open_scoring").notNull().default(false),
    // Entrant[] from @gamenight/shared: members and/or typed guests.
    // Legacy rows hold bare userId strings; parseEntrants() handles both.
    entrants: jsonb("entrants").$type<unknown[]>().notNull().default([]),
    results: jsonb("results")
      .$type<Record<string, "A" | "B">>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    // Last time a result was recorded or undone. The four session packs have
    // carried an updatedAt since they were built; brackets had only createdAt,
    // so the event TV resolver had no way to tell a bracket being scored all
    // night from one created hours ago and abandoned. Touched on score and on
    // undo, which are the only writes that change what is on the screen.
    // Existing rows take the migration timestamp and so all look freshly
    // touched for one moment; harmless, because completed brackets are
    // filtered out before ranking and a live one genuinely is current.
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("brackets_group_idx").on(t.groupId),
    // BY EVENT, added 2026-08-19 when a night gained the ability to run a
    // second tournament. Three separate reads select brackets by event_id and
    // none of them can use a LIMIT any more (the creation guard, the event
    // page tile and the event TV resolver all need every row to decide), so
    // what was one indexed-by-nothing lookup returning at most one row is now
    // three sequential scans per event on every event page load and every TV
    // poll. The TV route is deliberately uncached, which is what makes this
    // worth an index rather than worth ignoring.
    index("brackets_event_idx").on(t.eventId),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    bracketId: uuid("bracket_id").references(() => brackets.id),
    gameId: uuid("game_id").references(() => games.id),
    eventId: uuid("event_id").references(() => events.id),
    externalKey: text("external_key"),
    // Generic per-match label a pack may attach. The Mario Party pack
    // stores the board/map played here so "wins on <board>" survives into
    // the lifetime ledger. Null for packs that don't use it.
    label: text("label"),
    // The pack FORMAT this result was played under (free / bestof / koth /
    // ffa / grandprix / board). Distinct from label because label can't tell
    // formats apart (Ping Pong free play and KOTH both label bo1). Feeds the
    // per-format lifetime stats and the night recap's grouping. Null on
    // pre-existing rows and on brackets.
    format: text("format"),
    // Full completion snapshot, for a pack that reports a finished result
    // fire-and-forget instead of keeping its session server-side. Only
    // Beerio Kart populates it today: its vendored engine POSTs the final
    // placements for EVERY racer, and the completion route used to keep
    // only the names matching a crew member and discard the rest, so a
    // guest -> member backfill had nothing to reopen. The other packs
    // persist their whole session jsonb (brackets, smash_sessions,
    // game_sessions) and never need this. Null on every pre-existing row.
    rawResult: jsonb("raw_result").$type<{ placements: { name: string; place: number }[] }>(),
    round: integer("round").notNull(),
    position: integer("position").notNull(),
    // When this result was actually played. Every pack writes its matches
    // row once, at completion (never a pending/live row that is filled in
    // later), so the default IS play time and no pack sets this by hand.
    // Feeds the time-based stats: win streaks and recent form, which have
    // no other way to order results. Rows that predate this column carry
    // the migration timestamp, which is meaningless but harmless since the
    // app had no real use before it shipped.
    playedAt: timestamp("played_at").notNull().defaultNow(),
    status: text("status", { enum: ["pending", "live", "completed"] })
      .notNull()
      .default("pending"),
    // Winner advances to this match (null for the final).
    advancesToMatchId: uuid("advances_to_match_id"),
  },
  (t) => [
    index("matches_bracket_idx").on(t.bracketId),
    index("matches_group_idx").on(t.groupId),
    uniqueIndex("matches_event_external_uq").on(t.eventId, t.externalKey),
    // stats.ts joins matches.game_id -> games.id on every leaderboard read.
    index("matches_game_idx").on(t.gameId),
  ],
);

export const matchParticipants = pgTable(
  "match_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    matchId: uuid("match_id").notNull().references(() => matches.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    seed: integer("seed"),
    score: integer("score"),
    placement: integer("placement"),
    isWinner: boolean("is_winner").notNull().default(false),
    // Generic per-participant label a pack may attach to a result. The
    // Smash pack stores the fighter played here so "wins with <fighter>"
    // and "most-played" survive into the lifetime ledger. Null for packs
    // that don't use it (brackets, Beerio).
    character: text("character"),
    // Generic per-participant metadata bag a pack may attach. The Mario
    // Party pack stores the bonus stars a player won here, e.g.
    // { bonusStars: ["Minigame Star", "Coin Star"] }. Null otherwise.
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    // WHICH SIDE OF THIS MATCH THE PLAYER WAS ON. This is the team primitive,
    // and it is deliberately a property of the MATCH rather than of the pack:
    // the same two people are teammates in one game and opponents in the next,
    // so a pack-level flag would be wrong the first time a crew plays doubles
    // and then singles.
    //
    //   null            no team structure. Every row written before this
    //                   column existed, and every free-for-all result forever.
    //                   Two nulls are RIVALS, which is exactly the behaviour
    //                   that shipped before this column: placements decide.
    //   a string        names the side. Two players sharing a non-null value
    //                   were TEAMMATES in that match; different non-null
    //                   values are opponents.
    //
    // The value is opaque and never parsed: it only has to be equal or not.
    // Casino Run writes one constant for everybody, because a co-op run is one
    // team. Doubles ping pong, beer pong, cornhole and foosball will write two
    // values per match, and need no further mechanism than this.
    side: text("side"),
  },
  (t) => [
    uniqueIndex("match_participants_match_user_uq").on(t.matchId, t.userId),
    index("match_participants_group_idx").on(t.groupId),
    // Every personal stats read filters on user_id alone: /me/stats, a member
    // profile, a rivalry, and both friend endpoints. The unique index above
    // cannot serve them because match_id leads it, so without this they all
    // sequential-scan the whole participants table. Added while the table is
    // small, which is the cheap moment rather than the painful one.
    index("match_participants_user_idx").on(t.userId),
  ],
);

// ---------- Beerio Kart game pack ----------
// These back the vendored Beerio Kart app 1:1: it brings its own state
// shapes (full serialized bracket/GP session, spectator predictions,
// Hall of Fame history), stored opaquely as jsonb. Its API contracts are
// implemented in apps/server/src/beerio.ts. Group binding (lifetime
// stats into matches/match_participants) is the port's Session B.

export const beerioSessions = pgTable("beerio_sessions", {
  code: text("code").primaryKey(),
  state: jsonb("state").notNull(),
  predictions: jsonb("predictions")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const beerioHof = pgTable("beerio_hof", {
  code: text("code").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------- Smash pack ----------
// FFA Night and King of the Hill are session-based, not brackets: a night
// is a running log of individual games. The live session (roster,
// assignment mode, per-game log, KOTH state) is stored server-side as
// jsonb, ONE per event, so members join the host's session instead of a
// local copy (standing rule 2). Completed games materialize into
// matches/match_participants (standing rule 5); the jsonb here is the live
// working state, the matches tables are the durable ledger.
export const smashSessions = pgTable("smash_sessions", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => events.id),
  groupId: uuid("group_id").notNull().references(() => groups.id),
  status: text("status", { enum: ["setup", "live", "completed"] })
    .notNull()
    .default("setup"),
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------- Generic session pack ----------
// Newer session-based packs (Mario Kart general tracking today) share one
// table, keyed by (event, pack) so several can run on the same event. Same
// jsonb-working-state + materialize-into-matches model as smash_sessions;
// smash keeps its own table for back-compat. Additive: brand-new table.
export const gameSessions = pgTable(
  "game_sessions",
  {
    eventId: uuid("event_id").notNull().references(() => events.id),
    pack: text("pack").notNull(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    status: text("status", { enum: ["setup", "live", "completed"] })
      .notNull()
      .default("setup"),
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.pack] })],
);

// GameNight OS schema. Rule: every domain table carries group_id.
// Multi-tenancy from day one. No singleton assumptions.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
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

// Magic link auth. A token is emailed, consumed once, then dead.
export const magicLinkTokens = pgTable("magic_link_tokens", {
  token: text("token").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});


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
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("events_group_idx").on(t.groupId)],
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
  },
  (t) => [index("brackets_group_idx").on(t.groupId)],
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
    round: integer("round").notNull(),
    position: integer("position").notNull(),
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
  },
  (t) => [
    uniqueIndex("match_participants_match_user_uq").on(t.matchId, t.userId),
    index("match_participants_group_idx").on(t.groupId),
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

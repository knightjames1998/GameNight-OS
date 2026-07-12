// GameNight OS schema. Rule: every domain table carries group_id.
// Multi-tenancy from day one. No singleton assumptions.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------- Identity ----------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
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

// ---------- Crew ----------

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // Invite code baked in from day one; join-via-link is the growth loop.
  inviteCode: text("invite_code").notNull().unique(),
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

export const brackets = pgTable(
  "brackets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    eventId: uuid("event_id").notNull().references(() => events.id),
    gameId: uuid("game_id").notNull().references(() => games.id),
    format: text("format", { enum: ["single_elim", "round_robin"] })
      .notNull()
      .default("single_elim"),
    status: text("status", { enum: ["setup", "live", "completed"] })
      .notNull()
      .default("setup"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("brackets_group_idx").on(t.groupId)],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull().references(() => groups.id),
    bracketId: uuid("bracket_id").notNull().references(() => brackets.id),
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
  },
  (t) => [
    uniqueIndex("match_participants_match_user_uq").on(t.matchId, t.userId),
    index("match_participants_group_idx").on(t.groupId),
  ],
);

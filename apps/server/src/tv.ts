// The event TV resolver: one address that follows the night.
//
// Every TV view in the app is reached from inside the thing it shows, on a
// route that names a PACK rather than the night (/smash/tv/:eventId,
// /mariokart/tv/:eventId, /tv/:bracketId, /beerio/tv/:code). Putting a game on
// the big screen therefore meant knowing which pack was being played, opening
// that pack on a phone, finding its TV button and getting THAT url onto the
// TV — again, by hand, every time the crew switched games.
//
// This endpoint answers one question instead: what is being played on this
// event RIGHT NOW? The client renders that pack's own TV view inside the
// event TV route, so the screen follows the night with nobody touching it.
// Standing rule 3 is untouched: this routes to a pack's own TV design, it
// does not replace it with a generic one.
//
// AUTO-FOLLOW, no host picker: the most recently touched non-completed
// session wins. There is deliberately no stored "now showing" pointer, and so
// nothing to set, nothing to forget to clear, and nothing that can disagree
// with what is actually happening.
//
// Public and read-only, like the other TV routes: typing a password on a TV is
// misery, and the event's unguessable UUID is the access key, the same idea as
// an invite link. This router must stay mounted with the other /api/tv routers,
// BEFORE any router on the bare /api path, because those apply requireAuth at
// router level and would 401 this request before it could fall through.

import { Router } from "express";
import {
  getDb,
  beerioSessions,
  brackets,
  events,
  gameSessions,
  groups,
  rsvps,
  smashSessions,
  users,
  and,
  eq,
} from "@gamenight/db";
import { eventRecap } from "./events.js";

export const eventTvRouter = Router();

/** The four packs that run a server-side session (the client's SessionPackKey). */
export type TvPack = "smash" | "mariokart" | "marioparty" | "pingpong";

/** A session that can be shown: never "completed", which is filtered first. */
export type TvStatus = "setup" | "live";

/** What the TV should be showing, or null for the lobby. */
export type TvNow =
  | { kind: "pack"; pack: TvPack; status: TvStatus }
  | { kind: "bracket"; bracketId: string; status: TvStatus }
  | { kind: "beerio"; code: string }
  | null;

export interface PackCandidate {
  pack: TvPack;
  status: "setup" | "live" | "completed";
  updatedAt: Date | null;
}

export interface BracketCandidate {
  bracketId: string;
  status: "setup" | "live" | "completed";
  updatedAt: Date | null;
}

export interface BeerioCandidate {
  /** events.beerioCode: null when no room was ever opened on this event. */
  code: string | null;
  /** events.beerioCompletedAt: when the last tournament here finished. */
  completedAt: Date | null;
  /** beerio_sessions.updatedAt: null when the room row does not exist. */
  updatedAt: Date | null;
}

export interface TvCandidates {
  packs: PackCandidate[];
  bracket: BracketCandidate | null;
  beerio: BeerioCandidate | null;
}

/**
 * The tiebreak order, declared here rather than left to Postgres.
 *
 * Two rows CAN carry the same millisecond (a bracket created by the same tap
 * that ends a pack session, two sessions started back to back on a fast
 * connection), and without a fixed order the answer would depend on row order,
 * which is not stable. An unstable answer here is not a cosmetic problem: the
 * TV would flip between two packs on consecutive refetches, which looks like a
 * broken screen. Lower index wins a tie.
 */
const TIEBREAK: readonly string[] = [
  "bracket",
  "beerio",
  "smash",
  "mariokart",
  "marioparty",
  "pingpong",
];

const rank = (key: string) => {
  const i = TIEBREAK.indexOf(key);
  return i < 0 ? TIEBREAK.length : i;
};

/** Missing timestamps sort oldest rather than throwing off the comparison. */
const at = (d: Date | null) => (d ? d.getTime() : 0);

/**
 * Decide what the TV shows. PURE: no database, no clock, no randomness, so the
 * rule that actually matters is testable without a Postgres anywhere near it.
 *
 * Three rules, in order:
 *   1. Anything completed is out. Not "recently completed", not "completed but
 *      it is the newest thing" — out. That is what makes the TV fall back to
 *      the lobby (or to whatever else is still going) when the host ends a
 *      session, with no recency window to tune.
 *   2. Of what remains, the most recently TOUCHED wins. Touched, not started:
 *      a bracket being scored all night beats a Ping Pong session someone
 *      opened an hour ago and walked away from.
 *   3. An exact tie falls to TIEBREAK above.
 *
 * Beerio is the awkward one and is normalised into the same shape by the
 * caller: it counts as live when a room code is set on the event AND that
 * room's state has been written since the last completion stamp (or there is
 * no stamp yet). A room with no beerio_sessions row is not a room, so it never
 * wins — otherwise the TV would happily show a spinner for a room that does
 * not exist.
 */
export function resolveNow(c: TvCandidates): TvNow {
  const running: { key: string; when: number; now: NonNullable<TvNow> }[] = [];

  for (const p of c.packs) {
    if (p.status === "completed") continue;
    running.push({
      key: p.pack,
      when: at(p.updatedAt),
      now: { kind: "pack", pack: p.pack, status: p.status },
    });
  }

  if (c.bracket && c.bracket.status !== "completed") {
    running.push({
      key: "bracket",
      when: at(c.bracket.updatedAt),
      now: { kind: "bracket", bracketId: c.bracket.bracketId, status: c.bracket.status },
    });
  }

  const b = c.beerio;
  if (b?.code && b.updatedAt && (!b.completedAt || at(b.updatedAt) > at(b.completedAt))) {
    running.push({ key: "beerio", when: at(b.updatedAt), now: { kind: "beerio", code: b.code } });
  }

  let best: (typeof running)[number] | null = null;
  for (const r of running) {
    if (!best || r.when > best.when || (r.when === best.when && rank(r.key) < rank(best.key))) {
      best = r;
    }
  }
  return best ? best.now : null;
}

/** game_sessions.pack -> the TvPack the client renders. Smash has its own table. */
const PACK_OF: Record<string, TvPack> = {
  mario_kart: "mariokart",
  mario_party: "marioparty",
  ping_pong: "pingpong",
};

/**
 * What the TV should show for this night, plus enough to draw the lobby when
 * the answer is "nothing yet".
 *
 * NOT CACHED anywhere, deliberately (cache.ts already excludes the TV routes):
 * a stale scoreboard on a big screen is worse than a spinner, and that goes
 * double for the thing deciding WHICH scoreboard.
 */
eventTvRouter.get("/event/:eventId", async (req, res) => {
  const db = getDb();
  const eventId = String(req.params.eventId);

  const row = (
    await db
      .select({
        id: events.id,
        title: events.title,
        scheduledFor: events.scheduledFor,
        beerioCode: events.beerioCode,
        beerioCompletedAt: events.beerioCompletedAt,
        groupName: groups.name,
        inviteCode: groups.inviteCode,
      })
      .from(events)
      .innerJoin(groups, eq(events.groupId, groups.id))
      .where(eq(events.id, eventId))
      .limit(1)
  )[0];
  if (!row) {
    res.status(404).json({ error: "Game night not found" });
    return;
  }

  // Everything the rule needs, in one round trip's worth of parallel reads.
  const [shared, smash, bracketRows, beerioRows] = await Promise.all([
    db
      .select({ pack: gameSessions.pack, status: gameSessions.status, updatedAt: gameSessions.updatedAt })
      .from(gameSessions)
      .where(eq(gameSessions.eventId, eventId)),
    db
      .select({ status: smashSessions.status, updatedAt: smashSessions.updatedAt })
      .from(smashSessions)
      .where(eq(smashSessions.eventId, eventId))
      .limit(1),
    db
      .select({ id: brackets.id, status: brackets.status, updatedAt: brackets.updatedAt })
      .from(brackets)
      .where(eq(brackets.eventId, eventId))
      .limit(1),
    row.beerioCode
      ? db
          .select({ updatedAt: beerioSessions.updatedAt })
          .from(beerioSessions)
          .where(eq(beerioSessions.code, row.beerioCode))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const packs: PackCandidate[] = [];
  for (const s of shared) {
    const pack = PACK_OF[s.pack];
    if (pack) packs.push({ pack, status: s.status, updatedAt: s.updatedAt });
  }
  if (smash[0]) packs.push({ pack: "smash", status: smash[0].status, updatedAt: smash[0].updatedAt });

  const now = resolveNow({
    packs,
    bracket: bracketRows[0]
      ? { bracketId: bracketRows[0].id, status: bracketRows[0].status, updatedAt: bracketRows[0].updatedAt }
      : null,
    beerio: {
      code: row.beerioCode,
      completedAt: row.beerioCompletedAt,
      updatedAt: beerioRows[0]?.updatedAt ?? null,
    },
  });

  // The lobby is the most common state of the evening's first twenty minutes,
  // because the TV goes on before the games do — and it is on screen again
  // between every game after that, which is the other half of its job: once
  // anything has been played it shows the night so far rather than an empty
  // waiting screen. Both reads are skipped entirely while a game is live,
  // since nothing renders them then.
  const [yesRows, recap] = now
    ? [[], null]
    : await Promise.all([
        db
          .select({ displayName: users.displayName })
          .from(rsvps)
          .innerJoin(users, eq(rsvps.userId, users.id))
          .where(and(eq(rsvps.eventId, eventId), eq(rsvps.status, "yes")))
          .orderBy(rsvps.respondedAt),
        // The SAME rollup the recap card uses, so the big screen and the card
        // can never quote different numbers for the same night.
        eventRecap(row, row.groupName),
      ]);

  res.json({
    event: {
      id: row.id,
      title: row.title,
      scheduledFor: row.scheduledFor,
      groupName: row.groupName,
    },
    now,
    lobby: {
      yes: yesRows.map((r) => r.displayName),
      inviteCode: now ? "" : row.inviteCode,
      // Null until something has actually been played, so the client has one
      // obvious branch: nothing yet -> who's in; anything -> the night so far.
      recap: recap && recap.totalGames > 0 ? recap : null,
    },
  });
});

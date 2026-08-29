// The event TV resolver: one address that follows the night.
//
// Every TV view in the app is reached from inside the thing it shows, on a
// route that names a PACK rather than the night (/smash/tv/:eventId,
// /mariokart/tv/:eventId, /tv/:bracketId, /beerio/tv/:code). Putting a game on
// the big screen therefore meant knowing which pack was being played, opening
// that pack on a phone, finding its TV button and getting THAT url onto the
// TV, again by hand, every time the crew switched games.
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
// A NIGHT CAN HOLD MORE THAN ONE BRACKET, since 2026-08-19: once a tournament
// is completed the crew can start another, so brackets arrive here as a LIST
// and are filtered exactly the way pack sessions always were. This read used
// to be `.limit(1)` with no `orderBy`, which was safe only because the
// creation guard made a second row impossible; the guard relaxed, so the read
// had to. Postgres would otherwise have been free to hand back the COMPLETED
// bracket, which filters out, leaving the TV on the lobby while a live
// tournament was being scored and nothing erroring anywhere.
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
  games,
  groups,
  matches,
  matchParticipants,
  rsvps,
  smashSessions,
  users,
  and,
  eq,
} from "@gamenight/db";
import { PACK_BY_LEDGER, SESSION_PACK_KEYS, type SessionPackKey } from "@gamenight/shared";
import { eventRecap } from "./events.js";
// THE SHARED AGGREGATION, called rather than reimplemented. newAgg / feedAgg /
// finishAgg are exported from stats.ts precisely so a second consumer cannot
// invent its own idea of what a player's record is, and this is that second
// consumer. stats.ts itself is NOT modified by this: the crew leaderboard and
// every profile still go through the same three functions they always did.
import { newAgg, feedAgg, finishAgg } from "./stats.js";

export const eventTvRouter = Router();

/**
 * The four packs that run a server-side session. Derived from the shared
 * registry rather than restated, so this cannot fall out of step with the
 * component the client picks on the strength of it.
 */
export type TvPack = SessionPackKey;

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
  /** Every bracket on the night, completed ones included. Filtered here. */
  brackets: BracketCandidate[];
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
 *
 * The pack half comes from the registry, in registry order, so a new pack
 * cannot be missing from it: an absent key would silently rank LAST and lose
 * every tie, which is the sort of thing nobody would ever think to test.
 *
 * TWO BRACKETS SHARE THIS KEY, so the key alone stopped being a full answer
 * when a night gained the ability to run a second tournament. The last
 * comparison is on the candidate's own id, which is why `tie` exists below:
 * without it two rows carrying the same millisecond would rank equal and the
 * winner would fall out of iteration order.
 */
const TIEBREAK: readonly string[] = ["bracket", "beerio", ...SESSION_PACK_KEYS];

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
 *      it is the newest thing". It is out. That is what makes the TV fall back to
 *      the lobby (or to whatever else is still going) when the host ends a
 *      session, with no recency window to tune.
 *   2. Of what remains, the most recently TOUCHED wins. Touched, not started:
 *      a bracket being scored all night beats a Ping Pong session someone
 *      opened an hour ago and walked away from.
 *   3. An exact tie falls to TIEBREAK above, and a tie WITHIN a tiebreak key
 *      (two brackets, which is possible now) falls to the id, so the answer is
 *      total rather than merely mostly ordered.
 *
 * Beerio is the awkward one and is normalised into the same shape by the
 * caller: it counts as live when a room code is set on the event AND that
 * room's state has been written since the last completion stamp (or there is
 * no stamp yet). A room with no beerio_sessions row is not a room, so it never
 * wins, because otherwise the TV would happily show a spinner for a room that does
 * not exist.
 */
export function resolveNow(c: TvCandidates): TvNow {
  const running: { key: string; tie: string; when: number; now: NonNullable<TvNow> }[] = [];

  for (const p of c.packs) {
    if (p.status === "completed") continue;
    running.push({
      key: p.pack,
      tie: p.pack,
      when: at(p.updatedAt),
      now: { kind: "pack", pack: p.pack, status: p.status },
    });
  }

  // Every bracket on the night, filtered the same way the packs above are: a
  // completed tournament is history whatever its timestamp says, which is what
  // lets a crew finish one and start another without the screen getting stuck
  // on the finished one.
  for (const b of c.brackets) {
    if (b.status === "completed") continue;
    running.push({
      key: "bracket",
      tie: b.bracketId,
      when: at(b.updatedAt),
      now: { kind: "bracket", bracketId: b.bracketId, status: b.status },
    });
  }

  const b = c.beerio;
  if (b?.code && b.updatedAt && (!b.completedAt || at(b.updatedAt) > at(b.completedAt))) {
    running.push({
      key: "beerio",
      tie: b.code,
      when: at(b.updatedAt),
      now: { kind: "beerio", code: b.code },
    });
  }

  // Sorted here rather than in the query, deliberately: an ORDER BY would put
  // the answer in Postgres's hands for the packs half too, and this comparison
  // has to be total anyway. Newest first, then the declared key order, then the
  // candidate's own id, which is the comparison that keeps two brackets from
  // swapping places between refetches.
  let best: (typeof running)[number] | null = null;
  for (const r of running) {
    if (!best || better(r, best)) best = r;
  }
  return best ? best.now : null;
}

/** Strictly "a beats b", so an exact duplicate never displaces the incumbent. */
function better(
  a: { key: string; tie: string; when: number },
  b: { key: string; tie: string; when: number },
): boolean {
  if (a.when !== b.when) return a.when > b.when;
  if (rank(a.key) !== rank(b.key)) return rank(a.key) < rank(b.key);
  return a.tie < b.tie;
}

// game_sessions.pack -> the pack key the client renders, from the one registry
// (PACK_BY_LEDGER). This was a hand-written table here AND in events.ts AND,
// keyed the other way round, in the recap card.
//
// The hand-written one was WRONG, and this is the bug the registry exists to
// prevent: it mapped "ping_pong", a spelling that exists nowhere in the app
// (Ping Pong's ledger key is "pingpong"), so the lookup missed, the `if (pack)`
// below dropped the row, and a live Ping Pong session was invisible to the
// event TV. The screen sat on the lobby while a game was being played, and
// nothing errored, because a missing key is just undefined.

/**
 * What the TV should show for this night, plus enough to draw the lobby when
 * the answer is "nothing yet".
 *
 * NOT CACHED anywhere, deliberately (cache.ts already excludes the TV routes):
 * a stale scoreboard on a big screen is worse than a spinner, and that goes
 * double for the thing deciding WHICH scoreboard.
 */
/**
 * The crew's LIFETIME standings, for the between-games screen.
 *
 * WHY THIS IS COMPUTED HERE AND NOT READ FROM /api/groups/:id/stats, which is
 * what the backlog line assumed: THAT ENDPOINT REQUIRES AUTH AND A MEMBERSHIP.
 * `statsRouter.use(requireAuth)` gates it and the handler then checks that the
 * caller is in the crew. A television is the one screen in this app that is
 * reliably NOT signed in, which is the whole reason every /api/tv route is
 * public and why the header at the top of this file says typing a password on a
 * TV is misery. Pointing the big screen at an authed endpoint would have made
 * the feature invisible on exactly the device it is for.
 *
 * SO IT IS THE SAME DATA THROUGH THE SAME AGGREGATION, on the endpoint the
 * screen already calls, rather than a new route: newAgg / feedAgg / finishAgg
 * are what the crew leaderboard uses, so the TV and the Stats page cannot quote
 * different numbers for the same person. The query is narrower than the
 * leaderboard's because this screen renders one row per player and none of the
 * per-pack buckets.
 *
 * WHAT THIS PUTS ON A PUBLIC LINK: crew member display names with their wins,
 * games and average finish. The same link ALREADY exposes the yes-RSVP list and
 * tonight's standings with the same names and win counts, so this is the same
 * class of data over a longer window rather than a new kind of disclosure. It
 * is still a widening, and it is called out in the closeout rather than
 * slipped in.
 */
async function crewLifetime(db: ReturnType<typeof getDb>, groupId: string) {
  const rows = await db
    .select({
      matchId: matchParticipants.matchId,
      userId: matchParticipants.userId,
      displayName: users.displayName,
      placement: matchParticipants.placement,
      isWinner: matchParticipants.isWinner,
      gameName: games.name,
      character: matchParticipants.character,
      playedAt: matches.playedAt,
      eventId: matches.eventId,
      label: matches.label,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(users, eq(matchParticipants.userId, users.id))
    .leftJoin(games, eq(matches.gameId, games.id))
    .where(and(eq(matchParticipants.groupId, groupId), eq(matches.status, "completed")));

  const byUser = new Map<string, { name: string; agg: ReturnType<typeof newAgg> }>();
  for (const r of rows) {
    let e = byUser.get(r.userId);
    if (!e) {
      e = { name: r.displayName, agg: newAgg() };
      byUser.set(r.userId, e);
    }
    // feedAgg skips Smashdown series summaries itself, so a series cannot count
    // on top of the battles inside it here any more than it can anywhere else.
    feedAgg(e.agg, r);
  }

  return [...byUser.entries()]
    .map(([userId, e]) => {
      const f = finishAgg(e.agg);
      return { userId, name: e.name, games: f.played, wins: f.wins, avgPlacement: f.avgPlacement };
    })
    // A member with no completed games is not a standings row, they are a
    // person who has not played yet. The leaderboard shows them; a television
    // between games has 1080px and should spend it on people with a record.
    .filter((p) => p.games > 0)
    // The MVP rule, the same ordering eventRecap sorts tonight's players by, so
    // the two faces of this screen rank people the same way.
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        (a.avgPlacement ?? 99) - (b.avgPlacement ?? 99) ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Should this read compute the lobby block, or leave it empty?
 *
 * PULLED OUT AS A FUNCTION SO IT CAN BE TESTED, the same split resolveNow
 * exists for: the query half is verified on-device, the RULE is verified here.
 * Getting this wrong in either direction is silent. Too eager and every
 * television pays two aggregate reads on every score of every game; too shy and
 * the phone page behind every TV's QR is blank in the state it is most often
 * scanned in.
 *
 * The parameter is whatever Express parsed out of the query string, which can
 * be a string, an array of them, or undefined, so it is compared rather than
 * coerced: `?standings=1&standings=2` arrives as an array and is not a yes.
 */
export function lobbyWanted(now: TvNow, standings: unknown): boolean {
  return now === null || standings === "1";
}

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
        groupId: events.groupId,
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
    // NO LIMIT AND NO ORDER BY, both on purpose. A night can hold more than
    // one bracket now, so a limit would pick one arbitrarily; ordering here
    // would only move the decision into the database, and resolveNow sorts
    // totally anyway. Indexed on event_id.
    db
      .select({ id: brackets.id, status: brackets.status, updatedAt: brackets.updatedAt })
      .from(brackets)
      .where(eq(brackets.eventId, eventId)),
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
    const pack = PACK_BY_LEDGER[s.pack];
    if (pack) packs.push({ pack, status: s.status, updatedAt: s.updatedAt });
  }
  // Smash keeps its own table, so it is read separately and pushed by key.
  if (smash[0]) packs.push({ pack: "smash", status: smash[0].status, updatedAt: smash[0].updatedAt });

  const now = resolveNow({
    packs,
    brackets: bracketRows.map((b) => ({
      bracketId: b.id,
      status: b.status,
      updatedAt: b.updatedAt,
    })),
    beerio: {
      code: row.beerioCode,
      completedAt: row.beerioCompletedAt,
      updatedAt: beerioRows[0]?.updatedAt ?? null,
    },
  });

  // The lobby is the most common state of the evening's first twenty minutes,
  // because the TV goes on before the games do, and it is on screen again
  // between every game after that, which is the other half of its job: once
  // anything has been played it shows the night so far rather than an empty
  // waiting screen. Both reads are skipped entirely while a game is live,
  // since nothing renders them then.
  //
  // ...UNLESS SOMEBODY ASKS FOR THEM, which the phone page behind every TV's QR
  // does. That page shows the night so far to a guest standing in the room, and
  // the moment it exists the sentence above stops being true: mid-game is
  // exactly when it is scanned.
  //
  // A FLAG RATHER THAN SERVING THEM ALWAYS, and the reason is the hot path.
  // EventTvPage re-resolves this endpoint on EVERY pack websocket event, which
  // means every score in every game on every television, and two aggregate reads
  // on that path would be paid a few hundred times an evening for data the big
  // screen does not render while a game is up. The televisions send no flag and
  // pay nothing; the phones send it and pay for what they show.
  const wantsLobby = lobbyWanted(now, req.query.standings);
  const [yesRows, recap, lifetime] = !wantsLobby
    ? [[], null, []]
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
        // Beside the other two rather than after them: this is the third
        // independent read of a screen that is only ever drawn when nothing is
        // being played, and awaiting it in sequence would add a round trip to
        // the state the TV spends most of the evening in.
        crewLifetime(db, row.groupId),
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
      // Blank on the television's own read while a game is live, because the
      // big screen renders no lobby then and an unread invite code is one more
      // secret on the wire. The phone page asks for the lobby explicitly and
      // gets it: a guest scanning mid-game is the person most likely to want
      // the way in, and this code is already public to anyone holding this
      // same link in the state the TV spends most of the evening in.
      inviteCode: wantsLobby ? row.inviteCode : "",
      // Null until something has actually been played, so the client has one
      // obvious branch: nothing yet -> who's in; anything -> the night so far.
      recap: recap && recap.totalGames > 0 ? recap : null,
      // The crew's record across every night, for the column that alternates
      // with tonight's. Null rather than an empty list when a crew has no
      // completed games at all, so the client has the same one-branch test it
      // has for `recap` rather than a length check.
      lifetime: lifetime.length ? lifetime : null,
    },
  });
});

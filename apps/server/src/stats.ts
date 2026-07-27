// Lifetime stats (the Legacy module). Reads the cross-game ledger that
// completed tournaments write into: one matches row per tournament, one
// match_participants row per member with their finishing place.
//
// Sources today: generic brackets (materialized on completion) and the
// Beerio Kart pack (reports its own standings). Guests carry no stats
// until they're linked to a member (backlog).

import { Router } from "express";
import {
  getDb,
  events,
  eventAttendance,
  games,
  groups,
  matches,
  matchParticipants,
  memberships,
  rsvps,
  users,
  and,
  eq,
  inArray,
} from "@gamenight/db";
import { requireAuth, type AuthedRequest } from "./auth.js";

export const statsRouter = Router();
statsRouter.use(requireAuth);

/**
 * One player's bucket on the crew leaderboard. The tallying itself is the
 * shared Agg the profile views use, so the crew page and a profile can never
 * disagree about the same player's numbers.
 */
interface Row {
  userId: string;
  displayName: string;
  agg: Agg;
}

statsRouter.get("/groups/:id/stats", async (req: AuthedRequest, res) => {
  const db = getDb();
  const groupId = String(req.params.id);

  const mine = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, req.user!.id)))
    .limit(1);
  if (!mine[0]) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const rows = await db
    .select({
      matchId: matchParticipants.matchId,
      userId: matchParticipants.userId,
      displayName: users.displayName,
      placement: matchParticipants.placement,
      isWinner: matchParticipants.isWinner,
      gameName: games.name,
      pack: games.pack,
      format: matches.format,
      character: matchParticipants.character,
      playedAt: matches.playedAt,
      eventId: matches.eventId,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(users, eq(matchParticipants.userId, users.id))
    .leftJoin(games, eq(matches.gameId, games.id))
    .where(and(eq(matchParticipants.groupId, groupId), eq(matches.status, "completed")));

  // Per-game, per-format, per-player wins so the stats screen can split a
  // pack into its formats (Free Play / Best Of / KOTH / Grand Prix / FFA).
  // Rows with no format tag (legacy, or brackets) bucket under "Other".
  type FmtCell = { name: string; wins: number; played: number };
  type FmtBucket = { byUser: Map<string, FmtCell>; matchIds: Set<string> };
  const fmtByGame = new Map<string, Map<string, FmtBucket>>();
  for (const r of rows) {
    const game = r.gameName ?? "Unknown";
    const fmt = r.format ?? "other";
    const byFmt = fmtByGame.get(game) ?? new Map<string, FmtBucket>();
    fmtByGame.set(game, byFmt);
    const bucket = byFmt.get(fmt) ?? { byUser: new Map<string, FmtCell>(), matchIds: new Set<string>() };
    byFmt.set(fmt, bucket);
    bucket.matchIds.add(r.matchId);
    const cell = bucket.byUser.get(r.userId) ?? { name: r.displayName, wins: 0, played: 0 };
    cell.played++;
    if (r.isWinner) cell.wins++;
    bucket.byUser.set(r.userId, cell);
  }
  const FORMAT_ORDER = ["free", "ffa", "grandprix", "bestof", "koth", "board", "other"];
  const formatsFor = (game: string) => {
    const byFmt = fmtByGame.get(game);
    if (!byFmt) return [];
    return [...byFmt.entries()]
      .sort((a, b) => FORMAT_ORDER.indexOf(a[0]) - FORMAT_ORDER.indexOf(b[0]))
      .map(([format, bucket]) => ({
        format,
        // Count of results (matches/races/sets/boards) played in this format.
        played: bucket.matchIds.size,
        players: [...bucket.byUser.values()].sort((a, b) => b.wins - a.wins || b.played - a.played),
      }));
  };

  const byUser = new Map<string, Row>();
  for (const r of rows) {
    let row = byUser.get(r.userId);
    if (!row) {
      row = { userId: r.userId, displayName: r.displayName, agg: newAgg() };
      byUser.set(r.userId, row);
    }
    feedAgg(row.agg, r);
  }

  const finish = (r: Row) => ({
    userId: r.userId,
    displayName: r.displayName,
    ...finishAgg(r.agg),
  });
  // Most wins first; ties broken by win rate, then by who showed up more.
  const rank = <T extends { wins: number; winRate: number; played: number }>(list: T[]) =>
    [...list].sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.played - a.played);

  const leaderboard = rank([...byUser.values()].map(finish));

  // Same aggregation, one bucket per game: the stats screen splits by mode.
  const perGame = new Map<string, Map<string, Row>>();
  for (const r of rows) {
    const game = r.gameName ?? "Unknown";
    const bucket = perGame.get(game) ?? new Map<string, Row>();
    perGame.set(game, bucket);
    let row = bucket.get(r.userId);
    if (!row) {
      row = { userId: r.userId, displayName: r.displayName, agg: newAgg() };
      bucket.set(r.userId, row);
    }
    feedAgg(row.agg, r);
  }

  const tournamentRows = await db
    .select({ id: matches.id, gameName: games.name })
    .from(matches)
    .leftJoin(games, eq(matches.gameId, games.id))
    .where(and(eq(matches.groupId, groupId), eq(matches.status, "completed")));

  const countByGame = new Map<string, number>();
  for (const t of tournamentRows) {
    const g = t.gameName ?? "Unknown";
    countByGame.set(g, (countByGame.get(g) ?? 0) + 1);
  }

  const games_ = [...perGame.entries()]
    .map(([name, bucket]) => ({
      name,
      tournaments: countByGame.get(name) ?? 0,
      leaderboard: rank([...bucket.values()].map(finish)),
      formats: formatsFor(name),
    }))
    .sort((a, b) => b.tournaments - a.tournaments || a.name.localeCompare(b.name));

  res.json({ tournaments: tournamentRows.length, leaderboard, games: games_ });
});

// ---------- Profiles + rivalry (reads only, no schema change) ----------
//
// Head-to-head definition: any completed match where BOTH players have a
// participant row. Better (lower) placement wins the encounter; equal
// placement is a tie. This spans every pack because they all materialize
// into the same ledger. Results are ordered by matches.playedAt, which is
// the completion time (every pack writes its row once, when the game is
// done), so streaks and recent form are real rather than guessed.

/**
 * Games on one character before it can be crowned "best". Without a floor a
 * single lucky win is a 100% character and outranks a real main.
 */
const MIN_CHAR_GAMES = 3;

/** How many recent results the form pips show, most recent first. */
const FORM_LENGTH = 5;

/**
 * One ledger result, exactly as the profile queries select it. Passed as an
 * object rather than positionally: there are five like-typed fields and a
 * swapped pair would be silent.
 */
interface ResultRow {
  placement: number | null;
  isWinner: boolean;
  gameName: string | null;
  character: string | null;
  playedAt: Date | null;
  eventId: string | null;
}

interface Agg {
  played: number;
  wins: number;
  placementSum: number;
  placed: number;
  best: number | null;
  byGame: Record<string, { played: number; wins: number }>;
  // Keyed by character NAME, so one character is one line even when it was
  // played across different titles (standing rule: stats unify by name).
  // Packs with no characters (Beerio, Ping Pong, brackets) store null here
  // and never reach this map.
  byCharacter: Record<string, { played: number; wins: number }>;
  // Every result with its time, unordered as it arrives; finishForm sorts.
  // Streaks and recent form have no other way to order results, which is
  // why matches.playedAt exists.
  timeline: { playedAt: Date | null; isWinner: boolean; placement: number | null }[];
  // Distinct nights this user actually played a game on.
  eventIds: Set<string>;
}

function newAgg(): Agg {
  return {
    played: 0,
    wins: 0,
    placementSum: 0,
    placed: 0,
    best: null,
    byGame: {},
    byCharacter: {},
    timeline: [],
    eventIds: new Set(),
  };
}

function feedAgg(a: Agg, r: ResultRow) {
  const place = r.placement ?? 0;
  a.played++;
  if (r.isWinner) a.wins++;
  if (place >= 1) {
    a.placementSum += place;
    a.placed++;
    a.best = a.best === null ? place : Math.min(a.best, place);
  }
  const key = r.gameName ?? "Unknown";
  const g = (a.byGame[key] ??= { played: 0, wins: 0 });
  g.played++;
  if (r.isWinner) g.wins++;

  const char = r.character?.trim();
  if (char) {
    const c = (a.byCharacter[char] ??= { played: 0, wins: 0 });
    c.played++;
    if (r.isWinner) c.wins++;
  }

  a.timeline.push({ playedAt: r.playedAt, isWinner: r.isWinner, placement: r.placement });
  if (r.eventId) a.eventIds.add(r.eventId);
}

/**
 * Streaks and recent form, ordered by when each result was played. Results
 * with no timestamp cannot be placed in the order and are left out entirely
 * rather than guessed at.
 */
function finishForm(timeline: Agg["timeline"]) {
  const dated = timeline
    .filter((t): t is (typeof t) & { playedAt: Date } => t.playedAt != null)
    .sort((x, y) => x.playedAt.getTime() - y.playedAt.getTime());

  // Walking oldest to newest, `run` is the streak ending at the current
  // result, so when the loop finishes it IS the current streak.
  let run = 0;
  let longest = 0;
  for (const t of dated) {
    run = t.isWinner ? run + 1 : 0;
    if (run > longest) longest = run;
  }

  return {
    currentStreak: run,
    longestStreak: longest,
    last5: dated
      .slice(-FORM_LENGTH)
      .reverse()
      .map((t) => ({ isWinner: t.isWinner, placement: t.placement })),
    // How many results could be ordered at all, so the client can tell
    // "no wins yet" apart from "nothing timestamped yet".
    tracked: dated.length,
  };
}

/**
 * Roll the character tallies up into the shape the profile views render:
 * the full list (most played first), the main, and the best by win rate
 * among characters that clear MIN_CHAR_GAMES.
 */
function finishCharacters(byCharacter: Agg["byCharacter"]) {
  const list = Object.entries(byCharacter)
    .map(([name, v]) => ({ name, ...v, winRate: v.played ? v.wins / v.played : 0 }))
    .sort((x, y) => y.played - x.played || y.wins - x.wins || x.name.localeCompare(y.name));

  const mostPlayed = list[0]?.name ?? null;
  // Ties on win rate go to the character with more games behind it, then
  // alphabetically, so the pick is stable across requests.
  const eligible = list
    .filter((c) => c.played >= MIN_CHAR_GAMES)
    .sort((x, y) => y.winRate - x.winRate || y.played - x.played || x.name.localeCompare(y.name));

  return {
    byCharacter: list,
    mostPlayed,
    best: eligible[0]?.name ?? null,
    minGamesForBest: MIN_CHAR_GAMES,
  };
}

function finishAgg(a: Agg) {
  return {
    played: a.played,
    wins: a.wins,
    best: a.best,
    winRate: a.played ? a.wins / a.played : 0,
    avgPlacement: a.placed ? a.placementSum / a.placed : null,
    byGame: Object.entries(a.byGame)
      .map(([name, v]) => ({ name, ...v }))
      .sort((x, y) => y.played - x.played),
    // Nested rather than spread flat: this object has its own `best` (best
    // character) and the response already has one (best placement).
    characters: finishCharacters(a.byCharacter),
    form: finishForm(a.timeline),
    // Distinct nights with at least one recorded game. Counted off the
    // ledger, not off attendance check-ins: this claims "nights played",
    // and playing a game is proof, whereas a night nobody confirmed
    // showing up to would read as zero.
    nightsPlayed: a.eventIds.size,
  };
}

type Db = ReturnType<typeof getDb>;

/** One user's ledger stats across a set of crews. */
async function aggFor(db: Db, groupIds: string[], userId: string) {
  const a = newAgg();
  if (groupIds.length) {
    const rows = await db
      .select({
        placement: matchParticipants.placement,
        isWinner: matchParticipants.isWinner,
        gameName: games.name,
        character: matchParticipants.character,
        playedAt: matches.playedAt,
        eventId: matches.eventId,
      })
      .from(matchParticipants)
      .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
      .leftJoin(games, eq(matches.gameId, games.id))
      .where(
        and(
          inArray(matchParticipants.groupId, groupIds),
          eq(matchParticipants.userId, userId),
          eq(matches.status, "completed"),
        ),
      );
    for (const r of rows) feedAgg(a, r);
  }
  return finishAgg(a);
}

// ---------- Attendance / flake tracking ----------
// An RSVP is intent; event_attendance is what actually happened. A flake is
// "said yes and never confirmed showing up" — real flakes don't open the
// app to tap no, so silence after a yes counts once the night is clearly
// over (24h past its date). An honest "didn't show" answer counts right
// away. Streaks count consecutive confirmed shows, ordered by event date.

/** How long after an event's start an unanswered "yes" becomes a flake. */
const FLAKE_GRACE_MS = 24 * 60 * 60 * 1000;

async function attendanceFor(db: Db, groupIds: string[], userId: string) {
  const empty = {
    tracked: 0,
    showed: 0,
    flaked: 0,
    showRate: null as number | null,
    currentStreak: 0,
    bestStreak: 0,
  };
  if (!groupIds.length) return empty;

  const answers = await db
    .select({
      eventId: eventAttendance.eventId,
      showed: eventAttendance.showed,
      scheduledFor: events.scheduledFor,
      createdAt: events.createdAt,
    })
    .from(eventAttendance)
    .innerJoin(events, eq(eventAttendance.eventId, events.id))
    .where(and(inArray(eventAttendance.groupId, groupIds), eq(eventAttendance.userId, userId)));

  const yesRows = await db
    .select({ eventId: rsvps.eventId, scheduledFor: events.scheduledFor })
    .from(rsvps)
    .innerJoin(events, eq(rsvps.eventId, events.id))
    .where(
      and(inArray(rsvps.groupId, groupIds), eq(rsvps.userId, userId), eq(rsvps.status, "yes")),
    );

  // One entry per event that can count: every answered check-in, plus every
  // past dated event they said yes to and then went silent on. A "yes" on a
  // dateless event never counts — you can't flake on a TBD.
  const byEvent = new Map<string, { when: Date; showed: boolean | null; saidYes: boolean }>();
  for (const a of answers) {
    byEvent.set(a.eventId, { when: a.scheduledFor ?? a.createdAt, showed: a.showed, saidYes: false });
  }
  for (const y of yesRows) {
    const e = byEvent.get(y.eventId);
    if (e) {
      e.saidYes = true;
    } else if (y.scheduledFor && y.scheduledFor.getTime() < Date.now() - FLAKE_GRACE_MS) {
      byEvent.set(y.eventId, { when: y.scheduledFor, showed: null, saidYes: true });
    }
  }
  if (!byEvent.size) return empty;

  const list = [...byEvent.values()].sort((a, b) => a.when.getTime() - b.when.getTime());
  let showed = 0;
  let flaked = 0;
  let current = 0;
  let best = 0;
  for (const e of list) {
    if (e.showed === true) {
      showed++;
      current++;
      best = Math.max(best, current);
    } else {
      current = 0;
      if (e.saidYes) flaked++;
    }
  }
  return {
    tracked: list.length,
    showed,
    flaked,
    showRate: showed / list.length,
    currentStreak: current,
    bestStreak: best,
  };
}

/** Non-personal crews both users belong to. Empty = you've never crewed together. */
async function sharedGroupIds(db: Db, aId: string, bId: string): Promise<string[]> {
  const mine = await db
    .select({ groupId: memberships.groupId })
    .from(memberships)
    .innerJoin(groups, eq(memberships.groupId, groups.id))
    .where(and(eq(memberships.userId, aId), eq(groups.isPersonal, false)));
  if (!mine.length) return [];
  const theirs = await db
    .select({ groupId: memberships.groupId })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, bId),
        inArray(
          memberships.groupId,
          mine.map((m) => m.groupId),
        ),
      ),
    );
  return theirs.map((t) => t.groupId);
}

/** Me vs them across a set of crews: both sides' stats + the h2h ledger. */
async function buildRivalry(db: Db, groupIds: string[], meId: string, themId: string) {
  const mineAgg = newAgg();
  const theirsAgg = newAgg();
  const byMatch = new Map<
    string,
    { mine?: { p: number | null; w: boolean }; theirs?: { p: number | null; w: boolean }; game: string }
  >();

  if (groupIds.length) {
    // Every completed participant row for either of us, in one query;
    // pair them up by matchId in memory.
    const rows = await db
      .select({
        matchId: matchParticipants.matchId,
        userId: matchParticipants.userId,
        placement: matchParticipants.placement,
        isWinner: matchParticipants.isWinner,
        gameName: games.name,
        character: matchParticipants.character,
        playedAt: matches.playedAt,
        eventId: matches.eventId,
      })
      .from(matchParticipants)
      .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
      .leftJoin(games, eq(matches.gameId, games.id))
      .where(
        and(
          inArray(matchParticipants.groupId, groupIds),
          inArray(matchParticipants.userId, [meId, themId]),
          eq(matches.status, "completed"),
        ),
      );
    for (const r of rows) {
      const side = r.userId === meId ? mineAgg : theirsAgg;
      feedAgg(side, r);
      const m = byMatch.get(r.matchId) ?? { game: r.gameName ?? "Unknown" };
      if (r.userId === meId) m.mine = { p: r.placement, w: r.isWinner };
      else m.theirs = { p: r.placement, w: r.isWinner };
      byMatch.set(r.matchId, m);
    }
  }

  let wins = 0;
  let losses = 0;
  let ties = 0;
  const h2hByGame = new Map<string, { meetings: number; myWins: number; theirWins: number }>();
  for (const m of byMatch.values()) {
    if (!m.mine || !m.theirs) continue;
    const g = h2hByGame.get(m.game) ?? { meetings: 0, myWins: 0, theirWins: 0 };
    g.meetings++;
    // Placement decides; isWinner breaks a null-placement pair (rare).
    const mp = m.mine.p ?? Infinity;
    const tp = m.theirs.p ?? Infinity;
    if (mp < tp || (mp === tp && m.mine.w && !m.theirs.w)) {
      wins++;
      g.myWins++;
    } else if (tp < mp || (mp === tp && m.theirs.w && !m.mine.w)) {
      losses++;
      g.theirWins++;
    } else {
      ties++;
    }
    h2hByGame.set(m.game, g);
  }

  return {
    meStats: finishAgg(mineAgg),
    themStats: finishAgg(theirsAgg),
    h2h: {
      meetings: wins + losses + ties,
      wins,
      losses,
      ties,
      byGame: [...h2hByGame.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((x, y) => y.meetings - x.meetings),
    },
  };
}

/** Everything I've played, across every crew I'm in. Feeds the Home card. */
statsRouter.get("/me/stats", async (req: AuthedRequest, res) => {
  const db = getDb();
  const rows = await db
    .select({
      groupId: matches.groupId,
      groupName: groups.name,
      placement: matchParticipants.placement,
      isWinner: matchParticipants.isWinner,
      gameName: games.name,
      format: matches.format,
      character: matchParticipants.character,
      playedAt: matches.playedAt,
      eventId: matches.eventId,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(groups, eq(matches.groupId, groups.id))
    .leftJoin(games, eq(matches.gameId, games.id))
    .where(and(eq(matchParticipants.userId, req.user!.id), eq(matches.status, "completed")));

  const total = newAgg();
  const byFormat = new Map<string, { format: string; played: number; wins: number }>();
  const byCrew = new Map<string, { groupId: string; name: string; played: number; wins: number; personal: boolean }>();
  for (const r of rows) {
    feedAgg(total, r);
    if (r.format) {
      const f = byFormat.get(r.format) ?? { format: r.format, played: 0, wins: 0 };
      f.played++;
      if (r.isWinner) f.wins++;
      byFormat.set(r.format, f);
    }
    let c = byCrew.get(r.groupId);
    if (!c) {
      // Quick-play's hidden personal crew still counts toward totals but is
      // labeled so the Home card doesn't render an internal name.
      c = { groupId: r.groupId, name: r.groupName, played: 0, wins: 0, personal: false };
      byCrew.set(r.groupId, c);
    }
    c.played++;
    if (r.isWinner) c.wins++;
  }
  // Mark personal crews so the client can label them "Quick play".
  const personal = await db
    .select({ id: groups.id })
    .from(groups)
    .innerJoin(memberships, eq(memberships.groupId, groups.id))
    .where(and(eq(memberships.userId, req.user!.id), eq(groups.isPersonal, true)));
  for (const p of personal) {
    const c = byCrew.get(p.id);
    if (c) c.personal = true;
  }

  res.json({
    ...finishAgg(total),
    byFormat: [...byFormat.values()].sort((x, y) => y.wins - x.wins || y.played - x.played),
    byCrew: [...byCrew.values()].sort((x, y) => y.played - x.played),
  });
});

/** One member's lifetime stats within one crew (the profile page). */
statsRouter.get("/groups/:id/members/:userId/stats", async (req: AuthedRequest, res) => {
  const db = getDb();
  const groupId = String(req.params.id);
  const targetId = String(req.params.userId);

  const mine = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, req.user!.id)))
    .limit(1);
  if (!mine[0]) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const target = await db
    .select({ displayName: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, targetId)))
    .limit(1);
  if (!target[0]) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  res.json({
    userId: targetId,
    displayName: target[0].displayName,
    ...(await aggFor(db, [groupId], targetId)),
    attendance: await attendanceFor(db, [groupId], targetId),
  });
});

/** Me vs one crew member: both sides' stats plus the head-to-head ledger. */
statsRouter.get("/groups/:id/rivalry/:userId", async (req: AuthedRequest, res) => {
  const db = getDb();
  const groupId = String(req.params.id);
  const meId = req.user!.id;
  const themId = String(req.params.userId);
  if (themId === meId) {
    res.status(400).json({ error: "That's you" });
    return;
  }

  const names = await db
    .select({ userId: memberships.userId, displayName: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.groupId, groupId));
  const meName = names.find((n) => n.userId === meId)?.displayName;
  const themName = names.find((n) => n.userId === themId)?.displayName;
  if (!meName || !themName) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const r = await buildRivalry(db, [groupId], meId, themId);
  res.json({
    me: { userId: meId, displayName: meName, ...r.meStats },
    them: { userId: themId, displayName: themName, ...r.themStats },
    h2h: r.h2h,
  });
});

// ---------- Friends (cross-crew) ----------
// A friend is anyone you share (or have shared) a real crew with. No adding,
// no requests: crewing together IS the connection. Personal quick-play crews
// never count, they only ever contain you.

/** Everyone I've crewed with, deduped across crews. Feeds the Home section. */
statsRouter.get("/friends", async (req: AuthedRequest, res) => {
  const db = getDb();
  const mine = await db
    .select({ groupId: memberships.groupId, name: groups.name })
    .from(memberships)
    .innerJoin(groups, eq(memberships.groupId, groups.id))
    .where(and(eq(memberships.userId, req.user!.id), eq(groups.isPersonal, false)));
  if (!mine.length) {
    res.json([]);
    return;
  }

  const rows = await db
    .select({
      userId: memberships.userId,
      displayName: users.displayName,
      groupId: memberships.groupId,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      inArray(
        memberships.groupId,
        mine.map((m) => m.groupId),
      ),
    );

  const crewName = new Map(mine.map((m) => [m.groupId, m.name]));
  const byUser = new Map<string, { userId: string; displayName: string; crews: string[] }>();
  for (const r of rows) {
    if (r.userId === req.user!.id) continue;
    const f = byUser.get(r.userId) ?? { userId: r.userId, displayName: r.displayName, crews: [] };
    f.crews.push(crewName.get(r.groupId) ?? "?");
    byUser.set(r.userId, f);
  }
  res.json(
    [...byUser.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
});

/** A friend's stats aggregated across every crew we share. */
statsRouter.get("/friends/:userId/stats", async (req: AuthedRequest, res) => {
  const db = getDb();
  const targetId = String(req.params.userId);
  const shared = await sharedGroupIds(db, req.user!.id, targetId);
  if (!shared.length) {
    res.status(404).json({ error: "You haven't crewed with this person" });
    return;
  }

  const target = (
    await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, targetId)).limit(1)
  )[0];
  if (!target) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const crews = await db
    .select({ name: groups.name })
    .from(groups)
    .where(inArray(groups.id, shared));

  res.json({
    userId: targetId,
    displayName: target.displayName,
    crews: crews.map((c) => c.name).sort(),
    ...(await aggFor(db, shared, targetId)),
    attendance: await attendanceFor(db, shared, targetId),
  });
});

/** Me vs a friend, aggregated across every crew we share. */
statsRouter.get("/friends/:userId/rivalry", async (req: AuthedRequest, res) => {
  const db = getDb();
  const meId = req.user!.id;
  const themId = String(req.params.userId);
  if (themId === meId) {
    res.status(400).json({ error: "That's you" });
    return;
  }
  const shared = await sharedGroupIds(db, meId, themId);
  if (!shared.length) {
    res.status(404).json({ error: "You haven't crewed with this person" });
    return;
  }

  const names = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, [meId, themId]));
  const meName = names.find((n) => n.id === meId)?.displayName;
  const themName = names.find((n) => n.id === themId)?.displayName;
  if (!meName || !themName) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const r = await buildRivalry(db, shared, meId, themId);
  res.json({
    me: { userId: meId, displayName: meName, ...r.meStats },
    them: { userId: themId, displayName: themName, ...r.themStats },
    h2h: r.h2h,
  });
});

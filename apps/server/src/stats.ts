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
  sql,
} from "@gamenight/db";
import { isSeriesSummary, formatOrderIndex } from "@gamenight/shared";
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
      label: matches.label,
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
    // A series summary carries format "smashdown" like the battles it
    // summarizes, so without this the Smashdown bucket would count each
    // series as an extra unit played and credit its winner twice.
    if (isSeriesSummary(r.label)) continue;
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
  // The order comes from the shared ledger-format registry, which is also where
  // the client reads its labels. This used to be a local array of seven keys,
  // six short of what the packs actually write, and `indexOf` returning -1 for
  // the six sorted every one of them ABOVE "free" rather than below "other".
  const formatsFor = (game: string) => {
    const byFmt = fmtByGame.get(game);
    if (!byFmt) return [];
    return [...byFmt.entries()]
      .sort((a, b) => formatOrderIndex(a[0]) - formatOrderIndex(b[0]))
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

  // Every completed match in the crew, which is what the headline count and
  // the per-game ordering are built from. Series summaries are dropped here
  // too: they are not a thing that was played, they are a description of
  // things that were.
  const tournamentRows = (
    await db
      .select({ id: matches.id, gameName: games.name, label: matches.label })
      .from(matches)
      .leftJoin(games, eq(matches.gameId, games.id))
      .where(and(eq(matches.groupId, groupId), eq(matches.status, "completed")))
  ).filter((t) => !isSeriesSummary(t.label));

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
 * Games in one game/pack before it can be called someone's best or worst.
 * Same reasoning as MIN_CHAR_GAMES: one game played once at 100% or 0% is
 * not a verdict. Separate constant because a game is a bigger unit than a
 * character and the two floors should be free to move apart.
 */
const MIN_GAME_GAMES = 3;

/** How many months of history the games-per-month series covers. */
const HISTORY_MONTHS = 12;

/**
 * One ledger result, exactly as the profile queries select it. Passed as an
 * object rather than positionally: there are five like-typed fields and a
 * swapped pair would be silent.
 */
export interface ResultRow {
  matchId: string;
  placement: number | null;
  isWinner: boolean;
  gameName: string | null;
  character: string | null;
  playedAt: Date | null;
  eventId: string | null;
  /**
   * matches.label. Carried for ONE reason: a Smashdown series row summarizes
   * battles that are already in this same result set, so it must not be
   * counted as a game (see isSeriesSummary in the shared module). Every other
   * label is descriptive only (a board name, a cup, bo{N}) and is ignored
   * here, because those rows genuinely ARE the unit their games produced.
   */
  label: string | null;
}

// newAgg / feedAgg / finishAgg are EXPORTED for the tests, not for other
// modules to build their own aggregation with: the whole point of this file is
// that there is one, and the crew leaderboard was unified onto it precisely so
// two screens could not disagree about a player. They are exported because the
// series-summary exclusion is a rule that fails silently (every player quietly
// gains a game per series) and it cannot be asserted through a route without a
// database.
/** Per-character tallies. Placement fields ignore results with no placement. */
interface CharTally {
  played: number;
  wins: number;
  placementSum: number;
  placed: number;
  best: number | null;
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
  byCharacter: Record<string, CharTally>;
  // Every result with its time, unordered as it arrives; finishForm sorts.
  // Streaks and recent form have no other way to order results, which is
  // why matches.playedAt exists. matchId rides along so last-place finishes
  // can be worked out later against each match's field size.
  timeline: {
    matchId: string;
    playedAt: Date | null;
    isWinner: boolean;
    placement: number | null;
  }[];
  // Distinct nights this user actually played a game on.
  eventIds: Set<string>;
  // Per night, for the best-night pick. Same key as eventIds.
  byEvent: Map<string, { played: number; wins: number }>;
  // Finishes at 1st / 2nd / 3rd / 4th or worse. Results with NO placement
  // are counted in none of them, so the four never silently absorb a pack
  // that does not rank (they would otherwise all look like last place).
  firsts: number;
  seconds: number;
  thirds: number;
  fourthPlus: number;
  // Series (Smashdown) won and played. Fed ONLY by the summary rows, which
  // every other counter above skips, so the two can never double-count the
  // same night: a five-battle series is five games and one series.
  seriesWins: number;
  seriesPlayed: number;
}

export function newAgg(): Agg {
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
    byEvent: new Map(),
    firsts: 0,
    seconds: 0,
    thirds: 0,
    fourthPlus: 0,
    seriesWins: 0,
    seriesPlayed: 0,
  };
}

/**
 * Fold one ledger row into an aggregate.
 *
 * THE EXCLUSION LIVES HERE, at the top, rather than in each of the five
 * callers. A Smashdown series row is a summary of battles that are already in
 * the ledger, so counting it as a game would give every player a phantom game
 * per series and the winner a phantom win. Putting the test in the one place
 * every caller already goes through means a sixth caller inherits it instead
 * of being the one that forgets. The callers that tally OUTSIDE this function
 * (the crew leaderboard's format buckets, /me/stats' per-format and per-crew
 * rollups, the recap) each call isSeriesSummary themselves, and that is the
 * whole list.
 */
export function feedAgg(a: Agg, r: ResultRow) {
  if (isSeriesSummary(r.label)) {
    a.seriesPlayed++;
    if (r.isWinner) a.seriesWins++;
    return;
  }
  const place = r.placement ?? 0;
  a.played++;
  if (r.isWinner) a.wins++;
  if (place >= 1) {
    a.placementSum += place;
    a.placed++;
    a.best = a.best === null ? place : Math.min(a.best, place);
    if (place === 1) a.firsts++;
    else if (place === 2) a.seconds++;
    else if (place === 3) a.thirds++;
    else a.fourthPlus++;
  }
  const key = r.gameName ?? "Unknown";
  const g = (a.byGame[key] ??= { played: 0, wins: 0 });
  g.played++;
  if (r.isWinner) g.wins++;

  const char = r.character?.trim();
  if (char) {
    const c = (a.byCharacter[char] ??= { played: 0, wins: 0, placementSum: 0, placed: 0, best: null });
    c.played++;
    if (r.isWinner) c.wins++;
    if (place >= 1) {
      c.placementSum += place;
      c.placed++;
      c.best = c.best === null ? place : Math.min(c.best, place);
    }
  }

  a.timeline.push({
    matchId: r.matchId,
    playedAt: r.playedAt,
    isWinner: r.isWinner,
    placement: r.placement,
  });
  if (r.eventId) {
    a.eventIds.add(r.eventId);
    const e = a.byEvent.get(r.eventId) ?? { played: 0, wins: 0 };
    e.played++;
    if (r.isWinner) e.wins++;
    a.byEvent.set(r.eventId, e);
  }
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
  // result, so when the loop finishes it IS the current streak. The loss
  // walk is the same thing inverted: in a field of four only one player
  // wins, so "loss" here means "did not win", the same sense the win
  // streak already uses.
  let run = 0;
  let longest = 0;
  let lossRun = 0;
  let longestLoss = 0;
  for (const t of dated) {
    run = t.isWinner ? run + 1 : 0;
    if (run > longest) longest = run;
    lossRun = t.isWinner ? 0 : lossRun + 1;
    if (lossRun > longestLoss) longestLoss = lossRun;
  }

  return {
    currentStreak: run,
    longestStreak: longest,
    currentLossStreak: lossRun,
    longestLossStreak: longestLoss,
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
    .map(([name, v]) => ({
      name,
      played: v.played,
      wins: v.wins,
      winRate: v.played ? v.wins / v.played : 0,
      bestPlacement: v.best,
      avgPlacement: v.placed ? v.placementSum / v.placed : null,
    }))
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
    distinctCharacters: list.length,
  };
}

/** Share of finishes at each depth. Null shares when nothing was ranked. */
function finishPlacements(a: Agg) {
  const ranked = a.placed;
  const share = (n: number) => (ranked ? n / ranked : null);
  return {
    ranked,
    first: a.firsts,
    second: a.seconds,
    third: a.thirds,
    fourthPlus: a.fourthPlus,
    firstShare: share(a.firsts),
    secondShare: share(a.seconds),
    thirdShare: share(a.thirds),
    fourthPlusShare: share(a.fourthPlus),
    // Results the packs never ranked, so the four counts above do not add
    // up to games played and the client can say why.
    unranked: a.played - ranked,
  };
}

/** Best and worst game by win rate, once a game has enough games behind it. */
function finishGameExtremes(a: Agg) {
  const eligible = Object.entries(a.byGame)
    .map(([name, v]) => ({ name, ...v, winRate: v.played ? v.wins / v.played : 0 }))
    .filter((g) => g.played >= MIN_GAME_GAMES)
    .sort((x, y) => y.winRate - x.winRate || y.played - x.played || x.name.localeCompare(y.name));

  return {
    bestGame: eligible[0] ?? null,
    // Not simply the array tail: with one eligible game best and worst
    // would be the same entry, which says nothing.
    worstGame: eligible.length > 1 ? eligible[eligible.length - 1]! : null,
    minGamesForExtremes: MIN_GAME_GAMES,
  };
}

/** Month key in the user's own terms, e.g. 2026-07. */
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * When they started, and the last HISTORY_MONTHS of activity as a series a
 * sparkline can draw. Empty months are included on purpose: a gap is part
 * of the shape, and dropping it would draw a lie.
 */
function finishHistory(a: Agg) {
  const dated = a.timeline
    .filter((t): t is (typeof t) & { playedAt: Date } => t.playedAt != null)
    .sort((x, y) => x.playedAt.getTime() - y.playedAt.getTime());

  const counts = new Map<string, { played: number; wins: number }>();
  for (const t of dated) {
    const k = monthKey(t.playedAt);
    const c = counts.get(k) ?? { played: 0, wins: 0 };
    c.played++;
    if (t.isWinner) c.wins++;
    counts.set(k, c);
  }

  const now = new Date();
  const gamesPerMonth: { month: string; played: number; wins: number }[] = [];
  for (let i = HISTORY_MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = monthKey(d);
    gamesPerMonth.push({ month: k, ...(counts.get(k) ?? { played: 0, wins: 0 }) });
  }

  const nights = a.eventIds.size;
  return {
    playingSince: dated[0]?.playedAt ?? null,
    gamesPerMonth,
    gamesPerNight: nights ? a.played / nights : null,
  };
}

export function finishAgg(a: Agg) {
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
    // Nested so a client can render it only when there is one: a crew that has
    // never played Smashdown gets zeroes it can hide, not a new empty tile.
    series: { wins: a.seriesWins, played: a.seriesPlayed },
    // Distinct nights with at least one recorded game. Counted off the
    // ledger, not off attendance check-ins: this claims "nights played",
    // and playing a game is proof, whereas a night nobody confirmed
    // showing up to would read as zero.
    nightsPlayed: a.eventIds.size,
  };
}

type Db = ReturnType<typeof getDb>;

/**
 * Finishes where this player came LAST. Field size is not stored anywhere,
 * so it is derived: one grouped count of participant rows per match, then
 * compare each placement against its match's size. Deliberately one query
 * for the whole history rather than one per match. A field of one cannot
 * have a last place, so those are skipped (the winner would qualify).
 */
async function countLastPlace(db: Db, a: Agg) {
  const ranked = a.timeline.filter((t) => t.placement != null);
  const matchIds = [...new Set(ranked.map((t) => t.matchId))];
  if (!matchIds.length) return 0;

  const sizes = await db
    .select({ matchId: matchParticipants.matchId, size: sql<number>`count(*)::int` })
    .from(matchParticipants)
    .where(inArray(matchParticipants.matchId, matchIds))
    .groupBy(matchParticipants.matchId);

  const sizeById = new Map(sizes.map((s) => [s.matchId, Number(s.size)]));
  let last = 0;
  for (const t of ranked) {
    const size = sizeById.get(t.matchId) ?? 0;
    if (size > 1 && t.placement === size) last++;
  }
  return last;
}

/**
 * The night with the most wins. Ties go to the night that took fewer games
 * to get there, then to the event id so the pick is stable. One query, for
 * the single winning event's label.
 */
async function resolveBestNight(db: Db, a: Agg) {
  let bestId: string | null = null;
  let bestVal = { played: 0, wins: 0 };
  for (const [eventId, v] of a.byEvent) {
    if (
      bestId === null ||
      v.wins > bestVal.wins ||
      (v.wins === bestVal.wins && v.played < bestVal.played) ||
      (v.wins === bestVal.wins && v.played === bestVal.played && eventId < bestId)
    ) {
      bestId = eventId;
      bestVal = v;
    }
  }
  if (!bestId || bestVal.wins === 0) return null;

  const row = await db
    .select({ id: events.id, title: events.title, scheduledFor: events.scheduledFor })
    .from(events)
    .where(eq(events.id, bestId))
    .limit(1);
  if (!row[0]) return null;

  return {
    eventId: row[0].id,
    // Dateless nights fall back to their name, which is all they have.
    title: row[0].title,
    date: row[0].scheduledFor,
    wins: bestVal.wins,
    played: bestVal.played,
  };
}

/**
 * The profile-only depth: everything finishAgg returns, plus the groups that
 * are either expensive or only meaningful for one person. Kept OUT of
 * finishAgg because the crew leaderboard calls that once per player, and
 * lastPlaceCount / bestNight each cost a query.
 */
async function finishAggDeep(db: Db, a: Agg) {
  const [lastPlaceCount, bestNight] = await Promise.all([countLastPlace(db, a), resolveBestNight(db, a)]);
  return {
    ...finishAgg(a),
    placements: finishPlacements(a),
    ...finishGameExtremes(a),
    history: { ...finishHistory(a), bestNight },
    lastPlaceCount,
  };
}

/** The columns every profile-side aggregation needs, in one place. */
const resultCols = {
  matchId: matchParticipants.matchId,
  placement: matchParticipants.placement,
  isWinner: matchParticipants.isWinner,
  gameName: games.name,
  character: matchParticipants.character,
  playedAt: matches.playedAt,
  eventId: matches.eventId,
  // Only so feedAgg can skip series summary rows; see ResultRow.label.
  label: matches.label,
};

/** One user's ledger stats across a set of crews. */
async function aggFor(db: Db, groupIds: string[], userId: string) {
  const a = newAgg();
  if (groupIds.length) {
    const rows = await db
      .select(resultCols)
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
  return finishAggDeep(db, a);
}

// ---------- Attendance / flake tracking ----------
// An RSVP is intent; event_attendance is what actually happened. A flake is
// "said yes and never confirmed showing up". Real flakes don't open the
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
  // dateless event never counts: you can't flake on a TBD.
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

// ---------- the rivalry rules, pure ----------
//
// Extracted for the same reason resolveNow is: a wrong answer here is not an
// error anywhere, it is a head-to-head record that is quietly wrong forever.
// Pure once the two rows are in hand, so it is tested with no database near it.

/** One player's row in a shared match, reduced to what the outcome depends on. */
export interface MeetingSide {
  /** Finishing position. Null means the pack does not rank, and loses to any number. */
  p: number | null;
  /** isWinner, which breaks a null-placement pair. */
  w: boolean;
  /** match_participants.side. Null means the match had no team structure. */
  side: string | null;
}

export type MeetingOutcome = "win" | "loss" | "tie" | "together";

/**
 * How one shared match reads BETWEEN these two people, from `mine`'s side.
 *
 * TEAMMATES ARE CHECKED FIRST, ahead of every placement comparison, and that
 * order is the whole fix. A co-op pack writes IDENTICAL rows for everyone on
 * the run: same placement, same isWinner. Reaching the comparison at all
 * scores that a tie, which is how every Casino Run in the ledger read before
 * `side` existed. Two people who cleared a run together did not draw with each
 * other; they were not playing each other at all.
 *
 * Two matching NON-NULL sides is the only signal. A null side (every row
 * written before the column existed, and every free-for-all result forever)
 * falls straight through to the three-way classification that has always run,
 * so nothing about a normal match changes.
 */
export function meetingOutcome(mine: MeetingSide, theirs: MeetingSide): MeetingOutcome {
  if (mine.side !== null && mine.side === theirs.side) return "together";
  const mp = mine.p ?? Infinity;
  const tp = theirs.p ?? Infinity;
  if (mp < tp || (mp === tp && mine.w && !theirs.w)) return "win";
  if (tp < mp || (mp === tp && theirs.w && !mine.w)) return "loss";
  return "tie";
}

/**
 * One walk over the meetings, oldest to newest. `run` carries a sign so the
 * client knows whose streak it is: positive is mine, negative is theirs. A tie
 * breaks both. When the walk ends, `run` IS the current streak.
 *
 * A TEAMMATE GAME IS SKIPPED, not counted and not a break. Letting it through
 * the win branch would read a co-op night as an unbeaten run, which is the
 * loudest version of the bug `side` exists to fix. But breaking the streak is
 * wrong too, for the same reason it is not a tie: nothing happened between
 * these two that night, so neither "you extended your run" nor "your run
 * ended" is a true sentence. Three wins, a run played together, then a fourth
 * win is a streak of four.
 */
export function meetingStreaks(outcomes: MeetingOutcome[]): {
  run: number;
  myLongest: number;
  theirLongest: number;
} {
  let run = 0;
  let myLongest = 0;
  let theirLongest = 0;
  for (const o of outcomes) {
    if (o === "together") continue;
    if (o === "win") run = run > 0 ? run + 1 : 1;
    else if (o === "loss") run = run < 0 ? run - 1 : -1;
    else run = 0;
    if (run > myLongest) myLongest = run;
    if (-run > theirLongest) theirLongest = -run;
  }
  return { run, myLongest, theirLongest };
}

/** Me vs them across a set of crews: both sides' stats + the h2h ledger. */
async function buildRivalry(db: Db, groupIds: string[], meId: string, themId: string) {
  const mineAgg = newAgg();
  const theirsAgg = newAgg();
  type Side = MeetingSide & { character: string | null };
  const byMatch = new Map<
    string,
    { mine?: Side; theirs?: Side; game: string; playedAt: Date | null }
  >();

  if (groupIds.length) {
    // Every completed participant row for either of us, in one query;
    // pair them up by matchId in memory.
    const rows = await db
      .select({
        ...resultCols,
        userId: matchParticipants.userId,
        // Only the rivalry reads this. feedAgg is deliberately untouched: a
        // teammate game is still a game you played, so it belongs in both
        // players' lifetime totals exactly as it does today. What changes is
        // only how the two of them are recorded AGAINST EACH OTHER.
        side: matchParticipants.side,
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
      // feedAgg skips the series summary itself, but the meeting map below is
      // built here and would otherwise count a series as an extra head-to-head
      // encounter on top of every battle inside it, inflating the record,
      // breaking the meeting streak, and putting a null character through the
      // "what each of us reaches for" tally.
      if (isSeriesSummary(r.label)) continue;
      const m = byMatch.get(r.matchId) ?? { game: r.gameName ?? "Unknown", playedAt: r.playedAt };
      const entry: Side = { p: r.placement, w: r.isWinner, character: r.character, side: r.side };
      if (r.userId === meId) m.mine = entry;
      else m.theirs = entry;
      byMatch.set(r.matchId, m);
    }
  }

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let together = 0;
  const h2hByGame = new Map<
    string,
    { meetings: number; myWins: number; theirWins: number; together: number }
  >();
  // Every meeting with its outcome from MY side, for the ordered items
  // below. Built in the same pass so the two can never disagree.
  //
  // `together` is a FOURTH outcome, not a flavour of tie. Two people on the
  // same team did not draw with each other, they were not playing each other
  // at all, and folding that into ties would quietly claim they were. It is
  // counted and reported separately everywhere: the totals, the per-game
  // breakdown, the streak and the last-5 form line.
  type Meeting = {
    playedAt: Date | null;
    game: string;
    outcome: MeetingOutcome;
  };
  const meetings: Meeting[] = [];
  const myChars = new Map<string, number>();
  const theirChars = new Map<string, number>();

  for (const m of byMatch.values()) {
    if (!m.mine || !m.theirs) continue;
    const g = h2hByGame.get(m.game) ?? { meetings: 0, myWins: 0, theirWins: 0, together: 0 };
    g.meetings++;
    const outcome = meetingOutcome(m.mine, m.theirs);
    if (outcome === "together") {
      together++;
      g.together++;
    } else if (outcome === "win") {
      wins++;
      g.myWins++;
    } else if (outcome === "loss") {
      losses++;
      g.theirWins++;
    } else {
      ties++;
    }
    h2hByGame.set(m.game, g);
    meetings.push({ playedAt: m.playedAt, game: m.game, outcome });

    // Characters used in SHARED matches only, which is the point: what each
    // of us reaches for when the other is in the room.
    const mc = m.mine.character?.trim();
    if (mc) myChars.set(mc, (myChars.get(mc) ?? 0) + 1);
    const tc = m.theirs.character?.trim();
    if (tc) theirChars.set(tc, (theirChars.get(tc) ?? 0) + 1);
  }

  const topChar = (m: Map<string, number>) => {
    let name: string | null = null;
    let n = 0;
    for (const [k, v] of m) {
      if (v > n || (v === n && name !== null && k < name)) {
        name = k;
        n = v;
      }
    }
    return name ? { name, played: n } : null;
  };

  // Ordering-dependent items use dated meetings only. An undated meeting
  // cannot be placed in the sequence and is never guessed at.
  const dated = meetings
    .filter((m): m is Meeting & { playedAt: Date } => m.playedAt != null)
    .sort((x, y) => x.playedAt.getTime() - y.playedAt.getTime());

  const { run, myLongest, theirLongest } = meetingStreaks(dated.map((m) => m.outcome));

  const last = dated[dated.length - 1];

  return {
    meStats: await finishAggDeep(db, mineAgg),
    themStats: await finishAggDeep(db, theirsAgg),
    h2h: {
      meetings: wins + losses + ties + together,
      wins,
      losses,
      ties,
      /**
       * Meetings where the two were on the SAME side, so neither beat the
       * other. Counted in `meetings` because they did share a table, and in
       * none of wins/losses/ties because none of those happened.
       */
      together,
      /** Signed: positive is my streak, negative is theirs, 0 is neither. */
      currentStreak: run,
      myLongestStreak: myLongest,
      theirLongestStreak: theirLongest,
      lastMeeting: last
        ? { date: last.playedAt, game: last.game, outcome: last.outcome }
        : null,
      last5: dated
        .slice(-FORM_LENGTH)
        .reverse()
        .map((m) => ({ outcome: m.outcome, game: m.game, date: m.playedAt })),
      /** How many meetings could be ordered, so the client can say why. */
      tracked: dated.length,
      charactersInMeetings: { mine: topChar(myChars), theirs: topChar(theirChars) },
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
      matchId: matchParticipants.matchId,
      placement: matchParticipants.placement,
      isWinner: matchParticipants.isWinner,
      gameName: games.name,
      format: matches.format,
      label: matches.label,
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
    // feedAgg skips series summaries on its own; these two tallies are the
    // ones that live outside it, so they have to skip them here.
    if (isSeriesSummary(r.label)) continue;
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
  // One pass for both uses: labelling quick-play crews, and picking the
  // crews the show-up record is allowed to count.
  const myGroups = await db
    .select({ id: groups.id, isPersonal: groups.isPersonal })
    .from(groups)
    .innerJoin(memberships, eq(memberships.groupId, groups.id))
    .where(eq(memberships.userId, req.user!.id));

  // Mark personal crews so the client can label them "Quick play".
  for (const g of myGroups) {
    if (!g.isPersonal) continue;
    const c = byCrew.get(g.id);
    if (c) c.personal = true;
  }

  // Show-up record across REAL crews only. A personal quick-play crew is
  // just you, so there is nobody to have flaked on and no RSVP to break;
  // counting them would dilute the rate with nights that cannot be missed.
  const realCrewIds = myGroups.filter((g) => !g.isPersonal).map((g) => g.id);

  res.json({
    ...(await finishAggDeep(db, total)),
    byFormat: [...byFormat.values()].sort((x, y) => y.wins - x.wins || y.played - x.played),
    byCrew: [...byCrew.values()].sort((x, y) => y.played - x.played),
    // The crew profile has always shown this; the cross-crew view did not,
    // so the same person read differently on two pages.
    attendance: await attendanceFor(db, realCrewIds, req.user!.id),
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

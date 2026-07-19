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
  games,
  groups,
  matches,
  matchParticipants,
  memberships,
  users,
  and,
  eq,
} from "@gamenight/db";
import { requireAuth, type AuthedRequest } from "./auth.js";

export const statsRouter = Router();
statsRouter.use(requireAuth);

interface Row {
  userId: string;
  displayName: string;
  played: number;
  wins: number;
  podiums: number;
  placementSum: number;
  best: number | null;
  byGame: Record<string, { played: number; wins: number }>;
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
      userId: matchParticipants.userId,
      displayName: users.displayName,
      placement: matchParticipants.placement,
      isWinner: matchParticipants.isWinner,
      gameName: games.name,
      pack: games.pack,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(users, eq(matchParticipants.userId, users.id))
    .leftJoin(games, eq(matches.gameId, games.id))
    .where(and(eq(matchParticipants.groupId, groupId), eq(matches.status, "completed")));

  const byUser = new Map<string, Row>();
  for (const r of rows) {
    let row = byUser.get(r.userId);
    if (!row) {
      row = {
        userId: r.userId,
        displayName: r.displayName,
        played: 0,
        wins: 0,
        podiums: 0,
        placementSum: 0,
        best: null,
        byGame: {},
      };
      byUser.set(r.userId, row);
    }
    const place = r.placement ?? 0;
    row.played++;
    if (r.isWinner) row.wins++;
    if (place >= 1 && place <= 3) row.podiums++;
    if (place >= 1) {
      row.placementSum += place;
      row.best = row.best === null ? place : Math.min(row.best, place);
    }
    const key = r.gameName ?? "Unknown";
    const g = (row.byGame[key] ??= { played: 0, wins: 0 });
    g.played++;
    if (r.isWinner) g.wins++;
  }

  const finish = (r: Row) => ({
    userId: r.userId,
    displayName: r.displayName,
    played: r.played,
    wins: r.wins,
    podiums: r.podiums,
    best: r.best,
    winRate: r.played ? r.wins / r.played : 0,
    avgPlacement: r.played ? r.placementSum / r.played : null,
    byGame: Object.entries(r.byGame)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.played - a.played),
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
      row = {
        userId: r.userId,
        displayName: r.displayName,
        played: 0,
        wins: 0,
        podiums: 0,
        placementSum: 0,
        best: null,
        byGame: {},
      };
      bucket.set(r.userId, row);
    }
    const place = r.placement ?? 0;
    row.played++;
    if (r.isWinner) row.wins++;
    if (place >= 1 && place <= 3) row.podiums++;
    if (place >= 1) {
      row.placementSum += place;
      row.best = row.best === null ? place : Math.min(row.best, place);
    }
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
    }))
    .sort((a, b) => b.tournaments - a.tournaments || a.name.localeCompare(b.name));

  res.json({ tournaments: tournamentRows.length, leaderboard, games: games_ });
});

// ---------- Profiles + rivalry (reads only, no schema change) ----------
//
// Head-to-head definition: any completed match where BOTH players have a
// participant row. Better (lower) placement wins the encounter; equal
// placement is a tie. This spans every pack because they all materialize
// into the same ledger. No "current streak" here: matches carry no
// timestamp, so encounter order can't be reconstructed reliably.

interface Agg {
  played: number;
  wins: number;
  podiums: number;
  placementSum: number;
  placed: number;
  best: number | null;
  byGame: Record<string, { played: number; wins: number }>;
}

function newAgg(): Agg {
  return { played: 0, wins: 0, podiums: 0, placementSum: 0, placed: 0, best: null, byGame: {} };
}

function feedAgg(a: Agg, placement: number | null, isWinner: boolean, gameName: string | null) {
  const place = placement ?? 0;
  a.played++;
  if (isWinner) a.wins++;
  if (place >= 1 && place <= 3) a.podiums++;
  if (place >= 1) {
    a.placementSum += place;
    a.placed++;
    a.best = a.best === null ? place : Math.min(a.best, place);
  }
  const key = gameName ?? "Unknown";
  const g = (a.byGame[key] ??= { played: 0, wins: 0 });
  g.played++;
  if (isWinner) g.wins++;
}

function finishAgg(a: Agg) {
  return {
    played: a.played,
    wins: a.wins,
    podiums: a.podiums,
    best: a.best,
    winRate: a.played ? a.wins / a.played : 0,
    avgPlacement: a.placed ? a.placementSum / a.placed : null,
    byGame: Object.entries(a.byGame)
      .map(([name, v]) => ({ name, ...v }))
      .sort((x, y) => y.played - x.played),
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
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(groups, eq(matches.groupId, groups.id))
    .leftJoin(games, eq(matches.gameId, games.id))
    .where(and(eq(matchParticipants.userId, req.user!.id), eq(matches.status, "completed")));

  const total = newAgg();
  const byCrew = new Map<string, { groupId: string; name: string; played: number; wins: number; personal: boolean }>();
  for (const r of rows) {
    feedAgg(total, r.placement, r.isWinner, r.gameName);
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

  const rows = await db
    .select({
      placement: matchParticipants.placement,
      isWinner: matchParticipants.isWinner,
      gameName: games.name,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .leftJoin(games, eq(matches.gameId, games.id))
    .where(
      and(
        eq(matchParticipants.groupId, groupId),
        eq(matchParticipants.userId, targetId),
        eq(matches.status, "completed"),
      ),
    );

  const a = newAgg();
  for (const r of rows) feedAgg(a, r.placement, r.isWinner, r.gameName);
  res.json({ userId: targetId, displayName: target[0].displayName, ...finishAgg(a) });
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

  // Every completed participant row in the crew for either of us, in one
  // query; pair them up by matchId in memory.
  const rows = await db
    .select({
      matchId: matchParticipants.matchId,
      userId: matchParticipants.userId,
      placement: matchParticipants.placement,
      isWinner: matchParticipants.isWinner,
      gameName: games.name,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .leftJoin(games, eq(matches.gameId, games.id))
    .where(and(eq(matchParticipants.groupId, groupId), eq(matches.status, "completed")));

  const mineAgg = newAgg();
  const theirsAgg = newAgg();
  const byMatch = new Map<string, { mine?: { p: number | null; w: boolean }; theirs?: { p: number | null; w: boolean }; game: string }>();
  for (const r of rows) {
    if (r.userId !== meId && r.userId !== themId) continue;
    const side = r.userId === meId ? mineAgg : theirsAgg;
    feedAgg(side, r.placement, r.isWinner, r.gameName);
    const m = byMatch.get(r.matchId) ?? { game: r.gameName ?? "Unknown" };
    if (r.userId === meId) m.mine = { p: r.placement, w: r.isWinner };
    else m.theirs = { p: r.placement, w: r.isWinner };
    byMatch.set(r.matchId, m);
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

  res.json({
    me: { userId: meId, displayName: meName, ...finishAgg(mineAgg) },
    them: { userId: themId, displayName: themName, ...finishAgg(theirsAgg) },
    h2h: {
      meetings: wins + losses + ties,
      wins,
      losses,
      ties,
      byGame: [...h2hByGame.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((x, y) => y.meetings - x.meetings),
    },
  });
});

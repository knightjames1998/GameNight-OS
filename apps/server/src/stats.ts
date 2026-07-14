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

  const leaderboard = [...byUser.values()]
    .map((r) => ({
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
    }))
    // Most wins first; ties broken by win rate, then by who showed up more.
    .sort(
      (a, b) => b.wins - a.wins || b.winRate - a.winRate || b.played - a.played,
    );

  const tournaments = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.groupId, groupId), eq(matches.status, "completed")));

  res.json({ tournaments: tournaments.length, leaderboard });
});

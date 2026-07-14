import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import BackButton from "../BackButton";

interface StatRow {
  userId: string;
  displayName: string;
  played: number;
  wins: number;
  podiums: number;
  best: number | null;
  winRate: number;
  avgPlacement: number | null;
  byGame: { name: string; played: number; wins: number }[];
}

interface StatsView {
  tournaments: number;
  leaderboard: StatRow[];
}

export default function StatsPage() {
  const { id } = useParams();
  const [stats, setStats] = useState<StatsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api<StatsView>(`/api/groups/${id}/stats`)
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [id]);

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 p-6 max-w-md mx-auto space-y-6">
      <BackButton />

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Lifetime stats</h1>
        {stats && (
          <p className="text-neutral-500 text-sm mt-1">
            {stats.tournaments} {stats.tournaments === 1 ? "tournament" : "tournaments"} recorded
          </p>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {!stats && !error && <p className="text-neutral-500 text-sm">Loading...</p>}

      {stats?.leaderboard.length === 0 && (
        <p className="text-neutral-500 text-sm">
          Nothing recorded yet. Finish a bracket or a Beerio Kart night and the crew's
          records show up here. Guests don't count until they're linked to a member.
        </p>
      )}

      <ul className="space-y-2">
        {stats?.leaderboard.map((r, i) => {
          const expanded = open === r.userId;
          return (
            <li
              key={r.userId}
              className={`rounded-lg border px-4 py-3 ${
                i === 0
                  ? "bg-yellow-500/10 border-yellow-500/40"
                  : "bg-neutral-900 border-neutral-800"
              }`}
            >
              <button
                className="w-full text-left"
                onClick={() => setOpen(expanded ? null : r.userId)}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex items-baseline gap-2 min-w-0">
                    <span
                      className={`text-sm w-5 shrink-0 ${
                        i === 0 ? "text-yellow-400" : "text-neutral-600"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className={`font-semibold truncate ${i === 0 ? "text-yellow-400" : ""}`}>
                      {r.displayName}
                    </span>
                  </span>
                  <span className="text-sm shrink-0">
                    <span className="font-semibold">{r.wins}</span>
                    <span className="text-neutral-500"> {r.wins === 1 ? "win" : "wins"}</span>
                  </span>
                </div>
                <div className="text-xs text-neutral-500 mt-1 pl-7">
                  {r.played} played &middot; {Math.round(r.winRate * 100)}% win rate &middot;{" "}
                  {r.podiums} top 3
                  {r.avgPlacement !== null && ` · avg finish ${r.avgPlacement.toFixed(1)}`}
                </div>
              </button>

              {expanded && (
                <ul className="mt-3 pl-7 space-y-1 border-t border-neutral-800 pt-2">
                  {r.byGame.map((g) => (
                    <li key={g.name} className="text-xs text-neutral-400 flex justify-between">
                      <span>{g.name}</span>
                      <span className="text-neutral-500">
                        {g.wins}/{g.played} won
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}

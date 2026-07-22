import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import BackButton from "../BackButton";

// The full personal-stats page, opened from the "Your stats" button on Home.
// Lifetime totals across every crew (quick play included), broken down by
// game, by format, and by crew.
interface MyStats {
  played: number;
  wins: number;
  winRate: number;
  podiums: number;
  byGame: { name: string; played: number; wins: number }[];
  byFormat: { format: string; played: number; wins: number }[];
  byCrew: { groupId: string; name: string; played: number; wins: number; personal: boolean }[];
}

const FORMAT_LABEL: Record<string, string> = {
  free: "Free Play",
  ffa: "Free-for-all",
  grandprix: "Grand Prix",
  bestof: "Best Of",
  koth: "King of the Hill",
  board: "Board night",
  other: "Other",
};

function Tile({ n, label, accent }: { n: string; label: string; accent?: string }) {
  return (
    <div
      style={{
        flex: 1,
        textAlign: "center",
        background: "var(--gn-surf)",
        border: "1.5px solid var(--gn-line)",
        borderRadius: 14,
        padding: "16px 6px",
      }}
    >
      <div style={{ fontFamily: "Fredoka, system-ui, sans-serif", fontWeight: 800, fontSize: 30, lineHeight: 1, color: accent ?? "var(--gn-ink)" }}>{n}</div>
      <div className="gn-hint" style={{ fontSize: 12, marginTop: 5 }}>{label}</div>
    </div>
  );
}

function Row({ name, wins, played, link }: { name: string; wins: number; played: number; link?: string }) {
  return (
    <li className="flex justify-between items-baseline" style={{ fontSize: 15 }}>
      {link ? (
        <Link to={link} className="truncate" style={{ marginRight: 8, color: "var(--gn-p2)", fontWeight: 700, textDecoration: "none" }}>
          {name}
        </Link>
      ) : (
        <span className="truncate" style={{ marginRight: 8 }}>{name}</span>
      )}
      <span className="gn-hint" style={{ flexShrink: 0 }}>
        <span style={{ color: "var(--gn-ink)", fontWeight: 700 }}>{wins}</span>W / {played}
      </span>
    </li>
  );
}

export default function MyStatsPage() {
  const [stats, setStats] = useState<MyStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MyStats>("/api/me/stats")
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your stats"));
  }, []);

  return (
    <main className="gn-app">
      <div className="gn-wrap space-y-6">
        <BackButton />
        <h1 className="gn-title text-2xl">📊 Your stats</h1>

        {error && <p style={{ color: "var(--gn-danger)" }} className="text-sm">{error}</p>}
        {!stats && !error && <p className="gn-hint">Loading...</p>}

        {stats && stats.played === 0 && (
          <p className="gn-hint">Play a game night and your lifetime record shows up here.</p>
        )}

        {stats && stats.played > 0 && (
          <>
            <div className="flex gap-3">
              <Tile n={String(stats.wins)} label="wins" accent="var(--gn-gold)" />
              <Tile n={String(stats.played)} label="games" />
              <Tile n={`${Math.round(stats.winRate * 100)}%`} label="win rate" accent="var(--gn-p2)" />
            </div>
            {stats.podiums > 0 && (
              <p className="gn-hint">🏅 {stats.podiums} top-3 finish{stats.podiums === 1 ? "" : "es"}</p>
            )}

            {stats.byGame.length > 0 && (
              <section className="space-y-2">
                <h2 className="gn-h2">By game</h2>
                <ul className="gn-card space-y-2" style={{ padding: "12px 16px" }}>
                  {stats.byGame.map((g) => (
                    <Row key={g.name} name={g.name} wins={g.wins} played={g.played} />
                  ))}
                </ul>
              </section>
            )}

            {stats.byFormat.length > 0 && (
              <section className="space-y-2">
                <h2 className="gn-h2">By format</h2>
                <ul className="gn-card space-y-2" style={{ padding: "12px 16px" }}>
                  {stats.byFormat.map((f) => (
                    <Row key={f.format} name={FORMAT_LABEL[f.format] ?? f.format} wins={f.wins} played={f.played} />
                  ))}
                </ul>
              </section>
            )}

            {stats.byCrew.length > 0 && (
              <section className="space-y-2">
                <h2 className="gn-h2">By crew</h2>
                <ul className="gn-card space-y-2" style={{ padding: "12px 16px" }}>
                  {stats.byCrew.map((c) => (
                    <Row
                      key={c.groupId}
                      name={c.personal ? "Quick play" : c.name}
                      wins={c.wins}
                      played={c.played}
                      link={c.personal ? undefined : `/g/${c.groupId}/stats`}
                    />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

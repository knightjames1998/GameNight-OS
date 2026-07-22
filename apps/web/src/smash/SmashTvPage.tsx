import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import BackButton from "../BackButton";
import { useLiveUpdates } from "../useLiveUpdates";
import "./smash.css";

interface Slot { id: string; name: string; character: string | null }
interface TvSeriesStanding { slotId: string; name: string; seriesWins: number; seriesPlayed: number; gameWins: number; currentStreak: number }
interface TvSession {
  status: string;
  format: "ffa" | "koth" | "bestof";
  mode: "ffa" | "koth";
  roster: Slot[];
  games: { idx: number }[];
  koth: { kingId: string | null; queue: string[]; streak: number } | null;
  bestOf: number;
  series: { aId: string; bId: string; games: { winnerId: string }[] } | null;
  seriesLog: { idx: number }[];
  seriesStandings: TvSeriesStanding[];
  summary: {
    characters: { character: string; played: number; wins: number }[];
    players: { playerId: string; name: string; played: number; wins: number; mainCharacter: string | null }[];
  };
}

export default function SmashTvPage() {
  const { eventId = "" } = useParams();
  const [session, setSession] = useState<TvSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refetch() {
    const r = await api<{ session: TvSession | null }>(`/api/tv/smash/${eventId}`).catch(() => ({ session: null }));
    setSession(r.session);
  }
  useEffect(() => {
    refetch().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  useLiveUpdates(
    (m) => {
      if ((m.type === "smash_updated" || m.type === "leaderboard_updated") && m.eventId === eventId) refetch();
    },
    () => refetch(),
  );

  if (!loaded) return <div className="sm-tv"><div className="sm-tv__brand">Loading...</div></div>;

  if (!session) {
    return (
      <div className="sm-tv">
        <div className="sm-tv__brand">Smash Night</div>
        <p className="sm-tv__muted" style={{ fontSize: "3vmin", marginTop: "2vmin" }}>Waiting for the host to start the night.</p>
        <div style={{ marginTop: "3vmin" }}><BackButton className="sm-textbtn" /></div>
      </div>
    );
  }

  const nameOf = new Map(session.roster.map((p) => [p.id, p.name]));
  const charOf = new Map(session.roster.map((p) => [p.id, p.character]));
  const kingId = session.koth?.kingId ?? null;
  const bestOf = session.format === "bestof";
  const cur = session.series;
  const setWins = cur
    ? cur.games.reduce((acc, g) => { if (g.winnerId === cur.aId) acc.a++; else if (g.winnerId === cur.bId) acc.b++; return acc; }, { a: 0, b: 0 })
    : { a: 0, b: 0 };

  return (
    <div className="sm-tv">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="sm-tv__brand">Smash Night</div>
        <div className="sm-tv__muted" style={{ fontSize: "2.4vmin" }}>
          {bestOf
            ? `Best of ${session.bestOf} · ${session.seriesLog.length} set${session.seriesLog.length === 1 ? "" : "s"}`
            : `${session.mode === "koth" ? "King of the Hill" : "Free-for-all"} · ${session.games.length} games`}
        </div>
      </div>

      {bestOf && cur && (
        <div style={{ marginTop: "2vmin" }}>
          <div className="sm-tv__muted" style={{ fontSize: "2.6vmin", textTransform: "uppercase", letterSpacing: "0.3vmin" }}>On stage</div>
          <div className="sm-tv__king" style={{ display: "flex", alignItems: "center", gap: "2vmin" }}>
            <span>{nameOf.get(cur.aId)}</span>
            <span className="sm-tv__muted">{setWins.a} - {setWins.b}</span>
            <span>{nameOf.get(cur.bId)}</span>
          </div>
        </div>
      )}

      {session.mode === "koth" && kingId && (
        <div style={{ marginTop: "2vmin" }}>
          <div className="sm-tv__muted" style={{ fontSize: "2.6vmin" }}>👑 Current king{session.koth && session.koth.streak > 0 ? ` · ${session.koth.streak} in a row` : ""}</div>
          <div className="sm-tv__king">{nameOf.get(kingId)} <span style={{ fontSize: "3.4vmin" }} className="sm-tv__muted">as {charOf.get(kingId) ?? "?"}</span></div>
          {session.koth && session.koth.queue.length > 0 && (
            <div style={{ marginTop: "1.6vmin" }}>
              <span style={{ fontSize: "3.4vmin", fontFamily: "Fredoka, sans-serif", fontWeight: 700 }}>
                ⚔️ Up next: {nameOf.get(session.koth.queue[0]!)}
                {charOf.get(session.koth.queue[0]!) ? (
                  <span className="sm-tv__muted" style={{ fontSize: "2.6vmin" }}> as {charOf.get(session.koth.queue[0]!)}</span>
                ) : null}
              </span>
              {session.koth.queue.length > 1 && (
                <div className="sm-tv__muted" style={{ fontSize: "2.4vmin", marginTop: "0.6vmin" }}>
                  Then: {session.koth.queue.slice(1).map((id) => nameOf.get(id)).filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {bestOf ? (
        <div className="sm-tv__grid">
          <div className="sm-tv__panel">
            <h3>Standings</h3>
            {session.seriesStandings.length === 0 && <div className="sm-tv__muted">No sets yet</div>}
            {session.seriesStandings.map((p) => (
              <div className="sm-tv__line" key={p.slotId}>
                <span>{p.name}{p.currentStreak >= 2 ? ` 🔥${p.currentStreak}` : ""}</span>
                <span>{p.seriesWins}W · {p.gameWins}g</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="sm-tv__grid">
          <div className="sm-tv__panel">
            <h3>Players</h3>
            {session.summary.players.length === 0 && <div className="sm-tv__muted">No games yet</div>}
            {session.summary.players.map((p) => (
              <div className="sm-tv__line" key={p.playerId}>
                <span>{p.name} {p.mainCharacter ? <span className="sm-tv__muted" style={{ fontSize: "2.2vmin" }}>({p.mainCharacter})</span> : null}</span>
                <span>{p.wins}W · {p.played}</span>
              </div>
            ))}
          </div>
          <div className="sm-tv__panel">
            <h3>Fighters</h3>
            {session.summary.characters.length === 0 && <div className="sm-tv__muted">No games yet</div>}
            {session.summary.characters.slice(0, 8).map((c) => (
              <div className="sm-tv__line" key={c.character}>
                <span>{c.character}</span>
                <span>{c.wins}W · {c.played}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: "3vmin" }}><BackButton className="sm-textbtn" /></div>
    </div>
  );
}

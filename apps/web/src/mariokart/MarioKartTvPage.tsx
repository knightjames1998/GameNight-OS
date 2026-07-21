import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import BackButton from "../BackButton";
import { useLiveUpdates } from "../useLiveUpdates";
import "./mariokart.css";

interface Slot { id: string; name: string; character: string | null }
interface TvCupStanding { playerId: string; name: string; points: number; wins: number }
interface TvSeriesStanding { slotId: string; name: string; seriesWins: number; gameWins: number; currentStreak: number }
interface TvSession {
  status: string;
  format: "free" | "grandprix" | "bestof" | "koth";
  roster: Slot[];
  games: { idx: number }[];
  koth: { kingId: string | null; queue: string[]; streak: number } | null;
  series: { aId: string; bId: string; games: { winnerId: string }[] } | null;
  seriesLog: { idx: number }[];
  seriesStandings: TvSeriesStanding[];
  cup: { standings: TvCupStanding[]; cupNo: number; racesDone: number; raceCount: number; complete: boolean } | null;
  summary: {
    characters: { character: string; played: number; wins: number }[];
    players: { playerId: string; name: string; played: number; wins: number; mainCharacter: string | null }[];
  };
}

export default function MarioKartTvPage() {
  const { eventId = "" } = useParams();
  const [session, setSession] = useState<TvSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refetch() {
    const r = await api<{ session: TvSession | null }>(`/api/tv/mariokart/${eventId}`).catch(() => ({ session: null }));
    setSession(r.session);
  }
  useEffect(() => {
    refetch().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  useLiveUpdates(
    (m) => {
      if ((m.type === "mario_kart_updated" || m.type === "leaderboard_updated") && m.eventId === eventId) refetch();
    },
    () => refetch(),
  );

  if (!loaded) return <div className="mk-tv"><div className="mk-tv__brand">Loading...</div></div>;

  if (!session) {
    return (
      <div className="mk-tv">
        <div className="mk-tv__brand">Mario Kart</div>
        <p className="mk-tv__muted" style={{ fontSize: "3vmin", marginTop: "2vmin" }}>Waiting for the host to start the night.</p>
        <div style={{ marginTop: "3vmin" }}><BackButton className="mk-textbtn" /></div>
      </div>
    );
  }

  const label =
    session.format === "grandprix"
      ? session.cup
        ? `Grand Prix · Cup ${session.cup.cupNo} (${session.cup.racesDone}/${session.cup.raceCount})`
        : "Grand Prix"
      : session.format === "bestof"
      ? `Best Of · ${session.seriesLog.length} set${session.seriesLog.length === 1 ? "" : "s"}`
      : session.format === "koth"
      ? "King of the Hill"
      : `Free Play · ${session.games.length} races`;
  const nameOf = new Map(session.roster.map((p) => [p.id, p.name]));
  const cur = session.series;
  const setWins = cur
    ? cur.games.reduce((acc, g) => { if (g.winnerId === cur.aId) acc.a++; else if (g.winnerId === cur.bId) acc.b++; return acc; }, { a: 0, b: 0 })
    : { a: 0, b: 0 };

  return (
    <div className="mk-tv">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="mk-tv__brand">Mario Kart</div>
        <div className="mk-tv__muted" style={{ fontSize: "2.4vmin" }}>{label}</div>
      </div>

      {session.format === "bestof" && cur && (
        <div style={{ marginTop: "2vmin" }}>
          <div className="mk-tv__muted" style={{ fontSize: "2.6vmin", textTransform: "uppercase", letterSpacing: "0.3vmin" }}>On the grid</div>
          <div style={{ fontSize: "5vmin", fontFamily: "Fredoka, sans-serif", fontWeight: 800, display: "flex", alignItems: "center", gap: "2vmin" }}>
            <span>{nameOf.get(cur.aId)}</span>
            <span className="mk-tv__muted">{setWins.a} - {setWins.b}</span>
            <span>{nameOf.get(cur.bId)}</span>
          </div>
        </div>
      )}

      {session.format === "grandprix" && session.cup ? (
        <div className="mk-tv__grid">
          <div className="mk-tv__panel">
            <h3>Cup {session.cup.cupNo}{session.cup.complete ? " · complete" : ""}</h3>
            {session.cup.standings.length === 0 && <div className="mk-tv__muted">No races yet</div>}
            {session.cup.standings.map((s, i) => (
              <div className="mk-tv__line" key={s.playerId}>
                <span>{i === 0 && s.points > 0 ? "🏆 " : ""}{s.name}</span>
                <span>{s.points} pts</span>
              </div>
            ))}
          </div>
        </div>
      ) : session.format === "bestof" ? (
        <div className="mk-tv__grid">
          <div className="mk-tv__panel">
            <h3>Standings</h3>
            {session.seriesStandings.length === 0 && <div className="mk-tv__muted">No sets yet</div>}
            {session.seriesStandings.map((p) => (
              <div className="mk-tv__line" key={p.slotId}>
                <span>{p.name}{p.currentStreak >= 2 ? ` 🔥${p.currentStreak}` : ""}</span>
                <span>{p.seriesWins}W · {p.gameWins}r</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mk-tv__grid">
          <div className="mk-tv__panel">
            <h3>Players</h3>
            {session.summary.players.length === 0 && <div className="mk-tv__muted">No races yet</div>}
            {session.summary.players.map((p) => (
              <div className="mk-tv__line" key={p.playerId}>
                <span>{p.name} {p.mainCharacter ? <span className="mk-tv__muted" style={{ fontSize: "2.2vmin" }}>({p.mainCharacter})</span> : null}</span>
                <span>{p.wins}W · {p.played}</span>
              </div>
            ))}
          </div>
          <div className="mk-tv__panel">
            <h3>Racers</h3>
            {session.summary.characters.length === 0 && <div className="mk-tv__muted">No races yet</div>}
            {session.summary.characters.slice(0, 8).map((c) => (
              <div className="mk-tv__line" key={c.character}>
                <span>{c.character}</span>
                <span>{c.wins}W · {c.played}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: "3vmin" }}><BackButton className="mk-textbtn" /></div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import BackButton from "../BackButton";
import { useLiveUpdates } from "../useLiveUpdates";
import "./pingpong.css";

interface Slot { id: string; name: string }
interface Game { winnerId: string }
interface Match { aId: string; bId: string; games: Game[]; winnerId: string | null }
interface PlayerStat { playerId: string; name: string; matches: number; wins: number; currentStreak: number; longestReign: number }
interface TvSession {
  status: string;
  mode: "koth" | "ffa";
  bestOf: number;
  needed: number;
  roster: Slot[];
  matches: Match[];
  current: Match | null;
  koth: { kingId: string | null } | null;
  summary: { players: PlayerStat[] };
}

export default function PingPongTvPage() {
  const { eventId = "" } = useParams();
  const [session, setSession] = useState<TvSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refetch() {
    const r = await api<{ session: TvSession | null }>(`/api/tv/pingpong/${eventId}`).catch(() => ({ session: null }));
    setSession(r.session);
  }
  useEffect(() => {
    refetch().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  useLiveUpdates(
    (m) => {
      if ((m.type === "ping_pong_updated" || m.type === "leaderboard_updated") && m.eventId === eventId) refetch();
    },
    () => refetch(),
  );

  const nameOf = useMemo(() => new Map((session?.roster ?? []).map((p) => [p.id, p.name])), [session]);

  if (!loaded) return <div className="pp-tv"><div className="pp-tv__brand">Loading...</div></div>;

  if (!session) {
    return (
      <div className="pp-tv">
        <div className="pp-tv__brand">Ping Pong</div>
        <p className="pp-tv__muted" style={{ fontSize: "3vmin", marginTop: "2vmin" }}>Waiting for the host to start the night.</p>
        <div style={{ marginTop: "3vmin" }}><BackButton className="pp-textbtn" /></div>
      </div>
    );
  }

  const cur = session.current;
  const wins = cur
    ? cur.games.reduce(
        (acc, g) => {
          if (g.winnerId === cur.aId) acc.a++;
          else if (g.winnerId === cur.bId) acc.b++;
          return acc;
        },
        { a: 0, b: 0 },
      )
    : { a: 0, b: 0 };
  const players = session.summary.players.filter((p) => p.matches > 0);

  return (
    <div className="pp-tv">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="pp-tv__brand">Ping Pong</div>
        <div className="pp-tv__muted" style={{ fontSize: "2.4vmin" }}>
          {session.mode === "koth" ? "King of the Hill" : "Singles"} · {session.bestOf === 1 ? "free play" : `best of ${session.bestOf}`} · {session.matches.length} {session.bestOf === 1 ? "games" : "matches"}
        </div>
      </div>

      {cur ? (
        <div className="pp-tv__now">
          <div className="pp-tv__muted" style={{ fontSize: "2.4vmin", textTransform: "uppercase", letterSpacing: "0.3vmin" }}>
            {session.bestOf === 1 ? "On the table · free play" : `On the table · first to ${session.needed}`}
          </div>
          <div className="pp-tv__vs">
            <span className="pp-tv__pl">
              {nameOf.get(cur.aId)} {session.mode === "koth" && session.koth?.kingId === cur.aId ? "👑" : ""}
            </span>
            <span className="pp-tv__sc">{session.bestOf === 1 ? "VS" : `${wins.a} - ${wins.b}`}</span>
            <span className="pp-tv__pl">
              {nameOf.get(cur.bId)} {session.mode === "koth" && session.koth?.kingId === cur.bId ? "👑" : ""}
            </span>
          </div>
        </div>
      ) : (
        <div className="pp-tv__now"><span className="pp-tv__muted" style={{ fontSize: "3vmin" }}>Between matches</span></div>
      )}

      <div className="pp-tv__grid">
        <div className="pp-tv__panel">
          <h3>Standings</h3>
          {players.length === 0 && <div className="pp-tv__muted">No matches yet</div>}
          {players.map((p) => (
            <div className="pp-tv__line" key={p.playerId}>
              <span>
                {p.name}
                {p.currentStreak >= 2 ? ` 🔥${p.currentStreak}` : ""}
                {session.mode === "koth" && p.longestReign >= 2 ? ` · reign ${p.longestReign}` : ""}
              </span>
              <span>{p.wins}W · {p.matches}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "3vmin" }}><BackButton className="pp-textbtn" /></div>
    </div>
  );
}

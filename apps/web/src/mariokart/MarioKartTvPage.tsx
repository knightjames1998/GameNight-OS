import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import BackButton from "../BackButton";
import { useLiveUpdates } from "../useLiveUpdates";
import "./mariokart.css";

interface Slot { id: string; name: string; character: string | null }
interface TvSession {
  status: string;
  roster: Slot[];
  games: { idx: number }[];
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

  return (
    <div className="mk-tv">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="mk-tv__brand">Mario Kart</div>
        <div className="mk-tv__muted" style={{ fontSize: "2.4vmin" }}>
          Race night · {session.games.length} races
        </div>
      </div>

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

      <div style={{ marginTop: "3vmin" }}><BackButton className="mk-textbtn" /></div>
    </div>
  );
}

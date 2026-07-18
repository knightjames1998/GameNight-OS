import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import BackButton from "../BackButton";
import { useLiveUpdates } from "../useLiveUpdates";
import "./marioparty.css";

interface TvSession {
  status: string;
  games: { idx: number; map: string }[];
  summary: {
    players: { playerId: string; name: string; games: number; wins: number; totalStars: number; mainCharacter: string | null }[];
    boards: { map: string; games: number }[];
  };
}

export default function MarioPartyTvPage() {
  const { eventId = "" } = useParams();
  const [session, setSession] = useState<TvSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refetch() {
    const r = await api<{ session: TvSession | null }>(`/api/tv/marioparty/${eventId}`).catch(() => ({ session: null }));
    setSession(r.session);
  }
  useEffect(() => {
    refetch().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  useLiveUpdates(
    (m) => {
      if ((m.type === "mario_party_updated" || m.type === "leaderboard_updated") && m.eventId === eventId) refetch();
    },
    () => refetch(),
  );

  if (!loaded) return <div className="mp-tv"><div className="mp-tv__brand">Loading...</div></div>;

  if (!session) {
    return (
      <div className="mp-tv">
        <div className="mp-tv__brand">Mario Party</div>
        <p className="mp-tv__muted" style={{ fontSize: "3vmin", marginTop: "2vmin" }}>Waiting for the host to start the night.</p>
        <div style={{ marginTop: "3vmin" }}><BackButton className="mp-textbtn" /></div>
      </div>
    );
  }

  const leader = session.summary.players[0];

  return (
    <div className="mp-tv">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="mp-tv__brand">Mario Party</div>
        <div className="mp-tv__muted" style={{ fontSize: "2.4vmin" }}>{session.games.length} boards</div>
      </div>

      {leader && leader.games > 0 && (
        <div style={{ marginTop: "2vmin" }}>
          <div className="mp-tv__muted" style={{ fontSize: "2.6vmin" }}>★ In the lead</div>
          <div className="mp-tv__lead">{leader.name} <span style={{ fontSize: "3.4vmin" }} className="mp-tv__muted">{leader.wins}W · {leader.totalStars}★</span></div>
        </div>
      )}

      <div className="mp-tv__grid">
        <div className="mp-tv__panel">
          <h3>Players</h3>
          {session.summary.players.length === 0 && <div className="mp-tv__muted">No boards yet</div>}
          {session.summary.players.map((p) => (
            <div className="mp-tv__line" key={p.playerId}>
              <span>{p.name} {p.mainCharacter ? <span className="mp-tv__muted" style={{ fontSize: "2.2vmin" }}>({p.mainCharacter})</span> : null}</span>
              <span>{p.wins}W · {p.totalStars}★</span>
            </div>
          ))}
        </div>
        <div className="mp-tv__panel">
          <h3>Boards</h3>
          {session.summary.boards.length === 0 && <div className="mp-tv__muted">No boards yet</div>}
          {session.summary.boards.map((b) => (
            <div className="mp-tv__line" key={b.map}>
              <span>{b.map}</span>
              <span>{b.games}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "3vmin" }}><BackButton className="mp-textbtn" /></div>
    </div>
  );
}

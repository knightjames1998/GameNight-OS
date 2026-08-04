import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SESSION_PACKS } from "@gamenight/shared";
import { api } from "../api";
import BackButton from "../BackButton";
import { usePackLive } from "../useLiveUpdates";
import "./boardgame.css";

// THE BETWEEN-GAMES STATE IS THE PRIMARY ONE, and that is the whole design of
// this screen.
//
// A board game night is not a stream of results: it is a game of Catan, then
// ninety minutes of nothing, then one result. Every other TV view in this app
// was built around a scoreboard that changes every few minutes, and the event
// TV learned on 2026-07-28 that treating the quiet state as the EMPTY state
// gives you a screen that is blank for most of the evening. So the standings
// and the last result carry this screen at all times, and the title slot says
// what is out when something is out and says so plainly when nothing is.

interface TvSession {
  status: string;
  nowPlaying: string | null;
  games: { idx: number; title: string }[];
  summary: {
    players: { playerId: string; name: string; games: number; wins: number; avgPlacement: number | null }[];
    titles: { title: string; games: number }[];
    last: { title: string; lines: { name: string; placement: number; score: number | null }[] } | null;
  };
}

const avg = (n: number | null) => (n === null ? "-" : n.toFixed(1));

// Route param on /boardgame/tv/:eventId, or a prop when the event TV route
// renders this view in place. See SmashTvPage for the why.
export default function BoardGameTvPage({ eventId: propEventId }: { eventId?: string }) {
  const params = useParams();
  const eventId = propEventId ?? params.eventId ?? "";
  const [session, setSession] = useState<TvSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refetch() {
    const r = await api<{ session: TvSession | null }>(`/api/tv/boardgame/${eventId}`).catch(() => ({ session: null }));
    setSession(r.session);
  }
  useEffect(() => {
    refetch().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  usePackLive(SESSION_PACKS.boardgame.wsType, eventId, refetch);

  if (!loaded) return <div className="bg-tv"><div className="bg-tv__brand">Loading...</div></div>;

  if (!session) {
    return (
      <div className="bg-tv">
        <div className="bg-tv__brand">Board Game Night</div>
        <p className="bg-tv__muted" style={{ fontSize: "3vmin", marginTop: "2vmin" }}>Waiting for the host to start the night.</p>
        <div style={{ marginTop: "3vmin" }}><BackButton className="bg-textbtn" /></div>
      </div>
    );
  }

  const { last } = session.summary;

  return (
    <div className="bg-tv">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="bg-tv__brand">Board Game Night</div>
        <div className="bg-tv__muted" style={{ fontSize: "2.4vmin" }}>
          {session.games.length} game{session.games.length === 1 ? "" : "s"} &middot; {session.summary.titles.length} title{session.summary.titles.length === 1 ? "" : "s"}
        </div>
      </div>

      <div style={{ marginTop: "2vmin" }}>
        <div className="bg-tv__label">{session.nowPlaying ? "On the table" : "Between games"}</div>
        {session.nowPlaying ? (
          <div className="bg-tv__title">{session.nowPlaying}</div>
        ) : (
          <div className="bg-tv__title bg-tv__title--idle">
            {last ? `Last up: ${last.title}` : "Pick a box and tap it in"}
          </div>
        )}
      </div>

      <div className="bg-tv__grid">
        <div className="bg-tv__panel">
          <h3>Tonight</h3>
          {session.summary.players.length === 0 && <div className="bg-tv__muted">No games yet</div>}
          {session.summary.players.map((p) => (
            <div className="bg-tv__line" key={p.playerId}>
              <span>{p.name}</span>
              <span>
                {p.wins}W <span className="bg-tv__muted">/ {p.games} &middot; avg {avg(p.avgPlacement)}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="bg-tv__panel">
          <h3>{last ? last.title : "Last game"}</h3>
          {!last && <div className="bg-tv__muted">Nothing recorded yet</div>}
          {last?.lines.map((l, i) => (
            <div className="bg-tv__line" key={`${l.name}-${i}`}>
              <span><span className="bg-tv__rank">{l.placement}</span> {l.name}</span>
              {l.score !== null && <span className="bg-tv__muted">{l.score}</span>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "3vmin" }}><BackButton className="bg-textbtn" /></div>
    </div>
  );
}

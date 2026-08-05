import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { SESSION_PACKS, sideLabel, type Side } from "@gamenight/shared";
import { api } from "../api";
import BackButton from "../BackButton";
import { usePackLive } from "../useLiveUpdates";
import "./pingpong.css";

interface Slot { id: string; name: string }
interface Game { winnerSideId: string }
interface Match { a: Side; b: Side; games: Game[]; winnerSideId: string | null }
interface PlayerStat { playerId: string; name: string; matches: number; wins: number; gameWins: number; currentStreak: number; longestReign: number }
interface TvSession {
  status: string;
  mode: "koth" | "ffa";
  bestOf: number;
  needed: number;
  roster: Slot[];
  matches: Match[];
  current: Match | null;
  koth: { kingSideId: string | null; queue: string[] } | null;
  sides: Side[];
  doubles: boolean;
  summary: { players: PlayerStat[]; bestReign: { memberIds: string[]; reign: number } | null };
}

// Route param on /pingpong/tv/:eventId, or a prop when the event TV route
// renders this view in place. See SmashTvPage for the why.
export default function PingPongTvPage({ eventId: propEventId }: { eventId?: string }) {
  const params = useParams();
  const eventId = propEventId ?? params.eventId ?? "";
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
  usePackLive(SESSION_PACKS.pingpong.wsType, eventId, refetch);

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
          if (g.winnerSideId === cur.a.id) acc.a++;
          else if (g.winnerSideId === cur.b.id) acc.b++;
          return acc;
        },
        { a: 0, b: 0 },
      )
    : { a: 0, b: 0 };
  const players = session.summary.players.filter((p) => p.matches > 0);
  /** A side reads as its members' names, which is what a room calls a pair. */
  const label = (side: Side | undefined) => (side ? sideLabel(side, (id) => nameOf.get(id)) : "");
  const labelById = (id: string) => label(session.sides.find((x) => x.id === id));

  return (
    <div className="pp-tv">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="pp-tv__brand">Ping Pong</div>
        <div className="pp-tv__muted" style={{ fontSize: "2.4vmin" }}>
            {session.mode === "koth" ? "King of the Hill" : session.doubles ? "Doubles" : "Singles"} · {session.bestOf === 1 ? "free play" : `best of ${session.bestOf}`} · {session.matches.length} {session.bestOf === 1 ? "games" : "matches"}
        </div>
      </div>

      {cur ? (
        <div className="pp-tv__now">
          <div className="pp-tv__muted" style={{ fontSize: "2.4vmin", textTransform: "uppercase", letterSpacing: "0.3vmin" }}>
            {session.bestOf === 1 ? "On the table · free play" : `On the table · first to ${session.needed}`}
            {session.mode === "koth" && session.koth && session.koth.queue.length > 1
              ? ` · next ${session.koth.queue.slice(1, 3).map(labelById).join(", ")}`
              : ""}
          </div>
          <div className="pp-tv__vs">
            <span className="pp-tv__pl">
              {label(cur.a)} {session.mode === "koth" && session.koth?.kingSideId === cur.a.id ? "👑" : ""}
            </span>
            <span className="pp-tv__sc">{session.bestOf === 1 ? "VS" : `${wins.a} - ${wins.b}`}</span>
            <span className="pp-tv__pl">
              {label(cur.b)} {session.mode === "koth" && session.koth?.kingSideId === cur.b.id ? "👑" : ""}
            </span>
          </div>
        </div>
      ) : (
        <div className="pp-tv__now"><span className="pp-tv__muted" style={{ fontSize: "3vmin" }}>Between matches</span></div>
      )}

      <div className="pp-tv__grid">
        <div className="pp-tv__panel">
          <h3 style={{ display: "flex", justifyContent: "space-between", gap: "2vmin" }}>
            <span>Standings</span>
            {session.mode === "koth" && session.summary.bestReign && session.summary.bestReign.reign >= 2 && (
              <span style={{ fontWeight: 400, opacity: 0.8 }}>
                👑 {session.summary.bestReign.memberIds.map((id) => nameOf.get(id)).join(" + ")} &times;{session.summary.bestReign.reign}
              </span>
            )}
          </h3>
          {players.length === 0 && <div className="pp-tv__muted">No matches yet</div>}
          {players.map((p) => (
            <div className="pp-tv__line" key={p.playerId}>
              <span>
                {p.name}
                {p.currentStreak >= 2 ? ` 🔥${p.currentStreak}` : ""}
                {session.mode === "koth" && p.longestReign >= 2 ? ` · reign ${p.longestReign}` : ""}
              </span>
              <span>{session.bestOf === 1 ? `${p.gameWins}W` : `${p.wins}W · ${p.gameWins}g`}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "3vmin" }}><BackButton className="pp-textbtn" /></div>
    </div>
  );
}

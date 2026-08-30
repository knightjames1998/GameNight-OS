import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SESSION_PACKS } from "@gamenight/shared";
import { api } from "../api";
import BackButton from "../BackButton";
import { marioKartTvBand } from "./mariokart-tv-band";
import { usePackLive } from "../useLiveUpdates";
import TvQr, { TV_QR_MIN } from "../TvQr";
import "./mariokart.css";

interface Slot { id: string; name: string; character: string | null }
interface TvKart { id: string; name: string; memberIds: string[] }
interface TvCupStanding { playerId: string; name: string; points: number; wins: number }
interface TvSeriesStanding { slotId: string; name: string; seriesWins: number; gameWins: number; currentStreak: number }
interface TvSession {
  status: string;
  format: "free" | "grandprix" | "bestof" | "koth";
  roster: Slot[];
  /** The arrangement of karts in force. A solo night is one kart per racer. */
  sides: TvKart[];
  /** True when a kart holds more than one racer. */
  pairs: boolean;
  games: { idx: number }[];
  koth: { kingSideId: string | null; queue: string[]; streak: number } | null;
  series: { aId: string; bId: string; games: { winnerId: string }[] } | null;
  seriesLog: { idx: number }[];
  seriesStandings: TvSeriesStanding[];
  cup: { standings: TvCupStanding[]; cupNo: number; racesDone: number; raceCount: number; complete: boolean } | null;
  summary: {
    characters: { character: string; played: number; wins: number }[];
    players: { playerId: string; name: string; played: number; wins: number; mainCharacter: string | null }[];
  };
}

// Route param on /mariokart/tv/:eventId, or a prop when the event TV route
// renders this view in place. See SmashTvPage for the why.
export default function MarioKartTvPage({ eventId: propEventId }: { eventId?: string }) {
  const params = useParams();
  const eventId = propEventId ?? params.eventId ?? "";
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
  usePackLive(SESSION_PACKS.mariokart.wsType, eventId, refetch);

  if (!loaded) return <div className="mk-tv"><div className="mk-tv__brand">Loading...</div></div>;

  if (!session) {
    return (
      <div className="mk-tv">
        <div className="mk-tv__brand">Mario Kart</div>
        <p className="mk-tv__muted" style={{ fontSize: "3vmin", marginTop: "2vmin" }}>Waiting for the host to start the night.</p>
        <div className="mk-tv__back"><BackButton className="mk-textbtn" /></div>
      </div>
    );
  }

  const nameOf = new Map(session.roster.map((p) => [p.id, p.name]));
  const charOf = new Map(session.roster.map((p) => [p.id, p.character]));
  const kartOf = new Map((session.sides ?? []).map((k) => [k.id, k]));
  // A kart of one is that racer's name, so a solo night's TV reads exactly as
  // it did before karts existed.
  const kartLabel = (id: string | null | undefined) => {
    const k = id ? kartOf.get(id) : undefined;
    if (!k) return "?";
    const names = k.memberIds.map((m) => nameOf.get(m)).filter((n): n is string => !!n);
    return names.length ? names.join(" + ") : k.name;
  };
  const kartRacers = (id: string) =>
    (kartOf.get(id)?.memberIds ?? []).map((m) => charOf.get(m) ?? "no racer").join(" + ");

  const label =
    session.format === "grandprix"
      ? session.cup
        ? `Grand Prix · Cup ${session.cup.cupNo} (${session.cup.racesDone}/${session.cup.raceCount})`
        : "Grand Prix"
      : session.format === "bestof"
      ? `Best Of · ${session.seriesLog.length} set${session.seriesLog.length === 1 ? "" : "s"}`
      : session.format === "koth"
      ? // Who holds the table, FOLDED ONTO THE LABEL that is already on the
        // screen rather than given a block of its own. This view is measured
        // against 1080p and a new block is what pushes it over.
        session.koth?.kingSideId
        ? `King of the Hill · 👑 ${kartLabel(session.koth.kingSideId)}`
        : "King of the Hill"
      : `Free Play · ${session.games.length} races`;
  const cur = session.series;
  const setWins = cur
    ? cur.games.reduce((acc, g) => { if (g.winnerId === cur.aId) acc.a++; else if (g.winnerId === cur.bId) acc.b++; return acc; }, { a: 0, b: 0 })
    : { a: 0, b: 0 };

  // THE DENSITY LADDER. This TV has never fitted a 1080p screen past eight
  // racers and the server seats sixteen (see mariokart-tv-band.ts and the
  // [data-mkband] blocks in mariokart.css). It is the PLAYERS panel that grows:
  // the Racers/Karts panel is capped at eight by the view below.
  const band = marioKartTvBand({
    players: session.summary.players.length,
    sides: session.pairs ? session.sides.length : session.summary.characters.length,
  });

  return (
    <div className="mk-tv" data-mkband={band}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="mk-tv__brand">Mario Kart</div>
        <div className="mk-tv__muted mk-tv__meta">{label}</div>
        <TvQr eventId={eventId} size={TV_QR_MIN} />
      </div>

      {session.format === "bestof" && cur && (
        <div style={{ marginTop: "2vmin" }}>
          <div className="mk-tv__muted mk-tv__lbl" style={{ textTransform: "uppercase", letterSpacing: "0.3vmin" }}>On the grid</div>
          <div style={{ fontSize: "5vmin", fontFamily: "Fredoka, sans-serif", fontWeight: 800, display: "flex", alignItems: "center", gap: "2vmin" }}>
            <span>{kartLabel(cur.aId)}</span>
            <span className="mk-tv__muted">{setWins.a} - {setWins.b}</span>
            <span>{kartLabel(cur.bId)}</span>
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
                <span>{p.name} {p.mainCharacter ? <span className="mk-tv__muted mk-tv__sub">({p.mainCharacter})</span> : null}</span>
                <span>{p.wins}W · {p.played}</span>
              </div>
            ))}
          </div>
          {/* KARTS REPLACE RACERS ON A PAIRS NIGHT, in the panel that is
              already there rather than beside it. It is a swap and never an
              addition, and a kart line is never longer than the racer lines it
              replaces (karts <= racers), so the 1080p fit is bounded by what
              this view already measured at. On a solo night this is the Racers
              panel, unchanged. */}
          {session.pairs ? (
            <div className="mk-tv__panel">
              <h3>Karts</h3>
              {session.sides.length === 0 && <div className="mk-tv__muted">No karts yet</div>}
              {session.sides.slice(0, 8).map((k) => (
                <div className="mk-tv__line" key={k.id}>
                  <span>{kartLabel(k.id)}</span>
                  <span className="mk-tv__muted mk-tv__sub">{kartRacers(k.id)}</span>
                </div>
              ))}
            </div>
          ) : (
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
          )}
        </div>
      )}

      <div style={{ marginTop: "3vmin" }}><BackButton className="mk-textbtn" /></div>
    </div>
  );
}

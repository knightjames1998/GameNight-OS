import { useEffect, useState, type ReactNode } from "react";
import { SESSION_PACKS, type SessionPackKey } from "@gamenight/shared";
import { api } from "../api";
import BackButton from "../BackButton";
import { titleNightTvBand } from "./titlenight-tv-band";
import { usePackLive } from "../useLiveUpdates";
import type { TitleNightCopy, TnSummaryView } from "./TitleNight";
import TvQr, { TV_QR_MIN } from "../TvQr";
import "./titlenight.css";

// THE BETWEEN-GAMES STATE IS THE PRIMARY ONE, and that is the whole design of
// this screen.
//
// A title night is not a stream of results: it is a game of Catan, then ninety
// minutes of nothing, then one result. Every other TV view in this app was
// built around a scoreboard that changes every few minutes, and the event TV
// learned on 2026-07-28 that treating the quiet state as the EMPTY state gives
// you a screen that is blank for most of the evening. So the standings and the
// last result carry this screen at all times, and the title slot says what is
// out when something is out and says so plainly when nothing is.
//
// A PACK'S TV IS THIS FILE PLUS A BACKDROP. The pack passes its class (which
// carries its --tn-* tokens), its brand lettering and its idle line; nothing
// else about the two differs, so nothing else is a parameter.

export interface TnTvSession {
  status: string;
  nowPlaying: string | null;
  games: { idx: number; title: string }[];
  summary: TnSummaryView;
}

const avg = (n: number | null) => (n === null ? "-" : n.toFixed(1));

export function TitleNightTv({
  pack,
  eventId,
  className,
  brand,
  copy,
  waitingHint,
}: {
  pack: SessionPackKey;
  eventId: string;
  /** The pack's TV root class, which is where its --tn-* tokens live. */
  className: string;
  brand: ReactNode;
  copy: TitleNightCopy;
  /** Shown before the host has started anything. */
  waitingHint: string;
}) {
  const def = SESSION_PACKS[pack];
  const [session, setSession] = useState<TnTvSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refetch() {
    const r = await api<{ session: TnTvSession | null }>(`/api/tv/${def.route}/${eventId}`).catch(() => ({
      session: null,
    }));
    setSession(r.session);
  }
  useEffect(() => {
    refetch().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  usePackLive(def.wsType, eventId, refetch);

  if (!loaded) return <div className={`tn-tv ${className}`}><div className="tn-tv__brand">Loading...</div></div>;

  if (!session) {
    return (
      <div className={`tn-tv ${className}`}>
        {/* THE WAITING SCREEN IS THE ONE THAT IS UP WHILE PEOPLE ARRIVE, which
            makes it the likeliest thing in the house to be scanned. The phone
            page reads the NIGHT rather than this pack's session, so it has the
            RSVP list and the crew's record to show even though there is nothing
            on the table yet. */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="tn-tv__brand">{brand}</div>
          <TvQr eventId={eventId} size={TV_QR_MIN} />
        </div>
        <p className="tn-tv__muted" style={{ fontSize: "3vmin", marginTop: "2vmin" }}>{waitingHint}</p>
        <div className="tn-tv__back"><BackButton className="tn-textbtn" /></div>
      </div>
    );
  }

  const { last } = session.summary;
  // THE DENSITY LADDER, shared by Board Game and Card Table because they share
  // this component (see titlenight-tv-band.ts and the [data-tnband] blocks in
  // titlenight.css). Neither pack fitted a 1080p television at twelve players.
  // The two panels sit side by side, so the band takes the LARGER of them.
  const band = titleNightTvBand({
    players: session.summary.players.length,
    lastLines: last?.lines.length ?? 0,
  });

  return (
    <div className={`tn-tv ${className}`} data-tnband={band}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="tn-tv__brand">{brand}</div>
        <div className="tn-tv__muted tn-tv__meta">
          {session.games.length} game{session.games.length === 1 ? "" : "s"} &middot; {session.summary.titles.length} title{session.summary.titles.length === 1 ? "" : "s"}
        </div>
        <TvQr eventId={eventId} size={TV_QR_MIN} />
      </div>

      <div style={{ marginTop: "2vmin" }}>
        <div className="tn-tv__label">{session.nowPlaying ? "On the table" : "Between games"}</div>
        {session.nowPlaying ? (
          <div className="tn-tv__title">{session.nowPlaying}</div>
        ) : (
          <div className="tn-tv__title tn-tv__title--idle">
            {last ? `Last up: ${last.title}` : copy.tvIdleHint}
          </div>
        )}
      </div>

      <div className="tn-tv__grid">
        <div className="tn-tv__panel">
          <h3>Tonight</h3>
          {session.summary.players.length === 0 && <div className="tn-tv__muted">No games yet</div>}
          {session.summary.players.map((p) => (
            <div className="tn-tv__line" key={p.playerId}>
              <span>{p.name}</span>
              <span>
                {p.wins}W <span className="tn-tv__muted">/ {p.games} &middot; avg {avg(p.avgPlacement)}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="tn-tv__panel">
          <h3>{last ? last.title : "Last game"}</h3>
          {!last && <div className="tn-tv__muted">Nothing recorded yet</div>}
          {last?.lines.map((l, i) => (
            <div className="tn-tv__line" key={`${l.name}-${i}`}>
              <span><span className="tn-tv__rank">{l.placement}</span> {l.name}</span>
              {l.score !== null && <span className="tn-tv__muted">{l.score}</span>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "3vmin" }}><BackButton className="tn-textbtn" /></div>
    </div>
  );
}

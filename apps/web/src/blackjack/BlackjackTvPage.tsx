import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  SESSION_PACKS,
  formatCents,
  formatCentsShort,
  formatCentsSigned,
  type BjSummary,
} from "@gamenight/shared";
import { api } from "../api";
import BackButton from "../BackButton";
import { usePackLive } from "../useLiveUpdates";
import "./blackjack.css";

// THE LIVE MONEY BOARD.
//
// This is the best thing the casino group puts on a TV, so it gets the room:
// one line per player, sorted by net, big numbers, green for up and red for
// down, and it moves on every buy-in, rebuy and cash-out because the server
// broadcasts all three.
//
// BUILT TO BE REUSED, NOT YET EXTRACTED. Roulette, craps and poker all want
// this board with their own colours, and every colour here comes from a token
// declared once in blackjack.css (--bj-up / --bj-down / --bj-accent). A later
// pack copies this file and re-points those tokens. It is deliberately NOT a
// shared component yet: roulette is the first real evidence of what
// generalises, and extracting on one example is how a "shared" component ends
// up with four boolean props.
//
// Route param on /blackjack/tv/:eventId, or a prop when the event TV route
// renders this view in place. See SmashTvPage for the why.

type TvSession = {
  status: string;
  bank: "player" | "casino";
  tracker: boolean;
  summary: BjSummary;
};

export default function BlackjackTvPage({ eventId: propEventId }: { eventId?: string }) {
  const params = useParams();
  const eventId = propEventId ?? params.eventId ?? "";
  const [session, setSession] = useState<TvSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refetch() {
    const r = await api<{ session: TvSession | null }>(`/api/tv/${SESSION_PACKS.blackjack.route}/${eventId}`).catch(
      () => ({ session: null }),
    );
    setSession(r.session);
  }
  useEffect(() => {
    refetch().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  usePackLive(SESSION_PACKS.blackjack.wsType, eventId, refetch);

  if (!loaded) {
    return (
      <div className="bj-tv">
        <div className="bj-tv__brand">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="bj-tv">
        <div className="bj-tv__brand">
          Black<em>jack</em>
        </div>
        <p className="bj-tv__muted" style={{ fontSize: "3vmin", marginTop: "2vmin" }}>
          Waiting for the host to open the table.
        </p>
        <div style={{ marginTop: "3vmin" }}>
          <BackButton className="bj-textbtn" />
        </div>
      </div>
    );
  }

  const s = session.summary;
  // Everyone who has a net is ranked; those still holding chips sit under
  // them, because "in for $40" is not a position on a leaderboard.
  const ranked = s.players.filter((p) => p.net !== null);
  const playing = s.players.filter((p) => p.net === null);

  return (
    <div className="bj-tv">
      <div className="bj-tv__head">
        <div className="bj-tv__brand">
          Black<em>jack</em>
        </div>
        <div className="bj-tv__muted" style={{ fontSize: "2.4vmin" }}>
          {s.bank === "player" ? "player banked" : "casino banked"} · {s.players.length} at the table
          {s.stillIn > 0 && ` · ${s.stillIn} still in`}
          {session.tracker && s.hands > 0 && ` · ${s.hands} hands`}
        </div>
      </div>

      {s.warning && <div className="bj-tv__warn">⚠️ {s.warning}</div>}

      <div className="bj-tv__board">
        {s.players.length === 0 && <div className="bj-tv__muted" style={{ fontSize: "3vmin" }}>Nobody at the table yet.</div>}
        {ranked.map((p, i) => (
          <div className={`bj-tv__line ${i === 0 && (p.net ?? 0) > 0 ? "bj-tv__line--lead" : ""}`} key={p.playerId}>
            <span className="bj-tv__rank">{p.placement ?? i + 1}</span>
            <span style={{ minWidth: 0 }}>
              <span className="bj-tv__nm">
                {p.name}
                {p.isBanker && " 🏦"}
              </span>
              <div className="bj-tv__meta">
                in {formatCentsShort(p.totalIn)}
                {p.rebuys > 0 && ` · ${p.rebuys} rebuy${p.rebuys === 1 ? "" : "s"}`}
                {p.cashedOut && p.cashOut !== null && ` · out ${formatCentsShort(p.cashOut)}`}
                {p.derived && " · the bank"}
                {p.detail.blackjacks ? ` · ${p.detail.blackjacks} blackjack${p.detail.blackjacks === 1 ? "" : "s"}` : ""}
              </div>
            </span>
            <span
              className={`bj-tv__net ${
                (p.net ?? 0) > 0 ? "bj-tv__net--up" : (p.net ?? 0) < 0 ? "bj-tv__net--down" : "bj-tv__net--even"
              }`}
            >
              {formatCentsSigned(p.net ?? 0)}
            </span>
          </div>
        ))}

        {playing.map((p) => (
          <div className="bj-tv__line bj-tv__line--out" key={p.playerId}>
            <span className="bj-tv__rank">·</span>
            <span style={{ minWidth: 0 }}>
              <span className="bj-tv__nm">
                {p.name}
                {p.isBanker && " 🏦"}
              </span>
              <div className="bj-tv__meta">
                still playing
                {p.rebuys > 0 && ` · ${p.rebuys} rebuy${p.rebuys === 1 ? "" : "s"}`}
              </div>
            </span>
            <span className="bj-tv__net bj-tv__net--in">in {formatCentsShort(p.totalIn)}</span>
          </div>
        ))}
      </div>

      <div className="bj-tv__foot">
        <div className="bj-tv__stat">
          <b>{formatCents(s.totalIn)}</b>
          <span>bought in</span>
        </div>
        <div className="bj-tv__stat">
          <b>{formatCents(s.totalOut)}</b>
          <span>cashed out</span>
        </div>
        <div className="bj-tv__stat">
          <b>{formatCents(s.onTable)}</b>
          <span>on the table</span>
        </div>
        <div className="bj-tv__stat">
          <b>
            {s.cashedOut}/{s.players.length}
          </b>
          <span>settled up</span>
        </div>
      </div>

      <div style={{ marginTop: "3vmin" }}>
        <BackButton className="bj-textbtn" />
      </div>
    </div>
  );
}

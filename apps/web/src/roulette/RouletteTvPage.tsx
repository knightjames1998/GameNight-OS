import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SESSION_PACKS, betLabel, type RlSummary } from "@gamenight/shared";
import { api } from "../api";
import { usePackLive } from "../useLiveUpdates";
import { MoneyBoard, MoneyBoardWaiting } from "../casino/MoneyBoard";
import "./roulette.css";

// The roulette TV, and the whole argument for extracting the money board:
// this file is thirty lines of pack identity on top of the same board
// blackjack draws, rather than a second copy that would drift.
//
// Route param on /roulette/tv/:eventId, or a prop when the event TV route
// renders this view in place. See SmashTvPage for the why.

type TvSession = { status: string; tracker: boolean; summary: RlSummary };

const PACK = SESSION_PACKS.roulette;
const BRAND = (
  <>
    Rou<em>lette</em>
  </>
);

export default function RouletteTvPage({ eventId: propEventId }: { eventId?: string }) {
  const params = useParams();
  const eventId = propEventId ?? params.eventId ?? "";
  const [session, setSession] = useState<TvSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refetch() {
    const r = await api<{ session: TvSession | null }>(`/api/tv/${PACK.route}/${eventId}`).catch(() => ({
      session: null,
    }));
    setSession(r.session);
  }
  useEffect(() => {
    refetch().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  usePackLive(PACK.wsType, eventId, refetch);

  if (!loaded) return <MoneyBoardWaiting className="rl-tv" brand="Loading..." hint="" />;
  if (!session) {
    return <MoneyBoardWaiting className="rl-tv" brand={BRAND} hint="Waiting for the host to open the wheel." eventId={eventId} />;
  }

  return (
    <MoneyBoard
      eventId={eventId}
      summary={session.summary}
      className="rl-tv"
      brand={BRAND}
      meta={session.tracker && session.summary.events > 0 ? ` · ${session.summary.events} spins` : null}
      extraMeta={(p) => {
        const bits: string[] = [];
        // A streak of one is not a streak, so it is not worth a line on a TV.
        if (p.detail.bestStreak && p.detail.bestStreak >= 2) bits.push(`🔥${p.detail.bestStreak} in a row`);
        if (p.detail.favouriteBet) bits.push(`mostly ${betLabel(p.detail.favouriteBet).toLowerCase()}`);
        return bits.length ? ` · ${bits.join(" · ")}` : "";
      }}
      emptyHint="Nobody at the wheel yet."
    />
  );
}

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SESSION_PACKS, type BjSummary } from "@gamenight/shared";
import { api } from "../api";
import { usePackLive } from "../useLiveUpdates";
import { MoneyBoard, MoneyBoardWaiting } from "../casino/MoneyBoard";
import "./blackjack.css";

// The blackjack TV: the shared money board (../casino/MoneyBoard) with this
// pack's brand, its colours (set on .bj-tv) and one per-player subline tail.
//
// Route param on /blackjack/tv/:eventId, or a prop when the event TV route
// renders this view in place. See SmashTvPage for the why.

type TvSession = { status: string; tracker: boolean; summary: BjSummary };

const PACK = SESSION_PACKS.blackjack;
const BRAND = (
  <>
    Black<em>jack</em>
  </>
);

export default function BlackjackTvPage({ eventId: propEventId }: { eventId?: string }) {
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

  if (!loaded) return <MoneyBoardWaiting className="bj-tv" brand="Loading..." hint="" />;
  if (!session) {
    return (
      <MoneyBoardWaiting className="bj-tv" brand={BRAND} hint="Waiting for the host to open the table." eventId={eventId} />
    );
  }

  return (
    <MoneyBoard
      eventId={eventId}
      summary={session.summary}
      className="bj-tv"
      brand={BRAND}
      meta={session.tracker && session.summary.events > 0 ? ` · ${session.summary.events} hands` : null}
      extraMeta={(p) =>
        p.detail.blackjacks ? ` · ${p.detail.blackjacks} blackjack${p.detail.blackjacks === 1 ? "" : "s"}` : ""
      }
      emptyHint="Nobody at the table yet."
    />
  );
}

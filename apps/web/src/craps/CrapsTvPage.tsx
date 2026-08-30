import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SESSION_PACKS, type CrSummary } from "@gamenight/shared";
import { api } from "../api";
import { usePackLive } from "../useLiveUpdates";
import { MoneyBoard, MoneyBoardWaiting } from "../casino/MoneyBoard";
import "./craps.css";

// The craps TV: the shared money board, plus THE SHOOTER as a hero panel above
// it whenever the tracker is on. That panel is the single most watchable thing
// in this pack (a roll count climbing in real time, with the night's longest
// hand beside it as the number to beat), and it is why `MoneyBoard` grew a
// `hero` slot rather than craps forking the board.
//
// Route param on /craps/tv/:eventId, or a prop when the event TV route renders
// this view in place. See SmashTvPage for the why.

type TvSession = { status: string; tracker: boolean; summary: CrSummary };

const PACK = SESSION_PACKS.craps;
const BRAND = (
  <>
    Cr<em>aps</em>
  </>
);

export default function CrapsTvPage({ eventId: propEventId }: { eventId?: string }) {
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

  if (!loaded) return <MoneyBoardWaiting className="cr-tv" brand="Loading..." hint="" />;
  if (!session) {
    return <MoneyBoardWaiting className="cr-tv" brand={BRAND} hint="Waiting for the host to open the table." />;
  }

  const s = session.summary;
  const shooter = s.shooter;

  return (
    <MoneyBoard
      eventId={eventId}
      summary={s}
      className="cr-tv"
      brand={BRAND}
      meta={session.tracker && s.events > 0 ? ` · ${s.events} rolls` : null}
      hero={
        session.tracker && shooter ? (
          <div className="cg-tv__hero cg-tv__hero--live">
            <div>
              <div className="cg-tv__hero__l">On the dice</div>
              <div className="cg-tv__hero__who">{shooter.name}</div>
              <div className="cg-tv__hero__sub">
                {shooter.points > 0
                  ? `${shooter.points} point${shooter.points === 1 ? "" : "s"} made this hand`
                  : "come out roll"}
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div className="cg-tv__hero__l">Rolls</div>
              <div className="cg-tv__hero__n">{shooter.rolls}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div className="cg-tv__hero__l">To beat</div>
              <div className="cg-tv__hero__n">{s.longest ? s.longest.rolls : "–"}</div>
              <div className="cg-tv__hero__sub">{s.longest ? s.longest.name : "no hand finished"}</div>
            </div>
          </div>
        ) : null
      }
      extraMeta={(p) =>
        p.detail.longestRoll ? ` · best hand ${p.detail.longestRoll}` : ""
      }
      emptyHint="Nobody at the table yet."
    />
  );
}

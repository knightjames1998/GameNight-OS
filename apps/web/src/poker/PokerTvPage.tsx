import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SESSION_PACKS, money, type CashTransfer, type PokerSummary } from "@gamenight/shared";
import { api } from "../api";
import { usePackLive } from "../useLiveUpdates";
import { MoneyBoard, MoneyBoardWaiting } from "../casino/MoneyBoard";
import { settlementState } from "./Settlement";
import "./poker.css";

// The poker TV: the shared money board (../casino/MoneyBoard) with this pack's
// brand, its oxblood, and the SETTLEMENT in the hero slot.
//
// THE SETTLEMENT IS THE HERO, which is the same call craps makes with its
// shooter: a pack's most watchable thing goes above the board. For poker that is
// not the standings, it is whether the night adds up and who owes whom, and it
// is the thing everybody in the room turns to look at once the last stack is
// counted. The room reads it off the wall instead of four people crowding one
// phone.
//
// IT COMPUTES NOTHING. `transfers` arrives already derived on the payload, and
// the determinism rule in settleTransfers is what lets a phone and a television
// show the same list rather than two greedy answers to the same table.
//
// Route param on /poker/tv/:eventId, or a prop when the event TV route renders
// this view in place. See SmashTvPage for the why.

type TvSession = {
  status: string;
  summary: PokerSummary;
  variants: { variant: string; games: number }[];
  transfers: CashTransfer[] | null;
};

const PACK = SESSION_PACKS.poker;
const BRAND = (
  <>
    Po<em>ker</em>
  </>
);

export default function PokerTvPage({ eventId: propEventId }: { eventId?: string }) {
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

  if (!loaded) return <MoneyBoardWaiting className="pk-tv" brand="Loading..." hint="" />;
  if (!session) {
    return <MoneyBoardWaiting className="pk-tv" brand={BRAND} hint="Waiting for the host to open the table." />;
  }

  const { summary, transfers } = session;
  const m = money(summary.stakes);
  const { tone, headline } = settlementState(summary.balance, summary.stillIn);
  const nameOf = (id: string) => summary.players.find((p) => p.playerId === id)?.name ?? "somebody";

  // WHAT THE SETTLEMENT BAND COSTS THE LADDER, in board lines, because this hero
  // GROWS with the table where craps' shooter panel is a fixed two.
  //
  // Payment rows are 2.1vmin against a board line's much taller box, so they are
  // counted at ROUGHLY TWO TO A LINE rather than one for one; the headline is the
  // remaining whole line. That halving is measured rather than assumed: costing
  // them one for one puts a four-seat table on `tight` when tv-fit says it fits
  // on `close`, which would shrink a board that had room for no reason.
  const shownRows = Math.min(transfers?.length ?? 0, 4) + ((transfers?.length ?? 0) > 4 ? 1 : 0);
  const heroLines = 1 + Math.floor(shownRows / 2);

  return (
    <MoneyBoard
      summary={summary}
      className="pk-tv"
      brand={BRAND}
      // The variants ride the HEADER rather than the settlement band: the header
      // is a line that exists either way, so putting them there costs no height,
      // and the band is on the fit budget.
      meta={
        session.variants.length > 0
          ? ` · ${session.variants.map((v) => `${v.variant} x${v.games}`).join(", ")}`
          : summary.events > 0
            ? ` · ${summary.events} games`
            : null
      }
      heroLines={heroLines}
      hero={
        <div className="pk-tv__settle">
          <div
            className={
              tone === "square"
                ? "pk-tv__state pk-tv__state--square"
                : tone === "off"
                  ? "pk-tv__state pk-tv__state--off"
                  : "pk-tv__state"
            }
          >
            {headline}
          </div>
          {/* CAPPED AT FOUR ROWS, and the cap is a MEASURED fit budget rather
              than a design choice. This band is the pack's `hero`, so it spends
              the same 1080px the board does, and a greedy settlement of a
              twelve-hander runs to eleven payments. Four was six until
              scripts/tv-fit.mjs was pointed at it and the four-seat case came
              back 35px over; the rest are on the phone already in somebody's
              hand. Do not raise it without re-running that harness. */}
          {transfers?.slice(0, 4).map((t, i) => (
            <div className="pk-tv__pay" key={`${t.fromId}-${t.toId}-${i}`}>
              <span>
                {nameOf(t.fromId)} &rarr; {nameOf(t.toId)}
              </span>
              <b>{m.fmt(t.cents)}</b>
            </div>
          ))}
          {transfers && transfers.length > 4 && (
            <div className="pk-tv__pay">
              <span>and {transfers.length - 4} more on the host&apos;s phone</span>
            </div>
          )}
        </div>
      }
      extraMeta={(p) => (p.detail.dealt ? ` · dealt ${p.detail.dealt}` : "")}
      emptyHint="Nobody at the table yet."
    />
  );
}

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SESSION_PACKS, money, type CrunSummary } from "@gamenight/shared";
import { api } from "../api";
import { usePackLive } from "../useLiveUpdates";
import BackButton from "../BackButton";
import { StakesBadge } from "../casino/money";
import { ModifierWall } from "../casino/modifiers";
import TvQr, { TV_QR_MIN } from "../TvQr";
import "../casino/casino.css";
import "./casinorun.css";

// The Casino Run TV.
//
// THE BANK IS THE VIEW. Every other casino pack's TV is a per-player board;
// this one has no per-player anything, so the one number the whole room is
// watching gets the whole screen at 19vmin, which is more than three times the
// money board's biggest figure and readable from a sofa without trying.
// Underneath it: the quota it is chasing and how far off it is, the stage
// ladder, the cards that are live, and whose leg is in progress at what.
//
// Route param on /casinorun/tv/:eventId, or a prop when the event TV route
// renders this view in place. See SmashTvPage for the why.

type TvSession = { status: string; summary: CrunSummary };

const PACK = SESSION_PACKS.casinorun;
const BRAND = (
  <>
    Casino<em>Run</em>
  </>
);

export default function CasinoRunTvPage({ eventId: propEventId }: { eventId?: string }) {
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

  if (!loaded) return <Waiting hint="" brand="Loading..." />;
  if (!session) return <Waiting brand={BRAND} hint="Waiting for the host to open the run." eventId={eventId} />;

  const s = session.summary;
  const m = money(s.stakes);
  const tone = s.bank > s.startingBank ? "up" : s.bank < s.startingBank ? "down" : "even";
  const progress =
    s.quota > s.startingBank
      ? Math.max(0, Math.min(1, (s.bank - s.startingBank) / (s.quota - s.startingBank)))
      : 1;
  // The last leg is what is happening right now, as far as a TV can tell.
  const last = s.legs[s.legs.length - 1];
  const lastWho = last?.playerId
    ? s.players.find((p) => p.playerId === last.playerId)?.name
    : last
    ? "the table"
    : null;

  return (
    <div className="cg-tv crun-tv">
      <div className="cg-tv__head">
        <div className="cg-tv__brand">{BRAND}</div>
        <div className="cg-tv__muted" style={{ fontSize: "2.4vmin" }}>
          <StakesBadge stakes={s.stakes} />
          {s.stakes === "play" && " "}
          {s.ladder.name} &middot; {s.players.length} running it
          {s.missed > 0 && ` · ${s.missed} stage${s.missed === 1 ? "" : "s"} missed`}
        </div>
        <TvQr eventId={eventId} size={TV_QR_MIN} />
      </div>

      <div className="crun-tv__bank">
        <div className="crun-tv__bank__l">The bank</div>
        <div className={`crun-tv__bank__n crun-tv__bank__n--${tone}`}>{m.fmt(s.bank)}</div>
        {s.status === "running" ? (
          <>
            <div className="crun-tv__quota">
              Stage {s.stage + 1} of {s.ladder.stages} &middot; needs <b>{m.fmt(s.quota)}</b> &middot;{" "}
              {m.fmt(s.toGo)} to go
            </div>
            {/* Attempts and the ante share ONE line. They had a row each and
                that pushed the footer 23px off a 1080p screen. The money
                board's lesson, relearned: adding to a TV means re-measuring
                it, because rendering and fitting are different questions. */}
            <div className="crun-tv__quota" style={{ fontSize: "2.6vmin" }}>
              attempt {s.attempt} of {s.ladder.attemptsPerStage} &middot; {s.legsLeft} leg
              {s.legsLeft === 1 ? "" : "s"} left &middot; min ante{" "}
              <span className={s.ante.raises > 0 ? "crun-tv__ante--up" : undefined}>
                {m.fmt(s.ante.amount)}
              </span>
              {s.ante.everyone && " (everyone)"}
            </div>
          </>
        ) : (
          <div className={`crun-tv__verdict crun-tv__verdict--${s.status === "cleared" ? "cleared" : "bust"}`}>
            {s.status === "cleared"
              ? "RUN CLEARED"
              : s.ending === "attempts"
              ? "OUT OF ATTEMPTS"
              : "BUST"}
          </div>
        )}
      </div>

      <div className="crun-tv__bar">
        <div
          className={`crun-tv__bar__fill ${s.status === "bust" ? "crun-tv__bar__fill--bust" : ""}`}
          style={{ width: `${Math.round((s.status === "bust" ? 100 : progress * 100))}%` }}
        />
      </div>

      <div className="crun-tv__stages">
        {s.stages.map((st) => (
          <div
            key={st.index}
            className={`crun-tv__stage ${st.cleared ? "crun-tv__stage--done" : ""} ${
              s.status === "running" && st.index === s.stage ? "crun-tv__stage--live" : ""
            }`}
          >
            <div className="crun-tv__stage__n">{st.cleared ? "✓" : `Stage ${st.index + 1}`}</div>
            <div className="crun-tv__stage__q">{m.short(st.quota)}</div>
          </div>
        ))}
      </div>

      {/* The TV dims the cards that are not live on the game of the last leg,
          so the room can see which rules are actually in play right now. */}
      <ModifierWall
        ids={s.modifiers}
        unit={s.ante.amount}
        stakes={s.stakes}
        unitLabel="ante"
        game={s.status === "running" ? last?.game : undefined}
      />

      {s.status === "running" && (
        <div className="crun-tv__now">
          {last ? (
            <>
              last leg <b>{lastWho}</b> at <b>{last.game}</b> for{" "}
              <b>{m.signed(last.delta)}</b> &middot; {s.legsLeft} leg
              {s.legsLeft === 1 ? "" : "s"} left this stage
            </>
          ) : (
            <>
              {m.fmt(s.startingBank)} on the table &middot; {s.ladder.legsPerStage} legs a stage
            </>
          )}
        </div>
      )}

      <div className="cg-tv__foot">
        <div className="cg-tv__stat">
          <b>{s.cleared}/{s.ladder.stages}</b>
          <span>stages cleared</span>
        </div>
        <div className="cg-tv__stat">
          <b>{m.fmt(s.peak)}</b>
          <span>highest</span>
        </div>
        <div className="cg-tv__stat">
          <b>{m.fmt(s.comeback)}</b>
          <span>best comeback</span>
        </div>
        <div className="cg-tv__stat">
          <b>{s.legs.filter((l) => l.kind !== "buy").length}</b>
          <span>legs played</span>
        </div>
      </div>

      <div style={{ marginTop: "3vmin" }}>
        <BackButton className="cg-textbtn" />
      </div>
    </div>
  );
}

function Waiting({ brand, hint, eventId }: {
  brand: React.ReactNode;
  hint: string;
  /**
   * Omitted on the LOADING flash, before this screen knows whether it has a
   * session at all: a code that appears for 200ms and vanishes is worse than
   * no code. MoneyBoardWaiting says the same thing for the four packs that
   * share it.
   */
  eventId?: string;
}) {
  return (
    <div className="cg-tv crun-tv">
      {/* THE WAITING SCREEN IS THE ONE THAT IS UP WHILE PEOPLE ARRIVE, which
          makes it the likeliest thing in the house to be scanned. The phone
          page reads the NIGHT rather than this pack's session, so it has the
          RSVP list and the crew's record to show even though there is nothing
          on the table yet. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="cg-tv__brand">{brand}</div>
        {eventId ? <TvQr eventId={eventId} size={TV_QR_MIN} /> : null}
      </div>
      <p className="cg-tv__muted" style={{ fontSize: "3vmin", marginTop: "2vmin" }}>{hint}</p>
      <div style={{ marginTop: "3vmin" }}>
        <BackButton className="cg-textbtn" />
      </div>
    </div>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import BackButton from "../BackButton";
import { usePackSession } from "../usePackSession";
import CasinoSetup from "../casino/CasinoSetup";
import { CasinoTable, type Call, type CashOutDetail } from "../casino/CasinoTable";
import { MoneyInput, StakesBadge } from "../casino/money";
import {
  ROULETTE_BETS,
  SESSION_PACKS,
  betLabel,
  money,
  type CashPlayerRow,
  type RlDetail,
  type RlSessionState,
  type RlSummary,
} from "@gamenight/shared";
import "./roulette.css";

// The roulette pack page, and the proof the casino group works: everything
// about MONEY is the shared casino screens (../casino), so what is written
// here is the copy, one dropdown on the cash-out form, and a per-spin tracker.
// Compare its length with BlackjackPage.

type Session = RlSessionState & {
  status: "setup" | "live" | "completed";
  groupId: string;
  summary: RlSummary;
};

const PACK = SESSION_PACKS.roulette;

/**
 * The cash-out form asks for the favourite bet ONLY.
 *
 * There is deliberately no box for the winning streak: it is the one stat in
 * this group that genuinely cannot be reconstructed after the fact, so it
 * comes from the tracker or it stays absent. Offering somewhere to type it
 * would just invite a guess into the ledger.
 */
type Detail = { favouriteBet: string | null };

const cashOutDetail: CashOutDetail<Detail, RlDetail> = {
  initial: (p) => ({ favouriteBet: p.detail.favouriteBet }),
  label: (p) =>
    p.events > 0
      ? `From the tracker (${p.events} spin${p.events === 1 ? "" : "s"}) — edit if it's off`
      : "Optional, if anyone remembers",
  render: (d, set, p) => (
    <>
      <div className="cg-sub2" style={{ marginTop: 6 }}>What were they mostly on?</div>
      <div className="cg-seg">
        <button className={d.favouriteBet === null ? "on" : ""} onClick={() => set({ favouriteBet: null })}>
          Not sure
        </button>
        {ROULETTE_BETS.map((b) => (
          <button
            key={b.id}
            className={d.favouriteBet === b.id ? "on" : ""}
            onClick={() => set({ favouriteBet: b.id })}
          >
            {b.label}
          </button>
        ))}
      </div>
      {p.detail.bestStreak != null && (
        <p className="cg-hint" style={{ marginTop: 8 }}>
          Best run tonight: {p.detail.bestStreak} spin{p.detail.bestStreak === 1 ? "" : "s"} in a row.
          The tracker worked that out; there is nothing to type.
        </p>
      )}
    </>
  ),
};

export default function RoulettePage() {
  const eventId = new URLSearchParams(window.location.search).get("event") ?? "";
  const { ctx, session, loading, busy, err, call, startSession } = usePackSession<Session>({
    pack: PACK.route,
    wsType: PACK.wsType,
    eventId,
    replacePrompt:
      "A session is already in progress on this event. Replace it? Every buy-in and cash-out on the current wheel is lost, and nothing from it is recorded.",
  });

  if (!eventId) {
    return (
      <div className="cg-root rl-root">
        <div className="cg-wrap">
          <p className="cg-hint">No event specified.</p>
          <BackButton />
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="cg-root rl-root">
        <div className="cg-wrap">
          <p className="cg-hint">Loading...</p>
        </div>
      </div>
    );
  }

  const at = (p: string) => `/api/${PACK.route}/${eventId}/${p}`;

  return (
    <div className="cg-root rl-root">
      <div className="cg-wrap">
        <div className="cg-top">
          <BackButton className="cg-textbtn" />
          <Link to={`/e/${eventId}/tv`} className="cg-textbtn">
            📺 TV
          </Link>
        </div>
        <div>
          <div className="cg-brand">
            Rou<em>lette</em>
          </div>
          <div className="cg-sub">
            Cash game &middot; buy-ins, rebuys, cash-outs
            {session && session.status !== "completed" && (
              <>
                {" "}
                <StakesBadge stakes={session.summary.stakes} />
              </>
            )}
          </div>
        </div>

        {err && <p className="cg-err">{err}</p>}

        {!session || session.status === "completed" ? (
          <CasinoSetup
            ctx={ctx}
            completed={session?.status === "completed"}
            finished={session?.status === "completed" ? session.summary : null}
            busy={busy}
            onStart={startSession}
            copy={{
              noun: "the wheel",
              trackerHint:
                "Off by default. On, you log each spin's bet and whether it came in, which is the ONLY way to know anyone's winning streak — nobody remembers that honestly at 1am. Off, you can still type each player's favourite bet on the cash-out form.",
              waitingHint:
                "The crew owner or an admin opens the wheel. This screen updates live the moment they do.",
            }}
          />
        ) : (
          <CasinoTable<Detail, RlDetail>
            summary={session.summary}
            ctx={ctx}
            tracker={session.tracker}
            openScoring={session.openScoring}
            busy={busy}
            call={call}
            at={at}
            copy={{ noun: "the wheel", events: "spins" }}
            detail={cashOutDetail}
            trackerPanel={<SpinTracker session={session} busy={busy} call={call} at={at} />}
          />
        )}
      </div>
    </div>
  );
}

// ---------- the opt-in per-spin tracker ----------

function SpinTracker({
  session,
  busy,
  call,
  at,
}: {
  session: Session;
  busy: boolean;
  call: Call;
  at: (p: string) => string;
}) {
  const live = session.summary.players.filter((p) => !p.cashedOut);
  const [playerId, setPlayerId] = useState(live[0]?.playerId ?? "");
  const [bet, setBet] = useState<string>(ROULETTE_BETS[0]!.id);
  const [stake, setStake] = useState<number | null>(null);
  const chosen = live.some((p) => p.playerId === playerId) ? playerId : live[0]?.playerId ?? "";
  const def = ROULETTE_BETS.find((b) => b.id === bet);
  const m = money(session.summary.stakes);

  const record = (won: boolean) => {
    void call(at("spin"), { playerId: chosen, bet, stake, won });
    setStake(null);
  };

  return (
    <div className="cg-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="cg-h" style={{ margin: 0 }}>Live tracker</div>
        <span className="cg-hint">{session.summary.events} spins</span>
      </div>
      <p className="cg-hint" style={{ marginTop: 4 }}>
        Pick who, pick the bet, type the stake, tap whether it came in. Feeds the winning streak —
        which nothing else can — and the favourite bet. It never touches the money, which comes
        from buy-ins and cash-outs alone.
      </p>

      <div className="cg-lab" style={{ marginTop: 12 }}>Player</div>
      <div className="cg-seg">
        {live.map((p: CashPlayerRow<RlDetail>) => (
          <button key={p.playerId} className={chosen === p.playerId ? "on" : ""} onClick={() => setPlayerId(p.playerId)}>
            {p.name}
            {p.detail.bestStreak ? ` 🔥${p.detail.bestStreak}` : ""}
          </button>
        ))}
      </div>
      {live.length === 0 && <p className="cg-hint">Everyone has cashed out.</p>}

      <div className="cg-lab" style={{ marginTop: 12 }}>Bet</div>
      <div className="cg-seg">
        {ROULETTE_BETS.map((b) => (
          <button key={b.id} className={bet === b.id ? "on" : ""} onClick={() => setBet(b.id)}>
            {b.label}
          </button>
        ))}
      </div>

      <div className="cg-lab" style={{ marginTop: 12 }}>Stake</div>
      <MoneyInput value={stake} onChange={setStake} ariaLabel="Spin stake" />
      {def && stake !== null && stake > 0 && (
        <p className="cg-hint" style={{ marginTop: 6 }}>
          {betLabel(bet)} pays {def.to1}:1, so that comes in for {m.fmt(stake * def.to1)}.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          className="cg-btn cg-btn--go"
          disabled={busy || !chosen || stake === null}
          onClick={() => record(true)}
        >
          Came in
        </button>
        <button
          className="cg-btn cg-btn--ghost"
          disabled={busy || !chosen || stake === null}
          onClick={() => record(false)}
        >
          Missed
        </button>
      </div>

      {session.summary.events > 0 && (
        <button className="cg-textbtn" style={{ marginTop: 8 }} disabled={busy} onClick={() => call(at("undo-spin"))}>
          ↶ Undo last spin
        </button>
      )}
    </div>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import BackButton from "../BackButton";
import { usePackSession } from "../usePackSession";
import CasinoSetup from "../casino/CasinoSetup";
import { CasinoTable, type Call, type CashOutDetail } from "../casino/CasinoTable";
import { CountInput, MoneyInput, StakesBadge } from "../casino/money";
import {
  SESSION_PACKS,
  money,
  type BjDetail,
  type BjHandResult,
  type BjSessionState,
  type BjSummary,
  type CashPlayerRow,
} from "@gamenight/shared";
import "./blackjack.css";

// The blackjack pack page.
//
// Almost all of it is the shared casino screens (../casino), because a cash
// game's SCREEN is about money and the money is identical across the group.
// What is written here is what is actually blackjack: the copy, the three
// detail fields on the cash-out form, and the per-hand tracker.

type Session = BjSessionState & {
  status: "setup" | "live" | "completed";
  groupId: string;
  summary: BjSummary;
};

const PACK = SESSION_PACKS.blackjack;

/** The three details, as the cash-out form collects them. */
type Detail = { biggestBet: number | null; biggestWin: number | null; blackjacks: number | null };

const cashOutDetail: CashOutDetail<Detail, BjDetail> = {
  initial: (p) => ({ ...p.detail }),
  label: (p) =>
    p.events > 0
      ? `From the tracker (${p.events} hand${p.events === 1 ? "" : "s"}) — edit if it's off`
      : "Optional, if anyone remembers",
  render: (d, set) => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 6 }}>
      <div>
        <div className="cg-sub2">Biggest bet</div>
        <MoneyInput value={d.biggestBet} onChange={(v) => set({ ...d, biggestBet: v })} small ariaLabel="Biggest bet" />
      </div>
      <div>
        <div className="cg-sub2">Biggest win</div>
        <MoneyInput value={d.biggestWin} onChange={(v) => set({ ...d, biggestWin: v })} small ariaLabel="Biggest win" />
      </div>
      <div>
        <div className="cg-sub2">Blackjacks</div>
        <CountInput value={d.blackjacks} onChange={(v) => set({ ...d, blackjacks: v })} ariaLabel="Blackjacks hit" />
      </div>
    </div>
  ),
};

export default function BlackjackPage() {
  const eventId = new URLSearchParams(window.location.search).get("event") ?? "";
  const { ctx, session, loading, busy, err, call, startSession } = usePackSession<Session>({
    pack: PACK.route,
    wsType: PACK.wsType,
    eventId,
    replacePrompt:
      "A session is already in progress on this event. Replace it? Every buy-in and cash-out on the current table is lost, and nothing from it is recorded.",
  });

  if (!eventId) {
    return (
      <div className="cg-root bj-root">
        <div className="cg-wrap">
          <p className="cg-hint">No event specified.</p>
          <BackButton />
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="cg-root bj-root">
        <div className="cg-wrap">
          <p className="cg-hint">Loading...</p>
        </div>
      </div>
    );
  }

  const at = (p: string) => `/api/${PACK.route}/${eventId}/${p}`;

  return (
    <div className="cg-root bj-root">
      <div className="cg-wrap">
        <div className="cg-top">
          <BackButton className="cg-textbtn" />
          {/* The NIGHT's TV address, not this pack's: the big screen follows
              whatever is being played (see SmashPage). */}
          <Link to={`/e/${eventId}/tv`} className="cg-textbtn">
            📺 TV
          </Link>
        </div>
        <div>
          <div className="cg-brand">
            Black<em>jack</em>
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
            ledger={PACK.ledger}
            onStart={startSession}
            copy={{
              noun: "the table",
              trackerHint:
                "Off by default. On, you log each hand's bet and result, and biggest bet, biggest win and blackjacks fill themselves in. Off, you type those three on the cash-out form instead — nothing is lost either way.",
              waitingHint:
                "The crew owner or an admin opens the table. This screen updates live the moment they do.",
            }}
          />
        ) : (
          <CasinoTable<Detail, BjDetail>
            summary={session.summary}
            ctx={ctx}
            tracker={session.tracker}
            openScoring={session.openScoring}
            busy={busy}
            call={call}
            at={at}
            copy={{ noun: "the table", events: "hands" }}
            detail={cashOutDetail}
            trackerPanel={<HandTracker session={session} busy={busy} call={call} at={at} />}
          />
        )}
      </div>
    </div>
  );
}

// ---------- the opt-in per-hand tracker ----------

const RESULTS: { key: BjHandResult; label: string }[] = [
  { key: "win", label: "Won" },
  { key: "lose", label: "Lost" },
  { key: "push", label: "Push" },
  { key: "blackjack", label: "Blackjack!" },
];

function HandTracker({
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
  const [bet, setBet] = useState<number | null>(null);
  const chosen = live.some((p) => p.playerId === playerId) ? playerId : live[0]?.playerId ?? "";
  const m = money(session.summary.stakes);

  return (
    <div className="cg-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="cg-h" style={{ margin: 0 }}>Live tracker</div>
        <span className="cg-hint">{session.summary.events} hands</span>
      </div>
      <p className="cg-hint" style={{ marginTop: 4 }}>
        Pick who, type the bet, tap how it went. Feeds biggest bet, biggest win and blackjacks; it
        never touches the money, which comes from buy-ins and cash-outs alone.
      </p>

      <div className="cg-lab" style={{ marginTop: 12 }}>Player</div>
      <div className="cg-seg">
        {live.map((p: CashPlayerRow<BjDetail>) => (
          <button key={p.playerId} className={chosen === p.playerId ? "on" : ""} onClick={() => setPlayerId(p.playerId)}>
            {p.name}
          </button>
        ))}
      </div>
      {live.length === 0 && <p className="cg-hint">Everyone has cashed out.</p>}

      <div className="cg-lab" style={{ marginTop: 12 }}>Bet</div>
      <MoneyInput value={bet} onChange={setBet} ariaLabel="Hand bet" />

      <div className="cg-seg" style={{ marginTop: 10 }}>
        {RESULTS.map((r) => (
          <button
            key={r.key}
            disabled={busy || !chosen || bet === null}
            onClick={() => {
              void call(at("hand"), { playerId: chosen, bet, result: r.key });
              setBet(null);
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
      {bet !== null && bet > 0 && (
        <p className="cg-hint" style={{ marginTop: 6 }}>
          A blackjack on {m.fmt(bet)} pays {m.fmt(Math.floor((bet * 3) / 2))}.
        </p>
      )}

      {session.summary.events > 0 && (
        <button className="cg-textbtn" style={{ marginTop: 8 }} disabled={busy} onClick={() => call(at("undo-hand"))}>
          ↶ Undo last hand
        </button>
      )}
    </div>
  );
}

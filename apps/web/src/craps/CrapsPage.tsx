import { Link } from "react-router-dom";
import BackButton from "../BackButton";
import { usePackSession } from "../usePackSession";
import CasinoSetup from "../casino/CasinoSetup";
import { CasinoTable, type Call, type CashOutDetail } from "../casino/CasinoTable";
import { CountInput, MoneyInput, StakesBadge } from "../casino/money";
import {
  SESSION_PACKS,
  type CrDetail,
  type CrSessionState,
  type CrSummary,
} from "@gamenight/shared";
import "./craps.css";

// The craps pack page. Third on the shared casino screens, so everything about
// money is ../casino and what is written here is the copy, four cash-out
// fields, and THE SHOOTER — the one idea this pack owns.

type Session = CrSessionState & {
  status: "setup" | "live" | "completed";
  groupId: string;
  summary: CrSummary;
};

const PACK = SESSION_PACKS.craps;

/**
 * Longest roll and points are typed here when the tracker was off, unlike
 * roulette's win streak which has no box at all. The difference is real: a
 * table argues about how long somebody held the dice and remembers it, whereas
 * nobody honestly recalls a run of winning spins. Biggest bet and biggest win
 * are typed-only in this pack, because its tracker follows the dice rather than
 * the betting.
 */
type Detail = {
  longestRoll: number | null;
  points: number | null;
  biggestBet: number | null;
  biggestWin: number | null;
};

const cashOutDetail: CashOutDetail<Detail, CrDetail> = {
  initial: (p) => ({ ...p.detail }),
  label: (p) =>
    p.events > 0
      ? `From the tracker (${p.events} tap${p.events === 1 ? "" : "s"}) — edit if it's off`
      : "Optional, if anyone remembers",
  render: (d, set) => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
      <div>
        <div className="cg-sub2">Longest roll</div>
        <CountInput value={d.longestRoll} onChange={(v) => set({ ...d, longestRoll: v })} ariaLabel="Longest roll" />
      </div>
      <div>
        <div className="cg-sub2">Points made</div>
        <CountInput value={d.points} onChange={(v) => set({ ...d, points: v })} ariaLabel="Points made" />
      </div>
      <div>
        <div className="cg-sub2">Biggest bet</div>
        <MoneyInput value={d.biggestBet} onChange={(v) => set({ ...d, biggestBet: v })} small ariaLabel="Biggest bet" />
      </div>
      <div>
        <div className="cg-sub2">Biggest win</div>
        <MoneyInput value={d.biggestWin} onChange={(v) => set({ ...d, biggestWin: v })} small ariaLabel="Biggest win" />
      </div>
    </div>
  ),
};

export default function CrapsPage() {
  const eventId = new URLSearchParams(window.location.search).get("event") ?? "";
  const { ctx, session, loading, busy, err, call, startSession } = usePackSession<Session>({
    pack: PACK.route,
    wsType: PACK.wsType,
    eventId,
    replacePrompt:
      "A session is already in progress on this event. Replace it? Every buy-in, cash-out and hand on the current table is lost, and nothing from it is recorded.",
  });

  if (!eventId) {
    return (
      <div className="cg-root cr-root">
        <div className="cg-wrap">
          <p className="cg-hint">No event specified.</p>
          <BackButton />
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="cg-root cr-root">
        <div className="cg-wrap">
          <p className="cg-hint">Loading...</p>
        </div>
      </div>
    );
  }

  const at = (p: string) => `/api/${PACK.route}/${eventId}/${p}`;

  return (
    <div className="cg-root cr-root">
      <div className="cg-wrap">
        <div className="cg-top">
          <BackButton className="cg-textbtn" />
          <Link to={`/e/${eventId}/tv`} className="cg-textbtn">
            📺 TV
          </Link>
        </div>
        <div>
          <div className="cg-brand">
            Cr<em>aps</em>
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
                "Off by default. On, one tap per roll follows the shooter, and longest roll — the number everyone actually argues about — is worked out for you. Off, you type longest roll and points made on the cash-out form instead.",
              waitingHint:
                "The crew owner or an admin opens the table. This screen updates live the moment they do.",
            }}
          />
        ) : (
          <CasinoTable<Detail, CrDetail>
            summary={session.summary}
            ctx={ctx}
            tracker={session.tracker}
            openScoring={session.openScoring}
            busy={busy}
            call={call}
            at={at}
            copy={{ noun: "the table", events: "rolls" }}
            detail={cashOutDetail}
            trackerPanel={<ShooterTracker session={session} busy={busy} call={call} at={at} />}
          />
        )}
      </div>
    </div>
  );
}

// ---------- the opt-in shooter tracker ----------
//
// Three taps at the table plus handing the dice on. Everything else — the hand
// lengths, the record, who shoots next — is derived from the log, so this panel
// only has to send taps.

function ShooterTracker({
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
  const s = session.summary;
  const shooter = s.shooter;
  const live = s.players.filter((p) => !p.cashedOut);
  const tap = (kind: string) => call(at("tap"), { kind });

  return (
    <div className="cg-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="cg-h" style={{ margin: 0 }}>The shooter</div>
        <span className="cg-hint">
          {s.longest ? `longest tonight: ${s.longest.rolls} (${s.longest.name})` : "no hand finished yet"}
        </span>
      </div>

      {shooter ? (
        <>
          <div className="cr-shooter">
            <div className="cr-shooter__who">{shooter.name}</div>
            <div className="cr-shooter__n">{shooter.rolls}</div>
            <div className="cg-sub2">
              {shooter.rolls === 1 ? "roll" : "rolls"} this hand
              {shooter.points > 0 && ` · ${shooter.points} point${shooter.points === 1 ? "" : "s"} made`}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="cg-btn" disabled={busy} onClick={() => tap("roll")}>
              🎲 Roll
            </button>
            <button className="cg-btn cg-btn--go" disabled={busy} onClick={() => tap("point")}>
              Point made
            </button>
          </div>
          <button className="cg-btn cg-btn--ghost" style={{ marginTop: 8 }} disabled={busy} onClick={() => tap("sevenOut")}>
            Seven out — pass the dice
          </button>
          <p className="cg-hint" style={{ marginTop: 6 }}>
            A point made keeps the hand going. Seven out closes it at {shooter.rolls}{" "}
            {shooter.rolls === 1 ? "roll" : "rolls"} and passes the dice on.
          </p>
        </>
      ) : (
        <p className="cg-hint" style={{ marginTop: 6 }}>
          Nobody has the dice. Hand them to somebody below.
        </p>
      )}

      <div className="cg-lab" style={{ marginTop: 14 }}>Give the dice to</div>
      <div className="cg-seg">
        {live.map((p) => (
          <button
            key={p.playerId}
            className={shooter?.playerId === p.playerId ? "on" : ""}
            disabled={busy || shooter?.playerId === p.playerId}
            onClick={() => call(at("shooter"), { playerId: p.playerId })}
          >
            {p.name}
            {p.detail.longestRoll ? ` · best ${p.detail.longestRoll}` : ""}
          </button>
        ))}
      </div>
      {live.length === 0 && <p className="cg-hint">Everyone has cashed out.</p>}

      {s.events > 0 && (
        <button className="cg-textbtn" style={{ marginTop: 10 }} disabled={busy} onClick={() => call(at("undo-tap"))}>
          ↶ Undo last tap
        </button>
      )}
      <p className="cg-hint" style={{ marginTop: 4 }}>
        Undo takes back one tap, whatever it was — a seven-out reopens the hand and gives the dice
        back.
      </p>
    </div>
  );
}

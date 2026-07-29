import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import BackButton from "../BackButton";
import { usePackSession, type PackCtx as Ctx } from "../usePackSession";
import {
  SESSION_PACKS,
  formatCents,
  formatCentsShort,
  formatCentsSigned,
  parseCents,
  type BjSessionState,
  type BjSummary,
  type BjPlayerRow,
  type BjHandResult,
  type CashBank,
} from "@gamenight/shared";
import "./blackjack.css";

// The blackjack pack page: a cash game, so the screen is about MONEY rather
// than about results. Two interactions per player per night is the target
// (buy in at the start, cash out at the end) and everything else on this page
// is optional on top of that.
//
// EVERY AMOUNT HERE IS INTEGER CENTS, exactly as on the server. Typed text
// becomes cents through the shared parseCents the moment it leaves an input,
// and cents become text through formatCents the moment they reach the screen.
// Nothing in between is ever a dollar figure — see cashgame.ts for why.

type Session = BjSessionState & {
  status: "setup" | "live" | "completed";
  groupId: string;
  summary: BjSummary;
};

const PACK = SESSION_PACKS.blackjack;

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
      <div className="bj-root">
        <div className="bj-wrap">
          <p className="bj-hint">No event specified.</p>
          <BackButton />
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="bj-root">
        <div className="bj-wrap">
          <p className="bj-hint">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bj-root">
      <div className="bj-wrap">
        <div className="bj-top">
          <BackButton className="bj-textbtn" />
          {/* The NIGHT's TV address, not this pack's: the big screen follows
              whatever is being played (see SmashPage). */}
          <Link to={`/e/${eventId}/tv`} className="bj-textbtn">
            📺 TV
          </Link>
        </div>
        <div>
          <div className="bj-brand">
            Black<em>jack</em>
          </div>
          <div className="bj-sub">Cash game &middot; buy-ins, rebuys, cash-outs</div>
        </div>

        {err && <p className="bj-err">{err}</p>}

        {!session || session.status === "completed" ? (
          <SetupOrWaiting
            ctx={ctx}
            completed={session?.status === "completed"}
            finished={session?.status === "completed" ? session.summary : null}
            busy={busy}
            onStart={(p) => startSession(p)}
          />
        ) : (
          <LiveTable eventId={eventId} ctx={ctx} session={session} busy={busy} call={call} />
        )}
      </div>
    </div>
  );
}

// ---------- a money input, the only place dollars exist ----------

function MoneyInput({
  value,
  onChange,
  placeholder = "0.00",
  small,
  ariaLabel,
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  placeholder?: string;
  small?: boolean;
  ariaLabel?: string;
}) {
  // A local text draft so a half-typed "1." is not thrown away by a parse
  // that cannot make sense of it yet.
  const [draft, setDraft] = useState(value === null ? "" : (value / 100).toFixed(2));
  return (
    <input
      className={`bj-input ${small ? "bj-input--sm" : ""}`}
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => {
        const next = e.target.value.replace(/[^0-9.]/g, "").slice(0, 12);
        setDraft(next);
        onChange(parseCents(next));
      }}
    />
  );
}

/** A whole-number input for a count (blackjacks hit). */
function CountInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  return (
    <input
      className="bj-input bj-input--sm"
      inputMode="numeric"
      pattern="[0-9]*"
      aria-label={ariaLabel}
      placeholder="0"
      value={draft}
      onChange={(e) => {
        const next = e.target.value.replace(/\D/g, "").slice(0, 3);
        setDraft(next);
        onChange(next === "" ? null : Number(next));
      }}
    />
  );
}

// ---------- setup / waiting ----------

function SetupOrWaiting({
  ctx,
  completed,
  finished,
  busy,
  onStart,
}: {
  ctx: Ctx | null;
  completed: boolean;
  finished: BjSummary | null;
  busy: boolean;
  onStart: (p: Record<string, unknown>) => void;
}) {
  const [bank, setBank] = useState<CashBank>("player");
  const [bankerIndex, setBankerIndex] = useState(0);
  const [defaultBuyIn, setDefaultBuyIn] = useState<number | null>(2000);
  const [tracker, setTracker] = useState(false);
  const [roster, setRoster] = useState<{ userId: string | null; name: string }[]>([]);
  const [guest, setGuest] = useState("");

  useEffect(() => {
    if (ctx && roster.length === 0) setRoster(ctx.prefill.map((p) => ({ userId: p.userId, name: p.name })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  if (!ctx) return <p className="bj-hint" style={{ marginTop: 16 }}>Loading...</p>;

  if (!ctx.canHost) {
    return (
      <div className="bj-card" style={{ marginTop: 16 }}>
        <div className="bj-h">Waiting for the host</div>
        <p className="bj-hint">
          The crew owner or an admin opens the table. This screen updates live the moment they do.
        </p>
      </div>
    );
  }

  const addMember = (m: { userId: string; name: string }) => {
    if (!roster.some((r) => r.userId === m.userId)) setRoster([...roster, { userId: m.userId, name: m.name }]);
  };
  const addGuest = () => {
    const n = guest.trim().slice(0, 24);
    if (n) setRoster([...roster, { userId: null, name: n }]);
    setGuest("");
  };
  const removeAt = (i: number) => {
    setRoster(roster.filter((_, j) => j !== i));
    if (bankerIndex >= roster.length - 1) setBankerIndex(0);
  };
  const notAdded = ctx.members.filter((m) => !roster.some((r) => r.userId === m.userId));
  const minPlayers = bank === "player" ? 2 : 1;
  const ready = roster.length >= minPlayers && defaultBuyIn !== null;

  return (
    <>
      {completed && finished && <FinishedRecap summary={finished} />}

      <div className="bj-card" style={{ marginTop: 16 }}>
        <div className="bj-h">Who is banking?</div>
        <div className="bj-seg">
          <button className={bank === "player" ? "on" : ""} onClick={() => setBank("player")}>
            One of us
          </button>
          <button className={bank === "casino" ? "on" : ""} onClick={() => setBank("casino")}>
            A casino
          </button>
        </div>
        <p className="bj-hint" style={{ marginTop: 8 }}>
          {bank === "player"
            ? "A crew member is the house. Their net is worked out from everyone else's, never typed in, and the table has to add up to zero — if it doesn't, this screen says by how much."
            : "The house is a real casino, so nobody at the table is the banker and every net stands on its own. Nothing to balance."}
        </p>
      </div>

      <div className="bj-card">
        <div className="bj-h">Default buy-in</div>
        <MoneyInput value={defaultBuyIn} onChange={setDefaultBuyIn} ariaLabel="Default buy-in" />
        <p className="bj-hint" style={{ marginTop: 8 }}>
          What everyone starts on. You can change any individual buy-in later, and rebuy for a
          different amount.
          {bank === "player" &&
            " The banker's buy-in is the float they put up, so it is usually the biggest number on the table — fix theirs first."}
        </p>
      </div>

      <div className="bj-card">
        <div className="bj-h">At the table ({roster.length})</div>
        {roster.map((r, i) => (
          <div className="bj-row" key={`${r.userId ?? "g"}-${i}`}>
            <span className="bj-name" style={{ flex: 1, minWidth: 0 }}>
              {r.name}
            </span>
            {!r.userId && <span className="bj-pill bj-pill--guest">guest</span>}
            {bank === "player" && (
              <button
                className={`bj-pill ${bankerIndex === i ? "" : "bj-pill--guest"}`}
                onClick={() => setBankerIndex(i)}
                aria-pressed={bankerIndex === i}
              >
                {bankerIndex === i ? "banker" : "bank?"}
              </button>
            )}
            <button className="bj-textbtn" onClick={() => removeAt(i)}>
              remove
            </button>
          </div>
        ))}
        {roster.length === 0 && <p className="bj-hint">Add players from the crew or type a guest.</p>}

        {notAdded.length > 0 && (
          <>
            <div className="bj-lab" style={{ marginTop: 12 }}>Add from crew</div>
            <div className="bj-seg">
              {notAdded.map((m) => (
                <button key={m.userId} onClick={() => addMember(m)}>
                  + {m.name}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="bj-lab" style={{ marginTop: 12 }}>Add a guest</div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            className="bj-input"
            placeholder="Guest name"
            value={guest}
            onChange={(e) => setGuest(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addGuest()}
          />
          <button className="bj-btn bj-btn--ghost bj-btn--sm" onClick={addGuest}>
            Add
          </button>
        </div>
        <p className="bj-hint" style={{ marginTop: 8 }}>
          Guests play, but lifetime stats only count crew members. Anyone can sit down later.
        </p>
      </div>

      <div className="bj-card">
        <div className="bj-row" style={{ padding: 0 }}>
          <div style={{ flex: 1 }}>
            <div className="bj-h" style={{ margin: 0 }}>Live tracker</div>
            <p className="bj-hint" style={{ marginTop: 4 }}>
              Off by default. On, you log each hand's bet and result, and biggest bet, biggest win
              and blackjacks fill themselves in. Off, you type those three on the cash-out form
              instead — nothing is lost either way.
            </p>
          </div>
          <button
            className={`gn-toggle ${tracker ? "gn-toggle--on" : "gn-toggle--off"}`}
            aria-pressed={tracker}
            onClick={() => setTracker(!tracker)}
          >
            {tracker ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      <button
        className="bj-btn"
        style={{ marginTop: 12 }}
        disabled={busy || !ready}
        onClick={() =>
          onStart({
            bank,
            bankerIndex: bank === "player" ? bankerIndex : undefined,
            defaultBuyIn,
            tracker,
            roster,
          })
        }
      >
        {roster.length < minPlayers
          ? bank === "player"
            ? "Add the banker plus at least one player"
            : "Add at least 1 player"
          : defaultBuyIn === null
          ? "Set a default buy-in"
          : `Open the table · ${formatCentsShort(defaultBuyIn)} each`}
      </button>
    </>
  );
}

/** The night that just ended, so the host can see it before starting another. */
function FinishedRecap({ summary }: { summary: BjSummary }) {
  return (
    <div className="bj-card" style={{ marginTop: 16 }}>
      <div className="bj-h">That table is closed</div>
      {summary.players.map((p) => (
        <div className="bj-row" key={p.playerId}>
          <span className="bj-name" style={{ flex: 1, minWidth: 0 }}>
            {p.name}
            {p.isBanker && <span className="bj-pill" style={{ marginLeft: 6 }}>bank</span>}
          </span>
          <NetToken net={p.net} totalIn={p.totalIn} />
        </div>
      ))}
      <p className="bj-hint" style={{ marginTop: 10 }}>
        It's in the ledger. Set up another table below.
      </p>
    </div>
  );
}

// ---------- the money token, shared by every row on this page ----------

function NetToken({ net, totalIn }: { net: number | null; totalIn: number }) {
  if (net === null) {
    return <span className="bj-tok bj-tok--in">in {formatCentsShort(totalIn)}</span>;
  }
  const cls = net > 0 ? "bj-tok--up" : net < 0 ? "bj-tok--down" : "bj-tok--even";
  return <span className={`bj-tok ${cls}`}>{formatCentsSigned(net)}</span>;
}

// ---------- live table ----------

function LiveTable({
  eventId,
  ctx,
  session,
  busy,
  call,
}: {
  eventId: string;
  ctx: Ctx | null;
  session: Session;
  busy: boolean;
  call: (path: string, body?: unknown) => Promise<void>;
}) {
  const canHost = ctx?.canHost ?? false;
  const canScore = canHost || session.openScoring;
  const s = session.summary;
  const at = (p: string) => `/api/${PACK.route}/${eventId}/${p}`;
  const [cashingOut, setCashingOut] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const stillIn = useMemo(() => s.players.filter((p) => !p.cashedOut), [s.players]);

  function endSession() {
    // The balance warning is shown, then the host decides. The app records
    // what the night did; it does not referee it. What it must never do is
    // write numbers it already knows disagree WITHOUT saying so.
    if (s.balance.checked && !s.balance.balanced) {
      if (!window.confirm(`${s.warning}\n\nRecord the night anyway?`)) return;
      void call(at("complete"), { force: true });
      return;
    }
    if (s.stillIn > 0) {
      const names = stillIn.map((p) => p.name).join(", ");
      if (
        !window.confirm(
          `${s.stillIn} still at the table (${names}). Ending now records them as busting out for their whole buy-in. Carry on?`,
        )
      ) {
        return;
      }
    }
    void call(at("complete"));
  }

  return (
    <>
      {s.warning && <div className="bj-warn">⚠️ {s.warning}</div>}

      {/* The money board. Same shape as the TV view, deliberately: the host's
          phone and the big screen should never disagree about who is up. */}
      <div className="bj-card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="bj-h" style={{ margin: 0 }}>The table</div>
          <span className="bj-hint">
            {s.bank === "player" ? "one of us is banking" : "casino banked"}
          </span>
        </div>

        {s.players.map((p) => (
          <PlayerLine
            key={p.playerId}
            p={p}
            canScore={canScore}
            busy={busy}
            open={cashingOut === p.playerId}
            onToggleCashOut={() => setCashingOut(cashingOut === p.playerId ? null : p.playerId)}
            onRebuy={() => call(at("rebuy"), { playerId: p.playerId })}
            onUndoRebuy={() => call(at("undo-rebuy"), { playerId: p.playerId })}
            onReopen={() => call(at("reopen"), { playerId: p.playerId })}
            onBuyIn={(amount) => call(at("buy-in"), { playerId: p.playerId, amount })}
            onCashOut={(body) => {
              void call(at("cash-out"), { playerId: p.playerId, ...body });
              setCashingOut(null);
            }}
          />
        ))}

        <div className="bj-totals">
          <div className="bj-total">
            <div className="bj-total__n">{formatCents(s.totalIn)}</div>
            <div className="bj-total__l">bought in</div>
          </div>
          <div className="bj-total">
            <div className="bj-total__n">{formatCents(s.totalOut)}</div>
            <div className="bj-total__l">cashed out</div>
          </div>
          <div className="bj-total">
            <div className="bj-total__n">{formatCents(s.onTable)}</div>
            <div className="bj-total__l">on the table</div>
          </div>
        </div>
      </div>

      {session.tracker && canScore && <Tracker session={session} busy={busy} call={call} at={at} />}

      {canScore && (
        <div className="bj-card">
          {adding ? (
            <AddPlayer
              ctx={ctx}
              session={session}
              busy={busy}
              onAdd={(body) => {
                void call(at("add-player"), body);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button className="bj-btn bj-btn--ghost" onClick={() => setAdding(true)}>
              + Someone sat down
            </button>
          )}
        </div>
      )}

      {canHost && (
        <div className="bj-card">
          <div className="bj-h">Host controls</div>
          <div className="bj-row">
            <span style={{ flex: 1 }}>Live tracker (per-hand bets)</span>
            <button
              className={`gn-toggle ${session.tracker ? "gn-toggle--on" : "gn-toggle--off"}`}
              aria-pressed={session.tracker}
              onClick={() => call(at("tracker"), { on: !session.tracker })}
            >
              {session.tracker ? "ON" : "OFF"}
            </button>
          </div>
          <div className="bj-row">
            <span style={{ flex: 1 }}>Let members record the money</span>
            <button
              className={`gn-toggle ${session.openScoring ? "gn-toggle--on" : "gn-toggle--off"}`}
              aria-pressed={session.openScoring}
              onClick={() => call(at("open-scoring"), { open: !session.openScoring })}
            >
              {session.openScoring ? "ON" : "OFF"}
            </button>
          </div>
          <p className="bj-hint" style={{ marginTop: 6 }}>
            Turning the tracker off keeps every hand already logged — the details it worked out
            stay on the cash-out form.
          </p>
          <button className="bj-btn bj-btn--go" style={{ marginTop: 10 }} disabled={busy} onClick={endSession}>
            End the night &amp; record it
          </button>
          <p className="bj-hint" style={{ marginTop: 8 }}>
            One row per player goes into the ledger, placed by net. Nothing is recorded until you
            tap this.
          </p>
        </div>
      )}
    </>
  );
}

// ---------- one player's line, with its buy-in and cash-out controls ----------

function PlayerLine({
  p,
  canScore,
  busy,
  open,
  onToggleCashOut,
  onRebuy,
  onUndoRebuy,
  onReopen,
  onBuyIn,
  onCashOut,
}: {
  p: BjPlayerRow;
  canScore: boolean;
  busy: boolean;
  open: boolean;
  onToggleCashOut: () => void;
  onRebuy: () => void;
  onUndoRebuy: () => void;
  onReopen: () => void;
  onBuyIn: (cents: number) => void;
  onCashOut: (body: Record<string, unknown>) => void;
}) {
  const [editBuyIn, setEditBuyIn] = useState(false);
  const [buyInDraft, setBuyInDraft] = useState<number | null>(p.buyIn);

  return (
    <>
      <div className="bj-row">
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="bj-name">{p.name}</span>
          {p.isBanker && <span className="bj-pill" style={{ marginLeft: 6 }}>bank</span>}
          {p.kind === "guest" && <span className="bj-pill bj-pill--guest" style={{ marginLeft: 6 }}>guest</span>}
          <div className="bj-sub2">
            in {formatCentsShort(p.totalIn)}
            {p.rebuys > 0 && ` · ${p.rebuys} rebuy${p.rebuys === 1 ? "" : "s"}`}
            {p.cashedOut && p.cashOut !== null && ` · out ${formatCentsShort(p.cashOut)}`}
            {p.derived && " · worked out from the table"}
          </div>
        </span>
        <div className="bj-money">
          <NetToken net={p.net} totalIn={p.totalIn} />
        </div>
      </div>

      {canScore && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingBottom: 8 }}>
          {!p.cashedOut ? (
            <>
              <button className="bj-btn bj-btn--ghost bj-btn--sm" disabled={busy} onClick={onRebuy}>
                + Rebuy
              </button>
              {p.rebuys > 0 && (
                <button className="bj-textbtn" disabled={busy} onClick={onUndoRebuy}>
                  undo rebuy
                </button>
              )}
              <button
                className="bj-textbtn"
                onClick={() => {
                  // Re-seed from what is actually stored, not from whatever
                  // this component mounted with: a rebuy or another device
                  // may have moved it since.
                  if (!editBuyIn) setBuyInDraft(p.buyIn);
                  setEditBuyIn(!editBuyIn);
                }}
              >
                {editBuyIn ? "cancel" : "fix buy-in"}
              </button>
              <button className="bj-btn bj-btn--sm" disabled={busy} onClick={onToggleCashOut}>
                {open ? "Close" : "Cash out"}
              </button>
            </>
          ) : (
            <>
              <button className="bj-textbtn" disabled={busy} onClick={onToggleCashOut}>
                {open ? "close" : "edit cash-out"}
              </button>
              <button className="bj-textbtn" disabled={busy} onClick={onReopen}>
                sat back down
              </button>
            </>
          )}
        </div>
      )}

      {canScore && editBuyIn && !p.cashedOut && (
        <div style={{ display: "flex", gap: 8, paddingBottom: 10 }}>
          <MoneyInput value={buyInDraft} onChange={setBuyInDraft} small ariaLabel={`${p.name} buy-in`} />
          <button
            className="bj-btn bj-btn--sm"
            disabled={busy || buyInDraft === null}
            onClick={() => {
              if (buyInDraft !== null) onBuyIn(buyInDraft);
              setEditBuyIn(false);
            }}
          >
            Save
          </button>
        </div>
      )}

      {canScore && open && <CashOutForm p={p} busy={busy} onSubmit={onCashOut} />}
    </>
  );
}

/**
 * The cash-out form: the minimal-input path, and the one most nights use.
 *
 * The three detail boxes are OPTIONAL and prefill from the tracker when it was
 * running, which is the group rule: the tracker being off must never lose a
 * stat this form could have captured. Left blank they stay unknown rather
 * than becoming a zero that would drag a lifetime average down.
 */
function CashOutForm({
  p,
  busy,
  onSubmit,
}: {
  p: BjPlayerRow;
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [cashOut, setCashOut] = useState<number | null>(p.cashOut);
  const [biggestBet, setBiggestBet] = useState<number | null>(p.detail.biggestBet);
  const [biggestWin, setBiggestWin] = useState<number | null>(p.detail.biggestWin);
  const [blackjacks, setBlackjacks] = useState<number | null>(p.detail.blackjacks);
  const tracked = p.hands > 0;

  return (
    <div className="bj-card" style={{ marginBottom: 10 }}>
      <div className="bj-h">Cash out {p.name}</div>
      <div className="bj-lab">Cashing out for</div>
      <MoneyInput value={cashOut} onChange={setCashOut} ariaLabel={`${p.name} cash-out`} />
      <p className="bj-hint" style={{ marginTop: 6 }}>
        In for {formatCents(p.totalIn)}. Enter 0 if they busted.
        {cashOut !== null && ` That's ${formatCentsSigned(cashOut - p.totalIn)} on the night.`}
      </p>
      {p.isBanker && (
        <p className="bj-hint" style={{ marginTop: 6 }}>
          This is the bank's own count of the rack. It is never what gets recorded — the bank's
          net is worked out from everyone else's — so it is the cross-check: if it disagrees, the
          table is off and this screen says by how much.
        </p>
      )}

      <div className="bj-lab" style={{ marginTop: 12 }}>
        {tracked ? `From the tracker (${p.hands} hands) — edit if it's off` : "Optional, if anyone remembers"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 6 }}>
        <div>
          <div className="bj-sub2">Biggest bet</div>
          <MoneyInput value={biggestBet} onChange={setBiggestBet} small ariaLabel="Biggest bet" />
        </div>
        <div>
          <div className="bj-sub2">Biggest win</div>
          <MoneyInput value={biggestWin} onChange={setBiggestWin} small ariaLabel="Biggest win" />
        </div>
        <div>
          <div className="bj-sub2">Blackjacks</div>
          <CountInput value={blackjacks} onChange={setBlackjacks} ariaLabel="Blackjacks hit" />
        </div>
      </div>

      <button
        className="bj-btn"
        style={{ marginTop: 12 }}
        disabled={busy || cashOut === null}
        onClick={() => onSubmit({ cashOut, biggestBet, biggestWin, blackjacks })}
      >
        {cashOut === null ? "Enter an amount" : `Cash out ${formatCentsShort(cashOut)}`}
      </button>
    </div>
  );
}

// ---------- the opt-in live tracker ----------

const RESULTS: { key: BjHandResult; label: string }[] = [
  { key: "win", label: "Won" },
  { key: "lose", label: "Lost" },
  { key: "push", label: "Push" },
  { key: "blackjack", label: "Blackjack!" },
];

function Tracker({
  session,
  busy,
  call,
  at,
}: {
  session: Session;
  busy: boolean;
  call: (path: string, body?: unknown) => Promise<void>;
  at: (p: string) => string;
}) {
  const live = session.summary.players.filter((p) => !p.cashedOut);
  const [playerId, setPlayerId] = useState(live[0]?.playerId ?? "");
  const [bet, setBet] = useState<number | null>(null);

  const chosen = live.some((p) => p.playerId === playerId) ? playerId : live[0]?.playerId ?? "";

  return (
    <div className="bj-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="bj-h" style={{ margin: 0 }}>Live tracker</div>
        <span className="bj-hint">{session.hands.length} hands</span>
      </div>
      <p className="bj-hint" style={{ marginTop: 4 }}>
        Pick who, type the bet, tap how it went. Feeds biggest bet, biggest win and blackjacks;
        it never touches the money, which comes from buy-ins and cash-outs alone.
      </p>

      <div className="bj-lab" style={{ marginTop: 12 }}>Player</div>
      <div className="bj-seg">
        {live.map((p) => (
          <button key={p.playerId} className={chosen === p.playerId ? "on" : ""} onClick={() => setPlayerId(p.playerId)}>
            {p.name}
          </button>
        ))}
      </div>
      {live.length === 0 && <p className="bj-hint">Everyone has cashed out.</p>}

      <div className="bj-lab" style={{ marginTop: 12 }}>Bet</div>
      <MoneyInput value={bet} onChange={setBet} ariaLabel="Hand bet" />

      <div className="bj-seg" style={{ marginTop: 10 }}>
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

      {session.hands.length > 0 && (
        <button className="bj-textbtn" style={{ marginTop: 8 }} disabled={busy} onClick={() => call(at("undo-hand"))}>
          ↶ Undo last hand
        </button>
      )}
    </div>
  );
}

// ---------- a late arrival ----------

function AddPlayer({
  ctx,
  session,
  busy,
  onAdd,
  onCancel,
}: {
  ctx: Ctx | null;
  session: Session;
  busy: boolean;
  onAdd: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [buyIn, setBuyIn] = useState<number | null>(session.defaultBuyIn);
  const seated = new Set(session.roster.map((p) => p.userId).filter(Boolean) as string[]);
  const free = (ctx?.members ?? []).filter((m) => !seated.has(m.userId));

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="bj-h" style={{ margin: 0 }}>Someone sat down</div>
        <button className="bj-textbtn" onClick={onCancel}>cancel</button>
      </div>
      {free.length > 0 && (
        <>
          <div className="bj-lab" style={{ marginTop: 10 }}>From the crew</div>
          <div className="bj-seg">
            {free.map((m) => (
              <button key={m.userId} disabled={busy} onClick={() => onAdd({ name: m.name, userId: m.userId, buyIn })}>
                + {m.name}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="bj-lab" style={{ marginTop: 12 }}>Buy-in</div>
      <MoneyInput value={buyIn} onChange={setBuyIn} ariaLabel="New player buy-in" />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          className="bj-input"
          placeholder="Guest name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && onAdd({ name: name.trim(), buyIn })}
        />
        <button
          className="bj-btn bj-btn--sm"
          disabled={busy || !name.trim() || buyIn === null}
          onClick={() => onAdd({ name: name.trim(), buyIn })}
        >
          Seat
        </button>
      </div>
    </>
  );
}

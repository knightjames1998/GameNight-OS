import { useState, type ReactNode } from "react";
import {
  formatCents,
  formatCentsShort,
  formatCentsSigned,
  type CashPlayerRow,
  type CashSummary,
} from "@gamenight/shared";
import type { PackCtx } from "../usePackSession";
import { MoneyInput, NetToken } from "./money";
import "./casino.css";

// The live money table every casino pack runs a night on: the board, the
// buy-in / rebuy / cash-out controls, the late arrival, and the host's end-the
// -night button. Identical across the group, because the MONEY is identical
// across the group — the only per-pack part is which extra numbers the
// cash-out form asks for, which is the `detail` slot below.

export type Call = (path: string, body?: unknown) => Promise<void>;

/**
 * How a pack extends the cash-out form.
 *
 * The shared form owns the cash-out amount and the POST; the pack owns its own
 * detail fields and their initial values. `initial` prefills from the tracker
 * when it ran, which is the group's standing rule: the tracker being off must
 * never lose a stat this form could have captured.
 */
export interface CashOutDetail<D, R> {
  initial: (p: CashPlayerRow<R>) => D;
  render: (value: D, set: (next: D) => void, p: CashPlayerRow<R>) => ReactNode;
  /** The line above the fields; says where the prefill came from. */
  label: (p: CashPlayerRow<R>) => string;
}

export interface CasinoTableCopy {
  noun: string;
  /** Plural noun for one tracked event: "hands", "spins", "rolls". */
  events: string;
}

export function CasinoTable<D, R>({
  summary,
  ctx,
  tracker,
  openScoring,
  busy,
  call,
  at,
  copy,
  detail,
  trackerPanel,
}: {
  summary: CashSummary<R>;
  ctx: PackCtx | null;
  tracker: boolean;
  openScoring: boolean;
  busy: boolean;
  call: Call;
  /** Builds a route under this pack: at("rebuy") -> /api/roulette/:id/rebuy */
  at: (path: string) => string;
  copy: CasinoTableCopy;
  detail: CashOutDetail<D, R>;
  /** The pack's own tracker UI, shown only while the tracker is on. */
  trackerPanel?: ReactNode;
}) {
  const canHost = ctx?.canHost ?? false;
  const canScore = canHost || openScoring;
  const [cashingOut, setCashingOut] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  function endSession() {
    // The balance warning is shown, then the host decides. The app records
    // what the night did; it does not referee it. What it must never do is
    // write numbers it already knows disagree WITHOUT saying so.
    if (summary.balance.checked && !summary.balance.balanced) {
      if (!window.confirm(`${summary.warning}\n\nRecord the night anyway?`)) return;
      void call(at("complete"), { force: true });
      return;
    }
    if (summary.stillIn > 0) {
      const names = summary.players.filter((p) => !p.cashedOut).map((p) => p.name).join(", ");
      if (
        !window.confirm(
          `${summary.stillIn} still at ${copy.noun} (${names}). Ending now records them as busting out for their whole buy-in. Carry on?`,
        )
      ) {
        return;
      }
    }
    void call(at("complete"));
  }

  return (
    <>
      {summary.warning && <div className="cg-warn">⚠️ {summary.warning}</div>}

      {/* The money board. Same shape as the TV view, deliberately: the host's
          phone and the big screen must never disagree about who is up. */}
      <div className="cg-card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="cg-h" style={{ margin: 0 }}>{titleCase(copy.noun)}</div>
          <span className="cg-hint">
            {summary.bank === "player" ? "one of us is banking" : "casino banked"}
          </span>
        </div>

        {summary.players.map((p) => (
          <PlayerLine
            key={p.playerId}
            p={p}
            canScore={canScore}
            busy={busy}
            open={cashingOut === p.playerId}
            copy={copy}
            detail={detail}
            onToggleCashOut={() => setCashingOut(cashingOut === p.playerId ? null : p.playerId)}
            call={call}
            at={at}
            onDone={() => setCashingOut(null)}
          />
        ))}

        <div className="cg-totals">
          <div className="cg-total">
            <div className="cg-total__n">{formatCents(summary.totalIn)}</div>
            <div className="cg-total__l">bought in</div>
          </div>
          <div className="cg-total">
            <div className="cg-total__n">{formatCents(summary.totalOut)}</div>
            <div className="cg-total__l">cashed out</div>
          </div>
          <div className="cg-total">
            <div className="cg-total__n">{formatCents(summary.onTable)}</div>
            <div className="cg-total__l">on the table</div>
          </div>
        </div>
      </div>

      {tracker && canScore && trackerPanel}

      {canScore && (
        <div className="cg-card">
          {adding ? (
            <AddPlayer
              ctx={ctx}
              summary={summary}
              busy={busy}
              onAdd={(body) => {
                void call(at("add-player"), body);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button className="cg-btn cg-btn--ghost" onClick={() => setAdding(true)}>
              + Someone sat down
            </button>
          )}
        </div>
      )}

      {canHost && (
        <div className="cg-card">
          <div className="cg-h">Host controls</div>
          <div className="cg-row">
            <span style={{ flex: 1 }}>Live tracker</span>
            <button
              className={`gn-toggle ${tracker ? "gn-toggle--on" : "gn-toggle--off"}`}
              aria-pressed={tracker}
              onClick={() => call(at("tracker"), { on: !tracker })}
            >
              {tracker ? "ON" : "OFF"}
            </button>
          </div>
          <div className="cg-row">
            <span style={{ flex: 1 }}>Let members record the money</span>
            <button
              className={`gn-toggle ${openScoring ? "gn-toggle--on" : "gn-toggle--off"}`}
              aria-pressed={openScoring}
              onClick={() => call(at("open-scoring"), { open: !openScoring })}
            >
              {openScoring ? "ON" : "OFF"}
            </button>
          </div>
          <p className="cg-hint" style={{ marginTop: 6 }}>
            Turning the tracker off keeps every {copy.events.replace(/s$/, "")} already logged — the
            details it worked out stay on the cash-out form.
          </p>
          <button className="cg-btn cg-btn--go" style={{ marginTop: 10 }} disabled={busy} onClick={endSession}>
            End the night &amp; record it
          </button>
          <p className="cg-hint" style={{ marginTop: 8 }}>
            One row per player goes into the ledger, placed by net. Nothing is recorded until you
            tap this.
          </p>
        </div>
      )}
    </>
  );
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- one player's line, with its buy-in and cash-out controls ----------

function PlayerLine<D, R>({
  p,
  canScore,
  busy,
  open,
  copy,
  detail,
  onToggleCashOut,
  call,
  at,
  onDone,
}: {
  p: CashPlayerRow<R>;
  canScore: boolean;
  busy: boolean;
  open: boolean;
  copy: CasinoTableCopy;
  detail: CashOutDetail<D, R>;
  onToggleCashOut: () => void;
  call: Call;
  at: (path: string) => string;
  onDone: () => void;
}) {
  const [editBuyIn, setEditBuyIn] = useState(false);
  const [buyInDraft, setBuyInDraft] = useState<number | null>(p.buyIn);

  return (
    <>
      <div className="cg-row">
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="cg-name">{p.name}</span>
          {p.isBanker && <span className="cg-pill" style={{ marginLeft: 6 }}>bank</span>}
          {p.kind === "guest" && <span className="cg-pill cg-pill--muted" style={{ marginLeft: 6 }}>guest</span>}
          <div className="cg-sub2">
            in {formatCentsShort(p.totalIn)}
            {p.rebuys > 0 && ` · ${p.rebuys} rebuy${p.rebuys === 1 ? "" : "s"}`}
            {p.cashedOut && p.cashOut !== null && ` · out ${formatCentsShort(p.cashOut)}`}
            {p.derived && " · worked out from the table"}
          </div>
        </span>
        <NetToken net={p.net} totalIn={p.totalIn} />
      </div>

      {canScore && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingBottom: 8 }}>
          {!p.cashedOut ? (
            <>
              <button
                className="cg-btn cg-btn--ghost cg-btn--sm"
                disabled={busy}
                onClick={() => call(at("rebuy"), { playerId: p.playerId })}
              >
                + Rebuy
              </button>
              {p.rebuys > 0 && (
                <button
                  className="cg-textbtn"
                  disabled={busy}
                  onClick={() => call(at("undo-rebuy"), { playerId: p.playerId })}
                >
                  undo rebuy
                </button>
              )}
              <button
                className="cg-textbtn"
                onClick={() => {
                  // Re-seed from what is actually stored, not from whatever
                  // this component mounted with: a rebuy or another device may
                  // have moved it since.
                  if (!editBuyIn) setBuyInDraft(p.buyIn);
                  setEditBuyIn(!editBuyIn);
                }}
              >
                {editBuyIn ? "cancel" : "fix buy-in"}
              </button>
              <button className="cg-btn cg-btn--sm" disabled={busy} onClick={onToggleCashOut}>
                {open ? "Close" : "Cash out"}
              </button>
            </>
          ) : (
            <>
              <button className="cg-textbtn" disabled={busy} onClick={onToggleCashOut}>
                {open ? "close" : "edit cash-out"}
              </button>
              <button
                className="cg-textbtn"
                disabled={busy}
                onClick={() => call(at("reopen"), { playerId: p.playerId })}
              >
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
            className="cg-btn cg-btn--sm"
            disabled={busy || buyInDraft === null}
            onClick={() => {
              if (buyInDraft !== null) void call(at("buy-in"), { playerId: p.playerId, amount: buyInDraft });
              setEditBuyIn(false);
            }}
          >
            Save
          </button>
        </div>
      )}

      {canScore && open && (
        <CashOutForm
          p={p}
          busy={busy}
          copy={copy}
          detail={detail}
          onSubmit={(body) => {
            void call(at("cash-out"), { playerId: p.playerId, ...body });
            onDone();
          }}
        />
      )}
    </>
  );
}

/**
 * The cash-out form: the minimal-input path, and the one most nights use.
 *
 * The pack's detail fields are OPTIONAL and prefill from the tracker when it
 * was running, which is the group rule: the tracker being off must never lose
 * a stat this form could have captured. Left blank they stay unknown rather
 * than becoming a zero that would drag a lifetime average down.
 */
function CashOutForm<D, R>({
  p,
  busy,
  copy,
  detail,
  onSubmit,
}: {
  p: CashPlayerRow<R>;
  busy: boolean;
  copy: CasinoTableCopy;
  detail: CashOutDetail<D, R>;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [cashOut, setCashOut] = useState<number | null>(p.cashOut);
  const [fields, setFields] = useState<D>(() => detail.initial(p));

  return (
    <div className="cg-card" style={{ marginBottom: 10 }}>
      <div className="cg-h">Cash out {p.name}</div>
      <div className="cg-lab">Cashing out for</div>
      <MoneyInput value={cashOut} onChange={setCashOut} ariaLabel={`${p.name} cash-out`} />
      <p className="cg-hint" style={{ marginTop: 6 }}>
        In for {formatCents(p.totalIn)}. Enter 0 if they busted.
        {cashOut !== null && ` That's ${formatCentsSigned(cashOut - p.totalIn)} on the night.`}
      </p>
      {p.isBanker && (
        <p className="cg-hint" style={{ marginTop: 6 }}>
          This is the bank&rsquo;s own count of the rack. It is never what gets recorded — the
          bank&rsquo;s net is worked out from everyone else&rsquo;s — so it is the cross-check: if
          it disagrees, {copy.noun} is off and this screen says by how much.
        </p>
      )}

      <div className="cg-lab" style={{ marginTop: 12 }}>{detail.label(p)}</div>
      {detail.render(fields, setFields, p)}

      <button
        className="cg-btn"
        style={{ marginTop: 12 }}
        disabled={busy || cashOut === null}
        onClick={() => onSubmit({ cashOut, ...(fields as Record<string, unknown>) })}
      >
        {cashOut === null ? "Enter an amount" : `Cash out ${formatCentsShort(cashOut)}`}
      </button>
    </div>
  );
}

// ---------- a late arrival ----------
//
// Every other pack in this app locks its roster at start, because a Smash
// night has the players it has. A cash table does not work that way: somebody
// turns up at eleven and sits down, and a pack that could not take them would
// push the host into a second session for one person.

function AddPlayer<R>({
  ctx,
  summary,
  busy,
  onAdd,
  onCancel,
}: {
  ctx: PackCtx | null;
  summary: CashSummary<R>;
  busy: boolean;
  onAdd: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [buyIn, setBuyIn] = useState<number | null>(null);
  const seated = new Set(summary.players.map((p) => p.name));
  const free = (ctx?.members ?? []).filter((m) => !seated.has(m.name));

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="cg-h" style={{ margin: 0 }}>Someone sat down</div>
        <button className="cg-textbtn" onClick={onCancel}>cancel</button>
      </div>
      <div className="cg-lab" style={{ marginTop: 10 }}>Their buy-in</div>
      <MoneyInput value={buyIn} onChange={setBuyIn} ariaLabel="New player buy-in" />
      <p className="cg-hint" style={{ marginTop: 6 }}>
        Leave it blank to use the table default.
      </p>
      {free.length > 0 && (
        <>
          <div className="cg-lab" style={{ marginTop: 12 }}>From the crew</div>
          <div className="cg-seg">
            {free.map((m) => (
              <button key={m.userId} disabled={busy} onClick={() => onAdd({ name: m.name, userId: m.userId, buyIn })}>
                + {m.name}
              </button>
            ))}
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          className="cg-input"
          placeholder="Guest name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && onAdd({ name: name.trim(), buyIn })}
        />
        <button
          className="cg-btn cg-btn--sm"
          disabled={busy || !name.trim()}
          onClick={() => onAdd({ name: name.trim(), buyIn })}
        >
          Seat
        </button>
      </div>
    </>
  );
}

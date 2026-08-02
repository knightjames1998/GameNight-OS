import { useState } from "react";
import { Link } from "react-router-dom";
import BackButton from "../BackButton";
import { api } from "../api";
import { usePackSession, type PackCtx } from "../usePackSession";
import { MoneyInput, StakesBadge } from "../casino/money";
import { ModifierPicker, ModifierStrip } from "../casino/modifiers";
import {
  CRUN_LADDERS,
  CRUN_TOKENS,
  SESSION_PACKS,
  crunQuotas,
  crunTokenCost,
  crunTokenName,
  defaultAnte,
  modifierName,
  money,
  type CrunDifficulty,
  type CrunSummary,
} from "@gamenight/shared";
import "../casino/casino.css";
import "./casinorun.css";

// The Casino Run pack page.
//
// The co-op one, and the only casino pack whose screen is NOT the shared money
// board — because there is no per-player money to put on one. What it shows
// instead is ONE bank, the quota it is chasing, and the log of legs that got
// it there. It still reuses everything about money that is genuinely shared:
// integer cents through MoneyInput, the stakes-aware formatter, the modifier
// strip and picker, and the --cg-* tokens.
//
// A LEG IS THE ONLY THING ANYBODY TYPES. What the bank did, at which game, by
// whom. The app never computes a gambling outcome here any more than it does
// in the cash packs.

type Session = {
  status: "setup" | "live" | "completed";
  groupId: string;
  openScoring: boolean;
  summary: CrunSummary;
};

const PACK = SESSION_PACKS.casinorun;

/** The games a leg is usually played at, plus the escape hatch. */
const GAMES = ["Blackjack", "Roulette", "Craps", "Poker", "Other"];

export default function CasinoRunPage() {
  const eventId = new URLSearchParams(window.location.search).get("event") ?? "";
  const { ctx, session, loading, busy, err, call, startSession } = usePackSession<Session>({
    pack: PACK.route,
    wsType: PACK.wsType,
    eventId,
    replacePrompt:
      "A run is already in progress on this event. Replace it? The bank, every leg and every card drawn are lost, and nothing from it is recorded.",
  });

  if (!eventId) {
    return (
      <div className="cg-root crun-root">
        <div className="cg-wrap">
          <p className="cg-hint">No event specified.</p>
          <BackButton />
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="cg-root crun-root">
        <div className="cg-wrap">
          <p className="cg-hint">Loading...</p>
        </div>
      </div>
    );
  }

  const at = (p: string) => `/api/${PACK.route}/${eventId}/${p}`;

  return (
    <div className="cg-root crun-root">
      <div className="cg-wrap">
        <div className="cg-top">
          <BackButton className="cg-textbtn" />
          <Link to={`/e/${eventId}/tv`} className="cg-textbtn">
            📺 TV
          </Link>
        </div>
        <div>
          <div className="cg-brand">
            Casino<em>Run</em>
          </div>
          <div className="cg-sub">
            Co-op &middot; one bank, one quota, everybody wins or nobody does
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
          <RunSetup
            ctx={ctx}
            busy={busy}
            finished={session?.status === "completed" ? session.summary : null}
            onStart={startSession}
          />
        ) : (
          <LiveRun
            summary={session.summary}
            ctx={ctx}
            openScoring={session.openScoring}
            busy={busy}
            call={call}
            at={at}
          />
        )}
      </div>
    </div>
  );
}

// ---------- setup ----------

interface Seat {
  userId: string | null;
  name: string;
}

function RunSetup({
  ctx,
  busy,
  finished,
  onStart,
}: {
  ctx: PackCtx | null;
  busy: boolean;
  finished: CrunSummary | null;
  onStart: (payload: Record<string, unknown>) => void;
}) {
  const [startingBank, setStartingBank] = useState<number | null>(10000);
  const [difficulty, setDifficulty] = useState<CrunDifficulty>("standard");
  const [floor, setFloor] = useState<number | null>(0);
  // Null means "follow the bank", which is the 2% default the engine applies.
  const [ante, setAnte] = useState<number | null>(null);
  const [modifiers, setModifiers] = useState<string[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [guest, setGuest] = useState("");
  const [seeded, setSeeded] = useState(false);

  if (ctx && !seeded) {
    setSeeded(true);
    setSeats(ctx.prefill.map((p) => ({ userId: p.userId, name: p.name })));
  }

  if (!ctx) return <p className="cg-hint" style={{ marginTop: 16 }}>Loading...</p>;
  if (!ctx.canHost) {
    return (
      <div className="cg-card" style={{ marginTop: 16 }}>
        <div className="cg-h">Waiting for the host</div>
        <p className="cg-hint">
          The crew owner or an admin sets the bank and starts the run. This screen updates live the
          moment they do.
        </p>
      </div>
    );
  }

  // Play money, always: this mode has no stakes selector at all. See CrunState.
  const m = money("play");
  const ladder = CRUN_LADDERS.find((l) => l.key === difficulty)!;
  const bank = startingBank ?? 0;
  const quotas = crunQuotas(ladder, bank);
  const notAdded = ctx.members.filter((mm) => !seats.some((s) => s.userId === mm.userId));
  const ready = seats.length >= 1 && startingBank !== null && startingBank >= 100 && (floor ?? 0) < bank;

  return (
    <>
      {finished && <FinishedRecap summary={finished} />}

      <div className="cg-card" style={{ marginTop: 16 }}>
        <div className="cg-h">The bank</div>
        <p className="cg-hint" style={{ marginBottom: 10 }}>
          <StakesBadge stakes="play" /> Casino Run is <b>play money only</b>. The quotas climb to
          multiples of the bank and the hardest ladder is meant to be unwinnable, so there is no
          real-money option and nothing to choose here.
        </p>
        <div className="cg-lab">Starting stake</div>
        <MoneyInput value={startingBank} onChange={setStartingBank} ariaLabel="Starting bank" />
        <p className="cg-hint" style={{ marginTop: 8 }}>
          ONE shared stake for the whole crew, not a buy-in each. This is the pot everybody plays
          out of and everybody loses together.
        </p>
        <div className="cg-lab" style={{ marginTop: 14 }}>Floor</div>
        <MoneyInput value={floor} onChange={setFloor} small ariaLabel="Floor" />
        <p className="cg-hint" style={{ marginTop: 8 }}>
          Drop to this and the run is over. Zero means play it to the last chip.
        </p>

        <div className="cg-lab" style={{ marginTop: 14 }}>Opening minimum ante</div>
        <MoneyInput
          key={`ante-${bank}`}
          value={ante ?? defaultAnte(bank || 1)}
          onChange={setAnte}
          small
          ariaLabel="Opening ante"
        />
        <p className="cg-hint" style={{ marginTop: 8 }}>
          What it costs to sit in a round. Defaults to 2% of the bank. It RISES on its own — every
          missed stage puts it up, and Escalating minimum puts it up every five legs — so grinding
          gets more expensive the longer you do it.
        </p>
      </div>

      <div className="cg-card">
        <div className="cg-h">How hard?</div>
        <div className="cg-seg">
          {CRUN_LADDERS.map((l) => (
            <button
              key={l.key}
              className={difficulty === l.key ? "on" : ""}
              aria-pressed={difficulty === l.key}
              onClick={() => setDifficulty(l.key)}
            >
              {l.name}
            </button>
          ))}
        </div>
        <p className="cg-hint" style={{ marginTop: 8 }}>{ladder.blurb}</p>
        <p className="cg-hint" style={{ marginTop: 6 }}>
          {ladder.stages} stages, +{Math.round(ladder.escalation * 100)}% each. Each stage gives you{" "}
          {ladder.attemptsPerStage} attempt{ladder.attemptsPerStage === 1 ? "" : "s"} of{" "}
          {ladder.legsPerStage} legs &mdash; <b>run out of attempts and the run is over</b>, even
          with money still on the table.
        </p>
        {bank > 0 && (
          <>
            <div className="cg-lab" style={{ marginTop: 12 }}>The bank has to reach</div>
            <div className="crun-stages">
              {quotas.map((q, i) => (
                <div className="crun-stage" key={i}>
                  <div className="crun-stage__n">{i + 1}</div>
                  <div className="crun-stage__q">{m.short(q)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="cg-card">
        <div className="cg-h">Who is running it?</div>
        {seats.length > 0 && (
          <div className="cg-seg">
            {seats.map((s, i) => (
              <button key={`${s.userId ?? "g"}-${i}`} onClick={() => setSeats(seats.filter((_, j) => j !== i))}>
                {s.name} ✕
              </button>
            ))}
          </div>
        )}
        {notAdded.length > 0 && (
          <>
            <div className="cg-lab" style={{ marginTop: 12 }}>From the crew</div>
            <div className="cg-seg">
              {notAdded.map((mm) => (
                <button key={mm.userId} onClick={() => setSeats([...seats, { userId: mm.userId, name: mm.name }])}>
                  + {mm.name}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="cg-lab" style={{ marginTop: 12 }}>Add a guest</div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            className="cg-input"
            placeholder="Guest name"
            value={guest}
            onChange={(e) => setGuest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && guest.trim()) {
                setSeats([...seats, { userId: null, name: guest.trim().slice(0, 24) }]);
                setGuest("");
              }
            }}
          />
          <button
            className="cg-btn cg-btn--ghost cg-btn--sm"
            onClick={() => {
              if (guest.trim()) setSeats([...seats, { userId: null, name: guest.trim().slice(0, 24) }]);
              setGuest("");
            }}
          >
            Add
          </button>
        </div>
        <p className="cg-hint" style={{ marginTop: 8 }}>
          Everyone here shares the result: clear the run and it is a win for all of them, bust and
          it is a loss for all of them. Guests play but carry no lifetime stats.
        </p>
      </div>

      <ModifierPicker
        ledger={PACK.ledger}
        value={modifiers}
        onChange={setModifiers}
        unit={ante ?? defaultAnte(bank || 1)}
        stakes="play"
      />
      <p className="cg-hint" style={{ marginTop: 8 }}>
        Leave these empty and the house deals one card to open the run, then another every time you
        clear a stage — reaching for nastier ones as the quotas climb.
      </p>

      <button
        className="cg-btn"
        style={{ marginTop: 12 }}
        disabled={busy || !ready}
        onClick={() =>
          onStart({ startingBank, floor: floor ?? 0, ante, difficulty, modifiers, roster: seats })
        }
      >
        {seats.length < 1
          ? "Add at least one player"
          : startingBank === null || startingBank < 100
          ? "Set a starting bank"
          : (floor ?? 0) >= bank
          ? "The floor has to be below the bank"
          : `Open the run · ${m.fmt(bank)} on the table`}
      </button>
    </>
  );
}

function FinishedRecap({ summary }: { summary: CrunSummary }) {
  const m = money(summary.stakes);
  return (
    <div className={`crun-verdict crun-verdict--${summary.status === "cleared" ? "cleared" : "bust"}`}>
      <div className="crun-verdict__h">
        {summary.status === "cleared" ? "🏆 Run cleared" : "💀 Bust"}
      </div>
      <p className="cg-hint" style={{ marginTop: 6 }}>
        {summary.cleared} of {summary.ladder.stages} stages &middot; finished on {m.fmt(summary.bank)} from{" "}
        {m.fmt(summary.startingBank)} &middot; {summary.legs.length} legs. It&rsquo;s in the ledger.
      </p>
    </div>
  );
}

// ---------- the live run ----------

function LiveRun({
  summary,
  ctx,
  openScoring,
  busy,
  call,
  at,
}: {
  summary: CrunSummary;
  ctx: PackCtx | null;
  openScoring: boolean;
  busy: boolean;
  call: (path: string, body?: unknown) => Promise<void>;
  at: (p: string) => string;
}) {
  const canHost = ctx?.canHost ?? false;
  const canScore = canHost || openScoring;
  const m = money(summary.stakes);
  const over = summary.status !== "running";

  function endRun() {
    if (summary.status === "running") {
      if (
        !window.confirm(
          `The run is still going — stage ${summary.stage + 1} of ${summary.ladder.stages}. Recording it now counts as a BUST for everyone. Carry on?`,
        )
      ) {
        return;
      }
      void call(at("complete"), { force: true });
      return;
    }
    void call(at("complete"));
  }

  const progress =
    summary.quota > summary.startingBank
      ? Math.max(0, Math.min(1, (summary.bank - summary.startingBank) / (summary.quota - summary.startingBank)))
      : 1;

  return (
    <>
      <div className="cg-card" style={{ marginTop: 16 }}>
        <Bank summary={summary} />
        <div className="crun-bar">
          <div
            className={`crun-bar__fill ${summary.status === "bust" ? "crun-bar__fill--bust" : ""}`}
            style={{ width: `${Math.round((summary.status === "bust" ? 1 : progress) * 100)}%` }}
          />
        </div>
        <p className="cg-hint" style={{ marginTop: 8, textAlign: "center" }}>
          {summary.status === "cleared"
            ? `All ${summary.ladder.stages} stages cleared.`
            : summary.ending === "floor"
            ? `The bank went through the floor of ${m.fmt(summary.floor)}.`
            : summary.ending === "attempts"
            ? `Out of attempts on stage ${Math.min(summary.stage + 1, summary.ladder.stages)}, with ${m.fmt(summary.bank)} still on the table.`
            : `${m.fmt(summary.toGo)} to go · ${summary.legsLeft} leg${summary.legsLeft === 1 ? "" : "s"} left · attempt ${summary.attempt} of ${summary.ladder.attemptsPerStage}`}
        </p>

        <AnteStrip summary={summary} />

        <div className="crun-stages">
          {summary.stages.map((st) => (
            <div
              key={st.index}
              className={`crun-stage ${st.cleared ? "crun-stage--done" : ""} ${
                !over && st.index === summary.stage ? "crun-stage--live" : ""
              }`}
            >
              <div className="crun-stage__n">{st.cleared ? "✓" : st.index + 1}</div>
              <div className="crun-stage__q">{m.short(st.quota)}</div>
            </div>
          ))}
        </div>
      </div>

      {over && (
        <div className={`crun-verdict crun-verdict--${summary.status === "cleared" ? "cleared" : "bust"}`}>
          <div className="crun-verdict__h">
            {summary.status === "cleared" ? "🏆 Run cleared" : "💀 Bust"}
          </div>
          <p className="cg-hint" style={{ marginTop: 6 }}>
            {summary.status === "cleared"
              ? "Everybody at the table takes the win. Record it below."
              : "Everybody at the table takes the loss. Record it below, or undo the last leg if that was a mis-tap."}
          </p>
        </div>
      )}

      {/* The unit is the LIVE ante, not the base: a card that pays "100% of the
          minimum" gets dearer as the ante climbs, and the text should say so. */}
      <ModifierStrip ids={summary.modifiers} unit={summary.ante.amount} stakes={summary.stakes} />

      {canScore && !over && <LegForm summary={summary} busy={busy} call={call} at={at} />}

      {canScore && !over && <TokenShop summary={summary} busy={busy} call={call} at={at} />}

      {summary.legs.length > 0 && (
        <div className="cg-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div className="cg-h" style={{ margin: 0 }}>The run so far</div>
            <span className="cg-hint">
              {summary.legs.filter((l) => l.kind !== "buy").length} legs
            </span>
          </div>
          {[...summary.legs].reverse().map((l, i) => (
            <div className={`crun-leg ${l.kind === "buy" ? "crun-leg--buy" : ""}`} key={summary.legs.length - i}>
              <span className="crun-leg__g">
                {l.kind === "buy" && <span className="crun-leg__tag">card</span>}
                {l.game}
              </span>
              <span className="crun-leg__who">
                {l.playerId
                  ? summary.players.find((p) => p.playerId === l.playerId)?.name ?? "?"
                  : "the table"}
              </span>
              <span className={`crun-leg__d ${l.delta > 0 ? "crun-leg__d--up" : l.delta < 0 ? "crun-leg__d--down" : ""}`}>
                {m.signed(l.delta)}
              </span>
              <span className="crun-leg__who">{m.short(l.bank)}</span>
            </div>
          ))}
          {canScore && (
            <button className="cg-textbtn" style={{ marginTop: 8 }} disabled={busy} onClick={() => call(at("undo-leg"))}>
              ↶ Undo last leg
            </button>
          )}
          <p className="cg-hint" style={{ marginTop: 6 }}>
            Undo puts the bank and the stage back exactly. Cards already drawn stay: the table
            played under them.
          </p>
        </div>
      )}

      {summary.players.some((p) => p.legs > 0) && (
        <div className="cg-card">
          <div className="cg-h">Who played what</div>
          {summary.players.map((p) => (
            <div className="cg-row" key={p.playerId}>
              <span className="cg-name" style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
              <span className="cg-sub2">
                {p.legs} leg{p.legs === 1 ? "" : "s"}
              </span>
              <span className={`crun-leg__d ${p.delta > 0 ? "crun-leg__d--up" : p.delta < 0 ? "crun-leg__d--down" : ""}`}>
                {p.legs > 0 ? m.signed(p.delta) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {canHost && (
        <div className="cg-card">
          <div className="cg-h">Host controls</div>
          <div className="cg-row">
            <span style={{ flex: 1 }}>Let members record legs</span>
            <button
              className={`gn-toggle ${openScoring ? "gn-toggle--on" : "gn-toggle--off"}`}
              aria-pressed={openScoring}
              onClick={() => call(at("open-scoring"), { open: !openScoring })}
            >
              {openScoring ? "ON" : "OFF"}
            </button>
          </div>
          <DraftControl summary={summary} busy={busy} call={call} at={at} />
          <button className="cg-btn cg-btn--go" style={{ marginTop: 10 }} disabled={busy} onClick={endRun}>
            End the run &amp; record it
          </button>
          <p className="cg-hint" style={{ marginTop: 8 }}>
            One row per player goes into the ledger, all at the same result — a cleared run is a win
            for everybody, a bust is a loss for everybody. Nothing is recorded until you tap this.
          </p>
        </div>
      )}
    </>
  );
}

function Bank({ summary }: { summary: CrunSummary }) {
  const m = money(summary.stakes);
  const tone =
    summary.bank > summary.startingBank ? "up" : summary.bank < summary.startingBank ? "down" : "even";
  return (
    <div className="crun-bank">
      <div className="crun-bank__l">The bank</div>
      <div className={`crun-bank__n crun-bank__n--${tone}`}>{m.fmt(summary.bank)}</div>
      <div className="crun-bank__sub">
        {summary.status === "running"
          ? `Stage ${summary.stage + 1} of ${summary.ladder.stages} · needs ${m.fmt(summary.quota)}`
          : summary.headline}
      </div>
    </div>
  );
}

/**
 * The minimum ante, and why it is where it is.
 *
 * A TRACKER, NOT A REFEREE. The app is not deciding what anybody bets — it is
 * keeping the number the table already agreed on, and applying the rises that
 * the cards and the missed stages call for. That is bookkeeping, the same kind
 * as counting legs, and it is a different thing from computing a gambling
 * outcome, which this pack still never does.
 */
function AnteStrip({ summary }: { summary: CrunSummary }) {
  const m = money(summary.stakes);
  const a = summary.ante;
  const why: string[] = [];
  if (a.raises > 0) why.push(`up ${a.raises}x from ${m.short(a.base)}`);
  if (summary.missed > 0) why.push(`${summary.missed} missed stage${summary.missed === 1 ? "" : "s"}`);
  if (summary.modifiers.includes("escalating_min")) why.push("Escalating minimum");

  return (
    <div className={`crun-ante ${a.raises > 0 ? "crun-ante--up" : ""}`}>
      <div>
        <div className="crun-ante__l">Minimum ante</div>
        {a.everyone && <div className="crun-ante__all">everyone antes, every round</div>}
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="crun-ante__n">{m.fmt(a.amount)}</div>
        {why.length > 0 && <div className="crun-ante__why">{why.join(" · ")}</div>}
      </div>
    </div>
  );
}

/**
 * TOKENS: one-time-use cards bought out of the bank.
 *
 * The only decision in the pack that costs money to make: spending bank moves
 * you away from the quota you are chasing, so "buy a hedge and fall further
 * behind, or run the next leg naked" is a real choice rather than free value.
 * Most of them are declarative — the table applies them — and the two that are
 * not touch bookkeeping the app already owns.
 */
function TokenShop({
  summary,
  busy,
  call,
  at,
}: {
  summary: CrunSummary;
  busy: boolean;
  call: (path: string, body?: unknown) => Promise<void>;
  at: (p: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const m = money(summary.stakes);

  return (
    <div className="cg-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="cg-h" style={{ margin: 0 }}>Tokens</div>
        <button className="cg-textbtn" onClick={() => setOpen(!open)}>
          {open ? "▴ hide" : "▾ buy one"}
        </button>
      </div>

      {summary.held.length > 0 && (
        <div className="crun-held">
          <div className="crun-held__l">Held for the next leg</div>
          {summary.held.map((id, i) => (
            <span className="crun-held__c" key={`${id}-${i}`}>{crunTokenName(id)}</span>
          ))}
        </div>
      )}

      {open && (
        <>
          <p className="cg-hint" style={{ marginTop: 8 }}>
            Bought out of the bank and spent on the next leg. The cost moves you AWAY from the
            quota, which is the point.
          </p>
          {CRUN_TOKENS.map((t) => {
            const cost = crunTokenCost(t, summary.startingBank);
            return (
              <div className="cg-row" key={t.id}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="cg-name">{t.name}</span>
                  <div className="cg-sub2">{t.rule}</div>
                </span>
                <button
                  className="cg-btn cg-btn--ghost cg-btn--sm"
                  disabled={busy}
                  onClick={() => call(at("buy"), { token: t.id })}
                >
                  {m.short(cost)}
                </button>
              </div>
            );
          })}
          <p className="cg-hint" style={{ marginTop: 8 }}>
            Nothing stops you buying one you cannot afford. Spending the last of the bank on a
            hedge is a real way to end a run.
          </p>
        </>
      )}
      {!open && summary.held.length === 0 && (
        <p className="cg-hint" style={{ marginTop: 6 }}>
          Priced off the starting bank. Buy one when a leg has to land.
        </p>
      )}
    </div>
  );
}

/** The one thing anybody types: what the bank did, where, and who did it. */
function LegForm({
  summary,
  busy,
  call,
  at,
}: {
  summary: CrunSummary;
  busy: boolean;
  call: (path: string, body?: unknown) => Promise<void>;
  at: (p: string) => string;
}) {
  const [amount, setAmount] = useState<number | null>(null);
  const [game, setGame] = useState(GAMES[0]!);
  const [other, setOther] = useState("");
  const [playerId, setPlayerId] = useState<string>("");
  const m = money(summary.stakes);
  const gameName = game === "Other" ? other.trim() : game;
  const ok = amount !== null && amount > 0 && gameName.length > 0;

  const submit = (sign: 1 | -1) => {
    if (!ok) return;
    void call(at("leg"), { delta: sign * amount!, game: gameName, playerId: playerId || null });
    setAmount(null);
    setOther("");
  };

  return (
    <div className="cg-card">
      <div className="cg-h">Record a leg</div>
      <p className="cg-hint">
        Play a stretch at one game, then type what the bank is up or down. The app never works that
        out — you do, at the table.
      </p>

      <div className="cg-lab" style={{ marginTop: 12 }}>Game</div>
      <div className="cg-seg">
        {GAMES.map((g) => (
          <button key={g} className={game === g ? "on" : ""} aria-pressed={game === g} onClick={() => setGame(g)}>
            {g}
          </button>
        ))}
      </div>
      {game === "Other" && (
        <input
          className="cg-input"
          style={{ marginTop: 8 }}
          placeholder="What did you play?"
          aria-label="Other game"
          value={other}
          onChange={(e) => setOther(e.target.value.slice(0, 32))}
        />
      )}

      <div className="cg-lab" style={{ marginTop: 12 }}>Who played it</div>
      <div className="cg-seg">
        <button className={playerId === "" ? "on" : ""} onClick={() => setPlayerId("")}>
          The table
        </button>
        {summary.players.map((p) => (
          <button key={p.playerId} className={playerId === p.playerId ? "on" : ""} onClick={() => setPlayerId(p.playerId)}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="cg-lab" style={{ marginTop: 12 }}>The bank is</div>
      <MoneyInput value={amount} onChange={setAmount} ariaLabel="Leg amount" />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="cg-btn cg-btn--go" disabled={busy || !ok} onClick={() => submit(1)} style={{ flex: 1 }}>
          ▲ Up {amount ? m.short(amount) : ""}
        </button>
        <button className="cg-btn" disabled={busy || !ok} onClick={() => submit(-1)} style={{ flex: 1, background: "var(--cg-down)", color: "var(--cg-down-ink)", boxShadow: "none" }}>
          ▼ Down {amount ? m.short(amount) : ""}
        </button>
      </div>
      {amount !== null && amount > 0 && (
        <p className="cg-hint" style={{ marginTop: 8 }}>
          Up puts the bank on {m.fmt(summary.bank + amount)}, down on {m.fmt(summary.bank - amount)}.
        </p>
      )}
    </div>
  );
}

/**
 * DRAFT MODE: deal a hand, the table picks one.
 *
 * Deliberately two calls with nothing stored in between — the hand lives in
 * this component's state until somebody picks. Storing an undecided hand would
 * add a fourth run state that undo, completion and the TV would all need to
 * know about, to save one round trip.
 */
function DraftControl({
  summary,
  busy,
  call,
  at,
}: {
  summary: CrunSummary;
  busy: boolean;
  call: (path: string, body?: unknown) => Promise<void>;
  at: (p: string) => string;
}) {
  const [hand, setHand] = useState<string[] | null>(null);

  // The shared api helper, not a bare fetch: it carries the X-GN-Client header
  // the WebSocket echo-suppression depends on, and turns a failure into an
  // ApiError rather than a silent no-op.
  async function deal() {
    const j = await api<{ hand: string[] }>(at("draft"), {
      method: "POST",
      body: JSON.stringify({ count: 3 }),
    }).catch(() => null);
    if (j) setHand(j.hand);
  }

  return (
    <>
      <div className="cg-row">
        <span style={{ flex: 1 }}>Draft a card</span>
        <button className="cg-btn cg-btn--ghost cg-btn--sm" disabled={busy} onClick={deal}>
          Deal 3
        </button>
      </div>
      {hand && hand.length > 0 && (
        <div style={{ paddingBottom: 8 }}>
          <p className="cg-hint" style={{ marginBottom: 6 }}>Pick one. The other two go back.</p>
          <div className="cg-seg">
            {hand.map((id) => (
              <button
                key={id}
                disabled={busy}
                onClick={() => {
                  void call(at("modifiers"), { modifiers: [...summary.modifiers, id] });
                  setHand(null);
                }}
              >
                {modifierName(id)}
              </button>
            ))}
            <button className="cg-textbtn" onClick={() => setHand(null)}>cancel</button>
          </div>
        </div>
      )}
    </>
  );
}

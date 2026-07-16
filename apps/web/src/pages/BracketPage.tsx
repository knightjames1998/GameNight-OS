import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type BracketView, type BracketSlot, type BracketMatchView } from "../api";
import { RecapModal } from "../recap";
import BackButton from "../BackButton";

// ---- Bracket tree layout ----
// Same slot-height model the Beerio pack uses: a column is a relative box of
// height matchCount*slotH, each card absolutely centered at (i+0.5)*slotH.
// slotH doubles per winners round (and per losers pair), so a later match
// lines up vertically between the two matches that feed it. Connector arms
// and vertical joiners are drawn as thin absolute divs.
const CARD_W = 194;
const CARD_H = 76;
const SLOT_BASE = 96; // CARD_H + vertical gap between sibling cards
const CONN_W = 16;
const LINE = "rgba(160,145,190,.40)";

const P2 = "var(--gn-p2)"; // winners / teal
const P1 = "var(--gn-p1)"; // losers / coral
const GOLD = "var(--gn-gold)"; // grand final

type RoundView = BracketView["rounds"][number];
type Side = RoundView["side"];

// Column height per round index within a side. Losers rounds come in
// major/minor pairs that only halve every second column, so they step at
// floor(i/2); winners (and single elim) step every column.
const slotHeight = (side: Side, i: number) =>
  side === "L"
    ? SLOT_BASE * Math.pow(2, Math.floor(i / 2))
    : SLOT_BASE * Math.pow(2, i);

// A column joins into the next one when the next column merges two of its
// matches into one. Winners merge every round; losers merge only out of the
// minor (odd-index) columns.
const joinsRight = (side: Side, i: number, cols: number) =>
  i < cols - 1 && (side === "L" ? i % 2 === 1 : true);

export default function BracketPage() {
  const { id } = useParams();
  const [bracket, setBracket] = useState<BracketView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRecap, setShowRecap] = useState(false);

  const load = useCallback(async () => {
    try {
      setBracket(await api<BracketView>(`/api/brackets/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [id]);

  useEffect(() => {
    load();

    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${window.location.host}/ws`);
      socket.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.type === "bracket_updated" && data.bracketId === id) load();
        } catch {
          // Not our message; ignore.
        }
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
    }
    connect();

    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id, load]);

  const record = useCallback(
    async (matchId: string, winner: "A" | "B") => {
      if (busy) return;
      setBusy(true);
      try {
        await api(`/api/brackets/${id}/matches/${matchId}/result`, {
          method: "POST",
          body: JSON.stringify({ winner }),
        });
        await load();
      } finally {
        setBusy(false);
      }
    },
    [busy, id, load],
  );

  const undo = useCallback(
    async (matchId: string) => {
      if (busy || !window.confirm("Undo this result? Later results that depended on it clear too."))
        return;
      setBusy(true);
      try {
        await api(`/api/brackets/${id}/matches/${matchId}/result`, { method: "DELETE" });
        await load();
      } finally {
        setBusy(false);
      }
    },
    [busy, id, load],
  );

  if (error) {
    return (
      <main className="gn-app">
        <div className="gn-wrap"><BackButton /><p style={{ color: "var(--gn-danger)", marginTop: "12px" }}>{error}</p></div>
      </main>
    );
  }
  if (!bracket) {
    return (
      <main className="gn-app">
        <div className="gn-wrap"><BackButton /><p className="gn-hint" style={{ marginTop: "12px" }}>Loading...</p></div>
      </main>
    );
  }

  const isDouble = bracket.format === "double_elim";
  const wb = bracket.rounds.filter((r) => r.side === "W");
  const lb = bracket.rounds.filter((r) => r.side === "L");
  const gf = bracket.rounds.filter((r) => r.side === "GF");

  return (
    <main className="gn-app">
      <div className="p-6 pb-2 max-w-5xl mx-auto">
        <BackButton />
        <div className="flex items-center justify-between mt-2 gap-2">
          <h1 className="gn-title text-2xl">{bracket.gameName}</h1>
          <Link to={`/tv/${bracket.id}`} className="gn-btn gn-btn--ghost shrink-0" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            📺 TV mode
          </Link>
        </div>
        <p className="gn-hint" style={{ fontSize: "13px" }}>
          {bracket.entrantCount} players &middot; {isDouble ? "double elimination" : "single elimination"} &middot; open the /tv link on the big screen
        </p>
      </div>

      {bracket.canManage && (
        <div className="px-6 pt-2 max-w-5xl mx-auto">
          <label className="gn-hint flex items-center gap-2" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              className="accent-[var(--gn-p2)]"
              style={{ width: "16px", height: "16px" }}
              checked={bracket.openScoring}
              onChange={async (e) => {
                await api(`/api/brackets/${id}/settings`, {
                  method: "PATCH",
                  body: JSON.stringify({ openScoring: e.target.checked }),
                });
                await load();
              }}
            />
            Let members record results too (admins always can).
          </label>
        </div>
      )}

      {bracket.champion?.kind === "player" && (
        <div className="gn-champ mx-6 mt-3 max-w-5xl md:mx-auto px-4 py-3 text-center">
          <span className="font-bold text-lg" style={{ color: "var(--gn-gold)" }}>
            🏆 {bracket.champion.displayName} wins it all
          </span>
          <button
            onClick={() => setShowRecap(true)}
            className="gn-btn block mx-auto mt-2"
            style={{ background: "var(--gn-gold)", color: "#2a2003", minHeight: "40px" }}
          >
            Share recap card
          </button>
        </div>
      )}

      {showRecap && <RecapModal view={bracket} onClose={() => setShowRecap(false)} />}

      <p className="px-6 pt-4 pb-1 max-w-5xl mx-auto" style={{ fontSize: "12px", color: "var(--gn-dim)" }}>
        {bracket.canScore
          ? "Tap a name to record the winner. Tap the winner again to undo. Scroll each row sideways for later rounds."
          : "Scoring is locked to group admins. Scroll each row sideways for later rounds."}
      </p>

      <div className="px-6 pb-12 pt-2 max-w-5xl mx-auto">
        <div className="gn-bkt-secs">
          <Section
            side="W"
            rounds={wb}
            tag={isDouble ? { label: "Winners Bracket", color: P2 } : null}
            canScore={bracket.canScore}
            onPick={record}
            onUndo={undo}
          />
          {lb.length > 0 && (
            <Section
              side="L"
              rounds={lb}
              tag={{ label: "Losers Bracket", color: P1 }}
              canScore={bracket.canScore}
              onPick={record}
              onUndo={undo}
            />
          )}
          {gf.length > 0 && (
            <GrandFinal
              matches={gf[0]!.matches}
              canScore={bracket.canScore}
              onPick={record}
              onUndo={undo}
            />
          )}
        </div>
      </div>
    </main>
  );
}

// ---- Section (one bracket half: a scrollable row of round columns) ----

function Section({
  side,
  rounds,
  tag,
  canScore,
  onPick,
  onUndo,
}: {
  side: Side;
  rounds: RoundView[];
  tag: { label: string; color: string } | null;
  canScore: boolean;
  onPick: (matchId: string, winner: "A" | "B") => void;
  onUndo: (matchId: string) => void;
}) {
  if (rounds.length === 0) return null;
  return (
    <section className="gn-bkt-sec">
      {tag && (
        <div className="gn-bkt-tag" style={{ color: tag.color, borderColor: tag.color }}>
          {tag.label}
        </div>
      )}
      <div className="gn-bkt-scroll">
        <div className="gn-bkt-row">
          {rounds.map((round, i) => (
            <Column
              key={`${round.title}-${i}`}
              round={round}
              side={side}
              index={i}
              cols={rounds.length}
              canScore={canScore}
              onPick={onPick}
              onUndo={onUndo}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// ---- Column (one round; cards centered + connector lines) ----

function Column({
  round,
  side,
  index,
  cols,
  canScore,
  onPick,
  onUndo,
}: {
  round: RoundView;
  side: Side;
  index: number;
  cols: number;
  canScore: boolean;
  onPick: (matchId: string, winner: "A" | "B") => void;
  onUndo: (matchId: string) => void;
}) {
  const slotH = slotHeight(side, index);
  const n = round.matches.length;
  const rightConn = joinsRight(side, index, cols);
  const leftConn = index > 0 && joinsRight(side, index - 1, cols);
  const totalH = Math.max(n * slotH, SLOT_BASE);
  const totalW = CARD_W + (leftConn ? CONN_W : 0) + (rightConn ? CONN_W : 0);

  return (
    <div style={{ flexShrink: 0 }}>
      <div className="gn-bkt-rt" style={{ marginLeft: leftConn ? CONN_W : 0, width: CARD_W }}>
        {round.title}
      </div>
      <div style={{ position: "relative", width: totalW, height: totalH }}>
        {round.matches.map((m, i) => {
          const cy = (i + 0.5) * slotH;
          return (
            <div
              key={m.id}
              style={{ position: "absolute", top: cy - CARD_H / 2, left: leftConn ? CONN_W : 0, width: CARD_W }}
            >
              <MatchCard m={m} canScore={canScore} onPick={onPick} onUndo={onUndo} />
            </div>
          );
        })}
        {leftConn &&
          round.matches.map((_, i) => {
            const cy = (i + 0.5) * slotH;
            return <div key={`l${i}`} style={{ position: "absolute", left: 0, top: cy - 1, width: CONN_W, height: 2, background: LINE }} />;
          })}
        {rightConn &&
          round.matches.map((_, i) => {
            const cy = (i + 0.5) * slotH;
            return <div key={`r${i}`} style={{ position: "absolute", right: 0, top: cy - 1, width: CONN_W, height: 2, background: LINE }} />;
          })}
        {rightConn &&
          Array.from({ length: Math.floor(n / 2) }, (_, pi) => {
            const topY = (2 * pi + 0.5) * slotH;
            const botY = (2 * pi + 1.5) * slotH;
            return <div key={`v${pi}`} style={{ position: "absolute", right: 0, top: topY, width: 2, height: botY - topY, background: LINE }} />;
          })}
      </div>
    </div>
  );
}

// ---- Grand Final (two sequential games, stacked, not a merge pair) ----

function GrandFinal({
  matches,
  canScore,
  onPick,
  onUndo,
}: {
  matches: BracketMatchView[];
  canScore: boolean;
  onPick: (matchId: string, winner: "A" | "B") => void;
  onUndo: (matchId: string) => void;
}) {
  return (
    <section className="gn-bkt-sec">
      <div className="gn-bkt-tag" style={{ color: GOLD, borderColor: GOLD }}>Grand Final</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: CARD_W }}>
        {matches.map((m) => (
          <div key={m.id}>
            <div className="gn-bkt-rt" style={{ width: CARD_W }}>
              {m.reset ? "Reset · winner takes all" : "Game 1"}
            </div>
            <MatchCard m={m} canScore={canScore} onPick={onPick} onUndo={onUndo} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- Match card + slots ----

function MatchCard({
  m,
  canScore,
  onPick,
  onUndo,
}: {
  m: BracketMatchView;
  canScore: boolean;
  onPick: (matchId: string, winner: "A" | "B") => void;
  onUndo: (matchId: string) => void;
}) {
  return (
    <div className={`gn-bkt-card ${m.playable ? "gn-bkt-card--live" : ""}`} style={{ height: CARD_H }}>
      <SlotRow slot={m.a} side="A" m={m} canScore={canScore} onPick={onPick} onUndo={onUndo} />
      <div className="gn-bkt-div" />
      <SlotRow slot={m.b} side="B" m={m} canScore={canScore} onPick={onPick} onUndo={onUndo} />
    </div>
  );
}

function SlotRow({
  slot,
  side,
  m,
  canScore,
  onPick,
  onUndo,
}: {
  slot: BracketSlot;
  side: "A" | "B";
  m: BracketMatchView;
  canScore: boolean;
  onPick: (matchId: string, winner: "A" | "B") => void;
  onUndo: (matchId: string) => void;
}) {
  const label = slot.kind === "player" ? slot.displayName : slot.kind === "bye" ? "bye" : "TBD";
  const isPlayer = slot.kind === "player";
  const winnerSeed = m.winner?.kind === "player" ? m.winner.seed : null;
  const isWinner = m.decided && isPlayer && winnerSeed === slot.seed;
  const isLoser = m.decided && isPlayer && winnerSeed !== null && winnerSeed !== slot.seed;

  const tone = !isPlayer
    ? "gn-bkt-slot--empty"
    : isWinner
      ? "gn-bkt-slot--win"
      : isLoser
        ? "gn-bkt-slot--lose"
        : "";

  // Undecided + real + you can score: tap to record this slot as the winner.
  if (m.playable && canScore && isPlayer) {
    return (
      <button className="gn-bkt-slot gn-bkt-slot--tap" onClick={() => onPick(m.id, side)}>
        <span className="gn-bkt-nm">{label}</span>
        <span className="gn-bkt-meta"><span className="gn-bkt-seed">#{slot.seed}</span></span>
      </button>
    );
  }
  // Recorded winner + you can score: tap again to undo (cascades downstream).
  if (isWinner && m.undoable && canScore) {
    return (
      <button className={`gn-bkt-slot ${tone} gn-bkt-slot--tap`} onClick={() => onUndo(m.id)} title="Tap to undo">
        <span className="gn-bkt-nm">{label}</span>
        <span className="gn-bkt-meta">🏆</span>
      </button>
    );
  }
  return (
    <div className={`gn-bkt-slot ${tone}`}>
      <span className="gn-bkt-nm">{label}</span>
      <span className="gn-bkt-meta">
        {isWinner ? "🏆" : isPlayer && !isLoser ? <span className="gn-bkt-seed">#{slot.seed}</span> : null}
      </span>
    </div>
  );
}

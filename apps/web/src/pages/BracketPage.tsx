import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type BracketView, type BracketSlot } from "../api";
import { RecapModal } from "../recap";
import BackButton from "../BackButton";

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

  async function record(matchId: string, winner: "A" | "B") {
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
  }

  async function undo(matchId: string) {
    if (busy || !window.confirm("Undo this result? Later results that depended on it clear too."))
      return;
    setBusy(true);
    try {
      await api(`/api/brackets/${id}/matches/${matchId}/result`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

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

  return (
    <main className="gn-app">
      <div className="p-6 pb-2 max-w-3xl mx-auto">
        <BackButton />
        <div className="flex items-center justify-between mt-2 gap-2">
          <h1 className="gn-title text-2xl">{bracket.gameName}</h1>
          <Link to={`/tv/${bracket.id}`} className="gn-btn gn-btn--ghost shrink-0" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            📺 TV mode
          </Link>
        </div>
        <p className="gn-hint" style={{ fontSize: "13px" }}>
          {bracket.entrantCount} players &middot; {bracket.format === "double_elim" ? "double elimination" : "single elimination"} &middot; open /tv link on the big screen
        </p>
      </div>

      {bracket.canManage && (
        <div className="px-6 pt-2 max-w-3xl mx-auto">
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
        <div className="gn-champ mx-6 mt-3 max-w-3xl md:mx-auto px-4 py-3 text-center">
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

      <p className="px-6 pt-4 pb-1 max-w-3xl mx-auto" style={{ fontSize: "12px", color: "var(--gn-dim)" }}>
        {bracket.canScore
          ? "Tap a name to record the winner. Swipe sideways for later rounds."
          : "Scoring is locked to group admins. Swipe sideways for later rounds."}
      </p>

      <div className="flex gap-4 overflow-x-auto px-6 pb-10 pt-2 snap-x">
        {bracket.rounds.map((round) => (
          <section key={round.title} className="shrink-0 w-64 snap-start space-y-3">
            <h2 className="gn-tv-round" style={{ fontSize: "13px", letterSpacing: "1px" }}>
              {round.title}
            </h2>
            {round.matches.map((m) => (
              <div key={m.id} className={`gn-match ${m.playable ? "gn-match--live" : ""}`}>
                {m.reset && (
                  <p className="gn-hint" style={{ fontSize: "11px", padding: "4px 8px 0", margin: 0 }}>
                    bracket reset — winner takes it all
                  </p>
                )}
                <SlotRow
                  slot={m.a}
                  isWinner={m.decided && m.winner?.kind === "player" && m.winner.seed === (m.a as any).seed}
                  playable={m.playable && bracket.canScore}
                  faded={m.decided && m.winner?.kind === "player" && m.winner.seed !== (m.a as any).seed}
                  onPick={() => record(m.id, "A")}
                />
                <div className="gn-slot__div" />
                <SlotRow
                  slot={m.b}
                  isWinner={m.decided && m.winner?.kind === "player" && m.winner.seed === (m.b as any).seed}
                  playable={m.playable && bracket.canScore}
                  faded={m.decided && m.winner?.kind === "player" && m.winner.seed !== (m.b as any).seed}
                  onPick={() => record(m.id, "B")}
                />
                {m.undoable && bracket.canScore && (
                  <button onClick={() => undo(m.id)} className="gn-undo">
                    undo
                  </button>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}

function SlotRow({
  slot,
  isWinner,
  faded,
  playable,
  onPick,
}: {
  slot: BracketSlot;
  isWinner: boolean | null | undefined;
  faded: boolean | null | undefined;
  playable: boolean;
  onPick: () => void;
}) {
  const label =
    slot.kind === "player" ? slot.displayName : slot.kind === "bye" ? "bye" : "TBD";

  const tone =
    slot.kind !== "player"
      ? "gn-slot--empty"
      : isWinner
        ? "gn-slot--win"
        : faded
          ? "gn-slot--lose"
          : "";

  if (playable && slot.kind === "player") {
    return (
      <button onClick={onPick} className={`gn-slot gn-slot--tap ${tone}`}>
        <span className="truncate">{label}</span>
        <span className="gn-slot__hint">tap to win</span>
      </button>
    );
  }
  return (
    <div className={`gn-slot ${tone}`}>
      <span className="truncate">{label}</span>
      {slot.kind === "player" && <span className="gn-slot__seed">#{slot.seed}</span>}
    </div>
  );
}

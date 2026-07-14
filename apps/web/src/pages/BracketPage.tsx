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
      <main className="min-h-dvh bg-neutral-950 text-neutral-100 p-6">
        <p className="text-red-400">{error}</p>
      </main>
    );
  }
  if (!bracket) {
    return (
      <main className="min-h-dvh bg-neutral-950 text-neutral-100 p-6">
        <p className="text-neutral-500">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100">
      <div className="p-6 pb-2 max-w-3xl mx-auto">
        <BackButton />
        <div className="flex items-center justify-between mt-2">
          <h1 className="text-2xl font-bold tracking-tight">{bracket.gameName}</h1>
          <Link
            to={`/tv/${bracket.id}`}
            className="rounded-lg bg-neutral-800 px-3 py-2 text-sm shrink-0"
          >
            TV mode
          </Link>
        </div>
        <p className="text-neutral-500 text-sm">
          {bracket.entrantCount} players &middot; single elimination &middot; open /tv link on the big screen
        </p>
      </div>

      {bracket.canManage && (
        <div className="px-6 pt-2 max-w-3xl mx-auto">
          <label className="flex items-center gap-2 text-sm text-neutral-400">
            <input
              type="checkbox"
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
        <div className="mx-6 mt-3 max-w-3xl md:mx-auto rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-center">
          <span className="text-yellow-400 font-bold text-lg">
            {bracket.champion.displayName} wins it all
          </span>
          <button
            onClick={() => setShowRecap(true)}
            className="block mx-auto mt-2 rounded-lg bg-yellow-500 text-neutral-950 font-semibold px-4 py-2 text-sm"
          >
            Share recap card
          </button>
        </div>
      )}

      {showRecap && <RecapModal view={bracket} onClose={() => setShowRecap(false)} />}

      <p className="px-6 pt-4 pb-1 text-xs text-neutral-600 max-w-3xl mx-auto">
        {bracket.canScore
          ? "Tap a name to record the winner. Swipe sideways for later rounds."
          : "Scoring is locked to group admins. Swipe sideways for later rounds."}
      </p>

      <div className="flex gap-4 overflow-x-auto px-6 pb-10 pt-2 snap-x">
        {bracket.rounds.map((round) => (
          <section key={round.title} className="shrink-0 w-64 snap-start space-y-3">
            <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">
              {round.title}
            </h2>
            {round.matches.map((m) => (
              <div
                key={m.id}
                className="rounded-lg bg-neutral-900 border border-neutral-800 overflow-hidden"
              >
                <SlotRow
                  slot={m.a}
                  isWinner={m.decided && m.winner?.kind === "player" && m.winner.seed === (m.a as any).seed}
                  playable={m.playable && bracket.canScore}
                  faded={m.decided && m.winner?.kind === "player" && m.winner.seed !== (m.a as any).seed}
                  onPick={() => record(m.id, "A")}
                />
                <div className="border-t border-neutral-800" />
                <SlotRow
                  slot={m.b}
                  isWinner={m.decided && m.winner?.kind === "player" && m.winner.seed === (m.b as any).seed}
                  playable={m.playable && bracket.canScore}
                  faded={m.decided && m.winner?.kind === "player" && m.winner.seed !== (m.b as any).seed}
                  onPick={() => record(m.id, "B")}
                />
                {m.undoable && bracket.canScore && (
                  <button
                    onClick={() => undo(m.id)}
                    className="w-full text-xs text-neutral-600 py-1 border-t border-neutral-800"
                  >
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

  const base = "w-full text-left px-4 py-3 flex justify-between items-center";
  const toneClass =
    slot.kind !== "player"
      ? "text-neutral-600 italic"
      : isWinner
        ? "text-green-400 font-semibold"
        : faded
          ? "text-neutral-600 line-through"
          : "text-neutral-100";

  if (playable && slot.kind === "player") {
    return (
      <button onClick={onPick} className={`${base} ${toneClass} active:bg-neutral-800`}>
        <span>{label}</span>
        <span className="text-xs text-neutral-600">tap to win</span>
      </button>
    );
  }
  return (
    <div className={`${base} ${toneClass}`}>
      <span>{label}</span>
      {slot.kind === "player" && <span className="text-xs text-neutral-700">#{slot.seed}</span>}
    </div>
  );
}

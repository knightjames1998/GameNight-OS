import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { api, type BracketView, type BracketMatchView } from "../api";
import BackButton from "../BackButton";

// The Broadcast view. Design target: a 75" TV at couch distance. A full
// bracket tree is unreadable from across a room, so — like the Beerio pack's
// TV mode — this surfaces what actually matters live: the matchups on deck
// and the latest results, in type sized to read from the couch. Styled in
// the Arcade language; branded packs bring their own TV mode.

type TvView = BracketView & { groupName: string };
type FlatMatch = BracketMatchView & { round: string };

export default function TvPage() {
  const { id } = useParams();
  const [bracket, setBracket] = useState<TvView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBracket(await api<TvView>(`/api/tv/${id}`));
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
          // Not ours.
        }
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
    }
    connect();

    // TVs sleep too; catch up whenever we become visible.
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

  if (error) {
    return (
      <main className="gn-tv flex items-center justify-center">
        <p className="text-3xl" style={{ color: "var(--gn-danger)" }}>{error}</p>
      </main>
    );
  }
  if (!bracket) {
    return (
      <main className="gn-tv flex items-center justify-center">
        <p className="gn-hint text-3xl">Loading...</p>
      </main>
    );
  }

  const scoreUrl = `${window.location.origin}/b/${bracket.id}`;
  const all: FlatMatch[] = bracket.rounds.flatMap((r) =>
    r.matches.map((m) => ({ ...m, round: r.title })),
  );
  // On deck: both seats filled, nobody's won yet. Decided: real results
  // (skip bye walkovers). "Latest" leans on structure order — later rounds
  // sit last — which reads as recency closely enough without timestamps.
  const live = all.filter((m) => m.playable);
  const decided = all.filter((m) => m.decided && !m.auto);
  const latest = decided.slice(-6).reverse();
  const isChamp = bracket.champion?.kind === "player";

  return (
    <main className="gn-tv flex flex-col" style={{ padding: "calc(2.5rem + env(safe-area-inset-top, 0px)) calc(2.5rem + env(safe-area-inset-right, 0px)) calc(2.5rem + env(safe-area-inset-bottom, 0px)) calc(2.5rem + env(safe-area-inset-left, 0px))" }}>
      <header className="flex items-start justify-between gap-6 shrink-0">
        <div>
          <BackButton className="!text-lg mb-2 block" />
          <h1 className="gn-tv-title text-6xl">{bracket.gameName}</h1>
          <p className="text-2xl mt-3 flex items-center gap-4 flex-wrap" style={{ color: "var(--gn-dim)" }}>
            <span>
              {bracket.groupName} &middot; {bracket.entrantCount} players &middot;{" "}
              {bracket.format === "double_elim" ? "double elim" : "single elim"}
            </span>
            <span className="inline-flex items-center gap-2" style={{ color: "var(--gn-yes)" }}>
              <span className="gn-live-dot gn-pulse" />
              live
            </span>
          </p>
        </div>
        <div className="text-center shrink-0">
          <div className="bg-white p-2 rounded-lg">
            <QRCodeSVG value={scoreUrl} size={110} fgColor="#17111f" />
          </div>
          <p className="gn-hint text-sm mt-1">scan to score</p>
        </div>
      </header>

      {isChamp && (
        <div className="gn-tv-champ mt-8 px-8 py-6 text-center shrink-0">
          <p className="text-2xl uppercase tracking-widest" style={{ color: "var(--gn-gold)" }}>Champion</p>
          <p className="gn-tv-title text-7xl mt-2" style={{ color: "var(--gn-gold)" }}>
            {bracket.champion!.kind === "player" ? bracket.champion!.displayName : ""}
          </p>
        </div>
      )}

      <div className="gn-tv-cols">
        {!isChamp && (
          <section className="flex flex-col min-h-0">
            <h2 className="gn-tv-h2">On deck <span>{live.length} ready</span></h2>
            <div className="gn-tv-stack">
              {live.length === 0 ? (
                <p className="gn-tv-empty">Waiting on the next matchup…</p>
              ) : (
                live.slice(0, 5).map((m) => <TvMatch key={m.id} m={m} live />)
              )}
            </div>
          </section>
        )}

        <section className="flex flex-col min-h-0">
          <h2 className="gn-tv-h2">
            Latest results <span>{decided.length} played</span>
          </h2>
          <div className="gn-tv-stack">
            {latest.length === 0 ? (
              <p className="gn-tv-empty">No results yet.</p>
            ) : (
              latest.map((m) => <TvMatch key={m.id} m={m} />)
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function TvMatch({ m, live }: { m: FlatMatch; live?: boolean }) {
  const winnerSeed = m.winner?.kind === "player" ? m.winner.seed : null;
  return (
    <div className={`gn-tvm ${live ? "gn-tvm--live" : ""}`}>
      <div className="gn-tvm__rt">{m.round}</div>
      <TvRow slot={m.a} decided={m.decided} winnerSeed={winnerSeed} />
      <div className="gn-tvm__div" />
      <TvRow slot={m.b} decided={m.decided} winnerSeed={winnerSeed} />
    </div>
  );
}

function TvRow({
  slot,
  decided,
  winnerSeed,
}: {
  slot: BracketMatchView["a"];
  decided: boolean;
  winnerSeed: number | null;
}) {
  const isPlayer = slot.kind === "player";
  const label = isPlayer ? slot.displayName : slot.kind === "bye" ? "bye" : "TBD";
  const won = decided && isPlayer && winnerSeed === slot.seed;
  const lost = decided && isPlayer && winnerSeed !== null && winnerSeed !== slot.seed;
  const tone = won ? "gn-tvm__row--win" : lost ? "gn-tvm__row--lose" : "";
  return (
    <div className={`gn-tvm__row ${tone}`}>
      <span className="gn-tvm__nm">{label}</span>
      {won ? <span>🏆</span> : isPlayer ? <span className="gn-tvm__seed">#{slot.seed}</span> : null}
    </div>
  );
}

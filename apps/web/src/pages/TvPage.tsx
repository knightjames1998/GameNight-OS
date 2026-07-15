import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { api, type BracketView } from "../api";
import BackButton from "../BackButton";

// The Broadcast view. Design target: a 75" TV at couch distance. That
// means: huge type, high contrast, zero interaction, information visible
// from across the room. This page never asks for login; the bracket UUID
// in the URL is the (unguessable) key. Styled in the Arcade language so
// the big screen matches the app; branded packs bring their own TV mode.

type TvView = BracketView & { groupName: string };

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

  return (
    <main className="gn-tv flex flex-col p-10">
      <header className="flex items-start justify-between gap-6">
        <div>
          <BackButton className="!text-lg mb-2 block" />
          <h1 className="gn-tv-title text-6xl">{bracket.gameName}</h1>
          <p className="text-2xl mt-3 flex items-center gap-4" style={{ color: "var(--gn-dim)" }}>
            <span>{bracket.groupName} &middot; {bracket.entrantCount} players</span>
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

      {bracket.champion?.kind === "player" && (
        <div className="gn-tv-champ mt-8 px-8 py-6 text-center">
          <p className="text-2xl uppercase tracking-widest" style={{ color: "var(--gn-gold)" }}>Champion</p>
          <p className="gn-tv-title text-7xl mt-2" style={{ color: "var(--gn-gold)" }}>
            {bracket.champion.displayName}
          </p>
        </div>
      )}

      <div className="flex-1 flex gap-10 mt-10 items-start justify-center">
        {bracket.rounds.map((round) => (
          <section key={round.title} className="flex-1 max-w-md flex flex-col justify-around self-stretch gap-6">
            <h2 className="gn-tv-round text-2xl text-center">{round.title}</h2>
            <div className="flex-1 flex flex-col justify-around gap-6">
              {round.matches.map((m) => (
                <div key={m.id} className={`gn-tv-match ${m.playable ? "gn-tv-match--live" : ""}`}>
                  <TvSlot
                    label={m.a.kind === "player" ? m.a.displayName : m.a.kind === "bye" ? "bye" : "—"}
                    won={m.decided && m.winner?.kind === "player" && m.winner.seed === (m.a as any).seed}
                    lost={m.decided && m.winner?.kind === "player" && m.winner.seed !== (m.a as any).seed}
                    real={m.a.kind === "player"}
                  />
                  <div className="gn-tv-slot__div" />
                  <TvSlot
                    label={m.b.kind === "player" ? m.b.displayName : m.b.kind === "bye" ? "bye" : "—"}
                    won={m.decided && m.winner?.kind === "player" && m.winner.seed === (m.b as any).seed}
                    lost={m.decided && m.winner?.kind === "player" && m.winner.seed !== (m.b as any).seed}
                    real={m.b.kind === "player"}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

function TvSlot({
  label,
  won,
  lost,
  real,
}: {
  label: string;
  won: boolean | null | undefined;
  lost: boolean | null | undefined;
  real: boolean;
}) {
  const tone = !real ? "gn-tv-slot--empty" : won ? "gn-tv-slot--win" : lost ? "gn-tv-slot--lose" : "";
  return <div className={`gn-tv-slot text-3xl ${tone}`}>{label}</div>;
}

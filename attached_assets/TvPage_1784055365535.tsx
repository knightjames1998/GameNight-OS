import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { api, type BracketView } from "../api";
import BackButton from "../BackButton";

// The Broadcast view. Design target: a 75" TV at couch distance. That
// means: huge type, high contrast, zero interaction, information visible
// from across the room. This page never asks for login; the bracket UUID
// in the URL is the (unguessable) key.

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
      <main className="min-h-dvh bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <p className="text-red-400 text-3xl">{error}</p>
      </main>
    );
  }
  if (!bracket) {
    return (
      <main className="min-h-dvh bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <p className="text-neutral-600 text-3xl">Loading...</p>
      </main>
    );
  }

  const scoreUrl = `${window.location.origin}/b/${bracket.id}`;

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 flex flex-col p-10 overflow-hidden">
      <header className="flex items-start justify-between">
        <div>
          <BackButton className="!text-lg mb-2 block" />
          <h1 className="text-6xl font-black tracking-tight">{bracket.gameName}</h1>
          <p className="text-2xl text-neutral-500 mt-2">
            {bracket.groupName} &middot; {bracket.entrantCount} players
            <span className="ml-4 inline-flex items-center gap-2 text-green-500">
              <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
              live
            </span>
          </p>
        </div>
        <div className="text-center shrink-0">
          <div className="bg-white p-2 rounded-lg">
            <QRCodeSVG value={scoreUrl} size={110} />
          </div>
          <p className="text-neutral-600 text-sm mt-1">scan to score</p>
        </div>
      </header>

      {bracket.champion?.kind === "player" && (
        <div className="mt-8 rounded-2xl border-2 border-yellow-500/60 bg-yellow-500/10 px-8 py-6 text-center">
          <p className="text-yellow-500 text-2xl uppercase tracking-widest">Champion</p>
          <p className="text-7xl font-black text-yellow-400 mt-2">
            {bracket.champion.displayName}
          </p>
        </div>
      )}

      <div className="flex-1 flex gap-10 mt-10 items-start justify-center">
        {bracket.rounds.map((round) => (
          <section key={round.title} className="flex-1 max-w-md flex flex-col justify-around self-stretch gap-6">
            <h2 className="text-2xl font-bold text-neutral-400 uppercase tracking-widest text-center">
              {round.title}
            </h2>
            <div className="flex-1 flex flex-col justify-around gap-6">
              {round.matches.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-xl border-2 overflow-hidden ${
                    m.playable ? "border-green-500/50" : "border-neutral-800"
                  } bg-neutral-900`}
                >
                  <TvSlot
                    label={m.a.kind === "player" ? m.a.displayName : m.a.kind === "bye" ? "bye" : "—"}
                    won={m.decided && m.winner?.kind === "player" && m.winner.seed === (m.a as any).seed}
                    lost={m.decided && m.winner?.kind === "player" && m.winner.seed !== (m.a as any).seed}
                    real={m.a.kind === "player"}
                  />
                  <div className="border-t-2 border-neutral-800" />
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
  return (
    <div
      className={`px-6 py-4 text-3xl font-bold truncate ${
        !real
          ? "text-neutral-700 italic font-normal"
          : won
            ? "text-green-400 bg-green-500/10"
            : lost
              ? "text-neutral-600 line-through"
              : "text-neutral-100"
      }`}
    >
      {label}
    </div>
  );
}

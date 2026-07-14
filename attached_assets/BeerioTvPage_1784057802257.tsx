import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  buildBracket,
  compute,
  getChampion,
  gpStandings,
  isRealPlayer,
  type MatchResult,
  type SavedState,
} from "./BeerioApp";
import "./beerio.css";

// Beerio Kart TV mode. Reads the SAME public live-session endpoint the
// spectator view uses (/api/sessions/:code) and renders with the SAME
// engine functions the host runs, so the big screen can never disagree
// with the phones. Read-only, no login, designed for a 75" at couch
// distance: huge type, high contrast, no interaction.

const POLL_MS = 3000;

/** { spectatorId: { name, picks: { "M:<matchId>": "A"|"B", "H:<i>": "<seed>" } } } */
type PredMap = Record<string, { name?: string; picks?: Record<string, string> }>;

export default function BeerioTvPage() {
  const { code } = useParams();
  const [state, setState] = useState<SavedState | null>(null);
  const [preds, setPreds] = useState<PredMap>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/sessions/${code}`);
      if (!r.ok) throw new Error("That live room doesn't exist (or the night ended).");
      const d = await r.json();
      setState(d.state as SavedState);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      return;
    }
    try {
      const p = await fetch(`/api/sessions/${code}/predictions`);
      if (p.ok) setPreds(((await p.json()).predictions ?? {}) as PredMap);
    } catch {
      // Predictions are a garnish; never let them break the board.
    }
  }, [code]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const joinUrl =
    typeof window !== "undefined" ? `${window.location.origin}/beerio?s=${code}` : "";

  if (error) {
    return (
      <Shell>
        <p className="text-[3vw] font-[Fredoka] font-bold text-[var(--ink)]">{error}</p>
      </Shell>
    );
  }
  if (!state) {
    return (
      <Shell>
        <p className="text-[3vw] font-[Fredoka] font-bold text-[var(--ink)] opacity-60">
          Connecting to the room...
        </p>
      </Shell>
    );
  }

  const isGP = state.format?.mode === "gp";
  return (
    <Shell>
      <Header code={String(code)} joinUrl={joinUrl} isGP={isGP} />
      {isGP ? <GpBoard state={state} preds={preds} /> : <BracketBoard state={state} preds={preds} />}
    </Shell>
  );
}

/** Count spectator picks for one predictable item. */
function tally(preds: PredMap, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of Object.values(preds)) {
    const v = p?.picks?.[key];
    if (typeof v === "string") out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

/** The crowd's call, as a two-sided bar. Hidden until someone has voted. */
function PredictionBar({
  options,
  counts,
}: {
  options: { label: string; color: string; value: string }[];
  counts: Record<string, number>;
}) {
  const total = options.reduce((n, o) => n + (counts[o.value] ?? 0), 0);
  if (total === 0) return null;
  return (
    <div className="px-[1.2vw] pb-[0.9vw]">
      <div className="flex items-center justify-between font-[Fredoka] font-semibold text-[1vw] text-[var(--ink)] opacity-70 mb-[0.4vw]">
        <span>Crowd says</span>
        <span>
          {total} {total === 1 ? "vote" : "votes"}
        </span>
      </div>
      <div className="flex h-[1.4vw] rounded-full overflow-hidden border-[2px] border-[var(--ink)]">
        {options.map((o) => {
          const n = counts[o.value] ?? 0;
          if (n === 0) return null;
          return (
            <div
              key={o.value}
              className="flex items-center justify-center font-[Fredoka] font-bold text-[0.9vw] text-[var(--ink)]"
              style={{ width: `${(n / total) * 100}%`, background: o.color }}
            >
              {Math.round((n / total) * 100)}%
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="beerio-root min-h-dvh w-full overflow-hidden flex flex-col p-[2vw] gap-[1.5vw]">
      {children}
    </div>
  );
}

function Header({ code, joinUrl, isGP }: { code: string; joinUrl: string; isGP: boolean }) {
  return (
    <header className="flex items-start justify-between gap-6 shrink-0">
      <div>
        <button
          onClick={() => { if (window.history.length > 1) history.back(); else location.href = "/"; }}
          className="mb-[0.8vw] px-[1.2vw] py-[0.5vw] rounded-[10px] border-[3px] border-[var(--ink)] bg-[var(--foam)] font-[Fredoka] font-semibold text-[1.2vw] text-[var(--ink)] shadow-[0_3px_0_rgba(22,35,59,.22)] cursor-pointer"
        >
          &larr; Back
        </button>
        <h1
          className="font-[Luckiest_Guy,cursive] text-[5.5vw] leading-none m-0 tracking-wide text-[var(--sun)]"
          style={{ WebkitTextStroke: "3px var(--ink)", textShadow: "6px 6px 0 var(--ink)", transform: "rotate(-2deg)" }}
        >
          BEERIO KART
        </h1>
        <div className="mt-[1vw] inline-flex items-center gap-3 font-[Fredoka] font-semibold text-[1.5vw] text-[var(--ink)] bg-[var(--foam)] border-[3px] border-[var(--ink)] rounded-full px-[1.5vw] py-[0.5vw] shadow-[0_3px_0_rgba(22,35,59,.22)]">
          <span className="w-[0.8vw] h-[0.8vw] rounded-full bg-[var(--grass)] animate-pulse shadow-[0_0_0_2px_var(--ink)]" />
          LIVE &middot; Room {code} &middot; {isGP ? "Grand Prix" : "Double Elimination"}
        </div>
      </div>
      <div className="text-center shrink-0">
        <div className="bg-white p-[0.6vw] rounded-[10px] border-[3px] border-[var(--ink)]">
          <QRCodeSVG value={joinUrl} size={120} />
        </div>
        <p className="font-[Fredoka] font-semibold text-[1vw] text-[var(--ink)] mt-1">scan to watch</p>
      </div>
    </header>
  );
}

// ---------- Grand Prix ----------

function GpBoard({ state, preds }: { state: SavedState; preds: PredMap }) {
  const realCount = state.names.filter((n) => n && n.trim()).length;
  const rows = useMemo(
    () => gpStandings(realCount, state.gpLog ?? []),
    [realCount, state.gpLog],
  );
  const races = state.gpLog?.length ?? 0;
  const nextKey = `H:${races}`;
  const counts = tally(preds, nextKey);
  const voted = Object.values(counts).reduce((a, b) => a + b, 0) > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {voted && (
        <div className="mb-[1vw] border-[3px] border-[var(--ink)] rounded-[14px] bg-[var(--foam)] pt-[0.8vw] shadow-[0_4px_0_rgba(22,35,59,.18)]">
          <p className="font-[Fredoka] font-bold text-[1.4vw] text-[var(--ink)] px-[1.2vw]">
            Race {races + 1} &middot; who takes it?
          </p>
          <PredictionBar
            options={rows.map((r) => ({
              label: state.names[r.seed] || `Racer ${r.seed + 1}`,
              color: state.colors?.[r.seed] ?? "var(--foam)",
              value: String(r.seed),
            }))}
            counts={counts}
          />
        </div>
      )}
      <h2 className="font-[Fredoka] font-bold text-[2vw] text-[var(--ink)] mb-[1vw]">
        Standings <span className="opacity-60">&middot; {races} races in</span>
      </h2>
      <div className="flex-1 flex flex-col gap-[0.8vw] min-h-0">
        {rows.map((r) => {
          const color = state.colors?.[r.seed] ?? "var(--foam)";
          const leader = r.rank === 1 && races > 0;
          return (
            <div
              key={r.seed}
              className="flex items-center gap-[1.5vw] border-[3px] border-[var(--ink)] rounded-[14px] px-[1.5vw] py-[0.9vw] shadow-[0_4px_0_rgba(22,35,59,.18)]"
              style={{ background: leader ? "var(--sun)" : "var(--foam)" }}
            >
              <span className="font-[Luckiest_Guy,cursive] text-[2.6vw] text-[var(--ink)] w-[4vw]">
                {r.rank}
              </span>
              <span
                className="w-[2.2vw] h-[2.2vw] rounded-full border-[3px] border-[var(--ink)] shrink-0"
                style={{ background: color }}
              />
              <span className="font-[Fredoka] font-bold text-[2.4vw] text-[var(--ink)] flex-1 truncate">
                {state.names[r.seed] || `Racer ${r.seed + 1}`}
              </span>
              <span className="font-[Fredoka] text-[1.4vw] text-[var(--ink)] opacity-70">
                {r.wins} {r.wins === 1 ? "win" : "wins"} &middot; {r.races} raced
              </span>
              <span className="font-[Luckiest_Guy,cursive] text-[3vw] text-[var(--ink)] w-[6vw] text-right">
                {r.points}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Double elimination ----------

function BracketBoard({ state, preds }: { state: SavedState; preds: PredMap }) {
  const M = useMemo(() => {
    try {
      const BR = buildBracket(state.playerCount);
      return compute(BR, state.names, state.results ?? {});
    } catch {
      return {} as Record<string, MatchResult>;
    }
  }, [state.playerCount, state.names, state.results]);

  const all = Object.values(M).filter((m) => m.active && !m.phantom);
  const champ = getChampion(M);
  // Ready to play: both seats filled, nobody has won it yet.
  const live = all.filter(
    (m) => !m.decided && isRealPlayer(m.a) && isRealPlayer(m.b),
  );
  const recent = all.filter((m) => m.decided && !m.auto).slice(-6).reverse();

  return (
    <div className="flex-1 grid grid-cols-2 gap-[2vw] min-h-0">
      <section className="flex flex-col min-h-0">
        <h2 className="font-[Fredoka] font-bold text-[2vw] text-[var(--ink)] mb-[1vw]">Up next</h2>
        <div className="flex flex-col gap-[1vw] overflow-hidden">
          {live.length === 0 && (
            <p className="font-[Fredoka] text-[1.6vw] text-[var(--ink)] opacity-50">
              Waiting on the next matchup...
            </p>
          )}
          {live.slice(0, 4).map((m) => (
            <MatchCard key={m.def.id} m={m} state={state} preds={preds} highlight />
          ))}
        </div>
      </section>

      <section className="flex flex-col min-h-0">
        <h2 className="font-[Fredoka] font-bold text-[2vw] text-[var(--ink)] mb-[1vw]">
          {champ ? "Champion" : "Just finished"}
        </h2>
        {champ ? (
          <div className="border-[4px] border-[var(--ink)] rounded-[18px] bg-[var(--sun)] px-[2vw] py-[2.5vw] text-center shadow-[0_6px_0_rgba(22,35,59,.22)]">
            <p className="font-[Fredoka] font-bold text-[1.6vw] text-[var(--ink)] uppercase tracking-widest">
              Champion
            </p>
            <p className="font-[Luckiest_Guy,cursive] text-[5vw] text-[var(--ink)] leading-tight mt-[0.5vw]">
              {champ.name ?? `Racer ${champ.seed + 1}`}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-[0.8vw] overflow-hidden">
            {recent.length === 0 && (
              <p className="font-[Fredoka] text-[1.6vw] text-[var(--ink)] opacity-50">
                No results yet.
              </p>
            )}
            {recent.map((m) => (
              <MatchCard key={m.def.id} m={m} state={state} preds={preds} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MatchCard({
  m,
  state,
  preds,
  highlight,
}: {
  m: MatchResult;
  state: SavedState;
  preds: PredMap;
  highlight?: boolean;
}) {
  const Row = ({ side }: { side: "a" | "b" }) => {
    const c = m[side];
    const real = isRealPlayer(c);
    const seed = real ? c.seed : undefined;
    const label = real ? (c.name ?? `Racer ${c.seed + 1}`) : "TBD";
    const won = m.decided && m.winSlot === (side === "a" ? "A" : "B");
    const lost = m.decided && !won && real;
    return (
      <div
        className="flex items-center gap-[1vw] px-[1.2vw] py-[0.7vw]"
        style={{ background: won ? "rgba(94,193,109,0.25)" : "transparent" }}
      >
        <span
          className="w-[1.6vw] h-[1.6vw] rounded-full border-[3px] border-[var(--ink)] shrink-0"
          style={{ background: seed !== undefined ? (state.colors?.[seed] ?? "var(--foam)") : "transparent" }}
        />
        <span
          className={`font-[Fredoka] font-bold text-[1.9vw] text-[var(--ink)] flex-1 truncate ${
            lost ? "opacity-40 line-through" : ""
          }`}
        >
          {label}
        </span>
        {won && <span className="text-[1.6vw]">🏆</span>}
      </div>
    );
  };

  return (
    <div
      className="border-[3px] border-[var(--ink)] rounded-[14px] overflow-hidden bg-[var(--foam)] shadow-[0_4px_0_rgba(22,35,59,.18)]"
      style={highlight ? { borderColor: "var(--grass)" } : undefined}
    >
      <Row side="a" />
      <div className="border-t-[3px] border-[var(--ink)]" />
      <Row side="b" />
      {highlight && isRealPlayer(m.a) && isRealPlayer(m.b) && (
        <PredictionBar
          options={[
            {
              label: m.a.name ?? "A",
              color: state.colors?.[m.a.seed - 1] ?? "var(--foam)",
              value: "A",
            },
            {
              label: m.b.name ?? "B",
              color: state.colors?.[m.b.seed - 1] ?? "var(--foam)",
              value: "B",
            },
          ]}
          counts={tally(preds, `M:${m.def.id}`)}
        />
      )}
    </div>
  );
}

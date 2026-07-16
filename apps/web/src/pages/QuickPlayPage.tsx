import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import BackButton from "../BackButton";

// Quick play: run a bracket with typed names, no crew or event setup.
// Under the hood it still lives in a (hidden) personal crew, so scoring,
// the TV view and the recap card all work exactly as they do for crews.

export default function QuickPlayPage() {
  const navigate = useNavigate();
  const [gameName, setGameName] = useState("");
  const [format, setFormat] = useState<"single_elim" | "double_elim">("single_elim");
  const [names, setNames] = useState<string[]>(["", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filled = names.map((n) => n.trim()).filter(Boolean);

  async function start() {
    if (filled.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const b = await api<{ id: string }>("/api/quickplay/bracket", {
        method: "POST",
        body: JSON.stringify({ gameName, names, format }),
      });
      navigate(`/b/${b.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start");
      setBusy(false);
    }
  }

  return (
    <main className="gn-app">
      <div className="gn-wrap space-y-6">
        <BackButton />

        <div>
          <h1 className="gn-title text-2xl">🏆 Quick play</h1>
          <p className="gn-hint mt-1">
            A generalized bracket with typed-in names. No crew, no RSVPs. Players are
            guests, so nothing counts toward lifetime stats.
          </p>
        </div>

        <section className="space-y-2">
          <label className="gn-lab" htmlFor="qp-game">What are you playing?</label>
          <input
            id="qp-game"
            value={gameName}
            onChange={(e) => setGameName(e.target.value)}
            placeholder="Game name (optional)"
            maxLength={50}
            className="gn-input"
          />
        </section>

        <section className="space-y-2">
          <label className="gn-lab" htmlFor="qp-format">Format</label>
          <select
            id="qp-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as "single_elim" | "double_elim")}
            className="gn-input"
          >
            <option value="single_elim">Single elimination</option>
            <option value="double_elim">Double elimination (losers bracket + grand final)</option>
          </select>
        </section>

        <section className="space-y-2">
          <label className="gn-lab">
            Players <span style={{ color: "var(--gn-dim)", fontWeight: 400 }}>({filled.length})</span>
          </label>
          {names.map((n, i) => (
            <input
              key={i}
              value={n}
              onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={`Player ${i + 1}`}
              maxLength={24}
              className="gn-input"
            />
          ))}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setNames([...names, ""])}
              disabled={names.length >= 32}
              className="gn-btn gn-btn--ghost"
            >
              Add player
            </button>
            {names.length > 2 && (
              <button
                onClick={() => setNames(names.slice(0, -1))}
                className="gn-btn gn-btn--ghost"
              >
                Remove last
              </button>
            )}
          </div>
        </section>

        {error && <p style={{ color: "var(--gn-danger)" }} className="text-sm">{error}</p>}

        <button
          onClick={start}
          disabled={filled.length < 2 || busy}
          className="gn-btn gn-btn--p1 w-full"
        >
          {busy ? "Starting..." : `Start bracket (${filled.length} players)`}
        </button>
      </div>
    </main>
  );
}

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
        body: JSON.stringify({ gameName, names }),
      });
      navigate(`/b/${b.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start");
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-2 outline-none focus:border-neutral-600";

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 p-6 max-w-md mx-auto space-y-6">
      <BackButton />

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Quick play</h1>
        <p className="text-neutral-500 text-sm mt-1">
          A generalized bracket with typed-in names. No crew, no RSVPs. Players are
          guests, so nothing counts toward lifetime stats.
        </p>
      </div>

      <section className="space-y-2">
        <label className="block text-sm text-neutral-400">What are you playing?</label>
        <input
          value={gameName}
          onChange={(e) => setGameName(e.target.value)}
          placeholder="Game name (optional)"
          maxLength={50}
          className={input}
        />
      </section>

      <section className="space-y-2">
        <label className="block text-sm text-neutral-400">
          Players <span className="text-neutral-600">({filled.length})</span>
        </label>
        {names.map((n, i) => (
          <input
            key={i}
            value={n}
            onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder={`Player ${i + 1}`}
            maxLength={24}
            className={input}
          />
        ))}
        <div className="flex gap-2">
          <button
            onClick={() => setNames([...names, ""])}
            disabled={names.length >= 32}
            className="rounded-lg bg-neutral-800 px-3 py-2 text-sm disabled:opacity-40"
          >
            Add player
          </button>
          {names.length > 2 && (
            <button
              onClick={() => setNames(names.slice(0, -1))}
              className="rounded-lg bg-neutral-800 px-3 py-2 text-sm"
            >
              Remove last
            </button>
          )}
        </div>
      </section>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        onClick={start}
        disabled={filled.length < 2 || busy}
        className="w-full rounded-lg bg-neutral-100 text-neutral-950 font-semibold py-3 disabled:opacity-40"
      >
        {busy ? "Starting..." : `Start bracket (${filled.length} players)`}
      </button>
    </main>
  );
}

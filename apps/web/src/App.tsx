import { useEffect, useState } from "react";

// Placeholder shell. Real design pass comes in its own session.
// Job for now: prove the full pipeline works (web -> API -> deploy).

export default function App() {
  const [serverTime, setServerTime] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setServerTime(d.time))
      .catch(() => setServerTime(null));
  }, []);

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold tracking-tight">GameNight OS</h1>
      <p className="text-neutral-400 text-center">
        Scaffold is live. Crew module is up next.
      </p>
      <p className="text-xs text-neutral-600">
        {serverTime ? `API connected: ${serverTime}` : "API not reachable"}
      </p>
    </main>
  );
}

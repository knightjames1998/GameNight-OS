import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Me } from "../api";
import Login from "./Login";

// The invite link flow. Logged out: show login with a redirect back here,
// so the emailed magic link lands the new member right back on this page.

export default function JoinPage({ me }: { me: Me | null }) {
  const { code } = useParams();
  const navigate = useNavigate();
  const [groupName, setGroupName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ name: string }>(`/api/join/${code}/preview`)
      .then((d) => setGroupName(d.name))
      .catch(() => setError("This invite link doesn't work. Ask for a fresh one."));
  }, [code]);

  async function join() {
    setBusy(true);
    try {
      const { groupId } = await api<{ groupId: string }>(`/api/join/${code}`, {
        method: "POST",
      });
      navigate(`/g/${groupId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-3xl font-bold tracking-tight">GameNight OS</h1>
      {error && <p className="text-red-400">{error}</p>}
      {!error && groupName === null && <p className="text-neutral-500">Loading...</p>}
      {!error && groupName !== null && (
        <>
          <p className="text-neutral-300 text-center">
            You've been invited to join <span className="font-semibold">{groupName}</span>
          </p>
          {me ? (
            <button
              onClick={join}
              disabled={busy}
              className="rounded-lg bg-neutral-100 text-neutral-950 font-semibold px-8 py-3 disabled:opacity-50"
            >
              {busy ? "Joining..." : `Join as ${me.displayName}`}
            </button>
          ) : (
            <Login redirect={`/join/${code}`} />
          )}
        </>
      )}
    </main>
  );
}

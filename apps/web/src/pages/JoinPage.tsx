import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, type Me } from "../api";
import Login from "./Login";

// The invite link flow. Logged out: show login with a redirect back here,
// so login lands the new member right back on this page. A shared event link
// (?event=ID) routes through here too: after join we redirect to the event.

export default function JoinPage({ me }: { me: Me | null }) {
  const { code } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const eventId = new URLSearchParams(search).get("event");
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
      // A shared event link lands you on the event; a plain invite lands you
      // on the crew. Replace so Back doesn't return to this join screen.
      navigate(eventId ? `/e/${eventId}` : `/g/${groupId}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join");
      setBusy(false);
    }
  }

  return (
    <main className="gn-app">
      <div className="gn-wrap flex flex-col items-center gap-6" style={{ minHeight: "100dvh", justifyContent: "center", paddingTop: 40, paddingBottom: 40 }}>
        <h1 className="gn-brand" style={{ fontSize: 34 }}>GameNight OS</h1>

        {error && <p style={{ color: "var(--gn-danger)" }} className="text-center">{error}</p>}
        {!error && groupName === null && <p className="gn-hint">Loading...</p>}

        {!error && groupName !== null && (
          <>
            <div className="gn-card w-full text-center">
              <p className="gn-hint">You've been invited to join</p>
              <p className="gn-title text-2xl mt-1">{groupName}</p>
            </div>
            {me ? (
              <button onClick={join} disabled={busy} className="gn-btn gn-btn--p1 w-full">
                {busy ? "Joining..." : `Join as ${me.displayName}`}
              </button>
            ) : (
              <div className="w-full">
                {/* Carry ?event= through login so we return here and then
                    redirect to the event after joining. */}
                <Login redirect={`/join/${code}${search}`} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

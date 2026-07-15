import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type EventDetail, type RsvpStatus } from "../api";
import BackButton from "../BackButton";
import { useLiveUpdates } from "../useLiveUpdates";

export default function EventPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setEvent(await api<EventDetail>(`/api/events/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Live: RSVPs land without a refresh, and if the organizer deletes the
  // event out from under you, you get bounced instead of staring at a
  // screen that no longer exists.
  useLiveUpdates(
    (msg) => {
      if (msg.type === "event_rsvp_changed" && msg.eventId === id) load();
      if (msg.type === "event_session_changed" && msg.eventId === id) load();
      if (msg.type === "event_deleted" && msg.eventId === id) {
        window.alert("This game night was deleted.");
        navigate("/");
      }
    },
    () => load(),
  );

  async function startBracket() {
    if (busy) return;
    setBusy(true);
    try {
      const b = await api<{ id: string }>(`/api/events/${id}/bracket`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      navigate(`/b/${b.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function rsvp(status: RsvpStatus) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/events/${id}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Shell>
        <p style={{ color: "var(--gn-danger)" }}>{error}</p>
      </Shell>
    );
  }
  if (!event) {
    return (
      <Shell>
        <p className="gn-hint">Loading...</p>
      </Shell>
    );
  }

  const when = event.scheduledFor
    ? new Date(event.scheduledFor).toLocaleString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Date TBD";

  // Active state colors map to the arcade tokens: in = teal, maybe = gold, out = coral.
  const buttons: { status: RsvpStatus; label: string; bg: string; ink: string }[] = [
    { status: "yes", label: "I'm in", bg: "var(--gn-yes)", ink: "var(--gn-yes-ink)" },
    { status: "maybe", label: "Maybe", bg: "var(--gn-gold)", ink: "#2a2003" },
    { status: "no", label: "Can't", bg: "var(--gn-p1)", ink: "var(--gn-p1-ink)" },
  ];

  const groupBy = (s: RsvpStatus) => event.rsvps.filter((r) => r.status === s);

  return (
    <Shell>
      <div>
        <h1 className="gn-title text-2xl">{event.title}</h1>
        <p className="gn-hint mt-1">{when}</p>
      </div>

      <section className="space-y-2">
        <h2 className="gn-h2">You going?</h2>
        <div className="grid grid-cols-3 gap-2">
          {buttons.map((b) => {
            const on = event.myStatus === b.status;
            return (
              <button
                key={b.status}
                onClick={() => rsvp(b.status)}
                disabled={busy}
                className="gn-btn"
                style={
                  on
                    ? { background: b.bg, color: b.ink, boxShadow: "0 4px 0 rgba(0,0,0,.35)" }
                    : { background: "var(--gn-surf)", color: "var(--gn-ink)", border: "2px solid var(--gn-line)" }
                }
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="gn-h2">Tournament</h2>
        {(() => {
          const isHost = event.myRole === "owner" || event.myRole === "admin";
          const liveNow = !!event.beerioCode;
          // Members can always open Beerio: they land in the host's live
          // room, or on a "waiting for the host" screen. Only hosts can
          // actually start the night.
          return (
            <Link to={`/beerio?event=${id}`} className="gn-cab gn-cab--beerio">
              <span className="gn-cab__name">🍺 Beerio Kart</span>
              <span className="gn-cab__sub">
                {liveNow
                  ? isHost
                    ? "live now, rejoin"
                    : "live now, watch"
                  : isHost
                    ? "Double Elim & Grand Prix"
                    : "waiting for the host"}
              </span>
            </Link>
          );
        })()}
        {event.bracket ? (
          <Link to={`/b/${event.bracket.id}`} className="gn-cab gn-cab--brk">
            <span className="gn-cab__name">
              🏆 {event.bracket.status === "completed" ? "Final bracket" : "Live bracket"}
            </span>
            <span className="gn-cab__sub">tap to open</span>
          </Link>
        ) : event.myRole !== "owner" && event.myRole !== "admin" ? (
          <p className="gn-hint">
            The crew owner or an admin starts the generalized bracket.
          </p>
        ) : groupBy("yes").length >= 2 ? (
          <button onClick={startBracket} disabled={busy} className="gn-btn gn-btn--p1 w-full">
            Start generalized bracket ({groupBy("yes").length} players)
          </button>
        ) : (
          <p className="gn-hint">Needs at least 2 yes RSVPs to start a bracket.</p>
        )}
      </section>

      <section className="space-y-4">
        <RsvpList title="In" people={groupBy("yes")} tone="var(--gn-yes)" />
        <RsvpList title="Maybe" people={groupBy("maybe")} tone="var(--gn-gold)" />
        <RsvpList title="Out" people={groupBy("no")} tone="var(--gn-p1)" />
        <RsvpList title="No answer yet" people={event.noResponse} tone="var(--gn-dim)" />
      </section>
    </Shell>
  );
}

function RsvpList({
  title,
  people,
  tone,
}: {
  title: string;
  people: { userId: string; displayName: string }[];
  tone: string;
}) {
  if (people.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-bold mb-1" style={{ color: tone }}>
        {title} ({people.length})
      </h3>
      <ul className="space-y-1">
        {people.map((p) => (
          <li
            key={p.userId}
            style={{ background: "var(--gn-surf)", border: "2px solid var(--gn-line)", borderRadius: "12px", padding: "10px 14px", fontWeight: 700 }}
          >
            {p.displayName}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="gn-app">
      <div className="gn-wrap space-y-8">
        <BackButton />
        {children}
      </div>
    </main>
  );
}

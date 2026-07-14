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
      <Shell backTo="/">
        <p className="text-red-400">{error}</p>
      </Shell>
    );
  }
  if (!event) {
    return (
      <Shell backTo="/">
        <p className="text-neutral-500">Loading...</p>
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

  const buttons: { status: RsvpStatus; label: string; active: string }[] = [
    { status: "yes", label: "I'm in", active: "bg-green-500 text-neutral-950 border-green-500" },
    { status: "maybe", label: "Maybe", active: "bg-yellow-500 text-neutral-950 border-yellow-500" },
    { status: "no", label: "Can't", active: "bg-red-500 text-neutral-950 border-red-500" },
  ];

  const groupBy = (s: RsvpStatus) => event.rsvps.filter((r) => r.status === s);

  return (
    <Shell backTo={`/g/${event.groupId}`}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{event.title}</h1>
        <p className="text-neutral-400 mt-1">{when}</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">You going?</h2>
        <div className="grid grid-cols-3 gap-2">
          {buttons.map((b) => (
            <button
              key={b.status}
              onClick={() => rsvp(b.status)}
              disabled={busy}
              className={`rounded-lg border py-3 font-semibold transition-colors ${
                event.myStatus === b.status
                  ? b.active
                  : "bg-neutral-900 border-neutral-800 text-neutral-300"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Tournament</h2>
        <Link
          to={`/beerio?event=${id}`}
          className="block rounded-lg border border-yellow-600/50 bg-yellow-500/10 px-4 py-3 text-yellow-400 font-semibold"
        >
          🍺 Beerio Kart
          <span className="text-yellow-600/80 text-sm font-normal ml-2">
            Double Elim &amp; Grand Prix
          </span>
        </Link>
        {event.bracket ? (
          <Link
            to={`/b/${event.bracket.id}`}
            className="block rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 hover:border-neutral-600"
          >
            <span className="font-medium">
              {event.bracket.status === "completed" ? "Final bracket" : "Live bracket"}
            </span>
            <span className="text-neutral-500 text-sm ml-2">tap to open</span>
          </Link>
        ) : groupBy("yes").length >= 2 ? (
          <button
            onClick={startBracket}
            disabled={busy}
            className="w-full rounded-lg bg-neutral-100 text-neutral-950 font-semibold py-3 disabled:opacity-50"
          >
            Start generalized bracket ({groupBy("yes").length} players)
          </button>
        ) : (
          <p className="text-neutral-500 text-sm">
            Needs at least 2 yes RSVPs to start a bracket.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <RsvpList title="In" people={groupBy("yes")} tone="text-green-400" />
        <RsvpList title="Maybe" people={groupBy("maybe")} tone="text-yellow-400" />
        <RsvpList title="Out" people={groupBy("no")} tone="text-red-400" />
        <RsvpList title="No answer yet" people={event.noResponse} tone="text-neutral-500" />
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
      <h3 className={`text-sm font-semibold mb-1 ${tone}`}>
        {title} ({people.length})
      </h3>
      <ul className="space-y-1">
        {people.map((p) => (
          <li
            key={p.userId}
            className="rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-2"
          >
            {p.displayName}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Shell({ children, backTo }: { children: React.ReactNode; backTo: string }) {
  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 p-6 max-w-md mx-auto space-y-8">
      <BackButton />
      {children}
    </main>
  );
}

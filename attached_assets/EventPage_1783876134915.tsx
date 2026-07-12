import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type EventDetail, type RsvpStatus } from "../api";

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

    // Live updates: the server pushes a message whenever anyone RSVPs.
    // One socket per open page, reconnects with a small delay if it drops
    // (phones killing radio on lock is the common cause).
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${window.location.host}/ws`);
      socket.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.type === "event_rsvp_changed" && data.eventId === id) load();
        } catch {
          // Not our message shape; ignore.
        }
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
    }
    connect();

    // Belt and suspenders: refetch when the tab becomes visible again,
    // covering anything missed while the phone was locked.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
            Start bracket ({groupBy("yes").length} players)
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
      <Link to={backTo} className="text-sm text-neutral-500">
        &larr; Back
      </Link>
      {children}
    </main>
  );
}

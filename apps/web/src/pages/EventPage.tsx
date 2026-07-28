import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, CLIENT_ID, type EventDetail, type Me, type RsvpStatus } from "../api";
import { useCachedApi } from "../cache";
import { EventSkeleton } from "../Skeleton";
import { onIntent, routes } from "../prefetch";
import { shareLink } from "../share";
import BackButton from "../BackButton";
import { useLiveUpdates } from "../useLiveUpdates";
import GamePicker, { type PickerGame, type PickerFormat } from "../GamePicker";
import { buildPickerGames, type PackKey } from "../packs";

export default function EventPage({ me }: { me: Me | null }) {
  const { id } = useParams();
  const navigate = useNavigate();
  // Cached, and every setEvent below is a WRITE-THROUGH. That matters more
  // here than anywhere else: /api/events/:id/rsvp, PATCH /api/events/:id and
  // .../attendance all return the FULL updated event, and those responses are
  // already fed straight into setEvent. Routing setEvent through the cache
  // means coming back to this page after an RSVP is both instant and correct,
  // rather than instant and showing the pre-RSVP copy.
  const {
    data: event,
    error,
    set: setEvent,
    refetch: load,
  } = useCachedApi<EventDetail>(id ? `event:${id}` : null, id ? `/api/events/${id}` : null);
  const [busy, setBusy] = useState(false);
  const [editRsvp, setEditRsvp] = useState(false);
  const [editDate, setEditDate] = useState(false);
  const [whenDraft, setWhenDraft] = useState("");
  const [shareToast, setShareToast] = useState("");
  // Guards out-of-order mutation responses: only the newest request may
  // write its result into state (rapid taps race otherwise).
  const reqSeq = useRef(0);

  // Live: RSVPs land without a refresh, and if the organizer deletes the
  // event out from under you, you get bounced instead of staring at a
  // screen that no longer exists. Our own echoes are skipped: the mutation
  // response already carried the updated state, so refetching on them
  // would just double the traffic.
  useLiveUpdates(
    (msg) => {
      if (msg.origin === CLIENT_ID) return;
      if (msg.type === "event_rsvp_changed" && msg.eventId === id) load();
      if (msg.type === "event_session_changed" && msg.eventId === id) load();
      if (msg.type === "event_updated" && msg.eventId === id) load();
      if (msg.type === "event_deleted" && msg.eventId === id) {
        window.alert("This game night was deleted.");
        navigate("/");
      }
    },
    () => load(),
  );

  async function startBracket(format: "single_elim" | "double_elim") {
    if (busy) return;
    setBusy(true);
    try {
      const b = await api<{ id: string }>(`/api/events/${id}/bracket`, {
        method: "POST",
        body: JSON.stringify({ format }),
      });
      navigate(`/b/${b.id}`);
    } finally {
      setBusy(false);
    }
  }

  // Optimistic RSVP: paint the change immediately, then reconcile with the
  // authoritative state the mutation response carries. On failure, roll
  // back to the pre-tap snapshot and reopen the buttons.
  async function rsvp(status: RsvpStatus) {
    if (!event) return;
    const prev = event;
    const seq = ++reqSeq.current;
    if (me) {
      const others = event.rsvps.filter((r) => r.userId !== me.id);
      setEvent({
        ...event,
        myStatus: status,
        rsvps: [...others, { userId: me.id, displayName: me.displayName, status }],
        noResponse: event.noResponse.filter((p) => p.userId !== me.id),
      });
    }
    setEditRsvp(false);
    try {
      const fresh = await api<EventDetail>(`/api/events/${id}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      if (seq === reqSeq.current) setEvent(fresh);
    } catch (e) {
      if (seq === reqSeq.current) {
        setEvent(prev);
        setEditRsvp(true);
        window.alert(e instanceof Error ? e.message : "Couldn't save your RSVP");
      }
    }
  }

  async function saveDate() {
    if (busy) return;
    setBusy(true);
    const seq = ++reqSeq.current;
    try {
      // An emptied input means "clear the date" — the event goes back to TBD.
      const fresh = await api<EventDetail>(`/api/events/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          scheduledFor: whenDraft ? new Date(whenDraft).toISOString() : null,
        }),
      });
      if (seq === reqSeq.current) setEvent(fresh);
      setEditDate(false);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Couldn't change the date");
    } finally {
      setBusy(false);
    }
  }

  // Share the event through the existing invite/join flow: the link is a
  // crew invite carrying the event id, so a logged-out tap lands on the join
  // page and, after join/login, redirects to this event.
  async function shareEvent() {
    if (!event) return;
    const url = `${window.location.origin}/join/${event.inviteCode}?event=${event.id}`;
    const bits = [event.title];
    if (event.scheduledFor) {
      bits.push(
        new Date(event.scheduledFor).toLocaleString([], {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
      );
    }
    if (event.groupName) bits.push(event.groupName);
    const r = await shareLink({ title: `${event.title} · GameNight OS`, text: bits.join(" · "), url });
    if (r === "copied") {
      setShareToast("Link copied");
      setTimeout(() => setShareToast(""), 2000);
    }
  }

  // Optimistic check-in: the prompt disappears the moment it's tapped.
  async function markAttendance(showed: boolean) {
    if (!event) return;
    const prev = event;
    const seq = ++reqSeq.current;
    setEvent({ ...event, myAttendance: showed });
    try {
      const fresh = await api<EventDetail>(`/api/events/${id}/attendance`, {
        method: "POST",
        body: JSON.stringify({ showed }),
      });
      if (seq === reqSeq.current) setEvent(fresh);
    } catch (e) {
      if (seq === reqSeq.current) {
        setEvent(prev);
        window.alert(e instanceof Error ? e.message : "Couldn't record that");
      }
    }
  }

  // Cached content wins over a failed revalidation: an event page we can
  // already draw must not be blanked out because the network hiccuped.
  if (!event && error) {
    return (
      <Shell>
        <p style={{ color: "var(--gn-danger)" }}>{error}</p>
      </Shell>
    );
  }
  if (!event) {
    return (
      <Shell>
        <EventSkeleton />
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

  const canEditDate =
    event.myRole === "owner" || event.myRole === "admin" || me?.id === event.createdBy;
  const started =
    !!event.scheduledFor && new Date(event.scheduledFor).getTime() <= Date.now();
  const myButton = buttons.find((b) => b.status === event.myStatus);

  return (
    <Shell>
      {/* Once answered, the RSVP collapses into a pill inline with the title
          so the games are the first thing on the page. Tapping it reopens
          the three buttons. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="gn-title text-2xl">{event.title}</h1>
          {editDate ? (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <input
                type="datetime-local"
                value={whenDraft}
                onChange={(e) => setWhenDraft(e.target.value)}
                className="gn-input"
                style={{ minHeight: "40px", maxWidth: "13rem" }}
              />
              <button className="gn-actionbtn" onClick={saveDate} disabled={busy}>
                Save date
              </button>
              <button className="gn-textbtn" onClick={() => setEditDate(false)}>
                cancel
              </button>
            </div>
          ) : (
            <p className="gn-hint mt-1">
              {when}
              {canEditDate && (
                <button
                  className="gn-actionbtn"
                  style={{ minHeight: 32, padding: "5px 10px", marginLeft: 8, verticalAlign: "middle" }}
                  onClick={() => {
                    setWhenDraft(event.scheduledFor ? toLocalInput(event.scheduledFor) : "");
                    setEditDate(true);
                  }}
                >
                  📅 Change date
                </button>
              )}
            </p>
          )}
        </div>
        {event.myStatus && !editRsvp && (
          <button
            className="gn-rsvp-pill"
            style={{ color: myButton?.bg }}
            onClick={() => setEditRsvp(true)}
            title="Update RSVP"
          >
            {event.myStatus === "yes" ? "You're in" : event.myStatus === "maybe" ? "Maybe" : "You're out"}
            <span aria-hidden="true" style={{ fontSize: "9px" }}>
              ▾
            </span>
          </button>
        )}
      </div>

      {/* Low-key controls: share the event, put it on the TV, or open the
          night recap card. */}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="gn-actionbtn" onClick={shareEvent}>
          <span aria-hidden="true">📤</span> Share
        </button>
        {/* One TV button per night. Never disabled: the lobby (who's in, the
            join QR) is a legitimate thing to put on the screen before anyone
            has started a game, and that is when the TV usually goes on. */}
        <Link to={`/e/${id}/tv`} className="gn-actionbtn" {...onIntent(routes.eventTv)}>
          <span aria-hidden="true">📺</span> TV{tvLabel(event) && ` · ${tvLabel(event)}`}
        </Link>
        <Link to={`/e/${id}/recap`} className="gn-actionbtn" {...onIntent(routes.recap)}>
          <span aria-hidden="true">🏆</span> Night recap
        </Link>
        {shareToast && <span className="gn-hint">{shareToast}</span>}
      </div>

      {(!event.myStatus || editRsvp) && (
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
      )}

      {/* Show-up check-in: appears once the event's start time passes, and
          disappears as soon as it's answered. Attendance is stored separately
          from RSVP intent and feeds flake tracking. */}
      {started && event.myAttendance === null && (
        <section
          className="flex items-center justify-between gap-3"
          style={{
            background: "var(--gn-surf)",
            border: "2px solid var(--gn-line)",
            borderRadius: "12px",
            padding: "10px 14px",
          }}
        >
          <span style={{ fontWeight: 700 }}>Did you actually show?</span>
          <span className="flex gap-2">
            <button
              className="gn-btn gn-btn--go"
              style={{ minHeight: "40px" }}
              disabled={busy}
              onClick={() => markAttendance(true)}
            >
              Yes
            </button>
            <button
              className="gn-btn gn-btn--ghost"
              style={{ minHeight: "40px" }}
              disabled={busy}
              onClick={() => markAttendance(false)}
            >
              No
            </button>
          </span>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="gn-h2">Games</h2>
        <GamePicker games={eventGames(event, id!, (to) => navigate(to), startBracket, groupBy("yes").length)} />
      </section>

      <section className="space-y-4">
        <RsvpList title="In" people={groupBy("yes")} tone="var(--gn-yes)" groupId={event.groupId} meId={me?.id} />
        <RsvpList title="Maybe" people={groupBy("maybe")} tone="var(--gn-gold)" groupId={event.groupId} meId={me?.id} />
        <RsvpList title="Out" people={groupBy("no")} tone="var(--gn-p1)" groupId={event.groupId} meId={me?.id} />
        <RsvpList title="No answer yet" people={event.noResponse} tone="var(--gn-dim)" groupId={event.groupId} meId={me?.id} />
      </section>
    </Shell>
  );
}

/** ISO timestamp -> the local "YYYY-MM-DDTHH:mm" a datetime-local input wants. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Each name links to the same profile/rivalry page the crew list uses:
// yourself = your stats, anyone else = you vs them.
function RsvpList({
  title,
  people,
  tone,
  groupId,
  meId,
}: {
  title: string;
  people: { userId: string; displayName: string }[];
  tone: string;
  groupId: string;
  meId?: string;
}) {
  if (people.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-bold mb-1" style={{ color: tone }}>
        {title} ({people.length})
      </h3>
      <ul className="space-y-1">
        {people.map((p) => (
          <li key={p.userId}>
            <Link
              to={`/g/${groupId}/member/${p.userId}`}
              className="flex justify-between items-center gap-2"
              style={{
                background: "var(--gn-surf)",
                border: "2px solid var(--gn-line)",
                borderRadius: "12px",
                padding: "10px 14px",
                fontWeight: 700,
                color: "var(--gn-ink)",
                textDecoration: "none",
              }}
            >
              {p.displayName}
              <span className={`gn-chip ${meId === p.userId ? "gn-chip--stats" : "gn-chip--vs"}`}>
                {meId === p.userId ? "stats ›" : "vs ›"}
              </span>
            </Link>
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

/** Display name per pack tile, for the live sublines and the TV button. */
const PACK_NAME: Record<string, string> = {
  smash: "Smash Bros",
  mariokart: "Mario Kart",
  marioparty: "Mario Party",
  pingpong: "Ping Pong",
};

/** Everything running on this night right now, in no particular order. */
function liveNow(event: EventDetail): string[] {
  const names = event.sessions.map((s) => PACK_NAME[s.pack] ?? s.pack);
  if (event.beerioCode) names.push("Beerio Kart");
  if (event.bracket && event.bracket.status !== "completed") names.push("Tournament");
  return names;
}

/**
 * What to append to the TV button. Named only when there is exactly ONE thing
 * going: with two live sessions the TV follows whichever was touched last, and
 * this page cannot know which that is without asking the resolver, so naming
 * one here would be a guess that contradicts the screen half the time.
 */
function tvLabel(event: EventDetail): string {
  const live = liveNow(event);
  return live.length === 1 ? live[0]! : live.length > 1 ? "live now" : "";
}

// The event's game > format menu. Session packs (Beerio, Smash, Mario Kart
// general) are plain links — those pages gate hosting themselves and show a
// "waiting for the host" screen to members. Only Tournament needs gating
// here, because starting a bracket happens on this screen.
function eventGames(
  event: EventDetail,
  id: string,
  navigate: (to: string) => void,
  startBracket: (f: "single_elim" | "double_elim") => void,
  yesCount: number,
): PickerGame[] {
  const isHost = event.myRole === "owner" || event.myRole === "admin";
  const beerioSub = event.beerioCode
    ? isHost
      ? "live now, rejoin"
      : "live now, watch"
    : "double elim & grand prix";

  let tournamentFormats: PickerFormat[];
  if (event.bracket) {
    tournamentFormats = [
      {
        key: "open",
        label: event.bracket.status === "completed" ? "Open final bracket" : "Open live bracket",
        sub: event.bracket.status === "completed" ? "final bracket · tap to open" : "live now · tap to open",
        onPick: () => navigate(`/b/${event.bracket!.id}`),
      },
    ];
  } else if (!isHost) {
    tournamentFormats = [
      { key: "wait", label: "Waiting for the host", sub: "an owner or admin starts it", onPick: () => {}, disabled: true },
    ];
  } else if (yesCount >= 2) {
    tournamentFormats = [
      { key: "single", label: "Single elimination", sub: `${yesCount} players`, onPick: () => startBracket("single_elim") },
      { key: "double", label: "Double elimination", sub: `${yesCount} players · losers bracket`, onPick: () => startBracket("double_elim") },
    ];
  } else {
    tournamentFormats = [
      { key: "need", label: "Needs 2+ yes RSVPs", sub: "get the crew to RSVP first", onPick: () => {}, disabled: true },
    ];
  }

  // A pack running right now gets it said on the tile, the same way Beerio and
  // the Tournament always did. Members get "watch", hosts get "rejoin",
  // because tapping in takes each of them somewhere different.
  const liveSub: Partial<Record<PackKey, string>> = {};
  for (const s of event.sessions) {
    liveSub[s.pack as PackKey] = isHost ? "live now, rejoin ▸" : "live now, watch ▸";
  }

  // One catalogue, shared with Home (src/packs.ts). Everything here navigates
  // with ?event=<id> so the pack binds to this night; the genuinely contextual
  // bits (which packs are live, Beerio's subline, the Tournament gating) are
  // passed in rather than baked into the catalogue.
  return buildPickerGames({
    beerioSub,
    liveSub,
    tournamentFormats,
    destination: (pack, format) => () => {
      if (pack === "mariokart" && format === "beerio") return navigate(`/beerio?event=${id}`);
      if (pack === "tournament") return;
      if (pack === "marioparty") return navigate(`/marioparty?event=${id}`);
      navigate(`/${pack}?event=${id}&format=${format}`);
    },
  });
}

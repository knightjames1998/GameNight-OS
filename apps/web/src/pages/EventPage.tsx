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
import { SESSION_PACKS } from "@gamenight/shared/packs";
// THE NARROW SUBPATH, NOT THE BARREL, and the bundle budget test is what
// insists: EventPage is on the ENTRY path, so `from "@gamenight/shared"` pulls
// the whole index into the entry chunk, which is the Social Deduction title
// catalogue and the Smash fighter roster among other things. Measured when this
// import was written the wrong way: entry JS 73557 -> 81758 gzipped, +8201 for
// one predicate. See AUDIT-2026-08.md MUST FIX 1.
import { isHttpsUrl } from "@gamenight/shared/safeurl";
import { buildPickerGames, isSingleFormatPack, type PackKey, type SessionPackKey } from "../packs";

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
  // Where the night is and what to bring. One editor for all three, because
  // they are one thought ("about this night") and three separate pencils on one
  // screen is three ways to be halfway through an edit.
  const [editWhere, setEditWhere] = useState(false);
  const [locDraft, setLocDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
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

  // The tournament tile used to CREATE the bracket from here, which is why it
  // had no roster: a tile cannot show one. It now navigates to the setup step,
  // which builds the entrant list and does the POST. Everything that made this
  // an async host-only action moved with it.
  const startBracket = (format: "single_elim" | "double_elim") =>
    navigate(`/tournament?event=${id}&format=${format}`);

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
      // An emptied input means "clear the date": the event goes back to TBD.
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

  /**
   * Save all three detail fields together.
   *
   * Sends all three even when only one changed, which is correct HERE and would
   * be wrong from anywhere else: this form owns all three, so what it holds IS
   * the intended state, and an emptied input has to reach the server as a clear.
   * The route itself is partial (it writes only the keys it is sent), which is
   * what lets any OTHER caller send one field without blanking the rest.
   */
  async function saveWhere() {
    if (busy) return;
    setBusy(true);
    const seq = ++reqSeq.current;
    try {
      const fresh = await api<EventDetail>(`/api/events/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          location: locDraft.trim(),
          locationUrl: urlDraft.trim(),
          notes: notesDraft.trim(),
        }),
      });
      if (seq === reqSeq.current) setEvent(fresh);
      setEditWhere(false);
    } catch (e) {
      // Surfaces the server's own message, which is how a host learns that a
      // map link has to be https rather than watching the field silently empty.
      window.alert(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setBusy(false);
    }
  }

  // Share the event through the existing invite/join flow: the link is a
  // crew invite carrying the event id, so a logged-out tap lands on the join
  // page and, after join/login, redirects to this event.
  /**
   * ONE SHARE PATH, TWO MESSAGES. The nudge is not a second feature: it is this
   * function with a different opening line, so the invite-carrying URL, the
   * share sheet, the clipboard fallback and the toast are all the ones that
   * were already here and already work. A second share implementation would be
   * a second place for the join link to go stale.
   *
   * THE NUDGE NAMES NOBODY. It gets pasted into a group chat, and a count does
   * the job without the message being a callout with four people's names in it.
   */
  async function shareEvent(mode: "share" | "nudge" = "share") {
    if (!event) return;
    const waiting = event.noResponse.length;
    const url = `${window.location.origin}/join/${event.inviteCode}?event=${event.id}`;
    const bits = [mode === "nudge" ? `Who is in for ${event.title}?` : event.title];
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
    if (mode === "nudge" && waiting > 0) bits.push(`${waiting} still to answer`);
    const r = await shareLink({ title: `${event.title} · GameNight OS`, text: bits.join(" · "), url });
    if (r === "copied") {
      setShareToast("Link copied");
      setTimeout(() => setShareToast(""), 2000);
    }
  }

  // Optimistic check-in: the prompt disappears the moment it's tapped. The body
  // carries no userId, which is the shape this route has always taken for
  // somebody marking themselves, and the only one open to a plain member.
  async function markAttendance(showed: boolean) {
    if (!event) return;
    await postAttendance({ showed }, { ...withAttendance(event, me?.id, showed), myAttendance: showed });
  }

  /**
   * A host recording somebody else: `true` checks them in, `null` clears the row
   * back to unanswered. There is deliberately no false here, and the server
   * refuses one anyway: silence already counts as a flake, so a host never needs
   * to mark a no-show, and being able to would mean putting one on somebody
   * else's profile.
   */
  async function checkInOther(userId: string, showed: true | null) {
    if (!event) return;
    const next = withAttendance(event, userId, showed);
    if (userId === me?.id) next.myAttendance = showed;
    await postAttendance({ userId, showed }, next);
  }

  async function postAttendance(body: Record<string, unknown>, optimistic: EventDetail) {
    if (!event) return;
    const prev = event;
    const seq = ++reqSeq.current;
    setEvent(optimistic);
    try {
      const fresh = await api<EventDetail>(`/api/events/${id}/attendance`, {
        method: "POST",
        body: JSON.stringify(body),
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
  // THE RENDER-TIME GUARD, using the same shared predicate the server writes
  // through. Belt and braces on purpose: the write rule can be relaxed later by
  // somebody who does not know this side trusts it, and a row written before a
  // rule existed keeps whatever it was given. The last line of defence belongs
  // next to the thing that would do the damage.
  const mapHref = isHttpsUrl(event.locationUrl) ? event.locationUrl : null;
  const hasWhere = !!(event.location || mapHref || event.notes);
  const started =
    !!event.scheduledFor && new Date(event.scheduledFor).getTime() <= Date.now();
  const myButton = buttons.find((b) => b.status === event.myStatus);

  // WHO A HOST CAN CHECK IN: everybody who said yes, in the order they
  // answered, then anybody already recorded who is not on that list. Names come
  // from the RSVPs and the no-answer list, which between them cover every
  // current member; an attendance row whose name is missing belongs to somebody
  // who has since left the crew, and is dropped rather than drawn as a stranger.
  const isHost = event.myRole === "owner" || event.myRole === "admin";
  const nameOf = new Map<string, string>();
  for (const r of event.rsvps) nameOf.set(r.userId, r.displayName);
  for (const m of event.noResponse) nameOf.set(m.userId, m.displayName);
  const showedBy = new Map(event.attendance.map((a) => [a.userId, a.showed] as const));
  const checkInIds: string[] = [];
  for (const r of event.rsvps) if (r.status === "yes") checkInIds.push(r.userId);
  for (const a of event.attendance) if (!checkInIds.includes(a.userId)) checkInIds.push(a.userId);
  const checkInList = checkInIds
    .filter((u) => nameOf.has(u))
    .map((userId) => ({ userId, name: nameOf.get(userId)!, showed: showedBy.get(userId) }));

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

      {/* WHERE THE NIGHT IS AND WHAT TO BRING. Every member sees it; only the
          people who can change the date can change this, which is the same gate
          rather than a second one. An absent field renders NOTHING, not an
          empty row, so a night with no location looks exactly as it did before
          this shipped. */}
      {editWhere ? (
        <section className="gn-card space-y-2">
          <div className="gn-h2">About this night</div>
          <input
            className="gn-input"
            placeholder="Where (Dave's place, The Anchor)"
            value={locDraft}
            maxLength={120}
            onChange={(e) => setLocDraft(e.target.value)}
          />
          <input
            className="gn-input"
            type="url"
            inputMode="url"
            placeholder="Map link (https://...)"
            value={urlDraft}
            maxLength={500}
            onChange={(e) => setUrlDraft(e.target.value)}
          />
          <textarea
            className="gn-textarea"
            placeholder="Notes: park on the street, bring a chair"
            value={notesDraft}
            maxLength={1000}
            onChange={(e) => setNotesDraft(e.target.value)}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button className="gn-actionbtn" onClick={saveWhere} disabled={busy}>
              Save
            </button>
            <button className="gn-textbtn" onClick={() => setEditWhere(false)}>
              cancel
            </button>
            <span className="gn-hint">A map link has to start with https://</span>
          </div>
        </section>
      ) : (
        (hasWhere || canEditDate) && (
          <section className="space-y-1">
            {(event.location || mapHref) && (
              <p className="gn-where">
                <span aria-hidden="true">📍</span>
                {mapHref ? (
                  <>
                    {/* THE ONE LEGITIMATE RAW ANCHOR IN THIS APP. Standing rule 4
                        bans them for INTERNAL navigation, because a full page
                        load in an installed PWA opens a new Safari tab and
                        leaves the app. This link WANTS to leave: it is somebody
                        else's map. `noopener noreferrer` because the
                        destination is a string a crew member pasted. */}
                    <a href={mapHref} target="_blank" rel="noopener noreferrer">
                      {event.location || "Open map"}
                    </a>
                  </>
                ) : (
                  <span>{event.location}</span>
                )}
              </p>
            )}
            {event.notes && <p className="gn-notes">{event.notes}</p>}
            {canEditDate && (
              <button
                className="gn-actionbtn"
                style={{ minHeight: 32, padding: "5px 10px" }}
                onClick={() => {
                  setLocDraft(event.location ?? "");
                  setUrlDraft(event.locationUrl ?? "");
                  setNotesDraft(event.notes ?? "");
                  setEditWhere(true);
                }}
              >
                {hasWhere ? "📍 Edit details" : "📍 Add location or notes"}
              </button>
            )}
          </section>
        )
      )}

      {/* Low-key controls: share the event, put it on the TV, or open the
          night recap card. */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Wrapped rather than passed by reference: `shareEvent` takes a mode
            now, and a bare handler would hand it the click event. */}
        <button className="gn-actionbtn" onClick={() => shareEvent()}>
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

      {/* HOST CHECK-IN. Everything here is the one direction it can go: check
          somebody in, or clear the row back to unanswered. There is no way to
          mark anybody absent, because silence after a yes already counts as a
          flake, so the only thing this control can do is give somebody their
          night back. Members who are not hosts never see it. */}
      {started && isHost && checkInList.length > 0 && (
        <section className="space-y-2">
          <h2 className="gn-h2">Check people in</h2>
          <p className="gn-hint">
            For anyone who turned up and never opened the app. This only ever helps
            somebody's record: you can't mark anyone absent from here.
          </p>
          <ul className="space-y-2">
            {checkInList.map((p) => (
              <li
                key={p.userId}
                className="flex items-center justify-between gap-3"
                style={{
                  background: "var(--gn-surf)",
                  border: "2px solid var(--gn-line)",
                  borderRadius: "12px",
                  padding: "8px 12px",
                }}
              >
                <span className="min-w-0">
                  <span style={{ fontWeight: 700, display: "block" }}>{p.name}</span>
                  <span
                    className="gn-hint"
                    style={{
                      display: "block",
                      color: p.showed === true ? "var(--gn-yes)" : "var(--gn-dim)",
                    }}
                  >
                    {p.showed === true
                      ? "Checked in"
                      : p.showed === false
                        ? "Said they missed it"
                        : "Not checked in"}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {p.showed !== true && (
                    <button
                      className="gn-actionbtn"
                      disabled={busy}
                      onClick={() => checkInOther(p.userId, true)}
                    >
                      Check in
                    </button>
                  )}
                  {p.showed !== undefined && (
                    <button
                      className="gn-chipbtn"
                      style={{
                        background: "color-mix(in srgb, var(--gn-dim) 18%, transparent)",
                        color: "var(--gn-dim)",
                      }}
                      disabled={busy}
                      title="Back to unanswered"
                      onClick={() => checkInOther(p.userId, null)}
                    >
                      Clear
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="gn-h2">Games</h2>
        <GamePicker games={eventGames(event, id!, (to) => navigate(to), startBracket)} />
      </section>

      <section className="space-y-4">
        <RsvpList title="In" people={groupBy("yes")} tone="var(--gn-yes)" groupId={event.groupId} meId={me?.id} />
        <RsvpList title="Maybe" people={groupBy("maybe")} tone="var(--gn-gold)" groupId={event.groupId} meId={me?.id} />
        <RsvpList title="Out" people={groupBy("no")} tone="var(--gn-p1)" groupId={event.groupId} meId={me?.id} />
        <RsvpList title="No answer yet" people={event.noResponse} tone="var(--gn-dim)" groupId={event.groupId} meId={me?.id} />
        {/* THE NUDGE. Renders nothing once everybody has answered, which is the
            state a crew that is on top of things spends most of its time in.
            There is no push notification behind this and this session built
            none: it is a share sheet, so the nudge lands wherever the crew
            already talks. */}
        {event.noResponse.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <button className="gn-actionbtn" onClick={() => shareEvent("nudge")}>
              <span aria-hidden="true">👋</span> Nudge the {event.noResponse.length} who
              {event.noResponse.length === 1 ? " hasn't" : " haven't"} answered
            </button>
            {shareToast && <span className="gn-hint">{shareToast}</span>}
          </div>
        )}
      </section>
    </Shell>
  );
}

/**
 * One attendance row written into a cached event, so the optimistic update and
 * the server's answer describe the same thing. `null` removes the row, which is
 * what unanswered IS: there is no third state on either side of the wire.
 */
function withAttendance(
  e: EventDetail,
  userId: string | undefined,
  showed: boolean | null,
): EventDetail {
  if (!userId) return e;
  const rest = e.attendance.filter((a) => a.userId !== userId);
  return { ...e, attendance: showed === null ? rest : [...rest, { userId, showed }] };
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

/** Everything running on this night right now, in no particular order. */
function liveNow(event: EventDetail): string[] {
  // Display names from the one registry. This was a fourth hand-written table
  // of the same four packs, added by the TV session that also shipped the
  // ping_pong/pingpong mismatch.
  const names: string[] = event.sessions.map(
    (s) => SESSION_PACKS[s.pack as SessionPackKey]?.name ?? s.pack,
  );
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
// general) are plain links: those pages gate hosting themselves and show a
// "waiting for the host" screen to members. Tournament is gated HERE as well as
// on its own setup screen, because its tile carries the format choice: a member
// tapping through to a screen that only tells them to wait is a worse answer
// than a tile that says so.
function eventGames(
  event: EventDetail,
  id: string,
  navigate: (to: string) => void,
  startBracket: (f: "single_elim" | "double_elim") => void,
): PickerGame[] {
  const isHost = event.myRole === "owner" || event.myRole === "admin";
  const beerioSub = event.beerioCode
    ? isHost
      ? "live now, rejoin"
      : "live now, watch"
    : "double elim & grand prix";

  // NO RSVP GATE on either of these. They used to sit under a disabled
  // "Needs 2+ yes RSVPs" tile whenever fewer than two people had answered,
  // which was a lie: the bracket is built on the next screen from the whole
  // crew plus guests, so a night where nobody tracked their own RSVP is a
  // perfectly startable tournament.
  const startFormats = (again: boolean): PickerFormat[] => [
    {
      key: "single",
      label: "Single elimination",
      sub: again ? "a second tournament · pick who is playing" : "pick who is playing next",
      onPick: () => startBracket("single_elim"),
    },
    {
      key: "double",
      label: "Double elimination",
      sub: again ? "a second tournament · losers bracket" : "losers bracket · pick who is playing next",
      onPick: () => startBracket("double_elim"),
    },
  ];

  // THE COMPLETED CASE OFFERS BOTH, and that is the whole client half of this
  // change. `if (event.bracket)` used to swallow the start path entirely, so
  // once a night's tournament finished the tile could only ever reopen it: the
  // server said 409 to a second one and the screen never even asked. A
  // finished tournament is history you can still look at, not a night that is
  // over. While one is LIVE or in SETUP nothing changes, because the server
  // still refuses a second, and offering what will be refused is worse than
  // not offering it.
  const done = event.bracket?.status === "completed";
  const openBracket: PickerFormat = {
    key: "open",
    label: done ? "Open final bracket" : "Open live bracket",
    sub: done ? "final bracket · tap to open" : "live now · tap to open",
    onPick: () => navigate(`/b/${event.bracket!.id}`),
  };

  let tournamentFormats: PickerFormat[];
  if (event.bracket && !done) {
    tournamentFormats = [openBracket];
  } else if (event.bracket) {
    // Members get the finished bracket and nothing else: they could not start
    // the first one either, and the wait tile would be noise beside a real
    // thing to tap.
    tournamentFormats = isHost ? [openBracket, ...startFormats(true)] : [openBracket];
  } else if (!isHost) {
    tournamentFormats = [
      { key: "wait", label: "Waiting for the host", sub: "an owner or admin starts it", onPick: () => {}, disabled: true },
    ];
  } else {
    tournamentFormats = startFormats(false);
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
      // A pack with one format has nothing to choose, so it carries no
      // suffix. Asked of the catalogue rather than listed here; the list this
      // replaced was two packs out of date, and Home.tsx had the same list
      // with the same two gaps. See isSingleFormatPack in src/packs.ts.
      if (isSingleFormatPack(pack)) return navigate(`/${pack}?event=${id}`);
      navigate(`/${pack}?event=${id}&format=${format}`);
    },
  });
}

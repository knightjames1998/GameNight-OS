import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, CLIENT_ID, type EventSummary, type GroupDetail, type Me } from "../api";
// The narrow subpath, not the barrel: GroupPage is on the entry path and
// `@gamenight/shared` drags every pack catalogue into the entry chunk.
import { isPastEvent, MAX_INTERVAL_WEEKS, type SeriesKind } from "@gamenight/shared/recurrence";
import { useCachedApi } from "../cache";
import { useLiveUpdates } from "../useLiveUpdates";
import { EventListSkeleton, SkeletonBlock } from "../Skeleton";
import { onIntent, routes } from "../prefetch";

export default function GroupPage({
  me,
  onNameChange,
}: {
  me: Me | null;
  onNameChange: (name: string) => void;
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  // Cached: coming back to a crew you have already opened paints instantly and
  // revalidates behind the paint, instead of showing "Loading..." again for
  // data that has not changed. `set` writes local edits through to the cache,
  // so a role change or a deleted night survives navigating away and back.
  const {
    data: group,
    error,
    set: setGroup,
    refetch: loadGroup,
  } = useCachedApi<GroupDetail>(id ? `group:${id}` : null, id ? `/api/groups/${id}` : null);
  const {
    data: events,
    loading: eventsLoading,
    set: setEvents,
    refetch: loadEvents,
  } = useCachedApi<EventSummary[]>(
    id ? `group:${id}:events` : null,
    id ? `/api/groups/${id}/events` : null,
  );
  const [copied, setCopied] = useState(false);
  const [showInviteUrl, setShowInviteUrl] = useState(false);
  const [title, setTitle] = useState("");
  // The repeat rule for the night being created. "none" is the default and the
  // control only appears once there is a date, because the date IS the anchor.
  const [repeat, setRepeat] = useState<"none" | SeriesKind>("none");
  const [everyWeeks, setEveryWeeks] = useState(2);
  // Which tile is asking the three-way delete question. `window.confirm` is
  // OK/Cancel and cannot express three outcomes, and chaining two confirms
  // reads on a phone as the app asking twice, which trains a host to dismiss
  // the second one.
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(me?.displayName ?? "");
  const [editingCrew, setEditingCrew] = useState(false);
  const [crewDraft, setCrewDraft] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);

  // Live: new events, deletions, and people joining or leaving all land
  // without a refresh, same as RSVPs.
  useLiveUpdates(
    (msg) => {
      // Own echoes are skipped: this page already applies its writes to
      // local state (role changes, removals, deletes), so refetching on
      // them would just double the traffic.
      if (msg.origin === CLIENT_ID) return;
      if (msg.groupId !== id) return;
      if (msg.type === "group_events_changed" || msg.type === "event_deleted" || msg.type === "event_updated")
        loadEvents();
      if (msg.type === "group_members_changed") loadGroup();
    },
    () => {
      loadGroup();
      loadEvents();
    },
  );

  const inviteUrl = group ? `${window.location.origin}/join/${group.inviteCode}` : "";
  const canManage = group?.myRole === "owner" || group?.myRole === "admin";

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (older webviews); reveal the link so it can
      // be long-press copied instead.
      setShowInviteUrl(true);
    }
  }

  async function createEvent() {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const e = await api<{ id: string }>(`/api/groups/${id}/events`, {
        method: "POST",
        body: JSON.stringify({
          title,
          scheduledFor: when ? new Date(when).toISOString() : null,
          // THE ZONE TRAVELS WITH THE SERIES, captured here because this is the
          // only place that knows it: the server runs in UTC, where the clocks
          // never change, so it cannot work out that "7pm every Thursday" has
          // to survive a daylight-saving boundary in somebody else's city.
          repeat:
            when && repeat !== "none"
              ? {
                  kind: repeat,
                  intervalWeeks: repeat === "custom_weeks" ? everyWeeks : null,
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                }
              : null,
        }),
      });
      navigate(`/e/${e.id}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Delete one night, and optionally stop the series it belongs to.
   *
   * THE SCOPE IS EXPLICIT AND DEFAULTS TO THIS NIGHT. The server defaults the
   * same way, so neither end can stop a series by omission.
   */
  async function removeEvent(e: EventSummary, scope: "this" | "series") {
    try {
      await api(`/api/events/${e.id}`, { method: "DELETE", body: JSON.stringify({ scope }) });
      setEvents((events ?? []).filter((x) => x.id !== e.id));
      setDeleting(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Couldn't delete");
    }
  }

  /**
   * Run this night again.
   *
   * A DUPLICATE IS A CREATE, not a new route: the create endpoint already takes
   * the title and the three detail fields and already derives
   * `status: scheduledFor ? "scheduled" : "draft"`, so a dateless duplicate
   * lands as a draft with no server work at all.
   *
   * IT CARRIES NO DATE ON PURPOSE. "Next week, same time" is a guess, and a
   * guessed date on a real event is worse than no date: it shows up in the
   * upcoming list, it can be RSVP'd to, and nobody knows it was invented. The
   * new night opens on its own page, where the date editor is.
   *
   * NOTHING ELSE COPIES. Not RSVPs, not attendance, not the Beerio room code,
   * not a session or a bracket. A duplicate is a fresh night with the same name
   * and the same place, and everything else about the old one is that night's
   * history rather than this one's starting state.
   *
   * ANY MEMBER CAN, deliberately unlike delete. Delete is destructive and gated
   * on `canManage`; duplicating is a create with prefilled text, and the create
   * FORM further down this same page is open to every member. Gating the button
   * tighter than the form it is a shortcut for would be inconsistent, and this
   * cannot do anything that form cannot.
   */
  async function duplicateEvent(e: EventSummary) {
    if (busy) return;
    setBusy(true);
    try {
      const created = await api<EventSummary>(`/api/groups/${id}/events`, {
        method: "POST",
        body: JSON.stringify({
          // Verbatim. Two nights called the same thing are told apart by their
          // dates, and a recurring night keeping its name is the whole point.
          title: e.title,
          scheduledFor: null,
          location: e.location,
          locationUrl: e.locationUrl,
          notes: e.notes,
          // ALL THREE OR NONE, which is what the write enforces. Carrying the
          // label forward and dropping the pin would produce a duplicate that
          // looks right on screen and is useless to anything reading a
          // coordinate; the server refuses a lat with no lng for the same
          // reason.
          locationLat: e.locationLat,
          locationLng: e.locationLng,
          locationRef: e.locationRef,
        }),
      });
      // Write it through the cache the same way the delete handler does, so the
      // crew page is not showing a list that is missing the night it just made.
      setEvents([created, ...(events ?? [])]);
      navigate(`/e/${created.id}`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Couldn't duplicate that night");
    } finally {
      setBusy(false);
    }
  }

  // Order matters: cached content wins over an error. A revalidation that
  // fails (phone lost signal, Render still waking up) must not blank out a
  // crew page we can already draw perfectly well; it just means the copy on
  // screen might be a few seconds old. Only fall through to the error screen
  // when there is genuinely nothing to show.
  if (!group) {
    return (
      <Shell>
        {error ? (
          <p style={{ color: "var(--gn-danger)" }}>{error}</p>
        ) : (
          <>
            <SkeletonBlock height={26} width="56%" />
            <EventListSkeleton />
          </>
        )}
      </Shell>
    );
  }

  // One game-night tile, shared by the upcoming list and the collapsed past list.
  const eventTile = (e: EventSummary) => {
    // A ROW MISSING ITS COUNTS MUST NOT TAKE THE PAGE DOWN, and that is not
    // belt and braces: this list is painted from localStorage BEFORE anything
    // is fetched, so a malformed row reaches this line before any revalidation
    // could replace it, and `e.counts.yes` on an absent object throws during
    // the FIRST render. An error boundary raised from cached data is the one
    // kind a reload cannot clear, because the reload re-reads the same entry.
    // Zero for a moment and the real numbers a fetch later is the honest
    // failure; a dead crew page is not. The shape that made this necessary is
    // fixed at its source (see eventSummary in events.ts), which is where a
    // shape belongs. This is what stops the next one being fatal.
    const counts = e.counts ?? { yes: 0, maybe: 0, no: 0 };
    return (
      <li key={e.id}>
        <Link to={`/e/${e.id}`} className="gn-cab" style={{ display: "block" }}>
          <div className="flex justify-between items-center gap-2">
            <span className="gn-cab__name" style={{ fontSize: "16px" }}>{e.title}</span>
            {/* PAST NIGHTS ONLY. This is one tile function shared by the upcoming
                list and the past cabinet, so an ungated button would offer to
                duplicate a night that has not happened yet, which is a way to end
                up with two of the same Friday. */}
            {isPast(e) && (
              <button
                className="gn-chipbtn"
                style={{
                  background: "color-mix(in srgb, var(--gn-p2) 16%, transparent)",
                  color: "var(--gn-p2)",
                }}
                disabled={busy}
                onClick={(ev) => {
                  // Inside the card's Link, exactly like delete below: without
                  // both of these the tap navigates to the old night instead.
                  ev.preventDefault();
                  ev.stopPropagation();
                  void duplicateEvent(e);
                }}
              >
                run it again
              </button>
            )}
            {canManage && (
              <button
                className="gn-chipbtn gn-chipbtn--danger"
                onClick={(ev) => {
                  // Inside the card's Link: don't navigate, just act.
                  ev.preventDefault();
                  ev.stopPropagation();
                  // A NIGHT IN A RUNNING SERIES ASKS; EVERY OTHER NIGHT KEEPS THE
                  // CONFIRM IT ALWAYS HAD, word for word. The question is not
                  // "is this upcoming": deleting a PAST night of a series that is
                  // still running is a coherent moment to stop it.
                  if (e.seriesId && e.seriesActive) {
                    setDeleting(e.id);
                    return;
                  }
                  if (!window.confirm(`Delete "${e.title}"? Its RSVPs, brackets and recorded stats go with it. This can't be undone.`)) return;
                  void removeEvent(e, "this");
                }}
              >
                delete
              </button>
            )}
          </div>
          {/* THE THREE-OUTCOME DELETE, which is the one thing in this feature that
              could not be done with what was already here. `window.confirm` is
              OK/Cancel; this needs cancel, delete this night, and delete this
              night AND stop repeating.

              "ALL FUTURE" IS A PHRASE THIS DELIBERATELY AVOIDS, because it would
              be a lie: only one un-passed occurrence ever exists, so there are no
              future rows to delete. The second button deletes exactly one night
              and stops the rule. */}
          {deleting === e.id && (
            <div
              className="space-y-2"
              style={{
                marginTop: 10,
                padding: "10px 12px",
                borderRadius: "var(--gn-radius-tile)",
                background: "var(--gn-surf)",
                border: "2px solid var(--gn-line)",
              }}
              onClick={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
              }}
            >
              <p className="gn-hint" style={{ margin: 0 }}>
                This night repeats. Its RSVPs, brackets and recorded stats go with it either
                way, and that can't be undone.
              </p>
              <div className="flex gap-2 flex-wrap">
                <button className="gn-chipbtn gn-chipbtn--danger" onClick={() => void removeEvent(e, "this")}>
                  delete this night
                </button>
                <button className="gn-chipbtn gn-chipbtn--danger" onClick={() => void removeEvent(e, "series")}>
                  delete and stop repeating
                </button>
                <button className="gn-textbtn" onClick={() => setDeleting(null)}>
                  cancel
                </button>
              </div>
            </div>
          )}
          {/* Your own RSVP rides the same info line as everyone else's. */}
          <div className="gn-cab__sub">
            {e.scheduledFor
              ? new Date(e.scheduledFor).toLocaleString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "Date TBD"}
            {" · "}
            {counts.yes} in / {counts.maybe} maybe / {counts.no} out
            {e.myStatus && ` · you: ${e.myStatus}`}
          </div>
        </Link>
      </li>
    );
  };

  // A night is "past" once it is more than 24h beyond its scheduled time (the
  // same grace window flake tracking uses). Dateless (TBD) nights are never
  // past. Past nights collapse into one cabinet tile, like Friends on Home.
  // ONE DEFINITION OF PAST, SHARED WITH THE SERVER since recurrence shipped: the
  // generator decides whether a series is owed a new occurrence with the same
  // test this list sorts on, and two copies of the number drift into a game
  // night appearing a week early or a week late with nothing erroring.
  const now = Date.now();
  const isPast = (e: EventSummary) => isPastEvent(e.scheduledFor, now);
  const upcomingEvents = (events ?? []).filter((e) => !isPast(e));
  const pastEvents = (events ?? []).filter(isPast);

  return (
    <Shell>
      <div className="space-y-1">
        {editingCrew ? (
          <span className="flex gap-2 items-center flex-wrap">
            <input
              value={crewDraft}
              onChange={(e) => setCrewDraft(e.target.value)}
              maxLength={50}
              className="gn-input"
              style={{ minHeight: "40px", maxWidth: "14rem" }}
              autoFocus
            />
            <button
              className="gn-textbtn"
              onClick={async () => {
                const name = crewDraft.trim();
                setEditingCrew(false);
                if (!name || name === group.name) return;
                const prev = group.name;
                setGroup({ ...group, name }); // optimistic
                try {
                  await api(`/api/groups/${group.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ name }),
                  });
                } catch (e) {
                  setGroup({ ...group, name: prev }); // rollback
                  window.alert(e instanceof Error ? e.message : "Couldn't rename the crew");
                }
              }}
            >
              save
            </button>
            <button className="gn-textbtn" onClick={() => setEditingCrew(false)}>
              cancel
            </button>
          </span>
        ) : (
          <h1 className="gn-title text-2xl flex items-center gap-2 flex-wrap">
            {group.name}
            {canManage && (
              <button
                className="gn-actionbtn"
                style={{ minHeight: 30, padding: "4px 11px", fontSize: 12 }}
                onClick={() => {
                  setCrewDraft(group.name);
                  setEditingCrew(true);
                }}
              >
                ✏️ Edit
              </button>
            )}
          </h1>
        )}
        {me && (
          <div className="gn-hint">
            {editingName ? (
              <span className="flex gap-2 items-center">
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  maxLength={30}
                  className="gn-input"
                  style={{ minHeight: "40px", maxWidth: "12rem" }}
                />
                <button
                  className="gn-textbtn"
                  onClick={async () => {
                    const name = nameDraft.trim();
                    if (name && name !== me.displayName) {
                      await api("/api/auth/me", {
                        method: "PATCH",
                        body: JSON.stringify({ displayName: name }),
                      });
                      onNameChange(name);
                      setGroup(
                        {
                          ...group,
                          members: group.members.map((m) =>
                            m.userId === me.id ? { ...m, displayName: name } : m,
                          ),
                        },
                      );
                    }
                    setEditingName(false);
                  }}
                >
                  save
                </button>
              </span>
            ) : (
              <span>
                Playing as <span style={{ color: "var(--gn-ink)", fontWeight: 700 }}>{me.displayName}</span>{" "}
                <button
                  className="gn-actionbtn"
                  style={{ minHeight: 28, padding: "3px 10px", fontSize: 12 }}
                  onClick={() => {
                    setNameDraft(me.displayName);
                    setEditingName(true);
                  }}
                >
                  ✏️ Edit
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      <Link
        to={`/g/${group.id}/stats`}
        className="gn-cab gn-cab--stats"
        {...onIntent(routes.stats)}
      >
        <span className="gn-cab__name">📊 Lifetime stats</span>
        <span className="gn-cab__sub">wins, records, by game</span>
      </Link>

      {/* ---- Game nights ------------------------------------------------ */}
      <section className="space-y-3">
        <h2 className="gn-h2">Game nights</h2>
        {eventsLoading && <EventListSkeleton />}
        {events?.length === 0 && (
          <p className="gn-hint">Nothing scheduled yet. Start one below.</p>
        )}

        {upcomingEvents.length > 0 && (
          <ul className="space-y-2">{upcomingEvents.map(eventTile)}</ul>
        )}
        {!!events?.length && upcomingEvents.length === 0 && (
          <p className="gn-hint">Nothing coming up. Start one below.</p>
        )}

        {/* Past nights collapse into one cabinet tile, exactly like Friends. */}
        {pastEvents.length > 0 && (
          <section className="space-y-3">
            <button
              className="gn-cab"
              style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit" }}
              onClick={() => setPastOpen((o) => !o)}
              aria-expanded={pastOpen}
            >
              <span className="gn-cab__name">
                🗓️ Past game nights <span className="gn-hint" style={{ fontWeight: 400 }}>({pastEvents.length})</span>
                <span className="gn-hint" style={{ fontSize: 11, fontWeight: 400 }} aria-hidden="true">
                  {pastOpen ? "▴" : "▾"}
                </span>
              </span>
              <span className="gn-cab__sub">
                {pastOpen ? "tap to hide" : "wrapped nights · recaps & results"}
              </span>
            </button>
            {pastOpen && <ul className="space-y-2">{pastEvents.map(eventTile)}</ul>}
          </section>
        )}

        <div className="gn-divider">Schedule a new one</div>
        <div className="gn-card space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Game night title"
            maxLength={80}
            className="gn-input"
          />
          <label className="gn-lab">Date and time (optional)</label>
          <div className="flex gap-2">
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="gn-input"
            />
            <button onClick={createEvent} disabled={!title.trim() || busy} className="gn-btn gn-btn--p1">
              Create
            </button>
          </div>
            {/* ONLY ONCE THERE IS A DATE, because the date is the anchor: "every
                week" with no week to start from cannot be computed, and the
                server refuses it rather than dropping it silently. */}
            {when && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="gn-lab">Repeat</span>
                {(
                  [
                    ["none", "Never"],
                    ["weekly", "Weekly"],
                    ["monthly", "Monthly"],
                    ["custom_weeks", "Every N weeks"],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    className={`gn-chipbtn gn-chipbtn--${repeat === kind ? "on" : "off"}`}
                    aria-pressed={repeat === kind}
                    onClick={() => setRepeat(kind)}
                  >
                    {label}
                  </button>
                ))}
                {repeat === "custom_weeks" && (
                  <label className="flex items-center gap-2">
                    <span className="gn-hint">every</span>
                    <input
                      type="number"
                      min={1}
                      max={MAX_INTERVAL_WEEKS}
                      value={everyWeeks}
                      onChange={(ev) =>
                        setEveryWeeks(Math.min(MAX_INTERVAL_WEEKS, Math.max(1, Number(ev.target.value) || 1)))
                      }
                      className="gn-input"
                      style={{ width: "4.5rem", minHeight: 40 }}
                    />
                    <span className="gn-hint">weeks</span>
                  </label>
                )}
              </div>
            )}
            {/* MONTHLY IS THE ORDINAL WEEKDAY, and the host is told so rather
                than finding out four weeks later. Both the weekday and its
                position come from the date above, so there is nothing to pick. */}
            {when && repeat === "monthly" && (
              <p className="gn-hint">
                Monthly keeps the weekday, not the date: the same position in the month as
                the date above.
              </p>
            )}

        </div>
      </section>

      {/* ---- Crew (people) --------------------------------------------- */}
      <div className="gn-divider">Your crew</div>

      <section className="gn-card space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="gn-h2">
            Members <span className="gn-hint" style={{ fontWeight: 400 }}>({group.members.length})</span>
          </h2>
          <button
            className="gn-textbtn gn-textbtn--danger"
            onClick={async () => {
              if (!window.confirm(`Leave ${group.name}? Your game history stays with the crew.`)) return;
              try {
                await api(`/api/groups/${group.id}/members/me`, { method: "DELETE" });
                navigate("/");
              } catch (e) {
                window.alert(e instanceof Error ? e.message : "Couldn't leave");
              }
            }}
          >
            leave crew
          </button>
        </div>
        <ul className="space-y-2">
          {group.members.map((m) => {
            const canRemove =
              me &&
              m.userId !== me.id &&
              (group.myRole === "owner" ||
                (group.myRole === "admin" && m.role === "member"));
            return (
              <li
                key={m.userId}
                className="flex justify-between items-center gap-2 flex-wrap"
                style={{
                  background: "var(--gn-raise)",
                  border: "2px solid var(--gn-line)",
                  borderRadius: "12px",
                  padding: "10px 14px",
                }}
              >
                <button
                  onClick={() => navigate(`/g/${group.id}/member/${m.userId}`)}
                  className="flex items-center gap-2"
                  style={{
                    fontWeight: 700,
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--gn-ink)",
                    cursor: "pointer",
                    textAlign: "left",
                    font: "inherit",
                    flex: "1 0 auto",
                    maxWidth: "100%",
                  }}
                  title={me && m.userId === me.id ? "Your stats" : `You vs ${m.displayName}`}
                >
                  {/* The name never truncates or breaks mid-word; if a row runs
                      out of room the role/remove controls wrap to their own
                      right-aligned line instead. */}
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {m.displayName}
                  </span>
                  <span className={`gn-chip ${me && m.userId === me.id ? "gn-chip--stats" : "gn-chip--vs"}`}>
                    {me && m.userId === me.id ? "stats ›" : "vs ›"}
                  </span>
                </button>
                <span className="flex items-center gap-2" style={{ flexShrink: 0, marginLeft: "auto" }}>
                  {/* Owners get the role as a dropdown (same chip look, tiny ▾)
                      instead of a chip plus separate demote/make-admin text. */}
                  {group.myRole === "owner" && m.role !== "owner" ? (
                    <span className={`gn-chipsel gn-chipsel--${m.role}`}>
                      <select
                        value={m.role}
                        aria-label={`Role for ${m.displayName}`}
                        onChange={async (ev) => {
                          const next = ev.target.value as "admin" | "member";
                          if (next === m.role) return;
                          await api(`/api/groups/${group.id}/members/${m.userId}/role`, {
                            method: "PATCH",
                            body: JSON.stringify({ role: next }),
                          });
                          setGroup({
                            ...group,
                            members: group.members.map((x) =>
                              x.userId === m.userId ? { ...x, role: next } : x,
                            ),
                          });
                        }}
                      >
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                      </select>
                      <span aria-hidden="true" className="gn-chipsel__arrow">
                        ▾
                      </span>
                    </span>
                  ) : (
                    <span className={`gn-chip gn-chip--${m.role}`}>{m.role}</span>
                  )}
                  {canRemove && (
                    <button
                      className="gn-chipbtn gn-chipbtn--danger"
                      onClick={async () => {
                        if (!window.confirm(`Remove ${m.displayName} from ${group.name}? Their game history stays.`)) return;
                        await api(`/api/groups/${group.id}/members/${m.userId}`, { method: "DELETE" });
                        setGroup({ ...group, members: group.members.filter((x) => x.userId !== m.userId) });
                      }}
                    >
                      remove
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {canManage && (
          <button
            onClick={() => navigate(`/g/${group.id}/link-guest`)}
            className="gn-btn gn-btn--ghost"
            style={{ minHeight: "40px", width: "100%" }}
          >
            Link a past guest to a member
          </button>
        )}
      </section>

      {/* Compact invite row: one line, the full URL only appears if the
          clipboard is blocked (older webviews) so long-press copy still works. */}
      <section className="gn-card space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="gn-hint">Invite link. Anyone with it can join.</span>
          <button onClick={copyInvite} className="gn-btn gn-btn--go" style={{ minHeight: "40px" }}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {showInviteUrl && <code className="gn-code" style={{ display: "block" }}>{inviteUrl}</code>}
      </section>

      {group.myRole === "owner" && (
        <>
          <div className="gn-divider">Danger zone</div>
          <button
            className="gn-textbtn gn-textbtn--danger"
            onClick={async () => {
              if (!window.confirm(`Delete the entire "${group.name}" crew? Every event, bracket and lifetime stat goes with it. This cannot be undone.`)) return;
              if (!window.confirm("Really delete? There's no undo.")) return;
              try {
                await api(`/api/groups/${group.id}`, { method: "DELETE" });
                navigate("/");
              } catch (e) {
                window.alert(e instanceof Error ? e.message : "Couldn't delete");
              }
            }}
          >
            delete this crew
          </button>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="gn-app">
      <div className="gn-wrap space-y-6">
        <Link to="/" className="gn-textbtn" style={{ display: "inline-block" }}>
          &larr; All crews
        </Link>
        {children}
      </div>
    </main>
  );
}

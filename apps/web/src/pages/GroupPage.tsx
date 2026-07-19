import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type EventSummary, type GroupDetail, type Me } from "../api";
import { useLiveUpdates } from "../useLiveUpdates";

export default function GroupPage({
  me,
  onNameChange,
}: {
  me: Me | null;
  onNameChange: (name: string) => void;
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showInviteUrl, setShowInviteUrl] = useState(false);
  const [title, setTitle] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(me?.displayName ?? "");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);

  const loadGroup = useCallback(() => {
    api<GroupDetail>(`/api/groups/${id}`)
      .then(setGroup)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [id]);
  const loadEvents = useCallback(() => {
    api<EventSummary[]>(`/api/groups/${id}/events`)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [id]);

  useEffect(() => {
    loadGroup();
    loadEvents();
  }, [loadGroup, loadEvents]);

  // Live: new events, deletions, and people joining or leaving all land
  // without a refresh, same as RSVPs.
  useLiveUpdates(
    (msg) => {
      if (msg.groupId !== id) return;
      if (msg.type === "group_events_changed" || msg.type === "event_deleted") loadEvents();
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
        }),
      });
      navigate(`/e/${e.id}`);
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
  if (!group) {
    return (
      <Shell>
        <p className="gn-hint">Loading...</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-1">
        <h1 className="gn-title text-2xl">{group.name}</h1>
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
                        group && {
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
                  className="gn-textbtn"
                  onClick={() => {
                    setNameDraft(me.displayName);
                    setEditingName(true);
                  }}
                >
                  edit
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      <Link to={`/g/${group.id}/stats`} className="gn-cab gn-cab--stats">
        <span className="gn-cab__name">📊 Lifetime stats</span>
        <span className="gn-cab__sub">wins, records, by game</span>
      </Link>

      {/* ---- Game nights ------------------------------------------------ */}
      <section className="space-y-3">
        <h2 className="gn-h2">Game nights</h2>
        {events === null && <p className="gn-hint">Loading...</p>}
        {events?.length === 0 && (
          <p className="gn-hint">Nothing scheduled yet. Start one below.</p>
        )}
        {!!events?.length && (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id}>
                <Link to={`/e/${e.id}`} className="gn-cab" style={{ display: "block" }}>
                  <div className="flex justify-between items-baseline gap-2">
                    <span className="gn-cab__name" style={{ fontSize: "16px" }}>{e.title}</span>
                    <span className="flex items-baseline gap-3">
                      {e.myStatus && (
                        <span className="gn-hint" style={{ fontSize: "12px" }}>you: {e.myStatus}</span>
                      )}
                      {canManage && (
                        <button
                          className="gn-textbtn gn-textbtn--danger"
                          style={{ fontSize: "12px", padding: 0 }}
                          onClick={async (ev) => {
                            // Inside the card's Link: don't navigate, just delete.
                            ev.preventDefault();
                            ev.stopPropagation();
                            if (!window.confirm(`Delete "${e.title}"? Its RSVPs, brackets and recorded stats go with it. This can't be undone.`)) return;
                            try {
                              await api(`/api/events/${e.id}`, { method: "DELETE" });
                              setEvents((events ?? []).filter((x) => x.id !== e.id));
                            } catch (err) {
                              window.alert(err instanceof Error ? err.message : "Couldn't delete");
                            }
                          }}
                        >
                          delete
                        </button>
                      )}
                    </span>
                  </div>
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
                    {e.counts.yes} in / {e.counts.maybe} maybe / {e.counts.no} out
                  </div>
                </Link>
              </li>
            ))}
          </ul>
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
                className="flex justify-between items-center gap-2"
                style={{
                  background: "var(--gn-raise)",
                  border: "2px solid var(--gn-line)",
                  borderRadius: "12px",
                  padding: "10px 14px",
                }}
              >
                <button
                  onClick={() => navigate(`/g/${group.id}/member/${m.userId}`)}
                  style={{
                    fontWeight: 700,
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--gn-ink)",
                    cursor: "pointer",
                    textAlign: "left",
                    font: "inherit",
                  }}
                  title={me && m.userId === me.id ? "Your stats" : `You vs ${m.displayName}`}
                >
                  {m.displayName}
                  <span className="gn-hint" style={{ fontWeight: 400, fontSize: "11px", marginLeft: "6px" }}>
                    {me && m.userId === me.id ? "stats" : "vs"}
                  </span>
                </button>
                <span className="flex items-center gap-2">
                  <span className={`gn-chip gn-chip--${m.role}`}>{m.role}</span>
                  {group.myRole === "owner" && m.role !== "owner" && (
                    <button
                      className="gn-textbtn"
                      onClick={async () => {
                        const next = m.role === "admin" ? "member" : "admin";
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
                      {m.role === "admin" ? "demote" : "make admin"}
                    </button>
                  )}
                  {canRemove && (
                    <button
                      className="gn-textbtn gn-textbtn--danger"
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
      </section>

      {/* Compact invite row: one line, the full URL only appears if the
          clipboard is blocked (older webviews) so long-press copy still works. */}
      <section className="gn-card space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="gn-hint">Invite link — anyone with it can join.</span>
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

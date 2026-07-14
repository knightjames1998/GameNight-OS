import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type EventSummary, type GroupDetail, type Me } from "../api";

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
  const [title, setTitle] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(me?.displayName ?? "");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<GroupDetail>(`/api/groups/${id}`)
      .then(setGroup)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    api<EventSummary[]>(`/api/groups/${id}/events`)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [id]);

  const inviteUrl = group ? `${window.location.origin}/join/${group.inviteCode}` : "";

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (older webviews); the link is visible to
      // long-press copy either way.
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
        <p className="text-red-400">{error}</p>
      </Shell>
    );
  }
  if (!group) {
    return (
      <Shell>
        <p className="text-neutral-500">Loading...</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-bold tracking-tight">{group.name}</h1>

      {me && (
        <div className="text-sm text-neutral-500 -mt-6">
          {editingName ? (
            <span className="flex gap-2 items-center">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={30}
                className="rounded bg-neutral-900 border border-neutral-800 px-2 py-1 text-neutral-100 outline-none focus:border-neutral-600"
              />
              <button
                className="text-neutral-300"
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
              Playing as <span className="text-neutral-300">{me.displayName}</span>{" "}
              <button
                className="underline"
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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Game nights</h2>
        {events === null && <p className="text-neutral-500 text-sm">Loading...</p>}
        {events?.length === 0 && (
          <p className="text-neutral-500 text-sm">Nothing scheduled. Fix that below.</p>
        )}
        <ul className="space-y-2">
          {events?.map((e) => (
            <li key={e.id}>
              <Link
                to={`/e/${e.id}`}
                className="block rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 hover:border-neutral-600"
              >
                <div className="flex justify-between items-baseline">
                  <span className="font-medium">{e.title}</span>
                  {e.myStatus && (
                    <span className="text-xs text-neutral-500">you: {e.myStatus}</span>
                  )}
                </div>
                <div className="text-sm text-neutral-400 mt-1">
                  {e.scheduledFor
                    ? new Date(e.scheduledFor).toLocaleString([], {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "Date TBD"}
                  <span className="text-neutral-600">
                    {" "}
                    &middot; {e.counts.yes} in / {e.counts.maybe} maybe / {e.counts.no} out
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="space-y-2 pt-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Game night title"
            maxLength={80}
            className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-2 outline-none focus:border-neutral-600"
          />
          <label className="block text-sm text-neutral-400">Date and time (optional)</label>
          <div className="flex gap-2">
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="flex-1 rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-2 outline-none focus:border-neutral-600 text-neutral-300"
            />
            <button
              onClick={createEvent}
              disabled={!title.trim() || busy}
              className="rounded-lg bg-neutral-100 text-neutral-950 font-semibold px-4 py-2 disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Invite your crew</h2>
        <p className="text-neutral-400 text-sm">
          Anyone with this link can join. Drop it in the group chat.
        </p>
        <div className="flex gap-2 items-center">
          <code className="flex-1 rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs break-all">
            {inviteUrl}
          </code>
          <button
            onClick={copyInvite}
            className="rounded-lg bg-neutral-100 text-neutral-950 font-semibold px-3 py-2 text-sm shrink-0"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">
            Members <span className="text-neutral-500 font-normal">({group.members.length})</span>
          </h2>
          <button
            className="text-red-400/70 text-sm"
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
        <ul className="space-y-1">
          {group.members.map((m) => {
            const canRemove =
              me &&
              m.userId !== me.id &&
              (group.myRole === "owner" ||
                (group.myRole === "admin" && m.role === "member"));
            return (
              <li
                key={m.userId}
                className="flex justify-between items-center rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-2"
              >
                <span>{m.displayName}</span>
                <span className="flex items-center gap-3">
                  <span className="text-neutral-500 text-sm">{m.role}</span>
                  {canRemove && (
                    <button
                      className="text-red-400/70 text-sm"
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
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 p-6 max-w-md mx-auto space-y-8">
      <Link to="/" className="text-sm text-neutral-500">
        &larr; All crews
      </Link>
      {children}
    </main>
  );
}

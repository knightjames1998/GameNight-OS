import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type GroupSummary, type Me } from "../api";
import Login from "./Login";

export default function Home({
  me,
  onNameChange,
  onLogout,
}: {
  me: Me | null;
  onNameChange: (name: string) => void;
  onLogout: () => void;
}) {
  if (!me) {
    return (
      <main className="min-h-dvh bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center gap-8 p-6">
        <h1 className="text-3xl font-bold tracking-tight">GameNight OS</h1>
        <Login />
      </main>
    );
  }
  return <Groups me={me} onNameChange={onNameChange} onLogout={onLogout} />;
}

function Groups({
  me,
  onNameChange,
  onLogout,
}: {
  me: Me;
  onNameChange: (name: string) => void;
  onLogout: () => void;
}) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [newName, setNewName] = useState("");
  const [displayName, setDisplayName] = useState(me.displayName);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<GroupSummary[]>("/api/groups").then(setGroups).catch(() => setGroups([]));
  }, []);

  async function createGroup() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      const g = await api<GroupSummary>("/api/groups", {
        method: "POST",
        body: JSON.stringify({ name: newName }),
      });
      setGroups([...(groups ?? []), { ...g, role: "owner" }]);
      setNewName("");
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    const name = displayName.trim();
    if (!name || name === me.displayName) return;
    await api("/api/auth/me", { method: "PATCH", body: JSON.stringify({ displayName: name }) });
    onNameChange(name);
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 p-6 max-w-md mx-auto space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">GameNight OS</h1>
        <button className="text-sm text-neutral-500" onClick={onLogout}>
          Log out
        </button>
      </header>

      <section className="space-y-2">
        <label className="text-sm text-neutral-400">Your name (what your crew sees)</label>
        <div className="flex gap-2">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={30}
            className="flex-1 rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-2 outline-none focus:border-neutral-600"
          />
          <button
            onClick={saveName}
            disabled={displayName.trim() === me.displayName || !displayName.trim()}
            className="rounded-lg bg-neutral-800 px-4 py-2 text-sm disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your crews</h2>
        {groups === null && <p className="text-neutral-500 text-sm">Loading...</p>}
        {groups?.length === 0 && (
          <p className="text-neutral-500 text-sm">
            No crews yet. Create one below or ask a friend for an invite link.
          </p>
        )}
        <ul className="space-y-2">
          {groups?.map((g) => (
            <li key={g.id}>
              <Link
                to={`/g/${g.id}`}
                className="block rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 hover:border-neutral-600"
              >
                <span className="font-medium">{g.name}</span>
                <span className="text-neutral-500 text-sm ml-2">{g.role}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 pt-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createGroup()}
            placeholder="New crew name"
            maxLength={50}
            className="flex-1 rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-2 outline-none focus:border-neutral-600"
          />
          <button
            onClick={createGroup}
            disabled={!newName.trim() || busy}
            className="rounded-lg bg-neutral-100 text-neutral-950 font-semibold px-4 py-2 disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </section>
    </main>
  );
}

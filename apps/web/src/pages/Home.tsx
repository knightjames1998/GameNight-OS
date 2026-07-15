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
      <main className="gn-app flex flex-col items-center justify-center gap-8 p-6">
        <h1 className="gn-brand text-4xl">GameNight OS</h1>
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
  const [pw, setPw] = useState("");
  const [pwSaved, setPwSaved] = useState(false);
  const [showPw, setShowPw] = useState(false);

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

  async function savePassword() {
    await api("/api/auth/password", { method: "PATCH", body: JSON.stringify({ password: pw }) });
    setPw("");
    setPwSaved(true);
  }

  return (
    <main className="gn-app">
      <div className="gn-wrap space-y-8">
        <header className="flex items-center justify-between">
          <h1 className="gn-brand text-3xl">GameNight OS</h1>
          <button className="gn-textbtn" onClick={onLogout}>
            Log out
          </button>
        </header>

        <section className="space-y-2">
          <label className="gn-lab" htmlFor="home-name">
            Your name (what your crew sees)
          </label>
          <div className="flex gap-2">
            <input
              id="home-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={30}
              className="gn-input"
            />
            <button
              onClick={saveName}
              disabled={displayName.trim() === me.displayName || !displayName.trim()}
              className="gn-btn gn-btn--ghost"
            >
              Save
            </button>
          </div>
        </section>

        {/* Password: prominent prompt when unset, collapses to a small
            "Change password" once one exists so it stops eating space. */}
        <section>
          {me.hasPassword && !showPw ? (
            <div className="flex items-center justify-between">
              <span className="gn-hint">Password set.</span>
              <button className="gn-textbtn" onClick={() => setShowPw(true)}>
                Change password
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="gn-lab" htmlFor="home-pw">
                {me.hasPassword ? "New password" : "Set a password (skip the email link next time)"}
              </label>
              <div className="flex gap-2">
                <input
                  id="home-pw"
                  type="password"
                  autoComplete="new-password"
                  value={pw}
                  onChange={(e) => { setPw(e.target.value); setPwSaved(false); }}
                  placeholder="8+ characters"
                  className="gn-input"
                />
                <button onClick={savePassword} disabled={pw.length < 8} className="gn-btn gn-btn--go">
                  {pwSaved ? "Saved" : "Save"}
                </button>
                {me.hasPassword && (
                  <button
                    className="gn-textbtn"
                    onClick={() => { setShowPw(false); setPw(""); setPwSaved(false); }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="gn-h2">Game modes</h2>
          <p className="gn-hint">Playable standalone, no event needed; fill in names manually.</p>
          <Link to="/beerio" className="gn-cab gn-cab--beerio">
            <span className="gn-cab__name">🍺 Beerio Kart</span>
            <span className="gn-cab__sub">Double Elim &amp; Grand Prix</span>
          </Link>
          <Link to="/quick" className="gn-cab gn-cab--brk">
            <span className="gn-cab__name">🏆 Generalized bracket</span>
            <span className="gn-cab__sub">single elim, typed names</span>
          </Link>
        </section>

        <section className="space-y-3">
          <h2 className="gn-h2">Your crews</h2>
          {groups === null && <p className="gn-hint">Loading...</p>}
          {groups?.length === 0 && (
            <p className="gn-hint">
              No crews yet. Start one below or ask a friend for an invite link.
            </p>
          )}
          {!!groups?.length && (
            <ul className="space-y-2">
              {groups.map((g) => (
                <li key={g.id}>
                  <Link to={`/g/${g.id}`} className="gn-cab flex items-center justify-between">
                    <span className="font-bold">{g.name}</span>
                    <span className={`gn-chip gn-chip--${g.role}`}>{g.role}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="gn-divider">Add a crew</div>
          <div className="gn-card flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createGroup()}
              placeholder="New crew name"
              maxLength={50}
              className="gn-input"
            />
            <button onClick={createGroup} disabled={!newName.trim() || busy} className="gn-btn gn-btn--p1">
              Create
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type GroupSummary, type Me } from "../api";
import Login from "./Login";
import GamePicker, { type PickerGame } from "../GamePicker";

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
      <main className="gn-app flex flex-col items-center justify-center gap-8" style={{ padding: "calc(1.5rem + env(safe-area-inset-top, 0px)) calc(1.5rem + env(safe-area-inset-right, 0px)) calc(1.5rem + env(safe-area-inset-bottom, 0px)) calc(1.5rem + env(safe-area-inset-left, 0px))" }}>
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
  const navigate = useNavigate();
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

  // Session packs need a (personal) event to hang the live session on; spin
  // one up, then drop into the pack's own setup screen.
  async function startSession(pack: "smash" | "mariokart" | "marioparty", suffix = "") {
    if (busy) return;
    setBusy(true);
    try {
      const { eventId } = await api<{ eventId: string }>(`/api/quickplay/${pack}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      navigate(`/${pack}?event=${eventId}${suffix}`);
    } finally {
      setBusy(false);
    }
  }

  const quickGames: PickerGame[] = [
    {
      key: "mariokart",
      name: "Mario Kart",
      emoji: "🏎️",
      cabClass: "gn-cab--mk",
      formats: [
        { key: "beerio", label: "🍺 Beerio Kart", sub: "double elim & grand prix", onPick: () => navigate("/beerio") },
        { key: "general", label: "🏁 General tracking", sub: "pick a racer, log races", onPick: () => startSession("mariokart") },
      ],
    },
    {
      key: "smash",
      name: "Smash Bros",
      emoji: "🥊",
      cabClass: "gn-cab--smash",
      formats: [
        { key: "ffa", label: "Free-for-all", sub: "2–8 players a game", onPick: () => startSession("smash", "&mode=ffa") },
        { key: "koth", label: "King of the Hill", sub: "winner stays on", onPick: () => startSession("smash", "&mode=koth") },
      ],
    },
    {
      key: "marioparty",
      name: "Mario Party",
      emoji: "🎲",
      cabClass: "gn-cab--mp",
      formats: [
        { key: "board", label: "🎲 Board night", sub: "stars, boards, bonus stars", onPick: () => startSession("marioparty") },
      ],
    },
    {
      key: "tournament",
      name: "Tournament",
      emoji: "🏆",
      cabClass: "gn-cab--brk",
      formats: [
        { key: "single", label: "Single elimination", sub: "typed names", onPick: () => navigate("/quick?format=single_elim") },
        { key: "double", label: "Double elimination", sub: "losers bracket + grand final", onPick: () => navigate("/quick?format=double_elim") },
      ],
    },
  ];

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

          {/* Password lives right under the name field: prominent prompt when
              unset, collapses to a small "Change password" once one exists. */}
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

        <YourStats />

        <section className="space-y-3">
          <h2 className="gn-h2">Games</h2>
          <p className="gn-hint">Playable standalone, no event needed; fill in names manually.</p>
          <GamePicker games={quickGames} />
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

// Lifetime totals across every crew (quick play included). Hidden until
// there's at least one recorded game so a fresh account's home stays clean.
interface MyStats {
  played: number;
  wins: number;
  winRate: number;
  podiums: number;
  byGame: { name: string; played: number; wins: number }[];
  byCrew: { groupId: string; name: string; played: number; wins: number; personal: boolean }[];
}

function YourStats() {
  const [stats, setStats] = useState<MyStats | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api<MyStats>("/api/me/stats")
      .then(setStats)
      .catch(() => {});
  }, []);

  if (!stats || stats.played === 0) return null;
  const top = stats.byGame[0];

  return (
    <section className="space-y-2">
      <h2 className="gn-h2">Your stats</h2>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left"
        style={{
          background: "var(--gn-raise)",
          border: "2px solid var(--gn-line)",
          borderRadius: "14px",
          padding: "12px 16px",
          color: "var(--gn-ink)",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        <div className="flex justify-between items-baseline">
          <span style={{ fontWeight: 800, fontSize: "18px" }}>
            {stats.wins}
            <span className="gn-hint" style={{ fontWeight: 400 }}> wins · </span>
            {stats.played}
            <span className="gn-hint" style={{ fontWeight: 400 }}> games · </span>
            {Math.round(stats.winRate * 100)}%
          </span>
          <span className="gn-hint" style={{ fontSize: "12px" }}>{open ? "less" : "more"}</span>
        </div>
        {top && (
          <div className="gn-hint" style={{ fontSize: "12px", marginTop: "2px" }}>
            most played: {top.name} ({top.wins}W / {top.played})
          </div>
        )}
      </button>
      {open && (
        <div className="space-y-1" style={{ padding: "2px 4px" }}>
          {stats.byCrew.map((c) => (
            <div key={c.groupId} className="flex justify-between items-baseline">
              {c.personal ? (
                <span className="gn-hint">Quick play</span>
              ) : (
                <Link to={`/g/${c.groupId}/stats`} className="gn-textbtn" style={{ padding: 0 }}>
                  {c.name}
                </Link>
              )}
              <span className="gn-hint" style={{ fontSize: "12px" }}>
                {c.wins}W · {c.played} played
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

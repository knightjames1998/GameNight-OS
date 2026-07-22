import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Friend, type GroupSummary, type Me } from "../api";
import Login from "./Login";
import GamePicker, { type PickerGame } from "../GamePicker";
import AddToHomeHint from "../AddToHomeHint";

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
        <div style={{ maxWidth: "24rem", width: "100%" }}>
          <AddToHomeHint />
        </div>
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
  async function startSession(pack: "smash" | "mariokart" | "marioparty" | "pingpong", suffix = "") {
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
        { key: "free", label: "🏁 Free Play", sub: "single races", onPick: () => startSession("mariokart", "&format=free") },
        { key: "grandprix", label: "🏆 Grand Prix", sub: "a cup on points", onPick: () => startSession("mariokart", "&format=grandprix") },
        { key: "bestof", label: "Best Of", sub: "1v1 race sets", onPick: () => startSession("mariokart", "&format=bestof") },
        { key: "koth", label: "King of the Hill", sub: "winner stays on", onPick: () => startSession("mariokart", "&format=koth") },
      ],
    },
    {
      key: "smash",
      name: "Smash Bros",
      emoji: "🥊",
      cabClass: "gn-cab--smash",
      formats: [
        { key: "ffa", label: "Free-for-all", sub: "2–8 players a game", onPick: () => startSession("smash", "&format=ffa") },
        { key: "koth", label: "King of the Hill", sub: "winner stays on", onPick: () => startSession("smash", "&format=koth") },
        { key: "bestof", label: "Best Of", sub: "1v1 sets, best of 3/5/7", onPick: () => startSession("smash", "&format=bestof") },
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
      key: "pingpong",
      name: "Ping Pong",
      emoji: "🏓",
      cabClass: "gn-cab--pp",
      formats: [
        { key: "free", label: "Free Play", sub: "single games, one tap each", onPick: () => startSession("pingpong", "&format=free") },
        { key: "bestof", label: "Best Of", sub: "3, 5 or 7 game series", onPick: () => startSession("pingpong", "&format=bestof") },
        { key: "koth", label: "King of the Hill", sub: "winner stays on", onPick: () => startSession("pingpong", "&format=koth") },
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
      <div className="gn-wrap gn-wrap--wide space-y-8">
        <header className="flex items-center justify-between">
          <h1 className="gn-brand text-3xl">GameNight OS</h1>
          <button className="gn-actionbtn gn-actionbtn--danger" onClick={onLogout}>
            Log out
          </button>
        </header>

        <AddToHomeHint />

        {/* Account on the left two-thirds, detailed personal stats on the
            right third. Stacks on narrow screens. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5 items-start">
          <section className="space-y-2 md:col-span-2">
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
                <button className="gn-actionbtn" onClick={() => setShowPw(true)}>
                  🔑 Change password
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

          <PersonalStats />
        </div>

        <Friends />

        <section className="space-y-3">
          <h2 className="gn-h2">Crews</h2>
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

        <section className="space-y-3">
          <h2 className="gn-h2">Quick play</h2>
          <p className="gn-hint">Playable standalone, no event needed; fill in names manually.</p>
          <GamePicker games={quickGames} />
        </section>
      </div>
    </main>
  );
}

// Everyone you've ever shared a crew with, in one place — no digging into a
// crew to look someone up. Crewing together is the connection; there's no
// separate add-friend step. Collapsed behind one button so a long friends
// list doesn't clutter the home page. Hidden until you've crewed with someone.
function Friends() {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api<Friend[]>("/api/friends")
      .then(setFriends)
      .catch(() => setFriends([]));
  }, []);

  if (!friends?.length) return null;

  return (
    <section className="space-y-3">
      <button
        className="gn-cab"
        style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit" }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="gn-cab__name">
          👥 Friends <span className="gn-hint" style={{ fontWeight: 400 }}>({friends.length})</span>
        </span>
        <span className="gn-cab__sub">
          {open ? "tap to hide" : "everyone you've crewed with · stats & rivalries"}
        </span>
      </button>
      {open && (
      <ul className="space-y-2">
        {friends.map((f) => (
          <li key={f.userId}>
            <Link
              to={`/friend/${f.userId}`}
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
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.displayName}
              </span>
              <span className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                <span className="gn-hint" style={{ fontSize: "11px" }}>
                  {f.crews.length === 1 ? f.crews[0] : `${f.crews.length} crews`}
                </span>
                <span className="gn-chip gn-chip--vs">vs ›</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}

// Detailed personal stats, top-right on Home. Lifetime totals across every
// crew (quick play included), broken down by game and by format.
interface MyStats {
  played: number;
  wins: number;
  winRate: number;
  podiums: number;
  byGame: { name: string; played: number; wins: number }[];
  byFormat: { format: string; played: number; wins: number }[];
  byCrew: { groupId: string; name: string; played: number; wins: number; personal: boolean }[];
}

const FORMAT_LABEL: Record<string, string> = {
  free: "Free Play",
  ffa: "Free-for-all",
  grandprix: "Grand Prix",
  bestof: "Best Of",
  koth: "King of the Hill",
  board: "Board night",
  other: "Other",
};

function StatTile({ n, label, accent }: { n: string; label: string; accent?: string }) {
  return (
    <div style={{ flex: 1, textAlign: "center", background: "var(--gn-surf)", border: "1.5px solid var(--gn-line)", borderRadius: 12, padding: "10px 4px" }}>
      <div style={{ fontFamily: "Fredoka, system-ui, sans-serif", fontWeight: 800, fontSize: 22, lineHeight: 1, color: accent ?? "var(--gn-ink)" }}>{n}</div>
      <div className="gn-hint" style={{ fontSize: 11, marginTop: 3 }}>{label}</div>
    </div>
  );
}

function PersonalStats() {
  const [stats, setStats] = useState<MyStats | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api<MyStats>("/api/me/stats").then(setStats).catch(() => {});
  }, []);

  const has = stats && stats.played > 0;
  return (
    <section className="gn-card md:col-span-1" style={{ alignSelf: "start", padding: "10px 14px" }}>
      <button
        onClick={() => has && setOpen((o) => !o)}
        className="w-full text-left"
        style={{ background: "transparent", border: 0, color: "var(--gn-ink)", font: "inherit", cursor: has ? "pointer" : "default", padding: 0 }}
        aria-expanded={open}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="gn-h2" style={{ whiteSpace: "nowrap" }}>Your stats</span>
          {has ? (
            <span aria-hidden="true" className="gn-hint" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", fontSize: 12 }}>▾</span>
          ) : (
            <span className="gn-hint" style={{ fontSize: 12 }}>no games yet</span>
          )}
        </div>
        {has && !open && (
          <div className="gn-hint" style={{ fontSize: 12.5, marginTop: 3 }}>
            <b style={{ color: "var(--gn-gold)" }}>{stats!.wins}</b>W · {stats!.played} games · {Math.round(stats!.winRate * 100)}%
          </div>
        )}
      </button>

      {open && stats && stats.played > 0 && (
        <div className="space-y-3" style={{ marginTop: 12 }}>
          <div className="flex gap-2">
            <StatTile n={String(stats.wins)} label="wins" accent="var(--gn-gold)" />
            <StatTile n={String(stats.played)} label="games" />
            <StatTile n={`${Math.round(stats.winRate * 100)}%`} label="win rate" accent="var(--gn-p2)" />
          </div>
          {stats.podiums > 0 && (
            <p className="gn-hint" style={{ fontSize: 12 }}>
              🏅 {stats.podiums} top-3 finish{stats.podiums === 1 ? "" : "es"}
            </p>
          )}

          {stats.byGame.length > 0 && (
            <div>
              <div className="gn-lab" style={{ fontSize: 12, marginBottom: 4 }}>By game</div>
              <ul className="space-y-1">
                {stats.byGame.slice(0, 4).map((g) => (
                  <li key={g.name} className="flex justify-between" style={{ fontSize: 13 }}>
                    <span className="truncate" style={{ marginRight: 8 }}>{g.name}</span>
                    <span className="gn-hint" style={{ flexShrink: 0 }}>
                      <span style={{ color: "var(--gn-ink)", fontWeight: 700 }}>{g.wins}</span>W / {g.played}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {stats.byFormat.length > 0 && (
            <div>
              <div className="gn-lab" style={{ fontSize: 12, marginBottom: 4 }}>By format</div>
              <ul className="space-y-1">
                {stats.byFormat.slice(0, 4).map((f) => (
                  <li key={f.format} className="flex justify-between" style={{ fontSize: 13 }}>
                    <span className="truncate" style={{ marginRight: 8 }}>{FORMAT_LABEL[f.format] ?? f.format}</span>
                    <span className="gn-hint" style={{ flexShrink: 0 }}>
                      <span style={{ color: "var(--gn-ink)", fontWeight: 700 }}>{f.wins}</span>W / {f.played}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {stats.byCrew.some((c) => !c.personal) && (
            <div style={{ borderTop: "1.5px solid var(--gn-line)", paddingTop: 8 }}>
              <div className="gn-lab" style={{ fontSize: 12, marginBottom: 4 }}>By crew</div>
              <ul className="space-y-1">
                {stats.byCrew.map((c) => (
                  <li key={c.groupId} className="flex justify-between items-baseline" style={{ fontSize: 13 }}>
                    {c.personal ? (
                      <span className="gn-hint">Quick play</span>
                    ) : (
                      <Link to={`/g/${c.groupId}/stats`} className="truncate" style={{ marginRight: 8, color: "var(--gn-p2)", fontWeight: 700, textDecoration: "none" }}>
                        {c.name}
                      </Link>
                    )}
                    <span className="gn-hint" style={{ flexShrink: 0 }}>{c.wins}W / {c.played}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

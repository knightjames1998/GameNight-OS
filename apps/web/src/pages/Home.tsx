import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type AttendanceStats, type Friend, type GroupSummary, type Me } from "../api";
import { useCachedApi } from "../cache";
import Login from "./Login";
import GamePicker from "../GamePicker";
import { buildPickerGames, isSingleFormatPack, type SessionPackKey } from "../packs";
import AddToHomeHint from "../AddToHomeHint";
import { GroupListSkeleton } from "../Skeleton";
import { onIntent, routes } from "../prefetch";
import { THEMES, useTheme } from "../useTheme";
// The form pips and their type, from the component the stats page and the crew
// leaderboard already share. Home renders the same five, at the small size.
import { Pip, type FormStats } from "../FormStats";

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
    // The inline padding overrides the shell default in index.css, so it has to
    // carry --gn-shell-inset itself or the signed-out screen is the one place
    // content still sits against the rail. Arcade's inset is 0px, so every one
    // of these collapses to exactly the value it had before.
    return (
      <main className="gn-app flex flex-col items-center justify-center gap-8" style={{ padding: "calc(1.5rem + env(safe-area-inset-top, 0px) + var(--gn-shell-inset)) calc(1.5rem + env(safe-area-inset-right, 0px) + var(--gn-shell-inset)) calc(1.5rem + env(safe-area-inset-bottom, 0px) + var(--gn-shell-inset)) calc(1.5rem + env(safe-area-inset-left, 0px) + var(--gn-shell-inset))" }}>
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
  // Cached: your crews are the first thing on screen and almost never change
  // between launches, so a returning user should never watch this load.
  const { data: groups, loading: groupsLoading, set: setGroups } =
    useCachedApi<GroupSummary[]>("groups", "/api/groups");
  const [newName, setNewName] = useState("");
  const [displayName, setDisplayName] = useState(me.displayName);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState("");
  const [pwSaved, setPwSaved] = useState(false);
  const [showPw, setShowPw] = useState(false);
  // Local mirror of "has a password" so setting one for the first time sticks
  // even though the me prop doesn't refetch.
  const [hasPw, setHasPw] = useState(me.hasPassword);



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
    setShowPw(false);
    setHasPw(true);
    // Flash "Password set." for a few seconds, then it collapses back to just
    // the "Change password" button.
    setPwSaved(true);
    setTimeout(() => setPwSaved(false), 5000);
  }

  // Session packs need a (personal) event to hang the live session on; spin
  // one up, then drop into the pack's own setup screen.
  // SessionPackKey, not a hand-typed copy of the same four strings: the route
  // segment this builds and the quick-play route the server registers now come
  // from the same registry entry, so they cannot disagree.
  async function startSession(pack: SessionPackKey, suffix = "") {
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

  /**
   * The tournament, and it is deliberately the SAME two lines as startSession.
   *
   * It used to go to /quick, a second entrant screen with four typed name
   * boxes, and that is the only reason quick play missed crew-member entrants,
   * the member versus guest distinction, the seeding shuffle, team entrants and
   * the entrant validation when all of those shipped on 2026-08-17. It now
   * mints the event and opens the SHARED setup screen, so whatever that screen
   * offers, quick play offers, permanently and with nothing to keep in step.
   *
   * Not folded into startSession because the tournament is not a SessionPackKey
   * and its screen is not /<pack>. One duplicated fetch is cheaper than a
   * parameter that exists for one caller.
   */
  async function startTournament(format: "single_elim" | "double_elim") {
    if (busy) return;
    setBusy(true);
    try {
      const { eventId } = await api<{ eventId: string }>("/api/quickplay/tournament", {
        method: "POST",
        body: JSON.stringify({}),
      });
      navigate(`/tournament?event=${eventId}&format=${format}`);
    } finally {
      setBusy(false);
    }
  }

  // One catalogue, shared with the event page (src/packs.ts). Quick play has
  // no event, so every format starts a fresh session; Beerio and Tournament
  // go straight to their own routes.
  const quickGames = buildPickerGames({
    destination: (pack, format) => () => {
      if (pack === "mariokart" && format === "beerio") return navigate("/beerio");
      // Tournament never reaches here: its formats are supplied below.
      if (pack === "tournament") return;
      // A pack with one format has nothing to choose, so it carries no suffix.
      // Asked of the catalogue rather than listed here; the list this replaced
      // was two packs out of date. See isSingleFormatPack in src/packs.ts.
      if (isSingleFormatPack(pack)) return startSession(pack);
      startSession(pack, `&format=${format}`);
    },
    // The sub copy said "typed names", which was true of the screen this used
    // to open and is not true of the one it opens now: the setup screen offers
    // you, typed guests, doubles and a seeding shuffle.
    tournamentFormats: [
      { key: "single", label: "Single elimination", sub: "you plus guests", onPick: () => startTournament("single_elim") },
      { key: "double", label: "Double elimination", sub: "losers bracket + grand final", onPick: () => startTournament("double_elim") },
    ],
  });

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

        {/* Account on the left two-thirds; the "Your stats" button fills the
            right third, its top aligned with the name field and its bottom
            with the Change password button. The label sits above the grid so
            the button doesn't stretch up over it. */}
        <section className="space-y-2">
          <label className="gn-lab" htmlFor="home-name">
            Your name (what your crew sees)
          </label>
          {/* STACKS ON A PHONE, which the three-column grid never did. The
              panel used to be two lines and survived a third of 390px; it is
              seven now, and 130px is not a column, it is a wrapping accident.
              Full width under the account controls below sm, the right third
              above it. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
            <div className="col-span-1 sm:col-span-2 space-y-2 min-w-0">
              <div className="flex gap-2 min-w-0">
                <input
                  id="home-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={30}
                  className="gn-input"
                  style={{ minWidth: 0 }}
                />
                <button
                  onClick={saveName}
                  disabled={displayName.trim() === me.displayName || !displayName.trim()}
                  className="gn-btn gn-btn--ghost"
                >
                  Save
                </button>
              </div>

              {/* Change password sits left; the "Password set" confirmation
                  flashes to its right for a few seconds after saving. */}
              {hasPw && !showPw ? (
                <div className="flex items-center gap-2">
                  <button className="gn-actionbtn" onClick={() => setShowPw(true)}>
                    🔑 Change password
                  </button>
                  {pwSaved && <span className="gn-hint" style={{ color: "var(--gn-p2)" }}>✓ Password set</span>}
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="gn-lab" htmlFor="home-pw">
                    {hasPw ? "New password" : "Set a password (skip the email link next time)"}
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
                    {hasPw && (
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
            </div>

            <StatsButton />
          </div>

          <ThemePicker />
        </section>

        <Friends />

        <section className="space-y-3">
          <h2 className="gn-h2">Crews</h2>
          {groupsLoading && <GroupListSkeleton />}
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

// The theme switcher, sitting with the other per-device account controls
// rather than inside the Friends cabinet: it is a setting about this phone, in
// the same visual language as the name field and Change password above it.
//
// ONE THEME IN THE LIST TODAY. That is stage 1 doing its job: the plumbing
// ships and is provably a no-op before any new colour exists to argue about.
// Stage 2 adds Tabletop to THEMES and this renders two pills with no change
// here. The pills are .gn-tab, which is the shell's existing "pick one of
// these" control (the stats leaderboard filters), so it already matches.
function ThemePicker() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="space-y-2">
      <span className="gn-lab" id="home-theme-lab">
        Theme (this device)
      </span>
      <div className="flex gap-2 flex-wrap" role="group" aria-labelledby="home-theme-lab">
        {THEMES.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`gn-tab${theme === t.key ? " gn-tab--on" : ""}`}
            aria-pressed={theme === t.key}
            onClick={() => setTheme(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Everyone you've ever shared a crew with, in one place, with no digging into a
// crew to look someone up. Crewing together is the connection; there's no
// separate add-friend step. Collapsed behind one button so a long friends
// list doesn't clutter the home page. Hidden until you've crewed with someone.
function Friends() {
  // Cached: the friends list is the same on almost every launch, so it should
  // be there on the first paint rather than popping in a moment later.
  const { data: friends } = useCachedApi<Friend[]>("friends", "/api/friends");
  const [open, setOpen] = useState(false);

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
          <span className="gn-hint" style={{ fontSize: 11, fontWeight: 400 }} aria-hidden="true">
            {open ? "▴" : "▾"}
          </span>
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

// The personal stats panel on Home: the right third of the account row on a
// wide screen, a full-width block under it on a phone, and a link into the
// full stats page either way.
//
// EVERY FIELD BELOW WAS ALREADY IN THE PAYLOAD. This panel adds NO request and
// NO server work: it reads the same /api/me/stats through the same useCachedApi
// under the same `me:stats` key MyStatsPage uses, which is what makes opening
// the full page from here instant. What changed is only how much of that
// payload gets rendered: it used to show wins and win rate and throw the rest
// away.
//
// IT STAYS A ROUTER LINK, never a raw <a href>: an <a> is a full document load
// that discards the cache, the service worker warmth and the live socket, on
// the one screen a returning user lands on first. The onIntent prefetch stays
// with it.
interface HomeStats {
  played: number;
  wins: number;
  winRate: number;
  /** Best (lowest) placement and the average. Returned since 07-27, never rendered HERE. */
  best: number | null;
  avgPlacement: number | null;
  nightsPlayed?: number;
  form?: FormStats;
  attendance?: AttendanceStats;
  /** Only the main is read here; the full table is a page away. */
  characters?: { mostPlayed: string | null };
}

/**
 * One line of the panel. Label left, value right, both on the shell's normal
 * face at 12px, because this block sits in a third of a row on desktop and a
 * value that wraps is worse than a value that is not shown at all.
 */
function PanelRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2" style={{ minWidth: 0 }}>
      <span className="gn-hint" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {children}
      </span>
    </div>
  );
}

function StatsButton() {
  const { data: stats } = useCachedApi<HomeStats>("me:stats", "/api/me/stats");

  const has = !!stats && stats.played > 0;
  const form = stats?.form;
  const att = stats?.attendance;
  const main = stats?.characters?.mostPlayed;
  return (
    <Link
      to="/me/stats"
      {...onIntent(routes.myStats)}
      className="gn-card col-span-1 min-w-0 flex flex-col"
      style={{ padding: "10px 12px", textDecoration: "none", color: "var(--gn-ink)", gap: 4 }}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="gn-h2" style={{ whiteSpace: "nowrap", fontSize: 15 }}>Your stats</span>
        <span aria-hidden="true" className="gn-hint" style={{ fontSize: 14, color: "var(--gn-p2)" }}>›</span>
      </div>

      {/* A BRAND NEW ACCOUNT GETS ONE LINE, not a wall of zeroes. Every row
          below is about a record that does not exist yet, and rendering seven
          of them reading 0 and "-" is a worse first screen than saying so. */}
      {!has ? (
        <div className="gn-hint" style={{ fontSize: 12 }}>No games yet · see details</div>
      ) : (
        <>
          <div style={{ fontSize: 12 }}>
            <b style={{ color: "var(--gn-gold)" }}>{stats!.wins}</b>W ·{" "}
            <b>{Math.round(stats!.winRate * 100)}%</b>{" "}
            <span className="gn-hint">of {stats!.played}</span>
          </div>

          {/* Free: the endpoint has returned both since 2026-07-27 and Home
              has never printed either. */}
          <PanelRow label="best · avg">
            {stats!.best ? `#${stats!.best}` : "-"}
            <span className="gn-hint" style={{ fontWeight: 400 }}>
              {" · "}
              {stats!.avgPlacement ? stats!.avgPlacement.toFixed(1) : "-"}
            </span>
          </PanelRow>

          {form && form.tracked > 0 && (
            <PanelRow label="streak">
              <span style={{ color: form.currentStreak >= 3 ? "var(--gn-gold)" : undefined }}>
                {form.currentStreak}
                {form.currentStreak >= 3 ? " 🔥" : ""}
              </span>
              <span className="gn-hint" style={{ fontWeight: 400 }}>{` · best ${form.longestStreak}`}</span>
            </PanelRow>
          )}

          {form && form.last5.length > 0 && (
            <div className="flex items-center gap-1" style={{ marginTop: 1 }}>
              {/* Most recent first, the same order and the same component the
                  stats page and the crew leaderboard use. */}
              {form.last5.map((r, i) => (
                <Pip key={i} r={r} size={18} />
              ))}
            </div>
          )}

          {!!stats!.nightsPlayed && <PanelRow label="nights">{stats!.nightsPlayed}</PanelRow>}

          {/* attendanceFor returns zeroes for somebody with no tracked nights,
              so this hides on the same test ShowUpRecord uses rather than
              printing a 0% show rate at somebody who has never been asked. */}
          {att && att.tracked > 0 && (
            <PanelRow label="show rate">
              {Math.round((att.showRate ?? 0) * 100)}%
              <span className="gn-hint" style={{ fontWeight: 400 }}>
                {att.flaked > 0 ? ` · ${att.flaked} flake${att.flaked === 1 ? "" : "s"}` : ""}
              </span>
            </PanelRow>
          )}

          {main && <PanelRow label="main">{main}</PanelRow>}
        </>
      )}
    </Link>
  );
}

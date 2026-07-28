import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { type AttendanceStats, type Me } from "../api";
import { useCachedApi } from "../cache";
import BackButton from "../BackButton";
import CharacterStatsCard, { type CharacterStats } from "../CharacterStats";
import FormStatsCard, { type FormStats } from "../FormStats";
import Disclosure from "../Disclosure";
import DeepStats, { type PlacementStats, type HistoryStats, type GameExtreme } from "../DeepStats";
import ShowUpRecord, { Stat } from "../ShowUpRecord";
import { ensureRecapFonts } from "../recap";

// One page, two faces. Tapping yourself shows your profile; tapping anyone
// else opens the rivalry comparison (you vs them) by default, with a second
// tab for just their stats. Both read the same lifetime ledger the stats
// screen uses, so numbers always agree. The crew route scopes everything to
// one crew; the friend route (Home > Friends) aggregates every crew you share.

interface SideStats {
  userId: string;
  displayName: string;
  played: number;
  wins: number;
  best: number | null;
  winRate: number;
  avgPlacement: number | null;
  byGame: { name: string; played: number; wins: number }[];
  characters?: CharacterStats;
  form?: FormStats;
  nightsPlayed?: number;
  placements?: PlacementStats;
  history?: HistoryStats;
  bestGame?: GameExtreme | null;
  worstGame?: GameExtreme | null;
  minGamesForExtremes?: number;
  lastPlaceCount?: number;
  attendance?: AttendanceStats;
  /** Friend route only: the crews this view spans. */
  crews?: string[];
}

interface Rivalry {
  me: SideStats;
  them: SideStats;
  h2h: {
    meetings: number;
    wins: number;
    losses: number;
    ties: number;
    byGame: { name: string; meetings: number; myWins: number; theirWins: number }[];
    /** Signed: positive is my run, negative is theirs, 0 is neither. */
    currentStreak: number;
    myLongestStreak: number;
    theirLongestStreak: number;
    lastMeeting: { date: string | null; game: string; outcome: Outcome } | null;
    last5: { outcome: Outcome; game: string; date: string | null }[];
    /** Meetings that could be ordered by time. */
    tracked: number;
    charactersInMeetings: {
      mine: { name: string; played: number } | null;
      theirs: { name: string; played: number } | null;
    };
  };
}

type Outcome = "win" | "loss" | "tie";

const pct = (r: number) => `${Math.round(r * 100)}%`;

const shortDay = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** Crew route: /g/:id/member/:userId — everything scoped to that crew. */
export default function MemberPage({ me }: { me: Me | null }) {
  const { id: groupId, userId } = useParams();
  // Shares GroupPage's cache entry, so arriving here from the crew page
  // already knows the crew's name and never flashes an empty label.
  const { data: group } = useCachedApi<{ name: string }>(
    groupId ? `group:${groupId}` : null,
    groupId ? `/api/groups/${groupId}` : null,
  );
  if (!groupId || !userId) return null;
  return (
    <MemberView
      key={`${groupId}:${userId}`}
      isSelf={!!me && userId === me.id}
      profileUrl={`/api/groups/${groupId}/members/${userId}/stats`}
      rivalryUrl={`/api/groups/${groupId}/rivalry/${userId}`}
      contextLabel={group?.name ?? ""}
    />
  );
}

/** Friend route: /friend/:userId — aggregated across every crew you share. */
export function FriendPage({ me }: { me: Me | null }) {
  const { userId } = useParams();
  if (!userId) return null;
  return (
    <MemberView
      key={userId}
      isSelf={!!me && userId === me.id}
      profileUrl={`/api/friends/${userId}/stats`}
      rivalryUrl={`/api/friends/${userId}/rivalry`}
    />
  );
}

function MemberView({
  isSelf,
  profileUrl,
  rivalryUrl,
  contextLabel,
}: {
  isSelf: boolean;
  profileUrl: string;
  rivalryUrl: string;
  /** Shown after the names; the friend route derives it from profile.crews. */
  contextLabel?: string;
}) {
  // Keyed by URL, so the crew route and the friend route cache separately even
  // for the same person: they are genuinely different numbers (one crew versus
  // every crew you share).
  const { data: profile, error: profileErr } = useCachedApi<SideStats>(profileUrl, profileUrl);
  // A rivalry against yourself is not a thing; null key holds the fetch off.
  const { data: rivalry, error: rivalryErr } = useCachedApi<Rivalry>(
    isSelf ? null : rivalryUrl,
    isSelf ? null : rivalryUrl,
  );
  const err = (!profile && profileErr) || (!isSelf && !rivalry && rivalryErr) || "";
  const [showCard, setShowCard] = useState(false);
  const [tab, setTab] = useState<"rivalry" | "stats">("rivalry");

  const label = contextLabel || profile?.crews?.join(" · ") || "";

  return (
    <main className="gn-app">
      <div className="gn-wrap space-y-6">
        <BackButton />
        {err && <p className="gn-hint">{err}</p>}

        {isSelf && profile && <Profile stats={profile} title="Your stats" />}
        {!isSelf && !rivalry && !profile && !err && <p className="gn-hint">Loading...</p>}

        {!isSelf && (rivalry || profile) && (
          <>
            {/* Rivalry opens first; the second tab is just them. */}
            <div className="flex gap-2">
              <button
                className={`gn-tab ${tab === "rivalry" ? "gn-tab--on" : ""}`}
                onClick={() => setTab("rivalry")}
              >
                Rivalry
              </button>
              <button
                className={`gn-tab ${tab === "stats" ? "gn-tab--on" : ""}`}
                onClick={() => setTab("stats")}
              >
                {profile ? `${possessive(profile.displayName)} stats` : "Their stats"}
              </button>
            </div>

            {tab === "rivalry" && !rivalry && !err && <p className="gn-hint">Loading...</p>}
            {tab === "rivalry" && rivalry && (
              <>
                <header className="space-y-1">
                  <h1 className="gn-h1">Rivalry</h1>
                  <p className="gn-hint">
                    {rivalry.me.displayName} vs {rivalry.them.displayName}
                    {label ? ` · ${label}` : ""}
                  </p>
                </header>

                <RecordBanner r={rivalry} />
                <H2hExtras r={rivalry} />
                <Compare r={rivalry} />
                <H2hByGame r={rivalry} />
                <Disclosure label="More stats">
                  <Compare r={rivalry} variant="deep" />
                </Disclosure>

                <button className="gn-btn gn-btn--p1 w-full" onClick={() => setShowCard(true)}>
                  Share rivalry card
                </button>
              </>
            )}

            {tab === "stats" && !profile && !err && <p className="gn-hint">Loading...</p>}
            {tab === "stats" && profile && (
              <Profile stats={profile} title={`${possessive(profile.displayName)} stats`} subtitle={label} />
            )}
          </>
        )}
      </div>
      {showCard && rivalry && (
        <RivalryCardModal r={rivalry} groupName={label} onClose={() => setShowCard(false)} />
      )}
    </main>
  );
}

const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

// ---------- Self profile ----------

function Profile({ stats, title, subtitle }: { stats: SideStats; title: string; subtitle?: string }) {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="gn-h1">{title}</h1>
        <p className="gn-hint">
          {stats.displayName}
          {subtitle ? ` · ${subtitle}` : ""}
        </p>
      </header>
      {stats.played === 0 ? (
        <p className="gn-hint">No recorded games yet. Play something!</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="games" value={String(stats.played)} />
            <Stat label="wins" value={String(stats.wins)} accent="var(--gn-gold)" />
            <Stat label="win rate" value={pct(stats.winRate)} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <Stat label="best finish" value={stats.best ? `#${stats.best}` : "-"} />
            <Stat
              label="avg place"
              value={stats.avgPlacement ? stats.avgPlacement.toFixed(1) : "-"}
            />
          </div>
        </>
      )}
      {stats.played > 0 && (
        <FormStatsCard form={stats.form} nightsPlayed={stats.nightsPlayed} />
      )}
      <ShowUpRecord a={stats.attendance} />
      {stats.played > 0 && <CharacterStatsCard characters={stats.characters} />}
      {stats.played > 0 && (
        <div className="gn-card space-y-2">
          <h2 className="gn-h2">By game</h2>
          {stats.byGame.map((g) => (
            <div key={g.name} className="flex justify-between items-baseline">
              <span style={{ fontWeight: 700 }}>{g.name}</span>
              <span className="gn-hint">
                {g.wins}W · {g.played} played
              </span>
            </div>
          ))}
        </div>
      )}
      {stats.played > 0 && (
        <Disclosure label="More stats">
          <DeepStats
            placements={stats.placements}
            history={stats.history}
            bestGame={stats.bestGame}
            worstGame={stats.worstGame}
            lastPlaceCount={stats.lastPlaceCount}
            minGamesForExtremes={stats.minGamesForExtremes}
          />
        </Disclosure>
      )}
    </section>
  );
}



// ---------- Rivalry pieces ----------

// You are always teal, the opponent is always red/coral — here and on the card.
const P1 = "var(--gn-teal, #2dd4bf)"; // me
const P2 = "var(--gn-coral, #ff5a5f)"; // them

function RecordBanner({ r }: { r: Rivalry }) {
  const { wins, losses, ties, meetings } = r.h2h;
  return (
    <div
      className="text-center space-y-1"
      style={{
        background: "var(--gn-raise)",
        border: "2px solid var(--gn-line)",
        borderRadius: "14px",
        padding: "16px 12px",
      }}
    >
      <div className="gn-hint" style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        head to head
      </div>
      {meetings === 0 ? (
        <p className="gn-hint" style={{ padding: "6px 0" }}>
          You two haven't met in a recorded game yet. First blood pending.
        </p>
      ) : (
        <>
          <div style={{ fontWeight: 900, fontSize: "40px", lineHeight: 1.1 }}>
            <span style={{ color: P1 }}>{wins}</span>
            <span className="gn-hint" style={{ fontSize: "24px", padding: "0 10px" }}>-</span>
            <span style={{ color: P2 }}>{losses}</span>
          </div>
          <div className="gn-hint" style={{ fontSize: "12px" }}>
            {meetings} meeting{meetings === 1 ? "" : "s"}
            {ties ? ` · ${ties} tied` : ""}
          </div>
        </>
      )}
    </div>
  );
}

// The meeting-level detail: who took the last one, who is on a run, and what
// each of them reaches for when the other is in the room. Sits with the
// record banner because it is about the rivalry, not about either player.
function H2hExtras({ r }: { r: Rivalry }) {
  const { lastMeeting, currentStreak, myLongestStreak, theirLongestStreak, last5, charactersInMeetings, meetings } = r.h2h;
  if (meetings === 0) return null;

  const mine = charactersInMeetings.mine;
  const theirs = charactersInMeetings.theirs;
  const streakName = currentStreak > 0 ? r.me.displayName : r.them.displayName;
  const streakN = Math.abs(currentStreak);

  return (
    <div className="gn-card space-y-2" style={{ padding: "12px 16px" }}>
      {lastMeeting && (
        <p className="gn-hint" style={{ fontSize: 13 }}>
          Last meeting{shortDay(lastMeeting.date) ? ` ${shortDay(lastMeeting.date)}` : ""} in{" "}
          <b style={{ color: "var(--gn-ink)" }}>{lastMeeting.game}</b>
          {" · "}
          {lastMeeting.outcome === "tie" ? (
            "tied"
          ) : (
            <b style={{ color: lastMeeting.outcome === "win" ? P1 : P2 }}>
              {lastMeeting.outcome === "win" ? r.me.displayName : r.them.displayName} took it
            </b>
          )}
        </p>
      )}

      {streakN > 0 && (
        <p className="gn-hint" style={{ fontSize: 13 }}>
          <b style={{ color: currentStreak > 0 ? P1 : P2 }}>{streakName}</b> has won {streakN} in a row
        </p>
      )}

      {last5.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="gn-hint" style={{ fontSize: 12 }}>last {last5.length}</span>
          <span style={{ display: "flex", gap: 4 }}>
            {last5.map((m, i) => {
              const color = m.outcome === "win" ? P1 : m.outcome === "loss" ? P2 : "var(--gn-dim)";
              return (
                <span
                  key={i}
                  title={`${m.game}${shortDay(m.date) ? ` · ${shortDay(m.date)}` : ""}`}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    fontWeight: 800,
                    color: "var(--gn-bg)",
                    background: color,
                    flexShrink: 0,
                  }}
                >
                  {m.outcome === "win" ? "W" : m.outcome === "loss" ? "L" : "T"}
                </span>
              );
            })}
          </span>
        </div>
      )}

      {(myLongestStreak > 1 || theirLongestStreak > 1) && (
        <p className="gn-hint" style={{ fontSize: 12 }}>
          Best run: <b style={{ color: P1 }}>{myLongestStreak}</b> vs{" "}
          <b style={{ color: P2 }}>{theirLongestStreak}</b>
        </p>
      )}

      {(mine || theirs) && (
        <p className="gn-hint" style={{ fontSize: 12 }}>
          When they meet:{" "}
          {mine ? (
            <>
              <b style={{ color: P1 }}>{mine.name}</b> ({mine.played})
            </>
          ) : (
            "no character"
          )}
          {" vs "}
          {theirs ? (
            <>
              <b style={{ color: P2 }}>{theirs.name}</b> ({theirs.played})
            </>
          ) : (
            "no character"
          )}
        </p>
      )}
    </div>
  );
}

function Compare({ r, variant = "core" }: { r: Rivalry; variant?: "core" | "deep" }) {
  const rows: { label: string; a: string; b: string; aWins: boolean; bWins: boolean }[] = [];
  const add = (label: string, av: number | null | undefined, bv: number | null | undefined, fmt: (n: number) => string, lowerBetter = false) => {
    const an = av ?? null;
    const bn = bv ?? null;
    const a = an === null ? "-" : fmt(an);
    const b = bn === null ? "-" : fmt(bn);
    let aWins = false;
    let bWins = false;
    if (an !== null && bn !== null && an !== bn) {
      const aBetter = lowerBetter ? an < bn : an > bn;
      aWins = aBetter;
      bWins = !aBetter;
    }
    rows.push({ label, a, b, aWins, bWins });
  };

  if (variant === "core") {
    add("wins", r.me.wins, r.them.wins, String);
    add("win rate", r.me.winRate, r.them.winRate, pct);
    add("games", r.me.played, r.them.played, String);
    add("best finish", r.me.best, r.them.best, (n) => `#${n}`, true);
    add("avg place", r.me.avgPlacement, r.them.avgPlacement, (n) => n.toFixed(1), true);
  } else {
    // Both sides come from the same aggregate, so every one of these is a
    // like-for-like comparison with no extra derivation.
    add("streak", r.me.form?.currentStreak, r.them.form?.currentStreak, String);
    add("best streak", r.me.form?.longestStreak, r.them.form?.longestStreak, String);
    add("worst skid", r.me.form?.longestLossStreak, r.them.form?.longestLossStreak, String, true);
    add("1st place", r.me.placements?.firstShare, r.them.placements?.firstShare, pct);
    add("last place", r.me.lastPlaceCount, r.them.lastPlaceCount, String, true);
    add("nights", r.me.nightsPlayed, r.them.nightsPlayed, String);
    add("games a night", r.me.history?.gamesPerNight, r.them.history?.gamesPerNight, (n) => n.toFixed(1));
    add("characters", r.me.characters?.distinctCharacters, r.them.characters?.distinctCharacters, String);
  }

  return (
    <div className="gn-card space-y-2">
      <div className="flex justify-between" style={{ fontWeight: 800 }}>
        <span style={{ color: P1 }}>{r.me.displayName}</span>
        <span style={{ color: P2 }}>{r.them.displayName}</span>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between items-baseline gap-2">
          <span style={{ fontWeight: row.aWins ? 800 : 500, color: row.aWins ? P1 : "var(--gn-ink)", minWidth: "56px" }}>
            {row.a}
          </span>
          <span className="gn-hint" style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {row.label}
          </span>
          <span
            style={{
              fontWeight: row.bWins ? 800 : 500,
              color: row.bWins ? P2 : "var(--gn-ink)",
              minWidth: "56px",
              textAlign: "right",
            }}
          >
            {row.b}
          </span>
        </div>
      ))}
    </div>
  );
}

function H2hByGame({ r }: { r: Rivalry }) {
  if (!r.h2h.byGame.length) return null;
  return (
    <div className="gn-card space-y-2">
      <h2 className="gn-h2">Where you've met</h2>
      {r.h2h.byGame.map((g) => (
        <div key={g.name} className="flex justify-between items-baseline">
          <span style={{ fontWeight: 700 }}>{g.name}</span>
          <span style={{ fontWeight: 800 }}>
            <span style={{ color: P1 }}>{g.myWins}</span>
            <span className="gn-hint"> - </span>
            <span style={{ color: P2 }}>{g.theirWins}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Shareable card (canvas-to-JPG, same pipeline as the recap) ----------

const FONT_DISPLAY = `"Luckiest Guy", system-ui`;
const FONT_HEAD = `"Fredoka", system-ui`;
const FONT_BODY = `"Fredoka", system-ui`;
const C = {
  bg: "#1b1030",
  surf: "#251743",
  line: "#3a2a5e",
  ink: "#f5efff",
  dim: "#b3a5d6",
  gold: "#ffc857",
  coral: "#ff5a5f",
  teal: "#2dd4bf",
};

function drawRivalryCard(r: Rivalry, groupName: string): HTMLCanvasElement {
  const games = r.h2h.byGame.slice(0, 4);
  const scale = 2;
  const W = 800;
  const PAD = 40;
  const HEAD = 118;
  const NAMES = 84;
  const RECORD = 150;
  const STATS = 3 * 44 + 18;
  const GAMES = games.length ? 46 + games.length * 40 : 0;
  const FOOT = 64;
  const H = HEAD + NAMES + RECORD + STATS + GAMES + FOOT;

  const cv = document.createElement("canvas");
  cv.width = W * scale;
  cv.height = H * scale;
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  ctx.scale(scale, scale);

  // Background: deep plum, teal glow left (you), coral glow right (them).
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const gl = ctx.createRadialGradient(80, -40, 30, 80, -40, 420);
  gl.addColorStop(0, "rgba(45,212,191,0.18)");
  gl.addColorStop(1, "rgba(45,212,191,0)");
  ctx.fillStyle = gl;
  ctx.fillRect(0, 0, W, 260);
  const gr = ctx.createRadialGradient(W - 80, -40, 30, W - 80, -40, 420);
  gr.addColorStop(0, "rgba(255,90,95,0.20)");
  gr.addColorStop(1, "rgba(255,90,95,0)");
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, 260);

  // Header
  ctx.textAlign = "right";
  ctx.fillStyle = C.gold;
  ctx.font = `400 20px ${FONT_DISPLAY}`;
  ctx.fillText("GAMENIGHT OS", W - PAD, 44);
  ctx.textAlign = "left";
  ctx.fillStyle = C.ink;
  ctx.font = `400 44px ${FONT_DISPLAY}`;
  ctx.fillText("RIVALRY", PAD, 66);
  ctx.fillStyle = C.dim;
  ctx.font = `700 16px ${FONT_BODY}`;
  const date = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  ctx.fillText(`${groupName || "GameNight"} · ${date}`, PAD, 96);
  ctx.fillStyle = C.gold;
  ctx.fillRect(PAD, HEAD - 10, W - PAD * 2, 3);

  // Names, corner to corner
  let y = HEAD + 52;
  const name = (t: string, color: string, align: CanvasTextAlign, x: number) => {
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.font = `700 34px ${FONT_HEAD}`;
    ctx.fillText(t.slice(0, 14), x, y);
  };
  name(r.me.displayName, C.teal, "left", PAD);
  ctx.fillStyle = C.dim;
  ctx.textAlign = "center";
  ctx.font = `700 22px ${FONT_HEAD}`;
  ctx.fillText("VS", W / 2, y);
  name(r.them.displayName, C.coral, "right", W - PAD);

  // The record, huge
  y = HEAD + NAMES;
  ctx.textAlign = "center";
  if (r.h2h.meetings === 0) {
    ctx.fillStyle = C.dim;
    ctx.font = `700 24px ${FONT_HEAD}`;
    ctx.fillText("No meetings yet", W / 2, y + 88);
  } else {
    ctx.fillStyle = C.ink;
    ctx.font = `400 96px ${FONT_DISPLAY}`;
    const rec = `${r.h2h.wins} - ${r.h2h.losses}`;
    ctx.fillText(rec, W / 2, y + 96);
    ctx.fillStyle = C.dim;
    ctx.font = `700 17px ${FONT_BODY}`;
    ctx.fillText(
      `${r.h2h.meetings} meeting${r.h2h.meetings === 1 ? "" : "s"}${r.h2h.ties ? ` · ${r.h2h.ties} tied` : ""}`,
      W / 2,
      y + 130,
    );
  }

  // Three stat rows: wins, win rate, games
  y = HEAD + NAMES + RECORD;
  const statRow = (label: string, a: string, b: string, aWins: boolean, bWins: boolean) => {
    ctx.textAlign = "left";
    ctx.fillStyle = aWins ? C.teal : C.ink;
    ctx.font = `${aWins ? 800 : 600} 26px ${FONT_HEAD}`;
    ctx.fillText(a, PAD, y);
    ctx.textAlign = "center";
    ctx.fillStyle = C.dim;
    ctx.font = `700 14px ${FONT_BODY}`;
    ctx.fillText(label.toUpperCase(), W / 2, y - 3);
    ctx.textAlign = "right";
    ctx.fillStyle = bWins ? C.coral : C.ink;
    ctx.font = `${bWins ? 800 : 600} 26px ${FONT_HEAD}`;
    ctx.fillText(b, W - PAD, y);
    y += 44;
  };
  const better = (a: number, b: number) => [a > b, b > a] as const;
  let [aw, bw] = better(r.me.wins, r.them.wins);
  statRow("wins", String(r.me.wins), String(r.them.wins), aw, bw);
  [aw, bw] = better(r.me.winRate, r.them.winRate);
  statRow("win rate", pct(r.me.winRate), pct(r.them.winRate), aw, bw);
  [aw, bw] = better(r.me.played, r.them.played);
  statRow("games", String(r.me.played), String(r.them.played), false, false);

  // Per-game head to head
  if (games.length) {
    y += 10;
    ctx.fillStyle = C.line;
    ctx.fillRect(PAD, y - 24, W - PAD * 2, 2);
    ctx.textAlign = "left";
    ctx.fillStyle = C.gold;
    ctx.font = `700 16px ${FONT_BODY}`;
    ctx.fillText("HEAD TO HEAD BY GAME", PAD, y + 4);
    y += 40;
    for (const g of games) {
      ctx.textAlign = "left";
      ctx.fillStyle = C.ink;
      ctx.font = `600 20px ${FONT_HEAD}`;
      ctx.fillText(g.name.slice(0, 26), PAD, y);
      ctx.textAlign = "right";
      ctx.font = `800 20px ${FONT_HEAD}`;
      const rec = `${g.myWins} - ${g.theirWins}`;
      ctx.fillStyle = g.myWins > g.theirWins ? C.teal : g.theirWins > g.myWins ? C.coral : C.dim;
      ctx.fillText(rec, W - PAD, y);
      y += 40;
    }
  }

  // Footer
  ctx.fillStyle = C.gold;
  ctx.fillRect(PAD, H - FOOT + 8, W - PAD * 2, 3);
  ctx.textAlign = "center";
  ctx.fillStyle = C.dim;
  ctx.font = `700 14px ${FONT_BODY}`;
  ctx.fillText("settle it at the next game night", W / 2, H - 26);

  return cv;
}

function RivalryCardModal({ r, groupName, onClose }: { r: Rivalry; groupName: string; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureRecapFonts().then(() => {
      if (cancelled) return;
      const cv = drawRivalryCard(r, groupName);
      cv.toBlob(
        (b) => {
          if (!b || cancelled) return;
          setBlob(b);
          setUrl(URL.createObjectURL(b));
        },
        "image/jpeg",
        0.92,
      );
    });
    return () => {
      cancelled = true;
      setUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return "";
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fname = `rivalry-${new Date().toISOString().slice(0, 10)}.jpg`;

  async function share() {
    if (!blob) return;
    const file = new File([blob], fname, { type: "image/jpeg" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${r.me.displayName} vs ${r.them.displayName}`,
        });
        return;
      }
    } catch {
      // User cancelled or share failed; fall through to the hint.
    }
    setMsg("Sharing not available here; use Download instead.");
    setTimeout(() => setMsg(""), 2500);
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 z-50"
      style={{ background: "rgba(10,6,15,0.72)" }}
      onClick={onClose}
    >
      <div className="gn-card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h2 className="gn-h2">Rivalry card</h2>
          <button className="gn-textbtn" onClick={onClose}>
            close
          </button>
        </div>
        {url ? (
          <img
            src={url}
            alt="Rivalry card"
            className="w-full rounded-lg"
            style={{ border: "2px solid var(--gn-line)" }}
          />
        ) : (
          <p className="gn-hint py-8 text-center">Building your card...</p>
        )}
        {msg && (
          <p className="text-sm" style={{ color: "var(--gn-gold)" }}>
            {msg}
          </p>
        )}
        <div className="flex gap-2">
          <button onClick={share} className="gn-btn gn-btn--p1 flex-1">
            Share
          </button>
          <a
            href={url || undefined}
            download={fname}
            className="gn-btn gn-btn--ghost flex-1 text-center"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}
          >
            Download
          </a>
        </div>
      </div>
    </div>
  );
}

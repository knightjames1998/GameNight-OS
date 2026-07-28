import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useCachedApi } from "../cache";
import { StatsSkeleton } from "../Skeleton";
import { formatLabel, formatUnit } from "../formats";
import BackButton from "../BackButton";
import { type CharacterStats } from "../CharacterStats";
import { Pip, type FormStats } from "../FormStats";

interface StatRow {
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
}

interface FormatStat {
  format: string;
  played: number;
  players: { name: string; wins: number; played: number }[];
}
interface GameStats {
  name: string;
  tournaments: number;
  leaderboard: StatRow[];
  formats: FormatStat[];
}


interface StatsView {
  tournaments: number;
  leaderboard: StatRow[];
  games: GameStats[];
}

// The generic aggregator names the Smash pack's game this; the tab with
// this label swaps the generic list for the character-rich panel below.
const SMASH_GAME_NAME = "Smash Bros";

interface SmashStats {
  games: number;
  byCharacter: { character: string; played: number; wins: number; winRate: number }[];
  byPlayer: {
    userId: string;
    name: string;
    played: number;
    wins: number;
    winRate: number;
    main: string | null;
    variety: number;
    /** Distinct fighters this player has WON with (Smashdown's headline). */
    wonWith: number;
    bestStreak: number;
  }[];
  headToHead: {
    aUserId: string;
    bUserId: string;
    aName: string;
    bName: string;
    aWins: number;
    bWins: number;
    meetings: number;
  }[];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

// ---------- the one player row every tab uses ----------
//
// Each pack used to draw its own player list, so the same person read
// differently depending on which tab you were on: different headline number,
// different subline, and only the generic list expanded. This is that list,
// once. A pack keeps its own sections (fighters, boards, bonus stars, head to
// head) below it, since those are genuinely pack-specific, but the PLAYER
// ranking is identical everywhere and always expands to the same detail.

/** The affordance for anything that opens. Matches the app's existing ▾. */
function Caret({ open }: { open: boolean }) {
  return (
    <span className="gn-hint" style={{ fontSize: 11, flexShrink: 0, marginLeft: 2 }} aria-hidden="true">
      {open ? "▴" : "▾"}
    </span>
  );
}

function ExpandedStats({ r, showByGame }: { r: StatRow; showByGame: boolean }) {
  return (
    <div
      className="space-y-2"
      style={{ margin: "0 16px 12px", paddingLeft: "30px", borderTop: "2px solid var(--gn-line)", paddingTop: "8px" }}
    >
      {/* By game only on the overall tab: inside a game tab it would be one
          line repeating the tab's own name. */}
      {showByGame && r.byGame.length > 0 && (
        <ul className="space-y-1">
          {r.byGame.map((g) => (
            <li key={g.name} className="gn-hint flex justify-between" style={{ fontSize: "12px" }}>
              <span>{g.name}</span>
              <span style={{ color: "var(--gn-dim)" }}>
                {g.wins}/{g.played} won
              </span>
            </li>
          ))}
        </ul>
      )}

      {r.form && r.form.tracked > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ display: "flex", gap: 4 }}>
            {r.form.last5.map((x, j) => (
              <Pip key={j} r={x} size={20} />
            ))}
          </span>
          <span className="gn-hint" style={{ fontSize: "12px" }}>
            streak {r.form.currentStreak >= 3 ? `${r.form.currentStreak} 🔥` : r.form.currentStreak}
            {" · "}best {r.form.longestStreak}
            {r.nightsPlayed ? ` · ${r.nightsPlayed} night${r.nightsPlayed === 1 ? "" : "s"}` : ""}
          </span>
        </div>
      )}

      {r.characters && r.characters.byCharacter.length > 0 && (
        <div className="gn-hint" style={{ fontSize: "12px" }}>
          {r.characters.mostPlayed && (
            <>
              main <b style={{ color: "var(--gn-p2)" }}>{r.characters.mostPlayed}</b>
            </>
          )}
          {r.characters.best && r.characters.best !== r.characters.mostPlayed && (
            <>
              {" · "}best <b style={{ color: "var(--gn-gold)" }}>{r.characters.best}</b>
            </>
          )}
          <span style={{ color: "var(--gn-dim)" }}>
            {" · "}
            {r.characters.byCharacter
              .slice(0, 3)
              .map((c) => `${c.name} ${c.wins}/${c.played}`)
              .join(" · ")}
          </span>
        </div>
      )}
    </div>
  );
}

function PlayerRows({
  rows,
  open,
  setOpen,
  showByGame = false,
  extras,
}: {
  rows: StatRow[];
  open: string | null;
  setOpen: (id: string | null) => void;
  showByGame?: boolean;
  /** Pack-specific tail for the subline, keyed by userId (stars, game wins). */
  extras?: Map<string, ReactNode>;
}) {
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => {
        const expanded = open === r.userId;
        const top = i === 0;
        return (
          <li key={r.userId} className={top ? "gn-champ" : "gn-card"} style={{ padding: 0 }}>
            <button
              className="w-full text-left"
              style={{ padding: "12px 16px", background: "transparent", border: 0, color: "var(--gn-ink)" }}
              onClick={() => setOpen(expanded ? null : r.userId)}
              aria-expanded={expanded}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-baseline gap-2 min-w-0">
                  <span className={`gn-rank ${top ? "gn-rank--top" : ""}`} style={{ fontSize: "16px", width: "22px", flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <span className="font-bold truncate" style={top ? { color: "var(--gn-gold)" } : undefined}>
                    {r.displayName}
                  </span>
                </span>
                <span className="text-sm shrink-0 flex items-baseline gap-1">
                  <span className="font-bold">{r.wins}</span>
                  <span className="gn-hint">{r.wins === 1 ? "win" : "wins"}</span>
                  <Caret open={expanded} />
                </span>
              </div>
              <div className="gn-hint mt-1" style={{ fontSize: "12px", paddingLeft: "30px" }}>
                {r.played} played &middot; {pct(r.winRate)} win rate
                {r.avgPlacement !== null && ` · avg finish ${r.avgPlacement.toFixed(1)}`}
                {extras?.get(r.userId)}
              </div>
            </button>

            {expanded && <ExpandedStats r={r} showByGame={showByGame} />}
          </li>
        );
      })}
    </ul>
  );
}

/** Shared heading for a pack panel's own extra sections. */
const packHead = (label: string, accent: string) => (
  <h2 className="gn-h2" style={{ color: accent, marginBottom: 8 }}>
    {label}
  </h2>
);

/**
 * What every pack panel needs: its own groupId for its bespoke endpoint,
 * plus the shared per-game leaderboard rows so the PLAYER list is identical
 * across tabs.
 */
interface PackPanelProps {
  groupId: string;
  rows: StatRow[];
  open: string | null;
  setOpen: (id: string | null) => void;
}

function SmashPanel({ groupId, rows, open, setOpen }: PackPanelProps) {
  const { data, error } = useCachedApi<SmashStats>(
    `group:${groupId}:smash`,
    `/api/groups/${groupId}/smash-stats`,
  );

  if (!data && error) return <p style={{ color: "var(--gn-danger)" }} className="text-sm">{error}</p>;
  if (!data) return <StatsSkeleton />;
  if (data.games === 0) {
    return <p className="gn-hint">No Smash games recorded yet. Play a Free-for-all, King of the Hill or Smashdown night and it fills in here.</p>;
  }

  const accent = "#ff6a5a";
  const sectionHead = (label: string) => packHead(label, accent);

  // Main lives in the shared expanded block now, so it is not repeated here.
  // Fighter variety and the best streak are kept: the streak is scoped to a
  // single NIGHT (a hot run, or a KOTH king reign), which is a different
  // thing from the lifetime best streak the expanded block shows. "Won with"
  // is the Smashdown stat and is derived from the same ledger rows (distinct
  // character on a winning line), so it reads across every Smash format.
  const extras = new Map(
    data.byPlayer.map((p) => [
      p.userId,
      <>
        {" "}&middot; {p.variety} {p.variety === 1 ? "fighter" : "fighters"}
        {p.wonWith > 0 && <> &middot; won with {p.wonWith}</>}
        {p.bestStreak > 1 && <> &middot; 🔥 {p.bestStreak} in a night</>}
      </>,
    ]),
  );

  return (
    <div className="space-y-6">
      <section>
        {sectionHead("Players")}
        <PlayerRows rows={rows} open={open} setOpen={setOpen} extras={extras} />
      </section>

      {/* Fighters */}
      <section>
        {sectionHead("Fighters")}
        <ul className="space-y-1">
          {data.byCharacter.map((c) => (
            <li key={c.character} className="gn-card flex items-baseline justify-between" style={{ padding: "10px 16px" }}>
              <span className="font-bold truncate">{c.character}</span>
              <span className="text-sm shrink-0 gn-hint">
                <span className="font-bold" style={{ color: "var(--gn-ink)" }}>{c.wins}</span> / {c.played} &middot; {pct(c.winRate)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Head to head */}
      {data.headToHead.length > 0 && (
        <section>
          {sectionHead("Head to head")}
          <ul className="space-y-1">
            {data.headToHead.slice(0, 12).map((h) => (
              <li key={`${h.aUserId}-${h.bUserId}`} className="gn-card flex items-baseline justify-between gap-2" style={{ padding: "10px 16px" }}>
                <span className="truncate">
                  <span className="font-bold" style={h.aWins >= h.bWins ? { color: "var(--gn-ink)" } : { color: "var(--gn-dim)" }}>{h.aName}</span>
                  <span className="gn-hint"> vs </span>
                  <span className="font-bold" style={h.bWins > h.aWins ? { color: "var(--gn-ink)" } : { color: "var(--gn-dim)" }}>{h.bName}</span>
                </span>
                <span className="text-sm shrink-0 font-bold">{h.aWins}&ndash;{h.bWins}</span>
              </li>
            ))}
          </ul>
          <p className="gn-hint mt-1" style={{ fontSize: "12px" }}>Better finish in a shared game takes the meeting. Ties (same finish) don't count either way.</p>
        </section>
      )}
    </div>
  );
}

const MARIO_PARTY_GAME_NAME = "Mario Party";

interface MpStats {
  games: number;
  byPlayer: {
    userId: string;
    name: string;
    games: number;
    wins: number;
    winRate: number;
    totalStars: number;
    avgStars: number;
    main: string | null;
    variety: number;
    bonusStars: Record<string, number>;
  }[];
  byMap: { map: string; games: number; topWinner: string | null; topWinnerWins: number }[];
  byCharacter: { character: string; played: number; wins: number; winRate: number }[];
  bonusLeaders: { star: string; name: string | null; count: number }[];
}

function MarioPartyPanel({ groupId, rows, open, setOpen }: PackPanelProps) {
  const { data, error } = useCachedApi<MpStats>(
    `group:${groupId}:marioparty`,
    `/api/groups/${groupId}/marioparty-stats`,
  );

  if (!data && error) return <p style={{ color: "var(--gn-danger)" }} className="text-sm">{error}</p>;
  if (!data) return <StatsSkeleton />;
  if (data.games === 0) {
    return <p className="gn-hint">No Mario Party boards recorded yet. Play a board night and it fills in here.</p>;
  }

  const accent = "#ffd24a";
  const head = (label: string) => packHead(label, accent);

  // Stars are the one per-player number no other pack has, so they ride the
  // shared row as a subline tail rather than justifying a bespoke list.
  const extras = new Map(
    data.byPlayer.map((p) => [
      p.userId,
      <> &middot; {p.totalStars}★ total ({p.avgStars.toFixed(1)} avg)</>,
    ]),
  );

  return (
    <div className="space-y-6">
      <section>
        {head("Players")}
        <PlayerRows rows={rows} open={open} setOpen={setOpen} extras={extras} />
      </section>

      <section>
        {head("Boards")}
        <ul className="space-y-1">
          {data.byMap.map((m) => (
            <li key={m.map} className="gn-card flex items-baseline justify-between gap-2" style={{ padding: "10px 16px" }}>
              <span className="font-bold truncate">{m.map}</span>
              <span className="text-sm shrink-0 gn-hint">
                {m.games} played{m.topWinner ? <> &middot; <span style={{ color: "var(--gn-ink)" }}>{m.topWinner}</span> {m.topWinnerWins}W</> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {data.bonusLeaders.length > 0 && (
        <section>
          {head("Bonus stars")}
          <ul className="space-y-1">
            {data.bonusLeaders.map((b) => (
              <li key={b.star} className="gn-card flex items-baseline justify-between gap-2" style={{ padding: "10px 16px" }}>
                <span className="font-bold truncate">{b.star}</span>
                <span className="text-sm shrink-0 gn-hint">{b.name ? <><span style={{ color: "var(--gn-ink)" }}>{b.name}</span> &times;{b.count}</> : "-"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        {head("Characters")}
        <ul className="space-y-1">
          {data.byCharacter.map((c) => (
            <li key={c.character} className="gn-card flex items-baseline justify-between" style={{ padding: "10px 16px" }}>
              <span className="font-bold truncate">{c.character}</span>
              <span className="text-sm shrink-0 gn-hint"><span className="font-bold" style={{ color: "var(--gn-ink)" }}>{c.wins}</span> / {c.played} &middot; {pct(c.winRate)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// The generic aggregator names the Ping Pong pack's game this.
const PING_PONG_GAME_NAME = "Ping Pong";
const MARIO_KART_GAME_NAME = "Mario Kart";

interface PpStats {
  matches: number;
  formats: string[];
  byPlayer: {
    userId: string;
    name: string;
    matches: number;
    matchWins: number;
    gameWins: number;
    gamesPlayed: number;
    byFormat: { format: string; wins: number; played: number }[];
  }[];
}

// Ping Pong lifetime panel. A match is the ledger unit, so match wins split
// by format (free play / best of 3 / 5 / 7) come from the stored match
// length; single-game wins total the individual games, including the four
// won inside a best-of-seven plus every free-play game.
function PingPongPanel({ groupId, rows, open, setOpen }: PackPanelProps) {
  const { data, error } = useCachedApi<PpStats>(
    `group:${groupId}:pingpong`,
    `/api/groups/${groupId}/pingpong-stats`,
  );

  if (!data && error) return <p style={{ color: "var(--gn-danger)" }} className="text-sm">{error}</p>;
  if (!data) return <StatsSkeleton />;
  if (data.matches === 0) {
    return <p className="gn-hint">No ping pong recorded yet. Play a King of the Hill or Singles night and it fills in here.</p>;
  }

  // The ledger unit here is the MATCH, so the shared row's wins are match
  // wins like every other pack. Individual game wins are the pack-specific
  // number and ride the subline.
  const extras = new Map(
    data.byPlayer.map((p) => [p.userId, <> &middot; {p.gameWins} game wins</>]),
  );

  return (
    <div className="space-y-2">
      <p className="gn-hint">
        Wins are MATCH wins. Single-game wins count every individual game, including the four inside a won best of seven and each free-play game.
      </p>
      <PlayerRows rows={rows} open={open} setOpen={setOpen} extras={extras} />
    </div>
  );
}

export default function StatsPage() {
  const { id } = useParams();
  const [open, setOpen] = useState<string | null>(null);
  // null = the All tab (every game mode combined)
  const [tab, setTab] = useState<string | null>(null);
  // Cached: the crew leaderboard is one of the most reopened screens and its
  // numbers only move when a night is played.
  const { data: stats, error } = useCachedApi<StatsView>(
    id ? `group:${id}:stats` : null,
    id ? `/api/groups/${id}/stats` : null,
  );



  const active = tab ? stats?.games.find((g) => g.name === tab) : null;
  const shown = active ? active.leaderboard : stats?.leaderboard;
  const count = active ? active.tournaments : stats?.tournaments ?? 0;

  return (
    <main className="gn-app">
      <div className="gn-wrap space-y-6">
        <BackButton />

        <div>
          <h1 className="gn-title text-2xl">🏆 Leaderboard</h1>
          {stats && (
            <p className="gn-hint mt-1">
              {tab === SMASH_GAME_NAME
                ? `${count} ${count === 1 ? "game" : "games"} of Smash Bros`
                : tab === MARIO_PARTY_GAME_NAME
                ? `${count} ${count === 1 ? "board" : "boards"} of Mario Party`
                : tab === PING_PONG_GAME_NAME
                ? `${count} ${count === 1 ? "match" : "matches"} of Ping Pong`
                : tab === MARIO_KART_GAME_NAME
                ? `${count} ${count === 1 ? "race" : "races"} of Mario Kart`
                : `${count} ${count === 1 ? "result" : "results"}${active ? ` of ${active.name}` : " across all game modes"}`}
            </p>
          )}
        </div>

        {error && <p style={{ color: "var(--gn-danger)" }} className="text-sm">{error}</p>}
        {!stats && !error && <p className="gn-hint">Loading...</p>}

        {stats?.leaderboard.length === 0 && (
          <p className="gn-hint">
            Nothing recorded yet. Finish a bracket or a Beerio Kart night and the crew's
            records show up here. Guests don't count until they're linked to a member.
          </p>
        )}

        {stats && stats.games.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            <button className={`gn-tab ${tab === null ? "gn-tab--on" : ""}`} onClick={() => { setTab(null); setOpen(null); }}>
              All
            </button>
            {stats.games.map((g) => (
              <button
                key={g.name}
                className={`gn-tab ${tab === g.name ? "gn-tab--on" : ""}`}
                onClick={() => { setTab(g.name); setOpen(null); }}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}

        {tab === SMASH_GAME_NAME && id ? (
          <SmashPanel groupId={id} rows={shown ?? []} open={open} setOpen={setOpen} />
        ) : tab === MARIO_PARTY_GAME_NAME && id ? (
          <MarioPartyPanel groupId={id} rows={shown ?? []} open={open} setOpen={setOpen} />
        ) : tab === PING_PONG_GAME_NAME && id ? (
          <PingPongPanel groupId={id} rows={shown ?? []} open={open} setOpen={setOpen} />
        ) : (
          <PlayerRows rows={shown ?? []} open={open} setOpen={setOpen} showByGame={tab === null} />
        )}

        {active && active.formats.length > 0 && (
          <section className="space-y-2">
            <h2 className="gn-h2">Wins by format</h2>
            {active.formats.map((f) => (
              <div key={f.format} className="gn-card" style={{ padding: "12px 16px" }}>
                <div className="flex items-baseline justify-between">
                  <span className="font-bold">{formatLabel(f.format)}</span>
                  <span className="gn-hint" style={{ fontSize: "12px" }}>{f.played} {formatUnit(f.format, f.played)}</span>
                </div>
                <ul className="space-y-1" style={{ marginTop: 6 }}>
                  {f.players.slice(0, 5).map((p, i) => (
                    <li key={p.name} className="flex justify-between" style={{ fontSize: "13px" }}>
                      <span className="flex gap-2 min-w-0">
                        <span className="gn-hint" style={{ width: 16, flexShrink: 0 }}>{i + 1}</span>
                        <span className="truncate" style={i === 0 ? { color: "var(--gn-gold)", fontWeight: 700 } : undefined}>{p.name}</span>
                      </span>
                      <span className="gn-hint" style={{ flexShrink: 0 }}>
                        <span style={{ color: "var(--gn-ink)", fontWeight: 700 }}>{p.wins}</span> / {p.played}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

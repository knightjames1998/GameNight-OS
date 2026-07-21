import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import BackButton from "../BackButton";

interface StatRow {
  userId: string;
  displayName: string;
  played: number;
  wins: number;
  podiums: number;
  best: number | null;
  winRate: number;
  avgPlacement: number | null;
  byGame: { name: string; played: number; wins: number }[];
}

interface GameStats {
  name: string;
  tournaments: number;
  leaderboard: StatRow[];
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

function SmashPanel({ groupId }: { groupId: string }) {
  const [data, setData] = useState<SmashStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SmashStats>(`/api/groups/${groupId}/smash-stats`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [groupId]);

  if (error) return <p style={{ color: "var(--gn-danger)" }} className="text-sm">{error}</p>;
  if (!data) return <p className="gn-hint">Loading...</p>;
  if (data.games === 0) {
    return <p className="gn-hint">No Smash games recorded yet. Play an FFA or King of the Hill night and it fills in here.</p>;
  }

  const accent = "#ff6a5a";
  const sectionHead = (label: string) => (
    <h2 className="gn-h2" style={{ color: accent, marginBottom: 8 }}>{label}</h2>
  );

  return (
    <div className="space-y-6">
      {/* Players */}
      <section>
        {sectionHead("Players")}
        <ul className="space-y-2">
          {data.byPlayer.map((p, i) => (
            <li key={p.userId} className={i === 0 ? "gn-champ" : "gn-card"} style={{ padding: "12px 16px" }}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-baseline gap-2 min-w-0">
                  <span className={`gn-rank ${i === 0 ? "gn-rank--top" : ""}`} style={{ fontSize: "16px", width: "22px", flexShrink: 0 }}>{i + 1}</span>
                  <span className="font-bold truncate" style={i === 0 ? { color: "var(--gn-gold)" } : undefined}>{p.name}</span>
                </span>
                <span className="text-sm shrink-0">
                  <span className="font-bold">{p.wins}</span>
                  <span className="gn-hint"> / {p.played}</span>
                </span>
              </div>
              <div className="gn-hint mt-1" style={{ fontSize: "12px", paddingLeft: "30px" }}>
                {pct(p.winRate)} win rate
                {p.main && <> &middot; main {p.main}</>}
                {" "}&middot; {p.variety} {p.variety === 1 ? "fighter" : "fighters"}
                {p.bestStreak > 1 && <> &middot; 🔥 {p.bestStreak} in a row</>}
              </div>
            </li>
          ))}
        </ul>
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

function MarioPartyPanel({ groupId }: { groupId: string }) {
  const [data, setData] = useState<MpStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MpStats>(`/api/groups/${groupId}/marioparty-stats`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [groupId]);

  if (error) return <p style={{ color: "var(--gn-danger)" }} className="text-sm">{error}</p>;
  if (!data) return <p className="gn-hint">Loading...</p>;
  if (data.games === 0) {
    return <p className="gn-hint">No Mario Party boards recorded yet. Play a board night and it fills in here.</p>;
  }

  const accent = "#ffd24a";
  const head = (label: string) => <h2 className="gn-h2" style={{ color: accent, marginBottom: 8 }}>{label}</h2>;

  return (
    <div className="space-y-6">
      <section>
        {head("Players")}
        <ul className="space-y-2">
          {data.byPlayer.map((p, i) => (
            <li key={p.userId} className={i === 0 ? "gn-champ" : "gn-card"} style={{ padding: "12px 16px" }}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-baseline gap-2 min-w-0">
                  <span className={`gn-rank ${i === 0 ? "gn-rank--top" : ""}`} style={{ fontSize: "16px", width: "22px", flexShrink: 0 }}>{i + 1}</span>
                  <span className="font-bold truncate" style={i === 0 ? { color: "var(--gn-gold)" } : undefined}>{p.name}</span>
                </span>
                <span className="text-sm shrink-0"><span className="font-bold">{p.wins}</span><span className="gn-hint"> / {p.games}</span></span>
              </div>
              <div className="gn-hint mt-1" style={{ fontSize: "12px", paddingLeft: "30px" }}>
                {pct(p.winRate)} win rate &middot; {p.totalStars}★ total ({p.avgStars.toFixed(1)} avg)
                {p.main && <> &middot; main {p.main}</>}
              </div>
            </li>
          ))}
        </ul>
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
function PingPongPanel({ groupId }: { groupId: string }) {
  const [data, setData] = useState<PpStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PpStats>(`/api/groups/${groupId}/pingpong-stats`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [groupId]);

  if (error) return <p style={{ color: "var(--gn-danger)" }} className="text-sm">{error}</p>;
  if (!data) return <p className="gn-hint">Loading...</p>;
  if (data.matches === 0) {
    return <p className="gn-hint">No ping pong recorded yet. Play a King of the Hill or Singles night and it fills in here.</p>;
  }

  const accent = "#3ad07a";
  return (
    <div className="space-y-2">
      <p className="gn-hint">
        Single-game wins count every individual game (the four inside a won best of seven, and each free-play game). Match wins split by match length.
      </p>
      <ul className="space-y-2">
        {data.byPlayer.map((p, i) => (
          <li key={p.userId} className={i === 0 ? "gn-champ" : "gn-card"} style={{ padding: "12px 16px" }}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex items-baseline gap-2 min-w-0">
                <span className={`gn-rank ${i === 0 ? "gn-rank--top" : ""}`} style={{ fontSize: "16px", width: "22px", flexShrink: 0 }}>{i + 1}</span>
                <span className="font-bold truncate" style={i === 0 ? { color: "var(--gn-gold)" } : undefined}>{p.name}</span>
              </span>
              <span className="text-sm" style={{ color: accent, fontWeight: 800, flexShrink: 0 }}>
                {p.gameWins} <span className="gn-hint" style={{ fontWeight: 400 }}>game wins</span>
              </span>
            </div>
            <div className="gn-hint mt-1" style={{ fontSize: "12px" }}>
              {p.matchWins}W / {p.matches} matches
              {p.byFormat
                .filter((f) => f.played > 0)
                .map((f) => ` · ${f.format}: ${f.wins}/${f.played}`)
                .join("")}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function StatsPage() {
  const { id } = useParams();
  const [stats, setStats] = useState<StatsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // null = the All tab (every game mode combined)
  const [tab, setTab] = useState<string | null>(null);

  useEffect(() => {
    api<StatsView>(`/api/groups/${id}/stats`)
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [id]);

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
                : `${count} ${count === 1 ? "tournament" : "tournaments"}${active ? ` of ${active.name}` : " across all game modes"}`}
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
          <SmashPanel groupId={id} />
        ) : tab === MARIO_PARTY_GAME_NAME && id ? (
          <MarioPartyPanel groupId={id} />
        ) : tab === PING_PONG_GAME_NAME && id ? (
          <PingPongPanel groupId={id} />
        ) : (
        <ul className="space-y-2">
          {shown?.map((r, i) => {
            const expanded = open === r.userId;
            const top = i === 0;
            return (
              <li key={r.userId} className={top ? "gn-champ" : "gn-card"} style={{ padding: 0 }}>
                <button
                  className="w-full text-left"
                  style={{ padding: "12px 16px", background: "transparent", border: 0, color: "var(--gn-ink)" }}
                  onClick={() => tab === null && setOpen(expanded ? null : r.userId)}
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
                    <span className="text-sm shrink-0">
                      <span className="font-bold">{r.wins}</span>
                      <span className="gn-hint"> {r.wins === 1 ? "win" : "wins"}</span>
                    </span>
                  </div>
                  <div className="gn-hint mt-1" style={{ fontSize: "12px", paddingLeft: "30px" }}>
                    {r.played} played &middot; {Math.round(r.winRate * 100)}% win rate &middot;{" "}
                    {r.podiums} top 3
                    {r.avgPlacement !== null && ` · avg finish ${r.avgPlacement.toFixed(1)}`}
                  </div>
                </button>

                {expanded && tab === null && (
                  <ul className="space-y-1" style={{ margin: "0 16px 12px", paddingLeft: "30px", borderTop: "2px solid var(--gn-line)", paddingTop: "8px" }}>
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
              </li>
            );
          })}
        </ul>
        )}
      </div>
    </main>
  );
}

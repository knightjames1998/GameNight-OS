import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useCachedApi } from "../cache";
import { StatsSkeleton } from "../Skeleton";
import {
  betLabel,
  formatCents,
  formatCentsSigned,
  modifierById,
  type CashModifierAgg,
} from "@gamenight/shared";
import { formatLabel, formatUnit } from "../formats";
import BackButton from "../BackButton";
import Disclosure from "../Disclosure";
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
  /** Smashdown series won / played; absent for a crew that has none. */
  series?: { wins: number; played: number };
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
    /** Smashdown series won / played, off the series summary rows only. */
    seriesWins: number;
    seriesPlayed: number;
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
            {r.series && r.series.played > 0
              ? ` · ${r.series.wins}/${r.series.played} series won`
              : ""}
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
        {p.seriesPlayed > 0 && <> &middot; {p.seriesWins}/{p.seriesPlayed} series won</>}
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

const BLACKJACK_GAME_NAME = "Blackjack";
const ROULETTE_GAME_NAME = "Roulette";
const CRAPS_GAME_NAME = "Craps";
const CASINO_RUN_GAME_NAME = "Casino Run";

/**
 * The casino group's lifetime panel: MONEY, which no other pack has.
 *
 * ONE panel for all four packs, because every figure below falls out of the
 * BUY-IN AND THE CASH-OUT ALONE, the design promise of the whole group. A
 * night played the minimal-input way produces all of it, so there is nothing
 * per-pack to compute. Each pack's own detail stats are the only extras and
 * arrive through `extras`, read from the raw meta bags the endpoint returns.
 *
 * Amounts arrive as integer CENTS and are formatted here, at the edge. See
 * packages/shared/src/cashgame.ts for why that matters.
 */
interface CashMetaBag {
  biggestBet?: number | null;
  biggestWin?: number | null;
  blackjacks?: number | null;
  favouriteBet?: string | null;
  bestStreak?: number | null;
  longestRoll?: number | null;
  points?: number | null;
}

/** The money half, per stakes. `sessions: 0` means do not render it at all. */
interface MoneyAgg {
  stakes: "real" | "play";
  sessions: number;
  net: number;
  staked: number;
  avgBuyIn: number;
  avgNet: number;
  roi: number | null;
  best: number | null;
  worst: number | null;
  netPerHour: number | null;
}

interface CashStats {
  sessions: number;
  byPlayer: {
    userId: string;
    name: string;
    /** Counted ONCE across both stakes: a win is a win. */
    sessions: number;
    winRate: number;
    upNights: number;
    streak: number;
    bestStreak: number;
    rebuys: number;
    rebuyRate: number;
    minutes: number;
    banked: number;
    /** SPLIT, because adding a real net to a play net means nothing. */
    money: { real: MoneyAgg; play: MoneyAgg };
    metas: CashMetaBag[];
  }[];
  /**
   * The same nights sliced by house rule. Empty on a crew that has never turned
   * one on, which is most of them, so the whole section stays absent rather
   * than rendering an empty heading.
   */
  byModifier: CashModifierAgg[];
}

type CashRow = CashStats["byPlayer"][number];

function CasinoPanel({
  groupId,
  rows,
  open,
  setOpen,
  pack,
  empty,
  extras,
  record,
}: PackPanelProps & {
  /** The pack's route segment: keys the cache and the endpoint. */
  pack: string;
  empty: string;
  /** The pack's own detail line, from the raw meta bags. Empty to omit it. */
  extras: (p: CashRow) => string;
  /**
   * A CREW-WIDE record, if the pack has one worth a headline of its own.
   * Craps' longest hand is the case this exists for: it is a table record
   * people chase, not a personal average, so it reads across everybody.
   */
  record?: (rows: CashRow[]) => ReactNode;
}) {
  const { data, error } = useCachedApi<CashStats>(
    `group:${groupId}:${pack}`,
    `/api/groups/${groupId}/${pack}-stats`,
  );

  if (!data && error) return <p style={{ color: "var(--gn-danger)" }} className="text-sm">{error}</p>;
  if (!data) return <StatsSkeleton />;
  if (data.sessions === 0) return <p className="gn-hint">{empty}</p>;

  // The shared row's "wins" are nights finished up, because placement comes
  // from the net rank. The money is the pack-specific part and rides the
  // subline, the same way Mario Party's stars and Ping Pong's game wins do.
  //
  // ROWS ARRIVE SORTED by the shared comparator (real money first, play money
  // only breaking a tie between people who have never played for real), so a
  // big play-money night can never outrank an actual one.
  const rows2 = data.byPlayer;
  const tone = (n: number) => (n > 0 ? "var(--gn-yes)" : n < 0 ? "var(--gn-p1)" : undefined);

  /** "up $60 lifetime, down P$80 lifetime": both on ONE line, per stakes. */
  const lifetime = (p: CashRow) =>
    (["real", "play"] as const)
      .map((k) => p.money[k])
      .filter((mm) => mm.sessions > 0)
      .map((mm) => (
        <span key={mm.stakes}>
          {" "}
          <span style={{ color: tone(mm.net), fontWeight: 700 }}>
            {formatCentsSigned(mm.net, mm.stakes)}
          </span>
        </span>
      ));

  const playerExtras = new Map(
    data.byPlayer.map((p) => [
      p.userId,
      <>
        {" "}&middot;
        {lifetime(p)} lifetime
      </>,
    ]),
  );

  return (
    <div className="space-y-3">
      <p className="gn-hint">
        Wins are nights that finished UP: placement comes from the net, so first place is whoever
        won the most money. Every figure below comes from buy-ins and cash-outs alone.
      </p>
      {record?.(data.byPlayer)}
      <PlayerRows rows={rows} open={open} setOpen={setOpen} extras={playerExtras} />

      <section className="space-y-2">
        <h2 className="gn-h2">The money</h2>
        {rows2.map((p) => {
          const detail = extras(p);
          const played = (["real", "play"] as const).map((k) => p.money[k]).filter((mm) => mm.sessions > 0);
          return (
            <div key={p.userId} className="gn-card" style={{ padding: "12px 16px" }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold truncate">{p.name}</span>
                <span className="font-bold shrink-0">{lifetime(p)}</span>
              </div>
              {/* UNIFIED counts first: nights, win rate and streaks are about
                  whether you won, which play money does not change. */}
              <p className="gn-hint" style={{ fontSize: "12px", marginTop: 4 }}>
                {p.sessions} night{p.sessions === 1 ? "" : "s"} &middot; up {p.upNights} (
                {Math.round(p.winRate * 100)}%)
                {p.rebuys > 0 && ` · ${p.rebuys} rebuy${p.rebuys === 1 ? "" : "s"} (${Math.round(p.rebuyRate * 100)}% of nights)`}
                {p.streak >= 2 && ` · 🔥${p.streak} up in a row`}
                {p.bestStreak >= 2 && ` · best run ${p.bestStreak}`}
                {p.banked > 0 && ` · banked ${p.banked}`}
              </p>
              {/* Then the money, ONE LINE PER STAKES, because a total that mixes
                  dollars and play chips is a number that means nothing. */}
              {played.map((mm) => (
                <p key={mm.stakes} className="gn-hint" style={{ fontSize: "12px", marginTop: 2 }}>
                  <span style={{ color: mm.stakes === "play" ? "#c4b5fd" : "var(--gn-dim)", fontWeight: 700 }}>
                    {mm.stakes === "play" ? "play" : "real"}
                  </span>{" "}
                  {mm.sessions} night{mm.sessions === 1 ? "" : "s"} &middot; avg{" "}
                  {formatCentsSigned(mm.avgNet, mm.stakes)} &middot; avg buy-in{" "}
                  {formatCents(mm.avgBuyIn, mm.stakes)}
                  {mm.roi != null && ` · ROI ${(mm.roi * 100).toFixed(0)}%`}
                  {mm.best != null && ` · best ${formatCentsSigned(mm.best, mm.stakes)}`}
                  {mm.worst != null && ` · worst ${formatCentsSigned(mm.worst, mm.stakes)}`}
                  {mm.netPerHour != null && ` · ${formatCentsSigned(mm.netPerHour, mm.stakes)}/hr`}
                </p>
              ))}
              {detail && (
                <p className="gn-hint" style={{ fontSize: "12px", marginTop: 2 }}>{detail}</p>
              )}
            </div>
          );
        })}
      </section>

      {data.byModifier.length > 0 && (
        <Disclosure label="More stats">
          <ModifierStats rows={data.byModifier} />
        </Disclosure>
      )}
    </div>
  );
}

/**
 * Win rate and net PER HOUSE RULE.
 *
 * The one stat the modifier deck creates, and the only one it can honestly
 * support. The app never applies a modifier's effect (the humans do that at
 * the table), so this cannot say a card caused anything; it says how the nights
 * that carried it actually went, which is the question people ask out loud
 * ("we're cursed with Silence on") and previously could only argue about.
 *
 * PER PLAYER, not crew-wide, because a crew-wide net is zero on every
 * player-banked night by construction: the table has to balance. Only one
 * person's own nights carry a number that means anything.
 *
 * The caveat is printed rather than implied. Three nights at 100% is three
 * nights, and a panel that renders it as a bare percentage invites a crew to
 * retire a card over noise.
 */
function ModifierStats({ rows }: { rows: CashModifierAgg[] }) {
  return (
    <section className="space-y-2">
      <p className="gn-hint">
        How the nights with each house rule on actually went. The app never applies a rule, so
        this is what happened alongside it, not what it caused, and a couple of nights is
        a couple of nights.
      </p>
      {rows.map((r) => {
        const card = modifierById(r.id);
        return (
          <div key={r.id} className="gn-card" style={{ padding: "12px 16px" }}>
            <div className="flex items-baseline justify-between gap-2">
              {/* An id the deck no longer has still renders as itself: the
                  history is real even when the card has been retired. */}
              <span className="font-bold truncate">{card?.name ?? r.id}</span>
              <span className="gn-hint shrink-0" style={{ fontSize: "12px" }}>
                {r.nights} player-night{r.nights === 1 ? "" : "s"} &middot; up{" "}
                {Math.round(r.winRate * 100)}%
              </span>
            </div>
            {card && (
              <p className="gn-hint" style={{ fontSize: "12px", marginTop: 2 }}>{card.rule}</p>
            )}
            <ul className="space-y-1" style={{ marginTop: 6 }}>
              {r.players.slice(0, 5).map((p) => {
                const played = (["real", "play"] as const)
                  .map((k) => p.money[k])
                  .filter((mm) => mm.sessions > 0);
                return (
                  <li key={p.userId} className="flex justify-between gap-2" style={{ fontSize: "13px" }}>
                    <span className="truncate">{p.name}</span>
                    <span className="gn-hint shrink-0">
                      {p.upNights}/{p.sessions} up
                      {played.map((mm) => (
                        <span key={mm.stakes}>
                          {" · "}
                          <span
                            style={{
                              color:
                                mm.net > 0 ? "var(--gn-yes)" : mm.net < 0 ? "var(--gn-p1)" : undefined,
                              fontWeight: 700,
                            }}
                          >
                            {formatCentsSigned(mm.net, mm.stakes)}
                          </span>
                        </span>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/** Biggest across every night, ignoring the nights nobody answered for. */
const maxMeta = (p: CashRow, k: keyof CashMetaBag): number | null => {
  let best: number | null = null;
  for (const m of p.metas) {
    const v = m[k];
    if (typeof v === "number" && (best === null || v > best)) best = v;
  }
  return best;
};
const sumMeta = (p: CashRow, k: keyof CashMetaBag): number => {
  let n = 0;
  for (const m of p.metas) {
    const v = m[k];
    if (typeof v === "number") n += v;
  }
  return n;
};

function BlackjackPanel(props: PackPanelProps) {
  return (
    <CasinoPanel
      {...props}
      pack="blackjack"
      empty="No blackjack recorded yet. Run a table and the money shows up here."
      extras={(p) => {
        const bet = maxMeta(p, "biggestBet");
        const win = maxMeta(p, "biggestWin");
        const bj = sumMeta(p, "blackjacks");
        const bits: string[] = [];
        if (bet != null) bits.push(`biggest bet ${formatCents(bet)}`);
        if (win != null) bits.push(`biggest win ${formatCents(win)}`);
        if (bj > 0) bits.push(`${bj} blackjack${bj === 1 ? "" : "s"}`);
        return bits.join(" · ");
      }}
    />
  );
}

function RoulettePanel(props: PackPanelProps) {
  return (
    <CasinoPanel
      {...props}
      pack="roulette"
      empty="No roulette recorded yet. Spin a night and the money shows up here."
      extras={(p) => {
        const streak = maxMeta(p, "bestStreak");
        // Most-used favourite across every night, so one odd night does not
        // rewrite what somebody plays.
        const counts = new Map<string, number>();
        for (const m of p.metas) {
          if (typeof m.favouriteBet === "string") counts.set(m.favouriteBet, (counts.get(m.favouriteBet) ?? 0) + 1);
        }
        let fav: string | null = null;
        let top = 0;
        for (const [k, n] of counts) if (n > top) ((top = n), (fav = k));
        const bits: string[] = [];
        if (fav) bits.push(`mostly ${betLabel(fav).toLowerCase()}`);
        // A streak of one is not a streak.
        if (streak != null && streak >= 2) bits.push(`best run ${streak} spins`);
        return bits.join(" · ");
      }}
    />
  );
}

function CrapsPanel(props: PackPanelProps) {
  return (
    <CasinoPanel
      {...props}
      pack="craps"
      empty="No craps recorded yet. Run a table and the money shows up here."
      /**
       * LONGEST ROLL IS A CREW RECORD, not a personal stat. James's call, and
       * it is the right one: at a real table the number everybody knows is who
       * has held the dice longest, full stop. So it gets its own line above the
       * money, naming the holder.
       */
      record={(all) => {
        let best: { name: string; rolls: number } | null = null;
        for (const p of all) {
          const r = maxMeta(p, "longestRoll");
          if (r != null && (!best || r > best.rolls)) best = { name: p.name, rolls: r };
        }
        if (!best) return null;
        return (
          <div className="gn-champ" style={{ padding: "12px 16px" }}>
            <div className="gn-lab">Longest hand (crew record)</div>
            <div className="flex items-baseline justify-between gap-2" style={{ marginTop: 2 }}>
              <span className="font-bold truncate">🎲 {best.name}</span>
              <span className="font-bold shrink-0" style={{ color: "var(--gn-gold)" }}>
                {best.rolls} roll{best.rolls === 1 ? "" : "s"}
              </span>
            </div>
            <p className="gn-hint" style={{ fontSize: "12px", marginTop: 2 }}>
              Rolls survived before sevening out. Needs the live tracker, or somebody typing it on
              the cash-out form.
            </p>
          </div>
        );
      }}
      extras={(p) => {
        const longest = maxMeta(p, "longestRoll");
        const points = sumMeta(p, "points");
        const bet = maxMeta(p, "biggestBet");
        const win = maxMeta(p, "biggestWin");
        const bits: string[] = [];
        if (longest != null) bits.push(`best hand ${longest} roll${longest === 1 ? "" : "s"}`);
        if (points > 0) bits.push(`${points} point${points === 1 ? "" : "s"} made`);
        if (bet != null) bits.push(`biggest bet ${formatCents(bet)}`);
        if (win != null) bits.push(`biggest win ${formatCents(win)}`);
        return bits.join(" · ");
      }}
    />
  );
}

/**
 * The CASINO RUN panel, which is deliberately not the CasinoPanel above.
 *
 * That panel is built entirely on per-player net, and this pack has none: one
 * shared bank, one shared result, everyone at the same placement. What a run
 * produces instead is a clear rate, how deep the crew has ever got, and the
 * comeback, which is the number this pack is actually about.
 */
interface CrunStats {
  runs: number;
  byPlayer: {
    userId: string;
    name: string;
    runs: number;
    cleared: number;
    clearRate: number;
    deepest: number;
    busts: number;
    bestComeback: number;
    missed: number;
    legs: number;
    myLegs: number;
    lostBank: number;
    ranOut: number;
    tokens: number;
  }[];
  byModifier: { id: string; runs: number; cleared: number; clearRate: number }[];
  best: { name: string; comeback: number } | null;
}

function CasinoRunPanel({ groupId, rows, open, setOpen }: PackPanelProps) {
  const { data, error } = useCachedApi<CrunStats>(
    `group:${groupId}:casinorun`,
    `/api/groups/${groupId}/casinorun-stats`,
  );

  if (!data && error) return <p style={{ color: "var(--gn-danger)" }} className="text-sm">{error}</p>;
  if (!data) return <StatsSkeleton />;
  if (data.runs === 0) {
    return <p className="gn-hint">No runs recorded yet. Set a bank, pick a difficulty and see how far the crew gets.</p>;
  }

  const extras = new Map(
    data.byPlayer.map((p) => [
      p.userId,
      <>
        {" "}&middot; {p.cleared}/{p.runs} run{p.runs === 1 ? "" : "s"} cleared
      </>,
    ]),
  );

  return (
    <div className="space-y-3">
      <p className="gn-hint">
        A co-op pack: the crew shares one bank, so a cleared run is a win for everybody on it and a
        bust is a loss for everybody. Wins here are runs cleared.
      </p>

      {data.best && data.best.comeback > 0 && (
        <div className="gn-champ" style={{ padding: "12px 16px" }}>
          <div className="gn-lab">Biggest comeback (crew record)</div>
          <div className="flex items-baseline justify-between gap-2" style={{ marginTop: 2 }}>
            <span className="font-bold truncate">🎰 {data.best.name}&rsquo;s run</span>
            <span className="font-bold shrink-0" style={{ color: "var(--gn-gold)" }}>
              {formatCents(data.best.comeback, "play")}
            </span>
          </div>
          <p className="gn-hint" style={{ fontSize: "12px", marginTop: 2 }}>
            How far the bank climbed from its lowest point in a single run.
          </p>
        </div>
      )}

      <PlayerRows rows={rows} open={open} setOpen={setOpen} extras={extras} />

      <section className="space-y-2">
        <h2 className="gn-h2">The runs</h2>
        {data.byPlayer.map((p) => (
          <div key={p.userId} className="gn-card" style={{ padding: "12px 16px" }}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold truncate">{p.name}</span>
              <span className="font-bold shrink-0">{Math.round(p.clearRate * 100)}%</span>
            </div>
            <p className="gn-hint" style={{ fontSize: "12px", marginTop: 4 }}>
              {p.runs} run{p.runs === 1 ? "" : "s"} &middot; {p.cleared} cleared &middot; {p.busts} bust
              {p.deepest > 0 && ` · deepest ${p.deepest} stage${p.deepest === 1 ? "" : "s"}`}
              {p.bestComeback > 0 && ` · best comeback ${formatCents(p.bestComeback, "play")}`}
            </p>
            {/* THE TWO WAYS TO LOSE, told apart. "We lost the bank" and "we ran
                out of shots with money still on the table" are different
                nights, and a crew that mostly does the second is playing too
                cautiously rather than too riskily. */}
            {p.busts > 0 && (
              <p className="gn-hint" style={{ fontSize: "12px", marginTop: 2 }}>
                {p.lostBank > 0 && `${p.lostBank} lost the bank`}
                {p.lostBank > 0 && p.ranOut > 0 && " · "}
                {p.ranOut > 0 && `${p.ranOut} ran out of attempts`}
              </p>
            )}
            {(p.myLegs > 0 || p.missed > 0) && (
              <p className="gn-hint" style={{ fontSize: "12px", marginTop: 2 }}>
                {p.myLegs > 0 && `${p.myLegs} leg${p.myLegs === 1 ? "" : "s"} played`}
                {p.myLegs > 0 && p.missed > 0 && " · "}
                {p.missed > 0 && `${p.missed} stage${p.missed === 1 ? "" : "s"} missed to the house`}
                {p.tokens > 0 && ` · ${p.tokens} token${p.tokens === 1 ? "" : "s"} bought`}
              </p>
            )}
          </div>
        ))}
      </section>

      {data.byModifier.length > 0 && (
        <Disclosure label="More stats">
          <section className="space-y-2">
            <p className="gn-hint">
              How runs went with each house rule live. Crew-wide, because a co-op result is the
              table&rsquo;s and not one person&rsquo;s, and the app never applies a rule, so
              this is what happened alongside it, not what it caused.
            </p>
            {data.byModifier.map((r) => {
              const card = modifierById(r.id);
              return (
                <div key={r.id} className="gn-card" style={{ padding: "12px 16px" }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-bold truncate">{card?.name ?? r.id}</span>
                    <span className="gn-hint shrink-0" style={{ fontSize: "12px" }}>
                      {r.cleared}/{r.runs} cleared &middot; {Math.round(r.clearRate * 100)}%
                    </span>
                  </div>
                  {card && (
                    <p className="gn-hint" style={{ fontSize: "12px", marginTop: 2 }}>{card.rule}</p>
                  )}
                </div>
              );
            })}
          </section>
        </Disclosure>
      )}
    </div>
  );
}

// The generic aggregator names the Board Game pack's game this.
const BOARD_GAME_GAME_NAME = "Board Game";

interface BgStats {
  games: number;
  titles: number;
  byPlayer: {
    userId: string;
    name: string;
    games: number;
    wins: number;
    winRate: number;
    avgPlacement: number | null;
    titles: number;
  }[];
  byTitle: {
    title: string;
    games: number;
    winners: { name: string; wins: number }[];
    champion: string | null;
    championWins: number;
  }[];
  mostPlayed: { title: string; games: number } | null;
}

/**
 * The Board Game panel. Everything below the shared player list is per TITLE,
 * and every one of those groupings is `matches.label`: there is ONE `games` row
 * for this pack, never a row per title, because a row per title would split the
 * pack into a leaderboard tab per board game.
 *
 * Which is also why the titles have to be canonicalized on the way in. These
 * sections ARE the spelling: "Catan" and "catan" would sit here as two titles,
 * two champions and two histories, and nothing anywhere would have errored.
 */
function BoardGamePanel({ groupId, rows, open, setOpen }: PackPanelProps) {
  const { data, error } = useCachedApi<BgStats>(
    `group:${groupId}:boardgame`,
    `/api/groups/${groupId}/boardgame-stats`,
  );

  if (!data && error) return <p style={{ color: "var(--gn-danger)" }} className="text-sm">{error}</p>;
  if (!data) return <StatsSkeleton />;
  if (data.games === 0) {
    return <p className="gn-hint">No board games recorded yet. Play a night and it fills in here.</p>;
  }

  const accent = "#e0a54a";
  const head = (label: string) => packHead(label, accent);

  // How many different titles somebody has played is the one per-player number
  // no other pack has, so it rides the shared row as a subline tail.
  const extras = new Map(
    data.byPlayer.map((p) => [
      p.userId,
      <>
        {" "}&middot; {p.titles} {p.titles === 1 ? "title" : "titles"}
        {p.avgPlacement !== null && <> &middot; avg {p.avgPlacement.toFixed(1)}</>}
      </>,
    ]),
  );

  return (
    <div className="space-y-6">
      <section>
        {head("Players")}
        <PlayerRows rows={rows} open={open} setOpen={setOpen} extras={extras} />
      </section>

      <section>
        {head("Titles played")}
        {data.mostPlayed && (
          <p className="gn-hint" style={{ marginBottom: 8 }}>
            Most played: <span style={{ color: "var(--gn-ink)" }} className="font-bold">{data.mostPlayed.title}</span>{" "}
            ({data.mostPlayed.games} {data.mostPlayed.games === 1 ? "game" : "games"} across {data.titles}{" "}
            {data.titles === 1 ? "title" : "titles"})
          </p>
        )}
        <ul className="space-y-1">
          {data.byTitle.map((t) => (
            <li key={t.title} className="gn-card flex items-baseline justify-between gap-2" style={{ padding: "10px 16px" }}>
              <span className="font-bold truncate">{t.title}</span>
              <span className="text-sm shrink-0 gn-hint">
                {t.games} played
                {t.champion ? <> &middot; <span style={{ color: "var(--gn-ink)" }}>{t.champion}</span> {t.championWins}W</> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        {head("Wins by title")}
        {/* The champion above is the top of each of these lists. The full
            breakdown is here rather than folded into that line, because "who
            owns Catan" and "who else has ever won it" are different questions
            and the second one is the argument at the table. */}
        <ul className="space-y-1">
          {data.byTitle
            .filter((t) => t.winners.length > 0)
            .map((t) => (
              <li key={t.title} className="gn-card" style={{ padding: "10px 16px" }}>
                <div className="font-bold truncate">{t.title}</div>
                <p className="gn-hint" style={{ fontSize: "12px", marginTop: 2 }}>
                  {t.winners.map((w) => `${w.name} ${w.wins}`).join(" · ")}
                </p>
              </li>
            ))}
        </ul>
      </section>
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
                : tab === BLACKJACK_GAME_NAME
                ? `${count} blackjack ${count === 1 ? "night" : "nights"}`
                : tab === ROULETTE_GAME_NAME
                ? `${count} roulette ${count === 1 ? "night" : "nights"}`
                : tab === CRAPS_GAME_NAME
                ? `${count} craps ${count === 1 ? "night" : "nights"}`
                : tab === CASINO_RUN_GAME_NAME
                ? `${count} casino ${count === 1 ? "run" : "runs"}`
                : tab === BOARD_GAME_GAME_NAME
                ? `${count} board ${count === 1 ? "game" : "games"}`
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
        ) : tab === BLACKJACK_GAME_NAME && id ? (
          <BlackjackPanel groupId={id} rows={shown ?? []} open={open} setOpen={setOpen} />
        ) : tab === ROULETTE_GAME_NAME && id ? (
          <RoulettePanel groupId={id} rows={shown ?? []} open={open} setOpen={setOpen} />
        ) : tab === CRAPS_GAME_NAME && id ? (
          <CrapsPanel groupId={id} rows={shown ?? []} open={open} setOpen={setOpen} />
        ) : tab === CASINO_RUN_GAME_NAME && id ? (
          <CasinoRunPanel groupId={id} rows={shown ?? []} open={open} setOpen={setOpen} />
        ) : tab === BOARD_GAME_GAME_NAME && id ? (
          <BoardGamePanel groupId={id} rows={shown ?? []} open={open} setOpen={setOpen} />
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

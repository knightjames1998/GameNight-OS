// Smash pack: shared types, the fighter roster, and pure session logic.
// Dependency-free so both server and web import it. The server owns the
// authoritative session state; these helpers keep the rules in one place.
//
// Scope (Session A): FFA Night and King of the Hill. Tournament reuses the
// existing single-elim engine and is not modelled here. Stage and stock
// tracking are deferred (BACKLOG). One input drives every stat: the
// fighter each player used, plus who won. Everything else is derived.

// ---------- Fighter roster ----------
// Super Smash Bros. Ultimate, roster complete since Oct 2021 (Sora was the
// final DLC). One flat list across every game, in character-select order.
// Echo fighters are their own entries. Mii Brawler/Swordfighter/Gunner are
// three entries. Pokemon Trainer and Pyra/Mythra are single picks on
// purpose: tracking which Pokemon or which twin is exactly the per-life
// granularity we said isn't worth the input (standing rule 9).
export const SMASH_FIGHTERS: string[] = [
  "Mario", "Donkey Kong", "Link", "Samus", "Dark Samus", "Yoshi", "Kirby",
  "Fox", "Pikachu", "Luigi", "Ness", "Captain Falcon", "Jigglypuff", "Peach",
  "Daisy", "Bowser", "Ice Climbers", "Sheik", "Zelda", "Dr. Mario", "Pichu",
  "Falco", "Marth", "Lucina", "Young Link", "Ganondorf", "Mewtwo", "Roy",
  "Chrom", "Mr. Game & Watch", "Meta Knight", "Pit", "Dark Pit",
  "Zero Suit Samus", "Wario", "Snake", "Ike", "Pokemon Trainer", "Diddy Kong",
  "Lucas", "Sonic", "King Dedede", "Olimar", "Lucario", "R.O.B.", "Toon Link",
  "Wolf", "Villager", "Mega Man", "Wii Fit Trainer", "Rosalina & Luma",
  "Little Mac", "Greninja", "Mii Brawler", "Mii Swordfighter", "Mii Gunner",
  "Palutena", "Pac-Man", "Robin", "Shulk", "Bowser Jr.", "Duck Hunt", "Ryu",
  "Ken", "Cloud", "Corrin", "Bayonetta", "Inkling", "Ridley", "Simon",
  "Richter", "King K. Rool", "Isabelle", "Incineroar", "Piranha Plant",
  "Joker", "Hero", "Banjo & Kazooie", "Terry", "Byleth", "Min Min", "Steve",
  "Sephiroth", "Pyra/Mythra", "Kazuya", "Sora",
];

const FIGHTER_SET = new Set(SMASH_FIGHTERS);
export function isFighter(name: unknown): name is string {
  return typeof name === "string" && FIGHTER_SET.has(name);
}

// ---------- Which game in the series ----------
// A pack with character selection carries a list of the specific titles in
// its series. The host picks one on the pack's front page; that title
// scopes both the character picker and the random pool (standing rule:
// randomization stays within the game being played). It does NOT split
// stats: a character is the same character across titles.
//
// The Smash titles are expressed as subsets of the Ultimate roster above so
// spellings stay identical and lifetime stats stay unified. "Everyone is
// Here" makes every past fighter a subset of Ultimate, so this is exact.
export interface GameTitle {
  id: string;
  name: string;
  roster: readonly string[];
}

/** The roster for a chosen title id, falling back to the first (default). */
export function rosterForTitle(
  titles: readonly GameTitle[],
  titleId: string | null | undefined,
): readonly string[] {
  return (titles.find((t) => t.id === titleId) ?? titles[0])?.roster ?? [];
}

const pick = (...names: string[]): string[] => {
  for (const n of names) if (!FIGHTER_SET.has(n)) throw new Error(`unknown fighter: ${n}`);
  return names;
};

// Newest first; Ultimate is the default (also the widest roster).
export const SMASH_TITLES: GameTitle[] = [
  { id: "ultimate", name: "Ultimate", roster: SMASH_FIGHTERS },
  {
    id: "smash4",
    name: "Smash 4 (Wii U / 3DS)",
    roster: pick(
      "Mario", "Luigi", "Peach", "Bowser", "Yoshi", "Rosalina & Luma", "Bowser Jr.", "Wario",
      "Donkey Kong", "Diddy Kong", "Mr. Game & Watch", "Little Mac", "Link", "Zelda", "Sheik",
      "Ganondorf", "Toon Link", "Samus", "Zero Suit Samus", "Pit", "Palutena", "Marth", "Ike",
      "Robin", "Lucina", "Kirby", "King Dedede", "Meta Knight", "Fox", "Falco", "Pikachu",
      "Lucario", "Jigglypuff", "Greninja", "R.O.B.", "Ness", "Captain Falcon", "Villager",
      "Olimar", "Wii Fit Trainer", "Shulk", "Dr. Mario", "Dark Pit", "Lucas", "Duck Hunt",
      "Ryu", "Cloud", "Corrin", "Bayonetta", "Mewtwo", "Roy", "Mii Brawler", "Mii Swordfighter",
      "Mii Gunner", "Sonic", "Mega Man", "Pac-Man",
    ).concat("Charizard"), // standalone in Smash 4; in Ultimate it's part of Pokemon Trainer
  },
  {
    id: "brawl",
    name: "Brawl",
    roster: pick(
      "Mario", "Luigi", "Peach", "Bowser", "Donkey Kong", "Diddy Kong", "Yoshi", "Wario", "Link",
      "Zelda", "Sheik", "Ganondorf", "Toon Link", "Samus", "Zero Suit Samus", "Pit", "Ice Climbers",
      "R.O.B.", "Kirby", "Meta Knight", "King Dedede", "Olimar", "Fox", "Falco", "Wolf",
      "Captain Falcon", "Pikachu", "Pokemon Trainer", "Lucario", "Jigglypuff", "Marth", "Ike",
      "Ness", "Lucas", "Mr. Game & Watch", "Snake", "Sonic",
    ),
  },
  {
    id: "melee",
    name: "Melee",
    roster: pick(
      "Mario", "Luigi", "Peach", "Bowser", "Donkey Kong", "Yoshi", "Fox", "Falco", "Ness",
      "Captain Falcon", "Pikachu", "Pichu", "Jigglypuff", "Kirby", "Samus", "Zelda", "Sheik",
      "Link", "Young Link", "Ganondorf", "Marth", "Roy", "Mr. Game & Watch", "Mewtwo", "Dr. Mario",
      "Ice Climbers",
    ),
  },
  {
    id: "smash64",
    name: "Smash 64",
    roster: pick(
      "Mario", "Donkey Kong", "Link", "Samus", "Yoshi", "Kirby", "Fox", "Pikachu", "Luigi",
      "Ness", "Captain Falcon", "Jigglypuff",
    ),
  },
];

// ---------- Session shapes ----------

import type { Series, SeriesBestOf } from "./series.js";
import { sideIdAt, singletonSides, type Side } from "./teams.js";
import {
  currentSides,
  hasTeamStructure,
  newSideLog,
  sidesAtIdx,
  type SideLog,
} from "./sidelog.js";

export type SmashMode = "ffa" | "koth";
// User-facing FORMAT chosen at start. "ffa" and "koth" record each game (the
// mode of the same name); "bestof" is a 1v1 head-to-head series that records
// once, when the set is won. "smashdown" is Ultimate's own mode: a fixed
// number of battles where every fighter used is struck from the roster for the
// rest of the series. mode carries the ffa/koth engine behavior; format
// distinguishes bestof, which uses the shared series primitive instead of the
// games log, and smashdown, which is the FFA games log plus a burn board.
export type SmashFormat = "ffa" | "koth" | "bestof" | "smashdown";
// How fighters get onto players. self: each member picks their own on their
// device. random: host taps once, everyone gets a random fighter. host:
// only the host assigns (for when that's needed).
export type SmashAssignment = "self" | "random" | "host";
// winner: one tap records the winner only. placement: full 1..N order for
// the meticulous. Winner is the low-friction default; placement is opt-in.
export type SmashResultDetail = "winner" | "placement";

// A roster slot. Members carry a userId (stats accrue); guests are typed
// names (no lifetime stats until linked to a member, a backlog item).
export interface SmashPlayer {
  id: string; // stable slot id within the session
  kind: "member" | "guest";
  userId: string | null;
  name: string;
  character: string | null;
}

// One recorded result: an FFA game or a KOTH round.
export interface SmashResultLine {
  playerId: string;
  character: string | null;
  placement: number; // 1 = winner
  isWinner: boolean;
  /**
   * Which SIDE this player was on, or null whenever every side in that battle
   * held exactly one player. `teams.ts` sideIdFor owns that rule and no pack
   * may decide it differently: null is what "no team structure" means to
   * buildRivalry, and a solo night has always written it.
   *
   * A legacy line read out of jsonb gets it written explicitly by
   * normalizeSmashState rather than left absent, so the two spellings of "no
   * side" never both exist in one session.
   */
  side: string | null;
}
export interface SmashGame {
  idx: number; // 0-based order within the night; also the dedup key suffix
  mode: SmashMode;
  lines: SmashResultLine[];
  at: string; // ISO
}

/**
 * King of the Hill running state, keyed on SIDE ids rather than player ids.
 *
 * The winning side holds the throne and the losing side rotates to the back
 * TOGETHER, which is the whole point of a team ladder; a solo night is sides of
 * one and rotates exactly as it always did. `streak` is the current holder's
 * win count.
 *
 * `bestStreak` NAMES THE SIDE AND CARRIES ITS MEMBERS, which is not decoration:
 * a throne held by a pair has to be able to name that pair after a reshuffle
 * has replaced the arrangement, and the side id alone would then resolve to
 * whoever happens to be "side a" now. Ping Pong's reign record took the same
 * call, and Mario Kart's MkKothState is this shape exactly.
 */
export interface KothState {
  kingSideId: string | null;
  queue: string[]; // challenger side ids, front plays next
  streak: number;
  bestStreak: { sideId: string; memberIds: string[]; streak: number } | null;
}

export interface SmashSessionState {
  // Unique per session start. The ledger keys each materialized game
  // {pack}:{eventId}:{sessionKey}:{idx}; without it a second session on the
  // same event resets idx to 0,1,2... and collides with the first session's
  // keys, so the dedup check silently drops every new game. (Shared by Smash
  // and Mario Kart, which both build state from newSmashState.)
  sessionKey: string;
  // User-facing format. ffa/koth record each game (below); bestof records
  // 1v1 series (series/seriesLog below) and leaves games empty.
  format: SmashFormat;
  // Which title in the series is being played. Scopes the roster and the
  // random pool; null means the pack's default (widest) title.
  titleId: string | null;
  mode: SmashMode;
  assignment: SmashAssignment;
  resultDetail: SmashResultDetail;
  // When false, only owners/admins record results (standing rule 1). The
  // host may flip it on to let members score. Defaults off.
  openScoring: boolean;
  roster: SmashPlayer[];
  /**
   * Which arrangement of SIDES was in force when, oldest first.
   *
   * A log rather than a field because the King of the Hill throne is REBUILT by
   * replaying battles, and a replay that cannot tell which stretch of the night
   * was fought under which arrangement hands the throne to a pair that never
   * won it. Nothing errors; the screen is simply wrong. See sidelog.ts.
   *
   * A solo night is one side per player, which `sideIdFor` reads as no team
   * structure, so every row it writes is the row this pack wrote before sides
   * existed.
   */
  sideSets: SideLog;
  games: SmashGame[];
  koth: KothState | null;
  // Best Of format only. bestOf is the set length; series is the in-progress
  // set (host picks two players); seriesLog is the completed, materialized
  // sets. Null/empty for ffa and koth.
  bestOf: SeriesBestOf;
  series: Series | null;
  seriesLog: Series[];
  // ---- Smashdown only ----
  // How many battles the series runs for, fixed at start and capped by
  // smashdownCap(). 0 for every other format.
  battleCount: number;
  // The burn board: every fighter used in a completed battle, in the order
  // they were struck out. SHARED across all players (true Smashdown), and
  // nothing unburns until the series ends. Stored rather than only derived
  // because the TV and the pack page both render it and it is the centrepiece
  // of the format, but it is only ever WRITTEN by burnedFrom(games), so there
  // is one derivation and undo cannot leave it disagreeing with the log.
  burned: string[];
  // Mercy rule: end the series the moment the lead is unassailable. Host
  // toggle, defaults OFF (all battles get played).
  mercy: boolean;
}

export function newSmashState(opts: {
  format?: SmashFormat;
  titleId?: string | null;
  mode: SmashMode;
  assignment: SmashAssignment;
  resultDetail: SmashResultDetail;
  roster: SmashPlayer[];
  bestOf?: SeriesBestOf;
  battleCount?: number;
  mercy?: boolean;
  /** Defaults to one side per player, which is every night this pack had before. */
  sides?: Side[];
}): SmashSessionState {
  const format: SmashFormat = opts.format ?? (opts.mode === "koth" ? "koth" : "ffa");
  const sides = opts.sides?.length ? opts.sides : singletonSides(opts.roster.map((p) => p.id));
  return {
    sessionKey: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    format,
    titleId: opts.titleId ?? null,
    mode: opts.mode,
    assignment: opts.assignment,
    resultDetail: opts.resultDetail,
    openScoring: false,
    roster: opts.roster,
    sideSets: newSideLog(sides),
    games: [],
    koth: opts.mode === "koth" ? openSmashKoth(sides) : null,
    bestOf: opts.bestOf ?? 3,
    series: null,
    seriesLog: [],
    battleCount: opts.battleCount ?? 0,
    burned: [],
    mercy: opts.mercy ?? false,
  };
}

// ---------- legacy state ----------

/**
 * Upgrade a session persisted under the pre-teams shape.
 *
 * Every row in `smash_sessions` was written with no `sideSets` at all, no
 * `side` on a battle's lines, a `koth` holding a `kingId` plus a queue of
 * PLAYER ids, and a `series` between two PLAYER ids. A night that is live when
 * this deploys has to keep working, and a finished one has to stay readable by
 * the guest backfill, so the upgrade happens at the two points where jsonb
 * becomes state (PackRuntimeConfig.normalize) and nowhere else. Doing it at the
 * pack's own call sites means getting all of them, and this pack reads state in
 * a dozen places plus the backfill.
 *
 * THE UPGRADE IS EXACT RATHER THAN APPROXIMATE. Every battle this pack ever
 * recorded was fought by individuals, so the arrangement becomes one side per
 * player, which `sideIdFor` then treats as no team structure, which is what it
 * always was. A legacy line gets `side: null` written on it EXPLICITLY rather
 * than left absent, so one session never carries both spellings of "no side".
 *
 * Follows normalizeMkState, which does this job for Mario Kart, and
 * normalizePpState, which did it first for Ping Pong's KOTH queue.
 */
export function normalizeSmashState(state: SmashSessionState): SmashSessionState {
  const raw = state as unknown as Record<string, unknown>;
  if (Array.isArray(raw.sideSets) && raw.sideSets.length > 0) return state;

  const roster = (state.roster ?? []) as SmashPlayer[];
  const sides = singletonSides(roster.map((p) => p.id));
  const sideIdOfPlayer = new Map(roster.map((p, i) => [p.id, sideIdAt(i)]));
  /** A player id becomes the id of the side holding them; anything else is left. */
  const toSideId = (id: string | null | undefined): string | null =>
    id ? sideIdOfPlayer.get(id) ?? null : null;

  const upgradeSeries = (s: Series | null | undefined): Series | null => {
    if (!s) return null;
    const aId = toSideId(s.aId);
    const bId = toSideId(s.bId);
    if (!aId || !bId) return null;
    return {
      idx: s.idx ?? -1,
      aId,
      bId,
      games: (s.games ?? []).map((g) => ({ winnerId: toSideId(g.winnerId) ?? aId })),
      winnerId: s.winnerId ? toSideId(s.winnerId) : null,
      at: s.at ?? null,
    };
  };

  const k = raw.koth as Record<string, unknown> | null | undefined;
  const legacyBest = k?.bestStreak as { playerId?: string; streak?: number } | null | undefined;
  const bestSideId = toSideId(legacyBest?.playerId);
  const koth: KothState | null = k
    ? {
        kingSideId: toSideId(k.kingId as string) ?? sides[0]?.id ?? null,
        queue: ((k.queue ?? []) as string[])
          .map((id) => toSideId(id))
          .filter((id): id is string => !!id),
        streak: (k.streak as number) ?? 0,
        bestStreak:
          legacyBest && bestSideId
            ? { sideId: bestSideId, memberIds: [legacyBest.playerId!], streak: legacyBest.streak ?? 0 }
            : null,
      }
    : null;

  return {
    ...state,
    sideSets: newSideLog(sides),
    games: ((raw.games ?? []) as SmashGame[]).map((g) => ({
      ...g,
      lines: (g.lines ?? []).map((l) => ({ ...l, side: l.side ?? null })),
    })),
    koth,
    series: upgradeSeries(state.series),
    seriesLog: ((state.seriesLog ?? []) as Series[])
      .map(upgradeSeries)
      .filter((s): s is Series => s !== null),
  };
}

/** The arrangement of sides in force right now. */
export function smashSides(state: SmashSessionState): Side[] {
  return currentSides(state.sideSets);
}

/** True when a side in force holds more than one player. Drives the whole screen. */
export function isTeamBattle(state: SmashSessionState): boolean {
  return hasTeamStructure(state.sideSets);
}

/** A side by id out of the arrangement in force. */
export function smashSideById(
  state: SmashSessionState,
  sideId: string | null | undefined,
): Side | undefined {
  return sideId ? smashSides(state).find((s) => s.id === sideId) : undefined;
}

/**
 * How many ledger units this session has recorded, which is the index space the
 * side log is keyed in.
 *
 * Smash has TWO of them and exactly one is live in any session: FFA, King of
 * the Hill and Smashdown record BATTLES into `games`, and Best Of records SETS
 * into `seriesLog`. Getting this wrong is the silent kind: a reshuffle keyed to
 * the wrong counter puts its `fromIdx` in the wrong place and the arrangement a
 * recorded unit is reported under drifts.
 */
export function smashUnitCount(state: SmashSessionState): number {
  return state.format === "bestof" ? (state.seriesLog?.length ?? 0) : (state.games?.length ?? 0);
}

/** The arrangement of sides the recorded unit at `idx` was played under. */
export function smashSidesAtIdx(state: SmashSessionState, idx: number): Side[] {
  return sidesAtIdx(state.sideSets, idx);
}

// ---------- Pure helpers ----------

/**
 * Random character, optionally excluding some (so a match has no dupes).
 * The pool defaults to the Smash roster; other packs (Mario Kart) pass
 * their own so this same session engine works for them.
 */
export function randomFighter(
  exclude: Iterable<string> = [],
  pool: readonly string[] = SMASH_FIGHTERS,
): string {
  const taken = new Set(exclude);
  const avail = pool.filter((f) => !taken.has(f));
  const from = avail.length ? avail : pool;
  return from[Math.floor(Math.random() * from.length)]!;
}

/** Assign a unique-where-possible random character to every roster slot. */
export function assignRandomFighters(
  roster: SmashPlayer[],
  pool: readonly string[] = SMASH_FIGHTERS,
): SmashPlayer[] {
  const used = new Set<string>();
  return roster.map((p) => {
    const c = randomFighter(used, pool);
    used.add(c);
    return { ...p, character: c };
  });
}

/** The opening ladder: the first side holds the throne, the rest queue behind it. */
export function openSmashKoth(sides: readonly Side[]): KothState {
  return {
    kingSideId: sides[0]?.id ?? null,
    queue: sides.slice(1).map((s) => s.id),
    streak: 0,
    bestStreak: null,
  };
}

/**
 * Fold a KOTH result into the state: the winning SIDE keeps the throne, the
 * losing SIDE rotates to the back TOGETHER, and the next challenger comes off
 * the front of the queue. Pure: returns the next KothState, doesn't mutate.
 *
 * Sides rather than players, which is what a team ladder means and what a solo
 * night already was: a side of one rotates exactly as that player did. The
 * winner arrives as a Side rather than an id because `bestStreak` carries its
 * MEMBERS, and a bare id cannot name them once a reshuffle has replaced the
 * arrangement. Mario Kart's mkKothAdvance is this function; the filter before
 * the append is what stops a side appearing in the queue twice.
 */
export function kothAdvance(koth: KothState, winner: Side, loser: Side): KothState {
  const streak = koth.kingSideId === winner.id ? koth.streak + 1 : 1;
  const bestStreak =
    !koth.bestStreak || streak > koth.bestStreak.streak
      ? { sideId: winner.id, memberIds: [...winner.memberIds], streak }
      : koth.bestStreak;
  // Loser to the back; the next challenger is whoever is now at the front.
  const queue = [...koth.queue.filter((id) => id !== winner.id && id !== loser.id), loser.id];
  return { kingSideId: winner.id, queue, streak, bestStreak };
}

/** The two sides up next: the one holding the throne and the front of the queue. */
export function kothNextPair(
  koth: KothState | null | undefined,
  sides: readonly Side[],
): { king: Side; challenger: Side } | null {
  const king = sides.find((s) => s.id === koth?.kingSideId);
  const challenger = sides.find((s) => s.id === koth?.queue[0]);
  if (!king || !challenger || king.id === challenger.id) return null;
  return { king, challenger };
}

/**
 * The default ceiling on one FFA game, and it is SMASH'S number rather than a
 * general one: Ultimate seats 8, and Smashdown's battle cap is arithmetic
 * against it (`floor(rosterSize / playerCount)` for the chosen title). Raising
 * this would quietly change every Smashdown cap in the app, which is why the
 * cap is a per-pack argument below rather than a constant packs share.
 */
export const FFA_MAX_PLAYERS = 8;

/**
 * The size half of an FFA validation, on its own so a pack that seats more than
 * Smash can reuse it without reimplementing "how many people can be in one
 * game". Board Game passes 12; every existing caller stays on the default 8.
 *
 * `what` names the thing being capped, because "FFA is capped at 12 players" is
 * not a sentence a board game player should ever be shown.
 */
export function validateFfaSize(
  count: number,
  maxPlayers: number = FFA_MAX_PLAYERS,
  what = "FFA",
): string | null {
  if (count < 2) return "Need at least 2 players in a game";
  if (count > maxPlayers) return `${what} is capped at ${maxPlayers} players`;
  return null;
}

/**
 * Validate a set of placements for an FFA game. Returns an error string or
 * null. In winner-only detail exactly one line is the winner; in placement
 * detail placements must be a permutation of 1..N.
 *
 * `maxPlayers` defaults to Smash's 8. It is an argument rather than a constant
 * so a pack that seats more can pass its own without moving anybody else's
 * ceiling; see FFA_MAX_PLAYERS for why moving Smash's is not free.
 */
export function validateFfa(
  lines: SmashResultLine[],
  detail: SmashResultDetail,
  maxPlayers: number = FFA_MAX_PLAYERS,
): string | null {
  const size = validateFfaSize(lines.length, maxPlayers);
  if (size) return size;
  if (detail === "winner") {
    const winners = lines.filter((l) => l.isWinner).length;
    if (winners !== 1) return "Pick exactly one winner";
    return null;
  }
  const places = lines.map((l) => l.placement).sort((a, b) => a - b);
  for (let i = 0; i < places.length; i++) {
    if (places[i] !== i + 1) return "Placements must be 1 through " + lines.length;
  }
  return null;
}

// ---------- Smashdown ----------
// Ultimate's own mode: a series of battles where every fighter used in a
// battle is struck from the roster for the rest of the series. The battle
// count is fixed at the start and capped by how many fighters the chosen
// TITLE has, because each battle burns one fighter per player.
//
// Everything below is pure and takes only the session state, so the rules
// live in one place that both sides import and the tests can drive directly.
// The engine underneath is the FFA games log: a Smashdown battle is an FFA
// game where the whole roster plays, which is why 1v1 and 2-8 player series
// are one code path with no special casing.

/**
 * matches.label on a Smashdown SERIES row: the one row that says who won a
 * whole series, written alongside the per-battle rows rather than instead of
 * them.
 *
 * WHY THIS LABEL IS LOAD-BEARING, and why it is not just another format. Every
 * other match-as-unit row in the ledger (a Best Of set, a Ping Pong match) IS
 * the only row its games produce: the games inside it are never materialized,
 * so counting the row counts each game once. A Smashdown series is the
 * opposite (every battle is already a row), so its series row is a SUMMARY of
 * results the ledger has already counted. Counting it as a game would inflate
 * every player's games-played by one per series and hand the series winner a
 * phantom win.
 *
 * So the rule is: anything that counts games skips this label, and only the
 * series stats read it. That rule lives in one predicate below, and the places
 * that tally outside it (the crew leaderboard's format buckets, the recap
 * rollup, the Smash panel) each call it rather than re-testing the string.
 */
export const SERIES_LABEL = "smashdown";

/**
 * True for a ledger row that SUMMARIZES rows already in the ledger, so it must
 * never be counted as a game played. See SERIES_LABEL for why this is a
 * label and not a format.
 */
export const isSeriesSummary = (label: string | null | undefined): boolean => label === SERIES_LABEL;

/**
 * The most battles a series can run: every player burns one fighter per
 * battle, so the ceiling is floor(fighters / players).
 *
 * This is not a rounding detail, it is the shape of the format. Ultimate has
 * 86 fighters, so four players can play 21 battles and nobody thinks about the
 * cap. Smash 64 has 12, so the same four players get THREE battles, and a host
 * who typed 10 needs to be told before the night starts rather than at the
 * moment the roster runs dry.
 *
 * Returns 0 when there are not even enough fighters for one battle, which is
 * a real answer (a title cannot host that many players) rather than an error.
 */
export function smashdownCap(fighterCount: number, playerCount: number): number {
  if (playerCount <= 0 || fighterCount <= 0) return 0;
  return Math.floor(fighterCount / playerCount);
}

/**
 * The burn board, derived from the battles recorded so far, in the order the
 * fighters were struck out. This is the ONLY thing that ever writes
 * state.burned, which is what makes undo correct by construction: drop the
 * last battle from the log, re-derive, and exactly that battle's fighters come
 * back. Deduped, because a fighter cannot legally be used twice anyway and a
 * board that repeated one would be a lie about how many are left.
 */
export function burnedFrom(games: readonly SmashGame[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of games) {
    for (const l of g.lines) {
      if (l.character && !seen.has(l.character)) {
        seen.add(l.character);
        out.push(l.character);
      }
    }
  }
  return out;
}

/**
 * The fighters a player may still be given: the title's roster minus the burn
 * board, minus anyone already picked for the CURRENT battle. Both exclusions
 * matter and they are different things (burned is permanent for the series,
 * taken-now lasts until the battle is recorded), but every assignment mode
 * (self-select, random, host-assign) has to honour both, so they are applied
 * in one place.
 */
export function availableFighters(
  pool: readonly string[],
  burned: readonly string[],
  takenNow: readonly (string | null | undefined)[] = [],
): string[] {
  const out = new Set(burned);
  for (const c of takenNow) if (c) out.add(c);
  return pool.filter((f) => !out.has(f));
}

/** The fighters currently held by the roster, i.e. taken for this battle. */
export function currentPicks(roster: readonly SmashPlayer[], exceptId?: string): string[] {
  return roster.filter((p) => p.id !== exceptId && p.character).map((p) => p.character!);
}

export interface SmashdownStanding {
  playerId: string;
  name: string;
  wins: number;
  played: number;
  /** Competition ranking: two players tied on 3 wins are both 1, next is 3. */
  placement: number;
}

export interface SmashdownStatus {
  battleCount: number;
  battlesPlayed: number;
  battlesLeft: number;
  burned: string[];
  /** Fighters in the chosen title. */
  poolSize: number;
  /** Fighters still on the board. */
  fightersLeft: number;
  standings: SmashdownStanding[];
  /**
   * True when the lead is mathematically unassailable, whether or not the
   * mercy toggle is on. Reported either way so the screen can say "clinched"
   * on a series that is still being played out.
   */
  clinched: boolean;
  /** The series is finished: every battle played, or mercy ended it early. */
  over: boolean;
  /** playerIds on placement 1. More than one is a genuine co-win. */
  winnerIds: string[];
}

/**
 * Everything a Smashdown screen needs, derived from the log. One function so
 * the pack page, the TV and the server cannot disagree about whether a series
 * is over or who won it.
 */
export function smashdownStatus(state: SmashSessionState): SmashdownStatus {
  const games = state.games ?? [];
  const battleCount = state.battleCount ?? 0;
  const battlesPlayed = games.length;
  const battlesLeft = Math.max(0, battleCount - battlesPlayed);
  const burned = burnedFrom(games);
  const poolSize = rosterForTitle(SMASH_TITLES, state.titleId).length;

  const tally = new Map<string, { wins: number; played: number }>();
  for (const p of state.roster) tally.set(p.id, { wins: 0, played: 0 });
  for (const g of games) {
    for (const l of g.lines) {
      const t = tally.get(l.playerId) ?? { wins: 0, played: 0 };
      t.played++;
      if (l.isWinner) t.wins++;
      tally.set(l.playerId, t);
    }
  }

  const ranked = state.roster
    .map((p) => ({
      playerId: p.id,
      name: p.name,
      wins: tally.get(p.id)?.wins ?? 0,
      played: tally.get(p.id)?.played ?? 0,
    }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));

  // Competition ranking: everyone on the same win total shares the best
  // placement of that group, and the next group skips the ones used up. A tie
  // at the top is a genuine co-win, not something to break arbitrarily.
  const standings: SmashdownStanding[] = ranked.map((r) => ({
    ...r,
    placement: ranked.findIndex((x) => x.wins === r.wins) + 1,
  }));

  // Mercy: the leader has clinched when NO other player can still reach them,
  // even by winning every battle that is left. Strictly greater, on purpose:
  // when the best a chaser can do is DRAW LEVEL, the series is still live,
  // because a tie is a co-win here and not a formality.
  const top = standings[0]?.wins ?? 0;
  const leaders = standings.filter((s) => s.wins === top);
  const clinched =
    battlesPlayed > 0 &&
    leaders.length === 1 &&
    standings.every((s) => s.playerId === leaders[0]!.playerId || top > s.wins + battlesLeft);

  const over = battleCount > 0 && (battlesPlayed >= battleCount || (!!state.mercy && clinched));

  return {
    battleCount,
    battlesPlayed,
    battlesLeft,
    burned,
    poolSize,
    fightersLeft: Math.max(0, poolSize - burned.length),
    standings,
    clinched,
    over,
    winnerIds: over ? standings.filter((s) => s.placement === 1).map((s) => s.playerId) : [],
  };
}

// ---------- Derived stats (character focus) ----------
// Computed from the games log for the live TV/summary views. Lifetime
// cross-night stats come from the materialized ledger, but these give an
// instant read of the night in progress without a round trip.

export interface CharacterStat {
  character: string;
  played: number;
  wins: number;
}
export interface PlayerStat {
  playerId: string;
  name: string;
  played: number;
  wins: number;
  mainCharacter: string | null;
  /**
   * How many DIFFERENT fighters this player has won with tonight. Derived,
   * never stored: a win already carries its fighter. It is the headline stat
   * of a Smashdown series (you cannot repeat a fighter, so it is the whole
   * game) and it reads fine on an FFA night too.
   */
  wonWith: number;
}

export function summarizeNight(state: SmashSessionState): {
  characters: CharacterStat[];
  players: PlayerStat[];
} {
  const chars = new Map<string, CharacterStat>();
  const players = new Map<
    string,
    PlayerStat & { charCounts: Map<string, number>; wonChars: Set<string> }
  >();
  const nameOf = new Map(state.roster.map((p) => [p.id, p.name]));

  for (const g of state.games) {
    for (const l of g.lines) {
      if (l.character) {
        const c = chars.get(l.character) ?? { character: l.character, played: 0, wins: 0 };
        c.played++;
        if (l.isWinner) c.wins++;
        chars.set(l.character, c);
      }
      const p =
        players.get(l.playerId) ??
        {
          playerId: l.playerId,
          name: nameOf.get(l.playerId) ?? "?",
          played: 0,
          wins: 0,
          mainCharacter: null,
          wonWith: 0,
          charCounts: new Map<string, number>(),
          wonChars: new Set<string>(),
        };
      p.played++;
      if (l.isWinner) p.wins++;
      if (l.character) {
        p.charCounts.set(l.character, (p.charCounts.get(l.character) ?? 0) + 1);
        if (l.isWinner) p.wonChars.add(l.character);
      }
      players.set(l.playerId, p);
    }
  }

  const playerList: PlayerStat[] = [...players.values()].map((p) => {
    let main: string | null = null;
    let max = 0;
    for (const [c, n] of p.charCounts) if (n > max) ((max = n), (main = c));
    return {
      playerId: p.playerId,
      name: p.name,
      played: p.played,
      wins: p.wins,
      mainCharacter: main,
      wonWith: p.wonChars.size,
    };
  });

  return {
    characters: [...chars.values()].sort((a, b) => b.wins - a.wins || b.played - a.played),
    players: playerList.sort((a, b) => b.wins - a.wins || b.played - a.played),
  };
}

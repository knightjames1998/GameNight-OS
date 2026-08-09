// THE TITLE-NIGHT LAYER: one engine for every pack whose night is a sequence of
// named games with a tapped finish order.
//
// EXTRACTED FROM BOARD GAME ON 2026-08-05, when Card table arrived as the
// second example. That is deliberately the same moment the casino group's
// shared screens were extracted: blackjack shipped alone and its money board,
// setup screen and money routes were pulled out when ROULETTE turned up, not
// guessed at from one pack. One example is a pack; two is a layer.
//
// WHAT A TITLE-NIGHT PACK IS. A crew plays a sequence of named games in one
// evening. Each game is ONE recorded result: the host picks a title, taps the
// finish order, confirms. The title goes on `matches.label`, the pack has ONE
// `games` row (never one per title, which would split it into a leaderboard tab
// per game), and per-title stats derive from the label.
//
// WHAT A PACK STILL OWNS: its registry entry, its curated title list, its
// partnership defaults, its copy and its theme. That is the whole difference
// between Board Game and Card table, exactly as roulette differs from
// blackjack, and it is why they are two packs rather than one with a toggle:
// "good at board games" and "good at card games" are different claims and one
// `games` row per pack is what keeps a leaderboard tab meaningful.
//
// ===========================================================================
// THREE RULES LIVE HERE AND ALL THREE FAIL SILENTLY IF BROKEN.
//
//   1. PLACEMENT IS TAPPED, NEVER DERIVED FROM A SCORE. Titles disagree about
//      direction (Catan is high-wins, Hearts is low-wins, Pandemic has no score
//      at all), so an engine that ranked by number would need each title's
//      direction and a wrong one INVERTS a leaderboard without erroring.
//   2. A FREE-TEXT TITLE IS CANONICALIZED ON ENTRY, or three spellings of one
//      title are three histories and nothing errors.
//   3. `side` IS NULL WHEN EVERY SIDE HAS ONE MEMBER, which is teams.ts's rule
//      and is not re-derived here. A pack that worked around it would make
//      `meetingOutcome` call two opponents teammates, forever.
// ===========================================================================

import {
  placementsFromRankedSides,
  shuffleIntoSides,
  singletonSides,
  sideIdFor,
  type Side,
} from "./teams.js";
// The size rule lives with Smash's cap because that cap is load-bearing there;
// see FFA_MAX_PLAYERS. A title-night pack passes its own maximum.
import { validateFfaSize } from "./smash.js";

// ---------- what a pack supplies ----------

/**
 * How a title opens: how many sides the host is offered before they touch
 * anything. 1 means free-for-all (one side per player).
 *
 * THE TITLE SETS THE DEFAULT AND THE HOST CAN ALWAYS OVERRIDE (James, 2026-08-05).
 * Euchre and Spades are partnership games and should open that way; Hearts and
 * Rummy should not. But house rules are real: three-handed euchre exists and
 * partnership rummy exists, so a default that could not be overridden would be
 * the app refereeing somebody's kitchen table. The default is a starting
 * position, never a rule.
 */
export type TitleShape = number;

export interface TitleNightConfig {
  /** The curated starter list. A convenience, never a roster: free text always wins. */
  titles: readonly string[];
  /**
   * Titles that open with sides already on, and how many. Absent means
   * free-for-all. A FREE-TYPED TITLE HAS NO DEFAULT and opens free-for-all,
   * because there is nothing to look it up in.
   */
  partnerships?: Readonly<Record<string, TitleShape>>;
  /** How many people can sit at one game of this pack's kind. */
  maxPlayers: number;
  /** What one recorded unit is called on screen: "game", "hand". */
  unit: string;
}

/** How many sides `title` opens with. 1 is free-for-all. */
export function defaultShapeForTitle(config: TitleNightConfig, title: string | null | undefined): TitleShape {
  if (!title) return 1;
  const key = normalizeTitle(title).toLowerCase();
  for (const [name, shape] of Object.entries(config.partnerships ?? {})) {
    if (normalizeTitle(name).toLowerCase() === key) return shape;
  }
  return 1;
}

// ---------- session shapes ----------

/** A roster slot. No `character`: a title night has no characters. */
export interface TnPlayer {
  id: string;
  kind: "member" | "guest";
  userId: string | null;
  name: string;
}

/**
 * Whether a typed score belongs to a PLAYER or to a SIDE.
 *
 * Per session, because a night is one or the other in practice and asking per
 * game would be a tap the pack's whole promise is trying to avoid. It is stored
 * on every ledger row (see tnGameLines) so a reader never has to guess.
 */
export type ScoreGrain = "player" | "side";

/** One row of the tapped finish order, over SIDES. */
export interface TnOrderEntry {
  sideId: string;
  /** Competition ranking: this side finished level with the one above. */
  tiedWithAbove?: boolean;
  /** The side's score, when the grain is "side". */
  score?: number | null;
  /** Each member's own score, when the grain is "player". */
  memberScores?: Record<string, number | null>;
}

/** One recorded line, ready for the ledger. */
export interface TnLine {
  playerId: string;
  placement: number;
  isWinner: boolean;
  /** null when there is no team structure; teams.ts owns that rule. */
  side: string | null;
  /** A NOTE. Never a ranking input. */
  score: number | null;
}

export interface TnGame {
  idx: number;
  title: string;
  lines: TnLine[];
  /** Snapshot of the sides that played it, so a later reshuffle cannot rewrite history. */
  sides: Side[];
  /** The grain the scores on this game were typed at. */
  grain: ScoreGrain;
  at: string;
}

/** One arrangement of sides, and the game index it took effect from. */
export interface TnSideSet {
  fromIdx: number;
  sides: Side[];
}

export interface TnSessionState {
  sessionKey: string;
  openScoring: boolean;
  /** What is on the table right now, or null between games. */
  nowPlaying: string | null;
  roster: TnPlayer[];
  /** Always at least one entry; the LAST is in force. */
  sideSets: TnSideSet[];
  grain: ScoreGrain;
  games: TnGame[];
}

export function currentTnSides(state: TnSessionState): Side[] {
  return state.sideSets[state.sideSets.length - 1]?.sides ?? [];
}

/** True when any side in force holds more than one player. */
export function isPartnership(state: TnSessionState): boolean {
  return currentTnSides(state).some((s) => s.memberIds.length > 1);
}

export function newTnState(opts: {
  roster: TnPlayer[];
  sides?: Side[];
  grain?: ScoreGrain;
}): TnSessionState {
  const sides = opts.sides?.length ? opts.sides : singletonSides(opts.roster.map((p) => p.id));
  return {
    sessionKey: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    openScoring: false,
    nowPlaying: null,
    roster: opts.roster,
    sideSets: [{ fromIdx: 0, sides }],
    // The grain FOLLOWS THE SHAPE by default and the host can flip it: a
    // partnership night's score belongs to the pair, a free-for-all night's to
    // the player. Same idea as the title-driven default, so there is one thing
    // to learn rather than two.
    grain: opts.grain ?? (sides.some((s) => s.memberIds.length > 1) ? "side" : "player"),
    games: [],
  };
}

/**
 * Replace the arrangement of sides from here on. Returns an error or null.
 *
 * Completed games keep their own snapshots and are untouched, so the night's
 * history stays true. Same log-not-a-field shape Ping Pong uses, and for the
 * same reason: a boundary that is recorded can be undone across.
 */
export function reshuffleTnSides(state: TnSessionState, sides: Side[], grain?: ScoreGrain): string | null {
  const known = new Set(state.roster.map((p) => p.id));
  if (sides.some((s) => s.memberIds.some((id) => !known.has(id)))) {
    return "Somebody on a side is not in this session";
  }
  const last = state.sideSets[state.sideSets.length - 1]!;
  const entry: TnSideSet = { fromIdx: state.games.length, sides };
  // A reshuffle with no games under it yet REPLACES rather than stacks, so
  // changing your mind twice leaves no dead arrangement in the log.
  if (last.fromIdx === state.games.length) state.sideSets[state.sideSets.length - 1] = entry;
  else state.sideSets.push(entry);
  if (grain) state.grain = grain;
  return null;
}

// ---------- the title sets the shape ----------

/** What an auto-applied title change actually did. */
export interface TitleShapeChange {
  /** How many sides the title asked for. 1 is free-for-all. */
  shape: TitleShape;
  /** The arrangement now in force. */
  sides: Side[];
  /** The grain that came with it: it follows the shape. */
  grain: ScoreGrain;
}

/**
 * Put the sides into the shape the title implies, when the host says what is on
 * the table. Returns what changed, or null when nothing did.
 *
 * THE POINT IS THAT NOBODY HAS TO KNOW THIS EXISTS. Somebody taps Euchre and
 * the screen is already asking who is partnered with whom; they tap Hearts and
 * it is back to everybody for themselves. A default that has to be found in a
 * menu is a default that does not get used, and the alternative is a crew
 * recording four hands of Euchre as a free-for-all and only noticing in the
 * stats a month later.
 *
 * TWO GUARDS, and both exist to stop this being the feature that undoes the
 * host's work.
 *
 *   1. IT FIRES ONLY WHEN THE SIDE COUNT DIFFERS. A host who has already put
 *      four people into two specific pairs and then taps Euchre keeps their
 *      pairs: the title wanted two sides and there are two sides, so there is
 *      nothing to decide. Without this, naming the game you were already
 *      playing would silently reshuffle the table.
 *   2. GOING BACK TO FREE-FOR-ALL IS DETERMINISTIC. Partnerships to
 *      free-for-all is `singletonSides` in roster order, never a shuffle. The
 *      arrangement it produces is the only one that means "no teams", so
 *      randomising it would be theatre, and a host who taps Hearts and then
 *      Euchre and then Hearts again gets the same screen back both times.
 *
 * Only ever called when the host sets what is ON THE TABLE, never when a
 * result is recorded: the record form can carry its own title, and rearranging
 * the table at the moment a game is submitted would change the sides the game
 * was just played under.
 *
 * A CLEARED TITLE CHANGES NOTHING. "Between games" is where a title night
 * spends most of its evening, and dissolving the partnerships every time the
 * box goes back in the middle of the table would be absurd.
 */
export function applyTitleShape(
  state: TnSessionState,
  config: TitleNightConfig,
  title: string | null | undefined,
  rng: () => number = Math.random,
): TitleShapeChange | null {
  if (!title || !title.trim()) return null;

  const shape = defaultShapeForTitle(config, title);
  const ids = state.roster.map((p) => p.id);
  // Free-for-all is one side per player, so its "count" is the roster size.
  // WITH TWO PLAYERS THE TWO SHAPES ARE THE SAME ARRANGEMENT, and this falls
  // out rather than being special-cased: two singletons is two sides, so the
  // guard below sees no difference and leaves the table alone.
  const target = shape <= 1 ? ids.length : Math.max(2, Math.min(shape, Math.max(2, ids.length)));
  if (currentTnSides(state).length === target) return null;

  const sides = shape <= 1 ? singletonSides(ids) : shuffleIntoSides(ids, shape, rng);
  // The grain follows the shape, the same rule `newTnState` uses, so there is
  // one thing to learn rather than two.
  const grain: ScoreGrain = sides.some((s) => s.memberIds.length > 1) ? "side" : "player";
  // Cannot fail: every id came out of this session's own roster.
  reshuffleTnSides(state, sides, grain);
  return { shape, sides, grain };
}

// ---------- validation ----------

/**
 * Validate a tapped order against the sides in force.
 *
 * The size half delegates to `validateFfaSize` with the pack's own cap, so
 * there is one definition of "how many people fit in one game" across the app
 * and a pack differs from Smash by an argument rather than an implementation.
 */
export function validateTnOrder(
  order: TnOrderEntry[],
  state: TnSessionState,
  config: TitleNightConfig,
): string | null {
  const sides = currentTnSides(state);
  const known = new Map(sides.map((s) => [s.id, s]));
  const seen = new Set<string>();
  let heads = 0;
  for (const e of order) {
    const side = known.get(e.sideId);
    if (!side) return "Somebody in the finish order is not in this session";
    if (seen.has(e.sideId)) return "A side can only appear once in the finish order";
    seen.add(e.sideId);
    heads += side.memberIds.length;
  }
  if (order.length < 2) return `Need at least 2 players in a ${config.unit}`;
  return validateFfaSize(heads, config.maxPlayers, `A ${config.unit}`);
}

/** The side holding a player, out of the arrangement in force. */
export function tnSideIdOf(state: TnSessionState, playerId: string): string | undefined {
  return currentTnSides(state).find((s) => s.memberIds.includes(playerId))?.id;
}

/**
 * Record one finished game onto the session and hand it back.
 *
 * The game SNAPSHOTS the sides that played it and the grain its scores were
 * typed at, so neither a later reshuffle nor a later grain change can rewrite
 * what a recorded game meant.
 */
export function recordTnGame(state: TnSessionState, title: string, order: TnOrderEntry[]): TnGame {
  const sides = currentTnSides(state);
  const played = order
    .map((e) => sides.find((s) => s.id === e.sideId))
    .filter((s): s is Side => !!s);
  const game: TnGame = {
    idx: state.games.length,
    title,
    lines: tnPlacements(order, sides, state.grain),
    sides: played.map((s) => ({ ...s, memberIds: [...s.memberIds] })),
    grain: state.grain,
    at: new Date().toISOString(),
  };
  state.games.push(game);
  // The game is over, so nothing is on the table until the host says otherwise.
  state.nowPlaying = null;
  return game;
}

// ---------- placement and the ledger shape ----------

/**
 * Turn a tapped order into ranked lines.
 *
 * THE ORDER IS THE PLACEMENT AND NOTHING DERIVES IT FROM A SCORE. This is the
 * one place somebody would reach for a sort; do not add one. See rule 1 at the
 * top of this file for why a wrong sort here is silent rather than loud.
 *
 * The ranking itself is teams.ts's, not a second copy: singleton sides with
 * ties produce the free-for-all competition ranking (1,1,3) that Board Game
 * shipped with, and multi-member sides produce 1..N over sides (a 2v2 is
 * 1,1,2,2). The `side` value is teams.ts's too, so an all-singletons night
 * writes null on every row and is byte-identical to what shipped before this
 * layer existed.
 */
export function tnPlacements(order: TnOrderEntry[], sides: readonly Side[], grain: ScoreGrain): TnLine[] {
  const byId = new Map(sides.map((s) => [s.id, s]));
  const ranked = order
    .map((e) => ({ side: byId.get(e.sideId), tiedWithAbove: e.tiedWithAbove }))
    .filter((r): r is { side: Side; tiedWithAbove: boolean | undefined } => !!r.side);
  const placed = placementsFromRankedSides(ranked);

  const scoreOf = new Map<string, number | null>();
  for (const e of order) {
    const side = byId.get(e.sideId);
    if (!side) continue;
    for (const id of side.memberIds) {
      // A SIDE score is written onto every member of that side, which double
      // counts a crew-wide sum by the side's size. Accepted, consistent with
      // Ping Pong's 2026-08-05 call, and survivable precisely because the grain
      // travels with the row: a reader can divide by the side size later, and a
      // row that did not say its grain would be a number nobody can interpret.
      //
      // ON A SIDE OF ONE THE TWO GRAINS ARE THE SAME NUMBER, so a per-player
      // session still reads a score typed against the side. That is not a
      // convenience: a free-for-all night IS singleton sides, its score is
      // typed once per person, and without this fallback every score a
      // free-for-all pack recorded would be silently dropped. Caught by the
      // pinned Board Game fixtures, which is what they are for.
      const own = e.memberScores?.[id];
      const fallback = side.memberIds.length === 1 ? e.score ?? null : null;
      scoreOf.set(id, grain === "side" ? e.score ?? null : own ?? fallback);
    }
  }

  return placed.map((l) => ({
    playerId: l.playerId,
    placement: l.placement,
    isWinner: l.isWinner,
    side: l.side,
    score: scoreOf.get(l.playerId) ?? null,
  }));
}

/** One participant row a recorded game produces, before the runtime sees it. */
export interface TnLedgerLine {
  playerId: string;
  placement: number;
  isWinner: boolean;
  side: string | null;
  /**
   * The typed score as a NOTE, with the GRAIN it was typed at.
   *
   * Deliberately not `match_participants.score`: that column is a ranking input
   * where packs use it (Mario Party's stars decide the winner) and this must
   * never be mistaken for one.
   *
   * `grain` is omitted entirely when nobody typed a score, so a night with no
   * scores writes byte-identical meta to what Board Game wrote before this
   * layer existed. That equivalence is pinned in boardgame-pinned.test.ts.
   */
  meta: { score: number; grain: ScoreGrain } | null;
}

/** The participant rows for one recorded game. */
export function tnGameLines(game: TnGame): TnLedgerLine[] {
  return game.lines.map((line) => ({
    playerId: line.playerId,
    placement: line.placement,
    isWinner: line.isWinner,
    side: line.side,
    meta: line.score === null ? null : { score: line.score, grain: game.grain },
  }));
}

// ---------- titles ----------

/**
 * Trim, and collapse runs of internal whitespace to one space.
 *
 * Per-title stats read `matches.label`, so the label space is unbounded free
 * text: "Catan ", " Catan" and "Catan  " would be three titles that silently
 * split a crew's history. Same failure class as `games.name`, one level down.
 */
export function normalizeTitle(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Resolve a submitted title against the titles already in use.
 *
 * `known` is the crew's own recents FIRST and the curated list second, so a
 * crew that has been writing "Settlers of Catan" all year keeps their spelling
 * rather than being quietly moved onto the starter list's. Matching is
 * case-folded; only a genuine miss creates a new title. The DISPLAY name is
 * stored, never an id, because `label` is a display string everywhere else and
 * the leaderboard reads it directly.
 */
export function canonicalTitle(
  raw: string,
  known: readonly string[],
): { title: string; matched: boolean } {
  const title = normalizeTitle(raw);
  if (!title) return { title: "", matched: false };
  const folded = title.toLowerCase();
  for (const candidate of known) {
    if (normalizeTitle(candidate).toLowerCase() === folded) {
      return { title: normalizeTitle(candidate), matched: true };
    }
  }
  return { title, matched: false };
}

/** The crew's recents first, then the curated list, with no duplicates. */
export function tnTitleSuggestions(recents: readonly string[], curated: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [...recents, ...curated]) {
    const title = normalizeTitle(t);
    const folded = title.toLowerCase();
    if (!title || seen.has(folded)) continue;
    seen.add(folded);
    out.push(title);
  }
  return out;
}

// ---------- derived night summary ----------

export interface TnPlayerStat {
  playerId: string;
  name: string;
  games: number;
  wins: number;
  /** Null until they have played; an average of nothing is not zero. */
  avgPlacement: number | null;
}

export interface TnNightSummary {
  players: TnPlayerStat[];
  titles: { title: string; games: number }[];
  last: {
    title: string;
    lines: { name: string; placement: number; score: number | null }[];
  } | null;
}

export function summarizeTnNight(state: TnSessionState): TnNightSummary {
  const nameOf = new Map(state.roster.map((p) => [p.id, p.name]));
  const players = new Map<string, TnPlayerStat & { placeSum: number }>();
  const titles = new Map<string, number>();

  for (const g of state.games) {
    titles.set(g.title, (titles.get(g.title) ?? 0) + 1);
    for (const l of g.lines) {
      const p =
        players.get(l.playerId) ??
        {
          playerId: l.playerId,
          name: nameOf.get(l.playerId) ?? "?",
          games: 0,
          wins: 0,
          avgPlacement: null,
          placeSum: 0,
        };
      p.games++;
      if (l.isWinner) p.wins++;
      p.placeSum += l.placement;
      players.set(l.playerId, p);
    }
  }

  const lastGame = state.games[state.games.length - 1];
  return {
    players: [...players.values()]
      .map((p) => ({
        playerId: p.playerId,
        name: p.name,
        games: p.games,
        wins: p.wins,
        avgPlacement: p.games ? p.placeSum / p.games : null,
      }))
      .sort((a, b) => b.wins - a.wins || (a.avgPlacement ?? 99) - (b.avgPlacement ?? 99)),
    titles: [...titles.entries()]
      .map(([title, games]) => ({ title, games }))
      .sort((a, b) => b.games - a.games || a.title.localeCompare(b.title)),
    last: lastGame
      ? {
          title: lastGame.title,
          lines: lastGame.lines.map((l) => ({
            name: nameOf.get(l.playerId) ?? "?",
            placement: l.placement,
            score: l.score,
          })),
        }
      : null,
  };
}

/** A side's label from its members' names: what a room calls a pair. */
export function tnSideLabel(side: Side, nameOf: (id: string) => string | undefined): string {
  const names = side.memberIds.map((id) => nameOf(id)).filter((n): n is string => !!n);
  return names.length ? names.join(" + ") : side.name;
}

/** Re-exported so a pack never reaches past this layer for the null rule. */
export { sideIdFor };

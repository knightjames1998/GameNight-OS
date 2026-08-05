// Board Game pack: shared types, the curated starter titles, and pure logic.
// Dependency-free, like every other pack module.
//
// THE CHEAPEST PACK IN THE APP, and that is the design rather than an accident.
// A crew plays board games on a night; each board game played is one recorded
// result. The host picks a title, taps the finish order, confirms. No per-turn
// input, nothing to maintain between games, and NO NEW ENGINE: the ledger unit
// is the game, placement comes from the tapped order, and everything else rides
// the FFA placement path, `usePackSession`, `createPackRuntime` and the shared
// leaderboard row that already exist. If a later session finds itself writing a
// settlement function in here, something has gone wrong.
//
// TWO RULES LIVE IN THIS FILE AND BOTH ARE LOAD-BEARING:
//
//   1. PLACEMENT IS TAPPED, NEVER DERIVED FROM A SCORE. See placementsFromOrder.
//   2. A FREE-TEXT TITLE IS CANONICALIZED ON ENTRY. See canonicalTitle.
//
// Both exist because their failure mode is silence: a wrong direction on a
// score inverts a leaderboard, and three spellings of one title are three
// titles and nothing errors.

import { validateFfaSize } from "./smash.js";

/**
 * How many people can sit at one board game.
 *
 * PER PACK, and that matters: `validateFfa` caps at 8, and that 8 IS
 * LOAD-BEARING FOR SMASH (Ultimate seats 8, and Smashdown's
 * `floor(rosterSize / playerCount)` battle cap is arithmetic against it), so
 * raising the global would have quietly changed Smashdown's caps. Board games
 * seat more than 8, so the cap is an argument with a default of 8 and this pack
 * passes 12. Every existing caller stays on the default.
 */
export const BOARD_GAME_MAX_PLAYERS = 12;

/**
 * A convenience list, NOT a roster. It exists so a crew's first night is not a
 * blank text box, and it is deliberately modest and uncontroversial: the real
 * defence against a split history is the crew's OWN recents, offered first.
 *
 * Standing rule 10 (a title selector scoping a character picker) does not apply
 * here, because these are not characters and there is nothing to scope. Free
 * text is always allowed on top of this list.
 *
 * Codenames is deliberately absent: it belongs to the Party games pack, which
 * is scoped in the backlog and waits on the team primitive.
 */
export const BOARD_GAME_TITLES: readonly string[] = [
  "Catan",
  "Ticket to Ride",
  "Wingspan",
  "Carcassonne",
  "Azul",
  "Monopoly",
  "Risk",
  "Scrabble",
  "Clue",
  "Pandemic",
  "7 Wonders",
  "Splendor",
  "Dominion",
];

// ---------- session shapes ----------

/**
 * A roster slot. Structurally the runtime's RosterSlot, with no `character`
 * field: there are no characters in a board game, so the pack does not carry a
 * column it would only ever write null into.
 */
export interface BgPlayer {
  id: string;
  kind: "member" | "guest";
  userId: string | null;
  name: string;
}

/**
 * One row of the tapped finish order, as the host builds it.
 *
 * `tiedWithAbove` is the whole tie mechanism: rather than a separate "enter a
 * tie" mode, a row says it finished level with the row above it, which is how
 * somebody reading the order out loud would describe it ("then Sam and Jo, both
 * third"). It is meaningless on the first row and ignored there.
 */
export interface BgOrderEntry {
  playerId: string;
  tiedWithAbove?: boolean;
  /** Optional final score. A NOTE. See placementsFromOrder. */
  score?: number | null;
}

/** One recorded line, ready for the ledger. */
export interface BgLine {
  playerId: string;
  placement: number; // 1 = winner, competition ranking
  isWinner: boolean;
  /** Rides in match_participants.meta, never in the placement maths. */
  score: number | null;
}

export interface BgGame {
  idx: number; // 0-based order in the night; also the ledger key suffix
  title: string;
  lines: BgLine[];
  at: string; // ISO
}

export interface BgSessionState {
  // Unique per session start. The ledger keys each game
  // bg:{eventId}:{sessionKey}:{idx}; without it a second session on the same
  // event restarts idx at 0 and collides with the first session's keys, so the
  // dedupe check silently drops every new game.
  sessionKey: string;
  openScoring: boolean;
  /**
   * What is on the table RIGHT NOW, or null between games. One tap when the
   * box comes out, and it is what the TV shows large. It clears when the
   * result is recorded, because the game is then over.
   */
  nowPlaying: string | null;
  roster: BgPlayer[];
  games: BgGame[];
}

export function newBgState(opts: { roster: BgPlayer[] }): BgSessionState {
  return {
    sessionKey: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    openScoring: false,
    nowPlaying: null,
    roster: opts.roster,
    games: [],
  };
}

// ---------- placement, from the tapped order ----------

/**
 * Turn a tapped finish order into ranked lines. Competition ranking, the
 * convention already used everywhere in this app: two players tied at the top
 * are both placement 1 and the next player is placement 3. Both tied players
 * are winners.
 *
 * THE ORDER IS THE PLACEMENT AND NOTHING DERIVES IT FROM ANYTHING ELSE, AND
 * THE SCORE IS A NOTE. This is the one place somebody would reasonably reach
 * for a sort, so: do not add one. Board games disagree about direction (Catan
 * is high-wins, Hearts is low-wins, plenty have no score at all), so an engine
 * that derived placement from a number would have to know each title's
 * direction, and a wrong direction silently INVERTS a leaderboard rather than
 * erroring. Tapping the order removes the question and costs the host nothing,
 * since they know who won.
 *
 * A typed score that disagrees with the tapped order is therefore allowed to
 * stand, and the app must not "fix" either one.
 */
export function placementsFromOrder(order: BgOrderEntry[]): BgLine[] {
  const lines: BgLine[] = [];
  for (const [i, entry] of order.entries()) {
    // Competition ranking: a tie takes the placement above it, and the next
    // untied row takes its own 1-based position, which is what leaves the gap
    // (1, 1, 3) rather than closing it up (1, 1, 2).
    const placement = i > 0 && entry.tiedWithAbove ? lines[i - 1]!.placement : i + 1;
    lines.push({
      playerId: entry.playerId,
      placement,
      isWinner: placement === 1,
      score: entry.score ?? null,
    });
  }
  return lines;
}

/**
 * Validate a tapped order against the session roster. Returns an error string
 * or null, the same shape `validateFfa` uses.
 *
 * The size half delegates to `validateFfaSize` with this pack's cap, so there
 * is one definition of "how many people can be in one game" and Board Game
 * differs from Smash by an argument rather than by a second implementation.
 */
export function validateBgOrder(order: BgOrderEntry[], roster: BgPlayer[]): string | null {
  const size = validateFfaSize(order.length, BOARD_GAME_MAX_PLAYERS, "A board game");
  if (size) return size;
  const known = new Set(roster.map((p) => p.id));
  const seen = new Set<string>();
  for (const e of order) {
    if (!known.has(e.playerId)) return "Somebody in the finish order is not in the session";
    if (seen.has(e.playerId)) return "A player can only appear once in the finish order";
    seen.add(e.playerId);
  }
  return null;
}

// ---------- titles, and the one real risk in this pack ----------

/**
 * Trim, and collapse runs of internal whitespace to one space.
 *
 * Per-title stats read `matches.label`, so the label space is effectively
 * unbounded free text: "Catan ", " Catan" and "Catan  " would be three titles
 * that silently split a crew's history. Same failure class as `games.name`, one
 * level down.
 */
export function normalizeTitle(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Resolve a submitted title against the titles already in use.
 *
 * `known` is the crew's own recents FIRST and the curated list second, so a
 * crew that has been writing "Settlers of Catan" all year keeps getting their
 * spelling rather than being quietly moved onto the starter list's. Matching is
 * case-folded, so "catan" resolves to "Catan"; only a genuine miss creates a
 * new title.
 *
 * The DISPLAY NAME is what gets stored, never an id, because `label` is a
 * display string everywhere else it is used and the leaderboard reads it
 * directly.
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
export function titleSuggestions(recents: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [...recents, ...BOARD_GAME_TITLES]) {
    const title = normalizeTitle(t);
    const folded = title.toLowerCase();
    if (!title || seen.has(folded)) continue;
    seen.add(folded);
    out.push(title);
  }
  return out;
}

// ---------- the ledger shape ----------
//
// MOVED HERE VERBATIM from materializeGame in apps/server/src/boardgame.ts,
// unchanged, so that what one recorded game writes to the ledger is a PURE
// function with no database anywhere near it. Same reason ppMatchLines moved:
// the shared title-night extraction has to prove Board Game's rows are
// byte-identical afterwards, and a row shape that can only be observed through
// a Drizzle call cannot be pinned by a fixture.

/** One participant row a recorded game produces, before the runtime sees it. */
export interface BgLedgerLine {
  playerId: string;
  placement: number;
  isWinner: boolean;
  /**
   * The optional typed score, as a NOTE. Deliberately not
   * match_participants.score: that column is a ranking input where packs use it
   * (Mario Party's stars decide the winner) and this must never be mistaken for
   * one. Null when nobody typed a number.
   */
  meta: { score: number } | null;
}

/** The participant rows for one recorded game. */
export function bgGameLines(game: BgGame): BgLedgerLine[] {
  return game.lines.map((line) => ({
    playerId: line.playerId,
    placement: line.placement,
    isWinner: line.isWinner,
    meta: line.score === null ? null : { score: line.score },
  }));
}

// ---------- derived night summary ----------

export interface BgPlayerStat {
  playerId: string;
  name: string;
  games: number;
  wins: number;
  /** Null until they have played a game; averages of nothing are not zero. */
  avgPlacement: number | null;
}

export interface BgNightSummary {
  players: BgPlayerStat[];
  titles: { title: string; games: number }[];
  /** The most recent completed game, which is a whole panel on the TV. */
  last: { title: string; lines: { name: string; placement: number; score: number | null }[] } | null;
}

export function summarizeBgNight(state: BgSessionState): BgNightSummary {
  const nameOf = new Map(state.roster.map((p) => [p.id, p.name]));
  const players = new Map<string, BgPlayerStat & { placeSum: number }>();
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

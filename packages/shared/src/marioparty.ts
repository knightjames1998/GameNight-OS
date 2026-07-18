// Mario Party pack: shared types, per-title data, and pure logic.
// Dependency-free. Reuses the roster/player/title machinery from the Smash
// module (SmashPlayer, GameTitle, rosterForTitle) but a Mario Party game is
// richer than an FFA game: each game is one BOARD, each player has a TOTAL
// STAR count, and optionally the BONUS STARS they won. The winner is the
// most stars (a top tie is broken by the host, since we don't track coins).
//
// The "Which game?" title selector (standing rule) scopes three things
// here: the character roster, the board list, and the bonus-star options.

import type { GameTitle, SmashPlayer, SmashAssignment } from "./smash.js";
export type { SmashPlayer } from "./smash.js";

// A Mario Party title carries its playable roster, its boards, and the set
// of bonus stars that game awards. Extends GameTitle so rosterForTitle()
// works on it unchanged.
export interface MpTitle extends GameTitle {
  boards: readonly string[];
  bonusStars: readonly string[];
}

// Newest/widest first; Jamboree is the default. Rosters, boards, and bonus
// stars pinned against sources (Super Mario Wiki / official sites), not
// memory. Custom boards are always allowed on top of these lists.
export const MARIO_PARTY_TITLES: MpTitle[] = [
  {
    id: "jamboree",
    name: "Super Mario Party Jamboree",
    roster: [
      "Mario", "Luigi", "Peach", "Daisy", "Wario", "Waluigi", "Yoshi", "Rosalina", "Donkey Kong",
      "Birdo", "Shy Guy", "Koopa Troopa", "Monty Mole", "Bowser", "Bowser Jr.", "Goomba", "Boo",
      "Toad", "Toadette", "Spike", "Ninji", "Pauline",
    ],
    boards: [
      "Mega Wiggler's Tree Party", "Rainbow Galleria", "Goomba Lagoon", "Roll 'em Raceway",
      "King Bowser's Keep", "Western Land", "Mario's Rainbow Castle",
    ],
    bonusStars: ["Minigame Star", "Coin Star", "Event Star"],
  },
  {
    id: "superstars",
    name: "Mario Party Superstars",
    roster: [
      "Mario", "Luigi", "Peach", "Daisy", "Wario", "Waluigi", "Yoshi", "Rosalina", "Donkey Kong",
      "Birdo",
    ],
    boards: [
      "Peach's Birthday Cake", "Yoshi's Tropical Island", "Space Land", "Horror Land", "Woody Woods",
    ],
    bonusStars: ["Minigame Star", "Coin Star", "Happening Star"],
  },
];

const CUSTOM_BOARD = "Custom board";
export const MP_CUSTOM_BOARD = CUSTOM_BOARD;

function titleOf(titleId: string | null | undefined): MpTitle {
  return MARIO_PARTY_TITLES.find((t) => t.id === titleId) ?? MARIO_PARTY_TITLES[0]!;
}
export function boardsForTitle(titleId: string | null | undefined): readonly string[] {
  return titleOf(titleId).boards;
}
export function bonusStarsForTitle(titleId: string | null | undefined): readonly string[] {
  return titleOf(titleId).bonusStars;
}

// ---------- session shapes ----------

export interface MpLine {
  playerId: string;
  character: string | null;
  stars: number;
  bonusStars: string[];
  placement: number; // 1 = winner
  isWinner: boolean;
}
export interface MpGame {
  idx: number; // 0-based order in the night; also the dedup key suffix
  map: string;
  lines: MpLine[];
  at: string; // ISO
}
export interface MpSessionState {
  titleId: string | null;
  assignment: SmashAssignment;
  openScoring: boolean;
  roster: SmashPlayer[];
  games: MpGame[];
}

export function newMpState(opts: {
  titleId?: string | null;
  assignment: SmashAssignment;
  roster: SmashPlayer[];
}): MpSessionState {
  return {
    titleId: opts.titleId ?? null,
    assignment: opts.assignment,
    openScoring: false,
    roster: opts.roster,
    games: [],
  };
}

// ---------- pure ranking ----------
// Turn raw per-player star entries into ranked lines. Winner is the most
// stars; a top tie must be resolved by the host (winnerId), since coins
// (the real tiebreaker) aren't tracked. Non-winners are ordered by stars.
export interface MpRawEntry {
  playerId: string;
  character: string | null;
  stars: number;
  bonusStars: string[];
}
export function rankMpLines(
  entries: MpRawEntry[],
  winnerId: string | null | undefined,
): { lines: MpLine[]; error: string | null } {
  if (entries.length < 2) return { lines: [], error: "Need at least 2 players in a game" };
  if (entries.length > 4) return { lines: [], error: "Mario Party is up to 4 players" };
  if (entries.some((e) => !Number.isFinite(e.stars) || e.stars < 0)) {
    return { lines: [], error: "Enter a star count for every player" };
  }

  const maxStars = Math.max(...entries.map((e) => e.stars));
  const top = entries.filter((e) => e.stars === maxStars);
  let winner: MpRawEntry | undefined;
  if (winnerId) winner = entries.find((e) => e.playerId === winnerId);
  if (!winner) {
    if (top.length === 1) winner = top[0];
    else return { lines: [], error: "Two players are tied on stars. Tap who won." };
  }
  if (!winner) return { lines: [], error: "Couldn't determine a winner" };
  if (winner.stars !== maxStars) {
    return { lines: [], error: "The winner must have the most stars" };
  }

  const rest = entries
    .filter((e) => e.playerId !== winner!.playerId)
    .sort((a, b) => b.stars - a.stars);
  const ordered: MpRawEntry[] = [winner, ...rest];
  const lines: MpLine[] = ordered.map((e, i) => ({
    playerId: e.playerId,
    character: e.character,
    stars: e.stars,
    bonusStars: e.bonusStars,
    placement: i + 1,
    isWinner: i === 0,
  }));
  return { lines, error: null };
}

// ---------- derived night summary ----------
export interface MpPlayerStat {
  playerId: string;
  name: string;
  games: number;
  wins: number;
  totalStars: number;
  mainCharacter: string | null;
}
export function summarizeMpNight(state: MpSessionState): {
  players: MpPlayerStat[];
  boards: { map: string; games: number }[];
} {
  const players = new Map<
    string,
    MpPlayerStat & { charCounts: Map<string, number> }
  >();
  const nameOf = new Map(state.roster.map((p) => [p.id, p.name]));
  const boards = new Map<string, number>();

  for (const g of state.games) {
    boards.set(g.map, (boards.get(g.map) ?? 0) + 1);
    for (const l of g.lines) {
      const p =
        players.get(l.playerId) ??
        {
          playerId: l.playerId,
          name: nameOf.get(l.playerId) ?? "?",
          games: 0,
          wins: 0,
          totalStars: 0,
          mainCharacter: null,
          charCounts: new Map<string, number>(),
        };
      p.games++;
      if (l.isWinner) p.wins++;
      p.totalStars += l.stars;
      if (l.character) p.charCounts.set(l.character, (p.charCounts.get(l.character) ?? 0) + 1);
      players.set(l.playerId, p);
    }
  }

  const playerList: MpPlayerStat[] = [...players.values()].map((p) => {
    let main: string | null = null;
    let max = 0;
    for (const [c, n] of p.charCounts) if (n > max) ((max = n), (main = c));
    return {
      playerId: p.playerId,
      name: p.name,
      games: p.games,
      wins: p.wins,
      totalStars: p.totalStars,
      mainCharacter: main,
    };
  });

  return {
    players: playerList.sort((a, b) => b.wins - a.wins || b.totalStars - a.totalStars),
    boards: [...boards.entries()]
      .map(([map, games]) => ({ map, games }))
      .sort((a, b) => b.games - a.games),
  };
}

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
    // Jamboree calls them "Bonus" rather than "Star". Full set (the "On"
    // setting); the Classic setting is just the first three.
    bonusStars: [
      "Minigame Bonus", "Rich Bonus", "Eventful Bonus", "Item Bonus", "Shopping Bonus",
      "Sightseer Bonus", "Slowpoke Bonus", "Misfortune Bonus", "Bowser Space Bonus",
    ],
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
    bonusStars: [
      "Minigame Star", "Rich Star", "Eventful Star", "Item Star", "Shopping Star",
      "Sightseer Star", "Slowpoke Star", "Unlucky Star", "Bowser Space Star",
    ],
  },
  {
    id: "smp",
    name: "Super Mario Party (2018)",
    roster: [
      "Mario", "Luigi", "Peach", "Daisy", "Wario", "Waluigi", "Yoshi", "Rosalina", "Donkey Kong",
      "Diddy Kong", "Goomba", "Shy Guy", "Koopa Troopa", "Monty Mole", "Bowser", "Bowser Jr.",
      "Boo", "Hammer Bro", "Dry Bones", "Pom Pom",
    ],
    boards: [
      "Whomp's Domino Ruins", "King Bob-omb's Powderkeg Mine", "Megafruit Paradise",
      "Kamek's Tantalizing Tower",
    ],
    // Stompy/Doormat are Partner Party only, but they are real awards in
    // this game, so they're listed.
    bonusStars: [
      "Minigame Star", "Rich Star", "Eventful Star", "Item Star", "Sightseer Star",
      "Slowpoke Star", "Unlucky Star", "Ally Star", "Buddy Star", "Stompy Star", "Doormat Star",
    ],
  },
  {
    id: "mp6",
    name: "Mario Party 6",
    // Eleven playable: the ten from Mario Party 5 plus Toadette. Toad is
    // not playable in this one.
    roster: [
      "Mario", "Luigi", "Peach", "Daisy", "Yoshi", "Wario", "Waluigi", "Donkey Kong", "Boo",
      "Koopa Kid", "Toadette",
    ],
    boards: [
      "Towering Treetop", "E. Gadd's Garage", "Faire Square", "Snowflake Lake", "Castaway Bay",
      "Clockwork Castle",
    ],
    bonusStars: ["Minigame Star", "Orb Star", "Event Star"],
  },
  {
    id: "mp2",
    name: "Mario Party 2",
    roster: ["Mario", "Luigi", "Peach", "Yoshi", "Wario", "Donkey Kong"],
    boards: [
      "Pirate Land", "Western Land", "Space Land", "Mystery Land", "Horror Land", "Bowser Land",
    ],
    bonusStars: ["Minigame Star", "Coin Star", "Happening Star"],
  },
];

// ---------- bonus star families ----------
// The same award is renamed across titles (Coin Star -> Rich Star -> Rich
// Bonus; Happening -> Event -> Eventful). Each title's own name is what
// players see while recording, but lifetime stats aggregate by FAMILY so
// "who always wins the minigame star" holds across every Mario Party the
// crew plays. Same principle as characters: one identity, many spellings.
export const MP_BONUS_FAMILIES: Record<string, string> = {
  "Minigame Star": "Minigame",
  "Minigame Bonus": "Minigame",
  "Coin Star": "Coins",
  "Rich Star": "Coins",
  "Rich Bonus": "Coins",
  "Happening Star": "Happening",
  "Event Star": "Happening",
  "Eventful Star": "Happening",
  "Eventful Bonus": "Happening",
  "Orb Star": "Items",
  "Item Star": "Items",
  "Item Bonus": "Items",
  "Shopping Star": "Shopping",
  "Shopping Bonus": "Shopping",
  "Sightseer Star": "Walked farthest",
  "Sightseer Bonus": "Walked farthest",
  "Slowpoke Star": "Walked least",
  "Slowpoke Bonus": "Walked least",
  "Unlucky Star": "Bad luck spaces",
  "Misfortune Bonus": "Bad luck spaces",
  "Bowser Space Star": "Bowser spaces",
  "Bowser Space Bonus": "Bowser spaces",
  "Ally Star": "Allies",
  "Buddy Star": "Buddy",
  "Stompy Star": "Stomps",
  "Doormat Star": "Stomped on",
};

/** The cross-title family for a bonus star name (falls back to the name). */
export function bonusFamilyOf(name: string): string {
  return MP_BONUS_FAMILIES[name] ?? name;
}

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

  // A bonus star is awarded to exactly one player per game, so the same
  // one can't sit on two players in a single board.
  const claimed = new Map<string, string>();
  for (const e of entries) {
    for (const star of e.bonusStars) {
      if (claimed.has(star)) {
        return { lines: [], error: `Only one player can get the ${star}` };
      }
      claimed.set(star, e.playerId);
    }
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
  // Competition ranking (1, 2, 2, 4): non-winners tied on stars share a
  // placement instead of getting an arbitrary order. The real tiebreak is
  // coins, which we deliberately don't track, so we don't invent one. The
  // winner always holds 1 (a non-winner tied with them lost the coin
  // tiebreak in-game, so 2 is right).
  const placements: number[] = ordered.map((_, i) => i + 1);
  for (let i = 2; i < ordered.length; i++) {
    if (ordered[i]!.stars === ordered[i - 1]!.stars) placements[i] = placements[i - 1]!;
  }
  const lines: MpLine[] = ordered.map((e, i) => ({
    playerId: e.playerId,
    character: e.character,
    stars: e.stars,
    bonusStars: e.bonusStars,
    placement: placements[i] ?? i + 1,
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

// Mario Party pack: shared types, per-title data, and pure logic.
// Dependency-free. Reuses the roster/player/title machinery from the Smash
// module (SmashPlayer, GameTitle, rosterForTitle) but a Mario Party game is
// richer than an FFA game: each game is one BOARD, each player has a TOTAL
// STAR count, and optionally the BONUS STARS they won. The winner is the
// most stars (a top tie is broken by the host, since we don't track coins).
//
// The "Which game?" title selector (standing rule) scopes three things
// here: the character roster, the board list, and the bonus-star options.
//
// TAG BATTLE (2026-08-30) adds a second shape. In Mario Party 7's Tag Battle a
// team SHARES its Orbs, Stars and coins, so a tag board has ONE star total per
// SIDE rather than one per player. That collides with this pack's whole model,
// which is a typed star count PER PLAYER. The resolution, locked and written up
// in BACKLOG's decision log: the shared value is written to EVERY member of the
// side, and the READ layer splits solo from tag off `side`. It is the Double
// Dash precedent (foldMkStatRows) applied to stars and bonus stars alike, so
// there is one rule rather than two. THE CONSEQUENCE TO REMEMBER: an unsplit
// read of the star column now overstates a pair's night, so any NEW reader of
// Mario Party stars has to ask about `side` first.

import type { GameTitle, SmashPlayer, SmashAssignment } from "./smash.js";
export type { SmashPlayer } from "./smash.js";
import {
  placementsFromRankedSides,
  singletonSides,
  validateSides,
  type RankedSide,
  type Side,
} from "./teams.js";
import { newSideLog, type SideLog } from "./sidelog.js";

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
    id: "mp7",
    name: "Mario Party 7",
    // Twelve playable, and note what is NOT here: no Donkey Kong (he runs
    // the DK Space in this one) and no Koopa Kid, who was playable in 6.
    roster: [
      "Mario", "Luigi", "Peach", "Daisy", "Yoshi", "Wario", "Waluigi", "Toad", "Toadette",
      "Boo", "Birdo", "Dry Bones",
    ],
    // Five starters plus Bowser's Enchanted Inferno, which is unlocked.
    boards: [
      "Grand Canal", "Pagoda Peak", "Pyramid Park", "Neon Heights", "Windmillville",
      "Bowser's Enchanted Inferno",
    ],
    // SIX EXIST AND THE GAME AWARDS THREE, PICKED AT RANDOM PER BOARD. All
    // six are offered because the host records what actually happened, and
    // which three the game rolled is part of that. Do NOT add a "pick only
    // three" rule here: it would refuse a truthful record of a real night.
    bonusStars: [
      "Minigame Star", "Action Star", "Orb Star", "Shopping Star", "Red Star",
      "Running Star",
    ],
  },
  {
    id: "mp6",
    name: "Mario Party 6",
    // Eleven playable: the ten from Mario Party 5 plus Toadette. Donkey Kong
    // is NOT playable in this one; he runs the DK Space.
    roster: [
      "Mario", "Luigi", "Peach", "Daisy", "Yoshi", "Wario", "Waluigi", "Toad", "Boo",
      "Koopa Kid", "Toadette",
    ],
    boards: [
      "Towering Treetop", "E. Gadd's Garage", "Faire Square", "Snowflake Lake", "Castaway Bay",
      "Clockwork Castle",
    ],
    bonusStars: ["Minigame Star", "Orb Star", "Happening Star"],
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
  "Action Star": "Happening",
  // RETAINED FOR ROWS ALREADY WRITTEN. No title offers "Event Star" any more:
  // MP6 was corrected to "Happening Star" on 2026-08-30, because Event Star is
  // a Superstars-era name that appears on no MP6 source. DO NOT DELETE THIS
  // ENTRY as dead code. Bonus star names go into match_participants.meta
  // VERBATIM, so any MP6 board recorded before that correction still says
  // "Event Star" in the ledger; without this line those rows would stop folding
  // onto Happening and start tallying under their own name. This map is
  // read-side and additive, the title's offered list is write-side.
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
  "Running Star": "Walked farthest",
  "Slowpoke Star": "Walked least",
  "Slowpoke Bonus": "Walked least",
  "Unlucky Star": "Bad luck spaces",
  "Red Star": "Bad luck spaces",
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
  /**
   * The side this player was on, or null when the board had NO team structure.
   *
   * Absent entirely on a line recorded before Tag Battle shipped, which is why
   * every read of it coalesces. rankMpLines writes null, always: it is the
   * per-player path and a board recorded through it has no sides by definition.
   */
  side?: string | null;
}
export interface MpGame {
  idx: number; // 0-based order in the night; also the dedup key suffix
  map: string;
  lines: MpLine[];
  at: string; // ISO
}
export interface MpSessionState {
  // Unique per session start. The ledger keys each materialized game
  // mp:{eventId}:{sessionKey}:{idx}; without it a second session on the same
  // event resets idx to 0,1,2... and collides with the first session's keys,
  // so the dedup check silently drops every new game.
  sessionKey: string;
  titleId: string | null;
  assignment: SmashAssignment;
  openScoring: boolean;
  roster: SmashPlayer[];
  games: MpGame[];
  /**
   * Which arrangement of sides the night has been played under, and when it
   * changed. A LOG rather than a field so a reshuffle does not retroactively
   * apply to boards already recorded; see the header of sidelog.ts. The unit
   * count for this pack is `games.length`.
   *
   * Seeded with singleton sides, which `sideIdFor` reads as NO team structure,
   * so an ordinary Battle Royale night writes exactly the rows it wrote before
   * this existed.
   */
  sideLog: SideLog;
}

export function newMpState(opts: {
  titleId?: string | null;
  assignment: SmashAssignment;
  roster: SmashPlayer[];
  /** Tag Battle's opening arrangement. Omitted means singletons, i.e. no teams. */
  sides?: Side[];
}): MpSessionState {
  return {
    sessionKey: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    titleId: opts.titleId ?? null,
    assignment: opts.assignment,
    openScoring: false,
    roster: opts.roster,
    games: [],
    sideLog: newSideLog(opts.sides ?? singletonSides(opts.roster.map((p) => p.id))),
  };
}

/**
 * Upgrade a session persisted before Tag Battle shipped.
 *
 * Rows in `game_sessions` were written with no `sideLog` at all. A night that
 * is live when this deploys has to keep working, and a finished one has to stay
 * readable by the guest backfill, so the upgrade happens at the ONE point where
 * jsonb becomes state (PackRuntimeConfig.normalize) and nowhere else. Doing it
 * at the pack's own call sites would mean getting all of them, and this pack
 * reads state in a dozen places plus the backfill.
 *
 * THE UPGRADE IS EXACT RATHER THAN APPROXIMATE. Every board ever recorded by
 * this pack was played by individuals, so the roster becomes one side per
 * player, which `sideIdFor` then treats as no team structure, which is what it
 * always was. Follows normalizeMkState, which does the same job for Mario Kart.
 */
export function normalizeMpState(state: MpSessionState): MpSessionState {
  const raw = state as unknown as Record<string, unknown>;
  if (Array.isArray(raw.sideLog) && raw.sideLog.length > 0) return state;
  return { ...state, sideLog: newSideLog(singletonSides((state.roster ?? []).map((p) => p.id))) };
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
    // Always null on this path: it is the per-player one, and a board recorded
    // through it has no sides by definition. Written rather than left absent so
    // rankMpSides on an all-singletons field is byte-identical to it.
    side: null,
  }));
  return { lines, error: null };
}

// ---------- tag battle: ranking by SIDE ----------
// A SIBLING OF rankMpLines, NOT A MODE FLAG ON IT. The two take genuinely
// different input shapes (a star total per player against a star total per
// side) and threading a boolean through the one function would make every
// refusal above read "unless teams, in which case". Both stay exported.

/** One side's board result: the total the SIDE finished on, and its bonus stars. */
export interface MpSideEntry {
  sideId: string;
  stars: number;
  bonusStars: string[];
}

export function rankMpSides(
  sides: readonly Side[],
  entries: readonly MpSideEntry[],
  winnerSideId: string | null | undefined,
  /** Characters stay PER PLAYER: each player picks their own in Tag Battle. */
  characters: Readonly<Record<string, string | null>> = {},
): { lines: MpLine[]; error: string | null } {
  // The arrangement's own validation, rather than a second opinion about what
  // an acceptable arrangement is. Covers fewer than two sides, an empty side,
  // duplicate ids and a player on two sides at once.
  const check = validateSides(sides);
  if (check.error) return { lines: [], error: check.error };

  const byId = new Map(entries.map((e) => [e.sideId, e]));
  const ordered: { side: Side; entry: MpSideEntry }[] = [];
  for (const side of sides) {
    const entry = byId.get(side.id);
    if (!entry) return { lines: [], error: "Enter a star count for every side" };
    ordered.push({ side, entry });
  }
  if (ordered.some((o) => !Number.isFinite(o.entry.stars) || o.entry.stars < 0)) {
    return { lines: [], error: "Enter a star count for every side" };
  }

  // The per-player rule, one level up: a bonus star is awarded once per board,
  // so it cannot sit on two SIDES. Within a side it is shared, which is the
  // whole point of Tag Battle.
  const claimed = new Set<string>();
  for (const { entry } of ordered) {
    for (const star of entry.bonusStars) {
      if (claimed.has(star)) return { lines: [], error: `Only one side can get the ${star}` };
      claimed.add(star);
    }
  }

  const maxStars = Math.max(...ordered.map((o) => o.entry.stars));
  const top = ordered.filter((o) => o.entry.stars === maxStars);
  let winner = winnerSideId ? ordered.find((o) => o.side.id === winnerSideId) : undefined;
  if (!winner) {
    if (top.length === 1) winner = top[0];
    else return { lines: [], error: "Two sides are tied on stars. Tap who won." };
  }
  if (!winner) return { lines: [], error: "Couldn't determine a winning side" };
  if (winner.entry.stars !== maxStars) {
    return { lines: [], error: "The winning side must have the most stars" };
  }

  const rest = ordered
    .filter((o) => o.side.id !== winner!.side.id)
    .sort((a, b) => b.entry.stars - a.entry.stars);
  const finish = [winner, ...rest];

  // Competition ranking over SIDES, and the winner's exception is the same one
  // rankMpLines carries: the loop starts at index 2, so a side LEVEL with the
  // winner takes 2 rather than sharing 1. It lost the coin tiebreak in-game.
  // Ties below the winner do share, which is why this goes through
  // placementsFromRankedSides rather than writing the side placement rule a
  // second time. A 2v2 is 1,1,2,2 and never 1,1,3,3; see teams.ts.
  const ranked: RankedSide[] = finish.map((o, i) => ({
    side: o.side,
    tiedWithAbove: i >= 2 && o.entry.stars === finish[i - 1]!.entry.stars,
  }));
  // Keyed by PLAYER rather than by side id, because a line from an
  // all-singletons field carries side: null by design and could not look its
  // own numbers back up. The side still supplies them; it just is not recorded.
  const entryOfPlayer = new Map<string, MpSideEntry>();
  for (const o of finish) for (const id of o.side.memberIds) entryOfPlayer.set(id, o.entry);

  const lines: MpLine[] = placementsFromRankedSides(ranked).map((l) => {
    const entry = entryOfPlayer.get(l.playerId)!;
    return {
      playerId: l.playerId,
      character: characters[l.playerId] ?? null,
      // THE SHARED VALUE GOES ON EVERY MEMBER. Not on one row (arbitrary, and
      // it breaks every per-player read) and not halved (that invents a number
      // an odd total cannot produce). The read layer splits it off `side`.
      stars: entry.stars,
      bonusStars: [...entry.bonusStars],
      placement: l.placement,
      isWinner: l.isWinner,
      side: l.side,
    };
  });
  return { lines, error: null };
}

// ---------- derived night summary ----------
export interface MpPlayerStat {
  playerId: string;
  name: string;
  /** Every board, solo and tag alike. A player played it either way. */
  games: number;
  /**
   * Every board won, solo and tag alike. WINS ARE NOT SPLIT AND DO NOT NEED TO
   * BE: both members of a winning side genuinely won that board, which is not
   * the same as both of them having earned the side's stars twice over.
   */
  wins: number;
  /**
   * Stars from SOLO boards only, i.e. lines with no side on them.
   *
   * NOT THE UNSPLIT TOTAL, and the name is kept for the screens that already
   * read it. A tag board's star total belongs to the SIDE and is written to
   * every member, so summing it in here would credit a pair twice for one
   * total and put them ahead of a solo player two to one.
   */
  totalStars: number;
  /** Stars from TAG boards, where the number is the SIDE's, shared. */
  tagStars: number;
  /** How many of `games` were tag boards. Solo boards are games - tagGames. */
  tagGames: number;
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
          tagStars: 0,
          tagGames: 0,
          mainCharacter: null,
          charCounts: new Map<string, number>(),
        };
      p.games++;
      if (l.isWinner) p.wins++;
      // THE SPLIT, and the reason this is not one line. `l.side` is absent on
      // every board recorded before Tag Battle shipped, so the coalesce is
      // load-bearing rather than defensive.
      if (l.side ?? null) {
        p.tagGames++;
        p.tagStars += l.stars;
      } else {
        p.totalStars += l.stars;
      }
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
      tagStars: p.tagStars,
      tagGames: p.tagGames,
      mainCharacter: main,
    };
  });

  return {
    // Ordered on the COMBINED haul after wins, deliberately. Sorting on the
    // solo figure alone would leave a tag-only night in roster order with every
    // tiebreak reading zero. This is a display order rather than a claim that a
    // solo star and a shared one are the same thing, which is exactly why the
    // two are still reported apart.
    players: playerList.sort(
      (a, b) => b.wins - a.wins || b.totalStars + b.tagStars - (a.totalStars + a.tagStars),
    ),
    boards: [...boards.entries()]
      .map(([map, games]) => ({ map, games }))
      .sort((a, b) => b.games - a.games),
  };
}

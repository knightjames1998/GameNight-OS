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

// ---------- Session shapes ----------

export type SmashMode = "ffa" | "koth";
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
}
export interface SmashGame {
  idx: number; // 0-based order within the night; also the dedup key suffix
  mode: SmashMode;
  lines: SmashResultLine[];
  at: string; // ISO
}

// King of the Hill running state. The reigning player stays; the loser goes
// to the back of the queue. streak is the current king's win count.
export interface KothState {
  kingId: string | null;
  queue: string[]; // playerIds waiting, front plays next
  streak: number;
  bestStreak: { playerId: string; streak: number } | null;
}

export interface SmashSessionState {
  mode: SmashMode;
  assignment: SmashAssignment;
  resultDetail: SmashResultDetail;
  // When false, only owners/admins record results (standing rule 1). The
  // host may flip it on to let members score. Defaults off.
  openScoring: boolean;
  roster: SmashPlayer[];
  games: SmashGame[];
  koth: KothState | null;
}

export function newSmashState(opts: {
  mode: SmashMode;
  assignment: SmashAssignment;
  resultDetail: SmashResultDetail;
  roster: SmashPlayer[];
}): SmashSessionState {
  return {
    mode: opts.mode,
    assignment: opts.assignment,
    resultDetail: opts.resultDetail,
    openScoring: false,
    roster: opts.roster,
    games: [],
    koth:
      opts.mode === "koth"
        ? {
            kingId: opts.roster[0]?.id ?? null,
            queue: opts.roster.slice(1).map((p) => p.id),
            streak: 0,
            bestStreak: null,
          }
        : null,
  };
}

// ---------- Pure helpers ----------

/** Random fighter, optionally excluding some (so a match has no dupes). */
export function randomFighter(exclude: Iterable<string> = []): string {
  const taken = new Set(exclude);
  const pool = SMASH_FIGHTERS.filter((f) => !taken.has(f));
  const from = pool.length ? pool : SMASH_FIGHTERS;
  return from[Math.floor(Math.random() * from.length)]!;
}

/** Assign a unique-where-possible random fighter to every roster slot. */
export function assignRandomFighters(roster: SmashPlayer[]): SmashPlayer[] {
  const used = new Set<string>();
  return roster.map((p) => {
    const c = randomFighter(used);
    used.add(c);
    return { ...p, character: c };
  });
}

/**
 * Fold a KOTH result into the state: winner keeps the throne, loser rotates
 * to the back, next challenger comes off the front of the queue. Pure:
 * returns the next KothState, doesn't mutate.
 */
export function kothAdvance(koth: KothState, winnerId: string, loserId: string): KothState {
  const nextStreak = koth.kingId === winnerId ? koth.streak + 1 : 1;
  const best =
    !koth.bestStreak || nextStreak > koth.bestStreak.streak
      ? { playerId: winnerId, streak: nextStreak }
      : koth.bestStreak;
  // Loser to the back; the next challenger is whoever is now at the front.
  const queue = [...koth.queue.filter((id) => id !== winnerId && id !== loserId), loserId];
  return { kingId: winnerId, queue, streak: nextStreak, bestStreak: best };
}

/** The two playerIds due to play the next KOTH round, or null if not ready. */
export function kothNextPair(koth: KothState): [string, string] | null {
  if (!koth.kingId || koth.queue.length === 0) return null;
  return [koth.kingId, koth.queue[0]!];
}

/**
 * Validate a set of placements for an FFA game. Returns an error string or
 * null. In winner-only detail exactly one line is the winner; in placement
 * detail placements must be a permutation of 1..N.
 */
export function validateFfa(
  lines: SmashResultLine[],
  detail: SmashResultDetail,
): string | null {
  if (lines.length < 2) return "Need at least 2 players in a game";
  if (lines.length > 8) return "FFA is capped at 8 players";
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
}

export function summarizeNight(state: SmashSessionState): {
  characters: CharacterStat[];
  players: PlayerStat[];
} {
  const chars = new Map<string, CharacterStat>();
  const players = new Map<string, PlayerStat & { charCounts: Map<string, number> }>();
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
          charCounts: new Map<string, number>(),
        };
      p.played++;
      if (l.isWinner) p.wins++;
      if (l.character) p.charCounts.set(l.character, (p.charCounts.get(l.character) ?? 0) + 1);
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
    };
  });

  return {
    characters: [...chars.values()].sort((a, b) => b.wins - a.wins || b.played - a.played),
    players: playerList.sort((a, b) => b.wins - a.wins || b.played - a.played),
  };
}

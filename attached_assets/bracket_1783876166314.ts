// The bracket engine, generalized from Beerio Kart Bracket.
//
// The pattern (proven in the seed app): a bracket is a declarative graph.
// Each match has two slots, and each slot names its source: a seed number,
// or the winner of an earlier match. Results are a sparse map of
// { matchId: "A" | "B" }. Everything else (byes auto-advancing, TBD
// propagation, the champion) is DERIVED by compute() on every read.
// Nothing stored can drift out of sync, and undo is deleting a key.
//
// Single elimination only for now. The SlotSource vocabulary is the hook
// for future formats (double elim adds { t: "lose" } sources, exactly as
// Beerio Kart does).
//
// Pure module: no imports, safe for server and web alike.

export type SlotSource = { t: "seed"; n: number } | { t: "win"; m: string };

export interface MatchDef {
  id: string;
  round: number; // 1 = first round
  index: number; // position within the round, 0-based
  a: SlotSource;
  b: SlotSource;
}

export interface BracketStructure {
  defs: MatchDef[];
  rounds: number;
  size: number; // entrant count padded to a power of two
}

export type BracketResults = Record<string, "A" | "B">;

/** A resolved slot: an entrant (by seed), a bye, or not yet known. */
export type Slot =
  | { kind: "player"; seed: number }
  | { kind: "bye" }
  | { kind: "tbd" };

export interface ComputedMatch {
  def: MatchDef;
  a: Slot;
  b: Slot;
  winner: Slot;
  decided: boolean;
  /** Decided automatically (a bye walkover), not by a recorded result. */
  auto: boolean;
  /** Both slots hold real players and no result yet: tappable. */
  playable: boolean;
}

export interface ComputedBracket {
  matches: Record<string, ComputedMatch>;
  /** Round-major ordering for rendering. */
  roundIds: string[][];
  championSeed: number | null;
}

const nextPow2 = (n: number) => Math.pow(2, Math.ceil(Math.log2(Math.max(2, n))));

/**
 * Standard tournament seed ordering (1 vs S, 2 vs S-1, folded), straight
 * from the seed app. Ensures top seeds meet as late as possible and byes
 * (seeds beyond the real entrant count) land on the top seeds first.
 */
export function seedOrder(size: number): number[] {
  let pls = [1, 2];
  const rounds = Math.log2(size);
  for (let r = 0; r < rounds - 1; r++) {
    const len = pls.length * 2 + 1;
    const out: number[] = [];
    for (const d of pls) {
      out.push(d);
      out.push(len - d);
    }
    pls = out;
  }
  return pls;
}

/** Build the single-elim structure for n entrants. */
export function buildSingleElim(n: number): BracketStructure {
  const size = nextPow2(n);
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const defs: MatchDef[] = [];

  let prev: string[] = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / Math.pow(2, r);
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `R${r}M${i}`;
      const a: SlotSource =
        r === 1 ? { t: "seed", n: order[2 * i]! } : { t: "win", m: prev[2 * i]! };
      const b: SlotSource =
        r === 1 ? { t: "seed", n: order[2 * i + 1]! } : { t: "win", m: prev[2 * i + 1]! };
      defs.push({ id, round: r, index: i, a, b });
      ids.push(id);
    }
    prev = ids;
  }

  return { defs, rounds, size };
}

/**
 * Derive the full bracket state. entrantCount is the number of REAL
 * entrants; seeds above it are byes.
 */
export function computeBracket(
  entrantCount: number,
  structure: BracketStructure,
  results: BracketResults,
): ComputedBracket {
  const matches: Record<string, ComputedMatch> = {};

  const resolve = (src: SlotSource): Slot => {
    if (src.t === "seed") {
      return src.n <= entrantCount ? { kind: "player", seed: src.n } : { kind: "bye" };
    }
    const m = matches[src.m];
    if (!m || !m.decided) return { kind: "tbd" };
    return m.winner;
  };

  for (const def of structure.defs) {
    const a = resolve(def.a);
    const b = resolve(def.b);
    let winner: Slot = { kind: "tbd" };
    let decided = false;
    let auto = false;

    if (a.kind === "bye" && b.kind === "player") {
      winner = b;
      decided = true;
      auto = true;
    } else if (b.kind === "bye" && a.kind === "player") {
      winner = a;
      decided = true;
      auto = true;
    } else if (a.kind === "bye" && b.kind === "bye") {
      // Phantom match between two byes; a bye "wins" so later rounds
      // keep auto-advancing. Only occurs when size >= 2n.
      winner = { kind: "bye" };
      decided = true;
      auto = true;
    } else if (a.kind === "player" && b.kind === "player") {
      const r = results[def.id];
      if (r === "A") {
        winner = a;
        decided = true;
      } else if (r === "B") {
        winner = b;
        decided = true;
      }
    }

    matches[def.id] = {
      def,
      a,
      b,
      winner,
      decided,
      auto,
      playable: a.kind === "player" && b.kind === "player" && !decided,
    };
  }

  const roundIds: string[][] = [];
  for (let r = 1; r <= structure.rounds; r++) {
    roundIds.push(
      structure.defs.filter((d) => d.round === r).map((d) => d.id),
    );
  }

  const finalId = roundIds[roundIds.length - 1]?.[0];
  const final = finalId ? matches[finalId] : undefined;
  const championSeed =
    final && final.decided && final.winner.kind === "player" ? final.winner.seed : null;

  return { matches, roundIds, championSeed };
}

/**
 * Matches whose outcome depends (transitively) on the given match.
 * Used to cascade-clear results when undoing: if the undone match's
 * winner fed later matches, those recorded results no longer describe
 * the same two people and must be cleared too.
 */
export function downstreamOf(structure: BracketStructure, matchId: string): string[] {
  const dependents = new Map<string, string[]>();
  for (const def of structure.defs) {
    for (const src of [def.a, def.b]) {
      if (src.t === "win") {
        const list = dependents.get(src.m) ?? [];
        list.push(def.id);
        dependents.set(src.m, list);
      }
    }
  }
  const out: string[] = [];
  const queue = [...(dependents.get(matchId) ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (out.includes(id)) continue;
    out.push(id);
    queue.push(...(dependents.get(id) ?? []));
  }
  return out;
}

/** Human round names, counted from the final backwards. */
export function roundTitle(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
}

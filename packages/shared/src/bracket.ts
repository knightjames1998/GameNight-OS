// The bracket engine, generalized from Beerio Kart Bracket.
//
// The pattern (proven in the seed app): a bracket is a declarative graph.
// Each match has two slots, and each slot names its source: a seed number,
// the winner of an earlier match, or (double elim) the LOSER of an earlier
// match. Results are a sparse map of { matchId: "A" | "B" }. Everything
// else (byes auto-advancing, TBD propagation, losers dropping down, the
// grand-final reset, the champion) is DERIVED by compute() on every read.
// Nothing stored can drift out of sync, and undo is deleting a key — the
// cascade (downstreamOf) clears every match whose participants depended on
// the undone result, across both brackets.
//
// Match ids are stable per (format, entrant count): single elim keeps the
// original R{r}M{i} ids so existing stored results still resolve; double
// elim uses W{r}M{i} / L{r}M{i} / GF / GF2, same as Beerio Kart.
//
// Pure module: no imports, safe for server and web alike.

export type SlotSource =
  | { t: "seed"; n: number }
  | { t: "win"; m: string }
  | { t: "lose"; m: string };

export type BracketSide = "W" | "L" | "GF";

export interface MatchDef {
  id: string;
  round: number; // 1 = first round WITHIN its side
  index: number; // position within the round, 0-based
  side: BracketSide;
  a: SlotSource;
  b: SlotSource;
  /**
   * GF2 only: the id of the first grand final. The reset match is only
   * active (and only playable) when that match went to slot B — the
   * losers-bracket champion handing the winners-bracket champion their
   * first loss forces the rematch.
   */
  resetOf?: string;
}

/** A render group: one column of matches with a human title. */
export interface BracketGroup {
  title: string;
  side: BracketSide;
  ids: string[];
}

export interface BracketStructure {
  kind: "single" | "double";
  defs: MatchDef[];
  groups: BracketGroup[];
  rounds: number; // winners-side round count
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
  loser: Slot;
  decided: boolean;
  /** Decided automatically (a bye walkover), not by a recorded result. */
  auto: boolean;
  /** Both slots hold real players and no result yet: tappable. */
  playable: boolean;
  /**
   * False only for a grand-final reset that isn't (or isn't yet) needed.
   * Inactive matches resolve nothing and should be hidden.
   */
  active: boolean;
}

export interface ComputedBracket {
  matches: Record<string, ComputedMatch>;
  /** Group-major ordering for rendering (mirrors structure.groups). */
  roundIds: string[][];
  championSeed: number | null;
}

const TBD: Slot = { kind: "tbd" };
const BYE: Slot = { kind: "bye" };

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

/** Human round names, counted from the final backwards (single elim). */
export function roundTitle(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
}

function winnersTitle(round: number, totalRounds: number): string {
  if (totalRounds === 1) return "Final";
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "Winners Final";
  if (fromEnd === 1) return "Winners Semis";
  return `Winners R${round}`;
}

function losersTitle(round: number, lastRound: number): string {
  if (round === lastRound) return "Losers Final";
  if (round === lastRound - 1) return "Losers Semis";
  return `Losers R${round}`;
}

/** Build the structure for a stored format string. */
export function buildStructure(
  format: string,
  entrantCount: number,
): BracketStructure {
  return format === "double_elim"
    ? buildDoubleElim(entrantCount)
    : buildSingleElim(entrantCount);
}

/** Build the single-elim structure for n entrants. */
export function buildSingleElim(n: number): BracketStructure {
  const size = nextPow2(n);
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const defs: MatchDef[] = [];
  const groups: BracketGroup[] = [];

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
      defs.push({ id, round: r, index: i, side: "W", a, b });
      ids.push(id);
    }
    groups.push({ title: roundTitle(r, rounds), side: "W", ids });
    prev = ids;
  }

  return { kind: "single", defs, groups, rounds, size };
}

/**
 * Build the double-elim structure for n entrants: a winners bracket, a
 * losers bracket the winners' losers drop into, and a grand final with a
 * reset (GF2) if the losers-bracket champion takes the first grand final.
 *
 * Losers-bracket shape (the standard one, same as Beerio Kart):
 *   L1           = losers of W1, paired.
 *   L(2j)        = winners of the previous L round vs losers of W(j+1),
 *                  drop-ins reversed to delay rematches.
 *   L(2j+1)      = winners of L(2j), paired.
 *   Last L round = 2*(winnersRounds-1); its winner meets the winners-
 *                  bracket champion in the grand final.
 * With 2 entrants there is no losers bracket: the W final's loser goes
 * straight to the grand final (loser gets one more shot — true double elim).
 */
export function buildDoubleElim(n: number): BracketStructure {
  const size = nextPow2(n);
  const k = Math.log2(size);
  const order = seedOrder(size);
  const defs: MatchDef[] = [];
  const groups: BracketGroup[] = [];
  const wbRounds: string[][] = [];

  let prev: string[] = [];
  for (let r = 1; r <= k; r++) {
    const count = size / Math.pow(2, r);
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `W${r}M${i}`;
      const a: SlotSource =
        r === 1 ? { t: "seed", n: order[2 * i]! } : { t: "win", m: prev[2 * i]! };
      const b: SlotSource =
        r === 1 ? { t: "seed", n: order[2 * i + 1]! } : { t: "win", m: prev[2 * i + 1]! };
      defs.push({ id, round: r, index: i, side: "W", a, b });
      ids.push(id);
    }
    wbRounds.push(ids);
    groups.push({ title: winnersTitle(r, k), side: "W", ids });
    prev = ids;
  }

  let lbFinalId: string | null = null;
  if (k >= 2) {
    const lastLB = 2 * k - 2;
    let lr = 1;
    let prevL: string[] = [];
    {
      // L1: the first winners round's losers, paired off.
      const ids: string[] = [];
      const count = size / 4;
      for (let i = 0; i < count; i++) {
        const id = `L1M${i}`;
        defs.push({
          id,
          round: 1,
          index: i,
          side: "L",
          a: { t: "lose", m: wbRounds[0]![2 * i]! },
          b: { t: "lose", m: wbRounds[0]![2 * i + 1]! },
        });
        ids.push(id);
      }
      groups.push({ title: losersTitle(1, lastLB), side: "L", ids });
      prevL = ids;
      lr = 2;
    }
    for (let j = 1; j <= k - 1; j++) {
      // Drop-in round: survivors meet the losers of W(j+1). The drop-ins
      // are index-reversed so people who just played each other in the
      // winners bracket can't immediately rematch.
      const wbLosers = wbRounds[j]!;
      const count = prevL.length;
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const id = `L${lr}M${i}`;
        defs.push({
          id,
          round: lr,
          index: i,
          side: "L",
          a: { t: "win", m: prevL[i]! },
          b: { t: "lose", m: wbLosers[count - 1 - i]! },
        });
        ids.push(id);
      }
      groups.push({ title: losersTitle(lr, lastLB), side: "L", ids });
      prevL = ids;
      lr++;
      if (j < k - 1) {
        // Consolidation round: drop-in survivors, paired off.
        const count2 = prevL.length / 2;
        const ids2: string[] = [];
        for (let i = 0; i < count2; i++) {
          const id = `L${lr}M${i}`;
          defs.push({
            id,
            round: lr,
            index: i,
            side: "L",
            a: { t: "win", m: prevL[2 * i]! },
            b: { t: "win", m: prevL[2 * i + 1]! },
          });
          ids2.push(id);
        }
        groups.push({ title: losersTitle(lr, lastLB), side: "L", ids: ids2 });
        prevL = ids2;
        lr++;
      }
    }
    lbFinalId = prevL[0]!;
  }

  const wbFinalId = wbRounds[k - 1]![0]!;
  const gfB: SlotSource = lbFinalId
    ? { t: "win", m: lbFinalId }
    : { t: "lose", m: wbFinalId };
  defs.push({ id: "GF", round: 1, index: 0, side: "GF", a: { t: "win", m: wbFinalId }, b: gfB });
  defs.push({
    id: "GF2",
    round: 2,
    index: 0,
    side: "GF",
    a: { t: "win", m: wbFinalId },
    b: gfB,
    resetOf: "GF",
  });
  groups.push({ title: "Grand Final", side: "GF", ids: ["GF", "GF2"] });

  return { kind: "double", defs, groups, rounds: k, size };
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
      return src.n <= entrantCount ? { kind: "player", seed: src.n } : BYE;
    }
    const m = matches[src.m];
    if (!m || !m.decided || !m.active) return TBD;
    return src.t === "win" ? m.winner : m.loser;
  };

  for (const def of structure.defs) {
    // Grand-final reset: only exists once the first grand final went to
    // slot B (the losers-bracket champ). Until then it's inert scenery.
    if (def.resetOf) {
      const gf = matches[def.resetOf];
      const needed = !!gf && gf.decided && !gf.auto && results[def.resetOf] === "B";
      if (!needed) {
        matches[def.id] = {
          def,
          a: TBD,
          b: TBD,
          winner: TBD,
          loser: TBD,
          decided: false,
          auto: false,
          playable: false,
          active: false,
        };
        continue;
      }
    }

    const a = resolve(def.a);
    const b = resolve(def.b);
    let winner: Slot = TBD;
    let loser: Slot = TBD;
    let decided = false;
    let auto = false;

    if (a.kind === "bye" && b.kind === "player") {
      winner = b;
      loser = BYE;
      decided = true;
      auto = true;
    } else if (b.kind === "bye" && a.kind === "player") {
      winner = a;
      loser = BYE;
      decided = true;
      auto = true;
    } else if (a.kind === "bye" && b.kind === "bye") {
      // Phantom match between two byes; a bye "wins" (and "loses") so
      // later rounds in both brackets keep auto-advancing.
      winner = BYE;
      loser = BYE;
      decided = true;
      auto = true;
    } else if (a.kind === "player" && b.kind === "player") {
      const r = results[def.id];
      if (r === "A") {
        winner = a;
        loser = b;
        decided = true;
      } else if (r === "B") {
        winner = b;
        loser = a;
        decided = true;
      }
    }

    matches[def.id] = {
      def,
      a,
      b,
      winner,
      loser,
      decided,
      auto,
      playable: a.kind === "player" && b.kind === "player" && !decided,
      active: true,
    };
  }

  const roundIds = structure.groups.map((g) => g.ids);

  let championSeed: number | null = null;
  if (structure.kind === "double") {
    const gf = matches["GF"];
    const gf2 = matches["GF2"];
    if (gf && gf.decided) {
      if (results["GF"] === "A" || gf.auto) {
        // Winners-bracket champ held: done in one.
        championSeed = gf.winner.kind === "player" ? gf.winner.seed : null;
      } else if (gf2 && gf2.decided && gf2.winner.kind === "player") {
        // Reset happened; GF2 decides it.
        championSeed = gf2.winner.seed;
      }
    }
  } else {
    const finalId = roundIds[roundIds.length - 1]?.[0];
    const final = finalId ? matches[finalId] : undefined;
    championSeed =
      final && final.decided && final.winner.kind === "player" ? final.winner.seed : null;
  }

  return { matches, roundIds, championSeed };
}

/**
 * Matches whose outcome depends (transitively) on the given match.
 * Used to cascade-clear results when undoing: if the undone match's
 * winner OR loser fed later matches (losers feed the losers bracket in
 * double elim), those recorded results no longer describe the same two
 * people and must be cleared too. The grand-final reset depends on the
 * first grand final even though its slots don't reference it.
 */
export function downstreamOf(structure: BracketStructure, matchId: string): string[] {
  const dependents = new Map<string, string[]>();
  const addEdge = (from: string, to: string) => {
    const list = dependents.get(from) ?? [];
    list.push(to);
    dependents.set(from, list);
  };
  for (const def of structure.defs) {
    for (const src of [def.a, def.b]) {
      if (src.t === "win" || src.t === "lose") addEdge(src.m, def.id);
    }
    if (def.resetOf) addEdge(def.resetOf, def.id);
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

/**
 * Finishing places once a champion exists: champion 1, then everyone
 * ranked by how late they were ELIMINATED. In single elim every loss
 * eliminates; in double elim only losers-bracket losses and the loss in
 * whichever grand final actually decided it count (a winners-bracket loss
 * just drops you down). Returns an empty map while the bracket is live.
 */
export function placements(
  structure: BracketStructure,
  computed: ComputedBracket,
): Map<number, number> {
  const place = new Map<number, number>();
  const champion = computed.championSeed;
  if (champion == null) return place;
  place.set(champion, 1);

  const outs: { seed: number; stage: number }[] = [];
  for (const def of structure.defs) {
    const m = computed.matches[def.id];
    if (!m || !m.active || !m.decided || m.auto) continue;
    if (m.loser.kind !== "player" || m.winner.kind !== "player") continue;

    let terminal: boolean;
    let stage: number;
    if (structure.kind === "single") {
      terminal = true;
      stage = def.round;
    } else if (def.side === "L") {
      // Everyone in the losers bracket already has one loss; a loss here
      // is elimination.
      terminal = true;
      stage = def.round;
    } else if (def.side === "GF") {
      // GF: slot A is the winners-bracket champ. If A won, B is out (2nd).
      // If B won, that was A's FIRST loss: nobody is out, GF2 decides.
      // GF2's loser is always out (2nd).
      terminal = def.id !== "GF" || (m.a.kind === "player" && m.winner.seed === m.a.seed);
      stage = def.resetOf ? 1_000_001 : 1_000_000;
    } else {
      terminal = false; // winners-bracket losses drop down, never eliminate
      stage = 0;
    }
    if (terminal && m.loser.seed !== champion) {
      outs.push({ seed: m.loser.seed, stage });
    }
  }

  outs.sort((x, y) => y.stage - x.stage || x.seed - y.seed);
  let next = 2;
  for (const o of outs) {
    if (!place.has(o.seed)) place.set(o.seed, next++);
  }
  return place;
}

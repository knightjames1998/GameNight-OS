// The casino group's MODIFIER DECK. House rules a crew can turn on for a night.
//
// ---------------------------------------------------------------------------
// THE LINE, AND IT DOES NOT MOVE: the app DISPLAYS and RECORDS modifiers. It
// never computes their effect. The humans apply them at the table.
//
// This is the whole design rather than a limitation to be fixed later. The
// moment the app enforces a modifier's payout maths — "blackjack pays double"
// — it has to know what every hand paid, which means logging every hand, which
// means the minimal-input promise the entire casino group is built on is gone.
// A card that says "a natural pays twice the usual" costs one tap at setup and
// zero taps for the rest of the night; a card the app enforces costs a tap per
// hand forever. If a future session is tempted, the honest move is a new,
// explicitly high-input format, not a flag on this one.
//
// What the app DOES give back for that one tap: the rule is on the TV where
// everybody can read it without asking, and which cards were live is recorded
// against every player, so win rate per modifier falls out for free.
// ---------------------------------------------------------------------------
//
// `id` JOINS THE NEVER-CHANGE LIST alongside `ledger`, `gameName` and
// `keyPrefix` in packs.ts, for exactly the same reason: it is written into
// match_participants.meta, so renaming one does not error — it silently orphans
// every stat built on it and the card's history simply disappears. Names, rule
// text, kind, severity and appliesTo are all display or selection concerns and
// are safe to change whenever. Only the id is permanent, and the shipped ids
// are pinned in the tests.

/** A boon helps the table; a bane costs it something. Draws use the split. */
export type ModKind = "boon" | "bane";

/**
 * How much a card changes a night. 1 is a flavour rule, 3 is one that reshapes
 * how people play. Used to WEIGHT random draws so the nastiest cards stay rare,
 * and so Casino Run can escalate by reaching for higher severities as the
 * floors climb.
 */
export type ModSeverity = 1 | 2 | 3;

export interface Modifier {
  /** NEVER change once shipped: it is written into the ledger. */
  id: string;
  name: string;
  /** The actual rule, one line a person can read off a TV. */
  rule: string;
  kind: ModKind;
  severity: ModSeverity;
  /** "any", or the ledger keys of the packs this card makes sense at. */
  appliesTo: "any" | string[];
}

/**
 * The starting deck: two dozen cards, boons and banes across all three
 * severities, roughly half of them pack-agnostic. That last split is
 * deliberate — a crew that only ever plays blackjack still gets real variety,
 * because twelve "any" cards sit in their pool alongside the four blackjack
 * ones.
 */
export const MODIFIERS: Modifier[] = [
  // ---- any pack ----
  { id: "escalating_min", name: "Escalating minimum", rule: "The minimum bet rises every five hands.", kind: "bane", severity: 2, appliesTo: "any" },
  { id: "everyone_antes", name: "Everyone antes", rule: "Every player antes into the pot each round.", kind: "bane", severity: 1, appliesTo: "any" },
  { id: "loser_buys", name: "Loser buys", rule: "Whoever loses the hand buys the next round.", kind: "bane", severity: 1, appliesTo: "any" },
  { id: "dealers_choice", name: "Dealer's choice", rule: "Whoever deals picks the variant for that round.", kind: "boon", severity: 1, appliesTo: "any" },
  { id: "bust_penalty", name: "Bust penalty", rule: "Anyone who busts out pays the table a forfeit.", kind: "bane", severity: 3, appliesTo: "any" },
  { id: "leader_tax", name: "Leader tax", rule: "Anyone up on the night plays double the minimum.", kind: "bane", severity: 2, appliesTo: "any" },
  { id: "mercy_chip", name: "Mercy chip", rule: "The biggest loser gets one free rebuy.", kind: "boon", severity: 2, appliesTo: "any" },
  { id: "call_your_shot", name: "Call your shot", rule: "Call win or lose before the hand; correct calls pay a bonus.", kind: "boon", severity: 2, appliesTo: "any" },
  { id: "silence", name: "Silence", rule: "No table talk. Speaking costs an ante.", kind: "bane", severity: 2, appliesTo: "any" },
  { id: "phones_down", name: "Phones down", rule: "A phone on the table costs an ante.", kind: "bane", severity: 1, appliesTo: "any" },
  { id: "last_to_sit", name: "Last to sit", rule: "The last player to sit out a hand antes.", kind: "bane", severity: 1, appliesTo: "any" },
  { id: "high_roller", name: "High roller", rule: "One declared hand each pays double, win or lose.", kind: "boon", severity: 3, appliesTo: "any" },

  // ---- roulette ----
  { id: "hot_colour", name: "Hot colour", rule: "A chosen colour pays double all session.", kind: "boon", severity: 2, appliesTo: ["roulette"] },
  { id: "hot_number", name: "Hot number", rule: "A chosen number pays double all session.", kind: "boon", severity: 3, appliesTo: ["roulette"] },
  { id: "neighbours_only", name: "Neighbours only", rule: "Your bet must touch your previous number on the wheel.", kind: "bane", severity: 2, appliesTo: ["roulette"] },
  { id: "zero_pays_table", name: "Zero pays the table", rule: "Green pays the players, not the house.", kind: "boon", severity: 2, appliesTo: ["roulette"] },

  // ---- craps ----
  { id: "no_come_bets", name: "No come bets", rule: "Come and don't come bets are off.", kind: "bane", severity: 2, appliesTo: ["craps"] },
  { id: "pass_line_required", name: "Pass line required", rule: "The shooter must back the pass line.", kind: "bane", severity: 1, appliesTo: ["craps"] },
  { id: "long_hand_bonus", name: "Long hand bonus", rule: "A shooter reaching five rolls pays the table a bonus.", kind: "boon", severity: 2, appliesTo: ["craps"] },
  { id: "hard_ways_only", name: "Hard ways only", rule: "Prop bets are restricted to the hard ways.", kind: "bane", severity: 2, appliesTo: ["craps"] },

  // ---- blackjack ----
  { id: "extra_card_up", name: "Extra card up", rule: "The dealer exposes one extra card.", kind: "boon", severity: 2, appliesTo: ["blackjack"] },
  { id: "no_splitting", name: "No splitting", rule: "Splitting pairs is off.", kind: "bane", severity: 2, appliesTo: ["blackjack"] },
  { id: "blackjack_pays_double", name: "Blackjack pays double", rule: "A natural pays twice the usual.", kind: "boon", severity: 3, appliesTo: ["blackjack"] },
  { id: "stands_all_17", name: "Stands on all 17s", rule: "The dealer stands on soft 17 as well as hard.", kind: "boon", severity: 1, appliesTo: ["blackjack"] },
];

const BY_ID = new Map(MODIFIERS.map((m) => [m.id, m]));

/** One card by id, or undefined. A recorded id the deck no longer has reads as unknown. */
export const modifierById = (id: string): Modifier | undefined => BY_ID.get(id);

/**
 * The name for a recorded id, falling back to the id itself.
 *
 * The fallback is the point: a card retired from the deck still has history in
 * the ledger, and a stats panel must render that row as something rather than
 * as a blank. It is also the reason ids never change — a rename makes every
 * past row fall through to this branch.
 */
export const modifierName = (id: string): string => BY_ID.get(id)?.name ?? id;

/** Does this card make sense at this pack's table? */
export function appliesToPack(mod: Modifier, packLedger: string): boolean {
  return mod.appliesTo === "any" || mod.appliesTo.includes(packLedger);
}

/**
 * The cards a given pack can use, in deck order.
 *
 * Takes the LEDGER key (games.pack: "blackjack", "roulette", "craps"), not the
 * route segment, because that is what ends up beside the ids in the ledger and
 * what the server has in hand.
 */
export function modifiersFor(packLedger: string): Modifier[] {
  return MODIFIERS.filter((m) => appliesToPack(m, packLedger));
}

/** Keep only ids the deck still knows, in deck order, without duplicates. */
export function sanitizeModifierIds(ids: unknown, packLedger?: string): string[] {
  if (!Array.isArray(ids)) return [];
  const wanted = new Set(ids.filter((x): x is string => typeof x === "string"));
  return MODIFIERS.filter(
    (m) => wanted.has(m.id) && (packLedger === undefined || appliesToPack(m, packLedger)),
  ).map((m) => m.id);
}

// ---------- the draw ----------

/**
 * How much more likely a severity-1 card is than a severity-3 one.
 *
 * Weight is `1 / severity`, so a flavour card is three times as likely as a
 * night-reshaping one. Deliberately gentle rather than brutal: the point is
 * that the nastiest cards stay a surprise, not that they never appear.
 */
export const drawWeight = (m: Modifier): number => 1 / m.severity;

export interface DrawOptions {
  /** The pool to draw from. Pass a pre-filtered deck for a pack. */
  deck: Modifier[];
  count: number;
  /** Narrow the pool further: already-active cards, a severity floor, a kind. */
  filter?: (m: Modifier) => boolean;
  /** Override the severity weighting. Casino Run escalates by raising it. */
  weight?: (m: Modifier) => number;
  /** Injected for tests. Defaults to Math.random. */
  random?: () => number;
}

/**
 * Draw `count` distinct cards, weighted so the nastiest are rarer.
 *
 * TAKES A DECK, A COUNT, A FILTER AND A WEIGHTING rather than knowing anything
 * about "setup", because this session is not its only caller. Casino Run draws
 * on clearing a quota (escalating), draws a forced bane on missing one, and
 * deals a hand of three for draft mode — all of which are this function with
 * different arguments. Hard-coding the setup case would have meant writing it
 * again three times.
 *
 * ASKING FOR MORE THAN EXISTS RETURNS THE WHOLE POOL rather than looping
 * forever or returning duplicates. That is the case a caller hits by accident
 * — "draw 5" on a pack with four eligible cards left — and silently spinning
 * would be the worst possible answer.
 */
export function drawModifiers(opts: DrawOptions): Modifier[] {
  const rng = opts.random ?? Math.random;
  const weightOf = opts.weight ?? drawWeight;
  const pool = opts.deck.filter((m) => (opts.filter ? opts.filter(m) : true));
  const want = Math.max(0, Math.min(Math.trunc(opts.count), pool.length));

  const remaining = [...pool];
  const out: Modifier[] = [];
  while (out.length < want && remaining.length > 0) {
    const total = remaining.reduce((sum, m) => sum + Math.max(0, weightOf(m)), 0);
    // Every remaining weight is zero (a caller weighted the pool out), so fall
    // back to uniform rather than picking nothing and looping.
    let idx = 0;
    if (total <= 0) {
      idx = Math.floor(rng() * remaining.length);
    } else {
      let roll = rng() * total;
      for (let i = 0; i < remaining.length; i++) {
        roll -= Math.max(0, weightOf(remaining[i]!));
        if (roll <= 0) {
          idx = i;
          break;
        }
        idx = i;
      }
    }
    // Splice, so a card can never be drawn twice in one call.
    out.push(remaining.splice(Math.min(idx, remaining.length - 1), 1)[0]!);
  }
  return out;
}

/** Draw for one pack in one call: the setup screen's "Surprise me". */
export function drawForPack(
  packLedger: string,
  count: number,
  opts?: { exclude?: string[]; random?: () => number },
): Modifier[] {
  const exclude = new Set(opts?.exclude ?? []);
  return drawModifiers({
    deck: modifiersFor(packLedger),
    count,
    filter: (m) => !exclude.has(m.id),
    random: opts?.random,
  });
}

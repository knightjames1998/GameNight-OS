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
 * stages climb.
 */
export type ModSeverity = 1 | 2 | 3;

/**
 * The severity, spelled out. Every screen that draws the pips draws this as
 * its label too — a row of dots with no legend is decoration, and this deck
 * shipped with exactly that until somebody had to ask what they meant.
 */
export const SEVERITY_LABEL: Record<ModSeverity, string> = {
  1: "Light — a bit of flavour",
  2: "Medium — changes how you bet",
  3: "Heavy — reshapes the night",
};

/** "●●○" for a severity, for a screen that wants the pips as a string. */
export const severityPips = (sev: ModSeverity): string => "●".repeat(sev) + "○".repeat(3 - sev);

export interface Modifier {
  /** NEVER change once shipped: it is written into the ledger. */
  id: string;
  name: string;
  /**
   * The actual rule, one line a person can read off a TV.
   *
   * May contain the placeholder `{bonus}`, which `modifierRule` fills in with
   * a real amount. See bonusPct.
   */
  rule: string;
  kind: ModKind;
  severity: ModSeverity;
  /** "any", or the ledger keys of the packs this card makes sense at. */
  appliesTo: "any" | string[];
  /**
   * A multiple of the TABLE STAKE, for cards whose rule quotes an amount.
   *
   * "Pays a bonus" is not a rule, it is an argument waiting to happen — the
   * first cut of this deck was full of them and nobody could have applied one
   * without stopping to negotiate. So a card that involves money now names a
   * FRACTION, and `modifierRule` turns it into an actual figure using the
   * table's own stake, so the card on screen reads "pays P$2.00" rather than
   * "pays a bonus" or even "pays 100%".
   *
   * The unit is the table stake because that is the number both sides of the
   * group already have: Casino Run passes its live minimum ante (which rises,
   * so these cards get more expensive with it), and the cash packs pass their
   * default buy-in. With no unit at all it falls back to the percentage, which
   * is still a rule somebody can follow.
   */
  bonusPct?: number;
}

/**
 * The deck: 32 cards, EXACTLY HALF BOONS AND HALF BANES, across all three
 * severities, half of them pack-agnostic.
 *
 * THE 50/50 SPLIT IS ASSERTED, NOT ASPIRED TO. The first cut shipped 11 boons
 * to 13 banes, and worse, the "any" pool — the only pool Casino Run draws from
 * — was 4 boons to 8. So a co-op run got punished twice as often as it got
 * helped by its own random draws, which is a miserable way to lose. The split
 * is now enforced overall AND within the "any" pool by tests, so a future card
 * cannot quietly tip it again.
 *
 * The any/pack split is deliberate too: a crew that only ever plays blackjack
 * still gets real variety, because sixteen "any" cards sit in their pool
 * alongside the five blackjack ones.
 */
export const MODIFIERS: Modifier[] = [
  // ---- any pack ----
  // These are about THE MONEY AND THE TOTALS ON THE BOARD, deliberately. An
  // earlier batch policed the room instead — no talking, no phones, the last
  // player to sit out antes — and those were cut on 2026-08-02: they are
  // party rules wearing a casino costume, they have nothing to do with the
  // numbers the app is tracking, and half of them ("pays the table a forfeit")
  // did not even say what they cost.
  { id: "escalating_min", name: "Escalating minimum", rule: "The minimum ante rises every five legs.", kind: "bane", severity: 2, appliesTo: "any" },
  { id: "everyone_antes", name: "Everyone antes", rule: "Every player antes into the pot each round, not just the blinds.", kind: "bane", severity: 1, appliesTo: "any" },
  { id: "leader_tax", name: "Leader tax", rule: "Anyone up on the night plays double the minimum.", kind: "bane", severity: 2, appliesTo: "any" },
  { id: "house_rake", name: "House rake", rule: "The house rakes {bonus} out of every pot.", kind: "bane", severity: 2, appliesTo: "any", bonusPct: 0.1 },
  { id: "ante_surge", name: "Ante surge", rule: "The minimum ante is doubled for the rest of the run.", kind: "bane", severity: 3, appliesTo: "any" },
  { id: "losses_double", name: "Losses double", rule: "Every losing hand costs twice what it should.", kind: "bane", severity: 3, appliesTo: "any" },
  { id: "min_bet_up", name: "Table minimum up", rule: "No bet may be under {bonus}.", kind: "bane", severity: 2, appliesTo: "any", bonusPct: 3 },
  { id: "pot_tithe", name: "Tithe", rule: "Every fifth hand, each player puts {bonus} in the pot.", kind: "bane", severity: 1, appliesTo: "any", bonusPct: 0.5 },
  { id: "dealers_choice", name: "Dealer's choice", rule: "Whoever deals picks the variant for that round.", kind: "boon", severity: 1, appliesTo: "any" },
  { id: "mercy_chip", name: "Mercy chip", rule: "The biggest loser gets one free rebuy.", kind: "boon", severity: 2, appliesTo: "any" },
  { id: "call_your_shot", name: "Call your shot", rule: "Call win or lose before the hand; a correct call pays {bonus}.", kind: "boon", severity: 2, appliesTo: "any", bonusPct: 0.5 },
  { id: "hot_streak", name: "Hot streak", rule: "Two wins running pays {bonus} from the table.", kind: "boon", severity: 2, appliesTo: "any", bonusPct: 1 },
  { id: "free_round", name: "Free round", rule: "One round a session is played with no ante.", kind: "boon", severity: 1, appliesTo: "any" },
  { id: "underdog_bonus", name: "Underdog bonus", rule: "Whoever is furthest down plays their next hand double.", kind: "boon", severity: 2, appliesTo: "any" },
  { id: "insurance", name: "Insurance", rule: "Once each, take back half of one losing bet.", kind: "boon", severity: 3, appliesTo: "any" },
  { id: "bank_match", name: "House match", rule: "The house adds {bonus} to the biggest win of each round.", kind: "boon", severity: 3, appliesTo: "any", bonusPct: 0.5 },

  // ---- roulette ----
  { id: "hot_colour", name: "Hot colour", rule: "A chosen colour pays double all session.", kind: "boon", severity: 2, appliesTo: ["roulette"] },
  { id: "hot_number", name: "Hot number", rule: "A chosen number pays double all session.", kind: "boon", severity: 3, appliesTo: ["roulette"] },
  { id: "neighbours_only", name: "Neighbours only", rule: "Your bet must touch your previous number on the wheel.", kind: "bane", severity: 2, appliesTo: ["roulette"] },
  { id: "zero_pays_table", name: "Zero pays the table", rule: "Green pays the players, not the house.", kind: "boon", severity: 2, appliesTo: ["roulette"] },
  { id: "no_outside_bets", name: "No outside bets", rule: "Red, black, odd and even are all off.", kind: "bane", severity: 3, appliesTo: ["roulette"] },

  // ---- craps ----
  { id: "no_come_bets", name: "No come bets", rule: "Come and don't come bets are off.", kind: "bane", severity: 2, appliesTo: ["craps"] },
  { id: "pass_line_required", name: "Pass line required", rule: "The shooter must back the pass line.", kind: "bane", severity: 1, appliesTo: ["craps"] },
  { id: "long_hand_bonus", name: "Long hand bonus", rule: "A shooter reaching five rolls pays the table {bonus}.", kind: "boon", severity: 2, appliesTo: ["craps"], bonusPct: 1 },
  { id: "hard_ways_only", name: "Hard ways only", rule: "Prop bets are restricted to the hard ways.", kind: "bane", severity: 2, appliesTo: ["craps"] },
  { id: "come_out_bonus", name: "Come out bonus", rule: "A come-out seven or eleven pays the shooter double.", kind: "boon", severity: 1, appliesTo: ["craps"] },
  { id: "no_odds", name: "No odds", rule: "Taking odds behind the line is off.", kind: "bane", severity: 2, appliesTo: ["craps"] },

  // ---- blackjack ----
  { id: "extra_card_up", name: "Extra card up", rule: "The dealer exposes one extra card.", kind: "boon", severity: 2, appliesTo: ["blackjack"] },
  { id: "no_splitting", name: "No splitting", rule: "Splitting pairs is off.", kind: "bane", severity: 2, appliesTo: ["blackjack"] },
  { id: "blackjack_pays_double", name: "Blackjack pays double", rule: "A natural pays twice the usual.", kind: "boon", severity: 3, appliesTo: ["blackjack"] },
  { id: "stands_all_17", name: "Stands on all 17s", rule: "The dealer stands on soft 17 as well as hard.", kind: "boon", severity: 1, appliesTo: ["blackjack"] },
  { id: "no_doubling", name: "No doubling", rule: "Doubling down is off.", kind: "bane", severity: 2, appliesTo: ["blackjack"] },
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

/**
 * The rule text with `{bonus}` filled in.
 *
 * `unit` is the table's own stake in integer cents — Casino Run passes its
 * live minimum ante, the cash packs pass their default buy-in. Given one, a
 * card reads "pays P$2.00"; given none, it falls back to "pays 100% of the
 * minimum", which is still followable. A card with no `bonusPct` comes back
 * untouched, so callers never have to check first.
 *
 * `fmt` is injected rather than imported so this module stays free of the
 * money formatter and the caller keeps control of the stakes prefix.
 */
export function modifierRule(
  mod: Modifier,
  opts?: { unit?: number | null; fmt?: (cents: number) => string },
): string {
  if (!mod.rule.includes("{bonus}")) return mod.rule;
  const pct = mod.bonusPct ?? 0;
  const unit = opts?.unit ?? null;
  const fmt = opts?.fmt;
  const filled =
    unit != null && unit > 0 && fmt
      ? fmt(Math.max(1, Math.round(unit * pct)))
      : `${Math.round(pct * 100)}% of the minimum`;
  return mod.rule.replace("{bonus}", filled);
}

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

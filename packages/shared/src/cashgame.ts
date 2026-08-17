// The shared CASH GAME engine. Blackjack, roulette, craps and poker all ride
// this; each pack file stays thin because everything below is pack-agnostic.
//
// Dependency-free and PURE on purpose: no database, no clock, no randomness,
// no imports. That is what makes the money rules exhaustively testable, and
// money rules are the one part of this app that can be wrong in a way nobody
// notices until somebody is owed forty dollars.
//
// ---------------------------------------------------------------------------
// MONEY IS INTEGER CENTS. EVERYWHERE. NEVER A FLOAT.
//
// Not a style preference. The zero-sum balance check below asks whether a
// table's nets sum to exactly zero, and in binary floating point they often do
// not: 3.33 + 3.33 + 3.34 is 10.000000000000002, so a session that is
// perfectly correct would report "the table does not balance, off by
// $0.0000000002" and the host would go hunting for a mistake that does not
// exist. Cents are exact integers, so the check is exact.
//
// The rule in practice: every amount in this module, in the pack state, in the
// session jsonb and in match_participants.meta is an integer number of cents.
// Dollars exist only at the two EDGES: parseCents() turns typed text into
// cents on the way in, formatCents() turns cents into text on the way out.
// Nothing in between ever holds a decimal.
// ---------------------------------------------------------------------------
//
// WHY PLACEMENT IS DERIVED. These packs feed the existing matches /
// match_participants ledger with no schema change and no change to stats.ts at
// all: rank the players by net, descending, and that IS the placement every
// other pack already writes. Money never becomes a ledger column; it rides in
// match_participants.meta. That is the whole reason this shape was chosen, so
// resist adding a money column later. The leaderboard, the rivalry pages, the
// recap card and the profile aggregates all work today because a cash night
// looks exactly like any other night to the reader.

// ---------- stakes: real money or play money ----------

/**
 * What the chips are worth.
 *
 * "real": actual currency, formatted with `$`.
 * "play": play money, formatted with a distinct prefix AND flagged in its own
 * colour, because the one thing that must never happen is somebody reading a
 * play-money board across a room and thinking it is dollars. Both signals are
 * deliberate: a prefix survives a photo of the screen, a colour survives a
 * glance from the sofa, and either alone is a coin flip on a TV.
 *
 * A session with NO stakes value is real, so every night recorded before this
 * shipped reads exactly as it did. That is why the parameter is optional
 * everywhere rather than required.
 */
export type CashStakes = "real" | "play";

/**
 * The prefix in front of an amount. "P$" rather than a symbol on purpose: it is
 * plain ASCII, so it renders on every TV browser and in a canvas recap card,
 * and it reads as "play dollars" without a legend.
 *
 * Deliberately NOT "Monopoly money", here or in any UI copy. Monopoly is a
 * trademark and this app is public.
 */
export const stakesPrefix = (stakes?: CashStakes): string => (stakes === "play" ? "P$" : "$");

/** "Real money" / "Play money", for a label or a badge. */
export const stakesLabel = (stakes?: CashStakes): string =>
  stakes === "play" ? "Play money" : "Real money";

// ---------- money at the edges ----------

/**
 * Turn typed text into integer cents, or null if it is not a money amount.
 *
 * Parsed from the DIGITS rather than through parseFloat, so it is exact by
 * construction instead of exact because Math.round usually rescues it:
 * "0.07" is 7, not 7.000000000000001 rounded. Accepts an optional leading
 * "$", thousands separators, a leading sign, and at most two decimal places.
 * A third decimal is rejected rather than silently truncated, because "10.005"
 * is far more likely to be a typo than an intent.
 */
export function parseCents(text: string): number | null {
  const cleaned = String(text).trim().replace(/[$\s,]/g, "");
  if (!cleaned) return null;
  const m = /^([+-]?)(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!m) return null;
  const [, sign, whole, frac] = m;
  if (!whole && frac === undefined) return null;
  if (!whole && !frac) return null;
  const dollars = whole ? Number(whole) : 0;
  if (!Number.isSafeInteger(dollars)) return null;
  const cents = Number((frac ?? "").padEnd(2, "0"));
  const total = dollars * 100 + cents;
  if (!Number.isSafeInteger(total)) return null;
  return sign === "-" ? -total : total;
}

/**
 * "$1,234.56" / "-$12.50", or "P$1,234.56" on a play-money table. The only
 * place cents become a decimal.
 *
 * `stakes` is optional and absent means REAL, so every call site written before
 * play money existed keeps its exact output and every night recorded before it
 * shipped reads unchanged.
 */
export function formatCents(cents: number, stakes?: CashStakes): string {
  const n = Math.trunc(cents);
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}${stakesPrefix(stakes)}${whole}.${frac}`;
}

/** "+$12.50" / "-$12.50" / "$0.00". For a net, where the sign is the point. */
export function formatCentsSigned(cents: number, stakes?: CashStakes): string {
  const n = Math.trunc(cents);
  if (n === 0) return `${stakesPrefix(stakes)}0.00`;
  return n > 0 ? `+${formatCents(n, stakes)}` : formatCents(n, stakes);
}

/** "$40" when the cents are round, "$12.50" when they are not. Compact UI. */
export function formatCentsShort(cents: number, stakes?: CashStakes): string {
  const n = Math.trunc(cents);
  if (n % 100 !== 0) return formatCents(n, stakes);
  const neg = n < 0;
  const whole = Math.floor(Math.abs(n) / 100).toLocaleString("en-US");
  return `${neg ? "-" : ""}${stakesPrefix(stakes)}${whole}`;
}

/**
 * The three formatters bound to one table's stakes.
 *
 * Every casino screen takes this ONCE and uses it everywhere, rather than
 * threading `stakes` through twenty call sites by hand. That matters because
 * the failure mode of a missed call site is a play-money amount rendering as
 * dollars, which is silent and is exactly the confusion the prefix exists to
 * prevent.
 */
export function money(stakes?: CashStakes) {
  return {
    stakes: stakes ?? ("real" as CashStakes),
    prefix: stakesPrefix(stakes),
    label: stakesLabel(stakes),
    isPlay: stakes === "play",
    fmt: (c: number) => formatCents(c, stakes),
    signed: (c: number) => formatCentsSigned(c, stakes),
    short: (c: number) => formatCentsShort(c, stakes),
  };
}

// ---------- the table ----------

/**
 * Who is the house for this session, chosen by the host at start.
 *
 * "player": a crew member banks. Their net is the exact inverse of everyone
 * else's, the table must sum to zero, and the balance check below applies.
 * "casino": a real casino banks. Every net is independent, nobody is derived,
 * and there is nothing to check: the money that left the table went to a
 * building, not to another line on the screen.
 * "table": nobody banks. Every player types their own cash-out, nobody is
 * derived, and the table must sum to exactly zero once everybody has counted.
 *
 * POKER IS THE THIRD ONE AND IT IS GENUINELY NOT EITHER OF THE OTHER TWO,
 * which is the whole reason this union grew rather than the pack picking the
 * closest fit. "casino" is wrong because it checks NOTHING: a poker table is
 * zero-sum and a night that does not add up is the single most useful thing
 * this app can tell a room full of people. "player" is wrong because it DERIVES
 * somebody: on a poker table nobody is the other side of every hand, so
 * inverting one player's net against the rest would invent a number and hide
 * the very disagreement worth reporting.
 *
 * The difference between "table" and "player" is therefore where the check
 * comes from. A banked table checks the banker's own count against what the
 * players imply, so it can only check once the banker has counted. A poker
 * table checks the sum of everybody's count against zero, so it can only check
 * once EVERYBODY has counted. Same arithmetic, different trigger.
 */
export type CashBank = "player" | "casino" | "table";

/** A roster slot, the same shape every other pack uses. */
export interface CashPlayer {
  id: string;
  kind: "member" | "guest";
  userId: string | null;
  name: string;
}

/**
 * One player's money for the night. `rebuys` is a list rather than a count
 * because rebuys are not always the same size, and summing the list is the
 * only honest way to know what someone is in for.
 */
export interface CashEntry {
  playerId: string;
  /** cents */
  buyIn: number;
  /** cents each, in the order they happened */
  rebuys: number[];
  /** cents; null while the player is still at the table */
  cashOut: number | null;
  /** ISO timestamp of the cash-out, or null */
  at: string | null;
}

/** Everything the engine needs. Each pack's session state is a superset. */
export interface CashSessionCore {
  bank: CashBank;
  /** Roster slot id of the banker. Only meaningful when bank === "player". */
  bankerId: string | null;
  /**
   * Real money or play money. Optional HERE because the settlement does not
   * care (a net is a net whatever the chips are worth) and because a session
   * row written before play money existed has no value. Absent means real.
   */
  stakes?: CashStakes;
  /** Active modifier ids. Optional for the same reason: older rows have none. */
  modifiers?: string[];
  roster: CashPlayer[];
  entries: CashEntry[];
}

/** A fresh entry for a player joining the table. */
export function newEntry(playerId: string, buyIn: number): CashEntry {
  return { playerId, buyIn: Math.trunc(buyIn), rebuys: [], cashOut: null, at: null };
}

/** Everything a player has put on the table: the buy-in plus every rebuy. */
export function totalIn(entry: CashEntry): number {
  let sum = Math.trunc(entry.buyIn);
  for (const r of entry.rebuys) sum += Math.trunc(r);
  return sum;
}

/**
 * One player's net, or null while they are still playing.
 *
 * THE definition, and the reason it lives in exactly one place:
 *     net = cashOut - (buyIn + sum(rebuys))
 *
 * A player who has not cashed out has no net yet. Their chips are on the
 * table and nobody knows what they are worth, so reporting -totalIn would be
 * a lie that reads as a losing night. `settleCash({ final: true })` is where
 * that becomes a number, and there it means what it says: a player who left
 * without cashing out busted, so their cash-out is zero.
 */
export function netOf(entry: CashEntry): number | null {
  return entry.cashOut === null ? null : Math.trunc(entry.cashOut) - totalIn(entry);
}

// ---------- settlement ----------

export interface CashLine {
  playerId: string;
  /** cents */
  buyIn: number;
  /** how many rebuys, which is the number people actually quote */
  rebuys: number;
  /** cents across every rebuy */
  rebuyTotal: number;
  /** cents: buyIn + rebuyTotal */
  totalIn: number;
  /** cents; null while still at the table */
  cashOut: number | null;
  cashedOut: boolean;
  /** cents; null while still at the table (never null once final) */
  net: number | null;
  /** True for the banker of a player-banked table: net came from the others. */
  derived: boolean;
  /** Competition rank on net, descending. Null while the net is unknown. */
  placement: number | null;
  isWinner: boolean;
}

export interface CashBalance {
  /**
   * Whether a balance check applies at all. False for a casino-banked table
   * (there is no second side to compare against) and false when the banker's
   * own cash-out has not been recorded (there is nothing to compare WITH, and
   * treating an absent count as zero would report every winning table as
   * broken).
   */
  checked: boolean;
  /** Meaningless unless `checked`. True when the table sums to exactly zero. */
  balanced: boolean;
  /**
   * cents, signed, and it is the whole point of the warning. This is the sum
   * of every TYPED net at the table. Positive means more money came off the
   * table than went onto it, so a cash-out is too high; negative means the
   * opposite. Zero when the table is right.
   */
  delta: number;
}

export interface CashSettlement {
  /** Ranked: best net first, then everyone still at the table. */
  lines: CashLine[];
  balance: CashBalance;
  /** cents across every player's buy-in and rebuys */
  totalIn: number;
  /** cents across every recorded cash-out */
  totalOut: number;
  /** cents still in play: totalIn - totalOut */
  onTable: number;
  /** How many players have not cashed out yet. */
  stillIn: number;
}

const NO_CHECK: CashBalance = { checked: false, balanced: true, delta: 0 };

/**
 * Rank rows by net, descending, at COMPETITION ranking: two players tied on
 * the best net both place 1 and the next places 3. Same convention Smashdown
 * and every other placement in this app uses, so a cash night's placement
 * means the same thing on a leaderboard as a Smash night's.
 *
 * Rows with a null net (still at the table) rank nowhere and sort last.
 */
export function rankByNet<T extends { net: number | null }>(
  rows: T[],
): (T & { placement: number | null; isWinner: boolean })[] {
  const ranked = [...rows].sort((a, b) => {
    if (a.net === null && b.net === null) return 0;
    if (a.net === null) return 1;
    if (b.net === null) return -1;
    return b.net - a.net;
  });

  const out: (T & { placement: number | null; isWinner: boolean })[] = [];
  let place = 0;
  let prev: number | null = null;
  let seen = 0;
  for (const row of ranked) {
    if (row.net === null) {
      out.push({ ...row, placement: null, isWinner: false });
      continue;
    }
    seen++;
    // Competition ranking: only a DIFFERENT net advances the placement, and
    // when it does it jumps to how many players have been seen, so a two-way
    // tie for first is followed by third.
    if (prev === null || row.net !== prev) place = seen;
    prev = row.net;
    out.push({ ...row, placement: place, isWinner: place === 1 });
  }
  return out;
}

/**
 * Settle the table: per-player lines, the derived banker, and the balance
 * check.
 *
 * `final` is the difference between the live money board and the moment the
 * night is recorded. Live, a player who has not cashed out has no net and no
 * placement, because their chips are still on the table. Final, an absent
 * cash-out means zero: they busted and walked, which is a real and common way
 * for a cash night to end for one person.
 *
 * THE DERIVED BANKER, and why it is never typed. On a player-banked table the
 * banker IS the other side of every hand, so their net is arithmetically the
 * inverse of everyone else's, so typing it in could only ever introduce a
 * disagreement. So it is computed: -(sum of every other player's net). Live,
 * that sum covers only the players who have already cashed out, which is
 * exactly the banker's realised position so far.
 *
 * THE BALANCE CHECK, and what it is actually checking. Because the banker's
 * net is derived, the table sums to zero by construction and there would be
 * nothing to verify, unless the banker ALSO counts their own rack, which is
 * what a real banker does at the end of the night. So the banker's buy-in
 * (the float they put up) and cash-out (what came back) are recorded like
 * anyone else's, and the check asks whether the banker's own count agrees
 * with what the players' numbers say it should be. The disagreement is the
 * sum of every typed net, and it is reported as an exact figure so the host
 * can go and find the cash-out that is wrong instead of guessing.
 */
export function settleCash(core: CashSessionCore, opts?: { final?: boolean }): CashSettlement {
  const final = opts?.final ?? false;
  const byId = new Map(core.entries.map((e) => [e.playerId, e]));
  const bankerId = core.bank === "player" ? core.bankerId : null;

  let sumIn = 0;
  let sumOut = 0;
  let stillIn = 0;
  /** Sum of every typed net, banker included. Zero on a correct table. */
  let typedSum = 0;
  /** Sum of every non-banker net, which is what the banker's net inverts. */
  let othersSum = 0;
  let bankerCashedOut = false;

  const base: Omit<CashLine, "placement" | "isWinner">[] = [];

  for (const p of core.roster) {
    const e = byId.get(p.id) ?? newEntry(p.id, 0);
    const rebuyTotal = e.rebuys.reduce((a, r) => a + Math.trunc(r), 0);
    const tin = Math.trunc(e.buyIn) + rebuyTotal;
    const cashedOut = e.cashOut !== null;
    // A never-cashed-out player is only forced to zero when the night is being
    // recorded; live, "unknown" is the honest answer.
    const cashOut = cashedOut ? Math.trunc(e.cashOut as number) : final ? 0 : null;
    const net = cashOut === null ? null : cashOut - tin;

    sumIn += tin;
    if (cashedOut) sumOut += Math.trunc(e.cashOut as number);
    if (!cashedOut) stillIn++;

    if (net !== null) {
      typedSum += net;
      if (p.id !== bankerId) othersSum += net;
    }
    if (p.id === bankerId && cashedOut) bankerCashedOut = true;

    base.push({
      playerId: p.id,
      buyIn: Math.trunc(e.buyIn),
      rebuys: e.rebuys.length,
      rebuyTotal,
      totalIn: tin,
      cashOut,
      cashedOut,
      net,
      derived: false,
      placement: null,
      isWinner: false,
    } as CashLine);
  }

  // The banker's line is replaced, not adjusted: whatever their own count
  // said, the number that reaches the ledger is the inverse of the table.
  //
  // `|| 0` normalises negative zero. A table that comes out exactly even
  // makes -0, which compares equal to 0 everywhere but prints as "-0" in a
  // JSON payload and in any deep-equal a later test writes, and a banker's
  // net rendering as "-0" on a TV would read as a rounding bug.
  const withBanker = base.map((l) =>
    l.playerId === bankerId ? { ...l, net: -othersSum || 0, derived: true } : l,
  );

  // THREE BANK TYPES, TWO OF WHICH CHECK, AND THEY CHECK AT DIFFERENT MOMENTS.
  //
  // "player": a player must be banking (a casino table has no second side) and
  // that banker must have counted their own rack. An absent count is not a
  // count of zero, and treating it as one would report every table where the
  // players finished up as broken.
  //
  // "table": nobody banks, so there is no single count to compare against and
  // the comparison is the whole table against zero. That can only be asked once
  // EVERY seat has a net, which live means everyone has cashed out and final
  // means always (an absent cash-out is forced to zero, and for a player who
  // busted that zero IS their count). A partially counted poker table is not
  // unbalanced, it is unfinished, and reporting "you are $200 short" to a room
  // where two people still have chips in front of them would be worse than
  // saying nothing: it would train everyone to ignore the warning that matters.
  //
  // An EMPTY roster is not checked, because "the sum of no nets is zero" is
  // true and useless, and a table with no players is a table nobody has opened.
  const everySeatCounted = base.length > 0 && base.every((l) => l.net !== null);
  const balance: CashBalance =
    core.bank === "table"
      ? everySeatCounted
        ? { checked: true, balanced: typedSum === 0, delta: typedSum }
        : NO_CHECK
      : bankerId === null || !bankerCashedOut
        ? NO_CHECK
        : { checked: true, balanced: typedSum === 0, delta: typedSum };

  const lines = rankByNet(withBanker) as CashLine[];

  return {
    lines,
    balance,
    totalIn: sumIn,
    totalOut: sumOut,
    onTable: sumIn - sumOut,
    stillIn,
  };
}

/**
 * The ledger lines one settled cash session produces: placement from net
 * rank, winner at placement 1. Deliberately the LAST step and deliberately
 * tiny: everything interesting already happened in settleCash, and this is
 * only the shape the existing ledger wants.
 */
export interface CashLedgerLine {
  playerId: string;
  placement: number | null;
  isWinner: boolean;
  meta: Record<string, unknown>;
}

/**
 * Map a settlement onto ledger lines, with each pack free to add its own
 * per-player detail (blackjack's biggest bet, roulette's favourite bet type)
 * through `extraMeta`.
 */
export function cashLedgerLines(
  settlement: CashSettlement,
  opts: {
    bank: CashBank;
    bankerId: string | null;
    /**
     * Written to EVERY row, including the ones recorded before play money
     * existed, which carry nothing and are therefore read as real. That is what
     * lets the lifetime read split the money without a migration: an absent
     * value is not ambiguous, it means real.
     */
    stakes: CashStakes;
    /**
     * Active modifier ids, written to EVERY participant row.
     *
     * Redundant across a session's rows, and that is the right grain anyway:
     * the stat is win rate PER PLAYER per modifier, so it has to sit on the
     * participant. The alternative (a list on `matches`) has nowhere to go,
     * since that table has `label` (a single display string Mario Party already
     * uses for the board) and no generic meta column. This needs no schema
     * change and answers the question directly.
     */
    modifiers?: string[];
    extraMeta?: (playerId: string) => Record<string, unknown>;
  },
): CashLedgerLine[] {
  const { bank, bankerId, stakes, modifiers, extraMeta } = opts;
  return settlement.lines.map((l) => {
    const meta: Record<string, unknown> = {
      bank,
      stakes,
      buyIn: l.buyIn,
      rebuys: l.rebuys,
      rebuyTotal: l.rebuyTotal,
      totalIn: l.totalIn,
      cashOut: l.cashOut ?? 0,
      net: l.net ?? 0,
    };
    // Omitted entirely when nothing was active, so a plain night's meta bag is
    // exactly what it was before modifiers existed.
    if (modifiers && modifiers.length) meta.modifiers = [...modifiers];
    if (bank === "player" && l.playerId === bankerId) {
      meta.banker = true;
      meta.derivedNet = true;
    }
    const extra = extraMeta?.(l.playerId);
    if (extra) for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined) meta[k] = v;
    return { playerId: l.playerId, placement: l.placement, isWinner: l.isWinner, meta };
  });
}

/**
 * The host-facing sentence for a table that does not balance. Returned rather
 * than thrown, because the host is allowed to record it anyway once they have
 * been told: the app records what a home game did, it does not referee it.
 */
export function balanceWarning(
  balance: CashBalance,
  stakes?: CashStakes,
  /**
   * Optional and absent means a banked table, so every call site written before
   * poker existed keeps its exact sentence. It only changes the WORDING: the
   * delta and the sign mean the same thing on both, because it is the same sum.
   */
  bank?: CashBank,
): string | null {
  if (!balance.checked || balance.balanced) return null;
  const over = balance.delta > 0;
  const off = `The table does not balance, off by ${formatCents(Math.abs(balance.delta), stakes)}.`;
  // A BANKED TABLE AND A POKER TABLE ARE THE SAME ARITHMETIC AND A DIFFERENT
  // SENTENCE, and the sentence is most of the value. On a banked table the host
  // is looking for ONE wrong number, because the banker's own count is what
  // disagreed. On a poker table nobody is more suspect than anybody else and
  // the room is looking for the discrepancy together, so the wording names the
  // table rather than a cash-out and says which direction to look in.
  if (bank === "table") {
    return `${off} ${
      over
        ? "More money came off the table than went onto it, so somebody's count is too high."
        : "Less money came off the table than went onto it, so somebody's count is too low, or chips are still unaccounted for."
    }`;
  }
  return `${off} ${
    over
      ? "More was cashed out than was bought in, so a cash-out is too high."
      : "Less was cashed out than was bought in, so a cash-out is too low or one is missing."
  }`;
}

// ---------- who pays whom ----------

/** One payment, from the person who is down to the person who is up. */
export interface CashTransfer {
  fromId: string;
  toId: string;
  /** cents, always positive */
  cents: number;
}

/**
 * Turn a settled table into the list of payments that squares it.
 *
 * IT COSTS NO NEW INPUT, which is the reason it exists at all. The vector is
 * derived entirely from the signed nets, and those are already derived from the
 * buy-in, the rebuys and the cash-out that any cash pack has to collect anyway.
 * No new field, no new tap, no new screen state: `settleCash` already hands back
 * exactly what this needs.
 *
 * FOUR RULES, all of them load bearing.
 *
 * 1. IT RETURNS NULL UNLESS THE TABLE BALANCES. With a non-zero delta the list
 *    is not merely approximate, it is MEANINGLESS: somebody miscounted, and
 *    handing a room a set of debts derived from a wrong number is the app
 *    inventing a debt between two friends. So it appears exactly when
 *    `balance.checked && balance.balanced`, which on a poker table is the moment
 *    everybody has counted. That is not a separate gate for a user to satisfy;
 *    it is the same cash-outs the pack already needs.
 *
 * 2. IT IS DETERMINISTIC ACROSS DEVICES. Greedy settlement has ties, and two
 *    phones resolving a tie differently would show two different sets of debts
 *    for the same table over live sync, which is worse than showing none. So the
 *    order is a total order with no ties left in it: net descending, then
 *    playerId ascending. (`rankByNet` sorts on net alone and relies on a stable
 *    sort to hold roster order, which is deterministic for ONE device reading
 *    one roster; this needs the stronger property, so the id tie-break is
 *    explicit here rather than inherited.)
 *
 * 3. GUESTS ARE IN IT. The ledger skips guests because a guest carries no
 *    lifetime stats; the MONEY cannot skip anybody or the table does not square.
 *    A guest owes or is owed exactly like a member, their name is already typed,
 *    and this function never looks at `kind` at all. That is the same rule the
 *    balance check follows, and it has its own test for the same reason.
 *
 * 4. IT IS AT MOST n-1 TRANSFERS AND IT DOES NOT CLAIM TO BE MINIMAL. Provably
 *    minimising the number of payments is subset-sum, which is NP-hard, and it
 *    is not worth solving for six people at a kitchen table. Greedy
 *    largest-debtor-pays-largest-creditor gives n-1 or fewer, which is what
 *    every split-the-bill tool ships. This paragraph exists so that nobody later
 *    reads a four-transfer answer where three would do and files it as a bug.
 *
 * Players whose net is exactly zero are absent from the list rather than present
 * with a zero: they broke even and owe nobody, and a row saying so is noise on a
 * screen whose entire job is to be scanned once and acted on.
 */
export function settleTransfers(settlement: CashSettlement): CashTransfer[] | null {
  const { balance, lines } = settlement;
  if (!balance.checked || !balance.balanced) return null;

  const owing = lines.filter((l): l is CashLine & { net: number } => l.net !== null && l.net !== 0);
  const byId = (a: { playerId: string }, b: { playerId: string }) => (a.playerId < b.playerId ? -1 : 1);

  // Largest credit first, and largest DEBT first, each with the SAME id
  // tie-break. Sorting the debtors explicitly rather than reversing one shared
  // ordering is deliberate: reversing flips the tie-break too, so two players
  // level on -$50 would settle in descending id order while two level on +$50
  // settled in ascending. Both are deterministic and one of them is arbitrary
  // for no reason, which is exactly the kind of detail that reads as a bug the
  // first time somebody looks closely at a tied table.
  const creditors = owing
    .filter((l) => l.net > 0)
    .sort((a, b) => (b.net === a.net ? byId(a, b) : b.net - a.net))
    .map((l) => ({ id: l.playerId, left: l.net }));
  const debtors = owing
    .filter((l) => l.net < 0)
    .sort((a, b) => (a.net === b.net ? byId(a, b) : a.net - b.net))
    .map((l) => ({ id: l.playerId, left: -l.net }));

  const out: CashTransfer[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci]!;
    const d = debtors[di]!;
    const cents = Math.min(c.left, d.left);
    if (cents > 0) out.push({ fromId: d.id, toId: c.id, cents });
    c.left -= cents;
    d.left -= cents;
    if (c.left === 0) ci++;
    if (d.left === 0) di++;
  }
  return out;
}

// ---------- the night, as every casino screen reads it ----------
//
// Every pack in the group renders the same money board (on a phone and on a
// TV) and every one needs the same object to do it. The ONLY thing that
// differs is the pack's own per-player detail, so that is the generic:
// blackjack's D is { biggestBet, biggestWin, blackjacks }, roulette's is
// { favouriteBet, bestStreak }. Everything else is shared, which is what stops
// two packs quoting different numbers for the same shape of table.

export interface CashPlayerRow<D> {
  playerId: string;
  name: string;
  kind: "member" | "guest";
  isBanker: boolean;
  /** cents */
  buyIn: number;
  rebuys: number;
  /** cents */
  rebuyTotal: number;
  /** cents */
  totalIn: number;
  /** cents; null while still at the table */
  cashOut: number | null;
  cashedOut: boolean;
  /** cents; null while still at the table (the banker's is always known) */
  net: number | null;
  /** True when this net was derived from the rest of the table. */
  derived: boolean;
  placement: number | null;
  /**
   * How many tracked EVENTS this player has: blackjack hands, roulette spins,
   * craps rolls. Zero when the tracker was never on. Named generically because
   * the number always means "how much the tracker saw" and only the noun is
   * per-pack, which is the pack's own UI copy rather than a data difference.
   */
  events: number;
  detail: D;
}

export interface CashSummary<D> {
  bank: CashBank;
  bankerId: string | null;
  /** Active modifier ids. Same reasoning as `stakes`: carried, not threaded. */
  modifiers: string[];
  /**
   * cents. The table's standard stake, carried for the same reason as the two
   * above: a modifier card whose rule quotes a fraction ("the house rakes
   * 10%") is rendered as a real figure, and the renderer needs the unit.
   */
  defaultBuyIn: number;
  /**
   * Carried on the SUMMARY rather than threaded as a prop, so every screen that
   * can draw an amount already has the stakes in hand. A component cannot render
   * this board without it, which is what stops a play-money table showing
   * dollars because somebody forgot to pass a flag down.
   */
  stakes: CashStakes;
  /** Sorted: up first, down last, still-at-the-table after both. */
  players: CashPlayerRow<D>[];
  /** cents */
  totalIn: number;
  /** cents */
  totalOut: number;
  /** cents still in play */
  onTable: number;
  stillIn: number;
  cashedOut: number;
  /** Tracked events across the whole table. */
  events: number;
  balance: CashBalance;
  /** Null unless the table is player-banked AND does not balance. */
  warning: string | null;
}

/**
 * The whole night in one object, for the pack page, the TV board and the
 * session payload.
 *
 * DERIVED ON EVERY READ rather than maintained, for the same reason
 * Smashdown's burn board is: a maintained running total and an undone rebuy
 * drift apart silently, and money that drifts is the worst kind of wrong.
 */
export function summarizeCash<D>(
  core: CashSessionCore,
  detail: {
    /** The pack's per-player detail, typed-beats-derived already applied. */
    of: (playerId: string) => D;
    /** How many tracked events this player has. */
    events: (playerId: string) => number;
    /** Tracked events across the whole table. */
    total: number;
  },
): CashSummary<D> {
  const settlement = settleCash(core);
  const slotOf = new Map(core.roster.map((p) => [p.id, p]));
  const bankerId = core.bank === "player" ? core.bankerId : null;

  const players: CashPlayerRow<D>[] = settlement.lines.map((l) => {
    const slot = slotOf.get(l.playerId);
    return {
      playerId: l.playerId,
      name: slot?.name ?? "",
      kind: slot?.kind ?? "guest",
      isBanker: bankerId === l.playerId,
      buyIn: l.buyIn,
      rebuys: l.rebuys,
      rebuyTotal: l.rebuyTotal,
      totalIn: l.totalIn,
      cashOut: l.cashOut,
      cashedOut: l.cashedOut,
      net: l.net,
      derived: l.derived,
      placement: l.placement,
      events: detail.events(l.playerId),
      detail: detail.of(l.playerId),
    };
  });

  return {
    bank: core.bank,
    bankerId,
    stakes: core.stakes ?? "real",
    modifiers: core.modifiers ?? [],
    defaultBuyIn: (core as { defaultBuyIn?: number }).defaultBuyIn ?? 0,
    players,
    totalIn: settlement.totalIn,
    totalOut: settlement.totalOut,
    onTable: settlement.onTable,
    stillIn: settlement.stillIn,
    cashedOut: players.length - settlement.stillIn,
    events: detail.total,
    balance: settlement.balance,
    // Null until there is anything to disagree with, which is the banker's own
    // count on a banked table and everybody's count on a poker one. See
    // settleCash's balance rules for why the trigger differs.
    warning: balanceWarning(settlement.balance, core.stakes, core.bank),
  };
}

/**
 * The shape every casino pack's session state has. Each pack extends it with
 * its own tracker log and detail map; everything here is what the shared
 * setup screen, the shared table and the shared money board read.
 */
export interface CashPackState extends CashSessionCore {
  /** Unique per session start; namespaces the ledger key. */
  sessionKey: string;
  /** Required on a live session, unlike the optional field on the core. */
  stakes: CashStakes;
  /** ISO. Start of play, so net-per-hour is derivable at completion. */
  startedAt: string;
  /** cents. Prefilled on the buy-in and rebuy controls; not a rule. */
  defaultBuyIn: number;
  /** The live tracker. OFF by default; the host may flip it mid-session. */
  tracker: boolean;
  /** Standing rule 1: only owners/admins record unless the host opens it. */
  openScoring: boolean;
  /**
   * Active MODIFIER ids for this table (packages/shared/src/modifiers.ts).
   *
   * Ids only, never the cards themselves: the deck's names, rule text and
   * severities are display data that should be free to improve, and storing a
   * snapshot would freeze tonight's wording into the session jsonb forever.
   * The app DISPLAYS and RECORDS these; it never computes their effect.
   */
  modifiers: string[];
}

/**
 * Everything a casino pack needs to open a table, shared because the answer
 * is the same for all four. `buyIns` is what makes PER-PLAYER amounts work:
 * the banker's float is nearly always different from everyone else's, and a
 * table where one person sits down with $100 and another with $20 is the
 * normal case rather than an edge one.
 */
export function newCashState(opts: {
  bank: CashBank;
  bankerId: string | null;
  /** Real money or play money, chosen by the host at start. Absent is real. */
  stakes?: CashStakes;
  roster: CashPlayer[];
  defaultBuyIn: number;
  /** playerId -> that player's own opening buy-in, in cents. */
  buyIns?: Record<string, number>;
  tracker?: boolean;
  /** Active modifier ids, already sanitized against the deck by the caller. */
  modifiers?: string[];
}): CashPackState {
  const buy = Math.max(0, Math.trunc(opts.defaultBuyIn));
  return {
    sessionKey: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    bank: opts.bank,
    // A host who picks a banker, changes their mind and goes casino-banked
    // must not leave a derived line behind, so this is cleared rather than
    // remembered.
    bankerId: opts.bank === "player" ? opts.bankerId : null,
    // Fixed for the night. A table cannot be half play money, and changing it
    // mid-session would retroactively re-denominate every buy-in already taken,
    // so it is a start-only choice exactly like who is banking.
    stakes: opts.stakes ?? "real",
    startedAt: new Date().toISOString(),
    defaultBuyIn: buy,
    tracker: opts.tracker ?? false,
    openScoring: false,
    modifiers: opts.modifiers ?? [],
    roster: opts.roster,
    entries: opts.roster.map((p) => ({
      playerId: p.id,
      buyIn: Math.max(0, Math.trunc(opts.buyIns?.[p.id] ?? buy)),
      rebuys: [],
      cashOut: null,
      at: null,
    })),
  };
}

// ---------- the lifetime read, and the stakes split ----------
//
// THE RULE, and it is the whole of this section: WINS AND PLACEMENTS UNIFY
// ACROSS STAKES, ONLY MONEY SPLITS. A win is a win: you either finished the
// night up or you did not, and play money does not make that less true, so
// sessions, nights finished up, win rate, streaks, rebuys and hours are counted
// once over every night. What mixing genuinely corrupts is the TOTALS: adding a
// $60 real night to an 80-play-dollar one produces a number that means nothing,
// so net, staked, averages, ROI, best/worst and net-per-hour are computed twice
// from the same rows and reported side by side.
//
// This is pure so it can be tested without a database. The server's job is one
// query; the arithmetic and the split are here.

/** One night as the ledger describes it: when, and the meta bag it carried. */
export interface CashNight {
  /** ms since epoch. 0 when the row has no timestamp. */
  at: number;
  /** cents */
  net: number;
  /** cents put on the table across the buy-in and every rebuy */
  totalIn: number;
  rebuys: number;
  /** minutes of play, or null when the night did not record a length */
  minutes: number | null;
  /** True when this player banked the table. */
  banker: boolean;
  /** Absent on every night recorded before play money existed, so: real. */
  stakes?: CashStakes;
  /**
   * The modifier ids that were live. Absent on a plain night and on every night
   * recorded before modifiers existed, both of which mean the same thing, so
   * there is nothing to disambiguate.
   */
  modifiers?: string[];
}

/** The money half, computed per stakes. */
export interface CashMoneyAgg {
  stakes: CashStakes;
  /** How many nights were played at THIS stakes. Zero means hide it entirely. */
  sessions: number;
  /** cents */
  net: number;
  /** cents ever put on the table */
  staked: number;
  avgBuyIn: number;
  avgNet: number;
  /** Net over everything staked. Null rather than a divide by zero. */
  roi: number | null;
  best: number | null;
  worst: number | null;
  /** cents per hour. Null when no night at this stakes recorded a length. */
  netPerHour: number | null;
}

/** Everything that counts once, whatever the chips were worth. */
export interface CashLifetimeAgg {
  sessions: number;
  upNights: number;
  winRate: number;
  /** Nights finished UP in a row, right now. */
  streak: number;
  bestStreak: number;
  rebuys: number;
  rebuyRate: number;
  minutes: number;
  banked: number;
  /** The money, split. Look at `sessions` on each before rendering it. */
  money: { real: CashMoneyAgg; play: CashMoneyAgg };
}

function emptyMoney(stakes: CashStakes): CashMoneyAgg {
  return {
    stakes,
    sessions: 0,
    net: 0,
    staked: 0,
    avgBuyIn: 0,
    avgNet: 0,
    roi: null,
    best: null,
    worst: null,
    netPerHour: null,
  };
}

/**
 * Roll one player's nights up.
 *
 * The streak walk needs OLDEST FIRST so the run it ends on is the current one,
 * and it counts across both stakes deliberately: finishing up three nights
 * running is three nights running whether the third was for real money.
 * A break-even night ends a winning streak, because the streak counts nights
 * finishing UP and even is not up.
 */
export function aggregateCashNights(nights: CashNight[]): CashLifetimeAgg {
  const ordered = [...nights].sort((a, b) => a.at - b.at);

  const money: Record<CashStakes, CashMoneyAgg> = {
    real: emptyMoney("real"),
    play: emptyMoney("play"),
  };
  const perStakesMinutes: Record<CashStakes, number> = { real: 0, play: 0 };

  let upNights = 0;
  let rebuys = 0;
  let nightsWithRebuy = 0;
  let minutes = 0;
  let banked = 0;
  let streak = 0;
  let bestStreak = 0;

  for (const n of ordered) {
    // Unified: these are about whether you won, not about what you won.
    if (n.net > 0) {
      upNights++;
      streak++;
      if (streak > bestStreak) bestStreak = streak;
    } else {
      streak = 0;
    }
    rebuys += n.rebuys;
    if (n.rebuys > 0) nightsWithRebuy++;
    if (n.minutes) minutes += n.minutes;
    if (n.banker) banked++;

    // Split: adding a real net to a play net produces a meaningless number.
    const m = money[n.stakes === "play" ? "play" : "real"];
    m.sessions++;
    m.net += n.net;
    m.staked += n.totalIn;
    if (m.best === null || n.net > m.best) m.best = n.net;
    if (m.worst === null || n.net < m.worst) m.worst = n.net;
    if (n.minutes) perStakesMinutes[n.stakes === "play" ? "play" : "real"] += n.minutes;
  }

  for (const key of ["real", "play"] as CashStakes[]) {
    const m = money[key];
    if (m.sessions > 0) {
      m.avgBuyIn = Math.round(m.staked / m.sessions);
      m.avgNet = Math.round(m.net / m.sessions);
    }
    m.roi = m.staked ? m.net / m.staked : null;
    const mins = perStakesMinutes[key];
    m.netPerHour = mins ? Math.round((m.net * 60) / mins) : null;
  }

  const sessions = ordered.length;
  return {
    sessions,
    upNights,
    winRate: sessions ? upNights / sessions : 0,
    streak,
    bestStreak,
    rebuys,
    rebuyRate: sessions ? nightsWithRebuy / sessions : 0,
    minutes,
    banked,
    money: { real: money.real, play: money.play },
  };
}

// ---------- the same nights, sliced by MODIFIER ----------
//
// "Are we actually worse with Silence on?" is the one question the modifier
// deck creates and nothing else can answer, and it costs nothing to answer:
// the ids are already on every participant row beside that player's net.
//
// THE UNIT IS THE PLAYER, not the crew. A crew-wide net per modifier would read
// as zero on every player-banked night (the table is zero-sum by construction,
// which is the whole point of the balance check), so the only honest grain for
// money is one person's own nights.
//
// AND IT IS CORRELATION, NOT CAUSE. The app never applies a modifier's effect
// (see modifiers.ts), so this cannot claim the card did anything; it reports
// how the nights that carried it actually went. Three nights is three nights.
// The panel says so out loud rather than letting a 100% win rate off one night
// look like a finding.

/** One player's record with one card live. Everything CashLifetimeAgg carries. */
export interface CashModifierPlayerAgg extends CashLifetimeAgg {
  userId: string;
  name: string;
}

export interface CashModifierAgg {
  id: string;
  /** PLAYER-nights: one per person per night the card was live. */
  nights: number;
  /** How many of those finished up. */
  up: number;
  winRate: number;
  /** Busiest first, so the rows with something to say are at the top. */
  players: CashModifierPlayerAgg[];
}

/**
 * Roll every player's nights up per modifier.
 *
 * Reuses aggregateCashNights on the FILTERED subset rather than re-deriving
 * anything, so a per-modifier row is the same shape, the same stakes split and
 * the same arithmetic as a lifetime row: there is no second definition of
 * "win rate" to drift.
 *
 * A card nobody has played with is simply absent: the deck is display data and
 * this is history, so listing every unplayed card would be twenty-four empty
 * rows on a panel whose whole job is the ones with something in them.
 */
export function aggregateByModifier(
  players: { userId: string; name: string; nights: CashNight[] }[],
): CashModifierAgg[] {
  const byId = new Map<string, CashModifierAgg>();

  for (const p of players) {
    // One pass to find which cards this player has any history with, so the
    // filter below runs once per card they actually played rather than once
    // per card in the deck.
    const seen = new Set<string>();
    for (const n of p.nights) for (const id of n.modifiers ?? []) seen.add(id);

    for (const id of seen) {
      const mine = p.nights.filter((n) => (n.modifiers ?? []).includes(id));
      const agg = aggregateCashNights(mine);
      const row = byId.get(id) ?? { id, nights: 0, up: 0, winRate: 0, players: [] };
      row.nights += agg.sessions;
      row.up += agg.upNights;
      row.players.push({ userId: p.userId, name: p.name, ...agg });
      byId.set(id, row);
    }
  }

  const out = [...byId.values()];
  for (const row of out) {
    row.winRate = row.nights ? row.up / row.nights : 0;
    row.players.sort(
      (a, b) => b.sessions - a.sessions || b.winRate - a.winRate || a.name.localeCompare(b.name),
    );
  }
  // Ties broken by id rather than left to Map order, so the panel does not
  // reshuffle itself between two reads of the same data.
  return out.sort((a, b) => b.nights - a.nights || a.id.localeCompare(b.id));
}

/**
 * How to order a leaderboard when one player's totals are in dollars and
 * another's are in play chips: REAL MONEY FIRST, always, and play money only
 * breaks a tie between people who have never played for real. Anything else
 * would let a big play-money night outrank an actual one.
 */
export function compareCashLifetime(a: CashLifetimeAgg, b: CashLifetimeAgg): number {
  if (a.money.real.sessions > 0 || b.money.real.sessions > 0) {
    if (b.money.real.net !== a.money.real.net) return b.money.real.net - a.money.real.net;
  }
  if (b.money.play.net !== a.money.play.net) return b.money.play.net - a.money.play.net;
  return b.sessions - a.sessions;
}

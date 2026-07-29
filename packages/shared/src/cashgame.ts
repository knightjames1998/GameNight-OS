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
// Dollars exist only at the two EDGES — parseCents() turns typed text into
// cents on the way in, formatCents() turns cents into text on the way out.
// Nothing in between ever holds a decimal.
// ---------------------------------------------------------------------------
//
// WHY PLACEMENT IS DERIVED. These packs feed the existing matches /
// match_participants ledger with no schema change and no change to stats.ts at
// all: rank the players by net, descending, and that IS the placement every
// other pack already writes. Money never becomes a ledger column; it rides in
// match_participants.meta. That is the whole reason this shape was chosen, so
// resist adding a money column later — the leaderboard, the rivalry pages, the
// recap card and the profile aggregates all work today because a cash night
// looks exactly like any other night to the reader.

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

/** "$1,234.56" / "-$12.50". The only place cents become a decimal. */
export function formatCents(cents: number): string {
  const n = Math.trunc(cents);
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}$${whole}.${frac}`;
}

/** "+$12.50" / "-$12.50" / "$0.00". For a net, where the sign is the point. */
export function formatCentsSigned(cents: number): string {
  const n = Math.trunc(cents);
  if (n === 0) return "$0.00";
  return n > 0 ? `+${formatCents(n)}` : formatCents(n);
}

/** "$40" when the cents are round, "$12.50" when they are not. Compact UI. */
export function formatCentsShort(cents: number): string {
  const n = Math.trunc(cents);
  if (n % 100 !== 0) return formatCents(n);
  const neg = n < 0;
  const whole = Math.floor(Math.abs(n) / 100).toLocaleString("en-US");
  return `${neg ? "-" : ""}$${whole}`;
}

// ---------- the table ----------

/**
 * Who is the house for this session, chosen by the host at start.
 *
 * "player": a crew member banks. Their net is the exact inverse of everyone
 * else's, the table must sum to zero, and the balance check below applies.
 * "casino": a real casino banks. Every net is independent, nobody is derived,
 * and there is nothing to check — the money that left the table went to a
 * building, not to another line on the screen.
 */
export type CashBank = "player" | "casino";

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
 * inverse of everyone else's — typing it in could only ever introduce a
 * disagreement. So it is computed: -(sum of every other player's net). Live,
 * that sum covers only the players who have already cashed out, which is
 * exactly the banker's realised position so far.
 *
 * THE BALANCE CHECK, and what it is actually checking. Because the banker's
 * net is derived, the table sums to zero by construction and there would be
 * nothing to verify — unless the banker ALSO counts their own rack, which is
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

  // Two conditions, both necessary: a player must be banking (a casino table
  // has no second side), and that banker must have counted their own rack (an
  // absent count is not a count of zero, and treating it as one would report
  // every table where the players finished up as broken).
  const balance: CashBalance =
    bankerId === null || !bankerCashedOut
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
 * tiny — everything interesting already happened in settleCash, and this is
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
  bank: CashBank,
  bankerId: string | null,
  extraMeta?: (playerId: string) => Record<string, unknown>,
): CashLedgerLine[] {
  return settlement.lines.map((l) => {
    const meta: Record<string, unknown> = {
      bank,
      buyIn: l.buyIn,
      rebuys: l.rebuys,
      rebuyTotal: l.rebuyTotal,
      totalIn: l.totalIn,
      cashOut: l.cashOut ?? 0,
      net: l.net ?? 0,
    };
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
 * been told — the app records what a home game did, it does not referee it.
 */
export function balanceWarning(balance: CashBalance): string | null {
  if (!balance.checked || balance.balanced) return null;
  const over = balance.delta > 0;
  return `The table does not balance, off by ${formatCents(Math.abs(balance.delta))}. ${
    over
      ? "More was cashed out than was bought in, so a cash-out is too high."
      : "Less was cashed out than was bought in, so a cash-out is too low or one is missing."
  }`;
}

// ---------- the night, as every casino screen reads it ----------
//
// Every pack in the group renders the same money board — on a phone and on a
// TV — and every one needs the same object to do it. The ONLY thing that
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
    players,
    totalIn: settlement.totalIn,
    totalOut: settlement.totalOut,
    onTable: settlement.onTable,
    stillIn: settlement.stillIn,
    cashedOut: players.length - settlement.stillIn,
    events: detail.total,
    balance: settlement.balance,
    // Null until the banker has counted their own rack, which is the moment
    // there is anything to disagree with. See settleCash's balance rules.
    warning: balanceWarning(settlement.balance),
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
  /** ISO. Start of play, so net-per-hour is derivable at completion. */
  startedAt: string;
  /** cents. Prefilled on the buy-in and rebuy controls; not a rule. */
  defaultBuyIn: number;
  /** The live tracker. OFF by default; the host may flip it mid-session. */
  tracker: boolean;
  /** Standing rule 1: only owners/admins record unless the host opens it. */
  openScoring: boolean;
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
  roster: CashPlayer[];
  defaultBuyIn: number;
  /** playerId -> that player's own opening buy-in, in cents. */
  buyIns?: Record<string, number>;
  tracker?: boolean;
}): CashPackState {
  const buy = Math.max(0, Math.trunc(opts.defaultBuyIn));
  return {
    sessionKey: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    bank: opts.bank,
    // A host who picks a banker, changes their mind and goes casino-banked
    // must not leave a derived line behind, so this is cleared rather than
    // remembered.
    bankerId: opts.bank === "player" ? opts.bankerId : null,
    startedAt: new Date().toISOString(),
    defaultBuyIn: buy,
    tracker: opts.tracker ?? false,
    openScoring: false,
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

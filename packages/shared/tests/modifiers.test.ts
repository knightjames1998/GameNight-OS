// Tests for the modifier deck (packages/shared/src/modifiers.ts).
//
// TWO KINDS OF ASSERTION HERE, the same split packs.test.ts uses.
//
// 1. THE SHIPPED IDS, pinned to the exact strings written into the ledger. A
//    modifier id is on the never-change list for the same reason `ledger` and
//    `keyPrefix` are: renaming one does not error, it silently orphans every
//    stat built on it and that card's history simply vanishes from the panel.
//    A test that only checked the deck against itself would be worthless for
//    exactly that.
// 2. THE DRAW, which is the part with behaviour. It is written to be reused by
//    Casino Run (escalating draws on clearing a quota, a forced bane on missing
//    one, a hand of three for draft mode), so the awkward cases — asking for
//    more than exists, a filter that empties the pool, a weighting that zeroes
//    it — are the ones worth pinning now rather than when that session hits
//    them.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODIFIERS,
  appliesToPack,
  drawForPack,
  drawModifiers,
  drawWeight,
  modifierById,
  modifierName,
  modifierRule,
  modifiersFor,
  sanitizeModifierIds,
  severityPips,
  SEVERITY_LABEL,
  type Modifier,
} from "../src/index.js";

// ---------- 1. the shipped ids ----------

/**
 * Transcribed by hand from the deck as it shipped on 2026-07-30. Changing the
 * deck without changing this is the point; changing BOTH to match a rename is
 * the failure this cannot catch, which is why the blast radius is spelled out
 * in the file header and above.
 */
const SHIPPED_IDS = [
  // The "any" pool, rewritten on 2026-08-02 to be about THE MONEY AND THE
  // TOTALS. Six cards were retired in that pass — loser_buys, bust_penalty,
  // silence, phones_down, last_to_sit and high_roller — because they policed
  // the room rather than the board, and one of them ("pays the table a
  // forfeit") never said what it cost. RETIRED IDS ARE NOT REUSED: a run
  // recorded under one still has rows, and modifierName renders an unknown id
  // as itself so that history stays readable.
  "escalating_min",
  "everyone_antes",
  "leader_tax",
  "house_rake",
  "ante_surge",
  "losses_double",
  "min_bet_up",
  "pot_tithe",
  "dealers_choice",
  "mercy_chip",
  "call_your_shot",
  "hot_streak",
  "free_round",
  "underdog_bonus",
  "insurance",
  "bank_match",
  "hot_colour",
  "hot_number",
  "neighbours_only",
  "zero_pays_table",
  "no_outside_bets",
  "no_come_bets",
  "pass_line_required",
  "long_hand_bonus",
  "hard_ways_only",
  "come_out_bonus",
  "no_odds",
  "extra_card_up",
  "no_splitting",
  "blackjack_pays_double",
  "stands_all_17",
  "no_doubling",
];

/** Cards deliberately taken OUT. Reusing one of these ids would collide with real history. */
const RETIRED_IDS = ["loser_buys", "bust_penalty", "silence", "phones_down", "last_to_sit", "high_roller"];

test("every shipped modifier id is unchanged", () => {
  // An id lands in match_participants.meta. A rename orphans the card's whole
  // history without erroring anywhere.
  for (const id of SHIPPED_IDS) {
    assert.ok(modifierById(id), `modifier "${id}" is missing or was renamed`);
  }
});

test("the deck holds exactly the shipped cards, and ids are unique", () => {
  const ids = MODIFIERS.map((m) => m.id);
  // Sorted, because the four batches are grouped by pack rather than by when
  // they were added, so a new card lands in the middle of the list.
  assert.deepEqual([...ids].sort(), [...SHIPPED_IDS].sort());
  assert.equal(new Set(ids).size, ids.length, "duplicate modifier id");
});

test("every card is renderable: a name, a one-line rule, a valid kind and severity", () => {
  for (const m of MODIFIERS) {
    assert.ok(m.name.length > 0, m.id);
    assert.ok(m.rule.length > 0, `${m.id} has no rule text`);
    // One line a person can read off a TV. Long enough to be a rule, short
    // enough not to wrap three times at 3vmin.
    assert.ok(m.rule.length <= 80, `${m.id} rule is too long for a TV: ${m.rule.length} chars`);
    assert.ok(!m.rule.includes("\n"), `${m.id} rule is not one line`);
    assert.ok(m.kind === "boon" || m.kind === "bane", m.id);
    assert.ok([1, 2, 3].includes(m.severity), m.id);
  }
});

test("THE DECK IS EXACTLY HALF BOONS, overall and in the any pool", () => {
  // Not decoration, and not aspiration. The first cut shipped 11 boons to 13
  // banes, and the "any" pool — the only pool Casino Run draws from — was 4 to
  // 8, so a co-op run got hurt by its own random draws twice as often as it
  // got helped. Nothing else in the app would have noticed. Both halves are
  // asserted, because fixing only the total would leave the pool skewed.
  assert.equal(MODIFIERS.length, 32);
  assert.equal(MODIFIERS.filter((m) => m.kind === "boon").length, 16, "overall boons");
  assert.equal(MODIFIERS.filter((m) => m.kind === "bane").length, 16, "overall banes");

  const any = MODIFIERS.filter((m) => m.appliesTo === "any");
  assert.equal(any.length, 16, "half the deck should apply to any pack");
  assert.equal(any.filter((m) => m.kind === "boon").length, 8, "any-pool boons");
  assert.equal(any.filter((m) => m.kind === "bane").length, 8, "any-pool banes");

  for (const sev of [1, 2, 3]) {
    assert.ok(MODIFIERS.some((m) => m.severity === sev), `no severity ${sev} card`);
  }
});

test("every pack's own pool has both kinds in it", () => {
  // A pack whose four cards were all banes would make its draws feel like a
  // punishment even with the overall split correct.
  for (const pack of ["blackjack", "roulette", "craps"]) {
    const own = MODIFIERS.filter((m) => m.appliesTo !== "any" && m.appliesTo.includes(pack));
    assert.ok(own.some((m) => m.kind === "boon"), `${pack} has no boon of its own`);
    assert.ok(own.some((m) => m.kind === "bane"), `${pack} has no bane of its own`);
  }
});

test("a retired id is gone from the deck and never reused", () => {
  for (const id of RETIRED_IDS) {
    assert.equal(modifierById(id), undefined, `${id} is still in the deck`);
    // And it still renders, because runs played under it are in the ledger.
    assert.equal(modifierName(id), id);
  }
});

test("every card that mentions money names a real fraction", () => {
  // "Pays a bonus" is not a rule, it is an argument waiting to happen. A card
  // with a {bonus} placeholder must carry the percentage that fills it, and a
  // card carrying a percentage must have somewhere to put it.
  for (const m of MODIFIERS) {
    const hasSlot = m.rule.includes("{bonus}");
    assert.equal(hasSlot, m.bonusPct !== undefined, `${m.id}: placeholder and bonusPct disagree`);
    if (m.bonusPct !== undefined) assert.ok(m.bonusPct > 0, `${m.id}: bonusPct must be positive`);
  }
});

test("the bonus is filled in with a real amount when the table has a stake", () => {
  const card = modifierById("hot_streak")!; // 100% of the stake
  const fmt = (c: number) => `P$${(c / 100).toFixed(2)}`;
  assert.equal(modifierRule(card, { unit: 200, fmt }), "Two wins running pays P$2.00 from the table.");
  // A rising ante makes the card more expensive on its own, which is the whole
  // reason the unit is the ante rather than a fixed number.
  assert.equal(modifierRule(card, { unit: 500, fmt }), "Two wins running pays P$5.00 from the table.");
  // Multiples above 1 work too.
  assert.equal(modifierRule(modifierById("min_bet_up")!, { unit: 200, fmt }), "No bet may be under P$6.00.");
});

test("with no table stake the bonus falls back to a percentage, not a blank", () => {
  // The cash packs' setup screen has no stake typed yet, and a card that read
  // "pays {bonus}" or "pays " would be worse than useless.
  assert.equal(
    modifierRule(modifierById("hot_streak")!),
    "Two wins running pays 100% of the minimum from the table.",
  );
  assert.equal(
    modifierRule(modifierById("call_your_shot")!, { unit: 0 }),
    "Call win or lose before the hand; a correct call pays 50% of the minimum.",
  );
});

test("a card with no bonus comes back untouched", () => {
  const plain = modifierById("no_splitting")!;
  assert.equal(modifierRule(plain, { unit: 200, fmt: (c) => String(c) }), plain.rule);
});

test("the severity pips have a stated meaning", () => {
  // They shipped as three bare dots with no legend, which is decoration.
  assert.equal(severityPips(1), "●○○");
  assert.equal(severityPips(3), "●●●");
  for (const sev of [1, 2, 3] as const) {
    assert.ok(SEVERITY_LABEL[sev].length > 0, `severity ${sev} has no label`);
  }
});

test("an unknown id renders as itself rather than as a blank", () => {
  // A card retired from the deck still has rows in the ledger, and the stats
  // panel has to draw them as SOMETHING.
  assert.equal(modifierName("retired_card"), "retired_card");
  assert.equal(modifierById("retired_card"), undefined);
  assert.equal(modifierName("hot_streak"), "Hot streak");
});

// ---------- appliesTo ----------

test('"any" matches every pack', () => {
  const anyCard = MODIFIERS.find((m) => m.appliesTo === "any")!;
  for (const pack of ["blackjack", "roulette", "craps", "casino_run", "something_new"]) {
    assert.equal(appliesToPack(anyCard, pack), true, pack);
  }
});

test("a pack-specific card matches only its pack", () => {
  const bj = modifierById("no_splitting")!;
  assert.equal(appliesToPack(bj, "blackjack"), true);
  assert.equal(appliesToPack(bj, "roulette"), false);
  assert.equal(appliesToPack(bj, "craps"), false);
});

test("each pack's pool is its own cards plus every any card", () => {
  for (const [pack, own, size] of [
    ["blackjack", ["extra_card_up", "no_splitting", "blackjack_pays_double", "stands_all_17", "no_doubling"], 21],
    ["roulette", ["hot_colour", "hot_number", "neighbours_only", "zero_pays_table", "no_outside_bets"], 21],
    ["craps", ["no_come_bets", "pass_line_required", "long_hand_bonus", "hard_ways_only", "come_out_bonus", "no_odds"], 22],
  ] as const) {
    const pool = modifiersFor(pack);
    assert.equal(pool.length, size, `${pack}: 16 any + its own`);
    for (const id of own) assert.ok(pool.some((m) => m.id === id), `${pack} missing ${id}`);
    // And nothing from another pack leaked in.
    for (const m of pool) assert.equal(appliesToPack(m, pack), true, `${pack} got ${m.id}`);
  }
});

test("a pack with no cards of its own still has the twelve any cards", () => {
  // Which is what Casino Run and poker get on day one.
  const pool = modifiersFor("casino_run");
  assert.equal(pool.length, 16);
  for (const m of pool) assert.equal(m.appliesTo, "any");
});

test("sanitize keeps known ids in deck order and drops the rest", () => {
  assert.deepEqual(
    sanitizeModifierIds(["hot_streak", "retired", "leader_tax", 7, null]),
    ["leader_tax", "hot_streak"], // deck order, not the order given
  );
  assert.deepEqual(sanitizeModifierIds(["hot_streak", "hot_streak"]), ["hot_streak"]);
  assert.deepEqual(sanitizeModifierIds("nonsense"), []);
  assert.deepEqual(sanitizeModifierIds(undefined), []);
  // A RETIRED id is dropped by the same path, so a stale client cannot put one
  // back on a live table.
  assert.deepEqual(sanitizeModifierIds(["silence", "hot_streak"]), ["hot_streak"]);
  // Filtered to a pack, a card from another pack is dropped.
  assert.deepEqual(sanitizeModifierIds(["no_splitting", "hot_streak"], "roulette"), ["hot_streak"]);
  assert.deepEqual(sanitizeModifierIds(["no_splitting", "hot_streak"], "blackjack"), [
    "hot_streak",
    "no_splitting",
  ]);
});

// ---------- the draw ----------

/** A deterministic rng that walks a fixed sequence, so a draw is reproducible. */
const seeded = (seq: number[]) => {
  let i = 0;
  return () => seq[i++ % seq.length]!;
};

test("a draw returns the count asked for, with no duplicates", () => {
  for (let n = 0; n <= 8; n++) {
    const got = drawForPack("blackjack", n);
    assert.equal(got.length, n, `asked for ${n}`);
    assert.equal(new Set(got.map((m) => m.id)).size, got.length, "duplicate drawn");
  }
});

test("a draw never returns a card filtered out", () => {
  // 200 draws, because a weighted pick that occasionally escapes its filter is
  // exactly the bug a single run would miss.
  for (let i = 0; i < 200; i++) {
    for (const pack of ["blackjack", "roulette", "craps"]) {
      for (const m of drawForPack(pack, 4)) {
        assert.equal(appliesToPack(m, pack), true, `${m.id} is not a ${pack} card`);
      }
    }
  }
});

test("excluded cards never come back", () => {
  const exclude = modifiersFor("craps").slice(0, 16).map((m) => m.id);
  for (let i = 0; i < 200; i++) {
    for (const m of drawForPack("craps", 4, { exclude })) {
      assert.ok(!exclude.includes(m.id), `${m.id} was excluded`);
    }
  }
});

test("asking for more than exists returns the WHOLE pool rather than looping", () => {
  // The case a caller hits by accident: "draw 5" when four cards are left.
  const pool = modifiersFor("blackjack");
  const got = drawModifiers({ deck: pool, count: 999 });
  assert.equal(got.length, pool.length);
  assert.deepEqual(new Set(got.map((m) => m.id)), new Set(pool.map((m) => m.id)));
  // And with a filter that leaves four.
  const four = drawForPack("blackjack", 10, {
    exclude: modifiersFor("blackjack").slice(4).map((m) => m.id),
  });
  assert.equal(four.length, 4);
});

test("a filter that empties the pool draws nothing rather than throwing", () => {
  assert.deepEqual(drawModifiers({ deck: MODIFIERS, count: 3, filter: () => false }), []);
  assert.deepEqual(drawModifiers({ deck: [], count: 3 }), []);
  assert.deepEqual(drawModifiers({ deck: MODIFIERS, count: 0 }), []);
  assert.deepEqual(drawModifiers({ deck: MODIFIERS, count: -5 }), []);
});

test("severity weights the draw: flavour cards come up more than night-changing ones", () => {
  assert.equal(drawWeight({ severity: 1 } as Modifier), 1);
  assert.equal(drawWeight({ severity: 3 } as Modifier), 1 / 3);

  // Over enough single-card draws from a pool of one sev-1 and one sev-3, the
  // gentle card should win roughly three times as often. Deterministic rng so
  // this cannot flake.
  const deck = [
    { id: "a", name: "a", rule: "a", kind: "boon", severity: 1, appliesTo: "any" },
    { id: "b", name: "b", rule: "b", kind: "bane", severity: 3, appliesTo: "any" },
  ] as Modifier[];
  let easy = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const r = seeded([i / N]);
    if (drawModifiers({ deck, count: 1, random: r })[0]!.id === "a") easy++;
  }
  // Weights are 1 and 1/3, so the sev-1 card owns 3/4 of the range.
  assert.ok(easy / N > 0.6 && easy / N < 0.9, `sev-1 share was ${easy / N}`);
});

test("a caller can override the weighting, which is how Casino Run escalates", () => {
  // Reaching for higher severities as the floors climb is just a different
  // weight function, which is why the draw takes one rather than hard-coding
  // the setup case.
  const deck = modifiersFor("blackjack");
  for (let i = 0; i < 50; i++) {
    const got = drawModifiers({ deck, count: 3, weight: (m) => (m.severity === 3 ? 1 : 0) });
    for (const m of got) assert.equal(m.severity, 3, `${m.id} is severity ${m.severity}`);
  }
});

test("a weighting that zeroes the whole pool still draws, uniformly", () => {
  // Otherwise a caller who over-narrows gets an infinite loop instead of an
  // answer. Drawing something is the safe failure here.
  const got = drawModifiers({ deck: modifiersFor("craps"), count: 3, weight: () => 0 });
  assert.equal(got.length, 3);
  assert.equal(new Set(got.map((m) => m.id)).size, 3);
});

test("a forced BANE draw is a filter, not a second function", () => {
  // Casino Run's loan shark on missing a quota.
  for (let i = 0; i < 100; i++) {
    const got = drawModifiers({
      deck: modifiersFor("roulette"),
      count: 2,
      filter: (m) => m.kind === "bane",
    });
    assert.equal(got.length, 2);
    for (const m of got) assert.equal(m.kind, "bane");
  }
});

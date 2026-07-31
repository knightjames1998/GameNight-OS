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
  modifiersFor,
  sanitizeModifierIds,
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
  "escalating_min",
  "everyone_antes",
  "loser_buys",
  "dealers_choice",
  "bust_penalty",
  "leader_tax",
  "mercy_chip",
  "call_your_shot",
  "silence",
  "phones_down",
  "last_to_sit",
  "high_roller",
  "hot_colour",
  "hot_number",
  "neighbours_only",
  "zero_pays_table",
  "no_come_bets",
  "pass_line_required",
  "long_hand_bonus",
  "hard_ways_only",
  "extra_card_up",
  "no_splitting",
  "blackjack_pays_double",
  "stands_all_17",
];

test("every shipped modifier id is unchanged", () => {
  // An id lands in match_participants.meta. A rename orphans the card's whole
  // history without erroring anywhere.
  for (const id of SHIPPED_IDS) {
    assert.ok(modifierById(id), `modifier "${id}" is missing or was renamed`);
  }
});

test("the deck holds exactly the shipped cards, and ids are unique", () => {
  const ids = MODIFIERS.map((m) => m.id);
  assert.deepEqual(ids, SHIPPED_IDS);
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

test("the deck is the mix it was designed to be", () => {
  // Not decoration: a deck that drifted to all-banes or all-severity-1 would
  // make both the draw and the night boring, and nothing else would notice.
  assert.equal(MODIFIERS.length, 24);
  const any = MODIFIERS.filter((m) => m.appliesTo === "any");
  assert.equal(any.length, 12, "half the deck should apply to any pack");
  for (const sev of [1, 2, 3]) {
    assert.ok(MODIFIERS.some((m) => m.severity === sev), `no severity ${sev} card`);
  }
  assert.ok(MODIFIERS.some((m) => m.kind === "boon"));
  assert.ok(MODIFIERS.some((m) => m.kind === "bane"));
});

test("an unknown id renders as itself rather than as a blank", () => {
  // A card retired from the deck still has rows in the ledger, and the stats
  // panel has to draw them as SOMETHING.
  assert.equal(modifierName("retired_card"), "retired_card");
  assert.equal(modifierById("retired_card"), undefined);
  assert.equal(modifierName("silence"), "Silence");
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
  for (const [pack, own] of [
    ["blackjack", ["extra_card_up", "no_splitting", "blackjack_pays_double", "stands_all_17"]],
    ["roulette", ["hot_colour", "hot_number", "neighbours_only", "zero_pays_table"]],
    ["craps", ["no_come_bets", "pass_line_required", "long_hand_bonus", "hard_ways_only"]],
  ] as const) {
    const pool = modifiersFor(pack);
    assert.equal(pool.length, 16, `${pack}: 12 any + 4 own`);
    for (const id of own) assert.ok(pool.some((m) => m.id === id), `${pack} missing ${id}`);
    // And nothing from another pack leaked in.
    for (const m of pool) assert.equal(appliesToPack(m, pack), true, `${pack} got ${m.id}`);
  }
});

test("a pack with no cards of its own still has the twelve any cards", () => {
  // Which is what Casino Run and poker get on day one.
  const pool = modifiersFor("casino_run");
  assert.equal(pool.length, 12);
  for (const m of pool) assert.equal(m.appliesTo, "any");
});

test("sanitize keeps known ids in deck order and drops the rest", () => {
  assert.deepEqual(
    sanitizeModifierIds(["silence", "retired", "loser_buys", 7, null]),
    ["loser_buys", "silence"], // deck order, not the order given
  );
  assert.deepEqual(sanitizeModifierIds(["silence", "silence"]), ["silence"]);
  assert.deepEqual(sanitizeModifierIds("nonsense"), []);
  assert.deepEqual(sanitizeModifierIds(undefined), []);
  // Filtered to a pack, a card from another pack is dropped.
  assert.deepEqual(sanitizeModifierIds(["no_splitting", "silence"], "roulette"), ["silence"]);
  assert.deepEqual(sanitizeModifierIds(["no_splitting", "silence"], "blackjack"), [
    "silence",
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
  const exclude = modifiersFor("craps").slice(0, 12).map((m) => m.id);
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

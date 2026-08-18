// CHARACTERIZATION of the two things the tournament-roster work is about to
// move: what an entrant parses to, and what a seed places at.
//
// Written BEFORE any behaviour changed, and every number in it was captured by
// RUNNING the current engine rather than reasoned out by hand. That distinction
// is the whole point of the file. A hand-written expectation pins what somebody
// believed on the day; a captured one pins what the code actually did, which is
// the thing a refactor has to preserve. The bracket engine has one caller that
// writes to the lifetime ledger (materialize in apps/server/src/brackets.ts) and
// it turns a seed into a placement with no test between the two, so a change
// that shifted the map by one would show up as wrong history months later and
// never as a red run.
//
// WHAT IS PINNED, and why these cases:
//
//   parseEntrants   The legacy bare-userId upgrade is the one that matters:
//                   brackets.entrants is jsonb and rows written before the
//                   member/guest split are still in the table. Nothing migrates
//                   them, so the reader is the migration and it must keep
//                   working forever.
//
//   placements      Five and eight, single and double, played two ways. FIVE
//                   because it is the smallest count with byes in it (three of
//                   them), and byes are where a placement map goes wrong.
//                   EIGHT because it is a full bracket with no byes at all, so
//                   any difference between the two is about byes rather than
//                   about size. CHALK (the better seed always wins) and UPSET
//                   (the worse seed always wins) because chalk alone would pin
//                   an identity map, which is the one shape a broken function
//                   can also produce.
//
// These are the numbers the team-entrant ledger rows get derived from in the
// second half of this session, so they are pinned before anything moves.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GUEST_NAME_MAX,
  MAX_ENTRANTS,
  MIN_ENTRANTS,
  normalizeEntrants,
  parseEntrants,
  type Entrant,
} from "../src/index.js";
import {
  buildStructure,
  computeBracket,
  placements,
  type BracketResults,
} from "../src/bracket.js";

// ---------- parseEntrants ----------

test("parseEntrants upgrades a LEGACY bare userId string to a member", () => {
  // The rows written before the member/guest split. jsonb, never migrated, so
  // this branch is load bearing for as long as those brackets exist.
  assert.deepEqual(parseEntrants(["u1", "u2"]), [
    { kind: "member", userId: "u1" },
    { kind: "member", userId: "u2" },
  ]);
});

test("parseEntrants reads member and guest objects", () => {
  assert.deepEqual(
    parseEntrants([
      { kind: "member", userId: "u1" },
      { kind: "guest", name: "Sam" },
    ]),
    [
      { kind: "member", userId: "u1" },
      { kind: "guest", name: "Sam" },
    ],
  );
});

test("parseEntrants treats an unlabelled object with a userId as a member", () => {
  // Same forgiveness as the bare string, one shape up: a row that carried a
  // userId and no kind is a member, because a guest never had one.
  assert.deepEqual(parseEntrants([{ userId: "u9" }]), [{ kind: "member", userId: "u9" }]);
});

test("parseEntrants drops junk instead of throwing", () => {
  // A reader that throws takes the whole bracket down; a reader that drops
  // loses one slot. Neither is good and the second is survivable, which is why
  // this is the behaviour rather than an accident.
  assert.deepEqual(
    parseEntrants([null, 7, {}, { kind: "guest" }, { kind: "member" }, { kind: "guest", name: "Ok" }]),
    [{ kind: "guest", name: "Ok" }],
  );
  assert.deepEqual(parseEntrants(null), []);
  assert.deepEqual(parseEntrants("nope"), []);
  assert.deepEqual(parseEntrants(undefined), []);
});

// ---------- normalizeEntrants ----------
//
// The pure half of the create route. It is tested WITHOUT a database on
// purpose: everything interesting about a create request (is this a real crew
// member, is this a duplicate, is this too many, how long may a guest name be)
// is a fact about what a bracket is, and burying it behind Drizzle would mean
// the only way to check it was to stand up a schema.

const CREW = new Set(["u1", "u2", "u3"]);
/** The answer, or assert.fail with the sentence it refused with. */
const ok = (v: Entrant[] | string): Entrant[] => {
  if (typeof v === "string") assert.fail(`expected entrants, got the error ${JSON.stringify(v)}`);
  return v;
};

test("normalizeEntrants passes members and guests through in ORDER", () => {
  // Order is the seeding. First in the list is the top seed, which is what the
  // roster screen's drag-free "prefill in RSVP answer order" rule depends on.
  const out = ok(
    normalizeEntrants(
      [
        { kind: "member", userId: "u2" },
        { kind: "guest", name: "Sam" },
        { kind: "member", userId: "u1" },
      ],
      CREW,
    ),
  );
  assert.deepEqual(out, [
    { kind: "member", userId: "u2" },
    { kind: "guest", name: "Sam" },
    { kind: "member", userId: "u1" },
  ]);
});

test("normalizeEntrants REJECTS a userId outside the crew, and never downgrades it", () => {
  // The silent failure this whole change exists to remove. Turning an unknown
  // id into a guest with the same name reads as forgiving and means somebody
  // plays a whole tournament, places, and their record never hears about it.
  const v = normalizeEntrants(
    [{ kind: "member", userId: "u1" }, { kind: "member", userId: "stranger" }],
    CREW,
  );
  assert.equal(typeof v, "string");
  assert.match(String(v), /not in this crew/);
});

test("normalizeEntrants REJECTS the same member twice rather than deduping", () => {
  // The roster screen cannot offer one person twice, so a repeat means the body
  // did not come from that screen. Deduping would silently start a smaller
  // bracket than the host asked for.
  const v = normalizeEntrants(
    [{ kind: "member", userId: "u1" }, { kind: "member", userId: "u1" }],
    CREW,
  );
  assert.equal(typeof v, "string");
  assert.match(String(v), /twice/);
});

test("two guests with the SAME NAME are allowed", () => {
  // Two people called Sam is a real party. They are distinguishable by seed,
  // and guest-link.ts has credited both of them to one member since it shipped.
  const out = ok(
    normalizeEntrants([{ kind: "guest", name: "Sam" }, { kind: "guest", name: "Sam" }], CREW),
  );
  assert.equal(out.length, 2);
});

test("normalizeEntrants trims a guest name and caps its length", () => {
  const out = ok(
    normalizeEntrants(
      [{ kind: "guest", name: "   Sam   " }, { kind: "guest", name: "x".repeat(60) }],
      CREW,
    ),
  );
  assert.deepEqual(out[0], { kind: "guest", name: "Sam" });
  assert.equal(out[1]!.kind === "guest" && out[1]!.name.length, GUEST_NAME_MAX);
});

test("a guest with a blank or whitespace name is refused", () => {
  for (const name of ["", "   ", "\t"]) {
    const v = normalizeEntrants([{ kind: "guest", name }, { kind: "member", userId: "u1" }], CREW);
    assert.equal(typeof v, "string", `${JSON.stringify(name)} was accepted as a guest name`);
  }
});

test("a member entrant with no userId is refused, not treated as a guest", () => {
  const v = normalizeEntrants([{ kind: "member" }, { kind: "member", userId: "u1" }], CREW);
  assert.equal(typeof v, "string");
  assert.match(String(v), /missing their id/);
});

test("normalizeEntrants enforces both ends of the size range", () => {
  const one = normalizeEntrants([{ kind: "member", userId: "u1" }], CREW);
  assert.equal(typeof one, "string");
  assert.match(String(one), new RegExp(`at least ${MIN_ENTRANTS}`));

  const many = Array.from({ length: MAX_ENTRANTS + 1 }, (_, i) => ({ kind: "guest", name: `G${i}` }));
  const over = normalizeEntrants(many, CREW);
  assert.equal(typeof over, "string");
  assert.match(String(over), new RegExp(`at most ${MAX_ENTRANTS}`));

  // And the boundaries themselves pass, so the check is a range rather than an
  // off-by-one that happens to reject the same bodies.
  assert.equal(ok(normalizeEntrants(many.slice(0, MIN_ENTRANTS), CREW)).length, MIN_ENTRANTS);
  assert.equal(ok(normalizeEntrants(many.slice(0, MAX_ENTRANTS), CREW)).length, MAX_ENTRANTS);
});

test("normalizeEntrants refuses anything that is not a list of tagged objects", () => {
  for (const junk of [null, undefined, "u1,u2", 7, { kind: "member", userId: "u1" }]) {
    assert.equal(typeof normalizeEntrants(junk, CREW), "string", `${JSON.stringify(junk)} passed`);
  }
  // A bare userId string is fine on READ (parseEntrants upgrades legacy rows)
  // and is NOT fine on write: an incoming request has a client that can send
  // the tagged shape, and accepting both would make the write path guess.
  assert.equal(typeof normalizeEntrants(["u1", "u2"], CREW), "string");
  assert.equal(typeof normalizeEntrants([{ kind: "player", userId: "u1" }], CREW), "string");
});

test("what normalizeEntrants returns round trips through parseEntrants unchanged", () => {
  // The two halves of the same contract: what the write path accepts is exactly
  // what the read path gives back, so a bracket cannot be stored in a shape its
  // own reader would alter.
  const out = ok(
    normalizeEntrants(
      [{ kind: "member", userId: "u1" }, { kind: "guest", name: "Sam" }, { kind: "member", userId: "u3" }],
      CREW,
    ),
  );
  assert.deepEqual(parseEntrants(JSON.parse(JSON.stringify(out))), out);
});

// ---------- placements ----------

/**
 * Play a bracket to a champion with a deterministic picker, and return the
 * seed-to-placement map the ledger would be written from.
 *
 * The picker sees the two SEEDS rather than the slot letters, so "the better
 * seed wins" is expressible without knowing which side of the card a seed
 * landed on, which is exactly what makes the upset run comparable to the chalk
 * one at every entrant count.
 */
function playTo(
  n: number,
  format: string,
  pick: (aSeed: number, bSeed: number) => "A" | "B",
): { champion: number | null; place: [number, number][] } {
  const structure = buildStructure(format, n);
  const results: BracketResults = {};
  for (let guard = 0; guard < 500; guard++) {
    const c = computeBracket(n, structure, results);
    if (c.championSeed != null) break;
    const open = Object.values(c.matches).filter((m) => m.playable && m.active);
    assert.ok(open.length > 0, "live bracket with no playable match (deadlock)");
    const m = open[0]!;
    const aSeed = m.a.kind === "player" ? m.a.seed : 0;
    const bSeed = m.b.kind === "player" ? m.b.seed : 0;
    results[m.def.id] = pick(aSeed, bSeed);
  }
  const c = computeBracket(n, structure, results);
  return {
    champion: c.championSeed,
    place: [...placements(structure, c).entries()].sort((x, y) => x[0] - y[0]),
  };
}

const chalk = (a: number, b: number): "A" | "B" => (a < b ? "A" : "B");
const upset = (a: number, b: number): "A" | "B" => (a > b ? "A" : "B");

test("placements: 5 entrants, single elim, chalk", () => {
  const r = playTo(5, "single_elim", chalk);
  assert.equal(r.champion, 1);
  assert.deepEqual(r.place, [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
});

test("placements: 5 entrants, single elim, every upset", () => {
  const r = playTo(5, "single_elim", upset);
  assert.equal(r.champion, 5);
  // Seed 3 places 2nd and seed 1 places 3rd, which is the bye structure
  // showing: seeds 1 and 2 both took a bye into round 2 and went out there,
  // one round EARLIER than the round-3 final that decided second.
  assert.deepEqual(r.place, [[1, 3], [2, 4], [3, 2], [4, 5], [5, 1]]);
});

test("placements: 5 entrants, double elim, chalk", () => {
  const r = playTo(5, "double_elim", chalk);
  assert.equal(r.champion, 1);
  assert.deepEqual(r.place, [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
});

test("placements: 5 entrants, double elim, every upset", () => {
  const r = playTo(5, "double_elim", upset);
  assert.equal(r.champion, 5);
  assert.deepEqual(r.place, [[1, 4], [2, 5], [3, 3], [4, 2], [5, 1]]);
});

test("placements: 8 entrants, single elim, chalk", () => {
  const r = playTo(8, "single_elim", chalk);
  assert.equal(r.champion, 1);
  assert.deepEqual(r.place, [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8]]);
});

test("placements: 8 entrants, single elim, every upset", () => {
  const r = playTo(8, "single_elim", upset);
  assert.equal(r.champion, 8);
  assert.deepEqual(r.place, [[1, 5], [2, 6], [3, 7], [4, 8], [5, 3], [6, 4], [7, 2], [8, 1]]);
});

test("placements: 8 entrants, double elim, chalk", () => {
  const r = playTo(8, "double_elim", chalk);
  assert.equal(r.champion, 1);
  assert.deepEqual(r.place, [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8]]);
});

test("placements: 8 entrants, double elim, every upset", () => {
  const r = playTo(8, "double_elim", upset);
  assert.equal(r.champion, 8);
  // Not the mirror of the single-elim upset run, and that is the format doing
  // its job: a winners-bracket loss drops you down rather than ending your
  // night, so the order people are finally eliminated in is a different order.
  assert.deepEqual(r.place, [[1, 7], [2, 8], [3, 5], [4, 6], [5, 4], [6, 3], [7, 2], [8, 1]]);
});

test("a placement map covers every entrant exactly once, 1..N", () => {
  // The property behind the pinned tables. What the ledger relies on is not any
  // one of the maps above, it is that every seed gets exactly one placement and
  // the placements are a permutation of 1..N: that is what makes "one row per
  // entrant with their finishing place" true no matter which way the night went.
  for (const n of [5, 8]) {
    for (const format of ["single_elim", "double_elim"]) {
      for (const pick of [chalk, upset]) {
        const { place } = playTo(n, format, pick);
        assert.equal(place.length, n, `${n} ${format}: not every seed placed`);
        assert.deepEqual(
          place.map(([, p]) => p).sort((a, b) => a - b),
          Array.from({ length: n }, (_, i) => i + 1),
          `${n} ${format}: placements are not 1..${n}`,
        );
      }
    }
  }
});

test("placements is EMPTY while the bracket is still live", () => {
  // The materializer's gate. It only writes rows once championSeed exists, and
  // this is the other half of that: a half-played bracket has no places yet, so
  // an accidental early call writes nothing rather than writing a wrong table.
  const structure = buildStructure("double_elim", 8);
  const computed = computeBracket(8, structure, { W1M0: "A" });
  assert.equal(computed.championSeed, null);
  assert.equal(placements(structure, computed).size, 0);
});

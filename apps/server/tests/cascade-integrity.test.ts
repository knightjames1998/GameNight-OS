// THE CASCADE INTEGRITY RULE, which is a rule about the SCHEMA, and so is
// DERIVED from the schema here rather than listed by hand.
//
// THE RULE: deleting a crew, or an event, must delete every row that points at
// it, in an order no foreign key can refuse. There is no ON DELETE CASCADE
// anywhere in this schema (every foreign key is a plain references()), so the
// cascade is written out by hand in apps/server/src/cascade.ts. That is a
// deliberate choice and it is logged in DECISION LOG, but a hand-written list
// still has to be a CHECKED one, and until this file existed it was neither
// derived from the schema nor compared against it.
//
// WHAT IT COST. game_sessions shipped 2026-07-16 described as "additive, so
// smash_sessions is untouched and Smash keeps working". Additive is true of
// reads and writes and FALSE of deletes: a new child table is a new obligation
// on every hand-written cascade in the app. Neither cascade learned about it,
// and neither had ever learned about smash_sessions either. Both tables declare
// eventId ... .notNull().references(() => events.id), so Postgres refused the
// DELETE FROM events line in both handlers, and because neither handler ran in
// a transaction, the six deletes that had already run were already committed.
// The crew survived, its entire recorded history did not, and the only thing
// the user saw was a 500 they could retry forever.
//
// So the requirement below is COMPUTED. Parse the schema into a foreign key
// graph, take the inbound transitive closure of groups and of events, and
// assert the cascade covers it in a reverse topological order. A table added
// tomorrow with a group_id or an event_id joins the requirement the moment it
// is written, with nobody having to remember this file exists. The next missing
// table is a red gate rather than a foreign key violation halfway through a
// destructive sequence.
//
// NO DATABASE AND NO DRIZZLE STUB, the same reasoning quickplay-parity.test.ts
// and deduction-secrecy.test.ts give: what must hold is a property of the
// SOURCE against the SCHEMA, both of which are text, and a stub would only test
// the stub.
//
// NEGATIVE CONTROLS ARE MANDATORY HERE, the same discipline copy-rules.test.ts
// uses for its four em dash spellings. Every assertion below passes by finding
// NOTHING, so a scan that had quietly stopped matching would pass forever and
// be strictly worse than no scan. The last two tests feed the same parse and
// the same assertions a source with game_sessions removed, and a source that
// deletes matches before match_participants, and prove both go red.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.join(HERE, "../../../packages/db/src/schema.ts");
const CASCADE = path.join(HERE, "../src/cascade.ts");
const read = (abs) => readFileSync(abs, "utf8");

// Which root each exported cascade is FOR. This is the function's definition,
// not its expected contents: everything the function must delete is derived
// from the graph below, and nothing about the required set is written here.
const ROOTS = new Map([
  ["deleteGroupCascade", "groups"],
  ["deleteEventCascade", "events"],
]);

// ---------------------------------------------------------------------------
// The schema parse: drizzle variable -> physical table name, and the foreign
// key edges between physical tables.
// ---------------------------------------------------------------------------

function parseSchema(src) {
  const nameOf = new Map();
  const parentsOf = new Map();

  // Every table block runs from its own `export const x = pgTable(` to the
  // next one, or to the end of the file for the last table.
  const heads = [...src.matchAll(/export const (\w+) = pgTable\(/g)];
  const blocks = heads.map((m, i) => ({
    varName: m[1],
    body: src.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : src.length),
  }));

  // Two passes, so a table that references one declared BELOW it still
  // resolves. Nothing in this schema does today; a schema is not required to
  // stay in dependency order and a parse that assumed it would break silently.
  for (const b of blocks) {
    const named = b.body.match(/pgTable\(\s*"([^"]+)"/);
    if (named) nameOf.set(b.varName, named[1]);
  }
  for (const b of blocks) {
    const self = nameOf.get(b.varName);
    if (!self) continue;
    const parents = new Set();
    for (const m of b.body.matchAll(/references\(\s*\(\)\s*=>\s*(\w+)\.\w+\s*\)/g)) {
      const target = nameOf.get(m[1]);
      if (target && target !== self) parents.add(target);
    }
    parentsOf.set(self, parents);
  }
  return { nameOf, parentsOf };
}

/**
 * Every table that points AT `root`, then everything pointing at those, to
 * fixpoint. The root itself is not included: the caller adds it, because a
 * cascade deletes its own root last and nothing references it by then.
 */
function inboundClosure(root, graph) {
  const closure = new Set();
  for (let grew = true; grew; ) {
    grew = false;
    for (const [table, parents] of graph.parentsOf) {
      if (table === root || closure.has(table)) continue;
      if ([...parents].some((p) => p === root || closure.has(p))) {
        closure.add(table);
        grew = true;
      }
    }
  }
  return closure;
}

// ---------------------------------------------------------------------------
// The cascade parse: exported function -> the ORDERED physical tables it
// deletes. Order matters as much as membership, so this keeps the sequence.
// ---------------------------------------------------------------------------

function parseCascades(src, graph) {
  const out = new Map();
  const heads = [...src.matchAll(/export async function (\w+)\s*\(/g)];
  heads.forEach((m, i) => {
    const body = src.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : src.length);
    const deletes = [];
    for (const d of body.matchAll(/tx\.delete\(\s*(\w+)\s*\)/g)) {
      // An unresolvable name is reported rather than dropped: a delete against
      // something the schema parse never saw is a fault in one of the two
      // parses, and silently skipping it would hide exactly that.
      deletes.push(graph.nameOf.get(d[1]) ?? `UNRESOLVED:${d[1]}`);
    }
    out.set(m[1], deletes);
  });
  return out;
}

function coverage(deleted, required) {
  const got = new Set(deleted);
  return {
    missing: [...required].filter((t) => !got.has(t)).sort(),
    extra: [...got].filter((t) => !required.has(t)).sort(),
  };
}

/**
 * A reverse topological check, derived from the same graph rather than from a
 * hand-written expected order. For every foreign key edge whose BOTH ends are
 * in this sequence, the child has to be gone before the parent.
 */
function orderProblems(deleted, graph) {
  const at = new Map();
  deleted.forEach((t, i) => {
    if (!at.has(t)) at.set(t, i);
  });
  const problems = [];
  for (const [child, parents] of graph.parentsOf) {
    if (!at.has(child)) continue;
    for (const parent of parents) {
      if (!at.has(parent)) continue;
      if (at.get(child) > at.get(parent)) {
        problems.push(
          `${parent} is deleted at step ${at.get(parent) + 1}, before ${child} at step ` +
            `${at.get(child) + 1}, and ${child} still references it`,
        );
      }
    }
  }
  return problems.sort();
}

const graph = parseSchema(read(SCHEMA));
const cascades = parseCascades(read(CASCADE), graph);

// ---------------------------------------------------------------------------
// Controls on BOTH parses, before anything is asserted with them.
// ---------------------------------------------------------------------------

test("the schema parse actually read the schema, so an empty graph cannot pass", () => {
  // Every assertion in this file passes by finding nothing. A parse that
  // returned an empty graph would compute an empty requirement and every
  // cascade would satisfy it, which is the precise failure mode this file
  // exists to prevent in the cascade itself.
  assert.ok(
    graph.nameOf.size >= 14,
    `the schema parse found only ${graph.nameOf.size} tables`,
  );
  for (const [varName, table] of [
    ["groups", "groups"],
    ["events", "events"],
    ["matchParticipants", "match_participants"],
    ["eventAttendance", "event_attendance"],
    ["smashSessions", "smash_sessions"],
    ["gameSessions", "game_sessions"],
  ]) {
    assert.equal(graph.nameOf.get(varName), table, `the schema parse lost ${varName}`);
  }
  // And it reads EDGES, not just names.
  assert.deepEqual(
    [...(graph.parentsOf.get("match_participants") ?? [])].sort(),
    ["groups", "matches", "users"],
    "the schema parse did not read match_participants' foreign keys",
  );
  // Multi-line references() are the shape smash_sessions uses (primaryKey and
  // references on their own lines), and a single-line-only regex would miss it.
  assert.deepEqual(
    [...(graph.parentsOf.get("smash_sessions") ?? [])].sort(),
    ["events", "groups"],
    "the schema parse did not read a multi-line references() chain",
  );
});

test("beerio_sessions and beerio_hof carry no foreign key, which is why they are absent", () => {
  // DECISION, written here so the next reader does not "fix" the cascade by
  // adding them. Both Beerio tables are keyed by a text room code and carry
  // NEITHER group_id NOR event_id, so they cannot block a delete and they hold
  // no lifetime stats (Beerio's durable results are materialized into
  // matches/match_participants like every other pack). They are correctly
  // outside both cascades, and this test is the reason it stays that way: the
  // closure below is computed, so they are excluded by the schema itself
  // rather than by anybody's judgement.
  assert.deepEqual([...(graph.parentsOf.get("beerio_sessions") ?? [])], []);
  assert.deepEqual([...(graph.parentsOf.get("beerio_hof") ?? [])], []);
});

test("the cascade parse found both cascades and read their delete sequences", () => {
  assert.deepEqual(
    [...cascades.keys()].sort(),
    ["deleteEventCascade", "deleteGroupCascade"],
    "cascade.ts does not export exactly the two cascade functions this test knows about",
  );
  for (const [fn, deleted] of cascades) {
    assert.ok(deleted.length >= 5, `${fn} parsed as only ${deleted.length} deletes`);
    assert.deepEqual(
      deleted.filter((t) => t.startsWith("UNRESOLVED:")),
      [],
      `${fn} deletes a table the schema parse never saw`,
    );
  }
});

test("the two closures come out the shape the schema says they do", () => {
  // Not a hand-written list of tables: that would have to be edited every time
  // a legitimate new child table ships, which is the maintenance burden this
  // file exists to remove. These are the structural facts that stay true.
  const groupClosure = inboundClosure("groups", graph);
  const eventClosure = inboundClosure("events", graph);
  assert.ok(groupClosure.size >= 10, `groups' closure came out at ${groupClosure.size}`);
  assert.ok(groupClosure.has("events"), "events must be inside the crew closure");
  for (const t of eventClosure) {
    assert.ok(groupClosure.has(t), `${t} is under an event but not under a crew`);
  }
  // The two tables this session shipped for. Stated explicitly because the
  // whole point is that they are reachable from BOTH roots.
  for (const t of ["game_sessions", "smash_sessions"]) {
    assert.ok(groupClosure.has(t), `${t} is not in the crew closure`);
    assert.ok(eventClosure.has(t), `${t} is not in the event closure`);
  }
  // users is a PARENT of half this schema and must never be dragged in.
  assert.ok(!groupClosure.has("users"), "users must never be inside a cascade closure");
});

// ---------------------------------------------------------------------------
// The rule itself.
// ---------------------------------------------------------------------------

for (const [fn, root] of ROOTS) {
  test(`${fn} DELETES EVERY TABLE THAT POINTS AT ${root}`, () => {
    const deleted = cascades.get(fn) ?? [];
    const required = new Set([...inboundClosure(root, graph), root]);
    const { missing, extra } = coverage(deleted, required);
    assert.deepEqual(
      missing,
      [],
      `${fn} does not delete ${missing.length} table(s) that reference ${root}, directly or ` +
        `through another table. Postgres will refuse the DELETE FROM ${root} and everything ` +
        `already deleted by then is gone. Add them to apps/server/src/cascade.ts, children ` +
        `first:\n  ` + missing.join("\n  "),
    );
    assert.deepEqual(
      extra,
      [],
      `${fn} deletes ${extra.length} table(s) that do not reference ${root} at all. Nothing ` +
        `here can block the delete, so this is destroying rows the cascade has no claim on ` +
        `(see the beerio_sessions note above):\n  ` + extra.join("\n  "),
    );
  });

  test(`${fn} DELETES IN AN ORDER NO FOREIGN KEY CAN REFUSE`, () => {
    const problems = orderProblems(cascades.get(fn) ?? [], graph);
    assert.deepEqual(
      problems,
      [],
      `${fn} deletes a parent row before a child that still points at it:\n  ` +
        problems.join("\n  "),
    );
  });
}

// ---------------------------------------------------------------------------
// The negative controls. Same parse, same assertions, sources built to fail.
// ---------------------------------------------------------------------------

test("the coverage check goes red when a table is dropped from the cascade", () => {
  // The REAL source with game_sessions taken back out, which is exactly the
  // state both cascades were in before this session. If this passes, the
  // coverage assertion above has stopped seeing anything.
  const crippled = read(CASCADE).replace(/^.*tx\.delete\(gameSessions\).*$\n/gm, "");
  assert.notEqual(crippled, read(CASCADE), "the control could not find a line to remove");
  const parsed = parseCascades(crippled, graph);
  for (const [fn, root] of ROOTS) {
    const required = new Set([...inboundClosure(root, graph), root]);
    const { missing } = coverage(parsed.get(fn) ?? [], required);
    assert.deepEqual(
      missing,
      ["game_sessions"],
      `the coverage check did not notice game_sessions missing from ${fn}`,
    );
  }
});

test("the order check goes red when a parent is deleted before its child", () => {
  const backwards = `
export async function deleteGroupCascade(tx, groupId) {
  await tx.delete(matches).where(eq(matches.groupId, groupId));
  await tx.delete(matchParticipants).where(eq(matchParticipants.groupId, groupId));
}
`;
  const parsed = parseCascades(backwards, graph);
  assert.deepEqual(
    parsed.get("deleteGroupCascade"),
    ["matches", "match_participants"],
    "the control source did not parse into the backwards order it is meant to have",
  );
  const problems = orderProblems(parsed.get("deleteGroupCascade") ?? [], graph);
  assert.equal(problems.length, 1, "the order check did not notice the backwards pair");
  assert.match(problems[0], /matches is deleted at step 1, before match_participants/);
});

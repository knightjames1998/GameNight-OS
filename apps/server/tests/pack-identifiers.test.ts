// NO PACK IDENTIFIER IS TYPED OUT ANYWHERE BUT THE REGISTRY.
//
// packages/shared/src/packs.ts exists so that a pack's ledger key, its game
// name, its externalKey prefix and its live-sync type have exactly one spelling
// each. Its own header explains why: all four are silent when wrong. Change or
// mistype a `ledger` and history orphans, a `gameName` and one pack's record
// splits across two leaderboard tabs, a `keyPrefix` and dedupe and undo stop
// matching, a `wsType` and live sync dies with screens simply not updating.
// Nothing throws in any of those cases.
//
// A REGISTRY ONLY HELPS WHILE PEOPLE READ FROM IT. On 2026-08-15 an audit found
// nine sites in the four packs that predate it still writing their own
// identity as literals, including mariokart.ts declaring the registry constant
// for exactly that job and then not using it. This test is what stops that
// coming back. Commit 3.3 cleared the server; this test then immediately found
// eleven more on the client, which is the argument for writing it rather than
// trusting the sweep.
//
// WHAT IS SCANNED, AND WHY IT IS NOT SIMPLY EVERY FIELD. The pack KEY ("smash",
// "mariokart") is deliberately not scanned, and that is a real distinction
// rather than a convenience. A key is a TypeScript property access:
// `SESSION_PACKS.smsah.wsType` does not compile, so the compiler is already the
// guard, and there is no way to name a pack without naming it. The four VALUE
// fields are plain strings the compiler cannot check, which is exactly why
// retyping one is invisible. So a value is scanned unless it is:
//
//   - also a pack key, because then it is unavoidable and already safe
//     (smash, pingpong, blackjack, roulette, craps, boardgame, cardtable,
//     deduction and casinorun all spell their ledger or prefix like their key)
//   - also a registered ledger format, because several packs deliberately use
//     one string for both and the format side is legitimate
//     (boardgame.ts:35, cardtable.ts:28, deduction.ts:90, casinorun.ts:458)
//   - shorter than four characters, because mk / mp / pp / bg / ct / sd are too
//     generic to search for without drowning the result in noise
//
// That leaves 22 values that have no business appearing anywhere else, and the
// two that matter most are in it: every gameName, and every wsType that is not
// a bare pack key.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SESSION_PACKS, SESSION_PACK_KEYS, FORMAT_ORDER } from "@gamenight/shared";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "../../..");
const ROOTS = [path.join(ROOT, "apps/server/src"), path.join(ROOT, "apps/web/src")];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

/**
 * Lines allowed to hold an identifier, by file and exact content.
 *
 * ONE ENTRY, and it earns its place rather than papering over a miss. Casino
 * Run's picker asks which casino game a co-op leg was played at, and its list
 * is ["Blackjack", "Roulette", "Craps", "Other"]. Three of those collide with
 * gameNames and the fourth is not a pack at all, which is the tell: it is a
 * list of TABLES IN A CASINO, stored in session state as a label, and it is not
 * the crew leaderboard's join key wearing a disguise. Deriving it from the
 * registry would be wrong, because "Other" has nowhere to come from and because
 * a fifth casino pack should not silently appear in this picker.
 */
const ALLOWED: { file: string; contains: string; why: string }[] = [
  {
    file: "apps/web/src/casinorun/CasinoRunPage.tsx",
    contains: 'const GAMES = ["Blackjack", "Roulette", "Craps", "Other"]',
    why: "a list of casino tables for a co-op leg's label, including Other, not the leaderboard join key",
  },
];

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

interface Scanned {
  field: "ledger" | "gameName" | "keyPrefix" | "wsType";
  value: string;
  pack: string;
}

/** The identifier values that must never be typed outside the registry. */
function scannedValues(): Scanned[] {
  const keys = new Set<string>(SESSION_PACK_KEYS);
  const formats = new Set(FORMAT_ORDER);
  const out: Scanned[] = [];
  for (const pack of SESSION_PACK_KEYS) {
    for (const field of ["ledger", "gameName", "keyPrefix", "wsType"] as const) {
      const value = SESSION_PACKS[pack][field] as string;
      if (keys.has(value) || formats.has(value) || value.length < 4) continue;
      if (out.some((o) => o.value === value)) continue;
      out.push({ field, value, pack });
    }
  }
  return out;
}

/**
 * Strip comments before matching. A comment naming an identifier is
 * documentation, not a second source of truth, and this repo's comments name
 * them constantly and on purpose. The trailing-comment strip requires
 * whitespace before the slashes so a "https://" inside a string survives.
 */
const stripComments = (line: string): string =>
  /^\s*(\/\/|\*|\/\*)/.test(line) ? "" : line.replace(/\s\/\/.*$/, "");

test("NO PACK IDENTIFIER IS TYPED OUT OUTSIDE THE REGISTRY", () => {
  const values = scannedValues();
  const offenders: string[] = [];

  for (const root of ROOTS) {
    for (const file of sources(root)) {
      const rel = path.relative(ROOT, file);
      readFileSync(file, "utf8").split("\n").forEach((raw, i) => {
        const line = stripComments(raw);
        if (!line) return;
        if (ALLOWED.some((a) => a.file === rel && raw.includes(a.contains))) return;
        for (const v of values) {
          if (line.includes(`"${v.value}"`) || line.includes(`'${v.value}'`)) {
            offenders.push(`  ${rel}:${i + 1}  ${v.pack}.${v.field} = "${v.value}"\n      ${raw.trim().slice(0, 90)}`);
          }
        }
      });
    }
  }

  assert.equal(
    offenders.length,
    0,
    `${offenders.length} site(s) type a pack identifier that has exactly one home in ` +
      `packages/shared/src/packs.ts. Read it from SESSION_PACKS instead. All four of ` +
      `these fields are silent when they disagree: a ledger orphans history, a gameName ` +
      `splits one pack across two leaderboard tabs, a keyPrefix breaks dedupe and undo, ` +
      `and a wsType kills live sync with no error anywhere.\n${offenders.join("\n")}`,
  );
});

// ---------- the scanner's own controls ----------

test("the scan looks at a meaningful set of values, not an empty one", () => {
  const values = scannedValues();
  const byField = (f: string) => values.filter((v) => v.field === f).length;

  // Every gameName is distinctive, so all twelve packs' join keys are covered.
  assert.equal(byField("gameName"), SESSION_PACK_KEYS.length, "a gameName dropped out of the scan");
  // The nine wsTypes that are not a bare pack key. Craps and Casino Run spell
  // theirs as the key and the format respectively, and are covered by neither.
  assert.ok(byField("wsType") >= 9, "wsTypes fell out of the scan");
  // mario_kart and mario_party, the only two ledgers spelled unlike their key.
  assert.ok(byField("ledger") >= 2, "ledgers fell out of the scan");
  assert.ok(values.length >= 20, `only ${values.length} values scanned; there were 22 when written`);
});

test("the scan can actually see an offender, and does not fire on the fix", () => {
  // Negative control, in copy-rules.test.ts's style. The assertion above passes,
  // so a matcher that quietly stopped working would look exactly like the rule
  // still holding.
  const values = scannedValues();
  const gameName = values.find((v) => v.field === "gameName")!;
  const offending = `const TAB = "${gameName.value}";`;
  assert.ok(
    values.some((v) => stripComments(offending).includes(`"${v.value}"`)),
    "the matcher no longer sees a hand-typed gameName",
  );
  const fixed = `const TAB = SESSION_PACKS.${gameName.pack}.gameName;`;
  assert.equal(
    values.some((v) => stripComments(fixed).includes(`"${v.value}"`)),
    false,
    "the matcher fires on a registry read, which would make the rule unsatisfiable",
  );
  // And a comment naming one is documentation, not a violation.
  assert.equal(stripComments(`  // the tab is named "${gameName.value}" by the server`), "");
  assert.equal(stripComments(`  packLabel: string; // e.g. "${gameName.value}"`).includes(gameName.value), false);
});

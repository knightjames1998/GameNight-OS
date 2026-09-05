// EVERY MUTATING ROUTE IS BEHIND THE TELEVISION GATE, OR IS NAMED HERE WITH A
// REASON. A source-shape assertion, in the style of quickplay-parity.test.ts
// and pack-screens.test.ts, and for the same reason those exist: the rule is
// about shape, and the failure is silent.
//
// WHAT GOES WRONG WITHOUT IT. The gate lives inside `saveState` and
// `startSession`, so a pack cannot write without it and a thirteenth pack gets
// it for nothing. That is true TODAY and it is exactly the kind of true that
// stops being true quietly: the day somebody adds a route that updates a
// session row directly, or a second bracket-shaped thing that writes its own
// `updatedAt`, the gate is simply absent there. Nothing errors. The television
// goes back to being stolen, on that one route, and the reproduction in BUGS
// reads as fixed.
//
// SO THE ASSERTION IS AN ALLOWLIST, NOT A SEARCH. Every mutating route either
// reaches the gate or is named below with why it does not, and a new one that
// is neither turns this red. Naming a route here is a deliberate act; forgetting
// to gate one is not.
//
// The pack half is enumerated off SESSION_PACK_KEYS rather than a hand-written
// list, because a hand-written list is the exact failure this file exists to
// prevent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SESSION_PACKS, SESSION_PACK_KEYS } from "@gamenight/shared";
import { gateTv, tvHeldMessage, TvHeldError } from "../src/tv.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "../src");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Every mutating route registration in the server, with the handler text that
 * follows it.
 *
 * The body is taken as "from this registration to the next one", which is
 * coarse and is the right kind of coarse here: it can only ever make a route
 * look MORE gated than it is (by swallowing the next handler), never less, and
 * the negative control below proves the detector still says no to a route that
 * genuinely does not write.
 */
interface Route {
  file: string;
  method: string;
  path: string;
  gated: boolean;
}

const ROUTE_RE = /(\w+)\.(post|put|patch|delete)\(\s*"([^"]+)"/gm;
/**
 * The doors into a write that can move the screen.
 *
 * `loadState` is one of them because that is where the gate actually fires: it
 * is the chokepoint every mutating route passes through FIRST, which is what
 * puts the gate ahead of the ledger write rather than after it. `saveState`
 * asks again (free, the request is already marked) so no future write can slip
 * past. Counting `loadState` changes no route's classification today, which was
 * checked before it was added.
 */
const GATE_CALLS = ["loadState(", "saveState(", "startSession(", "gateTv("];

function routes(): Route[] {
  const out: Route[] = [];
  for (const abs of sources(SERVER).sort()) {
    const src = readFileSync(abs, "utf8");
    const ms = [...src.matchAll(ROUTE_RE)];
    for (const [i, m] of ms.entries()) {
      const end = i + 1 < ms.length ? ms[i + 1]!.index! : src.length;
      const body = src.slice(m.index!, end);
      out.push({
        file: path.basename(abs),
        method: m[2]!.toUpperCase(),
        path: m[3]!,
        gated: GATE_CALLS.some((c) => body.includes(c)),
      });
    }
  }
  return out;
}

const key = (r: Route) => `${r.file} ${r.method} ${r.path}`;

/**
 * The routes that are NOT behind the gate, each with the reason it cannot take
 * the television off a live session. Adding a line here is a decision; a route
 * that belongs to none of these categories fails the run.
 */
const UNGATED: Record<string, string> = {
  // Accounts and crews. No session row, no event, nothing on any screen.
  "auth.ts POST /request-link": "sign-in",
  "auth.ts POST /verify-code": "sign-in",
  "auth.ts POST /verify": "sign-in",
  "auth.ts POST /logout": "sign-in",
  "auth.ts PATCH /password": "account",
  "auth.ts PATCH /me": "account",
  "groups.ts POST /": "crew admin",
  "groups.ts POST /:code": "crew admin",
  "groups.ts PATCH /:id": "crew admin",
  "groups.ts DELETE /:id": "crew admin",
  "groups.ts PATCH /:id/members/:userId/role": "crew admin",
  "groups.ts DELETE /:id/members/me": "crew admin",
  "groups.ts DELETE /:id/members/:userId": "crew admin",

  // The night itself, and who is at it. None of these touch a session's
  // updatedAt, so none can change what resolveNow answers.
  "events.ts POST /groups/:groupId/events": "creates the night, plays nothing",
  "events.ts PATCH /events/:id": "event details",
  "events.ts DELETE /events/:id": "deletes the night and everything on it",
  "events.ts POST /events/:id/rsvp": "who is coming",
  "events.ts POST /events/:id/attendance": "who showed up",

  // Writes the ledger, never a session row: the guest backfill adds
  // match_participants to matches that already exist.
  "guest-link.ts POST /groups/:id/guest-link/preview": "reads only, writes nothing",
  "guest-link.ts POST /groups/:id/guest-link/confirm": "ledger rows, no session",

  // Quick play mints an event and stops (see quickplay-parity.test.ts). A
  // brand-new event has nothing on its television to take.
  "quickplay.ts POST /quickplay/tournament": "creates a fresh event, nothing live on it",
  "quickplay.ts POST /quickplay/bracket": "deprecated, kept to answer politely",

  // The one bracket write that changes no timestamp, so it cannot re-rank
  // anything: openScoring does not set updatedAt.
  "brackets.ts PATCH /brackets/:id/settings": "does not touch updatedAt",

  // BEERIO IS OUT OF SCOPE FOR THIS GATE, ON PURPOSE AND WITH A FOLLOW-UP.
  // Its sync is a debounced whole-state PUT with no discrete write to gate, the
  // endpoint is public and has no user to ask, and the client is a vendored
  // port called unmodified: "cancel" there would desync the room rather than
  // cancel anything. Opening a room CAN take the screen, and that is the known
  // hole; it closes when Beerio moves onto createPackRuntime. See BACKLOG.
  "beerio.ts POST /sessions": "vendored public sync, out of scope",
  "beerio.ts PUT /sessions/:code": "vendored public sync, out of scope",
  "beerio.ts PUT /sessions/:code/predictions/:sid": "vendored public sync, out of scope",
  "beerio.ts POST /hof": "hall of fame, not a session",
  "beerio.ts PUT /hof/:code": "hall of fame, not a session",
  "beerio-gn.ts POST /events/:eventId/beerio-session": "opens a Beerio room; KNOWN HOLE, see BACKLOG",
  "beerio-gn.ts POST /beerio-complete": "ends a Beerio room, which cannot take the screen",
};

// ---------- controls on the scan, before anything is asserted with it ----------

test("the route scan reaches real files and finds real routes", () => {
  // Two of the assertions below pass by finding nothing unexpected. A scan that
  // walked an empty directory would pass them forever, which is the failure
  // this repo has been bitten by more than once.
  const files = sources(SERVER);
  assert.ok(files.length > 25, `the server scan found only ${files.length} files`);
  const all = routes();
  assert.ok(all.length > 60, `the scan found only ${all.length} mutating routes`);
  assert.ok(
    all.some((r) => r.file === "smash.ts") && all.some((r) => r.file === "brackets.ts"),
    "the scan missed a file it must cover",
  );
});

test("the detector can see BOTH answers, so neither is vacuous", () => {
  const all = routes();
  const gated = all.filter((r) => r.gated);
  const ungated = all.filter((r) => !r.gated);
  // If everything read as gated the allowlist below would be untested; if
  // nothing did, the main assertion would be trivially satisfiable by an empty
  // allowlist. Both halves have to be non-empty for either to mean anything.
  assert.ok(gated.length > 30, `only ${gated.length} routes read as gated`);
  assert.ok(ungated.length > 5, `only ${ungated.length} routes read as ungated`);
  // And a specific known one of each, so the detector is not just counting.
  assert.ok(
    gated.some((r) => r.file === "smash.ts" && r.path === "/smash/:eventId/record"),
    "the Smash record route should read as gated",
  );
  assert.ok(
    ungated.some((r) => r.file === "auth.ts" && r.path === "/logout"),
    "logout should read as ungated",
  );
});

// ---------- the rule ----------

test("EVERY MUTATING ROUTE IS GATED OR NAMED, with no stale names left behind", () => {
  const all = routes();
  const missing = all.filter((r) => !r.gated && !(key(r) in UNGATED)).map(key);
  assert.deepEqual(
    missing,
    [],
    `these mutating routes reach neither the gate nor the allowlist:\n  ${missing.join("\n  ")}`,
  );

  // The allowlist must not rot either: a name left behind after its route is
  // deleted or gated is a line that reads like a decision and is not one.
  const live = new Set(all.filter((r) => !r.gated).map(key));
  const stale = Object.keys(UNGATED).filter((k) => !live.has(k));
  assert.deepEqual(stale, [], `these allowlist entries no longer match any ungated route:\n  ${stale.join("\n  ")}`);
});

test("EVERY SESSION PACK HAS A GATED WRITE, enumerated off the registry", () => {
  // The pack half, off SESSION_PACK_KEYS rather than a hand-written list, so a
  // thirteenth pack is covered on the day it is registered.
  //
  // A pack's routes do not all live in a file named after it: the four cash
  // packs share casino-runtime.ts and the two title-night packs share
  // titlenight-runtime.ts. So the assertion is that the pack's OWN file exists
  // and that the pack reaches the runtime, which is where the gate is.
  const files = new Set(sources(SERVER).map((f) => path.basename(f)));

  /**
   * Does this file reach createPackRuntime, itself or through one of the local
   * modules it imports?
   *
   * ONE HOP, FOLLOWED RATHER THAN GUESSED AT. An earlier version of this test
   * listed the factory names ("casinoRoutes", "titleNightRoutes") and was wrong
   * about both, which is the failure this whole file exists to prevent, one
   * level up: a hand-written list of the things that count.
   */
  const reachesRuntime = (file: string, depth = 1): boolean => {
    const abs = path.join(SERVER, file);
    if (!files.has(file)) return false;
    const src = readFileSync(abs, "utf8");
    if (src.includes("createPackRuntime")) return true;
    if (depth === 0) return false;
    return [...src.matchAll(/from "\.\/([\w.-]+)\.js"/g)].some((m) =>
      reachesRuntime(`${m[1]}.ts`, depth - 1),
    );
  };

  for (const k of SESSION_PACK_KEYS) {
    const file = `${SESSION_PACKS[k].route}.ts`;
    assert.ok(files.has(file), `no server file ${file} for pack ${k}`);
    assert.ok(reachesRuntime(file), `${file} does not reach createPackRuntime, which is where the gate lives`);
  }
  assert.equal(SESSION_PACK_KEYS.length, 12, "a pack was added or removed; confirm it is gated, then update this count");
});

// ---------- the gate's own short circuits, which need no database ----------

test("an already-confirmed write never reads the database", async () => {
  // There is no Postgres in this process, so if `confirmTv` did not short
  // circuit before requireTvConfirm this would reject with a connection error
  // rather than resolving. That is what makes this a real assertion rather
  // than a restatement of the code.
  await gateTv({
    eventId: "e1",
    self: { kind: "pack", pack: "smash" },
    selfName: "Smash Bros",
    req: { method: "POST", body: { confirmTv: true } },
  });
});

test("a write that completes a session never reads the database either", async () => {
  await gateTv({
    eventId: "e1",
    self: { kind: "pack", pack: "smash" },
    selfName: "Smash Bros",
    req: { method: "POST", body: {} },
    skip: true,
  });
});

test("anything other than confirmTv === true is not a confirmation", async () => {
  // A string "true", a 1, or a missing body must all fall through to the check.
  // They cannot be tested for their answer without a database, but they CAN be
  // tested for reaching it: each one rejects here, and a short circuit would
  // resolve.
  for (const body of [{}, null, undefined, { confirmTv: "true" }, { confirmTv: 1 }]) {
    await assert.rejects(
      gateTv({ eventId: "e1", self: { kind: "pack", pack: "smash" }, selfName: "Smash Bros", req: { method: "POST", body } }),
      "a non-confirmation should have fallen through to the database check",
    );
  }
});

test("readState IS PRIVATE, which is what puts the gate ahead of the ledger", () => {
  // THE INVARIANT THE FIX RESTS ON. Several packs materialize the ledger BEFORE
  // they save the session, so a gate that only fired at save time would let a
  // DECLINED write leave a matches row behind, and the next genuine result at
  // that index would reuse it (materializeUnit no-ops on an existing
  // externalKey) and keep the declined placements forever.
  //
  // The gate is in `loadState` instead. `saveState` cannot be called without a
  // Loaded, and a Loaded can only come from `loadState` or from the ungated
  // `readState`, so the whole guarantee is that readState stays private to
  // pack-runtime. Asserted, because "private" here is a convention rather than
  // a language feature.
  const leaked = sources(SERVER)
    .filter((f) => path.basename(f) !== "pack-runtime.ts")
    .filter((f) => readFileSync(f, "utf8").includes("readState"))
    .map((f) => path.basename(f));
  assert.deepEqual(leaked, [], `readState escaped pack-runtime into: ${leaked.join(", ")}`);
  // And it is genuinely there to be leaked, so this cannot pass by typo.
  assert.match(readFileSync(path.join(SERVER, "pack-runtime.ts"), "utf8"), /function readState\(/);
  assert.ok(
    !readFileSync(path.join(SERVER, "pack-runtime.ts"), "utf8").includes("readState(eventId: string, req"),
    "readState must stay the ungated read; the gated one is loadState",
  );
});

test("the refusal carries the holder, and says what BOTH answers do", () => {
  const err = new TvHeldError("Tournament", tvHeldMessage("Tournament", "Mario Kart"));
  assert.equal(err.holder, "Tournament");
  assert.match(err.message, /Tournament/);
  assert.match(err.message, /Mario Kart/);
  // The half a dialog usually leaves out. "No" cancels the write here, which is
  // surprising enough that the copy has to say so; there is nowhere to record a
  // decline, so "record it but leave the screen alone" is not a state this app
  // can be in.
  assert.match(err.message, /nothing is recorded/i);
});

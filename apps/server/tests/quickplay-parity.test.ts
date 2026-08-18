// THE QUICK PLAY PARITY RULE, which is a rule about SHAPE and so is checked
// against the source, the same way pack-screens.test.ts and copy-rules.test.ts
// check theirs.
//
// THE RULE: a quick play route mints context and STOPS. It creates the hidden
// personal crew and a live event, returns the event id, and the client then
// opens the pack's OWN screen at ?event=<id>. Quick play therefore runs the
// identical setup, the identical scoring and the identical materializer a crew
// night runs, and a feature added to a pack screen is in quick play the moment
// it ships, with nobody having to remember to port it.
//
// WHY IT NEEDS A TEST. This held for all twelve session packs by construction
// and was broken for exactly one tile, for months, in a way nothing could see.
// The tournament had a SECOND entrant implementation: /quick, its own page with
// four typed name boxes, POSTing its own bracket-creating endpoint. So when the
// roster screen shipped on 2026-08-17 with crew-member entrants, the member
// versus guest distinction, a seeding shuffle, team entrants, normalizeEntrants
// and an entrant cap, quick play got NONE of them and nothing failed. The
// second path did not error, it just quietly stayed behind.
//
// The repair was structural (delete the second path, 2026-08-18), and a
// structural repair without a check is a structural repair that gets undone by
// the next person who wants "just a simple version". Hence this file.
//
// It is a source-shape assertion, which is unusual in this repo and deliberate
// for the same reason pack-screens.test.ts gives: the alternative is a browser
// run per tile against a stub API, and this catches the same thing on the day
// somebody writes the second screen rather than whenever the harness next runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SESSION_PACKS, SESSION_PACK_KEYS } from "@gamenight/shared";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "../../web/src");
const SERVER = path.join(HERE, "../src");
const read = (abs: string) => readFileSync(abs, "utf8");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

// ---------- the control on the SCAN, before anything is asserted with it ----------

test("the source scan actually reaches the client, so an empty result means something", () => {
  // Three of the assertions below pass by finding NOTHING. A scan that walked
  // an empty directory would pass all of them forever and see no fault at all,
  // which is the exact failure mode this repo has been bitten by twice (the
  // stale tv-fit payload, the unread `rendered` flag). So: prove the walk
  // reaches real files first.
  const files = sources(WEB).map((f) => path.relative(WEB, f));
  assert.ok(files.length > 50, `the client scan found only ${files.length} files`);
  for (const known of ["pages/Home.tsx", "pages/TournamentSetupPage.tsx", "App.tsx"]) {
    assert.ok(files.includes(known), `the client scan did not reach ${known}`);
  }
});

// ---------- the deleted path stays deleted ----------

test("NO CLIENT FILE CALLS /api/quickplay/bracket", () => {
  // The endpoint still EXISTS, deliberately: this is an installed PWA, a phone
  // runs its cached bundle for as long as it likes, and deleting it would mean
  // a host whose start button 404s in front of the room. It is back-compat and
  // nothing more. A client that calls it is a client that has grown a second
  // entrant path again, which is the whole bug.
  const offenders = sources(WEB)
    .filter((f) => read(f).includes("/api/quickplay/bracket"))
    .map((f) => path.relative(WEB, f));
  assert.deepEqual(
    offenders,
    [],
    "a client file calls the deprecated bracket-creating quick play endpoint. Quick play " +
      "mints an event and opens the SHARED setup screen (/tournament?event=...); it does not " +
      "create brackets of its own.\n  " + offenders.join("\n  "),
  );
});

test("the deprecated endpoint is still SERVED, and says why", () => {
  // The other half, and it has to be asserted or a future tidy-up deletes it as
  // dead code, which is the failure this back-compat exists to prevent.
  const src = read(path.join(SERVER, "quickplay.ts"));
  assert.ok(
    src.includes('"/quickplay/bracket"'),
    "POST /quickplay/bracket was removed. It is unused by the app ON PURPOSE and must keep " +
      "answering: a cached bundle on somebody's phone still calls it.",
  );
  assert.ok(
    /DEPRECATED/.test(src),
    "the back-compat endpoint has no comment saying it is one, so the next reader cannot " +
      "tell it from a live design.",
  );
});

/** A client call that POSTs to a `.../bracket` endpoint. */
const CREATES_BRACKET = /\/bracket`?"?,?\s*\{[\s\S]{0,120}method:\s*"POST"/;

test("the bracket-creating pattern can actually see a call", () => {
  // The shape TournamentSetupPage uses, and the shape the deleted quick play
  // page used, so the assertion below cannot pass by matching neither.
  assert.ok(
    CREATES_BRACKET.test('api(`/api/events/${eventId}/bracket`, {\n method: "POST",'),
    "the pattern no longer matches the crew path's own call",
  );
  assert.ok(
    CREATES_BRACKET.test('api("/api/quickplay/bracket", {\n method: "POST",'),
    "the pattern no longer matches the shape the deleted second screen used",
  );
  assert.equal(CREATES_BRACKET.test('api(`/api/brackets/${id}`)'), false, "a plain read matched");
});

test("THERE IS EXACTLY ONE ENTRANT SCREEN, and it is the shared one", () => {
  // The invariant the whole session is about, stated as directly as a source
  // scan can state it: only one client file may create a bracket. Two screens
  // that build entrant lists is the bug, in any spelling.
  const creators = sources(WEB)
    .filter((f) => CREATES_BRACKET.test(read(f)))
    .map((f) => path.relative(WEB, f));
  assert.deepEqual(
    creators,
    ["pages/TournamentSetupPage.tsx"],
    "more (or fewer) than one client screen creates a bracket. Every path into a tournament, " +
      "crew or quick play, goes through TournamentSetupPage so they cannot drift apart.",
  );
});

// ---------- every tile ends at the shared screen ----------

test("EVERY QUICK PLAY TILE ON HOME OPENS THE SAME SCREEN THE CREW PATH DOES", () => {
  const home = read(path.join(WEB, "pages/Home.tsx"));

  // The twelve session packs, through one template built from the registry key,
  // which is what makes the route segment and the quickplay route unable to
  // disagree. Asserted as the template rather than twelve strings, because the
  // template is what guarantees the twelve.
  assert.ok(
    home.includes("navigate(`/${pack}?event=${eventId}${suffix}`)"),
    "Home no longer opens a session pack's own screen at ?event=. Quick play must land on " +
      "the same page a crew night lands on.",
  );

  // And the tournament, which has no registry entry and so is named.
  assert.ok(
    home.includes("navigate(`/tournament?event=${eventId}&format=${format}`)"),
    "Home no longer opens the shared tournament setup screen. It used to send this tile to " +
      "/quick, a second entrant screen, which is exactly the gap this rule exists to close.",
  );

  // Nothing on Home may reach for the deleted bespoke screen again.
  assert.equal(
    /["'`]\/quick[?"'`]/.test(home),
    false,
    "Home links to /quick. That address survives only as a redirect for old shortcuts; a " +
      "tile must go through the shared setup screen directly.",
  );
});

test("the server registers a quick play route for every pack AND for the tournament", () => {
  const src = read(path.join(SERVER, "quickplay.ts"));

  // The packs come from the registry loop, so the check is that the loop is
  // still what registers them rather than a hand-typed list that can go stale.
  assert.ok(
    src.includes("for (const key of SESSION_PACK_KEYS)") &&
      src.includes("`/quickplay/${pack.route}`"),
    "the per-pack quick play routes are no longer built from the registry, so a new pack can " +
      "ship without one, or with one whose spelling disagrees with its page.",
  );

  // The tournament is registered EXPLICITLY, because it is not a pack: it has
  // no registry entry, for the same reason pack-screens.test.ts lists
  // BracketPage.tsx by name.
  assert.ok(
    src.includes('"/quickplay/tournament"'),
    "POST /quickplay/tournament is gone. The tournament is not a session pack, so it is not " +
      "in the loop above and has to be registered by name.",
  );
});

test("every quick play route returns an EVENT ID, never a bracket", () => {
  // The shape that makes parity automatic. A route that returned a created
  // bracket would be minting entrants server-side again, which is how the
  // client stops being able to offer members, guests, seeding and teams.
  const src = read(path.join(SERVER, "quickplay.ts"));
  const handlers = src.split("quickPlayRouter.post(").slice(1);
  assert.ok(handlers.length >= 2, "quickplay.ts registers fewer routes than expected");
  for (const h of handlers) {
    const route = /^[(`"']*([^`"',)]+)/.exec(h)?.[1] ?? "?";
    // The one exception is the frozen back-compat endpoint, which answers with
    // the bracket it has always answered with.
    if (route.includes("/quickplay/bracket")) continue;
    assert.ok(
      /res\.json\(\{\s*eventId/.test(h),
      `${route} does not answer with { eventId }. A quick play route mints context and stops; ` +
        "the client then opens the pack's own screen.",
    );
  }
});

// ---------- what a quick play tournament is called ----------

test("A QUICK PLAY TOURNAMENT CREATES NO GAMES ROW OF ITS OWN", () => {
  // games.name is the lifetime history bucket. The old path inserted a games
  // row named after whatever the host typed, which was harmless only while
  // every entrant was a guest and nothing materialized. Now that the host is a
  // member of their own personal crew and IS credited, a typed name would split
  // their own tournament record across a bucket per phrase, silently.
  //
  // The live path creates no games row at all: the setup screen POSTs the same
  // /api/events/:id/bracket the crew path does, which names it through
  // bracketGameName (pinned in packages/shared/tests/bracket-entrants.test.ts).
  const src = read(path.join(SERVER, "quickplay.ts"));
  const inserts = src.split("db.insert(games)").length - 1;
  assert.equal(
    inserts,
    1,
    "quickplay.ts inserts a games row somewhere other than the single frozen back-compat " +
      "endpoint. A live quick play route must not name a game.",
  );
  const [beforeDeprecated, afterDeprecated] = src.split("DEPRECATED");
  assert.ok(
    !beforeDeprecated!.includes("db.insert(games)") && afterDeprecated!.includes("db.insert(games)"),
    "the one games insert is not inside the deprecated endpoint any more.",
  );
});

test("NO CLIENT SENDS gameName IN A REQUEST BODY", () => {
  // The other half of the same rule: the fallback only holds if nothing
  // overrides it, and the setup screen deliberately has no name box (decision
  // 2026-08-17, because a typed name would split the bucket).
  //
  // Scoped to REQUEST BODIES rather than to the word, because `gameName` is
  // also a perfectly good local variable (CasinoRunPage) and a field the client
  // READS off a recap or a stats payload. Sending one is the thing that splits
  // a history; reading one back cannot.
  const offenders: string[] = [];
  for (const f of sources(WEB)) {
    const src = read(f);
    for (const body of src.match(/JSON\.stringify\(\{[\s\S]{0,400}?\}\)/g) ?? []) {
      if (body.includes("gameName")) offenders.push(path.relative(WEB, f));
    }
  }
  assert.deepEqual(
    [...new Set(offenders)],
    [],
    "a client sends gameName in a request body. Lifetime tournament history buckets on " +
      "games.name, so a typed name splits a crew's own record and nothing errors.\n  " +
      offenders.join("\n  "),
  );
});

test("the gameName check can actually see one", () => {
  // A scan for nothing passes silently forever. The pattern below is the shape
  // the deleted quick play page used, verbatim.
  const sample = 'body: JSON.stringify({ gameName, names, format })';
  const found = (sample.match(/JSON\.stringify\(\{[\s\S]{0,400}?\}\)/g) ?? []).some((b) =>
    b.includes("gameName"),
  );
  assert.ok(found, "the request-body pattern no longer matches the call it was written for");
  // And that a local variable or a read is NOT caught.
  const innocent = 'const gameName = game === "Other" ? other.trim() : game;';
  assert.equal((innocent.match(/JSON\.stringify\(\{[\s\S]{0,400}?\}\)/g) ?? []).length, 0);
});

// ---------- the control on this file ----------

test("the parity check covers every session pack, and did not quietly shrink", () => {
  // Same control pack-screens.test.ts carries: an assertion that scans a list
  // built from the registry is only as good as the list still being complete.
  assert.ok(SESSION_PACK_KEYS.length >= 12, "the session pack registry shrank unexpectedly");
  for (const key of SESSION_PACK_KEYS) {
    assert.equal(
      SESSION_PACKS[key].route,
      key,
      `${key}'s route segment differs from its key, so the one template Home builds cannot ` +
        "serve it and this file's per-pack assertion stops meaning anything.",
    );
  }
});

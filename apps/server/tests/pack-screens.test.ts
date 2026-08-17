// Enforces the "two ways out" standing rule on every pack/tracker screen.
//
// THE RULE: "Every game mode/tracker screen has a BACK button (history-based,
// falls back to home), and a way back to the event it belongs to."
//
// It drifted on NINE screens at once and nothing noticed, because both halves
// look present: a header with a Back button and a TV link reads complete. But
// Back is history-based, so somebody who opened a shared pack link in a fresh
// tab has no history to pop and lands on HOME, and the only other link on the
// screen points at the TV. The night they were sent to is unreachable from the
// screen they were sent to. Four of the nine were fixed on 2026-08-02 with the
// casino group and the other five the same day, once it was clear this was a
// repo-wide gap rather than a casino one.
//
// SO IT IS A TEST RATHER THAN A FIX. A rule that nine screens can quietly break
// is a rule that needs something checking it, and the next pack's header will be
// copied from one of these. This is a source-shape assertion, which is unusual
// here and deliberate: the alternative is a browser check per screen, which
// needs a live session per pack in a stub API, and this catches the same thing
// on the day the file is written rather than whenever someone re-runs the
// harness. It fails loudly with the exact file and what is missing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SESSION_PACKS, SESSION_PACK_KEYS } from "@gamenight/shared";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../web/src");

/**
 * The scoring screen for one pack, found from its ROUTE SEGMENT.
 *
 * Every pack's client directory is named exactly its registry `route`, and
 * holds exactly one non-TV page. So the screen is discovered rather than
 * declared, and a pack that has not got one fails here instead of being absent
 * from a list nobody rechecked.
 *
 * The TV view is excluded on purpose: a television has no navigation and is
 * never the screen somebody arrived on, which is the whole reason the "two ways
 * out" rule is about pack screens rather than about every file.
 */
function screenFor(pack: (typeof SESSION_PACK_KEYS)[number]): string {
  const route = SESSION_PACKS[pack].route;
  const dir = path.join(WEB, route);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    assert.fail(
      `${pack} has no client directory at apps/web/src/${route}. Every session pack ` +
        `ships a scoring screen; see the ADDING A PACK checklist in BACKLOG.md.`,
    );
  }
  const pages = entries.filter((f) => f.endsWith("Page.tsx") && !f.endsWith("TvPage.tsx"));
  assert.equal(
    pages.length,
    1,
    `apps/web/src/${route} holds ${pages.length} non-TV page files (${pages.join(", ") || "none"}); ` +
      `expected exactly one, which is this pack's scoring screen.`,
  );
  return `${route}/${pages[0]}`;
}

/**
 * Every screen a crew scores a night on. Not the TV views, and not the event
 * page itself, which IS the destination.
 *
 * DERIVED FROM THE REGISTRY, NOT LISTED. This was a hand-written array of
 * twelve paths until 2026-08-15, and it was complete on the day it was
 * replaced, which is exactly when to replace it: the list was only ever as good
 * as somebody remembering to add the next pack to it, and the cost of
 * forgetting is that the pack silently is not checked by the one test that
 * checks this rule. Now a new pack is covered the moment it has a registry
 * entry, and a pack without a screen fails rather than going quiet.
 */
const SCREENS = [
  ...SESSION_PACK_KEYS.map(screenFor),
  // The generic bracket, which is a scoring screen with the same obligations
  // and no registry entry: it is not a pack, it is what a pack-less tournament
  // runs on. Explicit for that reason rather than by oversight.
  "pages/BracketPage.tsx",
];

/**
 * Beerio is deliberately absent. It is a vendored 1:1 replica with its own
 * header and its own styled back button, and the standing rule names it as the
 * exception for exactly that reason. Touching it to add a link would break the
 * 1:1 promise, which is a bigger rule than this one.
 */
const EXEMPT = ["beerio/BeerioApp.tsx"];

const read = (rel: string) => readFileSync(path.join(WEB, rel), "utf8");

test("the derived screen list covers every pack, and did not quietly shrink", () => {
  // The control on the derivation. A screenFor that started returning fewer
  // paths would make every assertion below pass by checking less, which is the
  // failure mode a hand-written list at least made visible.
  assert.equal(
    SCREENS.length,
    SESSION_PACK_KEYS.length + 1,
    "one screen per session pack, plus the generic bracket",
  );
  for (const pack of SESSION_PACK_KEYS) {
    const route = SESSION_PACKS[pack].route;
    assert.ok(
      SCREENS.some((s) => s.startsWith(`${route}/`)),
      `${pack} has no scoring screen in the derived list`,
    );
  }
  // And the paths themselves. This was the twelve the hand-written list held on
  // the day it was replaced, so the swap was provably a no-op rather than merely
  // a green run; a pack that ships adds its line here in the same commit, which
  // is the point where "the derivation found one more" becomes a decision rather
  // than a number going up.
  assert.deepEqual([...SCREENS].sort(), [
    "blackjack/BlackjackPage.tsx",
    "boardgame/BoardGamePage.tsx",
    "cardtable/CardTablePage.tsx",
    "casinorun/CasinoRunPage.tsx",
    "craps/CrapsPage.tsx",
    "deduction/DeductionPage.tsx",
    "mariokart/MarioKartPage.tsx",
    "marioparty/MarioPartyPage.tsx",
    "pages/BracketPage.tsx",
    "pingpong/PingPongPage.tsx",
    "poker/PokerPage.tsx",
    "roulette/RoulettePage.tsx",
    "smash/SmashPage.tsx",
  ]);
});

/** A JSX link to the event page: /e/${something}, with no path after it. */
const EVENT_LINK = /<Link\s[^>]*to=\{`\/e\/\$\{[^}]+\}`\}/;

test("every pack screen has a history-based Back button", () => {
  for (const rel of SCREENS) {
    const src = read(rel);
    assert.ok(
      src.includes("<BackButton"),
      `${rel} has no BackButton. Every tracker screen needs the history-based one; see BackButton.tsx.`,
    );
  }
});

test("EVERY PACK SCREEN HAS A WAY BACK TO ITS EVENT, not just to the TV", () => {
  for (const rel of SCREENS) {
    const src = read(rel);
    assert.ok(
      EVENT_LINK.test(src),
      `${rel} links to the TV but not to its event. A shared link opened in a fresh tab has no ` +
        "history, so BackButton sends the visitor home and the night is unreachable. Add " +
        "<Link to={`/e/${eventId}`}> beside the TV link.",
    );
  }
});

test("the event link is the EVENT, not the event's TV", () => {
  // The bug this guards against is subtle: `/e/${eventId}/tv` also matches
  // "there is a link with the event id in it", and the TV is not a way back.
  for (const rel of SCREENS) {
    const src = read(rel);
    const links = src.match(/to=\{`\/e\/\$\{[^}]+\}[^`]*`\}/g) ?? [];
    const plain = links.filter((l) => !l.includes("/tv"));
    assert.ok(
      plain.length > 0,
      `${rel}'s only /e/ links point at the TV: ${links.join(", ")}`,
    );
  }
});

test("no pack screen navigates internally with a raw anchor", () => {
  // The other half of the same standing rule, and it has real consequences on
  // iOS: a full page load in standalone mode opens a new Safari tab and the
  // installed app loses the session.
  for (const rel of [...SCREENS, ...EXEMPT]) {
    const src = read(rel);
    const raw = src.match(/<a\s[^>]*href=["'`]\/[^"'`]*["'`]/g) ?? [];
    assert.deepEqual(raw, [], `${rel} uses a raw <a href> for internal navigation: ${raw.join(", ")}`);
  }
});

// THE PAGE BEHIND EVERY TELEVISION'S QR, and the two ways it fails silently.
//
// 1. IT STOPS BEING PUBLIC. Nothing errors when a public page starts reading an
//    authed endpoint or takes a `me`: it keeps working perfectly for everybody
//    who built it, because they are signed in, and shows a sign-in wall to the
//    guest across the room who is the only person it was built for. Every
//    screenshot in review would look right.
//
// 2. THE LOBBY READ GOES BACK TO SKIPPING MID-GAME. The big screen renders no
//    lobby while a game is up, so the endpoint used to skip those reads then.
//    This page is scanned in exactly that state. The rule that decides it is
//    pure and is tested here; the query half is verified on-device, the same
//    split resolveNow has.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lobbyWanted } from "../src/tv.js";

const read = (rel: string) =>
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), rel), "utf8");
/** Source with comments stripped: a rule about code, not about prose. */
const bare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const page = () => bare(read("../../web/src/pages/EventLivePage.tsx"));

// ---------- it is public ----------

test("THE ROUTE HANDS IT NO IDENTITY", () => {
  const app = bare(read("../../web/src/App.tsx"));
  const route = app.match(/<Route path="\/e\/:id\/live"[^/]*\/>/);
  assert.ok(route, "the /e/:id/live route is gone or no longer a self-closing Route");
  // /e/:id right above it takes me={me}. Passing one here is how a public page
  // acquires an opinion about who is holding it.
  assert.doesNotMatch(route[0], /\bme=/, "the live page was handed a me prop");
});

test("IT READS NOTHING BUT THE PUBLIC TV ENDPOINT", () => {
  const src = page();
  const calls = [...src.matchAll(/api<[^>]*>\(\s*`([^`]*)`/g)].map((m) => m[1]!);
  assert.ok(calls.length > 0, "this test can no longer see how the page fetches");
  for (const c of calls) {
    // Every /api/tv route is mounted public in index.ts. Everything else in
    // this app is behind requireAuth, so a path that is not under /api/tv is a
    // sign-in wall for a guest with a camera.
    assert.ok(c.startsWith("/api/tv/"), `the live page reads ${c}, which is not a public TV route`);
  }
  assert.equal(calls.length, 1, `the live page now makes ${calls.length} reads; it is meant to make one`);
});

test("IT ASKS FOR THE NIGHT SO FAR, which is the only reason it has anything to show mid-game", () => {
  assert.match(page(), /standings=1/);
});

test("EVERY INTERNAL LINK GOES THROUGH THE ROUTER", () => {
  // Standing rule: BackButton and router links, never a raw anchor, or a phone
  // takes a full page load and loses the app.
  assert.doesNotMatch(page(), /<a\s+href=/, "a raw anchor is back on the live page");
});

// ---------- the lobby read ----------

test("NO GAME UP: the lobby is read, flag or no flag", () => {
  assert.equal(lobbyWanted(null, undefined), true);
  assert.equal(lobbyWanted(null, "1"), true);
});

test("A GAME UP: only the asking reader pays for it", () => {
  const live = { kind: "pack", pack: "poker", status: "live" } as const;
  // The television, re-resolving on every score in the room.
  assert.equal(lobbyWanted(live, undefined), false);
  // The phone in somebody's hand.
  assert.equal(lobbyWanted(live, "1"), true);
});

test("THE FLAG IS COMPARED, NOT COERCED", () => {
  const live = { kind: "bracket", bracketId: "b1", status: "live" } as const;
  // Express parses a repeated key into an array, and "truthy" would let one in.
  assert.equal(lobbyWanted(live, ["1", "2"]), false);
  assert.equal(lobbyWanted(live, "true"), false);
  assert.equal(lobbyWanted(live, ""), false);
});

// THE PROXY, AND THE FOUR THINGS THAT KEEP US WELCOME.
//
// Photon is free, unauthenticated and explicitly not guaranteed. Its terms say
// extensive usage will be throttled or banned, there is no paid tier to escalate
// to, and anyone with real volume is told to self-host. We are a friend group
// setting a location a few times a month, which is the case they welcome, but
// the difference between that and abuse is entirely in this file.
//
// AND THE BAN WOULD BE SHARED. Render runs this app on ONE instance behind ONE
// IP, the same IP every crew's live updates run through, so a single client
// hammering the endpoint breaks place search for everybody at once. That is why
// the limit lives here rather than in the browser: a client-side debounce is a
// courtesy that any client can decline.
//
// `fetch` is stubbed throughout. Nothing here touches the network, both because
// a test that calls a stranger's server is not a test and because doing so would
// be the exact behaviour these assertions exist to prevent.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchPlaces, normalizeQuery, resetPlacesState } from "../src/places.js";

const FEATURE = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [-87.6553, 41.9484] },
  properties: {
    osm_id: 3374814, osm_type: "W", name: "Wrigley Field",
    housenumber: "1060", street: "West Addison Street", city: "Chicago", state: "Illinois",
  },
};

const realFetch = globalThis.fetch;
let calls: string[] = [];

/** Stand in for Photon. Records what was asked and answers however the test says. */
function stubFetch(reply: () => unknown) {
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url));
    stubFetch.lastInit = init;
    const out = reply();
    if (out instanceof Error) throw out;
    return out as Response;
  }) as typeof fetch;
}
stubFetch.lastInit = undefined as RequestInit | undefined;

const ok = (features: unknown[]) =>
  ({ ok: true, status: 200, json: async () => ({ type: "FeatureCollection", features }) }) as unknown as Response;

beforeEach(() => {
  resetPlacesState();
  globalThis.fetch = realFetch;
});

// ---------- the cache ----------

test("A SECOND SEARCH FOR THE SAME PLACE DOES NOT CALL OUT AGAIN", () => {
  // The whole bargain with the upstream in one assertion.
  stubFetch(() => ok([FEATURE]));
  return (async () => {
    const first = await searchPlaces("Wrigley Field");
    const second = await searchPlaces("Wrigley Field");
    assert.equal(calls.length, 1, "the second search must be served from the cache");
    assert.deepEqual(second.results, first.results);
    assert.equal(second.results[0]!.name, "Wrigley Field");
  })();
});

test("the key is normalised, so spacing and case are one entry rather than three", async () => {
  assert.equal(normalizeQuery("  The   Anchor "), "the anchor");
  stubFetch(() => ok([FEATURE]));
  await searchPlaces("The Anchor");
  await searchPlaces("the  anchor");
  await searchPlaces("THE ANCHOR  ");
  assert.equal(calls.length, 1);
});

test("AN EMPTY RESULT IS CACHED TOO, or a miss is re-sent forever", async () => {
  // The query that matches nothing is the one most likely to be typed again by
  // the next host with the same idea. Not caching it means re-asking on every
  // keystroke of every future attempt, which is precisely what gets an IP
  // throttled.
  stubFetch(() => ok([]));
  const a = await searchPlaces("qqzzxx no such place");
  const b = await searchPlaces("qqzzxx no such place");
  assert.deepEqual(a.results, []);
  assert.deepEqual(b.results, []);
  assert.equal(a.unavailable, false, "a genuine no-match is not a failure");
  assert.equal(calls.length, 1, "the empty answer must be remembered");
});

test("A FAILURE IS NOT CACHED, because the geocoder coming back must be noticed", async () => {
  // The mirror of the test above, and the one that would be easy to get wrong by
  // caching the response rather than the answer: a five-second outage must not
  // blank this query for a week.
  stubFetch(() => new Error("connection refused"));
  const down = await searchPlaces("Wrigley Field");
  assert.equal(down.unavailable, true);
  stubFetch(() => ok([FEATURE]));
  const back = await searchPlaces("Wrigley Field");
  assert.equal(back.unavailable, false);
  assert.equal(back.results.length, 1);
});

// ---------- degrade, never break ----------

test("A THROWN UPSTREAM IS AN EMPTY FLAGGED LIST, never an exception", async () => {
  // This runs inside the edit view. A host mid-invite does not care why search
  // is unavailable and must not be stopped from typing "Dave's place".
  stubFetch(() => new Error("socket hang up"));
  const out = await searchPlaces("Wrigley Field");
  assert.deepEqual(out, { results: [], unavailable: true });
});

test("being throttled reads as unavailable rather than as no results", async () => {
  // A 429 is them telling us to back off. It is still just "search is not
  // answering" to the host, but it must not look like a successful empty search
  // or the field would say "nothing found" while the truth is "we misbehaved".
  for (const status of [429, 503, 500, 404]) {
    resetPlacesState();
    stubFetch(() => ({ ok: false, status, json: async () => ({}) }) as unknown as Response);
    const out = await searchPlaces("Wrigley Field");
    assert.deepEqual(out, { results: [], unavailable: true }, `status ${status}`);
  }
});

test("a body that is not the shape we expect degrades instead of throwing", async () => {
  for (const body of [{}, { features: null }, { features: "nope" }, []]) {
    resetPlacesState();
    stubFetch(() => ({ ok: true, status: 200, json: async () => body }) as unknown as Response);
    assert.equal((await searchPlaces("Wrigley Field")).unavailable, true);
  }
  resetPlacesState();
  stubFetch(() => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } }) as unknown as Response);
  assert.equal((await searchPlaces("Wrigley Field")).unavailable, true);
});

test("an unusable feature is dropped without taking the good ones with it", async () => {
  stubFetch(() => ok([{ geometry: { coordinates: [999, 999] } }, FEATURE, null]));
  const out = await searchPlaces("Wrigley Field");
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0]!.name, "Wrigley Field");
});

// ---------- a short query never leaves the building ----------

test("SHORTER THAN THREE CHARACTERS DOES NOT CALL OUT AT ALL", async () => {
  stubFetch(() => ok([FEATURE]));
  for (const q of ["", " ", "a", "ab", "  ab  "]) {
    const out = await searchPlaces(q);
    assert.deepEqual(out, { results: [], unavailable: false }, `"${q}" must be silent`);
  }
  assert.equal(calls.length, 0, "a prefix of a word is not a search");
  // Three is the floor, not the exclusion.
  await searchPlaces("abc");
  assert.equal(calls.length, 1);
});

test("waiting for more letters is not a failure, so the field does not degrade", async () => {
  // If a short query flagged `unavailable`, the field would collapse to plain
  // text every time somebody started typing, which is the opposite of the point.
  assert.equal((await searchPlaces("a")).unavailable, false);
});

// ---------- the rate limit is ours, not the client's ----------

test("THE LIMIT HOLDS EVEN IF THE CLIENT DOES NOT DEBOUNCE", async () => {
  // The client's debounce is a courtesy any client can decline; this is the
  // control. Distinct queries, so the cache cannot be what saves us.
  stubFetch(() => ok([FEATURE]));
  const outs = [];
  for (let i = 0; i < 12; i++) outs.push(await searchPlaces(`distinct query ${i}`));
  assert.ok(calls.length <= 5, `let ${calls.length} requests out of a 5-token bucket`);
  assert.ok(
    outs.some((o) => o.unavailable),
    "once the bucket is empty the extra calls must degrade rather than queue",
  );
});

test("a cache hit costs no token, so a repeated search is always answered", async () => {
  // Otherwise the limit would punish exactly the behaviour it wants to
  // encourage: the same crew searching the same bar every week.
  stubFetch(() => ok([FEATURE]));
  await searchPlaces("Wrigley Field");
  for (let i = 0; i < 20; i++) {
    const out = await searchPlaces("Wrigley Field");
    assert.equal(out.unavailable, false);
    assert.equal(out.results.length, 1);
  }
  assert.equal(calls.length, 1);
});

// ---------- courtesy and the exit ----------

test("we say who we are, because their terms ask and it beats being blocked", async () => {
  stubFetch(() => ok([FEATURE]));
  await searchPlaces("Wrigley Field");
  const ua = (stubFetch.lastInit?.headers as Record<string, string>)?.["User-Agent"];
  assert.match(ua ?? "", /GameNightOS/);
  assert.match(ua ?? "", /gamenightos\.app/, "and a way to reach us rather than block us");
});

test("the request is bounded and asks for no more than the list shows", async () => {
  stubFetch(() => ok([FEATURE]));
  await searchPlaces("Wrigley Field");
  assert.match(calls[0]!, /limit=5/);
  assert.match(calls[0]!, /q=Wrigley\+Field|q=Wrigley%20Field|q=wrigley\+field|q=wrigley%20field/i);
  assert.ok(stubFetch.lastInit?.signal, "a hung upstream must not hold a connection open");
});

test("THE PROVIDER IS ONE CONSTANT, which is the documented exit", () => {
  // Photon's terms give us nothing to rely on, so leaving has to cost one line.
  // Asserted rather than described, because the day this matters is the day the
  // upstream has already stopped answering.
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/places.ts"),
    "utf8",
  );
  assert.equal(
    (src.match(/photon\.komoot\.io/g) ?? []).length,
    1,
    "the provider host must appear exactly once",
  );
  assert.match(src, /LocationIQ/, "the swaps must be named where the constant is");
  assert.match(src, /self-hosted/i);
});

test("THE PROXY IS AUTHED AT THE ROUTER, not per route", () => {
  // An open geocoding proxy on the internet is a liability with our name on it,
  // and a per-route guard is one forgotten decorator away from being one.
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/places.ts"),
    "utf8",
  );
  assert.match(src, /placesRouter\.use\(requireAuth\);/);
  const index = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/index.ts"),
    "utf8",
  );
  // Its own prefix, so no public router shares it and none has to mount first.
  assert.match(index, /app\.use\("\/api\/places", placesRouter\);/);
  const at = index.indexOf('app.use("/api/places", placesRouter);');
  const bare = index.indexOf('app.use("/api", beerioRouter)');
  assert.ok(at > 0 && bare > at, "it must mount ahead of the bare /api routers");
});

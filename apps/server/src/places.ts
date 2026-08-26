import { Router } from "express";
import { parsePhotonFeature, type Place } from "@gamenight/shared";
import { requireAuth, type AuthedRequest } from "./auth.js";

// PLACE SEARCH, PROXIED. The browser never talks to the geocoder.
//
// THIS IS NOT ABOUT HIDING A KEY, because there is no key. Photon is open and
// unauthenticated. It is about the fact that RENDER RUNS THIS APP ON ONE
// INSTANCE BEHIND ONE IP, so every crew shares one reputation with the upstream.
// If any single client hammers the geocoder, Photon throttles or blocks that IP
// and place search breaks for EVERYBODY AT ONCE. A per-client courtesy in the
// browser cannot protect a shared resource; only a limit on this side can.
//
// SO CACHING IS THE PRICE OF ADMISSION RATHER THAN AN OPTIMISATION. Photon's own
// terms say extensive usage will be throttled or banned, that availability is
// not guaranteed, and that anyone with real volume should self-host. There is no
// paid tier to escalate to and no commercial API to buy. We are a friend group
// setting a location a few times a month, which is squarely the case they
// welcome, but only if we behave like it: a cache measured in days, a debounce
// in the client, and a hard limit here that does not care what the client does.
//
// EVERY FAILURE IS AN EMPTY LIST WITH A FLAG, NEVER A 500. If the geocoder is
// down, slow, or throttling us, the location field has to quietly become the
// plain text box it has always been. A host mid-invite does not care why search
// is unavailable and must not be blocked from typing "Dave's place".

/**
 * THE PROVIDER, IN ONE PLACE, WHICH IS THE EXIT.
 *
 * Photon's terms give us nothing to rely on, so the cost of leaving has to be
 * one line rather than a rewrite. Both swaps answer the same GeoJSON:
 *
 *   - a self-hosted Photon (their own recommendation for real volume), which is
 *     a docker image and an OSM extract, and needs only this URL changed;
 *   - LocationIQ, which is Photon-compatible on this endpoint but wants an
 *     account, a key on the query string and a visible "Search by LocationIQ"
 *     backlink, which is why it was not the first choice.
 *
 * Nothing else in this file knows the provider's name.
 */
const PHOTON_BASE = "https://photon.komoot.io/api";

/**
 * Who we are, because their terms ask for it and because it is the difference
 * between being contacted and being blocked.
 */
const USER_AGENT = "GameNightOS/1.0 (+https://gamenightos.app)";

/** Shorter than this is a prefix of a word, not a search. Never calls out. */
const MIN_QUERY = 3;

/** The render shows five. More is a scroll on a phone, not a better answer. */
const MAX_RESULTS = 5;

/**
 * A bar does not move. Days rather than minutes, because the whole point is that
 * a crew searching "the anchor" every Thursday costs the upstream one request
 * ever, not one a week.
 */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Bounded so a stream of junk queries cannot grow the heap forever. */
const CACHE_MAX = 500;

/** A hung upstream must not hold one of our connections open. */
const UPSTREAM_TIMEOUT_MS = 4_000;

/**
 * THE LIMIT IS SHARED ACROSS EVERY CALLER, deliberately, because it protects our
 * IP rather than any one user. A token bucket: five to absorb a host typing a
 * name, then one every three seconds, which is a third of the one-per-second the
 * client libraries around Photon converge on and comfortably inside what a
 * friend group generates.
 */
const RATE_CAPACITY = 5;
const RATE_REFILL_MS = 3_000;

export interface PlaceSearchResult {
  results: Place[];
  /**
   * The geocoder could not answer: down, slow, throttling, or we are holding
   * ourselves back. The field degrades to plain text on this, and it is a flag
   * rather than a status code because a 500 here would surface as a broken edit
   * view rather than as a missing convenience.
   */
  unavailable: boolean;
}

interface CacheEntry {
  at: number;
  results: Place[];
}

const cache = new Map<string, CacheEntry>();
let tokens = RATE_CAPACITY;
let lastRefill = Date.now();

/**
 * The cache key. Trimmed, whitespace collapsed, lower-cased, so "The  Anchor",
 * "the anchor " and "The Anchor" are one entry rather than three.
 */
export const normalizeQuery = (q: string): string => q.trim().replace(/\s+/g, " ").toLowerCase();

/** Test seam. Module state is the right shape here (see the note below); a way
 *  to clear it is what makes it testable. */
export function resetPlacesState(): void {
  cache.clear();
  tokens = RATE_CAPACITY;
  lastRefill = Date.now();
}

// A MODULE-SCOPE MAP IS CORRECT HERE RATHER THAN A COMPROMISE, and it is the one
// place the single-instance constraint helps. The WebSocket hub lives in this
// process's memory and pins the app to numInstances: 1 permanently (see STANDING
// RULES), so this cache cannot fragment across replicas the way it would in a
// normally-scaled service. If that ever changes, this becomes a shared cache
// problem on the same day the hub does.

function takeToken(now: number): boolean {
  const refilled = Math.floor((now - lastRefill) / RATE_REFILL_MS);
  if (refilled > 0) {
    tokens = Math.min(RATE_CAPACITY, tokens + refilled);
    lastRefill += refilled * RATE_REFILL_MS;
  }
  if (tokens <= 0) return false;
  tokens -= 1;
  return true;
}

function readCache(key: string, now: number): Place[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.results;
}

function writeCache(key: string, results: Place[], now: number): void {
  // EMPTY RESULTS ARE CACHED TOO. A query that matches nothing is the one most
  // likely to be typed again by the next host with the same idea, and not
  // caching it means re-asking the upstream on every keystroke of every future
  // attempt: the exact behaviour their terms are asking us not to have.
  cache.set(key, { at: now, results });
  while (cache.size > CACHE_MAX) {
    // Insertion order, so this is the oldest. Deliberately not an LRU: a hit
    // does not reinsert, because the value being fresh matters more here than
    // the value being popular.
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Search for a place. Never throws and never rejects; the worst case is an
 * empty list with `unavailable` set.
 */
export async function searchPlaces(raw: string): Promise<PlaceSearchResult> {
  const key = normalizeQuery(raw);
  // Not a failure, so not flagged: the field is simply waiting for more letters.
  if (key.length < MIN_QUERY) return { results: [], unavailable: false };

  const now = Date.now();
  const cached = readCache(key, now);
  if (cached) return { results: cached, unavailable: false };

  if (!takeToken(now)) return { results: [], unavailable: true };

  let payload: unknown;
  try {
    const url = `${PHOTON_BASE}?q=${encodeURIComponent(key)}&limit=${MAX_RESULTS}`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    // A 429 or a 503 is them telling us to back off, and it is the case this
    // whole file exists to avoid. It is still just "no results" to the host.
    if (!res.ok) return { results: [], unavailable: true };
    payload = await res.json();
  } catch {
    // Timed out, DNS failed, connection refused, body was not JSON. All the
    // same thing from where the host is standing.
    return { results: [], unavailable: true };
  }

  const features = (payload as { features?: unknown })?.features;
  if (!Array.isArray(features)) return { results: [], unavailable: true };

  const results: Place[] = [];
  for (const feature of features) {
    const place = parsePhotonFeature(feature);
    if (place) results.push(place);
    if (results.length >= MAX_RESULTS) break;
  }

  writeCache(key, results, now);
  return { results, unavailable: false };
}

// ---------------------------------------------------------------------------

export const placesRouter = Router();

// AUTHED AT THE ROUTER, and mounted on its own prefix in index.ts.
//
// An open geocoding proxy on the public internet is a liability with our name
// on it: anybody could point a scraper at it and the ban would land on the IP
// every crew's live updates run through. Checked where it mounts, per the
// standing ordering trap: NO PUBLIC ROUTER SHARES /api/places, so unlike the
// /api/tv block there is nothing that has to come first. It mounts ahead of the
// bare /api routers so that this router's own auth answers for it rather than
// whichever router-level requireAuth the request would otherwise fall into.
placesRouter.use(requireAuth);

placesRouter.get("/search", async (req: AuthedRequest, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  res.json(await searchPlaces(q));
});

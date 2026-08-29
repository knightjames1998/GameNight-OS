// Stale-while-revalidate cache for GET payloads.
//
// THE PROBLEM THIS SOLVES. Before this, every navigation refetched from
// scratch and showed a loading state while it waited, so going Home -> crew ->
// event -> crew put a "Loading..." on the crew page BOTH times, for data that
// had not changed. There was no client cache at all, in memory or otherwise.
//
// THE RULE. When there is something to show, show it. Return the cached value
// SYNCHRONOUSLY on first render, paint it, and revalidate in the background;
// swap in the fresh answer if it differs. A loading state is only for when
// there is genuinely nothing to show, which after the first visit is rare.
//
// TWO LAYERS, on purpose. Memory alone would survive an in-session navigation
// and nothing else; localStorage makes a relaunch of the installed PWA instant
// too, which is the launch that actually hurts. Memory is checked first
// because it needs no parse.
//
// VERSIONED BY BUILD (__BUILD_ID__ from vite.config.ts). Every key is prefixed
// with the build that wrote it. Without this, a deploy that changes a payload
// shape lets an old cached object hydrate into new code, and the failure mode
// is a white screen on launch for everyone with a warm cache: the worst
// possible outcome, arriving only for people who use the app most. The cost is
// that the cache is cold after each deploy, which is the right trade, and old
// namespaces are swept on boot so storage does not grow forever.
//
// WHAT MUST NOT BE CACHED. The TV routes, because they are the live surface
// and a stale scoreboard on a big screen is worse than a spinner. And anything
// under a pack's live session, where a stale roster could be tapped. Those
// screens keep fetching exactly as they did. Everything else is fair game:
// crew, event, stats, profiles, friends, recap.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

declare const __BUILD_ID__: string;

const NS = "gn";
const PREFIX = `${NS}:${__BUILD_ID__}:`;

/**
 * Anything bigger than this is not worth a localStorage slot: the quota is
 * around 5MB for the whole origin, and one oversized stats payload could
 * evict everything else. It still lives in memory for the session.
 */
const MAX_PERSISTED_BYTES = 256 * 1024;

const memory = new Map<string, unknown>();

function storage(): Storage | null {
  try {
    // Safari private mode has localStorage but throws on write, so probe it.
    const s = window.localStorage;
    const probe = `${PREFIX}__probe`;
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const store = storage();

/**
 * The PROBED localStorage, or null when it cannot be written to.
 *
 * EXPORTED FOR THE PROBE, NOT FOR THE NAMESPACE, and the distinction matters.
 * The probe is the non-obvious part: Safari private mode HAS `localStorage` and
 * throws on write, so anything that stores a flag needs this rather than a bare
 * `window.localStorage` and a hope. A second copy of that probe elsewhere in the
 * app would be a second thing to get wrong.
 *
 * BUT A CALLER THAT IS NOT THE CACHE MUST USE ITS OWN KEYS. Everything under
 * PREFIX is swept on a deploy (by design: a payload shape can change) and
 * cleared on logout (by design: the next person must not see the last one's
 * crews). Both are exactly wrong for a once-ever UI flag, which would then
 * replay after every deploy and every logout.
 */
export const probedStorage: Storage | null = store;

/**
 * Drop every namespace that is not this build's. Runs once at module load, so
 * a deploy reclaims the space its predecessor was using instead of stacking a
 * new copy beside it.
 */
function sweepOldBuilds() {
  if (!store) return;
  const doomed: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(`${NS}:`) && !k.startsWith(PREFIX)) doomed.push(k);
  }
  for (const k of doomed) store.removeItem(k);
}
sweepOldBuilds();

/** Read a cached value, memory first. Returns undefined when there is none. */
export function readCache<T>(key: string): T | undefined {
  if (memory.has(key)) return memory.get(key) as T;
  if (!store) return undefined;
  const raw = store.getItem(PREFIX + key);
  if (raw == null) return undefined;
  try {
    const value = JSON.parse(raw) as T;
    memory.set(key, value);
    return value;
  } catch {
    // Corrupt entry; treat it as a miss and get rid of it.
    store.removeItem(PREFIX + key);
    return undefined;
  }
}

/**
 * Cache a value. Also the write-through entry point for mutations: several
 * endpoints already return the full updated payload (eventDetail does, every
 * pack mutation does), so a screen returned to after a write is both instant
 * AND correct rather than instant and stale.
 */
export function writeCache(key: string, value: unknown): void {
  memory.set(key, value);
  if (!store) return;
  let raw: string;
  try {
    raw = JSON.stringify(value);
  } catch {
    return; // not serializable; memory-only is fine
  }
  if (raw.length > MAX_PERSISTED_BYTES) return;
  try {
    store.setItem(PREFIX + key, raw);
  } catch {
    // Out of quota. This build's entries are the only ones worth keeping, and
    // we cannot tell which are stale, so clear them and keep the newest write.
    dropAll();
    try {
      store.setItem(PREFIX + key, raw);
    } catch {
      // Still failing: give up quietly, memory still has it.
    }
  }
}

/** Forget one entry, in both layers. */
export function dropCache(key: string): void {
  memory.delete(key);
  store?.removeItem(PREFIX + key);
}

/**
 * Forget everything. Called on logout, because the next person to use this
 * device must not see the previous account's crews flash up before the
 * revalidation corrects it.
 */
export function dropAll(): void {
  memory.clear();
  if (!store) return;
  const doomed: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(PREFIX)) doomed.push(k);
  }
  for (const k of doomed) store.removeItem(k);
}

export interface CachedApi<T> {
  /** Cached first, then fresh. undefined only when nothing is known yet. */
  data: T | undefined;
  /** True while a revalidation is in flight over data we already showed. */
  stale: boolean;
  /** True only when there is nothing to render. This is the ONLY spinner. */
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /**
   * Apply an update the page already knows about, writing it through to the
   * cache as it goes. This is the write-through path: a mutation response that
   * carries the full updated payload, or a local edit the page applies
   * optimistically. Without it a page would paint the new value, navigate
   * away, come back, and show the pre-mutation cached copy.
   */
  set: (next: T) => void;
}

/**
 * GET `path`, cached under `key`.
 *
 * Pass a null key or path to hold off entirely (a screen that does not know
 * its id yet). The cached value is read during the first render, not in an
 * effect, so the very first paint already has it.
 */
export function useCachedApi<T>(key: string | null, path: string | null): CachedApi<T> {
  const [data, setData] = useState<T | undefined>(() => (key ? readCache<T>(key) : undefined));
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  // Newest request wins. A slow response for a key we have navigated away
  // from must never overwrite the new screen's data.
  const seq = useRef(0);
  const keyRef = useRef(key);
  keyRef.current = key;

  const load = useCallback(async () => {
    if (!key || !path) return;
    const mine = ++seq.current;
    setStale(true);
    try {
      const fresh = await api<T>(path);
      if (mine !== seq.current || keyRef.current !== key) return;
      writeCache(key, fresh);
      setData(fresh);
      setError(null);
    } catch (e) {
      if (mine !== seq.current || keyRef.current !== key) return;
      // A failed revalidation must NOT blank out good cached data. Surface the
      // error and keep showing what we have; that is the whole point of a
      // cache on a flaky phone connection.
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      if (mine === seq.current) setStale(false);
    }
  }, [key, path]);

  const set = useCallback(
    (next: T) => {
      if (key) writeCache(key, next);
      setData(next);
    },
    [key],
  );

  useEffect(() => {
    // Re-read on key change so a navigation paints the new screen's cached
    // value immediately rather than the previous screen's data.
    setData(key ? readCache<T>(key) : undefined);
    setError(null);
    void load();
  }, [key, path, load]);

  return { data, stale, loading: data === undefined && !error, error, refetch: load, set };
}

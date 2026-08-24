// IS THIS SCREEN STILL HEARING THE HUB? One answer for the whole app.
//
// WHY THIS IS NOT `socket.readyState`, which is the obvious version and the
// wrong one: A WEBSOCKET CAN DIE WITHOUT EITHER END BEING TOLD. A mobile NAT or
// a proxy drops the connection with no FIN, the browser's `onclose` never fires,
// the retry never runs, and `readyState` reads OPEN forever while nothing
// arrives. A pill built on it would print "connected" during exactly the failure
// it exists to expose, which is worse than shipping no pill.
//
// So the question is answered by TRAFFIC instead: the server pings every
// PING_INTERVAL_MS (apps/server/src/ws.ts), and a screen that has not heard
// anything in STALE_AFTER_MS has stopped receiving whether or not its socket
// admits it.
//
// A MODULE-SCOPE STORE, and that is deliberate rather than lazy. Nineteen files
// subscribe to the hub, but every one of them ends up inside `useLiveUpdates`,
// so a store every socket reports into is what lets ONE pill in the App shell
// cover all nineteen screens with no page edits at all.
//
// THIS IS NOT THE MODULE-SCOPE TRAP THE STANDING WARNING IS ABOUT. That warning
// is about caching `location` or `location.search` at module scope, where the
// value is captured ONCE at import against whatever URL loaded first and is
// silently wrong for every route after it. This is mutable state written at
// runtime by whoever is live right now, which is the opposite shape: nothing is
// captured, everything is reported.

/**
 * `stale` and `down` are DIFFERENT INTERNALLY AND IDENTICAL TO THE READER.
 *
 * The reader is told the same thing either way ("live updates paused,
 * reconnecting"), because from where they are sitting it is the same fact. The
 * distinction exists so `stale` can ACT: a half-open socket will never close
 * itself, so noticing has to be followed by closing it, which is what drops into
 * the existing retry. `down` has already done that and is waiting.
 *
 * `idle` IS THE ONE THAT IS NOT A PROBLEM, and separating it from `down` is the
 * whole reason this is four states rather than three. NOBODY SUBSCRIBED is what
 * Home and Login look like, and it must render nothing. NO SOCKET OPEN on a
 * screen that IS subscribed is a dropped connection, which is the pill's main
 * case. Both have zero open sockets, so a store that counted only sockets would
 * have gone silent during exactly the failure it was built for.
 */
export type LiveState = "idle" | "live" | "stale" | "down";

/**
 * How long a screen goes without hearing anything before it stops believing its
 * own socket.
 *
 * JUST OVER TWICE THE SERVER'S PING INTERVAL, which is the whole reasoning: at
 * 20s pings, one dropped ping still leaves the second one arriving at 40s and
 * inside this window, so a single missed beat is never a false alarm, while two
 * consecutive misses are a real silence worth acting on. Moving either number
 * without the other breaks that relationship, which `live-status.test.ts`
 * asserts against the server constant directly rather than by eye.
 */
export const STALE_AFTER_MS = 45_000;

/** How often a mounted screen re-asks the question. Cheap; it is a subtraction. */
export const STALE_CHECK_MS = 2_000;

/**
 * How long a screen may have no socket before that is worth mentioning.
 *
 * WITHOUT THIS THE PILL FLASHES ON EVERY SINGLE PAGE LOAD. A hook mounts before
 * its socket finishes opening, so for a few hundred milliseconds every live
 * screen in the app is subscribed with nothing open, which is the literal
 * definition of `down`. A badge that appears and vanishes on every navigation
 * teaches people to ignore it, which costs exactly the one moment it is for.
 *
 * SLIGHTLY LONGER THAN ONE RETRY CYCLE (3000ms), so a single failed attempt that
 * succeeds on its first retry never surfaces either. What is left is a
 * connection that is genuinely not coming back on the first try, which is worth
 * a word.
 */
export const DOWN_GRACE_MS = 4_000;

/**
 * The whole rule, pure, so it can be tested without a socket or a clock.
 *
 * `lastMessageAt` of 0 means nothing has ever arrived, which reads as an
 * infinite age and therefore as stale. That is the honest answer rather than an
 * edge case to special-case: a socket that is open and has never said anything
 * is exactly the state this file exists to catch.
 */
export function deriveLiveState(input: {
  /** Hooks currently mounted. Zero means no screen is even asking. */
  mountedCount: number;
  /** Sockets currently OPEN. Zero while a mounted hook is between retries. */
  openCount: number;
  lastMessageAt: number;
  /** When the current run of having no socket began; 0 when one is open. */
  downSince: number;
  now: number;
}): LiveState {
  if (input.mountedCount <= 0) return "idle";
  if (input.openCount <= 0) {
    // Inside the grace this reads as `idle`, which is the same instruction to
    // the pill: say nothing yet. Every page load passes through here.
    return input.downSince > 0 && input.now - input.downSince > DOWN_GRACE_MS ? "down" : "idle";
  }
  return input.now - input.lastMessageAt <= STALE_AFTER_MS ? "live" : "stale";
}

// ---------------------------------------------------------------------------
// The store every socket reports into.

let mountedCount = 0;
let openCount = 0;
let lastMessageAt = 0;
let downSince = 0;
let current: LiveState = "idle";
const listeners = new Set<() => void>();

function recompute() {
  const now = Date.now();
  // The clock on the current run of having nothing open, kept here rather than
  // by callers so no caller can forget to start or clear it.
  if (mountedCount > 0 && openCount <= 0) {
    if (downSince === 0) downSince = now;
  } else {
    downSince = 0;
  }
  const next = deriveLiveState({ mountedCount, openCount, lastMessageAt, downSince, now });
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export const liveStatus = {
  /** useSyncExternalStore's two halves. The snapshot is a primitive, so it is
   *  referentially stable by construction and cannot cause a render loop. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get(): LiveState {
    return current;
  },

  /** A screen subscribed. Counted separately from its socket, because a
   *  mounted hook between retries has no socket and is still the case the pill
   *  exists for. */
  mounted() {
    mountedCount += 1;
    recompute();
  },
  /** A screen went away. Floored for the same reason `closed` is. */
  unmounted() {
    mountedCount = Math.max(0, mountedCount - 1);
    recompute();
  },

  /** A socket opened. Its own connect stamps the clock, so a fresh connection
   *  is never briefly reported as stale before its first ping lands. */
  opened(at: number) {
    openCount += 1;
    lastMessageAt = Math.max(lastMessageAt, at);
    recompute();
  },
  /** A socket closed. Floors at zero: a cleanup and an `onclose` can both fire
   *  for the same socket, and a negative count would read as `down` forever. */
  closed() {
    openCount = Math.max(0, openCount - 1);
    recompute();
  },
  /** Anything arrived, PING INCLUDED. The ping is the only traffic on a quiet
   *  night, so treating it as ordinary is the entire mechanism. */
  message(at: number) {
    lastMessageAt = Math.max(lastMessageAt, at);
    recompute();
  },
  /** Re-ask the question with no new input, because staleness is a function of
   *  the clock and nothing arriving is not an event. */
  tick() {
    recompute();
  },
};

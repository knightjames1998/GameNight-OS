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
 */
export type LiveState = "live" | "stale" | "down";

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

/** How often an open socket re-asks the question. Cheap; it is a subtraction. */
export const STALE_CHECK_MS = 5_000;

/**
 * The whole rule, pure, so it can be tested without a socket or a clock.
 *
 * `lastMessageAt` of 0 means nothing has ever arrived, which reads as an
 * infinite age and therefore as stale. That is the honest answer rather than an
 * edge case to special-case: a socket that is open and has never said anything
 * is exactly the state this file exists to catch.
 */
export function deriveLiveState(input: {
  openCount: number;
  lastMessageAt: number;
  now: number;
}): LiveState {
  if (input.openCount <= 0) return "down";
  return input.now - input.lastMessageAt <= STALE_AFTER_MS ? "live" : "stale";
}

// ---------------------------------------------------------------------------
// The store every socket reports into.

let openCount = 0;
let lastMessageAt = 0;
let current: LiveState = "down";
const listeners = new Set<() => void>();

function recompute() {
  const next = deriveLiveState({ openCount, lastMessageAt, now: Date.now() });
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

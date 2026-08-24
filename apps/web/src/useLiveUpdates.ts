import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { CLIENT_ID } from "./api";
import { liveStatus, STALE_AFTER_MS, STALE_CHECK_MS, type LiveState } from "./livestatus";

/**
 * How long after a drop before trying again.
 *
 * FIXED, AND NOT A CANDIDATE FOR BACKOFF, which is the obvious next thought and
 * is wrong for this app. The real case is a host standing in one room with a
 * brief wifi dropout, and a constant three seconds is exactly what that wants.
 * Backoff would make somebody who steps back into range wait up to thirty
 * seconds for a board that could have recovered in three, to save retries
 * against a server that is one small instance. Left alone deliberately.
 */
const RETRY_MS = 3000;

/**
 * Subscribe to the live hub. Every screen that shows shared state uses
 * this: the server broadcasts on writes, the page refetches. Reconnects
 * on drop (phones kill the radio on lock) and refetches on wake, which
 * covers anything missed while asleep.
 *
 * onMessage is kept in a ref so callers don't need to memoize it.
 */
export function useLiveUpdates(
  onMessage: (msg: { type: string; [k: string]: unknown }) => void,
  onVisible?: () => void,
) {
  const msgRef = useRef(onMessage);
  const visRef = useRef(onVisible);
  msgRef.current = onMessage;
  visRef.current = onVisible;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    // Counted into the store, so a cleanup and an onclose for the same socket
    // cannot decrement twice.
    let counted = false;
    // A FIRST CONNECT MUST NOT COUNT AS A RECONNECT, or every screen in the app
    // double-fetches on mount: once from its own load, once from the catch-up
    // below. Scoped to this mount rather than to the module for the same reason.
    let everConnected = false;
    let lastMessageAt = 0;

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${window.location.host}/ws`);
      socket.onopen = () => {
        lastMessageAt = Date.now();
        counted = true;
        liveStatus.opened(lastMessageAt);
        if (everConnected) {
          // A RECONNECT REFETCHES, and this is a bug fix rather than part of the
          // pill. `onVisible` already covers a phone that slept, but nothing
          // covered a socket that dropped and came back while the page STAYED
          // VISIBLE: the host watches the screen the whole time, the socket
          // dies, it reconnects, and the board still shows what it showed before
          // the drop because every message sent during the gap is gone. Without
          // this the pill would just turn green over a stale board.
          visRef.current?.();
        }
        everConnected = true;
      };
      socket.onmessage = (e) => {
        // EVERY message, PING INCLUDED, and the ping is the important one: it is
        // the only traffic on a quiet night, so it is what proves the pipe is
        // open. Callers have always received and ignored pings (the connect-time
        // one has been sent since the hub shipped), so nothing downstream is new.
        lastMessageAt = Date.now();
        liveStatus.message(lastMessageAt);
        try {
          msgRef.current(JSON.parse(e.data));
        } catch {
          // Not our message shape; ignore.
        }
      };
      socket.onclose = () => {
        if (counted) {
          counted = false;
          liveStatus.closed();
        }
        if (!closed) retry = setTimeout(connect, RETRY_MS);
      };
    }
    connect();

    // NOTICING IS ONLY HALF OF IT: a half-open socket will never close itself,
    // so crossing the stale line has to CLOSE it, which drops into the onclose
    // path above and reuses the retry that is already there. There is
    // deliberately no second retry loop.
    const check = setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN && Date.now() - lastMessageAt > STALE_AFTER_MS) {
        socket.close();
      }
      // Staleness is a function of the clock, and nothing arriving is not an
      // event, so the label needs re-asking even when nothing happened.
      liveStatus.tick();
    }, STALE_CHECK_MS);

    const onVis = () => {
      if (document.visibilityState === "visible") visRef.current?.();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      clearInterval(check);
      if (counted) {
        counted = false;
        liveStatus.closed();
      }
      socket?.close();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
}

/**
 * Whether this app is currently hearing the hub, for the one pill in the shell.
 *
 * Reads the module-scope store every socket reports into, so it answers for the
 * whole app rather than for one screen, and needs no page to pass anything down.
 * `down` with no socket at all is the ordinary state of Home and Login, which is
 * why the pill renders nothing for it.
 */
export function useLiveStatus(): LiveState {
  return useSyncExternalStore(liveStatus.subscribe, liveStatus.get, () => "down" as const);
}

// ---------------------------------------------------------------------------
// The two shapes every live screen actually wanted.
//
// Before these, useLiveUpdates was the only rung on the ladder, and it is a
// low-level one: it hands you raw messages and leaves matching, filtering and
// refetching to the caller. So every screen wrote the same six lines. The
// filter block below existed EIGHT times across the four pack pages and their
// four TV pages, identical apart from one string, and BracketPage and TvPage
// skipped the hook entirely and hand-rolled their own connect/retry/visibility
// socket, which had already drifted apart from each other.
//
// useLiveUpdates itself stays exported and unchanged: EventPage and GroupPage
// listen for several unrelated message types and act differently on each (one
// of them navigates away when the event is deleted), which is genuinely the
// low-level case. Beerio polls on a timer instead, which is correct for a
// vendored pack that owns its own loop, and is left alone.

/** The message shape the hub broadcasts. */
type LiveMessage = { type: string; origin?: string; [k: string]: unknown };

const BRACKET_TYPES = ["bracket_updated"] as const;

/**
 * Refetch whenever one of `types` arrives for this id.
 *
 * Skips our own echo. The acting tab already holds the mutation response, so
 * refetching on its own broadcast doubles the traffic for no new information.
 * On a read-only screen (any TV view) this is a no-op rather than a special
 * case, because a screen that never writes never sees its own client id come
 * back, which is why one hook can serve both without a flag.
 *
 * A null id holds off entirely, for a screen that does not know what it is
 * watching yet.
 */
export function useLiveRefetch(
  types: readonly string[],
  field: string,
  id: string | null | undefined,
  refetch: () => void,
) {
  // Kept in refs so callers do not have to memoize the array or the callback;
  // the underlying effect must not re-subscribe on every render.
  const typesRef = useRef(types);
  typesRef.current = types;
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useLiveUpdates(
    (msg: LiveMessage) => {
      if (!id) return;
      if (msg.origin === CLIENT_ID) return;
      if (!typesRef.current.includes(msg.type)) return;
      if (msg[field] !== id) return;
      refetchRef.current();
    },
    () => {
      // Visibility: catch up on anything missed while the phone (or the TV)
      // was asleep, whatever the topic.
      if (id) refetchRef.current();
    },
  );
}

/**
 * A pack screen: its own updates, plus leaderboard_updated, both scoped to
 * this event. Used by all four pack pages and all four pack TV views.
 */
export function usePackLive(
  wsType: string,
  eventId: string | null | undefined,
  refetch: () => void,
) {
  const types = useMemo(() => [wsType, "leaderboard_updated"], [wsType]);
  useLiveRefetch(types, "eventId", eventId, refetch);
}

/** A bracket screen: the scoring page and the TV view watch the same topic. */
export function useBracketLive(bracketId: string | null | undefined, refetch: () => void) {
  useLiveRefetch(BRACKET_TYPES, "bracketId", bracketId, refetch);
}

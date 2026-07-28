import { useEffect, useMemo, useRef } from "react";
import { CLIENT_ID } from "./api";

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

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${window.location.host}/ws`);
      socket.onmessage = (e) => {
        try {
          msgRef.current(JSON.parse(e.data));
        } catch {
          // Not our message shape; ignore.
        }
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
    }
    connect();

    const onVis = () => {
      if (document.visibilityState === "visible") visRef.current?.();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
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

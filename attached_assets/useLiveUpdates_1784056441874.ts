import { useEffect, useRef } from "react";

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

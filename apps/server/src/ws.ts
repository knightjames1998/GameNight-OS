import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { WsMessage } from "@gamenight/shared";

// The Broadcast backbone. One hub, many screens. Routers call broadcast()
// after a write; every connected client gets the message and decides
// whether it cares. Phase 4's TV view rides this same pipe.
//
// Scale note: single instance only. Clients connect to this process's
// memory, so a multi-instance deployment would split the room. Revisit
// before ever raising max instances above 1.

let wss: WebSocketServer | null = null;
let heartbeat: NodeJS.Timeout | null = null;

/**
 * How often the server pings every open client.
 *
 * WHY A HEARTBEAT EXISTS AT ALL, and it is not keep-alive: A WEBSOCKET CAN DIE
 * WITHOUT EITHER END BEING TOLD. A mobile NAT or a proxy drops the connection
 * with no FIN, so the browser's `onclose` never fires, the client's retry never
 * runs, and `readyState` reads OPEN forever while nothing arrives. Traffic FROM
 * the server is the only thing that makes that state observable: the client
 * decides it has gone stale when the pings stop, and reconnects itself.
 *
 * 20 SECONDS IS PICKED AGAINST TWO NUMBERS. Comfortably under the 30-to-60
 * second idle timeout proxies apply, so it doubles as keep-alive; and the
 * client's stale window (STALE_AFTER_MS in apps/web/src/useLiveUpdates.ts) is
 * just over TWICE this, so a single dropped ping is never a false alarm. Moving
 * either number without the other is what `ws-heartbeat.test.ts` guards.
 *
 * ONE DIRECTIONAL, deliberately. There is no `socket.on("message")` handler
 * here and the client never sends: this is a signal, not a request/response
 * protocol, and a pong would only tell the SERVER something, which is the half
 * nobody is asking about (see BACKLOG, no dead-socket termination).
 */
export const PING_INTERVAL_MS = 20_000;

export function setupWebSockets(server: Server) {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    // The connect-time ping stays: it starts the client's clock immediately
    // rather than leaving the first window to be filled by the interval.
    socket.send(JSON.stringify({ type: "ping" } satisfies WsMessage));
  });

  // THROUGH broadcast(), not a second loop over wss.clients. One place knows
  // how to write to the room, including the readyState check, so a ping cannot
  // drift from what every other message does.
  stopHeartbeat();
  heartbeat = setInterval(() => broadcast({ type: "ping" }), PING_INTERVAL_MS);
  // UNREF'D so the heartbeat can never be the thing keeping a process alive.
  // The http server holds the event loop open in production, so the interval
  // still fires; in a test run that imports this module, a leaked interval
  // would otherwise hang the runner with nothing to point at.
  heartbeat.unref?.();

  // Both, because they are different events: closing the http server does not
  // close the WebSocketServer attached to it, and closing the hub does not stop
  // the server underneath.
  wss.on("close", stopHeartbeat);
  server.on("close", stopHeartbeat);
}

function stopHeartbeat() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

export function broadcast(msg: WsMessage, origin?: string) {
  if (!wss) return;
  const payload = JSON.stringify(origin ? { ...msg, origin } : msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

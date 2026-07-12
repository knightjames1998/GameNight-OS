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

export function setupWebSockets(server: Server) {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "ping" } satisfies WsMessage));
  });
}

export function broadcast(msg: WsMessage) {
  if (!wss) return;
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

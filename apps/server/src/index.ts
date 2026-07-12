import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { WsMessage } from "@gamenight/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json());

// ---------- API ----------

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "gamenight-os", time: new Date().toISOString() });
});

// Feature routes get mounted here in future sessions:
// app.use("/api/groups", groupsRouter);
// app.use("/api/events", eventsRouter);

// ---------- Static frontend (production) ----------
// In dev, Vite serves the web app on its own port and proxies /api here.
// In production, Express serves the built files.

const webDist = path.resolve(__dirname, "../../web/dist");
app.use(express.static(webDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(webDist, "index.html"), (err) => {
    if (err) res.status(404).send("Web build not found. Run pnpm build.");
  });
});

// ---------- WebSocket hub ----------
// Broadcast module lives here. TV and spectator views connect to /ws;
// score entry triggers a broadcast so every screen updates live.

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

export function broadcast(msg: WsMessage) {
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "ping" } satisfies WsMessage));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`GameNight OS server listening on :${PORT}`);
});

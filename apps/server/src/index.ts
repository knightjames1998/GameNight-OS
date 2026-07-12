import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { WsMessage } from "@gamenight/shared";
import { authRouter, attachUser } from "./auth.js";
import { groupsRouter, joinRouter } from "./groups.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
// Replit sits behind a proxy; trust it so req.protocol reports https
// and magic link URLs come out correct.
app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser());
app.use(attachUser);

// ---------- API ----------

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "gamenight-os", time: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api/groups", groupsRouter);
app.use("/api/join", joinRouter);

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

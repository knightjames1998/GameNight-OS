// Must run before any route module registers handlers: patches the Router
// so async handler rejections return a 500 instead of crashing the process.
import "./async-safe.js";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authRouter, attachUser } from "./auth.js";
import { groupsRouter, joinRouter } from "./groups.js";
import { eventsRouter } from "./events.js";
import { bracketsRouter, tvRouter } from "./brackets.js";
import { beerioRouter } from "./beerio.js";
import { beerioGnRouter } from "./beerio-gn.js";
import { quickPlayRouter } from "./quickplay.js";
import { smashRouter, smashTvRouter } from "./smash.js";
import { marioKartRouter, marioKartTvRouter } from "./mariokart.js";
import { statsRouter } from "./stats.js";
import { setupWebSockets } from "./ws.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
// Render sits behind a proxy; trust it so req.protocol reports https
// and magic link URLs come out correct.
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(attachUser);

// ---------- API ----------

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "gamenight-os", time: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api/groups", groupsRouter);
app.use("/api/join", joinRouter);
// tv must mount BEFORE any router on the bare /api path: those routers
// apply requireAuth at router level, which runs for every /api request
// entering them and 401s before the request can fall through.
app.use("/api/tv", tvRouter);
app.use("/api/tv", smashTvRouter); // public: big-screen read for the Smash pack
app.use("/api/tv", marioKartTvRouter); // public: big-screen read for Mario Kart
app.use("/api", beerioRouter); // public: sessions/hof for the Beerio pack
app.use("/api", beerioGnRouter); // authed per-route: GameNight binding for the pack
app.use("/api", quickPlayRouter);
app.use("/api", smashRouter); // authed per-route: Smash pack play + stats
app.use("/api", marioKartRouter); // authed per-route: Mario Kart general tracking
app.use("/api", statsRouter);
app.use("/api", eventsRouter);
app.use("/api", bracketsRouter);

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

// ---------- Error boundary ----------
// Any error a route handler throws or rejects with is routed here by the
// async-safe patch. Return a 500 and keep the process (and the WebSocket
// hub) alive; a single bad query must never take the whole server down.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[route error]", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong on our end." });
});

// ---------- WebSocket hub ----------
// Broadcast module lives here. TV and spectator views connect to /ws;
// score entry triggers a broadcast so every screen updates live.

const server = createServer(app);
setupWebSockets(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`GameNight OS server listening on :${PORT}`);
});

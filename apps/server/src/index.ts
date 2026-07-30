// Must run before any route module registers handlers: patches the Router
// so async handler rejections return a 500 instead of crashing the process.
import "./async-safe.js";
import express from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authRouter, attachUser } from "./auth.js";
import { groupsRouter, joinRouter } from "./groups.js";
import { eventsRouter } from "./events.js";
import { bracketsRouter, tvRouter } from "./brackets.js";
import { eventTvRouter } from "./tv.js";
import { beerioRouter } from "./beerio.js";
import { beerioGnRouter } from "./beerio-gn.js";
import { quickPlayRouter } from "./quickplay.js";
import { smashRouter, smashTvRouter } from "./smash.js";
import { marioKartRouter, marioKartTvRouter } from "./mariokart.js";
import { marioPartyRouter, marioPartyTvRouter } from "./marioparty.js";
import { pingPongRouter, pingPongTvRouter } from "./pingpong.js";
import { blackjackRouter, blackjackTvRouter } from "./blackjack.js";
import { rouletteRouter, rouletteTvRouter } from "./roulette.js";
import { crapsRouter, crapsTvRouter } from "./craps.js";
import { statsRouter } from "./stats.js";
import { guestLinkRouter } from "./guest-link.js";
import { setupWebSockets } from "./ws.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
// Render sits behind a proxy; trust it so req.protocol reports https
// and magic link URLs come out correct.
app.set("trust proxy", 1);
// Gzip API responses and the static build at the ORIGIN, so the bundle is
// never served uncompressed whatever sits in front of it. Cloudflare does
// compress proxied traffic, but that is a dashboard toggle outside this repo,
// it does nothing when the record is DNS-only, and it is bypassed entirely by
// anything hitting the *.onrender.com origin directly (which the keep-warm
// ping does deliberately, so it cannot be answered from cache). Mounted
// before the routers and before express.static so it covers both. It skips
// already-compressed content types on its own, so images and the OG PNG are
// untouched, and it does not affect the WebSocket upgrade.
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
// API only, deliberately. attachUser runs a sessions x users join whenever a
// session cookie is present, and a browser sends that cookie with EVERY
// request: index.html, the JS bundle, the CSS, five favicons, the manifest,
// the apple-touch-icon, the OG image. Mounted globally it fired roughly ten
// needless Neon round trips per cold page load, before a pixel rendered.
// Every router that reads req.user is under /api, so nothing else needs it.
app.use("/api", attachUser);

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
app.use("/api/tv", eventTvRouter); // public: resolves what an EVENT is playing now
app.use("/api/tv", tvRouter);
app.use("/api/tv", smashTvRouter); // public: big-screen read for the Smash pack
app.use("/api/tv", marioKartTvRouter); // public: big-screen read for Mario Kart
app.use("/api/tv", marioPartyTvRouter); // public: big-screen read for Mario Party
app.use("/api/tv", pingPongTvRouter); // public: big-screen read for Ping Pong
app.use("/api/tv", blackjackTvRouter); // public: big-screen money board for Blackjack
app.use("/api/tv", rouletteTvRouter); // public: big-screen money board for Roulette
app.use("/api/tv", crapsTvRouter); // public: big-screen money board + shooter for Craps
app.use("/api", beerioRouter); // public: sessions/hof for the Beerio pack
app.use("/api", beerioGnRouter); // authed per-route: GameNight binding for the pack
app.use("/api", quickPlayRouter);
app.use("/api", guestLinkRouter); // authed per-route: guest -> member stat backfill
app.use("/api", smashRouter); // authed per-route: Smash pack play + stats
app.use("/api", marioKartRouter); // authed per-route: Mario Kart general tracking
app.use("/api", marioPartyRouter); // authed per-route: Mario Party play + stats
app.use("/api", pingPongRouter); // authed per-route: Ping Pong play
app.use("/api", blackjackRouter); // authed per-route: Blackjack cash game + stats
app.use("/api", rouletteRouter); // authed per-route: Roulette cash game + stats
app.use("/api", crapsRouter); // authed per-route: Craps cash game + stats
app.use("/api", statsRouter);
app.use("/api", eventsRouter);
app.use("/api", bracketsRouter);

// ---------- Static frontend (production) ----------
// In dev, Vite serves the web app on its own port and proxies /api here.
// In production, Express serves the built files.

const webDist = path.resolve(__dirname, "../../web/dist");

// Vite gives every file under /assets a content hash, so the filename IS the
// version: if the contents change the URL changes. That makes them safe to
// cache forever, and revalidating them on every load (the express.static
// default of maxAge 0) bought nothing.
app.use(
  "/assets",
  express.static(path.join(webDist, "assets"), { immutable: true, maxAge: "1y" }),
);

// Everything else in the build (icons, manifest, OG image) is NOT hashed, so
// it gets a short cache instead of an immutable one. index: false matters:
// without it this would serve index.html for "/" with that same maxAge, and
// a cached index.html is the one genuinely dangerous mistake here, because a
// deploy ships new hashed chunks that a stale index.html never asks for.
app.use(express.static(webDist, { maxAge: "1h", index: false }));

// The SPA fallback owns index.html, and it must never be cached.
app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
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

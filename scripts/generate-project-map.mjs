// Generates project-map.excalidraw at the repo root from the zone/item data
// below. The data MUST mirror BACKLOG.md's headings (see MAP PROTOCOL there):
// BACKLOG.md is the source of truth, this file is a rendering of it, and the
// committed .excalidraw is the always-available copy — the live MCP canvas
// doesn't render in Claude Code sessions. On every map redraw: update the
// items below to match the reconciled BACKLOG.md, run
//   node scripts/generate-project-map.mjs
// and commit the regenerated project-map.excalidraw in the same commit.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const TITLE = "GameNight OS — Project Map";
const SUBTITLE = "August 2026 · source of truth: BACKLOG.md";
// Redrawn 2026-08-04 at the START of the Board Game pack session, because the three felt
// sessions handed the counter over at 3. This pass:
//   - Zone 1's tabletop item ABSORBED all three of them (the felt tile and the rail, the
//     materials pass, the room and card-alpha pass) instead of growing three more items.
//     Third redraw running to make that call, and for the same reason each time: the map
//     renders ideas, and "the shell is a table" is one idea. It keeps (NEW) because it
//     took new shipped work this pass rather than merely surviving one.
//   - ZONE 5 SHRANK FOR THE FIRST TIME, 12 items to 9. The four FIXED entries from
//     2026-08-02 have now been drawn on two consecutive redraws, which is what "age out
//     after a couple of redraws" means, and every one has its permanent record in the
//     DECISION LOG. In exchange it took one real OPEN: the felt does not reach the PACKS.
//   - Zone 4 took the modifier wall's cut at three, in FEATURES since 2026-08-02 and
//     never drawn. Found by reading the headings against the zone, not by memory.
//   - NO ROW MOVED. Row 2 stays at 840 with zone 5 needing 566 of it. Deliberate: a pack
//     lands in zone 2 and four backlog items land in zone 3 within the hour, so shrinking
//     now would only mean regrowing next pass. Canvas 1560x2080, unchanged.
//
// The 2026-08-03 pass, kept short: zone 1's tabletop item became ONE item covering the
// whole shell plus the Ping Pong pilot; zone 3's became STAGE 4, THE REMAINING EIGHT
// PACKS; zone 5 took Ping Pong's TV fit and the unthemed share cards; ROW 2 GREW
// 720 -> 840, because zone 5 needed 764 of a 720px zone and 800 would have left 36px,
// under the 58px an item costs.
//
// Earlier passes, kept short: 2026-08-02 twice (stage 1 into zone 1; four zone-5 items
// went FIXED and a fifth Watch trap landed; row 1 990 -> 1120 and row 2 530 -> 660 then
// 660 -> 720, row 2's first growth in six passes, and the pass that learned a row is
// THREE zones, not two), 2026-07-30 (zone 2 took roulette, craps and stakes; row 1
// 920 -> 990) and 2026-07-29 (zone 2 took Smashdown, the series rows and blackjack;
// row 1 860 -> 920).

// Layout constants from MAP PROTOCOL: 3 cols x 2 rows, cols at x=40/560/1080
// each 480 wide, row 1 y=95 h=1120, row 2 y=1240 h=840. Items 440x40, 46px
// step, first 50px below zone top; taller boxes for wrapping labels.
const ZONES = [
  {
    x: 40, y: 95, h: 1120,
    title: "SHIPPED — FOUNDATION", zoneBg: "#d3f9d8", header: "#15803d", itemBg: "#b2f2bb",
    items: [
      { t: "Auth: 6-digit codes + links + passwords" },
      { t: "Crews: invites, roles, join / leave / delete" },
      { t: "Events + RSVPs, event share, night recap" },
      { t: "Bracket engine: single + double elim, undo, GF clarity", h: 52 },
      { t: "WebSocket live sync + TV broadcast views" },
      { t: "Lifetime stats ledger + recap share cards" },
      { t: "Quick play via hidden personal crews" },
      { t: "Arcade theme + PWA install; profiles + rivalry cards" },
      { t: "Flake tracking, streaks, Friends; past nights" },
      { t: "Guest stat backfill; keep-warm ping; link previews", h: 52 },
      { t: "Stats depth: characters, placements, streaks, history", h: 52 },
      { t: "Crew leaderboard: shared agg, unified pack rows", h: 52 },
      { t: "Pre-pack cleanup COMPLETE: hygiene, tests, request cost, indexes, code splitting, caching, one pack runtime, perceived speed, one client implementation per idea", h: 70 },
      { t: "One TV button per night: /e/:id/tv auto-follows" },
      { t: "One pack registry: SESSION_PACKS, one entry per pack" },
      { t: "Pack picker groups: Nintendo / Casino / Bar / Other" },
      { t: "TABLETOP THEME, SHELL COMPLETE: 73 tokens, warm-dark palette, real felt tile + rail, translucent cards, woodtype face, Ping Pong pilot (NEW)", bg: "#c3fae8", h: 88 },
    ],
  },
  {
    x: 560, y: 95, h: 1120,
    title: "SHIPPED — GAME PACKS", zoneBg: "#d3f9d8", header: "#15803d", itemBg: "#b2f2bb",
    items: [
      { t: "Beerio Kart: full replica, predictions, TV" },
      { t: "Smash: FFA + KOTH + Best Of + characters + TV", h: 52 },
      { t: "Mario Kart: Free / Grand Prix / Best Of / KOTH", h: 52 },
      { t: "Ping Pong: Free Play / Best Of / KOTH + TV" },
      { t: "Mario Party: boards, stars, bonus stars, TV" },
      { t: "Title-scoped character selection (cross-pack)" },
      { t: "Generic bracket tracker + TV + recap" },
      { t: "Shared primitives: FFA, KOTH, series, brackets" },
      { t: "Beerio guest linking (forward-only snapshot)" },
      { t: "Smashdown: a 4th Smash FORMAT, burn board, mercy rule", h: 52 },
      { t: "Smashdown series rows: winning a series is its own stat", h: 52 },
      { t: "Blackjack + the shared CASH-GAME ENGINE: cents, derived banker, balance check", h: 70 },
      { t: "Roulette + the shared CASINO SCREENS: one setup, table, money board; per-player buy-ins", h: 70 },
      { t: "Craps + the shooter's hand: longest roll as a crew record", h: 52 },
      { t: "Stakes: real vs play money. Wins unify, only money splits", h: 52 },
      { t: "Declarative modifiers: house rules DISPLAYED and RECORDED, never computed", h: 70 },
      { t: "CASINO RUN: co-op pack, one shared bank, staged quotas, simulated ladders, tokens", h: 70 },
    ],
  },
  {
    x: 1080, y: 95, h: 1120,
    title: "NEXT UP (queued)", zoneBg: "#fff3bf", header: "#b45309", itemBg: "#ffd8a8",
    items: [
      { t: "1. Poker (cash engine PLUS a tournament format)", sw: 2, h: 52 },
      { t: "2. Smash Tournament format (bracket + fighters)", sw: 2, h: 52 },
      { t: "3. Tabletop theme STAGE 4: the remaining 8 packs", sw: 2, h: 52 },
      { t: "More packs: board games, darts" },
    ],
  },
  {
    x: 40, y: 1240, h: 840,
    title: "FEATURES TO ADD", zoneBg: "#dbe4ff", header: "#2563eb", itemBg: "#a5d8ff",
    items: [
      { t: "Revisit the modifier wall's cut at three (the room exists now)", h: 52 },
      { t: "Unified event TV + single active pack" },
      { t: "Detailed personal stats block on Home" },
      { t: "Per-route dynamic link previews" },
      { t: "Mario Kart crew-wide racer table; MP minigame H2H", h: 52 },
      { t: "Smack talk feed; TV stats + predictions ticker", h: 52 },
      { t: "Cross-pack night net (blackjack + poker on one night)", h: 52 },
      { t: "Seasons; round robin; availability polling", h: 52 },
    ],
  },
  {
    x: 560, y: 1240, h: 840,
    title: "BUG FIXES", zoneBg: "#ffc9c9", header: "#b91c1c", itemBg: "#ffc9c9",
    items: [
      { t: "OPEN: the felt does not reach the PACKS (no pack root mounts .gn-app / .gn-tv)", h: 52 },
      { t: "OPEN: Casino Run's TV has the same back-button blind spot the money board had", h: 52 },
      { t: "OPEN: Ping Pong's TV does not fit 1080p past SIX players (pre-existing)", h: 52 },
      { t: "Watch: cold delivery to new recipients while domain warms", bg: "#fff3bf", h: 52 },
      { t: "Watch: countLastPlace IN list grows without bound", bg: "#fff3bf", h: 52 },
      { t: "Watch: ws hub broadcasts everything to everyone (no rooms)", bg: "#fff3bf", h: 52 },
      { t: "Watch: drizzle push can no-op in CI, check build log", bg: "#fff3bf", h: 52 },
      { t: "Watch: color-mix's opaque fallback on pre-2023 browsers (shell-wide since stage 1)", bg: "#fff3bf", h: 52 },
      { t: "Watch: the canvas share cards follow NO theme (16 hardcoded colours, JS not CSS)", bg: "#fff3bf", h: 52 },
    ],
  },
  {
    x: 1080, y: 1240, h: 840,
    title: "IDEAS — NOT SOLIDIFIED", zoneBg: "#e5dbff", header: "#6d28d9", itemBg: "#d0bfff",
    items: [
      { t: "Draft night mode (snake drafts, TV board)" },
      { t: "Wager ledger (money allowed since 07-29)" },
      { t: "Achievements + custom crew badges" },
      { t: "Beer pong pack (forces the team model)" },
      { t: "Pool pack (rides ping pong's KOTH engine)" },
      { t: "Cornhole and darts (poker is committed now)" },
      { t: "Capacitor native wrapper (push notifs)" },
      { t: "Offline score entry sync (PWA)" },
      { t: "Event-aware warm ping (only before a night)" },
    ],
  },
];

// ---- Excalidraw element builders ----------------------------------------

let seedCounter = 1000;
const elements = [];

function base(id, type, x, y, w, h, overrides = {}) {
  return {
    id, type, x, y, width: w, height: h,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: seedCounter++,
    version: 1,
    versionNonce: seedCounter * 7919,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...overrides,
  };
}

function rect(id, x, y, w, h, bg, stroke, strokeWidth = 1) {
  return base(id, "rectangle", x, y, w, h, {
    backgroundColor: bg,
    strokeColor: stroke,
    strokeWidth,
    roundness: { type: 3 },
  });
}

function text(id, x, y, str, fontSize, color, overrides = {}) {
  const lineHeight = 1.25;
  return base(id, "text", x, y, str.length * fontSize * 0.5, fontSize * lineHeight, {
    strokeColor: color,
    text: str,
    fontSize,
    fontFamily: 1,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    originalText: str,
    lineHeight,
    ...overrides,
  });
}

/** Rectangle with centered bound label, the way Excalidraw stores them. */
function labeledRect(id, x, y, w, h, bg, labelText, strokeWidth = 1) {
  const textId = `${id}-label`;
  const r = rect(id, x, y, w, h, bg, "#1e1e1e", strokeWidth);
  r.boundElements = [{ type: "text", id: textId }];
  elements.push(r);
  const t = text(textId, x + 10, y + 8, labelText, 14, "#1e1e1e", {
    width: w - 20,
    height: h - 16,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: id,
  });
  elements.push(t);
}

// ---- Build the scene -----------------------------------------------------

elements.push(text("title", 590, 15, TITLE, 30, "#1e1e1e"));
elements.push(text("subtitle", 655, 56, SUBTITLE, 18, "#757575"));

for (const [zi, z] of ZONES.entries()) {
  elements.push(rect(`zone${zi}`, z.x, z.y, 480, z.h, z.zoneBg, z.header, 1));
  elements.push(text(`zone${zi}h`, z.x + 20, z.y + 15, z.title, 22, z.header));
  let itemY = z.y + 50;
  for (const [ii, item] of z.items.entries()) {
    const h = item.h ?? 40;
    labeledRect(`z${zi}i${ii}`, z.x + 20, itemY, 440, h, item.bg ?? z.itemBg, item.t, item.sw ?? 1);
    itemY += h + 6;
  }
}

const doc = {
  type: "excalidraw",
  version: 2,
  source: "gamenight-os/scripts/generate-project-map.mjs",
  elements,
  appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
  files: {},
};

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "project-map.excalidraw");
writeFileSync(out, JSON.stringify(doc, null, 1) + "\n");
console.log(`wrote ${out} (${elements.length} elements)`);

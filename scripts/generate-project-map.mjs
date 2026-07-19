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
const SUBTITLE = "July 2026 · source of truth: BACKLOG.md";

// Layout constants from MAP PROTOCOL: 3 cols x 2 rows, cols at x=40/560/1080
// each 480 wide, row 1 y=95 h=540, row 2 y=660 h=530. Items 440x40, 46px
// step, first 50px below zone top; taller boxes for wrapping labels.
const ZONES = [
  {
    x: 40, y: 95, h: 540,
    title: "SHIPPED — FOUNDATION", zoneBg: "#d3f9d8", header: "#15803d", itemBg: "#b2f2bb",
    items: [
      { t: "Auth: magic links + password accounts" },
      { t: "Crews: invites, roles, join / leave / delete" },
      { t: "Events + RSVPs with live updates" },
      { t: "Bracket engine: single + double elim, undo" },
      { t: "WebSocket live sync + TV broadcast views" },
      { t: "Lifetime stats ledger + recap share cards" },
      { t: "Quick play via hidden personal crews" },
      { t: "Arcade theme + PWA install; profiles + rivalry cards" },
      { t: "(NEW) Show-up check-in + event date editing + UI cleanup pass 2", bg: "#c3fae8", h: 52 },
      { t: "(NEW) Flake tracking + streaks, Friends, tabbed member pages", bg: "#c3fae8", h: 52 },
    ],
  },
  {
    x: 560, y: 95, h: 540,
    title: "SHIPPED — GAME PACKS", zoneBg: "#d3f9d8", header: "#15803d", itemBg: "#b2f2bb",
    items: [
      { t: "Beerio Kart: full replica, predictions, TV" },
      { t: "Smash: FFA + KOTH + characters + TV + stats" },
      { t: "Smash: double elim surfaced" },
      { t: "Mario Kart general tracking pack" },
      { t: "Mario Party: boards, stars, bonus stars, TV" },
      { t: "Title-scoped character selection (cross-pack)" },
      { t: "Generic bracket tracker + TV + recap" },
      { t: "Shared primitives: FFA roster, KOTH, brackets" },
    ],
  },
  {
    x: 1080, y: 95, h: 540,
    title: "NEXT UP (queued)", zoneBg: "#fff3bf", header: "#b45309", itemBg: "#ffd8a8",
    items: [
      { t: "1. Event night recap card, all games + MVP", h: 52, sw: 2 },
      { t: "2. (open slot — not committed)", sw: 2 },
      { t: "3. (open slot — not committed)", sw: 2 },
      { t: "Smashdown night (burned-fighter board)" },
      { t: "Smash Tournament format (bracket + fighters)" },
      { t: "Unify Smash + Mario Kart session packs" },
      { t: "Tabletop theme + theme switcher" },
      { t: "More packs: board games, darts, poker" },
    ],
  },
  {
    x: 40, y: 660, h: 530,
    title: "FEATURES TO ADD", zoneBg: "#dbe4ff", header: "#2563eb", itemBg: "#a5d8ff",
    items: [
      { t: "Mario Party minigame head-to-heads" },
      { t: "Link a guest to a crew member (rebind)" },
      { t: "Smack talk feed (TV and/or in-app)" },
      { t: "Stats on the TV view between matches" },
      { t: "Spectator predictions on generic Broadcast" },
      { t: "Seasons: 8-12 week arcs + offseason" },
      { t: "Round robin format" },
      { t: "Availability polling, auto-pick the night" },
    ],
  },
  {
    x: 560, y: 660, h: 530,
    title: "BUG FIXES", zoneBg: "#ffc9c9", header: "#b91c1c", itemBg: "#ffc9c9",
    items: [
      { t: "OPEN: magic link emails not sending on Render", h: 52, sw: 2 },
      { t: "FIX PLANNED: login CODE instead of emailed link", bg: "#ffd8a8", h: 52, sw: 2 },
      { t: "Watch: Resend only delivers to owner email", bg: "#fff3bf" },
      { t: "Watch: drizzle push can no-op in CI — check build log", bg: "#fff3bf", h: 52 },
      { t: "FIXED: Firefox double-back as Beerio spectator", bg: "#b2f2bb" },
      { t: "FIXED: Mario Party tie placements shared", bg: "#b2f2bb" },
      { t: "FIXED: PWA standalone + safe-area insets", bg: "#b2f2bb" },
    ],
  },
  {
    x: 1080, y: 660, h: 530,
    title: "IDEAS — NOT SOLIDIFIED", zoneBg: "#e5dbff", header: "#6d28d9", itemBg: "#d0bfff",
    items: [
      { t: "Draft night mode (snake drafts, TV board)" },
      { t: "Wager ledger (bragging rights only)" },
      { t: "Achievements + custom crew badges" },
      { t: "Beer pong pack (forces the team model)" },
      { t: "Pool / ping pong (rides KOTH engine)" },
      { t: "Cornhole, darts, poker night" },
      { t: "Capacitor native wrapper (push notifs)" },
      { t: "Offline score entry sync (PWA)" },
      { t: "Warm-up ping before game night (Render sleep)" },
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

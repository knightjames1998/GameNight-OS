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
// Redrawn 2026-08-22, because the counter read 3. THE REDRAW WENT FIRST, before
// this session's own work, which is what the counter is for: the partner-stats
// and Home-block work that follows it is NOT in this drawing, and increments the
// counter to 1 in its own commit. Same arrangement as 2026-08-17 and both 08-19
// passes. This pass:
//   - THE RECONCILE FOUND NO DRIFT, and that is worth writing down because it is
//     the first pass that can say it. Every item in SHIPPED, NEXT UP, FEATURES and
//     BUGS was checked against the repo: the three sessions since the last redraw
//     (the nickname session, the cascade integrity session, the on-deck session)
//     were all already written up, no bug entry was stale, and nothing left NEXT
//     UP. So this pass is purely additive.
//   - ZONE 1 TOOK TWO, both (NEW), 21 to 23. Crew and event deletion no longer
//     destroying the ledger (2026-08-20), and both bracketed TVs showing what is
//     NEXT rather than only what is READY (2026-08-21). Both are zone 1 rather
//     than zone 2 for the heading they live under: one is the delete path in the
//     shell's routes, the other is `bracketboard.ts` in packages/shared driving
//     two TVs. The second tournament lost its (NEW) on schedule.
//   - ZONE 2 TOOK ONE, (NEW), 27 to 28: a voter can change their nickname all
//     night. It is a PACK item because it is Beerio's own crowd screen. The crowd
//     bar and the two-host room sync both lost their (NEW), which is the whole job
//     of that marker: one redraw's worth.
//   - ZONE 5 IS UNCHANGED AT 16, and that is a finding rather than an oversight.
//     Neither the cascade session nor the on-deck session logged a new bug or
//     closed an open one, and no FIXED item was due to age out because the last
//     pass already dropped the last three. Six OPEN, ten Watch, still no FIXED.
//   - NO ROW MOVED, and this is the first pass in three to leave row 1 alone.
//     MEASURED BY READING THE GENERATED FILE BACK: zone 1 ends at 1671 in a zone
//     ending 2495, so 824px; zone 2 ends at 2225, so 270px. The standing test is
//     100px of slack after the pass's items land and both clear it comfortably.
//     THE ARITHMETIC THE LAST TWO PASSES USED SAYS SOMETHING DIFFERENT AND IS
//     RECORDED HERE RATHER THAN QUIETLY DROPPED: NEXT UP's numbered three are all
//     zone 2 packs, and 270px fits TWO of them at ~106 each, not three. That was
//     the trigger to raise on 08-19 and on its second pass, when the numbers were
//     138 and 114 and fitted one. At 270 the zone is neither over nor tight, and
//     "raise a row when a zone is over; leave it when a zone is under" is the
//     rule the protocol actually states. The next pass is the one that will need
//     to raise it; it is not this one.
//   - ZONES 3, 4 AND 6 ARE UNCHANGED. Nothing left NEXT UP, so the numbered three
//     are still Poker's tournament format, Smash Tournament and Party games.
//     ZONE 4 STILL CARRIES PARTNER STATS AND THE HOME BLOCK, deliberately: this
//     session ships both AFTER this drawing, so drawing them as shipped would be
//     drawing a state that does not exist yet. They move to zone 1 next redraw,
//     along with the eight backlog entries this session adds below them.
//   - Canvas 1560x3720, read off the generated file. Panorama camera 1600x3770.
//
// The 2026-08-10 pass, kept short: zone 2 took Card Table and Social Deduction,
// both (NEW); row 1 grew 1400 -> 1600; zone 3 shrank 7 items to 5; zone 5 took
// Board Game's and Card Table's shared TV overflow as an OPEN bug. Its own
// narrative, kept because it names the measure-the-file rule:
//   - ZONE 2 TOOK TWO, both (NEW): CARD TABLE and SOCIAL DEDUCTION. Deduction is ONE item
//     covering both of its parts, unlike the three separate items the 08-09 pass drew,
//     because part A and part B are two halves of one pack rather than three different
//     ideas. The three items from 08-09 lost their (NEW).
//   - ROW 1 GREW, 1400 -> 1600, because zone 2 went from 20 items to 22 and was 52px OVER.
//     1600 leaves it 106px, MEASURED BY READING THE GENERATED FILE BACK rather than by
//     hand, which is more than the 94px a large item costs, and POKER lands in that zone
//     next. Raised pre-emptively for the same reason every previous raise was. Row 2 moved
//     down by the same 200 so the columns stay aligned.
//   - Zone 3 SHRANK, 7 items to 5: Card Table and Social deduction both left by shipping.
//     The numbered three are now Poker, Smash Tournament and Party games. Tabletop stage 4
//     is still last, where James put it on 2026-08-04.
//   - ZONE 5 GAINED AN OPEN BUG THE LAST PASS COULD NOT HAVE DRAWN: Board Game's and Card
//     Table's shared TV is 176px over 1080p at twelve players. It was found ON 08-09, by
//     the session that ran immediately AFTER that redraw, which is exactly the case the
//     reconcile step exists to catch. Four OPEN, six Watch, one FIXED.
//   - Zone 4 took the Tournament entrants gap (James, 08-10), and its title-night item
//     dropped "Board Game defaults", which closed as a FINDING on 08-09 rather than as
//     work. Row 2 stayed at 840: both zones that grew had the slack.
//
// The 2026-08-09 pass, kept short: zone 2 took Board Game, the team primitive and the
// title-night layer, all (NEW); row 1 grew 1120 -> 1400; zone 3's numbered three became
// Card Table, Social deduction and Poker; zone 5 took the rail safe-area fix as FIXED.
//
// Earlier passes, kept short: 2026-08-04 (zone 1's tabletop item absorbed the three felt
// sessions; zone 5 SHRANK for the first time, 12 to 9), 2026-08-03 (row 2 grew 720 -> 840),
// 2026-08-02 twice (row 1 990 -> 1120, row 2 530 -> 660 then 660 -> 720, the pass that
// learned a row is THREE zones, not two), 2026-07-30 (row 1 920 -> 990) and 2026-07-29
// (row 1 860 -> 920).

// Layout constants from MAP PROTOCOL: 3 cols x 2 rows, cols at x=40/560/1080
// each 480 wide, row 1 y=95 h=2400, row 2 y=2520 h=1200. Items 440x40, 46px
// step, first 50px below zone top; taller boxes for wrapping labels.
const ZONES = [
  {
    x: 40, y: 95, h: 2400,
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
      { t: "TABLETOP THEME, SHELL COMPLETE AND REPAIRED: 80 tokens, warm-dark palette, a REAL felt tile (the shipped one was a 39-byte placeholder), a lamp that is a pool, cards that cast instead of being outlined, a mitred four-plank rail, woodtype face", h: 130 },
      { t: "BRACKETED TVs: shared round order, a STILL-ALIVE board in place of latest results, and a round strip. Both TVs, one rule each", h: 88 },
      { t: "TOURNAMENT SETUP SCREEN: entrants off the CREW, not the yes list. Guests, a seeding shuffle, and a team entrant is ONE slot (doubles)", h: 88 },
      { t: "QUICK PLAY IS ONE ROUTE THAT MINTS CONTEXT AND STOPS: the second entrant screen deleted, /quick a redirect, a parity test pinning it", h: 88 },
      { t: "A SECOND TOURNAMENT ON THE SAME NIGHT: allowed once every bracket is completed, never two at once. The guard, and the three limit-1 reads that agreed with it", h: 106 },
      { t: "CREW AND EVENT DELETION STOP DESTROYING THE LEDGER: one transaction each, and a hand-written cascade checked against the schema (NEW)", bg: "#c3fae8", h: 88 },
      { t: "BOTH BRACKETED TVs SHOW WHAT IS NEXT, NOT ONLY WHAT IS READY: three deck classes, and an empty seat names its feeder (NEW)", bg: "#c3fae8", h: 88 },
    ],
  },
  {
    x: 560, y: 95, h: 2400,
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
      { t: "BOARD GAME: one row per game played, title on the label, tapped order, canonicalized titles, seats 12", h: 70 },
      { t: "THE TEAM PRIMITIVE (teams.ts) + PING PONG DOUBLES: sides, 1,1,2,2 placement, pair ladder, singles pinned byte-identical", h: 88 },
      { t: "TITLE-NIGHT LAYER extracted from Board Game: engine, screens and routes, shared by two packs", h: 70 },
      { t: "CARD TABLE: the pack that is a config file. 50-line router, partnership defaults on Euchre and Spades", h: 88 },
      { t: "SOCIAL DEDUCTION (both parts): roles in a SEPARATE STORE so the session payload is public-safe by construction, factions with solo third parties, live moderator board, public TV that never leaks an unrevealed role, fits 20 at 1080p", h: 130 },
      { t: "MARIO KART PAIRS: two players, one kart, across all four formats. Sides all the way through, sidelog.ts extracted at the second consumer, Double Dash opens in pairs at exactly four", h: 106 },
      { t: "BOARD GAME wears the cloth: the stage 4 worked example. Same tile at an olive tint, the pack composing its own layer list, and the identity question settled for the other eight", h: 106 },
      { t: "POKER CASH GAME: the fourth pack on the cash engine, a THIRD bank type (no banker, the seats settle each other), and a table that has to add up", h: 88 },
      { t: "BEERIO CROWD BAR, READABLE FROM THE COUCH: the bar carries no text (17 of 32 palette colours clear 4.5:1), the split moves to the label row with swatches", h: 106 },
      { t: "TWO HOST DEVICES ON ONE BEERIO ROOM: the host page reads the room back instead of only writing it. A once-on-mount adopt made to repeat", h: 106 },
      { t: "A VOTER CAN CHANGE THEIR NICKNAME, ALL NIGHT: the crowd name box stops being one-shot, and a rename cannot move a row (NEW)", bg: "#c3fae8", h: 88 },
    ],
  },
  {
    x: 1080, y: 95, h: 2400,
    title: "NEXT UP (queued)", zoneBg: "#fff3bf", header: "#b45309", itemBg: "#ffd8a8",
    items: [
      { t: "1. POKER, THE TOURNAMENT FORMAT: blind levels are a wall clock shared across devices, which is a live-sync problem rather than a money one", sw: 2, h: 70 },
      { t: "2. Smash Tournament format (bracket + fighters)", sw: 2, h: 52 },
      { t: "3. Party games (Board Game plus a side)", sw: 2, h: 52 },
      { t: "Tabletop theme STAGE 4: the remaining EIGHT packs. Mechanism settled, casino tints settled, per-pack now (LAST, James 08-04)", h: 70 },
      { t: "More packs: darts" },
    ],
  },
  {
    x: 40, y: 2520, h: 1200,
    title: "FEATURES TO ADD", zoneBg: "#dbe4ff", header: "#2563eb", itemBg: "#a5d8ff",
    items: [
      { t: "PARTNER STATS: who you win most with (the primitive's missing payoff)", h: 52 },
      { t: "Smash 2v2 team battles (the bracket's half of this shipped 08-18)", h: 52 },
      { t: "Co-op titles (Pandemic): one side, everybody on it, win together", h: 52 },
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
    x: 560, y: 2520, h: 1200,
    title: "BUG FIXES", zoneBg: "#ffc9c9", header: "#b91c1c", itemBg: "#ffc9c9",
    items: [
      { t: "OPEN: a late write to an ABANDONED session steals the TV off the game being played (touch-recency's cost)", h: 52 },
      { t: "OPEN: Beerio's GRAND PRIX TV is 1206px over 1080p at twelve racers, and was never in the fit harness", h: 52 },
      { t: "OPEN: the bracketed TV does not fit 1080p at SIXTEEN PAIRS. Measured: it is the alive board, not the cards", h: 52 },
      { t: "OPEN: Mario Kart's TV does not fit 1080p past EIGHT racers, and was never in the fit harness", h: 52 },
      { t: "OPEN: Casino Run's TV has the same back-button blind spot the money board had", h: 52 },
      { t: "OPEN: Ping Pong's TV does not fit 1080p past SIX players (pre-existing)", h: 52 },
      { t: "OPEN: Board Game / Card Table TV is 156px over 1080p at TWELVE players", h: 52 },
      { t: "Watch: cold delivery to new recipients while domain warms", bg: "#fff3bf", h: 52 },
      { t: "Watch: countLastPlace IN list grows without bound", bg: "#fff3bf", h: 52 },
      { t: "Watch: ws hub broadcasts everything to everyone (no rooms)", bg: "#fff3bf", h: 52 },
      { t: "Watch: drizzle push can no-op in CI, check build log", bg: "#fff3bf", h: 52 },
      { t: "Watch: color-mix's opaque fallback on pre-2023 browsers (shell-wide since stage 1)", bg: "#fff3bf", h: 52 },
      { t: "Watch: the canvas share cards follow NO theme (16 hardcoded colours, JS not CSS)", bg: "#fff3bf", h: 52 },
      { t: "Watch: the sweep tracks no BOX-MODEL length, so padding and border-width move unseen", bg: "#fff3bf", h: 52 },
      { t: "Watch: judge a tiling texture at the PAINTED size; felt-variance scored a lattice higher", bg: "#fff3bf", h: 52 },
      { t: "Watch: Bevan overflows the stats tile on .gn-h2 at 390px (display face needs a width budget)", bg: "#fff3bf", h: 52 },
    ],
  },
  {
    x: 1080, y: 2520, h: 1200,
    title: "IDEAS — NOT SOLIDIFIED", zoneBg: "#e5dbff", header: "#6d28d9", itemBg: "#d0bfff",
    items: [
      { t: "Draft night mode (snake drafts, TV board)" },
      { t: "Wager ledger (money allowed since 07-29)" },
      { t: "Achievements + custom crew badges" },
      { t: "Beer pong pack (the team primitive exists now)" },
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

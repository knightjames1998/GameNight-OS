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
// Redrawn 2026-08-23, because the counter read 3. THE REDRAW WENT FIRST, before
// this session's own work, which is what the counter is for: the night-flow work
// that follows it (host check-in, the prefill chain, roster carry-over, guest
// chips) is NOT in this drawing and increments the counter in its own commit.
// Same arrangement as 2026-08-17, both 08-19 passes and 08-22. This pass:
//   - THE RECONCILE FOUND DRIFT, and it is the first pass that can say so. The
//     08-22 pass recorded "no drift" and was right on the day. TWO SHIPPED COMMITS
//     LANDED AFTER IT and neither wrote itself up: a Crews hint line on Home
//     (34d1486) and a casino becoming the default bank on every cash pack
//     (a591dbd), both AFTER that session's own counter-to-3 BACKLOG commit. Both
//     are in SHIPPED now. The lesson is about where a BACKLOG commit sits in a
//     session: walk `git log` against the file at a redraw, not only the headings
//     against the repo, because reading the file alone would have missed both.
//   - ZONE 1 TOOK TWO, both (NEW), 23 to 25: partner stats plus the real Home
//     stats block (the Crews hint line rides that item, since both are Home), and
//     the event TV's stats board plus the five TV density ladders. Crew/event
//     deletion and the two on-deck TVs lost their (NEW) on schedule.
//   - ZONE 2 TOOK ONE, (NEW), 28 to 29: a casino is the default bank on every cash
//     pack. A PACK item because it moves the shared casino setup screen and
//     `casino-runtime.ts`, and takes poker's dead banking control off the screen
//     with it. The nickname item lost its (NEW).
//   - ZONE 4 GREW BY SIX, 11 to 17, the biggest single move in this pass. Partner
//     stats and the Home block LEFT by shipping, and the EIGHT entries the 08-22
//     pass said it was adding "below them" are drawn for the first time. The
//     smack-talk item also dropped "TV stats", which shipped on 08-22.
//   - ZONE 5 IS UNCHANGED AT 16 AND COMPLETELY DIFFERENT IN COLOUR: five OPEN TV
//     overflows went FIXED in one session on 08-22, the most this file has ever
//     closed in a pass. Two OPEN remain (the late write stealing the TV, Casino
//     Run's back button), nine Watch traps, no new one logged.
//   - ROW 1 GREW, 2400 -> 2650, AND THE LAST PASS CALLED IT. Zone 2 would have
//     landed on 158px of slack at the old height after its one new item, MEASURED
//     BY READING THE GENERATED FILE BACK, and NEXT UP's numbered three are all
//     zone 2 packs at ~106px each: 158 fits one, not three. Same arithmetic that
//     raised the row at 138px on 08-19 and 114px on its second pass, and the 08-22
//     narrative wrote down that this pass would owe it. At 2650 zone 2 has 408px
//     and zone 1 has 850. Row 2 moved 2520 -> 2770 by the same amount so the
//     columns stay aligned; row 2's HEIGHT stayed at 1200, because neither zone in
//     it is over: zone 4 needs 1018 of it at 17 items (182 spare) and zone 5 needs
//     990 at 16 (210 spare).
//   - ZONES 3 AND 6 ARE UNCHANGED. Nothing left NEXT UP, so the numbered three are
//     still Poker's tournament format, Smash Tournament and Party games.
//   - Canvas 1560x3970, read off the generated file. Panorama camera 1600x4020.
//
// The 2026-08-22 pass, kept short: zone 1 took two (NEW), 21 to 23; zone 2 took
// one, 27 to 28; zone 5 unchanged at 16; NO ROW MOVED, the first pass in three to
// leave row 1 alone, and it recorded that the next pass would have to raise it.
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
// each 480 wide, row 1 y=95 h=2650, row 2 y=2770 h=1200. Items 440x40, 46px
// step, first 50px below zone top; taller boxes for wrapping labels.
const ZONES = [
  {
    x: 40, y: 95, h: 2650,
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
      { t: "CREW AND EVENT DELETION STOP DESTROYING THE LEDGER: one transaction each, and a hand-written cascade checked against the schema", h: 88 },
      { t: "BOTH BRACKETED TVs SHOW WHAT IS NEXT, NOT ONLY WHAT IS READY: three deck classes, and an empty seat names its feeder", h: 88 },
      { t: "PARTNER STATS + A REAL STATS BLOCK ON HOME: one self-join beside finishAggDeep, Home renders the payload it was throwing away, and Crews gets its hint line (NEW)", bg: "#c3fae8", h: 106 },
      { t: "THE EVENT TV GETS STATS, AND FIVE TVs GET DENSITY LADDERS: Ping Pong, the title-night pair, Mario Kart, the bracket and Beerio's GP. KNOWN is empty (NEW)", bg: "#c3fae8", h: 106 },
    ],
  },
  {
    x: 560, y: 95, h: 2650,
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
      { t: "A VOTER CAN CHANGE THEIR NICKNAME, ALL NIGHT: the crowd name box stops being one-shot, and a rename cannot move a row", h: 88 },
      { t: "A CASINO IS THE DEFAULT BANK on every cash pack: the setup screen and the runtime fallback both moved, minPlayers stops reading bank type, and poker's dead picker goes (NEW)", bg: "#c3fae8", h: 106 },
    ],
  },
  {
    x: 1080, y: 95, h: 2650,
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
    x: 40, y: 2770, h: 1200,
    title: "FEATURES TO ADD", zoneBg: "#dbe4ff", header: "#2563eb", itemBg: "#a5d8ff",
    items: [
      { t: "SAME PLAYERS AS THE LAST GAME: prefill off the event's last session, not the yes list", h: 52 },
      { t: "GUEST NAME MEMORY PER CREW: previously typed guests as tappable chips", h: 52 },
      { t: "RSVP NUDGE: \"4 haven't answered\" plus a button (the payload already carries it)", h: 52 },
      { t: "REPEAT OR DUPLICATE AN EVENT (no recurrence column today)", h: 52 },
      { t: "LOCATION AND NOTES ON AN EVENT (neither column exists)", h: 52 },
      { t: "FIX OR DELETE A COMPLETED RESULT: a question to answer before a screen", h: 52 },
      { t: "CONNECTION STATE PILL: \"reconnecting\" on the scoring screens", h: 52 },
      { t: "LOVERS (CUPID): two roles at once and a second win condition", h: 52 },
      { t: "Smash 2v2 team battles (the bracket's half of this shipped 08-18)", h: 52 },
      { t: "Co-op titles (Pandemic): one side, everybody on it, win together", h: 52 },
      { t: "Revisit the modifier wall's cut at three (the room exists now)", h: 52 },
      { t: "Single active pack + bounce everyone to the hub (TV half shipped)", h: 52 },
      { t: "Per-route dynamic link previews" },
      { t: "Mario Kart crew-wide racer table; MP minigame H2H", h: 52 },
      { t: "Smack talk feed; predictions ticker on the generic TV", h: 52 },
      { t: "Cross-pack night net (blackjack + poker on one night)", h: 52 },
      { t: "Seasons; round robin; availability polling", h: 52 },
    ],
  },
  {
    x: 560, y: 2770, h: 1200,
    title: "BUG FIXES", zoneBg: "#ffc9c9", header: "#b91c1c", itemBg: "#ffc9c9",
    items: [
      { t: "OPEN: a late write to an ABANDONED session steals the TV off the game being played (touch-recency's cost)", h: 52 },
      { t: "OPEN: Casino Run's TV has the same back-button blind spot the money board had", h: 52 },
      { t: "FIXED 08-22: Ping Pong's TV past SIX players, and the back button with it", bg: "#b2f2bb", h: 52 },
      { t: "FIXED 08-22: Board Game / Card Table at TWELVE, one ladder tuned to the taller", bg: "#b2f2bb", h: 52 },
      { t: "FIXED 08-22: Mario Kart past EIGHT racers (the roster, never the karts)", bg: "#b2f2bb", h: 52 },
      { t: "FIXED 08-22: the bracketed TV at SIXTEEN PAIRS (chip WIDTH, not slot count), and the four-fresh regression with it", bg: "#b2f2bb", h: 70 },
      { t: "FIXED 08-22: Beerio's GRAND PRIX TV, which had never fitted at any count", bg: "#b2f2bb", h: 52 },
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
    x: 1080, y: 2770, h: 1200,
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

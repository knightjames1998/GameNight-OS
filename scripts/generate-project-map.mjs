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
const SUBTITLE = "September 2026 · source of truth: BACKLOG.md";
// Redrawn 2026-09-15, because the counter read 3. THE REDRAW WENT FIRST, before
// this session's own work, the arrangement every pass since 08-17 has used: the
// tournament summary kind this session adds to the stats layer is NOT in this
// drawing and increments the counter in its own commit.
// This pass:
//   - THE RECONCILE WALKED git log AND FOUND DRIFT, only the second time it has
//     (the first was 08-23, which is why the step walks the log at all). All 24
//     commits since d75e17f belong to three sessions and all three wrote
//     themselves up, but TWO landed AFTER their session's BACKLOG commit and
//     neither amended it: 7a89e4e (the team-battles review pass, whose finding
//     was a comment asserting a rule that never fires) and 675d91e
//     (createPackRuntime throwing on a pack key the registry does not know).
//     Neither changes a number any zone draws, which is the point worth
//     recording: the cost of that drift was the record, not the map.
//   - ZONE 1 TOOK NOTHING, 36 items unchanged, THE FIRST PASS SINCE 2026-08-22
//     IT HAS NOT GROWN. Three (NEW) tags aged out on schedule. That is a
//     finding rather than an oversight: all three sessions since the last
//     redraw were pack work and bug work, so zone 1 had nothing to take, and
//     its 426px of slack is EXACTLY what the 08-30 raise was sized to leave.
//     Measured rather than assumed, by reading the generated file back.
//   - ZONE 2 TOOK TWO, both (NEW), 29 to 31: MP7 with the two MP6 corrections
//     and Tag Battle, and Smash team battles across all four formats. 1160 of
//     slack, so nothing is owed here for several passes.
//   - ZONE 3 CHANGED FOR THE FIRST TIME IN SEVEN PASSES, 5 to 6. Beerio takes
//     slot 1 as a FOUR-SESSION PROGRAM, moved in from FEATURES rather than
//     raised in a session, and Poker, Smash Tournament and Party games
//     renumber to 2, 3 and 4. The heavier stroke is no longer "the first
//     three": it is whatever NEXT UP numbers, and BACKLOG's colours line says
//     so in the same commit.
//   - ZONE 4 IS 11 TO 12 ON THREE MOVES, not one: Smash 2v2 team battles left
//     by SHIPPING, and the team-battles session deferred two items out of
//     itself on purpose (the solo-vs-team stats split, and making a handicap
//     visible). Beerio leaving for zone 3 is not visible here, because it
//     arrived in FEATURES after the last redraw and was never drawn.
//   - ZONE 5 WENT 16 TO 21, THE BIGGEST SINGLE GROWTH THIS ZONE HAS TAKEN.
//     One OPEN flipped to FIXED (the TV now asks before it changes hands, with
//     its unfixed half named on the item), one new OPEN came out of the
//     team-battles session's TV measurements, and FOUR came out of scoping the
//     Beerio program. The 08-30 correction to Mario Party's ladder is carried
//     too: it is over at FOUR, its own roster cap, not at the eight the
//     original measurement reported. Eight OPEN, ten Watch, three FIXED (the
//     two 08-28 sweep fixes are on their SECOND and last appearance).
//   - ROW 2 GREW, 1200 -> 1560, AND ROW 1 DID NOT MOVE. Only zone 5 was over,
//     by 62px (1262 of content in 1200), measured by reading the generated
//     file back. Sized in PASSES rather than items, as 08-30 established: this
//     pass cost zone 5 five items at 58px each, so a pass costs about 290, and
//     +360 leaves 298 -- one more pass at the rate this zone is actually
//     moving. Row 1 stays at 3650 because no zone in it is over and zone 1
//     took nothing, so row 2 stays at y=3770 and nothing needed realigning.
//   - Canvas 1560x5330, read off the generated file. Panorama camera 1600x5380.
//
// The 2026-08-30 pass, kept short: zone 1 took three (NEW), 33 to 36 (the
// signed-out cue, the tv-fit overlay probe, one QR on every TV); zone 5 went 14
// to 16 with two Watch traps closing and two new OPEN TV overflows; row 1 grew
// 3150 -> 3650, the third consecutive raise driven by zone 1 and the first ever
// made against a zone measured genuinely OVER rather than merely tight (three
// items put it at 3319 against a 3245 bottom). That raise is where SIZE A RAISE
// IN PASSES, NOT IN ITEMS comes from. Canvas 1560x4970.
//
// The 2026-08-28 pass, kept short: zone 1 took two (NEW), 31 to 33 (the help
// modal, the help button cue); zone 5 took one, 13 to 14; row 1 grew 2850 ->
// 3150, the second consecutive raise driven by zone 1. Place search shipped
// 08-27 and was reverted 08-28, entirely between two redraws, so it was never
// drawn — a pass that only ever added would have shown a feature the app does
// not have. Canvas 1560x4470.
//
// The 2026-08-27 pass, kept short: zone 1 took three (NEW), 28 to 31 (recurring
// nights, the crew page crash, the pinned card); zone 5 SHRANK 16 to 13 as the
// five 08-22 TV fixes aged out and two Watch traps went in; row 1 grew 2650 ->
// 2850, the first raise driven by zone 1 since 07-29. Canvas 1560x4170.
//
// The 2026-08-26 pass, kept short: zone 1 took three (NEW), 25 to 28 (night flow,
// the connection pill, the event layer bundle); zone 4 SHRANK by six, 17 to 11,
// the biggest drop that zone has taken, as three days of event-layer work landed;
// zone 5 unchanged at 16; no row moved, and it recorded 490px of zone 1 slack
// against a recurring-events item due next pass. Canvas 1560x3970.
//
// The 2026-08-23 pass, kept short: the FIRST reconcile to find drift (two
// shipped commits that never wrote themselves up, which is why the git-log rule
// above exists); zone 1 took two (NEW), 23 to 25; zone 2 took one; zone 4 grew
// by six as the 08-22 entries were finally drawn; zone 5 unchanged at 16 with
// five OPEN TV overflows turning FIXED in one session; row 1 grew 2400 -> 2650,
// the raise the 08-22 pass measured and declined.
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
// each 480 wide, row 1 y=95 h=3650, row 2 y=3770 h=1560. Items 440x40, 46px
// step, first 50px below zone top; taller boxes for wrapping labels.
const ZONES = [
  {
    x: 40, y: 95, h: 3650,
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
      { t: "PARTNER STATS + A REAL STATS BLOCK ON HOME: one self-join beside finishAggDeep, Home renders the payload it was throwing away, and Crews gets its hint line", h: 106 },
      { t: "THE EVENT TV GETS STATS, AND FIVE TVs GET DENSITY LADDERS: Ping Pong, the title-night pair, Mario Kart, the bracket and Beerio's GP. KNOWN is empty", h: 106 },
      { t: "THE NIGHT FLOW PASS: HOST CHECK-IN (a correctness fix, silence already flakes you), the prefill chain (last roster, then who showed, then who said yes), and two shared components on all nine setup screens", h: 130 },
      { t: "THE CONNECTION PILL, AND THE HEARTBEAT THAT MAKES IT HONEST: the server pings every 20s, because a dead socket says nothing and readyState reads OPEN forever", h: 106 },
      { t: "THE EVENT LAYER BUNDLE: where the night is (label + https-only link), the RSVP nudge on the share sheet already there, and run-it-again on past nights", h: 106 },
      { t: "RECURRING GAME NIGHTS: the repeat rule on its OWN row, occurrences from anchor plus index so a moved night cannot drag the series, generated lazily on a crew page read", h: 130 },
      { t: "THE CREW PAGE THAT KEPT CRASHING: a create response that was not the shape the cached list expects, and a boundary that now clears the cache ONCE rather than promising a reload that could not work", h: 130 },
      { t: "THE NIGHT'S DETAILS GET PINNED: the read view becomes the card the edit view already was, and an accent edge that sets its OWN width, because Tabletop's card border is 0px", h: 130 },
      { t: "A HELP MODAL OVER WHATEVER SCREEN YOU ARE ON: five sections, opened by a search param so the Back gesture closes it natively, and lazy because the budget gate refused it in the entry chunk", h: 130 },
      { t: "THE HELP BUTTON ASKS TO BE NOTICED, ONCE: gold on a first visit only, and a reduced-motion branch that KEEPS the colour, because here the motion is the message", h: 106 },
      { t: "THE SIGNED-OUT CUE GETS A SURFACE, AND THE SWEEP LEARNS TO SEE WHY IT DID NOT: a border COLOUR on a zero-width border paints nothing, and TRACKED_PROPS gains the four border widths and text-decoration-line", h: 130 },
      { t: "tv-fit CAN ASK WHERE A FIXED OVERLAY COULD GO, AND THE ANSWER WAS NOWHERE: four corner rectangles per case, one render each, and no corner clear at any size in either theme", h: 130 },
      { t: "ONE QR ON EVERY TV, AND A PHONE PAGE BEHIND IT: laid out rather than overlaid, one more child on a row every pack already had, a white plate whose quiet zone is measured, and a page a guest can read", h: 130 },
    ],
  },
  {
    x: 560, y: 95, h: 3650,
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
      { t: "A CASINO IS THE DEFAULT BANK on every cash pack: the setup screen and the runtime fallback both moved, minPlayers stops reading bank type, and poker's dead picker goes", h: 106 },
      { t: "MARIO PARTY 7, TWO MP6 CORRECTIONS, AND TAG BATTLE 2v2: a sixth title, and a team board whose ONE star total per SIDE is written to every member and split on read (NEW)", bg: "#c3fae8", h: 106 },
      { t: "SMASH TEAM BATTLES, ALL FOUR FORMATS: sides all the way through, Smashdown standings per SIDE because mercy provably stops working per player, and the normalize hook the pack never had (NEW)", bg: "#c3fae8", h: 130 },
    ],
  },
  {
    x: 1080, y: 95, h: 3650,
    title: "NEXT UP (queued)", zoneBg: "#fff3bf", header: "#b45309", itemBg: "#ffd8a8",
    items: [
      { t: "1. BEERIO BECOMES A REAL PACK: a FOUR-SESSION program. Tournament rows in the stats layer, then the engine into shared with a row per 1v1 match, then the client cutover, then the Hall of Fame import", sw: 2, h: 88 },
      { t: "2. POKER, THE TOURNAMENT FORMAT: blind levels are a wall clock shared across devices, which is a live-sync problem rather than a money one", sw: 2, h: 70 },
      { t: "3. Smash Tournament format (bracket + fighters)", sw: 2, h: 52 },
      { t: "4. Party games (Board Game plus a side)", sw: 2, h: 52 },
      { t: "Tabletop theme STAGE 4: the remaining EIGHT packs. Mechanism settled, casino tints settled, per-pack now (LAST, James 08-04)", h: 70 },
      { t: "More packs: darts" },
    ],
  },
  {
    x: 40, y: 3770, h: 1560,
    title: "FEATURES TO ADD", zoneBg: "#dbe4ff", header: "#2563eb", itemBg: "#a5d8ff",
    items: [
      { t: "FIX OR DELETE A COMPLETED RESULT: a question to answer before a screen", h: 52 },
      { t: "LOVERS (CUPID): two roles at once and a second win condition", h: 52 },
      { t: "Smash solo-vs-team stats split on the pack panel (Mario Kart and Mario Party both have theirs)", h: 52 },
      { t: "MAKE A HANDICAP VISIBLE: a 2v1 is a real result and no screen says so", h: 52 },
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
    x: 560, y: 3770, h: 1560,
    title: "BUG FIXES", zoneBg: "#ffc9c9", header: "#b91c1c", itemBg: "#ffc9c9",
    items: [
      { t: "OPEN: SMASH AND MARIO PARTY do not fit 1080p and never had a ladder; MP is over at FOUR, its own roster CAP", h: 52 },
      { t: "OPEN: SMASH'S TEAM TV cases are over, and so is its Smashdown at the only count it can reach", h: 52 },
      { t: "OPEN: the bracket TV clips 317px HORIZONTALLY, Arcade only, at 8 pairs mid", h: 52 },
      { t: "OPEN: Casino Run's TV has the same back-button blind spot the money board had", h: 52 },
      { t: "OPEN: a Beerio RERUN can vanish from stats: one client-built key the same seed reproduces on the same day", h: 52 },
      { t: "OPEN: an UNDONE Beerio final double-counts, and the first row is never retracted", h: 52 },
      { t: "OPEN: PUT /api/sessions/:code is PUBLIC and unauthenticated; any 4-char code overwrites a live night", h: 52 },
      { t: "OPEN: /beerio-complete takes any crew MEMBER, where standing rule 1 says hosts only", h: 52 },
      { t: "Watch: cold delivery to new recipients while domain warms", bg: "#fff3bf", h: 52 },
      { t: "Watch: countLastPlace IN list grows without bound", bg: "#fff3bf", h: 52 },
      { t: "Watch: ws hub broadcasts everything to everyone (no rooms)", bg: "#fff3bf", h: 52 },
      { t: "Watch: drizzle push can no-op in CI, check build log", bg: "#fff3bf", h: 52 },
      { t: "Watch: color-mix's opaque fallback on pre-2023 browsers (shell-wide since stage 1)", bg: "#fff3bf", h: 52 },
      { t: "Watch: the canvas share cards follow NO theme (16 hardcoded colours, JS not CSS)", bg: "#fff3bf", h: 52 },
      { t: "Watch: the sweep tracks no PADDING, narrowed 08-28 and left open on purpose: it holds meaning, not layout", bg: "#fff3bf", h: 52 },
      { t: "Watch: a word in a COMMENT can add a Tailwind utility to the shipped stylesheet", bg: "#fff3bf", h: 52 },
      { t: "Watch: judge a tiling texture at the PAINTED size; felt-variance scored a lattice higher", bg: "#fff3bf", h: 52 },
      { t: "Watch: Bevan overflows the stats tile on .gn-h2 at 390px (display face needs a width budget)", bg: "#fff3bf", h: 52 },
      { t: "FIXED 09-05: the TV ASKS before it changes hands, and 'no' cancels the write; a decline is still not recorded", bg: "#b2f2bb", h: 52 },
      { t: "FIXED 08-28: the sweep tracks text-decoration-LINE, and the rules filter had to learn the word too", bg: "#b2f2bb", h: 52 },
      { t: "FIXED 08-28: the sweep tracks all four border WIDTHS, after the gap shipped the same bug twice", bg: "#b2f2bb", h: 52 },
    ],
  },
  {
    x: 1080, y: 3770, h: 1560,
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

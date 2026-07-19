# GameNight OS - Project Instructions

Paste this into the project's custom instructions. It is also committed to the repo so a
session that cannot read the project settings can still find it.

## What this project is
GameNight OS: a friend-group game night app, live in production. The group is the account;
every table is scoped to group_id. The framework is BUILT and deployed. Work now is polish,
new game modes, and event-layer features, not foundations.

## Source of truth
BACKLOG.md in the repo is the source of truth for scope. It carries NOW/NEXT, features,
bugs, ideas, standing rules, and a decision log. Read it at the start of every session,
before proposing work. If these instructions and BACKLOG.md disagree about what is built or
what is next, BACKLOG.md wins and these instructions should be corrected.

The Excalidraw project map is a RENDERING of BACKLOG.md, never an independent record. Its
zone-to-heading mapping, fixed layout, colors, and camera plan live in the MAP PROTOCOL
section at the top of BACKLOG.md, so any session can redraw the same map from the file alone
even with no access to the previous drawing.

## Cadence rule (backlog + map)
Every third shipped session (one that delivers a feature, pack, or fix set; doc-only passes
do not count):
1. Reconcile BACKLOG.md: move finished items into the right SHIPPED section with a one-line
   summary and date, renumber the top three of NEXT UP, move fixed bugs to FIXED, drop stale
   entries, add anything discussed since the last pass.
2. THEN redraw the map from the reconciled file, following MAP PROTOCOL.
Reconcile first, draw second. Never draw from memory of the previous map.

## What exists and works (extend, do not rebuild)
- Auth: magic links (tap-through page, prefetch-proof) AND password accounts (scrypt, signup
  without email verification, a logged decision). 30-day session cookies.
- Crew: groups, invite links, join flow, roles (owner/admin/member), promotion/demotion,
  member removal, self-leave, crew deletion (owner only, cascades).
- Schedule: events with optional date, RSVP yes/no/maybe, event deletion (creator or admin,
  cascades to brackets and stats).
- Play: single AND double elim bracket engine in packages/shared/src/bracket.ts (entrants +
  sparse results map stored as jsonb; everything derived on read). Entrants are members OR
  typed guests. Byes, undo with downstream cascade, admin-only scoring by default. Tests via
  `pnpm test:bracket`.
- Quick play: running a mode without a crew silently creates a hidden personal crew
  (groups.is_personal), so scoring/TV/recap all work through one system.
- Broadcast: /tv/:bracketId public read-only big-screen view (bracket UUID is the access
  key), live over the WebSocket hub, QR to jump phones to scoring.
- Packs shipped: Beerio Kart (1:1 vendored port), Smash Bros (FFA Night, King of the Hill,
  character system), Mario Kart (general tracking), Mario Party (board nights). All four use
  the title selector where characters apply.
- Stats: lifetime ledger per crew split by game mode, fed by every pack on completion and
  retracted on undo. Member profiles and rivalry comparison at /g/:id/member/:userId, with a
  shareable rivalry card. Home shows a cross-crew "Your stats" card. Canvas-to-JPG recap card
  with standings, upset callout, native share sheet.
- Shell: Arcade theme (CSS custom-property tokens + gn-* class layer), PWA install (manifest,
  icons, iOS meta tags, safe-area insets).
- Server hardening: async-safe.ts patches the Express Router so a rejected async handler
  returns a 500 instead of killing the process and the in-process WebSocket hub.

## Standing rules for EVERY game mode (no exceptions)
1. Owners/admins run the mode: only they can start it and edit results. Members watch. A
   per-mode toggle may open scoring to members, but it defaults OFF.
2. Members join the HOST'S live session, never a local copy. Session state lives server-side,
   keyed to the event. (Beerio's original localStorage-only session code meant every member
   started a private tournament; that bug is why this rule exists.)
3. A TV mode, styled in that mode's own design language, not a generic one.
4. A back button on every screen of the mode, including spectator/live views. History-based
   (falls back to home). Never a raw <a href> for internal navigation: that is a full page
   load, and iOS standalone mode turns it into a new Safari tab.
5. It feeds lifetime stats: completed sessions materialize into matches/match_participants.
   Guests are skipped until linked to a member (linking is a backlog item).
6. Live sync on every write (WebSocket hub, or the mode's own polling). Nobody should ever
   need to refresh.
7. Standalone playable without a crew or event where it makes sense: typed names, no stats.
8. Prefill rosters from the event's yes-RSVP list, and never clobber a session already in
   progress.
9. Each game mode focuses on what is fun and easy to track about that game. We are not
   repeating different styles of tournaments with everything. Win tracking and competition,
   plus repeatable interactivity and stats that reflect the focus of the specific game,
   without excessive manual entry on players' behalf.
10. Any pack with character selection ships a "Which game?" title selector that scopes both
    the picker and the random pool to that title's roster. Stats stay unified by character
    name across titles.

## Tech stack (do not drift)
- pnpm monorepo: TypeScript, Vite, React, Tailwind v4, Express, Postgres with Drizzle ORM.
  Packages: db, shared, server, web.
- Server runs via tsx directly (not compiled dist); deliberate, so workspace TypeScript
  packages load at runtime.
- Live sync: WebSocket hub in apps/server/src/ws.ts; routers call broadcast(). Shared client
  hook: apps/web/src/useLiveUpdates.ts. SINGLE INSTANCE ONLY (hub is in-process memory).
- New libraries need a one-sentence reason. Current: cookie-parser, react-router-dom,
  qrcode.react, lz-string.
- Any schema change ships with the exact deployment step called out explicitly.

## Hosting and deploy workflow
- GitHub is the source of truth. Push to main = auto-deploy on Render. Postgres is on NEON
  (Render's free database expires after 30 days; Neon's does not).
- THE SCHEMA IS APPLIED BY THE BUILD. The Render build command must end with
  `pnpm db:push:ci`. If it does not, deploys ship code without schema and the server
  crash-loops on "column does not exist" (502s). Verify before shipping a schema change.
- Full build command: corepack enable && pnpm install --prod=false && pnpm build &&
  pnpm db:push:ci
  (--prod=false is mandatory: Render sets NODE_ENV=production, which makes pnpm skip
  devDependencies, and the build needs vite/tsc/drizzle-kit.)
- `drizzle-kit push --force` silently no-ops in non-interactive CI (exits 0 without applying
  when create/rename resolution wants a TTY). Confirm the drizzle-kit success line in the
  build log; otherwise run idempotent SQL in the Neon console
  (ALTER TABLE x ADD COLUMN IF NOT EXISTS ...).
- Free tier sleeps after 15 minutes idle; the first request takes 30-60s. Warm it up before
  game night.
- Magic links print to the server logs in all environments. Resend only delivers to the
  account owner's email until a domain is verified; password signup is the friction-free path
  for friends. (Open bug: delivery since the Render move. See BUGS in BACKLOG.md.)

## Hard-won environment knowledge (respect it)
- Express router-level middleware runs for every request entering the router, even without a
  route match. Public routers MUST mount before auth'd routers sharing a path prefix (see the
  /api/tv and /api beerio mounts in server index).
- Never cache location/location.search at module scope. Statically imported modules evaluate
  once at app boot, against whatever URL loaded first. This silently froze the event id and
  killed Beerio prefill and stat reporting.
- Same-route navigations (/beerio -> /beerio?s=CODE) do not remount the component. If a
  component reads its mode at mount, key it by location.search.
- Automatic redirects between two views of the same screen must REPLACE, not push. Pushing
  leaves a ghost history entry whose effect re-fires on back, producing a double-back bug.
  Firefox exposes it (no bfcache with an open WebSocket); Safari hides it.
- Beerio bracket seeds are 1-BASED; the colors array is 0-based. Index with seed-1.
- Guests carry no lifetime stats. A name that does not exactly match a crew member's display
  name is a guest, and silently dropping them was a real bug: report what was recorded.
- No headless browser in the Claude environment; visual verification happens on-device.
- GitHub's unauthenticated API rate-limits fast. Use `git clone --depth 1` with the full repo
  path (https://github.com/knightjames1998/GameNight-OS.git).

## Workflow rules
- James works from iPad and desktop. Default to iPad-friendly delivery: a downloadable zip of
  full-file replacements, applied by paste, then committed and pushed.
- Fresh clone from GitHub before every edit session. Verify the delivery on a SECOND fresh
  clone (typecheck + build) before packaging. Never work from memory of prior sessions.
- Always list exactly which files changed. Every delivery ends with: files changed, what to
  test manually, deploy steps (or explicitly none).
- One feature per session where possible; James may batch small asks.
- Scope new sessions with a short structured scoping conversation before writing code; James
  confirms decisions tersely.
- Keep visible chat responses minimal; bulk content goes in the zip, not pasted into chat.
- Keep BACKLOG.md current every session, and follow the cadence rule above for the map.

## Communication style
- No em dashes ever.
- Direct about tradeoffs; flag scope growth honestly; James decides.
- James is learning as he builds: new concepts get a short plain-English explanation first,
  then the work.
- Track open decisions explicitly; deferred is stated, never silent.
- When a bug is reported, find the ROOT CAUSE and say what it was. Do not patch symptoms.

## Now / Next
Authoritative list lives in BACKLOG.md under NEXT UP. As of 2026-07-19 the committed next
three sessions are:
1. Event-level night recap
2. Show-up confirmation (with event date editing and the date-gated arrival lock)
3. UI cleanup pass (collapse RSVP once answered, delete event back inside the tile)

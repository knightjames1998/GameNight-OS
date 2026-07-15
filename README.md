# GameNight OS

The operating system for friend-group game nights. Schedule the night, run the bracket, put the leaderboard on the TV, drop the recap card in the group chat. Live in production; the group is the account, every table is scoped to `group_id`.

## Structure

```
apps/
  server/    Express API + WebSocket hub, serves the built web app in production
  web/       Vite + React + Tailwind v4 frontend (PWA-first)
packages/
  db/        Drizzle schema + Postgres client. Every table scoped to group_id.
  shared/    Types shared between server and web (bracket engine lives here)
```

## What's built

- **Auth**: magic links (tap-through, prefetch-proof) and password accounts. 30-day sessions.
- **Crew**: groups, invite links, roles (owner/admin/member), member removal, self-leave, crew deletion.
- **Schedule**: events with RSVP (yes/no/maybe), live updates.
- **Play**: single-elim bracket engine, byes, undo with cascade, admin-only scoring by default (togglable open).
- **Quick play**: run a mode without a crew; a hidden personal crew is created so scoring, TV, and stats all still work.
- **Broadcast**: public read-only big-screen TV view per bracket, live over WebSocket, QR code to jump to scoring.
- **Beerio Kart**: the first full game pack, a 1:1 port of the standalone Beerio Kart Bracket app, bound to lifetime stats.
- **Legacy**: lifetime stats per crew, per game mode. Canvas-to-JPG recap card with native share sheet.

See GAMEPLAN.md for what's being built right now, and BACKLOG.md for the standing rules every game mode has to satisfy, the full idea backlog, and the decision log.

## Running it locally

Requirements: Node 20+, pnpm 9 (`npm i -g pnpm@9`).

```
pnpm install        # install everything
pnpm dev            # server on :3000, web on :5173 (proxies /api and /ws)
pnpm build          # full production build
pnpm start          # run production server (serves API + built web on :3000)
pnpm typecheck      # typecheck all packages
pnpm db:push        # push schema to DATABASE_URL (needed after any schema change)
```

Server runs via `tsx` directly, not compiled dist, so workspace TypeScript packages load at runtime without a build step in dev.

## Deploying

GitHub is the source of truth. Push to `main` auto-deploys on **Render**; the database is **Neon** Postgres (Render's free Postgres is deleted after 30 days, Neon's is not). Render reads `render.yaml`; the build command ends with `pnpm db:push:ci` so schema changes apply themselves on every deploy. Full walkthrough, including the Neon setup and the one trap to know about, is in RENDER.md.

## Ground rules

See GAMEPLAN.md for the build order and standing rules, and BACKLOG.md for everything not being built right now. Key principles: every table carries `group_id`, games are generic with packs layered on top, boring beats clever.

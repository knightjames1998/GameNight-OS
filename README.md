# GameNight OS

The operating system for friend-group game nights. Schedule the night, run the bracket, put the leaderboard on the TV, drop the recap card in the group chat.

## Structure

```
apps/
  server/    Express API + WebSocket hub, serves the built web app in production
  web/       Vite + React + Tailwind v4 frontend (PWA-first)
packages/
  db/        Drizzle schema + Postgres client. Every table scoped to group_id.
  shared/    Types shared between server and web
```

## Running it

Requirements: Node 20+, pnpm 9 (`npm i -g pnpm@9`).

```
pnpm install        # install everything
pnpm dev            # server on :3000, web on :5173 (proxies /api and /ws)
pnpm build          # full production build
pnpm start          # run production server (serves API + built web on :3000)
pnpm typecheck      # typecheck all packages
pnpm db:push        # push schema to DATABASE_URL (needed after any schema change)
```

## Replit setup

1. Import this repo from GitHub into Replit.
2. Add Replit's built-in Postgres to the Repl. It sets DATABASE_URL automatically.
3. Open the shell once and run: `npm i -g pnpm@9 && pnpm install && pnpm db:push`
4. Hit Run. The `.replit` config builds and starts the server on port 3000.

## Ground rules

See GAMEPLAN.md for the build order and BACKLOG.md for everything not being built right now. Key principles: every table carries group_id, games are generic with packs layered on top, boring beats clever.

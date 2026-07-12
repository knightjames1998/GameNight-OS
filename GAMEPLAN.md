# GameNight OS Game Plan

North star: a real friend group runs one full game night through the app. RSVPs collected, bracket run live, leaderboard on the TV, recap card in the group chat.

One feature per session where possible. Each phase ships something testable.

## Phase 0: Scaffold (this session)
Monorepo, schema, server skeleton, web shell, Replit deploy config.
Done when: repo builds, /api/health responds, placeholder page renders.

## Phase 1: Auth + Crew
Magic link login, create a group, invite link, join, member list.
New concept for James: magic link auth flow (token emailed, consumed once, becomes a session cookie).
Done when: two different people can be in the same group on their own phones.

## Phase 2: Schedule
Create a game night event, group members RSVP yes/no/maybe, organizer sees the list.
Done when: a real event has real RSVPs in it.

## Phase 3: Play
Generalize the Beerio Kart bracket engine: seed from RSVP yes list, single elim, score entry from a phone, winner advances.
Done when: a full bracket runs start to finish on phones.

## Phase 4: Broadcast
TV view: live bracket + leaderboard, designed for a 75" screen at couch distance. WebSocket push from score entry, polling fallback.
New concept for James: WebSockets (server pushes updates to open screens instead of screens asking repeatedly).
Done when: entering a score on a phone updates the TV within a second.

## Phase 5: Legacy v1
Recap card: canvas-to-JPG night summary (winner, upsets, final bracket), shareable to the group chat.
Done when: the card looks good enough that someone actually posts it.

## Phase 6: MVP night
Run a real game night end to end. Fix what breaks. Celebrate.

## After MVP
Pull from BACKLOG.md NEXT section: seasons, availability polling, Mario Kart pack, predictions ticker. Reassess order based on what the group actually asks for after the first night.

## Standing deployment notes
- Schema changes ship with the exact command: pnpm db:push (runs drizzle-kit push against DATABASE_URL).
- Replit needs env vars: DATABASE_URL (built-in Postgres), later SMTP creds for magic links.

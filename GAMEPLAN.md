# GameNight OS Game Plan

Live in production. The MVP framework is BUILT (Phases 0-5: scaffold, auth+crew, schedule, single-elim bracket engine, TV broadcast, recap card), and the first game pack (Beerio Kart) SHIPPED. This document tracks the features era: what's actively being built and the standing rules every mode has to satisfy. BACKLOG.md holds the full idea list, the decision log, and everything not being built right now.

## Standing rules for every game mode (no exceptions)
1. Owners/admins run the mode: only they can start it and edit results. Members watch. A per-mode toggle may open scoring to members, but it defaults OFF.
2. Members join the HOST'S live session, never a local copy. Session state lives server-side, keyed to the event. (Beerio's original localStorage-only session code meant every member started a private tournament; that bug is why this rule exists.)
3. A TV mode, styled in that mode's own design language, not a generic one.
4. A back button on every screen of the mode, including spectator/live views. History-based (falls back to home). Never a raw `<a href>` for internal navigation: that is a full page load, and iOS standalone mode turns it into a new Safari tab.
5. It feeds lifetime stats: completed sessions materialize into matches/match_participants. Guests are skipped until linked to a member (linking is a backlog item).
6. Live sync on every write (WebSocket hub, or the mode's own polling). Nobody should ever need to refresh.
7. Standalone playable without a crew or event where it makes sense: typed names, no stats.
8. Prefill rosters from the event's yes-RSVP list, and never clobber a session already in progress.

Full detail and the reasoning behind each rule lives in BACKLOG.md's STANDING RULES and DECISION LOG sections.

## NOW: Smash Bros game pack
Session A (FFA + King of the Hill + characters + TV + stats) and Session B (double elimination in the shared bracket engine, with a format dropdown on the event bracket and Quick Play; isolated tests via `pnpm test:bracket`) are SHIPPED. Remaining idea in this lane: a Tournament format inside the Smash launcher itself (see BACKLOG NOW).

The second game pack, built from scratch (not ported like Beerio Kart), so it's the first real test of whether the eight standing rules above generalize cleanly to a new mode.

Shape (confirm/refine at the start of the session, don't assume before then):
- Format: likely a stock-based bracket (single or double elim) with character/stage selection per match, but simpler than Beerio Kart's Grand Prix mode. Decide the minimum fun version first, defer extras to BACKLOG.md.
- Entrants: crew members or typed guests, same Entrant[] shape the generic bracket already uses.
- Data: new tables if the shape doesn't fit the generic bracket engine (packages/shared/src/bracket.ts) or Beerio's opaque-jsonb pattern (apps/server/src/beerio.ts). Decide which precedent to follow before writing schema, and call out the exact `pnpm db:push:ci` implication.
- TV mode: its own design language (not Arcade, not Beerio's kart theme) per standing rule 3.
- Stats: materializes into matches/match_participants per standing rule 5, same as generic brackets and Beerio nights, so Legacy stays one system across all three.

Nothing else starts until this pack satisfies all eight standing rules end to end: hosted by an owner/admin, live for members, its own TV view, back button everywhere, feeds stats, live sync, standalone-playable, RSVP-prefilled.

## NEXT: UI updates pass
The Arcade theme rollout (deep plum background, coral/teal player accents, chunky pressable buttons, Luckiest Guy wordmark, CSS custom-property tokens in index.css) already covers Home, Login, GroupPage, StatsPage, QuickPlayPage, EventPage, BracketPage, and TvPage. Remaining after Smash Bros ships:
- JoinPage (the invite-accept screen) still un-themed.
- Whatever new screens Smash Bros adds get themed as part of that pack, not deferred here.
- Branded packs (Beerio Kart, and Smash Bros once it has its own identity) keep their own visual language and are never reskinned to Arcade; that's a standing decision, not an oversight.
- Tabletop theme (the runner-up direction) stays a future opt-in, not built now.

## LATER (pull from BACKLOG.md when NEXT clears)
More game packs (board games, darts, poker), guest-to-member stat linking, smack talk feed, flake tracking. Full list and priority order in BACKLOG.md.

## Standing deployment notes
- GitHub is the source of truth. Push to `main` auto-deploys on Render.
- Postgres is on Neon, not Render's free Postgres (Render's expires after 30 days; Neon's does not). See RENDER.md for the full setup.
- THE SCHEMA IS APPLIED BY THE BUILD: the Render build command ends with `pnpm db:push:ci`. Full command: `corepack enable && pnpm install --prod=false && pnpm build && pnpm db:push:ci`. If a schema change ships without this running, the server crash-loops on "column does not exist" (502s). Verify this before shipping anything with a schema change.
- Emergency schema fix without a redeploy: idempotent SQL in the Neon console (`ALTER TABLE x ADD COLUMN IF NOT EXISTS ...`).
- WebSocket hub is in-process memory: SINGLE INSTANCE ONLY on any deployment (`numInstances: 1` in render.yaml).
- Free tier sleeps after 15 minutes idle; the first request takes 30-60s. Warm it up before game night.
- Magic links print to the server logs in all environments. Resend only delivers to the account owner's email until a domain is verified; password signup is the friction-free path for friends.

# GameNight OS Backlog

Ideas live here so nothing gets silently dropped. Status: NOW (current push), NEXT (after), LATER (someday), DEFERRED (decided against for now, with reason).

## SHIPPED (MVP framework, original Phases 0-5)
- [x] Magic link auth + password accounts
- [x] Crew: groups, invite links, join, member removal, roles
- [x] Events + RSVPs with live updates
- [x] Single-elim bracket engine (Beerio derive-from-results pattern), byes, undo cascade, scoring lock
- [x] TV broadcast view (public UUID link, QR to score, live)
- [x] Recap card (canvas-to-JPG, share sheet + download)
- [x] Beerio Kart game pack: 1:1 replica of the standalone app, bound to lifetime stats. Double elim + Grand Prix, spectator predictions, its own TV mode, live room bound to the event.
- [x] Legacy/stats screen: lifetime crew leaderboard at /g/:id/stats. Generic brackets and Beerio nights both materialize on completion, so stats span both bracket types.

## NOW
- [x] Smash Bros game pack, Session A: FFA Night (2-8) + King of the Hill + character system (self-select / random / host-assign, full Ultimate roster) + its own TV mode + lifetime character stats. Satisfies all 8 standing rules. Tournament for Smash reuses the existing single-elim engine (no new bracket code).
- [x] Smash Bros, Session B: double-elimination in the shared engine (packages/shared/src/bracket.ts): losers bracket, grand-final reset, undo cascade across both brackets, format dropdown on the event bracket and Quick Play. Isolated tests in packages/shared/tests/bracket.test.ts (`pnpm test:bracket`). The "Smash Tournament option" half is moot until the Smash launcher grows a Tournament format (below).
- [ ] Smash Tournament format: a third option in the Smash format picker that launches a bracket (single or double elim) from the Smash session roster and materializes with fighters. Today tournaments run through the generic bracket instead.

## NEXT (priority order set by James)
- [ ] UI design pass (paused, resumes after Smash Bros): Arcade theme rollout across the generic app.
      - Shipped: Home, Login, GroupPage, StatsPage, QuickPlayPage, EventPage, BracketPage, TvPage, plus the theme-token foundation in index.css.
      - Remaining: JoinPage (invite-accept screen), and whatever new screens Smash Bros adds get themed as part of that pack.
      - Branded packs (Beerio Kart, and Smash Bros once it has its own identity) keep their own styling and are NOT reskinned.
- [ ] Harden async route error handling (server). A rejected promise inside a route handler currently takes down the whole Node process, and with it the in-process WebSocket hub, so one bad query drops every connected client until Render restarts (~30-60s cold). Surfaced when a Smash game was recorded before the schema had applied: the missing-column error crash-looped the server instead of returning a 500. Fix: wrap routers in an async error boundary (an asyncHandler wrapper or a top-level error middleware) so a failed query returns an error response and leaves the process and the hub up. Pre-existing across all routers, not Smash-specific.
- [ ] More game packs. Candidates: board games, darts, poker night.
- [ ] Tabletop theme: build the second theme token block + a user-facing theme switcher (Arcade default, Tabletop opt-in). Foundation already laid (CSS variables + gn-* component classes).
- [ ] Smack talk feed (on the TV view and/or in-app)
- [ ] Flake tracking / RSVP streaks
- [ ] Link a guest to a crew member (crew settings): someone plays as a typed guest on night one, joins the crew later, and their past results get credited to them. Needs the Entrant guest shape (shipped) plus a rebind action.
- [ ] Stats on the TV view (leaderboard between matches)
- [ ] Per-member stat profile page (currently expandable rows on the crew leaderboard)
- [ ] Seasons: 8-12 week arcs with standings and an offseason
- [ ] Round robin format
- [ ] Availability polling and auto-pick-the-night
- [ ] Spectator predictions ticker on the generic Broadcast (port from Beerio Kart)

## LATER
- [ ] Draft night mode (snake drafts for characters/teams, TV draft board)
- [ ] Wager ledger (bragging-rights bets, confirmations, outstanding debts)
- [ ] Achievements/badges, including group-created custom badges
- [ ] Cross-game stats profiles per member
- [ ] Capacitor native wrapper: packages this web app as a real iOS/Android app for the app stores (same code, native shell, home screen icon, push notifications). Not needed while the PWA works.
- [ ] Offline score entry sync (PWA background sync)

## DEFERRED
- Smash character portraits: fighters are text-only for now. Portraits/thumbnails come with the UI pass (asset sourcing + licensing to think about). The roster and picker are built to swap in art without a data change.
- Smash stage tracking: which stage each game was on. Cut for Session A. Too much input per game for the payoff; the fun stat is the fighter, not the stage.
- Smash stock tracking: stocks remaining / KO counts per game. Cut for Session A for the same reason (per-life data entry). Winner + optional full placement is the low-barrier target (standing rule 9).
- House rules per group per game (versioned rule sets): deferred by James.
- Handicap engine: cut by James (not necessary).
- Venue/brewery league mode: different customer, different product. Revisit only if a venue asks.
- Money wagers: regulatory mess. Bragging rights only.

## STANDING RULES
- Owners/admins run a mode: only they start it and edit results. Members watch. A per-mode toggle may open scoring to members, but it defaults OFF.
- Members join the HOST'S live session, never a local copy. Session state lives server-side, keyed to the event.
- Every game mode/tracker ships with a TV/spectator view, styled in that mode's OWN design language, not a generic one. Generic bracket has /tv/:id; Beerio Kart has its original live spectator QR flow.
- Every game mode/tracker screen has a BACK button (history-based, falls back to home), and a way back to the event it belongs to. Never a raw <a href> for internal navigation (full page load; iOS standalone turns it into a new Safari tab). Shared component: apps/web/src/BackButton.tsx. Beerio has its own styled one in its header.
- Completed sessions materialize into matches/match_participants. Guests are skipped until linked to a member.
- Live sync on every write (WebSocket hub, or the mode's own polling). Nobody should ever need to refresh.
- Standalone playable without a crew or event where it makes sense: typed names, no stats.
- Prefill rosters from the event's yes-RSVP list, and never clobber a session already in progress.

## DECISION LOG
- "Format" terminology (2026-07-16): the things you pick inside a pack (FFA, King of the Hill; Beerio's Bracket vs Grand Prix; single vs double elim) are called FORMATS in user-facing copy, not "game modes" ("modules" was considered and rejected as too software-y). Code-level type names (SmashMode etc.) were left alone; this is a copy decision. The Smash "End night" button became "End format" because completing a session returns the host to the format picker to start another run the same night.
- Double elim engine (2026-07-16): shipped in the shared engine as Session B. The declarative-graph pattern extended exactly as the seed app does it: a {t:"lose",m} slot source feeds losers-bracket matches, GF/GF2 are built up front with GF2 gated on GF going to slot B (the reset), and undo stays "delete a key + cascade" — downstreamOf() follows win AND lose edges plus an explicit GF→GF2 edge. Ids are stable per format (single elim keeps R{r}M{i}, so old brackets read fine; double uses W/L/GF ids). Placements moved into the engine (placements()): in double elim only losers-bracket and deciding-grand-final losses eliminate. No schema push needed: drizzle text enums are TypeScript-level, existing rows default single_elim. Format dropdowns: event bracket + Quick Play. Tests: packages/shared/tests/bracket.test.ts via `pnpm test:bracket` (rides the server package's tsx on purpose — adding a devDep without regenerating pnpm-lock.yaml would fail Render's frozen-lockfile install).
- Smash session UX polish (2026-07-16): FFA "Record a game" starts with every roster player checked (plus a check all / clear all toggle) since full-roster games are the norm; the KOTH TV view shows the next challenger and the rest of the line ("Up next" / "Then"), not just the current king.
- Smash leaderboard (2026-07-16): the crew stats page (/g/:id/stats) gains a Smash-specific panel on the Smash Bros tab, replacing the generic per-game list there. It surfaces everything the pack tracks: per-player wins/win-rate/main/variety/best-streak, per-fighter wins/win-rate, and member head-to-head. Head-to-head is derived from shared games (better finish wins the meeting; equal finish, e.g. two non-winners in a winner-only FFA, is a no-edge meeting). Best streak is the longest run of consecutive wins within a single night, ordered by game position, which reads as the KOTH king streak and as an FFA hot streak. All of it comes from the materialized ledger via /groups/:id/smash-stats; the generic aggregator stays untouched.
- Smash deploy schema miss (2026-07-16): the Session A deploy shipped code but the DB was missing match_participants.character and smash_sessions, so recording a game crash-looped the server on "column does not exist". Root cause: pnpm db:push:ci (drizzle-kit push --force) exited 0 without applying the additive change. push is introspection-diff based and its create/rename resolution expects a TTY; --force only bypasses the destructive-change confirmation, so in Render's non-interactive build it can no-op and still exit clean. Fix applied: idempotent ALTER/CREATE ... IF NOT EXISTS in the Neon console (no redeploy needed). Takeaway: for schema-changing deploys, confirm the build log shows "[✓] Changes applied", and if not, run the idempotent SQL directly. Additive CREATE/ALTER ... IF NOT EXISTS is always safe to run by hand.
- Smash scope split (2026-07-16): the pack ships as two sessions. Session A = FFA Night + King of the Hill + character system + TV + stats, with Tournament reusing the existing single-elim engine. Session B = double-elimination in the shared engine, surfaced as a format dropdown in both the generic Tournament tracker and the Smash Tournament option. Double-elim was split out because it touches non-Smash code and its undo (re-routing losers between brackets + grand-final reset) needs isolated testing.
- Smash storage model (2026-07-16): FFA and KOTH are session-based, not brackets. A night is a running log of individual games held in one server-side row per event (smash_sessions, jsonb state), so members join the host's session rather than a local copy (standing rule 2). Each completed game materializes into matches/match_participants immediately, keyed smash:{eventId}:{idx} for idempotent undo/redo. The jsonb is the live working state; the matches tables are the durable ledger.
- Smash character tracking (2026-07-16): added one nullable column, match_participants.character, so the fighter played survives into the lifetime ledger (otherwise "wins with <fighter>" is impossible). It is a generic per-participant label; brackets and Beerio leave it null. This is the only schema change in Session A besides the new smash_sessions table; both are additive and apply via the existing pnpm db:push:ci in the Render build.
- Smash roster (2026-07-16): one flat list of every fighter across all games (the complete Ultimate roster, static since Sora in Oct 2021), no per-game filtering. Echo fighters are separate entries and the three Mii Fighters are separate; Pokemon Trainer and Pyra/Mythra are single picks (tracking which Pokemon or twin is the kind of per-life granularity standing rule 9 says isn't worth the input). Pinned against a current source at build time, not from memory.
- Smash result detail (2026-07-16): winner-only is the default (one tap), with an opt-in full-placement toggle for FFA (1..N). Low barrier for entry, meticulous mode available. KOTH and Tournament are inherently winner/loser so the toggle only affects FFA.
- Smash character assignment (2026-07-16): host picks one mode per session: players self-select on their own devices (default), host taps once for random, or host-assigns everyone. Self-select writes are scoped so a member can only set their own slot; the host can set any.
- Smash stats endpoint (2026-07-16): character stats (wins by fighter, each member's main, variety) come from a dedicated /groups/:id/smash-stats endpoint reading the pack's ledger rows, leaving the generic /groups/:id/stats aggregator untouched. Keeps the character focus out of the cross-game leaderboard and lowers the risk of destabilizing a working endpoint (standing rule 9).
- UI direction (2026-07-15): Arcade chosen as the app's visual identity (deep plum, coral + teal "player" accents, chunky pressable buttons, Luckiest Guy wordmark). Tabletop was the runner-up and is saved as a future opt-in theme, not built now.
- Theming architecture (2026-07-15): the app moved off hardcoded Tailwind color utilities onto CSS custom-property tokens plus a small gn-* component-class layer in index.css. Reason: Tailwind color utilities compile to fixed values and cannot be re-themed at runtime; CSS variables can. A second theme (Tabletop) becomes another token block plus a switcher, with no component rewrites.
- Theme scope (2026-07-15): generic app screens get the Arcade theme; branded packs (Beerio Kart) keep their own styling by design. The generic tournament TV mode gets an Arcade big-screen variant; Beerio's TV mode is untouched.
- BACKLOG.md recovery (2026-07-15): the "Prepare for render" commit (94cc12b) accidentally overwrote BACKLOG.md with an old copy of the Beerio source. Restored from the last good copy (bef93b5) and brought current. If it ever happens again: `git checkout <good-commit> -- BACKLOG.md`.
- Hosting (resolved): deploys run on Render free tier with Postgres on NEON (Render's free DB is deleted after 30 days; Neon's is not). The Render build command MUST end with `pnpm db:push:ci` or deploys ship code without schema and crash-loop on missing columns. See RENDER.md.
- Beerio TV mode: reads the SAME public live-session endpoint the spectator view uses and renders with the SAME exported engine functions the host runs, so the big screen can never disagree with the phones. Polls every 3s (WebSocket hub is not wired into the beerio pack's own sync).
- Generic brackets materialize into matches/match_participants on completion. Undoing a result past completion RETRACTS the recorded rows, so the ledger always matches reality.
- Placement rule for generic brackets: champion 1st, then everyone ranked by how late they were eliminated. Guests are skipped (no identity to credit).
- Passwords added pre-v1 (revised from "magic links only"): Resend free-tier delivery limits made email-only login painful for testing and for friends pre-domain-verification. Signup does NOT verify email ownership; magic links remain the fallback and the only verified path. Revisit verification before any public launch.
- Bracket scoring defaults open to all members; group owners/admins can lock it per bracket.
- TV/spectator view is public read-only, keyed by the bracket UUID (unguessable link, like invite codes). No login on TVs. Revisit if brackets ever carry private data.
- Quick play (Option B, chosen over a parallel statless system): running a mode without a crew silently creates a PERSONAL crew (groups.is_personal, hidden from the crew list). One system: scoring, TV view, recap all work unchanged. Entrants can be typed guests; guests carry no lifetime stats until linked to a member.
- Bracket entrants are Entrant[] ({kind:"member",userId} | {kind:"guest",name}). Legacy rows holding bare userId strings are upgraded on read by parseEntrants(), so no data migration was needed.
- Leaving a crew: any member can leave; an owner cannot leave while others remain (no ownership transfer exists yet).
- Beerio divergence from the original (bug fix): champion celebration and Hall of Fame keys are seed-based, not name-based. Name-based keys re-fired the champion popup and wrote a HoF entry per keystroke when editing names on a completed bracket.
- Beerio prefill: launching from an event prefills setup with the yes-RSVP list ONLY when nothing is recorded yet; setup-screen names from an older saved night get replaced, an in-progress tournament never does. Fires once per event per device via a localStorage flag.
- Beerio stats binding: names match crew members case-insensitively at completion time; unmatched names are guests and unrecorded. A member renamed mid-night won't match; acceptable v1.
- Firefox back-button (bug fix): the auto event->s=CODE member bounce used push navigation, leaving a ghost history entry; switched to replace navigation, plus a "Connecting to the night" gate so members never see the host's setup screen mid-fetch.
- Recap card sharing (resolved, shipped): native share sheet first, download fallback.

## OPEN DECISIONS
- Whether to reskin Beerio Kart to match Arcade later, or keep packs visually independent forever. Currently: packs stay independent.

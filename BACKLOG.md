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
- [ ] Smash Bros game pack (must satisfy all 8 standing rules). Plan tracked in GAMEPLAN.md.

## NEXT (priority order set by James)
- [ ] UI design pass (paused, resumes after Smash Bros): Arcade theme rollout across the generic app.
      - Shipped: Home, Login, GroupPage, StatsPage, QuickPlayPage, EventPage, BracketPage, TvPage, plus the theme-token foundation in index.css.
      - Remaining: JoinPage (invite-accept screen), and whatever new screens Smash Bros adds get themed as part of that pack.
      - Branded packs (Beerio Kart, and Smash Bros once it has its own identity) keep their own styling and are NOT reskinned.
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

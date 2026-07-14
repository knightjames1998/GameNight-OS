# GameNight OS Backlog

Ideas live here so nothing gets silently dropped. Status: NOW (current MVP push), NEXT (after MVP), LATER (someday), DEFERRED (decided against for now, with reason).

## SHIPPED (MVP framework, original Phases 0-5)
- [x] Magic link auth + password accounts
- [x] Crew: groups, invite links, join, member removal, roles
- [x] Events + RSVPs with live updates
- [x] Single-elim bracket engine (Beerio derive-from-results pattern), byes, undo cascade, scoring lock
- [x] TV broadcast view (public UUID link, QR to score, live)
- [x] Recap card (canvas-to-JPG, share sheet + download)

## NOW
- [ ] Beerio Kart game pack: 1:1 replica of the standalone app, bound to lifetime stats. Plan in GAMEPLAN.md.

## NEXT (priority order set by James)
- [ ] More game packs (the current priority). Candidates: Smash, board games, darts, poker night.
- [ ] Smack talk feed (on the TV view and/or in-app)
- [ ] Flake tracking / RSVP streaks
- [ ] Link a guest to a crew member (crew settings): someone plays as a typed guest on night one, joins the crew later, and their past results get credited to them. Needs the Entrant guest shape (shipped) plus a rebind action.
- [ ] Legacy/stats screen: lifetime stats are being RECORDED (Beerio) but nothing displays them yet. Biggest gap in what is built.
- [ ] UI design pass: the whole app is functional-but-boring placeholder styling. Deliberate for now; gets a dedicated design session (visual identity, bracket rendering with connector lines, animations).
- [ ] Seasons: 8-12 week arcs with standings and an offseason
- [ ] Round robin format
- [ ] Availability polling and auto-pick-the-night
- [ ] Flake tracking / RSVP streaks
- [ ] Mario Kart game pack (first real pack on the generic model)
- [ ] Spectator predictions ticker on Broadcast (port from Beerio Kart)

## LATER
- [ ] Draft night mode (snake drafts for characters/teams, TV draft board)
- [ ] Wager ledger (bragging-rights bets, confirmations, outstanding debts)
- [ ] Achievements/badges, including group-created custom badges
- [ ] Cross-game stats profiles per member
- [ ] Smack talk feed on Broadcast view
- [ ] Capacitor native wrapper: tool that packages this web app as a real iOS/Android app for the app stores (same code, native shell, home screen icon, push notifications). Not needed while the PWA works.
- [ ] Offline score entry sync (PWA background sync)
- [ ] Additional game packs: Smash, board games, darts, poker night

## DEFERRED
- House rules per group per game (versioned rule sets): deferred by James.
- Handicap engine: cut by James (not necessary).
- Venue/brewery league mode: different customer, different product. Revisit only if a venue asks.
- Money wagers: regulatory mess. Bragging rights only.

## STANDING RULES
- Every game mode/tracker gets a BACK button (goes to the previous screen, history-based, falls back to home). Shared component: apps/web/src/BackButton.tsx. Beerio has its own styled one in its header.
- Every game mode/tracker ships with a TV/spectator view.
- Every game mode/tracker ships with a TV/spectator view. The generic bracket has /tv/:id; Beerio Kart has its original live spectator QR flow.

## DECISION LOG
- Passwords added pre-v1 (revised from "magic links only"): Resend free-tier delivery limits made email-only login painful for testing and for friends pre-domain-verification. Signup does NOT verify email ownership; magic links remain the fallback and the only verified path. Revisit verification before any public launch.
- Bracket scoring defaults open to all members; group owners/admins can lock it per bracket.

- TV/spectator view is public read-only, keyed by the bracket UUID (unguessable link, like invite codes). No login on TVs. Revisit if brackets ever carry private data.
- Quick play (Option B, chosen over a parallel statless system): running a mode without a crew silently creates a PERSONAL crew (groups.is_personal, hidden from the crew list). One system: scoring, TV view, recap all work unchanged. Entrants can be typed guests; guests carry no lifetime stats until linked to a member.
- Bracket entrants are now Entrant[] ({kind:"member",userId} | {kind:"guest",name}). Legacy rows holding bare userId strings are upgraded on read by parseEntrants(), so no data migration was needed.
- Leaving a crew: any member can leave; an owner cannot leave while others remain (no ownership transfer exists yet).
- Beerio divergence from the original (bug fix): champion celebration and Hall of Fame keys are seed-based, not name-based. Name-based keys re-fired the champion popup and wrote a HoF entry per keystroke when editing names on a completed bracket.
- Beerio prefill (revised): fires once per event per device via a localStorage flag, replacing the "skip if any results exist" gate that silently blocked prefill when an old finished night sat in localStorage.
- Beerio stats binding: names match crew members case-insensitively at completion time; unmatched names are guests and unrecorded. A member renamed mid-night won't match; acceptable v1.
- Beerio prefill: launching from an event prefills setup with the yes-RSVP list ONLY when nothing is recorded yet; setup-screen names from an older saved night get replaced, an in-progress tournament never does.
- Beerio Kart folds in as the first game pack (resolves the original open decision): visually and functionally identical to the standalone app, but bound to GameNight identity so results feed lifetime stats. Guests allowed, excluded from stats.
- Recap card sharing (resolved, shipped): native share sheet first, download fallback.

## OPEN DECISIONS
(none right now; next ones will come from the Beerio Kart port, see GAMEPLAN.md)
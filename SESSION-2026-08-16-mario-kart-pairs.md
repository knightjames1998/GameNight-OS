# SESSION: Mario Kart pairs (two players, one kart)

Commit this file to the repo root before starting. Scoped 2026-08-16 with James.

## What this session is

Mario Kart gets **two players sharing one kart**, across all four formats. A kart is a
side. Karts are ranked by the tapped finish order. This is Ping Pong doubles again, on a
pack whose shapes are single-player by construction.

**This is NOT Team VS.** The decision log entry of 2026-08-05 stands untouched: a Team VS
side's rank comes from its members' summed points, which would be the first team placement
this app COMPUTES rather than RECORDS. Nothing in this session computes a placement. If
you find yourself summing points to decide who won, stop, because you have drifted into a
mode James deliberately did not queue.

## The architectural call, already made

**Fork into Mario Kart. Do not open `packages/shared/src/smash.ts`.**

`MkSessionState` is `Omit<SmashSessionState, "format" | "battleCount" | "burned" | "mercy">`
and `kothAdvance` lives in `smash.ts` keyed on `winnerId` / `loserId`. So Mario Kart and
Smash share a session shape, and the tempting move is to put sides into the shared shape so
Smash 2v2 comes along free. That move is rejected, for three reasons:

1. **Ping Pong already answered this.** `pingpong.ts` imports from `teams.js` and nothing
   else. It did not reuse `kothAdvance`. It wrote its own `PpKothState` with a `kingSideId`
   and a queue of SIDE ids, and its own rotation inline. Smash was never opened. Share the
   primitive, fork the rotation. That is the established pattern and this session follows it.
2. **Smashdown.** Sides in `SmashSessionState` drag the burn board into a session scoped as
   "pairs in Mario Kart". Whether a pair burns two fighters or one changes the
   `floor(rosterSize / playerCount)` arithmetic the setup screen prints as a sentence, and
   BACKLOG.md says explicitly to ask rather than assume. Separate session.
3. **`kothAdvance` is shipped and stable.** Changing what its ids mean fails silently:
   nothing errors, a throne is just held by somebody who never played. That is the exact
   class this project guards against.

The cost is that Mario Kart and Smash diverge further. Accepted, and worth recording: they
are already typed apart on purpose (the comment on `MkSessionState` says so) and the `Omit`
already drops four fields. Smash 2v2, when it comes, will have TWO worked examples to copy
from rather than inheriting a shape nobody validated against it.

## The extraction this session earns

Ping Pong's side-arrangement log is generic and **Mario Kart is its second consumer**, so it
comes out into shared. Same rule the money board and the title-night layer came out under:
one example is a pack, two is a layer.

New file `packages/shared/src/sidelog.ts`, importing from `teams.js`. It carries:

- the `{ fromIdx, sides }` entry type and the list of them,
- `currentSides(log)`, the arrangement in force,
- `reshuffle(log, sides, matchCount)`, including the REPLACE-rather-than-stack rule when no
  matches have run under the last entry, so changing your mind twice leaves no dead entry,
- `sidesAtIdx(log, idx)`, the arrangement a given match was played under,
- the truncation rule for undoing back past a reshuffle.

It is a new file rather than an addition to `teams.ts` deliberately: `teams.ts` is a pure
primitive with no notion of a session timeline, and folding a timeline into it makes the
primitive harder to reason about. Deep imports are cheap since the cleanup added the
`exports` map.

**Ping Pong converts onto it in the same commit, and the conversion must be provably
behaviour-free.** Capture fixtures off the UNMODIFIED engine first (a doubles night, a
singles night, a KOTH night with a mid-night reshuffle, and an undo back past that
reshuffle), confirm them green, and only then move a line. This is the discipline the
doubles conversion and the pack-runtime refactor both used, and in both cases the fixtures
found a real bug that reasoning by hand had missed.

## Formats

All four seat pairs. In rough order of cost:

- **Free Play.** Cheapest. A race is a tapped order of karts. `placementsFromRankedSides`
  already produces 1,1,2,2 for two karts of two.
- **Best Of.** Head to head between two sides. Ping Pong's worked example.
- **Grand Prix.** `cupStandings` accumulates per player off `g.lines`, so both members of a
  kart receive the kart's points unchanged. **Do not modify `cupStandings` or `mkPoints`.**
  Add fixtures proving a pair night sums correctly and that a solo night is untouched. The
  accepted double-count is the same one written down for Ping Pong's reign credit: two
  people on a kart that finished first both genuinely finished first.
- **KOTH.** The work. Needs the side log with `fromIdx`, because the throne and queue are
  rebuilt by replaying matches, and a replay that does not know which arrangement each
  stretch was played under hands the throne to a pair that never played. Winning kart holds
  the table, losing kart rotates to the back TOGETHER. Write Mario Kart's own side-keyed
  rotation next to its state, the way `pingpong.ts` does. Do not reach for `kothAdvance`.

## The auto-apply rule (James, 2026-08-16)

**Double Dash plus exactly four players opens in pairs.** Grounded in the actual game: the
GameCube has four controller ports, so four players in two karts is what a Double Dash co-op
night IS. It follows the Euchre precedent, and for the same reason: a default that has to be
found in a menu is a default that does not get used, and the alternative is a crew recording
four races as a free-for-all and noticing in the stats a month later.

Three guards, each with its own named test, because all three fail silently if wrong:

1. **It fires only when the side count differs.** A host who has already put four people into
   two specific karts and then taps Double Dash keeps their karts. Free-for-all counts as one
   side per player, so its count is the roster size.
2. **Going the other way is deterministic.** Tapping MK8 Deluxe (or any title that is not
   Double Dash) with the roster in pairs returns `singletonSides` in ROSTER ORDER, never a
   shuffle, so Double Dash then MK8DX then Double Dash hands the host the same screen back.
   Reverting is correct rather than merely tidy: no other title in the roster has a shared
   kart.
3. **Setup only, never once a race has been logged.** Once races exist, changing the
   arrangement is `reshuffle` with a `fromIdx` and it is a deliberate host action. An
   auto-apply that rearranged the table between two races would silently change what the
   night was played under, and it would look exactly like a host who rearranged it on
   purpose.

**Exactly four, and nothing else, and that is a deliberate line rather than a starting
point (James, 2026-08-16).** Auto-apply is a convenience for the one shape that is
unambiguous. Every other arrangement, including uneven ones, is available and is OPT-IN.
Three players is not two even karts, and auto-dealing somebody into a solo kart is the app
making a judgement about a night it was not at. Two players is a 1v1, which is singletons.
Six and eight are not reachable on one console, and a host running two consoles can set
karts by hand. Do not widen this rule to "any even roster" because it looks tidier.

Evaluate the predicate at the two points where its inputs change, the title route and a
roster change, and never on the record route. The record form can carry its own title, and
rearranging the table at the moment a result is submitted would change the sides the race
was just played under.

## Uneven karts are supported (2v1 and friends)

A three-player Double Dash night where two share a kart and one drives alone is a real
thing a crew does, so the host can set it and the app records it. **The primitive already
allows this and the session must not narrow it.** `validateSides` returns `even` as a FACT
for the screen to warn with, not as an error, and only genuinely broken arrangements are
refused: fewer than two sides, an empty side, a player on two sides at once.
`shuffleIntoSides` already distributes the remainder rather than dropping anybody, so a
random deal of three into two gives 2 and 1.

Four consequences, each of which needs its own named test because none of them errors:

1. **The solo racer gets a REAL side id, not null.** `isTeamPlay` is true because another
   side holds multiple members, so `sideIdFor` does not take its null-when-every-side-is-one
   branch. This is exactly the shape the Social Deduction session named a test for: a null
   `side` on a row like this would make `meetingOutcome` read the pair and the solo as
   having played TOGETHER, and the rivalry would be wrong forever with nothing erroring.
2. **Placements are 1, 1, 2 for a winning pair, or 1, 2, 2 for a winning solo.** Sides are
   ranked 1..N, so a 2v1 has two places to finish and three participant rows. Do not reach
   for competition ranking here; that rule is for genuine ties between players.
3. **Last place is unaffected and that is correct.** `countLastPlace` compares a placement
   against the participant count, so the losing solo is placement 2 of 3 and never
   qualifies. In a two-sided race there is a loser, not a last. This is the 2026-08-05
   decision applied, not a new one.
4. **Grand Prix needs no change.** Each player receives their kart's points, so a pair
   finishing first gives both members 15 and the solo in second gets 12. Per player that is
   correct and the standings table is per player. Do not add a per-side standings view in
   this session; if James wants one it is a separate decision about what a cup means.

Surface unevenness on the picker as information, never as a blocking error and never
styled like a failure. A KOTH night with an odd roster is better served by three sides than
two, since two sides gives a king and a queue of one and the ladder stops meaning anything;
say so on the screen rather than refusing the arrangement.

## Hard guards

- **Do not open `packages/shared/src/smash.ts`.** If you believe you must, stop and report
  why instead.
- **No schema change.** `match_participants.side` shipped 2026-08-02. Nothing is owed in the
  Neon console and the deploy is the push.
- **No renamed permanent identifiers.** `games.pack`, the `game_sessions.pack` key,
  `ledgerKey`'s prefix, the `wsType` string and the `ensureGame` display name for Mario Kart
  all stay exactly as they are. Any of them moving splits a shipped pack's history into a
  leaderboard tab of its own, silently.
- **No new format string and no new `matches.label` value.** The stats split is DERIVED from
  `side IS NOT NULL`, the way Ping Pong's is. A mislabelled row is unrecoverable history; a
  derived split is a query anyone can change their mind about later.
- **No new devDependencies and no lockfile regeneration.** Render installs with
  `--frozen-lockfile`.
- **A solo Mario Kart night must be byte-identical to what ships today.** `sideIdFor` returns
  null when every side is one, and a null `side` classifies in `meetingOutcome` exactly as it
  always did. Prove this with fixtures rather than asserting it. Note that MK caps at eight
  players through `validateFfa`'s default and `MAX_SIDES` is eight, so eight singletons sits
  exactly at the cap with nothing to reconcile.
- **No em dashes anywhere**, including in this file's descendants and in BACKLOG entries.
  `copy-rules.test.ts` checks four spellings, and a grep for the character alone will miss
  the HTML entity form written in JSX, which is how five of them survived a pass that
  reported clean.

## Ordered commits

Every one gated on `pnpm -r typecheck`, then `pnpm build`, then `pnpm test`, all passing
before the next begins. A commit that has not passed all three is not finished.

1. **Fixtures, no production code.** Current Mario Kart behaviour across all four formats
   captured by RUNNING the unmodified engine: the ledger rows, the night summary, a Grand
   Prix cup's standings, a KOTH rebuild. Plus Ping Pong's side log behaviour including a
   mid-night reshuffle and an undo back past it. Green before anything moves.
2. **`sidelog.ts` extracted, Ping Pong converted onto it.** Fixtures from commit 1 prove no
   behaviour changed. Zero user-visible difference.
3. **Mario Kart state takes the side log**, stopping its inheritance of the side-bearing
   parts of the Smash shape. Free Play and Best Of seat pairs.
4. **Grand Prix fixtures.** `cupStandings` and `mkPoints` untouched; the tests say so.
5. **KOTH**, side-keyed, rebuilt by replay, undo past a reshuffle restores the previous
   arrangement.
6. **`normalizeMkState`** through the existing `normalize` hook on the pack runtime, so a
   session live when this deploys keeps working. Follow `normalizePpState`, which maps a
   legacy queue of player ids onto side ids at the two points where jsonb becomes state.
7. **Client.** `TeamPicker` into `apps/web/src/mariokart/MarioKartPage.tsx`, the TV view in
   `MarioKartTvPage.tsx` showing karts rather than racers, the auto-apply rule and its three
   guards. `BackButton` and router links only, never a raw anchor.
8. **Stats panel** in `StatsPage.tsx`: solo and pairs split, derived from `side IS NOT NULL`.
   Print both halves so a reader can check they sum to the unsplit totals.
9. **Close the Paratroopa todo** in `packages/shared/tests/mariokart.test.ts`. `isRacer`
   rejects a racer the Double Dash picker offers, which reaches the ledger as null and is
   currently rescued only by a fallback on both server gates. The file is open anyway.
10. **BACKLOG.md**: shipped entry, decision log entries for the fork call and the auto-apply
    rule, and the **MAP STATUS counter incremented to 3** in the same commit. The next
    session then opens with a reconcile and a redraw before its own work, which is the point.

Commits 1 and 2 are a clean split point if this runs long. They change no behaviour and
leave the tree in a shippable state.

## Verification beyond the gates

- `scripts/theme-sweep.mjs` before and after on both Mario Kart screens. The screens
  baseline compares TEXT and cannot see a repaint. Arcade must be computationally identical.
- The TV view is already measured against 1080p. Adding a kart line must not push it over.
  Measure rather than eyeball, and fold new information into lines that already exist rather
  than giving it a block of its own, which is what the doubles TV pass had to do.
- `pack-screens.test.ts`, `pack-identifiers.test.ts` and `bundle-budget.test.ts` all run in
  `pnpm test` and all three are load-bearing here.

## End of session, report exactly this

Files changed. What James tests by hand on a real device, including a Double Dash night that
proves the auto-apply fires and a solo night that proves nothing moved. Deploy steps, which
should be "none beyond the push". Confirmation that the Render deploy went green, not just
that the push succeeded. Confirmation that MAP STATUS now reads 3.

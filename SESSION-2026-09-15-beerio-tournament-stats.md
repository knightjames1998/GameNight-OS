# SESSION 2026-09-15: map redraw, then Beerio tournament rows in the stats layer

Session 1 of 4 in the BEERIO BECOMES A REAL PACK program. Commit this file to the
repo root in the first commit.

## Start of session (non-negotiable)

1. Fresh `git clone --depth 1 https://github.com/knightjames1998/GameNight-OS.git`, then
   `git fetch --deepen=60` so the reconcile can walk history.
2. `cat BACKLOG.md`. MAP STATUS read **3** when this session was scoped (head `675d91e`).
   If it still reads >= 3, the reconcile and redraw below come FIRST. If head has moved
   past `675d91e`, stop and report what changed before doing anything.
3. Run the four gates once before touching anything and record what they PRINT.

## Why this session exists

James wants Beerio nights to write every 1v1 bracket match to the ledger (so they feed
rivalries) plus one tournament row for the podium. Today the stats layer knows exactly
one kind of summary row, identified by `label === SERIES_LABEL` (`"smashdown"`), and
every game counter, the format buckets, the meeting map, the recap and one SQL filter
(`ne(matches.label, SERIES_LABEL)` near stats.ts:1061) skip it. A Beerio tournament row
written without teaching the stats layer about it gives every racer a phantom game and
the champion a phantom win. `stats.ts` is the shared aggregation layer, so this change
is isolated in its own session, before any Beerio code is touched.

**This session is behaviour-neutral in production until the closeout SQL runs.** No
row carries the new label until then, so commits 3 to 6 can deploy one at a time.

## Ordered commits

### 1. RECONCILE (BACKLOG.md only)
- Walk `git log` since `d75e17f` (the 08-30 redraw) against BACKLOG. Expected: the MP7 /
  Tag Battle session, Smash team battles and the TV ownership gate, all written up.
  Report any commit that is not.
- **Drift to log:** the two 2026-09-05 session prompts
  (`SESSION-2026-09-05-smash-teams.md`, `SESSION-2026-09-05-tv-ownership-confirm.md`)
  were never committed to the repo root. They cannot be recovered from here; log the
  gap in MAP STATUS history rather than inventing them.
- **Move the Beerio entry out of FEATURES and into NEXT UP as slot 1**, renumbering the
  existing three to 2, 3 and 4. Rewrite it as a four-session program carrying every
  decision in "Locked decisions" below, verbatim in substance.
- **Add four OPEN bugs to BUGS**, each naming the program session that closes it:
  1. A rerun can vanish from stats. The completion key is
     `{b|g}|s{winnerSeed}|{UTC date}|{n}p|{count}h`, built client-side. The same seed
     winning in the same number of matches on the same UTC day produces the same key;
     `/beerio-complete` dedupes it and the localStorage `bk-hof:` flag returns before
     reporting. The second tournament is never recorded. Closes in session 2.
  2. An undone final double-counts. Undo the grand final and pick the other winner: new
     seed, new key, a second `matches` row. The first is never retracted. Session 2.
  3. `PUT /api/sessions/:code` is public and unauthenticated, so anyone holding a
     4-character code can overwrite a live night (31^4 codes). `PUT /api/hof/:code` has
     the same shape. Session 3 (sessions), session 4 (HoF).
  4. `/beerio-complete` accepts any crew member, where standing rule 1 says hosts only.
     Session 2.
- **Log each locked decision in the DECISION LOG** dated 2026-09-15, James's calls
  attributed to James.

### 2. MAP
- Redraw with `scripts/generate-project-map.mjs` per MAP PROTOCOL. Beerio's program lands
  in zone 3 as NEXT UP slot 1 with the heavier stroke; the four new bugs land in zone 5.
- Measure zone heights by reading the generated file back. Zone 1 was 74px over on the
  last pass and zone 2 takes MP7/Tag Battle and Smash teams on this one: raise rows only
  on measurement, and write the arithmetic into MAP STATUS history the way prior passes
  did.
- Reset MAP STATUS: date 2026-09-15, counter 0. Do not write a conclusion under the
  numbers.

### 3. BASELINE (tests only, before any change)
- Build a pure fixture ledger (extend `tests/result-fixture.ts` if it fits) containing:
  Smash battles plus their `smashdown` series row; generic bracket rows (label
  `"Tournament"` or a game name); legacy Beerio bracket rows (label NULL, externalKey
  `b|...`, format NULL, placements 1..N); legacy Beerio Grand Prix rows (`g|...`); and
  ordinary rows from two other packs.
- Capture, by RUNNING the current code, the outputs of `feedAgg` / `finishAgg`, the
  per-format buckets, the per-game counts, the meeting map and `meetingOutcome` results,
  and the recap rollup over that fixture. Pin them. Hand-written expectations are not
  acceptable here.

### 4. CLASSIFIER
- Add a fixed constant `BEERIO_TOURNAMENT_LABEL = "beerio_tournament"`. It is a ledger
  identifier: pick it once, never change it, add it to `pack-identifiers.test.ts`.
- Add one classifier, `summaryKind(label): "series" | "tournament" | null`, plus a
  `SUMMARY_LABELS` array for the SQL spelling, in a neutral shared module (not
  `smash.ts`). Keep `isSeriesSummary` exported with its current meaning so Smash's own
  series standings are untouched.
- Audit EVERY caller of `isSeriesSummary` and `SERIES_LABEL` (currently stats.ts at the
  format buckets, per-game counts, `feedAgg`, the meeting map and the SQL filter;
  events.ts recap; smash.ts series standings). For each, decide and comment whether it
  means "skip any summary" or "Smash series specifically". Only smash.ts should stay
  series-specific.
- The SQL filter uses `SUMMARY_LABELS`. Add a test pinning that the JS classifier and the
  SQL list agree, in the style of `partner-stats-baseline.test.ts`.
- Baseline from commit 3: byte-identical.

### 5. AGGREGATION
- Tournament rows feed their OWN tally, never `seriesWins` / `seriesPlayed`, so a
  player's "series won" line can never mix Smashdown sets with Beerio titles.
- A tournament row KEEPS ITS PLACEMENT in that tally (played, titles, best finish,
  placement sum), because that is the podium history old Beerio nights carry.
- Tournament rows are excluded from game counters and from the meeting map. Old Beerio
  nights therefore stop producing placement-comparison "meetings"; state this in the
  commit message and BACKLOG as a deliberate consequence (new nights get real meetings
  from their matches in session 2).
- `finishAgg` stays sync and query-free. Anything that needs a query goes in
  `finishAggDeep`.
- Extend the baseline with labeled tournament rows. Every non-tournament output must be
  byte-identical to commit 3.

### 6. SURFACES
- **Acceptance: after the relabel, no old Beerio night disappears from any screen.** The
  crew leaderboard's Beerio tab, member profiles, `/me`, rivalry pages and the night
  recap must all still show every old bracket night, as tournaments and titles rather
  than games.
- Recap: a tournament row renders as its own line (as legacy rows do today). Folding a
  tournament's match rows under it is session 2's job, because no match rows exist yet.
- Per-game counts (the `tournamentRows` / `countByGame` block near stats.ts:160) must
  not show the Beerio tab as zero after the relabel.
- Copy: "titles" is the headline word for a tournament win. Standard copy rules apply.
- Harnesses: `screens-baseline.mjs` gets a stub for a Beerio leaderboard with tournament
  rows if the screen changed; `theme-sweep.mjs` if any new element appears.

### 7. CLOSEOUT (BACKLOG.md)
- Move this session's work to SHIPPED, mark program session 1 done, increment MAP
  STATUS to 1 in this commit.
- Record the gate numbers the run actually printed.
- Put the SQL below in the closeout and in BACKLOG, verbatim.

## The data step (run by James in the Neon console AFTER commit 6 is live)

```sql
-- Preview: how many rows will change, and confirm none are already labeled.
SELECT count(*), count(m.label)
FROM matches m JOIN games g ON g.id = m.game_id
WHERE g.pack = 'beerio_kart' AND m.external_key LIKE 'b|%';

-- Relabel legacy Beerio BRACKET nights as tournaments. Idempotent.
UPDATE matches m SET label = 'beerio_tournament'
FROM games g
WHERE m.game_id = g.id
  AND g.pack = 'beerio_kart'
  AND m.external_key LIKE 'b|%'
  AND m.label IS NULL;
```

The session must verify both statements against the schema before publishing them (column
names, the games join, that legacy Beerio rows really have `label` NULL), and state the
expected preview result shape. Running the UPDATE before commit 6 is live is harmless but
makes old nights read as tournaments on screens not yet taught to show them.

## Locked decisions (the whole program, for BACKLOG)

Scoped 2026-09-15. James's calls are marked.

1. **Sign-in required (James).** Beerio without a crew runs through quick play and its
   hidden personal crew. Signed-out live rooms retire.
2. **Discrete authed writes on `createPackRuntime`**, session row in `game_sessions` keyed
   `(eventId, pack)`. The TV gate comes with it; Beerio's `tv-gate.test.ts` allowlist
   entry is removed in session 3.
3. **The engine moves byte-for-byte** (`buildBracket`, `compute`, `getChampion`,
   `getRunnerUp`, `bracketPlacements`, `gpStandings` and the GP helpers, `pruneState`)
   into `packages/shared`, with fixtures captured by running the unmodified code first.
   The server derives placements and completion. No rewrite, so the port boundary's
   reason still holds.
4. **The look is untouched.** Presentational components and `beerio.css` are unchanged;
   only the container moves onto `usePackSession`, and the TV onto `usePackLive`. Setup
   keeps typed names; the server resolves them to members once at start (exact
   display-name rule) and stores roster slots.
5. **Room codes stay** as a public alias to the event for QR and typed joins. Spectator
   predictions stay public in `beerio_sessions.predictions`, with lock enforcement
   reading the new state.
6. **Deploy-safe order.** New routes ship beside the old ones, the client cuts over, and
   `PUT /api/sessions/:code` is retired last. A room open at deploy time is imported on
   first read.
7. **Fixed constants do not move:** `games.pack = "beerio_kart"`,
   `games.name = "Beerio Kart"`, and Beerio's second place in the TV tiebreak. New
   constants (registry key, `wsType`, `keyPrefix`) are picked once in session 2.
8. **Ledger (James: every 1v1 match).** A bracket night writes each decided match
   (byes, auto and phantom matches excluded; `side` NULL; series race wins as `score`)
   plus one tournament row labeled `beerio_tournament` carrying full placements and
   `rawResult`. Undo retracts.
9. **Grand Prix writes the final result only (James).** One placement row per night, no
   heat rows. GP rows are NOT relabeled: with no heats, the night is itself the game
   unit, exactly as today.
10. **Existing bracket nights become tournaments (James).** The session 1 SQL.
11. **Hall of Fame merges into crew stats (James).** Session 4: owner/admin import,
    preview then confirm, run from the device so local-only history is included (local
    cache and server code merged). Entries whose key already exists in the crew ledger
    are skipped. Bracket entries import as tournament rows (champion 1, runner-up 2,
    other racers with no placement); GP entries import full order by points. Names match
    members; the rest become guests linkable later. Imported rows have no event. HoF
    writes stop after the move.
12. **The Hall of Fame screen keeps its look and reads crew Beerio stats (James).**
13. **Rivalries start with nights played after session 2 deploys, UNLESS the
    head-to-head backfill below is approved.** Log this as an OPEN DECISION, not a
    settled one. The question: replay each event's surviving `beerio_sessions.state`
    through the shared engine and write match rows ONLY where the replay reproduces the
    recorded tournament exactly (completion key, and every placement in `rawResult` where
    one exists). This would partly reverse the 2026-07-27 forward-only decision; what
    changed is that the rebuilt key plus stored standings now give a verifiable link, and
    session 2 makes the engine a pinned shared module. Hard limits: only the last
    tournament per room survives, rooms never opened live are out, pre-07-27 nights can
    only be checked on member placements, HoF-only nights have no pairings. James
    decides after running the measurement query in the Neon console (events joined to
    their room and their Beerio tournament rows, counted per event). If approved, it
    ships in session 4 beside the HoF import, owner/admin, preview then confirm.
14. **Open for later sessions, stated rather than silent:** `events.beerio_code` has no
    index and no uniqueness (session 2 measures duplicates in prod before choosing);
    what a cached PWA bundle does when the retired PUT answers (session 3);
    `beerioCompletedAt` leaves the TV resolver but the column stays (session 3); Beerio
    stays exempt from theming and from the `pack-screens` event-back test.

The program:
- **Session 1 (this):** the redraw, then tournament rows in the stats layer.
- **Session 2:** the engine into shared, the server pack, quick play, and per-match plus
  tournament materialize with undo.
- **Session 3:** the client cutover, the TV on live updates, the old endpoints retired,
  and the resolver special case removed.
- **Session 4:** the Hall of Fame import, with the HoF screen reading crew stats.

## Explicitly deferred (do NOT do in this session)
- Any change to `beerio.ts`, `beerio-gn.ts`, `BeerioApp.tsx`, `BeerioTvPage.tsx` or the
  Beerio registry. Nothing here writes a `beerio_tournament` row.
- Recap folding of match rows under a tournament (session 2).
- Any schema change. The relabel is data only.
- GP heat rows (declined by James).

## Gates (before every commit, record what PRINTS)
```
pnpm install --frozen-lockfile   # only if dependencies changed; none should
pnpm -r typecheck                # all four packages print Done
pnpm test                        # all pass; report the count
pnpm build                       # exits 0
```

## Escape lever
After commit 5 everything is still invisible in production. If commit 6 grows past the
surfaces named above, stop there, ship the closeout without the SQL, and say so. The SQL
is only published once every surface in commit 6 is live.

## Closeout (in chat, short)
Files changed, what to test by hand (Beerio tab, a member profile, a past night's recap,
before and after running the SQL), the SQL as the one deploy step, and the MAP STATUS
counter reading 1.

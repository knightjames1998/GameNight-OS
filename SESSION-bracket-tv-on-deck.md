# SESSION: bracket TV on-deck placeholders

Shipped 2026-08-21. Committed as part of commit 6, per the prompt that drove it.

## Start of session

Fresh clone. MAP STATUS read **2**, which is below 3, so the map was NOT redrawn and the
counter went to 3 in commit 6. The next session reads 3 and owes the reconcile and redraw
before its own work.

The prompt said the counter read 2 when it was written and told the reader to check it
themselves. It still read 2: a commit had landed since (`91174df`, counter 1 to 2) and the
fresh clone is what showed it.

## What was wrong

Both bracket TVs answered "what is on deck" with a filter that required both seats to hold a
real player. The ORDERING was already correct and had been since 2026-08-15:
`compareRoundOrder` sorts depth first and side second, so losers R1 already sorted above
winners R2. **The losers R1 card simply did not exist yet.** With a bye in play the room saw a
winners R2 matchup at the top of the column while the actual next race was a losers R1 one
whose entrants were still being decided, and nobody in that match knew they were up.

So the fix is what ENTERS the list, not how it is sorted.

## What shipped

`deckStateOf` and `buildDeck` in `packages/shared/src/bracketboard.ts`, for the reason that
module's header already gives: two boards, one set of rules, so they cannot disagree about
what comes next. `DeckCandidate` carries no names, ids or slots, so neither TV can qualify a
match on something the other cannot see.

Three classes:

- `ready`: both seats real. Unchanged.
- `pending`, one seat known: always eligible.
- `pending`, blank vs blank: eligible only when every feeder it waits on is playable RIGHT
  NOW. Local and non-recursive on purpose.

An empty seat names its feeder, "Loser of Ana vs Ben", falling back to "Loser of Winners R1
#2" when the feeder is itself undecided. The shell needed feeder provenance on the wire
(`aFrom`/`bFrom`, which `MatchDef` has always carried and `deriveView` dropped); Beerio
needed no payload change, and its own `SlotSource` union turned out to be byte for byte the
shared one, so the vendored file was not edited at all.

## Fit

No band metric moved. A pending card is exactly the height of a ready one, because the feeder
label rides in the existing one-line name class (`.gn-tvm__nm` / `.beerio-tvm__nm`, both
already `nowrap` with an ellipsis). Placeholders spend from the existing 4-card slice rather
than extending it. Pending reads as pending through colour and border only, from tokens.

The escape levers named in the prompt were never needed and are recorded here in case they
are: confirm the pending card is not taller than a ready one, then drop the blank-vs-blank
class at the `tight` and `packed` bands, then stop and report. Never edit the ladder.

## Numbers, from the runs

Baseline on the fresh clone before any work:

    typecheck  4 of 4 Done
    test       1038 tests, 1034 pass, 0 fail, 4 skipped (the 4 need a built dist)
    build      exit 0

After:

    typecheck  4 of 4 Done
    test       1047 tests, 1047 pass, 0 fail
    build      exit 0

Harnesses:

    tv-fit            PASS. Every bracket tv and beerio tv case fits 1080p at 4, 8, 12
                      and 16 in all four states. The 16-pairs cases are OVER by 229
                      (fresh) and 297 (mid, late), which are the pre-existing KNOWN
                      numbers to the digit. Both negative controls hold: bracket tv 16
                      mid 1309 (OVER by 229), beerio tv 16 mid 1644 (OVER by 564).
    theme-sweep       25 differences, ALL of them new rules appearing
                      (.gn-tvm--pending, .gn-tvm__row--waiting, .opacity-55).
                      ZERO pre-existing values moved.
    screens-baseline  UNCHANGED, 27 snapshots, exit 0. NOT re-pinned.

**screens-baseline did not need re-pinning, and the prompt expected it would.** That harness
pins the pack setup screens, the entrant picker, the tournament setup screen and three PACK
TVs (Board Game, Card Table, Social Deduction). It has never covered the shell's `/tv/:id`.
Re-pinning would have been re-pinning nothing.

## Verified by rendering, not only by tests

The deck was read off the real built bundle at `bracket tv 8 mid` and `beerio tv 8 mid`:

    shell   heading "On deck / 3 ready", four cards drawn, the fourth PENDING and reading
            "LOSERS SEMIS / Winner of <name> vs <name>"
    beerio  three ready cards and a PENDING one with the same named feeders

The heading counting 3 while 4 cards are drawn is the design working: the count stays
ready-only, the list is merged.

## Files changed

    packages/shared/src/bracketboard.ts        deckStateOf, buildDeck
    packages/shared/tests/bracketboard.test.ts nine new tests
    apps/server/src/brackets.ts                aFrom / bFrom on the match mapper
    apps/web/src/api.ts                        the two fields on BracketMatchView
    apps/web/src/pages/TvPage.tsx              buildDeck, feeder labels, pending card
    apps/web/src/index.css                     .gn-tvm--pending, .gn-tvm__row--waiting
    apps/web/src/beerio/BeerioTvPage.tsx       the same, in that pack's language
    scripts/tv-fit.mjs                         fixture carries the new payload fields
    BACKLOG.md                                 shipped entry, three decisions, counter
    SESSION-bracket-tv-on-deck.md              this file

## Deploy

**None beyond the push.** No schema change, no new dependency, no `db:push` to watch.

## Test by hand

A bye-heavy double elim, six or twelve entrants, at the moment winners R1 is PARTLY played.
Losers R1 should be on the board with named feeders before either of its racers is known.

Worth knowing which fixture shows what, because a full round hides it: at six entrants played
in full waves the losers R1 matches are auto-decided by byes and there is no pending losers
card to see. Eight entrants with a SINGLE winners R1 match played is the sharpest case, and is
what the shared test pins.

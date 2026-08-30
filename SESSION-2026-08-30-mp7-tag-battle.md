# SESSION: Mario Party 7, Tag Battle 2v2, and two MP6 data corrections

Scoped 2026-08-30 against a fresh clone. Commit this file to the repo root before
starting, then work the commits in order.

## READ THIS FIRST: THE MAP REDRAW IS DUE

`MAP STATUS` at the top of `BACKLOG.md` reads:

    Last map redraw:                    2026-08-28
    Shipped sessions since that redraw: 3
    Redraw due at:                      3

Counter is 3, the test is `>=`, so **COMMIT 0 IS THE RECONCILE AND REDRAW AND IT
HAPPENS BEFORE ANY FEATURE WORK IN THIS FILE.** Not at the end. A long session
that leaves it for the end skips it, which is exactly how the counter reached 4
on 2026-08-17. Re-read the counter in the file rather than trusting this
paragraph; if it has moved since this was written, the file wins.

## What this session ships

Three things, in one session because James asked for them together after being
told the split was the recommendation. Recording that here so the size is not a
surprise later: the MP7 half is small and the Tag Battle half is roughly a Double
Dash sized piece of work, and it is the reason this file has six commits.

1. Mario Party 7 as a title in the Mario Party pack.
2. Two corrections to the existing Mario Party 6 data.
3. Tag Battle, 2v2, as a team format inside the pack.

---

# COMMIT 0: map reconcile and redraw

Reconcile `BACKLOG.md` against the repo, redraw `project-map.excalidraw` by
editing the data in `scripts/generate-project-map.mjs` and re-running it (never
by editing the JSON), then set `MAP STATUS` to date = today, counter = 0.

MAP PROTOCOL in `BACKLOG.md` pins the zone mapping, layout, colours and cameras.
Follow it; do not invent a layout.

Gate: `pnpm -r typecheck && pnpm test && pnpm build`. Record the numbers the run
actually printed.

---

# COMMIT 1: Mario Party 7, and the two MP6 corrections

Files: `packages/shared/src/marioparty.ts`, `packages/shared/tests/marioparty.test.ts`

## 1a. The MP7 title entry

Insert into `MARIO_PARTY_TITLES` **between `smp` and `mp6`**, because the list is
ordered newest first and MP7 is 2005 against MP6's 2004. Id `mp7`.

Pinned against Super Mario Wiki and StrategyWiki on 2026-08-30, not memory.

    name:   "Mario Party 7"

    roster (12, and note there is NO Donkey Kong and NO Koopa Kid):
      Mario, Luigi, Peach, Daisy, Yoshi, Wario, Waluigi, Toad, Toadette,
      Boo, Birdo, Dry Bones

    boards (6, five starters plus Bowser's Enchanted Inferno):
      Grand Canal, Pagoda Peak, Pyramid Park, Neon Heights, Windmillville,
      Bowser's Enchanted Inferno

    bonusStars (6 exist, the game awards 3 at random):
      Minigame Star, Action Star, Orb Star, Shopping Star, Red Star,
      Running Star

Every one of the six boards ends on a star total and the most stars wins, so
`rankMpLines` needs nothing for MP7 itself. Windmillville caps at 11 stars, which
is under the engine's existing 0..99 clamp. Leave a short comment saying the
title offers six and the game hands out three, so a later reader does not add a
"you may only pick three" rule: the host records what actually happened.

## 1b. Three new bonus families, and this is the real risk in 1a

`MP_BONUS_FAMILIES` does not know three of MP7's six names. Unmapped,
`bonusFamilyOf` falls back to the raw name, so MP7's Running Star would tally
separately from Superstars' Sightseer Star and the lifetime bonus leaders would
split with nothing erroring. Add:

    "Action Star":  "Happening"
    "Red Star":     "Bad luck spaces"
    "Running Star": "Walked farthest"

`Minigame Star`, `Orb Star` and `Shopping Star` are already mapped. Do not touch
them.

## 1c. Tighten the family test so this cannot recur

`packages/shared/tests/marioparty.test.ts` currently has "every bonus star a
title offers has a family, or it tallies under its own name", asserting
`bonusFamilyOf(star).length > 0`. **That assertion cannot fail**, because the
fallback returns the name itself, so it would have passed on a broken MP7 exactly
as it passes today. Replace it with one that requires an EXPLICIT entry:

    for every title, for every star it offers,
      assert Object.prototype.hasOwnProperty.call(MP_BONUS_FAMILIES, star)

Every star currently offered by every shipped title has an explicit entry, so
this passes on the tree before 1a and after it. Confirm that by running it once
with the MP7 entry present and the three families absent, and watching it go red.
That negative control is the point of the change.

## 1d. MP6: Toad in, Donkey Kong out

The shipped MP6 roster lists `Donkey Kong` and omits `Toad`, and its comment says
"Toad is not playable in this one", which is backwards. MP6's eleven are Mario,
Luigi, Peach, Yoshi, Wario, Daisy, Waluigi, Toad, Boo, Koopa Kid, Toadette.
Donkey Kong is not playable in MP6.

Fix the roster and delete the wrong comment. **This is safe and it is worth
saying why**: `character` is a display string on `match_participants`, not a
ledger-permanent identifier, and the roster is only validated on write
(`pool.includes(...)` at start and on the character route). Existing rows are
untouched, and Donkey Kong still exists in three other titles' rosters, so no
lifetime character history is orphaned.

## 1e. MP6: the third bonus star name

MP6 offers `Event Star`. Sources call MP6's third star the Happening Star, also
published as Action Star; `Event Star` is a Superstars-era name and appears on no
MP6 source. Change MP6's offered name to `Happening Star`, which is already in the
family map.

**KEEP `"Event Star": "Happening"` IN `MP_BONUS_FAMILIES`.** Removing it is the
silent failure here: bonus star names are written verbatim into
`match_participants.meta`, so any MP6 board already recorded with an Event Star
would stop folding onto the Happening family and would start tallying under its
own name. The map is read-side and additive; the title's offered list is
write-side. Add a comment at the entry saying it is retained for rows already
written, so a future tidy-up does not delete it.

## Tests for commit 1

Add to `packages/shared/tests/marioparty.test.ts`:
- MP7 resolves: `boardsForTitle("mp7")` has the six boards,
  `bonusStarsForTitle("mp7")` the six stars, `rosterForTitle` the twelve.
- The three new families fold: `bonusFamilyOf("Running Star")` equals
  `bonusFamilyOf("Sightseer Star")`, and the same pairing for Action/Eventful and
  Red/Unlucky.
- `bonusFamilyOf("Event Star")` still returns "Happening" even though no title
  offers it any more. Assert this directly; it is the whole reason 1e is safe.
- MP6 roster contains Toad and does not contain Donkey Kong.
- The existing "no title offers MP_CUSTOM_BOARD" check still covers mp7.

Gate: `pnpm -r typecheck && pnpm test && pnpm build`.

---

# COMMIT 2: Tag Battle in the shared engine

Files: `packages/shared/src/marioparty.ts`, `packages/shared/tests/marioparty.test.ts`

## The rule that makes this more than a title

In Mario Party 7 Tag Battle, **teams share Orbs, Stars and coins**. A tag board
therefore has ONE star total per side, not one per player. The pack's whole model
is a typed star count per player that ranks the board, lands on
`match_participants.score`, and is summed into `totalStars` / `avgStars` on the
crew leaderboard. That collision is the design work in this session.

## Decisions locked, with the reasoning

**LOCKED: a shared value is written to EVERY member of the side, and the READ
layer splits solo from tag off `side`.** This is the Double Dash precedent
(`foldMkStatRows` splits `solo` and `pairs` tallies off `side`) and it is applied
here to the star total and to bonus stars alike, so there is one rule rather than
two. The alternatives were rejected: putting the total on one row is arbitrary
and breaks every per-player read, and halving it invents a number that odd totals
cannot produce.

**LOCKED: no new `matches.format` key.** Double Dash minted none; a non-null
`side` is what makes a row a pairs row. `matches.format` keys are PERMANENT (see
the header of `packages/shared/src/formats.ts`), so not minting one is worth
having. Tag rows stay `format: "board"` and are identified by `side != null`.

**LOCKED: Tag Battle is available on any title, not gated to MP7.** MP2, MP6 and
MP7 all have team modes, and gating would need a per-title capability flag that
goes stale the moment a title's data is edited. The app records what the night
did rather than refereeing it, which is the principle already written at
`validateSides`.

**LOCKED: `sidelog.ts`, not a field on the session.** Mario Party becomes its
THIRD consumer, after Ping Pong and Mario Kart. The unit count is
`state.games.length`. Read the header of that file before wiring it: the reason
it is a log is that an arrangement change must not retroactively apply to boards
already recorded, and `truncateSideLog` is what makes undo across a reshuffle put
the old pairs back.

## The work

Add `sideLog: SideLog` to `MpSessionState`. `newMpState` seeds it with
`newSideLog(singletonSides(rosterIds))`, which is the no-team-structure case and
must produce rows byte-identical to what the pack writes today. Existing sessions
read out of jsonb have no `sideLog`; the `normalize` hook on `createPackRuntime`
is the place to backfill it, and that hook is exactly what it is for. Do not
default it inline at twelve read sites.

Add a team ranking path. Do NOT overload `rankMpLines` with a mode flag: give it
a sibling, `rankMpSides`, and keep both exported. Its input is one star total and
one bonus star list per SIDE plus an optional winning side id; its output is the
same `MpLine[]`, produced through `placementsFromRankedSides` from `teams.ts` so
the side placement rule is not written a second time. Every member of a side gets
that side's star total, that side's bonus stars, and `side` from `sideIdFor`.

Refusals `rankMpSides` must carry over, adapted:
- fewer than two sides, or a side with nobody on it
- a missing or negative star total on any side, refused rather than read as zero
- **one bonus star cannot sit on two SIDES** (the existing per-player rule, one
  level up)
- a tie at the top refused until the host taps the winning side
- the tapped winner must hold the top star total

`summarizeMpNight` needs to stop double counting. It currently sums `l.stars`
per player, which on a tag board would credit the pair twice for one total. Split
its per-player figures the way the ledger read will: `totalStars` counts only
lines with `side == null`, and tag boards contribute a separate
`tagStars` / `tagGames` pair. Wins are unaffected: both members of a winning side
genuinely won that board.

## Tests for commit 2

Fixtures first, and **capture them by running the unmodified engine before
writing a line of the tag path**. Hand-written fixtures have been wrong three
times in this repo.

- A 2v2 produces 1,1,2,2 and never 1,1,3,3. Assert the exact placements; this is
  placement rule 2 and the comment block in `teams.ts` explains why it is not the
  tie rule.
- Every line in a 2v2 carries a non-null `side`, and the two members of one side
  share it.
- An all-singletons arrangement produces `side: null` on every line and output
  identical to `rankMpLines` on the same numbers. This is the regression that
  matters most: the ordinary four-player board must be untouched.
- A 1v1 (two sides of one) is `side: null` on both. A pack writing "a"/"b" here
  would make `meetingOutcome` classify two opponents as teammates and the rivalry
  would be wrong forever with nothing erroring.
- Both members of a side carry the same star total and the same bonus stars.
- One bonus star on two sides is refused.
- A top tie is refused until a winning side is tapped, and a tapped side that
  does not hold the top total is refused.
- `summarizeMpNight` over a mixed night (some solo boards, some tag) reports solo
  and tag star totals separately and does not double count.
- Undo across a reshuffle: `truncateSideLog` restores the previous arrangement.

Gate: `pnpm -r typecheck && pnpm test && pnpm build`.

---

# COMMIT 3: server routes and the lifetime stats split

File: `apps/server/src/marioparty.ts`

- Start route accepts an optional sides arrangement, validated through
  `validateSides` with `maxSides: 2`. Uneven sides are NOT an error
  (`validateSides` returns `even` as a fact); a 2v1 is a real thing a crew does
  and the screen warns rather than blocks.
- New reshuffle route, host only, calling `reshuffle(state.sideLog, sides,
  state.games.length)`. Return its error string rather than deciding for yourself
  that an arrangement is acceptable.
- Record route branches on `hasTeamStructure(state.sideLog)`: per-side body shape
  through `rankMpSides`, per-player body shape through `rankMpLines`. Sanitize
  bonus stars against `bonusStarsForTitle` on both paths, as today.
- `materializeGame` sets `side: line.side ?? null` on each `LedgerLine`, with the
  same coalesce comment Mario Kart carries: a board recorded before this shipped
  has no `side` on its line at all.
- Undo calls `truncateSideLog(state.sideLog, state.games.length)` after popping.
- The stats endpoint (`/groups/:id/marioparty-stats`) selects
  `matchParticipants.side` and splits `totalStars` / `avgStars` / `games` / `wins`
  into solo and tag tallies per player, following `foldMkStatRows`'s shape. Bonus
  star tallies split the same way, for the same reason: a pair both credited with
  one Minigame Star would otherwise outrank a solo player two to one.

**Roster cap stays 4 and `maxSides` stays 2.** MP7's 8-player and 4-Team Battle
modes are deferred (see below).

No schema change. `match_participants.side` shipped 2026-08-02 with Casino Run.
Say so explicitly in the closeout so nobody goes looking for SQL.

Gate: `pnpm -r typecheck && pnpm test && pnpm build`.

---

# COMMIT 4: the pack page

File: `apps/web/src/marioparty/MarioPartyPage.tsx`

Setup screen gets a Battle Royale / Tag Battle toggle. Tag Battle mounts the
shared `TeamPicker` with `cx="mp"` and `maxSides={2}`.

**Verified in the clone: every class `TeamPicker` needs already exists in
`marioparty.css`.** It uses `${cx}-btn`, `-err`, `-hint`, `-lab`, `-name`, `-row`,
`-seg`, `-textbtn`, and `.mp-btn`, `.mp-err`, `.mp-hint`, `.mp-lab`, `.mp-name`,
`.mp-row`, `.mp-seg` and `.mp-textbtn` are all defined. No CSS work for the
picker. If that stops being true, add the class rather than passing a different
`cx`.

Record screen, when team structure is on: one star box per SIDE instead of one
per player, side labels via `sideLabel` from `teams.ts`, bonus stars owned by a
side rather than a player, and the tiebreak taps a side. Characters stay per
player and are unchanged: each player still picks their own in Tag Battle.

The existing per-player screen is the no-team-structure path and must be reachable
and unchanged. Do not fold the two into one component with a flag threaded through
every row; the two entry shapes are different enough that a shared component would
drift into a lowest common denominator, which is the argument written at
`pack-runtime.ts` for why routes stay per pack.

A reshuffle control, host only, on the live screen.

Gate: `pnpm -r typecheck && pnpm test && pnpm build`.

---

# COMMIT 5: TV and the harnesses

Files: `apps/web/src/marioparty/MarioPartyTvPage.tsx`, `scripts/tv-fit.mjs`,
`BACKLOG.md` (the BUGS entry)

## 5a. A back button hook that has never been checked

`MarioPartyTvPage` renders `<BackButton className="mp-textbtn" />` in both
branches. `tv-fit.mjs`'s back-button hook is `.gn-textbtn, .cg-tv__back,
.beerio-tv-back`, which does not match, so **Mario Party's TV has been reporting
"no button" and having its standing-rule-4 check SKIPPED rather than failed, for
as long as its cases have existed.** Add `.mp-textbtn` to the hook. Check the
other pack TVs for the same shape while you are in there and add any that match;
report what you found either way.

## 5b. Tag rows on the TV

Show the pairing on the standings panel. Keep it to one line per side rather than
a new row per player.

## 5c. Re-measure, and be honest about the number

Mario Party's TV is in `KNOWN` as over by 76px at eight boards and 738px at
sixteen, with no density ladder. **A side line makes that worse.** Add tag cases
to the `marioparty` payload builder and `CASES`, run the harness, and write the
new measured numbers into the BUGS entry that already carries the old ones. Do
not silently leave the old figures standing.

**THE LADDER IS NOT THIS SESSION'S WORK.** A fit ladder has been its own session
every time it has been done, and bolting one on at the end of a session this size
is guessing at rungs nobody has measured. The `KNOWN` entries stay, with updated
numbers and a note that the tag rows are part of the figure now.

`theme-sweep.mjs` needs nothing: `/marioparty` and `/marioparty/tv/x` are already
in both `ROUTES` and `RULE_ROUTES`.

Gate: `pnpm -r typecheck && pnpm test && pnpm build`, plus
`node scripts/tv-fit.mjs` and `node scripts/theme-sweep.mjs`.

---

# COMMIT 6: BACKLOG

- MP7, the MP6 corrections and Tag Battle move to SHIPPED with the numbers the
  gates actually printed.
- The updated TV overflow figures land in BUGS.
- Decision log entries, below.
- MAP STATUS counter: it was reset to 0 in commit 0, so increment it to 1 here,
  because this session ships.

## Decision log entries to write

**A SHARED TEAM VALUE IS WRITTEN TO EVERY MEMBER AND SPLIT ON READ (2026-08-30).**
Mario Party 7's Tag Battle shares Orbs, Stars and coins, so a tag board has one
star total per side. The pack's model is a typed star count per player that lands
on `match_participants.score` and is summed into `totalStars` and `avgStars`.
Writing the team total to both members and splitting solo from tag on read, off
`side`, is the Double Dash precedent and was chosen over putting the total on one
row (arbitrary, breaks per-player reads) and over halving it (invents a number an
odd total cannot produce). The rule covers bonus stars too, so there is one rule
rather than two. The consequence to remember: an unsplit read of that column now
overstates a pair's night, so any NEW reader of Mario Party stars has to ask about
`side` first.

**TAG BATTLE MINTED NO FORMAT KEY (2026-08-30).** `matches.format` keys are
permanent. Double Dash added none for pairs and identifies them by a non-null
`side`; Tag Battle does the same and stays `format: "board"`. Written down because
adding `board:tag` looks tidier and is a permanent identifier bought for nothing.

**MP6's ROSTER WAS WRONG SINCE THE PACK SHIPPED (2026-08-30).** It listed Donkey
Kong, omitted Toad, and carried a comment asserting the opposite of the truth.
Found by pinning MP7's roster against sources and noticing MP7's returning ten
did not match what this repo believed MP6 had. Safe to correct because `character`
is a display string rather than a ledger-permanent identifier and the roster is
only validated on write. The general lesson is the one this repo keeps relearning:
the comment explaining a data choice is not evidence for it.

**A TEST THAT CANNOT FAIL IS NOT A TEST (2026-08-30).** The bonus-family check
asserted `bonusFamilyOf(star).length > 0`, which the fallback satisfies for any
string, so it would have passed on an MP7 whose Action, Red and Running Stars all
tallied under their own names and split the lifetime bonus leaders. Same shape as
the `rendered` flag being computed and not read, and as tv-fit reporting a fit it
never enforced. Replaced with an explicit-entry assertion and negative-controlled
by watching it go red before the families were added.

---

# Explicitly deferred

- **MP7's 8-player and 4-Team Battle modes.** Roster cap stays 4, `maxSides`
  stays 2. Eight players needs the cap raised in three places and four sides
  changes what the record screen is; it is not a bigger version of this.
- **The Mario Party TV density ladder.** Already open in BUGS with numbers, and
  its own session by the practice every other ladder has followed.
- **Minigame head-to-heads** as a second Mario Party format. Already queued
  separately in BACKLOG.
- **Converting `titlenight.ts` onto `sidelog.ts`.** Already logged; it moves two
  shipped packs and their fixtures.

# Escape levers

If commit 2 turns out larger than it reads, **stop after commit 1 and ship it**.
MP7 plus the two MP6 corrections is a complete, independently valuable change
that touches one file and its test, and the map redraw in commit 0 is the thing
that actually had to happen today. Say so plainly rather than half-landing the
tag path.

If the TV work in commit 5 starts turning into a ladder, stop, record the
measurement, and leave the `KNOWN` entries updated. That is a finished commit.

# Closeout must state

Files changed. The numbers `pnpm test` actually printed. What to test by hand:
a four-player Battle Royale board records exactly as before; a 2v2 records one
star total per side and shows 1,1,2,2; undo across a reshuffle puts the old pairs
back; the crew leaderboard's Mario Party tab shows solo and tag stars separately;
MP7 appears in the title selector with six boards and twelve characters; MP6
offers Toad and not Donkey Kong. Deploy steps: **none, no schema change**,
`match_participants.side` already exists.

Do not reference a Render deploy confirmation. You cannot read that dashboard.

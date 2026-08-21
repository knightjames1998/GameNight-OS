# SESSION: cascade integrity (crew delete and event delete)

Commit this file to the repo root as `SESSION-2026-08-20-cascade-integrity.md` in the
first commit of the session.

## Start here, before anything else

1. `git clone --depth 1 https://github.com/knightjames1998/GameNight-OS.git` into a fresh
   directory. Do not reuse a prior working directory.
2. `cat BACKLOG.md`, starting at the MAP STATUS block.
3. **The counter read 1 when this prompt was written, and 1 is below 3.** So: do the work
   below, and increment the counter to 2 in the commit that ships. Re-read the block
   anyway and act on what it actually says, not on this sentence. If it reads 3 or more,
   reconcile and redraw the map FIRST, reset to 0, then come back here.
4. No scope conversation is needed. Scope is locked below. If something forces a change,
   say so before writing code.

## The bug, and why nothing has caught it

Two delete handlers hand-write a cascade, because **this schema has no `ON DELETE CASCADE`
anywhere**. Every foreign key is a plain `references()`.

`DELETE /api/groups/:id` (`apps/server/src/groups.ts`, around lines 140 to 148) deletes, in
order: `match_participants`, `matches`, `brackets`, `rsvps`, `event_attendance`, `events`,
`games`, `memberships`, `groups`.

`DELETE /api/events/:id` (`apps/server/src/events.ts`, around lines 103 to 115) deletes:
`match_participants` (in a per-match loop), `matches`, `brackets`, `rsvps`,
`event_attendance`, `events`.

**Neither list includes `game_sessions` or `smash_sessions`.** Both tables declare
`eventId: uuid("event_id").notNull().references(() => events.id)`, so Postgres raises a
foreign key violation on the `DELETE FROM events` line in both handlers.

That is bad on its own. What makes it a data loss bug rather than a 500 is that **neither
handler is in a transaction**. The deletes are sequential awaits on the shared `db`, so by
the time the events delete raises, `match_participants`, `matches`, `brackets`, `rsvps` and
`event_attendance` are already committed and gone. `async-safe.ts` catches the rejection and
returns a 500, the crew or event is still there, and the entire recorded history under it
has been destroyed. The user sees an error, retries, gets the same error, and has no way to
know anything was deleted.

**Trigger condition:** the crew or event has ever had a session pack STARTED on it. Twelve
of the fourteen tiles write a `game_sessions` or `smash_sessions` row at setup, before a
single result is recorded, so an abandoned setup screen is enough. A crew that only ever ran
brackets or Beerio deletes cleanly, which is why this has survived: the happy path is real,
it is just not the common one.

**Why it was introduced silently.** `game_sessions` shipped as "additive, so `smash_sessions`
is untouched and Smash keeps working" (BACKLOG, Mario Kart pack, 2026-07-16). Additive is
true of reads and writes and false of deletes: a new child table is a new obligation on every
hand-written cascade in the app, and there was no list saying so and nothing that failed when
it was missed.

**Root cause in one line:** a hand-maintained cascade list that is not derived from, or
checked against, the schema it is supposed to cover.

## What ships

A shared cascade module, both handlers wrapped in a real transaction, and a schema-driven
test that makes the next missing table a red gate instead of a silent one.

## Decisions already locked. Do not reopen these.

**1. The fix is NOT `ON DELETE CASCADE` on the foreign keys.** Tempting, and rejected for
three reasons. It is a DDL change across roughly twenty constraints, each needing a drop and
re-add on a live Neon database, and `drizzle-kit push --force` is documented in this repo as
silently no-opping in non-interactive CI exactly on constraint resolution, so it would owe a
long hand-written Neon script for a bug that owes none today. It would also delete the app's
ability to know what it removed. And it removes a real safety property: today a stray
`DELETE FROM groups` errors. With database cascades it would silently take the whole ledger
with it and report success. Hand-written cascades stay. They just stop being hand-CHECKED.

**2. One list, not two.** The two handlers get a new shared module,
`apps/server/src/cascade.ts`, exporting `deleteGroupCascade(tx, groupId)` and
`deleteEventCascade(tx, eventId)`. Two copies of an ordered list drift, and these two already
had. The test in commit 1 scans this one file.

**3. Broadcast stays OUTSIDE the transaction**, after it commits. Broadcasting a deletion
that then rolls back tells every connected phone about a thing that still exists.

**4. Auth and lookup stay outside the transaction too.** They are read-only and there is no
reason to hold a transaction open across them. The transaction starts at the first delete.

**5. Member removal and self-leave are OUT OF SCOPE and must not be touched.** They delete
the membership row and deliberately keep the `match_participants` rows: BACKLOG records this
as intentional ("leaving deletes the membership row but keeps the participant rows"), and the
`/api/me/stats` query depends on it. Do not make them cascade.

**6. `beerio_sessions` and `beerio_hof` are correctly absent from both cascades.** They are
keyed by a text code and carry neither `group_id` nor `event_id`, so they cannot block a
delete and hold no lifetime stats. The test must not demand them. Say so in a comment so the
next reader does not add them.

**7. No schema change. No Neon SQL is owed by this session.** If you find yourself writing
DDL, stop, and re-read decision 1.

## Ordered commits

Gates run in this order before EVERY commit, and all four must pass at each step:

```
pnpm install --frozen-lockfile   # only if dependencies changed; none should
pnpm -r typecheck                # all four packages print Done
pnpm test                        # all pass
pnpm build                       # exits 0
```

Record the numbers each run actually printed. Do not carry forward a count from this file or
from a previous session.

---

### Commit 1: the cascade module, the two missing deletes, and the test that pins them

**Write the test FIRST and run it against the UNMODIFIED handlers before you change a line
of them.** It must go red, naming `game_sessions` and `smash_sessions` for both cascades.
Transcribe that exact failure output into the commit message. This matters because the whole
point of the test is that it bites, and a scan written after a fix pins the fix rather than
the property.

The test is nonetheless COMMITTED together with the fix, not before it, because a commit
whose gates are red is not permitted. That is a real tension between two project rules and
this is the resolution: prove red out of tree, ship green in tree, record the red output.

**`apps/server/tests/cascade-integrity.test.ts`**, in the style of
`deduction-secrecy.test.ts` and `quickplay-parity.test.ts`: no database, no Drizzle stub,
source and schema scanning only.

It derives the requirement instead of listing it:

1. Parse `packages/db/src/schema.ts`. Split on `export const <var> = pgTable(`, read each
   table's physical name and its `references(() => <var>.<col>)` edges. This gives a foreign
   key graph and a drizzle-variable to table-name map.
2. Build the INBOUND transitive closure of `groups` (every table that references it, then
   everything referencing those, to fixpoint), and the same for `events`.
3. Parse `apps/server/src/cascade.ts`. For each exported cascade function, read the ordered
   sequence of `tx.delete(<var>)` calls and map each back to a table name.
4. Assert COVERAGE: each cascade deletes its root's full closure, plus the root itself.
5. Assert ORDER: the delete sequence is a reverse topological order of that closure, so no
   table is deleted before something that still references it. Derive this from the same
   graph. Do not hand-write the expected order.

Both closures should come out as the same ten tables: `memberships`, `events`, `rsvps`,
`event_attendance`, `games`, `brackets`, `matches`, `match_participants`, `smash_sessions`,
`game_sessions`. The event cascade's closure is those minus `memberships`, `games` and
`events` as root. Confirm that against the parse rather than trusting this paragraph, and if
the parse disagrees, the parse is right and this paragraph is stale.

**Negative controls are mandatory**, same discipline as the four em dash encodings in
`copy-rules.test.ts`. A scan that has quietly stopped matching passes forever and is worse
than no scan. At minimum: a synthetic cascade source with `game_sessions` removed must fail
the coverage assertion, and a synthetic source with `matches` deleted before
`match_participants` must fail the order assertion. Assert both go red.

**`apps/server/src/cascade.ts`**, new. Two functions taking a transaction handle and an id.
The ordered lists are the current ones plus `game_sessions` and `smash_sessions` before
`events` in both. Type the `tx` parameter off the real transaction type rather than `any`.

**`apps/server/src/groups.ts`**: import nothing new from `@gamenight/db` except what
`cascade.ts` now owns. The handler's delete block becomes one call. Note that `groups.ts`
does not currently import `gameSessions` or `smashSessions`; after this change it should not
need to import any table for the delete path.

**`apps/server/src/events.ts`**: same. It already imports `gameSessions` and `smashSessions`
for the event detail payload, so leave those imports alone; only the delete block changes.

Behaviour at this commit is unchanged on the happy path and fixed on the failing one. Still
not transactional. That is commit 2.

---

### Commit 2: both handlers become one transaction each

Wrap each cascade call in `db.transaction(async (tx) => { ... })`.

This is safe and uninteresting here because the driver is `drizzle-orm/node-postgres` over a
real `pg.Pool` (`packages/db/src/index.ts`), which supports genuine interactive
transactions. Confirm that yourself before writing the code. If it were the Neon HTTP driver
this commit would be a different and much harder conversation.

Everything inside the callback uses `tx`, never `db`. The 500 that `async-safe.ts` returns
becomes an honest one: nothing was deleted.

Do not add retry logic and do not catch and swallow. A rollback plus a 500 is the correct
outcome.

---

### Commit 3: the event cascade stops doing N+1

`events.ts` currently selects every match id for the event and issues one
`DELETE FROM match_participants` per match. Collapse it to a single statement using
`inArray` with a subquery over `matches` filtered by `event_id`. `inArray` is already
re-exported from `@gamenight/db`.

**This is in scope specifically because of commit 2, not as drive-by tidying.** An N+1 loop
inside a transaction holds locks across every round trip, so leaving it makes the
transaction measurably worse than the loop was outside one. It is also three lines, in the
exact block being rewritten. BACKLOG already carries it as a deferred item; this closes it
and the deferral entry moves.

`groups.ts` has no equivalent loop: it deletes by `group_id` directly.

---

### Commit 4: BACKLOG, project instructions, MAP STATUS

**`BACKLOG.md`:**

- A shipped entry. State the root cause in the terms above: not "forgot two tables" but "a
  hand-maintained cascade list not derived from the schema", plus the non-transactional
  sequence that turned a foreign key error into data loss. Name the trigger condition (any
  crew or event that ever started a session pack, including an abandoned setup screen).
- A decision log entry for decision 1, database cascades rejected, with all three reasons.
  This will be re-proposed by somebody. Write it down so it is re-proposed once.
- Move the deferred N+1 and non-transactional event delete item out of the deferred list.
- Add a NEXT UP or deferred entry for the thing this session deliberately does NOT do: see
  Deferred below.
- MAP STATUS counter 1 to 2, in this commit.

**`PROJECT-INSTRUCTIONS.md`:** the registration checklist under "Adding a game pack" gains a
step. Wording along these lines, in the checklist's own voice:

> **A new table carrying `group_id` or `event_id` joins BOTH cascades in
> `apps/server/src/cascade.ts`, in the same commit that adds it.** `cascade-integrity.test.ts`
> derives the required set from the schema, so a missing table is a red gate rather than a
> foreign key violation that destroys a crew's history mid-delete. This is a step because it
> was missed: `game_sessions` shipped 2026-07-16 as an additive table and neither cascade
> learned about it for four months.

Also correct the "What exists and works" section if it claims crew deletion cascades
cleanly, since it did not.

## Deferred, stated rather than silent

- **A supported way to erase one profile's quick play data.** Quick play lives in a hidden
  personal crew (`groups.is_personal = true`) and `GET /api/groups` filters
  `is_personal = false`, so that crew is in no list and has no delete button. Even after this
  session, a delete route exists that nothing can reach for a personal crew. That is a
  product decision (does a personal crew get a delete affordance, an account level "clear my
  quick play history", or nothing), and it sits next to the already-deferred BACKLOG entry
  about guest linking for personal crews, which is the same shape of gap. **Not this
  session.** A one-off Neon script covers the immediate need.
- Converting foreign keys to `ON DELETE CASCADE`. Logged against, see decision 1.
- Member removal and self-leave cascade behaviour. Deliberately unchanged, see decision 5.

## Closeout, required

End the session with, in this order:

1. Every file changed.
2. The four gate numbers each run actually printed.
3. The red output the new test produced against the unmodified handlers, before the fix.
4. What to test by hand: create a throwaway crew, start a Smash or Mario Kart session on an
   event without recording a result, then delete the event. Then repeat and delete the whole
   crew. Both must succeed. Also delete a crew that only ever ran a bracket, to confirm the
   path that always worked still does.
5. Deploy steps: push to `main` auto-deploys to Render. **No schema change and no Neon SQL.**
   Confirm the Render deploy goes green, not just that the push succeeded.
6. Confirmation that the MAP STATUS counter was incremented in the same commit.

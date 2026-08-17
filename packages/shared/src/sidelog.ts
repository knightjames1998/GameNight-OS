// THE SIDE LOG: which arrangement of sides a night was played under, and when
// it changed.
//
// `teams.ts` is the primitive: what a side IS, and what a side result does to
// placement. It has no notion of a session timeline and it should not get one,
// because a pure rule about placement is easier to reason about than a pure
// rule about placement that also knows what a match index is. This file is the
// timeline half, sitting next to it, importing from it.
//
// WHY IT IS A LOG AND NOT A FIELD, which is the whole design and the one thing
// to understand before changing anything here. Sides are fixed for the night by
// default with an explicit host reshuffle. If a reshuffle just OVERWROTE the
// arrangement, then a session that rebuilds derived state by REPLAYING its
// completed units (King of the Hill's throne and queue, in both packs that have
// one) would replay the early part of the night under sides that did not exist
// when it was played, and hand the table to a pair that never won it. Nothing
// errors; the screen is just wrong. Recording the boundary instead makes undo
// across it correct by construction rather than correct until somebody forgets
// a counter, which is the same reason craps derives its hands from an event log
// and Smashdown derives its burn board.
//
// EXTRACTED WHEN THE SECOND CONSUMER ARRIVED, which is the rule this repo uses
// for everything that has come out into shared (the money board, the
// title-night layer): one example is a pack, two is a layer. Ping Pong shipped
// it on 2026-08-02 and Mario Kart's pairs mode is the second.
//
// THERE IS A THIRD, AND IT IS DELIBERATELY NOT CONVERTED HERE.
// `titlenight.ts` carries the same log under its own names (`TnSideSet`,
// `currentTnSides`, the fromIdx-on-games.length reshuffle, the same
// replace-rather-than-stack rule), keyed on the GAMES count rather than a
// matches count. It fits this module exactly and it is a separate commit,
// because converting it moves two shipped packs (Board Game and Card Table) and
// their fixtures, and folding that into a Mario Kart session is how a session
// that was scoped as one thing ends up as three. Logged in BACKLOG.md.
//
// The unit COUNT is a plain number rather than a session, so nothing here knows
// whether a unit is a match, a race or a game. That is what lets three packs
// with three different ledger units share it.

import { validateSides, type Side } from "./teams.js";

/**
 * One arrangement of sides, and the unit index it takes effect from.
 *
 * `fromIdx` is an index into the session's COMPLETED units, so an entry with
 * fromIdx 2 means "everything from the third match on was played like this".
 */
export interface SideSet {
  fromIdx: number;
  sides: Side[];
}

/**
 * The whole history of arrangements, oldest first.
 *
 * ALWAYS AT LEAST ONE ENTRY, and the LAST one is in force. Every helper below
 * tolerates an empty array rather than throwing, because this thing is read out
 * of jsonb written by an older deploy and a screen that renders nothing is a
 * better failure than a screen that renders a stack trace.
 */
export type SideLog = SideSet[];

/** The opening log for a session: one arrangement, in force from the first unit. */
export function newSideLog(sides: Side[]): SideLog {
  return [{ fromIdx: 0, sides }];
}

/** The arrangement of sides in force right now. */
export function currentSides(log: readonly SideSet[]): Side[] {
  return log[log.length - 1]?.sides ?? [];
}

/**
 * The arrangement the unit at `idx` was played under.
 *
 * The last entry that had already taken effect by then, which is the reason
 * `fromIdx` is stored at all. A unit from before the first entry (which cannot
 * happen with a well-formed log, and can happen with one read out of old jsonb)
 * falls back to the earliest arrangement rather than to nothing.
 */
export function sidesAtIdx(log: readonly SideSet[], idx: number): Side[] {
  let found: SideSet | undefined;
  for (const entry of log) {
    if (entry.fromIdx <= idx) found = entry;
    else break;
  }
  return (found ?? log[0])?.sides ?? [];
}

/** True when the arrangement in force holds a side of more than one player. */
export function hasTeamStructure(log: readonly SideSet[]): boolean {
  return currentSides(log).some((s) => s.memberIds.length > 1);
}

/**
 * Put a new arrangement in force from the next unit on. MUTATES the log.
 *
 * Returns an error string or null, from the primitive's own validation, so a
 * caller cannot decide for itself that an arrangement is acceptable. Uneven
 * sides are NOT an error: see validateSides.
 *
 * A RESHUFFLE THAT HAS HAD NO UNITS UNDER IT YET REPLACES RATHER THAN STACKS,
 * so a host changing their mind twice does not leave a dead arrangement in the
 * log for a replay to walk past. This is the rule that is easy to drop in a
 * rewrite and impossible to see afterwards, because a dead entry is invisible
 * on every screen and only shows up as an off-by-one in a rebuilt ladder.
 *
 * It mutates rather than returning a new log because both consumers hold the
 * log inside a session object they are already mutating, and a version that
 * returned a copy would need every call site to remember to assign it back.
 */
export function reshuffle(log: SideLog, sides: Side[], unitCount: number): string | null {
  const check = validateSides(sides);
  if (check.error) return check.error;

  const entry: SideSet = { fromIdx: unitCount, sides };
  const last = log[log.length - 1];
  if (last && last.fromIdx === unitCount) log[log.length - 1] = entry;
  else log.push(entry);
  return null;
}

/**
 * Drop any arrangement that has not been reached yet. MUTATES the log.
 *
 * Called after an undo: the session now has `unitCount` completed units, and an
 * entry that took effect at a later index than that is an arrangement nothing
 * was ever played under any more. Popping it restores the one that WAS in force
 * before the reshuffle, which is what makes undoing back past a reshuffle put
 * the old pairs back on the screen.
 *
 * The first entry is never dropped, because a session with no arrangement at
 * all has nothing to render. Returns whether anything was dropped.
 */
export function truncateSideLog(log: SideLog, unitCount: number): boolean {
  let dropped = false;
  while (log.length > 1 && log[log.length - 1]!.fromIdx > unitCount) {
    log.pop();
    dropped = true;
  }
  return dropped;
}

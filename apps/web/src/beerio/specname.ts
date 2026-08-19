// A VOTER'S NICKNAME IS A LABEL, NEVER AN IDENTITY.
//
// The crowd's predictions are keyed by `sid`, a per-device id in localStorage,
// and the nickname is one field on the entry beside the picks. That is the
// right shape and it was already the shape: renaming has never been able to
// move a row, split a score, or orphan a pick, because nothing anywhere keys on
// the name. What was missing was the ability to do it at all. The name input
// rendered only while a voter had NO name, so the first thing you typed was
// permanent for the night.
//
// So this module is not "make renaming safe", it is the two small rules that
// keep an editable name from becoming an identity by accident:
//
//   cleanSpecName   what counts as a name at all, so blank or whitespace can
//                   never be saved. A voter whose name is cleared would show as
//                   "Mystery fan" on the board and, worse, look to themselves
//                   like a different person, which is exactly the confusion the
//                   sid exists to prevent.
//   renameInPreds   the local echo, which changes the NAME and nothing else.
//                   The picks are carried across by reference, so this cannot
//                   quietly drop a vote while looking like it only touched a
//                   string.
//
// THIS FILE IS OURS, beside band.ts, racer.ts, crowd.ts and roomsync.ts.

/** Matches the input's maxLength. The server caps at 24 independently. */
export const SPEC_NAME_MAX = 18;

/** One voter's entry: the shape BeerioApp's PredMap holds. */
export interface SpecEntry {
  name: string;
  picks: Record<string, string>;
}

/**
 * The name as it should be stored, or null when it is not a name.
 *
 * Null rather than an empty string on purpose: the caller has to decide what to
 * do about it, and the one thing it must not do is save it. An empty name is
 * not a rename, it is a voter deleting themselves from the board by holding
 * backspace.
 */
export function cleanSpecName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().slice(0, SPEC_NAME_MAX);
  return t.length > 0 ? t : null;
}

/**
 * The same crowd with one voter renamed, for the optimistic local echo.
 *
 * WHY THIS IS NOT JUST A SPREAD AT THE CALL SITE. The existing pick handler
 * writes `{name: specName, picks: next}`, rebuilding the whole entry from two
 * variables it happens to have in hand. Doing that for a rename would mean
 * naming `picks` again at a moment when picks are not what changed, and the
 * failure mode is silent: the board would show the new name over an empty score
 * until the next poll corrected it. Here the picks are the ones already on the
 * entry, and an unknown voter is returned untouched rather than invented.
 */
export function renameInPreds<T extends SpecEntry>(
  preds: Record<string, T>,
  sid: string,
  name: string,
): Record<string, T> {
  const mine = preds[sid];
  if (!mine) return preds;
  return { ...preds, [sid]: { ...mine, name } };
}

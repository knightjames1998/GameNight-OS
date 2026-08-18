// WHO IS IN A BRACKET: the entrant type, the reader that survives old rows,
// and the normalizer a create request runs its body through.
//
// Lifted out of index.ts on 2026-08-17, when the tournament stopped taking its
// entrants off the yes-RSVP list and started taking them from a roster screen.
// The type and its reader had lived in the middle of the transport types; the
// moment there was a THIRD function that had to agree with both of them, they
// wanted a file, the same way sides got teams.ts.
//
// PURE, AND THAT IS THE POINT OF THE FILE. The create route is a Drizzle
// sandwich: load the event, check the role, check for an existing bracket, then
// insert. The interesting part (is this a real crew member, is this a duplicate,
// is this too many, how long may a guest name be) has nothing to do with the
// database and everything to do with what a bracket is, so it lives here where
// a test can reach it without a schema.

/**
 * A bracket entrant is either a crew member (stats accrue) or a typed-in guest
 * (no stats, linkable to a member later). Legacy rows stored bare userId
 * strings; parseEntrants() below upgrades them on read, so no data migration
 * was needed.
 */
export type Entrant =
  | { kind: "member"; userId: string }
  | { kind: "guest"; name: string };

export function parseEntrants(raw: unknown): Entrant[] {
  if (!Array.isArray(raw)) return [];
  const out: Entrant[] = [];
  for (const e of raw) {
    if (typeof e === "string") out.push({ kind: "member", userId: e });
    else if (e && typeof e === "object") {
      const o = e as Record<string, unknown>;
      if (o.kind === "guest" && typeof o.name === "string") out.push({ kind: "guest", name: o.name });
      else if (typeof o.userId === "string") out.push({ kind: "member", userId: o.userId });
    }
  }
  return out;
}

// ---------- limits ----------

/** A bracket needs two entrants to be a bracket. */
export const MIN_ENTRANTS = 2;

/**
 * Thirty-two slots. The bracketed TV was measured to sixteen and reports
 * twenty-four out of contract (scripts/tv-fit.mjs), and the create endpoint had
 * no cap at all before this, which is how a bracket nobody can read on a
 * television gets started. Thirty-two is one power of two past anything this
 * app has seen and stops the truly silly case.
 */
export const MAX_ENTRANTS = 32;

/** Guest names are trimmed to this, matching every other roster in the app. */
export const GUEST_NAME_MAX = 24;

// ---------- normalization ----------

/**
 * Turn a create request's `entrants` body into `Entrant[]`, or into one
 * plain-English sentence explaining why it is not one.
 *
 * A STRING BACK IS AN ERROR, an array back is the answer. Two return types
 * rather than a throw because the only caller is an express handler that has to
 * choose a status code and a message, and a thrown Error there becomes either a
 * 500 or a catch block that reinvents this sentence.
 *
 * MEMBERSHIP IS VERIFIED, NEVER DOWNGRADED. A member entrant whose userId is
 * not in this event's crew is REJECTED. The tempting alternative is to quietly
 * turn it into a guest with the same name, which reads as forgiving and is the
 * exact silent failure this whole change exists to remove: a guest earns no
 * lifetime stats, so somebody would play a whole tournament and place, and
 * their record would not know about it. Nothing errors, the screen looks right,
 * and the history is wrong. Rejecting is loud, and the client cannot produce
 * the case anyway (its member path carries a userId picked from the crew list).
 *
 * A DUPLICATE MEMBER IS REJECTED RATHER THAN DEDUPED, for the same reason. The
 * roster screen cannot offer the same person twice, so a repeat means the body
 * did not come from that screen and something is wrong upstream. Deduping would
 * silently start a five-person bracket for a six-person request.
 *
 * Guests are NOT deduped: two people called Sam is a real party, and the two
 * of them are already distinguishable by seed. They both link to whoever the
 * host says later, which guest-link.ts has handled since it shipped.
 */
export function normalizeEntrants(
  input: unknown,
  crewMemberIds: ReadonlySet<string>,
): Entrant[] | string {
  if (!Array.isArray(input)) return "Entrants must be a list";

  const out: Entrant[] = [];
  const seenMembers = new Set<string>();

  for (const raw of input) {
    if (!raw || typeof raw !== "object") return "Every entrant needs a kind of member or guest";
    const o = raw as Record<string, unknown>;

    if (o.kind === "guest") {
      const name = String(o.name ?? "").trim().slice(0, GUEST_NAME_MAX);
      if (!name) return "A guest needs a name";
      out.push({ kind: "guest", name });
      continue;
    }

    if (o.kind === "member") {
      const userId = typeof o.userId === "string" ? o.userId : "";
      if (!userId) return "A crew member entrant is missing their id";
      if (!crewMemberIds.has(userId)) return "Someone on the list is not in this crew";
      if (seenMembers.has(userId)) return "Someone is on the list twice";
      seenMembers.add(userId);
      out.push({ kind: "member", userId });
      continue;
    }

    return "Every entrant needs a kind of member or guest";
  }

  if (out.length < MIN_ENTRANTS) return `Need at least ${MIN_ENTRANTS} entrants to start a bracket`;
  if (out.length > MAX_ENTRANTS) return `A bracket holds at most ${MAX_ENTRANTS} entrants`;
  return out;
}

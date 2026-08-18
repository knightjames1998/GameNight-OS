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
//
// The one import is the team primitive's side ids, which is the right direction
// and the only one that makes sense: an entrant knows it might be a side, and a
// side has never heard of a bracket.

import { sideIdAt } from "./teams.js";

/**
 * ONE PERSON IN A BRACKET: a crew member (stats accrue) or a typed-in guest
 * (no stats, linkable to a member later).
 */
export type SoloEntrant =
  | { kind: "member"; userId: string }
  | { kind: "guest"; name: string };

/**
 * SEVERAL PEOPLE IN ONE BRACKET SLOT: a doubles pair, a 2v2 Smash team, a beer
 * pong side.
 *
 * A TEAM ENTRANT IS ONE SLOT, and that sentence is the whole design. The engine
 * counts entrants and never asks what is in one, so `entrants.length` stays the
 * number of SLOTS and buildStructure, computeBracket, seedOrder and placements
 * are untouched by teams existing. A doubles bracket of eight pairs is the same
 * eight-slot bracket the engine has always built.
 *
 * `name` is optional because most pairs never get one: a team with no name
 * reads as its members joined with " + ", which is what sideLabel does for the
 * session packs and what a crew says out loud anyway.
 */
export interface TeamEntrant {
  kind: "team";
  name?: string;
  members: SoloEntrant[];
}

/**
 * A bracket entrant. Legacy rows stored bare userId strings; parseEntrants()
 * below upgrades them on read, so no data migration was needed then and none is
 * needed now: `entrants` is jsonb, and a bracket written before teams existed
 * simply has no entrant of this third kind in it.
 */
export type Entrant = SoloEntrant | TeamEntrant;

export function parseEntrants(raw: unknown): Entrant[] {
  if (!Array.isArray(raw)) return [];
  const out: Entrant[] = [];
  for (const e of raw) {
    if (typeof e === "string") out.push({ kind: "member", userId: e });
    else if (e && typeof e === "object") {
      const o = e as Record<string, unknown>;
      if (o.kind === "guest" && typeof o.name === "string") out.push({ kind: "guest", name: o.name });
      else if (o.kind === "team") {
        // A team's members go through the SOLO reader, so a team cannot nest a
        // team and junk inside one is dropped the same way junk beside one is.
        const members = parseSolo(o.members);
        const name = typeof o.name === "string" && o.name ? o.name : undefined;
        if (members.length) out.push(name ? { kind: "team", name, members } : { kind: "team", members });
      } else if (typeof o.userId === "string") out.push({ kind: "member", userId: o.userId });
    }
  }
  return out;
}

/** The solo half of the reader, which is also what a team's members are read by. */
function parseSolo(raw: unknown): SoloEntrant[] {
  if (!Array.isArray(raw)) return [];
  const out: SoloEntrant[] = [];
  for (const m of raw) {
    if (typeof m === "string") out.push({ kind: "member", userId: m });
    else if (m && typeof m === "object") {
      const o = m as Record<string, unknown>;
      if (o.kind === "guest" && typeof o.name === "string") out.push({ kind: "guest", name: o.name });
      else if (typeof o.userId === "string") out.push({ kind: "member", userId: o.userId });
    }
  }
  return out;
}

// ---------- reading an entrant of any kind ----------

/**
 * The people in an entrant, flat, whatever kind it is.
 *
 * A solo entrant is a list of one. That is what lets every caller stop asking
 * which kind it has: the guest-name scan, the guest backfill and the ledger
 * writer all walk this and are correct for all three kinds without a branch.
 */
export function entrantMembers(e: Entrant): SoloEntrant[] {
  return e.kind === "team" ? e.members : [e];
}

/**
 * What to show on a card, a TV row or a recap line.
 *
 * `nameOf` resolves a crew member's userId, because names live in the users
 * table and this module has no database. A member whose name cannot be resolved
 * reads "Unknown", which is what deriveView has always shown for that case.
 */
export function entrantLabel(e: Entrant, nameOf: (userId: string) => string | undefined): string {
  if (e.kind === "guest") return e.name;
  if (e.kind === "member") return nameOf(e.userId) ?? "Unknown";
  // A NAME WINS IF THERE IS ONE, and most pairs will not have one: a team is
  // usually just two people, and "Ann + Ben" is what the room calls them.
  if (e.name) return e.name;
  const names = e.members.map((m) => (m.kind === "guest" ? m.name : nameOf(m.userId) ?? "Unknown"));
  return names.length ? names.join(" + ") : "Unknown";
}

/** Does this bracket have team structure at all? See the side rule below. */
export function hasTeamEntrants(entrants: readonly Entrant[]): boolean {
  return entrants.some((e) => e.kind === "team");
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

/** A team is at least a pair. */
export const MIN_TEAM_MEMBERS = 2;

/**
 * And at most eight, which is the team primitive's MAX_SIDES read sideways: a
 * side that big is already past anything real.
 *
 * A SIDE OF ONE IS NOT A TEAM ENTRANT, it is a plain solo entrant. A doubles
 * bracket that has an odd person out holds pairs and one member entrant, and
 * the side rule below still gives that person a side id, because in a bracket
 * that HAS teams a solo entrant is a side of one.
 */
export const MAX_TEAM_MEMBERS = 8;

/** Team names get the same cap a guest name does. */
export const TEAM_NAME_MAX = 24;

// ---------- what a tournament is CALLED in the ledger ----------

/**
 * The name every generic bracket's `games` row carries.
 *
 * LIFETIME TOURNAMENT HISTORY BUCKETS ON `games.name`, so this being one
 * constant is what makes "my tournament record" a single number instead of one
 * per phrase anybody has ever typed. A host who names a night "beer pong" one
 * week and "Mario Kart" the next would otherwise split their own record across
 * three buckets, and nothing anywhere would error.
 */
export const BRACKET_GAME_NAME = "Tournament";

/**
 * Resolve the `games.name` for a bracket from a request body's `gameName`.
 *
 * A NAME IS ONLY HONOURED IF SOMETHING SENDS ONE, and nothing in the app does:
 * the tournament setup screen has no name box by decision (2026-08-17), and the
 * quick play route sends a typed title to the EVENT rather than to the game.
 * The parameter exists because the endpoint has always accepted it and a cached
 * bundle may still pass it; the fallback is the path every live caller takes.
 */
export function bracketGameName(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, 50) || BRACKET_GAME_NAME;
}

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
  // ACROSS THE WHOLE LIST, teams included: one person cannot be on two sides of
  // the same bracket, and that is not a different rule from "not twice in the
  // seeding", it is the same rule now that a slot can hold several people.
  const seenMembers = new Set<string>();

  /** One person, wherever they appear: on their own, or inside a team. */
  const solo = (o: Record<string, unknown>): SoloEntrant | string => {
    if (o.kind === "guest") {
      const name = String(o.name ?? "").trim().slice(0, GUEST_NAME_MAX);
      if (!name) return "A guest needs a name";
      return { kind: "guest", name };
    }
    if (o.kind === "member") {
      const userId = typeof o.userId === "string" ? o.userId : "";
      if (!userId) return "A crew member entrant is missing their id";
      if (!crewMemberIds.has(userId)) return "Someone on the list is not in this crew";
      if (seenMembers.has(userId)) return "Someone is on the list twice";
      seenMembers.add(userId);
      return { kind: "member", userId };
    }
    return "Every entrant needs a kind of member, guest or team";
  };

  for (const raw of input) {
    if (!raw || typeof raw !== "object") return "Every entrant needs a kind of member, guest or team";
    const o = raw as Record<string, unknown>;

    if (o.kind === "team") {
      if (!Array.isArray(o.members)) return "A team needs a list of members";
      const members: SoloEntrant[] = [];
      for (const m of o.members) {
        if (!m || typeof m !== "object") return "Every entrant needs a kind of member, guest or team";
        const one = solo(m as Record<string, unknown>);
        if (typeof one === "string") return one;
        members.push(one);
      }
      // A SIDE OF ONE IS A SOLO ENTRANT, not a team of one. Accepting a
      // one-member team would put a side id on a bracket that has no team
      // structure in it, which is the exact thing the side rule exists to stop.
      if (members.length < MIN_TEAM_MEMBERS) return `A team needs at least ${MIN_TEAM_MEMBERS} players`;
      if (members.length > MAX_TEAM_MEMBERS) return `A team holds at most ${MAX_TEAM_MEMBERS} players`;
      const name = String(o.name ?? "").trim().slice(0, TEAM_NAME_MAX);
      out.push(name ? { kind: "team", name, members } : { kind: "team", members });
      continue;
    }

    const one = solo(o);
    if (typeof one === "string") return one;
    out.push(one);
  }

  // SLOTS, not people. A doubles bracket of eight pairs is eight entrants, and
  // the cap is about how big a bracket the engine draws and a television shows.
  if (out.length < MIN_ENTRANTS) return `Need at least ${MIN_ENTRANTS} entrants to start a bracket`;
  if (out.length > MAX_ENTRANTS) return `A bracket holds at most ${MAX_ENTRANTS} entrants`;
  return out;
}

// ---------- the lifetime ledger ----------

/** One row for one crediting human, ready to become a match_participants row. */
export interface BracketLedgerRow {
  userId: string;
  seed: number;
  placement: number;
  isWinner: boolean;
  /** The side id, or null when this bracket has no team structure. */
  side: string | null;
}

/**
 * Turn a finished bracket into its ledger rows.
 *
 * ONE ROW PER CREDITING HUMAN, taking the SLOT's placement. A pair that goes out
 * in the semis is placement 3 for both of them, which is rule 2 in teams.ts: a
 * team result ranks SIDES, 1..N, written onto every member. Do not reach for
 * competition ranking here. placements() already ranks the entrants 1..N, and
 * for team entrants that IS the rule, which is why this function does not need
 * to know anything about ties.
 *
 * SIDE IS WRITTEN ONLY WHEN THE BRACKET HAS AT LEAST ONE TEAM ENTRANT, and that
 * is the same rule sideIdFor holds for the session packs, stated once more here
 * because the shape it applies to is different. An all-solo bracket keeps
 * writing null, because null means "no team structure" and writing "a" and "b"
 * into a 1v1 would make meetingOutcome classify two OPPONENTS as having played
 * together. Nothing errors; the rivalry is simply wrong forever.
 *
 * In a bracket that HAS teams, EVERY entrant gets a side id including the solo
 * ones: a solo entrant in a doubles bracket is a side of one, and leaving them
 * null there would say "this match had no teams" on a match that did.
 *
 * SIDE IDS COME FROM THE SEED INDEX. Slot 1 is side "a", slot 2 is "b", and
 * past the eighth sideIdAt falls back to s8, s9 and so on, which is why
 * validateSides is deliberately NOT called here: its MAX_SIDES of 8 is a
 * SESSION-level rule about how many sides one match can have, and a 16-team
 * bracket is a legitimate thing that would fail it. The only thing anything
 * does with `side` is compare it for equality.
 *
 * `linkedGuest` resolves a guest name to a member id and is how the guest-link
 * backfill credits somebody who played as a guest. Without it, guests are
 * skipped, which is what a live completion does.
 *
 * DEDUPED BY userId, BEST PLACEMENT WINS. Two guest slots typed with the same
 * name both resolve to one member through the link map, and the ledger's unique
 * index is (matchId, userId), so the caller must hand over one row per person.
 * Rows are walked in placement order so the row that survives is the better
 * finish rather than whichever the map happened to yield first.
 */
export function bracketLedgerRows(
  entrants: readonly Entrant[],
  placeBySeed: ReadonlyMap<number, number>,
  linkedGuest: (name: string) => string | undefined = () => undefined,
): BracketLedgerRow[] {
  const teams = hasTeamEntrants(entrants);
  const bySeed = [...placeBySeed.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const rows = new Map<string, BracketLedgerRow>();

  for (const [seed, placement] of bySeed) {
    const e = entrants[seed - 1];
    if (!e) continue;
    const side = teams ? sideIdAt(seed - 1) : null;
    for (const m of entrantMembers(e)) {
      const userId = m.kind === "member" ? m.userId : linkedGuest(m.name);
      if (!userId || rows.has(userId)) continue;
      rows.set(userId, { userId, seed, placement, isWinner: placement === 1, side });
    }
  }
  return [...rows.values()];
}

// SOCIAL DEDUCTION: the first pack in this app whose session state contains a
// SECRET.
//
// Every other pack's state is public by nature. Fighters, scores, standings and
// money are things a room says out loud, so a pack could hand its whole state to
// anybody who opened the page and nothing was lost. Roles are hidden by
// construction, and that IS the game.
//
// ===========================================================================
// ROLES NEVER ENTER THE SHARED SESSION STATE (James, 2026-08-10).
//
// `createPackRuntime`'s sessionView takes NO VIEWER ARGUMENT: every pack returns
// one payload to everybody, and standing rule 2 says members join the host's
// live session. So a role sitting in `SdSessionState` would reach every player
// at the table the moment they opened the page. Nothing would error. The game
// would simply be over.
//
// The rejected fix was making sessionView viewer-aware, which touches the
// plumbing all ten packs sit on and makes every future pack responsible for
// remembering to redact. Instead the secret lives in its own store
// (apps/server/src/deduction-secret.ts), reached by two routes and no others,
// and `SdSessionState` is public-safe BY CONSTRUCTION rather than by filtering.
// Same instinct as `sideIdFor` holding the null rule in one place: make the
// wrong thing unrepresentable, not merely filtered out.
//
// Read that as a rule about THIS FILE: there is no field below that maps a
// player to a role while a game is undecided, and adding one is the whole bug.
// The deal SUMMARY is here (how many wolves are in play) because a moderator
// announces the setup out loud in every one of these games. Who has what is
// not, and only becomes public at REVEAL, where it moves onto the recorded
// game, which is exactly where it is supposed to be.
//
// Guarded by apps/server/tests/deduction-secrecy.test.ts, which fails if a role
// reaches the session payload of a live game, and which proves it can see a
// leak by scanning a deliberately leaky payload.
// ===========================================================================
//
// WHY THIS DOES NOT RIDE THE TITLE-NIGHT LAYER, which was investigated against
// the real files rather than assumed. Two structural collisions:
//
//   1. The layer's sides are STABLE FOR THE NIGHT, with a reshuffle log keyed by
//      the game index it took effect from. Card Table partners persist across
//      hands. Deduction factions are RE-DEALT EVERY SINGLE GAME, so a reshuffle
//      would fire before every game and the log would carry one entry per game,
//      which is the model telling you it is the wrong model.
//   2. `recordTnGame` reads `currentTnSides(state)` internally, so riding it
//      requires factions to sit in session state during play, which is
//      precisely what the block above forbids.
//
// What IS reused, and it is a regression not to: `placementsFromRankedSides`
// for the faction result, `sideIdFor` for the `side` column, `validateSides`
// for the structure, `validateFfaSize` for the cap, and the three pure title
// functions (`normalizeTitle`, `canonicalTitle`, `tnTitleSuggestions`), which
// have no state dependency and so carry over free.
//
// Dependency-free, pure, no clock, no database. The only randomness is the
// deal, and it takes an injected RNG so a test can pin it.

import {
  placementsFromRankedSides,
  sideIdFor,
  validateSides,
  type RankedSide,
  type Side,
} from "./teams.js";
import { validateFfaSize } from "./smash.js";
// Exactly one of the three pure title functions is needed INSIDE this module;
// the other two (`canonicalTitle`, `tnTitleSuggestions`) are used by the pack's
// routes and its page, which import them from the layer directly.
import { normalizeTitle } from "./titlenight.js";

/**
 * How many people can sit at one deduction game.
 *
 * TWENTY. Blood on the Clocktower seats fifteen plus travellers and a Werewolf
 * party at a house is genuinely that big, so this is the one pack where the cap
 * is doing real work rather than catching a mis-tap. `validateFfa`'s 8 IS LOAD
 * BEARING FOR SMASH (Smashdown's battle cap is arithmetic against it), so
 * nothing here goes near the global; the cap travels as an argument, exactly as
 * the title-night packs pass their own twelve.
 */
export const SD_MAX_PLAYERS = 20;

// ---------- factions ----------

/**
 * Which way a faction is pointed. THREE, not two, and the third one is the
 * reason this type exists rather than a boolean.
 *
 * A SOLO faction is a third party: Tanner, Jester, the Serial Killer. It is in
 * scope for v1 rather than deferred, because these roles are in the box and a
 * crew that plays one has played it whether the app models it or not.
 *
 * The alignment is what the headline stat groups on ("win rate as village
 * versus as wolf"), so it travels onto every ledger row. A faction ID cannot do
 * that job on its own: Secret Hitler's evil faction is `fascists` and
 * Werewolf's is `wolves`, and those are genuinely different factions that a
 * lifetime stat still wants to count together.
 */
export type SdAlignment = "town" | "evil" | "solo";

export interface SdFaction {
  /** Stable, short, opaque. THIS IS THE `side` VALUE; see sdSidesFromOrder. */
  id: string;
  /** Display only. Never reaches the ledger. */
  name: string;
  alignment: SdAlignment;
}

/** One role in one title's catalogue. */
export interface SdRole {
  /** Stable and unique WITHIN a title. Written to the ledger at reveal. */
  id: string;
  name: string;
  factionId: string;
}

/**
 * One title's factions and roles.
 *
 * A CATALOGUE, NOT A RULEBOOK. The app records what a night did; it does not
 * referee it, so nothing below constrains what a moderator may deal. The lists
 * exist so the common setup is a few taps instead of typing, exactly as the
 * title-night packs' curated title lists do.
 */
export interface SdTitleDef {
  title: string;
  factions: readonly SdFaction[];
  roles: readonly SdRole[];
  /**
   * The plain role most of the table gets, and the plain evil one.
   *
   * OPTIONAL, because an UNCURATED TITLE HAS AN EMPTY CATALOGUE and there is no
   * such thing as its baseline. Absent means `suggestComposition` returns
   * nothing rather than inventing a shape, which is the whole point of the
   * 2026-08-14 fix: a game nobody picked is not Werewolf.
   */
  baselineTown?: string;
  baselineEvil?: string;
}

const TOWN = (id: string, name: string): SdFaction => ({ id, name, alignment: "town" });
const EVIL = (id: string, name: string): SdFaction => ({ id, name, alignment: "evil" });
const SOLO = (id: string, name: string): SdFaction => ({ id, name, alignment: "solo" });
const role = (id: string, name: string, factionId: string): SdRole => ({ id, name, factionId });

/**
 * The curated titles, and their factions.
 *
 * A CONVENIENCE, NEVER A ROSTER: free text always wins, and a free-typed title
 * gets SD_DEFAULT_DEF below, which is the same call the title-night layer makes
 * for a title it has never seen.
 *
 * The role lists are deliberately SHALLOW. Every one of these games has a long
 * tail of optional roles, and Blood on the Clocktower has hundreds that change
 * per script, so listing them would be a rulebook this app has no business
 * maintaining and would be out of date by its second edition. What is here is
 * the roles a crew actually announces at the start of a game.
 *
 * A ROLE THAT IS NOT ON THE LIST IS TYPED, not approximated. The workaround
 * this file used to document (deal the baseline and say the rest out loud) wrote
 * a FALSE RECORD on purpose: a Salem Witch went into `meta.role` as a
 * Townsperson, permanently, and any future win-rate-by-role surface reads that.
 * Titles were built open so a gap produces NO record rather than a WRONG one,
 * and `canonicalRole` below gives roles the same treatment.
 */
export const SD_TITLE_DEFS: readonly SdTitleDef[] = [
  {
    title: "Werewolf",
    factions: [TOWN("village", "Village"), EVIL("wolves", "Werewolves"), SOLO("tanner", "Tanner")],
    roles: [
      role("villager", "Villager", "village"),
      role("seer", "Seer", "village"),
      role("doctor", "Doctor", "village"),
      role("hunter", "Hunter", "village"),
      role("werewolf", "Werewolf", "wolves"),
      role("alpha", "Alpha Werewolf", "wolves"),
      // EVIL BUT NOT A WOLF. Both know the wolves and win with them, and neither
      // is one: a seer reads them as human and the wolves do not wake with them.
      // They sit on the wolves' FACTION because that is who they win with, which
      // is the only question this model asks, and the difference the deal cares
      // about is that they are not part of the wolf count.
      role("minion", "Minion", "wolves"),
      role("sorcerer", "Sorcerer", "wolves"),
      role("tanner", "Tanner", "tanner"),
    ],
    baselineTown: "villager",
    baselineEvil: "werewolf",
  },
  {
    title: "Mafia",
    factions: [TOWN("town", "Town"), EVIL("mafia", "Mafia")],
    roles: [
      role("townsperson", "Townsperson", "town"),
      role("detective", "Detective", "town"),
      role("doctor", "Doctor", "town"),
      role("mafioso", "Mafioso", "mafia"),
      role("godfather", "Godfather", "mafia"),
    ],
    baselineTown: "townsperson",
    baselineEvil: "mafioso",
  },
  {
    // SALEM MEANS THE 1692 CARD GAME (Facade Games, 2015), 2 to 12 players.
    //
    // ===================================================================
    // TWO DIFFERENT GAMES SHARE THIS NAME AND THIS CATALOGUE HAD THE WRONG
    // ONE until 2026-08-14, when James played a night and found a Mafioso.
    //
    // TOWN OF SALEM is the online PC and mobile game (BlankMediaGames):
    // Mafioso, Godfather, Sheriff, Investigator, Serial Killer, Jester,
    // Executioner, Witch. That is what shipped here on 2026-08-10, and it
    // is a game this app cannot be used for at all: it runs in its own
    // client with its own UI, and a crew playing it has no use for a
    // moderator board or a TV.
    //
    // SALEM 1692 is the physical card game, which is the one that needs
    // exactly this pack, and the one the crew plays (James, 2026-08-14).
    // Its tryal cards are Witch, Constable or Not A Witch, and its two
    // factions are the Townspeople and the Witches.
    //
    // DO NOT RE-IMPORT TOWN OF SALEM. If somebody wants it, it is a
    // DIFFERENT TITLE with a different label, not more roles under this one.
    // ===================================================================
    title: "Salem",
    factions: [
      // BOTH IDS SURVIVE THE CORRECTION, and that is deliberate: a faction id
      // is written to `match_participants.side` and to `meta.faction`, so it is
      // exactly as permanent as a role id.
      TOWN("town", "Townspeople"),
      // THE ONE THING THAT CHANGES MEANING UNDERNEATH A STABLE ID. The Witch
      // was a SOLO third party under Town of Salem; in Salem 1692 the Witches
      // are a main EVIL faction. The id stays (it still means "a witch") and
      // the alignment does not, so any row recorded before 2026-08-14 carries
      // `meta.alignment: "solo"` and now means something different. Nothing can
      // fix that in code; see the audit query in the 2026-08-14 closeout.
      EVIL("witch", "Witches"),
    ],
    roles: [
      role("townsperson", "Townsperson", "town"),
      role("witch", "Witch", "witch"),
      // THE CONSTABLE SPLITS INTO TWO, exactly as Blood on the Clocktower's
      // Traveller does, and for exactly the same reason: the Constable is
      // INDEPENDENT OF ALIGNMENT (a witch who draws it is an evil Constable and
      // may protect fellow witches), `role()` pins one faction on purpose, and
      // a role whose alignment floats cannot be ranked. Two entries, chosen
      // when the role is dealt, rather than one role that means either.
      role("constable", "Constable", "town"),
      role("witchconstable", "Witch Constable", "witch"),
    ],
    baselineTown: "townsperson",
    baselineEvil: "witch",
  },
  {
    title: "Secret Hitler",
    factions: [TOWN("liberals", "Liberals"), EVIL("fascists", "Fascists")],
    roles: [
      role("liberal", "Liberal", "liberals"),
      role("fascist", "Fascist", "fascists"),
      role("hitler", "Hitler", "fascists"),
    ],
    baselineTown: "liberal",
    baselineEvil: "fascist",
  },
  {
    title: "Avalon",
    factions: [EVIL("evil", "Minions of Mordred"), TOWN("good", "Loyal Servants of Arthur")],
    roles: [
      role("servant", "Loyal Servant", "good"),
      role("merlin", "Merlin", "good"),
      role("percival", "Percival", "good"),
      role("minion", "Minion of Mordred", "evil"),
      role("assassin", "Assassin", "evil"),
      role("morgana", "Morgana", "evil"),
      role("mordred", "Mordred", "evil"),
      role("oberon", "Oberon", "evil"),
    ],
    baselineTown: "servant",
    baselineEvil: "minion",
  },
  {
    title: "Blood on the Clocktower",
    // ROLE TYPES RATHER THAN NAMED ROLES, on purpose. The character set is
    // per script and runs to hundreds, so a list of names here would be wrong
    // for whichever script is on the table. The four types are what the
    // Storyteller announces to the room, and they are what the result needs.
    factions: [TOWN("good", "Good"), EVIL("evil", "Evil")],
    roles: [
      role("townsfolk", "Townsfolk", "good"),
      role("outsider", "Outsider", "good"),
      role("minion", "Minion", "evil"),
      role("demon", "Demon", "evil"),
      // THE FIFTH TYPE, AND IT NEEDS TWO ENTRIES RATHER THAN ONE. The
      // Storyteller announces five types and only four were listed. Travellers
      // can be good OR evil, and `role()` pins exactly one faction on purpose:
      // a role whose faction floats cannot be ranked, because the result form
      // ranks factions and every player's side is derived from their role. So
      // the choice is made when the role is dealt rather than left open.
      role("goodtraveller", "Good Traveller", "good"),
      role("eviltraveller", "Evil Traveller", "evil"),
    ],
    baselineTown: "townsfolk",
    baselineEvil: "demon",
  },
];

/** Just the names, for the picker and for `tnTitleSuggestions`. */
export const SD_TITLES: readonly string[] = SD_TITLE_DEFS.map((d) => d.title);

/**
 * What a title nobody has a catalogue for opens with: NOTHING.
 *
 * ===========================================================================
 * A GAME NOBODY PICKED IS NOT WEREWOLF (James, 2026-08-14).
 *
 * This used to be Village/Wolves with a `villager` and a `wolf`, returned for
 * an empty title AND for every free-typed one. Both routes already refuse an
 * empty title, so the empty case was only ever cosmetic (the deal card rendered
 * a Werewolf catalogue before anyone had picked anything, so the game looked
 * pre-selected). THE FREE-TYPED CASE WAS THE DAMAGING ONE: type "One Night
 * Ultimate Werewolf" or anything uncurated and the app OFFERED `villager` and
 * `wolf`, and a host who accepted them wrote `meta.role: "villager"` and
 * `meta.faction: "village"` permanently for a game that has neither.
 *
 * That is the same class of false record as a Witch recorded as a Townsperson,
 * except on the DEFAULT path, which is where it would happen most.
 *
 * So an uncurated title opens EMPTY and the host types the roles. That is
 * exactly what typed roles were built for, which is what makes this fix a
 * deletion rather than a feature. The two-faction floor still applies:
 * `validateComposition` refuses a deal that is all one faction, so a typed-only
 * deal cannot be a game with nobody to find.
 * ===========================================================================
 */
export const SD_DEFAULT_DEF: SdTitleDef = {
  title: "",
  factions: [],
  roles: [],
};

/** True when a title has no catalogue and the host has to type its roles. */
export function sdIsEmptyDef(def: SdTitleDef): boolean {
  return def.roles.length === 0;
}

/**
 * Other names for a curated title, folded onto the curated one.
 *
 * THE LABEL ITSELF NEVER CHANGES. `matches.label` carries the title and the
 * crew's recents carry it, so renaming "Salem" to "Salem 1692" would split that
 * title's history across two names with nothing erroring, which is the silent
 * failure this file already catalogues for pack display names. An alias fixes
 * the input instead: a host typing either lands on the one label.
 *
 * "TOWN OF SALEM" IS DELIBERATELY NOT HERE. It is a genuinely different game
 * (the online one) rather than another name for this one, so it stays
 * uncurated and opens the empty catalogue, which is the honest answer.
 */
export const SD_TITLE_ALIASES: Readonly<Record<string, string>> = {
  "salem 1692": "Salem",
  salem1692: "Salem",
};

/** Fold a known alias onto its curated title. Returns the title normalized. */
export function sdAliasTitle(raw: string | null | undefined): string {
  const title = normalizeTitle(raw ?? "");
  return SD_TITLE_ALIASES[title.toLowerCase()] ?? title;
}

/** The catalogue for a title, matched case-folded, or the default shape. */
export function sdTitleDef(title: string | null | undefined): SdTitleDef {
  if (!title) return SD_DEFAULT_DEF;
  const folded = sdAliasTitle(title).toLowerCase();
  return SD_TITLE_DEFS.find((d) => d.title.toLowerCase() === folded) ?? SD_DEFAULT_DEF;
}

/** A role out of a title's catalogue, or undefined. */
export function sdRole(def: SdTitleDef, roleId: string): SdRole | undefined {
  return def.roles.find((r) => r.id === roleId);
}

/** A faction out of a title's catalogue, or undefined. */
export function sdFaction(def: SdTitleDef, factionId: string): SdFaction | undefined {
  return def.factions.find((f) => f.id === factionId);
}

/** The faction a role belongs to, or undefined. */
export function sdFactionOfRole(def: SdTitleDef, roleId: string): SdFaction | undefined {
  const r = sdRole(def, roleId);
  return r ? sdFaction(def, r.factionId) : undefined;
}

// ---------- roles that are not on the list ----------
//
// ===========================================================================
// TITLES WERE OPEN AND ROLES WERE CLOSED, AND BOTH REACH THE PERMANENT RECORD.
//
// A free-typed title always won and got SD_DEFAULT_DEF. There was no equivalent
// for a role: the catalogue was closed per title, and the documented workaround
// was to deal the baseline and say the rest out loud. Every ledger line carries
// `meta.role`. So a Salem Witch was recorded as a Townsperson, permanently.
// That is not a missing feature, it is a false record written on purpose.
//
// THE ONE RULE THAT MAKES THIS SAFE: A TYPED ROLE CANONICALIZES TO THE ID THE
// CURATED ROLE WOULD HAVE. If a host types "Witch" tonight and a later session
// adds Witch to the catalogue, those must be THE SAME ROLE IN THE LEDGER, not
// two rows splitting one player's history across a typed one and a curated one.
// There is deliberately no separate namespace like `custom:Witch`: that is the
// split, dressed as tidiness. Same defence `canonicalTitle` already gives
// titles, one level down.
// ===========================================================================

/**
 * The id a role name mints: lower case, alphanumerics only.
 *
 * IT MUST MATCH THE CURATED IDS, which is why it strips rather than hyphenates:
 * "Serial Killer" is `serialkiller` in the shipped catalogue, and a slug that
 * produced `serial-killer` would mean a host who typed the name before it was
 * curated had their history split from everybody who tapped it afterwards.
 */
export function sdRoleSlug(name: string): string {
  return normalizeTitle(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A role typed for one game, on top of the title's catalogue. */
export interface SdCustomRole {
  id: string;
  name: string;
  factionId: string;
}

/** A faction created for a typed role that wins alone. */
export interface SdCustomFaction {
  id: string;
  name: string;
  alignment: SdAlignment;
}

/**
 * Resolve a typed role name against a title's catalogue.
 *
 * MATCHED BY NAME FIRST, THEN BY ID, and only a genuine miss mints a new id.
 * The name pass is what keeps the three roles whose shipped id does not equal
 * their slug working: "Alpha Werewolf" is `alpha`, "Loyal Servant" is `servant`
 * and Avalon's "Minion of Mordred" is `minion`. Typing any of those has to
 * return the id already in the ledger, never a second one.
 *
 * Returns null for an empty name.
 */
export function canonicalRole(raw: string, def: SdTitleDef): { id: string; name: string; matched: boolean } | null {
  const name = normalizeTitle(raw);
  if (!name) return null;
  const folded = name.toLowerCase();
  for (const r of def.roles) {
    if (r.name.toLowerCase() === folded) return { id: r.id, name: r.name, matched: true };
  }
  const slug = sdRoleSlug(name);
  for (const r of def.roles) {
    if (r.id === slug) return { id: r.id, name: r.name, matched: true };
  }
  return { id: slug, name, matched: false };
}

/**
 * Check a typed role before it can be dealt. Returns an error or null.
 *
 * A TYPED ROLE MUST CARRY A FACTION, and that is structural rather than
 * fussy: `factionsFromRoles` derives every player's side from their role, and
 * the result form ranks factions, so a role belonging to nothing cannot be
 * ranked and the game it was dealt in could not be recorded.
 *
 * `soloFaction` is the escape hatch for a role that wins alone, which is most
 * of what a host is typing: it mints a faction named after the role, exactly
 * the shape the Jester and the Tanner already have in the catalogue.
 */
export function validateTypedRole(
  def: SdTitleDef,
  raw: string,
  factionId: string | null,
  soloFaction: boolean,
): string | null {
  const c = canonicalRole(raw, def);
  if (!c) return "Name the role";
  if (soloFaction) return null;
  if (!factionId) return "Pick which faction this role wins with";
  if (!sdFaction(def, factionId)) return "That faction is not in this game";
  return null;
}

/**
 * Turn a typed role into the pair the deal stores: the role, and the faction it
 * needs if that faction does not exist yet.
 *
 * Returns null when the name is empty or, for the solo case, when the minted
 * faction id would collide with a faction the title already has, which is the
 * host typing the name of a faction rather than of a role.
 */
export function typedRole(
  def: SdTitleDef,
  raw: string,
  factionId: string | null,
  soloFaction: boolean,
): { role: SdCustomRole; faction: SdCustomFaction | null } | null {
  const c = canonicalRole(raw, def);
  if (!c) return null;
  if (!soloFaction) {
    if (!factionId || !sdFaction(def, factionId)) return null;
    return { role: { id: c.id, name: c.name, factionId }, faction: null };
  }
  // A solo faction takes the role's own id, which is what the catalogue already
  // does for the Jester, the Tanner and the Witch: one third party, one faction.
  const fid = c.id;
  return {
    role: { id: c.id, name: c.name, factionId: fid },
    faction: sdFaction(def, fid) ? null : { id: fid, name: c.name, alignment: "solo" },
  };
}

/**
 * The catalogue for ONE GAME: the title's, plus whatever the host typed.
 *
 * ONE MERGE POINT, so nothing downstream has to know typed roles exist.
 * `sdRole`, `sdFaction`, `factionsFromRoles`, `validateComposition`,
 * `sdPlacements` and the TV projection all take a def and are unchanged.
 *
 * A typed role whose id already exists is DROPPED rather than allowed to
 * shadow the curated one, which is the other half of the no-split rule: the
 * curated entry is the one with the faction the catalogue intends.
 */
export function sdDefWith(
  def: SdTitleDef,
  extraRoles: readonly SdCustomRole[] = [],
  extraFactions: readonly SdCustomFaction[] = [],
): SdTitleDef {
  if (extraRoles.length === 0 && extraFactions.length === 0) return def;
  const haveRole = new Set(def.roles.map((r) => r.id));
  const haveFaction = new Set(def.factions.map((f) => f.id));
  const factions = [...def.factions];
  for (const f of extraFactions) {
    if (haveFaction.has(f.id)) continue;
    haveFaction.add(f.id);
    factions.push(f);
  }
  const roles = [...def.roles];
  for (const r of extraRoles) {
    if (haveRole.has(r.id)) continue;
    haveRole.add(r.id);
    roles.push({ id: r.id, name: r.name, factionId: r.factionId });
  }
  return { ...def, factions, roles };
}

// ---------- the deal ----------

/** How many of one role are in the game. The public half of a deal. */
export interface SdRoleCount {
  roleId: string;
  count: number;
}

/**
 * What the room is told: the title, which deal this is, and the composition.
 *
 * THIS IS PUBLIC AND IT IS SUPPOSED TO BE. Every game in this genre opens with
 * the moderator saying the setup out loud ("nine players, two wolves, a seer
 * and a doctor"), and a screen that hid it would be hiding something the room
 * already knows while adding nothing. What is secret is WHO HAS WHAT, and that
 * mapping appears nowhere in this interface, nor anywhere else in this file's
 * session state.
 */
export interface SdDealSummary {
  /** 1-based, and it increments for every deal, including a re-deal. */
  dealNo: number;
  title: string;
  at: string;
  composition: SdRoleCount[];
  /**
   * Roles the host typed for this game, on top of the title's catalogue.
   *
   * PUBLIC, exactly like the composition and for exactly the same reason: the
   * moderator announces the setup out loud, and "there is a Witch in this one"
   * is part of that. What is secret is who has it, and that mapping is not here
   * or anywhere else in session state.
   */
  extraRoles: SdCustomRole[];
  /** Factions those typed roles needed, for the ones that win alone. */
  extraFactions: SdCustomFaction[];
}

/** The SECRET half: who has what. Never part of session state. See the header. */
export type SdRoleAssignment = Record<string, string>;

/**
 * The suggested number of evil players for a table of this size.
 *
 * floor(n / 4), never below one: 5 to 7 players get one, 8 to 11 get two, 12 to
 * 15 get three. That is the ratio every rulebook in the genre lands near, and it
 * is a STARTING POSITION rather than a rule, the same call the title-night packs
 * make about partnership defaults. The host adds and removes roles by tapping
 * before they deal.
 */
export function suggestedEvilCount(playerCount: number): number {
  return Math.max(1, Math.floor(playerCount / 4));
}

/**
 * The opening composition for a table of this size: the suggested evils, and
 * everybody else on the baseline town role.
 *
 * Deliberately does NOT sprinkle power roles or third parties. A Tanner that
 * turned up in every deal because the app liked the idea would be the app
 * refereeing somebody's game, and a seer nobody asked for changes what the
 * night IS. The host taps those in.
 */
export function suggestComposition(def: SdTitleDef, playerCount: number): SdRoleCount[] {
  // AN EMPTY CATALOGUE HAS NO SUGGESTION, and returning one would be inventing
  // a shape for a game the app has never heard of. That is the bug this
  // replaced, in its most damaging form.
  if (!def.baselineTown || !def.baselineEvil) return [];
  const n = Math.max(0, Math.floor(playerCount));
  const evil = Math.min(suggestedEvilCount(n), Math.max(0, n - 1));
  const town = n - evil;
  const out: SdRoleCount[] = [];
  if (town > 0) out.push({ roleId: def.baselineTown, count: town });
  if (evil > 0) out.push({ roleId: def.baselineEvil, count: evil });
  return out;
}

/** Total seats a composition fills. */
export function compositionSize(composition: readonly SdRoleCount[]): number {
  return composition.reduce((n, c) => n + Math.max(0, Math.floor(c.count)), 0);
}

/** Which factions a composition puts in the game, in catalogue order. */
export function factionsInPlay(def: SdTitleDef, composition: readonly SdRoleCount[]): SdFaction[] {
  const ids = new Set<string>();
  for (const c of composition) {
    if (c.count > 0) {
      const r = sdRole(def, c.roleId);
      if (r) ids.add(r.factionId);
    }
  }
  return def.factions.filter((f) => ids.has(f.id));
}

/**
 * Is this composition dealable to this many players? Returns an error or null.
 *
 * The count has to match EXACTLY rather than "at least". A deal that left
 * somebody without a role would be a person sitting at the table with nothing
 * to be, and a deal with a role left over is a moderator who has miscounted and
 * would rather find out now than three nights later.
 */
export function validateComposition(
  def: SdTitleDef,
  composition: readonly SdRoleCount[],
  playerCount: number,
): string | null {
  for (const c of composition) {
    if (!sdRole(def, c.roleId)) return "That role is not in this game";
    if (!Number.isInteger(c.count) || c.count < 0) return "A role count has to be a whole number";
  }
  const size = validateFfaSize(playerCount, SD_MAX_PLAYERS, "A deduction game");
  if (size) return size;
  const total = compositionSize(composition);
  if (total !== playerCount) {
    return total < playerCount
      ? `${playerCount - total} more role${playerCount - total === 1 ? "" : "s"} to deal`
      : `${total - playerCount} role${total - playerCount === 1 ? "" : "s"} too many`;
  }
  // TWO FACTIONS IS WHAT MAKES IT A GAME. A table where everybody is a villager
  // has nobody to find, and it is a real mis-tap: knock the wolf count to zero
  // and every other check above still passes.
  if (factionsInPlay(def, composition).length < 2) return "A deal needs at least two factions";
  return null;
}

/**
 * Deal a composition onto a roster at random.
 *
 * THE RESULT IS THE SECRET. It goes to the store behind the two gated routes
 * and never to session state; see the header of this file.
 *
 * Fisher-Yates over the role multiset, so every arrangement is equally likely.
 * A sort with a random comparator is not a shuffle and is biased in ways nobody
 * notices, which matters more here than anywhere else in the app: a dealer that
 * favoured the first seat would hand the same person the wolf all night and the
 * crew would blame each other rather than the code. The RNG is injected so a
 * test can pin the deal.
 *
 * Assumes a composition that has already passed `validateComposition`; it deals
 * as many seats as it can rather than throwing, so a caller that skipped the
 * check gets a short deal instead of a crash mid-night.
 */
export function dealRoles(
  composition: readonly SdRoleCount[],
  playerIds: readonly string[],
  rng: () => number = Math.random,
): SdRoleAssignment {
  const pool: string[] = [];
  for (const c of composition) {
    for (let i = 0; i < Math.max(0, Math.floor(c.count)); i++) pool.push(c.roleId);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const out: SdRoleAssignment = {};
  playerIds.forEach((id, i) => {
    const roleId = pool[i];
    if (roleId) out[id] = roleId;
  });
  return out;
}

/** The composition a dealt assignment actually produced, in catalogue order. */
export function compositionOf(def: SdTitleDef, roles: SdRoleAssignment): SdRoleCount[] {
  const counts = new Map<string, number>();
  for (const roleId of Object.values(roles)) counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
  return def.roles
    .filter((r) => counts.has(r.id))
    .map((r) => ({ roleId: r.id, count: counts.get(r.id)! }));
}

/** playerId -> factionId, for a dealt assignment. The record form's prefill. */
export function factionsFromRoles(def: SdTitleDef, roles: SdRoleAssignment): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [playerId, roleId] of Object.entries(roles)) {
    const f = sdFactionOfRole(def, roleId);
    if (f) out[playerId] = f.id;
  }
  return out;
}

// ---------- session state ----------

/** A roster slot. No character and no role: see the header for the role half. */
export interface SdPlayer {
  id: string;
  kind: "member" | "guest";
  userId: string | null;
  name: string;
}

/** One recorded line, ready for the ledger. */
export interface SdLine {
  playerId: string;
  placement: number;
  isWinner: boolean;
  /**
   * `match_participants.side`, and it is NOT the same field as `factionId`
   * below even though it usually holds the same string.
   *
   * teams.ts owns the rule: null when every faction has exactly one member, so
   * "null means no team structure" stays literally true and `meetingOutcome`
   * cannot read a field of solos as a set of teammates. `factionId` is the
   * pack's own truth and is always set. Keeping both is what lets the ledger
   * rule and the pack's record disagree safely on the one arrangement where
   * they should.
   */
  side: string | null;
  factionId: string;
  alignment: SdAlignment;
  /**
   * The role, PUBLIC FROM REVEAL ON. Null when the night was moderated on paper
   * and nobody dealt through the app, which is a real way to play: the result
   * form still captures the faction, which is what the headline stat needs.
   */
  roleId: string | null;
  /**
   * Did they make it to the end? NULL WHEN THE LIVE BOARD WAS OFF, never false.
   *
   * The board is opt-in and off by default (we always lead with low friction
   * tracking), and roulette's max-consecutive-winning-spins settled what that
   * costs: a stat the tracker alone can produce is ABSENT rather than zero when
   * the tracker was off, and there is deliberately NO BOX TO TYPE IT INTO,
   * because offering one invites a guess into the ledger. A zero here would be
   * a claim that everybody died.
   */
  survived: boolean | null;
  /** First off the table. Null for the same reason, and never typed. */
  votedOutFirst: boolean | null;
}

export interface SdGame {
  idx: number;
  title: string;
  lines: SdLine[];
  /** The factions that played it, in finish order. A snapshot, not a pointer. */
  factions: { id: string; name: string; alignment: SdAlignment; memberIds: string[]; placement: number }[];
  /** Whether the app dealt this game, or the room did it on paper. */
  dealt: boolean;
  /** How far the game got, or NULL when the board was off. Absent, never zero. */
  days: number | null;
  /**
   * The typed roles this game was played with, snapshotted.
   *
   * `meta.role` on the ledger carries the ID, which is the permanent record and
   * is self-contained. This keeps the NAME too, so a future wins-by-role surface
   * can label a typed role without needing the catalogue to have caught up.
   */
  extraRoles: SdCustomRole[];
  at: string;
}

// ---------- the live moderator board ----------

/**
 * Night, then day, then night again. Numbered together as the room narrates
 * them: Night 1, Day 1, Night 2, Day 2.
 *
 * The number advances on DAY TO NIGHT rather than on night to day, which is the
 * one that looks backwards written down and is right at a table: a game opens
 * on night one, and the day that follows is day one because it is the day that
 * night produced.
 */
export type SdPhase = "night" | "day";

/** How somebody left the table. */
export type SdOutKind = "voted" | "night";

export interface SdBoardPlayer {
  playerId: string;
  alive: boolean;
  /** How they went out. Null while alive. */
  out: SdOutKind | null;
  /** The phase number they went out on. Null while alive. */
  outDay: number | null;
  /**
   * Their role, PUBLIC FROM THE MOMENT IT IS SET, and it is the only role that
   * may ever reach the TV before a game is recorded.
   *
   * ONE WAY. Bringing a mis-tapped player back to life does NOT clear this,
   * because the room has already seen it on the big screen and a screen that
   * un-revealed would be telling the table something untrue. The host is warned
   * of that on the button rather than protected from it by a lie.
   */
  revealedRoleId: string | null;
}

export interface SdBoard {
  /** 1-based. Night 1 is where a game opens. */
  day: number;
  phase: SdPhase;
  players: SdBoardPlayer[];
  /** Who left the table, in the order they left. First out is first. */
  outOrder: string[];
  /** When the board was switched on, so a mid-game start is legible. */
  startedAt: string;
}

/** A fresh board: everybody alive, nothing revealed, Night 1. */
export function newSdBoard(roster: readonly SdPlayer[], at: string): SdBoard {
  return {
    day: 1,
    phase: "night",
    players: roster.map((p) => ({
      playerId: p.id,
      alive: true,
      out: null,
      outDay: null,
      revealedRoleId: null,
    })),
    outOrder: [],
    startedAt: at,
  };
}

/** Night 1, Day 1, Night 2, Day 2. Mutates and returns the board. */
export function sdAdvancePhase(board: SdBoard): SdBoard {
  if (board.phase === "night") board.phase = "day";
  else {
    board.phase = "night";
    board.day++;
  }
  return board;
}

/**
 * Put somebody out, or bring them back. Returns an error or null.
 *
 * `kind` null brings a player back, which exists because the board is tapped by
 * a person moderating a game at the same time and a mis-tap has to be
 * survivable. It restores life and clears the exit, and it deliberately does
 * NOT clear a reveal: see SdBoardPlayer.revealedRoleId.
 *
 * `revealRoleId` is the one input to this whole module that comes out of the
 * SECRET STORE. The server reads it there and passes it here; nothing in this
 * file can reach a role on its own, which is what keeps the secret's readers
 * countable.
 */
export function sdSetOut(
  board: SdBoard,
  playerId: string,
  kind: SdOutKind | null,
  revealRoleId?: string | null,
): string | null {
  const p = board.players.find((x) => x.playerId === playerId);
  if (!p) return "That player is not on this board";

  if (kind === null) {
    p.alive = true;
    p.out = null;
    p.outDay = null;
    board.outOrder = board.outOrder.filter((id) => id !== playerId);
  } else {
    p.alive = false;
    p.out = kind;
    p.outDay = board.day;
    if (!board.outOrder.includes(playerId)) board.outOrder.push(playerId);
  }
  // A reveal is applied whichever way the tap went, and never undone.
  if (revealRoleId) p.revealedRoleId = revealRoleId;
  return null;
}

/** How many are still in. */
export function sdAliveCount(board: SdBoard): number {
  return board.players.filter((p) => p.alive).length;
}

/**
 * What the board says about each player, for the ledger.
 *
 * FIRST VOTED OUT IS LITERAL: the first player the table VOTED out, so a night
 * kill does not take it. That is what the stat is called and it is the one a
 * crew argues about. A game where nobody was voted out gives it to nobody, and
 * false is a real answer there because the board was on and the answer is known.
 */
export function sdBoardOutcomes(board: SdBoard): Record<string, { survived: boolean; votedOutFirst: boolean }> {
  const kindOf = new Map(board.players.map((p) => [p.playerId, p.out]));
  const firstVoted = board.outOrder.find((id) => kindOf.get(id) === "voted") ?? null;
  const out: Record<string, { survived: boolean; votedOutFirst: boolean }> = {};
  for (const p of board.players) {
    out[p.playerId] = { survived: p.alive, votedOutFirst: p.playerId === firstVoted };
  }
  return out;
}

/**
 * The whole shared session state, and every field in it is PUBLIC.
 *
 * Read the header before adding one. The test that guards this asserts the
 * exact key list of the session payload, so a new field is a deliberate act
 * rather than something that slips in behind a spread.
 */
export interface SdSessionState {
  sessionKey: string;
  openScoring: boolean;
  /** The title on the table right now, or null between games. */
  nowPlaying: string | null;
  roster: SdPlayer[];
  /** The setup the room was told. Never who has what. Null when nothing is dealt. */
  deal: SdDealSummary | null;
  /**
   * THE HOST'S PREFERENCE FOR THIS NIGHT, and it is OFF BY DEFAULT.
   *
   * We always lead with low friction tracking (James), so the board is opt-in
   * and off is a real mode rather than a degraded one: a night moderated
   * entirely on paper still records the title, the factions and the winner,
   * which is everything the headline stat needs. What the board buys on top is
   * survival and first voted out, and those are absent rather than zero without
   * it.
   *
   * Separate from `board` below because they answer different questions. This
   * one survives between games; `board` is the current game's and is rebuilt
   * every deal.
   */
  boardEnabled: boolean;
  /**
   * The live board for the game in progress, or null.
   *
   * EVERYTHING IN IT IS PUBLIC. Alive and dead is what the room can see across
   * the table, the day count is what the moderator says out loud, and a revealed
   * role is one the room has already been told. That is what lets the board sit
   * in shared state at all while the deal cannot: see the header.
   */
  board: SdBoard | null;
  games: SdGame[];
}

export function newSdState(opts: { roster: SdPlayer[] }): SdSessionState {
  return {
    sessionKey: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    openScoring: false,
    nowPlaying: null,
    roster: opts.roster,
    deal: null,
    boardEnabled: false,
    board: null,
    games: [],
  };
}

/**
 * Bring a state read out of jsonb up to the current shape.
 *
 * PART A SHIPPED WITHOUT A BOARD, so every session row written before this
 * session has no `boardEnabled`, no `board` and no `days` on its games. The
 * failure without this is silent rather than loud: an old row loads, a read of
 * `state.board.players` throws inside a route that was working yesterday, or
 * worse, a `games.map` renders `undefined` days into the TV. `createPackRuntime`
 * runs it at the two points where raw jsonb becomes state and nowhere else.
 */
export function normalizeSdState(state: SdSessionState): SdSessionState {
  return {
    ...state,
    boardEnabled: state.boardEnabled ?? false,
    board: state.board ?? null,
    // Every session row written before typed roles existed lacks these three.
    // The failure without the backfill is silent rather than loud: a `.map` over
    // undefined throws inside a route that worked yesterday.
    deal: state.deal
      ? { ...state.deal, extraRoles: state.deal.extraRoles ?? [], extraFactions: state.deal.extraFactions ?? [] }
      : null,
    games: (state.games ?? []).map((g) => ({ ...g, days: g.days ?? null, extraRoles: g.extraRoles ?? [] })),
  };
}

// ---------- the result ----------

/** One faction in a finish order, with who was on it. */
export interface SdFactionEntry {
  factionId: string;
  memberIds: string[];
  /** Competition ranking: this faction finished level with the one above. */
  tiedWithAbove?: boolean;
}

/**
 * The faction order as the team primitive sees it.
 *
 * THE FACTION ID IS THE SIDE ID, deliberately. `side` is compared only for
 * equality and never rendered, so an opaque stable string is exactly what it
 * wants, and "which side of this match were you on" and "which faction were you"
 * are the same question in this pack. Two players who shared a faction read as
 * teammates to `buildRivalry`, which is correct and is the whole reason `side`
 * was built.
 */
export function sdSidesFromOrder(order: readonly SdFactionEntry[]): Side[] {
  return order.map((e) => ({ id: e.factionId, name: e.factionId, memberIds: [...e.memberIds] }));
}

/**
 * Check a faction result. Returns an error or null.
 *
 * The structural half is `validateSides`, so the screen and the server cannot
 * give two different answers about what a valid arrangement is, and this file
 * does not get its own opinion about empty sides or a player on two of them.
 * What is checked here first is what is specific to this pack: a faction the
 * title does not have, a player who is not in this session, and the size rule,
 * which delegates to `validateFfaSize` with this pack's own cap.
 */
export function validateSdResult(
  order: readonly SdFactionEntry[],
  state: SdSessionState,
  def: SdTitleDef,
): string | null {
  const known = new Set(state.roster.map((p) => p.id));
  let heads = 0;
  for (const e of order) {
    if (!sdFaction(def, e.factionId)) return "That faction is not in this game";
    for (const id of e.memberIds) {
      if (!known.has(id)) return "Somebody in the result is not in this session";
    }
    heads += e.memberIds.length;
  }
  // Said in this pack's words before validateSides gets to say it in the
  // primitive's ("Need at least 2 sides"), which is true but reads like a
  // different app on a screen that has never used the word.
  if (order.length < 2) return "A result needs at least two factions";
  const size = validateFfaSize(heads, SD_MAX_PLAYERS, "A deduction game");
  if (size) return size;
  return validateSides(sdSidesFromOrder(order)).error;
}

/**
 * Turn a faction finish order into one ledger line per player.
 *
 * The ranking is teams.ts's, not a second copy: rule 2 at the top of that file
 * says a team result ranks SIDES 1..N and writes the side's placement onto
 * every member, so the whole winning faction takes placement 1 and wins
 * together, which is exactly what `side` was built for.
 *
 * THE TIE FLAG IS COMPETITION RANKING OVER FACTIONS, and it is not decoration:
 * a solo win is real. `[Tanner, Village, Wolves]` with the tie flag on Wolves is
 * 1, 2, 2, which says the Tanner won and the other two lost together, and that
 * is a sentence a Werewolf table says out loud most weeks.
 */
export function sdPlacements(
  order: readonly SdFactionEntry[],
  def: SdTitleDef,
  roles: SdRoleAssignment | null,
  board?: SdBoard | null,
): SdLine[] {
  // THE BOARD IS THE ONLY SOURCE for these two, and a missing board means NULL
  // rather than false. There is deliberately no other input: the order the
  // caller passes in could carry `survived` and this ignores it, because a box
  // to type it into is a guess in the ledger and a `false` here would claim
  // everybody died.
  const outcome = board ? sdBoardOutcomes(board) : null;
  const sides = sdSidesFromOrder(order);
  const ranked: RankedSide[] = order.map((e, i) => ({
    side: sides[i]!,
    tiedWithAbove: e.tiedWithAbove,
  }));
  const placed = placementsFromRankedSides(ranked);
  const factionOf = new Map<string, string>();
  for (const e of order) for (const id of e.memberIds) factionOf.set(id, e.factionId);

  return placed.map((l) => {
    const factionId = factionOf.get(l.playerId) ?? "";
    return {
      playerId: l.playerId,
      placement: l.placement,
      isWinner: l.isWinner,
      // teams.ts's null rule, applied rather than re-derived. An all-solo table
      // (every faction holding exactly one player) writes null here and reads
      // as the ordinary per-player case it is.
      side: sideIdFor(sides, l.playerId),
      factionId,
      alignment: sdFaction(def, factionId)?.alignment ?? "solo",
      roleId: roles?.[l.playerId] ?? null,
      // Absent, never zero; see SdLine.survived.
      survived: outcome?.[l.playerId]?.survived ?? null,
      votedOutFirst: outcome?.[l.playerId]?.votedOutFirst ?? null,
    };
  });
}

/**
 * Record one finished game onto the session and hand it back.
 *
 * `roles` is the deal read out of the SECRET STORE at the moment of reveal, and
 * this is the ONE place a role legitimately crosses into shared state: the game
 * is over, the room has been told, and a recorded result that did not say who
 * was the wolf would be a record of nothing anybody remembers.
 *
 * The game snapshots its factions, so nothing a later deal does can rewrite
 * what a recorded game meant.
 */
export function recordSdGame(
  state: SdSessionState,
  title: string,
  order: readonly SdFactionEntry[],
  def: SdTitleDef,
  roles: SdRoleAssignment | null,
  at: string,
): SdGame {
  const lines = sdPlacements(order, def, roles, state.board);
  const placementOf = new Map(lines.map((l) => [l.playerId, l.placement]));
  const game: SdGame = {
    idx: state.games.length,
    title,
    lines,
    factions: order.map((e) => ({
      id: e.factionId,
      name: sdFaction(def, e.factionId)?.name ?? e.factionId,
      alignment: sdFaction(def, e.factionId)?.alignment ?? "solo",
      memberIds: [...e.memberIds],
      placement: placementOf.get(e.memberIds[0] ?? "") ?? 0,
    })),
    dealt: !!roles && Object.keys(roles).length > 0,
    days: state.board?.day ?? null,
    extraRoles: state.deal?.extraRoles ?? [],
    at,
  };
  state.games.push(game);
  // The game is over, so nothing is on the table and nothing is dealt until the
  // host says otherwise. Clearing the deal here is not tidying: the summary
  // describes a game that has finished, and leaving it up would have the screen
  // announce a setup nobody is playing.
  //
  // THE BOARD GOES WITH IT, and `boardEnabled` does not. The board belongs to
  // the game that just ended and its outcomes are already baked into the lines
  // above, so keeping it would have the TV showing a table of dead people from
  // a game nobody is playing. The host's PREFERENCE survives, so the next deal
  // opens a fresh board without anybody re-flipping a toggle.
  state.nowPlaying = null;
  state.deal = null;
  state.board = null;
  return game;
}

// ---------- the TV projection ----------

/**
 * What the public TV route serves.
 *
 * ===========================================================================
 * THIS IS THE ONE SCREEN IN THE APP WITH A SECRECY CONSTRAINT, and it is built
 * as a PROJECTION rather than as a filter for exactly that reason.
 *
 * The TV is public, UUID-keyed and unauthenticated: anybody with the link can
 * open it, including a player sitting at the table on their own phone. So an
 * unrevealed role must be ABSENT FROM THIS PAYLOAD. Not hidden by CSS, not
 * rendered face down with the value in the DOM, not filtered on the client.
 *
 * The only two roles this function can reach are:
 *   1. `board.players[].revealedRoleId`, which is set only by a host tapping
 *      reveal and is public from that moment, and
 *   2. the roles on a RECORDED game, which are public because recording IS the
 *      reveal.
 * It never touches the secret store and it is never handed a deal, so there is
 * no code path here that HAS an unrevealed role in a variable it could
 * accidentally serialize.
 *
 * Guarded by apps/server/tests/deduction-secrecy.test.ts with the same three
 * probes the session payload gets, and negative-controlled.
 * ===========================================================================
 */
export interface SdTvPlayer {
  playerId: string;
  name: string;
  alive: boolean;
  out: SdOutKind | null;
  outDay: number | null;
  /** The role name, ONLY once revealed. Null otherwise, and absent by construction. */
  revealed: string | null;
  /** The revealed role's alignment, for the ink. Null until revealed. */
  alignment: SdAlignment | null;
}

export interface SdTvView {
  status: string;
  title: string | null;
  /** The setup the room was told. Counts only, never who has what. */
  composition: { name: string; count: number }[] | null;
  board: {
    day: number;
    phase: SdPhase;
    alive: number;
    outTotal: number;
    players: SdTvPlayer[];
  } | null;
  /** The roster, for the nights the board is off and there is nobody to draw. */
  roster: { playerId: string; name: string }[];
  games: number;
  summary: SdNightSummary;
}

export function sdTvView(state: SdSessionState): SdTvView {
  const nameOf = new Map(state.roster.map((p) => [p.id, p.name]));
  // THE MERGED def, so a typed role reaches the screen under its own name
  // rather than falling back to its id. It still resolves only roles somebody
  // chose to reveal; see this function's header.
  const def = sdDefWith(
    sdTitleDef(state.deal?.title ?? state.nowPlaying),
    state.deal?.extraRoles,
    state.deal?.extraFactions,
  );
  const board = state.board;

  return {
    status: "live",
    title: state.deal?.title ?? state.nowPlaying,
    composition:
      state.deal?.composition.map((c) => ({
        name: sdRole(def, c.roleId)?.name ?? c.roleId,
        count: c.count,
      })) ?? null,
    board: board
      ? {
          day: board.day,
          phase: board.phase,
          alive: sdAliveCount(board),
          outTotal: board.players.length - sdAliveCount(board),
          players: board.players.map((p) => {
            // Resolved through the catalogue, so what reaches the screen is a
            // display name for a role somebody chose to reveal, and `null`
            // otherwise. There is no branch here that reads a deal.
            const r = p.revealedRoleId ? sdRole(def, p.revealedRoleId) : undefined;
            return {
              playerId: p.playerId,
              name: nameOf.get(p.playerId) ?? "?",
              alive: p.alive,
              out: p.out,
              outDay: p.outDay,
              revealed: r?.name ?? null,
              alignment: r ? sdFaction(def, r.factionId)?.alignment ?? "solo" : null,
            };
          }),
        }
      : null,
    roster: state.roster.map((p) => ({ playerId: p.id, name: p.name })),
    games: state.games.length,
    summary: summarizeSdNight(state),
  };
}

// ---------- the ledger shape ----------

/** What one recorded line writes to `match_participants.meta`. */
export interface SdMeta {
  faction: string;
  alignment: SdAlignment;
  role: string | null;
  /** Null when the live board was off. Absent, never zero. See SdLine. */
  survived: boolean | null;
  votedOutFirst: boolean | null;
}

/** One participant row a recorded game produces, before the runtime sees it. */
export interface SdLedgerLine {
  playerId: string;
  placement: number;
  isWinner: boolean;
  side: string | null;
  meta: SdMeta;
}

/**
 * The participant rows for one recorded game.
 *
 * The FACTION rides in meta rather than only in `side`, and the two are not
 * redundant: `side` goes null on an all-solo table by the primitive's rule, and
 * the headline stat ("win rate as village versus as wolf") must still be able to
 * read what somebody was. `alignment` rides along for the same reason a score's
 * grain does: a row that named only `wolves` or `fascists` would leave every
 * future reader to maintain a table of which faction ids are evil.
 */
export function sdGameLines(game: SdGame): SdLedgerLine[] {
  return game.lines.map((l) => ({
    playerId: l.playerId,
    placement: l.placement,
    isWinner: l.isWinner,
    side: l.side,
    meta: {
      faction: l.factionId,
      alignment: l.alignment,
      role: l.roleId,
      survived: l.survived,
      votedOutFirst: l.votedOutFirst,
    },
  }));
}

// ---------- the night so far ----------

export interface SdPlayerStat {
  playerId: string;
  name: string;
  games: number;
  wins: number;
  /** Games and wins on a town-aligned faction. */
  townGames: number;
  townWins: number;
  /** Games and wins on an evil-aligned faction. */
  evilGames: number;
  evilWins: number;
  /** Games and wins as a third party. */
  soloGames: number;
  soloWins: number;
}

export interface SdNightSummary {
  players: SdPlayerStat[];
  titles: { title: string; games: number }[];
  /** Wins per faction alignment across the night, for the room's own argument. */
  byAlignment: { alignment: SdAlignment; games: number; wins: number }[];
  last: {
    title: string;
    factions: { name: string; placement: number; names: string[] }[];
  } | null;
}

const ALIGNMENTS: SdAlignment[] = ["town", "evil", "solo"];

export function summarizeSdNight(state: SdSessionState): SdNightSummary {
  const nameOf = new Map(state.roster.map((p) => [p.id, p.name]));
  const players = new Map<string, SdPlayerStat>();
  const titles = new Map<string, number>();
  const align = new Map<SdAlignment, { games: number; wins: number }>();

  for (const g of state.games) {
    titles.set(g.title, (titles.get(g.title) ?? 0) + 1);
    for (const l of g.lines) {
      const p =
        players.get(l.playerId) ??
        {
          playerId: l.playerId,
          name: nameOf.get(l.playerId) ?? "?",
          games: 0,
          wins: 0,
          townGames: 0,
          townWins: 0,
          evilGames: 0,
          evilWins: 0,
          soloGames: 0,
          soloWins: 0,
        };
      p.games++;
      if (l.isWinner) p.wins++;
      if (l.alignment === "town") {
        p.townGames++;
        if (l.isWinner) p.townWins++;
      } else if (l.alignment === "evil") {
        p.evilGames++;
        if (l.isWinner) p.evilWins++;
      } else {
        p.soloGames++;
        if (l.isWinner) p.soloWins++;
      }
      players.set(l.playerId, p);

      const a = align.get(l.alignment) ?? { games: 0, wins: 0 };
      a.games++;
      if (l.isWinner) a.wins++;
      align.set(l.alignment, a);
    }
  }

  const lastGame = state.games[state.games.length - 1];
  return {
    players: [...players.values()].sort((a, b) => b.wins - a.wins || b.games - a.games || a.name.localeCompare(b.name)),
    titles: [...titles.entries()]
      .map(([title, games]) => ({ title, games }))
      .sort((a, b) => b.games - a.games || a.title.localeCompare(b.title)),
    byAlignment: ALIGNMENTS.filter((a) => align.has(a)).map((a) => ({
      alignment: a,
      games: align.get(a)!.games,
      wins: align.get(a)!.wins,
    })),
    last: lastGame
      ? {
          title: lastGame.title,
          factions: [...lastGame.factions]
            .sort((a, b) => a.placement - b.placement)
            .map((f) => ({
              name: f.name,
              placement: f.placement,
              names: f.memberIds.map((id) => nameOf.get(id) ?? "?"),
            })),
        }
      : null,
  };
}

// The three pure title functions this pack reuses (`normalizeTitle`,
// `canonicalTitle`, `tnTitleSuggestions`) are NOT re-exported from here.
// They already leave the package under their own names from titlenight.ts, and
// a second export of the same binding through `export *` in index.ts would be
// an ambiguous star export: TypeScript resolves that by dropping the name
// entirely, so both packs would lose a function nothing had touched. Callers
// import them from @gamenight/shared exactly as Board Game and Card Table do.

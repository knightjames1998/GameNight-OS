// SOCIAL DEDUCTION, the pure half: the faction model, the deal, and the result
// path built on the team primitive.
//
// The secrecy rule (roles never enter shared session state) is guarded next
// door in apps/server/tests/deduction-secrecy.test.ts, because what it asserts
// is the shape of a SESSION PAYLOAD rather than the shape of a value. What is
// here is everything the ledger and the screen depend on, and two of these
// tests exist because their failure is SILENT:
//
//   - the Tanner case, where a solo winner would go `side: null` if nothing
//     else at the table had more than one member, and a null side makes
//     `meetingOutcome` misread the row forever with nothing erroring,
//   - the survival and first-voted-out fields, which must be ABSENT rather than
//     zero when the live board was off, and which nothing may smuggle in.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compositionOf,
  compositionSize,
  dealRoles,
  factionsFromRoles,
  factionsInPlay,
  canonicalRole,
  newSdBoard,
  newSdState,
  normalizeSdState,
  recordSdGame,
  sdAdvancePhase,
  sdAliasTitle,
  sdAliveCount,
  sdBoardOutcomes,
  sdDefWith,
  sdIsEmptyDef,
  sdRoleSlug,
  sdSetOut,
  sdTvView,
  sdFaction,
  sdFactionOfRole,
  sdGameLines,
  sdPlacements,
  sdRole,
  sdSidesFromOrder,
  sdTitleDef,
  suggestComposition,
  suggestedEvilCount,
  summarizeSdNight,
  typedRole,
  validateComposition,
  validateSdResult,
  validateTypedRole,
  SD_DEFAULT_DEF,
  SD_MAX_PLAYERS,
  SD_TITLES,
  SD_TITLE_DEFS,
  SESSION_PACKS,
  type SdFactionEntry,
  type SdCustomFaction,
  type SdCustomRole,
  type SdPlayer,
  type SdSessionState,
  type SdTitleDef,
} from "../src/index.js";

const players = (n: number): SdPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    kind: "member" as const,
    userId: `u${i}`,
    name: `P${i}`,
  }));

/** A deterministic RNG, so a deal can be pinned. */
const seeded = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};

// ---------- identity ----------

test("the pack's permanent identifiers are the ones that were picked", () => {
  // All three fail SILENTLY when changed: nothing errors, the rows simply stop
  // matching. Pinned here on the day the pack shipped, the same discipline
  // every other pack's identifiers get.
  const p = SESSION_PACKS.deduction;
  assert.equal(p.ledger, "deduction");
  assert.equal(p.gameName, "Social Deduction");
  assert.equal(p.keyPrefix, "sd");
  assert.equal(p.route, "deduction");
  assert.equal(p.table, "game_sessions");
});

test("the curated titles, exactly as they shipped", () => {
  assert.deepEqual(SD_TITLES, [
    "Werewolf",
    "Mafia",
    "Salem",
    "Secret Hitler",
    "Avalon",
    "Blood on the Clocktower",
  ]);
});

/**
 * EVERY ROLE ID SHIPPED BEFORE 2026-08-10, transcribed by hand from the
 * catalogue as it stood.
 *
 * These are already written into `meta.role` on real ledger rows. Renaming one
 * orphans that history with NOTHING ERRORING, exactly like a ledgerKey or a
 * pack display name: the row stays, the lookup stops matching, and a
 * win-rate-by-role surface quietly disagrees with the night it describes. ADD
 * ONLY, NEVER RENAME (James, 2026-08-10: "keep the existing roles").
 */
const SHIPPED_ROLE_IDS: Record<string, string[]> = {
  Werewolf: ["villager", "seer", "doctor", "hunter", "werewolf", "alpha", "tanner"],
  Mafia: ["townsperson", "detective", "doctor", "mafioso", "godfather"],
  Salem: ["townsperson", "sheriff", "doctor", "investigator", "mafioso", "godfather", "serialkiller", "jester"],
  "Secret Hitler": ["liberal", "fascist", "hitler"],
  Avalon: ["servant", "merlin", "percival", "minion", "assassin", "morgana", "mordred", "oberon"],
  "Blood on the Clocktower": ["townsfolk", "outsider", "minion", "demon"],
};

/**
 * IDS DELIBERATELY REMOVED, and why, so a future session cannot quietly drop a
 * role without editing this list.
 *
 * SALEM WAS THE WRONG SALEM. The catalogue shipped Town of Salem (the online
 * game) and the crew plays Salem 1692 (the card game), so seven roles and four
 * factions that belong to a different game came out on 2026-08-14. Removal is
 * NOT the same hazard as renaming: existing ledger rows keep their ids intact
 * and the screens already fall back to the raw id for a role the catalogue does
 * not have.
 *
 * THE REAL HAZARD IS REUSE. None of these ids may EVER be re-added to Salem
 * meaning something else, because that silently rewrites rows already written.
 * If Town of Salem is ever wanted, it is a DIFFERENT TITLE with its own label.
 */
const REMOVED_ROLE_IDS: Record<string, string[]> = {
  Salem: ["sheriff", "doctor", "investigator", "mafioso", "godfather", "serialkiller", "jester", "executioner"],
};

test("EVERY PREVIOUSLY SHIPPED ROLE ID STILL RESOLVES, unless it was deliberately removed", () => {
  // The guard, made mechanical. A role removed or renamed fails here rather
  // than in a stats query nobody runs for a month, and a REMOVAL has to be
  // written into the list above to pass, which is the point.
  for (const [title, ids] of Object.entries(SHIPPED_ROLE_IDS)) {
    const def = sdTitleDef(title);
    const removed = new Set(REMOVED_ROLE_IDS[title] ?? []);
    for (const id of ids) {
      if (removed.has(id)) {
        assert.equal(sdRole(def, id), undefined, `${title}: ${id} is listed as removed but still resolves`);
        continue;
      }
      assert.ok(sdRole(def, id), `${title}: role id ${id} no longer resolves`);
      assert.ok(sdFactionOfRole(def, id), `${title}: role id ${id} points at no faction`);
    }
  }
});

test("A REMOVED ROLE ID IS NEVER REUSED FOR SOMETHING ELSE", () => {
  // The one hazard removal actually carries. A row recorded under Town of Salem
  // says `meta.role: "sheriff"`; re-adding `sheriff` to Salem meaning anything
  // at all would retroactively relabel that row.
  for (const [title, ids] of Object.entries(REMOVED_ROLE_IDS)) {
    const def = sdTitleDef(title);
    for (const id of ids) {
      assert.equal(sdRole(def, id), undefined, `${title}: the removed id ${id} has been reused`);
      assert.equal(sdFaction(def, id), undefined, `${title}: the removed faction id ${id} has been reused`);
    }
  }
});

test("SALEM IS SALEM 1692, THE CARD GAME, not the online one", () => {
  // Two different games share the name and this catalogue had the wrong one
  // until 2026-08-14. Salem 1692's tryal cards are Witch, Constable or Not A
  // Witch, and its factions are the Townspeople and the Witches.
  const salem = sdTitleDef("Salem");
  assert.deepEqual(salem.roles.map((r) => r.id), ["townsperson", "witch", "constable", "witchconstable"]);
  assert.deepEqual(salem.factions.map((f) => f.id), ["town", "witch"]);

  // THE WITCH KEEPS HER ID AND CHANGES ALIGNMENT. She was a SOLO third party
  // under Town of Salem; here the Witches are a main EVIL faction.
  assert.equal(sdFactionOfRole(salem, "witch")?.alignment, "evil");
  assert.equal(sdFactionOfRole(salem, "townsperson")?.alignment, "town");

  // THE CONSTABLE SPLITS IN TWO, exactly like BotC's Traveller: the role is
  // independent of alignment, and a role whose faction floats cannot be ranked.
  assert.equal(sdFactionOfRole(salem, "constable")?.alignment, "town");
  assert.equal(sdFactionOfRole(salem, "witchconstable")?.alignment, "evil");
  assert.equal(sdRole(salem, "witchconstable")?.name, "Witch Constable");
});

test("SALEM 1692 RESOLVES TO THE SALEM LABEL, rather than becoming a second one", () => {
  // The label never changes: `matches.label` carries the title and the crew's
  // recents carry it, so renaming would split that title's history across two
  // names with nothing erroring. The ALIAS fixes the input instead.
  assert.equal(sdAliasTitle("Salem 1692"), "Salem");
  assert.equal(sdAliasTitle("  salem 1692  "), "Salem");
  assert.equal(sdAliasTitle("Salem1692"), "Salem");
  assert.equal(sdTitleDef("Salem 1692").title, "Salem");
  assert.equal(sdTitleDef("salem 1692").roles.length, 4);
  // A title with no alias comes back as itself, normalized.
  assert.equal(sdAliasTitle("  One   Night  "), "One Night");

  // TOWN OF SALEM IS DELIBERATELY NOT ALIASED. It is a different game rather
  // than another name for this one, so it stays uncurated and opens empty,
  // which is the honest answer.
  assert.equal(sdAliasTitle("Town of Salem"), "Town of Salem");
  assert.ok(sdIsEmptyDef(sdTitleDef("Town of Salem")));
});

test("the catalogue gaps found on 2026-08-10 are filled", () => {
  const wolf = sdTitleDef("Werewolf");
  // Evil but not a wolf: both win WITH the wolves, so they sit on that faction.
  assert.equal(sdFactionOfRole(wolf, "minion")?.id, "wolves");
  assert.equal(sdFactionOfRole(wolf, "sorcerer")?.id, "wolves");

  // SALEM'S 08-10 ADDITIONS WERE TO THE WRONG GAME and left with it on 08-14;
  // see "SALEM IS SALEM 1692" above. The Witch survives, under a stable id,
  // with the alignment the correct game gives her.

  const botc = sdTitleDef("Blood on the Clocktower");
  // THE FIFTH TYPE NEEDED TWO ENTRIES: a Traveller can be good or evil, and
  // `role()` pins exactly one faction because a role whose faction floats
  // cannot be ranked.
  assert.equal(sdFactionOfRole(botc, "goodtraveller")?.alignment, "town");
  assert.equal(sdFactionOfRole(botc, "eviltraveller")?.alignment, "evil");
  assert.equal(botc.roles.length, 6);

  // LEFT ALONE ON PURPOSE. Secret Hitler's three roles are the whole game,
  // Avalon is complete for the base box, and Mafia is thin but coherent.
  // Adding to these to look thorough is how a curated list turns into the
  // rulebook this pack declined to become.
  assert.equal(sdTitleDef("Secret Hitler").roles.length, 3);
  assert.equal(sdTitleDef("Avalon").roles.length, 8);
  assert.equal(sdTitleDef("Mafia").roles.length, 5);
});

test("every catalogue is internally consistent", () => {
  for (const def of [...SD_TITLE_DEFS, SD_DEFAULT_DEF]) {
    const factionIds = new Set(def.factions.map((f) => f.id));
    assert.equal(factionIds.size, def.factions.length, `${def.title}: duplicate faction id`);
    const roleIds = new Set(def.roles.map((r) => r.id));
    assert.equal(roleIds.size, def.roles.length, `${def.title}: duplicate role id`);
    for (const r of def.roles) {
      assert.ok(factionIds.has(r.factionId), `${def.title}: ${r.id} points at no faction`);
    }
    // AN EMPTY CATALOGUE HAS NO BASELINES AND NO FACTIONS, and that is the
    // point of it: an uncurated title opens with nothing and the host types the
    // roles. Skipped rather than deleted, so the CURATED six keep the check.
    if (sdIsEmptyDef(def)) {
      assert.equal(def.factions.length, 0, "an empty catalogue must not carry factions either");
      assert.equal(def.baselineTown, undefined);
      assert.equal(def.baselineEvil, undefined);
      continue;
    }
    // The baselines are what a suggested composition deals, so a typo in one
    // would produce a deal with a role nobody can look up.
    assert.ok(sdRole(def, def.baselineTown!), `${def.title}: baselineTown`);
    assert.ok(sdRole(def, def.baselineEvil!), `${def.title}: baselineEvil`);
    assert.equal(sdFactionOfRole(def, def.baselineTown!)?.alignment, "town", `${def.title}: town baseline`);
    assert.equal(sdFactionOfRole(def, def.baselineEvil!)?.alignment, "evil", `${def.title}: evil baseline`);
    // Two factions minimum, or there is nobody to find.
    assert.ok(def.factions.length >= 2, `${def.title}: needs at least two factions`);

    // TYPING A CURATED ROLE'S NAME RETURNS THAT ROLE, never a second one. This
    // is the half of 3.2 that has to hold for every entry in the catalogue,
    // including the three whose shipped id does not equal their slug.
    for (const r of def.roles) {
      assert.equal(canonicalRole(r.name, def)?.id, r.id, `${def.title}: typing "${r.name}" misses ${r.id}`);
      assert.equal(canonicalRole(r.name.toUpperCase(), def)?.id, r.id, `${def.title}: ${r.name} is case sensitive`);
    }
  }
});

/**
 * THE THREE ROLES WHOSE SHIPPED ID DOES NOT EQUAL THEIR NAME'S SLUG.
 *
 * They predate typed roles, so nothing could ever have been typed against them
 * and no history can be split by them; `canonicalRole` matches by NAME first,
 * so typing their names still lands on the shipped id. Every role added from
 * 2026-08-10 on must slug cleanly, because a role typed BEFORE it is curated
 * mints `sdRoleSlug(name)` and the curated entry has to agree with that or the
 * two are different rows in the ledger.
 */
const SLUG_EXCEPTIONS = new Set(["Werewolf:alpha", "Avalon:servant", "Avalon:minion"]);

test("A ROLE ID EQUALS ITS NAME'S SLUG, which is what makes type-then-curate unify", () => {
  const offenders: string[] = [];
  for (const def of [...SD_TITLE_DEFS, SD_DEFAULT_DEF]) {
    for (const r of def.roles) {
      const key = `${def.title}:${r.id}`;
      if (SLUG_EXCEPTIONS.has(key)) continue;
      if (sdRoleSlug(r.name) !== r.id) offenders.push(`${key} (slug of "${r.name}" is ${sdRoleSlug(r.name)})`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a curated role's id does not match its name's slug. A host who typed that name before " +
      "it was curated got the slug, so these are two different roles in the ledger and one " +
      "player's history is split across both.\n  " + offenders.join("\n  "),
  );
  // And the exceptions are real rather than a list somebody widened.
  assert.equal(sdRoleSlug("Alpha Werewolf"), "alphawerewolf");
  assert.notEqual(sdRoleSlug("Alpha Werewolf"), "alpha");
});

test("a title is matched case-folded, and ANYTHING ELSE OPENS AN EMPTY CATALOGUE", () => {
  assert.equal(sdTitleDef("Werewolf").title, "Werewolf");
  assert.equal(sdTitleDef("werewolf").title, "Werewolf");
  assert.equal(sdTitleDef("  secret hitler  ").title, "Secret Hitler");

  // THIS ASSERTION USED TO BE THE BUG WRITTEN DOWN AS A TEST. It said an
  // uncurated title "opens the default shape", and the default shape was
  // Village/Wolves with a `villager` and a `wolf`. So typing "One Night
  // Ultimate Werewolf" offered those two roles, and a host who accepted them
  // wrote `meta.role: "villager"` permanently for a game that has neither.
  // A game nobody picked is not Werewolf (James, 2026-08-14).
  for (const uncurated of ["Ultimate Werewolf Deluxe", "One Night Ultimate Werewolf", "Town of Salem", null, ""]) {
    const def = sdTitleDef(uncurated);
    assert.equal(def, SD_DEFAULT_DEF, `${uncurated} should open the empty catalogue`);
    assert.ok(sdIsEmptyDef(def));
    assert.deepEqual(def.roles, []);
    assert.deepEqual(def.factions, []);
  }
});

test("AN EMPTY CATALOGUE SUGGESTS NOTHING rather than inventing a shape", () => {
  const empty = sdTitleDef("One Night Ultimate Werewolf");
  assert.deepEqual(suggestComposition(empty, 9), []);
  assert.equal(compositionSize(suggestComposition(empty, 9)), 0);
  // And the deal is blocked until the host types some roles, by the count rule
  // that was already there.
  assert.equal(validateComposition(empty, [], 9), "9 more roles to deal");
});

test("an uncurated title is playable the moment the host TYPES its roles", () => {
  // Which is what makes the empty default cheap rather than a new feature:
  // typed roles already existed, and this is the path they were built for.
  const empty = sdTitleDef("One Night Ultimate Werewolf");
  const villager = typedRole(empty, "Villager", null, false);
  assert.equal(villager, null, "with no factions to pick from, a non-solo role cannot resolve yet");

  const wolf = typedRole(empty, "Wolf", null, true)!;
  const withWolf = sdDefWith(empty, [wolf.role], [wolf.faction!]);
  const town = typedRole(withWolf, "Villager", null, true)!;
  const def = sdDefWith(withWolf, [town.role], [town.faction!]);

  assert.equal(def.roles.length, 2);
  assert.equal(validateComposition(def, [{ roleId: "wolf", count: 2 }, { roleId: "villager", count: 7 }], 9), null);
  // And the two-faction floor still bites on a typed-only deal, so an empty
  // catalogue cannot become a game with nobody to find.
  assert.equal(
    validateComposition(def, [{ roleId: "villager", count: 9 }], 9),
    "A deal needs at least two factions",
  );
});

test("THIRD-PARTY SOLO ROLES ARE IN THE CATALOGUE, not deferred", () => {
  // Salem's third parties left with Town of Salem on 2026-08-14, so the
  // Werewolf Tanner carries this now. The MODEL is unchanged: a solo faction
  // is still a first-class alignment and `sdPlacements` still gives a solo
  // winner a real side id (see the Tanner case below).
  const wolf = sdTitleDef("Werewolf");
  assert.equal(sdFaction(wolf, "tanner")?.alignment, "solo");
  assert.equal(sdFactionOfRole(wolf, "tanner")?.alignment, "solo");
});

// ---------- the deal ----------

test("the suggested evil count is floor(n/4), never below one", () => {
  assert.equal(suggestedEvilCount(5), 1);
  assert.equal(suggestedEvilCount(7), 1);
  assert.equal(suggestedEvilCount(8), 2);
  assert.equal(suggestedEvilCount(11), 2);
  assert.equal(suggestedEvilCount(12), 3);
  // A table too small to be a game still gets one, so the screen has something
  // to show rather than a composition of nothing.
  assert.equal(suggestedEvilCount(2), 1);
});

test("a suggested composition fills exactly the seats, and sprinkles nothing", () => {
  const def = sdTitleDef("Werewolf");
  const c = suggestComposition(def, 9);
  assert.equal(compositionSize(c), 9);
  assert.deepEqual(c, [
    { roleId: "villager", count: 7 },
    { roleId: "werewolf", count: 2 },
  ]);
  // NO POWER ROLES AND NO THIRD PARTIES BY DEFAULT. A Tanner that turned up
  // because the app liked the idea would be the app refereeing somebody's game.
  assert.equal(c.some((x) => x.roleId === "tanner" || x.roleId === "seer"), false);
});

test("a composition has to fill every seat exactly, and say what is missing", () => {
  const def = sdTitleDef("Werewolf");
  assert.equal(validateComposition(def, suggestComposition(def, 9), 9), null);
  assert.equal(
    validateComposition(def, [{ roleId: "villager", count: 6 }, { roleId: "werewolf", count: 2 }], 9),
    "1 more role to deal",
  );
  assert.equal(
    validateComposition(def, [{ roleId: "villager", count: 8 }, { roleId: "werewolf", count: 3 }], 9),
    "2 roles too many",
  );
  assert.equal(validateComposition(def, [{ roleId: "nobody", count: 9 }], 9), "That role is not in this game");
  assert.equal(
    validateComposition(def, [{ roleId: "villager", count: 1.5 }], 9),
    "A role count has to be a whole number",
  );
});

test("A DEAL WITH ONE FACTION IS NOT A GAME, and it is a reachable mis-tap", () => {
  // Knock the wolf count to zero and every other check passes: the counts add
  // up, every role is real, the table is the right size. There is just nobody
  // to find.
  const def = sdTitleDef("Werewolf");
  assert.equal(
    validateComposition(def, [{ roleId: "villager", count: 9 }], 9),
    "A deal needs at least two factions",
  );
  assert.equal(
    factionsInPlay(def, [{ roleId: "villager", count: 9 }, { roleId: "werewolf", count: 0 }]).length,
    1,
  );
});

test("the cap is this pack's twenty, and Smash's eight is nowhere near it", () => {
  const def = sdTitleDef("Werewolf");
  assert.equal(SD_MAX_PLAYERS, 20);
  assert.equal(validateComposition(def, suggestComposition(def, 20), 20), null);
  assert.equal(
    validateComposition(def, suggestComposition(def, 21), 21),
    "A deduction game is capped at 20 players",
  );
});

test("the deal hands every player exactly one role, and the composition survives it", () => {
  const def = sdTitleDef("Werewolf");
  const roster = players(9);
  const composition = suggestComposition(def, 9);
  const roles = dealRoles(composition, roster.map((p) => p.id), seeded(7));

  assert.equal(Object.keys(roles).length, 9);
  for (const p of roster) assert.ok(sdRole(def, roles[p.id]!), `${p.id} got ${roles[p.id]}`);
  // What was dealt IS what was announced. A dealer that quietly dropped a role
  // would leave the room playing a different game from the one on the screen.
  assert.deepEqual(compositionOf(def, roles), composition);
});

test("the deal is a real shuffle: the seat that gets the wolf moves", () => {
  const def = sdTitleDef("Werewolf");
  const ids = players(9).map((p) => p.id);
  const composition = suggestComposition(def, 9);
  const seen = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    const roles = dealRoles(composition, ids, seeded(seed));
    for (const [id, r] of Object.entries(roles)) if (r === "werewolf") seen.add(id);
  }
  // A dealer that favoured the first seats would hand the same people the wolf
  // all night and the crew would blame each other rather than the code.
  assert.ok(seen.size >= 7, `only ${seen.size} of 9 seats ever drew the wolf`);
});

test("a dealt assignment maps back onto factions, which is the record form's prefill", () => {
  const def = sdTitleDef("Secret Hitler");
  const roles = { p0: "liberal", p1: "liberal", p2: "fascist", p3: "hitler" };
  assert.deepEqual(factionsFromRoles(def, roles), {
    p0: "liberals",
    p1: "liberals",
    p2: "fascists",
    p3: "fascists",
  });
});

// ---------- the result ----------

test("the winning faction takes placement 1 together, which is what side was built for", () => {
  const def = sdTitleDef("Werewolf");
  const order: SdFactionEntry[] = [
    { factionId: "wolves", memberIds: ["p0", "p1"] },
    { factionId: "village", memberIds: ["p2", "p3", "p4"] },
  ];
  const lines = sdPlacements(order, def, null);
  assert.deepEqual(
    lines.map((l) => [l.playerId, l.placement, l.isWinner, l.side]),
    [
      ["p0", 1, true, "wolves"],
      ["p1", 1, true, "wolves"],
      ["p2", 2, false, "village"],
      ["p3", 2, false, "village"],
      ["p4", 2, false, "village"],
    ],
  );
});

test("THE TANNER CASE: a solo winner gets a REAL side id, never null", () => {
  // The shape 3.3 of the scoping session called out, and the one that would go
  // wrong silently. Sides [Tanner, Village, Wolves] with the tie flag on Wolves
  // is placements 1, 2, 2: the Tanner won and the other two lost together.
  //
  // Because VILLAGE HOLDS SEVERAL MEMBERS, `isTeamPlay` is true, so teams.ts
  // gives the Tanner a real side id rather than null. A null there would make
  // `meetingOutcome` read the row as having no team structure forever, and
  // nothing would error: the rivalry would simply be wrong.
  const def = sdTitleDef("Werewolf");
  const order: SdFactionEntry[] = [
    { factionId: "tanner", memberIds: ["p0"] },
    { factionId: "village", memberIds: ["p1", "p2", "p3"] },
    { factionId: "wolves", memberIds: ["p4", "p5"], tiedWithAbove: true },
  ];
  const lines = sdPlacements(order, def, null);
  const tanner = lines.find((l) => l.playerId === "p0")!;

  assert.equal(tanner.placement, 1);
  assert.equal(tanner.isWinner, true);
  assert.equal(tanner.side, "tanner", "a solo winner must carry its faction id, not null");
  assert.equal(tanner.alignment, "solo");
  // 1, 2, 2: the tie is competition ranking over FACTIONS, and it is what says
  // the village and the wolves lost together to a third party.
  assert.deepEqual(lines.map((l) => l.placement), [1, 2, 2, 2, 2, 2]);
  assert.deepEqual(
    lines.map((l) => l.side),
    ["tanner", "village", "village", "village", "wolves", "wolves"],
  );
});

test("an all-solo table writes side: null, because teams.ts owns that rule", () => {
  // The one arrangement where `side` and `factionId` disagree, and they are
  // supposed to: with every faction holding exactly one player there is no team
  // structure, and "null means no team structure" has to stay literally true.
  const def = sdTitleDef("Salem");
  const order: SdFactionEntry[] = [
    { factionId: "jester", memberIds: ["p0"] },
    { factionId: "serialkiller", memberIds: ["p1"] },
  ];
  const lines = sdPlacements(order, def, null);
  assert.deepEqual(lines.map((l) => l.side), [null, null]);
  // The pack's own record still knows exactly what everybody was.
  assert.deepEqual(lines.map((l) => l.factionId), ["jester", "serialkiller"]);
  assert.deepEqual(sdSidesFromOrder(order).map((s) => s.id), ["jester", "serialkiller"]);
});

test("a result is validated against this session and this title", () => {
  const def = sdTitleDef("Werewolf");
  const state = newSdState({ roster: players(5) });
  const ok: SdFactionEntry[] = [
    { factionId: "wolves", memberIds: ["p0"] },
    { factionId: "village", memberIds: ["p1", "p2"] },
  ];
  assert.equal(validateSdResult(ok, state, def), null);
  assert.equal(
    validateSdResult([{ factionId: "fascists", memberIds: ["p0"] }, ok[1]!], state, def),
    "That faction is not in this game",
  );
  assert.equal(
    validateSdResult([{ factionId: "wolves", memberIds: ["nobody"] }, ok[1]!], state, def),
    "Somebody in the result is not in this session",
  );
  assert.equal(validateSdResult([ok[0]!], state, def), "A result needs at least two factions");
  // Structure is the PRIMITIVE's answer, so the screen and the server cannot
  // disagree about what a valid arrangement is.
  assert.equal(
    validateSdResult(
      [{ factionId: "wolves", memberIds: ["p0"] }, { factionId: "village", memberIds: ["p0", "p1"] }],
      state,
      def,
    ),
    "A player can only be on one side",
  );
  assert.equal(
    validateSdResult(
      [
        { factionId: "wolves", memberIds: ["p0"] },
        { factionId: "village", memberIds: ["p1", "p2"] },
        { factionId: "tanner", memberIds: [] },
      ],
      state,
      def,
    ),
    "Every side needs at least one player",
  );
  // And the size rule is `validateFfaSize` with this pack's cap, so a result
  // that does not add up to a game says so in the words every other pack uses.
  assert.equal(
    validateSdResult(
      [{ factionId: "wolves", memberIds: ["p0"] }, { factionId: "village", memberIds: [] }],
      state,
      def,
    ),
    "Need at least 2 players in a game",
  );
});

test("somebody can sit a game out without breaking the result", () => {
  // A crew of eight plays a six-hander while two get drinks. The app records
  // what the night did rather than refereeing who has to be at the table.
  const def = sdTitleDef("Werewolf");
  const state = newSdState({ roster: players(8) });
  const order: SdFactionEntry[] = [
    { factionId: "wolves", memberIds: ["p0"] },
    { factionId: "village", memberIds: ["p1", "p2", "p3", "p4"] },
  ];
  assert.equal(validateSdResult(order, state, def), null);
  assert.equal(sdPlacements(order, def, null).length, 5);
});

// ---------- recording, and what reaches the ledger ----------

test("recording attaches the deal's roles, clears the table, and snapshots the factions", () => {
  const def = sdTitleDef("Werewolf");
  const state = newSdState({ roster: players(5) });
  state.nowPlaying = "Werewolf";
  state.deal = {
    dealNo: 1,
    title: "Werewolf",
    at: "2026-08-10T20:00:00.000Z",
    composition: [{ roleId: "villager", count: 4 }, { roleId: "werewolf", count: 1 }],
  };
  const roles = { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager", p4: "villager" };
  const game = recordSdGame(
    state,
    "Werewolf",
    [
      { factionId: "wolves", memberIds: ["p0"] },
      { factionId: "village", memberIds: ["p1", "p2", "p3", "p4"] },
    ],
    def,
    roles,
    "2026-08-10T20:40:00.000Z",
  );

  assert.equal(game.idx, 0);
  assert.equal(game.dealt, true);
  assert.equal(game.lines.find((l) => l.playerId === "p0")!.roleId, "werewolf");
  assert.deepEqual(game.factions.map((f) => [f.name, f.placement]), [
    ["Werewolves", 1],
    ["Village", 2],
  ]);
  // The game is over, so nothing is on the table and nothing is dealt. Leaving
  // the summary up would have the screen announce a setup nobody is playing.
  assert.equal(state.nowPlaying, null);
  assert.equal(state.deal, null);
});

test("a night moderated on paper still records the faction, which is the headline stat", () => {
  const def = sdTitleDef("Mafia");
  const state = newSdState({ roster: players(5) });
  const game = recordSdGame(
    state,
    "Mafia",
    [
      { factionId: "town", memberIds: ["p1", "p2", "p3"] },
      { factionId: "mafia", memberIds: ["p0", "p4"] },
    ],
    def,
    null,
    "2026-08-10T21:00:00.000Z",
  );
  assert.equal(game.dealt, false);
  for (const l of game.lines) assert.equal(l.roleId, null);
  assert.deepEqual(sdGameLines(game).map((l) => l.meta.faction), ["town", "town", "town", "mafia", "mafia"]);
});

test("SURVIVAL AND FIRST VOTED OUT ARE ABSENT, NEVER ZERO, and nothing can type them in", () => {
  // The live moderator board is opt-in and off by default, and roulette's
  // max-consecutive-winning-spins settled what that costs: a stat only the
  // tracker can produce is null when the tracker was off. A `false` here would
  // claim everybody died, and a `true` would claim everybody lived.
  //
  // The type makes the smuggling case unwriteable at compile time, so what is
  // asserted is the runtime shape: whatever a caller hands the result path,
  // these two come out null, exactly as roulette asserts for bestStreak.
  const def = sdTitleDef("Werewolf");
  const order = [
    { factionId: "wolves", memberIds: ["p0"], survived: true, votedOutFirst: false },
    { factionId: "village", memberIds: ["p1", "p2"], survived: false, votedOutFirst: true },
  ] as unknown as SdFactionEntry[];
  const state = newSdState({ roster: players(3) });
  const game = recordSdGame(state, "Werewolf", order, def, null, "2026-08-10T21:00:00.000Z");
  for (const l of game.lines) {
    assert.equal(l.survived, null);
    assert.equal(l.votedOutFirst, null);
  }
  for (const l of sdGameLines(game)) {
    assert.equal(l.meta.survived, null);
    assert.equal(l.meta.votedOutFirst, null);
  }
});

test("the ledger line carries the faction AND its alignment, and the role once revealed", () => {
  const def = sdTitleDef("Werewolf");
  const state = newSdState({ roster: players(3) });
  const game = recordSdGame(
    state,
    "Werewolf",
    [
      { factionId: "tanner", memberIds: ["p0"] },
      { factionId: "village", memberIds: ["p1", "p2"] },
    ],
    def,
    { p0: "tanner", p1: "villager", p2: "villager" },
    "2026-08-10T21:30:00.000Z",
  );
  assert.deepEqual(sdGameLines(game), [
    {
      playerId: "p0",
      placement: 1,
      isWinner: true,
      side: "tanner",
      meta: { faction: "tanner", alignment: "solo", role: "tanner", survived: null, votedOutFirst: null },
    },
    {
      playerId: "p1",
      placement: 2,
      isWinner: false,
      side: "village",
      meta: { faction: "village", alignment: "town", role: "villager", survived: null, votedOutFirst: null },
    },
    {
      playerId: "p2",
      placement: 2,
      isWinner: false,
      side: "village",
      meta: { faction: "village", alignment: "town", role: "villager", survived: null, votedOutFirst: null },
    },
  ]);
});

// ---------- the night so far ----------

test("the night summary splits wins by alignment, which is the headline stat", () => {
  const def = sdTitleDef("Werewolf");
  const state = newSdState({ roster: players(5) });
  const at = "2026-08-10T22:00:00.000Z";
  // p0 is the wolf and wins; then p0 is a villager and the village wins.
  recordSdGame(
    state,
    "Werewolf",
    [
      { factionId: "wolves", memberIds: ["p0"] },
      { factionId: "village", memberIds: ["p1", "p2", "p3", "p4"] },
    ],
    def,
    null,
    at,
  );
  recordSdGame(
    state,
    "Werewolf",
    [
      { factionId: "village", memberIds: ["p0", "p1", "p2", "p3"] },
      { factionId: "wolves", memberIds: ["p4"] },
    ],
    def,
    null,
    at,
  );

  const s = summarizeSdNight(state);
  const p0 = s.players.find((p) => p.playerId === "p0")!;
  assert.deepEqual(
    [p0.games, p0.wins, p0.townGames, p0.townWins, p0.evilGames, p0.evilWins],
    [2, 2, 1, 1, 1, 1],
  );
  const p4 = s.players.find((p) => p.playerId === "p4")!;
  assert.deepEqual([p4.games, p4.wins, p4.townGames, p4.townWins, p4.evilGames, p4.evilWins], [2, 0, 1, 0, 1, 0]);
  assert.deepEqual(s.byAlignment, [
    { alignment: "town", games: 8, wins: 4 },
    { alignment: "evil", games: 2, wins: 1 },
  ]);
  assert.deepEqual(s.titles, [{ title: "Werewolf", games: 2 }]);
  assert.equal(s.last?.factions[0]?.name, "Village");
});

test("a summary of nothing is empty rather than zeroed", () => {
  const s = summarizeSdNight(newSdState({ roster: players(5) }));
  assert.deepEqual(s.players, []);
  assert.deepEqual(s.titles, []);
  assert.deepEqual(s.byAlignment, []);
  assert.equal(s.last, null);
});

// ---------- the live moderator board ----------

const NIGHT = "2026-08-10T20:00:00.000Z";

/** A session with the board on and a game dealt, which is the live shape. */
function boardNight(n = 5): SdSessionState {
  const state = newSdState({ roster: players(n) });
  state.nowPlaying = "Werewolf";
  state.boardEnabled = true;
  state.board = newSdBoard(state.roster, NIGHT);
  return state;
}

test("a fresh board opens on NIGHT 1 with everybody alive", () => {
  const b = newSdBoard(players(7), NIGHT);
  assert.equal(b.day, 1);
  assert.equal(b.phase, "night");
  assert.equal(sdAliveCount(b), 7);
  assert.deepEqual(b.outOrder, []);
  assert.ok(b.players.every((p) => p.alive && p.out === null && p.revealedRoleId === null));
});

test("the phase runs Night 1, Day 1, Night 2, Day 2", () => {
  // The number advances on DAY TO NIGHT, which reads backwards and is right at
  // a table: a game opens on night one, and the day that follows is day one
  // because it is the day that night produced.
  const b = newSdBoard(players(5), NIGHT);
  const seen: string[] = [`${b.phase} ${b.day}`];
  for (let i = 0; i < 3; i++) seen.push(`${sdAdvancePhase(b).phase} ${b.day}`);
  assert.deepEqual(seen, ["night 1", "day 1", "night 2", "day 2"]);
});

test("going out records how and when, in the order it happened", () => {
  const b = newSdBoard(players(5), NIGHT);
  assert.equal(sdSetOut(b, "p3", "night"), null);
  sdAdvancePhase(b); // day 1
  assert.equal(sdSetOut(b, "p1", "voted"), null);

  const p3 = b.players.find((p) => p.playerId === "p3")!;
  assert.deepEqual([p3.alive, p3.out, p3.outDay], [false, "night", 1]);
  const p1 = b.players.find((p) => p.playerId === "p1")!;
  assert.deepEqual([p1.alive, p1.out, p1.outDay], [false, "voted", 1]);
  assert.deepEqual(b.outOrder, ["p3", "p1"]);
  assert.equal(sdAliveCount(b), 3);
  assert.equal(sdSetOut(b, "nobody", "voted"), "That player is not on this board");
});

test("A MIS-TAP IS SURVIVABLE, but a REVEAL IS ONE WAY", () => {
  // The board is tapped by somebody moderating a game at the same time, so
  // bringing a player back has to work. Un-revealing does not: the room has
  // already read it off the big screen, and a screen that took it back would be
  // telling the table something untrue.
  const b = newSdBoard(players(5), NIGHT);
  sdSetOut(b, "p2", "voted", "werewolf");
  assert.equal(b.players.find((p) => p.playerId === "p2")!.revealedRoleId, "werewolf");

  assert.equal(sdSetOut(b, "p2", null), null);
  const p2 = b.players.find((p) => p.playerId === "p2")!;
  assert.deepEqual([p2.alive, p2.out, p2.outDay], [true, null, null]);
  assert.deepEqual(b.outOrder, []);
  assert.equal(p2.revealedRoleId, "werewolf", "a reveal must survive being brought back");
});

test("FIRST VOTED OUT IS LITERAL: a night kill does not take it", () => {
  // The stat is called first VOTED out and it is the one a crew argues about.
  // Somebody killed on night one was not voted for by anybody.
  const b = newSdBoard(players(5), NIGHT);
  sdSetOut(b, "p0", "night");
  sdSetOut(b, "p4", "voted");
  sdSetOut(b, "p1", "voted");
  const o = sdBoardOutcomes(b);
  assert.equal(o.p0!.votedOutFirst, false, "a night kill is not a vote");
  assert.equal(o.p4!.votedOutFirst, true);
  assert.equal(o.p1!.votedOutFirst, false);
  assert.deepEqual(
    Object.entries(o).map(([id, v]) => [id, v.survived]),
    [["p0", false], ["p1", false], ["p2", true], ["p3", true], ["p4", false]],
  );
});

test("a game where nobody was voted out gives it to nobody, and false is a real answer", () => {
  const b = newSdBoard(players(5), NIGHT);
  sdSetOut(b, "p0", "night");
  const o = sdBoardOutcomes(b);
  // The board was ON, so "nobody was voted out" is known rather than missing.
  assert.ok(Object.values(o).every((v) => v.votedOutFirst === false));
});

test("THE BOARD IS THE ONLY SOURCE of survived and first voted out", () => {
  const def = sdTitleDef("Werewolf");
  const state = boardNight(5);
  sdSetOut(state.board!, "p4", "voted", "villager");
  sdSetOut(state.board!, "p3", "night");

  const game = recordSdGame(
    state,
    "Werewolf",
    [
      { factionId: "wolves", memberIds: ["p0"] },
      { factionId: "village", memberIds: ["p1", "p2", "p3", "p4"] },
    ],
    def,
    null,
    NIGHT,
  );
  const by = new Map(game.lines.map((l) => [l.playerId, l]));
  assert.deepEqual([by.get("p0")!.survived, by.get("p0")!.votedOutFirst], [true, false]);
  assert.deepEqual([by.get("p4")!.survived, by.get("p4")!.votedOutFirst], [false, true]);
  assert.deepEqual([by.get("p3")!.survived, by.get("p3")!.votedOutFirst], [false, false]);
  // The day count reached rides along, and is null when the board was off.
  assert.equal(game.days, 1);
  // Recording clears the board: its outcomes are already baked into the lines,
  // and leaving it up would have the TV showing a table of dead people from a
  // game nobody is playing.
  assert.equal(state.board, null);
  assert.equal(state.boardEnabled, true, "the host's preference outlives the game");
});

test("TURNING THE BOARD ON PARTWAY THROUGH INVENTS NO HISTORY", () => {
  // 2.1, direction one. A night that started on paper and picks the board up at
  // game three gets a board that opens at Night 1 with everybody alive, and the
  // games already recorded keep their nulls.
  const def = sdTitleDef("Werewolf");
  const state = newSdState({ roster: players(5) });
  const paper = recordSdGame(
    state,
    "Werewolf",
    [
      { factionId: "wolves", memberIds: ["p0"] },
      { factionId: "village", memberIds: ["p1", "p2"] },
    ],
    def,
    null,
    NIGHT,
  );
  assert.ok(paper.lines.every((l) => l.survived === null && l.votedOutFirst === null));
  assert.equal(paper.days, null);

  state.boardEnabled = true;
  state.board = newSdBoard(state.roster, NIGHT);
  assert.equal(state.board.day, 1);
  assert.equal(sdAliveCount(state.board), 5);
  // And the game already in the log is untouched by the flip.
  assert.ok(state.games[0]!.lines.every((l) => l.survived === null));
});

test("TURNING THE BOARD OFF DISCARDS NOTHING ALREADY RECORDED", () => {
  // 2.1, direction two. The flip clears the live board and leaves every
  // finished game exactly as it was, because the outcomes were baked onto the
  // lines at the moment each game was recorded.
  const def = sdTitleDef("Werewolf");
  const state = boardNight(5);
  sdSetOut(state.board!, "p2", "voted");
  recordSdGame(
    state,
    "Werewolf",
    [
      { factionId: "wolves", memberIds: ["p0"] },
      { factionId: "village", memberIds: ["p1", "p2"] },
    ],
    def,
    null,
    NIGHT,
  );
  const before = JSON.stringify(state.games);

  state.boardEnabled = false;
  state.board = null;
  assert.equal(JSON.stringify(state.games), before, "a recorded game must not move when the board goes off");
  assert.equal(state.games[0]!.lines.find((l) => l.playerId === "p2")!.votedOutFirst, true);

  // And the NEXT game, played with the board off, is null again rather than
  // inheriting the last one's answers.
  const next = recordSdGame(
    state,
    "Werewolf",
    [
      { factionId: "village", memberIds: ["p1", "p2"] },
      { factionId: "wolves", memberIds: ["p0"] },
    ],
    def,
    null,
    NIGHT,
  );
  assert.ok(next.lines.every((l) => l.survived === null && l.votedOutFirst === null));
});

test("a part A session row loads with a board-shaped hole filled in", () => {
  // Part A shipped without a board, so every row already in the database lacks
  // these three fields. The failure without this is silent rather than loud.
  const legacy = {
    sessionKey: "abc",
    openScoring: false,
    nowPlaying: null,
    roster: players(3),
    deal: null,
    games: [{ idx: 0, title: "Werewolf", lines: [], factions: [], dealt: false, at: NIGHT }],
  } as unknown as SdSessionState;
  const up = normalizeSdState(legacy);
  assert.equal(up.boardEnabled, false);
  assert.equal(up.board, null);
  assert.equal(up.games[0]!.days, null);
  // And a current state passes through unchanged in every field that matters.
  const now = boardNight(4);
  assert.deepEqual(normalizeSdState(now), now);
});

// ---------- the TV projection ----------

test("the TV projection carries the board, the setup counts and the standings", () => {
  const state = boardNight(5);
  state.deal = {
    dealNo: 1,
    title: "Werewolf",
    at: NIGHT,
    composition: [{ roleId: "villager", count: 4 }, { roleId: "werewolf", count: 1 }],
  };
  sdSetOut(state.board!, "p2", "voted", "villager");
  sdAdvancePhase(state.board!);

  const tv = sdTvView(state);
  assert.equal(tv.title, "Werewolf");
  assert.deepEqual(tv.composition, [{ name: "Villager", count: 4 }, { name: "Werewolf", count: 1 }]);
  assert.equal(tv.board!.day, 1);
  assert.equal(tv.board!.phase, "day");
  assert.equal(tv.board!.alive, 4);
  assert.equal(tv.board!.outTotal, 1);
  assert.equal(tv.board!.players.length, 5);
  const p2 = tv.board!.players.find((p) => p.playerId === "p2")!;
  assert.deepEqual([p2.alive, p2.out, p2.revealed, p2.alignment], [false, "voted", "Villager", "town"]);
});

test("the TV projection says NOTHING about a player who has not been revealed", () => {
  // The full scan lives in apps/server/tests/deduction-secrecy.test.ts, which
  // runs the same three probes it runs on the session payload. What is pinned
  // here is the shape: an unrevealed player carries nulls, not a role.
  const state = boardNight(5);
  const tv = sdTvView(state);
  for (const p of tv.board!.players) {
    assert.equal(p.revealed, null);
    assert.equal(p.alignment, null);
  }
  // And the keys are pinned, so a field added to SdTvPlayer is a deliberate act
  // rather than something that slips in behind a spread.
  assert.deepEqual(Object.keys(tv.board!.players[0]!).sort(), [
    "alignment",
    "alive",
    "name",
    "out",
    "outDay",
    "playerId",
    "revealed",
  ]);
});

test("with the board off the TV still has a night to show", () => {
  // Off is a real mode, not a degraded one: the roster, the title and the
  // standings all still reach the screen.
  const state = newSdState({ roster: players(6) });
  state.nowPlaying = "Secret Hitler";
  const tv = sdTvView(state);
  assert.equal(tv.board, null);
  assert.equal(tv.title, "Secret Hitler");
  assert.equal(tv.roster.length, 6);
  assert.equal(tv.composition, null);
});

test("the TV projection holds twenty players, which is this pack's cap", () => {
  // The fit risk is real and it is measured in scripts/tv-fit.mjs at exactly
  // this number. What is asserted here is only that the payload reaches it.
  const state = boardNight(SD_MAX_PLAYERS);
  assert.equal(sdTvView(state).board!.players.length, 20);
});

// ---------- roles that are not on the list ----------

test("the slug strips rather than hyphenates, which is what the shipped ids need", () => {
  // "Serial Killer" is `serialkiller` in the shipped catalogue. A slug that
  // produced `serial-killer` would split that role from itself the first time
  // somebody typed the name.
  assert.equal(sdRoleSlug("Serial Killer"), "serialkiller");
  assert.equal(sdRoleSlug("  witch  "), "witch");
  assert.equal(sdRoleSlug("WITCH"), "witch");
  assert.equal(sdRoleSlug("Cult Leader!"), "cultleader");
  assert.equal(sdRoleSlug("   "), "");
});

test("a typed role that names a CURATED role resolves to the curated id", () => {
  // Werewolf carries this now: Salem's Jester and Serial Killer belonged to
  // Town of Salem and left with it on 2026-08-14.
  const wolf = sdTitleDef("Werewolf");
  assert.deepEqual(canonicalRole("tanner", wolf), { id: "tanner", name: "Tanner", matched: true });
  assert.deepEqual(canonicalRole("  ALPHA werewolf ", wolf), {
    id: "alpha",
    name: "Alpha Werewolf",
    matched: true,
  });
  // Matched by ID too, for a host who types what they saw in a URL.
  assert.equal(canonicalRole("sorcerer", wolf)?.id, "sorcerer");
  const salem = sdTitleDef("Salem");
  assert.deepEqual(canonicalRole("witch constable", salem), {
    id: "witchconstable",
    name: "Witch Constable",
    matched: true,
  });
  // And the three legacy ids, which only the NAME pass can reach.
  assert.equal(canonicalRole("Alpha Werewolf", sdTitleDef("Werewolf"))?.id, "alpha");
  assert.equal(canonicalRole("Minion of Mordred", sdTitleDef("Avalon"))?.id, "minion");
  assert.equal(canonicalRole("Loyal Servant", sdTitleDef("Avalon"))?.id, "servant");

  assert.equal(canonicalRole("", salem), null);
  assert.equal(canonicalRole("   ", salem), null);
});

test("TYPE IT TONIGHT, CURATE IT LATER, AND IT IS THE SAME ROLE IN THE LEDGER", () => {
  // The single most important property in this session. Salem had no Witch, so
  // a host typed one. A later session adds Witch to the catalogue. Those two
  // must be ONE role, not a typed row and a curated row splitting a player's
  // history in half, and there is deliberately no separate namespace like
  // `custom:Witch`, which would be that split dressed as tidiness.
  //
  // Modelled against a catalogue that does NOT have the role, which is exactly
  // what Salem looked like this morning.
  const before: SdTitleDef = {
    ...sdTitleDef("Salem"),
    roles: sdTitleDef("Salem").roles.filter((r) => r.id !== "witch"),
    factions: sdTitleDef("Salem").factions.filter((f) => f.id !== "witch"),
  };
  assert.equal(sdRole(before, "witch"), undefined, "the fixture must not already have the role");

  const typed = canonicalRole("Witch", before)!;
  assert.equal(typed.matched, false, "it is a genuine miss before curation");
  const idWhenTyped = typed.id;

  // And now, against the catalogue as it actually ships today.
  const after = sdTitleDef("Salem");
  const curated = canonicalRole("Witch", after)!;
  assert.equal(curated.matched, true);

  assert.equal(
    idWhenTyped,
    curated.id,
    "a role typed before it was curated must land on the SAME id, or that player's history splits",
  );
  assert.equal(idWhenTyped, "witch");
  // Which is what makes the ledger unify: both nights wrote meta.role "witch".
  assert.equal(sdRole(after, idWhenTyped)?.name, "Witch");
});

test("A TYPED ROLE MUST CARRY A FACTION, because a faction is what gets ranked", () => {
  const salem = sdTitleDef("Salem");
  assert.equal(validateTypedRole(salem, "", null, false), "Name the role");
  assert.equal(validateTypedRole(salem, "Amnesiac", null, false), "Pick which faction this role wins with");
  assert.equal(validateTypedRole(salem, "Amnesiac", "nosuchfaction", false), "That faction is not in this game");
  assert.equal(validateTypedRole(salem, "Amnesiac", "town", false), null);
  // A role that wins alone gets its own faction instead of picking one.
  assert.equal(validateTypedRole(salem, "Amnesiac", null, true), null);
});

test("a typed role joins an existing faction, or brings its own solo one", () => {
  const salem = sdTitleDef("Salem");

  const joined = typedRole(salem, "Amnesiac", "town", false)!;
  assert.deepEqual(joined.role, { id: "amnesiac", name: "Amnesiac", factionId: "town" });
  assert.equal(joined.faction, null, "an existing faction is not re-created");

  const alone = typedRole(salem, "Cult Leader", null, true)!;
  assert.deepEqual(alone.role, { id: "cultleader", name: "Cult Leader", factionId: "cultleader" });
  assert.deepEqual(alone.faction, { id: "cultleader", name: "Cult Leader", alignment: "solo" });

  // Typing a role the title ALREADY has, as a solo, does not mint a second
  // faction over the top of the curated one. `witch` is the interesting case
  // after the 08-14 correction: the role and the faction share an id, and the
  // faction is EVIL rather than solo, so a solo request must not overwrite it.
  const already = typedRole(salem, "Witch", null, true)!;
  assert.equal(already.role.id, "witch");
  assert.equal(already.faction, null, "a curated faction must not be replaced by a minted solo one");
  assert.equal(sdFactionOfRole(salem, already.role.id)?.alignment, "evil");

  assert.equal(typedRole(salem, "", null, true), null);
  assert.equal(typedRole(salem, "Amnesiac", "nosuchfaction", false), null);
});

test("the merged catalogue is ONE merge point, and a typed role cannot shadow a curated one", () => {
  const salem = sdTitleDef("Salem");
  const extraRoles: SdCustomRole[] = [
    { id: "cultleader", name: "Cult Leader", factionId: "cultleader" },
    // A typed role whose id already exists is DROPPED rather than allowed to
    // shadow: the curated entry is the one with the faction the catalogue means.
    { id: "witch", name: "Cunning Woman", factionId: "town" },
  ];
  const extraFactions: SdCustomFaction[] = [{ id: "cultleader", name: "Cult Leader", alignment: "solo" }];
  const merged = sdDefWith(salem, extraRoles, extraFactions);

  assert.equal(sdRole(merged, "cultleader")?.name, "Cult Leader");
  assert.equal(sdFactionOfRole(merged, "cultleader")?.alignment, "solo");
  assert.equal(sdRole(merged, "witch")?.name, "Witch", "a typed role must not shadow a curated one");
  assert.equal(sdFactionOfRole(merged, "witch")?.id, "witch");
  // Every curated role survives the merge.
  assert.equal(merged.roles.length, salem.roles.length + 1);
  assert.equal(merged.factions.length, salem.factions.length + 1);
  // And merging nothing returns the def itself, so the common path allocates nothing.
  assert.equal(sdDefWith(salem), salem);
});

test("a typed role deals, ranks and reaches the ledger like any other", () => {
  const salem = sdTitleDef("Salem");
  const made = typedRole(salem, "Cult Leader", null, true)!;
  const def = sdDefWith(salem, [made.role], [made.faction!]);
  const state = newSdState({ roster: players(5) });

  const composition = [
    { roleId: "townsperson", count: 4 },
    { roleId: "cultleader", count: 1 },
  ];
  assert.equal(validateComposition(def, composition, 5), null);
  const roles = dealRoles(composition, state.roster.map((p) => p.id), seeded(3));
  assert.equal(Object.values(roles).filter((r) => r === "cultleader").length, 1);

  const cultist = Object.keys(roles).find((id) => roles[id] === "cultleader")!;
  assert.equal(factionsFromRoles(def, roles)[cultist], "cultleader");

  state.deal = {
    dealNo: 1,
    title: "Salem",
    at: NIGHT,
    composition,
    extraRoles: [made.role],
    extraFactions: [made.faction!],
  };
  const game = recordSdGame(
    state,
    "Salem",
    [
      { factionId: "cultleader", memberIds: [cultist] },
      { factionId: "town", memberIds: state.roster.map((p) => p.id).filter((id) => id !== cultist) },
    ],
    def,
    roles,
    NIGHT,
  );
  const line = sdGameLines(game).find((l) => l.playerId === cultist)!;
  // The TYPED role reaches meta.role under the id a curated Cult Leader would
  // have, which is the whole point.
  assert.deepEqual(line.meta, {
    faction: "cultleader",
    alignment: "solo",
    role: "cultleader",
    survived: null,
    votedOutFirst: null,
  });
  // And the game keeps the NAME, so a later stats surface can label it.
  assert.deepEqual(game.extraRoles, [{ id: "cultleader", name: "Cult Leader", factionId: "cultleader" }]);
});

test("a session row from before typed roles existed loads with the new fields filled in", () => {
  const legacy = {
    sessionKey: "abc",
    openScoring: false,
    nowPlaying: "Salem",
    roster: players(3),
    boardEnabled: false,
    board: null,
    deal: { dealNo: 1, title: "Salem", at: NIGHT, composition: [{ roleId: "townsperson", count: 3 }] },
    games: [{ idx: 0, title: "Salem", lines: [], factions: [], dealt: false, days: null, at: NIGHT }],
  } as unknown as SdSessionState;
  const up = normalizeSdState(legacy);
  assert.deepEqual(up.deal!.extraRoles, []);
  assert.deepEqual(up.deal!.extraFactions, []);
  assert.deepEqual(up.games[0]!.extraRoles, []);
});

// ---------- shared wins ----------

test("TWO FACTIONS SHARE A WIN AND THE LOSER IS THIRD: 1, 1, 3, never 1, 1, 2", () => {
  // THE WITCH IS THE WORKED EXAMPLE. She survives and wins ALONGSIDE whoever
  // kills the town, so two factions take placement 1 and the town is THIRD.
  //
  // Two placement rules live in this app and both are correct (teams.ts says so
  // at its head): a TEAM result ranks sides 1..N, so a 2v2 is 1,1,2,2, and a
  // GENUINE TIE uses competition ranking, which leaves the gap. A shared win is
  // a tie between two SIDES, so the gap is right: there was no second place,
  // there were two firsts. Closing it to 1,1,2 would quietly rewrite what a
  // placement means in every row the other rule already wrote.
  // WEREWOLF carries the three-faction example: Salem 1692 has exactly two
  // factions, and the Tanner is the app's other worked shared-win case.
  const def = sdTitleDef("Werewolf");
  const order: SdFactionEntry[] = [
    { factionId: "wolves", memberIds: ["p0", "p1"] },
    { factionId: "tanner", memberIds: ["p2"], tiedWithAbove: true },
    { factionId: "village", memberIds: ["p3", "p4", "p5"] },
  ];
  const lines = sdPlacements(order, def, null);

  assert.deepEqual(lines.map((l) => l.placement), [1, 1, 1, 3, 3, 3]);
  assert.deepEqual(lines.map((l) => l.isWinner), [true, true, true, false, false, false]);
  // The Tanner is one player on his own faction and still carries a REAL side
  // id, because the wolves and the village both hold several: teams.ts's rule.
  assert.deepEqual(lines.map((l) => l.side), ["wolves", "wolves", "tanner", "village", "village", "village"]);
  assert.equal(lines.find((l) => l.playerId === "p2")!.alignment, "solo");
});

test("a shared win reaches the LEDGER as two winning factions and a third placement", () => {
  const def = sdTitleDef("Werewolf");
  const state = newSdState({ roster: players(6) });
  const game = recordSdGame(
    state,
    "Werewolf",
    [
      { factionId: "wolves", memberIds: ["p0", "p1"] },
      { factionId: "tanner", memberIds: ["p2"], tiedWithAbove: true },
      { factionId: "village", memberIds: ["p3", "p4", "p5"] },
    ],
    def,
    { p0: "werewolf", p1: "alpha", p2: "tanner", p3: "villager", p4: "seer", p5: "doctor" },
    NIGHT,
  );

  const ledger = sdGameLines(game);
  assert.deepEqual(ledger.map((l) => [l.placement, l.isWinner]), [
    [1, true], [1, true], [1, true], [3, false], [3, false], [3, false],
  ]);
  assert.equal(ledger.find((l) => l.playerId === "p2")!.meta.role, "tanner");
  // The game's own snapshot agrees: two factions at 1, one at 3.
  assert.deepEqual(
    game.factions.map((f) => [f.id, f.placement]),
    [["wolves", 1], ["tanner", 1], ["village", 3]],
  );
});

test("a shared win counts as a win for everybody on both factions in the night summary", () => {
  const def = sdTitleDef("Werewolf");
  const state = newSdState({ roster: players(6) });
  recordSdGame(
    state,
    "Werewolf",
    [
      { factionId: "wolves", memberIds: ["p0", "p1"] },
      { factionId: "tanner", memberIds: ["p2"], tiedWithAbove: true },
      { factionId: "village", memberIds: ["p3", "p4", "p5"] },
    ],
    def,
    null,
    NIGHT,
  );
  const s = summarizeSdNight(state);
  const by = new Map(s.players.map((p) => [p.playerId, p]));
  assert.deepEqual([by.get("p0")!.wins, by.get("p0")!.evilWins], [1, 1]);
  assert.deepEqual([by.get("p2")!.wins, by.get("p2")!.soloWins], [1, 1]);
  assert.equal(by.get("p3")!.wins, 0);
  // Both alignments show a win; the town shows three losses.
  assert.deepEqual(s.byAlignment, [
    { alignment: "town", games: 3, wins: 0 },
    { alignment: "evil", games: 2, wins: 2 },
    { alignment: "solo", games: 1, wins: 1 },
  ]);
  // And the last-game panel puts both winners at the top.
  assert.deepEqual(s.last!.factions.map((f) => [f.name, f.placement]), [
    ["Werewolves", 1], ["Tanner", 1], ["Village", 3],
  ]);
});

test("three factions sharing one win is 1, 1, 1, 4", () => {
  // The rule generalises rather than being special-cased at two, which is what
  // competition ranking means: the next untied side takes its own 1-based
  // position.
  const def = sdDefWith(sdTitleDef("Werewolf"), [], [
    { id: "cultleader", name: "Cult Leader", alignment: "solo" },
  ]);
  const order: SdFactionEntry[] = [
    { factionId: "wolves", memberIds: ["p0"] },
    { factionId: "tanner", memberIds: ["p1"], tiedWithAbove: true },
    { factionId: "cultleader", memberIds: ["p2"], tiedWithAbove: true },
    { factionId: "village", memberIds: ["p3", "p4"] },
  ];
  assert.deepEqual(sdPlacements(order, def, null).map((l) => l.placement), [1, 1, 1, 4, 4]);
});

test("a tie flag on the FIRST faction is ignored rather than being an error", () => {
  // Reachable from a client that sent an order starting with the flag set, and
  // there is nothing above the first row to be level with.
  const def = sdTitleDef("Salem");
  const order: SdFactionEntry[] = [
    { factionId: "witch", memberIds: ["p0"], tiedWithAbove: true },
    { factionId: "town", memberIds: ["p1", "p2"] },
  ];
  assert.equal(validateSdResult(order, newSdState({ roster: players(3) }), def), null);
  assert.deepEqual(sdPlacements(order, def, null).map((l) => l.placement), [1, 2, 2]);
});

// ---------- loyalties that change mid-game ----------

test("A PLAYER DEALT INTO ONE FACTION CAN BE RECORDED IN ANOTHER", () => {
  // SALEM 1692'S CONSPIRACY shifts loyalties mid-game: a townsperson who gains
  // a Witch card joins the Witches and stays a witch for the rest of the game.
  // The deal happens at the start, so a player who flips is dealt one faction
  // and finishes in another.
  //
  // THE MODEL ALREADY RECORDS THAT CORRECTLY, and this test is what keeps it
  // that way: the record path takes `memberIds` FROM THE CALLER rather than
  // deriving them from the deal, so the deal only PREFILLS the form and the
  // host moves the flipped player before recording.
  const def = sdTitleDef("Salem");
  const state = newSdState({ roster: players(6) });
  const dealt = { p0: "witch", p1: "townsperson", p2: "townsperson", p3: "townsperson", p4: "townsperson", p5: "constable" };
  state.deal = {
    dealNo: 1,
    title: "Salem",
    at: NIGHT,
    composition: [{ roleId: "townsperson", count: 4 }, { roleId: "witch", count: 1 }, { roleId: "constable", count: 1 }],
    extraRoles: [],
    extraFactions: [],
  };
  // What the deal implies, which is what the form opens on.
  assert.equal(factionsFromRoles(def, dealt).p3, "town");

  // p3 flipped. The host moves them onto the Witches and records.
  const game = recordSdGame(
    state,
    "Salem",
    [
      { factionId: "witch", memberIds: ["p0", "p3"] },
      { factionId: "town", memberIds: ["p1", "p2", "p4", "p5"] },
    ],
    def,
    dealt,
    NIGHT,
  );

  const flipped = game.lines.find((l) => l.playerId === "p3")!;
  assert.equal(flipped.factionId, "witch", "the RECORDED faction wins, not the dealt one");
  assert.equal(flipped.alignment, "evil");
  assert.equal(flipped.side, "witch");
  assert.equal(flipped.isWinner, true);
  // AND THE DEALT ROLE IS STILL TRUE: they were dealt a Townsperson and became
  // a witch, so `meta.role` says townsperson and `meta.faction` says witch,
  // which is exactly what happened rather than a contradiction.
  assert.equal(flipped.roleId, "townsperson");
  assert.deepEqual(sdGameLines(game).find((l) => l.playerId === "p3")!.meta, {
    faction: "witch",
    alignment: "evil",
    role: "townsperson",
    survived: null,
    votedOutFirst: null,
  });
  // Nobody else moved.
  assert.equal(game.lines.find((l) => l.playerId === "p1")!.factionId, "town");
});

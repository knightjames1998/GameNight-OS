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
  newSdState,
  recordSdGame,
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
  validateComposition,
  validateSdResult,
  SD_DEFAULT_DEF,
  SD_MAX_PLAYERS,
  SD_TITLES,
  SD_TITLE_DEFS,
  SESSION_PACKS,
  type SdFactionEntry,
  type SdPlayer,
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

test("every catalogue is internally consistent", () => {
  for (const def of [...SD_TITLE_DEFS, SD_DEFAULT_DEF]) {
    const factionIds = new Set(def.factions.map((f) => f.id));
    assert.equal(factionIds.size, def.factions.length, `${def.title}: duplicate faction id`);
    const roleIds = new Set(def.roles.map((r) => r.id));
    assert.equal(roleIds.size, def.roles.length, `${def.title}: duplicate role id`);
    for (const r of def.roles) {
      assert.ok(factionIds.has(r.factionId), `${def.title}: ${r.id} points at no faction`);
    }
    // The baselines are what a suggested composition deals, so a typo in one
    // would produce a deal with a role nobody can look up.
    assert.ok(sdRole(def, def.baselineTown), `${def.title}: baselineTown`);
    assert.ok(sdRole(def, def.baselineEvil), `${def.title}: baselineEvil`);
    assert.equal(sdFactionOfRole(def, def.baselineTown)?.alignment, "town", `${def.title}: town baseline`);
    assert.equal(sdFactionOfRole(def, def.baselineEvil)?.alignment, "evil", `${def.title}: evil baseline`);
    // Two factions minimum, or there is nobody to find.
    assert.ok(def.factions.length >= 2, `${def.title}: needs at least two factions`);
  }
});

test("a title is matched case-folded, and anything else opens the default shape", () => {
  assert.equal(sdTitleDef("Werewolf").title, "Werewolf");
  assert.equal(sdTitleDef("werewolf").title, "Werewolf");
  assert.equal(sdTitleDef("  secret hitler  ").title, "Secret Hitler");
  // A free-typed title has no catalogue, because there is nothing to look it
  // up in. Same call the title-night layer makes about partnership defaults.
  assert.equal(sdTitleDef("Ultimate Werewolf Deluxe"), SD_DEFAULT_DEF);
  assert.equal(sdTitleDef(null), SD_DEFAULT_DEF);
  assert.equal(sdTitleDef(""), SD_DEFAULT_DEF);
});

test("THIRD-PARTY SOLO ROLES ARE IN THE CATALOGUE, not deferred", () => {
  const wolf = sdTitleDef("Werewolf");
  assert.equal(sdFaction(wolf, "tanner")?.alignment, "solo");
  const salem = sdTitleDef("Salem");
  assert.equal(sdFaction(salem, "jester")?.alignment, "solo");
  assert.equal(sdFaction(salem, "serialkiller")?.alignment, "solo");
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

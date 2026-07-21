// Mario Kart pack: the racer roster. The live-session logic itself is the
// same pure engine the Smash pack uses (roster, per-game placements, night
// summary) — Mario Kart's "general tracking" is FFA races: pick a racer,
// log the finishing order (or just the winner). Only the character list and
// the wording differ, so this file carries just the roster; everything else
// is reused from ./smash.ts via the shared session helpers.
//
// Mario Kart 8 Deluxe roster (base + Booster Course Pass additions),
// character-select order-ish. Weight/variant duplicates (e.g. the metal
// skins) are kept because groups genuinely main them.
export const MARIO_KART_RACERS: string[] = [
  "Mario", "Luigi", "Peach", "Daisy", "Rosalina", "Tanooki Mario", "Cat Peach",
  "Yoshi", "Toad", "Koopa Troopa", "Shy Guy", "Lakitu", "Toadette", "King Boo",
  "Baby Mario", "Baby Luigi", "Baby Peach", "Baby Daisy", "Baby Rosalina",
  "Metal Mario", "Pink Gold Peach", "Wario", "Waluigi", "Donkey Kong", "Bowser",
  "Dry Bones", "Bowser Jr.", "Dry Bowser", "Lemmy", "Larry", "Wendy", "Ludwig",
  "Iggy", "Roy", "Morton", "Inkling Girl", "Inkling Boy", "Link", "Villager",
  "Isabelle", "Birdo", "Petey Piranha", "Wiggler", "Kamek", "Pauline",
  "Diddy Kong", "Funky Kong", "Peachette", "Mii",
];

const RACER_SET = new Set(MARIO_KART_RACERS);
export function isRacer(name: unknown): name is string {
  return typeof name === "string" && RACER_SET.has(name);
}

// ---------- Which Mario Kart title ----------
// The host picks a title on the pack's front page; it scopes the racer
// picker and the random pool to that game (standing rule: randomize within
// the game being played). Stats stay unified across titles by racer name.
// Newest-and-widest MK8 Deluxe is the default. Rosters use MK8 Deluxe
// spellings where a racer is shared so lifetime stats line up. Title-only
// racers (e.g. Paratroopa, Dry Bowser, Funky Kong) keep their own name.
import type { GameTitle } from "./smash.js";
export type { GameTitle } from "./smash.js";

// ---------- Mario Kart session ----------
// Mario Kart is its OWN pack (never merged with Smash), but it reuses the
// shared primitives: the Smash session shape and factory, the KOTH rotation
// (kothAdvance), and the best-of series engine (./series). Mk adds two
// formats of its own on top: Free Play (single races) and Grand Prix (a cup
// of N races scored on cumulative Mario Kart points). Grand Prix records each
// race as its own ledger match (game-as-unit) with the cup id on
// matches.label; the cup standings are derived on read, never a ledger row.
import {
  newSmashState,
  type SmashSessionState,
  type SmashPlayer,
  type SmashMode,
  type SmashAssignment,
  type SmashResultDetail,
} from "./smash.js";
import type { SeriesBestOf } from "./series.js";

export type MkFormat = "free" | "grandprix" | "bestof" | "koth";

// Grand Prix groups races into cups of raceCount, DERIVED from the games log
// by chunking: race i belongs to cup floor(i / raceCount) + 1, so cups
// advance automatically and undo just recomputes (no stored cup pointer to
// drift). raceCount is the only stored setting.
export interface MkGrandPrix {
  raceCount: number;
}

/** 1-based cup number a race at games index `idx` belongs to. */
export function cupNoForRace(idx: number, raceCount: number): number {
  return Math.floor(idx / raceCount) + 1;
}

// MK's state is the Smash session shape with MK's own format union and the
// Grand Prix bookkeeping. A distinct type so the two packs never entangle.
export interface MkSessionState extends Omit<SmashSessionState, "format"> {
  format: MkFormat;
  grandPrix: MkGrandPrix;
}

export function newMkKartState(opts: {
  format: MkFormat;
  titleId?: string | null;
  assignment: SmashAssignment;
  resultDetail: SmashResultDetail;
  roster: SmashPlayer[];
  bestOf?: SeriesBestOf;
  raceCount?: number;
}): MkSessionState {
  const mode: SmashMode = opts.format === "koth" ? "koth" : "ffa";
  const base = newSmashState({
    mode,
    titleId: opts.titleId,
    assignment: opts.assignment,
    resultDetail: opts.resultDetail,
    roster: opts.roster,
    bestOf: opts.bestOf,
  });
  const { format: _drop, ...rest } = base;
  const raceCount = Math.min(Math.max(Math.floor(Number(opts.raceCount) || 4), 2), 12);
  return { ...rest, format: opts.format, grandPrix: { raceCount } };
}

// Mario Kart 8 points table (positions 1..12). Fewer racers just use the top
// of the table, which keeps the spread meaningful for a friend group.
const MK_POINTS = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
export function mkPoints(placement: number): number {
  return placement >= 1 && placement <= MK_POINTS.length ? MK_POINTS[placement - 1]! : 0;
}

export interface MkCupStanding {
  playerId: string;
  name: string;
  points: number;
  wins: number;
  races: number;
}

/**
 * Standings for the CURRENT cup, derived from the games log by chunking. On a
 * cup boundary (races is an exact multiple of raceCount) the just-completed
 * cup is shown as complete; otherwise the in-progress partial cup is shown.
 * Never a ledger row.
 */
export function cupStandings(state: MkSessionState): {
  standings: MkCupStanding[];
  cupNo: number;
  racesDone: number;
  raceCount: number;
  complete: boolean;
} {
  const rc = state.grandPrix.raceCount;
  const total = state.games.length;
  let cupNo: number;
  let cupStart: number;
  if (total === 0) {
    cupNo = 1;
    cupStart = 0;
  } else if (total % rc === 0) {
    cupNo = total / rc; // the cup that just filled up
    cupStart = total - rc;
  } else {
    cupNo = Math.floor(total / rc) + 1;
    cupStart = Math.floor(total / rc) * rc;
  }
  const cupGames = state.games.slice(cupStart, cupStart + rc);
  const nameOf = new Map(state.roster.map((p) => [p.id, p.name]));
  const acc = new Map<string, MkCupStanding>();
  const ensure = (id: string) => {
    let s = acc.get(id);
    if (!s) {
      s = { playerId: id, name: nameOf.get(id) ?? "?", points: 0, wins: 0, races: 0 };
      acc.set(id, s);
    }
    return s;
  };
  for (const g of cupGames) {
    for (const l of g.lines) {
      const s = ensure(l.playerId);
      s.points += mkPoints(l.placement);
      s.races++;
      if (l.isWinner) s.wins++;
    }
  }
  return {
    standings: [...acc.values()].sort((a, b) => b.points - a.points || b.wins - a.wins),
    cupNo,
    racesDone: cupGames.length,
    raceCount: rc,
    complete: cupGames.length >= rc,
  };
}

export const MARIO_KART_TITLES: GameTitle[] = [
  { id: "mk8dx", name: "Mario Kart 8 Deluxe", roster: MARIO_KART_RACERS },
  {
    id: "mkworld",
    name: "Mario Kart World",
    roster: [
      "Mario", "Luigi", "Peach", "Daisy", "Yoshi", "Donkey Kong", "Bowser", "Bowser Jr.",
      "Koopa Troopa", "Toad", "Toadette", "Lakitu", "King Boo", "Shy Guy", "Wario", "Waluigi",
      "Birdo", "Pauline", "Rosalina", "Baby Mario", "Baby Luigi", "Baby Peach", "Baby Daisy",
      "Baby Rosalina",
    ],
  },
  {
    id: "mkwii",
    name: "Mario Kart Wii",
    roster: [
      "Mario", "Luigi", "Peach", "Daisy", "Rosalina", "Baby Mario", "Baby Luigi", "Baby Peach",
      "Baby Daisy", "Toad", "Toadette", "Koopa Troopa", "Dry Bones", "Bowser", "Bowser Jr.",
      "Wario", "Waluigi", "Donkey Kong", "Diddy Kong", "Yoshi", "Birdo", "King Boo", "Dry Bowser",
      "Funky Kong", "Mii",
    ],
  },
  {
    id: "mkdd",
    name: "Double Dash!!",
    roster: [
      "Mario", "Luigi", "Peach", "Daisy", "Yoshi", "Birdo", "Baby Mario", "Baby Luigi", "Toad",
      "Toadette", "Koopa Troopa", "Paratroopa", "Donkey Kong", "Diddy Kong", "Bowser", "Bowser Jr.",
      "Wario", "Waluigi", "Petey Piranha", "King Boo",
    ],
  },
  {
    id: "mk64",
    name: "Mario Kart 64",
    roster: ["Mario", "Luigi", "Peach", "Toad", "Yoshi", "Donkey Kong", "Wario", "Bowser"],
  },
];

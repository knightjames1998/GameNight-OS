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

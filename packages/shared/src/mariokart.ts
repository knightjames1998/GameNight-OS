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

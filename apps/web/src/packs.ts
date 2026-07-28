// The pack catalogue: what games exist, what formats each offers, and how each
// one is labelled in the picker.
//
// This list was written TWICE, as `quickGames` in Home.tsx and `eventGames()`
// in EventPage.tsx: same games, same formats, same emoji, same cabClass, same
// sublines, differing only in where each format sends you and in two genuinely
// contextual bits. Adding a pack meant remembering to add it in both places,
// and the failure mode is quiet: the pack simply never appears on one of the
// two screens, which is exactly the sort of thing nobody notices until a game
// night.
//
// What the CALLER supplies, because it is genuinely different:
//   - the destination for each format (quick play starts a session with no
//     event; the event page navigates with ?event=<id>),
//   - Beerio's subline, which on the event page becomes "live now, rejoin" or
//     "live now, watch" when a room is already going,
//   - the Tournament pack's formats, which on the event page are gated on
//     whether a bracket exists, whether you can host, and whether two people
//     have RSVP'd yes.
//
// Those three stay parameters rather than being folded in, because they depend
// on state this module has no business knowing about. Everything else is one
// list.

import type { PickerFormat, PickerGame } from "./GamePicker";

/**
 * Every pack the picker knows about. A union rather than `string` so a caller
 * switching on the key gets narrowing (and a compile error for a pack it
 * forgot) instead of having to trust itself.
 */
export type PackKey = "mariokart" | "smash" | "marioparty" | "pingpong" | "tournament";

/** The four packs that run a server-side session; Tournament and Beerio do not. */
export type SessionPackKey = Exclude<PackKey, "tournament">;

/** A format as the catalogue describes it, before a destination is attached. */
export interface PackFormatSpec {
  key: string;
  label: string;
  sub: string;
}

/** A pack as the catalogue describes it. */
export interface PackSpec {
  key: PackKey;
  name: string;
  emoji: string;
  cabClass: string;
  /** Empty for Tournament, whose formats are always supplied by the caller. */
  formats: PackFormatSpec[];
}

export const PACKS: PackSpec[] = [
  {
    key: "mariokart",
    name: "Mario Kart",
    emoji: "🏎️",
    cabClass: "gn-cab--mk",
    formats: [
      // Beerio is a separate pack that lives under the Mario Kart tile,
      // because that is where someone looks for it.
      { key: "beerio", label: "🍺 Beerio Kart", sub: "double elim & grand prix" },
      { key: "free", label: "🏁 Free Play", sub: "single races" },
      { key: "grandprix", label: "🏆 Grand Prix", sub: "a cup on points" },
      { key: "bestof", label: "Best Of", sub: "1v1 race sets" },
      { key: "koth", label: "King of the Hill", sub: "winner stays on" },
    ],
  },
  {
    key: "smash",
    name: "Smash Bros",
    emoji: "🥊",
    cabClass: "gn-cab--smash",
    formats: [
      { key: "ffa", label: "Free-for-all", sub: "2–8 players a game" },
      { key: "koth", label: "King of the Hill", sub: "winner stays on" },
      { key: "bestof", label: "Best Of", sub: "1v1 sets, best of 3/5/7" },
    ],
  },
  {
    key: "marioparty",
    name: "Mario Party",
    emoji: "🎲",
    cabClass: "gn-cab--mp",
    formats: [{ key: "board", label: "🎲 Board night", sub: "stars, boards, bonus stars" }],
  },
  {
    key: "pingpong",
    name: "Ping Pong",
    emoji: "🏓",
    cabClass: "gn-cab--pp",
    formats: [
      { key: "free", label: "Free Play", sub: "single games, one tap each" },
      { key: "bestof", label: "Best Of", sub: "3, 5 or 7 game series" },
      { key: "koth", label: "King of the Hill", sub: "winner stays on" },
    ],
  },
  {
    key: "tournament",
    name: "Tournament",
    emoji: "🏆",
    cabClass: "gn-cab--brk",
    formats: [],
  },
];

export interface BuildPickerOptions {
  /** Where a given pack/format goes. Called once per format when building. */
  destination: (packKey: PackKey, formatKey: string) => () => void;
  /** Overrides the Beerio subline; the event page makes it live-aware. */
  beerioSub?: string;
  /** The Tournament pack's formats, always caller-supplied. */
  tournamentFormats: PickerFormat[];
}

/** Turn the catalogue into the picker's shape for one screen. */
export function buildPickerGames(opts: BuildPickerOptions): PickerGame[] {
  return PACKS.map((pack): PickerGame => ({
    key: pack.key,
    name: pack.name,
    emoji: pack.emoji,
    cabClass: pack.cabClass,
    formats:
      pack.key === "tournament"
        ? opts.tournamentFormats
        : pack.formats.map((f) => ({
            key: f.key,
            label: f.label,
            sub: f.key === "beerio" && opts.beerioSub ? opts.beerioSub : f.sub,
            onPick: opts.destination(pack.key, f.key),
          })),
  }));
}

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

import { SESSION_PACKS, type SessionPackKey } from "@gamenight/shared";
import type { PickerFormat, PickerGame } from "./GamePicker";

/**
 * Every pack the picker knows about: the session packs from the shared
 * registry, plus Tournament, which is not a pack in the registry's sense (it
 * has no session, no route segment of its own and no ws type: it is a bracket
 * started from this screen).
 *
 * A union rather than `string` so a caller switching on the key gets narrowing
 * (and a compile error for a pack it forgot) instead of having to trust itself.
 */
export type PackKey = SessionPackKey | "tournament";

// Re-exported so client code can keep importing it from here, while the one
// definition lives in packages/shared alongside the server's spelling of the
// same four packs.
export type { SessionPackKey };

/** A format as the catalogue describes it, before a destination is attached. */
export interface PackFormatSpec {
  key: string;
  label: string;
  sub: string;
}

/**
 * The picker's display groups, in the order they appear.
 *
 * DISPLAY ONLY. Unlike `ledger`, `gameName` and `keyPrefix` in the shared
 * registry, a group key is never written to the database, never a join key and
 * never in a URL. It exists to draw a divider and a caption. Rename them,
 * reorder them, split them or merge them at any time; the only consequence is
 * where a tile appears on one screen.
 *
 * Grouping lives HERE rather than in `SESSION_PACKS` because this list is the
 * client's display catalogue, and it already carries things the registry does
 * not: Tournament is not a registry pack at all, and Beerio Kart is a format
 * under the Mario Kart tile rather than a tile of its own. Those belong in the
 * same list as the real packs, so the grouping has to be where they all are.
 */
export const PACK_GROUPS = [
  { key: "nintendo", label: "Nintendo" },
  { key: "casino", label: "Casino" },
  { key: "bar", label: "Bar and sports" },
  { key: "other", label: "Other" },
] as const;

export type PackGroup = (typeof PACK_GROUPS)[number]["key"];

/** A pack as the catalogue describes it. */
export interface PackSpec {
  key: PackKey;
  name: string;
  emoji: string;
  cabClass: string;
  /**
   * Which picker section this tile sits under. DISPLAY ONLY and safe to change
   * whenever. See PACK_GROUPS above. A group with no members renders nothing,
   * so a new pack only has to set this and it appears in the right place.
   */
  group: PackGroup;
  /** Empty for Tournament, whose formats are always supplied by the caller. */
  formats: PackFormatSpec[];
}

// Name and emoji come from the shared registry; the picker owns only what is
// genuinely picker-specific (the cabinet class and the format list). The two
// used to be typed out here AND in the recap card AND on the event page, which
// is three chances to spell one pack differently.
const S = SESSION_PACKS;

export const PACKS: PackSpec[] = [
  {
    key: "mariokart",
    name: S.mariokart.name,
    emoji: S.mariokart.emoji,
    cabClass: "gn-cab--mk",
    group: "nintendo",
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
    name: S.smash.name,
    emoji: S.smash.emoji,
    cabClass: "gn-cab--smash",
    group: "nintendo",
    formats: [
      { key: "ffa", label: "Free-for-all", sub: "2–8 players a game" },
      { key: "koth", label: "King of the Hill", sub: "winner stays on" },
      { key: "bestof", label: "Best Of", sub: "1v1 sets, best of 3/5/7" },
      { key: "smashdown", label: "Smashdown", sub: "used fighters are struck out" },
    ],
  },
  {
    key: "marioparty",
    name: S.marioparty.name,
    emoji: S.marioparty.emoji,
    cabClass: "gn-cab--mp",
    group: "nintendo",
    formats: [{ key: "board", label: "🎲 Board night", sub: "stars, boards, bonus stars" }],
  },
  {
    key: "pingpong",
    name: S.pingpong.name,
    emoji: S.pingpong.emoji,
    cabClass: "gn-cab--pp",
    // Pool, darts and beer pong join this group when they land.
    group: "bar",
    formats: [
      { key: "free", label: "Free Play", sub: "single games, one tap each" },
      { key: "bestof", label: "Best Of", sub: "3, 5 or 7 game series" },
      { key: "koth", label: "King of the Hill", sub: "winner stays on" },
    ],
  },
  {
    key: "blackjack",
    name: S.blackjack.name,
    emoji: S.blackjack.emoji,
    cabClass: "gn-cab--bj",
    group: "casino",
    // One format today. The other three casino packs (roulette, craps,
    // poker) are their own tiles when they land, not formats under this one:
    // separate ledger keys, separate leaderboard tabs.
    formats: [{ key: "cash", label: "🃏 Cash game", sub: "buy-ins, rebuys, cash-outs" }],
  },
  {
    key: "roulette",
    name: S.roulette.name,
    emoji: S.roulette.emoji,
    cabClass: "gn-cab--rl",
    group: "casino",
    formats: [{ key: "cash", label: "🎡 Cash game", sub: "buy-ins, rebuys, cash-outs" }],
  },
  {
    key: "craps",
    name: S.craps.name,
    emoji: S.craps.emoji,
    cabClass: "gn-cab--cr",
    group: "casino",
    formats: [{ key: "cash", label: "🎲 Cash game", sub: "buy-ins, rebuys, cash-outs" }],
  },
  {
    key: "casinorun",
    name: S.casinorun.name,
    emoji: S.casinorun.emoji,
    cabClass: "gn-cab--crun",
    group: "casino",
    // The CO-OP one. Its format key is "coop" rather than "cash" because it is
    // genuinely not a cash game: there are no buy-ins and no cash-outs, just
    // one shared bank against a target.
    formats: [{ key: "coop", label: "🎰 Co-op run", sub: "one bank, quotas, everybody wins or nobody" }],
  },
  {
    key: "tournament",
    name: "Tournament",
    emoji: "🏆",
    cabClass: "gn-cab--brk",
    group: "other",
    formats: [],
  },
];

export interface BuildPickerOptions {
  /** Where a given pack/format goes. Called once per format when building. */
  destination: (packKey: PackKey, formatKey: string) => () => void;
  /** Overrides the Beerio subline; the event page makes it live-aware. */
  beerioSub?: string;
  /**
   * Per-pack tile subline, used by the event page to mark a pack that is
   * running RIGHT NOW. Only Beerio and Tournament could say "live now" before,
   * because those were the only two the event payload described, so a night
   * already playing Mario Kart looked idle. Quick play never sets it: there is
   * no shared night to be live on.
   */
  liveSub?: Partial<Record<PackKey, string>>;
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
    group: pack.group,
    sub: opts.liveSub?.[pack.key],
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

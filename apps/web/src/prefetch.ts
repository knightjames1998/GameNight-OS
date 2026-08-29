// Prefetch a lazy route's chunk the moment someone shows intent.
//
// Route splitting (cleanup phase 4) halved the entry bundle, but it moved a
// cost rather than deleting it: the first visit to any lazy route now pays one
// round trip for its chunk, and that round trip does not start until the tap
// has already landed. On a phone, the gap between "finger goes down" and
// "finger comes up and the click fires" is 80-150ms of dead time, and a
// pointerdown listener turns that dead time into a head start.
//
// It is the SAME import() call the route uses, so this costs nothing extra: a
// dynamic import is memoized by the module system, and the route's own import
// resolves against the in-flight (or finished) request instead of making a
// second one. Worst case, someone touches a tile and does not open it, and we
// fetched a chunk they will probably want later anyway.
//
// pointerdown, not mouseover: this app is used on phones, where hover does not
// exist. pointerdown covers touch, mouse and pen with one event.
//
// Deliberately limited to the highest-value routes: the game picker tiles, the
// crew stats button and the TV link. Prefetching everything on the page would
// undo the split.

import type { PackKey } from "./packs";

export type Importer = () => Promise<unknown>;

const started = new Set<Importer>();

/**
 * Kick off a route chunk. Safe to call repeatedly; only the first call per
 * importer does anything, and a failure is swallowed because this is pure
 * optimisation. If the chunk really is broken, the actual navigation will
 * surface it through RouteBoundary, which is where the user can act on it.
 */
export function prefetch(importer: Importer): void {
  if (started.has(importer)) return;
  started.add(importer);
  void importer().catch(() => {
    // Let the real navigation report it; a prefetch must never throw.
    started.delete(importer);
  });
}

/**
 * Spread onto any element that leads somewhere lazy:
 *   <Link to="/g/1/stats" {...onIntent(routes.stats)}>
 */
export function onIntent(importer: Importer) {
  return { onPointerDown: () => prefetch(importer) };
}

/**
 * The lazy routes worth prefetching, as the same import specifiers App.tsx
 * uses. Vite resolves an identical specifier to the same chunk, so these do
 * not create duplicates.
 */
export const routes = {
  /** Not a route: the help guide, which is lazy for the same reason. */
  help: () => import("./HelpDialog"),
  stats: () => import("./pages/StatsPage"),
  myStats: () => import("./pages/MyStatsPage"),
  member: () => import("./pages/MemberPage"),
  recap: () => import("./pages/RecapPage"),
  bracket: () => import("./pages/BracketPage"),
  tv: () => import("./pages/TvPage"),
  eventTv: () => import("./pages/EventTvPage"),
  /**
   * The page behind every television's QR.
   *
   * NO onIntent SITE, AND THAT IS NOT AN OVERSIGHT. Nothing in this app links
   * to it: it is reached by pointing a camera at a screen across the room, so
   * there is no pointerdown to get a head start from. It is listed because this
   * table is where a lazy route's specifier lives, and a second spelling of an
   * import is how a route quietly ends up in its own duplicate chunk.
   */
  eventLive: () => import("./pages/EventLivePage"),
  beerio: () => import("./beerio/BeerioRoute"),
  smash: () => import("./smash/SmashPage"),
  marioKart: () => import("./mariokart/MarioKartPage"),
  marioParty: () => import("./marioparty/MarioPartyPage"),
  pingPong: () => import("./pingpong/PingPongPage"),
  blackjack: () => import("./blackjack/BlackjackPage"),
  poker: () => import("./poker/PokerPage"),
  roulette: () => import("./roulette/RoulettePage"),
  craps: () => import("./craps/CrapsPage"),
  casinoRun: () => import("./casinorun/CasinoRunPage"),
  boardGame: () => import("./boardgame/BoardGamePage"),
  cardTable: () => import("./cardtable/CardTablePage"),
  deduction: () => import("./deduction/DeductionPage"),
  tournamentSetup: () => import("./pages/TournamentSetupPage"),
} as const;

/**
 * Look up a pack's route chunk by the picker key the catalogue uses.
 *
 * The IMPORTERS have to stay hand-written: Vite needs a static literal inside
 * import() to split a chunk, so this cannot be built by looping over the pack
 * registry. What it CAN do is make the table complete by type, which is the
 * half that was actually failing before: a `Record<string, Importer>` accepts
 * a missing pack (silently prefetching nothing, so the tap just feels slower)
 * and, worse, accepts a MISSPELLED one. Keyed by PackKey it is a compile error
 * to add a pack and forget this file. "beerio" is a format under the Mario Kart
 * tile rather than a PackKey, so it is named explicitly.
 */
export const packRoute: Record<PackKey | "beerio", Importer> = {
  beerio: routes.beerio,
  smash: routes.smash,
  mariokart: routes.marioKart,
  marioparty: routes.marioParty,
  pingpong: routes.pingPong,
  blackjack: routes.blackjack,
  poker: routes.poker,
  roulette: routes.roulette,
  craps: routes.craps,
  casinorun: routes.casinoRun,
  boardgame: routes.boardGame,
  cardtable: routes.cardTable,
  // Social Deduction has no picker tile yet, so nothing looks this up today.
  // It is here because the table is keyed by PackKey and the registry entry
  // exists, which is the type doing exactly its job: the pack cannot be added
  // and then quietly left out of the one file that makes its tap feel fast.
  deduction: routes.deduction,
  // The SETUP screen, not the bracket: since 2026-08-17 the Tournament tile
  // leads to a roster step, so prefetching BracketPage would warm the chunk
  // AFTER the one the tap actually opens. The bracket's own chunk is prefetched
  // from the "open live bracket" tile, which is the tap that leads there.
  tournament: routes.tournamentSetup,
};

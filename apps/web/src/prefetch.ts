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

type Importer = () => Promise<unknown>;

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
  stats: () => import("./pages/StatsPage"),
  myStats: () => import("./pages/MyStatsPage"),
  member: () => import("./pages/MemberPage"),
  recap: () => import("./pages/RecapPage"),
  bracket: () => import("./pages/BracketPage"),
  tv: () => import("./pages/TvPage"),
  eventTv: () => import("./pages/EventTvPage"),
  beerio: () => import("./beerio/BeerioRoute"),
  smash: () => import("./smash/SmashPage"),
  marioKart: () => import("./mariokart/MarioKartPage"),
  marioParty: () => import("./marioparty/MarioPartyPage"),
  pingPong: () => import("./pingpong/PingPongPage"),
  quickPlay: () => import("./pages/QuickPlayPage"),
} as const;

/** Look up a pack's route chunk by the picker key the catalogue uses. */
export const packRoute: Record<string, Importer> = {
  beerio: routes.beerio,
  smash: routes.smash,
  mariokart: routes.marioKart,
  marioparty: routes.marioParty,
  pingpong: routes.pingPong,
  tournament: routes.bracket,
};

// Layout-shaped placeholders for the screens that have nothing cached yet.
//
// This is only ever reached on a FIRST visit to a screen. Once something is
// cached, the cache paints the real thing and no placeholder appears at all
// (see cache.ts). So these are the honest "we genuinely have nothing" state,
// not a thing users should see often.
//
// Why shapes and not centred grey text: "Loading..." in the middle of an empty
// screen reads as broken, because it looks nothing like what is about to
// appear. A block roughly the size and position of the real content reads as
// fast, because the page visibly does not move when the data lands. Same wait,
// different feeling, and it also removes a layout shift.
//
// Deliberately small in scope: a few reusable primitives and the four screens
// that get opened most. This is not a design pass.

/** One shimmering block. Sizes are in px unless a string is given. */
export function SkeletonBlock({
  height = 16,
  width = "100%",
  radius = 8,
  className,
}: {
  height?: number | string;
  width?: number | string;
  radius?: number;
  className?: string;
}) {
  return (
    <div
      className={`gn-skel${className ? ` ${className}` : ""}`}
      style={{ height, width, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

/**
 * A card-shaped placeholder: the shape almost every list row in the app has.
 * `lines` controls how many text bars sit inside it.
 */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="gn-skel-card" aria-hidden="true">
      <SkeletonBlock height={15} width="58%" />
      {Array.from({ length: Math.max(0, lines - 1) }, (_, i) => (
        <SkeletonBlock key={i} height={12} width={i % 2 ? "44%" : "72%"} />
      ))}
    </div>
  );
}

/**
 * Wraps a skeleton so screen readers announce a wait instead of silence, and
 * so the whole group is one live region rather than a dozen chattering blocks.
 */
function Loading({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="gn-skel-group">
      <span className="gn-sr-only">{label}</span>
      {children}
    </div>
  );
}

/** The crew page's game-night list. */
export function EventListSkeleton() {
  return (
    <Loading label="Loading game nights">
      <SkeletonCard lines={2} />
      <SkeletonCard lines={2} />
    </Loading>
  );
}

/** Home's crew list. */
export function GroupListSkeleton() {
  return (
    <Loading label="Loading your crews">
      <SkeletonCard lines={1} />
      <SkeletonCard lines={1} />
    </Loading>
  );
}

/** The event page: title block, then the RSVP row, then the games grid. */
export function EventSkeleton() {
  return (
    <Loading label="Loading this game night">
      <SkeletonBlock height={26} width="64%" />
      <SkeletonBlock height={13} width="38%" />
      <SkeletonCard lines={2} />
      <div className="gn-skel-grid">
        <SkeletonBlock height={72} radius={14} />
        <SkeletonBlock height={72} radius={14} />
        <SkeletonBlock height={72} radius={14} />
        <SkeletonBlock height={72} radius={14} />
      </div>
    </Loading>
  );
}

/** A stats screen: a row of tiles over a leaderboard. */
export function StatsSkeleton() {
  return (
    <Loading label="Loading stats">
      <div className="gn-skel-grid">
        <SkeletonBlock height={62} radius={14} />
        <SkeletonBlock height={62} radius={14} />
        <SkeletonBlock height={62} radius={14} />
        <SkeletonBlock height={62} radius={14} />
      </div>
      <SkeletonCard lines={2} />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={2} />
    </Loading>
  );
}

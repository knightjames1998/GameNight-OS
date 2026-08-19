// TWO HOST DEVICES ON ONE ROOM, and the rule that keeps them agreeing.
//
// THE DEFECT THIS EXISTS TO KILL. A host device pushes its local state to the
// room on every change and never reads the room back, so a night driven from a
// phone leaves a laptop sitting on the state it had when it loaded. The laptop
// is not merely stale: its own next push overwrites the phone's work. The only
// cure was a page refresh, which is what made it look like a rendering problem
// rather than a sync one.
//
// IT IS A HALF-BUILT FEATURE RATHER THAN A MISSING ONE. BeerioApp already
// adopts the room's state for a host, with the reason written on it ("Host
// rejoining an open room: adopt its state so the auto-sync effect can't
// overwrite the live night with this device's stale copy"), and that adopt is
// correct. It just only ever runs ONCE, when the GameNight event context
// resolves on mount. Refreshing the page is how a person re-runs it by hand.
// This module is the comparison that lets it run on the poll the pack already
// uses everywhere else.
//
// THIS FILE IS OURS, in the same sense band.ts, racer.ts and crowd.ts are: a new
// module beside the vendored port rather than an edit to its internals. The
// vendored file gets the wiring and nothing else, so the rule that matters (do
// not rewrite proven engine code that has no test to catch drift) is kept while
// the part that can actually be reasoned about lives here, with tests.

/**
 * The fields a room's two devices have to agree on.
 *
 * hofCode IS DELIBERATELY NOT ONE OF THEM, and leaving it out is what stops an
 * infinite ping-pong rather than a matter of taste. It is a per-device value
 * read from localStorage, the host's mount-time adopt has never applied it, and
 * a key that one device sends and the other never adopts is a difference that
 * can never be resolved: each poll would see the other's copy as new, adopt it,
 * fail to actually change its own, and push again, forever, at both ends.
 */
const SYNC_FIELDS = [
  "playerCount",
  "names",
  "results",
  "series",
  "format",
  "gpLog",
  "colors",
  "seeded",
] as const;

/**
 * JSON with object keys sorted, at every depth.
 *
 * PLAIN JSON.stringify CANNOT BE USED HERE, and the reason is a full layer
 * away: the room's state is stored in a Postgres `jsonb` column, and jsonb does
 * not preserve key order. It normalises. So the bytes a device PUTs are not the
 * bytes it reads back, `results` and `format` come home with their keys in a
 * different order, and a string compare would report "somebody changed this" on
 * every single poll of a room nobody has touched.
 */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stableJson).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return (
      "{" +
      Object.keys(o)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stableJson(o[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(v === undefined ? null : v);
}

/**
 * One room state reduced to a comparable string. Two devices holding the same
 * night produce the same key whichever way the state reached them.
 */
export function roomStateKey(state: unknown): string {
  const s = (state ?? {}) as Record<string, unknown>;
  return stableJson(SYNC_FIELDS.map((k) => s[k] ?? null));
}

/**
 * Should this device take the room's copy?
 *
 * `synced` is the key of the state this device last AGREED with the room on,
 * whether it pushed that state or read it. The two answers this gives are what
 * make the loop terminate:
 *
 *   - remote === synced  nothing has happened since we last agreed, so there is
 *                        nothing to adopt AND nothing to push. This is the
 *                        steady state, and it is why a quiet room generates no
 *                        traffic beyond the poll itself.
 *   - pushing            this device has an edit of its own in flight. Adopting
 *                        now would wipe a half-typed name out from under
 *                        somebody, so the local edit wins and lands first; the
 *                        next poll converges.
 *
 * Adopting sets local state EQUAL to remote, so the push side then finds its own
 * key already synced and stays quiet. Without that the two devices would echo
 * each other's writes forever, which is the failure this pair of rules is really
 * guarding against.
 */
export function shouldAdopt(opts: {
  remote: string;
  synced: string | null;
  pushing: boolean;
}): boolean {
  if (opts.pushing) return false;
  return opts.remote !== opts.synced;
}

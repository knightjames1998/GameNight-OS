import { probedStorage } from "./cache";

// HAS THIS PERSON BEEN SHOWN THE HELP BUTTON YET? Two flags, one per surface.
//
// TWO, NOT ONE, AND THEY ARE GENUINELY TWO MOMENTS. The signed-out screen and
// Home are different sightings: somebody who saw the cue on the login screen has
// since typed a six-digit code and landed somewhere that looks nothing like it,
// and is not going to connect the two. A single flag would let the first
// sighting silence the second, which is the one that matters more, since Home is
// where they now have to work out what to do.
//
// NOT UNDER cache.ts's PREFIX, deliberately. That namespace is swept on every
// deploy and cleared on logout, both correct for cached payloads and both wrong
// here: the cue would replay after every deploy (explicitly deferred) and after
// every logout. These sit beside the theme preference instead, which is the
// app's other piece of durable per-device state.

const KEYS = {
  signedOut: "gamenight.seen.help.signedout",
  home: "gamenight.seen.help.home",
} as const;

export type HelpSurface = keyof typeof KEYS;

/**
 * How long the cue lasts before it counts as delivered.
 *
 * THE SAME NUMBER AS THE CSS: `.gn-cue` runs 1.4s three times. It is a constant
 * here rather than an `animationend` listener because THAT EVENT NEVER FIRES
 * UNDER REDUCED MOTION, where the rule is `animation: none`, and a flag written
 * only on an event some people never get is a cue those people would see for
 * ever. help-cue.test.ts multiplies the CSS back out against this, so the two
 * cannot drift apart quietly.
 */
export const CUE_MS = 4200;

/**
 * Should this surface show the cue?
 *
 * WHEN STORAGE IS UNAVAILABLE, ANIMATE, and that is the opposite of what gets
 * picked by reflex. A Safari private-mode visitor seeing the gold halo on every
 * visit is a small, self-explaining annoyance; a first-timer never seeing it at
 * all is the feature not existing for them. When in doubt, show it.
 *
 * ("halo" rather than the obvious synonym on purpose. TAILWIND v4 SCANS RAW
 * SOURCE TEXT FOR CLASS CANDIDATES AND DOES NOT SKIP COMMENTS, so an earlier
 * draft of this sentence used that synonym as an ordinary English word and
 * Tailwind emitted the matching utility into the shipped stylesheet. The theme
 * sweep then reported a difference in a selector this session never touched.
 * Harmless in itself, but it is real bytes and a real false positive, both
 * conjured out of prose, and the second draft of this very comment reintroduced
 * it by naming the word while explaining it. Measured: absent at cad1818,
 * present once the word appeared, absent again once it did not.)
 */
export function shouldCueHelp(surface: HelpSurface): boolean {
  if (!probedStorage) return true;
  try {
    return probedStorage.getItem(KEYS[surface]) !== "1";
  } catch {
    return true;
  }
}

/** Remember that this surface has now shown it. Failure is silently fine. */
export function markHelpSeen(surface: HelpSurface): void {
  try {
    probedStorage?.setItem(KEYS[surface], "1");
  } catch {
    // Quota, private mode, storage disabled. The cost is the cue playing again.
  }
}

/**
 * Opening the guide settles BOTH surfaces at once.
 *
 * Somebody who has read it does not need pointing at it on the other screen, and
 * "once opened, the button is normal forever" is the whole promise. This is also
 * why opening early has to count: the cue is about the button being noticed, and
 * a tap is proof it was.
 */
export function markAllHelpSeen(): void {
  markHelpSeen("signedOut");
  markHelpSeen("home");
}

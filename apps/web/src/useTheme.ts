// The theme switcher.
//
// ONE THEME IN IT RIGHT NOW, ON PURPOSE. This is stage 1 of three: make the
// theme swappable without changing a single colour, so that a regression in
// the plumbing is provable against a fixed target instead of being tangled up
// with intended visual change. Stage 2 adds Tabletop as a second token block
// in index.css and one entry in THEMES below. Nothing else here changes.
//
// HOW A THEME IS APPLIED: document.documentElement.dataset.theme. Arcade is
// what :root already defines, so it needs no block of its own and
// data-theme="arcade" renders identically to no attribute at all. That is
// deliberate, and it is what makes the default free: a device that has never
// touched the switcher, or one where localStorage throws, gets Arcade by
// doing nothing.
//
// WHY THIS IS NOT IN cache.ts, and please do not "tidy" it in there. Every key
// in that module is namespaced by __BUILD_ID__ and every namespace that is not
// the current build is swept on boot, which is exactly right for cached API
// payloads (a stale one hydrating into new code is a white screen on launch)
// and exactly wrong for a preference. A theme that silently resets to Arcade
// every time the app ships is worse than having no switcher at all, because
// the person who set it has no idea why it keeps changing back. So: its own
// key, its own namespace, and no build id anywhere near it.
//
// THE NAMESPACE IS DELIBERATELY NOT NEIGHBOURING cache.ts's. That module
// sweeps everything matching "gn:" that is not the current build. "gamenight."
// cannot collide with that prefix by any near-miss, which "gn-theme" or
// "gn.theme" could if somebody widened the sweep later.

import { useCallback, useEffect, useState } from "react";

export const THEMES = [{ key: "arcade", label: "Arcade" }] as const;

export type ThemeKey = (typeof THEMES)[number]["key"];

export const DEFAULT_THEME: ThemeKey = "arcade";

/** Also read by the pre-paint script in index.html. Change both or neither. */
export const THEME_STORAGE_KEY = "gamenight.pref.theme";

function isTheme(value: string | null): value is ThemeKey {
  return !!value && THEMES.some((t) => t.key === value);
}

/**
 * The stored preference, or the default. Never throws.
 *
 * AN UNRECOGNISED VALUE IS NOT ERASED, only ignored. If a deploy is rolled
 * back to a build that predates Tabletop, every phone set to Tabletop reads a
 * theme this build has never heard of. Rendering Arcade is right; rewriting
 * storage to Arcade is not, because it would throw the choice away on every
 * such device and the roll-forward would come back to a fleet of phones that
 * had silently been reset. Ignore it, leave it, let the build that owns it
 * pick it up again.
 *
 * The visible cost is one frame in exactly that case: the inline script in
 * index.html shape-checks rather than name-checks (so stage 2 does not have to
 * remember to edit it), so it sets data-theme="tabletop", and this corrects it
 * on mount. A one-frame correction on a rolled-back build is a much smaller
 * problem than a switcher that silently forgets.
 */
export function readTheme(): ThemeKey {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    // Safari private mode throws on storage access.
    return DEFAULT_THEME;
  }
}

/**
 * The current theme and a setter that persists it.
 *
 * The attribute is normally already correct before React runs, because the
 * inline script in index.html set it from the same key. The effect here is
 * what keeps it correct AFTER a change, and what repairs it if the stored
 * value was one this build does not recognise.
 */
export function useTheme(): { theme: ThemeKey; setTheme: (next: ThemeKey) => void } {
  const [theme, setThemeState] = useState<ThemeKey>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback((next: ThemeKey) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage is unavailable. The choice still applies for this session;
      // it just will not survive a relaunch, which beats failing the tap.
    }
  }, []);

  return { theme, setTheme };
}

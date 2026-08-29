import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { onIntent, routes } from "./prefetch";
import { CUE_MS, markAllHelpSeen, markHelpSeen, shouldCueHelp, type HelpSurface } from "./helpseen";

// WHAT IS THIS APP? One modal, over whatever screen you are on.
//
// MOUNTED ONCE, GLOBALLY, the way ConnectionPill is: a single mount in the App
// shell that reads its own state rather than anything on the tree below it. That
// is what makes a trigger just a button: it can go in the signed-in header,
// beside the signed-out brand, and anywhere a later session wants one, without
// any of them owning the modal or passing it anything.
//
// THE OPEN STATE LIVES IN A SEARCH PARAM, NOT IN useState, AND THAT IS THE WHOLE
// DESIGN. A modal held in component state has no answer for the Android back
// gesture: back leaves the screen, or closes the app, while the modal is sitting
// open on top of it. The obvious fix is to push a history entry by hand and
// listen for popstate, and hand-rolling that inside a react-router app is how
// this project got its ghost-history double-back bug.
//
// `?help=1` on the CURRENT route sidesteps both. It is a real history entry, so
// Android back closes the modal natively and nothing here listens for anything;
// and because it rides the current route rather than being one, it is still a
// modal over whatever you were looking at.
//
// THE PARAM IS READ REACTIVELY, never captured. Same-route navigations do not
// remount, so a value read once at mount would be frozen at whatever the URL
// said when the app started; and `location.search` cached at module scope is a
// trap this app has already fallen into once.
//
// THIS FILE IS DELIBERATELY ALMOST EMPTY. Everything the guide needs to RUN
// (the focus trap, the iOS scroll lock, the close-by-history rule, the copy)
// lives in HelpDialog and loads on the tap, because none of it can do anything
// before then. The first draft had it all here and cost 836 gzipped bytes on the
// entry path; the bundle budget's headroom test refused it, which is that test
// working exactly as it was written to.

const HelpDialog = lazy(() => import("./HelpDialog"));

/** The one spelling of the param, shared by the dialog and every trigger. */
export const HELP_PARAM = "help";

/**
 * Open the guide from anywhere.
 *
 * ROUTER-DRIVEN, NEVER AN ANCHOR. A raw href here would be a full page load, and
 * in an installed iOS PWA a full page load opens a new Safari tab and leaves the
 * app: standing rule 4.
 *
 * The push carries `state.help` so the dialog knows the entry is one WE added
 * and can close by going back, consuming it. Without that marker, closing would
 * push a second entry and back would reopen the modal, which is the same ghost
 * history the param was chosen to avoid.
 */
export function useOpenHelp(): () => void {
  const [params, setParams] = useSearchParams();
  return useCallback(() => {
    if (params.get(HELP_PARAM) === "1") return;
    const next = new URLSearchParams(params);
    next.set(HELP_PARAM, "1");
    setParams(next, { state: { help: true } });
  }, [params, setParams]);
}

/**
 * The trigger, so both placements share one wiring.
 *
 * TWO PLACEMENTS, TWO SHAPES, and the signed-out one is arguably the important
 * one: somebody looking at a login screen with no idea what this is has nowhere
 * else to find out. Signed in it sits between the brand and Log out, where the
 * only spare width on a 390px header is an icon's worth, so `compact` is a
 * measured decision rather than a preference (see the header at 390px).
 *
 * `onIntent` warms the chunk on pointerdown, which is the 80 to 150ms between a
 * finger going down and the click firing.
 */
export function HelpButton({ compact, surface }: { compact?: boolean; surface: HelpSurface }) {
  const openHelp = useOpenHelp();

  // DECIDED ONCE, ON MOUNT, and the lazy initializer is what makes that true:
  // it runs on the first render and never again, so a re-render of Home cannot
  // restart the animation. Reading the flag at module scope would be worse
  // still, and for a reason this app has already been bitten by: a module is
  // evaluated once at boot, and this value changes DURING the session.
  //
  // It is state rather than a ref because opening the guide has to clear it
  // mid-mount: once read, the button is normal immediately, not on next load.
  const [cue, setCue] = useState(() => shouldCueHelp(surface));

  useEffect(() => {
    if (!cue) return;
    // A TIMER, NOT `animationend`. Under reduced motion the rule is
    // `animation: none`, so that event never fires and the flag would never be
    // written: the one group of people who cannot be shown movement would be
    // the only ones shown the marker for ever. The duration is shared with the
    // CSS through CUE_MS and pinned by a test.
    const t = setTimeout(() => markHelpSeen(surface), CUE_MS);
    return () => clearTimeout(t);
  }, [cue, surface]);

  return (
    <button
      // The cue is its own class rather than a modifier of either form, because
      // the trigger has two and both can carry it.
      className={`${compact ? "gn-helpbtn" : "gn-textbtn"}${cue ? " gn-cue" : ""}`}
      aria-label={compact ? "How GameNight works" : undefined}
      onClick={() => {
        // Opening counts as delivered, on BOTH surfaces and immediately: the cue
        // is about the button being noticed, and a tap is proof that it was.
        markAllHelpSeen();
        setCue(false);
        openHelp();
      }}
      {...onIntent(routes.help)}
    >
      {compact ? "?" : "How this works"}
    </button>
  );
}

export default function HelpModal() {
  const [params] = useSearchParams();
  if (params.get(HELP_PARAM) !== "1") return null;
  // No fallback: the chunk is small, prefetched on the trigger's pointerdown,
  // and a flash of an empty panel is worse than the extra beat before the real
  // one appears.
  return (
    <Suspense fallback={null}>
      <HelpDialog />
    </Suspense>
  );
}

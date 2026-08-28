import { lazy, Suspense, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { onIntent, routes } from "./prefetch";

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
export function HelpButton({ compact }: { compact?: boolean }) {
  const openHelp = useOpenHelp();
  return (
    <button
      className={compact ? "gn-helpbtn" : "gn-textbtn"}
      aria-label={compact ? "How GameNight works" : undefined}
      onClick={openHelp}
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

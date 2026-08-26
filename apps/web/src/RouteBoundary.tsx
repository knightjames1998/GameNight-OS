import { Component, type ReactNode } from "react";
import { dropAll } from "./cache";

// Route chunks are fetched on demand, so a route can now fail for a reason
// that did not exist when everything shipped in one bundle: the network drops
// mid-fetch, or a deploy replaced the hashed chunk this page's index.html was
// asking for. Without a boundary that is a white screen, which is the worst
// possible outcome on a TV or a phone on bad wifi in the middle of a game
// night.
//
// Reload is the right recovery, not a retry of the same import: a stale
// index.html keeps asking for a chunk that no longer exists, and only a full
// page load picks up the new one. This is deliberately a real page load, not
// internal navigation, so it does not conflict with the no-raw-anchor rule.
//
// A THIRD CAUSE, AND THE ONLY ONE A RELOAD CANNOT FIX ON ITS OWN. This
// boundary catches anything a route throws while RENDERING, not only a chunk
// that failed to arrive, and the pages under it paint from localStorage before
// they fetch anything (cache.ts returns a cached payload synchronously so the
// first paint is not a spinner). So a malformed cached payload throws during
// the FIRST render, ahead of the revalidation that would have replaced it, and
// the Reload button below re-runs that same first render off that same entry.
// The screen tells the reader that reloading fixes it, and for that one cause
// it was a lie: the app stayed dead until a deploy changed the cache namespace.
// That is what "it keeps crashing" was, reported 2026-08-26.
//
// So the first failure in a tab now DROPS THE CACHE AND RELOADS ITSELF, once.
// It costs a refetch if the crash was something else, which is nothing, and it
// is the right move for the two causes above as well: the reload picks up the
// new index.html either way. ONE recovery per tab, claimed through
// sessionStorage before it is used, and refused outright if that claim cannot
// be recorded, because an unbounded self-reload is a loop and a loop is worse
// than the screen it was trying to replace.

/** The one automatic recovery per tab, and the record that it was spent. */
const RECOVERY_KEY = "gn:route-recovery";

/**
 * Claim this tab's recovery. False if it is already spent, and false if the
 * claim cannot be written down at all: a recovery nothing can bound is a
 * reload loop, so an unusable sessionStorage means no automatic reload rather
 * than an unlimited one.
 */
function claimRecovery(): boolean {
  try {
    if (sessionStorage.getItem(RECOVERY_KEY)) return false;
    sessionStorage.setItem(RECOVERY_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** Whether the recovery has already run, so the copy can stop promising it. */
function recoverySpent(): boolean {
  try {
    return !!sessionStorage.getItem(RECOVERY_KEY);
  } catch {
    return false;
  }
}

/** Shown while a route chunk is in flight. Matches App's loading shell. */
export function RouteFallback() {
  return (
    <main className="gn-app flex items-center justify-center" style={{ minHeight: "100dvh" }}>
      <p className="gn-hint">Loading...</p>
    </main>
  );
}

export default class RouteBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; cleared: boolean }
> {
  state = { failed: false, cleared: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[route]", error);
    if (claimRecovery()) {
      // Everything in here is a cached GET payload and is refetched on the way
      // back up, so there is nothing to lose by dropping it and no state that
      // only lives here. The reload is a real page load for the same reason
      // the button is.
      dropAll();
      window.location.reload();
      return;
    }
    // The recovery already ran and this screen came back broken anyway, so the
    // copy must stop telling the reader that reloading fixes it.
    if (recoverySpent()) this.setState({ cleared: true });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="gn-app flex items-center justify-center" style={{ minHeight: "100dvh" }}>
        <div className="gn-wrap text-center space-y-3" style={{ maxWidth: 360 }}>
          <h1 className="gn-h1">That screen did not load</h1>
          {this.state.cleared ? (
            <>
              {/* SECOND TIME ROUND, AND THE COPY OWES THE READER THE TRUTH: the
                  app has already tried the thing the button offers. What is
                  worth saying instead is that nothing is lost, because a host
                  standing in front of this mid-night is wondering about the
                  night rather than about the screen. */}
              <p className="gn-hint">
                The app cleared what it had saved and reloaded once, and this screen still
                did not come back. Nothing is lost: the night lives on the server, not on
                this device.
              </p>
              <button className="gn-btn gn-btn--p1 w-full" onClick={() => window.location.reload()}>
                Try again
              </button>
              {/* THE WAY OUT OF ONE DEAD ROUTE. Reload has demonstrably not
                  worked by this point, and a host with a game night starting
                  needs a door rather than a second try at the same one. A real
                  page load, like Reload, so it does not conflict with the
                  no-raw-anchor rule. */}
              <button className="gn-textbtn" onClick={() => window.location.assign("/")}>
                go to the start
              </button>
            </>
          ) : (
            <>
              <p className="gn-hint">
                Usually the connection dropped, or the app updated while this tab was open.
                Reloading fixes both.
              </p>
              <button className="gn-btn gn-btn--p1 w-full" onClick={() => window.location.reload()}>
                Reload
              </button>
            </>
          )}
        </div>
      </main>
    );
  }
}

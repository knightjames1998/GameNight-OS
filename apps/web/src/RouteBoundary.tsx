import { Component, type ReactNode } from "react";

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
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[route]", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="gn-app flex items-center justify-center" style={{ minHeight: "100dvh" }}>
        <div className="gn-wrap text-center space-y-3" style={{ maxWidth: 360 }}>
          <h1 className="gn-h1">That screen did not load</h1>
          <p className="gn-hint">
            Usually the connection dropped, or the app updated while this tab was open.
            Reloading fixes both.
          </p>
          <button className="gn-btn gn-btn--p1 w-full" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
}

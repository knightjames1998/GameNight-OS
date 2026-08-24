import { useLiveStatus } from "./useLiveUpdates";

// THE ONE PILL, in the shell, covering all nineteen live screens.
//
// It reads the module-scope status store every socket reports into, so no page
// passes it anything and no page was edited to get it. See livestatus.ts for why
// the store answers on TRAFFIC rather than on `socket.readyState`.
//
// IT EXPLAINS; IT DOES NOT GATE. Nothing is disabled while it is up, no confirm
// is blocked, and there is no manual reconnect to tap. WRITES STILL GO THROUGH
// while this is showing: they are ordinary HTTP requests, and a failed one
// already rolls back its optimistic update and surfaces its own error on the
// page. The thing that stops silently is RECEIVING other people's updates, which
// is the only thing this says.
//
// WHICH IS ALSO WHY IT MUST NOT SAY "OFFLINE". The app is not offline: the host
// can still record a game, and telling them otherwise would be both wrong and
// the kind of wrong that makes somebody stop and wait for nothing.

export default function ConnectionPill() {
  const state = useLiveStatus();

  // `idle` is Home, Login and anything else with no live subscription: there is
  // nothing to report, so those screens are byte-identical to before this
  // shipped. `live` is the healthy case and is deliberately SILENT rather than
  // green: a permanent "connected" badge is a thing people stop seeing, and on a
  // television it is pixels spent every night to say nothing. Zero pixels in
  // normal operation is also what keeps this off every TV fit measurement.
  if (state === "idle" || state === "live") return null;

  return (
    <div
      className="gn-connpill"
      role="status"
      aria-live="polite"
      // FIXED, AND FOLDING THE SAFE AREA INTO ITS OWN calc(). A class rule beats
      // the zero-specificity shell inset, so an element that sets its own
      // position has to add env() itself or it sits under the notch in landscape
      // and under the home indicator in portrait. `--gn-shell-inset` carries the
      // rail's width under Tabletop and 0px under Arcade, which is what keeps
      // this off the timber in one expression instead of a theme branch.
      style={{
        position: "fixed",
        right: "calc(env(safe-area-inset-right, 0px) + var(--gn-shell-inset) + 12px)",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + var(--gn-shell-inset) + 12px)",
        // Above the rail, which sits at 3.
        zIndex: 5,
        // It is a label, not a control: nothing can be tapped and, more to the
        // point, nothing UNDER it can be blocked from being tapped.
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        maxWidth: "min(92vw, 26rem)",
        padding: "8px 14px",
        borderRadius: "var(--gn-radius-pill)",
        // An opaque surface, because this lands on top of a pack's own painted
        // board and a translucent one would be unreadable over half of them.
        background: "var(--gn-surf-solid)",
        border: "2px solid color-mix(in srgb, var(--gn-gold) 55%, transparent)",
        color: "var(--gn-ink)",
        boxShadow: "0 6px 18px rgba(0,0,0,.35)",
        // Legible across a room on a 1080p television and ordinary on a phone.
        fontSize: "max(13px, 1.5vmin)",
        fontWeight: 700,
        lineHeight: 1.25,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "0.6em",
          height: "0.6em",
          borderRadius: "50%",
          background: "var(--gn-gold)",
          flexShrink: 0,
        }}
      />
      <span>Live updates paused. Reconnecting...</span>
    </div>
  );
}

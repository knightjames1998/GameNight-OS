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
//
// EVERY STYLE LIVES IN index.css UNDER `.gn-connpill`, not inline here, and that
// is not tidiness: the theme sweep's fixture pass builds one element per `.gn-*`
// class it finds in the stylesheets and measures it under BOTH themes, so a
// styled class is swept for free while a styled attribute is invisible to it.
// The placement reasoning, which was measured rather than chosen, is written
// down beside the rule.

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
    <div className="gn-connpill" role="status" aria-live="polite">
      <span className="gn-connpill__dot" aria-hidden="true" />
      <span>Live updates paused. Reconnecting...</span>
    </div>
  );
}

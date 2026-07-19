import { useState } from "react";

/**
 * Small "add this to your home screen" tip for Safari, Chrome and Firefox.
 * Collapsed to one line so it stays out of the way; renders nothing when
 * the app is already running FROM the home screen (standalone mode), which
 * is exactly the case where the tip has done its job.
 */
export default function AddToHomeHint() {
  const [open, setOpen] = useState(false);
  if (isStandalone()) return null;

  return (
    <div>
      <button className="gn-textbtn" style={{ padding: "4px 0" }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        📲 Tip: add GameNight to your home screen {open ? "▴" : "▾"}
      </button>
      {open && (
        <div
          className="gn-hint space-y-1"
          style={{
            background: "var(--gn-surf)",
            border: "2px solid var(--gn-line)",
            borderRadius: "12px",
            padding: "10px 14px",
            marginTop: "4px",
          }}
        >
          <p>
            <b style={{ color: "var(--gn-ink)" }}>Safari</b> (iPhone/iPad): tap the Share button
            (the square with the up arrow), then <b>Add to Home Screen</b>.
          </p>
          <p>
            <b style={{ color: "var(--gn-ink)" }}>Chrome</b>: tap the <b>⋮</b> menu, then{" "}
            <b>Add to Home screen</b> (on iPhone: Share, then Add to Home Screen).
          </p>
          <p>
            <b style={{ color: "var(--gn-ink)" }}>Firefox</b>: tap the <b>⋮</b> menu, then{" "}
            <b>Add to Home screen</b> (on iPhone: Share, then Add to Home Screen).
          </p>
          <p style={{ opacity: 0.8 }}>It opens full-screen, like a real app. This tip disappears once you're in it.</p>
        </div>
      )}
    </div>
  );
}

/** True when launched from the home screen (installed PWA). */
function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

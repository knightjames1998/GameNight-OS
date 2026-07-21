import { useState } from "react";

/**
 * Small "install as an app" tip for Android (Chrome) and iPhone/iPad
 * (Safari). Collapsed to one line so it stays out of the way; renders
 * nothing when the app is already running FROM the home screen (standalone
 * mode), which is exactly the case where the tip has done its job.
 */
export default function AddToHomeHint() {
  const [open, setOpen] = useState(false);
  if (isStandalone()) return null;

  return (
    <div>
      <button className="gn-textbtn" style={{ padding: "4px 0" }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        📲 Tip: install GameNight as an app {open ? "▴" : "▾"}
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
            <b style={{ color: "var(--gn-ink)" }}>Android</b>: open GameNight in <b>Chrome</b> (it
            handles web apps and links best), tap the <b>⋮</b> menu, then <b>Install app</b>.
          </p>
          <p>
            <b style={{ color: "var(--gn-ink)" }}>iPhone/iPad</b>: in <b>Safari</b>, tap the Share
            button (the square with the up arrow), then <b>Add to Home Screen</b>.
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

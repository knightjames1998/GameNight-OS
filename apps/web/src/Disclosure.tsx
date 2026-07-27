import { useState, type ReactNode } from "react";

// One collapsed section, closed by default. The depth stats live behind this
// so the profile keeps its minimal-by-default shape and nothing new pushes
// into the always-visible tiles.
//
// A real <button> rather than a styled div, so it is tappable and reachable
// by keyboard for free, and it carries aria-expanded like the app's other
// disclosures (Friends, past game nights, the leaderboard rows).

export default function Disclosure({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="space-y-2">
      <button
        className="gn-textbtn w-full text-left"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 0",
          background: "transparent",
          border: 0,
          color: "var(--gn-ink)",
          fontWeight: 800,
        }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>{label}</span>
        <span className="gn-hint" style={{ fontSize: 11 }} aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && <div className="space-y-4">{children}</div>}
    </section>
  );
}

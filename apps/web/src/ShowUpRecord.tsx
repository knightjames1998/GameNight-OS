import { type AttendanceStats } from "./api";

// The show-up record, shared by the crew profile and your cross-crew stats.
//
// It lived inside MemberPage, which was fine while only that page rendered
// it. Now that MyStatsPage shows it too, importing it from MemberPage would
// pull that whole route's chunk into this one and partly undo the route
// splitting, so it lives here instead: one implementation, and each page
// only pays for what it uses.
//
// Flake tracking: intent (RSVP yes) vs reality (the show-up check-in, or
// silence). Hidden until there's something tracked so old profiles stay clean.

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** One stat tile. Shared for the same reason the record itself is. */
export function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        background: "var(--gn-raise)",
        border: "2px solid var(--gn-line)",
        borderRadius: "12px",
        padding: "10px 6px",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: "22px", color: accent ?? "var(--gn-ink)" }}>{value}</div>
      <div className="gn-hint" style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
    </div>
  );
}

export default function ShowUpRecord({ a }: { a?: AttendanceStats }) {
  if (!a || a.tracked === 0) return null;
  const rate = a.showRate ?? 0;
  const rateColor = rate >= 0.8 ? "var(--gn-p2)" : rate >= 0.5 ? "var(--gn-gold)" : "var(--gn-danger)";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="show rate" value={pct(rate)} accent={rateColor} />
        <Stat
          label="show streak"
          value={a.currentStreak >= 3 ? `${a.currentStreak} 🔥` : String(a.currentStreak)}
          accent={a.currentStreak >= 3 ? "var(--gn-gold)" : undefined}
        />
        <Stat
          label="flakes"
          value={String(a.flaked)}
          accent={a.flaked > 0 ? "var(--gn-danger)" : "var(--gn-p2)"}
        />
      </div>
      <p className="gn-hint" style={{ fontSize: "12px" }}>
        showed up to {a.showed} of {a.tracked} night{a.tracked === 1 ? "" : "s"} · best streak{" "}
        {a.bestStreak}
      </p>
    </div>
  );
}

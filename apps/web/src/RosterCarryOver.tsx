// WHERE THIS ROSTER CAME FROM, said out loud, on every setup screen.
//
// The prefill chain (see apps/server/src/event-prefill.ts) changed what nine
// screens open with: the last session's roster on this night, then who showed,
// then who said yes. THE LINE OF COPY IS PART OF THE FEATURE, not decoration. A
// host who is handed a roster they did not build and is not told where it came
// from cannot tell a carry-over from a bug, and "the app put four people in my
// blackjack game" is a support question rather than a nice surprise.
//
// AND THE WAY BACK IS ALWAYS OFFERED. Automatic beats a button for the common
// case, but the yes list is still the right answer some nights, and a host who
// has to delete six rows by hand to get to it has been given a worse screen than
// they had before.
//
// IT OWNS NO STATE AND APPLIES NO CAP. Each pack caps its own roster (Mario
// Party at 4, the title-night packs at their own `cap`, Deduction at
// SD_MAX_PLAYERS, and three that do not cap at all), and centralising that here
// would quietly change four screens. This hands slots over; the page decides.

export type PrefillSource = "session" | "attendance" | "rsvp";

/** The minimal roster row every pack's own slot type already satisfies. */
export interface CarrySlot {
  userId: string | null;
  name: string;
}

const same = (a: readonly CarrySlot[], b: readonly CarrySlot[]) =>
  a.length === b.length &&
  a.every((s, i) => s.userId === b[i]!.userId && s.name === b[i]!.name);

export default function RosterCarryOver({
  source,
  label,
  rsvpSlots,
  current,
  onUseRsvp,
}: {
  source: PrefillSource;
  /** The pack's display name when the source is a session, else "". */
  label: string;
  /** The yes list, which is what the button goes back to. */
  rsvpSlots: readonly CarrySlot[];
  /** The roster as it stands now, so this can stop talking once it is stale. */
  current: readonly CarrySlot[];
  onUseRsvp: (slots: CarrySlot[]) => void;
}) {
  // NOTHING TO SAY IN TWO CASES, and they are the same case from the reader's
  // side: the roster IS the yes list. Either the chain fell all the way through
  // to it, which is exactly what every screen did before this shipped and needs
  // no announcement, or the host has already tapped the button and the line
  // would now be describing a roster that is no longer on the screen.
  if (source === "rsvp" || same(current, rsvpSlots)) return null;

  const line =
    source === "session"
      ? `Same players as ${label || "the last game"}`
      : "Everyone who showed up";

  return (
    <div
      className="flex items-center justify-between gap-3 flex-wrap"
      style={{
        background: "color-mix(in srgb, var(--gn-p2) 10%, transparent)",
        border: "1px solid color-mix(in srgb, var(--gn-p2) 30%, transparent)",
        borderRadius: "10px",
        padding: "8px 12px",
        marginBottom: "10px",
      }}
    >
      <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--gn-p2)" }}>{line}</span>
      {rsvpSlots.length > 0 && (
        <button className="gn-textbtn" onClick={() => onUseRsvp([...rsvpSlots])}>
          use the yes list instead
        </button>
      )}
    </div>
  );
}

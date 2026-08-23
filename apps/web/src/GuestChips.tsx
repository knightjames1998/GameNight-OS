// GUEST NAMES THIS CREW HAS TYPED BEFORE, as one tap.
//
// Typed guests are per session and nothing remembered them, so "Mike", "mike"
// and "Mike D" are three people to the app and one person to the crew. The
// guest-link backfill then becomes a hunt through spellings that should have
// been one chip. THIS MAKES AN EXISTING FEATURE WORK RATHER THAN ADDING ONE:
// guest linking already works, and this is what stops it having to.
//
// It is the recent-titles pattern Board Game and Card Table already use for game
// names, pointed at guests instead. Newest first, and the server already
// de-duplicated case-insensitively keeping the most recent spelling, because
// that is the one the host last chose.
//
// It owns no state and applies no cap, for the same reason RosterCarryOver does
// not: the page owns its roster and its own limit.

export interface ChipSlot {
  userId: string | null;
  name: string;
}

export default function GuestChips({
  names,
  current,
  onAdd,
}: {
  /** Past guest names, newest first, as the launch context returned them. */
  names: readonly string[];
  /** The roster as it stands, so a name already sitting down is not offered. */
  current: readonly ChipSlot[];
  onAdd: (name: string) => void;
}) {
  // Case-insensitively, because the whole point is that a crew's "mike" and
  // "Mike" are one person: offering a chip for somebody already on the roster
  // under a different capitalisation is how a duplicate gets made by a feature
  // built to stop them.
  const taken = new Set(current.map((s) => s.name.trim().toLowerCase()));
  const offer = names.filter((n) => n.trim() && !taken.has(n.trim().toLowerCase()));
  if (offer.length === 0) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <p className="gn-hint" style={{ marginBottom: 6 }}>Guests you have had before</p>
      <div className="flex flex-wrap gap-2">
        {offer.map((name) => (
          <button
            key={name}
            className="gn-chipbtn"
            style={{
              background: "color-mix(in srgb, var(--gn-gold) 16%, transparent)",
              color: "var(--gn-gold)",
              textTransform: "none",
              fontSize: "12px",
            }}
            onClick={() => onAdd(name)}
          >
            + {name}
          </button>
        ))}
      </div>
    </div>
  );
}

import { useState } from "react";
import { PACK_GROUPS, type PackGroup } from "./packs";
import { packRoute, prefetch, type Importer } from "./prefetch";

// Shared "pick a game, then a format" chooser (Arcade). Used on the home
// quick-play screen and on the event page. Each game expands to its formats;
// the parent owns what each format does (navigate, start a bracket, etc.), so
// this component stays dumb. A game with exactly ONE format skips the
// expansion step entirely: the cab itself launches the format in one tap
// (e.g. Mario Party's board night, or a Tournament that's already live).

export interface PickerFormat {
  key: string;
  label: string;
  sub?: string;
  onPick: () => void;
  disabled?: boolean;
}
export interface PickerGame {
  key: string;
  name: string;
  emoji: string;
  cabClass?: string;
  /**
   * Which section this tile sits under. DISPLAY ONLY — see PACK_GROUPS in
   * packs.ts. Optional so a caller that builds a one-off list (a test, or a
   * future screen showing a single pack) does not have to care.
   */
  group?: PackGroup;
  sub?: string;
  formats: PickerFormat[];
}

/**
 * Start fetching the route chunk a tile leads to, on pointerdown, so it is
 * usually in flight before the tap completes. Resolved from the picker key
 * rather than passed in by every caller, which keeps this component dumb and
 * means Home and the event page do not each have to repeat the mapping for
 * every game and format they list. A format key wins over its game key, so
 * Beerio (a format under the Mario Kart tile) prefetches the Beerio chunk and
 * not the Mario Kart one. Unknown keys simply prefetch nothing.
 */
function warm(...keys: (string | undefined)[]) {
  for (const k of keys) {
    // The keys arriving here are format keys as well as pack keys ("koth",
    // "bestof", ...), so the lookup is deliberately open while the TABLE
    // itself stays complete by type. Widening it here rather than typing
    // packRoute loosely keeps the compile error where it is useful: on
    // adding a pack and forgetting to register its chunk.
    const route = k ? (packRoute as Record<string, Importer | undefined>)[k] : undefined;
    if (route) return prefetch(route);
  }
}

export default function GamePicker({ games }: { games: PickerGame[] }) {
  const [open, setOpen] = useState<string | null>(null);

  /**
   * Grouped in PACK_GROUPS order, with anything ungrouped falling to the end so
   * a caller-built list still renders rather than vanishing. An EMPTY group
   * draws nothing at all: that is what lets poker and pool land by setting one
   * field, with no divider appearing before there is anything under it.
   */
  const sections: { label: string; games: PickerGame[] }[] = PACK_GROUPS.map((g) => ({
    // Widened to string on purpose: the trailing ungrouped section carries no
    // caption, and PACK_GROUPS' labels are `as const`.
    label: g.label as string,
    games: games.filter((x) => x.group === g.key),
  })).filter((sec) => sec.games.length > 0);
  const ungrouped = games.filter((x) => !x.group || !PACK_GROUPS.some((g) => g.key === x.group));
  if (ungrouped.length > 0) sections.push({ label: "", games: ungrouped });

  return (
    <div className="space-y-2">
      {sections.map((sec, i) => (
        <div key={sec.label || `rest${i}`} className="space-y-2">
          {sec.label && (
            <div className="gn-pickgroup" role="presentation">
              <span>{sec.label}</span>
            </div>
          )}
          {sec.games.map((g) => (
            <Cab key={g.key} g={g} open={open} setOpen={setOpen} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** One cabinet, expanded or not. Unchanged behaviour; lifted out for grouping. */
function Cab({
  g,
  open,
  setOpen,
}: {
  g: PickerGame;
  open: string | null;
  setOpen: (k: string | null) => void;
}) {
  const single = g.formats.length === 1 ? g.formats[0] : null;
  if (single) {
    return (
      <button
        type="button"
        disabled={single.disabled}
        onPointerDown={() => !single.disabled && warm(single.key, g.key)}
        onClick={single.onPick}
        className={`gn-cab ${g.cabClass ?? ""} w-full text-left`}
        style={{ display: "block", ...(single.disabled ? { opacity: 0.55, cursor: "default" } : {}) }}
      >
        <span className="gn-cab__name">
          {g.emoji} {g.name}
        </span>
        <span className="gn-cab__sub">
          {/* The game's own sub wins when it is set, because the only thing
              that sets it is "this pack is live right now", which beats the
              format blurb. */}
          {single.disabled ? single.label : (g.sub ?? single.sub ?? single.label)}
        </span>
      </button>
    );
  }
  const isOpen = open === g.key;
  return (
    <div>
      <button
        type="button"
        onPointerDown={() => warm(g.key)}
        onClick={() => setOpen(isOpen ? null : g.key)}
        className={`gn-cab ${g.cabClass ?? ""} w-full text-left`}
        style={{ display: "block" }}
        aria-expanded={isOpen}
      >
        <span className="gn-cab__name">
          {g.emoji} {g.name}
        </span>
        <span className="gn-cab__sub">
          {isOpen ? "pick a format ▾" : (g.sub ?? "tap to pick a format ▸")}
        </span>
      </button>
      {isOpen && (
        <div className="gn-fmts">
          {g.formats.map((f) => (
            <button
              key={f.key}
              type="button"
              disabled={f.disabled}
              onPointerDown={() => !f.disabled && warm(f.key, g.key)}
              onClick={f.onPick}
              className="gn-fmt w-full text-left"
            >
              <span className="gn-fmt__name">{f.label}</span>
              {f.sub && <span className="gn-fmt__sub">{f.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

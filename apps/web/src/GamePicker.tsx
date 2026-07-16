import { useState } from "react";

// Shared "pick a game, then a format" chooser (Arcade). Used on the home
// quick-play screen and on the event page. Each game expands to its formats;
// the parent owns what each format does (navigate, start a bracket, etc.), so
// this component stays dumb. Games with a single format still read as
// game > format — e.g. Tournament expands to single/double elim, which is the
// "the format is the game" case.

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
  sub?: string;
  formats: PickerFormat[];
}

export default function GamePicker({ games }: { games: PickerGame[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {games.map((g) => {
        const isOpen = open === g.key;
        return (
          <div key={g.key}>
            <button
              type="button"
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
      })}
    </div>
  );
}

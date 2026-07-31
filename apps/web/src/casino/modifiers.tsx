import { useState } from "react";
import { drawForPack, modifierById, modifiersFor } from "@gamenight/shared";

// The MODIFIER UI for the casino group: the setup picker, the compact strip on
// the pack page, and the wall on the TV.
//
// THE LINE THESE SCREENS HOLD: the app displays and records modifiers, it never
// computes their effect (packages/shared/src/modifiers.ts spells out why). So
// every component here is a renderer. Nothing below touches a bet, a payout or
// a net, and the strip is deliberately READ-ONLY once a table is open — the
// cards were agreed before the first hand, and a rule that could change halfway
// through would make the recorded ids a lie about what the night was played
// under.
//
// WHY THE RULE TEXT IS ALWAYS ON SCREEN rather than behind a tap: the whole
// return on a modifier is that nobody has to remember it or ask. A name alone
// ("Silence") would be a reminder that something is on; the sentence is the
// thing people actually need at the table, so it rides along everywhere,
// including on the TV at a size readable across a room.

/** One card as a chip: kind sets the colour, severity the pip count. */
function pips(severity: number) {
  return "•".repeat(severity);
}

// ---------- setup: pick them ----------

export function ModifierPicker({
  ledger,
  value,
  onChange,
}: {
  /** The pack's LEDGER key ("blackjack"), which is what filters the deck. */
  ledger: string;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [browsing, setBrowsing] = useState(false);
  const pool = modifiersFor(ledger);
  const active = value.map((id) => modifierById(id)).filter((m) => !!m);

  const toggle = (id: string) =>
    // Kept in DECK ORDER rather than tap order, so the same three cards always
    // read the same way here, on the table and on the TV.
    onChange(
      value.includes(id)
        ? value.filter((x) => x !== id)
        : pool.filter((m) => m.id === id || value.includes(m.id)).map((m) => m.id),
    );

  return (
    <div className="cg-card">
      <div className="cg-h">House rules</div>
      <p className="cg-hint">
        Optional. Turn on the rules you&rsquo;re playing tonight and everyone can read them off
        the TV. The app shows them and records which were live &mdash; you apply them at the
        table, it never does the maths for you.
      </p>

      <div className="cg-seg" style={{ marginTop: 10 }}>
        {/* Two draws, not one. "Surprise me" REPLACES, because the usual tap is
            "give me a night, I don't mind which"; "one more" ADDS, excluding
            what is already on so it can never hand back a duplicate. */}
        <button onClick={() => onChange(drawForPack(ledger, 2).map((m) => m.id))}>
          🎲 Surprise me
        </button>
        <button
          disabled={active.length >= pool.length}
          onClick={() => {
            const [drawn] = drawForPack(ledger, 1, { exclude: value });
            if (drawn) onChange(pool.filter((m) => m.id === drawn.id || value.includes(m.id)).map((m) => m.id));
          }}
        >
          + One more
        </button>
        {active.length > 0 && <button onClick={() => onChange([])}>Clear</button>}
      </div>
      <p className="cg-hint" style={{ marginTop: 8 }}>
        A random draw leans towards the gentler cards, so the night-changing ones stay a
        surprise.
      </p>

      {active.length > 0 && (
        <div className="cg-mods" style={{ marginTop: 12 }}>
          {active.map((m) => (
            <div className={`cg-mod cg-mod--${m.kind}`} key={m.id}>
              <div className="cg-mod__top">
                <span className="cg-mod__n">{m.name}</span>
                <span className="cg-mod__sev" title={`Severity ${m.severity}`} aria-hidden="true">
                  {pips(m.severity)}
                </span>
                <button className="cg-textbtn" style={{ padding: 0 }} onClick={() => toggle(m.id)}>
                  remove
                </button>
              </div>
              <div className="cg-mod__r">{m.rule}</div>
            </div>
          ))}
        </div>
      )}

      <button className="cg-textbtn" style={{ marginTop: 8 }} onClick={() => setBrowsing(!browsing)}>
        {browsing ? "▴ Hide the deck" : `▾ Pick from the deck (${pool.length} cards)`}
      </button>
      {browsing && (
        <div className="cg-seg">
          {pool.map((m) => (
            <button
              key={m.id}
              className={value.includes(m.id) ? "on" : ""}
              aria-pressed={value.includes(m.id)}
              title={m.rule}
              onClick={() => toggle(m.id)}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- the live table: a compact strip ----------

export function ModifierStrip({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <div className="cg-card">
      <div className="cg-h" style={{ margin: 0 }}>
        House rules tonight
      </div>
      <div className="cg-mods" style={{ marginTop: 10 }}>
        {ids.map((id) => {
          const m = modifierById(id);
          // A card retired from the deck still has a live session pointing at
          // it. Render the id rather than a blank row.
          if (!m) return <div className="cg-mod" key={id}><div className="cg-mod__n">{id}</div></div>;
          return (
            <div className={`cg-mod cg-mod--${m.kind}`} key={id}>
              <div className="cg-mod__top">
                <span className="cg-mod__n">{m.name}</span>
                <span className="cg-mod__sev" aria-hidden="true">{pips(m.severity)}</span>
              </div>
              <div className="cg-mod__r">{m.rule}</div>
            </div>
          );
        })}
      </div>
      <p className="cg-hint" style={{ marginTop: 8 }}>
        Set when the table opened, and recorded against everyone here. You apply them; the app
        just remembers.
      </p>
    </div>
  );
}

// ---------- the TV: big enough to read from the sofa ----------

export function ModifierWall({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <div className="cg-tv__mods">
      {ids.map((id) => {
        const m = modifierById(id);
        return (
          <div className={`cg-tv__mod ${m ? `cg-tv__mod--${m.kind}` : ""}`} key={id}>
            <div className="cg-tv__mod__n">{m?.name ?? id}</div>
            {m && <div className="cg-tv__mod__r">{m.rule}</div>}
          </div>
        );
      })}
    </div>
  );
}

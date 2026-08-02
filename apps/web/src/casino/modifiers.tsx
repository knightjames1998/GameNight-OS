import { useState } from "react";
import {
  SEVERITY_LABEL,
  drawForPack,
  liveAtGame,
  modifierById,
  modifierGames,
  modifierRule,
  modifiersFor,
  severityPips,
  type Modifier,
} from "@gamenight/shared";

// The MODIFIER UI for the casino group: the setup picker, the compact strip on
// the pack page, and the wall on the TV.
//
// THE LINE THESE SCREENS HOLD: the app displays and records modifiers, it never
// computes their effect (packages/shared/src/modifiers.ts spells out why). So
// every component here is a renderer. Nothing below touches a bet, a payout or
// a net, and the strip is deliberately READ-ONLY once a table is open: the
// cards were agreed before the first hand, and a rule that could change halfway
// through would make the recorded ids a lie about what the night was played
// under.
//
// WHY THE RULE TEXT IS ALWAYS ON SCREEN rather than behind a tap: the whole
// return on a modifier is that nobody has to remember it or ask. A name alone
// ("Silence") would be a reminder that something is on; the sentence is the
// thing people actually need at the table, so it rides along everywhere,
// including on the TV at a size readable across a room.

/**
 * The severity pips, WITH A LEGEND ATTACHED.
 *
 * They shipped as one to three bare dots and nothing on any screen said what
 * they meant, which makes them decoration rather than information. Now they
 * are filled/empty out of three, they carry the label as a tooltip and as
 * screen-reader text, and every screen that draws them prints the key once.
 */
function Pips({ severity }: { severity: 1 | 2 | 3 }) {
  return (
    <span className="cg-mod__sev" title={SEVERITY_LABEL[severity]}>
      <span aria-hidden="true">{severityPips(severity)}</span>
      <span className="cg-sr">{SEVERITY_LABEL[severity]}</span>
    </span>
  );
}

/** The key, printed once per screen that shows pips. */
function PipLegend() {
  return (
    <p className="cg-hint cg-piplegend">
      <b>●○○</b> light &middot; <b>●●○</b> changes how you bet &middot; <b>●●●</b> reshapes the night
    </p>
  );
}

/**
 * A card's rule with any {bonus} resolved to a real figure.
 *
 * `unit` is the table's own stake. Casino Run passes its live minimum ante,
 * so these cards get dearer as it rises; the cash packs pass the default
 * buy-in. Without one the card still reads as a percentage rather than a gap.
 */
function ruleOf(m: Modifier, unit?: number | null, stakes?: "real" | "play", unitLabel?: string) {
  return modifierRule(m, {
    unit,
    unitLabel,
    fmt: (c) => `${stakes === "play" ? "P$" : "$"}${(c / 100).toFixed(2)}`,
  });
}

/**
 * WHICH GAMES a card is live on, when that is not "all of them".
 *
 * Only worth drawing where a table plays more than one game, which is Casino
 * Run, and only Casino Run. At a blackjack table every card in the pool is a
 * blackjack card by construction, so tagging them all would be noise.
 */
function GameTag({ mod }: { mod: Modifier }) {
  const games = modifierGames(mod);
  if (!games) return null;
  return <span className="cg-mod__game">{games}</span>;
}

/**
 * Split a pool into "every game" and one section per table.
 *
 * Order is deliberate: the cards that are always on come first, because they
 * are the ones a host picking blind should read. The per-table sections say
 * plainly that those cards sit out until that game is played.
 */
function groupPool(pool: Modifier[]): [string, Modifier[]][] {
  const anywhere = pool.filter((m) => m.appliesTo === "any" || m.appliesTo === "cash");
  const groups: [string, Modifier[]][] = [];
  if (anywhere.length) groups.push(["On at every game", anywhere]);
  const seen = new Set<string>();
  for (const m of pool) {
    if (!Array.isArray(m.appliesTo)) continue;
    for (const table of m.appliesTo) {
      if (seen.has(table)) continue;
      seen.add(table);
      const cards = pool.filter((c) => Array.isArray(c.appliesTo) && c.appliesTo.includes(table));
      groups.push([`${table.charAt(0).toUpperCase()}${table.slice(1)} legs only`, cards]);
    }
  }
  return groups;
}

// ---------- setup: pick them ----------

export function ModifierPicker({
  ledger,
  value,
  onChange,
  unit,
  stakes,
  unitLabel,
  showGames,
}: {
  /** The pack's LEDGER key ("blackjack"), which is what filters the deck. */
  ledger: string;
  value: string[];
  onChange: (ids: string[]) => void;
  /** The table's own unit in cents, so a card's bonus reads as a real figure. */
  unit?: number | null;
  stakes?: "real" | "play";
  /** What the percentages are OF: "ante" in a run, "buy-in" at a cash table. */
  unitLabel?: string;
  /** Tag each card with the games it is live on. Only a run needs this. */
  showGames?: boolean;
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

      {active.length > 0 && <PipLegend />}
      {active.length > 0 && (
        <div className="cg-mods" style={{ marginTop: 12 }}>
          {active.map((m) => (
            <div className={`cg-mod cg-mod--${m.kind}`} key={m.id}>
              <div className="cg-mod__top">
                <span className="cg-mod__n">{m.name}</span>
                {showGames && <GameTag mod={m} />}
                <Pips severity={m.severity} />
                <button className="cg-textbtn" style={{ padding: 0 }} onClick={() => toggle(m.id)}>
                  remove
                </button>
              </div>
              <div className="cg-mod__r">{ruleOf(m, unit, stakes, unitLabel)}</div>
            </div>
          ))}
        </div>
      )}

      <button className="cg-textbtn" style={{ marginTop: 8 }} onClick={() => setBrowsing(!browsing)}>
        {browsing ? "▴ Hide the deck" : `▾ Pick from the deck (${pool.length} cards)`}
      </button>
      {browsing && (
        /* GROUPED BY WHERE THEY BITE, not one flat list. A run's pool is 32
           cards spanning every table, and a wall of names gives no way to tell
           "on at every game" from "only when we play craps", which is the
           difference between a card that shapes the night and one that might
           never come up. */
        <>
          {groupPool(pool).map(([label, cards]) => (
            <div key={label} style={{ marginTop: 10 }}>
              <div className="cg-lab">{label}</div>
              <div className="cg-seg">
                {cards.map((m) => (
                  <button
                    key={m.id}
                    className={value.includes(m.id) ? "on" : ""}
                    aria-pressed={value.includes(m.id)}
                    title={`${ruleOf(m, unit, stakes, unitLabel)} · ${SEVERITY_LABEL[m.severity]}`}
                    onClick={() => toggle(m.id)}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ---------- the live table: a compact strip ----------

export function ModifierStrip({
  ids,
  unit,
  stakes,
  unitLabel,
  showGames,
  game,
}: {
  ids: string[];
  /** The table's own unit in cents, so a card's bonus reads as a real figure. */
  unit?: number | null;
  stakes?: "real" | "play";
  /** What the percentages are OF: "ante" in a run, "buy-in" at a cash table. */
  unitLabel?: string;
  /** Tag each card with the games it is live on. Only a run needs this. */
  showGames?: boolean;
  /** The game being played right now; cards that do not apply are dimmed. */
  game?: string;
}) {
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
          // Dimmed when a game is being played that this card is not live on.
          const dormant = !!game && !liveAtGame(m, game);
          return (
            <div className={`cg-mod cg-mod--${m.kind} ${dormant ? "cg-mod--dormant" : ""}`} key={id}>
              <div className="cg-mod__top">
                <span className="cg-mod__n">{m.name}</span>
                {showGames && <GameTag mod={m} />}
                <Pips severity={m.severity} />
              </div>
              <div className="cg-mod__r">{ruleOf(m, unit, stakes, unitLabel)}</div>
            </div>
          );
        })}
      </div>
      <PipLegend />
      <p className="cg-hint" style={{ marginTop: 8 }}>
        Set when the table opened, and recorded against everyone here. You apply them; the app
        just remembers.
      </p>
    </div>
  );
}

// ---------- the TV: big enough to read from the sofa, small enough to fit ----------

/**
 * IT HAS A BUDGET, AND THAT IS THE WHOLE DESIGN OF THIS COMPONENT.
 *
 * The money board is the feature; the rules are a reference. So the wall is
 * never allowed to grow without limit and push the board down. It gets denser
 * as cards are added instead. Measured on a 1080p screen, the first version of
 * this (three-across boxes, name over rule) cost 173px for ONE card against a
 * four-player layout that had 116px of slack, so it pushed the footer off the
 * bottom. This ladder makes that structurally impossible rather than unlikely:
 *
 *   1 or 2 cards  name and rule on ONE line, full size, one row. What
 *                 "Surprise me" produces, and the common night.
 *   3 or more     NAMES ONLY, packed as chips.
 *
 * THE CUT AT THREE IS FORCED, not a taste call, and it is worth writing down
 * because it looks needlessly strict. Three rules do not fit on one 1920px row
 * (the longest cards in the deck run ~60 characters), and a second row costs
 * ~135px against 116px of slack. That leaves three options: wrap and cover the
 * money board, ellipsis the rules mid-sentence, or drop them. Wrapping loses
 * the feature. A half-shown rule is worse than no rule, because it reads as
 * complete. So: the names stay on the TV as the reminder that something is on,
 * and the full text is one glance away on the strip on every phone at the
 * table. If the rules should survive to a higher count, the fix is not here:
 * it is the money board scaling with player count, which would buy the room
 * (see the TV overflow bug in BACKLOG; it already overflows at six players
 * with no modifiers at all).
 */
export function ModifierWall({
  ids,
  unit,
  stakes,
  unitLabel,
  game,
}: {
  ids: string[];
  unit?: number | null;
  stakes?: "real" | "play";
  unitLabel?: string;
  /** The game on the current leg; cards not live on it are dimmed. */
  game?: string;
}) {
  if (ids.length === 0) return null;
  const density = ids.length <= 2 ? "roomy" : "names";
  return (
    <div className="cg-tv__mods" data-density={density}>
      {ids.map((id) => {
        const m = modifierById(id);
        const dormant = !!m && !!game && !liveAtGame(m, game);
        return (
          <div
            className={`cg-tv__mod ${m ? `cg-tv__mod--${m.kind}` : ""} ${dormant ? "cg-tv__mod--dormant" : ""}`}
            key={id}
          >
            <span className="cg-tv__mod__n">{m?.name ?? id}</span>
            {m && density !== "names" && (
              <span className="cg-tv__mod__r">{ruleOf(m, unit, stakes, unitLabel)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Per-character breakdown for the personal profile views (a crew member's
// profile and your own cross-crew stats). Every character pack already stores
// the fighter/racer/character on each result; this is the read side of it.
//
// Unified by character NAME, so a character played across different titles is
// one line (standing rule). Packs with no characters (Beerio, Ping Pong,
// generic brackets) store null and contribute nothing, so this whole section
// hides itself rather than rendering an empty card.

export interface CharacterStats {
  byCharacter: { name: string; played: number; wins: number; winRate: number }[];
  /** Most games played. Null when nothing character-based has been recorded. */
  mostPlayed: string | null;
  /** Best win rate among characters with at least minGamesForBest games. */
  best: string | null;
  minGamesForBest: number;
}

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: "1px 6px",
        flexShrink: 0,
      }}
    >
      {text}
    </span>
  );
}

export default function CharacterStatsCard({ characters }: { characters?: CharacterStats }) {
  if (!characters || characters.byCharacter.length === 0) return null;
  const { byCharacter, mostPlayed, best, minGamesForBest } = characters;

  return (
    <section className="space-y-2">
      <h2 className="gn-h2">Characters</h2>
      <ul className="gn-card space-y-2" style={{ padding: "12px 16px" }}>
        {byCharacter.map((c) => (
          <li
            key={c.name}
            className="flex justify-between items-baseline"
            style={{ fontSize: 15, gap: 8 }}
          >
            <span
              className="truncate"
              style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
            >
              <span className="truncate" style={{ fontWeight: 700 }}>{c.name}</span>
              {c.name === mostPlayed && <Chip text="main" color="var(--gn-p2)" />}
              {c.name === best && <Chip text="best" color="var(--gn-gold)" />}
            </span>
            <span className="gn-hint" style={{ flexShrink: 0 }}>
              <span style={{ color: "var(--gn-ink)", fontWeight: 700 }}>{c.wins}</span>W / {c.played}
              {" · "}
              {Math.round(c.winRate * 100)}%
            </span>
          </li>
        ))}
      </ul>
      {best === null && (
        <p className="gn-hint" style={{ fontSize: 12 }}>
          Best needs {minGamesForBest} games on one character.
        </p>
      )}
    </section>
  );
}

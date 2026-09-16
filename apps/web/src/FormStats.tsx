// Recent form for the personal profile views: current win streak, longest
// win streak, the last five results as pips, and nights played.
//
// All of it is ordered by matches.playedAt, the completion time each pack
// stamps when it writes a result. Before that column existed there was no
// way to order results at all, so these stats are accurate from the deploy
// that added it forward.

export interface FormStats {
  currentStreak: number;
  longestStreak: number;
  /** The same walk inverted: "did not win" runs, shown under More stats. */
  currentLossStreak: number;
  longestLossStreak: number;
  /** Most recent first. Placement is null in packs that don't rank. */
  last5: { isWinner: boolean; placement: number | null }[];
  /** Results that carried a timestamp, so could be ordered at all. */
  tracked: number;
}

export function Pip({
  r,
  size = 26,
}: {
  r: { isWinner: boolean; placement: number | null };
  /** Smaller on the crew leaderboard, where pips sit inside a list row. */
  size?: number;
}) {
  const color = r.isWinner ? "var(--gn-gold)" : "var(--gn-dim)";
  return (
    <span
      title={r.isWinner ? "win" : r.placement ? `finished #${r.placement}` : "loss"}
      style={{
        width: size,
        height: size,
        borderRadius: size >= 26 ? 8 : 6,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size >= 26 ? 11 : 9,
        fontWeight: 800,
        color: r.isWinner ? "var(--gn-bg)" : color,
        background: r.isWinner ? color : "transparent",
        border: `1.5px solid ${color}`,
        flexShrink: 0,
      }}
    >
      {r.isWinner ? "W" : r.placement ? `#${r.placement}` : "L"}
    </span>
  );
}

function Cell({ n, label, accent }: { n: string; label: string; accent?: string }) {
  return (
    <div
      style={{
        flex: 1,
        textAlign: "center",
        background: "var(--gn-surf)",
        border: "1.5px solid var(--gn-line)",
        borderRadius: 14,
        padding: "12px 6px",
      }}
    >
      <div
        style={{
          fontFamily: "Fredoka, system-ui, sans-serif",
          fontWeight: 800,
          fontSize: 24,
          lineHeight: 1,
          color: accent ?? "var(--gn-ink)",
        }}
      >
        {n}
      </div>
      <div className="gn-hint" style={{ fontSize: 11, marginTop: 5 }}>
        {label}
      </div>
    </div>
  );
}

export default function FormStatsCard({
  form,
  nightsPlayed,
  series,
  tournaments,
}: {
  form?: FormStats;
  nightsPlayed?: number;
  /**
   * Smashdown series won / played. Rendered only when there are any, so a
   * crew that has never played the format sees exactly what it saw before
   * rather than a permanent "0 series" tile.
   */
  series?: { wins: number; played: number };
  /**
   * Tournaments entered and TITLES won, the word every surface uses for
   * winning one. Same hide-at-zero rule as `series`, and deliberately a
   * separate prop rather than a second field on it.
   */
  tournaments?: { titles: number; played: number; best: number | null; avgPlacement: number | null };
}) {
  if (!form || form.tracked === 0) return null;
  const { currentStreak, longestStreak, last5 } = form;
  const hot = currentStreak >= 3;

  return (
    <section className="space-y-2">
      <h2 className="gn-h2">Form</h2>
      <div className="flex gap-2">
        <Cell
          n={hot ? `${currentStreak} 🔥` : String(currentStreak)}
          label="win streak"
          accent={hot ? "var(--gn-gold)" : undefined}
        />
        <Cell n={String(longestStreak)} label="best streak" />
        {nightsPlayed !== undefined && <Cell n={String(nightsPlayed)} label="nights" />}
        {series && series.played > 0 && (
          <Cell n={`${series.wins}/${series.played}`} label="series won" />
        )}
        {/* TITLES, never folded into the cell above. A Smashdown set and a
            bracket night are different things to have won, and one cell
            claiming both would be the lie the split in stats.ts exists to
            prevent. The cell hides itself at zero, exactly as that one does,
            so a crew that has never run a tournament gains no empty tile. */}
        {tournaments && tournaments.played > 0 && (
          <Cell
            n={`${tournaments.titles}/${tournaments.played}`}
            label={tournaments.titles === 1 ? "title won" : "titles won"}
          />
        )}
      </div>
      {last5.length > 0 && (
        <div
          className="gn-card"
          style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}
        >
          <span className="gn-hint" style={{ fontSize: 12, flexShrink: 0 }}>
            last {last5.length}
          </span>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {last5.map((r, i) => (
              <Pip key={i} r={r} />
            ))}
          </span>
        </div>
      )}
    </section>
  );
}

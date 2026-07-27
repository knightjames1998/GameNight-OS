// The depth behind "More stats" on the personal profile views: where their
// finishes land, when they play, and the standout night. Everything here is
// derived server-side in the one shared aggregate, so a profile, your own
// stats and both sides of a rivalry all describe a player identically.
//
// Rendered only inside a collapsed disclosure: the always-visible tiles stay
// as they were, and this is the tap-for-more layer.

export interface PlacementStats {
  /** Results the packs actually ranked. The four counts below sum to this. */
  ranked: number;
  first: number;
  second: number;
  third: number;
  fourthPlus: number;
  firstShare: number | null;
  secondShare: number | null;
  thirdShare: number | null;
  fourthPlusShare: number | null;
  /** Played but never ranked, so the bars do not claim to cover everything. */
  unranked: number;
}

export interface HistoryStats {
  playingSince: string | null;
  gamesPerMonth: { month: string; played: number; wins: number }[];
  gamesPerNight: number | null;
  bestNight: {
    eventId: string;
    title: string;
    date: string | null;
    wins: number;
    played: number;
  } | null;
}

export interface GameExtreme {
  name: string;
  played: number;
  wins: number;
  winRate: number;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

const shortDate = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

/** Month label for the sparkline axis, e.g. "Jul". */
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
};

function Bar({ label, n, share, color }: { label: string; n: number; share: number | null; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="gn-hint" style={{ fontSize: 12, width: 46, flexShrink: 0 }}>
        {label}
      </span>
      <span
        style={{
          flex: 1,
          height: 10,
          borderRadius: 999,
          background: "var(--gn-line)",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${Math.round((share ?? 0) * 100)}%`,
            background: color,
          }}
        />
      </span>
      <span className="gn-hint" style={{ fontSize: 12, width: 62, flexShrink: 0, textAlign: "right" }}>
        {n}
        {share !== null ? ` · ${pct(share)}` : ""}
      </span>
    </div>
  );
}

function PlacementBlock({ p }: { p: PlacementStats }) {
  if (p.ranked === 0) {
    return (
      <p className="gn-hint" style={{ fontSize: 12 }}>
        Nothing ranked yet. Packs that only record a winner do not produce placements.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <Bar label="1st" n={p.first} share={p.firstShare} color="var(--gn-gold)" />
      <Bar label="2nd" n={p.second} share={p.secondShare} color="var(--gn-p2)" />
      <Bar label="3rd" n={p.third} share={p.thirdShare} color="var(--gn-p1)" />
      <Bar label="4th+" n={p.fourthPlus} share={p.fourthPlusShare} color="var(--gn-dim)" />
      {p.unranked > 0 && (
        <p className="gn-hint" style={{ fontSize: 11 }}>
          {p.unranked} more {p.unranked === 1 ? "result" : "results"} had no placement recorded.
        </p>
      )}
    </div>
  );
}

/** Bars, not a line: a sparkline of 12 months reads fine as small columns. */
function MonthlySpark({ months }: { months: HistoryStats["gamesPerMonth"] }) {
  const peak = Math.max(1, ...months.map((m) => m.played));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 48 }}>
        {months.map((m) => (
          <span
            key={m.month}
            title={`${m.month}: ${m.played} played, ${m.wins} won`}
            style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}
          >
            <span
              style={{
                display: "block",
                height: `${Math.round((m.played / peak) * 100)}%`,
                minHeight: m.played > 0 ? 3 : 0,
                background: m.played > 0 ? "var(--gn-p2)" : "transparent",
                borderRadius: 3,
              }}
            />
          </span>
        ))}
      </div>
      <div className="gn-hint" style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginTop: 4 }}>
        <span>{monthLabel(months[0]?.month ?? "")}</span>
        <span>{monthLabel(months[months.length - 1]?.month ?? "")}</span>
      </div>
    </div>
  );
}

export default function DeepStats({
  placements,
  history,
  bestGame,
  worstGame,
  lastPlaceCount,
  minGamesForExtremes,
}: {
  placements?: PlacementStats;
  history?: HistoryStats;
  bestGame?: GameExtreme | null;
  worstGame?: GameExtreme | null;
  lastPlaceCount?: number;
  minGamesForExtremes?: number;
}) {
  const since = shortDate(history?.playingSince ?? null);
  const played = history?.gamesPerMonth.some((m) => m.played > 0);

  return (
    <>
      {placements && (
        <section className="space-y-2">
          <h3 className="gn-h2" style={{ fontSize: 15 }}>Where they finish</h3>
          <PlacementBlock p={placements} />
          {lastPlaceCount !== undefined && lastPlaceCount > 0 && (
            <p className="gn-hint" style={{ fontSize: 12 }}>
              Dead last {lastPlaceCount} {lastPlaceCount === 1 ? "time" : "times"}.
            </p>
          )}
        </section>
      )}

      {(bestGame || worstGame) && (
        <section className="space-y-1">
          <h3 className="gn-h2" style={{ fontSize: 15 }}>Best and worst game</h3>
          {bestGame && (
            <p className="gn-hint" style={{ fontSize: 13 }}>
              Best <b style={{ color: "var(--gn-gold)" }}>{bestGame.name}</b>
              {" · "}
              {pct(bestGame.winRate)} over {bestGame.played}
            </p>
          )}
          {worstGame && (
            <p className="gn-hint" style={{ fontSize: 13 }}>
              Worst <b style={{ color: "var(--gn-ink)" }}>{worstGame.name}</b>
              {" · "}
              {pct(worstGame.winRate)} over {worstGame.played}
            </p>
          )}
          {!worstGame && minGamesForExtremes !== undefined && (
            <p className="gn-hint" style={{ fontSize: 11 }}>
              A game needs {minGamesForExtremes} games before it counts here.
            </p>
          )}
        </section>
      )}

      {history && (
        <section className="space-y-2">
          <h3 className="gn-h2" style={{ fontSize: 15 }}>History</h3>
          <p className="gn-hint" style={{ fontSize: 13 }}>
            {since ? <>Playing since {since}</> : "No dated games yet"}
            {history.gamesPerNight !== null && <> · {history.gamesPerNight.toFixed(1)} games a night</>}
          </p>
          {played && <MonthlySpark months={history.gamesPerMonth} />}
          {history.bestNight && (
            <p className="gn-hint" style={{ fontSize: 13 }}>
              Best night <b style={{ color: "var(--gn-ink)" }}>{history.bestNight.title}</b>
              {shortDate(history.bestNight.date) ? ` · ${shortDate(history.bestNight.date)}` : ""}
              {" · "}
              <b style={{ color: "var(--gn-gold)" }}>{history.bestNight.wins}</b> of {history.bestNight.played} won
            </p>
          )}
        </section>
      )}
    </>
  );
}

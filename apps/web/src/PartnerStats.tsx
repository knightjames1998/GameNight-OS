// Who you win with, shared by the crew profile and your cross-crew stats.
//
// Lives here rather than inside MemberPage for exactly the reason
// ShowUpRecord does: MyStatsPage renders it too, and importing it from
// MemberPage would pull that whole route's chunk into this one and partly
// undo the route splitting. One implementation, and each page only pays for
// what it uses.
//
// WHAT COUNTS AS A PARTNER, and it is narrower than "shared a side". `side`
// means three things in this ledger: a competitive TEAM (ping pong doubles,
// Double Dash karts, bracket team entrants), ONE co-op team holding the whole
// table (Casino Run), and a dealt FACTION (Social Deduction). Only the first is
// "who you win with". The server excludes the other two, so this block is about
// TEAM GAMES and says so on screen rather than quietly averaging a Werewolf
// faction into a doubles record.
//
// WHY THIS IS A TOP-LEVEL SECTION AND NOT INSIDE "More stats". The team
// primitive has shipped across five packs and, until this block, changed what
// the ledger RECORDED without changing anything anybody SAW. Burying the one
// screen that makes it visible inside a disclosure would leave it invisible,
// which is the exact gap the backlog entry was written about.

/** One partner row, exactly as partnersFor returns it. */
export interface PartnerRow {
  userId: string;
  displayName: string;
  /** Matches the two of you were on the same side of. */
  played: number;
  wins: number;
  winRate: number;
}

export interface PartnerStats {
  partners: PartnerRow[];
  mostPlayedWith: PartnerRow | null;
  bestPartner: PartnerRow | null;
  worstPartner: PartnerRow | null;
  /** The floor best and worst are held to. Printed, never assumed. */
  minGames: number;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

/**
 * The sample, always. A rate on its own is the thing this block exists to
 * avoid printing: "100% together" means one game as often as it means ten.
 */
const sample = (p: PartnerRow) => `${p.played} together · ${p.wins}W`;

/**
 * The heading says TEAM GAMES out loud, because the number underneath is not
 * "who you win with across everything you have played". Co-op runs and dealt
 * factions are excluded on the server, and a reader who has played a lot of
 * Werewolf would otherwise reasonably expect to see it here.
 */
function Heading() {
  return (
    <h2 className="gn-h2">
      Who you win with{" "}
      <span className="gn-hint" style={{ fontSize: "12px", fontWeight: 400 }}>
        team games
      </span>
    </h2>
  );
}

function Line({ labels, p, accent }: { labels: string[]; p: PartnerRow; accent?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 700, color: accent ?? "var(--gn-ink)" }}>{p.displayName}</span>
        <span className="gn-hint" style={{ fontSize: "12px" }}>
          {" "}
          {labels.join(" · ")}
        </span>
      </span>
      <span className="gn-hint" style={{ whiteSpace: "nowrap", fontSize: "12px" }}>
        {sample(p)} · {pct(p.winRate)}
      </span>
    </div>
  );
}

export default function PartnerStatsCard({ partners: s }: { partners?: PartnerStats }) {
  // The endpoint is older than this block on any client running a cached
  // bundle, so an absent key renders nothing rather than throwing.
  if (!s) return null;

  // THE EMPTY STATE IS THE COMMON CASE TODAY, not an edge. Only doubles ping
  // pong, Mario Kart pairs, Casino Run, Smash pairs and bracket team entrants
  // write a non-null side, so most crews have very few of these rows and many
  // have none. Saying so in one line beats rendering an empty box, and beats
  // hiding the section with no explanation: a reader who played a doubles
  // night and sees nothing here should be able to tell the difference between
  // "no team games" and "this app forgot".
  if (s.partners.length === 0) {
    return (
      <div className="gn-card space-y-2">
        <Heading />
        <p className="gn-hint">
          No team games recorded yet. Doubles ping pong, Double Dash karts and team
          brackets all count here.
        </p>
      </div>
    );
  }

  // Three lines maximum, in payoff order. ONE PERSON IS ONE LINE: your best
  // partner is very often also the person you have played with most, and
  // printing that name twice with two labels reads as a bug. Merging the
  // labels onto one line loses nothing, because each line already prints its
  // own sample.
  const order: { key: string; label: string; p: PartnerRow | null; accent?: string }[] = [
    { key: "best", label: "best partner", p: s.bestPartner, accent: "var(--gn-p2)" },
    { key: "most", label: "most played with", p: s.mostPlayedWith },
    { key: "worst", label: "worst partner", p: s.worstPartner, accent: "var(--gn-danger)" },
  ];
  const lines: { p: PartnerRow; labels: string[]; accent?: string }[] = [];
  for (const o of order) {
    if (!o.p) continue;
    const already = lines.find((l) => l.p.userId === o.p!.userId);
    if (already) already.labels.push(o.label);
    else lines.push({ p: o.p, labels: [o.label], accent: o.accent });
  }

  // Only "most played with" survived, which means nobody has cleared the
  // floor yet. Say why, or a crew two games into doubles reads the absence of
  // a "best partner" line as the feature being broken.
  const belowFloor = !s.bestPartner && s.partners.length > 0;

  return (
    <div className="gn-card space-y-2">
      <Heading />
      {lines.map((l) => (
        <Line key={l.p.userId} labels={l.labels} p={l.p} accent={l.accent} />
      ))}
      {belowFloor && (
        <p className="gn-hint" style={{ fontSize: "12px" }}>
          Best and worst partner need {s.minGames} games together.
        </p>
      )}
    </div>
  );
}

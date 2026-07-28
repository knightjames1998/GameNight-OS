import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { api, type BracketView, type BracketMatchView } from "../api";
import BackButton from "../BackButton";
import { useBracketLive } from "../useLiveUpdates";

// The Broadcast view. Design target: a 75" TV at couch distance. A full
// bracket tree is unreadable from across a room, so — like the Beerio pack's
// TV mode — this surfaces what actually matters live: the matchups on deck
// and the latest results, in type sized to read from the couch. Styled in
// the Arcade language; branded packs bring their own TV mode.

type TvView = BracketView & { groupName: string };
type Side = BracketView["rounds"][number]["side"];
type FlatMatch = BracketMatchView & { round: string; side: Side; depth: number };

export default function TvPage() {
  const { id } = useParams();
  const [bracket, setBracket] = useState<TvView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBracket(await api<TvView>(`/api/tv/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Was a second hand-rolled copy of the same socket, drifted from
  // BracketPage's: that one skipped its own echo and this one did not. Both
  // are on the shared hook now, which does skip. That is a no-op here rather
  // than a behaviour change, because the TV never writes anything, so its
  // client id can never come back as the origin of a broadcast. TVs sleep
  // too, and the hook refetches on visibility, same as before.
  useBracketLive(id, load);

  if (error) {
    return (
      <main className="gn-tv flex items-center justify-center">
        <p className="text-3xl" style={{ color: "var(--gn-danger)" }}>{error}</p>
      </main>
    );
  }
  if (!bracket) {
    return (
      <main className="gn-tv flex items-center justify-center">
        <p className="gn-hint text-3xl">Loading...</p>
      </main>
    );
  }

  const scoreUrl = `${window.location.origin}/b/${bracket.id}`;

  // Flatten every round into one list, carrying each match's bracket side and
  // its round depth within that side, so the on-deck list can be ordered.
  const all: FlatMatch[] = [];
  const depthSeen: Record<string, number> = {};
  for (const r of bracket.rounds) {
    const depth = (depthSeen[r.side] = (depthSeen[r.side] ?? 0) + 1);
    for (const m of r.matches) all.push({ ...m, round: r.title, side: r.side, depth });
  }

  // On deck: both seats filled, nobody has won yet. Order it by depth then
  // side (winners round 1, losers round 1, winners round 2, losers round 2,
  // and so on) with the grand final last, so the losers path never reads as
  // an afterthought.
  const sideRank: Record<Side, number> = { W: 0, L: 1, GF: 2 };
  const depthKey = (m: FlatMatch) => (m.side === "GF" ? 9999 : m.depth);
  const live = all
    .filter((m) => m.playable)
    .sort((x, y) => depthKey(x) - depthKey(y) || sideRank[x.side] - sideRank[y.side]);

  // Decided: real results (skip bye walkovers). "Latest" leans on structure
  // order (later rounds sit last), which reads as recency closely enough
  // without timestamps.
  const decided = all.filter((m) => m.decided && !m.auto);
  const latest = decided.slice(-6).reverse();
  const isChamp = bracket.champion?.kind === "player";

  return (
    <main className="gn-tv flex flex-col" style={{ padding: "calc(2.5rem + env(safe-area-inset-top, 0px)) calc(2.5rem + env(safe-area-inset-right, 0px)) calc(2.5rem + env(safe-area-inset-bottom, 0px)) calc(2.5rem + env(safe-area-inset-left, 0px))" }}>
      <header className="flex items-start justify-between gap-6 shrink-0">
        <div>
          <BackButton className="!text-lg mb-2 block" />
          <h1 className="gn-tv-title text-6xl">{bracket.gameName}</h1>
          <p className="text-2xl mt-3 flex items-center gap-4 flex-wrap" style={{ color: "var(--gn-dim)" }}>
            <span>
              {bracket.groupName} &middot; {bracket.entrantCount} players &middot;{" "}
              {bracket.format === "double_elim" ? "double elim" : "single elim"}
            </span>
            <span className="inline-flex items-center gap-2" style={{ color: "var(--gn-yes)" }}>
              <span className="gn-live-dot gn-pulse" />
              live
            </span>
          </p>
        </div>
        <div className="text-center shrink-0">
          <div className="bg-white p-2 rounded-lg">
            <QRCodeSVG value={scoreUrl} size={110} fgColor="#17111f" />
          </div>
          <p className="gn-hint text-sm mt-1">scan to score</p>
        </div>
      </header>

      {isChamp && (
        <div className="gn-tv-champ mt-8 px-8 py-6 text-center shrink-0">
          <p className="text-2xl uppercase tracking-widest" style={{ color: "var(--gn-gold)" }}>Champion</p>
          <p className="gn-tv-title text-7xl mt-2" style={{ color: "var(--gn-gold)" }}>
            {bracket.champion!.kind === "player" ? bracket.champion!.displayName : ""}
          </p>
        </div>
      )}

      <div className="gn-tv-cols">
        {!isChamp && (
          <section className="flex flex-col min-h-0">
            <h2 className="gn-tv-h2">On deck <span>{live.length} ready</span></h2>
            <div className="gn-tv-stack">
              {live.length === 0 ? (
                <p className="gn-tv-empty">Waiting on the next matchup…</p>
              ) : (
                live.slice(0, 5).map((m) => <TvMatch key={m.id} m={m} live />)
              )}
            </div>
          </section>
        )}

        <section className="flex flex-col min-h-0">
          <h2 className="gn-tv-h2">
            Latest results <span>{decided.length} played</span>
          </h2>
          <div className="gn-tv-stack">
            {latest.length === 0 ? (
              <p className="gn-tv-empty">No results yet.</p>
            ) : (
              latest.map((m) => <TvMatch key={m.id} m={m} />)
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function TvMatch({ m, live }: { m: FlatMatch; live?: boolean }) {
  const winnerSeed = m.winner?.kind === "player" ? m.winner.seed : null;
  // Slot B of the grand final is always the losers-bracket finalist, who has
  // to win the first set AND the reset. Make that visible on the big screen.
  const isFirstGf = m.side === "GF" && !m.reset;
  const isReset = m.side === "GF" && !!m.reset;
  const lbName = m.b.kind === "player" ? m.b.displayName : "the losers finalist";
  const rt = m.side === "GF" ? (isReset ? "Grand Final · Reset" : "Grand Final · Set 1") : m.round;
  return (
    <div className={`gn-tvm ${live ? "gn-tvm--live" : ""}`}>
      <div className="gn-tvm__rt">{rt}</div>
      <TvRow slot={m.a} decided={m.decided} winnerSeed={winnerSeed} />
      <div className="gn-tvm__div" />
      <TvRow slot={m.b} decided={m.decided} winnerSeed={winnerSeed} needs2={!!live && isFirstGf} />
      {live && isFirstGf && (
        <div className="gn-tvm__note">
          {lbName} came up through the losers bracket and must win twice: win this set to force a reset game for the title.
        </div>
      )}
      {live && isReset && <div className="gn-tvm__note">Reset game: winner takes the title.</div>}
    </div>
  );
}

function TvRow({
  slot,
  decided,
  winnerSeed,
  needs2,
}: {
  slot: BracketMatchView["a"];
  decided: boolean;
  winnerSeed: number | null;
  needs2?: boolean;
}) {
  const isPlayer = slot.kind === "player";
  const label = isPlayer ? slot.displayName : slot.kind === "bye" ? "bye" : "TBD";
  const won = decided && isPlayer && winnerSeed === slot.seed;
  const lost = decided && isPlayer && winnerSeed !== null && winnerSeed !== slot.seed;
  const tone = won ? "gn-tvm__row--win" : lost ? "gn-tvm__row--lose" : "";
  return (
    <div className={`gn-tvm__row ${tone}`}>
      <span className="gn-tvm__nm">{label}</span>
      {won ? (
        <span>🏆</span>
      ) : needs2 && isPlayer ? (
        <span className="gn-tvm__needs2">needs 2</span>
      ) : isPlayer ? (
        <span className="gn-tvm__seed">#{slot.seed}</span>
      ) : null}
    </div>
  );
}

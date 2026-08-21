import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  aliveBoard,
  buildDeck,
  loserSeedOf,
  roundStrip,
  type AliveBoard as AliveBoardShape,
  type DeckState,
  type SlotSource,
  type StripRound,
} from "@gamenight/shared";
import { api, slotTeam, type BracketView, type BracketMatchView } from "../api";
import { bracketTvBand, TV_DECK_SLICE } from "./tv-band";
import BackButton from "../BackButton";
import { useBracketLive } from "../useLiveUpdates";

// The Broadcast view. Design target: a 75" TV at couch distance. A full
// bracket tree is unreadable from across a room, so (like the Beerio pack's
// TV mode) this surfaces what actually matters live: the night's shape, the
// matchups on deck and who is still alive, in type sized to read from the
// couch. Styled in the Arcade language; branded packs bring their own TV mode.
//
// The three derivations it shares with Beerio Kart's TV (round order, the
// alive board, the round strip) live in @gamenight/shared, so the two boards
// cannot disagree about what comes next or about who is out.

type TvView = BracketView & { groupName: string };
type Side = BracketView["rounds"][number]["side"];
type FlatMatch = BracketMatchView & {
  round: string;
  side: Side;
  depth: number;
  /** 1-based position within its round, for the positional feeder label. */
  pos: number;
};

// The bracket id comes from /tv/:id, or from a prop when the event TV route
// (/e/:id/tv) renders this view inside itself because a tournament is what the
// night is currently playing.
export default function TvPage({ bracketId }: { bracketId?: string }) {
  const params = useParams();
  const id = bracketId ?? params.id;
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
  const rounds: StripRound[] = [];
  const depthSeen: Record<string, number> = {};
  for (const r of bracket.rounds) {
    const depth = (depthSeen[r.side] = (depthSeen[r.side] ?? 0) + 1);
    r.matches.forEach((m, i) => all.push({ ...m, round: r.title, side: r.side, depth, pos: i + 1 }));
    rounds.push({
      // The payload carries a title and a side, not a key; this is the same
      // shape Beerio's groups already use, and it only has to be unique.
      key: r.side === "GF" ? "GF" : `${r.side}${depth}`,
      title: r.title,
      side: r.side,
      depth,
      decided: r.matches.filter((m) => m.decided).length,
      total: r.matches.length,
      playable: r.matches.filter((m) => m.playable).length,
    });
  }

  const byId = new Map(all.map((m) => [m.id, m]));

  // ON DECK, and what enters it is the SHARED rule (buildDeck), not a filter
  // written here: a match with one seat known is on deck, and a blank-vs-blank
  // one is too when every feeder it waits on is playable right now. The old
  // "both seats filled" filter is why a losers R1 card could not exist yet
  // while the room was being shown a winners R2 matchup instead.
  //
  // The ORDER was never the problem and is unchanged: buildDeck sorts on the
  // same compareRoundOrder this list always used.
  const deckAll = buildDeck(
    all.map((m) => {
      const feeders = [m.aFrom, m.bFrom]
        .filter((src) => src.t !== "seed")
        .map((src) => byId.get((src as { m: string }).m));
      return {
        ...m,
        known: [m.a, m.b].filter((sl) => sl.kind === "player").length as 0 | 1 | 2,
        feedersLive: feeders.length > 0 && feeders.every((f) => !!f && f.playable),
      };
    }),
  );
  // THE HEADING KEEPS COUNTING READY MATCHES ONLY, off the deck entries rather
  // than off a second filter, so the number and the cards can never describe
  // two different lists. A pending card reordering the column never hides a
  // ready match from this count.
  const readyCount = deckAll.filter((d) => d.deck === "ready").length;

  // Who is still in it. `BracketMatchView` carries a, b and winner but no
  // loser, so the loser is whichever of the two the winner is not.
  const seedOf = (s: BracketMatchView["a"]) => (s.kind === "player" ? s.seed : null);
  const board = aliveBoard(
    Array.from({ length: bracket.entrantCount }, (_, i) => i + 1),
    all.map((m) => ({
      decided: m.decided,
      auto: m.auto,
      loser: loserSeedOf(seedOf(m.a), seedOf(m.b), m.winner ? seedOf(m.winner) : null),
    })),
    bracket.format === "double_elim" ? "double_elim" : "single_elim",
  );

  // Every entrant appears in the first winners round (a bye pairs them with
  // an empty slot rather than hiding them), so the slots are a complete name
  // table for the board's seeds.
  const nameOf = new Map<number, string>();
  for (const m of all) {
    for (const s of [m.a, m.b]) if (s.kind === "player") nameOf.set(s.seed, s.displayName);
  }

  const strip = roundStrip(rounds);
  const isChamp = bracket.champion?.kind === "player";

  // THE DENSITY LADDER. Both columns and the strip take their metrics from this
  // one attribute (see tv-band.ts and the [data-band] blocks in index.css); this
  // screen did not fit a 1080p television at any entrant count before it.
  const band = bracketTvBand({
    // CARDS DRAWN, not matches ready, and the difference is the point: a
    // pending card costs the column exactly what a ready one does, because it
    // is the same height (the feeder label rides in .gn-tvm__nm, which is
    // already one line with an ellipsis). Costing this at readyCount would
    // under-report the column by however many placeholders are up. The band
    // clamps to TV_DECK_SLICE.roomy itself, which is what stops this being
    // circular, so passing the full candidate count is safe and honest.
    entrants: bracket.entrantCount,
    ready: deckAll.length,
    gfNote: deckAll.some((m) => m.side === "GF"),
  });
  const deck = deckAll.slice(0, TV_DECK_SLICE[band]);

  return (
    <main className="gn-tv flex flex-col" data-band={band} style={{ padding: "calc(2.5rem + env(safe-area-inset-top, 0px)) calc(2.5rem + env(safe-area-inset-right, 0px)) calc(2.5rem + env(safe-area-inset-bottom, 0px)) calc(2.5rem + env(safe-area-inset-left, 0px))" }}>
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

      {/* The strip stays true after the night ends: every round done, which is
          the shape of the night that just happened. */}
      <RoundStrip cells={strip} />

      {/* THE CHAMPION PANEL WINS OVER THE BOARD. The alive board does not just
          become redundant once there is a winner, it becomes WRONG: "one loss,
          next one is out" is false after the last race, and in double elim the
          champion can be sitting in that very group, having come up through
          the losers bracket. So the board goes and the panel above is what the
          room is left looking at. */}
      {!isChamp && (
        <>
          <div className="gn-tv-cols">
            <section className="flex flex-col min-h-0">
              <h2 className="gn-tv-h2">On deck <span>{readyCount} ready</span></h2>
              <div className="gn-tv-stack">
                {deck.length === 0 ? (
                  <p className="gn-tv-empty">Waiting on the next matchup…</p>
                ) : (
                  deck.map((m) => <TvMatch key={m.id} m={m} live deck={m.deck} byId={byId} />)
                )}
              </div>
            </section>

            <section className="flex flex-col min-h-0">
              <h2 className="gn-tv-h2">
                Who&apos;s left <span>{board.stillIn} of {board.entrants}</span>
              </h2>
              <AliveBoard board={board} nameOf={nameOf} />
            </section>
          </div>
        </>
      )}
    </main>
  );
}

/**
 * Who is still in it, in groups. This replaced the "Latest results" column:
 * a result that just happened is already known to everyone in the room, and
 * the question a bracket night actually leaves open is who is still standing.
 *
 * SINGLE ELIM IS A DIFFERENT BOARD, not a double one with an empty middle:
 * one loss is out, so it reads "Still in" and "Out" and never shows a
 * one-loss group.
 */
function AliveBoard({
  board,
  nameOf,
}: {
  board: AliveBoardShape;
  nameOf: Map<number, string>;
}) {
  const single = board.format === "single_elim";
  const groups: { label: string; seeds: number[]; tone: string }[] = [
    { label: single ? "Still in" : "Unbeaten", seeds: board.unbeaten, tone: "clean" },
    ...(single ? [] : [{ label: "One loss, next one is out", seeds: board.oneLoss, tone: "one" }]),
    { label: "Out", seeds: board.out, tone: "out" },
  ];
  return (
    <div className="gn-tv-alive">
      {groups.map((g) =>
        g.seeds.length === 0 ? null : (
          <div key={g.label}>
            <p className="gn-tv-alive__lbl">
              {g.label} <span>{g.seeds.length}</span>
            </p>
            <div className="gn-tv-alive__row">
              {g.seeds.map((seed) => (
                <span key={seed} className={`gn-tva gn-tva--${g.tone}`}>
                  {nameOf.get(seed) ?? `Seed ${seed}`}
                </span>
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/**
 * The night's shape in one band: every round, in the SAME order the on-deck
 * list uses, with how far each one has got. State is the top edge rather than
 * a fill, so the band stays quiet under the two columns that carry the actual
 * reading. More than one round is lit at once in double elim, which is the
 * normal case rather than an edge one.
 */
function RoundStrip({ cells }: { cells: ReturnType<typeof roundStrip> }) {
  if (cells.length === 0) return null;
  return (
    <div className="gn-tv-strip">
      {cells.map((c) => (
        <div key={c.key} className={`gn-tvst gn-tvst--${c.state}`}>
          <div className="gn-tvst__nm">{c.title}</div>
          <div className="gn-tvst__n">{c.decided}/{c.total}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * What to call a seat nobody has won yet.
 *
 * "Loser of Ana vs Ben" when the feeder has both its own seats, which is the
 * label worth putting on a television: the two people who are about to decide
 * who walks into this match are named, so everyone involved can see it coming.
 * When the feeder is itself undecided there is nobody to name, so it falls
 * back to the position, "Loser of Winners R1 #2". The round title comes from
 * the payload, so Final, Semifinals, Winners Final and Losers Semis all read
 * correctly without a second naming rule living here.
 *
 * A `{ t: "seed" }` source cannot reach this: a seed slot is always resolved
 * to a player or a bye. If one ever does, it says TBD rather than inventing a
 * label out of a number that means something else.
 */
function feederLabel(src: SlotSource, byId: Map<string, FlatMatch>): string {
  if (src.t === "seed") return "TBD";
  const verb = src.t === "win" ? "Winner" : "Loser";
  const f = byId.get(src.m);
  if (!f) return "TBD";
  const a = f.a.kind === "player" ? f.a.displayName : null;
  const b = f.b.kind === "player" ? f.b.displayName : null;
  return a && b ? `${verb} of ${a} vs ${b}` : `${verb} of ${f.round} #${f.pos}`;
}

function TvMatch({
  m,
  live,
  deck,
  byId,
}: {
  m: FlatMatch;
  live?: boolean;
  deck?: DeckState;
  byId?: Map<string, FlatMatch>;
}) {
  const winnerSeed = m.winner?.kind === "player" ? m.winner.seed : null;
  // Slot B of the grand final is always the losers-bracket finalist, who has
  // to win the first set AND the reset. Make that visible on the big screen.
  const isFirstGf = m.side === "GF" && !m.reset;
  const isReset = m.side === "GF" && !!m.reset;
  const lbName = m.b.kind === "player" ? m.b.displayName : "the losers finalist";
  const rt = m.side === "GF" ? (isReset ? "Grand Final · Reset" : "Grand Final · Set 1") : m.round;
  return (
    // A PENDING CARD IS THE SAME HEIGHT AS A READY ONE, which is what lets
    // placeholders spend from the existing 4-card budget instead of extending
    // it. Colour and border carry the difference, both from tokens, and no
    // extra row is added.
    <div className={`gn-tvm ${live ? "gn-tvm--live" : ""} ${deck === "pending" ? "gn-tvm--pending" : ""}`}>
      <div className="gn-tvm__rt">{rt}</div>
      <TvRow slot={m.a} decided={m.decided} winnerSeed={winnerSeed} pending={byId && feederLabel(m.aFrom, byId)} />
      <div className="gn-tvm__div" />
      <TvRow slot={m.b} decided={m.decided} winnerSeed={winnerSeed} needs2={!!live && isFirstGf} pending={byId && feederLabel(m.bFrom, byId)} />
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
  pending,
}: {
  slot: BracketMatchView["a"];
  decided: boolean;
  winnerSeed: number | null;
  needs2?: boolean;
  /** What this seat is waiting on, when it is waiting on something. */
  pending?: string;
}) {
  const isPlayer = slot.kind === "player";
  // An unresolved seat names its feeder instead of saying TBD. It stays in
  // .gn-tvm__nm at the full name size, which is deliberate: the string
  // contains people's names, and TV_NAME_FLOOR_VMIN is asserted against the
  // stylesheet. One line either way, since that class is already nowrap with
  // an ellipsis.
  const label = isPlayer
    ? slot.displayName
    : slot.kind === "bye"
      ? "bye"
      : (pending ?? "TBD");
  const won = decided && isPlayer && winnerSeed === slot.seed;
  const lost = decided && isPlayer && winnerSeed !== null && winnerSeed !== slot.seed;
  const tone = won ? "gn-tvm__row--win" : lost ? "gn-tvm__row--lose" : "";
  const waiting = !isPlayer && slot.kind !== "bye" && !!pending;
  // A TEAM SLOT KEEPS ONE LINE ON THE BIG SCREEN, and that is a measurement
  // rather than a preference. An unnamed pair's label already IS its people
  // joined ("Ann + Ben"), so one line loses nothing; stacking them was tried
  // first and put this board 288px past 1080p at eight pairs and 297px at
  // sixteen (scripts/tv-fit.mjs, both counts, every state). A television cannot
  // be scrolled, so past 1080 is GONE, which is strictly worse than the ellipsis
  // a long name has always taken here. The one thing a stack buys is the second
  // line under a NAMED team, whose label does not say who is on it, and that
  // one line is what is kept.
  const team = slotTeam(slot);
  return (
    <div className={`gn-tvm__row ${tone} ${waiting ? "gn-tvm__row--waiting" : ""}`}>
      {team?.name ? (
        <span className="gn-tvm__team">
          <span className="gn-tvm__nm">{team.name}</span>
          <span className="gn-tvm__tmsub">{team.people.join(" + ")}</span>
        </span>
      ) : (
        <span className="gn-tvm__nm">{label}</span>
      )}
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

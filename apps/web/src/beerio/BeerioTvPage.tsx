import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  aliveBoard,
  buildDeck,
  type DeckState,
  // Beerio declares its own SlotSource in BeerioApp.tsx and does not export it.
  // The two are byte-for-byte the same union ({t:"seed";n} | {t:"win";m} |
  // {t:"lose";m}), checked rather than assumed, so the shared one types this
  // without an edit to the vendored file.
  type SlotSource,
  roundOrderFromKey,
  roundStrip,
  type RoundOrder,
  type StripRound,
} from "@gamenight/shared";
import {
  beerioGpBand,
  beerioTvBand,
  BEERIO_DECK_SLICE,
  BEERIO_QR_PX,
  type BeerioTvBand,
} from "./band";
import { racerLabel } from "./racer";
import { crowdSplit } from "./crowd";
import {
  buildBracket,
  compute,
  getChampion,
  gpStandings,
  isRealPlayer,
  type Bracket,
  type MatchResult,
  type SavedState,
} from "./BeerioApp";
import "./beerio.css";

// Beerio Kart TV mode. Reads the SAME public live-session endpoint the
// spectator view uses (/api/sessions/:code) and renders with the SAME
// engine functions the host runs, so the big screen can never disagree
// with the phones. Read-only, no login, designed for a 75" at couch
// distance: huge type, high contrast, no interaction.

const POLL_MS = 3000;

/** { spectatorId: { name, picks: { "M:<matchId>": "A"|"B", "H:<i>": "<seed>" } } } */
type PredMap = Record<string, { name?: string; picks?: Record<string, string> }>;

// The room code comes from /beerio/tv/:code, or from a prop when the event TV
// route renders this board in place because Beerio is what is on. This page is
// ours, not part of the vendored 1:1 port (BeerioApp.tsx / beerio.ts), so it
// may take a prop; it reads the same public endpoints either way.
export default function BeerioTvPage({ code: propCode }: { code?: string }) {
  const params = useParams();
  const code = propCode ?? params.code;
  const [state, setState] = useState<SavedState | null>(null);
  const [preds, setPreds] = useState<PredMap>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/sessions/${code}`);
      if (!r.ok) throw new Error("That live room doesn't exist (or the night ended).");
      const d = await r.json();
      setState(d.state as SavedState);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      return;
    }
    try {
      const p = await fetch(`/api/sessions/${code}/predictions`);
      if (p.ok) setPreds(((await p.json()).predictions ?? {}) as PredMap);
    } catch {
      // Predictions are a garnish; never let them break the board.
    }
  }, [code]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const joinUrl =
    typeof window !== "undefined" ? `${window.location.origin}/beerio?s=${code}` : "";

  if (error) {
    return (
      <Shell>
        <p className="text-[3vw] font-[Fredoka] font-bold text-[var(--ink)]">{error}</p>
      </Shell>
    );
  }
  if (!state) {
    return (
      <Shell>
        <p className="text-[3vw] font-[Fredoka] font-bold text-[var(--ink)] opacity-60">
          Connecting to the room...
        </p>
      </Shell>
    );
  }

  const isGP = state.format?.mode === "gp";
  // GRAND PRIX HAS ITS OWN LADDER NOW. It used to render at band="roomy"
  // HARDCODED, with the comment here claiming it "draws a fixed number of
  // standings rows and always has". It does not: it draws one per racer, and
  // nothing had ever measured it. 1148 / 1717 / 2286px at 4 / 8 / 12 racers,
  // so it has never fitted a television at any count. The band is computed from
  // the same payload the board draws and lifted to the shell so the header and
  // the page padding spend it too, which is where a quarter of this screen's
  // 1080px goes, exactly as the bracket board already did.
  const gpBand = beerioGpBand({
    racers: state.names.filter((n) => n && n.trim()).length,
    predictions: gpHasPredictions(state, preds),
  });
  return isGP ? (
    <Shell band={gpBand}>
      <Header code={String(code)} joinUrl={joinUrl} isGP band={gpBand} />
      <GpBoard state={state} preds={preds} />
    </Shell>
  ) : (
    <BracketBoard state={state} preds={preds} code={String(code)} joinUrl={joinUrl} />
  );
}

/**
 * Is the next-race prediction bar up?
 *
 * EXPORTED AS A FUNCTION so the BAND and the BOARD cannot disagree about it.
 * The band has to charge for the bar before the board renders it, and two
 * copies of "is anybody predicting" is exactly how a ladder ends up costing a
 * block that is not there, or not costing one that is.
 */
function gpHasPredictions(state: SavedState, preds: PredMap): boolean {
  const races = state.gpLog?.length ?? 0;
  const counts = tally(preds, `H:${races}`);
  return Object.values(counts).reduce((a, b) => a + b, 0) > 0;
}

/** Count spectator picks for one predictable item. */
function tally(preds: PredMap, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of Object.values(preds)) {
    const v = p?.picks?.[key];
    if (typeof v === "string") out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

/**
 * The crowd's call. Hidden until someone has voted.
 *
 * THE BAR CARRIES NO TEXT, and that is forced rather than chosen. The
 * percentage used to sit inside each segment in --ink on the racer's own
 * colour, where it cleared 4.5:1 on 17 of the 32 palette colours and on only
 * seven of the sixteen the app auto-assigns. See crowd.ts for the measurement
 * and for the two reasons that survive even if the palette is ever re-picked.
 * The bar is pure shape now: it answers "who did the crowd back" from the far
 * side of a room, which is the one job it was ever doing well.
 *
 * The number moved UP, to the label row, which sits on --foam where contrast
 * was never in question and which is legible on the screen today.
 *
 * EACH SHARE WEARS ITS RACER'S COLOUR AS A SWATCH, which is not decoration. The
 * row is sorted by share and the bar is drawn in board order, so a lopsided
 * card lists the leader first and paints the trailer's colour on the left. The
 * old percentage could not get that wrong because it sat ON the fill it
 * described; taking it out cut the tie, and the swatch is what puts it back.
 */
function PredictionBar({
  options,
  counts,
}: {
  options: { label: string; color: string; value: string }[];
  counts: Record<string, number>;
}) {
  const total = options.reduce((n, o) => n + (counts[o.value] ?? 0), 0);
  if (total === 0) return null;
  const split = crowdSplit(options, counts);
  return (
    <div className="beerio-tvpb">
      <div className="beerio-tvpb__l flex items-center justify-between gap-[1vw] font-[Fredoka] font-semibold text-[var(--ink)] opacity-70">
        <span className="shrink-0">Crowd says</span>
        <span className="beerio-tvpb__say">
          {split.kind === "agreed"
            ? `${split.total} ${split.total === 1 ? "vote" : "votes"}`
            : split.shares.map((s, i) => (
                // Index in the key because two racers CAN share a name, and the
                // order is deterministic (crowdSplit sorts, ties keep board
                // order), so it is stable across renders.
                <span key={i}>
                  {i > 0 && " · "}
                  <span className="beerio-tvpb__sw" style={{ background: s.color }} />
                  {s.label} {s.pct}%
                </span>
              ))}
          {split.kind === "split" && split.overflow > 0 && ` · +${split.overflow} more`}
        </span>
      </div>
      <div className="beerio-tvpb__bar flex rounded-full overflow-hidden border-[2px] border-[var(--ink)]">
        {options.map((o) => {
          const n = counts[o.value] ?? 0;
          if (n === 0) return null;
          return (
            <div
              key={o.value}
              style={{ width: `${(n / total) * 100}%`, background: o.color }}
            />
          );
        })}
      </div>
    </div>
  );
}

function Shell({ band = "roomy", children }: { band?: BeerioTvBand; children: React.ReactNode }) {
  // beerio-tv carries the ladder's variables and beerio-tv__shell spends the
  // two that are the page's own frame. The safe-area insets stay folded into
  // the padding calc (ADDING A PACK step 7: a TV that sets its own padding must,
  // because a class rule beats the zero-specificity shell inset).
  return (
    <div
      className="beerio-root beerio-tv beerio-tv__shell min-h-dvh w-full overflow-hidden flex flex-col"
      data-band={band}
    >
      {children}
    </div>
  );
}

function Header({ code, joinUrl, isGP, band }: { code: string; joinUrl: string; isGP: boolean; band: BeerioTvBand }) {
  return (
    <header className="flex items-start justify-between gap-6 shrink-0">
      <div>
        {/* beerio-tv-back is an unstyled hook. Standing rule 4 wants a way back
            on every screen and scripts/tv-fit.mjs measures to that control
            rather than to the footer, but its selector is
            `.gn-textbtn, .cg-tv__back` and this pack's back button is its own
            styled one rather than the shared BackButton component, so this
            screen reported "no button" and had its rule-4 check quietly skipped
            from the day the harness was written. */}
        <button
          onClick={() => { if (window.history.length > 1) history.back(); else location.href = "/"; }}
          className="beerio-tv-back mb-[0.6vw] px-[1.2vw] py-[0.4vw] rounded-[10px] border-[3px] border-[var(--ink)] bg-[var(--foam)] font-[Fredoka] font-semibold text-[1.1vw] text-[var(--ink)] shadow-[0_3px_0_rgba(22,35,59,.22)] cursor-pointer"
        >
          &larr; Back
        </button>
        <h1
          className="beerio-tv__brand font-[Luckiest_Guy,cursive] leading-none m-0 tracking-wide text-[var(--sun)]"
          style={{ WebkitTextStroke: "3px var(--ink)", transform: "rotate(-2deg)" }}
        >
          BEERIO KART
        </h1>
        <div className="beerio-tv__pill mt-[0.6vw] inline-flex items-center gap-3 font-[Fredoka] font-semibold text-[var(--ink)] bg-[var(--foam)] border-[3px] border-[var(--ink)] rounded-full shadow-[0_3px_0_rgba(22,35,59,.22)]">
          <span className="w-[0.8vw] h-[0.8vw] rounded-full bg-[var(--grass)] animate-pulse shadow-[0_0_0_2px_var(--ink)]" />
          LIVE &middot; Room {code} &middot; {isGP ? "Grand Prix" : "Double Elimination"}
        </div>
      </div>
      <div className="text-center shrink-0">
        <div className="bg-white p-[0.5vw] rounded-[10px] border-[3px] border-[var(--ink)]">
          <QRCodeSVG value={joinUrl} size={BEERIO_QR_PX[band]} />
        </div>
        <p className="font-[Fredoka] font-semibold text-[0.9vw] text-[var(--ink)] mt-1">scan to watch</p>
      </div>
    </header>
  );
}

// ---------- Grand Prix ----------

// No `band` prop: the Shell carries data-band and every --bt-gp-* variable
// below resolves off it. Threading it in as well would be a second source of
// truth for one attribute.
function GpBoard({ state, preds }: { state: SavedState; preds: PredMap }) {
  const realCount = state.names.filter((n) => n && n.trim()).length;
  const rows = useMemo(
    () => gpStandings(realCount, state.gpLog ?? []),
    [realCount, state.gpLog],
  );
  const races = state.gpLog?.length ?? 0;
  const nextKey = `H:${races}`;
  const counts = tally(preds, nextKey);
  // The same predicate the band was computed from, so the two cannot disagree
  // about whether this block costs anything.
  const voted = gpHasPredictions(state, preds);

  return (
    // beerio-tv-gp carries no styling: it is the stable hook scripts/tv-fit.mjs
    // proves this board actually rendered with, the same way beerio-tv-alive
    // serves the bracket board. Without one, a payload the page rejects draws
    // the short "Connecting to the room..." state, which fits trivially and
    // measures nothing.
    <div className="beerio-tv-gp flex-1 flex flex-col min-h-0">
      {voted && (
        <div className="beerio-tv-gp__pred border-[3px] border-[var(--ink)] rounded-[14px] bg-[var(--foam)] shadow-[0_4px_0_rgba(22,35,59,.18)]">
          <p className="beerio-tv-gp__predlbl font-[Fredoka] font-bold text-[var(--ink)] px-[1.2vw]">
            Race {races + 1} &middot; who takes it?
          </p>
          <PredictionBar
            options={rows.map((r) => ({
              label: racerLabel(r.seed + 1, state.names[r.seed]),
              color: state.colors?.[r.seed] ?? "var(--foam)",
              value: String(r.seed),
            }))}
            counts={counts}
          />
        </div>
      )}
      <h2 className="beerio-tv-gp__h2 font-[Fredoka] font-bold text-[var(--ink)]">
        Standings <span className="opacity-60">&middot; {races} races in</span>
      </h2>
      <div className="beerio-tv-gp__stack">
        {rows.map((r) => {
          const color = state.colors?.[r.seed] ?? "var(--foam)";
          const leader = r.rank === 1 && races > 0;
          return (
            <div
              key={r.seed}
              className="beerio-tv-gp__row border-[3px] border-[var(--ink)] rounded-[14px] shadow-[0_4px_0_rgba(22,35,59,.18)]"
              style={{ background: leader ? "var(--sun)" : "var(--foam)" }}
            >
              <span className="beerio-tv-gp__rank font-[Luckiest_Guy,cursive] text-[var(--ink)]">
                {r.rank}
              </span>
              <span
                className="beerio-tv-gp__dot rounded-full border-[3px] border-[var(--ink)] shrink-0"
                style={{ background: color }}
              />
              <span className="beerio-tv-gp__nm font-[Fredoka] font-bold text-[var(--ink)] flex-1 truncate">
                {racerLabel(r.seed + 1, state.names[r.seed])}
              </span>
              <span className="beerio-tv-gp__sub font-[Fredoka] text-[var(--ink)] opacity-70">
                {r.wins} {r.wins === 1 ? "win" : "wins"} &middot; {r.races} raced
              </span>
              <span className="beerio-tv-gp__pts font-[Luckiest_Guy,cursive] text-[var(--ink)] text-right">
                {r.points}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Double elimination ----------

/**
 * Where a Beerio match sits in the night, for the SHARED comparator.
 *
 * `def.grp` is already exactly the key shape that parse understands (`W{r}`,
 * `L{lr}`, `GF`), and this pack's losers rounds are numbered the same way the
 * generic engine's are, so the depth lines up with the shell TV's behaviour
 * rather than only looking like it does. A key that does not parse sorts last
 * rather than silently sorting first.
 */
const orderOf = (key: string): RoundOrder => roundOrderFromKey(key) ?? { side: "GF", depth: 1 };

function BracketBoard({
  state,
  preds,
  code,
  joinUrl,
}: {
  state: SavedState;
  preds: PredMap;
  code: string;
  joinUrl: string;
}) {
  const { BR, M } = useMemo(() => {
    try {
      const b = buildBracket(state.playerCount);
      return { BR: b as Bracket | null, M: compute(b, state.names, state.results ?? {}) };
    } catch {
      return { BR: null, M: {} as Record<string, MatchResult> };
    }
  }, [state.playerCount, state.names, state.results]);

  const all = Object.values(M).filter((m) => m.active && !m.phantom);
  const champ = getChampion(M);

  // Where a match sits, for the positional feeder label ("Loser of Winners R1
  // #2") when the feeder is itself undecided and there is nobody to name.
  const place = new Map<string, { title: string; pos: number }>();
  for (const g of BR?.groups ?? []) {
    g.ids.forEach((id, i) => place.set(id, { title: g.title, pos: i + 1 }));
  }

  // UP NEXT, and what enters it is the SHARED rule (buildDeck), the same one
  // the shell's TV uses, so the two boards cannot disagree about what comes
  // next. The old filter wanted both seats filled, which is why a losers R1
  // card could not exist yet while this screen showed a winners R2 matchup
  // instead. The ORDER is unchanged: same comparator, same coordinates.
  const deckAll = buildDeck(
    all.map((m) => {
      const feeders = [m.def.a, m.def.b]
        .filter((src) => src.t !== "seed")
        .map((src) => M[(src as { m: string }).m]);
      return {
        ...m,
        ...orderOf(m.def.grp),
        known: ((isRealPlayer(m.a) ? 1 : 0) + (isRealPlayer(m.b) ? 1 : 0)) as 0 | 1 | 2,
        feedersLive:
          feeders.length > 0 &&
          feeders.every((f) => !!f && !f.decided && isRealPlayer(f.a) && isRealPlayer(f.b)),
      };
    }),
  );

  // Who is still in it. Everyone with a typed name is an entrant; a seat left
  // blank is a bye, and compute() already resolves it as one.
  const entrants = state.names.flatMap((n, i) => (n && n.trim() ? [i + 1] : []));
  const board = aliveBoard(
    entrants,
    all.map((m) => ({
      decided: m.decided,
      auto: m.auto,
      loser: isRealPlayer(m.loser) ? m.loser.seed : null,
    })),
    // Beerio's bracket mode is always double elim; Grand Prix is a different
    // board entirely and never reaches here.
    "double_elim",
  );

  const strip = roundStrip(
    (BR?.groups ?? []).flatMap((g): StripRound[] => {
      const ms = g.ids.flatMap((id) => {
        const m = M[id];
        return m && m.active && !m.phantom ? [m] : [];
      });
      if (ms.length === 0) return [];
      return [{
        key: g.key,
        title: g.title,
        ...orderOf(g.key),
        decided: ms.filter((m) => m.decided).length,
        total: ms.length,
        playable: ms.filter((m) => !m.decided && isRealPlayer(m.a) && isRealPlayer(m.b)).length,
      }];
    }),
  );

  // THE DENSITY LADDER. The header is on it too, which is what this screen
  // needed that the shell TV's did not: 561px of the 1080 went on chrome before
  // a racer was drawn, most of it the wordmark and the QR beside it.
  const anyVotes = Object.values(preds).some((p) => p?.picks && Object.keys(p.picks).length > 0);
  const band = beerioTvBand({
    // CARDS DRAWN, not matches ready. A pending card is the same height as a
    // ready one, so it costs the column the same; counting only the ready ones
    // would under-report the column by however many placeholders are up.
    // beerioTvBand clamps to BEERIO_DECK_SLICE.roomy itself, so this is not
    // circular.
    entrants: entrants.length,
    ready: deckAll.length,
    predictions: anyVotes,
  });
  const deck = deckAll.slice(0, BEERIO_DECK_SLICE[band]);

  return (
    <Shell band={band}>
      <Header code={code} joinUrl={joinUrl} isGP={false} band={band} />
      <div className="beerio-tv__cols flex-1 flex flex-col min-h-0">
      <RoundStrip cells={strip} />
      <div className="flex-1 grid grid-cols-2 gap-[2vw] min-h-0">
        <section className="flex flex-col min-h-0">
          <h2 className="beerio-tv__h2 font-[Fredoka] font-bold text-[var(--ink)]">Up next</h2>
          <div className="beerio-tv__deck flex flex-col overflow-hidden">
            {deck.length === 0 && (
              <p className="font-[Fredoka] text-[1.4vw] text-[var(--ink)] opacity-50">
                Waiting on the next matchup...
              </p>
            )}
            {deck.map((m) => (
              <MatchCard
                key={m.def.id}
                m={m}
                state={state}
                preds={preds}
                highlight
                deck={m.deck}
                feeder={(side) => feederLabel(side === "a" ? m.def.a : m.def.b, M, state, place)}
              />
            ))}
          </div>
        </section>

        <section className="flex flex-col min-h-0">
          <h2 className="beerio-tv__h2 font-[Fredoka] font-bold text-[var(--ink)]">
            {champ ? "Champion" : (
              <>
                Who&apos;s left{" "}
                <span className="opacity-60">
                  &middot; {board.stillIn} of {board.entrants}
                </span>
              </>
            )}
          </h2>
          {/* THE CHAMPION PANEL STILL WINS. When there is a champion, that is
              what the room wants to see, not a standings board with one name
              in the unbeaten row. */}
          {champ ? (
            <div className="border-[4px] border-[var(--ink)] rounded-[18px] bg-[var(--sun)] px-[2vw] py-[2vw] text-center shadow-[0_6px_0_rgba(22,35,59,.22)]">
              <p className="font-[Fredoka] font-bold text-[1.5vw] text-[var(--ink)] uppercase tracking-widest">
                Champion
              </p>
              <p className="font-[Luckiest_Guy,cursive] text-[5vw] text-[var(--ink)] leading-tight mt-[0.5vw]">
                {racerLabel(champ.seed, champ.name)}
              </p>
            </div>
          ) : (
            <AliveBoard board={board} state={state} />
          )}
        </section>
      </div>
      </div>
    </Shell>
  );
}

// ---------- The still-alive board ----------

/**
 * Who is still in it, in three groups. This replaced the "Just finished"
 * column: a result that just happened is already on the phones and already
 * cheered, and what a room actually asks across a night is who is still
 * standing and who is one race from going home.
 */
function AliveBoard({
  board,
  state,
}: {
  board: ReturnType<typeof aliveBoard>;
  state: SavedState;
}) {
  const groups: { label: string; seeds: number[]; tone: "clean" | "one" | "out" }[] = [
    { label: "Unbeaten", seeds: board.unbeaten, tone: "clean" },
    { label: "One loss, next one is out", seeds: board.oneLoss, tone: "one" },
    { label: "Out", seeds: board.out, tone: "out" },
  ];
  return (
    // beerio-tv-alive carries no styling: it is the stable hook scripts/tv-fit.mjs
    // proves this board rendered by. Every other pack's TV has a class name to
    // point at and this one is all utility classes, which is why it needs one.
    <div className="beerio-tv-alive flex flex-col overflow-hidden">
      {groups.map((g) =>
        g.seeds.length === 0 ? null : (
          <div key={g.label}>
            <p className="beerio-tv-alive__lbl font-[Fredoka] font-bold text-[var(--ink)] opacity-70 uppercase tracking-wide">
              {g.label} &middot; {g.seeds.length}
            </p>
            <div className="beerio-tv-alive__row flex flex-wrap">
              {g.seeds.map((seed) => (
                <RacerChip key={seed} seed={seed} tone={g.tone} state={state} />
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function RacerChip({
  seed,
  tone,
  state,
}: {
  seed: number;
  tone: "clean" | "one" | "out";
  state: SavedState;
}) {
  // Bracket seeds are 1-based; the colors array is 0-based.
  const color = state.colors?.[seed - 1] ?? "var(--foam)";
  const name = racerLabel(seed, state.names[seed - 1]);
  const out = tone === "out";
  return (
    <span
      className={`beerio-tva inline-flex items-center border-[3px] rounded-full font-[Fredoka] font-bold text-[var(--ink)] max-w-full ${
        out ? "border-dashed opacity-45" : "shadow-[0_3px_0_rgba(22,35,59,.18)]"
      }`}
      style={{
        background: tone === "one" ? "var(--sun)" : "var(--foam)",
        borderColor: tone === "clean" ? "var(--grass)" : "var(--ink)",
      }}
    >
      <span
        className="beerio-tva__dot rounded-full border-[3px] border-[var(--ink)] shrink-0"
        style={{ background: color }}
      />
      <span className={`truncate ${out ? "line-through" : ""}`}>{name}</span>
    </span>
  );
}

// ---------- The round strip ----------

/**
 * The night's shape in one band: every round, in the same order the Up next
 * list uses, with how far each one has got. STATE IS THE TOP EDGE rather than
 * a fill, so the band stays quiet under the two columns that carry the
 * actual reading. More than one round is lit at once in double elim, which is
 * the normal case rather than an edge one.
 */
function RoundStrip({ cells }: { cells: ReturnType<typeof roundStrip> }) {
  if (cells.length === 0) return null;
  return (
    // beerio-tv-strip: the same unstyled hook the alive board carries, and the
    // one scripts/tv-fit.mjs uses as its render proof for this route.
    <div className="beerio-tv-strip flex shrink-0">
      {cells.map((c) => {
        const now = c.state === "now";
        const done = c.state === "done";
        return (
          <div
            key={c.key}
            className={`beerio-tvst flex-1 min-w-0 bg-[var(--foam)] border-[3px] border-[var(--ink)] rounded-[10px] ${
              done ? "opacity-50" : ""
            }`}
            style={{ borderTopColor: now ? "var(--grass)" : "var(--ink)" }}
          >
            <div className="beerio-tvst__nm font-[Fredoka] font-bold text-[var(--ink)] truncate">
              {c.title}
            </div>
            <div className="beerio-tvst__n font-[Fredoka] font-semibold text-[var(--ink)] opacity-70">
              {c.decided}/{c.total}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * What to call a seat nobody has won yet, in this pack's own voice.
 *
 * Same rule as the shell TV's: name the two racers about to decide it when the
 * feeder has both its seats, and fall back to the position when it does not.
 * The titles come from BR.groups, so "Loser of Winners Semis #2" reads the way
 * the round strip above it already reads.
 */
function feederLabel(
  src: SlotSource,
  M: Record<string, MatchResult>,
  state: SavedState,
  place: Map<string, { title: string; pos: number }>,
): string {
  if (src.t === "seed") return "TBD";
  const verb = src.t === "win" ? "Winner" : "Loser";
  const f = M[src.m];
  if (!f) return "TBD";
  if (isRealPlayer(f.a) && isRealPlayer(f.b)) {
    return `${verb} of ${racerLabel(f.a.seed, state.names[f.a.seed - 1])} vs ${racerLabel(f.b.seed, state.names[f.b.seed - 1])}`;
  }
  const p = place.get(src.m);
  return p ? `${verb} of ${p.title} #${p.pos}` : "TBD";
}

function MatchCard({
  m,
  state,
  preds,
  highlight,
  deck,
  feeder,
}: {
  m: MatchResult;
  state: SavedState;
  preds: PredMap;
  highlight?: boolean;
  deck?: DeckState;
  feeder?: (side: "a" | "b") => string;
}) {
  const Row = ({ side }: { side: "a" | "b" }) => {
    const c = m[side];
    const real = isRealPlayer(c);
    // Bracket seeds are 1-based; the colors array is 0-based.
    const colorIdx = real ? c.seed - 1 : undefined;
    // A seat still being decided names its feeder instead of saying TBD. It
    // stays in .beerio-tvm__nm at the full name size, which is already one
    // line with `truncate`, so a pending card is exactly the height of a ready
    // one and spends from the same deck budget rather than extending it.
    const label = real ? racerLabel(c.seed, c.name) : (feeder?.(side) ?? "TBD");
    const won = m.decided && m.winSlot === (side === "a" ? "A" : "B");
    const lost = m.decided && !won && real;
    return (
      <div
        className="beerio-tvm__row flex items-center"
        style={{ background: won ? "rgba(94,193,109,0.25)" : "transparent" }}
      >
        <span
          className="beerio-tvm__dot rounded-full border-[3px] border-[var(--ink)] shrink-0"
          style={{ background: colorIdx !== undefined ? (state.colors?.[colorIdx] ?? "var(--foam)") : "transparent" }}
        />
        <span
          className={`beerio-tvm__nm font-[Fredoka] font-bold text-[var(--ink)] flex-1 truncate ${
            lost ? "opacity-40 line-through" : ""
          } ${!real ? "opacity-55" : ""}`}
        >
          {label}
        </span>
        {won && <span className="text-[1.6vw]">🏆</span>}
      </div>
    );
  };

  return (
    // PENDING READS AS PENDING through the border alone, in this pack's own
    // language: a dashed ink edge instead of the grass one a ready card gets.
    // No extra row and no height change, which is what keeps the deck budget
    // honest.
    <div
      className={`border-[3px] border-[var(--ink)] rounded-[14px] overflow-hidden bg-[var(--foam)] shadow-[0_4px_0_rgba(22,35,59,.18)] ${
        deck === "pending" ? "border-dashed" : ""
      }`}
      style={highlight && deck !== "pending" ? { borderColor: "var(--grass)" } : undefined}
    >
      <Row side="a" />
      <div className="border-t-[3px] border-[var(--ink)]" />
      <Row side="b" />
      {highlight && isRealPlayer(m.a) && isRealPlayer(m.b) && (
        <PredictionBar
          options={[
            {
              label: m.a.name ?? "A",
              color: state.colors?.[m.a.seed - 1] ?? "var(--foam)",
              value: "A",
            },
            {
              label: m.b.name ?? "B",
              color: state.colors?.[m.b.seed - 1] ?? "var(--foam)",
              value: "B",
            },
          ]}
          counts={tally(preds, `M:${m.def.id}`)}
        />
      )}
    </div>
  );
}

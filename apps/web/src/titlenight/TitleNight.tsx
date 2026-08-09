import { useEffect, useMemo, useState } from "react";
import { tnTitleSuggestions, type TitleNightConfig } from "@gamenight/shared";
import type { PackCtx } from "../usePackSession";
import "./titlenight.css";

// The TITLE-NIGHT group's screens: everything Board Game and Card Table do
// identically, which is everything below the header.
//
// A title night is one shape of evening: a crew sits down, somebody says what
// is being played, people finish in an order, and that repeats until the night
// ends. Board Game and Card Table are the same evening with a different box on
// the table, so they are the same screens with a different palette and a
// different curated list, exactly as blackjack and roulette are the same money
// board with a different accent.
//
// WHAT STAYS IN THE PACK PAGE, on purpose, and it is the casino group's split:
//   - the root element and the BACKDROP (a pack's identity is its own),
//   - the header, because the two-ways-out standing rule is checked per screen
//     and a shared header would make that check unfalsifiable,
//   - the brand lettering and the tagline under it,
//   - which curated list, which cap, which partnership defaults: the config.
//
// THE ORDER IS THE PLACEMENT, everywhere below. Nothing on these screens
// derives a finish from a number, and the optional score box says so out loud,
// because a title night includes games where high wins, games where low wins,
// and games with no score at all. A typed score that disagrees with the tapped
// order is allowed to stand.

/** The launch context, plus the crew's own title history. */
export interface TnCtx extends PackCtx {
  recentTitles: string[];
}

export interface TnSlot {
  id: string;
  kind: "member" | "guest";
  userId: string | null;
  name: string;
}

export interface TnLineView {
  playerId: string;
  placement: number;
  isWinner: boolean;
  score: number | null;
}

export interface TnSummaryView {
  players: { playerId: string; name: string; games: number; wins: number; avgPlacement: number | null }[];
  titles: { title: string; games: number }[];
  last: { title: string; lines: { name: string; placement: number; score: number | null }[] } | null;
}

export interface TnSessionView {
  status: "setup" | "live" | "completed";
  groupId: string;
  openScoring: boolean;
  nowPlaying: string | null;
  roster: TnSlot[];
  games: { idx: number; title: string; lines: TnLineView[]; at: string }[];
  summary: TnSummaryView;
}

export type TnCall = (path: string, body?: unknown) => Promise<void>;

/**
 * The handful of strings a title-night pack does not share.
 *
 * Deliberately small. Every sentence that reads correctly for both packs stays
 * in this file: a copy slot per line would make the layer a template, and a
 * template is a copy with extra steps.
 */
export interface TitleNightCopy {
  /** The marker on the player leading tonight. */
  leadPill: string;
  /** The button that opens the title picker when nothing is on the table. */
  setNowPlaying: string;
  /** Why the typed score never moves a placement, in the pack's own terms. */
  scoreNote: string;
  /** On the TV, when the night has not started producing results yet. */
  tvIdleHint: string;
}

const avg = (n: number | null) => (n === null ? "-" : n.toFixed(1));

// ---------- Setup / waiting ----------

/**
 * Build the roster and start the night, or wait for whoever can.
 *
 * `recentTitles` is shown here rather than only on the live screen because it
 * is the pack's main defence against a split history: a crew that sees its own
 * spelling before the first result is a crew that reuses it.
 */
export function TitleNightSetup({
  ctx,
  config,
  completed,
  busy,
  onStart,
}: {
  ctx: TnCtx | null;
  config: TitleNightConfig;
  completed: boolean;
  busy: boolean;
  onStart: (p: unknown) => void;
}) {
  const [roster, setRoster] = useState<{ userId: string | null; name: string }[]>([]);
  const [guest, setGuest] = useState("");
  const cap = config.maxPlayers;

  useEffect(() => {
    if (ctx && roster.length === 0) {
      setRoster(ctx.prefill.slice(0, cap).map((p) => ({ userId: p.userId, name: p.name })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  if (!ctx) return <p className="tn-hint" style={{ marginTop: 16 }}>Loading...</p>;

  if (!ctx.canHost) {
    return (
      <div className="tn-card" style={{ marginTop: 16 }}>
        <div className="tn-h">Waiting for the host</div>
        <p className="tn-hint">The crew owner or an admin starts the night. This screen updates live the moment they do.</p>
      </div>
    );
  }

  const full = roster.length >= cap;
  const addMember = (m: { userId: string; name: string }) => {
    if (!full && !roster.some((r) => r.userId === m.userId)) setRoster([...roster, { userId: m.userId, name: m.name }]);
  };
  const addGuest = () => {
    const n = guest.trim().slice(0, 24);
    if (n && !full) setRoster([...roster, { userId: null, name: n }]);
    setGuest("");
  };
  const removeAt = (i: number) => setRoster(roster.filter((_, j) => j !== i));
  const notAdded = ctx.members.filter((m) => !roster.some((r) => r.userId === m.userId));

  return (
    <>
      {completed && (
        <div className="tn-card" style={{ marginTop: 16 }}>
          <p className="tn-hint">That night wrapped. Starting again begins a fresh session for this event.</p>
        </div>
      )}
      <div className="tn-card" style={{ marginTop: 16 }}>
        <div className="tn-h">Who is playing ({roster.length}/{cap})</div>
        {roster.map((r, i) => (
          <div className="tn-row" key={`${r.userId ?? "g"}-${i}`}>
            <span className="tn-name" style={{ flex: 1 }}>{r.name}</span>
            {!r.userId && <span className="tn-pill">guest</span>}
            <button className="tn-textbtn" onClick={() => removeAt(i)}>remove</button>
          </div>
        ))}
        {roster.length === 0 && (
          <p className="tn-hint">Add up to {cap} players from the crew or type a guest. Not everybody has to play every game.</p>
        )}

        {notAdded.length > 0 && !full && (
          <>
            <div className="tn-lab" style={{ marginTop: 12 }}>Add from crew</div>
            <div className="tn-seg">
              {notAdded.map((m) => (
                <button key={m.userId} onClick={() => addMember(m)}>+ {m.name}</button>
              ))}
            </div>
          </>
        )}
        {!full && (
          <>
            <div className="tn-lab" style={{ marginTop: 12 }}>Add a guest</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <input className="tn-input" placeholder="Guest name" value={guest} onChange={(e) => setGuest(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addGuest()} />
              <button className="tn-btn tn-btn--ghost" style={{ width: "auto", padding: "0 16px" }} onClick={addGuest}>Add</button>
            </div>
          </>
        )}
        <p className="tn-hint" style={{ marginTop: 8 }}>Guests play, but lifetime stats only count crew members.</p>
      </div>

      {ctx.recentTitles.length > 0 && (
        <div className="tn-card">
          <div className="tn-h">You have played</div>
          <p className="tn-hint">{ctx.recentTitles.slice(0, 8).join(", ")}</p>
        </div>
      )}

      <button
        className="tn-btn"
        style={{ marginTop: 12 }}
        disabled={busy || roster.length < 2}
        onClick={() => onStart({ roster })}
      >
        {roster.length < 2 ? "Add at least 2 players" : "Start the night"}
      </button>
    </>
  );
}

// ---------- Live play ----------

export function TitleNightLive({
  route,
  eventId,
  ctx,
  config,
  copy,
  session,
  busy,
  call,
}: {
  /** The pack's route segment: at("record") -> /api/cardtable/:id/record */
  route: string;
  eventId: string;
  ctx: TnCtx | null;
  config: TitleNightConfig;
  copy: TitleNightCopy;
  session: TnSessionView;
  busy: boolean;
  call: TnCall;
}) {
  const canHost = ctx?.canHost ?? false;
  const canScore = canHost || session.openScoring;
  const at = (path: string) => `/api/${route}/${eventId}/${path}`;
  // The crew's recents first, then the curated starter list. Same order the
  // server canonicalizes against, so what the picker offers and what the ledger
  // stores can never be two different spellings of one title.
  const suggestions = useMemo(
    () => tnTitleSuggestions(ctx?.recentTitles ?? [], config.titles),
    [ctx?.recentTitles, config.titles],
  );

  return (
    <>
      <OnTheTable
        at={at}
        session={session}
        suggestions={suggestions}
        copy={copy}
        canScore={canScore}
        busy={busy}
        call={call}
      />

      {canScore ? (
        <RecordGame
          session={session}
          suggestions={suggestions}
          copy={copy}
          busy={busy}
          onRecord={(payload) => call(at("record"), payload)}
        />
      ) : (
        <div className="tn-card"><p className="tn-hint">The host is recording results. Standings update live below.</p></div>
      )}

      <div className="tn-card">
        <div className="tn-h">Tonight ({session.games.length} game{session.games.length === 1 ? "" : "s"})</div>
        {session.summary.players.length === 0 ? (
          <p className="tn-hint">No games recorded yet.</p>
        ) : (
          <>
            {session.summary.players.map((p, i) => (
              <div className="tn-row" key={p.playerId}>
                <span style={{ flex: 1 }} className="tn-name">
                  {i === 0 && <span className="tn-pill tn-pill--lead">{copy.leadPill}</span>} {p.name}
                </span>
                <span className="tn-meta">{p.wins}W / {p.games} &middot; avg {avg(p.avgPlacement)}</span>
              </div>
            ))}
            {session.summary.titles.length > 0 && (
              <p className="tn-hint" style={{ marginTop: 10 }}>
                Played: {session.summary.titles.map((t) => `${t.title} (${t.games})`).join(", ")}
              </p>
            )}
          </>
        )}
      </div>

      {canHost && (
        <div className="tn-card">
          <div className="tn-h">Host controls</div>
          <div className="tn-row">
            <span style={{ flex: 1 }}>Let members record results</span>
            <button
              className={`gn-toggle ${session.openScoring ? "gn-toggle--on" : "gn-toggle--off"}`}
              aria-pressed={session.openScoring}
              onClick={() => call(at("open-scoring"), { open: !session.openScoring })}
            >
              {session.openScoring ? "ON" : "OFF"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="tn-btn tn-btn--ghost" disabled={busy || session.games.length === 0} onClick={() => call(at("undo"))}>↶ Undo last</button>
            <button className="tn-btn tn-btn--go" disabled={busy} onClick={() => call(at("complete"))}>End the night</button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- What is on the table now ----------

/**
 * One tap when the box comes out. It is not required to record a result (the
 * record form can carry its own title), but it is what the TV shows large, and
 * a title night spends most of its length between results.
 */
function OnTheTable({
  at,
  session,
  suggestions,
  copy,
  canScore,
  busy,
  call,
}: {
  at: (path: string) => string;
  session: TnSessionView;
  suggestions: string[];
  copy: TitleNightCopy;
  canScore: boolean;
  busy: boolean;
  call: TnCall;
}) {
  const [picking, setPicking] = useState(false);
  const [typed, setTyped] = useState("");

  const set = (title: string) => {
    void call(at("now-playing"), { title });
    setPicking(false);
    setTyped("");
  };

  return (
    <div className="tn-card" style={{ marginTop: 16 }}>
      <div className="tn-lab">On the table</div>
      <div className="tn-now" style={{ marginTop: 4 }}>
        {session.nowPlaying ?? <span className="tn-hint" style={{ fontSize: 16 }}>Between games</span>}
      </div>
      {canScore && (
        <>
          {!picking ? (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tn-btn tn-btn--ghost" disabled={busy} onClick={() => setPicking(true)}>
                {session.nowPlaying ? "Change" : copy.setNowPlaying}
              </button>
              {session.nowPlaying && (
                <button className="tn-btn tn-btn--ghost" disabled={busy} onClick={() => set("")}>Clear</button>
              )}
            </div>
          ) : (
            <>
              <div className="tn-seg" style={{ marginTop: 10 }}>
                {suggestions.slice(0, 12).map((t) => (
                  <button key={t} className={session.nowPlaying === t ? "on" : ""} onClick={() => set(t)}>{t}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input
                  className="tn-input"
                  placeholder="Something else"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && typed.trim() && set(typed)}
                />
                <button className="tn-btn tn-btn--ghost" style={{ width: "auto", padding: "0 16px" }} disabled={!typed.trim()} onClick={() => set(typed)}>Set</button>
              </div>
              <button className="tn-textbtn" onClick={() => setPicking(false)}>cancel</button>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Record a game ----------

/** The whole scoring interaction: tap people into the finish order, confirm. */
function RecordGame({
  session,
  suggestions,
  copy,
  busy,
  onRecord,
}: {
  session: TnSessionView;
  suggestions: string[];
  copy: TitleNightCopy;
  busy: boolean;
  onRecord: (payload: unknown) => void;
}) {
  const [title, setTitle] = useState("");
  const [order, setOrder] = useState<{ playerId: string; tiedWithAbove: boolean }[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});

  // The title defaults to whatever is on the table, so the common night is one
  // tap when the box comes out and none at all when the game ends.
  const effectiveTitle = (title || session.nowPlaying || "").trim();

  const nameOf = useMemo(
    () => new Map(session.roster.map((p) => [p.id, p.name])),
    [session.roster],
  );
  const inOrder = new Set(order.map((o) => o.playerId));
  const remaining = session.roster.filter((p) => !inOrder.has(p.id));

  // Competition ranking, computed here only so the screen can SHOW it. The
  // server recomputes it from the same order; this never travels.
  const placements = order.map((_, i) => i + 1);
  for (let i = 1; i < order.length; i++) {
    if (order[i]!.tiedWithAbove) placements[i] = placements[i - 1]!;
  }

  const ready = !!effectiveTitle && order.length >= 2;

  const record = () => {
    onRecord({
      title: effectiveTitle,
      order: order.map((o) => ({
        playerId: o.playerId,
        tiedWithAbove: o.tiedWithAbove,
        score: scores[o.playerId] ?? null,
      })),
    });
    setTitle("");
    setOrder([]);
    setScores({});
  };

  return (
    <div className="tn-card">
      <div className="tn-h">Record a result</div>

      <div className="tn-lab">What did you play</div>
      <div className="tn-seg">
        {suggestions.slice(0, 12).map((t) => (
          <button key={t} className={effectiveTitle === t ? "on" : ""} onClick={() => setTitle(t)}>{t}</button>
        ))}
      </div>
      <input
        className="tn-input"
        style={{ marginTop: 8 }}
        placeholder="Or type a title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      {!title && session.nowPlaying && (
        <p className="tn-hint" style={{ marginTop: 6 }}>Recording {session.nowPlaying}, the game on the table.</p>
      )}

      <div className="tn-lab" style={{ marginTop: 14 }}>Finish order (tap in order, first place first)</div>
      {remaining.length > 0 && (
        <div className="tn-seg">
          {remaining.map((p) => (
            <button key={p.id} onClick={() => setOrder([...order, { playerId: p.id, tiedWithAbove: false }])}>
              + {p.name}
            </button>
          ))}
        </div>
      )}
      {order.length === 0 && <p className="tn-hint" style={{ marginTop: 8 }}>Tap the winner first. Anybody who sat this one out just stays off the list.</p>}

      {order.map((o, i) => (
        <div className="tn-row" key={o.playerId}>
          <span className={`tn-place ${placements[i] === 1 ? "tn-place--win" : ""}`}>{placements[i]}</span>
          <span className="tn-name" style={{ flex: 1 }}>{nameOf.get(o.playerId) ?? "?"}</span>
          {i > 0 && (
            <button
              className={`tn-tie ${o.tiedWithAbove ? "on" : ""}`}
              aria-pressed={o.tiedWithAbove}
              onClick={() =>
                setOrder(order.map((e, j) => (j === i ? { ...e, tiedWithAbove: !e.tiedWithAbove } : e)))
              }
            >
              tied
            </button>
          )}
          <input
            className="tn-input tn-score"
            type="number"
            inputMode="numeric"
            placeholder="score"
            value={scores[o.playerId] ?? ""}
            onChange={(e) => setScores((s) => ({ ...s, [o.playerId]: e.target.value }))}
          />
          <button className="tn-textbtn" onClick={() => setOrder(order.filter((_, j) => j !== i))}>x</button>
        </div>
      ))}

      {order.length > 0 && (
        <p className="tn-hint" style={{ marginTop: 8 }}>
          Score is optional and is only a note: it never changes the finish. {copy.scoreNote}
        </p>
      )}

      <button className="tn-btn" style={{ marginTop: 14 }} disabled={busy || !ready} onClick={record}>
        {!effectiveTitle ? "Pick what you played" : order.length < 2 ? "Tap at least 2 players into the order" : "Record it"}
      </button>
    </div>
  );
}

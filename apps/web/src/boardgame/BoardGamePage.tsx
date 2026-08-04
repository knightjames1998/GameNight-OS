import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import BackButton from "../BackButton";
import { usePackSession, type PackCtx } from "../usePackSession";
import { SESSION_PACKS, BOARD_GAME_MAX_PLAYERS, titleSuggestions } from "@gamenight/shared";
import "./boardgame.css";

/**
 * The launch context, plus the crew's own title history. See the pack's server
 * file: the recents are the thing that keeps a crew's spelling stable, so the
 * picker offers them first and free text is the last resort rather than the
 * default.
 */
interface Ctx extends PackCtx {
  recentTitles: string[];
}

interface Slot {
  id: string;
  kind: "member" | "guest";
  userId: string | null;
  name: string;
}
interface Line {
  playerId: string;
  placement: number;
  isWinner: boolean;
  score: number | null;
}
interface Session {
  status: "setup" | "live" | "completed";
  groupId: string;
  openScoring: boolean;
  nowPlaying: string | null;
  roster: Slot[];
  games: { idx: number; title: string; lines: Line[]; at: string }[];
  summary: {
    players: { playerId: string; name: string; games: number; wins: number; avgPlacement: number | null }[];
    titles: { title: string; games: number }[];
    last: { title: string; lines: { name: string; placement: number; score: number | null }[] } | null;
  };
}

const avg = (n: number | null) => (n === null ? "-" : n.toFixed(1));

export default function BoardGamePage() {
  const eventId = new URLSearchParams(window.location.search).get("event") ?? "";
  const { ctx, session, loading, busy, err, call, startSession } =
    usePackSession<Session, Ctx>({
      pack: "boardgame",
      wsType: SESSION_PACKS.boardgame.wsType,
      eventId,
      replacePrompt:
        "A session is already in progress on this event. Replace it? Every game recorded in the current session stays in your stats, but the session itself is ended.",
    });

  if (!eventId) {
    return <div className="bg-root"><div className="bg-wrap"><p className="bg-hint">No event specified.</p><BackButton /></div></div>;
  }
  if (loading) {
    return <div className="bg-root"><div className="bg-wrap"><p className="bg-hint">Loading...</p></div></div>;
  }

  return (
    <div className="bg-root">
      <div className="bg-wrap">
        <div className="bg-top">
          <BackButton className="bg-textbtn" />
          {/* A way back to the NIGHT this pack belongs to, which the
              history-based Back button cannot promise: somebody who opened a
              shared link in a fresh tab has no history to pop, so Back sends
              them home rather than to the event they were sent to. Standing
              rule: every pack screen has both. */}
          <Link to={`/e/${eventId}`} className="bg-textbtn">🎪 Event</Link>
          {/* The NIGHT's TV address, not this pack's. */}
          <Link to={`/e/${eventId}/tv`} className="bg-textbtn">📺 TV</Link>
        </div>
        <div>
          <div className="bg-brand">Board <em>Game</em></div>
          <div className="bg-sub">Pick the box, tap the finish order, done</div>
        </div>

        {err && <p className="bg-err">{err}</p>}

        {!session || session.status === "completed" ? (
          <SetupOrWaiting
            ctx={ctx}
            completed={session?.status === "completed"}
            busy={busy}
            onStart={(payload) => startSession(payload as Record<string, unknown>)}
          />
        ) : (
          <LivePlay eventId={eventId} ctx={ctx} session={session} busy={busy} call={call} />
        )}
      </div>
    </div>
  );
}

// ---------- Setup / waiting ----------

function SetupOrWaiting({
  ctx,
  completed,
  busy,
  onStart,
}: {
  ctx: Ctx | null;
  completed: boolean;
  busy: boolean;
  onStart: (p: unknown) => void;
}) {
  const [roster, setRoster] = useState<{ userId: string | null; name: string }[]>([]);
  const [guest, setGuest] = useState("");

  useEffect(() => {
    if (ctx && roster.length === 0) {
      setRoster(ctx.prefill.slice(0, BOARD_GAME_MAX_PLAYERS).map((p) => ({ userId: p.userId, name: p.name })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  if (!ctx) return <p className="bg-hint" style={{ marginTop: 16 }}>Loading...</p>;

  if (!ctx.canHost) {
    return (
      <div className="bg-card" style={{ marginTop: 16 }}>
        <div className="bg-h">Waiting for the host</div>
        <p className="bg-hint">The crew owner or an admin starts the night. This screen updates live the moment they do.</p>
      </div>
    );
  }

  const full = roster.length >= BOARD_GAME_MAX_PLAYERS;
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
        <div className="bg-card" style={{ marginTop: 16 }}>
          <p className="bg-hint">That night wrapped. Starting again begins a fresh session for this event.</p>
        </div>
      )}
      <div className="bg-card" style={{ marginTop: 16 }}>
        <div className="bg-h">Who is playing ({roster.length}/{BOARD_GAME_MAX_PLAYERS})</div>
        {roster.map((r, i) => (
          <div className="bg-row" key={`${r.userId ?? "g"}-${i}`}>
            <span className="bg-name" style={{ flex: 1 }}>{r.name}</span>
            {!r.userId && <span className="bg-pill">guest</span>}
            <button className="bg-textbtn" onClick={() => removeAt(i)}>remove</button>
          </div>
        ))}
        {roster.length === 0 && (
          <p className="bg-hint">Add up to {BOARD_GAME_MAX_PLAYERS} players from the crew or type a guest. Not everybody has to play every game.</p>
        )}

        {notAdded.length > 0 && !full && (
          <>
            <div className="bg-lab" style={{ marginTop: 12 }}>Add from crew</div>
            <div className="bg-seg">
              {notAdded.map((m) => (
                <button key={m.userId} onClick={() => addMember(m)}>+ {m.name}</button>
              ))}
            </div>
          </>
        )}
        {!full && (
          <>
            <div className="bg-lab" style={{ marginTop: 12 }}>Add a guest</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <input className="bg-input" placeholder="Guest name" value={guest} onChange={(e) => setGuest(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addGuest()} />
              <button className="bg-btn bg-btn--ghost" style={{ width: "auto", padding: "0 16px" }} onClick={addGuest}>Add</button>
            </div>
          </>
        )}
        <p className="bg-hint" style={{ marginTop: 8 }}>Guests play, but lifetime stats only count crew members.</p>
      </div>

      {ctx.recentTitles.length > 0 && (
        <div className="bg-card">
          <div className="bg-h">You have played</div>
          <p className="bg-hint">{ctx.recentTitles.slice(0, 8).join(", ")}</p>
        </div>
      )}

      <button
        className="bg-btn"
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

function LivePlay({
  eventId,
  ctx,
  session,
  busy,
  call,
}: {
  eventId: string;
  ctx: Ctx | null;
  session: Session;
  busy: boolean;
  call: (path: string, body?: unknown, optimistic?: (s: Session) => Session) => Promise<void>;
}) {
  const canHost = ctx?.canHost ?? false;
  const canScore = canHost || session.openScoring;
  // The crew's recents first, then the curated starter list. Same order the
  // server canonicalizes against, so what the picker offers and what the ledger
  // stores can never be two different spellings of one title.
  const suggestions = useMemo(() => titleSuggestions(ctx?.recentTitles ?? []), [ctx?.recentTitles]);

  return (
    <>
      <OnTheTable
        eventId={eventId}
        session={session}
        suggestions={suggestions}
        canScore={canScore}
        busy={busy}
        call={call}
      />

      {canScore ? (
        <RecordGame
          session={session}
          suggestions={suggestions}
          busy={busy}
          onRecord={(payload) => call(`/api/boardgame/${eventId}/record`, payload)}
        />
      ) : (
        <div className="bg-card"><p className="bg-hint">The host is recording results. Standings update live below.</p></div>
      )}

      <div className="bg-card">
        <div className="bg-h">Tonight ({session.games.length} game{session.games.length === 1 ? "" : "s"})</div>
        {session.summary.players.length === 0 ? (
          <p className="bg-hint">No games recorded yet.</p>
        ) : (
          <>
            {session.summary.players.map((p, i) => (
              <div className="bg-row" key={p.playerId}>
                <span style={{ flex: 1 }} className="bg-name">
                  {i === 0 && <span className="bg-pill bg-pill--lead">♟ lead</span>} {p.name}
                </span>
                <span className="bg-meta">{p.wins}W / {p.games} &middot; avg {avg(p.avgPlacement)}</span>
              </div>
            ))}
            {session.summary.titles.length > 0 && (
              <p className="bg-hint" style={{ marginTop: 10 }}>
                Played: {session.summary.titles.map((t) => `${t.title} (${t.games})`).join(", ")}
              </p>
            )}
          </>
        )}
      </div>

      {canHost && (
        <div className="bg-card">
          <div className="bg-h">Host controls</div>
          <div className="bg-row">
            <span style={{ flex: 1 }}>Let members record results</span>
            <button
              className={`gn-toggle ${session.openScoring ? "gn-toggle--on" : "gn-toggle--off"}`}
              aria-pressed={session.openScoring}
              onClick={() => call(`/api/boardgame/${eventId}/open-scoring`, { open: !session.openScoring })}
            >
              {session.openScoring ? "ON" : "OFF"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="bg-btn bg-btn--ghost" disabled={busy || session.games.length === 0} onClick={() => call(`/api/boardgame/${eventId}/undo`)}>↶ Undo last</button>
            <button className="bg-btn bg-btn--go" disabled={busy} onClick={() => call(`/api/boardgame/${eventId}/complete`)}>End the night</button>
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
 * a board game night spends most of its length between results.
 */
function OnTheTable({
  eventId,
  session,
  suggestions,
  canScore,
  busy,
  call,
}: {
  eventId: string;
  session: Session;
  suggestions: string[];
  canScore: boolean;
  busy: boolean;
  call: (path: string, body?: unknown) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const [typed, setTyped] = useState("");

  const set = (title: string) => {
    void call(`/api/boardgame/${eventId}/now-playing`, { title });
    setPicking(false);
    setTyped("");
  };

  return (
    <div className="bg-card" style={{ marginTop: 16 }}>
      <div className="bg-lab">On the table</div>
      <div className="bg-now" style={{ marginTop: 4 }}>
        {session.nowPlaying ?? <span className="bg-hint" style={{ fontSize: 16 }}>Between games</span>}
      </div>
      {canScore && (
        <>
          {!picking ? (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="bg-btn bg-btn--ghost" disabled={busy} onClick={() => setPicking(true)}>
                {session.nowPlaying ? "Change" : "Set what is out"}
              </button>
              {session.nowPlaying && (
                <button className="bg-btn bg-btn--ghost" disabled={busy} onClick={() => set("")}>Clear</button>
              )}
            </div>
          ) : (
            <>
              <div className="bg-seg" style={{ marginTop: 10 }}>
                {suggestions.slice(0, 12).map((t) => (
                  <button key={t} className={session.nowPlaying === t ? "on" : ""} onClick={() => set(t)}>{t}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input
                  className="bg-input"
                  placeholder="Something else"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && typed.trim() && set(typed)}
                />
                <button className="bg-btn bg-btn--ghost" style={{ width: "auto", padding: "0 16px" }} disabled={!typed.trim()} onClick={() => set(typed)}>Set</button>
              </div>
              <button className="bg-textbtn" onClick={() => setPicking(false)}>cancel</button>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Record a game ----------

/**
 * The whole scoring interaction: tap people into the finish order, confirm.
 *
 * THE ORDER IS THE PLACEMENT. Nothing on this screen derives a finish from a
 * number, and the optional score box says so out loud, because a board game
 * night includes titles where high wins, titles where low wins, and titles with
 * no score at all. A typed score that disagrees with the tapped order is
 * allowed to stand.
 */
function RecordGame({
  session,
  suggestions,
  busy,
  onRecord,
}: {
  session: Session;
  suggestions: string[];
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
    <div className="bg-card">
      <div className="bg-h">Record a result</div>

      <div className="bg-lab">What did you play</div>
      <div className="bg-seg">
        {suggestions.slice(0, 12).map((t) => (
          <button key={t} className={effectiveTitle === t ? "on" : ""} onClick={() => setTitle(t)}>{t}</button>
        ))}
      </div>
      <input
        className="bg-input"
        style={{ marginTop: 8 }}
        placeholder="Or type a title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      {!title && session.nowPlaying && (
        <p className="bg-hint" style={{ marginTop: 6 }}>Recording {session.nowPlaying}, the game on the table.</p>
      )}

      <div className="bg-lab" style={{ marginTop: 14 }}>Finish order (tap in order, first place first)</div>
      {remaining.length > 0 && (
        <div className="bg-seg">
          {remaining.map((p) => (
            <button key={p.id} onClick={() => setOrder([...order, { playerId: p.id, tiedWithAbove: false }])}>
              + {p.name}
            </button>
          ))}
        </div>
      )}
      {order.length === 0 && <p className="bg-hint" style={{ marginTop: 8 }}>Tap the winner first. Anybody who sat this one out just stays off the list.</p>}

      {order.map((o, i) => (
        <div className="bg-row" key={o.playerId}>
          <span className={`bg-place ${placements[i] === 1 ? "bg-place--win" : ""}`}>{placements[i]}</span>
          <span className="bg-name" style={{ flex: 1 }}>{nameOf.get(o.playerId) ?? "?"}</span>
          {i > 0 && (
            <button
              className={`bg-tie ${o.tiedWithAbove ? "on" : ""}`}
              aria-pressed={o.tiedWithAbove}
              onClick={() =>
                setOrder(order.map((e, j) => (j === i ? { ...e, tiedWithAbove: !e.tiedWithAbove } : e)))
              }
            >
              tied
            </button>
          )}
          <input
            className="bg-input bg-score"
            type="number"
            inputMode="numeric"
            placeholder="score"
            value={scores[o.playerId] ?? ""}
            onChange={(e) => setScores((s) => ({ ...s, [o.playerId]: e.target.value }))}
          />
          <button className="bg-textbtn" onClick={() => setOrder(order.filter((_, j) => j !== i))}>x</button>
        </div>
      ))}

      {order.length > 0 && (
        <p className="bg-hint" style={{ marginTop: 8 }}>
          Score is optional and is only a note: it never changes the finish. Board games disagree about whether high or low wins, so the order you tapped is the result.
        </p>
      )}

      <button className="bg-btn" style={{ marginTop: 14 }} disabled={busy || !ready} onClick={record}>
        {!effectiveTitle ? "Pick what you played" : order.length < 2 ? "Tap at least 2 players into the order" : "Record it"}
      </button>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, CLIENT_ID } from "../api";
import BackButton from "../BackButton";
import { useLiveUpdates } from "../useLiveUpdates";
import { recordGame, gameWins, type PpSessionState, type PpMatch } from "@gamenight/shared";
import "./pingpong.css";

type Mode = "koth" | "ffa";
type BestOf = 1 | 3 | 5 | 7;

interface Slot { id: string; kind: "member" | "guest"; userId: string | null; name: string }
interface Game { winnerId: string; loserPoints: number | null }
interface Match { idx: number; aId: string; bId: string; games: Game[]; winnerId: string | null; at: string | null }
interface Koth { kingId: string | null; queue: string[]; reign: number; bestReign: { playerId: string; reign: number } | null }
interface PlayerStat {
  playerId: string; name: string; matches: number; wins: number; winRate: number;
  gameWins: number; gamesPlayed: number;
  currentStreak: number; bestStreak: number; longestReign: number;
}
interface Session {
  status: "setup" | "live" | "completed";
  groupId: string;
  mode: Mode;
  bestOf: BestOf;
  openScoring: boolean;
  roster: Slot[];
  matches: Match[];
  current: Match | null;
  koth: Koth | null;
  needed: number;
  summary: { players: PlayerStat[] };
}
interface Ctx {
  groupId: string;
  canHost: boolean;
  viewerId: string;
  prefill: { userId: string; name: string }[];
  members: { userId: string; name: string }[];
  live: boolean;
}

export default function PingPongPage() {
  const eventId = new URLSearchParams(window.location.search).get("event") ?? "";
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reqSeq = useRef(0);

  async function refetch() {
    if (!eventId) return;
    const [c, s] = await Promise.all([
      api<Ctx>(`/api/pingpong-context/${eventId}`).catch(() => null),
      api<{ session: Session | null }>(`/api/pingpong/${eventId}`).catch(() => ({ session: null })),
    ]);
    if (c) setCtx(c);
    setSession(s.session);
  }

  useEffect(() => {
    refetch().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Own echoes are skipped: mutation responses already carry the session.
  useLiveUpdates(
    (m) => {
      if (m.origin === CLIENT_ID) return;
      if ((m.type === "ping_pong_updated" || m.type === "leaderboard_updated") && m.eventId === eventId) refetch();
    },
    () => refetch(),
  );

  // Mutations return the session; apply directly. Optional optimistic updater
  // paints one-tap changes before the network answers, rollback on failure.
  async function call(path: string, body?: unknown, optimistic?: (s: Session) => Session) {
    setErr(null);
    const prev = session;
    const seq = ++reqSeq.current;
    if (optimistic && session) setSession(optimistic(session));
    setBusy(true);
    try {
      const r = await api<{ session: Session | null }>(path, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      if (seq === reqSeq.current && r && typeof r === "object" && "session" in r) setSession(r.session);
    } catch (e: any) {
      if (seq === reqSeq.current && optimistic) setSession(prev);
      setErr(e?.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!eventId) {
    return <div className="pp-root"><div className="pp-wrap"><p className="pp-hint">No event specified.</p><BackButton /></div></div>;
  }
  if (loading) {
    return <div className="pp-root"><div className="pp-wrap"><p className="pp-hint">Loading...</p></div></div>;
  }

  return (
    <div className="pp-root">
      <div className="pp-wrap">
        <div className="pp-top">
          <BackButton className="pp-textbtn" />
          <Link to={`/pingpong/tv/${eventId}`} className="pp-textbtn">📺 TV</Link>
        </div>
        <div>
          <div className="pp-brand">Ping <em>Pong</em></div>
          <div className="pp-sub">King of the Hill &amp; Singles</div>
        </div>

        {err && <p className="pp-err">{err}</p>}

        {!session || session.status === "completed" ? (
          <SetupOrWaiting
            ctx={ctx}
            completed={session?.status === "completed"}
            busy={busy}
            onStart={(payload) => call(`/api/events/${eventId}/pingpong`, payload)}
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
  const initialMode: Mode = new URLSearchParams(window.location.search).get("mode") === "ffa" ? "ffa" : "koth";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [bestOf, setBestOf] = useState<BestOf>(3);
  const [roster, setRoster] = useState<{ userId: string | null; name: string }[]>([]);
  const [guest, setGuest] = useState("");

  useEffect(() => {
    if (ctx && roster.length === 0) setRoster(ctx.prefill.map((p) => ({ userId: p.userId, name: p.name })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  if (!ctx) return <p className="pp-hint" style={{ marginTop: 16 }}>Loading...</p>;

  if (!ctx.canHost) {
    return (
      <div className="pp-card" style={{ marginTop: 16 }}>
        <div className="pp-h">Waiting for the host</div>
        <p className="pp-hint">The crew owner or an admin starts the night. This screen updates live the moment they do.</p>
      </div>
    );
  }

  const addMember = (m: { userId: string; name: string }) => {
    if (!roster.some((r) => r.userId === m.userId)) setRoster([...roster, { userId: m.userId, name: m.name }]);
  };
  const addGuest = () => {
    const n = guest.trim().slice(0, 24);
    if (n) setRoster([...roster, { userId: null, name: n }]);
    setGuest("");
  };
  const removeAt = (i: number) => setRoster(roster.filter((_, j) => j !== i));
  const notAdded = ctx.members.filter((m) => !roster.some((r) => r.userId === m.userId));

  return (
    <>
      {completed && (
        <div className="pp-card" style={{ marginTop: 16 }}>
          <p className="pp-hint">That session wrapped. Set up another one below.</p>
        </div>
      )}
      <div className="pp-card" style={{ marginTop: 16 }}>
        <div className="pp-h">Format</div>
        <div className="pp-seg">
          <button className={mode === "koth" ? "on" : ""} onClick={() => setMode("koth")}>King of the Hill</button>
          <button className={mode === "ffa" ? "on" : ""} onClick={() => setMode("ffa")}>Singles</button>
        </div>
        <p className="pp-hint" style={{ marginTop: 8 }}>
          {mode === "koth"
            ? "Winner stays on, loser rotates to the back of the line. First up is first in the list."
            : "One match at a time between any two players. You pick the two each match."}
        </p>
        <div className="pp-h" style={{ marginTop: 14 }}>Match length</div>
        <div className="pp-seg">
          <button className={bestOf === 1 ? "on" : ""} onClick={() => setBestOf(1)}>Free play</button>
          {[3, 5, 7].map((n) => (
            <button key={n} className={bestOf === n ? "on" : ""} onClick={() => setBestOf(n as BestOf)}>Best of {n}</button>
          ))}
        </div>
        <p className="pp-hint" style={{ marginTop: 8 }}>
          {bestOf === 1
            ? "Free play: one tap logs one game. The same two stay on until you change players."
            : `A match is best of ${bestOf}; first to ${Math.floor(bestOf / 2) + 1} games wins it.`}
        </p>
      </div>

      <div className="pp-card">
        <div className="pp-h">Players ({roster.length})</div>
        {roster.map((r, i) => (
          <div className="pp-row" key={`${r.userId ?? "g"}-${i}`}>
            <span className="pp-name" style={{ flex: 1 }}>{r.name}</span>
            {!r.userId && <span className="pp-pill">guest</span>}
            <button className="pp-textbtn" onClick={() => removeAt(i)}>remove</button>
          </div>
        ))}
        {roster.length === 0 && <p className="pp-hint">Add players from the crew or type a guest.</p>}

        {notAdded.length > 0 && (
          <>
            <div className="pp-lab" style={{ marginTop: 12 }}>Add from crew</div>
            <div className="pp-seg">
              {notAdded.map((m) => (
                <button key={m.userId} onClick={() => addMember(m)}>+ {m.name}</button>
              ))}
            </div>
          </>
        )}
        <div className="pp-lab" style={{ marginTop: 12 }}>Add a guest</div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input className="pp-input" placeholder="Guest name" value={guest} onChange={(e) => setGuest(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addGuest()} />
          <button className="pp-btn pp-btn--ghost" style={{ width: "auto", padding: "0 16px" }} onClick={addGuest}>Add</button>
        </div>
        <p className="pp-hint" style={{ marginTop: 8 }}>Guests play, but lifetime stats only count crew members.</p>
      </div>

      <button
        className="pp-btn"
        style={{ marginTop: 12 }}
        disabled={busy || roster.length < 2}
        onClick={() => onStart({ mode, bestOf, roster })}
      >
        {roster.length < 2 ? "Add at least 2 players" : `Start ${mode === "koth" ? "King of the Hill" : "Singles"}`}
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
  const nameOf = useMemo(() => new Map(session.roster.map((p) => [p.id, p.name])), [session.roster]);
  const [pointsDraft, setPointsDraft] = useState("");
  const [pickA, setPickA] = useState("");
  const [pickB, setPickB] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  const cur = session.current;
  const freePlay = session.bestOf === 1;
  const wins = cur ? gameWins(cur as unknown as PpMatch) : { a: 0, b: 0 };

  function tapWinner(winnerId: string) {
    const lp = pointsDraft.trim() === "" ? null : Number(pointsDraft);
    setPointsDraft("");
    call(`/api/pingpong/${eventId}/record`, { winnerId, loserPoints: lp }, (s) => {
      // Optimistic: apply the same pure engine step to a clone so the tap
      // paints instantly; the server response reconciles.
      const clone: Session = structuredClone(s);
      recordGame(clone as unknown as PpSessionState, winnerId, lp);
      return clone;
    });
  }

  return (
    <>
      {/* Current match. In free-play singles a "Change players" tap reopens
          the picker (showPicker) so the same pair doesn't stay on forever. */}
      {cur && !(showPicker && session.mode === "ffa") ? (
        <div className="pp-card" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div className="pp-h" style={{ margin: 0 }}>
              {session.mode === "koth" ? "On the table" : "Current match"}
            </div>
            <span className="pp-hint">{freePlay ? "Free play · single game" : `first to ${session.needed} · best of ${session.bestOf}`}</span>
          </div>

          {!freePlay && <div className="pp-score" style={{ margin: "8px 0 12px" }}>{wins.a} &ndash; {wins.b}</div>}

          {canScore ? (
            <>
              <div className="pp-vs">
                <button className="pp-fighter" disabled={busy} onClick={() => tapWinner(cur.aId)}>
                  <div className="pp-fighter__n">{nameOf.get(cur.aId)}</div>
                  {session.mode === "koth" && session.koth?.kingId === cur.aId && (
                    <div className="pp-pill pp-pill--king" style={{ marginTop: 6, display: "inline-block" }}>👑 king</div>
                  )}
                </button>
                <div className="pp-vsbadge">VS</div>
                <button className="pp-fighter" disabled={busy} onClick={() => tapWinner(cur.bId)}>
                  <div className="pp-fighter__n">{nameOf.get(cur.bId)}</div>
                  {session.mode === "koth" && session.koth?.kingId === cur.bId && (
                    <div className="pp-pill pp-pill--king" style={{ marginTop: 6, display: "inline-block" }}>👑 king</div>
                  )}
                </button>
              </div>
              <div style={{ marginTop: 10 }}>
                <label className="pp-lab">Loser's points (optional)</label>
                <input
                  className="pp-input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="e.g. 7"
                  value={pointsDraft}
                  onChange={(e) => setPointsDraft(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  style={{ marginTop: 4 }}
                />
                <p className="pp-hint" style={{ marginTop: 6 }}>Type the loser's points if you want, then tap the winner. Skip it to just tap.</p>
              </div>
              {session.mode === "ffa" && (
                <button className="pp-textbtn" style={{ marginTop: 8 }} onClick={() => { setPickA(""); setPickB(""); setShowPicker(true); }}>
                  Change players
                </button>
              )}
            </>
          ) : (
            <p className="pp-hint">The host is recording. Standings update live below.</p>
          )}

          {cur.games.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="pp-lab">This match</div>
              {cur.games.map((g, i) => {
                const loserId = g.winnerId === cur.aId ? cur.bId : cur.aId;
                return (
                  <div className="pp-row" key={i}>
                    <span style={{ flex: 1 }}>{nameOf.get(g.winnerId)} def {nameOf.get(loserId)}</span>
                    {g.loserPoints != null && <span className="pp-hint">{g.loserPoints} pts</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : session.mode === "ffa" && canScore ? (
        <div className="pp-card" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div className="pp-h" style={{ margin: 0 }}>Start a match</div>
            {cur && <button className="pp-textbtn" onClick={() => setShowPicker(false)}>cancel</button>}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <select className="pp-select" value={pickA} onChange={(e) => setPickA(e.target.value)}>
              <option value="">Player 1</option>
              {session.roster.map((p) => <option key={p.id} value={p.id} disabled={p.id === pickB}>{p.name}</option>)}
            </select>
            <select className="pp-select" value={pickB} onChange={(e) => setPickB(e.target.value)}>
              <option value="">Player 2</option>
              {session.roster.map((p) => <option key={p.id} value={p.id} disabled={p.id === pickA}>{p.name}</option>)}
            </select>
          </div>
          <button
            className="pp-btn"
            style={{ marginTop: 10 }}
            disabled={busy || !pickA || !pickB || pickA === pickB}
            onClick={() => { call(`/api/pingpong/${eventId}/start-match`, { aId: pickA, bId: pickB }); setPickA(""); setPickB(""); setShowPicker(false); }}
          >
            Start match
          </button>
        </div>
      ) : (
        <div className="pp-card" style={{ marginTop: 16 }}>
          <p className="pp-hint">{session.mode === "koth" ? "Need at least two players queued." : "Waiting for the host to start a match."}</p>
        </div>
      )}

      {/* KOTH queue */}
      {session.mode === "koth" && session.koth && session.koth.queue.length > 1 && (
        <div className="pp-card">
          <div className="pp-h">Up next</div>
          <p className="pp-hint">{session.koth.queue.slice(1).map((id) => nameOf.get(id)).join(", ")}</p>
        </div>
      )}

      {/* Standings */}
      <div className="pp-card">
        <div className="pp-h">Tonight ({session.matches.length} match{session.matches.length === 1 ? "" : "es"})</div>
        {session.summary.players.filter((p) => p.matches > 0).length === 0 ? (
          <p className="pp-hint">No matches finished yet.</p>
        ) : (
          session.summary.players.filter((p) => p.matches > 0).map((p) => (
            <div className="pp-row" key={p.playerId}>
              <span className="pp-name" style={{ flex: 1 }}>{p.name}</span>
              <span className="pp-hint">
                {freePlay ? `${p.gameWins}W / ${p.matches} games` : `${p.wins}W / ${p.matches} · ${p.gameWins} game W`}
                {p.currentStreak >= 2 ? ` · 🔥${p.currentStreak}` : ""}
                {session.mode === "koth" && p.longestReign >= 2 ? ` · reign ${p.longestReign}` : ""}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Host controls */}
      {canHost && (
        <div className="pp-card">
          <div className="pp-h">Host controls</div>
          <div className="pp-row">
            <span style={{ flex: 1 }}>Let members record results</span>
            <button
              className={`gn-toggle ${session.openScoring ? "gn-toggle--on" : "gn-toggle--off"}`}
              aria-pressed={session.openScoring}
              onClick={() => call(`/api/pingpong/${eventId}/open-scoring`, { open: !session.openScoring })}
            >
              {session.openScoring ? "ON" : "OFF"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              className="pp-btn pp-btn--ghost"
              disabled={busy || (session.matches.length === 0 && !(session.current && session.current.games.length > 0))}
              onClick={() => call(`/api/pingpong/${eventId}/undo`)}
            >
              ↶ Undo last
            </button>
            <button className="pp-btn pp-btn--go" disabled={busy} onClick={() => call(`/api/pingpong/${eventId}/complete`)}>End session</button>
          </div>
        </div>
      )}
    </>
  );
}

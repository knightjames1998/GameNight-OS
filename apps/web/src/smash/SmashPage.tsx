import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, CLIENT_ID } from "../api";
import BackButton from "../BackButton";
import { useLiveUpdates } from "../useLiveUpdates";
import { SMASH_TITLES, rosterForTitle } from "@gamenight/shared";
import "./smash.css";

type Mode = "ffa" | "koth";
type Format = "ffa" | "koth" | "bestof";
type BestOf = 3 | 5 | 7;
type Assignment = "self" | "random" | "host";
type Detail = "winner" | "placement";

interface Slot {
  id: string;
  kind: "member" | "guest";
  userId: string | null;
  name: string;
  character: string | null;
}
interface Koth {
  kingId: string | null;
  queue: string[];
  streak: number;
  bestStreak: { playerId: string; streak: number } | null;
}
interface GameLine { playerId: string; character: string | null; placement: number; isWinner: boolean }
interface SeriesT { idx: number; aId: string; bId: string; games: { winnerId: string }[]; winnerId: string | null; at: string | null }
interface SeriesStanding {
  slotId: string; name: string; seriesWins: number; seriesPlayed: number;
  gameWins: number; gamesPlayed: number; currentStreak: number; bestStreak: number;
}
interface Session {
  status: "setup" | "live" | "completed";
  groupId: string;
  format: Format;
  titleId: string | null;
  mode: Mode;
  assignment: Assignment;
  resultDetail: Detail;
  openScoring: boolean;
  roster: Slot[];
  games: { idx: number; mode: Mode; lines: GameLine[]; at: string }[];
  koth: Koth | null;
  bestOf: BestOf;
  series: SeriesT | null;
  seriesLog: SeriesT[];
  seriesStandings: SeriesStanding[];
  summary: {
    characters: { character: string; played: number; wins: number }[];
    players: { playerId: string; name: string; played: number; wins: number; mainCharacter: string | null }[];
  };
}
interface Ctx {
  groupId: string;
  canHost: boolean;
  viewerId: string;
  prefill: { userId: string; name: string }[];
  members: { userId: string; name: string }[];
  live: boolean;
}

function FighterSelect({
  value,
  onChange,
  roster,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  roster: readonly string[];
}) {
  return (
    <select className="sm-select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Pick a fighter</option>
      {roster.map((f) => (
        <option key={f} value={f}>{f}</option>
      ))}
    </select>
  );
}

export default function SmashPage() {
  const eventId = new URLSearchParams(window.location.search).get("event") ?? "";
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Newest-request-wins guard for mutation responses under rapid taps.
  const reqSeq = useRef(0);

  async function refetch() {
    if (!eventId) return;
    const [c, s] = await Promise.all([
      api<Ctx>(`/api/smash-context/${eventId}`).catch(() => null),
      api<{ session: Session | null }>(`/api/smash/${eventId}`).catch(() => ({ session: null })),
    ]);
    if (c) setCtx(c);
    setSession(s.session);
  }

  useEffect(() => {
    refetch().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Own echoes are skipped: every mutation response already carries the
  // updated session, so refetching on them would double the traffic.
  useLiveUpdates(
    (m) => {
      if (m.origin === CLIENT_ID) return;
      if ((m.type === "smash_updated" || m.type === "leaderboard_updated") && m.eventId === eventId) refetch();
    },
    () => refetch(),
  );

  // Mutations return the updated session; apply it directly. An optional
  // optimistic updater paints simple changes (fighter picks) before the
  // network answers, rolling back to the snapshot on failure.
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

  // Start a format. A live session 409s; confirm a replace with the host, then
  // resend with force (standing rule 8: confirm-and-replace, never a silent
  // clobber).
  async function startSession(payload: Record<string, unknown>) {
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ session: Session | null }>(`/api/events/${eventId}/smash`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (r && typeof r === "object" && "session" in r) setSession(r.session);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409) {
        setBusy(false);
        if (window.confirm("A session is already in progress on this event. Replace it? Any unfinished game or set is lost.")) {
          await startSession({ ...payload, force: true });
        }
        return;
      }
      setErr(e?.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!eventId) {
    return (
      <div className="sm-root"><div className="sm-wrap"><p className="sm-hint">No event specified.</p><BackButton /></div></div>
    );
  }
  if (loading) {
    return <div className="sm-root"><div className="sm-wrap"><p className="sm-hint">Loading...</p></div></div>;
  }

  return (
    <div className="sm-root">
      <div className="sm-wrap">
        <div className="sm-top">
          <BackButton className="sm-textbtn" />
          <Link to={`/smash/tv/${eventId}`} className="sm-textbtn">📺 TV</Link>
        </div>
        <div>
          <div className="sm-brand">Smash <em>Night</em></div>
          <div className="sm-sub">Free-for-all, King of the Hill &amp; Best Of</div>
        </div>

        {err && <p className="sm-err">{err}</p>}

        {!session || session.status === "completed" ? (
          <SetupOrWaiting
            ctx={ctx}
            completed={session?.status === "completed"}
            busy={busy}
            onStart={(payload) => startSession(payload)}
          />
        ) : (
          <LivePlay
            eventId={eventId}
            ctx={ctx}
            session={session}
            busy={busy}
            call={call}
          />
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
  onStart: (p: Record<string, unknown>) => void;
}) {
  // A format chosen upstream (the game>format picker) arrives as ?format=
  // (older links used ?mode=).
  const qs = new URLSearchParams(window.location.search);
  const qFormat = qs.get("format");
  const initialFormat: Format =
    qFormat === "koth" || qFormat === "bestof" || qFormat === "ffa"
      ? qFormat
      : qs.get("mode") === "koth"
      ? "koth"
      : "ffa";
  const [format, setFormat] = useState<Format>(initialFormat);
  const [bestOf, setBestOf] = useState<BestOf>(3);
  const [titleId, setTitleId] = useState<string>(SMASH_TITLES[0]!.id);
  const [assignment, setAssignment] = useState<Assignment>("self");
  const [detail, setDetail] = useState<Detail>("winner");
  const [roster, setRoster] = useState<{ userId: string | null; name: string }[]>([]);
  const [guest, setGuest] = useState("");

  useEffect(() => {
    if (ctx && roster.length === 0) {
      setRoster(ctx.prefill.map((p) => ({ userId: p.userId, name: p.name })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  if (!ctx) return <p className="sm-hint" style={{ marginTop: 16 }}>Loading...</p>;

  if (!ctx.canHost) {
    return (
      <div className="sm-card" style={{ marginTop: 16 }}>
        <div className="sm-h">Waiting for the host</div>
        <p className="sm-hint">The crew owner or an admin starts the night. This screen updates live the moment they do.</p>
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
        <div className="sm-card" style={{ marginTop: 16 }}>
          <p className="sm-hint">That format wrapped. Pick a format below to run another one tonight.</p>
        </div>
      )}
      <div className="sm-card" style={{ marginTop: 16 }}>
        <div className="sm-h">Which game?</div>
        <select className="sm-select" value={titleId} onChange={(e) => setTitleId(e.target.value)}>
          {SMASH_TITLES.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <p className="sm-hint" style={{ marginTop: 8 }}>
          Scopes the fighter list and random assignment to this game's roster. Stats stay combined across games.
        </p>
      </div>

      <div className="sm-card">
        <div className="sm-h">Format</div>
        <div className="sm-seg">
          <button className={format === "ffa" ? "on" : ""} onClick={() => setFormat("ffa")}>Free-for-all</button>
          <button className={format === "koth" ? "on" : ""} onClick={() => setFormat("koth")}>King of the Hill</button>
          <button className={format === "bestof" ? "on" : ""} onClick={() => setFormat("bestof")}>Best Of</button>
        </div>
        <p className="sm-hint" style={{ marginTop: 8 }}>
          {format === "ffa"
            ? "2 to 8 players per game, played across the night."
            : format === "koth"
            ? "Winner stays on, loser rotates out. First up is first in the list."
            : "1v1 sets. Pick two players; a set records once, when it is won."}
        </p>
        {format === "bestof" && (
          <>
            <div className="sm-h" style={{ marginTop: 14 }}>Set length</div>
            <div className="sm-seg">
              {[3, 5, 7].map((n) => (
                <button key={n} className={bestOf === n ? "on" : ""} onClick={() => setBestOf(n as BestOf)}>Best of {n}</button>
              ))}
            </div>
            <p className="sm-hint" style={{ marginTop: 8 }}>First to {Math.floor(bestOf / 2) + 1} games wins the set.</p>
          </>
        )}
      </div>

      <div className="sm-card">
        <div className="sm-h">Fighters</div>
        <div className="sm-seg">
          <button className={assignment === "self" ? "on" : ""} onClick={() => setAssignment("self")}>Players pick</button>
          <button className={assignment === "random" ? "on" : ""} onClick={() => setAssignment("random")}>Random</button>
          <button className={assignment === "host" ? "on" : ""} onClick={() => setAssignment("host")}>Host picks</button>
        </div>
        {format !== "bestof" && (
          <>
            <div className="sm-h" style={{ marginTop: 14 }}>Result detail</div>
            <div className="sm-seg">
              <button className={detail === "winner" ? "on" : ""} onClick={() => setDetail("winner")}>Winner only</button>
              <button className={detail === "placement" ? "on" : ""} onClick={() => setDetail("placement")}>Full placement</button>
            </div>
            <p className="sm-hint" style={{ marginTop: 8 }}>Winner-only is one tap. Full placement records the whole 1-2-3 order.</p>
          </>
        )}
      </div>

      <div className="sm-card">
        <div className="sm-h">Players ({roster.length})</div>
        {roster.map((r, i) => (
          <div className="sm-row" key={`${r.userId ?? "g"}-${i}`}>
            <span className="sm-name" style={{ flex: 1 }}>{r.name}</span>
            {!r.userId && <span className="sm-pill">guest</span>}
            <button className="sm-textbtn" onClick={() => removeAt(i)}>remove</button>
          </div>
        ))}
        {roster.length === 0 && <p className="sm-hint">Add players from the crew or type a guest.</p>}

        {notAdded.length > 0 && (
          <>
            <div className="sm-lab" style={{ marginTop: 12 }}>Add from crew</div>
            <div className="sm-seg">
              {notAdded.map((m) => (
                <button key={m.userId} onClick={() => addMember(m)}>+ {m.name}</button>
              ))}
            </div>
          </>
        )}
        <div className="sm-lab" style={{ marginTop: 12 }}>Add a guest</div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            className="sm-input"
            placeholder="Guest name"
            value={guest}
            onChange={(e) => setGuest(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addGuest()}
          />
          <button className="sm-btn sm-btn--ghost" style={{ width: "auto", padding: "0 16px" }} onClick={addGuest}>Add</button>
        </div>
        <p className="sm-hint" style={{ marginTop: 8 }}>Guests play, but lifetime stats only count crew members.</p>
      </div>

      <button
        className="sm-btn"
        style={{ marginTop: 12 }}
        disabled={busy || roster.length < 2}
        onClick={() => onStart({ titleId, format, bestOf, assignment, resultDetail: detail, roster })}
      >
        {roster.length < 2
          ? "Add at least 2 players"
          : `Start ${format === "ffa" ? "FFA" : format === "koth" ? "King of the Hill" : "Best Of"}`}
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
  const viewerId = ctx?.viewerId ?? "";
  const canScore = canHost || session.openScoring;
  const titleRoster = useMemo(() => rosterForTitle(SMASH_TITLES, session.titleId), [session.titleId]);
  const nameOf = useMemo(() => new Map(session.roster.map((p) => [p.id, p.name])), [session.roster]);

  // Optimistic: the dropdown reflects the pick instantly.
  const setChar = (playerId: string, character: string | null) =>
    call(`/api/smash/${eventId}/character`, { playerId, character }, (s) => ({
      ...s,
      roster: s.roster.map((p) => (p.id === playerId ? { ...p, character } : p)),
    }));

  const mayEditChar = (slot: Slot) =>
    canHost || (session.assignment === "self" && slot.userId === viewerId);

  return (
    <>
      {/* Roster + fighters */}
      <div className="sm-card" style={{ marginTop: 16 }}>
        <div className="sm-h">Fighters</div>
        {session.roster.map((slot) => {
          const isKing = session.koth?.kingId === slot.id;
          return (
            <div className="sm-row" key={slot.id}>
              <div style={{ flex: 1 }}>
                <div className="sm-name">
                  {slot.name} {isKing && <span className="sm-pill sm-pill--king">👑 king</span>}
                </div>
                <div className="sm-char">{slot.character ?? "no fighter yet"}</div>
              </div>
              {mayEditChar(slot) && (
                <div style={{ width: 160 }}>
                  <FighterSelect value={slot.character} onChange={(v) => setChar(slot.id, v)} roster={titleRoster} />
                </div>
              )}
            </div>
          );
        })}
        {canHost && (session.assignment === "random" || session.assignment === "host") && (
          <button className="sm-btn sm-btn--ghost" style={{ marginTop: 10 }} disabled={busy} onClick={() => call(`/api/smash/${eventId}/randomize`)}>
            🎲 Randomize all fighters
          </button>
        )}
      </div>

      {/* Play area */}
      {canScore ? (
        session.format === "bestof" ? (
          <BestOfPlay
            session={session}
            nameOf={nameOf}
            busy={busy}
            onStartSet={(aId, bId) => call(`/api/smash/${eventId}/start-series`, { aId, bId })}
            onWin={(winnerId) => call(`/api/smash/${eventId}/record`, { winnerId })}
          />
        ) : session.mode === "koth" ? (
          <KothPlay session={session} nameOf={nameOf} busy={busy} onWin={(winnerId) => call(`/api/smash/${eventId}/record`, { winnerId })} />
        ) : (
          <FfaPlay session={session} busy={busy} onRecord={(lines) => call(`/api/smash/${eventId}/record`, { lines })} />
        )
      ) : (
        <div className="sm-card">
          <p className="sm-hint">The host is recording results. Standings update live below.</p>
        </div>
      )}

      {/* Night summary */}
      {session.format === "bestof" ? (
        <div className="sm-card">
          <div className="sm-h">Tonight ({session.seriesLog.length} set{session.seriesLog.length === 1 ? "" : "s"})</div>
          {session.seriesStandings.length === 0 ? (
            <p className="sm-hint">No sets finished yet.</p>
          ) : (
            session.seriesStandings.map((p) => (
              <div className="sm-row" key={p.slotId}>
                <span style={{ flex: 1 }} className="sm-name">
                  {p.name}
                  {p.currentStreak >= 2 ? ` 🔥${p.currentStreak}` : ""}
                </span>
                <span className="sm-char">{p.seriesWins}W / {p.seriesPlayed} sets · {p.gameWins} game W</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="sm-card">
          <div className="sm-h">Tonight ({session.games.length} game{session.games.length === 1 ? "" : "s"})</div>
          {session.summary.players.length === 0 ? (
            <p className="sm-hint">No games recorded yet.</p>
          ) : (
            <>
              <div className="sm-lab">Players</div>
              {session.summary.players.map((p) => (
                <div className="sm-row" key={p.playerId}>
                  <span style={{ flex: 1 }} className="sm-name">{p.name}</span>
                  <span className="sm-char">{p.wins}W / {p.played} · {p.mainCharacter ?? "-"}</span>
                </div>
              ))}
              {session.summary.characters.length > 0 && (
                <>
                  <div className="sm-lab" style={{ marginTop: 12 }}>Fighters</div>
                  {session.summary.characters.slice(0, 6).map((c) => (
                    <div className="sm-row" key={c.character}>
                      <span style={{ flex: 1 }} className="sm-name">{c.character}</span>
                      <span className="sm-char">{c.wins}W / {c.played}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Host controls */}
      {canHost && (
        <div className="sm-card">
          <div className="sm-h">Host controls</div>
          <div className="sm-row">
            <span style={{ flex: 1 }}>Let members record results</span>
            <button
              className={`gn-toggle ${session.openScoring ? "gn-toggle--on" : "gn-toggle--off"}`}
              aria-pressed={session.openScoring}
              onClick={() => call(`/api/smash/${eventId}/open-scoring`, { open: !session.openScoring })}
            >
              {session.openScoring ? "ON" : "OFF"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              className="sm-btn sm-btn--ghost"
              disabled={
                busy ||
                (session.format === "bestof"
                  ? (session.series?.games.length ?? 0) === 0 && session.seriesLog.length === 0
                  : session.games.length === 0)
              }
              onClick={() => call(`/api/smash/${eventId}/undo`)}
            >
              ↶ Undo last
            </button>
            <button className="sm-btn sm-btn--go" disabled={busy} onClick={() => call(`/api/smash/${eventId}/complete`)}>End format</button>
          </div>
          <p className="sm-hint" style={{ marginTop: 8 }}>
            Ending the format wraps this run and takes you back to the format picker, so you can go from FFA into King of the Hill (or run it back).
          </p>
        </div>
      )}
    </>
  );
}

// ---------- KOTH play ----------

function KothPlay({
  session,
  nameOf,
  busy,
  onWin,
}: {
  session: Session;
  nameOf: Map<string, string>;
  busy: boolean;
  onWin: (winnerId: string) => void;
}) {
  const koth = session.koth;
  const kingId = koth?.kingId ?? null;
  const challengerId = koth?.queue[0] ?? null;
  const charOf = useMemo(() => new Map(session.roster.map((p) => [p.id, p.character])), [session.roster]);

  if (!kingId || !challengerId) {
    return <div className="sm-card"><p className="sm-hint">Need at least two players queued to play.</p></div>;
  }
  return (
    <div className="sm-card">
      <div className="sm-h">Next round {koth && koth.streak > 0 ? `· king on a ${koth.streak} streak` : ""}</div>
      <div className="sm-vs">
        <button className="sm-fighter" disabled={busy} onClick={() => onWin(kingId)}>
          <div className="sm-fighter__n">{nameOf.get(kingId)}</div>
          <div className="sm-fighter__c">{charOf.get(kingId) ?? "no fighter"}</div>
          <div className="sm-pill sm-pill--king" style={{ marginTop: 6 }}>👑 defending</div>
        </button>
        <div className="sm-vsbadge">VS</div>
        <button className="sm-fighter" disabled={busy} onClick={() => onWin(challengerId)}>
          <div className="sm-fighter__n">{nameOf.get(challengerId)}</div>
          <div className="sm-fighter__c">{charOf.get(challengerId) ?? "no fighter"}</div>
          <div className="sm-pill" style={{ marginTop: 6 }}>challenger</div>
        </button>
      </div>
      <p className="sm-hint" style={{ marginTop: 10 }}>Tap the winner. Loser goes to the back of the line.</p>
      {koth?.queue.length ? (
        <p className="sm-hint">Up next: {koth.queue.slice(1).map((id) => nameOf.get(id)).join(", ") || "—"}</p>
      ) : null}
    </div>
  );
}

// ---------- FFA play ----------

function FfaPlay({
  session,
  busy,
  onRecord,
}: {
  session: Session;
  busy: boolean;
  onRecord: (lines: { playerId: string; placement: number; isWinner: boolean }[]) => void;
}) {
  // Everyone plays by default: most FFA nights are full-roster games, so
  // the checklist starts all-on and "record" resets it back to all-on.
  const allChecked = () =>
    Object.fromEntries(session.roster.map((p): [string, boolean] => [p.id, true]));
  const [inGame, setInGame] = useState<Record<string, boolean>>(allChecked);
  const [winner, setWinner] = useState<string | null>(null);
  const [places, setPlaces] = useState<Record<string, number>>({});

  const active = session.roster.filter((p) => inGame[p.id]);
  const everyoneIn = active.length === session.roster.length;
  const detail = session.resultDetail;

  const toggle = (id: string) => setInGame((s) => ({ ...s, [id]: !s[id] }));

  const record = () => {
    if (detail === "winner") {
      if (!winner) return;
      onRecord(active.map((p) => ({ playerId: p.id, placement: p.id === winner ? 1 : 2, isWinner: p.id === winner })));
    } else {
      onRecord(active.map((p) => ({ playerId: p.id, placement: places[p.id] ?? 0, isWinner: (places[p.id] ?? 0) === 1 })));
    }
    setInGame(allChecked());
    setWinner(null);
    setPlaces({});
  };

  const ready =
    active.length >= 2 &&
    (detail === "winner"
      ? !!winner && inGame[winner]
      : active.every((p) => (places[p.id] ?? 0) >= 1 && (places[p.id] ?? 0) <= active.length) &&
        new Set(active.map((p) => places[p.id] ?? 0)).size === active.length);

  return (
    <div className="sm-card">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div className="sm-h">Record a game</div>
        <button
          className="sm-textbtn"
          onClick={() => setInGame(everyoneIn ? {} : allChecked())}
        >
          {everyoneIn ? "clear all" : "check all"}
        </button>
      </div>
      <p className="sm-hint" style={{ marginBottom: 8 }}>Everyone starts checked; untick who sat out, then {detail === "winner" ? "tap the winner" : "set each placement"}.</p>
      {session.roster.map((p) => (
        <div className="sm-row" key={p.id}>
          <input type="checkbox" checked={!!inGame[p.id]} onChange={() => toggle(p.id)} />
          <div style={{ flex: 1 }}>
            <div className="sm-name">{p.name}</div>
            <div className="sm-char">{p.character ?? "no fighter"}</div>
          </div>
          {inGame[p.id] && detail === "winner" && (
            <button className={winner === p.id ? "sm-fighter win" : "sm-textbtn"} style={{ padding: "6px 12px" }} onClick={() => setWinner(p.id)}>
              {winner === p.id ? "★ winner" : "win"}
            </button>
          )}
          {inGame[p.id] && detail === "placement" && (
            <select
              className="sm-select"
              style={{ width: 72 }}
              value={places[p.id] ?? ""}
              onChange={(e) => setPlaces((s) => ({ ...s, [p.id]: Number(e.target.value) }))}
            >
              <option value="">–</option>
              {active.map((_, i) => (
                <option key={i + 1} value={i + 1}>{i + 1}</option>
              ))}
            </select>
          )}
        </div>
      ))}
      <button className="sm-btn" style={{ marginTop: 12 }} disabled={busy || !ready} onClick={record}>
        {active.length < 2 ? "Pick at least 2 players" : "Record game"}
      </button>
    </div>
  );
}

// ---------- Best Of play (1v1 sets) ----------

function BestOfPlay({
  session,
  nameOf,
  busy,
  onStartSet,
  onWin,
}: {
  session: Session;
  nameOf: Map<string, string>;
  busy: boolean;
  onStartSet: (aId: string, bId: string) => void;
  onWin: (winnerId: string) => void;
}) {
  const charOf = useMemo(() => new Map(session.roster.map((p) => [p.id, p.character])), [session.roster]);
  const [pickA, setPickA] = useState("");
  const [pickB, setPickB] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const cur = session.series;
  const need = Math.floor(session.bestOf / 2) + 1;

  const wins = cur
    ? cur.games.reduce(
        (acc, g) => {
          if (g.winnerId === cur.aId) acc.a++;
          else if (g.winnerId === cur.bId) acc.b++;
          return acc;
        },
        { a: 0, b: 0 },
      )
    : { a: 0, b: 0 };

  if (!cur || showPicker) {
    return (
      <div className="sm-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="sm-h">Start a set</div>
          {cur && <button className="sm-textbtn" onClick={() => setShowPicker(false)}>cancel</button>}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <select className="sm-select" value={pickA} onChange={(e) => setPickA(e.target.value)}>
            <option value="">Player 1</option>
            {session.roster.map((p) => <option key={p.id} value={p.id} disabled={p.id === pickB}>{p.name}</option>)}
          </select>
          <select className="sm-select" value={pickB} onChange={(e) => setPickB(e.target.value)}>
            <option value="">Player 2</option>
            {session.roster.map((p) => <option key={p.id} value={p.id} disabled={p.id === pickA}>{p.name}</option>)}
          </select>
        </div>
        <button
          className="sm-btn"
          style={{ marginTop: 10 }}
          disabled={busy || !pickA || !pickB || pickA === pickB}
          onClick={() => { onStartSet(pickA, pickB); setPickA(""); setPickB(""); setShowPicker(false); }}
        >
          Start best of {session.bestOf}
        </button>
      </div>
    );
  }

  return (
    <div className="sm-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="sm-h" style={{ margin: 0 }}>On stage · first to {need}</div>
        <span className="sm-hint">best of {session.bestOf}</span>
      </div>
      <div className="sm-score" style={{ margin: "8px 0 12px" }}>{wins.a} &ndash; {wins.b}</div>
      <div className="sm-vs">
        <button className="sm-fighter" disabled={busy} onClick={() => onWin(cur.aId)}>
          <div className="sm-fighter__n">{nameOf.get(cur.aId)}</div>
          <div className="sm-fighter__c">{charOf.get(cur.aId) ?? "no fighter"}</div>
        </button>
        <div className="sm-vsbadge">VS</div>
        <button className="sm-fighter" disabled={busy} onClick={() => onWin(cur.bId)}>
          <div className="sm-fighter__n">{nameOf.get(cur.bId)}</div>
          <div className="sm-fighter__c">{charOf.get(cur.bId) ?? "no fighter"}</div>
        </button>
      </div>
      <p className="sm-hint" style={{ marginTop: 10 }}>Tap the winner of each game. The set records when someone reaches {need}.</p>
      {cur.games.length === 0 && (
        <button className="sm-textbtn" style={{ marginTop: 4 }} onClick={() => { setPickA(""); setPickB(""); setShowPicker(true); }}>
          Change players
        </button>
      )}
    </div>
  );
}

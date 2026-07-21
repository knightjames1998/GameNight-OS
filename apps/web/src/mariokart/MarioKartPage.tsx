import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, CLIENT_ID } from "../api";
import BackButton from "../BackButton";
import { useLiveUpdates } from "../useLiveUpdates";
import { MARIO_KART_TITLES, rosterForTitle } from "@gamenight/shared";
import "./mariokart.css";

// Mario Kart race night. Four formats: Free Play (single races), Grand Prix
// (a cup of N races scored on cumulative points), Best Of (1v1 series), and
// King of the Hill. Session-based like Smash (host's live session,
// materializes to lifetime stats, own TV mode), and it reuses the shared
// best-of + KOTH primitives. Beerio Kart is a separate pack and stays put.

type Assignment = "self" | "random" | "host";
type Detail = "winner" | "placement";
type Format = "free" | "grandprix" | "bestof" | "koth";
type BestOf = 3 | 5 | 7;

interface Slot {
  id: string;
  kind: "member" | "guest";
  userId: string | null;
  name: string;
  character: string | null;
}
interface GameLine { playerId: string; character: string | null; placement: number; isWinner: boolean }
interface SeriesT { idx: number; aId: string; bId: string; games: { winnerId: string }[]; winnerId: string | null; at: string | null }
interface SeriesStanding {
  slotId: string; name: string; seriesWins: number; seriesPlayed: number;
  gameWins: number; gamesPlayed: number; currentStreak: number; bestStreak: number;
}
interface CupStanding { playerId: string; name: string; points: number; wins: number; races: number }
interface Cup { standings: CupStanding[]; cupNo: number; racesDone: number; raceCount: number; complete: boolean }
interface Koth { kingId: string | null; queue: string[]; streak: number }
interface Session {
  status: "setup" | "live" | "completed";
  groupId: string;
  format: Format;
  titleId: string | null;
  mode: "ffa" | "koth";
  assignment: Assignment;
  resultDetail: Detail;
  openScoring: boolean;
  roster: Slot[];
  games: { idx: number; lines: GameLine[]; at: string }[];
  koth: Koth | null;
  bestOf: BestOf;
  series: SeriesT | null;
  seriesLog: SeriesT[];
  seriesStandings: SeriesStanding[];
  cup: Cup | null;
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

function RacerSelect({
  value,
  onChange,
  roster,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  roster: readonly string[];
}) {
  return (
    <select className="mk-select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Pick a racer</option>
      {roster.map((r) => (
        <option key={r} value={r}>{r}</option>
      ))}
    </select>
  );
}

export default function MarioKartPage() {
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
      api<Ctx>(`/api/mariokart-context/${eventId}`).catch(() => null),
      api<{ session: Session | null }>(`/api/mariokart/${eventId}`).catch(() => ({ session: null })),
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
      if ((m.type === "mario_kart_updated" || m.type === "leaderboard_updated") && m.eventId === eventId) refetch();
    },
    () => refetch(),
  );

  // Mutations return the updated session; apply it directly. An optional
  // optimistic updater paints simple changes before the network answers,
  // rolling back to the snapshot on failure.
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
      const r = await api<{ session: Session | null }>(`/api/events/${eventId}/mariokart`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (r && typeof r === "object" && "session" in r) setSession(r.session);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409) {
        setBusy(false);
        if (window.confirm("A session is already in progress on this event. Replace it? Any unfinished race or set is lost.")) {
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
    return <div className="mk-root"><div className="mk-wrap"><p className="mk-hint">No event specified.</p><BackButton /></div></div>;
  }
  if (loading) {
    return <div className="mk-root"><div className="mk-wrap"><p className="mk-hint">Loading...</p></div></div>;
  }

  return (
    <div className="mk-root">
      <div className="mk-wrap">
        <div className="mk-top">
          <BackButton className="mk-textbtn" />
          <Link to={`/mariokart/tv/${eventId}`} className="mk-textbtn">📺 TV</Link>
        </div>
        <div>
          <div className="mk-brand">Mario Kart</div>
          <div className="mk-sub">Race night · free-for-all tracking</div>
        </div>

        {err && <p className="mk-err">{err}</p>}

        {!session || session.status === "completed" ? (
          <SetupOrWaiting
            ctx={ctx}
            completed={session?.status === "completed"}
            busy={busy}
            onStart={(payload) => startSession(payload)}
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
  onStart: (p: Record<string, unknown>) => void;
}) {
  const qFormat = new URLSearchParams(window.location.search).get("format");
  const initialFormat: Format =
    qFormat === "grandprix" || qFormat === "bestof" || qFormat === "koth" || qFormat === "free" ? qFormat : "free";
  const [format, setFormat] = useState<Format>(initialFormat);
  const [bestOf, setBestOf] = useState<BestOf>(3);
  const [raceCount, setRaceCount] = useState(4);
  const [titleId, setTitleId] = useState<string>(MARIO_KART_TITLES[0]!.id);
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

  if (!ctx) return <p className="mk-hint" style={{ marginTop: 16 }}>Loading...</p>;

  if (!ctx.canHost) {
    return (
      <div className="mk-card" style={{ marginTop: 16 }}>
        <div className="mk-h">Waiting for the host</div>
        <p className="mk-hint">The crew owner or an admin starts the night. This screen updates live the moment they do.</p>
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
        <div className="mk-card" style={{ marginTop: 16 }}>
          <p className="mk-hint">That race night wrapped. Starting again begins a fresh session for this event.</p>
        </div>
      )}
      <div className="mk-card" style={{ marginTop: 16 }}>
        <div className="mk-h">Which game?</div>
        <select className="mk-select" value={titleId} onChange={(e) => setTitleId(e.target.value)}>
          {MARIO_KART_TITLES.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <p className="mk-hint" style={{ marginTop: 8 }}>
          Scopes the racer list and random assignment to this game's roster. Stats stay combined across games.
        </p>
      </div>

      <div className="mk-card">
        <div className="mk-h">Format</div>
        <div className="mk-seg">
          <button className={format === "free" ? "on" : ""} onClick={() => setFormat("free")}>Free Play</button>
          <button className={format === "grandprix" ? "on" : ""} onClick={() => setFormat("grandprix")}>Grand Prix</button>
          <button className={format === "bestof" ? "on" : ""} onClick={() => setFormat("bestof")}>Best Of</button>
          <button className={format === "koth" ? "on" : ""} onClick={() => setFormat("koth")}>King of the Hill</button>
        </div>
        <p className="mk-hint" style={{ marginTop: 8 }}>
          {format === "free"
            ? "Single races, logged one at a time."
            : format === "grandprix"
            ? "A cup of races scored on cumulative Mario Kart points. Each race still counts on its own."
            : format === "bestof"
            ? "1v1 sets. Pick two players; a set records once, when it is won."
            : "Winner stays on, loser rotates out. First up is first in the list."}
        </p>
        {format === "grandprix" && (
          <>
            <div className="mk-h" style={{ marginTop: 14 }}>Races per cup</div>
            <div className="mk-seg">
              {[3, 4, 6, 8].map((n) => (
                <button key={n} className={raceCount === n ? "on" : ""} onClick={() => setRaceCount(n)}>{n}</button>
              ))}
            </div>
          </>
        )}
        {format === "bestof" && (
          <>
            <div className="mk-h" style={{ marginTop: 14 }}>Set length</div>
            <div className="mk-seg">
              {[3, 5, 7].map((n) => (
                <button key={n} className={bestOf === n ? "on" : ""} onClick={() => setBestOf(n as BestOf)}>Best of {n}</button>
              ))}
            </div>
            <p className="mk-hint" style={{ marginTop: 8 }}>First to {Math.floor(bestOf / 2) + 1} races wins the set.</p>
          </>
        )}
      </div>

      <div className="mk-card">
        <div className="mk-h">Racers</div>
        <div className="mk-seg">
          <button className={assignment === "self" ? "on" : ""} onClick={() => setAssignment("self")}>Players pick</button>
          <button className={assignment === "random" ? "on" : ""} onClick={() => setAssignment("random")}>Random</button>
          <button className={assignment === "host" ? "on" : ""} onClick={() => setAssignment("host")}>Host picks</button>
        </div>
        {(format === "free" || format === "grandprix") && (
          <>
            <div className="mk-h" style={{ marginTop: 14 }}>Result detail</div>
            <div className="mk-seg">
              <button className={detail === "winner" ? "on" : ""} onClick={() => setDetail("winner")}>Winner only</button>
              <button className={detail === "placement" ? "on" : ""} onClick={() => setDetail("placement")}>Full placement</button>
            </div>
            <p className="mk-hint" style={{ marginTop: 8 }}>
              {format === "grandprix"
                ? "Full placement is recommended for Grand Prix so every position scores points."
                : "Winner-only is one tap. Full placement records the whole finishing order."}
            </p>
          </>
        )}
      </div>

      <div className="mk-card">
        <div className="mk-h">Players ({roster.length})</div>
        {roster.map((r, i) => (
          <div className="mk-row" key={`${r.userId ?? "g"}-${i}`}>
            <span className="mk-name" style={{ flex: 1 }}>{r.name}</span>
            {!r.userId && <span className="mk-pill">guest</span>}
            <button className="mk-textbtn" onClick={() => removeAt(i)}>remove</button>
          </div>
        ))}
        {roster.length === 0 && <p className="mk-hint">Add players from the crew or type a guest.</p>}

        {notAdded.length > 0 && (
          <>
            <div className="mk-lab" style={{ marginTop: 12 }}>Add from crew</div>
            <div className="mk-seg">
              {notAdded.map((m) => (
                <button key={m.userId} onClick={() => addMember(m)}>+ {m.name}</button>
              ))}
            </div>
          </>
        )}
        <div className="mk-lab" style={{ marginTop: 12 }}>Add a guest</div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            className="mk-input"
            placeholder="Guest name"
            value={guest}
            onChange={(e) => setGuest(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addGuest()}
          />
          <button className="mk-btn mk-btn--ghost" style={{ width: "auto", padding: "0 16px" }} onClick={addGuest}>Add</button>
        </div>
        <p className="mk-hint" style={{ marginTop: 8 }}>Guests race, but lifetime stats only count crew members.</p>
      </div>

      <button
        className="mk-btn"
        style={{ marginTop: 12 }}
        disabled={busy || roster.length < 2}
        onClick={() => onStart({ titleId, format, bestOf, raceCount, assignment, resultDetail: detail, roster })}
      >
        {roster.length < 2
          ? "Add at least 2 players"
          : `Start ${format === "free" ? "Free Play" : format === "grandprix" ? "Grand Prix" : format === "bestof" ? "Best Of" : "King of the Hill"}`}
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
  const titleRoster = rosterForTitle(MARIO_KART_TITLES, session.titleId);

  // Optimistic: the dropdown reflects the pick instantly.
  const setChar = (playerId: string, character: string | null) =>
    call(`/api/mariokart/${eventId}/character`, { playerId, character }, (s) => ({
      ...s,
      roster: s.roster.map((p) => (p.id === playerId ? { ...p, character } : p)),
    }));

  const mayEditChar = (slot: Slot) =>
    canHost || (session.assignment === "self" && slot.userId === viewerId);

  return (
    <>
      <div className="mk-card" style={{ marginTop: 16 }}>
        <div className="mk-h">Racers</div>
        {session.roster.map((slot) => (
          <div className="mk-row" key={slot.id}>
            <div style={{ flex: 1 }}>
              <div className="mk-name">{slot.name}</div>
              <div className="mk-char">{slot.character ?? "no racer yet"}</div>
            </div>
            {mayEditChar(slot) && (
              <div style={{ width: 170 }}>
                <RacerSelect value={slot.character} onChange={(v) => setChar(slot.id, v)} roster={titleRoster} />
              </div>
            )}
          </div>
        ))}
        {canHost && (session.assignment === "random" || session.assignment === "host") && (
          <button className="mk-btn mk-btn--ghost" style={{ marginTop: 10 }} disabled={busy} onClick={() => call(`/api/mariokart/${eventId}/randomize`)}>
            🎲 Randomize all racers
          </button>
        )}
      </div>

      {canScore ? (
        session.format === "bestof" ? (
          <BestOfPlay
            session={session}
            busy={busy}
            onStartSet={(aId, bId) => call(`/api/mariokart/${eventId}/start-series`, { aId, bId })}
            onWin={(winnerId) => call(`/api/mariokart/${eventId}/record`, { winnerId })}
          />
        ) : session.format === "koth" ? (
          <KothPlay session={session} busy={busy} onWin={(winnerId) => call(`/api/mariokart/${eventId}/record`, { winnerId })} />
        ) : (
          <RacePlay session={session} busy={busy} onRecord={(lines) => call(`/api/mariokart/${eventId}/record`, { lines })} />
        )
      ) : (
        <div className="mk-card">
          <p className="mk-hint">The host is recording results. Standings update live below.</p>
        </div>
      )}

      {/* Grand Prix cup standings (derived, no ledger row) */}
      {session.format === "grandprix" && session.cup && (
        <div className="mk-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div className="mk-h" style={{ margin: 0 }}>Cup {session.cup.cupNo}</div>
            <span className="mk-hint">
              {session.cup.complete ? "cup complete" : `race ${session.cup.racesDone + 1} of ${session.cup.raceCount}`}
            </span>
          </div>
          {session.cup.standings.length === 0 ? (
            <p className="mk-hint" style={{ marginTop: 8 }}>No races in this cup yet.</p>
          ) : (
            session.cup.standings.map((s, i) => (
              <div className="mk-row" key={s.playerId}>
                <span style={{ flex: 1 }} className="mk-name">{i === 0 && s.points > 0 ? "🏆 " : ""}{s.name}</span>
                <span className="mk-char">{s.points} pts · {s.wins}W</span>
              </div>
            ))
          )}
          {session.cup.complete && <p className="mk-hint" style={{ marginTop: 8 }}>Next race starts Cup {session.cup.cupNo + 1}.</p>}
        </div>
      )}

      {/* Night summary */}
      {session.format === "bestof" ? (
        <div className="mk-card">
          <div className="mk-h">Tonight ({session.seriesLog.length} set{session.seriesLog.length === 1 ? "" : "s"})</div>
          {session.seriesStandings.length === 0 ? (
            <p className="mk-hint">No sets finished yet.</p>
          ) : (
            session.seriesStandings.map((p) => (
              <div className="mk-row" key={p.slotId}>
                <span style={{ flex: 1 }} className="mk-name">{p.name}{p.currentStreak >= 2 ? ` 🔥${p.currentStreak}` : ""}</span>
                <span className="mk-char">{p.seriesWins}W / {p.seriesPlayed} sets · {p.gameWins} race W</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="mk-card">
          <div className="mk-h">Tonight ({session.games.length} race{session.games.length === 1 ? "" : "s"})</div>
          {session.summary.players.length === 0 ? (
            <p className="mk-hint">No races recorded yet.</p>
          ) : (
            <>
              <div className="mk-lab">Players</div>
              {session.summary.players.map((p) => (
                <div className="mk-row" key={p.playerId}>
                  <span style={{ flex: 1 }} className="mk-name">{p.name}</span>
                  <span className="mk-char">{p.wins}W / {p.played} · {p.mainCharacter ?? "-"}</span>
                </div>
              ))}
              {session.summary.characters.length > 0 && (
                <>
                  <div className="mk-lab" style={{ marginTop: 12 }}>Racers used</div>
                  {session.summary.characters.slice(0, 6).map((c) => (
                    <div className="mk-row" key={c.character}>
                      <span style={{ flex: 1 }} className="mk-name">{c.character}</span>
                      <span className="mk-char">{c.wins}W / {c.played}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {canHost && (
        <div className="mk-card">
          <div className="mk-h">Host controls</div>
          <div className="mk-row">
            <span style={{ flex: 1 }}>Let members record results</span>
            <button
              className={`gn-toggle ${session.openScoring ? "gn-toggle--on" : "gn-toggle--off"}`}
              aria-pressed={session.openScoring}
              onClick={() => call(`/api/mariokart/${eventId}/open-scoring`, { open: !session.openScoring })}
            >
              {session.openScoring ? "ON" : "OFF"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              className="mk-btn mk-btn--ghost"
              disabled={
                busy ||
                (session.format === "bestof"
                  ? (session.series?.games.length ?? 0) === 0 && session.seriesLog.length === 0
                  : session.games.length === 0)
              }
              onClick={() => call(`/api/mariokart/${eventId}/undo`)}
            >
              ↶ Undo last
            </button>
            <button className="mk-btn mk-btn--go" disabled={busy} onClick={() => call(`/api/mariokart/${eventId}/complete`)}>End race night</button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Race play (FFA) ----------

function RacePlay({
  session,
  busy,
  onRecord,
}: {
  session: Session;
  busy: boolean;
  onRecord: (lines: { playerId: string; placement: number; isWinner: boolean }[]) => void;
}) {
  // Everyone races by default; untick who sat out.
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
    <div className="mk-card">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div className="mk-h">Record a race</div>
        <button className="mk-textbtn" onClick={() => setInGame(everyoneIn ? {} : allChecked())}>
          {everyoneIn ? "clear all" : "check all"}
        </button>
      </div>
      <p className="mk-hint" style={{ marginBottom: 8 }}>Everyone starts checked; untick who sat out, then {detail === "winner" ? "tap the winner" : "set each placement"}.</p>
      {session.roster.map((p) => (
        <div className="mk-row" key={p.id}>
          <input type="checkbox" checked={!!inGame[p.id]} onChange={() => toggle(p.id)} />
          <div style={{ flex: 1 }}>
            <div className="mk-name">{p.name}</div>
            <div className="mk-char">{p.character ?? "no racer"}</div>
          </div>
          {inGame[p.id] && detail === "winner" && (
            <button className={winner === p.id ? "mk-fighter win" : "mk-textbtn"} style={{ padding: "6px 12px" }} onClick={() => setWinner(p.id)}>
              {winner === p.id ? "★ winner" : "win"}
            </button>
          )}
          {inGame[p.id] && detail === "placement" && (
            <select
              className="mk-select"
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
      <button className="mk-btn" style={{ marginTop: 12 }} disabled={busy || !ready} onClick={record}>
        {active.length < 2 ? "Pick at least 2 players" : "Record race"}
      </button>
    </div>
  );
}

// ---------- KOTH play ----------

function KothPlay({
  session,
  busy,
  onWin,
}: {
  session: Session;
  busy: boolean;
  onWin: (winnerId: string) => void;
}) {
  const koth = session.koth;
  const kingId = koth?.kingId ?? null;
  const challengerId = koth?.queue[0] ?? null;
  const nameOf = new Map(session.roster.map((p) => [p.id, p.name]));
  const charOf = new Map(session.roster.map((p) => [p.id, p.character]));

  if (!kingId || !challengerId) {
    return <div className="mk-card"><p className="mk-hint">Need at least two players queued to race.</p></div>;
  }
  return (
    <div className="mk-card">
      <div className="mk-h">Next race {koth && koth.streak > 0 ? `· king on a ${koth.streak} streak` : ""}</div>
      <div className="mk-vs">
        <button className="mk-fighter" disabled={busy} onClick={() => onWin(kingId)}>
          <div className="mk-fighter__n">{nameOf.get(kingId)}</div>
          <div className="mk-fighter__c">{charOf.get(kingId) ?? "no racer"} · 👑 king</div>
        </button>
        <div className="mk-vsbadge">VS</div>
        <button className="mk-fighter" disabled={busy} onClick={() => onWin(challengerId)}>
          <div className="mk-fighter__n">{nameOf.get(challengerId)}</div>
          <div className="mk-fighter__c">{charOf.get(challengerId) ?? "no racer"} · challenger</div>
        </button>
      </div>
      <p className="mk-hint" style={{ marginTop: 10 }}>Tap the winner. Loser goes to the back of the line.</p>
      {koth && koth.queue.length > 1 ? (
        <p className="mk-hint">Up next: {koth.queue.slice(1).map((id) => nameOf.get(id)).join(", ")}</p>
      ) : null}
    </div>
  );
}

// ---------- Best Of play (1v1 sets) ----------

function BestOfPlay({
  session,
  busy,
  onStartSet,
  onWin,
}: {
  session: Session;
  busy: boolean;
  onStartSet: (aId: string, bId: string) => void;
  onWin: (winnerId: string) => void;
}) {
  const nameOf = new Map(session.roster.map((p) => [p.id, p.name]));
  const charOf = new Map(session.roster.map((p) => [p.id, p.character]));
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
      <div className="mk-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="mk-h">Start a set</div>
          {cur && <button className="mk-textbtn" onClick={() => setShowPicker(false)}>cancel</button>}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <select className="mk-select" value={pickA} onChange={(e) => setPickA(e.target.value)}>
            <option value="">Player 1</option>
            {session.roster.map((p) => <option key={p.id} value={p.id} disabled={p.id === pickB}>{p.name}</option>)}
          </select>
          <select className="mk-select" value={pickB} onChange={(e) => setPickB(e.target.value)}>
            <option value="">Player 2</option>
            {session.roster.map((p) => <option key={p.id} value={p.id} disabled={p.id === pickA}>{p.name}</option>)}
          </select>
        </div>
        <button
          className="mk-btn"
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
    <div className="mk-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="mk-h" style={{ margin: 0 }}>On the grid · first to {need}</div>
        <span className="mk-hint">best of {session.bestOf}</span>
      </div>
      <div className="mk-score" style={{ margin: "8px 0 12px" }}>{wins.a} &ndash; {wins.b}</div>
      <div className="mk-vs">
        <button className="mk-fighter" disabled={busy} onClick={() => onWin(cur.aId)}>
          <div className="mk-fighter__n">{nameOf.get(cur.aId)}</div>
          <div className="mk-fighter__c">{charOf.get(cur.aId) ?? "no racer"}</div>
        </button>
        <div className="mk-vsbadge">VS</div>
        <button className="mk-fighter" disabled={busy} onClick={() => onWin(cur.bId)}>
          <div className="mk-fighter__n">{nameOf.get(cur.bId)}</div>
          <div className="mk-fighter__c">{charOf.get(cur.bId) ?? "no racer"}</div>
        </button>
      </div>
      <p className="mk-hint" style={{ marginTop: 10 }}>Tap the winner of each race. The set records when someone reaches {need}.</p>
      {cur.games.length === 0 && (
        <button className="mk-textbtn" style={{ marginTop: 4 }} onClick={() => { setPickA(""); setPickB(""); setShowPicker(true); }}>
          Change players
        </button>
      )}
    </div>
  );
}

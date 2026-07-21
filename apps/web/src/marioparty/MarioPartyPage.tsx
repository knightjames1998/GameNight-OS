import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, CLIENT_ID } from "../api";
import BackButton from "../BackButton";
import { useLiveUpdates } from "../useLiveUpdates";
import {
  MARIO_PARTY_TITLES,
  rosterForTitle,
  boardsForTitle,
  bonusStarsForTitle,
  MP_CUSTOM_BOARD,
} from "@gamenight/shared";
import "./marioparty.css";

type Assignment = "self" | "random" | "host";

interface Slot {
  id: string;
  kind: "member" | "guest";
  userId: string | null;
  name: string;
  character: string | null;
}
interface GameLine {
  playerId: string;
  character: string | null;
  stars: number;
  bonusStars: string[];
  placement: number;
  isWinner: boolean;
}
interface Session {
  status: "setup" | "live" | "completed";
  groupId: string;
  titleId: string | null;
  assignment: Assignment;
  openScoring: boolean;
  roster: Slot[];
  games: { idx: number; map: string; lines: GameLine[]; at: string }[];
  summary: {
    players: { playerId: string; name: string; games: number; wins: number; totalStars: number; mainCharacter: string | null }[];
    boards: { map: string; games: number }[];
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

function CharacterSelect({
  value,
  onChange,
  roster,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  roster: readonly string[];
}) {
  return (
    <select className="mp-select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Pick a character</option>
      {roster.map((r) => (
        <option key={r} value={r}>{r}</option>
      ))}
    </select>
  );
}

export default function MarioPartyPage() {
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
      api<Ctx>(`/api/marioparty-context/${eventId}`).catch(() => null),
      api<{ session: Session | null }>(`/api/marioparty/${eventId}`).catch(() => ({ session: null })),
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
      if ((m.type === "mario_party_updated" || m.type === "leaderboard_updated") && m.eventId === eventId) refetch();
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

  if (!eventId) {
    return <div className="mp-root"><div className="mp-wrap"><p className="mp-hint">No event specified.</p><BackButton /></div></div>;
  }
  if (loading) {
    return <div className="mp-root"><div className="mp-wrap"><p className="mp-hint">Loading...</p></div></div>;
  }

  return (
    <div className="mp-root">
      <div className="mp-wrap">
        <div className="mp-top">
          <BackButton className="mp-textbtn" />
          <Link to={`/marioparty/tv/${eventId}`} className="mp-textbtn">📺 TV</Link>
        </div>
        <div>
          <div className="mp-brand">Mario <em>Party</em></div>
          <div className="mp-sub">Board nights, stars, and bragging rights</div>
        </div>

        {err && <p className="mp-err">{err}</p>}

        {!session || session.status === "completed" ? (
          <SetupOrWaiting
            ctx={ctx}
            completed={session?.status === "completed"}
            busy={busy}
            onStart={(payload) => call(`/api/events/${eventId}/marioparty`, payload)}
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
  const [titleId, setTitleId] = useState<string>(MARIO_PARTY_TITLES[0]!.id);
  const [assignment, setAssignment] = useState<Assignment>("self");
  const [roster, setRoster] = useState<{ userId: string | null; name: string }[]>([]);
  const [guest, setGuest] = useState("");

  useEffect(() => {
    if (ctx && roster.length === 0) {
      setRoster(ctx.prefill.slice(0, 4).map((p) => ({ userId: p.userId, name: p.name })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  if (!ctx) return <p className="mp-hint" style={{ marginTop: 16 }}>Loading...</p>;

  if (!ctx.canHost) {
    return (
      <div className="mp-card" style={{ marginTop: 16 }}>
        <div className="mp-h">Waiting for the host</div>
        <p className="mp-hint">The crew owner or an admin starts the night. This screen updates live the moment they do.</p>
      </div>
    );
  }

  const full = roster.length >= 4;
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
        <div className="mp-card" style={{ marginTop: 16 }}>
          <p className="mp-hint">That party wrapped. Starting again begins a fresh session for this event.</p>
        </div>
      )}
      <div className="mp-card" style={{ marginTop: 16 }}>
        <div className="mp-h">Which game?</div>
        <select className="mp-select" value={titleId} onChange={(e) => setTitleId(e.target.value)}>
          {MARIO_PARTY_TITLES.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <p className="mp-hint" style={{ marginTop: 8 }}>
          Scopes the character list, the boards, and the bonus stars to this game. Stats stay combined across games.
        </p>
      </div>

      <div className="mp-card">
        <div className="mp-h">Characters</div>
        <div className="mp-seg">
          <button className={assignment === "self" ? "on" : ""} onClick={() => setAssignment("self")}>Players pick</button>
          <button className={assignment === "random" ? "on" : ""} onClick={() => setAssignment("random")}>Random</button>
          <button className={assignment === "host" ? "on" : ""} onClick={() => setAssignment("host")}>Host picks</button>
        </div>
      </div>

      <div className="mp-card">
        <div className="mp-h">Players ({roster.length}/4)</div>
        {roster.map((r, i) => (
          <div className="mp-row" key={`${r.userId ?? "g"}-${i}`}>
            <span className="mp-name" style={{ flex: 1 }}>{r.name}</span>
            {!r.userId && <span className="mp-pill">guest</span>}
            <button className="mp-textbtn" onClick={() => removeAt(i)}>remove</button>
          </div>
        ))}
        {roster.length === 0 && <p className="mp-hint">Add up to 4 players from the crew or type a guest.</p>}

        {notAdded.length > 0 && !full && (
          <>
            <div className="mp-lab" style={{ marginTop: 12 }}>Add from crew</div>
            <div className="mp-seg">
              {notAdded.map((m) => (
                <button key={m.userId} onClick={() => addMember(m)}>+ {m.name}</button>
              ))}
            </div>
          </>
        )}
        {!full && (
          <>
            <div className="mp-lab" style={{ marginTop: 12 }}>Add a guest</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <input className="mp-input" placeholder="Guest name" value={guest} onChange={(e) => setGuest(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addGuest()} />
              <button className="mp-btn mp-btn--ghost" style={{ width: "auto", padding: "0 16px" }} onClick={addGuest}>Add</button>
            </div>
          </>
        )}
        <p className="mp-hint" style={{ marginTop: 8 }}>Guests play, but lifetime stats only count crew members.</p>
      </div>

      <button
        className="mp-btn"
        style={{ marginTop: 12 }}
        disabled={busy || roster.length < 2}
        onClick={() => onStart({ titleId, assignment, roster })}
      >
        {roster.length < 2 ? "Add at least 2 players" : "Start the party"}
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
  const titleRoster = useMemo(() => rosterForTitle(MARIO_PARTY_TITLES, session.titleId), [session.titleId]);

  // Optimistic: the dropdown reflects the pick instantly.
  const setChar = (playerId: string, character: string | null) =>
    call(`/api/marioparty/${eventId}/character`, { playerId, character }, (s) => ({
      ...s,
      roster: s.roster.map((p) => (p.id === playerId ? { ...p, character } : p)),
    }));
  const mayEditChar = (slot: Slot) => canHost || (session.assignment === "self" && slot.userId === viewerId);

  return (
    <>
      <div className="mp-card" style={{ marginTop: 16 }}>
        <div className="mp-h">Characters</div>
        {session.roster.map((slot) => (
          <div className="mp-row" key={slot.id}>
            <div style={{ flex: 1 }}>
              <div className="mp-name">{slot.name}</div>
              <div className="mp-char">{slot.character ?? "no character yet"}</div>
            </div>
            {mayEditChar(slot) && (
              <div style={{ width: 170 }}>
                <CharacterSelect value={slot.character} onChange={(v) => setChar(slot.id, v)} roster={titleRoster} />
              </div>
            )}
          </div>
        ))}
        {canHost && (session.assignment === "random" || session.assignment === "host") && (
          <button className="mp-btn mp-btn--ghost" style={{ marginTop: 10 }} disabled={busy} onClick={() => call(`/api/marioparty/${eventId}/randomize`)}>
            🎲 Randomize all characters
          </button>
        )}
      </div>

      {canScore ? (
        <RecordBoard
          session={session}
          busy={busy}
          onRecord={(payload) => call(`/api/marioparty/${eventId}/record`, payload)}
        />
      ) : (
        <div className="mp-card"><p className="mp-hint">The host is recording results. Standings update live below.</p></div>
      )}

      {/* Standings */}
      <div className="mp-card">
        <div className="mp-h">Tonight ({session.games.length} board{session.games.length === 1 ? "" : "s"})</div>
        {session.summary.players.length === 0 ? (
          <p className="mp-hint">No boards recorded yet.</p>
        ) : (
          <>
            {session.summary.players.map((p, i) => (
              <div className="mp-row" key={p.playerId}>
                <span style={{ flex: 1 }} className="mp-name">
                  {i === 0 && <span className="mp-pill mp-pill--star">★ lead</span>} {p.name}
                </span>
                <span className="mp-char">{p.wins}W · {p.totalStars}★ · {p.mainCharacter ?? "-"}</span>
              </div>
            ))}
            {session.summary.boards.length > 0 && (
              <p className="mp-hint" style={{ marginTop: 10 }}>
                Boards: {session.summary.boards.map((b) => `${b.map} (${b.games})`).join(", ")}
              </p>
            )}
          </>
        )}
      </div>

      {canHost && (
        <div className="mp-card">
          <div className="mp-h">Host controls</div>
          <div className="mp-row">
            <span style={{ flex: 1 }}>Let members record results</span>
            <button
              className={`gn-toggle ${session.openScoring ? "gn-toggle--on" : "gn-toggle--off"}`}
              aria-pressed={session.openScoring}
              onClick={() => call(`/api/marioparty/${eventId}/open-scoring`, { open: !session.openScoring })}
            >
              {session.openScoring ? "ON" : "OFF"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="mp-btn mp-btn--ghost" disabled={busy || session.games.length === 0} onClick={() => call(`/api/marioparty/${eventId}/undo`)}>↶ Undo last</button>
            <button className="mp-btn mp-btn--go" disabled={busy} onClick={() => call(`/api/marioparty/${eventId}/complete`)}>End party</button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Record a board ----------

function RecordBoard({
  session,
  busy,
  onRecord,
}: {
  session: Session;
  busy: boolean;
  onRecord: (payload: unknown) => void;
}) {
  const boards = useMemo(() => boardsForTitle(session.titleId), [session.titleId]);
  const bonusOptions = useMemo(() => bonusStarsForTitle(session.titleId), [session.titleId]);

  const [board, setBoard] = useState<string>(boards[0] ?? MP_CUSTOM_BOARD);
  const [customBoard, setCustomBoard] = useState("");
  const [inGame, setInGame] = useState<Record<string, boolean>>(
    Object.fromEntries(session.roster.map((p) => [p.id, true])),
  );
  const [stars, setStars] = useState<Record<string, string>>({});
  // Keyed by bonus star -> the one player who got it. A bonus star is
  // awarded to a single player per board, so owning it is exclusive by
  // construction; two people can't both hold the Coin Star.
  const [bonusOwner, setBonusOwner] = useState<Record<string, string>>({});
  const [winnerId, setWinnerId] = useState<string | null>(null);

  const active = session.roster.filter((p) => inGame[p.id]);
  const starNum = (id: string) => {
    const v = stars[id];
    return v === undefined || v === "" ? NaN : Math.max(0, Math.floor(Number(v)));
  };
  const allStarsSet = active.length >= 2 && active.every((p) => Number.isFinite(starNum(p.id)));
  const maxStars = allStarsSet ? Math.max(...active.map((p) => starNum(p.id))) : -1;
  const topPlayers = active.filter((p) => starNum(p.id) === maxStars);
  const needsTiebreak = allStarsSet && topPlayers.length > 1;
  const effectiveWinner = needsTiebreak
    ? (winnerId && topPlayers.some((p) => p.id === winnerId) ? winnerId : null)
    : (topPlayers[0]?.id ?? null);

  const mapValue = board === MP_CUSTOM_BOARD ? customBoard.trim() : board;
  const ready = !!mapValue && allStarsSet && !!effectiveWinner;

  // Tapping the current owner clears the award (nobody got it).
  const setBonus = (star: string, playerId: string) =>
    setBonusOwner((s) => {
      const next = { ...s };
      if (next[star] === playerId) delete next[star];
      else next[star] = playerId;
      return next;
    });

  const bonusFor = (pid: string) =>
    Object.entries(bonusOwner)
      .filter(([, owner]) => owner === pid)
      .map(([star]) => star);

  const record = () => {
    onRecord({
      map: mapValue,
      winnerId: effectiveWinner,
      lines: active.map((p) => ({ playerId: p.id, stars: starNum(p.id), bonusStars: bonusFor(p.id) })),
    });
    setStars({});
    setBonusOwner({});
    setWinnerId(null);
  };

  return (
    <div className="mp-card">
      <div className="mp-h">Record a board</div>

      <div className="mp-lab">Board</div>
      <select className="mp-select" style={{ marginTop: 6 }} value={board} onChange={(e) => setBoard(e.target.value)}>
        {boards.map((b) => <option key={b} value={b}>{b}</option>)}
        <option value={MP_CUSTOM_BOARD}>{MP_CUSTOM_BOARD}...</option>
      </select>
      {board === MP_CUSTOM_BOARD && (
        <input className="mp-input" style={{ marginTop: 6 }} placeholder="Board name" value={customBoard} onChange={(e) => setCustomBoard(e.target.value)} />
      )}

      <div className="mp-lab" style={{ marginTop: 14 }}>Final stars</div>
      {session.roster.map((p) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid #33244f" }}>
          <input
            type="checkbox"
            checked={!!inGame[p.id]}
            onChange={() => {
              const leaving = !!inGame[p.id];
              setInGame((s) => ({ ...s, [p.id]: !s[p.id] }));
              if (leaving) {
                setBonusOwner((s) => Object.fromEntries(Object.entries(s).filter(([, owner]) => owner !== p.id)));
              }
            }}
          />
          <div style={{ flex: 1 }}>
            <div className="mp-name">{p.name}</div>
            <div className="mp-char">{p.character ?? "no character"}</div>
          </div>
          {inGame[p.id] && (
            <input
              className="mp-input mp-stars"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="★"
              value={stars[p.id] ?? ""}
              onChange={(e) => setStars((s) => ({ ...s, [p.id]: e.target.value }))}
            />
          )}
        </div>
      ))}

      {bonusOptions.length > 0 && active.length > 0 && (
        <>
          <div className="mp-lab" style={{ marginTop: 16 }}>Bonus stars (one player each, optional)</div>
          {bonusOptions.map((star) => (
            <div key={star} style={{ padding: "8px 0", borderTop: "1px solid #33244f" }}>
              <div className="mp-char" style={{ marginBottom: 4 }}>{star}</div>
              <div className="mp-bonus">
                {active.map((p) => (
                  <button
                    key={p.id}
                    className={bonusOwner[star] === p.id ? "on" : ""}
                    onClick={() => setBonus(star, p.id)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {needsTiebreak && (
        <div style={{ marginTop: 12 }}>
          <div className="mp-lab">Tied on stars. Tap who won (coins break the tie)</div>
          <div className="mp-seg">
            {topPlayers.map((p) => (
              <button key={p.id} className={effectiveWinner === p.id ? "on" : ""} onClick={() => setWinnerId(p.id)}>{p.name}</button>
            ))}
          </div>
        </div>
      )}

      <button className="mp-btn" style={{ marginTop: 14 }} disabled={busy || !ready} onClick={record}>
        {active.length < 2 ? "Pick at least 2 players" : !mapValue ? "Pick a board" : !allStarsSet ? "Enter everyone's stars" : needsTiebreak && !effectiveWinner ? "Tap the winner" : "Record board"}
      </button>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import BackButton from "../BackButton";
import { usePackSession, type PackCtx as Ctx } from "../usePackSession";
import RosterCarryOver from "../RosterCarryOver";
import GuestChips from "../GuestChips";
import {
  SESSION_PACKS,
  MARIO_PARTY_TITLES,
  rosterForTitle,
  boardsForTitle,
  bonusStarsForTitle,
  MP_CUSTOM_BOARD,
  currentSides,
  hasTeamStructure,
  sideLabel,
  type Side,
  type SideLog,
} from "@gamenight/shared";
import { TeamPicker, teamPickerStatus, dropRosterIndex } from "../teams/TeamPicker";
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
  /** Absent on a board recorded before Tag Battle shipped. */
  side?: string | null;
}
interface Session {
  status: "setup" | "live" | "completed";
  groupId: string;
  titleId: string | null;
  assignment: Assignment;
  openScoring: boolean;
  roster: Slot[];
  games: { idx: number; map: string; lines: GameLine[]; at: string }[];
  /** Backfilled server-side by normalizeMpState, so it is always present. */
  sideLog: SideLog;
  summary: {
    players: {
      playerId: string;
      name: string;
      games: number;
      wins: number;
      /** SOLO stars only. A tag board's total belongs to the side. */
      totalStars: number;
      tagStars: number;
      tagGames: number;
      mainCharacter: string | null;
    }[];
    boards: { map: string; games: number }[];
  };
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
  const { ctx, session, loading, busy, err, call, startSession } =
    usePackSession<Session>({
      pack: "marioparty",
      wsType: SESSION_PACKS.marioparty.wsType,
      eventId,
      replacePrompt:
        "A session is already in progress on this event. Replace it? Any board recorded in the current session stays in your stats, but the session itself is ended.",
    });

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
          {/* A way back to the NIGHT this pack belongs to, which the
              history-based Back button cannot promise: somebody who opened a
              shared link in a fresh tab has no history to pop, so Back sends
              them home rather than to the event they were sent to. Standing
              rule: every pack screen has both. */}
          <Link to={`/e/${eventId}`} className="mp-textbtn">🎪 Event</Link>
          {/* The NIGHT's TV address, not this pack's (see SmashPage). */}
          <Link to={`/e/${eventId}/tv`} className="mp-textbtn">📺 TV</Link>
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
  const [titleId, setTitleId] = useState<string>(MARIO_PARTY_TITLES[0]!.id);
  const [assignment, setAssignment] = useState<Assignment>("self");
  const [roster, setRoster] = useState<{ userId: string | null; name: string }[]>([]);
  const [guest, setGuest] = useState("");
  const [tag, setTag] = useState(false);
  // TeamPicker works in ROSTER INDICES, not ids: the server mints slot ids when
  // the session starts, so at setup time this screen has never seen one. The
  // start route reads the same indices back.
  const [assign, setAssign] = useState<number[][]>([[], []]);

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
  const addGuestNamed = (raw: string) => {
    const n = raw.trim().slice(0, 24);
    if (n && !full) setRoster([...roster, { userId: null, name: n }]);
  };
  const addGuest = () => {
    addGuestNamed(guest);
    setGuest("");
  };
  // Removing a player shifts every index above them, so the assignment has to
  // be renumbered with it. dropRosterIndex exists precisely because a version
  // of this that forgets looks completely correct and pairs the wrong people.
  const removeAt = (i: number) => {
    setRoster(roster.filter((_, j) => j !== i));
    setAssign((a) => dropRosterIndex(a, i));
  };
  const notAdded = ctx.members.filter((m) => !roster.some((r) => r.userId === m.userId));

  const teamStatus = teamPickerStatus(assign, roster.length, 2);
  const blocked = tag && !teamStatus.ready;

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
        {/* SLICED TO FOUR, exactly as the prefill effect above slices: a
            board holds four and the cap stays this page's business. */}
        <RosterCarryOver
          source={ctx.prefillSource}
          label={ctx.prefillLabel}
          rsvpSlots={ctx.rsvpPrefill.slice(0, 4)}
          current={roster}
          onUseRsvp={(slots) =>
            setRoster(slots.slice(0, 4).map((p) => ({ userId: p.userId, name: p.name })))
          }
        />
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
        {!full && <GuestChips names={ctx.recentGuests} current={roster} onAdd={addGuestNamed} />}
        <p className="mp-hint" style={{ marginTop: 8 }}>Guests play, but lifetime stats only count crew members.</p>
      </div>

      <div className="mp-card">
        <div className="mp-h">Format</div>
        <div className="mp-seg">
          <button className={!tag ? "on" : ""} onClick={() => setTag(false)}>Battle Royale</button>
          <button className={tag ? "on" : ""} onClick={() => setTag(true)}>Tag Battle</button>
        </div>
        {tag ? (
          <>
            <p className="mp-hint" style={{ marginTop: 8 }}>
              Teams share Orbs, Stars and coins, so a board has one star total per side.
              Everyone still picks their own character.
            </p>
            <TeamPicker cx="mp" roster={roster} assign={assign} setAssign={setAssign} maxSides={2} />
            {teamStatus.unplaced.length > 0 && (
              <p className="mp-hint" style={{ marginTop: 8 }}>
                Everyone has to be on a side before the party starts.
              </p>
            )}
          </>
        ) : (
          <p className="mp-hint" style={{ marginTop: 8 }}>
            Everyone for themselves: one star total each, most stars wins the board.
          </p>
        )}
      </div>

      <button
        className="mp-btn"
        style={{ marginTop: 12 }}
        disabled={busy || roster.length < 2 || blocked}
        onClick={() => onStart({ titleId, assignment, roster, ...(tag ? { sides: assign } : {}) })}
      >
        {roster.length < 2
          ? "Add at least 2 players"
          : blocked
            ? teamStatus.check.error ?? "Put everyone on a side"
            : tag ? "Start the tag battle" : "Start the party"}
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
  // TEAM STRUCTURE IS READ OFF THE LOG, not off a flag on the session, so the
  // arrangement a reshuffle put in force is the one the screen records under.
  const sides = useMemo(() => currentSides(session.sideLog ?? []), [session.sideLog]);
  const teamPlay = hasTeamStructure(session.sideLog ?? []);
  const nameOf = (id: string) => session.roster.find((p) => p.id === id)?.name;

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
        // TWO RECORD SCREENS, NOT ONE WITH A FLAG THREADED THROUGH EVERY ROW.
        // The entry shapes are different enough (a star box per SIDE against a
        // star box per PLAYER, bonus stars owned by a side against by a player,
        // a tiebreak that taps a side against one that taps a person) that a
        // shared component would drift into a lowest common denominator. Same
        // argument pack-runtime.ts makes for why routes stay per pack.
        teamPlay ? (
          <RecordTagBoard
            session={session}
            sides={sides}
            busy={busy}
            onRecord={(payload) => call(`/api/marioparty/${eventId}/record`, payload)}
          />
        ) : (
          <RecordBoard
            session={session}
            busy={busy}
            onRecord={(payload) => call(`/api/marioparty/${eventId}/record`, payload)}
          />
        )
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
                <span className="mp-char">
                  {p.wins}W · {p.totalStars}★
                  {/* A tag board's stars are the SIDE's, so they are shown
                      apart rather than added in. Adding them would credit a
                      pair twice for one total. */}
                  {p.tagGames > 0 && <> · {p.tagStars}★ tag</>} · {p.mainCharacter ?? "-"}
                </span>
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
          {teamPlay && (
            <>
              <div className="mp-lab" style={{ marginTop: 12 }}>
                Sides ({sides.map((sd) => sideLabel(sd, nameOf)).join(" v ")})
              </div>
              <Reshuffle
                session={session}
                sides={sides}
                busy={busy}
                onReshuffle={(payload) => call(`/api/marioparty/${eventId}/reshuffle`, payload)}
              />
            </>
          )}
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

// ---------- Record a TAG board ----------
//
// The per-side entry shape. Deliberately NOT the screen above with a flag: in
// Tag Battle a team shares its Orbs, Stars and coins, so there is one star box
// and one set of bonus stars per SIDE, and the tiebreak taps a side. What is
// still per player is the character, which each player picks for themselves,
// and that lives on the Characters card above rather than here.

function RecordTagBoard({
  session,
  sides,
  busy,
  onRecord,
}: {
  session: Session;
  sides: readonly Side[];
  busy: boolean;
  onRecord: (payload: unknown) => void;
}) {
  const boards = useMemo(() => boardsForTitle(session.titleId), [session.titleId]);
  const bonusOptions = useMemo(() => bonusStarsForTitle(session.titleId), [session.titleId]);
  const nameOf = (id: string) => session.roster.find((p) => p.id === id)?.name;

  const [board, setBoard] = useState<string>(boards[0] ?? MP_CUSTOM_BOARD);
  const [customBoard, setCustomBoard] = useState("");
  const [stars, setStars] = useState<Record<string, string>>({});
  // Keyed by bonus star -> the one SIDE that got it. Exclusive by construction,
  // the same way the per-player screen is: two sides cannot both hold the
  // Minigame Star, and the engine refuses it if they somehow do.
  const [bonusOwner, setBonusOwner] = useState<Record<string, string>>({});
  const [winnerSideId, setWinnerSideId] = useState<string | null>(null);

  const starNum = (id: string) => {
    const v = stars[id];
    return v === undefined || v === "" ? NaN : Math.max(0, Math.floor(Number(v)));
  };
  const allStarsSet = sides.length >= 2 && sides.every((sd) => Number.isFinite(starNum(sd.id)));
  const maxStars = allStarsSet ? Math.max(...sides.map((sd) => starNum(sd.id))) : -1;
  const topSides = sides.filter((sd) => starNum(sd.id) === maxStars);
  const needsTiebreak = allStarsSet && topSides.length > 1;
  const effectiveWinner = needsTiebreak
    ? (winnerSideId && topSides.some((sd) => sd.id === winnerSideId) ? winnerSideId : null)
    : (topSides[0]?.id ?? null);

  const mapValue = board === MP_CUSTOM_BOARD ? customBoard.trim() : board;
  const ready = !!mapValue && allStarsSet && !!effectiveWinner;

  const setBonus = (star: string, sideId: string) =>
    setBonusOwner((s) => {
      const next = { ...s };
      if (next[star] === sideId) delete next[star];
      else next[star] = sideId;
      return next;
    });
  const bonusFor = (sideId: string) =>
    Object.entries(bonusOwner)
      .filter(([, owner]) => owner === sideId)
      .map(([star]) => star);

  const record = () => {
    onRecord({
      map: mapValue,
      winnerSideId: effectiveWinner,
      lines: sides.map((sd) => ({ sideId: sd.id, stars: starNum(sd.id), bonusStars: bonusFor(sd.id) })),
    });
    setStars({});
    setBonusOwner({});
    setWinnerSideId(null);
  };

  return (
    <div className="mp-card">
      <div className="mp-h">Record a board (Tag Battle)</div>

      <div className="mp-lab">Board</div>
      <select className="mp-select" style={{ marginTop: 6 }} value={board} onChange={(e) => setBoard(e.target.value)}>
        {boards.map((b) => <option key={b} value={b}>{b}</option>)}
        <option value={MP_CUSTOM_BOARD}>{MP_CUSTOM_BOARD}...</option>
      </select>
      {board === MP_CUSTOM_BOARD && (
        <input className="mp-input" style={{ marginTop: 6 }} placeholder="Board name" value={customBoard} onChange={(e) => setCustomBoard(e.target.value)} />
      )}

      <div className="mp-lab" style={{ marginTop: 14 }}>Final stars, per side</div>
      {sides.map((sd) => (
        <div key={sd.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid #33244f" }}>
          <div style={{ flex: 1 }}>
            <div className="mp-name">{sideLabel(sd, nameOf)}</div>
            <div className="mp-char">{sd.name}</div>
          </div>
          <input
            className="mp-input mp-stars"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="★"
            value={stars[sd.id] ?? ""}
            onChange={(e) => setStars((s) => ({ ...s, [sd.id]: e.target.value }))}
          />
        </div>
      ))}
      <p className="mp-hint" style={{ marginTop: 8 }}>
        One total for the side, not one each: teams share Orbs, Stars and coins.
      </p>

      {bonusOptions.length > 0 && (
        <>
          <div className="mp-lab" style={{ marginTop: 16 }}>Bonus stars (one side each, optional)</div>
          {bonusOptions.map((star) => (
            <div key={star} style={{ padding: "8px 0", borderTop: "1px solid #33244f" }}>
              <div className="mp-char" style={{ marginBottom: 4 }}>{star}</div>
              <div className="mp-bonus">
                {sides.map((sd) => (
                  <button
                    key={sd.id}
                    className={bonusOwner[star] === sd.id ? "on" : ""}
                    onClick={() => setBonus(star, sd.id)}
                  >
                    {sideLabel(sd, nameOf)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {needsTiebreak && (
        <div style={{ marginTop: 12 }}>
          <div className="mp-lab">Tied on stars. Tap which side won (coins break the tie)</div>
          <div className="mp-seg">
            {topSides.map((sd) => (
              <button key={sd.id} className={effectiveWinner === sd.id ? "on" : ""} onClick={() => setWinnerSideId(sd.id)}>
                {sideLabel(sd, nameOf)}
              </button>
            ))}
          </div>
        </div>
      )}

      <button className="mp-btn" style={{ marginTop: 14 }} disabled={busy || !ready} onClick={record}>
        {!mapValue ? "Pick a board" : !allStarsSet ? "Enter both sides' stars" : needsTiebreak && !effectiveWinner ? "Tap the winning side" : "Record board"}
      </button>
    </div>
  );
}

// ---------- Reshuffle the sides ----------
//
// Host only, and it takes effect FROM THE NEXT BOARD. Boards already recorded
// keep the pairs they were played under, which is why the arrangement is a log
// rather than a field, and why undoing back past a reshuffle puts the old pairs
// back rather than rewriting history.

function Reshuffle({
  session,
  sides,
  busy,
  onReshuffle,
}: {
  session: Session;
  sides: readonly Side[];
  busy: boolean;
  onReshuffle: (payload: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  // Indices into the roster, the same currency TeamPicker works in. Seeded from
  // the arrangement in force so opening the panel shows the current pairs.
  const idx = (id: string) => session.roster.findIndex((p) => p.id === id);
  const [assign, setAssign] = useState<number[][]>(() =>
    sides.map((sd) => sd.memberIds.map(idx).filter((n) => n >= 0)),
  );
  const status = teamPickerStatus(assign, session.roster.length, 2);

  if (!open) {
    return (
      <button
        className="mp-btn mp-btn--ghost"
        style={{ marginTop: 10 }}
        disabled={busy}
        onClick={() => {
          setAssign(sides.map((sd) => sd.memberIds.map(idx).filter((n) => n >= 0)));
          setOpen(true);
        }}
      >
        🔀 Reshuffle sides
      </button>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <TeamPicker cx="mp" roster={session.roster} assign={assign} setAssign={setAssign} maxSides={2} />
      <p className="mp-hint" style={{ marginTop: 8 }}>
        Takes effect from the next board. Boards already recorded keep the sides they were played under.
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="mp-btn mp-btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button
          className="mp-btn"
          disabled={busy || !status.ready}
          onClick={() => {
            onReshuffle({
              sides: assign.map((members) => ({
                memberIds: members.map((n) => session.roster[n]?.id).filter(Boolean),
              })),
            });
            setOpen(false);
          }}
        >
          {status.ready ? "Use these sides" : status.check.error ?? "Put everyone on a side"}
        </button>
      </div>
    </div>
  );
}

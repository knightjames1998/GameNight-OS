import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import BackButton from "../BackButton";
import { formatLabel } from "../formats";
import { usePackSession, type PackCtx as Ctx } from "../usePackSession";
import {
  SESSION_PACKS,
  recordGame,
  gameWins,
  sideLabel,
  validateSides,
  type PpSessionState,
  type PpMatch,
  type Side,
} from "@gamenight/shared";
import { TeamPicker, dropRosterIndex, teamPickerStatus } from "../teams/TeamPicker";
import RosterCarryOver from "../RosterCarryOver";
import GuestChips from "../GuestChips";
import "./pingpong.css";

type Mode = "koth" | "ffa";
type BestOf = 1 | 3 | 5 | 7;
type Format = "free" | "bestof" | "koth";

interface Slot { id: string; kind: "member" | "guest"; userId: string | null; name: string }
interface Game { winnerSideId: string; loserPoints: number | null }
// A match holds SNAPSHOTS of the two sides that played it, so a completed match
// still knows who was on it after the host reshuffles.
interface Match { idx: number; a: Side; b: Side; games: Game[]; winnerSideId: string | null; at: string | null }
interface Koth {
  kingSideId: string | null;
  queue: string[];
  reign: number;
  bestReign: { sideId: string; memberIds: string[]; reign: number } | null;
}
interface PlayerStat {
  playerId: string; name: string; matches: number; wins: number; winRate: number;
  gameWins: number; gamesPlayed: number;
  currentStreak: number; bestStreak: number; longestReign: number;
}
interface Session {
  status: "setup" | "live" | "completed";
  groupId: string;
  format: Format;
  mode: Mode;
  bestOf: BestOf;
  openScoring: boolean;
  roster: Slot[];
  matches: Match[];
  current: Match | null;
  koth: Koth | null;
  needed: number;
  /** The arrangement of sides in force. Singles is one side per player. */
  sides: Side[];
  doubles: boolean;
  summary: { players: PlayerStat[]; bestReign: { sideId: string; memberIds: string[]; reign: number } | null };
}
export default function PingPongPage() {
  const eventId = new URLSearchParams(window.location.search).get("event") ?? "";
  const { ctx, session, loading, busy, err, call, startSession } =
    usePackSession<Session>({
      pack: "pingpong",
      wsType: SESSION_PACKS.pingpong.wsType,
      eventId,
      replacePrompt:
        "A session is already in progress on this event. Replace it? Any unfinished match in the current session is lost.",
    });

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
          {/* A way back to the NIGHT this pack belongs to, which the
              history-based Back button cannot promise: somebody who opened a
              shared link in a fresh tab has no history to pop, so Back sends
              them home rather than to the event they were sent to. Standing
              rule: every pack screen has both. */}
          <Link to={`/e/${eventId}`} className="pp-textbtn">🎪 Event</Link>
          {/* The NIGHT's TV address, not this pack's (see SmashPage). */}
          <Link to={`/e/${eventId}/tv`} className="pp-textbtn">📺 TV</Link>
        </div>
        <div>
          <div className="pp-brand">Ping <em>Pong</em></div>
          <div className="pp-sub">Singles and doubles, one tap a game</div>
        </div>

        {err && <p className="pp-err">{err}</p>}

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
  const q = new URLSearchParams(window.location.search).get("format");
  const initialFormat: Format = q === "free" || q === "bestof" || q === "koth" ? q : "koth";
  const [format, setFormat] = useState<Format>(initialFormat);
  // Series/match length for Best Of (3/5/7) and KOTH (1/3/5/7). Free Play is
  // always single games, so length is ignored there.
  const [length, setLength] = useState<BestOf>(3);
  const [roster, setRoster] = useState<{ userId: string | null; name: string }[]>([]);
  const [guest, setGuest] = useState("");
  // Singles is one side per player and is what every night was before sides
  // existed, so it stays the default and costs the host nothing.
  const [teams, setTeams] = useState(false);
  // Side membership by ROSTER INDEX, because slot ids are minted by the server
  // and this screen has never seen them.
  const [assign, setAssign] = useState<number[][]>([[], []]);

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
  const addGuestNamed = (raw: string) => {
    const n = raw.trim().slice(0, 24);
    if (n) setRoster([...roster, { userId: null, name: n }]);
  };
  const addGuest = () => {
    addGuestNamed(guest);
    setGuest("");
  };
  const removeAt = (i: number) => {
    setRoster(roster.filter((_, j) => j !== i));
    // Indices shift when somebody is removed, so the assignment has to shift
    // with them or it silently points at the wrong people.
    setAssign((a) => dropRosterIndex(a, i));
  };
  const notAdded = ctx.members.filter((m) => !roster.some((r) => r.userId === m.userId));

  // The picker owns the sides, and the primitive owns what is valid, so this
  // screen cannot drift from the answer the server will give it.
  const { unplaced, check } = teamPickerStatus(assign, roster.length);
  const teamsReady = !teams || (check.error === null && unplaced.length === 0);

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
          <button className={format === "free" ? "on" : ""} onClick={() => setFormat("free")}>Free Play</button>
          <button className={format === "bestof" ? "on" : ""} onClick={() => { setFormat("bestof"); if (length === 1) setLength(3); }}>Best Of</button>
          <button className={format === "koth" ? "on" : ""} onClick={() => setFormat("koth")}>King of the Hill</button>
        </div>
        <p className="pp-hint" style={{ marginTop: 8 }}>
          {format === "free"
            ? "Singles, one game per result. One tap logs a game; the same two stay on until you change players."
            : format === "bestof"
            ? "Singles head-to-head. A match is a best-of series; it records once, when the series is won."
            : "Winner stays on, loser rotates to the back of the line. First up is first in the list."}
        </p>

        {format === "bestof" && (
          <>
            <div className="pp-h" style={{ marginTop: 14 }}>Series length</div>
            <div className="pp-seg">
              {[3, 5, 7].map((n) => (
                <button key={n} className={length === n ? "on" : ""} onClick={() => setLength(n as BestOf)}>Best of {n}</button>
              ))}
            </div>
            <p className="pp-hint" style={{ marginTop: 8 }}>First to {Math.floor(length / 2) + 1} games wins the match.</p>
          </>
        )}

      </div>

      <div className="pp-card">
        <div className="pp-h">Players ({roster.length})</div>
        {/* A CARRY-OVER REPLACES THE ROSTER WHOLESALE, SO THE SIDES GO WITH
            IT. `assign` holds ROSTER INDICES (see dropRosterIndex), so keeping
            an arrangement across a swap would leave doubles pairs pointing at
            whoever now sits at those indices: a screen that looks completely
            correct and puts the wrong two people on a side. Reset, not
            shifted, because every index is meaningless after a replacement. */}
        <RosterCarryOver
          source={ctx.prefillSource}
          label={ctx.prefillLabel}
          rsvpSlots={ctx.rsvpPrefill}
          current={roster}
          onUseRsvp={(slots) => {
            setRoster(slots.map((p) => ({ userId: p.userId, name: p.name })));
            setAssign([[], []]);
          }}
        />
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
        <GuestChips names={ctx.recentGuests} current={roster} onAdd={addGuestNamed} />
        <p className="pp-hint" style={{ marginTop: 8 }}>Guests play, but lifetime stats only count crew members.</p>
      </div>

      <div className="pp-card">
        <div className="pp-row">
          <span style={{ flex: 1 }} className="pp-name">Doubles</span>
          <button
            className={`gn-toggle ${teams ? "gn-toggle--on" : "gn-toggle--off"}`}
            aria-pressed={teams}
            onClick={() => setTeams(!teams)}
          >
            {teams ? "ON" : "OFF"}
          </button>
        </div>
        <p className="pp-hint">
          {teams
            ? "Put everybody on a side. Sides hold the table together and rotate together."
            : "Off means singles: everybody plays for themselves, exactly as before."}
        </p>

        {teams && <TeamPicker cx="pp" roster={roster} assign={assign} setAssign={setAssign} />}
      </div>

      <button
        className="pp-btn"
        style={{ marginTop: 12 }}
        disabled={busy || roster.length < 2 || !teamsReady}
        onClick={() =>
          onStart({ format, bestOf: length, roster, ...(teams ? { sides: assign } : {}) })
        }
      >
        {roster.length < 2
          ? "Add at least 2 players"
          : teams && unplaced.length > 0
          ? `${unplaced.length} still to put on a side`
          : teams && check.error
          ? check.error
          : `Start ${formatLabel(format)}`}
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
  /** A side's label: its members' names, which is what a room calls a pair. */
  const label = (side: Side | undefined) =>
    side ? sideLabel(side, (id) => nameOf.get(id)) : "";
  const labelById = (sideId: string | null | undefined) =>
    label(session.sides.find((x) => x.id === sideId));

  function tapWinner(winnerSideId: string) {
    const lp = pointsDraft.trim() === "" ? null : Number(pointsDraft);
    setPointsDraft("");
    call(`/api/pingpong/${eventId}/record`, { winnerSideId, loserPoints: lp }, (s) => {
      // Optimistic: apply the same pure engine step to a clone so the tap
      // paints instantly; the server response reconciles.
      const clone: Session = structuredClone(s);
      recordGame(clone as unknown as PpSessionState, winnerSideId, lp);
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
                <button className="pp-fighter" disabled={busy} onClick={() => tapWinner(cur.a.id)}>
                  <div className="pp-fighter__n">{label(cur.a)}</div>
                  {session.mode === "koth" && session.koth?.kingSideId === cur.a.id && (
                    <div className="pp-pill pp-pill--king" style={{ marginTop: 6, display: "inline-block" }}>👑 holding</div>
                  )}
                </button>
                <div className="pp-vsbadge">VS</div>
                <button className="pp-fighter" disabled={busy} onClick={() => tapWinner(cur.b.id)}>
                  <div className="pp-fighter__n">{label(cur.b)}</div>
                  {session.mode === "koth" && session.koth?.kingSideId === cur.b.id && (
                    <div className="pp-pill pp-pill--king" style={{ marginTop: 6, display: "inline-block" }}>👑 holding</div>
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
                  {session.doubles ? "Change sides" : "Change players"}
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
                const won = g.winnerSideId === cur.a.id ? cur.a : cur.b;
                const lost = g.winnerSideId === cur.a.id ? cur.b : cur.a;
                return (
                  <div className="pp-row" key={i}>
                    <span style={{ flex: 1 }}>{label(won)} def {label(lost)}</span>
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
              <option value="">{session.doubles ? "Side 1" : "Player 1"}</option>
              {session.sides.map((sd) => <option key={sd.id} value={sd.id} disabled={sd.id === pickB}>{label(sd)}</option>)}
            </select>
            <select className="pp-select" value={pickB} onChange={(e) => setPickB(e.target.value)}>
              <option value="">{session.doubles ? "Side 2" : "Player 2"}</option>
              {session.sides.map((sd) => <option key={sd.id} value={sd.id} disabled={sd.id === pickA}>{label(sd)}</option>)}
            </select>
          </div>
          <button
            className="pp-btn"
            style={{ marginTop: 10 }}
            disabled={busy || !pickA || !pickB || pickA === pickB}
            onClick={() => { call(`/api/pingpong/${eventId}/start-match`, { aSideId: pickA, bSideId: pickB }); setPickA(""); setPickB(""); setShowPicker(false); }}
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
          <p className="pp-hint">{session.koth.queue.slice(1).map((id) => labelById(id)).join(" · ")}</p>
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
        {session.mode === "koth" && session.summary.bestReign && session.summary.bestReign.reign >= 2 && (
          <p className="pp-hint" style={{ marginTop: 10 }}>
            👑 Longest hold tonight: <strong>{session.summary.bestReign.memberIds.map((id) => nameOf.get(id)).join(" + ")}</strong>
            {" "}with {session.summary.bestReign.reign} in a row.
          </p>
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
          {session.doubles && (
            <Reshuffle eventId={eventId} session={session} busy={busy} call={call} nameOf={nameOf} />
          )}
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
          {!freePlay && cur && cur.games.length > 0 && wins.a !== wins.b && (
            <p className="pp-hint" style={{ marginTop: 8 }}>
              Ending now records this match for {label(wins.a > wins.b ? cur.a : cur.b)} ({Math.max(wins.a, wins.b)}&ndash;{Math.min(wins.a, wins.b)}).
            </p>
          )}
        </div>
      )}
    </>
  );
}

// ---------- Reshuffle the sides mid-night ----------
//
// Sides are FIXED for the night by default (James's call) and this is the
// explicit way out of that. It applies from the NEXT match on: every match
// already played keeps its own snapshot of who was on it, so the night's
// history stays true, and in KOTH the ladder restarts because a queue of sides
// that no longer exist is not a queue. The screen says both of those things
// out loud, because a control that silently resets a ladder is a control
// nobody will trust twice.

function Reshuffle({
  eventId,
  session,
  busy,
  call,
  nameOf,
}: {
  eventId: string;
  session: Session;
  busy: boolean;
  call: (path: string, body?: unknown) => Promise<void>;
  nameOf: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[][]>([]);

  const start = () => {
    setDraft(session.sides.map((sd) => [...sd.memberIds]));
    setOpen(true);
  };

  const placed = new Set(draft.flat());
  const loose = session.roster.map((p) => p.id).filter((id) => !placed.has(id));
  const asSides: Side[] = draft.map((memberIds, i) => ({
    id: String.fromCharCode(97 + i),
    name: `Side ${String.fromCharCode(65 + i)}`,
    memberIds,
  }));
  const check = validateSides(asSides);
  const ready = check.error === null && loose.length === 0;

  const putOn = (sideIdx: number, playerId: string) =>
    setDraft((d) => d.map((side, i) => (i === sideIdx ? [...side, playerId] : side.filter((x) => x !== playerId))));
  const takeOff = (playerId: string) => setDraft((d) => d.map((side) => side.filter((x) => x !== playerId)));

  if (!open) {
    return (
      <button className="pp-textbtn" style={{ marginTop: 8 }} onClick={start} disabled={busy}>
        🔀 Reshuffle sides
      </button>
    );
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--pp-line)" }}>
      <div className="pp-lab">New sides, from the next match on</div>
      {draft.map((members, i) => (
        <div key={i} style={{ marginTop: 8 }}>
          <div className="pp-lab">Side {String.fromCharCode(65 + i)}</div>
          <div className="pp-seg">
            {members.length === 0 && <span className="pp-hint">nobody yet</span>}
            {members.map((id) => (
              <button key={id} className="on" onClick={() => takeOff(id)}>{nameOf.get(id)} &times;</button>
            ))}
          </div>
        </div>
      ))}
      {loose.length > 0 && (
        <>
          <div className="pp-lab" style={{ marginTop: 10 }}>Not on a side</div>
          {loose.map((id) => (
            <div className="pp-row" key={id}>
              <span className="pp-name" style={{ flex: 1 }}>{nameOf.get(id)}</span>
              <div className="pp-seg" style={{ flex: "0 0 auto", marginTop: 0 }}>
                {draft.map((_, i) => (
                  <button key={i} onClick={() => putOn(i, id)}>{String.fromCharCode(65 + i)}</button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
      {!check.error && !check.even && loose.length === 0 && (
        <p className="pp-hint" style={{ marginTop: 8 }}>⚠️ Uneven sides ({check.sizes.join(" v ")}). Allowed.</p>
      )}
      <p className="pp-hint" style={{ marginTop: 8 }}>
        Matches already played keep the sides they were played with.
        {session.mode === "koth" ? " The queue restarts from the new sides." : ""}
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="pp-btn pp-btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button
          className="pp-btn"
          disabled={busy || !ready}
          onClick={() => {
            void call(`/api/pingpong/${eventId}/sides`, { sides: draft.map((memberIds) => ({ memberIds })) });
            setOpen(false);
          }}
        >
          {loose.length > 0 ? `${loose.length} still to place` : "Use these sides"}
        </button>
      </div>
    </div>
  );
}

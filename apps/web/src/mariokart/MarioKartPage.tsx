import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import BackButton from "../BackButton";
import { formatLabel } from "../formats";
import { usePackSession, type PackCtx as Ctx } from "../usePackSession";
import { TeamPicker, dropRosterIndex, teamPickerStatus } from "../teams/TeamPicker";
import RosterCarryOver from "../RosterCarryOver";
import GuestChips from "../GuestChips";
import {
  SESSION_PACKS,
  MARIO_KART_TITLES,
  autoKartAssign,
  rosterForTitle,
} from "@gamenight/shared";
import "./mariokart.css";

// Mario Kart race night. Four formats: Free Play (single races), Grand Prix
// (a cup of N races scored on cumulative points), Best Of (1v1 sets), and
// King of the Hill. Session-based like Smash (host's live session,
// materializes to lifetime stats, own TV mode). Beerio Kart is a separate pack
// and stays put.
//
// ===========================================================================
// EVERY RESULT ON THIS SCREEN IS ABOUT A KART, NOT A RACER.
//
// Double Dash puts two people in one kart, so from 2026-08-16 a race is a
// tapped order of KARTS, a set is between two KARTS and the throne is held by a
// KART. A solo night is karts of one, which is not a special case: a kart
// holding one racer is labelled with that racer's name, so the screen reads
// exactly as it did before any of this.
//
// The setup screen works in ROSTER INDICES rather than slot ids, because slot
// ids are minted by the server when the session starts and this screen has
// never seen them. TeamPicker works at the same level for the same reason, and
// dropRosterIndex exists because removing somebody shifts every index after
// them.
// ===========================================================================

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
interface Kart { id: string; name: string; memberIds: string[] }
interface GameLine { playerId: string; character: string | null; placement: number; isWinner: boolean; side: string | null }
interface SeriesT { idx: number; aId: string; bId: string; games: { winnerId: string }[]; winnerId: string | null; at: string | null }
interface SeriesStanding {
  slotId: string; name: string; seriesWins: number; seriesPlayed: number;
  gameWins: number; gamesPlayed: number; currentStreak: number; bestStreak: number;
}
interface CupStanding { playerId: string; name: string; points: number; wins: number; races: number }
interface Cup { standings: CupStanding[]; cupNo: number; racesDone: number; raceCount: number; complete: boolean }
interface Koth { kingSideId: string | null; queue: string[]; streak: number }
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
  /** The arrangement of karts in force. A solo night is one kart per racer. */
  sides: Kart[];
  /** True when a kart holds more than one racer. Every panel branches on it. */
  pairs: boolean;
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

/** One kart per racer, as roster indices: the arrangement a solo night is. */
const soloAssign = (n: number): number[][] => Array.from({ length: n }, (_, i) => [i]);

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
  const { ctx, session, loading, busy, err, call, startSession } =
    usePackSession<Session>({
      pack: "mariokart",
      wsType: SESSION_PACKS.mariokart.wsType,
      eventId,
      replacePrompt:
        "A session is already in progress on this event. Replace it? Any unfinished race or set is lost.",
    });

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
          {/* A way back to the NIGHT this pack belongs to, which the
              history-based Back button cannot promise: somebody who opened a
              shared link in a fresh tab has no history to pop, so Back sends
              them home rather than to the event they were sent to. Standing
              rule: every pack screen has both. */}
          <Link to={`/e/${eventId}`} className="mk-textbtn">🎪 Event</Link>
          {/* The NIGHT's TV address, not this pack's (see SmashPage). */}
          <Link to={`/e/${eventId}/tv`} className="mk-textbtn">📺 TV</Link>
        </div>
        <div>
          <div className="mk-brand">Mario Kart</div>
          <div className="mk-sub">Free Play · Grand Prix · Best Of · King of the Hill</div>
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
  // Shared karts are OFF by default, which is every Mario Kart night this pack
  // has ever recorded. Double Dash with exactly four players turns it on by
  // itself; see autoKartAssign for the three guards on that.
  const [karts, setKarts] = useState(false);
  // Kart membership by ROSTER INDEX; slot ids do not exist yet.
  const [assign, setAssign] = useState<number[][]>([[], []]);

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

  /**
   * The arrangement the auto-apply has to reason about.
   *
   * With the toggle OFF there is no picker on the screen, and the arrangement
   * in force is one kart per racer, which is a count of `roster.length`. That
   * is what makes "it fires only when the kart count differs" mean what it says.
   */
  const inForce = (size: number) => (karts ? assign : soloAssign(size));

  /** The host said which Mario Kart is on. Evaluates BOTH directions. */
  const pickTitle = (id: string) => {
    setTitleId(id);
    const next = autoKartAssign({ titleId: id, rosterSize: roster.length, assign: inForce(roster.length), trigger: "title" });
    if (!next) return;
    const shared = next.some((k) => k.length > 1);
    setKarts(shared);
    // Reverting empties the picker rather than leaving four karts of one on it,
    // so re-opening it starts from somewhere a host would actually build from.
    setAssign(shared ? next : [[], []]);
  };

  /**
   * The roster changed. This direction only ever puts karts TOGETHER: a host
   * who hand-built karts and then adds somebody must not watch them dissolve.
   */
  const setRosterAnd = (next: { userId: string | null; name: string }[], nextAssign: number[][]) => {
    setRoster(next);
    const auto = autoKartAssign({ titleId, rosterSize: next.length, assign: karts ? nextAssign : soloAssign(next.length), trigger: "roster" });
    if (auto) {
      setAssign(auto);
      setKarts(true);
    } else {
      setAssign(nextAssign);
    }
  };

  const addMember = (m: { userId: string; name: string }) => {
    if (roster.some((r) => r.userId === m.userId)) return;
    setRosterAnd([...roster, { userId: m.userId, name: m.name }], assign);
  };
  const addGuestNamed = (raw: string) => {
    const n = raw.trim().slice(0, 24);
    if (n) setRosterAnd([...roster, { userId: null, name: n }], assign);
  };
  const addGuest = () => {
    addGuestNamed(guest);
    setGuest("");
  };
  const removeAt = (i: number) => {
    // Indices shift when somebody is removed, so the assignment has to shift
    // with them or the karts silently hold the wrong people.
    setRosterAnd(roster.filter((_, j) => j !== i), dropRosterIndex(assign, i));
  };

  const notAdded = ctx.members.filter((m) => !roster.some((r) => r.userId === m.userId));

  // The picker owns the karts and the primitive owns what is valid, so this
  // screen cannot drift from the answer the server will give it.
  const { unplaced, check } = teamPickerStatus(assign, roster.length);
  const kartsReady = !karts || (check.error === null && unplaced.length === 0);
  const kothOddWarning =
    karts && format === "koth" && check.error === null && unplaced.length === 0 && assign.length < 3;

  return (
    <>
      {completed && (
        <div className="mk-card" style={{ marginTop: 16 }}>
          <p className="mk-hint">That race night wrapped. Starting again begins a fresh session for this event.</p>
        </div>
      )}
      <div className="mk-card" style={{ marginTop: 16 }}>
        <div className="mk-h">Which game?</div>
        <select className="mk-select" value={titleId} onChange={(e) => pickTitle(e.target.value)}>
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
            ? "Head to head sets. Pick two karts; a set records once, when it is won."
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
        {/* THE KARTS GO WITH THE ROSTER. `assign` holds ROSTER INDICES, so a
            wholesale swap has to reset them rather than shift them: every
            index means somebody else now. Through setRosterAnd, so Double
            Dash's auto-pairing at four gets its say on the new roster exactly
            as it would on a freshly built one. */}
        <RosterCarryOver
          source={ctx.prefillSource}
          label={ctx.prefillLabel}
          rsvpSlots={ctx.rsvpPrefill}
          current={roster}
          onUseRsvp={(slots) =>
            setRosterAnd(slots.map((p) => ({ userId: p.userId, name: p.name })), [[], []])
          }
        />
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
        <GuestChips names={ctx.recentGuests} current={roster} onAdd={addGuestNamed} />
        <p className="mk-hint" style={{ marginTop: 8 }}>Guests race, but lifetime stats only count crew members.</p>
      </div>

      <div className="mk-card">
        <div className="mk-row">
          <span style={{ flex: 1 }} className="mk-name">Shared karts</span>
          <button
            className={`gn-toggle ${karts ? "gn-toggle--on" : "gn-toggle--off"}`}
            aria-pressed={karts}
            onClick={() => setKarts(!karts)}
          >
            {karts ? "ON" : "OFF"}
          </button>
        </div>
        <p className="mk-hint">
          {karts
            ? "Put everybody in a kart. A kart finishes as one, and both racers get the result."
            : "Off means one racer per kart, exactly as before."}
        </p>
        {titleId === "mkdd" && roster.length === 4 && karts && (
          <p className="mk-hint" style={{ marginTop: 6 }}>
            🏎️ Double Dash with four players, so the karts are already paired up. Change them below if you like.
          </p>
        )}

        {karts && <TeamPicker cx="mk" roster={roster} assign={assign} setAssign={setAssign} />}
        {/* Uneven karts are INFORMATION, never a blocking error: TeamPicker
            already says so. The one thing worth adding is that a two-kart
            ladder is a king and a queue of one, which stops meaning anything. */}
        {kothOddWarning && (
          <p className="mk-hint" style={{ marginTop: 8 }}>
            Two karts in King of the Hill is one kart waiting its turn. Three or more makes a ladder.
          </p>
        )}
      </div>

      <button
        className="mk-btn"
        style={{ marginTop: 12 }}
        disabled={busy || roster.length < 2 || !kartsReady}
        onClick={() =>
          onStart({
            titleId,
            format,
            bestOf,
            raceCount,
            assignment,
            resultDetail: detail,
            roster,
            ...(karts ? { sides: assign } : {}),
          })
        }
      >
        {roster.length < 2
          ? "Add at least 2 players"
          : karts && unplaced.length > 0
          ? `${unplaced.length} still to put in a kart`
          : karts && check.error
          ? check.error
          : `Start ${formatLabel(format)}`}
      </button>
    </>
  );
}

// ---------- Live play ----------

/** Every racer's name, keyed by slot id. */
const namesOf = (session: Session) => new Map(session.roster.map((p) => [p.id, p.name]));
/** Every racer's chosen racer, keyed by slot id. */
const racersOf = (session: Session) => new Map(session.roster.map((p) => [p.id, p.character]));

/**
 * A kart's label: its racers' names.
 *
 * A kart of one is that racer's name, which is why every screen below reads the
 * same on a solo night as it did before karts existed.
 */
function kartLabel(session: Session, sideId: string | null | undefined): string {
  const kart = session.sides.find((s) => s.id === sideId);
  if (!kart) return "?";
  const names = namesOf(session);
  const out = kart.memberIds.map((id) => names.get(id)).filter((n): n is string => !!n);
  return out.length ? out.join(" + ") : kart.name;
}

/** A kart's racers, for the line under its name. */
function kartRacers(session: Session, sideId: string | null | undefined): string {
  const kart = session.sides.find((s) => s.id === sideId);
  if (!kart) return "no racer";
  const chars = racersOf(session);
  const out = kart.memberIds.map((id) => chars.get(id) ?? "no racer");
  return out.join(" + ");
}

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
              <div className="mk-char">
                {slot.character ?? "no racer yet"}
                {/* Which kart, folded onto the line that is already there
                    rather than given a column of its own. Silent on a solo
                    night, where every kart holds one racer. */}
                {session.pairs && <> · {kartLabel(session, session.sides.find((s) => s.memberIds.includes(slot.id))?.id)}</>}
              </div>
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
            onWin={(winnerSideId) => call(`/api/mariokart/${eventId}/record`, { winnerSideId })}
          />
        ) : session.format === "koth" ? (
          <KothPlay session={session} busy={busy} onWin={(winnerSideId) => call(`/api/mariokart/${eventId}/record`, { winnerSideId })} />
        ) : (
          <RacePlay session={session} busy={busy} onRecord={(sides) => call(`/api/mariokart/${eventId}/record`, { sides })} />
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
          {session.pairs && (
            <p className="mk-hint" style={{ marginTop: 8 }}>
              Points are per racer, so both seats in a kart score what the kart finished.
            </p>
          )}
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

      {canHost && <RearrangeKarts eventId={eventId} session={session} busy={busy} call={call} />}

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

// ---------- Rearrange the karts mid-night ----------
//
// Karts are fixed for the night by default and this is the explicit way to
// change them. Races already recorded keep the kart they were raced under, so
// the night's history stays true, and in King of the Hill the ladder restarts
// because a queue of karts that no longer exist is not a queue.

function RearrangeKarts({
  eventId,
  session,
  busy,
  call,
}: {
  eventId: string;
  session: Session;
  busy: boolean;
  call: (path: string, body?: unknown) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[][]>([]);

  const start = () => {
    setDraft(session.sides.map((s) => [...s.memberIds]));
    setOpen(true);
  };

  const names = namesOf(session);
  const placed = new Set(draft.flat());
  const loose = session.roster.filter((p) => !placed.has(p.id));
  const putOn = (kartIdx: number, playerId: string) =>
    setDraft(draft.map((k, i) => (i === kartIdx ? [...k, playerId] : k.filter((id) => id !== playerId))));
  const takeOff = (playerId: string) => setDraft(draft.map((k) => k.filter((id) => id !== playerId)));
  const sizes = draft.map((k) => k.length);
  const even = sizes.length > 0 && sizes.every((n) => n === sizes[0]);

  if (!open) {
    return (
      <div className="mk-card">
        <div className="mk-h">Karts</div>
        {session.sides.map((s) => (
          <div className="mk-row" key={s.id}>
            <span style={{ flex: 1 }} className="mk-name">{kartLabel(session, s.id)}</span>
            <span className="mk-char">{kartRacers(session, s.id)}</span>
          </div>
        ))}
        <button className="mk-btn mk-btn--ghost" style={{ marginTop: 10 }} disabled={busy} onClick={start}>
          🔀 Rearrange karts
        </button>
      </div>
    );
  }

  return (
    <div className="mk-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="mk-h" style={{ margin: 0 }}>Rearrange karts</div>
        <button className="mk-textbtn" onClick={() => setOpen(false)}>cancel</button>
      </div>
      <div className="mk-lab" style={{ marginTop: 10 }}>New karts, from the next race on</div>
      {draft.map((members, i) => (
        <div key={i} style={{ marginTop: 10 }}>
          <div className="mk-lab" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Kart {String.fromCharCode(65 + i)} ({members.length})</span>
            {draft.length > 2 && (
              <button className="mk-textbtn" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>remove</button>
            )}
          </div>
          <div className="mk-seg">
            {members.length === 0 && <span className="mk-hint">nobody yet</span>}
            {members.map((id) => (
              <button key={id} className="on" onClick={() => takeOff(id)}>{names.get(id)} &times;</button>
            ))}
          </div>
        </div>
      ))}

      {loose.length > 0 && (
        <>
          <div className="mk-lab" style={{ marginTop: 12 }}>Not in a kart yet</div>
          {loose.map((p) => (
            <div className="mk-row" key={p.id}>
              <span className="mk-name" style={{ flex: 1 }}>{p.name}</span>
              <div className="mk-seg" style={{ flex: "0 0 auto", marginTop: 0 }}>
                {draft.map((_, i) => (
                  <button key={i} onClick={() => putOn(i, p.id)}>{String.fromCharCode(65 + i)}</button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="mk-btn mk-btn--ghost" onClick={() => setDraft([...draft, []])} disabled={draft.length >= 8}>+ Kart</button>
      </div>

      {/* Uneven is allowed and warned, never blocked. */}
      {!even && loose.length === 0 && (
        <p className="mk-hint" style={{ marginTop: 8 }}>⚠️ Uneven karts ({sizes.join(" v ")}). That is allowed.</p>
      )}
      <p className="mk-hint" style={{ marginTop: 8 }}>
        Races already recorded keep the karts they were raced with.
        {session.format === "koth" ? " The ladder restarts from the new karts." : ""}
      </p>
      <button
        className="mk-btn"
        style={{ marginTop: 10 }}
        disabled={busy || loose.length > 0 || draft.length < 2 || sizes.some((n) => n === 0)}
        onClick={() => {
          void call(`/api/mariokart/${eventId}/sides`, { sides: draft.map((memberIds) => ({ memberIds })) });
          setOpen(false);
        }}
      >
        {loose.length > 0 ? `${loose.length} still to place` : "Use these karts"}
      </button>
    </div>
  );
}

// ---------- Race play (a tapped order of karts) ----------

function RacePlay({
  session,
  busy,
  onRecord,
}: {
  session: Session;
  busy: boolean;
  onRecord: (sideIds: string[]) => void;
}) {
  // Every kart races by default; untick the ones that sat out.
  const allChecked = () => Object.fromEntries(session.sides.map((s): [string, boolean] => [s.id, true]));
  const [inRace, setInRace] = useState<Record<string, boolean>>(allChecked);
  const [winner, setWinner] = useState<string | null>(null);
  const [places, setPlaces] = useState<Record<string, number>>({});

  const active = session.sides.filter((s) => inRace[s.id]);
  const everyoneIn = active.length === session.sides.length;
  const detail = session.resultDetail;
  const unit = session.pairs ? "kart" : "racer";

  const toggle = (id: string) => setInRace((s) => ({ ...s, [id]: !s[id] }));

  const record = () => {
    if (detail === "winner") {
      if (!winner) return;
      // The winner first, then everybody else in the order they are listed. The
      // placement rule collapses the rest to second, so their order among
      // themselves carries no meaning and is not asked for.
      onRecord([winner, ...active.filter((s) => s.id !== winner).map((s) => s.id)]);
    } else {
      onRecord([...active].sort((a, b) => (places[a.id] ?? 0) - (places[b.id] ?? 0)).map((s) => s.id));
    }
    setInRace(allChecked());
    setWinner(null);
    setPlaces({});
  };

  const ready =
    active.length >= 2 &&
    (detail === "winner"
      ? !!winner && !!inRace[winner]
      : active.every((s) => (places[s.id] ?? 0) >= 1 && (places[s.id] ?? 0) <= active.length) &&
        new Set(active.map((s) => places[s.id] ?? 0)).size === active.length);

  return (
    <div className="mk-card">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div className="mk-h">Record a race</div>
        <button className="mk-textbtn" onClick={() => setInRace(everyoneIn ? {} : allChecked())}>
          {everyoneIn ? "clear all" : "check all"}
        </button>
      </div>
      <p className="mk-hint" style={{ marginBottom: 8 }}>
        Every {unit} starts checked; untick who sat out, then {detail === "winner" ? `tap the winning ${unit}` : "set each placement"}.
      </p>
      {session.sides.map((s) => (
        <div className="mk-row" key={s.id}>
          <input type="checkbox" checked={!!inRace[s.id]} onChange={() => toggle(s.id)} />
          <div style={{ flex: 1 }}>
            <div className="mk-name">{kartLabel(session, s.id)}</div>
            <div className="mk-char">{kartRacers(session, s.id)}</div>
          </div>
          {inRace[s.id] && detail === "winner" && (
            <button className={winner === s.id ? "mk-fighter win" : "mk-textbtn"} style={{ padding: "6px 12px" }} onClick={() => setWinner(s.id)}>
              {winner === s.id ? "★ winner" : "win"}
            </button>
          )}
          {inRace[s.id] && detail === "placement" && (
            <select
              className="mk-select"
              style={{ width: 72 }}
              value={places[s.id] ?? ""}
              onChange={(e) => setPlaces((v) => ({ ...v, [s.id]: Number(e.target.value) }))}
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
        {active.length < 2 ? `Pick at least 2 ${unit}s` : "Record race"}
      </button>
      {session.pairs && (
        <p className="mk-hint" style={{ marginTop: 8 }}>Both racers in a kart get the kart's result.</p>
      )}
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
  onWin: (winnerSideId: string) => void;
}) {
  const koth = session.koth;
  const kingId = koth?.kingSideId ?? null;
  const challengerId = koth?.queue[0] ?? null;

  if (!kingId || !challengerId) {
    return <div className="mk-card"><p className="mk-hint">Need at least two karts queued to race.</p></div>;
  }
  return (
    <div className="mk-card">
      <div className="mk-h">Next race {koth && koth.streak > 0 ? `· on a ${koth.streak} streak` : ""}</div>
      <div className="mk-vs">
        <button className="mk-fighter" disabled={busy} onClick={() => onWin(kingId)}>
          <div className="mk-fighter__n">{kartLabel(session, kingId)}</div>
          <div className="mk-fighter__c">{kartRacers(session, kingId)} · 👑 king</div>
        </button>
        <div className="mk-vsbadge">VS</div>
        <button className="mk-fighter" disabled={busy} onClick={() => onWin(challengerId)}>
          <div className="mk-fighter__n">{kartLabel(session, challengerId)}</div>
          <div className="mk-fighter__c">{kartRacers(session, challengerId)} · challenger</div>
        </button>
      </div>
      <p className="mk-hint" style={{ marginTop: 10 }}>
        Tap the winner. The losing kart goes to the back of the line{session.pairs ? ", together" : ""}.
      </p>
      {koth && koth.queue.length > 1 ? (
        <p className="mk-hint">Up next: {koth.queue.slice(1).map((id) => kartLabel(session, id)).join(", ")}</p>
      ) : null}
    </div>
  );
}

// ---------- Best Of play (sets between two karts) ----------

function BestOfPlay({
  session,
  busy,
  onStartSet,
  onWin,
}: {
  session: Session;
  busy: boolean;
  onStartSet: (aId: string, bId: string) => void;
  onWin: (winnerSideId: string) => void;
}) {
  const [pickA, setPickA] = useState("");
  const [pickB, setPickB] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const cur = session.series;
  const need = Math.floor(session.bestOf / 2) + 1;
  const unit = session.pairs ? "kart" : "player";

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
            <option value="">{session.pairs ? "Kart 1" : "Player 1"}</option>
            {session.sides.map((s) => <option key={s.id} value={s.id} disabled={s.id === pickB}>{kartLabel(session, s.id)}</option>)}
          </select>
          <select className="mk-select" value={pickB} onChange={(e) => setPickB(e.target.value)}>
            <option value="">{session.pairs ? "Kart 2" : "Player 2"}</option>
            {session.sides.map((s) => <option key={s.id} value={s.id} disabled={s.id === pickA}>{kartLabel(session, s.id)}</option>)}
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
          <div className="mk-fighter__n">{kartLabel(session, cur.aId)}</div>
          <div className="mk-fighter__c">{kartRacers(session, cur.aId)}</div>
        </button>
        <div className="mk-vsbadge">VS</div>
        <button className="mk-fighter" disabled={busy} onClick={() => onWin(cur.bId)}>
          <div className="mk-fighter__n">{kartLabel(session, cur.bId)}</div>
          <div className="mk-fighter__c">{kartRacers(session, cur.bId)}</div>
        </button>
      </div>
      <p className="mk-hint" style={{ marginTop: 10 }}>Tap the winner of each race. The set records when someone reaches {need}.</p>
      {cur.games.length === 0 && (
        <button className="mk-textbtn" style={{ marginTop: 4 }} onClick={() => { setPickA(""); setPickB(""); setShowPicker(true); }}>
          Change {unit}s
        </button>
      )}
    </div>
  );
}

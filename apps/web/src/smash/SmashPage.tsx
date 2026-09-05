import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import BackButton from "../BackButton";
import { formatLabel } from "../formats";
import { usePackSession, type PackCtx as Ctx } from "../usePackSession";
import RosterCarryOver from "../RosterCarryOver";
import GuestChips from "../GuestChips";
import { TeamPicker, dropRosterIndex, teamPickerStatus } from "../teams/TeamPicker";
import {
  FFA_MAX_PLAYERS,
  SESSION_PACKS,
  SMASH_TITLES,
  rosterForTitle,
  availableFighters,
  currentPicks,
  smashdownCap,
} from "@gamenight/shared";
import "./smash.css";

type Mode = "ffa" | "koth";
type Format = "ffa" | "koth" | "bestof" | "smashdown";
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
/** One side of a battle. `memberIds` are roster slot ids. */
interface SideT { id: string; name: string; memberIds: string[] }
interface Koth {
  kingSideId: string | null;
  /** Challenger SIDE ids, front plays next. */
  queue: string[];
  streak: number;
  bestStreak: { sideId: string; memberIds: string[]; streak: number } | null;
}
interface GameLine { playerId: string; character: string | null; placement: number; isWinner: boolean; side: string | null }
interface SeriesT { idx: number; aId: string; bId: string; games: { winnerId: string }[]; winnerId: string | null; at: string | null }
interface SeriesStanding {
  slotId: string; name: string; seriesWins: number; seriesPlayed: number;
  gameWins: number; gamesPlayed: number; currentStreak: number; bestStreak: number;
}
interface SdStanding {
  playerId: string; name: string; wins: number; played: number; placement: number;
  /** Null on a solo series, the side id on a team one. */
  side: string | null;
}
/** One SIDE's row in a team Smashdown series. Absent on a solo one. */
interface SdSideStanding {
  sideId: string; memberIds: string[]; name: string; wins: number; played: number; placement: number;
}
/** Everything Smashdown-shaped, derived server-side (see smashdownStatus). */
interface SdStatus {
  battleCount: number;
  battlesPlayed: number;
  battlesLeft: number;
  burned: string[];
  poolSize: number;
  fightersLeft: number;
  standings: SdStanding[];
  /** Present only when sides are in force; see smashdownSideStatus. */
  sideStandings?: SdSideStanding[];
  clinched: boolean;
  over: boolean;
  winnerIds: string[];
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
  /** The arrangement of sides in force, flattened by the server. */
  sides: SideT[];
  /** True when a side in force holds more than one player. Drives the screen. */
  teamPlay: boolean;
  games: { idx: number; mode: Mode; lines: GameLine[]; at: string }[];
  koth: Koth | null;
  bestOf: BestOf;
  series: SeriesT | null;
  seriesLog: SeriesT[];
  seriesStandings: SeriesStanding[];
  battleCount: number;
  burned: string[];
  mercy: boolean;
  smashdown: SdStatus | null;
  summary: {
    characters: { character: string; played: number; wins: number }[];
    players: {
      playerId: string; name: string; played: number; wins: number;
      mainCharacter: string | null; wonWith: number;
    }[];
  };
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
  const { ctx, session, loading, busy, err, call, startSession } =
    usePackSession<Session>({
      pack: "smash",
      wsType: SESSION_PACKS.smash.wsType,
      eventId,
      replacePrompt:
        "A session is already in progress on this event. Replace it? Any unfinished game or set is lost.",
    });

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
          {/* A way back to the NIGHT this pack belongs to, which the
              history-based Back button cannot promise: somebody who opened a
              shared link in a fresh tab has no history to pop, so Back sends
              them home rather than to the event they were sent to. Standing
              rule: every pack screen has both. */}
          <Link to={`/e/${eventId}`} className="sm-textbtn">🎪 Event</Link>
          {/* The NIGHT's TV address, not this pack's: one url in circulation,
              and the screen keeps working when the crew switches games. Quick
              play has an eventId too (it creates a hidden personal crew and a
              real event), so this is unconditional. /smash/tv/:eventId still
              works for anything already bookmarked. */}
          <Link to={`/e/${eventId}/tv`} className="sm-textbtn">📺 TV</Link>
        </div>
        <div>
          <div className="sm-brand">Smash <em>Night</em></div>
          <div className="sm-sub">Free-for-all, King of the Hill, Best Of &amp; Smashdown</div>
        </div>

        {err && <p className="sm-err">{err}</p>}

        {!session || session.status === "completed" ? (
          <SetupOrWaiting
            ctx={ctx}
            completed={session?.status === "completed"}
            lastSeries={session?.status === "completed" ? session.smashdown : null}
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
  lastSeries,
  busy,
  onStart,
}: {
  ctx: Ctx | null;
  completed: boolean;
  /** The finished Smashdown series, so ending it doesn't wipe the result. */
  lastSeries: SdStatus | null;
  busy: boolean;
  onStart: (p: Record<string, unknown>) => void;
}) {
  // A format chosen upstream (the game>format picker) arrives as ?format=
  // (older links used ?mode=).
  const qs = new URLSearchParams(window.location.search);
  const qFormat = qs.get("format");
  const initialFormat: Format =
    qFormat === "koth" || qFormat === "bestof" || qFormat === "ffa" || qFormat === "smashdown"
      ? qFormat
      : qs.get("mode") === "koth"
      ? "koth"
      : "ffa";
  const [format, setFormat] = useState<Format>(initialFormat);
  const [bestOf, setBestOf] = useState<BestOf>(3);
  const [battleCount, setBattleCount] = useState(5);
  const [mercy, setMercy] = useState(false);
  const [titleId, setTitleId] = useState<string>(SMASH_TITLES[0]!.id);
  const [assignment, setAssignment] = useState<Assignment>("self");
  const [detail, setDetail] = useState<Detail>("winner");
  const [roster, setRoster] = useState<{ userId: string | null; name: string }[]>([]);
  const [guest, setGuest] = useState("");
  // Team battles are OFF by default, which is every Smash night this pack has
  // ever recorded. NOTHING TURNS THEM ON BY ITSELF: Mario Kart auto-pairs for
  // Double Dash at exactly four players because a shared kart is what that game
  // IS, and Smash has no title where a shared slot is the game, so there is
  // nothing to auto-apply here. See the DECISION LOG.
  const [teams, setTeams] = useState(false);
  // Side membership by ROSTER INDEX; slot ids are minted server-side and this
  // screen has never seen one.
  const [assign, setAssign] = useState<number[][]>([[], []]);

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
  const addGuestNamed = (raw: string) => {
    const n = raw.trim().slice(0, 24);
    if (n) setRoster([...roster, { userId: null, name: n }]);
  };
  const addGuest = () => {
    addGuestNamed(guest);
    setGuest("");
  };
  const removeAt = (i: number) => {
    // Indices shift when somebody is removed, so the assignment has to shift
    // with them or the sides silently hold the wrong people.
    setRoster(roster.filter((_, j) => j !== i));
    setAssign(dropRosterIndex(assign, i));
  };

  const notAdded = ctx.members.filter((m) => !roster.some((r) => r.userId === m.userId));

  // THE TOGGLE IS OFFERED ONLY FOR THE FORMATS THAT ARE CONVERTED. Offering it
  // on a format whose play screen still ranks individuals would be a switch
  // that appears to do something and does not, which is worse than not having
  // it yet. Add a format to this list in the same commit that converts it.
  const teamFormats: Format[] = ["ffa", "koth", "bestof", "smashdown"];
  const teamsOffered = teamFormats.includes(format);
  const teamsOn = teams && teamsOffered;

  // The picker owns the sides and the primitive owns what is valid, so this
  // screen cannot drift from the answer the server will give it.
  const { unplaced, check } = teamPickerStatus(assign, roster.length);
  const teamsReady = !teamsOn || (check.error === null && unplaced.length === 0);
  const kothOddWarning =
    teamsOn && format === "koth" && check.error === null && unplaced.length === 0 && assign.length < 3;

  // The battle cap is a property of the TITLE, not of Smash: Ultimate's 86
  // fighters give four players 21 battles, but Smash 64's 12 give them three.
  // Shown as a plain sentence up front rather than as a validation error after
  // the host has typed a number the roster cannot support.
  const title = SMASH_TITLES.find((t) => t.id === titleId) ?? SMASH_TITLES[0]!;
  const poolSize = rosterForTitle(SMASH_TITLES, titleId).length;
  const cap = smashdownCap(poolSize, roster.length);
  const battles = Math.max(1, Math.min(battleCount, Math.max(cap, 1)));
  const smashdownImpossible = format === "smashdown" && roster.length >= 2 && cap < 1;
  const tooManyForSmashdown = format === "smashdown" && roster.length > 8;

  return (
    <>
      {completed && (
        <div className="sm-card" style={{ marginTop: 16 }}>
          <p className="sm-hint">That format wrapped. Pick a format below to run another one tonight.</p>
        </div>
      )}
      {completed && lastSeries && lastSeries.battlesPlayed > 0 && (
        <SeriesResult sd={lastSeries} heading="Smashdown result" />
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
          <button className={format === "smashdown" ? "on" : ""} onClick={() => setFormat("smashdown")}>Smashdown</button>
        </div>
        <p className="sm-hint" style={{ marginTop: 8 }}>
          {format === "ffa"
            ? "2 to 8 players per game, played across the night."
            : format === "koth"
            ? "Winner stays on, loser rotates out. First up is first in the list."
            : format === "bestof"
            ? "1v1 sets. Pick two players; a set records once, when it is won."
            : "Every fighter used is struck off for the rest of the series. Everyone plays every battle; most wins takes it."}
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
        {format === "smashdown" && (
          <>
            <div className="sm-h" style={{ marginTop: 14 }}>How many battles?</div>
            {roster.length < 2 ? (
              <p className="sm-hint">Add players below and the limit for this game appears here.</p>
            ) : cap < 1 ? (
              <p className="sm-err" style={{ marginTop: 0 }}>
                {title.name} only has {poolSize} fighters, so {roster.length} players cannot play a battle.
                Pick a bigger game or drop a player.
              </p>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <input
                    className="sm-input"
                    style={{ width: 90 }}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={cap}
                    value={battles}
                    onChange={(e) => setBattleCount(Math.max(1, Math.min(Number(e.target.value) || 1, cap)))}
                  />
                  <span className="sm-hint">battle{battles === 1 ? "" : "s"}</span>
                  {cap > 1 && (
                    <button className="sm-textbtn" onClick={() => setBattleCount(cap)}>use the max ({cap})</button>
                  )}
                </div>
                <p className="sm-hint" style={{ marginTop: 8 }}>
                  {title.name} has {poolSize} fighters, so {roster.length} players can play up to{" "}
                  {cap} battle{cap === 1 ? "" : "s"} before the roster runs out.
                </p>
              </>
            )}
            <div className="sm-row" style={{ marginTop: 10 }}>
              <span style={{ flex: 1 }}>
                Mercy rule
                <div className="sm-hint">End early once the lead is unbeatable.</div>
              </span>
              <button
                className={`gn-toggle ${mercy ? "gn-toggle--on" : "gn-toggle--off"}`}
                aria-pressed={mercy}
                onClick={() => setMercy(!mercy)}
              >
                {mercy ? "ON" : "OFF"}
              </button>
            </div>
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
        <RosterCarryOver
          source={ctx.prefillSource}
          label={ctx.prefillLabel}
          rsvpSlots={ctx.rsvpPrefill}
          current={roster}
          onUseRsvp={(slots) => setRoster(slots.map((p) => ({ userId: p.userId, name: p.name })))}
        />
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
        <GuestChips names={ctx.recentGuests} current={roster} onAdd={addGuestNamed} />
        <p className="sm-hint" style={{ marginTop: 8 }}>Guests play, but lifetime stats only count crew members.</p>
      </div>

      {teamsOffered && (
        <div className="sm-card">
          <div className="sm-row">
            <span style={{ flex: 1 }} className="sm-name">Team battles</span>
            <button
              className={`gn-toggle ${teamsOn ? "gn-toggle--on" : "gn-toggle--off"}`}
              aria-pressed={teamsOn}
              onClick={() => setTeams(!teams)}
            >
              {teamsOn ? "ON" : "OFF"}
            </button>
          </div>
          <p className="sm-hint">
            {teamsOn
              ? "Put everybody on a side. A side wins or loses as one, and every member gets the result."
              : "Off means one player per side, exactly as before."}
          </p>

          {teamsOn && <TeamPicker cx="sm" roster={roster} assign={assign} setAssign={setAssign} />}
          {teamsOn && format === "smashdown" && (
            <p className="sm-hint" style={{ marginTop: 8 }}>
              Everybody still picks their OWN fighter, so a battle burns one fighter per player and the number of
              battles that fit does not change.
            </p>
          )}
          {/* Uneven sides are INFORMATION, never a blocking error: TeamPicker
              already says so. 2v1 and 3v1 record exactly like a 2v2. The one
              thing worth adding is that a two-side ladder is a king and a queue
              of one, which stops meaning anything. */}
          {kothOddWarning && (
            <p className="sm-hint" style={{ marginTop: 8 }}>
              Two sides in King of the Hill is one side waiting its turn. Three or more makes a ladder.
            </p>
          )}
        </div>
      )}

      {tooManyForSmashdown && (
        <p className="sm-err">
          Smashdown is capped at 8 players, because everyone plays every battle. Drop{" "}
          {roster.length - 8} to run it.
        </p>
      )}
      <button
        className="sm-btn"
        style={{ marginTop: 12 }}
        disabled={busy || roster.length < 2 || smashdownImpossible || tooManyForSmashdown || !teamsReady}
        onClick={() =>
          onStart({
            titleId, format, bestOf, assignment, resultDetail: detail, roster,
            battleCount: battles, mercy,
            ...(teamsOn ? { sides: assign } : {}),
          })
        }
      >
        {roster.length < 2
          ? "Add at least 2 players"
          : teamsOn && unplaced.length > 0
          ? `${unplaced.length} still to put on a side`
          : teamsOn && check.error
          ? check.error
          : format === "smashdown" && !smashdownImpossible && !tooManyForSmashdown
          ? `Start Smashdown · ${battles} battle${battles === 1 ? "" : "s"}`
          : `Start ${formatLabel(format)}`}
      </button>
    </>
  );
}

// ---------- Live play ----------

/** Every player's name, keyed by slot id. */
const namesOf = (session: Session) => new Map(session.roster.map((p) => [p.id, p.name]));

/**
 * A side's label: its members' names.
 *
 * A side of one is that player's name, which is why every screen below reads
 * the same on a solo night as it did before sides existed.
 */
function sideLabel(session: Session, sideId: string | null | undefined): string {
  const side = session.sides.find((s) => s.id === sideId);
  if (!side) return "?";
  const names = namesOf(session);
  // Falls back to the side's own name rather than to a row of "?", which is the
  // rule teams.ts sideLabel already owns; a side whose members are gone should
  // read "Side A", not "? + ?".
  const out = side.memberIds.map((id) => names.get(id)).filter((n): n is string => !!n);
  return out.length ? out.join(" + ") : side.name;
}

/** A side's fighters, one per member, because fighters are per PLAYER. */
function sideFighters(session: Session, sideId: string | null | undefined): string {
  const side = session.sides.find((s) => s.id === sideId);
  if (!side) return "";
  const charOf = new Map(session.roster.map((p) => [p.id, p.character]));
  return side.memberIds.map((id) => charOf.get(id) ?? "no fighter").join(" + ");
}

/** The side holding a roster slot, out of the arrangement in force. */
const sideOfSlot = (session: Session, slotId: string): SideT | undefined =>
  session.sides.find((s) => s.memberIds.includes(slotId));

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

  const sd = session.smashdown;
  // Smashdown scopes every picker to what is LEFT: the title's roster minus
  // the burn board, minus whoever the other players are already on for this
  // battle. Computed the same way the server checks it, from the shared
  // helpers, so the dropdown can never offer something the POST will reject.
  const fighterOptions = (slot: Slot): readonly string[] =>
    sd ? availableFighters(titleRoster, sd.burned, currentPicks(session.roster, slot.id)) : titleRoster;

  return (
    <>
      {/* Roster + fighters */}
      <div className="sm-card" style={{ marginTop: 16 }}>
        <div className="sm-h">
          Fighters{sd && !sd.over ? ` · battle ${sd.battlesPlayed + 1} of ${sd.battleCount}` : ""}
        </div>
        {sd && !sd.over && (
          <p className="sm-hint" style={{ marginBottom: 8 }}>
            Everyone needs a fighter before the battle, and nobody can repeat one.
            {" "}{sd.fightersLeft} of {sd.poolSize} still available.
          </p>
        )}
        {session.roster.map((slot) => {
          const isKing = !!session.koth?.kingSideId && sideOfSlot(session, slot.id)?.id === session.koth.kingSideId;
          return (
            <div className="sm-row" key={slot.id}>
              <div style={{ flex: 1 }}>
                <div className="sm-name">
                  {slot.name} {isKing && <span className="sm-pill sm-pill--king">👑 king</span>}
                </div>
                <div className="sm-char">
                  {slot.character ?? "no fighter yet"}
                  {session.teamPlay && <> · {sideLabel(session, sideOfSlot(session, slot.id)?.id)}</>}
                </div>
              </div>
              {mayEditChar(slot) && !(sd && sd.over) && (
                <div style={{ width: 160 }}>
                  <FighterSelect value={slot.character} onChange={(v) => setChar(slot.id, v)} roster={fighterOptions(slot)} />
                </div>
              )}
            </div>
          );
        })}
        {canHost && !(sd && sd.over) && (session.assignment === "random" || session.assignment === "host") && (
          <button className="sm-btn sm-btn--ghost" style={{ marginTop: 10 }} disabled={busy} onClick={() => call(`/api/smash/${eventId}/randomize`)}>
            🎲 Randomize all fighters
          </button>
        )}
      </div>

      {/* The burn board: the centrepiece of the format, so it sits above the
          scoring controls rather than under the standings. */}
      {sd && <BurnBoard sd={sd} />}
      {sd && sd.over && <SeriesResult sd={sd} heading="Series over" />}

      {/* Play area */}
      {canScore ? (
        session.format === "smashdown" && sd ? (
          <SmashdownPlay
            session={session}
            sd={sd}
            busy={busy}
            onWin={(winnerId) => call(`/api/smash/${eventId}/record`, { winnerId })}
            onPlacements={(lines) => call(`/api/smash/${eventId}/record`, { lines })}
            onSideOrder={(sideIds) => call(`/api/smash/${eventId}/record`, { sides: sideIds })}
          />
        ) : session.format === "bestof" ? (
          <BestOfPlay
            session={session}
            busy={busy}
            onStartSet={(aId, bId) => call(`/api/smash/${eventId}/start-series`, { aId, bId })}
            onWin={(winnerId) => call(`/api/smash/${eventId}/record`, { winnerId })}
          />
        ) : session.mode === "koth" ? (
          // SEPARATE COMPONENTS, NOT ONE WITH A FLAG. The entry shapes genuinely
          // differ: one taps a player and one taps a side, and threading a
          // boolean would make every line in them read "unless teams". Mario
          // Party's RecordTagBoard sits next to its per-player screen for the
          // same reason.
          session.teamPlay ? (
            <KothTeamPlay
              session={session}
              busy={busy}
              onWin={(winnerSideId) => call(`/api/smash/${eventId}/record`, { winnerSideId })}
            />
          ) : (
            <KothPlay session={session} nameOf={nameOf} busy={busy} onWin={(winnerId) => call(`/api/smash/${eventId}/record`, { winnerId })} />
          )
        ) : session.teamPlay ? (
          <FfaTeamPlay
            session={session}
            busy={busy}
            onRecord={(sideIds) => call(`/api/smash/${eventId}/record`, { sides: sideIds })}
          />
        ) : (
          <FfaPlay session={session} busy={busy} onRecord={(lines) => call(`/api/smash/${eventId}/record`, { lines })} />
        )
      ) : (
        <div className="sm-card">
          <p className="sm-hint">The host is recording results. Standings update live below.</p>
        </div>
      )}

      {/* Night summary */}
      {sd ? (
        <div className="sm-card">
          <div className="sm-h">
            Standings ({sd.battlesPlayed} of {sd.battleCount} battle{sd.battleCount === 1 ? "" : "s"})
          </div>
          {/* THE SIDE TABLE, above the per-player rows rather than instead of
              them. The clinch and the mercy rule run over SIDES (a per-player
              leader board can never have a single leader in a team series, see
              smashdownSideStatus), so the table the rule actually reads is the
              one the room should be looking at. The per-player rows underneath
              stay, because that is what the ledger writes. */}
          {sd.sideStandings && sd.battlesPlayed > 0 && (
            <>
              <div className="sm-lab">Sides</div>
              {sd.sideStandings.map((x) => (
                <div className="sm-row" key={x.sideId}>
                  <span className="sm-char" style={{ width: 22 }}>{x.placement}</span>
                  <span style={{ flex: 1 }} className="sm-name">{x.name}</span>
                  <span className="sm-char">{x.wins}W / {x.played}</span>
                </div>
              ))}
              <div className="sm-lab" style={{ marginTop: 10 }}>Players</div>
            </>
          )}
          {sd.battlesPlayed === 0 ? (
            <p className="sm-hint">No battles recorded yet.</p>
          ) : (
            sd.standings.map((p) => {
              const wonWith = session.summary.players.find((x) => x.playerId === p.playerId)?.wonWith ?? 0;
              return (
                <div className="sm-row" key={p.playerId}>
                  <span className="sm-char" style={{ width: 22 }}>{p.placement}</span>
                  <span style={{ flex: 1 }} className="sm-name">{p.name}</span>
                  <span className="sm-char">
                    {p.wins}W / {p.played}
                    {wonWith > 0 && <> · won with {wonWith}</>}
                  </span>
                </div>
              );
            })
          )}
          {sd.battlesPlayed > 0 && (
            <p className="sm-hint" style={{ marginTop: 8 }}>
              "Won with" counts the different fighters each player has won a battle with.
            </p>
          )}
        </div>
      ) : session.format === "bestof" ? (
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
      {canHost && teamFormatsLive.includes(session.format) && (
        <RearrangeSides eventId={eventId} session={session} busy={busy} call={call} />
      )}

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
          {sd && (
            <div className="sm-row">
              <span style={{ flex: 1 }}>
                Mercy rule
                <div className="sm-hint">
                  {sd.clinched && !session.mercy
                    ? "The lead is already unbeatable. Turning this on ends the series now."
                    : "End the series once the lead is unbeatable."}
                </div>
              </span>
              <button
                className={`gn-toggle ${session.mercy ? "gn-toggle--on" : "gn-toggle--off"}`}
                aria-pressed={session.mercy}
                onClick={() => call(`/api/smash/${eventId}/mercy`, { on: !session.mercy })}
              >
                {session.mercy ? "ON" : "OFF"}
              </button>
            </div>
          )}
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
            <button className="sm-btn sm-btn--go" disabled={busy} onClick={() => call(`/api/smash/${eventId}/complete`)}>
              {sd && sd.over ? "End series" : "End format"}
            </button>
          </div>
          <p className="sm-hint" style={{ marginTop: 8 }}>
            Ending the format wraps this run and takes you back to the format picker, so you can go from FFA into King of the Hill (or run it back).
          </p>
        </div>
      )}
    </>
  );
}

// ---------- Rearrange the sides mid-night ----------
//
// Sides are fixed for the night by default and this is the explicit way to
// change them. Battles already recorded keep the side written on their lines,
// so the night's history stays true; in King of the Hill the ladder restarts,
// because a queue of sides that no longer exist is not a queue, and a Best Of
// set in progress blocks it. The server owns all three rules.
//
// Offered on the same formats the setup toggle is offered on, and for the same
// reason: a rearrange on a format whose play screen still ranks individuals
// would be a control that appears to do something and does not.
const teamFormatsLive: Format[] = ["ffa", "koth", "bestof", "smashdown"];

function RearrangeSides({
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
  const putOn = (sideIdx: number, playerId: string) =>
    setDraft(draft.map((k, i) => (i === sideIdx ? [...k, playerId] : k.filter((id) => id !== playerId))));
  const takeOff = (playerId: string) => setDraft(draft.map((k) => k.filter((id) => id !== playerId)));
  const sizes = draft.map((k) => k.length);
  const even = sizes.length > 0 && sizes.every((n) => n === sizes[0]);

  if (!open) {
    return (
      <div className="sm-card">
        <div className="sm-h">Sides</div>
        {session.sides.map((sd) => (
          <div className="sm-row" key={sd.id}>
            <span style={{ flex: 1 }} className="sm-name">{sideLabel(session, sd.id)}</span>
            <span className="sm-char">{sideFighters(session, sd.id)}</span>
          </div>
        ))}
        <button className="sm-btn sm-btn--ghost" style={{ marginTop: 10 }} disabled={busy} onClick={start}>
          🔀 Rearrange sides
        </button>
      </div>
    );
  }

  return (
    <div className="sm-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="sm-h" style={{ margin: 0 }}>Rearrange sides</div>
        <button className="sm-textbtn" onClick={() => setOpen(false)}>cancel</button>
      </div>
      <div className="sm-lab" style={{ marginTop: 10 }}>New sides, from the next battle on</div>
      {draft.map((members, i) => (
        <div key={i} style={{ marginTop: 10 }}>
          <div className="sm-lab" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Side {String.fromCharCode(65 + i)} ({members.length})</span>
            {draft.length > 2 && (
              <button className="sm-textbtn" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>remove</button>
            )}
          </div>
          <div className="sm-seg">
            {members.length === 0 && <span className="sm-hint">nobody yet</span>}
            {members.map((id) => (
              <button key={id} className="on" onClick={() => takeOff(id)}>{names.get(id)} &times;</button>
            ))}
          </div>
        </div>
      ))}

      {loose.length > 0 && (
        <>
          <div className="sm-lab" style={{ marginTop: 12 }}>Not on a side yet</div>
          {loose.map((p) => (
            <div className="sm-row" key={p.id}>
              <span className="sm-name" style={{ flex: 1 }}>{p.name}</span>
              <div className="sm-seg" style={{ flex: "0 0 auto", marginTop: 0 }}>
                {draft.map((_, i) => (
                  <button key={i} onClick={() => putOn(i, p.id)}>{String.fromCharCode(65 + i)}</button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="sm-btn sm-btn--ghost" onClick={() => setDraft([...draft, []])} disabled={draft.length >= 8}>+ Side</button>
      </div>

      {/* Uneven is allowed and warned, never blocked. */}
      {!even && loose.length === 0 && (
        <p className="sm-hint" style={{ marginTop: 8 }}>⚠️ Uneven sides ({sizes.join(" v ")}). That is allowed.</p>
      )}
      <p className="sm-hint" style={{ marginTop: 8 }}>
        Battles already recorded keep the sides they were fought with.
        {session.format === "koth" ? " The ladder restarts from the new sides." : ""}
      </p>
      <button
        className="sm-btn"
        style={{ marginTop: 10 }}
        disabled={busy || loose.length > 0 || draft.length < 2 || sizes.some((n) => n === 0)}
        onClick={() => {
          void call(`/api/smash/${eventId}/sides`, { sides: draft.map((memberIds) => ({ memberIds })) });
          setOpen(false);
        }}
      >
        {loose.length > 0 ? `${loose.length} still to place` : "Use these sides"}
      </button>
    </div>
  );
}

// ---------- FFA team play (a tapped order of SIDES) ----------
//
// A SIBLING OF FfaPlay, not FfaPlay with a flag. That screen ranks players and
// this one ranks sides; the checklist, the winner tap and the placement select
// are all keyed on a different thing, and there is no line in either that reads
// better for having both cases in it.

function FfaTeamPlay({
  session,
  busy,
  onRecord,
}: {
  session: Session;
  busy: boolean;
  onRecord: (sideIds: string[]) => void;
}) {
  const allChecked = () => Object.fromEntries(session.sides.map((s): [string, boolean] => [s.id, true]));
  const [inGame, setInGame] = useState<Record<string, boolean>>(allChecked);
  const [winner, setWinner] = useState<string | null>(null);
  const [places, setPlaces] = useState<Record<string, number>>({});

  const active = session.sides.filter((s) => inGame[s.id]);
  const everyoneIn = active.length === session.sides.length;
  const detail = session.resultDetail;
  const seats = active.reduce((n, s) => n + s.memberIds.length, 0);

  const toggle = (id: string) => setInGame((s) => ({ ...s, [id]: !s[id] }));

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
    setInGame(allChecked());
    setWinner(null);
    setPlaces({});
  };

  const ready =
    active.length >= 2 &&
    // Smash seats eight PLAYERS, not eight sides, and this is the same cap the
    // server checks. Off the shared constant rather than a literal, so raising
    // FFA_MAX_PLAYERS cannot leave this button refusing what the server allows.
    seats <= FFA_MAX_PLAYERS &&
    (detail === "winner"
      ? !!winner && !!inGame[winner]
      : active.every((s) => (places[s.id] ?? 0) >= 1 && (places[s.id] ?? 0) <= active.length) &&
        new Set(active.map((s) => places[s.id] ?? 0)).size === active.length);

  return (
    <div className="sm-card">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div className="sm-h">Record a battle</div>
        <button className="sm-textbtn" onClick={() => setInGame(everyoneIn ? {} : allChecked())}>
          {everyoneIn ? "clear all" : "check all"}
        </button>
      </div>
      <p className="sm-hint" style={{ marginBottom: 8 }}>
        Every side starts checked; untick who sat out, then {detail === "winner" ? "tap the winning side" : "set each placement"}.
      </p>
      {session.sides.map((s) => (
        <div className="sm-row" key={s.id}>
          <input type="checkbox" checked={!!inGame[s.id]} onChange={() => toggle(s.id)} />
          <div style={{ flex: 1 }}>
            <div className="sm-name">{sideLabel(session, s.id)}</div>
            <div className="sm-char">{sideFighters(session, s.id)}</div>
          </div>
          {inGame[s.id] && detail === "winner" && (
            <button
              className={winner === s.id ? "sm-fighter win" : "sm-textbtn"}
              style={{ padding: "6px 12px" }}
              onClick={() => setWinner(s.id)}
            >
              {winner === s.id ? "★ winner" : "win"}
            </button>
          )}
          {inGame[s.id] && detail === "placement" && (
            <select
              className="sm-select"
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
      <button className="sm-btn" style={{ marginTop: 12 }} disabled={busy || !ready} onClick={record}>
        {active.length < 2
          ? "Pick at least 2 sides"
          : seats > FFA_MAX_PLAYERS
          ? `Smash seats ${FFA_MAX_PLAYERS} players`
          : "Record battle"}
      </button>
      <p className="sm-hint" style={{ marginTop: 8 }}>
        Every member of a side gets the side's result, and everybody keeps their own fighter.
      </p>
    </div>
  );
}

// ---------- KOTH team play (the throne held by a side) ----------

function KothTeamPlay({
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
    return <div className="sm-card"><p className="sm-hint">Need at least two sides queued to play.</p></div>;
  }
  return (
    <div className="sm-card">
      <div className="sm-h">Next round {koth && koth.streak > 0 ? `· on a ${koth.streak} streak` : ""}</div>
      <div className="sm-vs">
        <button className="sm-fighter" disabled={busy} onClick={() => onWin(kingId)}>
          <div className="sm-fighter__n">{sideLabel(session, kingId)}</div>
          <div className="sm-fighter__c">{sideFighters(session, kingId)}</div>
          <div className="sm-pill sm-pill--king" style={{ marginTop: 6 }}>👑 defending</div>
        </button>
        <div className="sm-vsbadge">VS</div>
        <button className="sm-fighter" disabled={busy} onClick={() => onWin(challengerId)}>
          <div className="sm-fighter__n">{sideLabel(session, challengerId)}</div>
          <div className="sm-fighter__c">{sideFighters(session, challengerId)}</div>
          <div className="sm-pill" style={{ marginTop: 6 }}>challenger</div>
        </button>
      </div>
      <p className="sm-hint" style={{ marginTop: 10 }}>
        Tap the winner. The losing side goes to the back of the line, together.
      </p>
      {koth && koth.queue.length > 1 ? (
        <p className="sm-hint">Up next: {koth.queue.slice(1).map((id) => sideLabel(session, id)).join(", ")}</p>
      ) : null}
    </div>
  );
}

// ---------- Smashdown ----------

/** The burn board: every fighter struck out, in the order they went. */
function BurnBoard({ sd }: { sd: SdStatus }) {
  return (
    <div className="sm-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="sm-h" style={{ margin: 0 }}>Burned</div>
        <span className="sm-hint">{sd.fightersLeft} of {sd.poolSize} left</span>
      </div>
      {sd.burned.length === 0 ? (
        <p className="sm-hint" style={{ marginTop: 8 }}>Nobody is out yet. Every fighter used tonight lands here.</p>
      ) : (
        <div className="sm-burn">
          {sd.burned.map((f) => (
            <span className="sm-burn__x" key={f}>{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Final (or clinched) standings, most wins takes it, ties are co-winners. */
function SeriesResult({ sd, heading }: { sd: SdStatus; heading: string }) {
  const winners = sd.standings.filter((s) => sd.winnerIds.includes(s.playerId));
  const co = winners.length > 1;
  return (
    <div className="sm-card">
      <div className="sm-h">🏆 {heading}</div>
      {winners.length > 0 && (
        <div className="sm-score" style={{ margin: "4px 0 10px" }}>
          {winners.map((w) => w.name).join(" & ")}
        </div>
      )}
      <p className="sm-hint" style={{ marginBottom: 8 }}>
        {co
          ? `Tied on ${winners[0]!.wins} win${winners[0]!.wins === 1 ? "" : "s"}, so they are co-winners.`
          : `${sd.battlesPlayed} of ${sd.battleCount} battle${sd.battleCount === 1 ? "" : "s"} played.`}
      </p>
      {sd.standings.map((p) => (
        <div className="sm-row" key={p.playerId}>
          <span className="sm-char" style={{ width: 22 }}>{p.placement}</span>
          <span style={{ flex: 1 }} className="sm-name">{p.name}</span>
          <span className="sm-char">{p.wins}W / {p.played}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Recording a battle. Everyone in the roster plays every battle (that is what
 * makes the cap arithmetic honest), so there is no sit-out checklist here: it
 * is one tap on the winner, or the full 1..N order when the host chose full
 * placement detail.
 */
function SmashdownPlay({
  session,
  sd,
  busy,
  onWin,
  onPlacements,
  onSideOrder,
}: {
  session: Session;
  sd: SdStatus;
  busy: boolean;
  onWin: (winnerId: string) => void;
  onPlacements: (lines: { playerId: string; placement: number; isWinner: boolean }[]) => void;
  /** A tapped finish order of SIDES, used only when sides are in force. */
  onSideOrder: (sideIds: string[]) => void;
}) {
  const [places, setPlaces] = useState<Record<string, number>>({});
  // A team Smashdown battle ranks SIDES; a solo one ranks players. Everybody
  // plays every battle either way, which is what makes the cap arithmetic true,
  // so the list is the whole arrangement rather than a checklist.
  const units = session.teamPlay
    ? session.sides.map((sd2) => ({ id: sd2.id, name: sideLabel(session, sd2.id), fighters: sideFighters(session, sd2.id) }))
    : session.roster.map((p) => ({ id: p.id, name: p.name, fighters: p.character ?? "" }));
  const n = units.length;
  const missing = session.roster.filter((p) => !p.character);

  if (sd.over) {
    return (
      <div className="sm-card">
        <p className="sm-hint">
          The series is done. End it from the host controls below, or undo the last battle to keep going.
        </p>
      </div>
    );
  }
  if (missing.length > 0) {
    return (
      <div className="sm-card">
        <div className="sm-h">Battle {sd.battlesPlayed + 1} of {sd.battleCount}</div>
        <p className="sm-hint">
          Waiting on a fighter for {missing.map((p) => p.name).join(", ")}. Every player needs one before the battle
          can be recorded, because that is what gets struck off.
        </p>
      </div>
    );
  }

  if (session.resultDetail === "placement") {
    const ready =
      units.every((u) => (places[u.id] ?? 0) >= 1 && (places[u.id] ?? 0) <= n) &&
      new Set(units.map((u) => places[u.id] ?? 0)).size === n;
    return (
      <div className="sm-card">
        <div className="sm-h">Battle {sd.battlesPlayed + 1} of {sd.battleCount}</div>
        {units.map((u) => (
          <div className="sm-row" key={u.id}>
            <div style={{ flex: 1 }}>
              <div className="sm-name">{u.name}</div>
              <div className="sm-char">{u.fighters}</div>
            </div>
            <select
              className="sm-select"
              style={{ width: 72 }}
              value={places[u.id] ?? ""}
              onChange={(e) => setPlaces((s) => ({ ...s, [u.id]: Number(e.target.value) }))}
            >
              <option value="">–</option>
              {units.map((_, i) => (
                <option key={i + 1} value={i + 1}>{i + 1}</option>
              ))}
            </select>
          </div>
        ))}
        <button
          className="sm-btn"
          style={{ marginTop: 12 }}
          disabled={busy || !ready}
          onClick={() => {
            if (session.teamPlay) {
              onSideOrder([...units].sort((a, b) => (places[a.id] ?? 0) - (places[b.id] ?? 0)).map((u) => u.id));
            } else {
              onPlacements(
                units.map((u) => ({
                  playerId: u.id,
                  placement: places[u.id] ?? 0,
                  isWinner: (places[u.id] ?? 0) === 1,
                })),
              );
            }
            setPlaces({});
          }}
        >
          Record battle
        </button>
      </div>
    );
  }

  return (
    <div className="sm-card">
      <div className="sm-h">Battle {sd.battlesPlayed + 1} of {sd.battleCount}</div>
      <p className="sm-hint" style={{ marginBottom: 8 }}>
        Tap the winner{session.teamPlay ? "ing side" : ""}. Every fighter below is struck off after this.
      </p>
      <div className="sm-picks">
        {units.map((u) => (
          <button
            className="sm-fighter"
            key={u.id}
            disabled={busy}
            onClick={() =>
              session.teamPlay
                ? onSideOrder([u.id, ...units.filter((x) => x.id !== u.id).map((x) => x.id)])
                : onWin(u.id)
            }
          >
            <div className="sm-fighter__n">{u.name}</div>
            <div className="sm-fighter__c">{u.fighters}</div>
          </button>
        ))}
      </div>
    </div>
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
  // The throne and the queue hold SIDE ids. This screen is the solo one, where a
  // side holds exactly one player, so each id resolves to that player and the
  // screen reads exactly as it did before sides existed. The team ladder has its
  // own component; see KothTeamPlay.
  const soloIn = (sideId: string | null | undefined): string | null =>
    session.sides.find((sd) => sd.id === sideId)?.memberIds[0] ?? null;
  const kingId = soloIn(koth?.kingSideId);
  const challengerId = soloIn(koth?.queue[0]);
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
        <p className="sm-hint">
          Up next: {koth.queue.slice(1).map((id) => nameOf.get(soloIn(id) ?? "")).join(", ") || "–"}
        </p>
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
  busy,
  onStartSet,
  onWin,
}: {
  session: Session;
  busy: boolean;
  /** Two SIDE ids. On a solo night a side holds one player. */
  onStartSet: (aId: string, bId: string) => void;
  onWin: (winnerSideId: string) => void;
}) {
  // A set is between two SIDES, and the ids in `series` are side ids. This is
  // ONE screen rather than a sibling, unlike the FFA and KOTH pair, because the
  // shape does not change: two things picked from a list, a scoreline, and a
  // tap on the winner. A side of one is labelled with that player's name, so a
  // solo night reads exactly as it did.
  const unit = session.teamPlay ? "Side" : "Player";
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
            <option value="">{unit} 1</option>
            {session.sides.map((sd) => (
              <option key={sd.id} value={sd.id} disabled={sd.id === pickB}>{sideLabel(session, sd.id)}</option>
            ))}
          </select>
          <select className="sm-select" value={pickB} onChange={(e) => setPickB(e.target.value)}>
            <option value="">{unit} 2</option>
            {session.sides.map((sd) => (
              <option key={sd.id} value={sd.id} disabled={sd.id === pickA}>{sideLabel(session, sd.id)}</option>
            ))}
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
          <div className="sm-fighter__n">{sideLabel(session, cur.aId)}</div>
          <div className="sm-fighter__c">{sideFighters(session, cur.aId)}</div>
        </button>
        <div className="sm-vsbadge">VS</div>
        <button className="sm-fighter" disabled={busy} onClick={() => onWin(cur.bId)}>
          <div className="sm-fighter__n">{sideLabel(session, cur.bId)}</div>
          <div className="sm-fighter__c">{sideFighters(session, cur.bId)}</div>
        </button>
      </div>
      <p className="sm-hint" style={{ marginTop: 10 }}>Tap the winner of each game. The set records when someone reaches {need}.</p>
      {cur.games.length === 0 && (
        <button className="sm-textbtn" style={{ marginTop: 4 }} onClick={() => { setPickA(""); setPickB(""); setShowPicker(true); }}>
          Change {session.teamPlay ? "sides" : "players"}
        </button>
      )}
    </div>
  );
}

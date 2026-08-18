import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type EventDetail } from "../api";
import BackButton from "../BackButton";
import { MAX_ENTRANTS, MAX_TEAM_MEMBERS, type Entrant, type SoloEntrant } from "@gamenight/shared";
import { TeamPicker, dropRosterIndex, teamPickerStatus } from "../teams/TeamPicker";
import "./tournament.css";

// THE TOURNAMENT SETUP SCREEN: who is actually in the bracket.
//
// WHAT THIS REPLACED. Starting a tournament used to be one tap on the event
// page: the client POSTed { format } and the server built the entrant list out
// of the yes RSVPs. So the bracket was locked to whoever had tracked their own
// attendance on their own phone, and there was no way at all to add the four
// people standing in the kitchen. Every session pack has offered the whole crew
// plus a guest box since the day it shipped; the tournament was the one path
// with NO ROSTER SCREEN AT ALL, which is why it is the one place the gap could
// survive this long.
//
// IT IS A ROUTE, NOT AN INLINE PANEL, and the address matches every pack:
// /tournament?event=<id>&format=<f>, the same shape as /smash?event=...&format=...
// The picker tile navigates here, this screen creates the bracket, and then it
// REPLACES itself with /b/:id.
//
// THE REDIRECT REPLACES, and that is load bearing rather than tidy. Pushing
// leaves this screen in history behind the bracket, so Back lands on a setup
// form for a bracket that already exists, whose start button then 409s. Firefox
// shows that ghost entry, Safari hides it, and the bug reads as "back goes
// nowhere" on one and "back is broken" on the other.
//
// THE SEEDING IS THE ORDER OF THIS LIST. First row is the top seed. The prefill
// is the yes RSVPs in the order they answered, which is the rule the server used
// before this screen existed and is worth keeping: it rewards the committed.
// Everything after that is the host's call, and the shuffle is there for the
// nights where seeding by who answered first is not the spirit of the thing.
//
// A CREW MEMBER TYPED INTO THE GUEST BOX IS A GUEST AND EARNS NOTHING. That is
// the silent failure this whole screen exists to remove, so the two paths are
// kept visibly apart: "Add from crew" carries a userId, the text box only ever
// makes { kind: "guest" }, and the server rejects a member id that is not in
// this crew rather than downgrading it.
//
// TEAMS ARE THE SAME ROSTER, ARRANGED. The doubles toggle does not build a
// second list: the roster stays the source of truth and TeamPicker puts ROSTER
// INDICES onto sides, which is why removing somebody has to go through
// dropRosterIndex. A version that forgot would leave the sides pointing at the
// wrong people, looking completely correct, with nothing to error about.
//
// THERE ARE TWO SHUFFLES AND THEY DO DIFFERENT THINGS. "Shuffle the seeding"
// reorders the DRAW: in solo mode the roster, in teams mode the sides, because
// the first side is the number 1 seed. TeamPicker's own shuffle deals PEOPLE
// onto sides and does not touch the draw order. They are separate buttons
// because they are separate questions.

/** One roster row. `userId` null is a guest, exactly as every pack roster. */
interface Slot {
  userId: string | null;
  name: string;
}

const GUEST_NAME_MAX = 24;

/** Fisher-Yates, so every ordering is equally likely. */
function shuffled<T>(list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export default function TournamentSetupPage() {
  // READ THE QUERY STRING INSIDE THE COMPONENT. At module scope this is
  // evaluated once per page load and then frozen, so the second event opened in
  // one session gets the first one's id. That exact mistake has been made in
  // this repo before and it is invisible until somebody starts two nights.
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get("event") ?? "";
  const format = params.get("format") === "double_elim" ? "double_elim" : "single_elim";

  const navigate = useNavigate();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [roster, setRoster] = useState<Slot[]>([]);
  const [guest, setGuest] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Solo is what a tournament has always been, so it stays the default and
  // costs a host who does not want doubles nothing.
  const [teams, setTeams] = useState(false);
  // Side membership by ROSTER INDEX. See the note at the top of TeamPicker.
  const [assign, setAssign] = useState<number[][]>([[], []]);

  // NOT THROUGH THE CLIENT CACHE, and for the reason usePackSession spells out
  // for the pack launch contexts: this payload carries the member list a roster
  // is built from, and a stale one silently offers a crew that has changed. A
  // setup screen is reached once a night and then left.
  useEffect(() => {
    if (!eventId) {
      setLoadErr("No game night was named in the link");
      return;
    }
    api<EventDetail>(`/api/events/${eventId}`)
      .then(setEvent)
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Couldn't load this game night"));
  }, [eventId]);

  // The whole crew, in one list: everyone who answered, plus everyone who never
  // did. Their union is the membership, which is what the server checks against.
  const crew = useMemo(() => {
    if (!event) return [];
    const seen = new Set<string>();
    const out: { userId: string; name: string }[] = [];
    for (const p of [...event.rsvps, ...event.noResponse]) {
      if (seen.has(p.userId)) continue;
      seen.add(p.userId);
      out.push({ userId: p.userId, name: p.displayName });
    }
    return out;
  }, [event]);

  // Prefill once, when the night lands: the yes RSVPs in answer order.
  useEffect(() => {
    if (!event) return;
    setRoster(
      event.rsvps
        .filter((r) => r.status === "yes")
        .map((r) => ({ userId: r.userId, name: r.displayName })),
    );
  }, [event]);

  if (loadErr) {
    return (
      <Frame eventId={eventId}>
        <p className="tr-err">{loadErr}</p>
      </Frame>
    );
  }
  if (!event) {
    return (
      <Frame eventId={eventId}>
        <p className="gn-hint" style={{ marginTop: 12 }}>Loading...</p>
      </Frame>
    );
  }

  // Already running. The create endpoint answers 409 for this, and a screen
  // that lets you fill in a roster before telling you so is a screen that
  // wastes the host's time at the worst possible moment.
  if (event.bracket) {
    return (
      <Frame eventId={eventId} title={event.title}>
        <div className="gn-card" style={{ marginTop: 16 }}>
          <div className="gn-h2">This night already has a tournament</div>
          <p className="gn-hint" style={{ marginTop: 6 }}>
            Only one bracket runs per night. Open the one that is already going.
          </p>
          <Link
            to={`/b/${event.bracket.id}`}
            className="gn-btn gn-btn--go tr-link"
            style={{ marginTop: 12 }}
          >
            Open the bracket
          </Link>
        </div>
      </Frame>
    );
  }

  const isHost = event.myRole === "owner" || event.myRole === "admin";
  if (!isHost) {
    return (
      <Frame eventId={eventId} title={event.title}>
        <div className="gn-card" style={{ marginTop: 16 }}>
          <div className="gn-h2">Waiting for the host</div>
          <p className="gn-hint" style={{ marginTop: 6 }}>
            The crew owner or an admin builds the bracket and starts it.
          </p>
        </div>
      </Frame>
    );
  }

  const full = roster.length >= MAX_ENTRANTS;
  const notAdded = crew.filter((m) => !roster.some((r) => r.userId === m.userId));
  // A CREW OF ONE IS THE QUICK PLAY NIGHT, and since 2026-08-18 it is this
  // screen's second most common use rather than an edge case: the Home tile
  // mints a personal crew holding only the host and opens this screen on it.
  // The copy below is the only thing that has to know, because everything
  // structural already works: "Add from crew" hides itself when there is nobody
  // left to add, and a guest is a guest in either kind of crew.
  const soloCrew = crew.length <= 1;

  const addMember = (m: { userId: string; name: string }) => {
    if (full || roster.some((r) => r.userId === m.userId)) return;
    setRoster([...roster, { userId: m.userId, name: m.name }]);
  };
  const addGuest = () => {
    const name = guest.trim().slice(0, GUEST_NAME_MAX);
    if (name && !full) setRoster([...roster, { userId: null, name }]);
    setGuest("");
  };
  const removeAt = (i: number) => {
    setRoster(roster.filter((_, j) => j !== i));
    // The indices above the removed player all shift down by one, so the sides
    // shift with them or they silently point at somebody else.
    setAssign((a) => dropRosterIndex(a, i));
  };

  // The picker owns the sides; the ceiling passed in is the BRACKET's, not the
  // team primitive's eight, because these sides are slots in a draw.
  const { unplaced, check } = teamPickerStatus(assign, roster.length, MAX_ENTRANTS);
  const oversized = assign.findIndex((side) => side.length > MAX_TEAM_MEMBERS);
  const teamsReady = !teams || (check.error === null && unplaced.length === 0 && oversized < 0);

  async function start() {
    if (busy || roster.length < 2 || !teamsReady) return;
    setBusy(true);
    setErr(null);
    // The member path carries the userId it was picked with. The guest path
    // never has one. Nothing here tries to match a typed name to a member.
    const personAt = (i: number): SoloEntrant => {
      const r = roster[i]!;
      return r.userId ? { kind: "member", userId: r.userId } : { kind: "guest", name: r.name };
    };
    const entrants: Entrant[] = teams
      ? // A SIDE OF ONE IS A SOLO ENTRANT, not a team of one. The server refuses
        // a one-member team, and rightly: a side id on a bracket with no team
        // structure in it is the thing the whole side rule exists to prevent.
        assign.map((side) =>
          side.length === 1
            ? personAt(side[0]!)
            : { kind: "team", members: side.map(personAt) },
        )
      : roster.map((_, i) => personAt(i));
    try {
      const b = await api<{ id: string }>(`/api/events/${eventId}/bracket`, {
        method: "POST",
        body: JSON.stringify({ format, entrants }),
      });
      // REPLACE, never push. See the note at the top of this file.
      navigate(`/b/${b.id}`, { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start the tournament");
      setBusy(false);
    }
  }

  return (
    <Frame eventId={eventId} title={event.title}>
      <p className="gn-hint" style={{ marginTop: 4 }}>
        {format === "double_elim" ? "Double elimination" : "Single elimination"}
        {format === "double_elim" ? " · one loss drops you to the losers bracket" : " · one loss and you are out"}
      </p>

      <div className="gn-card" style={{ marginTop: 16 }}>
        <div className="gn-h2">
          Who is playing ({roster.length}/{MAX_ENTRANTS})
        </div>
        <p className="gn-hint" style={{ marginTop: 4 }}>
          {teams
            ? soloCrew
              ? "Add whoever turned up as a guest, then put everybody on a side below."
              : "Anyone in the crew can play, RSVP or not. Put everybody on a side below."
            : soloCrew
              ? "Top of the list is the number 1 seed. Add whoever turned up as a guest below."
              : "Top of the list is the number 1 seed. Anyone in the crew can play, RSVP or not."}
        </p>

        {roster.map((r, i) => (
          <div className="tr-row" key={`${r.userId ?? "g"}-${i}`}>
            {/* In teams mode the DRAW is the sides, so a per-person seed number
                here would name a seed that does not exist. */}
            {!teams && <span className="tr-seed">{i + 1}</span>}
            <span className="tr-name">{r.name}</span>
            {!r.userId && <span className="tr-pill">guest</span>}
            <button className="gn-textbtn" onClick={() => removeAt(i)}>remove</button>
          </div>
        ))}
        {roster.length === 0 && (
          <p className="gn-hint" style={{ marginTop: 10 }}>
            {soloCrew
              ? "Nobody yet. Add yourself back below, or type in whoever turned up."
              : "Nobody yet. Add the crew below, or type in whoever turned up."}
          </p>
        )}

        {roster.length > 1 && !teams && (
          <button
            className="gn-btn gn-btn--ghost tr-shuffle"
            onClick={() => setRoster(shuffled(roster))}
          >
            🎲 Shuffle the seeding
          </button>
        )}

        {notAdded.length > 0 && !full && (
          <>
            <div className="gn-lab" style={{ marginTop: 14 }}>Add from crew</div>
            <div className="tr-seg">
              {notAdded.map((m) => (
                <button key={m.userId} onClick={() => addMember(m)}>+ {m.name}</button>
              ))}
            </div>
          </>
        )}

        {!full && (
          <>
            <div className="gn-lab" style={{ marginTop: 14 }}>Add a guest</div>
            <div className="tr-guest">
              <input
                className="gn-input"
                placeholder="Guest name"
                value={guest}
                maxLength={GUEST_NAME_MAX}
                onChange={(e) => setGuest(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addGuest()}
              />
              <button className="gn-btn gn-btn--ghost" onClick={addGuest}>Add</button>
            </div>
          </>
        )}
        <p className="gn-hint" style={{ marginTop: 10 }}>
          {soloCrew
            ? "Guests play, but lifetime stats only count you. Your own results are recorded either way."
            : "Guests play, but lifetime stats only count crew members. Add someone from the crew list above and their record follows them."}
        </p>
      </div>

      <div className="gn-card">
        {/* Its own class rather than .tr-row: a settings row is not an entrant,
            and sharing the class made every reader of the roster (including the
            screens harness) count the toggle as a player. */}
        <div className="tr-opt">
          <span className="tr-name">Doubles and teams</span>
          <button
            className={`gn-toggle ${teams ? "gn-toggle--on" : "gn-toggle--off"}`}
            aria-pressed={teams}
            onClick={() => setTeams(!teams)}
          >
            {teams ? "ON" : "OFF"}
          </button>
        </div>
        <p className="gn-hint">
          {teams
            ? "Each side takes ONE slot in the draw. Side A is the number 1 seed, and everybody on a side shares whatever that side finishes."
            : "Off means everybody plays for themselves, exactly as a tournament always has."}
        </p>
        {teams && roster.length === 2 && (
          // Two people into two sides is a 1v1 wearing the doubles shape. It is
          // allowed and it is almost never what somebody means, and the side
          // rule makes the difference invisible afterwards: two sides of one
          // write side null, exactly like a solo bracket.
          <p className="gn-hint" style={{ marginTop: 6 }}>
            With two players this is a 1v1 either way. Add more before splitting sides.
          </p>
        )}

        {teams && (
          <>
            <TeamPicker
              cx="tr"
              roster={roster}
              assign={assign}
              setAssign={setAssign}
              maxSides={MAX_ENTRANTS}
            />
            {oversized >= 0 && (
              <p className="tr-err">A side holds at most {MAX_TEAM_MEMBERS} players.</p>
            )}
            {assign.length > 1 && (
              <button
                className="gn-btn gn-btn--ghost tr-shuffle"
                onClick={() => setAssign(shuffled(assign))}
              >
                🎲 Shuffle the seeding
              </button>
            )}
            <p className="gn-hint" style={{ marginTop: 8 }}>
              Two different shuffles: the one above deals people onto sides, this one reorders the
              draw.
            </p>
          </>
        )}
      </div>

      {err && <p className="tr-err">{err}</p>}

      <button
        className="gn-btn gn-btn--go tr-start"
        disabled={busy || roster.length < 2 || !teamsReady}
        onClick={start}
      >
        {roster.length < 2
          ? "Add at least 2 players"
          : teams && unplaced.length > 0
            ? `${unplaced.length} still to put on a side`
            : teams && oversized >= 0
              ? `A side holds at most ${MAX_TEAM_MEMBERS} players`
              : teams && check.error
                ? check.error
                : `Start the tournament (${teams ? assign.length : roster.length})`}
      </button>
    </Frame>
  );
}

/**
 * The shell every state of this screen shares.
 *
 * BOTH WAYS OUT LIVE HERE, so no branch above can ship without them: the
 * history-based Back button, and a link to the NIGHT this bracket belongs to.
 * Back alone is not enough, because somebody who opened a shared link in a
 * fresh tab has no history to pop and lands on home.
 */
function Frame({
  eventId,
  title,
  children,
}: {
  eventId: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="gn-app tr-root">
      <div className="gn-wrap">
        <div className="tr-nav">
          <BackButton />
          {eventId && (
            <Link to={`/e/${eventId}`} className="gn-actionbtn">
              🎪 Event
            </Link>
          )}
        </div>
        <h1 className="gn-title text-2xl" style={{ marginTop: 6 }}>Tournament</h1>
        {/* A quick play night's event IS called "Tournament", so printing it
            under the heading reads as a stutter rather than as context. */}
        {title && title !== "Tournament" && <p className="gn-hint">{title}</p>}
        {children}
      </div>
    </main>
  );
}

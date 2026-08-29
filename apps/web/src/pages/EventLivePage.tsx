import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PACK_WS_TYPES, SESSION_PACKS } from "@gamenight/shared";
import { api, type EventRecap, type EventTv, type LifetimeStanding } from "../api";
import BackButton from "../BackButton";
import { useLiveRefetch } from "../useLiveUpdates";

// THE PAGE BEHIND EVERY TELEVISION'S QR.
//
// One address for the whole night, the same one on every pack's big screen, so
// a guest scans once and keeps the tab. It answers the question somebody in the
// room actually has: how is the night going, and who is winning.
//
// PUBLIC, AND THAT IS THE WHOLE POINT. It takes no `me`, it calls nothing under
// an authed route, and it must render completely for a phone that has never
// signed in and never will. A guest holding a beer is the one person in this
// app guaranteed not to have an account, and a sign-in wall behind a code on a
// television is the feature not shipping while looking like it did.
//
// IT READS EXACTLY ONE ENDPOINT, /api/tv/event/:id, the same public resolver
// the big screen reads, so the phone and the television can never quote
// different numbers for the same person. `?standings=1` asks that endpoint for
// the night so far even while a game is live, which is the state a code on a
// television is most often scanned in and the one the big screen itself never
// renders.
//
// A PHONE SCROLLS AND A TELEVISION DOES NOT, which is the one real difference
// between this and the between-games face. The big screen ALTERNATES tonight's
// standings with the crew's lifetime table on a timer because it has 1080px and
// nobody to touch it. Here both are simply on the page, one after the other.

const TYPES = [...PACK_WS_TYPES, "event_session_changed"];

export default function EventLivePage() {
  const { id } = useParams();
  const [tv, setTv] = useState<EventTv | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setTv(await api<EventTv>(`/api/tv/event/${id}?standings=1`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the night");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // The same subscription the television has, so a score recorded in any pack
  // updates the phone in the room at the same moment it updates the big screen.
  useLiveRefetch(TYPES, "eventId", id, load);

  if (error && !tv) {
    return (
      <main className="gn-app">
        <div className="gn-wrap space-y-4">
          <BackButton />
          <p style={{ color: "var(--gn-danger)" }}>{error}</p>
        </div>
      </main>
    );
  }
  if (!tv) {
    return (
      <main className="gn-app">
        <div className="gn-wrap space-y-4">
          <BackButton />
          <p className="gn-hint">Loading...</p>
        </div>
      </main>
    );
  }

  const { event, lobby } = tv;
  const recap = lobby.recap;
  const when = event.scheduledFor
    ? new Date(event.scheduledFor).toLocaleString([], {
        weekday: "long",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <main className="gn-app">
      <div className="gn-wrap space-y-4">
        <BackButton />

        <div>
          <h1 className="gn-title text-2xl">{event.title}</h1>
          <p className="gn-hint mt-1">
            {event.groupName}
            {when ? ` · ${when}` : ""}
          </p>
        </div>

        {tv.now && <NowPlaying now={tv.now} />}

        {recap ? (
          <Standings
            heading="Tonight"
            sub={`${recap.totalGames} ${recap.totalGames === 1 ? "game" : "games"} played`}
            rows={recap.players.map((p) => ({ ...p, userId: p.userId }))}
          />
        ) : (
          <WhosIn names={lobby.yes} />
        )}

        {recap && recap.sessions.length > 0 && <WhatWasPlayed recap={recap} />}

        {lobby.lifetime && (
          <Standings heading="All time" sub={event.groupName} rows={lobby.lifetime} />
        )}

        {/* THE WAY IN, and it is the only control on the page. A guest who
            likes what they see can join the crew from the same scan, which is
            the one thing this page can do that the television cannot. Blank
            invite code means the night is not open to joins, and then there is
            no button rather than a button that goes nowhere. */}
        {lobby.inviteCode && (
          <Link
            to={`/join/${lobby.inviteCode}?event=${event.id}`}
            className="gn-btn gn-btn--p1"
            style={{ display: "inline-flex", textDecoration: "none" }}
          >
            {/* A FIXED LABEL, NOT THE CREW'S NAME. .gn-btn sets white-space:
                nowrap, and a crew name is whatever somebody typed, so putting
                it in here makes the button as wide as the longest name anybody
                ever picks and runs it off the right edge of a phone. The crew
                is named two lines up, under the title. */}
            Join this crew
          </Link>
        )}
      </div>
    </main>
  );
}

/**
 * What is on the big screen right now.
 *
 * DELIBERATELY NOT A SCOREBOARD. Rendering the live game here would mean this
 * page reading twelve pack endpoints and carrying twelve pack stylesheets onto
 * a phone, and the live scoreboard is already six feet away on a television the
 * size of a door. What a phone adds is the thing the big screen cannot show
 * while a game is up: the night so far, below.
 */
function NowPlaying({ now }: { now: NonNullable<EventTv["now"]> }) {
  // The pack's name comes off the registry, so a pack added later names itself
  // here. A hand-typed table would fail by quietly calling a new pack "a game",
  // which is the same shape of miss PACK_TV was rewritten to stop making.
  const what =
    now.kind === "pack" ? SESSION_PACKS[now.pack].name
    : now.kind === "bracket" ? "A bracket"
    : "Beerio Kart";
  return (
    <div className="gn-card">
      <p className="gn-hint">On the big screen</p>
      <p className="gn-title text-xl mt-1">{what}</p>
    </div>
  );
}

/** One standings table, used for tonight and for the crew's whole history. */
function Standings({
  heading,
  sub,
  rows,
}: {
  heading: string;
  sub: string;
  rows: (LifetimeStanding | EventRecap["players"][number])[];
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="gn-title text-xl">{heading}</h2>
      <p className="gn-hint mt-1 mb-2">{sub}</p>
      <div className="gn-card" style={{ padding: 0, overflow: "hidden" }}>
        {rows.map((r, i) => (
          <div
            key={r.userId}
            className="flex items-baseline justify-between gap-3"
            style={{
              padding: "12px 16px",
              borderTop: i === 0 ? undefined : "2px solid var(--gn-line)",
            }}
          >
            <span className="flex items-baseline gap-2 min-w-0">
              <span
                className={`gn-rank ${i === 0 ? "gn-rank--top" : ""}`}
                style={{ fontSize: "16px", width: "22px", flexShrink: 0 }}
              >
                {i + 1}
              </span>
              <span
                className="font-bold truncate"
                style={i === 0 ? { color: "var(--gn-gold)" } : undefined}
              >
                {r.name}
              </span>
            </span>
            <span className="text-sm shrink-0 flex items-baseline gap-1">
              <span className="font-bold">{r.wins}</span>
              <span className="gn-hint">
                {r.wins === 1 ? "win" : "wins"} of {r.games}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Before anything has been played, the only thing there is to say. */
function WhosIn({ names }: { names: string[] }) {
  return (
    <section>
      <h2 className="gn-title text-xl">Who&rsquo;s in</h2>
      <p className="gn-hint mt-1 mb-2">
        {names.length} {names.length === 1 ? "person" : "people"} so far
      </p>
      <div className="gn-card">
        {names.length === 0 ? (
          <p className="gn-hint">Nobody has RSVP&rsquo;d yes yet.</p>
        ) : (
          <p className="font-bold" style={{ lineHeight: 1.6 }}>
            {names.join(" · ")}
          </p>
        )}
      </div>
    </section>
  );
}

/** What has actually been played, in the order the recap card tells it. */
function WhatWasPlayed({ recap }: { recap: EventRecap }) {
  return (
    <section>
      <h2 className="gn-title text-xl">What was played</h2>
      <div className="gn-card mt-2" style={{ padding: 0, overflow: "hidden" }}>
        {recap.sessions.map((s, i) => (
          <div
            key={`${s.pack}-${s.gameName}-${i}`}
            style={{
              padding: "12px 16px",
              borderTop: i === 0 ? undefined : "2px solid var(--gn-line)",
            }}
          >
            <p className="font-bold truncate">
              {s.gameName}
              {s.label ? ` · ${s.label}` : ""}
            </p>
            <p className="gn-hint mt-1" style={{ fontSize: "12px" }}>
              {s.matches} {s.matches === 1 ? "game" : "games"}
              {s.winnerName ? ` · ${s.winnerName} took ${s.winnerWins}` : ""}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

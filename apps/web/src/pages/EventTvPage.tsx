import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { PACK_WS_TYPES } from "@gamenight/shared";
import { api, type EventTv } from "../api";
import BackButton from "../BackButton";
import { useLiveRefetch } from "../useLiveUpdates";

// ONE TV BUTTON PER NIGHT.
//
// Point the TV at the night once, and it follows whatever is being played.
// Before this, every TV view was reached from inside the thing it shows, on an
// address naming a PACK rather than the night, so switching from Mario Kart to
// Smash two hours in meant somebody walking over to the TV and typing a new
// url. This route resolves what is live on the event and renders THAT pack's
// own TV view, in that pack's own design language (standing rule 3 is
// untouched: this is a router, not a generic TV mode).
//
// RENDER THE CHILD, NEVER NAVIGATE TO IT. Two reasons, both of which matter on
// a device nobody is holding: a TV must not accumulate history entries, and
// swapping the child in place is exactly what makes the pack switch happen
// with nobody touching the screen.
//
// The children are lazily loaded with the SAME import specifiers App.tsx
// uses, so Vite resolves them to the same chunks and this route does not drag
// every pack (Beerio especially, which brings lz-string) into one bundle.
// Only the pack actually being played is ever fetched.

const SmashTvPage = lazy(() => import("../smash/SmashTvPage"));
const MarioKartTvPage = lazy(() => import("../mariokart/MarioKartTvPage"));
const MarioPartyTvPage = lazy(() => import("../marioparty/MarioPartyTvPage"));
const PingPongTvPage = lazy(() => import("../pingpong/PingPongTvPage"));
const BlackjackTvPage = lazy(() => import("../blackjack/BlackjackTvPage"));
const RouletteTvPage = lazy(() => import("../roulette/RouletteTvPage"));
const CrapsTvPage = lazy(() => import("../craps/CrapsTvPage"));
const TvPage = lazy(() => import("./TvPage"));
const BeerioTvPage = lazy(() => import("../beerio/BeerioTvPage"));

/**
 * The resolver only needs to know when to RE-RESOLVE. The pack types come from
 * the registry, so a new pack is subscribed to by existing — the alternative,
 * a hand-typed list, fails by simply never re-resolving for the pack somebody
 * forgot, which looks exactly like a TV that ignores one game.
 */
const TYPES = [...PACK_WS_TYPES, "event_session_changed"];

export default function EventTvPage() {
  const { id } = useParams();
  // Deliberately NOT through cache.ts, which already excludes the TV routes: a
  // stale scoreboard on a big screen is worse than a spinner, and that goes
  // double for the thing deciding WHICH scoreboard.
  const [tv, setTv] = useState<EventTv | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setTv(await api<EventTv>(`/api/tv/event/${id}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Per-score updates are the child's job and it already does them; this
  // subscription exists only to re-resolve WHICH child should be on screen.
  // A refetch that returns the same answer re-renders the same element type
  // with the same props, so React keeps the mounted child exactly as it is.
  useLiveRefetch(TYPES, "eventId", id, load);

  if (error && !tv) {
    return (
      <Frame>
        <p className="text-3xl" style={{ color: "var(--gn-danger)" }}>{error}</p>
      </Frame>
    );
  }
  if (!tv) {
    return (
      <Frame>
        <p className="gn-hint text-3xl">Loading...</p>
      </Frame>
    );
  }

  const now = tv.now;
  if (!now) return <Lobby tv={tv} />;

  // Each child owns the whole screen from here, in its own design language.
  return (
    <Suspense fallback={<Frame><p className="gn-hint text-3xl">Loading...</p></Frame>}>
      {now.kind === "bracket" ? (
        <TvPage bracketId={now.bracketId} />
      ) : now.kind === "beerio" ? (
        <BeerioTvPage code={now.code} />
      ) : now.pack === "smash" ? (
        <SmashTvPage eventId={tv.event.id} />
      ) : now.pack === "mariokart" ? (
        <MarioKartTvPage eventId={tv.event.id} />
      ) : now.pack === "marioparty" ? (
        <MarioPartyTvPage eventId={tv.event.id} />
      ) : now.pack === "blackjack" ? (
        <BlackjackTvPage eventId={tv.event.id} />
      ) : now.pack === "roulette" ? (
        <RouletteTvPage eventId={tv.event.id} />
      ) : now.pack === "craps" ? (
        <CrapsTvPage eventId={tv.event.id} />
      ) : (
        <PingPongTvPage eventId={tv.event.id} />
      )}
    </Suspense>
  );
}

/**
 * Nothing is being played right now.
 *
 * This screen is the difference between the feature working and the feature
 * looking broken. `now: null` is not an error state, and it is on screen twice
 * over: for the evening's first twenty minutes, because the TV goes on before
 * the games do, and again BETWEEN every game after that.
 *
 * So it has two faces, split on whether anything has been played yet. Before:
 * the night, who is in, and how to join. After: the night so far — standings
 * with whoever is leading, and what was just won — because between games is
 * exactly when a room looks up at the screen to see where they stand, and an
 * empty "waiting for the host" is a wasted TV. Both flip to the game on their
 * own the moment a host starts one.
 */
function Lobby({ tv }: { tv: EventTv }) {
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
    : "Date TBD";
  const joinUrl = lobby.inviteCode
    ? `${window.location.origin}/join/${lobby.inviteCode}?event=${event.id}`
    : `${window.location.origin}/e/${event.id}`;

  return (
    <Frame align="stretch">
      <div className="flex flex-col" style={{ width: "100%", gap: "3vmin" }}>
        <header className="flex items-start justify-between gap-6 shrink-0">
          <div className="min-w-0">
            <BackButton className="!text-lg mb-2 block" />
            <h1 className="gn-tv-title text-6xl">{event.title}</h1>
            <p className="text-2xl mt-3" style={{ color: "var(--gn-dim)" }}>
              {event.groupName} &middot; {when}
              {recap && ` · ${recap.totalGames} ${recap.totalGames === 1 ? "game" : "games"} played`}
            </p>
          </div>
          <div className="text-center shrink-0">
            <div className="bg-white p-2 rounded-lg">
              <QRCodeSVG value={joinUrl} size={130} fgColor="#17111f" />
            </div>
            <p className="gn-hint text-sm mt-1">scan to join</p>
          </div>
        </header>

        {recap ? (
          <NightSoFar recap={recap} />
        ) : (
          <section className="flex flex-col min-h-0">
            <h2 className="gn-tv-h2">
              Who&rsquo;s in <span>{lobby.yes.length}</span>
            </h2>
            <div className="gn-tv-stack">
              {lobby.yes.length === 0 ? (
                <p className="gn-tv-empty">Nobody has RSVP&rsquo;d yes yet.</p>
              ) : (
                <div className="gn-tv-names">
                  {lobby.yes.map((name) => (
                    <span className="gn-tv-name" key={name}>
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        <p className="text-3xl shrink-0" style={{ color: "var(--gn-dim)" }}>
          {recap
            ? "Waiting on the host to start the next game. This screen follows the night on its own."
            : "Waiting on the host to start a game. This screen follows the night on its own."}
        </p>
      </div>
    </Frame>
  );
}

/**
 * The night so far: standings on the left, what was just won on the right.
 *
 * Two columns in the same shape TvPage uses for on-deck/latest, so this reads
 * as part of the Arcade TV language rather than a page that wandered in. The
 * standings are already sorted by the MVP rule (most wins, then best average
 * finish), so the top row IS who is leading the night and gets said so.
 */
function NightSoFar({ recap }: { recap: NonNullable<EventTv["lobby"]["recap"]> }) {
  // Newest first: between games, what just happened is the interesting part.
  const latest = recap.games.slice(-6).reverse();
  return (
    <div className="gn-tv-cols" style={{ marginTop: 0 }}>
      <section className="flex flex-col min-h-0">
        <h2 className="gn-tv-h2">
          Tonight so far <span>{recap.players.length} playing</span>
        </h2>
        <div className="gn-tv-stack">
          {recap.players.slice(0, 8).map((p, i) => (
            <div className={`gn-tvs ${i === 0 ? "gn-tvs--lead" : ""}`} key={p.userId}>
              <span className="gn-tvs__rank">{i + 1}</span>
              <span className="gn-tvs__nm">
                {i === 0 && <span aria-hidden="true">👑 </span>}
                {p.name}
              </span>
              <span className="gn-tvs__fig">
                <span className="gn-tvs__w">{p.wins}W</span>
                <span className="gn-tvs__sub">
                  {p.games} played
                  {p.avgPlacement != null && ` · avg ${p.avgPlacement.toFixed(1)}`}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col min-h-0">
        <h2 className="gn-tv-h2">
          Latest results <span>{recap.totalGames} played</span>
        </h2>
        <div className="gn-tv-stack">
          {latest.map((g, i) => (
            <div className="gn-tvr" key={`${g.gameName}-${i}`}>
              <span className="gn-tvr__game">
                {g.gameName}
                {g.label && <span className="gn-tvs__sub"> · {g.label}</span>}
              </span>
              <span className="gn-tvr__won">
                {g.winnerName ? `🏆 ${g.winnerName}` : "—"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Frame({
  children,
  align = "center",
}: {
  children: React.ReactNode;
  align?: "center" | "stretch";
}) {
  return (
    <main
      className={`gn-tv flex ${align === "center" ? "items-center justify-center" : "flex-col"}`}
      style={{
        padding:
          "calc(2.5rem + env(safe-area-inset-top, 0px)) calc(2.5rem + env(safe-area-inset-right, 0px)) calc(2.5rem + env(safe-area-inset-bottom, 0px)) calc(2.5rem + env(safe-area-inset-left, 0px))",
      }}
    >
      {children}
    </main>
  );
}

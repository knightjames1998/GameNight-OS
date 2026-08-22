import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { PACK_WS_TYPES, type SessionPackKey } from "@gamenight/shared";
import { api, type EventTv, type LifetimeStanding } from "../api";
import BackButton from "../BackButton";
import { useLiveRefetch } from "../useLiveUpdates";
import {
  ETV_PLAYER_SLICE,
  ETV_QR,
  ETV_RESULT_SLICE,
  eventTvBand,
  shown,
  type EventTvBand,
} from "./event-tv-band";

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
const PokerTvPage = lazy(() => import("../poker/PokerTvPage"));
const RouletteTvPage = lazy(() => import("../roulette/RouletteTvPage"));
const CrapsTvPage = lazy(() => import("../craps/CrapsTvPage"));
const CasinoRunTvPage = lazy(() => import("../casinorun/CasinoRunTvPage"));
const BoardGameTvPage = lazy(() => import("../boardgame/BoardGameTvPage"));
const CardTableTvPage = lazy(() => import("../cardtable/CardTableTvPage"));
const DeductionTvPage = lazy(() => import("../deduction/DeductionTvPage"));
const TvPage = lazy(() => import("./TvPage"));
const BeerioTvPage = lazy(() => import("../beerio/BeerioTvPage"));

/**
 * The resolver only needs to know when to RE-RESOLVE. The pack types come from
 * the registry, so a new pack is subscribed to by existing. The alternative,
 * a hand-typed list, fails by simply never re-resolving for the pack somebody
 * forgot, which looks exactly like a TV that ignores one game.
 */
const TYPES = [...PACK_WS_TYPES, "event_session_changed"];

/**
 * Which TV view each pack renders, as a TABLE RATHER THAN A CHAIN.
 *
 * It used to be an if/else chain ending in a bare `: <PingPongTvPage />`, so a
 * pack nobody added a branch for did not fail: it silently drew PING PONG's
 * scoreboard. That is the worst possible failure on a device nobody is holding:
 * the screen is confidently wrong rather than blank. Typed `Record<
 * SessionPackKey, ...>`, adding a pack to the registry without adding it here
 * is a COMPILE ERROR, which is the same trick prefetch.ts uses and for the same
 * reason. Caught 2026-07-30 when Casino Run shipped and the event TV quietly
 * rendered a ping pong board for it.
 *
 * NULL IS A REAL ANSWER: a pack with no TV view yet. It falls through to the
 * Lobby below, which is the honest screen for "there is nothing here to show"
 * and is exactly what a missing entry USED to do silently. Writing it out keeps
 * the Record exhaustive, so a pack is still a decision rather than an omission.
 */
const PACK_TV: Record<SessionPackKey, ((eventId: string) => JSX.Element) | null> = {
  smash: (id) => <SmashTvPage eventId={id} />,
  mariokart: (id) => <MarioKartTvPage eventId={id} />,
  marioparty: (id) => <MarioPartyTvPage eventId={id} />,
  pingpong: (id) => <PingPongTvPage eventId={id} />,
  blackjack: (id) => <BlackjackTvPage eventId={id} />,
  roulette: (id) => <RouletteTvPage eventId={id} />,
  craps: (id) => <CrapsTvPage eventId={id} />,
  casinorun: (id) => <CasinoRunTvPage eventId={id} />,
  boardgame: (id) => <BoardGameTvPage eventId={id} />,
  cardtable: (id) => <CardTableTvPage eventId={id} />,
  deduction: (id) => <DeductionTvPage eventId={id} />,
  poker: (id) => <PokerTvPage eventId={id} />,
};

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
      ) : (
        // A pack the table does not know is a NIGHT SCREEN, not another pack's
        // scoreboard. Unreachable while the Record above is exhaustive, which
        // is the point, but a server sending an unknown string must not paint
        // somebody else's numbers.
        PACK_TV[now.pack]?.(tv.event.id) ?? <Lobby tv={tv} />
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
 * the night, who is in, and how to join. After: the night so far, standings
 * with whoever is leading, and what was just won, because between games is
 * exactly when a room looks up at the screen to see where they stand, and an
 * empty "waiting for the host" is a wasted TV. Both flip to the game on their
 * own the moment a host starts one.
 */
function Lobby({ tv }: { tv: EventTv }) {
  const { event, lobby } = tv;
  const recap = lobby.recap;
  // THE DENSITY LADDER. Every metric on this screen comes off this one
  // attribute (see event-tv-band.ts and the [data-eband] blocks in index.css).
  // Before it, the between-games face was 152px past 1080p AND hid everybody
  // past the eighth player to get there.
  const lifetime = lobby.lifetime;
  const band = eventTvBand({
    // THE LARGER OF THE TWO COLUMNS, because the left one ALTERNATES between
    // tonight and lifetime and the screen has to fit whichever is up. A crew's
    // lifetime list is usually the longer one (everybody who has ever played,
    // against everybody playing tonight), so taking the band off tonight alone
    // would fit the screen and then overflow it twelve seconds later, which is
    // the worst possible way for this to fail: nobody is holding the device
    // when it happens.
    // ...but only when the between-games face is actually up. The LOBBY draws
    // chips and no standings at all, so counting a 24-person crew there would
    // tighten a screen that is rendering none of them.
    players: recap ? Math.max(recap.players.length, lifetime?.length ?? 0) : 0,
    results: recap?.games.length ?? 0,
    waiting: recap ? 0 : lobby.yes.length,
  });
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
    <Frame align="stretch" band={band}>
      <div className="flex flex-col" style={{ width: "100%", gap: "var(--gn-etv-gap)" }}>
        <header className="flex items-start justify-between gap-6 shrink-0">
          <div className="min-w-0">
            <BackButton className="!text-lg mb-2 block" />
            <h1 className="gn-tv-title gn-etv-title">{event.title}</h1>
            <p className="gn-etv-meta mt-3" style={{ color: "var(--gn-dim)" }}>
              {event.groupName} &middot; {when}
              {recap && ` · ${recap.totalGames} ${recap.totalGames === 1 ? "game" : "games"} played`}
            </p>
          </div>
          <div className="text-center shrink-0">
            <div className="bg-white p-2 rounded-lg">
              {/* Sized by the band: at base metrics the header is 169px and the
                  QR is 130 of it, which makes this the cheapest chrome lever on
                  the screen. It is a prop rather than a stylesheet value, so it
                  cannot ride the CSS variables the rest of the ladder spends. */}
              <QRCodeSVG value={joinUrl} size={ETV_QR[band]} fgColor="#17111f" />
            </div>
            <p className="gn-hint text-sm mt-1">scan to join</p>
          </div>
        </header>

        {recap ? (
          <NightSoFar recap={recap} lifetime={lifetime} band={band} />
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

        <p className="gn-etv-foot shrink-0">
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
/**
 * How long each face of the left column stays up.
 *
 * ONE PREDICTABLE BEHAVIOUR, NOT A ROTATION FRAMEWORK. A television has no
 * input device, so anything configurable here is a setting nobody will ever
 * open, and anything clever is a screen whose state nobody in the room can
 * predict. Twelve seconds is long enough to read eleven rows from a sofa and
 * short enough that somebody glancing up twice sees both faces.
 */
const ROTATE_MS = 12_000;

function NightSoFar({
  recap,
  lifetime,
  band,
}: {
  recap: NonNullable<EventTv["lobby"]["recap"]>;
  lifetime: LifetimeStanding[] | null;
  band: EventTvBand;
}) {
  // TONIGHT and LIFETIME alternate in the left column on a fixed timer.
  const [showLifetime, setShowLifetime] = useState(false);
  // THE DEPENDENCY IS A BOOLEAN, AND THAT IS THE WHOLE TRICK. useLiveRefetch
  // re-fetches this screen on every pack message, so `lifetime` is a NEW ARRAY
  // several times a minute on a busy night. Depending on it (or on `recap`, or
  // on anything else off the payload) would clear and recreate this interval
  // every time, and a 12s timer that restarts every 4s NEVER FIRES: the column
  // would sit on tonight forever and look like a feature that does not work,
  // with nothing erroring. `hasLifetime` only changes when a crew goes from
  // having no record to having one, which happens once.
  const hasLifetime = !!lifetime && lifetime.length > 0;
  useEffect(() => {
    if (!hasLifetime) return;
    const t = setInterval(() => setShowLifetime((v) => !v), ROTATE_MS);
    return () => clearInterval(t);
  }, [hasLifetime]);
  // A crew whose record vanishes mid-cycle (or that never had one) must not be
  // left on an empty lifetime face.
  const lifeUp = hasLifetime && showLifetime;
  const rows: { userId: string; name: string; games: number; wins: number; avgPlacement: number | null }[] =
    lifeUp ? lifetime! : recap.players;
  // THE SLICES ARE THE BAND'S NOW, and that is the fix rather than a tidy-up.
  // These were `slice(0, 8)` and `slice(-6)`, two hardcoded caps with nothing
  // behind them: a twelve-person night dropped four people off a television and
  // the screen said nothing, while STILL running 152px past 1080p with them
  // hidden. The band decides what fits, and whatever does not fit is COUNTED
  // and printed rather than discarded.
  // The standings list carries a "+N more" line, so its slice pays for one.
  const people = shown(rows.length, ETV_PLAYER_SLICE[band], true);
  // The results list does NOT, and that is a difference rather than an
  // oversight: its heading already reads "Latest results / N played", so
  // showing the most recent few of a stated total is the feature. A standings
  // list headed "12 playing" that draws eight rows is the bug.
  const games = shown(recap.games.length, ETV_RESULT_SLICE[band]);
  // Newest first: between games, what just happened is the interesting part.
  const latest = recap.games.slice(-games.take).reverse();
  return (
    <div className="gn-tv-cols" style={{ marginTop: 0 }}>
      <section className="flex flex-col min-h-0">
        <h2 className="gn-tv-h2">
          {lifeUp ? "All time" : "Tonight so far"}{" "}
          <span>{lifeUp ? `${lifetime!.length} in the crew` : `${recap.players.length} playing`}</span>
        </h2>
        <div className="gn-tv-stack">
          {rows.slice(0, people.take).map((p, i) => (
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
          {people.hidden > 0 && (
            <p className="gn-etv-more">+{people.hidden} more not shown</p>
          )}
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
                {g.winnerName ? `🏆 ${g.winnerName}` : "–"}
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
  band,
}: {
  children: React.ReactNode;
  align?: "center" | "stretch";
  /** Absent on the loading and error faces, which are one line and never tight. */
  band?: EventTvBand;
}) {
  return (
    <main
      className={`gn-tv flex ${align === "center" ? "items-center justify-center" : "flex-col"}`}
      data-eband={band}
      style={{
        padding:
          "calc(2.5rem + env(safe-area-inset-top, 0px)) calc(2.5rem + env(safe-area-inset-right, 0px)) calc(2.5rem + env(safe-area-inset-bottom, 0px)) calc(2.5rem + env(safe-area-inset-left, 0px))",
      }}
    >
      {children}
    </main>
  );
}

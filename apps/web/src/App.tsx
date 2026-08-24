import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import ConnectionPill from "./ConnectionPill";
import { api, ApiError, type Me } from "./api";
import { readCache, writeCache, dropAll } from "./cache";
import RouteBoundary, { RouteFallback } from "./RouteBoundary";

// Eager: the entry path. Someone arriving at the app lands on one of these,
// so splitting them would only add a round trip before anything renders.
import Home from "./pages/Home";
import GroupPage from "./pages/GroupPage";
import JoinPage from "./pages/JoinPage";
import EventPage from "./pages/EventPage";

// Lazy: everything you reach by choosing to go there. Before this, App
// statically imported all 24 routes, so opening the login page downloaded and
// parsed the entire Beerio Kart app (the biggest file in the repo, and it
// drags lz-string with it), all four pack pages, all five TV pages, the recap
// canvas renderer with qrcode.react, and all five pack stylesheets. The pack
// CSS rides along automatically: `import "./smash.css"` inside a lazily
// loaded SmashPage moves that CSS into the pack's own chunk.
const RecapPage = lazy(() => import("./pages/RecapPage"));
const EventTvPage = lazy(() => import("./pages/EventTvPage"));
const BracketPage = lazy(() => import("./pages/BracketPage"));
const TvPage = lazy(() => import("./pages/TvPage"));
// The tournament's setup step. A route rather than a panel on the event page,
// matching every pack (/smash?event=...&format=...), so the bracket is created
// from a screen that can show a roster instead of from a tile that cannot.
const TournamentSetupPage = lazy(() => import("./pages/TournamentSetupPage"));
const StatsPage = lazy(() => import("./pages/StatsPage"));
const LinkGuestPage = lazy(() => import("./pages/LinkGuestPage"));
const MyStatsPage = lazy(() => import("./pages/MyStatsPage"));
// Two routes out of one module, so they share a chunk. FriendPage is a named
// export, and lazy() wants a default, hence the re-map.
const MemberPage = lazy(() => import("./pages/MemberPage"));
const FriendPage = lazy(() =>
  import("./pages/MemberPage").then((m) => ({ default: m.FriendPage })),
);
const BeerioRoute = lazy(() => import("./beerio/BeerioRoute"));
const BeerioTvPage = lazy(() => import("./beerio/BeerioTvPage"));
const SmashPage = lazy(() => import("./smash/SmashPage"));
const SmashTvPage = lazy(() => import("./smash/SmashTvPage"));
const MarioKartPage = lazy(() => import("./mariokart/MarioKartPage"));
const MarioKartTvPage = lazy(() => import("./mariokart/MarioKartTvPage"));
const MarioPartyPage = lazy(() => import("./marioparty/MarioPartyPage"));
const MarioPartyTvPage = lazy(() => import("./marioparty/MarioPartyTvPage"));
const PingPongPage = lazy(() => import("./pingpong/PingPongPage"));
const PingPongTvPage = lazy(() => import("./pingpong/PingPongTvPage"));
const BlackjackPage = lazy(() => import("./blackjack/BlackjackPage"));
const BlackjackTvPage = lazy(() => import("./blackjack/BlackjackTvPage"));
const PokerPage = lazy(() => import("./poker/PokerPage"));
const PokerTvPage = lazy(() => import("./poker/PokerTvPage"));
const RoulettePage = lazy(() => import("./roulette/RoulettePage"));
const RouletteTvPage = lazy(() => import("./roulette/RouletteTvPage"));
const CrapsPage = lazy(() => import("./craps/CrapsPage"));
const CrapsTvPage = lazy(() => import("./craps/CrapsTvPage"));
const CasinoRunPage = lazy(() => import("./casinorun/CasinoRunPage"));
const CasinoRunTvPage = lazy(() => import("./casinorun/CasinoRunTvPage"));
const BoardGamePage = lazy(() => import("./boardgame/BoardGamePage"));
const BoardGameTvPage = lazy(() => import("./boardgame/BoardGameTvPage"));
const CardTablePage = lazy(() => import("./cardtable/CardTablePage"));
const CardTableTvPage = lazy(() => import("./cardtable/CardTableTvPage"));
const DeductionPage = lazy(() => import("./deduction/DeductionPage"));
const DeductionTvPage = lazy(() => import("./deduction/DeductionTvPage"));

function TournamentSearchKeyed() {
  // Same reason as the pack pages below: /tournament?event=A -> ?event=B is a
  // same-route navigation and will not remount on its own.
  const location = useLocation();
  return <TournamentSetupPage key={location.search} />;
}

/**
 * /quick: mint a quick play event, then REPLACE into the shared tournament
 * setup screen.
 *
 * WHAT THIS REPLACED. /quick used to be its own entrant screen (four typed name
 * boxes, a format select, a game name box) that POSTed a bracket directly. It
 * was a SECOND implementation of a thing the app already had, which is the only
 * reason quick play silently missed crew-member entrants, the member versus
 * guest distinction, seeding shuffle, team entrants and entrant validation when
 * those shipped on 2026-08-17. The page is deleted; this address is not,
 * because saved shortcuts and cached bundles both point at it.
 *
 * THE QUERY STRING IS READ INSIDE THE COMPONENT. At module scope it is
 * evaluated once per page load and then frozen, which is exactly the shape that
 * has pinned a stale event id in this app before.
 *
 * THE REDIRECT REPLACES. Pushing would leave /quick behind the setup screen in
 * history, so Back would land on a route whose whole job is to mint ANOTHER
 * event, and the crew would collect empty nights by pressing Back.
 */
function QuickStart() {
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const format =
      new URLSearchParams(window.location.search).get("format") === "double_elim"
        ? "double_elim"
        : "single_elim";
    let cancelled = false;
    api<{ eventId: string }>("/api/quickplay/tournament", {
      method: "POST",
      body: JSON.stringify({}),
    })
      .then(({ eventId }) => {
        if (!cancelled) navigate(`/tournament?event=${eventId}&format=${format}`, { replace: true });
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Couldn't start a quick play night");
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <main className="gn-app">
      <div className="gn-wrap">
        {err ? (
          <p style={{ color: "var(--gn-danger)", marginTop: 12 }}>{err}</p>
        ) : (
          <p className="gn-hint" style={{ marginTop: 12 }}>Starting a quick play tournament...</p>
        )}
      </div>
    </main>
  );
}

function SmashSearchKeyed() {
  // /smash?event=A -> /smash?event=B is a same-route navigation and won't
  // remount on its own; key by search so the page rebinds to the new event.
  const location = useLocation();
  return <SmashPage key={location.search} />;
}

function MarioKartSearchKeyed() {
  const location = useLocation();
  return <MarioKartPage key={location.search} />;
}

function MarioPartySearchKeyed() {
  const location = useLocation();
  return <MarioPartyPage key={location.search} />;
}

function PingPongSearchKeyed() {
  const location = useLocation();
  return <PingPongPage key={location.search} />;
}

function PokerSearchKeyed() {
  const location = useLocation();
  return <PokerPage key={location.search} />;
}

function BlackjackSearchKeyed() {
  const location = useLocation();
  return <BlackjackPage key={location.search} />;
}

function RouletteSearchKeyed() {
  const location = useLocation();
  return <RoulettePage key={location.search} />;
}

function CrapsSearchKeyed() {
  const location = useLocation();
  return <CrapsPage key={location.search} />;
}

function CasinoRunSearchKeyed() {
  const location = useLocation();
  return <CasinoRunPage key={location.search} />;
}

function BoardGameSearchKeyed() {
  const location = useLocation();
  return <BoardGamePage key={location.search} />;
}

function CardTableSearchKeyed() {
  const location = useLocation();
  return <CardTablePage key={location.search} />;
}

function DeductionSearchKeyed() {
  const location = useLocation();
  return <DeductionPage key={location.search} />;
}

/**
 * Who is signed in, hydrated from cache so the app never blocks on the answer.
 *
 * WHAT THIS REPLACED: App used to fire GET /api/auth/me and hold the ENTIRE
 * app behind `if (loading) return <RouteFallback />`, so every single launch
 * showed a full-screen "Loading..." before a single route could mount, even
 * though the answer is almost always the same as last time. On a sleeping
 * Render instance that gate lasted the whole cold start.
 *
 * Now the cached Me is read synchronously during the first render, the real UI
 * paints immediately, and the request goes out in the background to confirm.
 * If the answer changed, it is corrected in place; a 401 drops to logged out
 * and clears the cache.
 *
 * WHY A STALE CACHED IDENTITY IS SAFE, and please do not "fix" this back into
 * a blocking gate: this value decides what the UI DRAWS, never what the user
 * may DO. Every endpoint authenticates the session cookie itself, server-side,
 * on every request. So the worst a stale entry can produce is a briefly
 * wrong-looking screen that corrects itself a moment later, never access to
 * anything. Blocking the whole app on a network round trip to avoid a
 * half-second of possibly-stale name is a bad trade, and it was the single
 * biggest fixed cost in the launch path.
 *
 * THREE STATES, NOT TWO, and the third one earns its keep. `undefined` means
 * nobody has told us yet; `null` means we know you are signed out. Collapsing
 * them would make a cold cache render as signed-out, so every logged-in user
 * would get a flash of the login screen before it corrected itself, and they
 * would get it after EVERY DEPLOY, since a deploy sweeps the cache by design.
 * Flashing the login screen at someone who is signed in is worse than the
 * spinner this phase set out to remove. So: warm cache paints instantly (the
 * common case, and the whole point), and a genuinely unknown answer waits, the
 * same as it always did. Nothing got slower; the frequent case got faster.
 */
const ME_KEY = "auth:me";

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(() => readCache<Me>(ME_KEY));

  useEffect(() => {
    api<Me>("/api/auth/me")
      .then((fresh) => {
        writeCache(ME_KEY, fresh);
        setMe(fresh);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          // Genuinely logged out: the cached identity is wrong and everything
          // cached under it belongs to someone who is no longer here.
          dropAll();
          setMe(null);
          return;
        }
        // Anything else (offline, server down, cold start that timed out) is
        // NOT evidence the session ended, so the cached identity stands and
        // the app keeps working against whatever else is cached.
        console.error(e);
      });
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    // Clear everything, not just the identity: the next person to open this
    // device must not see the previous account's crews flash up first.
    dropAll();
    setMe(null);
  }

  function updateName(displayName: string) {
    if (!me) return;
    const next = { ...me, displayName };
    writeCache(ME_KEY, next);
    setMe(next);
  }

  // Only reached on a cold cache (first ever visit, or the first launch after
  // a deploy). A warm launch skips this entirely and paints the real UI.
  if (me === undefined) return <RouteFallback />;

  return (
    <BrowserRouter>
      {/* ONE MOUNT FOR NINETEEN SCREENS. It reads the module-scope live-status
          store rather than anything on this tree, so it is fixed-position and
          it does not matter which wrapper it sits in; it renders nothing at all
          unless a live screen has stopped hearing the hub. Outside the boundary
          and the Suspense fallback on purpose: a route that is still loading,
          or one that threw, is exactly when somebody wants to know whether the
          connection is the reason. */}
      <ConnectionPill />
      {/* Boundary outside Suspense so it catches a chunk that fails to
          arrive, not just a component that throws while rendering. */}
      <RouteBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route
              path="/"
              element={
                <Home me={me} onLogout={logout} onNameChange={updateName} />
              }
            />
            <Route
              path="/g/:id"
              element={
                <GroupPage me={me} onNameChange={updateName} />
              }
            />
            <Route path="/e/:id" element={<EventPage me={me} />} />
            <Route path="/e/:id/recap" element={<RecapPage me={me} />} />
            {/* The night's one TV address: public, read-only, and stable for
                the whole evening. It resolves what is being played and renders
                that pack's own TV view in place, so the screen follows the
                night. The five pack-specific TV routes below stay forever:
                deep links, bookmarks and any QR already in the wild. */}
            <Route path="/e/:id/tv" element={<EventTvPage />} />
            <Route path="/b/:id" element={<BracketPage />} />
            <Route path="/tv/:id" element={<TvPage />} />
            <Route path="/beerio" element={<BeerioRoute />} />
            {/* KEPT AS A ROUTE, and it is a redirect now. See QuickStart. */}
            <Route path="/quick" element={<QuickStart />} />
            <Route path="/tournament" element={<TournamentSearchKeyed />} />
            <Route path="/g/:id/stats" element={<StatsPage />} />
            <Route path="/g/:id/link-guest" element={<LinkGuestPage />} />
            <Route path="/me/stats" element={<MyStatsPage />} />
            <Route path="/g/:id/member/:userId" element={<MemberPage me={me} />} />
            <Route path="/friend/:userId" element={<FriendPage me={me} />} />
            <Route path="/beerio/tv/:code" element={<BeerioTvPage />} />
            <Route path="/smash" element={<SmashSearchKeyed />} />
            <Route path="/smash/tv/:eventId" element={<SmashTvPage />} />
            <Route path="/mariokart" element={<MarioKartSearchKeyed />} />
            <Route path="/mariokart/tv/:eventId" element={<MarioKartTvPage />} />
            <Route path="/marioparty" element={<MarioPartySearchKeyed />} />
            <Route path="/marioparty/tv/:eventId" element={<MarioPartyTvPage />} />
            <Route path="/pingpong" element={<PingPongSearchKeyed />} />
            <Route path="/pingpong/tv/:eventId" element={<PingPongTvPage />} />
            <Route path="/blackjack" element={<BlackjackSearchKeyed />} />
            <Route path="/blackjack/tv/:eventId" element={<BlackjackTvPage />} />
            <Route path="/poker" element={<PokerSearchKeyed />} />
            <Route path="/poker/tv/:eventId" element={<PokerTvPage />} />
            <Route path="/roulette" element={<RouletteSearchKeyed />} />
            <Route path="/roulette/tv/:eventId" element={<RouletteTvPage />} />
            <Route path="/craps" element={<CrapsSearchKeyed />} />
            <Route path="/craps/tv/:eventId" element={<CrapsTvPage />} />
            <Route path="/casinorun" element={<CasinoRunSearchKeyed />} />
            <Route path="/casinorun/tv/:eventId" element={<CasinoRunTvPage />} />
            <Route path="/boardgame" element={<BoardGameSearchKeyed />} />
            <Route path="/boardgame/tv/:eventId" element={<BoardGameTvPage />} />
            <Route path="/cardtable" element={<CardTableSearchKeyed />} />
            <Route path="/cardtable/tv/:eventId" element={<CardTableTvPage />} />
            <Route path="/deduction" element={<DeductionSearchKeyed />} />
            <Route path="/deduction/tv/:eventId" element={<DeductionTvPage />} />
            <Route path="/join/:code" element={<JoinPage me={me} />} />
          </Routes>
        </Suspense>
      </RouteBoundary>
    </BrowserRouter>
  );
}

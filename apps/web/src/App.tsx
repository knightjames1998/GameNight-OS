import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { api, ApiError, type Me } from "./api";
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
const BracketPage = lazy(() => import("./pages/BracketPage"));
const TvPage = lazy(() => import("./pages/TvPage"));
const QuickPlayPage = lazy(() => import("./pages/QuickPlayPage"));
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

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Me>("/api/auth/me")
      .then(setMe)
      .catch((e) => {
        // 401 just means logged out; anything else is a real problem
        // but the login screen is still the right place to land.
        if (!(e instanceof ApiError && e.status === 401)) console.error(e);
      })
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setMe(null);
  }

  if (loading) return <RouteFallback />;

  return (
    <BrowserRouter>
      {/* Boundary outside Suspense so it catches a chunk that fails to
          arrive, not just a component that throws while rendering. */}
      <RouteBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route
              path="/"
              element={
                <Home
                  me={me}
                  onLogout={logout}
                  onNameChange={(displayName) => me && setMe({ ...me, displayName })}
                />
              }
            />
            <Route
              path="/g/:id"
              element={
                <GroupPage
                  me={me}
                  onNameChange={(displayName) => me && setMe({ ...me, displayName })}
                />
              }
            />
            <Route path="/e/:id" element={<EventPage me={me} />} />
            <Route path="/e/:id/recap" element={<RecapPage me={me} />} />
            <Route path="/b/:id" element={<BracketPage />} />
            <Route path="/tv/:id" element={<TvPage />} />
            <Route path="/beerio" element={<BeerioRoute />} />
            <Route path="/quick" element={<QuickPlayPage />} />
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
            <Route path="/join/:code" element={<JoinPage me={me} />} />
          </Routes>
        </Suspense>
      </RouteBoundary>
    </BrowserRouter>
  );
}

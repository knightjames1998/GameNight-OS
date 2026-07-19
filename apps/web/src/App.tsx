import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, useNavigate, useLocation} from "react-router-dom";
import { api, ApiError, type Me } from "./api";
import Home from "./pages/Home";
import GroupPage from "./pages/GroupPage";
import JoinPage from "./pages/JoinPage";
import EventPage from "./pages/EventPage";
import BracketPage from "./pages/BracketPage";
import TvPage from "./pages/TvPage";
import BeerioApp, { setBeerioNavigator } from "./beerio/BeerioApp";
import QuickPlayPage from "./pages/QuickPlayPage";
import StatsPage from "./pages/StatsPage";
import MemberPage, { FriendPage } from "./pages/MemberPage";
import BeerioTvPage from "./beerio/BeerioTvPage";
import SmashPage from "./smash/SmashPage";
import SmashTvPage from "./smash/SmashTvPage";
import MarioKartPage from "./mariokart/MarioKartPage";
import MarioKartTvPage from "./mariokart/MarioKartTvPage";
import MarioPartyPage from "./marioparty/MarioPartyPage";
import MarioPartyTvPage from "./marioparty/MarioPartyTvPage";

function BeerioRoute() {
  // Hand the vendored app a router-aware navigate(), so its internal links
  // never do a full page load (which iOS standalone mode turns into a new
  // Safari tab).
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => setBeerioNavigator((to, replace) => navigate(to, { replace: !!replace })), [navigate]);
  return (
    <div className="beerio-root">
      <BeerioApp key={location.search} />
    </div>
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

  if (loading) {
    return (
      <main className="gn-app flex items-center justify-center" style={{ minHeight: "100dvh" }}>
        <p className="gn-hint">Loading...</p>
      </main>
    );
  }

  return (
    <BrowserRouter>
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
        <Route path="/b/:id" element={<BracketPage />} />
        <Route path="/tv/:id" element={<TvPage />} />
        <Route path="/beerio" element={<BeerioRoute />} />
        <Route path="/quick" element={<QuickPlayPage />} />
        <Route path="/g/:id/stats" element={<StatsPage />} />
        <Route path="/g/:id/member/:userId" element={<MemberPage me={me} />} />
        <Route path="/friend/:userId" element={<FriendPage me={me} />} />
        <Route path="/beerio/tv/:code" element={<BeerioTvPage />} />
        <Route path="/smash" element={<SmashSearchKeyed />} />
        <Route path="/smash/tv/:eventId" element={<SmashTvPage />} />
        <Route path="/mariokart" element={<MarioKartSearchKeyed />} />
        <Route path="/mariokart/tv/:eventId" element={<MarioKartTvPage />} />
        <Route path="/marioparty" element={<MarioPartySearchKeyed />} />
        <Route path="/marioparty/tv/:eventId" element={<MarioPartyTvPage />} />
        <Route path="/join/:code" element={<JoinPage me={me} />} />
      </Routes>
    </BrowserRouter>
  );
}

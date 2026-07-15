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
import BeerioTvPage from "./beerio/BeerioTvPage";

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
      <main className="min-h-dvh bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <p className="text-neutral-600">Loading...</p>
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
        <Route path="/e/:id" element={<EventPage />} />
        <Route path="/b/:id" element={<BracketPage />} />
        <Route path="/tv/:id" element={<TvPage />} />
        <Route path="/beerio" element={<BeerioRoute />} />
        <Route path="/quick" element={<QuickPlayPage />} />
        <Route path="/g/:id/stats" element={<StatsPage />} />
        <Route path="/beerio/tv/:code" element={<BeerioTvPage />} />
        <Route path="/join/:code" element={<JoinPage me={me} />} />
      </Routes>
    </BrowserRouter>
  );
}

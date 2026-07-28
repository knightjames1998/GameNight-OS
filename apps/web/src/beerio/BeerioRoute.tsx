import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import BeerioApp, { setBeerioNavigator } from "./BeerioApp";

// Lives in its own module so the whole Beerio pack can be lazily loaded as
// one chunk. App.tsx used to hold this component and import BeerioApp and
// setBeerioNavigator directly, which meant the vendored app (the biggest
// file in the repo, plus lz-string) shipped to every screen including the
// login page. Importing the named setBeerioNavigator from App would have
// pulled the module back into the entry chunk and undone the split, so the
// route component moved here instead.
//
// The vendored BeerioApp itself is untouched, per the 1:1 standing rule.

export default function BeerioRoute() {
  // Hand the vendored app a router-aware navigate(), so its internal links
  // never do a full page load (which iOS standalone mode turns into a new
  // Safari tab).
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(
    () => setBeerioNavigator((to, replace) => navigate(to, { replace: !!replace })),
    [navigate],
  );
  return (
    <div className="beerio-root">
      <BeerioApp key={location.search} />
    </div>
  );
}

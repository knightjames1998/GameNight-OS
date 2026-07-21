import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type EventRecap, type Me } from "../api";
import BackButton from "../BackButton";
import { ensureRecapFonts, drawNightRecapCard } from "../recap";
import { shareImage } from "../share";
import { useLiveUpdates } from "../useLiveUpdates";

// Event night recap: the whole night on one shareable card, aggregated
// across every pack. Reuses the canvas-to-JPG recap pipeline; share via the
// same Web Share path as the event Share control, download as the fallback.
export default function RecapPage({ me: _me }: { me: Me | null }) {
  const { id } = useParams();
  const [recap, setRecap] = useState<EventRecap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState("");
  const [toast, setToast] = useState("");
  const blobRef = useRef<Blob | null>(null);

  function load() {
    api<EventRecap>(`/api/events/${id}/recap`)
      .then(setRecap)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the recap"));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Live: a game recorded in any pack materializes and fires
  // leaderboard_updated for this event, so the card refreshes while open.
  useLiveUpdates(
    (m) => {
      if (m.type === "leaderboard_updated" && m.eventId === id) load();
    },
    () => load(),
  );

  // Redraw the card whenever the data changes.
  useEffect(() => {
    if (!recap || recap.totalGames === 0) return;
    let cancelled = false;
    ensureRecapFonts().then(() => {
      if (cancelled) return;
      const cv = drawNightRecapCard(recap);
      cv.toBlob(
        (b) => {
          if (!b || cancelled) return;
          blobRef.current = b;
          setImgUrl((old) => {
            if (old) URL.revokeObjectURL(old);
            return URL.createObjectURL(b);
          });
        },
        "image/jpeg",
        0.92,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [recap]);

  // Revoke the last object URL on unmount.
  useEffect(
    () => () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    },
    [imgUrl],
  );

  const fname = `gamenight-recap-${new Date().toISOString().slice(0, 10)}.jpg`;

  async function onShare() {
    const b = blobRef.current;
    if (!b) return;
    const r = await shareImage(b, fname, `${recap?.title ?? "Game night"} recap`);
    if (r === "unavailable") {
      setToast("Sharing not available here; use Download.");
      setTimeout(() => setToast(""), 2500);
    }
  }

  return (
    <main className="gn-app">
      <div className="gn-wrap space-y-4">
        <BackButton />

        {error && <p style={{ color: "var(--gn-danger)" }}>{error}</p>}

        {!error && !recap && <p className="gn-hint">Loading...</p>}

        {recap && (
          <>
            <div>
              <h1 className="gn-title text-2xl">Night recap</h1>
              <p className="gn-hint mt-1">
                {recap.title}
                {recap.groupName ? ` · ${recap.groupName}` : ""}
              </p>
            </div>

            {recap.totalGames === 0 ? (
              <div className="gn-card text-center space-y-2">
                <p className="gn-title text-xl">Nothing played yet</p>
                <p className="gn-hint">
                  Once a game wraps in any pack, the night recap card builds itself here.
                </p>
                <Link to={`/e/${id}`} className="gn-btn gn-btn--p1" style={{ display: "inline-flex", textDecoration: "none", marginTop: 4 }}>
                  Back to the event
                </Link>
              </div>
            ) : (
              <>
                {imgUrl ? (
                  <img
                    src={imgUrl}
                    alt="Night recap card"
                    className="w-full rounded-lg"
                    style={{ border: "2px solid var(--gn-line)" }}
                  />
                ) : (
                  <p className="gn-hint py-8 text-center">Building your card...</p>
                )}

                {toast && <p className="text-sm" style={{ color: "var(--gn-gold)" }}>{toast}</p>}

                <div className="flex gap-2">
                  <button onClick={onShare} disabled={!imgUrl} className="gn-btn gn-btn--p1 flex-1">
                    Share
                  </button>
                  <a
                    href={imgUrl || undefined}
                    download={fname}
                    className="gn-btn gn-btn--ghost flex-1 text-center"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}
                  >
                    Download
                  </a>
                </div>

                <Link
                  to={`/e/${id}`}
                  className="gn-textbtn"
                  style={{ display: "inline-block" }}
                >
                  &larr; Back to the event
                </Link>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

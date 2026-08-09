import { Link } from "react-router-dom";
import BackButton from "../BackButton";
import { usePackSession } from "../usePackSession";
import { SESSION_PACKS, BOARD_GAME_CONFIG } from "@gamenight/shared";
import { TitleNightLive, TitleNightSetup, type TnCtx, type TnSessionView } from "../titlenight/TitleNight";
import { BOARD_GAME_COPY } from "./copy";
import "./boardgame.css";

// The Board Game page: its shell, its header, its brand, and then the shared
// title-night screens. Everything below the header is in
// ../titlenight/TitleNight.tsx, which Card Table draws too.
//
// THE HEADER STAYS HERE rather than moving into the layer, and that is not an
// oversight. The "two ways out" standing rule is checked per screen by
// apps/server/tests/pack-screens.test.ts, and a header hidden behind a shared
// component would make that check pass for a pack that had lost its way back.
// The casino group made the same call for the same reason.

const PACK = SESSION_PACKS.boardgame;

export default function BoardGamePage() {
  const eventId = new URLSearchParams(window.location.search).get("event") ?? "";
  const { ctx, session, loading, busy, err, call, startSession } =
    usePackSession<TnSessionView, TnCtx>({
      pack: PACK.route,
      wsType: PACK.wsType,
      eventId,
      replacePrompt:
        "A session is already in progress on this event. Replace it? Every game recorded in the current session stays in your stats, but the session itself is ended.",
    });

  if (!eventId) {
    return <div className="tn-root bg-root"><div className="tn-wrap"><p className="tn-hint">No event specified.</p><BackButton /></div></div>;
  }
  if (loading) {
    return <div className="tn-root bg-root"><div className="tn-wrap"><p className="tn-hint">Loading...</p></div></div>;
  }

  return (
    <div className="tn-root bg-root">
      <div className="tn-wrap">
        <div className="tn-top">
          <BackButton className="tn-textbtn" />
          {/* A way back to the NIGHT this pack belongs to, which the
              history-based Back button cannot promise: somebody who opened a
              shared link in a fresh tab has no history to pop, so Back sends
              them home rather than to the event they were sent to. Standing
              rule: every pack screen has both. */}
          <Link to={`/e/${eventId}`} className="tn-textbtn">🎪 Event</Link>
          {/* The NIGHT's TV address, not this pack's. */}
          <Link to={`/e/${eventId}/tv`} className="tn-textbtn">📺 TV</Link>
        </div>
        <div>
          <div className="tn-brand">Board <em>Game</em></div>
          <div className="tn-sub">Pick the box, tap the finish order, done</div>
        </div>

        {err && <p className="tn-err">{err}</p>}

        {!session || session.status === "completed" ? (
          <TitleNightSetup
            ctx={ctx}
            config={BOARD_GAME_CONFIG}
            completed={session?.status === "completed"}
            busy={busy}
            onStart={(payload) => startSession(payload as Record<string, unknown>)}
          />
        ) : (
          <TitleNightLive
            route={PACK.route}
            eventId={eventId}
            ctx={ctx}
            config={BOARD_GAME_CONFIG}
            copy={BOARD_GAME_COPY}
            session={session}
            busy={busy}
            call={call}
          />
        )}
      </div>
    </div>
  );
}

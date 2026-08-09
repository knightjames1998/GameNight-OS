import { useParams } from "react-router-dom";
import { TitleNightTv } from "../titlenight/TitleNightTv";
import { BOARD_GAME_COPY } from "./copy";
import "./boardgame.css";

// Board Game's TV is the shared title-night TV plus a backdrop, which is the
// whole argument for extracting it: this file is the pack's identity and
// nothing else, rather than a second copy of a screen that would drift.
//
// Route param on /boardgame/tv/:eventId, or a prop when the event TV route
// renders this view in place. See SmashTvPage for the why.
export default function BoardGameTvPage({ eventId: propEventId }: { eventId?: string }) {
  const params = useParams();
  const eventId = propEventId ?? params.eventId ?? "";
  return (
    <TitleNightTv
      pack="boardgame"
      eventId={eventId}
      className="bg-tv"
      brand="Board Game Night"
      copy={BOARD_GAME_COPY}
      waitingHint="Waiting for the host to start the night."
    />
  );
}

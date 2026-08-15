import { useParams } from "react-router-dom";
import { SESSION_PACKS } from "@gamenight/shared";
import { TitleNightTv } from "../titlenight/TitleNightTv";
import { CARD_TABLE_COPY } from "./copy";
import "./cardtable.css";

// Card Table's TV is the shared title-night TV plus a backdrop, which is the
// whole return on the extraction: this file is the pack's identity and nothing
// else.
//
// Route param on /cardtable/tv/:eventId, or a prop when the event TV route
// renders this view in place. See SmashTvPage for the why.
export default function CardTableTvPage({ eventId: propEventId }: { eventId?: string }) {
  const params = useParams();
  const eventId = propEventId ?? params.eventId ?? "";
  return (
    <TitleNightTv
      pack="cardtable"
      eventId={eventId}
      className="ct-tv"
      brand={SESSION_PACKS.cardtable.name}
      copy={CARD_TABLE_COPY}
      waitingHint="Waiting for the host to start the night."
    />
  );
}

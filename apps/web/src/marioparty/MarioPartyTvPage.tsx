import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SESSION_PACKS, currentSides, hasTeamStructure, sideLabel, type SideLog } from "@gamenight/shared";
import { api } from "../api";
import BackButton from "../BackButton";
import { usePackLive } from "../useLiveUpdates";
import TvQr, { TV_QR_MIN } from "../TvQr";
import "./marioparty.css";

interface TvSession {
  status: string;
  games: { idx: number; map: string }[];
  roster?: { id: string; name: string }[];
  /** Backfilled server-side by normalizeMpState, so it is always present. */
  sideLog?: SideLog;
  summary: {
    players: {
      playerId: string;
      name: string;
      games: number;
      wins: number;
      /** SOLO stars only. A tag board's total belongs to the SIDE. */
      totalStars: number;
      tagStars: number;
      tagGames: number;
      mainCharacter: string | null;
    }[];
    boards: { map: string; games: number }[];
  };
}

/**
 * A player's star figure for the big screen, solo and tag kept apart.
 *
 * ADDING THEM WOULD BE WRONG, not merely imprecise: a tag board's total is the
 * SIDE's and is written to both members, so one number would show the pair
 * having scored it twice. On a tag-only night the solo half is zero and would
 * read as a crew who scored nothing, which is why the tag figure stands alone
 * when there is no solo half rather than trailing a "0★".
 */
function starText(p: { totalStars: number; tagStars: number; tagGames: number; games: number }): string {
  if (!p.tagGames) return `${p.totalStars}★`;
  if (p.tagGames === p.games) return `${p.tagStars}★ tag`;
  return `${p.totalStars}★ · ${p.tagStars}★ tag`;
}

// Route param on /marioparty/tv/:eventId, or a prop when the event TV route
// renders this view in place. See SmashTvPage for the why.
export default function MarioPartyTvPage({ eventId: propEventId }: { eventId?: string }) {
  const params = useParams();
  const eventId = propEventId ?? params.eventId ?? "";
  const [session, setSession] = useState<TvSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refetch() {
    const r = await api<{ session: TvSession | null }>(`/api/tv/marioparty/${eventId}`).catch(() => ({ session: null }));
    setSession(r.session);
  }
  useEffect(() => {
    refetch().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  usePackLive(SESSION_PACKS.marioparty.wsType, eventId, refetch);

  if (!loaded) return <div className="mp-tv"><div className="mp-tv__brand">Loading...</div></div>;

  if (!session) {
    return (
      <div className="mp-tv">
        {/* THE WAITING SCREEN IS THE ONE THAT IS UP WHILE PEOPLE ARRIVE,
            which makes it the likeliest thing in the house to be scanned. The
            phone page reads the NIGHT rather than this pack's session, so it
            has the RSVP list and the crew's record to show even though there
            is nothing on the table yet. */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="mp-tv__brand">Mario Party</div>
          <TvQr eventId={eventId} size={TV_QR_MIN} />
        </div>
        <p className="mp-tv__muted" style={{ fontSize: "3vmin", marginTop: "2vmin" }}>Waiting for the host to start the night.</p>
        <div style={{ marginTop: "3vmin" }}><BackButton className="mp-textbtn" /></div>
      </div>
    );
  }

  const leader = session.summary.players[0];
  const log = session.sideLog ?? [];
  const teamPlay = hasTeamStructure(log);
  const nameOf = (id: string) => session.roster?.find((p) => p.id === id)?.name;

  return (
    <div className="mp-tv">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="mp-tv__brand">Mario Party</div>
        <div className="mp-tv__muted" style={{ fontSize: "2.4vmin" }}>{session.games.length} boards</div>
        <TvQr eventId={eventId} size={TV_QR_MIN} />
      </div>

      {leader && leader.games > 0 && (
        <div style={{ marginTop: "2vmin" }}>
          <div className="mp-tv__muted" style={{ fontSize: "2.6vmin" }}>★ In the lead</div>
          <div className="mp-tv__lead">{leader.name} <span style={{ fontSize: "3.4vmin" }} className="mp-tv__muted">{leader.wins}W · {starText(leader)}</span></div>
        </div>
      )}

      <div className="mp-tv__grid">
        <div className="mp-tv__panel">
          <h3>Players</h3>
          {/* THE PAIRING IS ONE LINE PER SIDE, not a row per player. A row per
              player would say the same thing twice and cost this screen a line
              it does not have: the panel is already over 1080p at eight boards
              (BUGS). The players below still list individually, because that is
              where the wins and the characters are. */}
          {teamPlay && (
            <div className="mp-tv__line" style={{ fontSize: "2.2vmin" }}>
              <span className="mp-tv__muted">Tag Battle</span>
              <span className="mp-tv__muted">{currentSides(log).map((sd) => sideLabel(sd, nameOf)).join("  v  ")}</span>
            </div>
          )}
          {session.summary.players.length === 0 && <div className="mp-tv__muted">No boards yet</div>}
          {session.summary.players.map((p) => (
            <div className="mp-tv__line" key={p.playerId}>
              <span>{p.name} {p.mainCharacter ? <span className="mp-tv__muted" style={{ fontSize: "2.2vmin" }}>({p.mainCharacter})</span> : null}</span>
              <span>{p.wins}W · {starText(p)}</span>
            </div>
          ))}
        </div>
        <div className="mp-tv__panel">
          <h3>Boards</h3>
          {session.summary.boards.length === 0 && <div className="mp-tv__muted">No boards yet</div>}
          {session.summary.boards.map((b) => (
            <div className="mp-tv__line" key={b.map}>
              <span>{b.map}</span>
              <span>{b.games}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "3vmin" }}><BackButton className="mp-textbtn" /></div>
    </div>
  );
}

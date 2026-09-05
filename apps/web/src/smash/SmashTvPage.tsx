import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SESSION_PACKS } from "@gamenight/shared";
import { api } from "../api";
import BackButton from "../BackButton";
import { usePackLive } from "../useLiveUpdates";
import TvQr, { TV_QR_MIN } from "../TvQr";
import "./smash.css";

interface Slot { id: string; name: string; character: string | null }
interface TvSeriesStanding { slotId: string; name: string; seriesWins: number; seriesPlayed: number; gameWins: number; currentStreak: number }
interface TvSdStanding { playerId: string; name: string; wins: number; played: number; placement: number }
interface TvSdStatus {
  battleCount: number;
  battlesPlayed: number;
  battlesLeft: number;
  burned: string[];
  poolSize: number;
  fightersLeft: number;
  standings: TvSdStanding[];
  clinched: boolean;
  over: boolean;
  winnerIds: string[];
}
interface TvSession {
  status: string;
  format: "ffa" | "koth" | "bestof" | "smashdown";
  mode: "ffa" | "koth";
  roster: Slot[];
  /** The arrangement of sides in force. A solo night is sides of one. */
  sides: { id: string; name: string; memberIds: string[] }[];
  /** True when a side in force holds more than one player. */
  teamPlay: boolean;
  games: { idx: number }[];
  koth: { kingSideId: string | null; queue: string[]; streak: number } | null;
  bestOf: number;
  series: { aId: string; bId: string; games: { winnerId: string }[] } | null;
  seriesLog: { idx: number }[];
  seriesStandings: TvSeriesStanding[];
  smashdown: TvSdStatus | null;
  summary: {
    characters: { character: string; played: number; wins: number }[];
    players: { playerId: string; name: string; played: number; wins: number; mainCharacter: string | null }[];
  };
}

// eventId comes from the route param on /smash/tv/:eventId, or from a prop
// when the event TV route (/e/:id/tv) renders this view inside itself. Same
// component either way: the night's one TV address swaps packs in place, and
// it can only do that by rendering the pack's own view rather than navigating
// to it (a TV must not accumulate history entries).
export default function SmashTvPage({ eventId: propEventId }: { eventId?: string }) {
  const params = useParams();
  const eventId = propEventId ?? params.eventId ?? "";
  const [session, setSession] = useState<TvSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refetch() {
    const r = await api<{ session: TvSession | null }>(`/api/tv/smash/${eventId}`).catch(() => ({ session: null }));
    setSession(r.session);
  }
  useEffect(() => {
    refetch().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  usePackLive(SESSION_PACKS.smash.wsType, eventId, refetch);

  if (!loaded) return <div className="sm-tv"><div className="sm-tv__brand">Loading...</div></div>;

  if (!session) {
    return (
      <div className="sm-tv">
        {/* THE WAITING SCREEN IS THE ONE THAT IS UP WHILE PEOPLE ARRIVE,
            which makes it the likeliest thing in the house to be scanned. The
            phone page reads the NIGHT rather than this pack's session, so it
            has the RSVP list and the crew's record to show even though there
            is nothing on the table yet. */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="sm-tv__brand">Smash Night</div>
          <TvQr eventId={eventId} size={TV_QR_MIN} />
        </div>
        <p className="sm-tv__muted" style={{ fontSize: "3vmin", marginTop: "2vmin" }}>Waiting for the host to start the night.</p>
        <div style={{ marginTop: "3vmin" }}><BackButton className="sm-textbtn" /></div>
      </div>
    );
  }

  const nameOf = new Map(session.roster.map((p) => [p.id, p.name]));
  const charOf = new Map(session.roster.map((p) => [p.id, p.character]));
  // The throne and the queue hold SIDE ids, so a side is resolved to the names
  // and fighters of its members. A side of one reads as that one player, which
  // is what every solo night on this screen has always shown.
  const sideById = new Map(session.sides.map((s) => [s.id, s]));
  const sideNames = (sideId: string | null | undefined): string =>
    (sideById.get(sideId ?? "")?.memberIds ?? []).map((id) => nameOf.get(id) ?? "?").join(" + ");
  const sideChars = (sideId: string | null | undefined): string =>
    (sideById.get(sideId ?? "")?.memberIds ?? []).map((id) => charOf.get(id) ?? "?").join(" + ");
  const kingId = session.koth?.kingSideId ?? null;
  const bestOf = session.format === "bestof";
  const sd = session.format === "smashdown" ? session.smashdown : null;

  // Smashdown gets its own screen rather than a panel bolted onto the FFA one:
  // the burn board IS the format, so it takes the width, and the standings sit
  // beside the fighters that are still in play.
  if (sd) {
    const winners = sd.standings.filter((s) => sd.winnerIds.includes(s.playerId));
    return (
      <div className="sm-tv">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="sm-tv__brand">Smashdown</div>
          <div className="sm-tv__muted" style={{ fontSize: "2.4vmin" }}>
            {sd.over
              ? "Series over"
              : `Battle ${sd.battlesPlayed + 1} of ${sd.battleCount}`}
          </div>
          <TvQr eventId={eventId} size={TV_QR_MIN} />
        </div>

        {sd.over && winners.length > 0 && (
          <div style={{ marginTop: "1.6vmin" }}>
            <div className="sm-tv__muted" style={{ fontSize: "2.6vmin", textTransform: "uppercase", letterSpacing: "0.3vmin" }}>
              {winners.length > 1 ? "Co-winners" : "Winner"}
            </div>
            <div className="sm-tv__king">🏆 {winners.map((w) => w.name).join(" & ")}</div>
          </div>
        )}

        <div style={{ marginTop: "2.4vmin", display: "flex", alignItems: "baseline", gap: "2vmin" }}>
          <span className="sm-tv__count">{sd.fightersLeft}</span>
          <span className="sm-tv__muted" style={{ fontSize: "3vmin" }}>
            fighters left of {sd.poolSize}
            {!sd.over && ` · ${sd.battlesLeft} battle${sd.battlesLeft === 1 ? "" : "s"} to go`}
          </span>
        </div>

        <div className="sm-tv__grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="sm-tv__panel">
            <h3>Burned ({sd.burned.length})</h3>
            {sd.burned.length === 0 ? (
              <div className="sm-tv__muted">Nobody is out yet</div>
            ) : (
              <div className="sm-tv__burn">
                {sd.burned.map((f) => (
                  <span key={f}>{f}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="sm-tv__grid">
          <div className="sm-tv__panel">
            <h3>Standings</h3>
            {sd.battlesPlayed === 0 && <div className="sm-tv__muted">No battles yet</div>}
            {sd.battlesPlayed > 0 &&
              sd.standings.map((p) => (
                <div className="sm-tv__line" key={p.playerId}>
                  <span>
                    <span className="sm-tv__muted" style={{ marginRight: "1.4vmin" }}>{p.placement}</span>
                    {p.name}
                  </span>
                  <span>{p.wins}W · {p.played}</span>
                </div>
              ))}
          </div>
          <div className="sm-tv__panel">
            <h3>Fighters</h3>
            {session.roster.map((p) => (
              <div className="sm-tv__line" key={p.id}>
                <span>{p.name}</span>
                <span className="sm-tv__muted">{p.character ?? "picking…"}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: "3vmin" }}><BackButton className="sm-textbtn" /></div>
      </div>
    );
  }

  const cur = session.series;
  const setWins = cur
    ? cur.games.reduce((acc, g) => { if (g.winnerId === cur.aId) acc.a++; else if (g.winnerId === cur.bId) acc.b++; return acc; }, { a: 0, b: 0 })
    : { a: 0, b: 0 };

  return (
    <div className="sm-tv">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="sm-tv__brand">Smash Night</div>
        <div className="sm-tv__muted" style={{ fontSize: "2.4vmin" }}>
          {bestOf
            ? `Best of ${session.bestOf} · ${session.seriesLog.length} set${session.seriesLog.length === 1 ? "" : "s"}`
            : `${session.mode === "koth" ? "King of the Hill" : "Free-for-all"} · ${session.games.length} games`}
        </div>
        <TvQr eventId={eventId} size={TV_QR_MIN} />
      </div>

      {bestOf && cur && (
        <div style={{ marginTop: "2vmin" }}>
          <div className="sm-tv__muted" style={{ fontSize: "2.6vmin", textTransform: "uppercase", letterSpacing: "0.3vmin" }}>On stage</div>
          <div className="sm-tv__king" style={{ display: "flex", alignItems: "center", gap: "2vmin" }}>
            <span>{nameOf.get(cur.aId)}</span>
            <span className="sm-tv__muted">{setWins.a} - {setWins.b}</span>
            <span>{nameOf.get(cur.bId)}</span>
          </div>
        </div>
      )}

      {session.mode === "koth" && kingId && (
        <div style={{ marginTop: "2vmin" }}>
          <div className="sm-tv__muted" style={{ fontSize: "2.6vmin" }}>👑 Current king{session.koth && session.koth.streak > 0 ? ` · ${session.koth.streak} in a row` : ""}</div>
          <div className="sm-tv__king">{sideNames(kingId)} <span style={{ fontSize: "3.4vmin" }} className="sm-tv__muted">as {sideChars(kingId)}</span></div>
          {session.koth && session.koth.queue.length > 0 && (
            <div style={{ marginTop: "1.6vmin" }}>
              <span style={{ fontSize: "3.4vmin", fontFamily: "Fredoka, sans-serif", fontWeight: 700 }}>
                ⚔️ Up next: {sideNames(session.koth.queue[0])}
                {sideChars(session.koth.queue[0]) ? (
                  <span className="sm-tv__muted" style={{ fontSize: "2.6vmin" }}> as {sideChars(session.koth.queue[0])}</span>
                ) : null}
              </span>
              {session.koth.queue.length > 1 && (
                <div className="sm-tv__muted" style={{ fontSize: "2.4vmin", marginTop: "0.6vmin" }}>
                  Then: {session.koth.queue.slice(1).map((id) => sideNames(id)).filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {bestOf ? (
        <div className="sm-tv__grid">
          <div className="sm-tv__panel">
            <h3>Standings</h3>
            {session.seriesStandings.length === 0 && <div className="sm-tv__muted">No sets yet</div>}
            {session.seriesStandings.map((p) => (
              <div className="sm-tv__line" key={p.slotId}>
                <span>{p.name}{p.currentStreak >= 2 ? ` 🔥${p.currentStreak}` : ""}</span>
                <span>{p.seriesWins}W · {p.gameWins}g</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="sm-tv__grid">
          <div className="sm-tv__panel">
            <h3>{session.teamPlay ? "Sides" : "Players"}</h3>
            {/* THE PAIRING, one line per SIDE, above the per-player figures
                rather than instead of them. A side wins or loses as one, so the
                room needs to see who is on it; the wins underneath stay per
                player because that is what the ledger counts and what a
                lifetime stat is made of. On a solo night this renders nothing
                at all and the panel is the one it always was. */}
            {session.teamPlay &&
              session.sides.map((sd) => (
                <div className="sm-tv__line" key={sd.id}>
                  <span>{sideNames(sd.id)}</span>
                  <span className="sm-tv__muted">{sd.memberIds.length}</span>
                </div>
              ))}
            {session.summary.players.length === 0 && <div className="sm-tv__muted">No games yet</div>}
            {session.summary.players.map((p) => (
              <div className="sm-tv__line" key={p.playerId}>
                <span>{p.name} {p.mainCharacter ? <span className="sm-tv__muted" style={{ fontSize: "2.2vmin" }}>({p.mainCharacter})</span> : null}</span>
                <span>{p.wins}W · {p.played}</span>
              </div>
            ))}
          </div>
          <div className="sm-tv__panel">
            <h3>Fighters</h3>
            {session.summary.characters.length === 0 && <div className="sm-tv__muted">No games yet</div>}
            {session.summary.characters.slice(0, 8).map((c) => (
              <div className="sm-tv__line" key={c.character}>
                <span>{c.character}</span>
                <span>{c.wins}W · {c.played}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: "3vmin" }}><BackButton className="sm-textbtn" /></div>
    </div>
  );
}

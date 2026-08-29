import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import TvQr, { TV_QR_MIN } from "../TvQr";
import { SESSION_PACKS, type SdTvView } from "@gamenight/shared";
import { api } from "../api";
import BackButton from "../BackButton";
import { usePackLive } from "../useLiveUpdates";
import "./deduction.css";

// THE ALIVE/DEAD BOARD, and the one TV in this app with a secrecy constraint.
//
// ===========================================================================
// THIS ROUTE IS PUBLIC, UUID-KEYED AND UNAUTHENTICATED. Anybody with the event
// link can open it, including a player sitting at the table on their own phone
// while the game is running.
//
// So there is NO CLIENT-SIDE REDACTION HERE and there must never be. An
// unrevealed role is absent from the payload the server sends (see `sdTvView`
// in packages/shared/src/deduction.ts, which is a projection rather than a
// filter), so this file has nothing to hide: it renders what it is given.
// Anything that arrived and was hidden with CSS, or rendered face down with
// the value in the DOM, would be readable by anybody who opened the console,
// which on this route is everybody.
//
// Guarded by apps/server/tests/deduction-secrecy.test.ts, which runs three
// probes over the TV payload and is negative-controlled.
// ===========================================================================
//
// THE FIT RISK IS THE OTHER THING THIS FILE IS ABOUT. This pack seats TWENTY,
// the largest cap in the app, and the board shows every player at once. Board
// Game's TV shipped 176px over a 1080p screen at twelve players and nobody
// measured it for five days, so the column count steps with the roster below
// and scripts/tv-fit.mjs carries cases at the full twenty.

const PACK = SESSION_PACKS.deduction;

/**
 * How many columns the board gets.
 *
 * Stepped rather than `auto-fill`, because auto-fill picks a count from the
 * available width and this screen's constraint is HEIGHT: twenty players in
 * three columns is seven rows, which is what puts a TV over 1080p. Five columns
 * at twenty is four rows, and the tile is still wide enough for a name.
 */
function columnsFor(n: number): number {
  if (n <= 6) return 2;
  if (n <= 12) return 3;
  if (n <= 16) return 4;
  return 5;
}

/** One tile's worth of player, whether the board is on or not. */
type TvPerson = NonNullable<SdTvView["board"]>["players"][number];

/** What a tile says under the name. */
function stateLine(p: TvPerson): string {
  if (p.alive) return "in";
  const how = p.out === "voted" ? "voted out" : "killed";
  return p.outDay ? `${how} on ${p.outDay}` : how;
}

export default function DeductionTvPage({ eventId: fixed }: { eventId?: string }) {
  // Rendered both as its own route (/deduction/tv/:eventId) and inside the
  // event TV, which passes the id as a prop rather than through the URL.
  const params = useParams();
  const eventId = fixed ?? params.eventId ?? "";
  const [tv, setTv] = useState<SdTvView | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refetch() {
    const r = await api<{ session: SdTvView | null }>(`/api/tv/${PACK.route}/${eventId}`).catch(() => ({
      session: null,
    }));
    setTv(r.session);
  }
  useEffect(() => {
    refetch().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  // Deliberately NOT through cache.ts, which already excludes the TV routes: a
  // stale board on a big screen would show somebody alive who is out.
  usePackLive(PACK.wsType, eventId, refetch);

  if (!loaded) {
    return (
      <div className="sd-tv">
        <div className="sd-tv__brand">Loading...</div>
      </div>
    );
  }

  if (!tv) {
    return (
      <div className="sd-tv">
        <Brand />
        <p className="sd-tv__title sd-tv__title--idle">Waiting on the host to start the night.</p>
        <div className="sd-tv__foot">
          <span />
          <BackButton className="sd-tv__back" />
        </div>
      </div>
    );
  }

  const board = tv.board;
  // WITH THE BOARD OFF THE TV STILL HAS A NIGHT TO SHOW, because off is a real
  // mode rather than a degraded one: the roster, the title and the standings
  // all still reach the screen, and every tile simply reads "in".
  const people: TvPerson[] = board
    ? board.players
    : tv.roster.map((r) => ({ ...r, alive: true, out: null, outDay: null, revealed: null, alignment: null }));
  const cols = columnsFor(people.length);
  const lead = tv.summary.players.slice(0, 5);

  return (
    <div className="sd-tv">
      <div className="sd-tv__top">
        <Brand />
        {board ? (
          <div className="sd-tv__phase">
            {board.phase === "night" ? "Night" : "Day"} {board.day} &middot; {board.alive} of {people.length} in
          </div>
        ) : (
          <div className="sd-tv__phase sd-tv__muted">
            {tv.games} game{tv.games === 1 ? "" : "s"} tonight
          </div>
        )}
        {/* THE SLOT. Last child of the row this screen already had; the brand
            and the phase line keep their own markup, type and colours exactly.
            Deduction is the TIGHTEST screen in the app (32px of back-button
            clearance before this, against 57 for the money board and 63 for
            ping pong) and it has no density ladder to compress, so it is the
            worst case and therefore the one to prove the contract on. */}
        <TvQr eventId={eventId} size={SD_TV_QR} />
      </div>

      <div>
        {tv.title ? (
          <div className="sd-tv__title">{tv.title}</div>
        ) : (
          <div className="sd-tv__title sd-tv__title--idle">Between games</div>
        )}
        {tv.composition && (
          // THE SETUP IS PUBLIC AND IS SUPPOSED TO BE: every game in this genre
          // opens with the moderator saying it out loud. Counts only, and never
          // who has what.
          <div className="sd-tv__setup">
            {tv.composition.map((c) => `${c.count} ${c.name}`).join(" · ")}
          </div>
        )}
      </div>

      <div className="sd-tv__board" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {people.map((p) => (
          <div className={`sd-p ${p.alive ? "" : "sd-p--out"}`} key={p.playerId}>
            <span className="sd-p__name">{p.name}</span>
            <span className="sd-p__state">
              {/* The ONLY place a role appears on this screen, and it is only
                  ever a role somebody chose to reveal. */}
              {p.revealed ? (
                <span className={`sd-p__role sd-p__role--${p.alignment ?? "solo"}`}>{p.revealed}</span>
              ) : (
                stateLine(p)
              )}
              {p.revealed && !p.alive && ` · ${stateLine(p)}`}
            </span>
          </div>
        ))}
      </div>

      <div className="sd-tv__foot">
        <div className="sd-tv__standings">
          {lead.length === 0 ? (
            <span className="sd-tv__standing">No games recorded yet</span>
          ) : (
            lead.map((p) => (
              <span className="sd-tv__standing" key={p.playerId}>
                <b>{p.name}</b> {p.wins}W &middot; village {p.townWins}/{p.townGames} &middot; evil {p.evilWins}/
                {p.evilGames}
              </span>
            ))
          )}
        </div>
        <BackButton className="sd-tv__back" />
      </div>
    </div>
  );
}

/**
 * Deduction's QR size.
 *
 * A FLAT NUMBER BECAUSE THIS SCREEN HAS NO DENSITY LADDER: it lays out in
 * columns rather than a vertical stack, so it does not scale type by roster the
 * way the ladder packs do, and there is no band to read. TV_QR_MIN is the floor
 * every pack shares; this screen sits on it, because it is the one with the
 * least room to give.
 */
const SD_TV_QR = TV_QR_MIN;

function Brand() {
  return (
    <div className="sd-tv__brand">
      Social <em>Deduction</em>
    </div>
  );
}

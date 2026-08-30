import type { ReactNode } from "react";
import { money, type CashPlayerRow, type CashSummary } from "@gamenight/shared";
import BackButton from "../BackButton";
import TvQr, { TV_QR_MIN } from "../TvQr";
import { StakesBadge } from "./money";
import { ModifierWall } from "./modifiers";
import { moneyBoardBand } from "./band";
import "./casino.css";

// THE LIVE MONEY BOARD, shared by every casino pack's TV view.
//
// One line per player, sorted by net, big numbers, green for up and red for
// down, moving on every buy-in, rebuy and cash-out because the server
// broadcasts all three. It is the best thing this group puts on a TV, so it
// gets the room.
//
// WHY IT IS SHARED NOW AND WAS NOT BEFORE. Blackjack shipped this inline on
// 2026-07-29 with a note saying roulette would decide whether to extract it,
// because extracting on ONE example is guessing at what generalises. Building
// roulette answered it: the board is identical line for line, and the only
// differences are the brand, one header sentence and a per-player subline
// tail, which are the three props below. Colours come from --cg-* tokens
// each pack re-points on its TV root, so a pack customises without forking
// any of this.
//
// IT HAS TO FIT A TELEVISION, which is the one constraint this component
// carries that a phone screen never would: a TV cannot be scrolled, so
// anything past 1080px is gone rather than below. Every metric on the board
// was a fixed vmin, so its height grew with the roster while the screen did
// not, and from six players up the footer and the back button were off the
// bottom. The band computed below and spent in casino.css is the fix; band.ts
// explains what feeds it and why the seat count alone is not enough.

export function MoneyBoard<D>({
  summary,
  eventId,
  className,
  brand,
  meta,
  hero,
  heroLines,
  extraMeta,
  emptyHint,
}: {
  summary: CashSummary<D>;
  /**
   * The night this table belongs to, for the code in the header row.
   *
   * THE BOARD NEVER NEEDED TO KNOW THE NIGHT UNTIL NOW: it is handed a summary
   * and renders it, which is why four packs can share it. This is the one piece
   * of context it takes that is not about the money, and it is required rather
   * than optional so a pack cannot forget it and quietly ship a television with
   * no way onto a phone.
   */
  eventId: string;
  /** The pack's TV root class: sets the backdrop and the --cg-* tokens. */
  className: string;
  /** Brand lettering, e.g. <>Rou<em>lette</em></> */
  brand: ReactNode;
  /** Extra header text after the shared bank/seat counts. */
  meta?: ReactNode;
  /**
   * A pack's own headline, above the board. Craps puts the current shooter and
   * their live roll count here, which is the most watchable thing in that pack
   * and has no equivalent in blackjack or roulette. Omitted, the board simply
   * starts where it always did.
   */
  hero?: ReactNode;
  /**
   * What the hero costs in board lines, when it is not the flat two a fixed
   * panel costs. A pack whose hero GROWS with the table has to say so, or the
   * ladder sizes the board for a hero that is three lines shorter than the one
   * being painted. See BoardLoad.heroLines.
   */
  heroLines?: number;
  /** A per-player tail on the subline: "· 2 blackjacks", "· mostly red". */
  extraMeta?: (p: CashPlayerRow<D>) => string;
  emptyHint: string;
}) {
  // Everyone who HAS a net is ranked; those still holding chips sit under
  // them, because "in for $40" is not a position on a leaderboard.
  const ranked = summary.players.filter((p) => p.net !== null);
  const playing = summary.players.filter((p) => p.net === null);
  const m = money(summary.stakes);

  // HOW MUCH THIS SCREEN IS CARRYING, which is what the metrics scale on. It
  // rides on the ROOT rather than on the board, because the board is not the
  // only thing spending the 1080px: the hero, the warning and the wall are on
  // the same budget and all four have to give together at a full table. See
  // band.ts for the measured costs.
  const band = moneyBoardBand(summary.players.length, {
    hero: !!hero,
    heroLines,
    warning: !!summary.warning,
    rules: summary.modifiers.length > 0,
  });

  return (
    <div className={`cg-tv ${className}`} data-band={band}>
      <div className="cg-tv__head">
        <div className="cg-tv__brand">{brand}</div>
        <div className="cg-tv__muted" style={{ fontSize: "2.4vmin" }}>
          <StakesBadge stakes={summary.stakes} />
          {summary.stakes === "play" && " "}
          {/* THREE BANK TYPES SINCE POKER. A ternary read "casino banked" for
              anything that was not "player", which on a poker table is exactly
              backwards: nobody banks it, which is the whole point of the pack. */}
          {summary.bank === "player" ? "player banked" : summary.bank === "table" ? "no banker" : "casino banked"} ·{" "}
          {summary.players.length} at the table
          {summary.stillIn > 0 && ` · ${summary.stillIn} still in`}
          {meta}
        </div>
        <TvQr eventId={eventId} size={TV_QR_MIN} />
      </div>

      {summary.warning && <div className="cg-tv__warn">⚠️ {summary.warning}</div>}

      {/* ABOVE the hero and the board, and big. A rule you learn about after the
          hand is worthless, so the one screen everybody is already looking at is
          where it belongs, and it costs nothing on a night with no cards on,
          where this renders nothing at all. */}
      <ModifierWall
        ids={summary.modifiers}
        unit={summary.defaultBuyIn}
        stakes={summary.stakes}
        unitLabel="buy-in"
      />

      {hero}

      <div className="cg-tv__board" data-band={band}>
        {summary.players.length === 0 && (
          <div className="cg-tv__muted" style={{ fontSize: "3vmin" }}>{emptyHint}</div>
        )}

        {ranked.map((p, i) => (
          <div
            className={`cg-tv__line ${i === 0 && (p.net ?? 0) > 0 ? "cg-tv__line--lead" : ""}`}
            key={p.playerId}
          >
            <span className="cg-tv__rank">{p.placement ?? i + 1}</span>
            <span style={{ minWidth: 0 }}>
              <span className="cg-tv__nm">
                {p.name}
                {p.isBanker && " 🏦"}
              </span>
              <div className="cg-tv__meta">
                in {m.short(p.totalIn)}
                {p.rebuys > 0 && ` · ${p.rebuys} rebuy${p.rebuys === 1 ? "" : "s"}`}
                {p.cashedOut && p.cashOut !== null && ` · out ${m.short(p.cashOut)}`}
                {p.derived && " · the bank"}
                {extraMeta?.(p) ?? ""}
              </div>
            </span>
            <span
              className={`cg-tv__net ${
                (p.net ?? 0) > 0 ? "cg-tv__net--up" : (p.net ?? 0) < 0 ? "cg-tv__net--down" : "cg-tv__net--even"
              }`}
            >
              {m.signed(p.net ?? 0)}
            </span>
          </div>
        ))}

        {playing.map((p) => (
          <div className="cg-tv__line cg-tv__line--out" key={p.playerId}>
            <span className="cg-tv__rank">·</span>
            <span style={{ minWidth: 0 }}>
              <span className="cg-tv__nm">
                {p.name}
                {p.isBanker && " 🏦"}
              </span>
              <div className="cg-tv__meta">
                still playing
                {p.rebuys > 0 && ` · ${p.rebuys} rebuy${p.rebuys === 1 ? "" : "s"}`}
                {extraMeta?.(p) ?? ""}
              </div>
            </span>
            <span className="cg-tv__net cg-tv__net--in">in {m.short(p.totalIn)}</span>
          </div>
        ))}
      </div>

      <div className="cg-tv__foot">
        <div className="cg-tv__stat">
          <b>{m.fmt(summary.totalIn)}</b>
          <span>bought in</span>
        </div>
        <div className="cg-tv__stat">
          <b>{m.fmt(summary.totalOut)}</b>
          <span>cashed out</span>
        </div>
        <div className="cg-tv__stat">
          <b>{m.fmt(summary.onTable)}</b>
          <span>on the table</span>
        </div>
        <div className="cg-tv__stat">
          <b>
            {summary.cashedOut}/{summary.players.length}
          </b>
          <span>settled up</span>
        </div>
      </div>

      {/* A CLASS RATHER THAN AN INLINE STYLE, so its margin is on the ladder
          with everything else. This is the LAST element on the screen and the
          one the fit is measured against: standing rule 4 wants a way back on
          every screen, and a back button pushed past 1080 on a television is
          the same as not having one. */}
      <div className="cg-tv__back">
        <BackButton className="cg-textbtn" />
      </div>
    </div>
  );
}

/** The shared "nothing started yet" screen, so all four packs say it the same. */
export function MoneyBoardWaiting({
  className,
  brand,
  hint,
}: {
  className: string;
  brand: ReactNode;
  hint: string;
}) {
  return (
    <div className={`cg-tv ${className}`}>
      <div className="cg-tv__brand">{brand}</div>
      <p className="cg-tv__muted" style={{ fontSize: "3vmin", marginTop: "2vmin" }}>{hint}</p>
      <div style={{ marginTop: "3vmin" }}>
        <BackButton className="cg-textbtn" />
      </div>
    </div>
  );
}

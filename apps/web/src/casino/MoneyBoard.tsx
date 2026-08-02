import type { ReactNode } from "react";
import { money, type CashPlayerRow, type CashSummary } from "@gamenight/shared";
import BackButton from "../BackButton";
import { StakesBadge } from "./money";
import { ModifierWall } from "./modifiers";
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
// tail — which are the three props below. Colours come from --cg-* tokens
// each pack re-points on its TV root, so a pack customises without forking
// any of this.

export function MoneyBoard<D>({
  summary,
  className,
  brand,
  meta,
  hero,
  extraMeta,
  emptyHint,
}: {
  summary: CashSummary<D>;
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
  /** A per-player tail on the subline: "· 2 blackjacks", "· mostly red". */
  extraMeta?: (p: CashPlayerRow<D>) => string;
  emptyHint: string;
}) {
  // Everyone who HAS a net is ranked; those still holding chips sit under
  // them, because "in for $40" is not a position on a leaderboard.
  const ranked = summary.players.filter((p) => p.net !== null);
  const playing = summary.players.filter((p) => p.net === null);
  const m = money(summary.stakes);

  return (
    <div className={`cg-tv ${className}`}>
      <div className="cg-tv__head">
        <div className="cg-tv__brand">{brand}</div>
        <div className="cg-tv__muted" style={{ fontSize: "2.4vmin" }}>
          <StakesBadge stakes={summary.stakes} />
          {summary.stakes === "play" && " "}
          {summary.bank === "player" ? "player banked" : "casino banked"} ·{" "}
          {summary.players.length} at the table
          {summary.stillIn > 0 && ` · ${summary.stillIn} still in`}
          {meta}
        </div>
      </div>

      {summary.warning && <div className="cg-tv__warn">⚠️ {summary.warning}</div>}

      {/* ABOVE the hero and the board, and big. A rule you learn about after the
          hand is worthless, so the one screen everybody is already looking at is
          where it belongs — and it costs nothing on a night with no cards on,
          where this renders nothing at all. */}
      <ModifierWall
        ids={summary.modifiers}
        unit={summary.defaultBuyIn}
        stakes={summary.stakes}
        unitLabel="buy-in"
      />

      {hero}

      <div className="cg-tv__board">
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

      <div style={{ marginTop: "3vmin" }}>
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

import { useState } from "react";
import { Link } from "react-router-dom";
import BackButton from "../BackButton";
import { usePackSession } from "../usePackSession";
import CasinoSetup from "../casino/CasinoSetup";
import { CasinoTable, type CashOutDetail } from "../casino/CasinoTable";
import { StakesBadge } from "../casino/money";
import { Settlement } from "./Settlement";
import {
  POKER_VARIANTS,
  SESSION_PACKS,
  type CashPlayer,
  type CashTransfer,
  type PokerDetail,
  type PokerSessionState,
  type PokerSummary,
} from "@gamenight/shared";
import "./poker.css";

// The poker pack page.
//
// Almost all of it is the shared casino screens (../casino), because a cash
// game's SCREEN is about money and the money is identical across the group.
// What is written here is what is actually poker: the SETTLEMENT (see
// ./Settlement.tsx, and it is the reason the pack exists), the variant on the
// table, and the dealer's-choice rotation.
//
// THE SETTLEMENT COMES FIRST ON THE PAGE, above the money board. Every other
// cash pack leads with the standings because the standings are the point; here
// the point is whether the night adds up, and burying that under a leaderboard
// would be building the screen around the wrong question.

type Session = PokerSessionState & {
  status: "setup" | "live" | "completed";
  groupId: string;
  summary: PokerSummary;
  dealer: CashPlayer | null;
  variants: { variant: string; games: number }[];
  transfers: CashTransfer[] | null;
};

const PACK = SESSION_PACKS.poker;

/**
 * NOTHING TO TYPE ON THE CASH-OUT FORM, and that is the pack rather than an
 * omission. Blackjack collects three details because its tracker can be off and
 * the rule is that the tracker being off must lose nothing; poker records no
 * per-player detail at all, so the form is the cash-out amount and no more.
 */
const cashOutDetail: CashOutDetail<Record<string, never>, PokerDetail> = {
  initial: () => ({}),
  label: (p) => (p.events > 0 ? `Dealt ${p.events} of tonight's games` : "Just the final stack"),
  render: () => null,
};

export default function PokerPage() {
  const eventId = new URLSearchParams(window.location.search).get("event") ?? "";
  const { ctx, session, loading, busy, err, call, startSession } = usePackSession<Session>({
    pack: PACK.route,
    wsType: PACK.wsType,
    eventId,
    replacePrompt:
      "A session is already in progress on this event. Replace it? Every buy-in and cash-out on the current table is lost, and nothing from it is recorded.",
  });
  const [typed, setTyped] = useState("");

  if (!eventId) {
    return (
      <div className="cg-root pk-root">
        <div className="cg-wrap">
          <p className="cg-hint">No event specified.</p>
          <BackButton />
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="cg-root pk-root">
        <div className="cg-wrap">
          <p className="cg-hint">Loading...</p>
        </div>
      </div>
    );
  }

  const at = (p: string) => `/api/${PACK.route}/${eventId}/${p}`;
  // Same derivation the shared table uses: an owner/admin can always score, and
  // a member can when the host has opened it (standing rule 1).
  const canScore = !!session && session.status === "live" && ((ctx?.canHost ?? false) || session.openScoring);

  return (
    <div className="cg-root pk-root">
      <div className="cg-wrap">
        <div className="cg-top">
          <BackButton className="cg-textbtn" />
          {/* Both ways out, per the standing rule: the history-based Back button
              cannot help somebody who opened a shared link in a fresh tab. */}
          <Link to={`/e/${eventId}`} className="cg-textbtn">
            🎪 Event
          </Link>
          <Link to={`/e/${eventId}/tv`} className="cg-textbtn">
            📺 TV
          </Link>
        </div>
        <div>
          <div className="cg-brand">
            Po<em>ker</em>
          </div>
          <div className="cg-sub">
            Cash game &middot; buy-ins, rebuys, final stacks
            {session && session.status !== "completed" && (
              <>
                {" "}
                <StakesBadge stakes={session.summary.stakes} />
              </>
            )}
          </div>
        </div>

        {err && <p className="cg-err">{err}</p>}

        {!session || session.status === "completed" ? (
          <CasinoSetup
            ctx={ctx}
            completed={session?.status === "completed"}
            finished={session?.status === "completed" ? session.summary : null}
            busy={busy}
            ledger={PACK.ledger}
            onStart={startSession}
            copy={{
              noun: "the table",
              trackerHint:
                "Poker records buy-ins and final stacks, never individual hands. The table has no banker: everybody counts their own stack at the end and the app tells you whether the night adds up.",
              waitingHint:
                "The crew owner or an admin opens the table. This screen updates live the moment they do.",
            }}
          />
        ) : (
          <>
            {/* THE SETTLEMENT, ABOVE THE BOARD. See the note at the top. */}
            <Settlement
              balance={session.summary.balance}
              stillIn={session.summary.stillIn}
              warning={session.summary.warning}
              transfers={session.transfers}
              players={session.summary.players}
              stakes={session.summary.stakes}
            />

            {/* The variant on the table, and the deal. Standing rule 10's
                answer for this pack, on the title-night pattern rather than the
                Casino Run modifier deck: which game is being played is not a
                house rule laid on top of a game. */}
            <section className="pk-settle" aria-label="On the table">
              <div className="pk-settle__head">
                <span>On the table</span>
                <span className="pk-settle__state">{session.nowPlaying ?? "Nothing yet"}</span>
              </div>
              {canScore && (
                <>
                  <div className="pk-variant">
                    {POKER_VARIANTS.map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={session.nowPlaying === v ? "on" : ""}
                        disabled={busy}
                        onClick={() => call(at("variant"), { variant: v })}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <input
                      className="cg-input"
                      placeholder="Or type one"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      aria-label="Type a variant"
                    />
                    <button
                      type="button"
                      className="cg-btn cg-btn--ghost"
                      disabled={busy || !typed.trim()}
                      onClick={() => {
                        call(at("variant"), { variant: typed });
                        setTyped("");
                      }}
                    >
                      Set
                    </button>
                  </div>
                  <div className="pk-deal">
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={session.dealersChoice}
                        disabled={busy}
                        onChange={(e) => call(at("dealers-choice"), { on: e.target.checked })}
                      />
                      Dealer&apos;s choice
                    </label>
                    {session.dealer && (
                      <span>
                        Dealing: <span className="pk-deal__who">{session.dealer.name}</span>
                      </span>
                    )}
                    <button
                      type="button"
                      className="cg-btn cg-btn--go"
                      style={{ marginLeft: "auto" }}
                      disabled={busy || !session.nowPlaying}
                      onClick={() => call(at("game"), {})}
                    >
                      Played it
                    </button>
                    {session.games.length > 0 && (
                      <button
                        type="button"
                        className="cg-textbtn"
                        disabled={busy}
                        onClick={() => call(at("undo-game"), {})}
                      >
                        Undo
                      </button>
                    )}
                  </div>
                </>
              )}
              {session.variants.length > 0 && (
                <p className="pk-settle__note">
                  Tonight: {session.variants.map((v) => `${v.variant} x${v.games}`).join(", ")}
                </p>
              )}
            </section>

            <CasinoTable<Record<string, never>, PokerDetail>
              summary={session.summary}
              ctx={ctx}
              tracker={false}
              openScoring={session.openScoring}
              busy={busy}
              call={call}
              at={at}
              copy={{
                noun: "the table",
                events: "games",
              }}
              detail={cashOutDetail}
            />
          </>
        )}
      </div>
    </div>
  );
}

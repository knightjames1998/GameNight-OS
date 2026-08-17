import { money, type CashBalance, type CashPlayerRow, type CashTransfer, type CashStakes } from "@gamenight/shared";

// THE SETTLEMENT PANEL, and it is the reason this pack exists.
//
// The single most useful thing this app can do for a poker night is end the "we
// are forty dollars short" argument: say so, say by exactly how much, and say it
// while everyone is still in the room. So this is the screen element the page is
// built around, not the standings.
//
// IT COMPUTES NOTHING. `transfers` arrives on the session payload already
// derived by the server from settleTransfers, and it is null until the table
// balances. Deriving it here as well would mean a phone and a television could
// disagree about who owes whom, which is exactly the failure the determinism
// rule in settleTransfers exists to prevent; deriving it here INSTEAD would mean
// the TV, which never has a scorer, could not show it at all.

export function settlementState(balance: CashBalance, stillIn: number): {
  tone: "waiting" | "square" | "off";
  headline: string;
} {
  if (stillIn > 0) {
    return {
      tone: "waiting",
      headline: `${stillIn} still counting`,
    };
  }
  if (!balance.checked) return { tone: "waiting", headline: "Nobody has counted yet" };
  if (balance.balanced) return { tone: "square", headline: "The table squares" };
  return { tone: "off", headline: "The table does not balance" };
}

export function Settlement({
  balance,
  stillIn,
  warning,
  transfers,
  players,
  stakes,
}: {
  balance: CashBalance;
  stillIn: number;
  warning: string | null;
  transfers: CashTransfer[] | null;
  players: CashPlayerRow<unknown>[];
  stakes: CashStakes;
}) {
  const m = money(stakes);
  const { tone, headline } = settlementState(balance, stillIn);
  const nameOf = (id: string) => players.find((p) => p.playerId === id)?.name ?? "somebody";

  return (
    <section className="pk-settle" aria-label="Settlement">
      <div className="pk-settle__head">
        <span>Settlement</span>
        <span
          className={
            tone === "square"
              ? "pk-settle__state pk-settle__state--square"
              : tone === "off"
                ? "pk-settle__state pk-settle__state--off"
                : "pk-settle__state"
          }
        >
          {headline}
        </span>
      </div>

      {tone === "waiting" && (
        <p className="pk-settle__note">
          Everyone counts their stack, then this says whether the night adds up and who pays whom.
        </p>
      )}

      {tone === "off" && <p className="pk-settle__note">{warning}</p>}

      {/* THE LIST APPEARS EXACTLY WHEN THE TABLE BALANCES, which is the same
          moment `transfers` stops being null. A list built on a table that is
          off by forty dollars is not approximate, it is the app inventing a debt
          between two friends, so there is deliberately nothing to show. */}
      {transfers && transfers.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {transfers.map((t, i) => (
            <div className="pk-pay" key={`${t.fromId}-${t.toId}-${i}`}>
              <span>{nameOf(t.fromId)}</span>
              <span className="pk-pay__arrow" aria-label="pays">
                &rarr;
              </span>
              <span>{nameOf(t.toId)}</span>
              <span className="pk-pay__amt">{m.fmt(t.cents)}</span>
            </div>
          ))}
        </div>
      )}

      {transfers && transfers.length === 0 && (
        <p className="pk-settle__note">Everybody finished level. Nobody owes anybody.</p>
      )}
    </section>
  );
}

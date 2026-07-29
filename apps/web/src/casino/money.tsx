import { useState, type ReactNode } from "react";
import { formatCentsShort, formatCentsSigned, parseCents } from "@gamenight/shared";

// The money primitives every casino pack uses.
//
// THE INVARIANT THESE EXIST TO HOLD: dollars appear at exactly two edges of
// this app and nowhere else. MoneyInput is the way in — typed text becomes
// integer cents through the shared parseCents the moment it changes, and the
// component hands the caller cents or null, never a decimal. NetToken and the
// format* helpers are the way out. Everything between them, in every casino
// pack, in the session jsonb and in the ledger, is an integer number of cents.
// See packages/shared/src/cashgame.ts for why that matters more than it looks.

export function MoneyInput({
  value,
  onChange,
  placeholder = "0.00",
  small,
  ariaLabel,
  className,
}: {
  /** cents, or null for empty */
  value: number | null;
  onChange: (cents: number | null) => void;
  placeholder?: string;
  small?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  // A local text draft, so a half-typed "1." is not thrown away by a parse
  // that cannot make sense of it yet. Seeded once; remount (a changed React
  // key) is how a caller re-seeds it, which is what the setup screen's
  // "follow the table default until you touch it" behaviour relies on.
  const [draft, setDraft] = useState(value === null ? "" : (value / 100).toFixed(2));
  return (
    <input
      className={`cg-input ${small ? "cg-input--sm" : ""} ${className ?? ""}`}
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => {
        const next = e.target.value.replace(/[^0-9.]/g, "").slice(0, 12);
        setDraft(next);
        onChange(parseCents(next));
      }}
    />
  );
}

/** A whole-number input for a count (blackjacks hit, points made). */
export function CountInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  return (
    <input
      className="cg-input cg-input--sm"
      inputMode="numeric"
      pattern="[0-9]*"
      aria-label={ariaLabel}
      placeholder="0"
      value={draft}
      onChange={(e) => {
        const next = e.target.value.replace(/\D/g, "").slice(0, 3);
        setDraft(next);
        onChange(next === "" ? null : Number(next));
      }}
    />
  );
}

/**
 * One player's position, as a token. Green up, red down, hollow while they are
 * still holding chips — because "in for $40" is an honest answer and a net of
 * minus forty is not, until they cash out.
 */
export function NetToken({ net, totalIn }: { net: number | null; totalIn: number }): ReactNode {
  if (net === null) {
    return <span className="cg-tok cg-tok--in">in {formatCentsShort(totalIn)}</span>;
  }
  const cls = net > 0 ? "cg-tok--up" : net < 0 ? "cg-tok--down" : "cg-tok--even";
  return <span className={`cg-tok ${cls}`}>{formatCentsSigned(net)}</span>;
}

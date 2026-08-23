import { useEffect, useState, type ReactNode } from "react";
import {
  money,
  type CashBank,
  type CashStakes,
  type CashSummary,
} from "@gamenight/shared";
import type { PackCtx } from "../usePackSession";
import RosterCarryOver from "../RosterCarryOver";
import GuestChips from "../GuestChips";
import { MoneyInput, NetToken } from "./money";
import { ModifierPicker } from "./modifiers";
import "./casino.css";

// The setup screen every casino pack opens a table with.
//
// Blackjack, roulette, craps and poker ask the SAME questions (who is
// banking, what is the buy-in, who is at the table, is the tracker on), so
// this is one screen with per-pack copy rather than four screens that drift.
// Anything genuinely pack-specific goes in `extra`.

export interface CasinoSetupCopy {
  /** "the table" / "the wheel". Used in a couple of sentences. */
  noun: string;
  /** What the tracker records, in the host's words. */
  trackerHint: string;
  /** Shown to a member who cannot host. */
  waitingHint: string;
}

/** A seat being built on the setup screen, before the session exists. */
interface Seat {
  userId: string | null;
  name: string;
  /**
   * This seat's own opening buy-in, in cents, or null to FOLLOW the table
   * default. Null rather than a copy of the default on purpose: a host who
   * sets the table to $20, adds four people and then changes the table to $40
   * expects all four to move, and only the seats they deliberately overrode
   * to stay put.
   */
  buyIn: number | null;
}

export default function CasinoSetup({
  ctx,
  completed,
  finished,
  busy,
  ledger,
  copy,
  fixedBank,
  extra,
  onStart,
}: {
  ctx: PackCtx | null;
  completed: boolean;
  finished: CashSummary<unknown> | null;
  busy: boolean;
  /**
   * The pack's LEDGER key, which is what filters the modifier deck. The ledger
   * rather than the route segment because it is what gets written beside the
   * ids, so the two can never disagree about which cards a pack owns.
   */
  ledger: string;
  copy: CasinoSetupCopy;
  /**
   * A bank this pack does not let the host choose. Poker pins "table" on the
   * server (`fixedBank` in poker.ts) and IGNORES `bank` on the request, so
   * without this the screen renders a "Who is banking?" control whose answer
   * is thrown away, which is worse than not offering it.
   */
  fixedBank?: CashBank;
  /** A pack's own setup card, rendered above the start button. */
  extra?: ReactNode;
  onStart: (payload: Record<string, unknown>) => void;
}) {
  // A CASINO IS THE DEFAULT. Most nights on this app are played against a real
  // house, and the alternative default is the one that costs something when it
  // is wrong: a player-banked table DERIVES one person's net from everyone
  // else's, so a host who never touched this control would have had somebody's
  // money worked out for them rather than counted. Defaulting to the answer
  // that derives nobody is the safer of the two.
  const [bank, setBank] = useState<CashBank>("casino");
  // Real money by default. A host who means play money says so; the reverse
  // default would let a real night be recorded as pretend, which is the more
  // damaging mistake of the two.
  const [stakes, setStakes] = useState<CashStakes>("real");
  const [bankerIndex, setBankerIndex] = useState(0);
  const [defaultBuyIn, setDefaultBuyIn] = useState<number | null>(2000);
  const [tracker, setTracker] = useState(false);
  // Ids, never the cards: the deck's names and rule text are display data that
  // should stay free to improve, and only the ids are on the never-change list.
  const [modifiers, setModifiers] = useState<string[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [guest, setGuest] = useState("");

  useEffect(() => {
    if (ctx && seats.length === 0) {
      setSeats(ctx.prefill.map((p) => ({ userId: p.userId, name: p.name, buyIn: null })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  if (!ctx) return <p className="cg-hint" style={{ marginTop: 16 }}>Loading...</p>;

  if (!ctx.canHost) {
    return (
      <div className="cg-card" style={{ marginTop: 16 }}>
        <div className="cg-h">Waiting for the host</div>
        <p className="cg-hint">{copy.waitingHint}</p>
      </div>
    );
  }

  const addMember = (m: { userId: string; name: string }) => {
    if (!seats.some((r) => r.userId === m.userId)) {
      setSeats([...seats, { userId: m.userId, name: m.name, buyIn: null }]);
    }
  };
  const addGuestNamed = (raw: string) => {
    const n = raw.trim().slice(0, 24);
    if (n) setSeats([...seats, { userId: null, name: n, buyIn: null }]);
  };
  const addGuest = () => {
    addGuestNamed(guest);
    setGuest("");
  };
  const removeAt = (i: number) => {
    setSeats(seats.filter((_, j) => j !== i));
    // The banker is an INDEX, so removing a seat above them would silently
    // move the bank to somebody else. Shift it, and fall back to the first
    // seat if the banker themselves was the one removed.
    setBankerIndex((b) => (i === b ? 0 : i < b ? b - 1 : b));
  };
  const setBuyIn = (i: number, cents: number | null) =>
    setSeats(seats.map((s, j) => (j === i ? { ...s, buyIn: cents } : s)));

  const notAdded = ctx.members.filter((m) => !seats.some((r) => r.userId === m.userId));
  // What the table is ACTUALLY banked by: a pinned bank wins over the picker,
  // because on those packs the server ignores the picker anyway.
  const effBank: CashBank = fixedBank ?? bank;
  // ONLY A CASINO-BANKED TABLE CAN HAVE ONE SEAT, and that is the real rule
  // rather than "not player-banked": one person against a real house is a
  // legitimate session, a player-banked table needs a banker plus somebody to
  // bank against, and a table-banked one needs two people to have a game at
  // all. Written as "casino" rather than "not player" because poker pins
  // "table" and would otherwise have been openable with a single seat.
  const minPlayers = effBank === "casino" ? 1 : 2;
  const m = money(stakes);
  const fallback = defaultBuyIn ?? 0;
  const amountOf = (s: Seat) => s.buyIn ?? fallback;
  const onTable = seats.reduce((a, s) => a + amountOf(s), 0);
  const ready = seats.length >= minPlayers && defaultBuyIn !== null;

  return (
    <>
      {completed && finished && <FinishedRecap summary={finished} noun={copy.noun} />}

      <div className="cg-card" style={{ marginTop: 16 }}>
        <div className="cg-h">What are the chips worth?</div>
        {/* A SELECT rather than the segmented buttons the other choices use, on
            purpose: this is the one setting a host should have to look at and
            deliberately change, and a dropdown reads as a decision where two
            side-by-side pills read as a toggle you might fat-finger. */}
        <select
          className="cg-input"
          aria-label="Stakes"
          value={stakes}
          onChange={(e) => setStakes(e.target.value === "play" ? "play" : "real")}
        >
          <option value="real">Real money</option>
          <option value="play">Play money</option>
        </select>
        <p className="cg-hint" style={{ marginTop: 8 }}>
          {stakes === "real"
            ? "Amounts are recorded in dollars and count towards lifetime real-money totals."
            : "Amounts are recorded as play money, shown as P$ everywhere, and kept apart from real-money totals. Wins and placings still count: a win is a win."}
        </p>
      </div>

      {!fixedBank && (
      <div className="cg-card">
        <div className="cg-h">Who is banking?</div>
        <div className="cg-seg">
          <button className={bank === "player" ? "on" : ""} onClick={() => setBank("player")}>
            One of us
          </button>
          <button className={bank === "casino" ? "on" : ""} onClick={() => setBank("casino")}>
            A casino
          </button>
        </div>
        <p className="cg-hint" style={{ marginTop: 8 }}>
          {bank === "player"
            ? `A crew member is the house. Their net is worked out from everyone else's, never typed in, and ${copy.noun} has to add up to zero. If it doesn't, this screen says by how much.`
            : "The house is a real casino, so nobody here is the banker and every net stands on its own. Nothing to balance."}
        </p>
      </div>
      )}

      <div className="cg-card">
        <div className="cg-h">Buy-ins</div>
        <div className="cg-lab">Default</div>
        <MoneyInput value={defaultBuyIn} onChange={setDefaultBuyIn} ariaLabel="Default buy-in" />
        <p className="cg-hint" style={{ marginTop: 8 }}>
          What everyone starts on unless you give them their own amount below.
          {effBank === "player" &&
            " The banker's is the float they put up, so it is usually the biggest number here."}
        </p>

        {seats.length > 0 && (
          <>
            <div className="cg-lab" style={{ marginTop: 14 }}>
              Sitting down ({seats.length})
            </div>
            {/* SWAPPING THE ROSTER RESETS THE BANKER, and it has to:
                `bankerIndex` points INTO the seat list, so a new list of
                different people would leave the bank on whoever now sits in
                that slot. Same class of bug as dropRosterIndex on the three
                side-carrying packs. */}
            <RosterCarryOver
              source={ctx.prefillSource}
              label={ctx.prefillLabel}
              rsvpSlots={ctx.rsvpPrefill}
              current={seats}
              onUseRsvp={(slots) => {
                setSeats(slots.map((p) => ({ userId: p.userId, name: p.name, buyIn: null })));
                setBankerIndex(0);
              }}
            />
            {seats.map((s, i) => (
              <div className="cg-seat" key={`${s.userId ?? "g"}-${i}`}>
                <span className="cg-seat__who">
                  <span className="cg-name">{s.name}</span>
                  {!s.userId && <span className="cg-pill cg-pill--muted" style={{ marginLeft: 6 }}>guest</span>}
                  {effBank === "player" && (
                    <button
                      className={`cg-pill ${bankerIndex === i ? "" : "cg-pill--muted"}`}
                      style={{ marginLeft: 6 }}
                      onClick={() => setBankerIndex(i)}
                      aria-pressed={bankerIndex === i}
                    >
                      {bankerIndex === i ? "banker" : "bank?"}
                    </button>
                  )}
                  <div className="cg-sub2">
                    {s.buyIn === null ? (
                      "on the default"
                    ) : (
                      <>
                        <span className="cg-seat__own">their own {m.short(s.buyIn)}</span>{" "}
                        <button className="cg-textbtn" style={{ padding: 0 }} onClick={() => setBuyIn(i, null)}>
                          use default
                        </button>
                      </>
                    )}
                  </div>
                </span>
                <span className="cg-seat__amt">
                  {/*
                    The key is what makes "follow the default until you touch
                    it" work: while this seat has no override, the key carries
                    the table default, so changing that default remounts the
                    input and re-seeds it. Once the seat has its own amount the
                    key is stable and nothing can overwrite what was typed.
                  */}
                  <MoneyInput
                    key={s.buyIn === null ? `d${fallback}` : "own"}
                    value={amountOf(s)}
                    onChange={(c) => setBuyIn(i, c)}
                    small
                    ariaLabel={`${s.name} buy-in`}
                  />
                </span>
                <button className="cg-textbtn" onClick={() => removeAt(i)}>
                  remove
                </button>
              </div>
            ))}
            <p className="cg-hint" style={{ marginTop: 10 }}>
              {m.fmt(onTable)} going on {copy.noun} to start. Any of these can rebuy for a
              different amount later.
            </p>
          </>
        )}
        {seats.length === 0 && <p className="cg-hint" style={{ marginTop: 10 }}>Add players from the crew or type a guest.</p>}
      </div>

      <div className="cg-card">
        <div className="cg-h">Add players</div>
        {notAdded.length > 0 && (
          <>
            <div className="cg-lab">From the crew</div>
            <div className="cg-seg">
              {notAdded.map((m) => (
                <button key={m.userId} onClick={() => addMember(m)}>
                  + {m.name}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="cg-lab" style={{ marginTop: notAdded.length > 0 ? 12 : 0 }}>Add a guest</div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            className="cg-input"
            placeholder="Guest name"
            value={guest}
            onChange={(e) => setGuest(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addGuest()}
          />
          <button className="cg-btn cg-btn--ghost cg-btn--sm" onClick={addGuest}>
            Add
          </button>
        </div>
        <GuestChips names={ctx.recentGuests} current={seats} onAdd={addGuestNamed} />
        <p className="cg-hint" style={{ marginTop: 8 }}>
          Guests play, but lifetime stats only count crew members. Anyone can sit down later.
        </p>
      </div>

      <div className="cg-card">
        <div className="cg-row" style={{ padding: 0 }}>
          <div style={{ flex: 1 }}>
            <div className="cg-h" style={{ margin: 0 }}>Live tracker</div>
            <p className="cg-hint" style={{ marginTop: 4 }}>{copy.trackerHint}</p>
          </div>
          <button
            className={`gn-toggle ${tracker ? "gn-toggle--on" : "gn-toggle--off"}`}
            aria-pressed={tracker}
            onClick={() => setTracker(!tracker)}
          >
            {tracker ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* Last of the shared cards, and after the required ones on purpose: it
          is entirely optional, and a host in a hurry should reach the start
          button without having to decide anything here. */}
      <ModifierPicker
        ledger={ledger}
        value={modifiers}
        onChange={setModifiers}
        unit={defaultBuyIn}
        stakes={stakes}
        unitLabel="buy-in"
      />

      {extra}

      <button
        className="cg-btn"
        style={{ marginTop: 12 }}
        disabled={busy || !ready}
        onClick={() =>
          onStart({
            bank: effBank,
            stakes,
            bankerIndex: effBank === "player" ? bankerIndex : undefined,
            defaultBuyIn,
            // Only the seats the host deliberately overrode. Everything else
            // is the default, and sending it explicitly would freeze a number
            // the host never chose.
            buyIns: Object.fromEntries(
              seats.map((s, i) => [i, s.buyIn]).filter(([, v]) => v !== null),
            ),
            tracker,
            modifiers,
            roster: seats.map((s) => ({ userId: s.userId, name: s.name })),
          })
        }
      >
        {seats.length < minPlayers
          ? effBank === "player"
            ? "Add the banker plus at least one player"
            : effBank === "table"
            ? "Add at least 2 players"
            : "Add at least 1 player"
          : defaultBuyIn === null
          ? "Set a default buy-in"
          : `Open ${copy.noun} · ${m.fmt(onTable)} on it`}
      </button>
    </>
  );
}

/** The night that just ended, so the host can see it before starting another. */
function FinishedRecap({ summary, noun }: { summary: CashSummary<unknown>; noun: string }) {
  return (
    <div className="cg-card" style={{ marginTop: 16 }}>
      <div className="cg-h">That {noun.replace(/^the /, "")} is closed</div>
      {summary.players.map((p) => (
        <div className="cg-row" key={p.playerId}>
          <span className="cg-name" style={{ flex: 1, minWidth: 0 }}>
            {p.name}
            {p.isBanker && <span className="cg-pill" style={{ marginLeft: 6 }}>bank</span>}
          </span>
          <NetToken net={p.net} totalIn={p.totalIn} stakes={summary.stakes} />
        </div>
      ))}
      <p className="cg-hint" style={{ marginTop: 10 }}>
        It&rsquo;s in the ledger. Set up another one below.
      </p>
    </div>
  );
}

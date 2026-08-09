import { shuffleIntoSides, validateSides, type Side, type SideCheck } from "@gamenight/shared";

// The TEAM PICKER: put a roster onto sides before a night starts.
//
// Lifted out of PingPongPage.tsx, where it shipped on 2026-08-02 as the team
// primitive's first consumer. Card Table is the second, and a partnership card
// game needs exactly this screen: a set of sides, people dealt onto them by
// hand or at random, uneven allowed and warned about, and a start button that
// says what is still missing.
//
// IT WORKS IN ROSTER INDICES, NOT IDS, and that is load-bearing rather than
// incidental. Player slot ids are minted by the SERVER when the session starts,
// so at setup time this screen has never seen one. Everything below indexes
// into the roster array the host is building, and `dropRosterIndex` exists
// because removing a player shifts every index after them: get that wrong and
// the sides silently point at the wrong people, with nothing to error about.
//
// THE PRIMITIVE OWNS WHAT IS VALID. validateSides is the same function the
// server runs, so this screen cannot drift from the answer it will get back.
// `even` is a FACT rather than a verdict: uneven sides are warned about and
// never blocked, because five into two is a real thing a crew does.
//
// STYLING IS BY PREFIX rather than by a stylesheet of its own. Ping Pong is
// green felt and an orange ball; Card Table is cream, red and black. A picker
// that brought its own palette would be the one component on the screen that
// belonged to neither pack, so it renders `${cx}-lab`, `${cx}-seg` and so on,
// and each pack's existing stylesheet paints it.

export interface TeamPickerStatus {
  /** Roster indices not on any side yet. */
  unplaced: number[];
  /** The primitive's verdict on the sides as they stand. */
  check: SideCheck;
  /** Everybody placed and the sides valid: safe to start. */
  ready: boolean;
}

/** The sides as the primitive sees them, ids and names included. */
export function sidesFromAssign(assign: readonly (readonly number[])[]): Side[] {
  return assign.map((members, i) => ({
    id: String.fromCharCode(97 + i),
    name: `Side ${String.fromCharCode(65 + i)}`,
    memberIds: members.map(String),
  }));
}

export function teamPickerStatus(assign: readonly (readonly number[])[], rosterSize: number): TeamPickerStatus {
  const placed = new Set(assign.flat());
  const unplaced = Array.from({ length: rosterSize }, (_, i) => i).filter((i) => !placed.has(i));
  const check = validateSides(sidesFromAssign(assign));
  return { unplaced, check, ready: check.error === null && unplaced.length === 0 };
}

/**
 * Remove a roster index and shift the ones above it down.
 *
 * The whole reason this is a named export rather than three lines inline: the
 * host removing the third of five players has to renumber the assignment, and
 * a version of this that forgets is a screen that looks completely correct and
 * puts the wrong two people on a side.
 */
export function dropRosterIndex(assign: readonly (readonly number[])[], removed: number): number[][] {
  return assign.map((side) => side.filter((n) => n !== removed).map((n) => (n > removed ? n - 1 : n)));
}

/**
 * Deal the roster at random across the sides that exist.
 *
 * The dealing itself is the primitive's (Fisher-Yates, remainder distributed
 * round robin rather than piled on the last side), so the app has ONE shuffle.
 * The primitive clamps its side count to the number of players; the picker does
 * not, because the host asked for that many sides and an empty one is a visible
 * prompt to fill it rather than a state to silently rewrite. Hence the pad.
 */
export function shuffleAssign(sideCount: number, rosterSize: number, rng: () => number = Math.random): number[][] {
  const ids = Array.from({ length: rosterSize }, (_, i) => String(i));
  const dealt = shuffleIntoSides(ids, sideCount, rng).map((s) => s.memberIds.map(Number));
  while (dealt.length < sideCount) dealt.push([]);
  return dealt;
}

export function TeamPicker({
  cx,
  roster,
  assign,
  setAssign,
  maxSides = 8,
}: {
  /** Class prefix, so the picker wears the pack's own palette: "pp", "tn". */
  cx: string;
  roster: readonly { name: string }[];
  assign: number[][];
  setAssign: (next: number[][]) => void;
  maxSides?: number;
}) {
  const { unplaced, check } = teamPickerStatus(assign, roster.length);

  const putOn = (sideIdx: number, playerIdx: number) =>
    setAssign(assign.map((side, i) => (i === sideIdx ? [...side, playerIdx] : side.filter((n) => n !== playerIdx))));
  const takeOff = (playerIdx: number) => setAssign(assign.map((side) => side.filter((n) => n !== playerIdx)));
  const addSide = () => setAssign(assign.length < maxSides ? [...assign, []] : assign);
  const dropSide = (i: number) => setAssign(assign.length > 2 ? assign.filter((_, j) => j !== i) : assign);

  return (
    <>
      {assign.map((members, i) => (
        <div key={i} style={{ marginTop: 10 }}>
          <div className={`${cx}-lab`} style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Side {String.fromCharCode(65 + i)} ({members.length})</span>
            {assign.length > 2 && <button className={`${cx}-textbtn`} onClick={() => dropSide(i)}>remove</button>}
          </div>
          <div className={`${cx}-seg`}>
            {members.length === 0 && <span className={`${cx}-hint`}>nobody yet</span>}
            {members.map((n) => (
              <button key={n} className="on" onClick={() => takeOff(n)}>{roster[n]?.name} &times;</button>
            ))}
          </div>
        </div>
      ))}

      {unplaced.length > 0 && (
        <>
          <div className={`${cx}-lab`} style={{ marginTop: 12 }}>Not on a side yet</div>
          {unplaced.map((n) => (
            <div className={`${cx}-row`} key={n}>
              <span className={`${cx}-name`} style={{ flex: 1 }}>{roster[n]?.name}</span>
              <div className={`${cx}-seg`} style={{ flex: "0 0 auto", marginTop: 0 }}>
                {assign.map((_, i) => (
                  <button key={i} onClick={() => putOn(i, n)}>{String.fromCharCode(65 + i)}</button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          className={`${cx}-btn ${cx}-btn--ghost`}
          onClick={() => setAssign(shuffleAssign(assign.length, roster.length))}
          disabled={roster.length < 2}
        >
          🎲 Shuffle
        </button>
        <button className={`${cx}-btn ${cx}-btn--ghost`} onClick={addSide} disabled={assign.length >= maxSides}>+ Side</button>
      </div>

      {check.error && unplaced.length === 0 && <p className={`${cx}-err`}>{check.error}</p>}
      {/* UNEVEN IS ALLOWED AND WARNED, NEVER BLOCKED. The app records what the
          night did rather than refereeing it. */}
      {!check.error && !check.even && unplaced.length === 0 && (
        <p className={`${cx}-hint`} style={{ marginTop: 8 }}>
          ⚠️ Uneven sides ({check.sizes.join(" v ")}). That is allowed; the result records the same way.
        </p>
      )}
    </>
  );
}

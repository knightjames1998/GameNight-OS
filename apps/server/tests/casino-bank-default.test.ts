// WHO BANKS BY DEFAULT, pinned in both places that decide it.
//
// THIS HAD NO TEST AT ALL until the default was changed on 2026-08-22, which is
// the reason for the file: the answer decides whether somebody's money is
// DERIVED or COUNTED, and it was a bare ternary in a route and a useState
// initial value, neither of which anything asserted.
//
// THE TWO DEFAULTS HAVE TO AGREE. The setup screen sends `bank` on every start,
// so in practice the client's answer is the one that lands; the server's
// fallback only decides for a body that omits it, which is an older installed
// PWA running a cached bundle. When those two disagree, the disagreement is
// invisible until somebody opens a table from a stale app and finds a banker
// they did not pick.
//
// WHY "casino" IS THE SAFER DEFAULT, which is the actual argument rather than a
// preference: a PLAYER-banked table derives the banker's net as the exact
// inverse of everyone else's (see the CashBank union in cashgame.ts), so a host
// who never touched the control would have had one person's money worked out
// for them rather than counted. A CASINO-banked table derives nobody: every net
// stands on its own. Defaulting to the answer that invents no numbers is the
// same reasoning `stakes` uses to default to real money.
//
// Source assertions rather than route calls, the same shape
// bracket-tv-fit.test.ts uses for "the component actually emits the attribute":
// what is being guarded against is a one-word edit, and a one-word edit throws
// nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(HERE, "..", "..", p), "utf8");

const runtime = read("server/src/casino-runtime.ts");
const poker = read("server/src/poker.ts");
const setup = read("../apps/web/src/casino/CasinoSetup.tsx");
const pokerPage = read("../apps/web/src/poker/PokerPage.tsx");

test("the SERVER defaults an unspecified bank to a casino, not to a player", () => {
  assert.match(
    runtime,
    /req\.body\?\.bank === "player" \? "player" : "casino"/,
    "the casino-runtime bank fallback is not defaulting to `casino`",
  );
  // The inverse spelling is the bug this replaced: `=== "casino" ? "casino" :
  // "player"` made every malformed body a player-banked table.
  assert.doesNotMatch(runtime, /bank === "casino" \? "casino" : "player"/);
});

test("a pack that PINS its bank still wins over the default", () => {
  // Poker is zero-sum with no house. If the default ever started overriding
  // `fixedBank`, a poker table would be recorded as casino-banked and its
  // balance check (the whole feature) would stop checking anything.
  assert.match(runtime, /cfg\.fixedBank \?\?/, "fixedBank no longer takes precedence over the default");
  assert.match(poker, /fixedBank: "table"/, "poker no longer pins its bank");
});

test("the SETUP SCREEN defaults to the same answer the server does", () => {
  // The two defaults disagreeing is invisible until somebody starts a table
  // from a cached bundle, so they are asserted together on purpose.
  assert.match(setup, /useState<CashBank>\("casino"\)/, "CasinoSetup no longer defaults to a casino");
});

test("ONLY a casino-banked table may be opened with a single seat", () => {
  // This was `bank === "player" ? 2 : 1`, which is the right floor for the two
  // banks that existed when it was written and the WRONG one for poker's
  // "table": nobody banks there, but two people are still needed to have a
  // game, and the old spelling would have let a poker table open with one seat
  // the moment the default stopped being "player".
  assert.match(setup, /effBank === "casino" \? 1 : 2/, "the single-seat rule is not keyed on a casino bank");
  assert.doesNotMatch(setup, /bank === "player" \? 2 : 1/);
});

test("poker does not render a banking picker whose answer is thrown away", () => {
  // The server ignores `bank` for poker entirely. A control that changes
  // nothing is worse than no control, and it is the one this pack used to show.
  assert.match(pokerPage, /fixedBank="table"/, "PokerPage no longer pins the bank on the setup screen");
  assert.match(setup, /\{!fixedBank && \(/, "CasinoSetup renders the picker even when the bank is pinned");
});

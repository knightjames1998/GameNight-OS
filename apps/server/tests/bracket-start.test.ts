// Tests for the "may this event start another tournament?" rule
// (canStartBracket in src/brackets.ts).
//
// The rule this replaces was "does this event have a bracket at all", which is
// not the same question and got the answer wrong in one direction only: an
// event that had finished a tournament could never start a second one, ever,
// because there is no bracket delete route either. A crew that plays Smash at
// nine and Mario Kart at ten was told their night already had a bracket.
//
// PURE, no database, the same split tv.ts uses between reading rows and
// deciding. Stubbing Drizzle here would test the stub; the query half is one
// select with no limit and is verified on-device.

import { test } from "node:test";
import assert from "node:assert/strict";
import { canStartBracket, type ExistingBracket } from "../src/brackets.js";

const b = (id: string, status: ExistingBracket["status"]): ExistingBracket => ({ id, status });

test("an event with no bracket at all can start one", () => {
  assert.deepEqual(canStartBracket([]), { ok: true });
});

test("ONE COMPLETED BRACKET DOES NOT BLOCK A SECOND TOURNAMENT", () => {
  // The whole point of the change. This case returned a 409 for months.
  assert.deepEqual(canStartBracket([b("b1", "completed")]), { ok: true });
});

test("two completed brackets still do not block a third", () => {
  // A third tournament on one night is not a special case, it is the second
  // rule applied twice. Nothing here counts brackets.
  assert.deepEqual(canStartBracket([b("b1", "completed"), b("b2", "completed")]), { ok: true });
});

test("a LIVE bracket blocks, and hands back its id", () => {
  // The id is the payload that matters: it is what lets the client offer to
  // open the running tournament instead of only refusing.
  assert.deepEqual(canStartBracket([b("b1", "live")]), { ok: false, bracketId: "b1" });
});

test("a bracket still in SETUP blocks too", () => {
  // Setup is not completed, so it is a tournament in progress. A host who
  // tapped through to the roster screen and has not finished picking has not
  // finished with the screen, and starting a second one behind their back is
  // the failure this rule prevents.
  assert.deepEqual(canStartBracket([b("b1", "setup")]), { ok: false, bracketId: "b1" });
});

test("ONE COMPLETED PLUS ONE LIVE BLOCKS ON THE LIVE ONE", () => {
  // The case the old guard could not distinguish, and the one that matters on
  // a real night: the first tournament is history, the second is being played.
  // Order in the array must not change the answer, because the query that
  // feeds this has no ORDER BY.
  assert.deepEqual(canStartBracket([b("b1", "completed"), b("b2", "live")]), {
    ok: false,
    bracketId: "b2",
  });
  assert.deepEqual(canStartBracket([b("b2", "live"), b("b1", "completed")]), {
    ok: false,
    bracketId: "b2",
  });
});

test("two non-completed rows resolve deterministically, whatever order they arrive in", () => {
  // This rule makes two non-completed brackets impossible, so this is about
  // what happens when the impossible turns up anyway: a hand-edited database,
  // or a future change to the rule. An answer that depends on row order would
  // send two phones to two different brackets from the same tap.
  const rows = [b("b9", "live"), b("b2", "setup"), b("b5", "live")];
  assert.deepEqual(canStartBracket(rows), { ok: false, bracketId: "b2" });
  assert.deepEqual(canStartBracket([...rows].reverse()), { ok: false, bracketId: "b2" });
});

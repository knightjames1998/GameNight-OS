// THE CONNECTION STATE RULE, and the two numbers it stands on.
//
// WHY THIS RULE IS NOT `socket.readyState`, which is the version everybody
// writes first: A WEBSOCKET CAN DIE WITHOUT EITHER END BEING TOLD. A mobile NAT
// or a proxy drops the connection with no FIN, the browser's `onclose` never
// fires, the 3000ms retry never runs, and `readyState` reads OPEN forever while
// nothing arrives. A pill built on it would say "connected" during exactly the
// failure it exists to expose, which is worse than shipping no pill.
//
// So the rule is about TRAFFIC: the server pings on an interval, and a screen
// that has heard nothing for longer than the stale window has stopped receiving
// whether or not its socket admits it. That makes the two constants a matched
// pair rather than two independent knobs, which is what the second half of this
// file pins.
//
// The derivation is pure, so it needs no socket and no clock. The socket half
// (closing on stale, refetching on a reconnect) is verified on-device, the same
// split tv-resolve and the pack runtime use.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveLiveState,
  STALE_AFTER_MS,
  STALE_CHECK_MS,
  DOWN_GRACE_MS,
} from "../../web/src/livestatus.js";
import { PING_INTERVAL_MS } from "../src/ws.js";

const NOW = 1_700_000_000_000;
const at = (msAgo: number) => NOW - msAgo;

// ---------- the three states ----------

test("NOBODY SUBSCRIBED IS IDLE, and that is not the same as no socket", () => {
  // The distinction the pill turns on, and the one a three-state store would
  // have got wrong. Home and Login mount no live hook at all: nothing to say,
  // render nothing. A screen that IS subscribed and has no socket is a dropped
  // connection, which is the case the pill exists for. Both have zero open
  // sockets, so counting sockets alone would have gone silent during exactly the
  // failure this was built for.
  assert.equal(deriveLiveState({ mountedCount: 0, openCount: 0, downSince: 0, lastMessageAt: NOW, now: NOW }), "idle");
  assert.equal(deriveLiveState({ mountedCount: 0, openCount: 0, downSince: 0, lastMessageAt: 0, now: NOW }), "idle");
  // Floored the same way the socket count is.
  assert.equal(deriveLiveState({ mountedCount: -1, openCount: 0, downSince: 0, lastMessageAt: NOW, now: NOW }), "idle");
});

test("subscribed with no socket is DOWN once the grace has passed", () => {
  const dropped = { mountedCount: 1, openCount: 0, lastMessageAt: NOW, now: NOW };
  assert.equal(deriveLiveState({ ...dropped, downSince: at(DOWN_GRACE_MS + 1) }), "down");
  assert.equal(
    deriveLiveState({ ...dropped, downSince: at(DOWN_GRACE_MS + 1), lastMessageAt: 0 }),
    "down",
  );
  // Floored, because a cleanup and an onclose can both fire for one socket and a
  // negative count would otherwise read as something other than down.
  assert.equal(
    deriveLiveState({ ...dropped, openCount: -1, downSince: at(DOWN_GRACE_MS + 1) }),
    "down",
  );
});

test("A PAGE LOAD DOES NOT FLASH THE PILL, which is what the grace is for", () => {
  // Every live screen in the app mounts its hook before its socket finishes
  // opening, so for a few hundred milliseconds it is subscribed with nothing
  // open: the literal definition of down. Without the grace the pill would
  // appear and vanish on every single navigation, which is how a badge teaches
  // people to ignore it.
  const connecting = { mountedCount: 1, openCount: 0, lastMessageAt: 0, now: NOW };
  assert.equal(deriveLiveState({ ...connecting, downSince: NOW }), "idle");
  assert.equal(deriveLiveState({ ...connecting, downSince: at(200) }), "idle");
  assert.equal(deriveLiveState({ ...connecting, downSince: at(DOWN_GRACE_MS) }), "idle");
  assert.equal(deriveLiveState({ ...connecting, downSince: at(DOWN_GRACE_MS + 1) }), "down");
});

test("the grace outlasts one retry cycle, so a single failed attempt is silent", () => {
  // The retry is a fixed 3000ms. A connection that fails once and succeeds on
  // its first retry is not worth a word, and the grace is what makes that true
  // rather than a race between two timers.
  assert.ok(
    DOWN_GRACE_MS > 3000,
    `the down grace ${DOWN_GRACE_MS}ms must outlast one 3000ms retry cycle`,
  );
});

test("an open socket that heard something recently is LIVE", () => {
  assert.equal(deriveLiveState({ mountedCount: 1, openCount: 1, downSince: 0, lastMessageAt: NOW, now: NOW }), "live");
  assert.equal(deriveLiveState({ mountedCount: 1, openCount: 1, downSince: 0, lastMessageAt: at(1_000), now: NOW }), "live");
  // Two screens open at once: the store tracks the NEWEST message across every
  // socket, so one busy screen is enough to say the pipe is fine.
  assert.equal(deriveLiveState({ mountedCount: 1, openCount: 3, downSince: 0, lastMessageAt: at(5_000), now: NOW }), "live");
});

test("an open socket that has gone quiet past the window is STALE", () => {
  assert.equal(
    deriveLiveState({ mountedCount: 1, openCount: 1, downSince: 0, lastMessageAt: at(STALE_AFTER_MS + 1), now: NOW }),
    "stale",
  );
  assert.equal(deriveLiveState({ mountedCount: 1, openCount: 1, downSince: 0, lastMessageAt: at(120_000), now: NOW }), "stale");
});

test("OPEN AND NEVER HEARD ANYTHING IS STALE, not a special case", () => {
  // lastMessageAt of 0 reads as an infinite age, which is the honest answer: a
  // socket that is open and has never said a word is precisely the half-open
  // state this whole mechanism exists to catch, not an edge to exempt.
  assert.equal(deriveLiveState({ mountedCount: 1, openCount: 1, downSince: 0, lastMessageAt: 0, now: NOW }), "stale");
});

test("the boundary is inclusive, so the window is not off by a tick", () => {
  assert.equal(
    deriveLiveState({ mountedCount: 1, openCount: 1, downSince: 0, lastMessageAt: at(STALE_AFTER_MS), now: NOW }),
    "live",
    "exactly at the window is still live",
  );
  assert.equal(
    deriveLiveState({ mountedCount: 1, openCount: 1, downSince: 0, lastMessageAt: at(STALE_AFTER_MS + 1), now: NOW }),
    "stale",
  );
});

test("a clock that jumps backwards does not invent a stale screen", () => {
  // Phones adjust their clock, and a negative age must read as "just heard from
  // them" rather than wrapping into a large positive number somewhere.
  assert.equal(deriveLiveState({ mountedCount: 1, openCount: 1, downSince: 0, lastMessageAt: NOW + 10_000, now: NOW }), "live");
});

// ---------- the two numbers are a matched pair ----------

test("THE STALE WINDOW SURVIVES ONE DROPPED PING AND NOT TWO", () => {
  // This is the relationship both constants exist in, asserted against the
  // server's own value rather than by eye, because the failure mode of getting
  // it wrong is silent in both directions: too tight and every quiet minute
  // flaps the pill and forces a pointless reconnect; too loose and a dead
  // socket sits there looking fine for a minute.
  assert.ok(
    STALE_AFTER_MS > PING_INTERVAL_MS * 2,
    `stale window ${STALE_AFTER_MS}ms must exceed two ping intervals (${PING_INTERVAL_MS * 2}ms), ` +
      "or one dropped ping is a false alarm",
  );
  assert.ok(
    STALE_AFTER_MS < PING_INTERVAL_MS * 3,
    `stale window ${STALE_AFTER_MS}ms must be under three ping intervals ` +
      `(${PING_INTERVAL_MS * 3}ms), or two consecutive misses go unnoticed`,
  );

  // Said as the scenario rather than as arithmetic: a ping lands, the next one
  // is lost, the one after that arrives on schedule and inside the window.
  const oneMissed = PING_INTERVAL_MS * 2;
  assert.equal(
    deriveLiveState({ mountedCount: 1, openCount: 1, downSince: 0, lastMessageAt: at(oneMissed), now: NOW }),
    "live",
    "one dropped ping must not raise the pill",
  );
  // Two in a row is a real silence.
  const twoMissed = PING_INTERVAL_MS * 3;
  assert.equal(
    deriveLiveState({ mountedCount: 1, openCount: 1, downSince: 0, lastMessageAt: at(twoMissed), now: NOW }),
    "stale",
    "two consecutive dropped pings must raise the pill",
  );
});

test("the check runs often enough to notice inside one ping interval", () => {
  // A stale window nobody looks at is a label that updates whenever something
  // else happens to re-render, which on a quiet TV is never.
  assert.ok(
    STALE_CHECK_MS < PING_INTERVAL_MS,
    "the staleness check must run more often than the thing it is checking for",
  );
});

// ---------- the socket half, asserted at the source ----------

test("STALE CLOSES THE SOCKET rather than only labelling it", () => {
  // The half that is easy to leave out and impossible to see: a half-open socket
  // will never close itself, so noticing achieves nothing on its own. Closing it
  // drops into the onclose path and reuses the retry that is already there.
  const src = readHook();
  assert.match(src, /socket\.close\(\)/, "the stale check does not close the socket");
  assert.match(
    src,
    /Date\.now\(\) - lastMessageAt > STALE_AFTER_MS/,
    "the stale check is not comparing against the window",
  );
});

test("THE RETRY IS STILL 3000ms AND THERE IS STILL ONLY ONE OF IT", () => {
  // Backoff is the obvious next thought and is wrong for this app: the real case
  // is a host in one room with a brief dropout, and constant 3s recovery is what
  // that wants. A second retry loop next to the existing one is the other way
  // this goes wrong.
  const src = readHook();
  assert.match(src, /const RETRY_MS = 3000;/);
  assert.equal(
    src.match(/setTimeout\(connect/g)?.length,
    1,
    "there must be exactly one reconnect path",
  );
});

test("A RECONNECT REFETCHES, and a FIRST connect does not", () => {
  // The bug the pill would otherwise have decorated: onVisible covers a phone
  // that slept, but nothing covered a socket that dropped and came back while
  // the page stayed visible. And the guard matters as much as the call: without
  // it every screen in the app double-fetches on mount.
  const src = readHook();
  assert.match(src, /if \(everConnected\) \{/);
  assert.match(src, /everConnected = true;/);
});

function readHook(): string {
  return readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../web/src/useLiveUpdates.ts"),
    "utf8",
  );
}

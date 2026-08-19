// Tests for the two-host-devices room sync rule (web/src/beerio/roomsync.ts).
//
// THE BUG: a host device pushed its state to the room and never read the room
// back, so a night driven from a phone left a laptop on whatever it had when it
// loaded, and the laptop's next push then overwrote the phone. A refresh was
// the only cure, which is exactly what made it read as a rendering fault.
//
// The half that can be reasoned about is the COMPARISON, so that is what lives
// in a module of ours and what is tested here. The vendored file gets the
// wiring only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { roomStateKey, stableJson, shouldAdopt } from "../../web/src/beerio/roomsync.js";

const night = (over: Record<string, unknown> = {}) => ({
  playerCount: 4,
  names: ["Ann", "Ben", "Cal", "Dee"],
  results: { W1M0: "A", W1M1: "B" },
  series: {},
  format: { series: 1, mode: "bracket", gpRaces: 4 },
  gpLog: [],
  colors: ["#E10600", "#FF7A00", "#FFC400", "#9CCC00"],
  seeded: true,
  ...over,
});

test("the same night produces the same key", () => {
  assert.equal(roomStateKey(night()), roomStateKey(night()));
});

test("A KEY ORDER CHANGE IS NOT A CHANGE, which is the whole reason for stableJson", () => {
  // The room lives in a Postgres jsonb column and jsonb does not preserve key
  // order, it normalises. So the bytes a device PUTs are not the bytes it reads
  // back. A plain JSON.stringify compare would report "somebody changed this"
  // on every poll of a room nobody has touched, and both devices would adopt
  // and re-push each other forever.
  const a = night({ results: { W1M0: "A", W1M1: "B" }, format: { series: 1, mode: "bracket", gpRaces: 4 } });
  const b = night({ results: { W1M1: "B", W1M0: "A" }, format: { gpRaces: 4, mode: "bracket", series: 1 } });
  assert.notEqual(JSON.stringify(a), JSON.stringify(b), "the fixture must actually be reordered");
  assert.equal(roomStateKey(a), roomStateKey(b));
});

test("stableJson sorts at every depth, not just the top", () => {
  assert.equal(stableJson({ b: { d: 1, c: 2 }, a: 3 }), '{"a":3,"b":{"c":2,"d":1}}');
  // Arrays are ORDER BEARING and must not be sorted: names and colors are keyed
  // by seat, so reordering them would be a different night.
  assert.equal(stableJson([3, 1, 2]), "[3,1,2]");
  assert.notEqual(stableJson({ names: ["Ann", "Ben"] }), stableJson({ names: ["Ben", "Ann"] }));
});

test("a real change is a change", () => {
  assert.notEqual(roomStateKey(night()), roomStateKey(night({ results: { W1M0: "A" } })));
  assert.notEqual(roomStateKey(night()), roomStateKey(night({ playerCount: 6 })));
  assert.notEqual(roomStateKey(night()), roomStateKey(night({ names: ["Ann", "Ben", "Cal", "Eve"] })));
  assert.notEqual(roomStateKey(night()), roomStateKey(night({ seeded: false })));
});

test("HOFCODE IS NOT PART OF THE KEY, and that is what stops an endless ping-pong", () => {
  // It is a per-device localStorage value that the host's adopt has never
  // applied. A field one device SENDS and the other never ADOPTS can never be
  // resolved: each poll sees the other's copy as new, adopts, fails to actually
  // change its own, and pushes again. Forever, at both ends.
  assert.equal(roomStateKey(night({ hofCode: "CREW1" })), roomStateKey(night({ hofCode: null })));
  assert.equal(roomStateKey(night({ hofCode: "CREW1" })), roomStateKey(night()));
});

test("a missing field reads as null rather than throwing", () => {
  assert.equal(typeof roomStateKey({}), "string");
  assert.equal(typeof roomStateKey(null), "string");
  assert.equal(typeof roomStateKey(undefined), "string");
});

test("nothing has happened, so nothing is adopted", () => {
  const k = roomStateKey(night());
  assert.equal(shouldAdopt({ remote: k, synced: k, pushing: false }), false);
});

test("THE PHONE MOVED, so the laptop takes it", () => {
  // The user's case exactly: laptop parked on the editable screen, night driven
  // from a phone on the same account and the same room.
  assert.equal(
    shouldAdopt({ remote: roomStateKey(night({ results: { W1M0: "A" } })), synced: roomStateKey(night()), pushing: false }),
    true,
  );
});

test("a device with its own edit in flight does not get it wiped", () => {
  // The half-typed name case. The local edit wins and lands first; the next
  // poll converges. Without this the debounce window is a hole somebody's
  // typing falls into.
  assert.equal(
    shouldAdopt({ remote: roomStateKey(night({ playerCount: 8 })), synced: roomStateKey(night()), pushing: true }),
    false,
  );
});

test("a device that has never synced adopts whatever the room says", () => {
  assert.equal(shouldAdopt({ remote: roomStateKey(night()), synced: null, pushing: false }), true);
});

test("ADOPTING ENDS THE EXCHANGE, which is the property that matters most", () => {
  // Walk the real two-device sequence and assert it goes quiet. If this ever
  // fails, two phones sit in a PUT loop for the length of a game night.
  const phoneState = night({ results: { W1M0: "A", W1M1: "B", W2M0: "A" } });
  let laptopSynced = roomStateKey(night());
  const remote = roomStateKey(phoneState);

  // 1. the laptop notices and adopts
  assert.equal(shouldAdopt({ remote, synced: laptopSynced, pushing: false }), true);
  laptopSynced = remote;
  // 2. the laptop's local state now EQUALS the room, so its push side is quiet
  assert.equal(roomStateKey(phoneState), laptopSynced);
  // 3. and every later poll of an untouched room adopts nothing
  assert.equal(shouldAdopt({ remote, synced: laptopSynced, pushing: false }), false);
  assert.equal(shouldAdopt({ remote, synced: laptopSynced, pushing: false }), false);
});

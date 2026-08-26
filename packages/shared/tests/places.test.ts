// THE COORDINATE ORDER, PINNED BEFORE ANYTHING CALLS IT.
//
// Photon answers in GeoJSON and GeoJSON is [LONGITUDE, LATITUDE]. Swapping them
// is the highest-consequence silent bug available in this session: the value is
// still a number, the row still saves, the map link still builds, and the game
// night is in the Indian Ocean with nothing anywhere erroring. So the order is
// asserted first and asserted twice, once where a swap is merely wrong and once
// where a swap is UNDETECTABLE by validation.
//
// ABOUT THESE FIXTURES: they are transcribed from Photon's documented GeoJSON
// response shape, not captured from a live call, because this sandbox has no
// outbound route to photon.komoot.io (the agent proxy answers 403 to CONNECT).
// The fields used here (geometry.coordinates, properties.name/housenumber/
// street/city/state/osm_type/osm_id) are the stable documented ones, and the
// parser rejects anything it does not recognise rather than guessing, so an
// unexpected extra field cannot change an answer. WHAT TO CHECK ON THE FIRST
// REAL CALL is written at the bottom of this file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePhotonFeature, mapUrlFor } from "../src/places.js";

/** A named venue with a full address. Wrigley Field is at 41.95N, 87.66W. */
const WRIGLEY = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [-87.6553, 41.9484] },
  properties: {
    osm_id: 3374814, osm_type: "W", osm_key: "leisure", osm_value: "stadium",
    name: "Wrigley Field", housenumber: "1060", street: "West Addison Street",
    city: "Chicago", state: "Illinois", postcode: "60613",
    country: "United States", countrycode: "US",
  },
};

/**
 * PARIS, WHICH IS THE FIXTURE THAT ACTUALLY MATTERS. 48.85N 2.35E: swap it and
 * you get 2.35N 48.85E, which is a PERFECTLY VALID COORDINATE in the Somali
 * Sea. No range check can catch that, so only the assertion below can.
 */
const PARIS = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [2.3522, 48.8566] },
  properties: { osm_id: 7444, osm_type: "R", name: "Paris", city: "Paris", state: "Ile-de-France" },
};

/** No `name`: a plain address result, which Photon returns constantly. */
const HOUSE = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [-87.6244, 41.8781] },
  properties: {
    osm_id: 1234567, osm_type: "N", housenumber: "233", street: "South Wacker Drive",
    city: "Chicago", state: "Illinois",
  },
};

const parsed = (f: unknown) => {
  const p = parsePhotonFeature(f);
  assert.ok(p, "expected the feature to parse");
  return p;
};

// ---------- the coordinate order ----------

test("LAT COMES FROM coordinates[1] AND LNG FROM coordinates[0]", () => {
  const p = parsed(WRIGLEY);
  assert.equal(p.lat, 41.9484, "latitude must be the SECOND element");
  assert.equal(p.lng, -87.6553, "longitude must be the FIRST element");
});

test("A SWAP AT PARIS WOULD BE A VALID COORDINATE, so it is asserted by value", () => {
  // 48.8566N 2.3522E. Swapped it is 2.3522N 48.8566E, off the Somali coast:
  // in range, in the ocean, and invisible to every check except this one.
  const p = parsed(PARIS);
  assert.equal(p.lat, 48.8566);
  assert.equal(p.lng, 2.3522);
  assert.ok(p.lat > 40 && p.lat < 55, "Paris is in northern Europe, not the tropics");
  assert.ok(p.lng > 0 && p.lng < 10, "Paris is just east of Greenwich, not in the Indian Ocean");
});

test("the western hemisphere keeps its sign", () => {
  // The other half of the same mistake: dropping the sign puts Chicago in China.
  assert.ok(parsed(WRIGLEY).lng < 0);
});

test("the map link is built in HUMAN order, which is the opposite of the input", () => {
  // The one place the two conventions meet, so the one place to assert it.
  const p = parsed(WRIGLEY);
  const url = mapUrlFor(p.lat, p.lng);
  assert.match(url, /mlat=41\.9484/);
  assert.match(url, /mlon=-87\.6553/);
});

// ---------- what it refuses ----------

test("a coordinate outside the world is refused rather than clamped", () => {
  const bad = (coordinates: unknown) =>
    parsePhotonFeature({ ...WRIGLEY, geometry: { type: "Point", coordinates } });
  assert.equal(bad([0, 91]), null, "latitude past the pole");
  assert.equal(bad([0, -91]), null);
  assert.equal(bad([181, 0]), null, "longitude past the date line");
  assert.equal(bad([-181, 0]), null);
  // The boundary itself is a real place: the poles and the date line exist.
  assert.ok(parsePhotonFeature({ ...WRIGLEY, geometry: { type: "Point", coordinates: [180, 90] } }));
});

test("a missing or malformed geometry is refused", () => {
  assert.equal(parsePhotonFeature({ ...WRIGLEY, geometry: undefined }), null);
  assert.equal(parsePhotonFeature({ ...WRIGLEY, geometry: { coordinates: [1] } }), null);
  assert.equal(parsePhotonFeature({ ...WRIGLEY, geometry: { coordinates: ["1", "2"] } }), null);
  assert.equal(parsePhotonFeature({ ...WRIGLEY, geometry: { coordinates: [NaN, 5] } }), null);
});

test("nothing at all is refused, rather than throwing", () => {
  // This runs on a payload from somebody else's server, so the interesting
  // inputs are the ones a type never promised.
  for (const junk of [null, undefined, "", 0, [], "a string", { properties: {} }]) {
    assert.equal(parsePhotonFeature(junk), null, `${JSON.stringify(junk)} should be refused`);
  }
});

test("A FEATURE WITH NO IDENTITY IS REFUSED, because it could not be saved whole", () => {
  // The event row sets lat, lng and ref together or not at all, so a place with
  // no ref is not a place this app can store.
  const noType = { ...WRIGLEY, properties: { ...WRIGLEY.properties, osm_type: undefined } };
  const noId = { ...WRIGLEY, properties: { ...WRIGLEY.properties, osm_id: undefined } };
  assert.equal(parsePhotonFeature(noType), null);
  assert.equal(parsePhotonFeature(noId), null);
});

test("a feature with no usable name AND no usable address is refused", () => {
  const blank = {
    ...WRIGLEY,
    properties: { osm_id: 1, osm_type: "N", country: "United States", postcode: "60613" },
  };
  assert.equal(parsePhotonFeature(blank), null, "a blank row is worse than a shorter list");
});

// ---------- the name and the line under it ----------

test("a named place keeps its name and gets the full address underneath", () => {
  const p = parsed(WRIGLEY);
  assert.equal(p.name, "Wrigley Field");
  assert.equal(p.address, "1060 West Addison Street, Chicago, Illinois");
});

test("AN ADDRESS RESULT BECOMES ITS OWN NAME, and the street is not said twice", () => {
  // Photon returns these constantly, and composing the two separately gets this
  // exact case wrong: "North Clark Street" is not equal to "1060 North Clark
  // Street", so de-duplicating by string comparison would keep both lines.
  const p = parsed(HOUSE);
  assert.equal(p.name, "233 South Wacker Drive");
  assert.equal(p.address, "Chicago, Illinois");
});

test("one part composes without a stray comma, and so does none", () => {
  const only = (properties: Record<string, unknown>) =>
    parsed({ ...WRIGLEY, properties: { osm_id: 1, osm_type: "N", ...properties } });
  assert.equal(only({ name: "The Anchor" }).address, "", "no parts must not leave a comma");
  assert.equal(only({ name: "The Anchor", city: "Chicago" }).address, "Chicago");
  assert.equal(only({ name: "The Anchor", state: "Illinois" }).address, "Illinois");
  assert.equal(only({ name: "The Anchor", street: "Clark Street", state: "Illinois" }).address,
    "Clark Street, Illinois", "a missing middle part must not leave a double comma");
  // A settlement with nothing else is still nameable rather than refused.
  assert.equal(only({ city: "Chicago", state: "Illinois" }).name, "Chicago");
  assert.equal(only({ city: "Chicago", state: "Illinois" }).address, "Illinois");
});

test("a street with no house number does not gain a leading space", () => {
  const p = parsed({
    ...WRIGLEY,
    properties: { osm_id: 1, osm_type: "N", street: "West Addison Street", city: "Chicago" },
  });
  assert.equal(p.name, "West Addison Street");
});

test("whitespace-only fields count as absent", () => {
  const p = parsed({ ...WRIGLEY, properties: { ...WRIGLEY.properties, city: "   ", state: "" } });
  assert.equal(p.address, "1060 West Addison Street", "blank parts must not become commas");
});

// ---------- the identity ----------

test("the ref is osm_type and osm_id, and survives a numeric id", () => {
  assert.equal(parsed(WRIGLEY).ref, "W:3374814");
  assert.equal(parsed(PARIS).ref, "R:7444");
  assert.equal(parsed(HOUSE).ref, "N:1234567");
  // Photon sends a number; a string would be just as usable and must not break.
  const asString = { ...WRIGLEY, properties: { ...WRIGLEY.properties, osm_id: "3374814" } };
  assert.equal(parsed(asString).ref, "W:3374814");
});

test("WHAT TO CHECK ON THE FIRST REAL CALL, since these fixtures were transcribed", () => {
  // Not an assertion about Photon, which this sandbox cannot reach. It is the
  // list a person should run their eye down the first time real results appear,
  // written where it cannot drift away from the parser it describes.
  //
  //   1. A known venue's pin lands in the right city, not its mirror.
  //   2. A plain address result shows a street line, not a blank name.
  //   3. The ref reads like "N:1234567" / "W:..." / "R:...".
  //
  // The parser is total over anything, so a surprise costs a missing row rather
  // than a crash; this test exists to keep that list beside the code.
  assert.equal(parsePhotonFeature({ geometry: { coordinates: [0, 0] } }), null);
});

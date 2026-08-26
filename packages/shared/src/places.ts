// A PHOTON SEARCH RESULT, TURNED INTO SOMETHING THE APP CAN STORE.
//
// THE COORDINATE ORDER IS THE WHOLE REASON THIS IS A SEPARATE, TESTED FILE.
// Photon answers in GeoJSON, and GeoJSON is [LONGITUDE, LATITUDE]: the opposite
// of how every human writes a coordinate and the opposite of how Google Maps
// URLs order them. A swapped pair is the worst kind of bug this app could ship,
// because NOTHING FAILS. The value is still a number, the row still saves, the
// map link still builds, and the night is silently in the Indian Ocean. So
// nothing downstream of this file ever sees the raw array: it comes out named
// `lat` and `lng` and stays that way through the schema, the payload and the UI.
//
// EVERYTHING IS REJECTED RATHER THAN PATCHED UP. A feature missing its geometry,
// its identity, or anything to call itself yields null, and the caller drops it.
// A half-built row in a list of places is worse than a shorter list: it is a
// thing a host can tap.

/** One searchable place, in the app's own vocabulary rather than Photon's. */
export interface Place {
  /** What the row calls it. Never empty; see nameAndAddress. */
  name: string;
  /** The line under the name. May be empty when there is nothing more to say. */
  address: string;
  lat: number;
  lng: number;
  /**
   * Photon's identity for the place, as "{osm_type}:{osm_id}" (e.g. "N:1234567").
   *
   * REQUIRED, and that is a deliberate coupling to the write rule rather than an
   * accident: the event row sets `location_lat`, `location_lng` and
   * `location_ref` together or not at all, so a parsed place that could not be
   * saved whole is not a place this app can use. Photon returns both fields on
   * every real result.
   */
  ref: string;
}

/** Latitude is degrees north; anything outside this is not a place on Earth. */
const MAX_LAT = 90;
/** Longitude is degrees east. */
const MAX_LNG = 180;

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Join present parts with commas. The filter is what stops ", , Illinois". */
const join = (parts: string[]): string => parts.filter(Boolean).join(", ");

/**
 * What to call this place, and what to put underneath it.
 *
 * COMPUTED TOGETHER because they have to agree. A result with no `name` is a
 * plain address, and its name becomes the street line, which means the street
 * must NOT also appear in the address underneath or the row says the same thing
 * twice. Deriving them separately and then de-duplicating gets that wrong for
 * exactly the case it matters: "North Clark Street" is not equal to "1060 North
 * Clark Street", so a string comparison would keep both.
 */
function nameAndAddress(p: Record<string, unknown>): { name: string; address: string } {
  const named = clean(p.name);
  const house = clean(p.housenumber);
  const street = clean(p.street);
  const city = clean(p.city);
  const state = clean(p.state);
  const streetLine = house && street ? `${house} ${street}` : street;

  if (named) return { name: named, address: join([streetLine, city, state]) };
  if (streetLine) return { name: streetLine, address: join([city, state]) };
  // Nothing but a settlement. Still nameable, so still tappable.
  if (city) return { name: city, address: state };
  if (state) return { name: state, address: "" };
  return { name: "", address: "" };
}

/**
 * One Photon GeoJSON feature, or null if it cannot be used whole.
 *
 * Takes `unknown` on purpose: this is the boundary between somebody else's
 * server and our types, and the only honest thing to accept from it is anything.
 */
export function parsePhotonFeature(feature: unknown): Place | null {
  if (!feature || typeof feature !== "object") return null;
  const f = feature as Record<string, unknown>;

  const geometry = f.geometry as Record<string, unknown> | undefined;
  const coords = geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;

  // [LONGITUDE, LATITUDE]. See the note at the top of this file; this line and
  // the one below it are the entire reason the file exists.
  const lng = coords[0];
  const lat = coords[1];
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > MAX_LAT || Math.abs(lng) > MAX_LNG) return null;

  const props = (f.properties ?? {}) as Record<string, unknown>;

  const osmType = clean(props.osm_type);
  const osmId =
    typeof props.osm_id === "number" && Number.isFinite(props.osm_id)
      ? String(props.osm_id)
      : clean(props.osm_id);
  if (!osmType || !osmId) return null;

  const { name, address } = nameAndAddress(props);
  // A row with nothing to print is a row a host can tap by accident.
  if (!name && !address) return null;

  return { name, address, lat, lng, ref: `${osmType}:${osmId}` };
}

/**
 * The map link for a picked place.
 *
 * A GEO QUERY RATHER THAN A PROVIDER PAGE, so the host's own device opens
 * whatever map app it prefers, and so this app is not quietly sending everyone
 * to one company. The order here is the HUMAN one (lat then lng), which is the
 * opposite of the GeoJSON above: that mismatch is exactly what this file exists
 * to keep in one place.
 */
export function mapUrlFor(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

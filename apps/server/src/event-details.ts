// WHERE THE NIGHT IS AND WHAT TO BRING, validated in one place for two routes.
//
// Create and PATCH both take these three fields and must agree about them
// exactly, which is why this is a function rather than two copies: a cap
// enforced on create and forgotten on PATCH is a cap that does not exist.
//
// IT RETURNS ONLY THE KEYS THAT WERE SENT, and that is the whole reason PATCH
// can be partial. A body carrying just `notes` must not blank the location, so
// "absent" and "sent as empty" are kept apart all the way down: absent is not in
// the returned object at all, empty string comes back as `null`, which is how a
// host CLEARS one.

import { isHttpsUrl } from "@gamenight/shared";

/** Caps, enforced here rather than by the column, which is plain `text`. */
export const EVENT_LOCATION_MAX = 120;
export const EVENT_LOCATION_URL_MAX = 500;
export const EVENT_NOTES_MAX = 1000;
/** "{osm_type}:{osm_id}". Short by construction; the cap is a sanity bound. */
export const EVENT_LOCATION_REF_MAX = 64;

/** Degrees north. Outside this is not a place on Earth, so it is refused. */
const MAX_LAT = 90;
/** Degrees east. */
const MAX_LNG = 180;

export interface EventDetailFields {
  location?: string | null;
  locationUrl?: string | null;
  notes?: string | null;
  /** The three below are ONE unit. See parseCoordinates. */
  locationLat?: number | null;
  locationLng?: number | null;
  locationRef?: string | null;
}

export type DetailParse =
  | { ok: true; fields: EventDetailFields }
  | { ok: false; error: string };

const TEXT_FIELDS = [
  ["location", "location", EVENT_LOCATION_MAX] as const,
  ["notes", "notes", EVENT_NOTES_MAX] as const,
];

/**
 * Read the three optional detail fields off a request body.
 *
 * `null` and `""` both mean CLEAR IT, because the two arrive from different
 * places for the same intent: a client sending JSON null, and a host emptying a
 * text input. Refusing one of them would make clearing a field depend on which
 * screen you were on.
 */
export function parseEventDetails(body: unknown): DetailParse {
  const b = (body ?? {}) as Record<string, unknown>;
  const fields: EventDetailFields = {};

  for (const [key, label, max] of TEXT_FIELDS) {
    if (!(key in b)) continue;
    const raw = b[key];
    if (raw === null || raw === undefined) {
      fields[key] = null;
      continue;
    }
    if (typeof raw !== "string") {
      return { ok: false, error: `${label} must be text` };
    }
    const trimmed = raw.trim();
    if (trimmed.length > max) {
      return { ok: false, error: `${label} must be ${max} characters or fewer` };
    }
    fields[key] = trimmed || null;
  }

  if ("locationUrl" in b) {
    const raw = b.locationUrl;
    if (raw === null || raw === undefined || raw === "") {
      fields.locationUrl = null;
    } else if (typeof raw !== "string") {
      return { ok: false, error: "map link must be text" };
    } else {
      const trimmed = raw.trim();
      if (!trimmed) {
        fields.locationUrl = null;
      } else if (trimmed.length > EVENT_LOCATION_URL_MAX) {
        return {
          ok: false,
          error: `map link must be ${EVENT_LOCATION_URL_MAX} characters or fewer`,
        };
      } else if (!isHttpsUrl(trimmed)) {
        // A 400 SAYING WHY, not a silent drop. A host who pastes an http link
        // and gets a night with no map link and no explanation will paste it
        // again. The rule is an allowlist of one protocol; see isHttpsUrl.
        return { ok: false, error: "A map link must start with https://" };
      } else {
        fields.locationUrl = trimmed;
      }
    }
  }

  const coords = parseCoordinates(b);
  if (!coords.ok) return coords;
  Object.assign(fields, coords.fields);

  return { ok: true, fields };
}

/**
 * The three place fields, which are ONE VALUE IN THREE COLUMNS.
 *
 * ALL THREE OR NONE, ENFORCED HERE RATHER THAN TRUSTED. A latitude with no
 * longitude is not a partial location, it is a row that means nothing; and a
 * coordinate with no ref is a pin that can never be re-resolved. The client
 * sends them together, but "the client sends them together" is not a
 * constraint, it is a habit, and the write is where a habit becomes a rule.
 *
 * THE TRIO IS STILL ABSENT-ABLE, which is what keeps PATCH partial: a body
 * carrying only `notes` mentions none of these keys, so none of them is written
 * and a night keeps the place it already had. Only a body that mentions at least
 * one of them is making a statement about all three.
 *
 * REFUSED, NOT CLAMPED. A latitude of 91 is not a place slightly past the pole,
 * it is a bug upstream of us, and clamping would write a plausible wrong answer
 * to a column nothing else validates.
 */
function parseCoordinates(b: Record<string, unknown>): DetailParse {
  const keys = ["locationLat", "locationLng", "locationRef"] as const;
  if (!keys.some((k) => k in b)) return { ok: true, fields: {} };

  const empty = (v: unknown) => v === null || v === undefined || v === "";
  if (keys.every((k) => empty(b[k]))) {
    // Clearing. All three go together for the same reason they arrive together.
    return { ok: true, fields: { locationLat: null, locationLng: null, locationRef: null } };
  }

  const lat = b.locationLat;
  const lng = b.locationLng;
  const ref = b.locationRef;

  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: "a place needs both a latitude and a longitude" };
  }
  if (Math.abs(lat) > MAX_LAT) return { ok: false, error: "latitude must be between -90 and 90" };
  if (Math.abs(lng) > MAX_LNG) return { ok: false, error: "longitude must be between -180 and 180" };

  if (typeof ref !== "string" || !ref.trim()) {
    return { ok: false, error: "a place needs its reference" };
  }
  const trimmed = ref.trim();
  if (trimmed.length > EVENT_LOCATION_REF_MAX) {
    return { ok: false, error: `place reference must be ${EVENT_LOCATION_REF_MAX} characters or fewer` };
  }

  return { ok: true, fields: { locationLat: lat, locationLng: lng, locationRef: trimmed } };
}

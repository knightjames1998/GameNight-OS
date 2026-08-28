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

export interface EventDetailFields {
  location?: string | null;
  locationUrl?: string | null;
  notes?: string | null;
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

  return { ok: true, fields };
}

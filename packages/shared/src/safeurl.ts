// IS THIS PASTED STRING SAFE TO PUT BEHIND A LINK?
//
// `events.location_url` is the only user-pasted string this app has ever
// rendered as a navigable link, and it is written by any member of a crew. The
// rule lives in the SHARED package because it has to be applied TWICE: the
// server refuses a bad one on write, and the client refuses to render one it
// somehow holds. Two copies of a security rule drift; one copy called from both
// ends cannot.
//
// WHY THE RENDER GUARD EXISTS EVEN THOUGH THE WRITE IS GUARDED: the write-time
// rule can be relaxed later by somebody who does not know the render side trusts
// it, and rows written before a rule existed keep whatever they were given. The
// last line of defence belongs next to the thing that would do the damage.

/**
 * HTTPS ONLY. Not "not javascript:", which is a blocklist and therefore a game
 * of remembering every scheme (`data:`, `vbscript:`, `blob:`, whatever ships
 * next). An allowlist of exactly one protocol is the version that cannot be
 * out-thought, and a map link that is not https in 2026 is not a link worth
 * following anyway.
 *
 * Parsing with `new URL` rather than a regex, because a regex on URLs is how
 * `java\nscript:` gets through: the browser's own parser is the thing that will
 * eventually resolve this, so it is the thing that should decide what it is.
 */
export function isHttpsUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    return new URL(trimmed).protocol === "https:";
  } catch {
    // Not a URL at all. A relative path lands here too, which is correct: this
    // field is for somewhere else, and an internal link would be a raw anchor
    // out of the SPA (see standing rule 4).
    return false;
  }
}

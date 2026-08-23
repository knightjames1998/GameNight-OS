// The pack-page shell: everything the four pack pages did identically.
//
// Each pack page carried its own copy of roughly a hundred and twenty lines:
// the ctx/session/loading/err/busy/reqSeq state, a refetch() that Promise.alls
// the context and the session, a call() with an optimistic update, a snapshot
// rollback and a newest-request-wins guard, and a startSession() with the 409
// confirm-and-replace dance. Four copies, and they had already drifted.
//
// The pages keep ALL of their own rendering. That is the part where packs must
// stay different: a Mario Party board entry screen and a ping pong one-tap
// scoring screen have nothing in common and should not be pushed toward each
// other. What is shared here is only the plumbing that was already identical.
//
// ---------------------------------------------------------------------------
// WHY THIS DOES NOT USE THE CLIENT CACHE (src/cache.ts), despite the backlog
// entry suggesting it should.
//
// Phase 8a's own rule is that a pack's LIVE SESSION must never be served from
// cache, and that rule wins here. Everywhere else, a stale render is a
// cosmetic problem that corrects itself a moment later. On a live pack screen
// it is a correctness problem, because the screen is not just showing state,
// it is offering BUTTONS THAT WRITE. Painting a cached roster means someone
// can tap a player who is no longer in the session, or record a result into a
// session the host has already replaced, and the write lands before the
// revalidation arrives to say so. The launch context is excluded for the same
// reason: it carries the member list the setup roster is built from, and the
// `live` flag that decides whether the page offers to start at all.
//
// So this hook deliberately fetches fresh every time, and the pack pages are
// the one place in the app that still shows a loading state on a return
// visit. That is the correct trade, and it is a small cost: you reach these
// screens once per night and then stay on them.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { usePackLive } from "./useLiveUpdates";
import type { PrefillSource } from "./RosterCarryOver";

/** The launch context every pack's *-context endpoint returns. */
export interface PackCtx {
  groupId: string;
  canHost: boolean;
  viewerId: string;
  /**
   * What the roster opens with. NOT THE YES LIST ANY MORE: it is whichever rung
   * of the prefill chain answered (the last session's roster on this night, then
   * who showed, then who said yes), which is why a slot can now be a GUEST
   * carried over from the last game and `userId` is nullable.
   */
  prefill: { userId: string | null; name: string }[];
  members: { userId: string; name: string }[];
  live: boolean;
  /** Which rung answered. The screen says so; a silent change would not do. */
  prefillSource: PrefillSource;
  /** The pack's display name when the source is a session, else "". */
  prefillLabel: string;
  /** The yes list, always, so a screen can offer it back in one tap. */
  rsvpPrefill: { userId: string | null; name: string }[];
  /** Guest names typed on this crew before, newest first. */
  recentGuests: string[];
}

/**
 * `C` widens the launch context for a pack whose *-context endpoint returns
 * more than the shared envelope. Board Game is the first: its endpoint adds the
 * crew's own recent titles, because the setup screen needs them BEFORE the
 * first game is recorded and they are the pack's main defence against a
 * free-text title splitting a crew's history. It defaults to PackCtx, so every
 * other pack is untouched.
 */
export interface PackSessionApi<S, C extends PackCtx = PackCtx> {
  ctx: C | null;
  session: S | null;
  /** True only until the first load settles. */
  loading: boolean;
  /** True while a write is in flight; pages use it to disable taps. */
  busy: boolean;
  err: string | null;
  setErr: (e: string | null) => void;
  refetch: () => Promise<void>;
  /**
   * POST to a pack route and apply the session it returns.
   *
   * `optimistic` paints a simple change (a character pick, a toggle) before
   * the network answers and is rolled back to the snapshot on failure. Only
   * pass it for changes the client can predict exactly; anything the server
   * derives (placements, standings, a KOTH throne) must wait for the response.
   */
  call: (path: string, body?: unknown, optimistic?: (s: S) => S) => Promise<void>;
  /** Start a session, with the confirm-and-replace dance on a 409. */
  startSession: (payload: Record<string, unknown>) => Promise<void>;
}

export interface PackSessionOptions {
  /** Route slug: also the API path segment, e.g. "mariokart". */
  pack: string;
  /** The live-sync message type this pack broadcasts. */
  wsType: string;
  eventId: string | null;
  /**
   * The confirm text shown when a session is already in progress. Pack
   * specific on purpose: it has to name what is actually lost, which is a
   * race, a set, a match or a board depending on the pack.
   */
  replacePrompt: string;
}

export function usePackSession<S, C extends PackCtx = PackCtx>(
  opts: PackSessionOptions,
): PackSessionApi<S, C> {
  const { pack, wsType, eventId, replacePrompt } = opts;
  const [ctx, setCtx] = useState<C | null>(null);
  const [session, setSession] = useState<S | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Newest request wins. Rapid taps race, and without this an older response
  // can land after a newer one and put the screen back in time.
  const reqSeq = useRef(0);

  const refetch = useCallback(async () => {
    if (!eventId) return;
    const [c, s] = await Promise.all([
      api<C>(`/api/${pack}-context/${eventId}`).catch(() => null),
      api<{ session: S | null }>(`/api/${pack}/${eventId}`).catch(() => ({ session: null })),
    ]);
    // The context is allowed to fail without wiping what we have: it is
    // secondary to the session and a null would blank the setup screen.
    if (c) setCtx(c);
    setSession(s.session);
  }, [pack, eventId]);

  useEffect(() => {
    setLoading(true);
    refetch().finally(() => setLoading(false));
  }, [refetch]);

  usePackLive(wsType, eventId, refetch);

  const call = useCallback(
    async (path: string, body?: unknown, optimistic?: (s: S) => S) => {
      setErr(null);
      const prev = session;
      const seq = ++reqSeq.current;
      if (optimistic && session) setSession(optimistic(session));
      setBusy(true);
      try {
        const r = await api<{ session: S | null }>(path, {
          method: "POST",
          body: body ? JSON.stringify(body) : undefined,
        });
        if (seq === reqSeq.current && r && typeof r === "object" && "session" in r) {
          setSession(r.session);
        }
      } catch (e) {
        // Roll back only what we painted ourselves. A failed write that had no
        // optimistic update must leave the screen alone.
        if (seq === reqSeq.current && optimistic) setSession(prev);
        setErr(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setBusy(false);
      }
    },
    [session],
  );

  /**
   * Standing rule 8: never clobber a session already in progress. The server
   * answers 409 when one is live; the host confirms, and only then do we
   * resend with force. Never a silent replace.
   */
  const startSession = useCallback(
    async (payload: Record<string, unknown>): Promise<void> => {
      setErr(null);
      setBusy(true);
      try {
        const r = await api<{ session: S | null }>(`/api/events/${eventId}/${pack}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (r && typeof r === "object" && "session" in r) setSession(r.session);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          // Drop busy before the blocking confirm, or the page stays frozen
          // behind the dialog for as long as the host takes to decide.
          setBusy(false);
          if (window.confirm(replacePrompt)) {
            await startSession({ ...payload, force: true });
          }
          return;
        }
        setErr(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setBusy(false);
      }
    },
    [eventId, pack, replacePrompt],
  );

  return { ctx, session, loading, busy, err, setErr, refetch, call, startSession };
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  compositionSize,
  sdTitleDef,
  suggestComposition,
  tnTitleSuggestions,
  validateComposition,
  SD_MAX_PLAYERS,
  SD_TITLES,
  SESSION_PACKS,
  type SdAlignment,
  type SdDealSummary,
  type SdNightSummary,
  type SdPlayer,
  type SdRoleCount,
  type SdTitleDef,
} from "@gamenight/shared";
import { api } from "../api";
import BackButton from "../BackButton";
import { usePackSession, type PackCtx } from "../usePackSession";

// The Social Deduction page: set up the night, deal the roles, reveal, record.
//
// NO STYLESHEET OF ITS OWN, and that is deliberate rather than unfinished. This
// pack's visual identity has not been decided, and a palette invented here
// would be a decision made by whoever typed fastest. So the page is built out
// of the shell's existing `gn-*` layer and Arcade tokens only, which is the one
// thing guaranteed to survive a theme swap, and the pack's own design language
// (standing rule 3) arrives with its TV.
//
// ---------------------------------------------------------------------------
// WHY THE ROLE READS DO NOT GO THROUGH useCachedApi.
//
// Every other read on a screen like this is a candidate for the stale-while-
// revalidate cache, and `usePackSession` already explains why a pack's LIVE
// SESSION is not (a cached roster means tapping a player who is no longer in
// the session). The role routes fail a second test on top of that one:
// useCachedApi WRITES THROUGH TO localStorage, and a role is a secret with a
// lifetime of about twenty minutes. Persisting it would leave the answer to
// "who was the wolf" on the device after the game, after the night, and across
// packs, and a re-deal would be served the previous game's answer until a
// revalidation landed. So both role reads are plain fetches, on demand, and
// nothing about them is stored anywhere.
// ---------------------------------------------------------------------------

const PACK = SESSION_PACKS.deduction;

interface SdCtx extends PackCtx {
  recentTitles: string[];
}

interface SdSessionView {
  status: "setup" | "live" | "completed";
  groupId: string;
  openScoring: boolean;
  nowPlaying: string | null;
  roster: SdPlayer[];
  deal: SdDealSummary | null;
  games: { idx: number; title: string; at: string; factions: { name: string; placement: number; memberIds: string[] }[] }[];
  summary: SdNightSummary;
}

interface MyRole {
  dealNo: number | null;
  title: string | null;
  playerId: string | null;
  role: { id: string; name: string; factionId: string; factionName: string; alignment: SdAlignment } | null;
}

interface DealLine {
  playerId: string;
  name: string;
  roleId: string;
  roleName: string;
  factionId: string;
  factionName: string;
  alignment: SdAlignment;
}

/** What the room calls each side, in one place so the copy cannot drift. */
const ALIGNMENT_WORD: Record<SdAlignment, string> = {
  town: "village side",
  evil: "evil side",
  solo: "on their own",
};

export default function DeductionPage() {
  // Never cached at module scope: a same-route navigation to another event
  // would keep the old id forever.
  const eventId = new URLSearchParams(window.location.search).get("event") ?? "";
  const { ctx, session, loading, busy, err, call, startSession } = usePackSession<SdSessionView, SdCtx>({
    pack: PACK.route,
    wsType: PACK.wsType,
    eventId,
    replacePrompt:
      "A session is already in progress on this event. Replace it? Every game recorded in the current session stays in your stats, but the session itself is ended.",
  });

  if (!eventId) {
    return (
      <main className="gn-app">
        <div className="gn-wrap space-y-4">
          <p className="gn-hint">No event specified.</p>
          <BackButton />
        </div>
      </main>
    );
  }
  if (loading) {
    return (
      <main className="gn-app">
        <div className="gn-wrap">
          <p className="gn-hint">Loading...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="gn-app">
      <div className="gn-wrap space-y-4">
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <BackButton />
          {/* A way back to the NIGHT this pack belongs to, which the
              history-based Back button cannot promise: somebody who opened a
              shared link in a fresh tab has no history to pop, so Back sends
              them home rather than to the event they were sent to. Standing
              rule: every pack screen has both. There is no TV link yet, because
              there is no TV yet, and a link to a screen that would show the
              lobby is worse than no link. */}
          <Link to={`/e/${eventId}`} className="gn-textbtn">🎪 Event</Link>
        </div>

        <div>
          <h1 className="gn-title text-2xl">{PACK.emoji} Social Deduction</h1>
          <p className="gn-hint mt-1">Deal in secret, argue, record who won.</p>
        </div>

        {err && <p style={{ color: "var(--gn-danger)" }}>{err}</p>}

        {!session || session.status === "completed" ? (
          <Setup
            ctx={ctx}
            completed={session?.status === "completed"}
            busy={busy}
            onStart={(payload) => startSession(payload)}
          />
        ) : (
          <Live eventId={eventId} ctx={ctx} session={session} busy={busy} call={call} />
        )}
      </div>
    </main>
  );
}

// ---------- setup ----------

function Setup({
  ctx,
  completed,
  busy,
  onStart,
}: {
  ctx: SdCtx | null;
  completed: boolean;
  busy: boolean;
  onStart: (p: Record<string, unknown>) => void;
}) {
  const [roster, setRoster] = useState<{ userId: string | null; name: string }[]>([]);
  const [guest, setGuest] = useState("");

  useEffect(() => {
    if (ctx && roster.length === 0) {
      setRoster(ctx.prefill.slice(0, SD_MAX_PLAYERS).map((p) => ({ userId: p.userId, name: p.name })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  if (!ctx) return <p className="gn-hint">Loading...</p>;

  if (!ctx.canHost) {
    return (
      <div className="gn-card">
        <h2 className="gn-h2">Waiting for the host</h2>
        <p className="gn-hint mt-1">
          The crew owner or an admin starts the night and deals. This screen updates live the moment they do.
        </p>
      </div>
    );
  }

  const full = roster.length >= SD_MAX_PLAYERS;
  const addMember = (m: { userId: string; name: string }) => {
    if (!full && !roster.some((r) => r.userId === m.userId)) setRoster([...roster, { userId: m.userId, name: m.name }]);
  };
  const addGuest = () => {
    const n = guest.trim().slice(0, 24);
    if (n && !full) setRoster([...roster, { userId: null, name: n }]);
    setGuest("");
  };
  const notAdded = ctx.members.filter((m) => !roster.some((r) => r.userId === m.userId));

  return (
    <>
      {completed && (
        <div className="gn-card">
          <p className="gn-hint">That night wrapped. Starting again begins a fresh session for this event.</p>
        </div>
      )}

      <div className="gn-card space-y-2">
        <h2 className="gn-h2">
          Who is playing ({roster.length}/{SD_MAX_PLAYERS})
        </h2>
        {roster.map((r, i) => (
          <div key={`${r.userId ?? "g"}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1 }}>{r.name}</span>
            {!r.userId && <span className="gn-chip gn-chip--member">guest</span>}
            <button className="gn-textbtn" onClick={() => setRoster(roster.filter((_, j) => j !== i))}>
              remove
            </button>
          </div>
        ))}
        {roster.length === 0 && (
          <p className="gn-hint">Add everybody at the table. Three at a minimum, and it is a better game at seven.</p>
        )}

        {notAdded.length > 0 && !full && (
          <>
            <div className="gn-lab mt-3">Add from crew</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {notAdded.map((m) => (
                <button key={m.userId} className="gn-actionbtn" onClick={() => addMember(m)}>
                  + {m.name}
                </button>
              ))}
            </div>
          </>
        )}
        {!full && (
          <>
            <div className="gn-lab mt-3">Add a guest</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="gn-input"
                placeholder="Guest name"
                value={guest}
                onChange={(e) => setGuest(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addGuest()}
              />
              <button className="gn-btn gn-btn--ghost" style={{ width: "auto", padding: "0 16px" }} onClick={addGuest}>
                Add
              </button>
            </div>
          </>
        )}
        <p className="gn-hint">
          Guests play and are dealt roles like anybody else. Lifetime stats only count crew members, and a guest can be
          linked to one later.
        </p>
      </div>

      {ctx.recentTitles.length > 0 && (
        <div className="gn-card">
          <h2 className="gn-h2">You have played</h2>
          <p className="gn-hint mt-1">{ctx.recentTitles.slice(0, 8).join(", ")}</p>
        </div>
      )}

      <button className="gn-btn gn-btn--go" disabled={busy || roster.length < 3} onClick={() => onStart({ roster })}>
        {roster.length < 3 ? "Add at least 3 players" : "Start the night"}
      </button>
    </>
  );
}

// ---------- live ----------

function Live({
  eventId,
  ctx,
  session,
  busy,
  call,
}: {
  eventId: string;
  ctx: SdCtx | null;
  session: SdSessionView;
  busy: boolean;
  call: (path: string, body?: unknown) => Promise<void>;
}) {
  const canHost = ctx?.canHost ?? false;
  const canScore = canHost || session.openScoring;
  const at = (path: string) => `/api/${PACK.route}/${eventId}/${path}`;
  const suggestions = useMemo(
    () => tnTitleSuggestions(ctx?.recentTitles ?? [], SD_TITLES),
    [ctx?.recentTitles],
  );
  const title = session.deal?.title ?? session.nowPlaying ?? "";
  const def = useMemo(() => sdTitleDef(title), [title]);

  return (
    <>
      <OnTheTable at={at} session={session} suggestions={suggestions} canScore={canScore} busy={busy} call={call} />

      {canHost && <DealCard at={at} session={session} def={def} busy={busy} call={call} />}

      <MyRoleCard eventId={eventId} dealNo={session.deal?.dealNo ?? null} />

      {canHost && session.deal && <HostDealCard eventId={eventId} dealNo={session.deal.dealNo} />}

      {canScore ? (
        <RecordResult
          eventId={eventId}
          session={session}
          def={def}
          title={title}
          canHost={canHost}
          busy={busy}
          onRecord={(payload) => call(at("record"), payload)}
        />
      ) : (
        <div className="gn-card">
          <p className="gn-hint">The host records results. Standings update live below.</p>
        </div>
      )}

      <Standings session={session} />

      {canHost && (
        <div className="gn-card space-y-3">
          <h2 className="gn-h2">Host controls</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1 }}>Let members record results</span>
            <button
              className={`gn-toggle ${session.openScoring ? "gn-toggle--on" : "gn-toggle--off"}`}
              aria-pressed={session.openScoring}
              onClick={() => call(at("open-scoring"), { open: !session.openScoring })}
            >
              {session.openScoring ? "ON" : "OFF"}
            </button>
          </div>
          {/* Dealing stays host-only whatever this toggle says: recording is a
              claim about a game everybody watched, and dealing is the one
              action whose caller could learn the whole table by taking it. */}
          <p className="gn-hint">Dealing is always host only, whatever this is set to.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="gn-btn gn-btn--ghost"
              disabled={busy || session.games.length === 0}
              onClick={() => call(at("undo"))}
            >
              ↶ Undo last
            </button>
            <button className="gn-btn gn-btn--go" disabled={busy} onClick={() => call(at("complete"))}>
              End the night
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- what is on the table ----------

function OnTheTable({
  at,
  session,
  suggestions,
  canScore,
  busy,
  call,
}: {
  at: (p: string) => string;
  session: SdSessionView;
  suggestions: string[];
  canScore: boolean;
  busy: boolean;
  call: (path: string, body?: unknown) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const [typed, setTyped] = useState("");

  const set = (title: string) => {
    void call(at("now-playing"), { title });
    setPicking(false);
    setTyped("");
  };

  return (
    <div className="gn-card space-y-2">
      <div className="gn-lab">On the table</div>
      <div className="gn-title text-xl">
        {session.nowPlaying ?? <span className="gn-hint">Between games</span>}
      </div>
      {canScore && !session.deal && (
        <>
          {!picking ? (
            <button className="gn-btn gn-btn--ghost" disabled={busy} onClick={() => setPicking(true)}>
              {session.nowPlaying ? "Change" : "Say what you are playing"}
            </button>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {suggestions.slice(0, 10).map((t) => (
                  <button key={t} className="gn-actionbtn" onClick={() => set(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="gn-input"
                  placeholder="Something else"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && typed.trim() && set(typed)}
                />
                <button
                  className="gn-btn gn-btn--ghost"
                  style={{ width: "auto", padding: "0 16px" }}
                  disabled={!typed.trim()}
                  onClick={() => set(typed)}
                >
                  Set
                </button>
              </div>
              <button className="gn-textbtn" onClick={() => setPicking(false)}>
                cancel
              </button>
            </>
          )}
        </>
      )}
      {session.deal && (
        <p className="gn-hint">
          Dealt: {session.deal.composition.map((c) => `${c.count} ${roleName(session.deal!.title, c.roleId)}`).join(", ")}.
          Everybody can read their own role below.
        </p>
      )}
    </div>
  );
}

/** A role's display name, or its id when the title's catalogue has moved on. */
function roleName(title: string, roleId: string): string {
  return sdTitleDef(title).roles.find((r) => r.id === roleId)?.name ?? roleId;
}

// ---------- the deal ----------

function DealCard({
  at,
  session,
  def,
  busy,
  call,
}: {
  at: (p: string) => string;
  session: SdSessionView;
  def: SdTitleDef;
  busy: boolean;
  call: (path: string, body?: unknown) => Promise<void>;
}) {
  const size = session.roster.length;
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [seeded, setSeeded] = useState("");

  // Reseed from the suggestion whenever the title or the table changes, so the
  // host opens on a workable setup rather than a blank form. Their own edits
  // survive until one of those two actually moves.
  const seed = `${def.title}|${size}`;
  useEffect(() => {
    if (seeded === seed) return;
    const next: Record<string, number> = {};
    for (const c of suggestComposition(def, size)) next[c.roleId] = c.count;
    setCounts(next);
    setSeeded(seed);
  }, [seed, seeded, def, size]);

  const composition: SdRoleCount[] = def.roles
    .filter((r) => (counts[r.id] ?? 0) > 0)
    .map((r) => ({ roleId: r.id, count: counts[r.id]! }));
  const dealt = compositionSize(composition);
  const problem = validateComposition(def, composition, size);
  const bump = (roleId: string, by: number) =>
    setCounts((c) => ({ ...c, [roleId]: Math.max(0, (c[roleId] ?? 0) + by) }));

  if (session.deal) {
    return (
      <div className="gn-card space-y-2">
        <h2 className="gn-h2">Dealt</h2>
        <p className="gn-hint">
          Deal {session.deal.dealNo} of the night. Nobody sees anybody else&rsquo;s role, including on this screen: pass
          the phone round, or let everybody open the night on their own.
        </p>
        <button className="gn-btn gn-btn--ghost" disabled={busy} onClick={() => call(at("undeal"))}>
          Take it back and deal again
        </button>
      </div>
    );
  }

  return (
    <div className="gn-card space-y-2">
      <h2 className="gn-h2">Deal the roles</h2>
      <p className="gn-hint">
        {def.title
          ? `${def.title}, ${size} at the table.`
          : `${size} at the table. Nothing named yet, so this is the plain village-and-wolves shape.`}{" "}
        The suggestion is a starting position, never a rule.
      </p>

      {def.roles.map((r) => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1 }}>
            {r.name}
            <span className="gn-hint"> · {factionName(def, r.factionId)}</span>
          </span>
          <button className="gn-actionbtn" aria-label={`one fewer ${r.name}`} onClick={() => bump(r.id, -1)}>
            &minus;
          </button>
          <span style={{ minWidth: 24, textAlign: "center", fontWeight: 800 }}>{counts[r.id] ?? 0}</span>
          <button className="gn-actionbtn" aria-label={`one more ${r.name}`} onClick={() => bump(r.id, 1)}>
            +
          </button>
        </div>
      ))}

      <p className="gn-hint">
        {dealt} of {size} seats filled.
      </p>
      <button
        className="gn-btn gn-btn--go"
        disabled={busy || !!problem}
        onClick={() => call(at("deal"), { title: def.title || session.nowPlaying || "", composition })}
      >
        {problem ?? "Deal"}
      </button>
    </div>
  );
}

const factionName = (def: SdTitleDef, id: string) => def.factions.find((f) => f.id === id)?.name ?? id;

// ---------- your own role ----------

/**
 * YOUR ROLE, AND ONLY YOURS.
 *
 * Behind a tap rather than on screen, because the first thing that happens in
 * this game is somebody leaning over to look at your phone. The fetch happens
 * on the tap too, so a role is not sitting in this component's state through
 * the argument that follows.
 */
function MyRoleCard({ eventId, dealNo }: { eventId: string; dealNo: number | null }) {
  const [mine, setMine] = useState<MyRole | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new deal invalidates whatever was on screen. Hiding it is not enough: the
  // old answer has to leave, or a tap would show the previous game's role.
  useEffect(() => {
    setMine(null);
    setShown(false);
  }, [dealNo]);

  const reveal = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setMine(await api<MyRole>(`/api/${PACK.route}/${eventId}/my-role`));
      setShown(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read your role");
    } finally {
      setBusy(false);
    }
  }, [eventId]);

  if (dealNo === null) {
    return (
      <div className="gn-card">
        <h2 className="gn-h2">Your role</h2>
        <p className="gn-hint mt-1">Nothing is dealt yet.</p>
      </div>
    );
  }

  return (
    <div className="gn-card space-y-2">
      <h2 className="gn-h2">Your role</h2>
      {error && <p style={{ color: "var(--gn-danger)" }}>{error}</p>}
      {!shown ? (
        <>
          <p className="gn-hint">Hold the phone where nobody else can see it.</p>
          <button className="gn-btn" disabled={busy} onClick={reveal}>
            {busy ? "..." : "Show me my role"}
          </button>
        </>
      ) : mine?.role ? (
        <>
          <div className="gn-title text-xl">{mine.role.name}</div>
          <p className="gn-hint">
            {mine.role.factionName} &middot; {ALIGNMENT_WORD[mine.role.alignment]}
          </p>
          <button className="gn-btn gn-btn--ghost" onClick={() => setShown(false)}>
            Hide it
          </button>
        </>
      ) : (
        <>
          <p className="gn-hint">
            {mine?.playerId
              ? "This deal has no role for you. Ask the host to deal again."
              : "You are not in tonight's roster, so you are watching this one."}
          </p>
          <button className="gn-btn gn-btn--ghost" onClick={() => setShown(false)}>
            Hide it
          </button>
        </>
      )}
    </div>
  );
}

// ---------- the moderator's copy ----------

function HostDealCard({ eventId, dealNo }: { eventId: string; dealNo: number }) {
  const [lines, setLines] = useState<DealLine[] | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLines(null);
    setShown(false);
  }, [dealNo]);

  const reveal = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ lines: DealLine[] }>(`/api/${PACK.route}/${eventId}/deal`);
      setLines(r.lines);
      setShown(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the deal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gn-card space-y-2">
      <h2 className="gn-h2">The whole deal</h2>
      {error && <p style={{ color: "var(--gn-danger)" }}>{error}</p>}
      {!shown ? (
        <>
          <p className="gn-hint">
            For whoever is moderating. Everybody else is refused this by the server, not just by a hidden button.
          </p>
          <button className="gn-btn gn-btn--ghost" disabled={busy} onClick={reveal}>
            {busy ? "..." : "Show me the table"}
          </button>
        </>
      ) : (
        <>
          {(lines ?? []).map((l) => (
            <div key={l.playerId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>{l.name}</span>
              <span className={l.alignment === "evil" ? "gn-chip gn-chip--vs" : "gn-chip gn-chip--member"}>
                {l.roleName}
              </span>
            </div>
          ))}
          <button className="gn-btn gn-btn--ghost" onClick={() => setShown(false)}>
            Hide it
          </button>
        </>
      )}
    </div>
  );
}

// ---------- record the result ----------

/**
 * Put each player on a faction, then rank the factions.
 *
 * TWO STEPS RATHER THAN ONE, because they are two different questions and the
 * second one has the interesting answer: the tie flag is what records a night
 * where a third party stole it and everybody else lost together.
 *
 * The assignment is PREFILLED FROM THE DEAL when the moderator has one, which
 * is the flow a real table takes: the game ends, the host already knows who was
 * what, and the form should not make them retype it. That prefill is the
 * host-gated route, so a member recording under open scoring assigns by hand.
 */
function RecordResult({
  eventId,
  session,
  def,
  title,
  canHost,
  busy,
  onRecord,
}: {
  eventId: string;
  session: SdSessionView;
  def: SdTitleDef;
  title: string;
  canHost: boolean;
  busy: boolean;
  onRecord: (payload: unknown) => void;
}) {
  const [typedTitle, setTypedTitle] = useState("");
  const [faction, setFaction] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<{ factionId: string; tiedWithAbove: boolean }[]>([]);
  const [prefilled, setPrefilled] = useState<number | null>(null);

  const effectiveTitle = (typedTitle || title).trim();
  const effectiveDef = useMemo(() => (typedTitle.trim() ? sdTitleDef(typedTitle) : def), [typedTitle, def]);
  const dealNo = session.deal?.dealNo ?? null;

  // Prefill once per deal, and only for a host, who is the only caller the deal
  // route answers. A failure is silent on purpose: assigning by hand is the
  // fallback the screen already offers, and an error banner over a form that
  // works would be noise.
  useEffect(() => {
    if (!canHost || dealNo === null || prefilled === dealNo) return;
    let live = true;
    void api<{ lines: DealLine[] }>(`/api/${PACK.route}/${eventId}/deal`)
      .then((r) => {
        if (!live) return;
        const next: Record<string, string> = {};
        for (const l of r.lines) next[l.playerId] = l.factionId;
        setFaction(next);
        setPrefilled(dealNo);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [canHost, dealNo, prefilled, eventId]);

  const playing = session.roster.filter((p) => faction[p.id]);
  const used = effectiveDef.factions.filter((f) => playing.some((p) => faction[p.id] === f.id));
  const inOrder = new Set(order.map((o) => o.factionId));
  const remaining = used.filter((f) => !inOrder.has(f.id));

  // Competition ranking, computed here only so the screen can SHOW it. The
  // server recomputes it from the same order; this never travels.
  const placements = order.map((_, i) => i + 1);
  for (let i = 1; i < order.length; i++) {
    if (order[i]!.tiedWithAbove) placements[i] = placements[i - 1]!;
  }

  const ready = !!effectiveTitle && order.length >= 2 && remaining.length === 0 && playing.length >= 3;

  const record = () => {
    onRecord({
      title: effectiveTitle,
      order: order.map((o) => ({
        factionId: o.factionId,
        tiedWithAbove: o.tiedWithAbove,
        memberIds: playing.filter((p) => faction[p.id] === o.factionId).map((p) => p.id),
      })),
    });
    setTypedTitle("");
    setFaction({});
    setOrder([]);
    setPrefilled(null);
  };

  return (
    <div className="gn-card space-y-3">
      <h2 className="gn-h2">Record the result</h2>

      {!title && (
        <>
          <div className="gn-lab">What did you play</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SD_TITLES.map((t) => (
              <button
                key={t}
                className={effectiveTitle === t ? "gn-chip gn-chip--stats" : "gn-actionbtn"}
                onClick={() => setTypedTitle(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <input
            className="gn-input"
            placeholder="Or type a title"
            value={typedTitle}
            onChange={(e) => setTypedTitle(e.target.value)}
          />
        </>
      )}
      {title && <p className="gn-hint">Recording {title}, the game on the table.</p>}

      <div className="gn-lab">Who was on what</div>
      {session.roster.map((p) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 100 }}>{p.name}</span>
          {effectiveDef.factions.map((f) => (
            <button
              key={f.id}
              className={faction[p.id] === f.id ? "gn-chip gn-chip--stats" : "gn-actionbtn"}
              onClick={() =>
                setFaction((cur) => {
                  const next = { ...cur };
                  if (next[p.id] === f.id) delete next[p.id];
                  else next[p.id] = f.id;
                  return next;
                })
              }
            >
              {f.name}
            </button>
          ))}
        </div>
      ))}
      <p className="gn-hint">
        Anybody who sat this one out just stays unassigned. Their night is not affected.
      </p>

      <div className="gn-lab">Finish order (tap the winning faction first)</div>
      {remaining.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {remaining.map((f) => (
            <button
              key={f.id}
              className="gn-actionbtn"
              onClick={() => setOrder([...order, { factionId: f.id, tiedWithAbove: false }])}
            >
              + {f.name}
            </button>
          ))}
        </div>
      )}
      {order.map((o, i) => (
        <div key={o.factionId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`gn-rank ${placements[i] === 1 ? "gn-rank--top" : ""}`} style={{ minWidth: 20 }}>
            {placements[i]}
          </span>
          <span style={{ flex: 1 }}>{factionName(effectiveDef, o.factionId)}</span>
          {i > 0 && (
            <button
              className={o.tiedWithAbove ? "gn-chip gn-chip--vs" : "gn-actionbtn"}
              aria-pressed={o.tiedWithAbove}
              onClick={() => setOrder(order.map((e, j) => (j === i ? { ...e, tiedWithAbove: !e.tiedWithAbove } : e)))}
            >
              lost with the one above
            </button>
          )}
          <button className="gn-textbtn" onClick={() => setOrder(order.filter((_, j) => j !== i))}>
            x
          </button>
        </div>
      ))}
      {order.length > 0 && (
        <p className="gn-hint">
          Everybody on the winning faction wins together. A third party who stole it goes first, and the sides that lost
          to them are marked as losing together.
        </p>
      )}

      <button className="gn-btn gn-btn--go" disabled={busy || !ready} onClick={record}>
        {!effectiveTitle
          ? "Pick what you played"
          : playing.length < 3
            ? "Put at least 3 players on a faction"
            : remaining.length > 0
              ? `${remaining.length} faction${remaining.length === 1 ? "" : "s"} still to rank`
              : order.length < 2
                ? "Rank the factions"
                : "Record it"}
      </button>
    </div>
  );
}

// ---------- the night so far ----------

function Standings({ session }: { session: SdSessionView }) {
  const s = session.summary;
  return (
    <div className="gn-card space-y-2">
      <h2 className="gn-h2">
        Tonight ({session.games.length} game{session.games.length === 1 ? "" : "s"})
      </h2>
      {s.players.length === 0 ? (
        <p className="gn-hint">No games recorded yet.</p>
      ) : (
        <>
          {s.players.map((p, i) => (
            <div key={p.playerId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`gn-rank ${i === 0 ? "gn-rank--top" : ""}`} style={{ minWidth: 20 }}>
                {i + 1}
              </span>
              <span style={{ flex: 1 }}>{p.name}</span>
              <span className="gn-hint">
                {p.wins}W / {p.games} &middot; village {p.townWins}/{p.townGames} &middot; evil {p.evilWins}/
                {p.evilGames}
                {p.soloGames > 0 && ` · solo ${p.soloWins}/${p.soloGames}`}
              </span>
            </div>
          ))}
          {s.last && (
            <p className="gn-hint">
              Last: {s.last.title}, won by {s.last.factions[0]?.name} ({s.last.factions[0]?.names.join(", ")}).
            </p>
          )}
        </>
      )}
    </div>
  );
}

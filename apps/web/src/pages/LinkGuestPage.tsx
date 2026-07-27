import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type GroupDetail } from "../api";
import BackButton from "../BackButton";

// Owner/admin flow to credit a past typed guest's results to a crew member.
// Guests are never written into the ledger, so this re-materializes the
// guest's recoverable history (brackets, Smash, Mario Kart, Mario Party, Ping
// Pong) under the member's identity. Preview first (nothing is written until
// Confirm); the write is additive and idempotent. Beerio is not recoverable.

interface PreviewItem {
  pack: string;
  packLabel: string;
  eventId: string;
  eventTitle: string;
  label: string;
  date: string | null;
  placement: number | null;
  isWinner: boolean;
}

const ordinal = (n: number | null): string => {
  if (n == null) return "";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

const shortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

export default function LinkGuestPage() {
  const { id } = useParams();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [guestName, setGuestName] = useState("");
  const [memberId, setMemberId] = useState("");
  const [preview, setPreview] = useState<{ items: PreviewItem[]; total: number } | null>(null);
  const [done, setDone] = useState<{ written: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const g = await api<GroupDetail>(`/api/groups/${id}`);
      setGroup(g);
      if (g.myRole === "owner" || g.myRole === "admin") {
        const res = await api<{ names: string[] }>(`/api/groups/${id}/guest-names`);
        setNames(res.names);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Any change to the selection invalidates a stale preview / result.
  const resetResult = () => {
    setPreview(null);
    setDone(null);
  };

  const runPreview = async () => {
    if (!guestName || !memberId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ items: PreviewItem[]; total: number }>(`/api/groups/${id}/guest-link/preview`, {
        method: "POST",
        body: JSON.stringify({ guestName, memberId }),
      });
      setPreview(res);
      setDone(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!guestName || !memberId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ written: number }>(`/api/groups/${id}/guest-link/confirm`, {
        method: "POST",
        body: JSON.stringify({ guestName, memberId }),
      });
      setDone(res);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirm failed");
    } finally {
      setBusy(false);
    }
  };

  const memberName = useMemo(
    () => group?.members.find((m) => m.userId === memberId)?.displayName ?? "",
    [group, memberId],
  );

  // Group the preview rows by pack for readability.
  const byPack = useMemo(() => {
    const map = new Map<string, PreviewItem[]>();
    for (const it of preview?.items ?? []) {
      const list = map.get(it.packLabel) ?? [];
      list.push(it);
      map.set(it.packLabel, list);
    }
    return [...map.entries()];
  }, [preview]);

  if (error && !group) {
    return (
      <main className="gn-app">
        <div className="gn-wrap"><BackButton /><p style={{ color: "var(--gn-danger)", marginTop: 12 }}>{error}</p></div>
      </main>
    );
  }
  if (!group) {
    return (
      <main className="gn-app">
        <div className="gn-wrap"><BackButton /><p className="gn-hint" style={{ marginTop: 12 }}>Loading...</p></div>
      </main>
    );
  }
  const canManage = group.myRole === "owner" || group.myRole === "admin";
  if (!canManage) {
    return (
      <main className="gn-app">
        <div className="gn-wrap">
          <BackButton />
          <p className="gn-hint" style={{ marginTop: 12 }}>Only an owner or admin can link a guest.</p>
        </div>
      </main>
    );
  }

  const noGuests = names !== null && names.length === 0;

  return (
    <main className="gn-app">
      <div className="gn-wrap" style={{ paddingBottom: 40 }}>
        <BackButton />
        <h1 className="gn-title text-2xl" style={{ marginTop: 8 }}>Link a past guest</h1>
        <p className="gn-hint" style={{ fontSize: 13, marginTop: 4 }}>
          Someone played as a typed guest, then joined {group.name}? Credit their past results to their
          crew profile. Preview first; nothing is written until you confirm. Beerio Kart history is not
          included.
        </p>

        {noGuests ? (
          <p className="gn-hint" style={{ marginTop: 20 }}>No past guest names were found in this crew's games.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 18 }}>
            <label className="gn-hint" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              Guest name
              <select
                className="gn-input"
                value={guestName}
                onChange={(e) => { setGuestName(e.target.value); resetResult(); }}
              >
                <option value="">Pick a past guest name...</option>
                {(names ?? []).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>

            <label className="gn-hint" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              Credit to crew member
              <select
                className="gn-input"
                value={memberId}
                onChange={(e) => { setMemberId(e.target.value); resetResult(); }}
              >
                <option value="">Pick a crew member...</option>
                {group.members.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.displayName}</option>
                ))}
              </select>
            </label>

            {!done && (
              <button
                onClick={runPreview}
                disabled={!guestName || !memberId || busy}
                className="gn-btn gn-btn--go"
                style={{ minHeight: 44 }}
              >
                {busy && !preview ? "Checking..." : "Preview what would be credited"}
              </button>
            )}
          </div>
        )}

        {error && <p style={{ color: "var(--gn-danger)", marginTop: 14 }}>{error}</p>}

        {preview && (
          <div
            style={{
              marginTop: 20, padding: 16, borderRadius: 12,
              background: "var(--gn-surf)", border: "1px solid var(--gn-line)",
            }}
          >
            {preview.total === 0 ? (
              <p className="gn-hint">
                Nothing to credit: no recoverable results for <b style={{ color: "var(--gn-ink)" }}>{guestName}</b> that
                {" "}{memberName || "this member"} does not already have. (Beerio history is never included.)
              </p>
            ) : (
              <>
                <p style={{ fontWeight: 700, color: "var(--gn-ink)" }}>
                  {preview.total} game{preview.total === 1 ? "" : "s"} will be credited to {memberName}
                </p>
                <p className="gn-hint" style={{ fontSize: 12, marginTop: 2 }}>from guest "{guestName}". Beerio Kart games are not included.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
                  {byPack.map(([packLabel, list]) => (
                    <div key={packLabel}>
                      <div style={{ fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--gn-p2)" }}>
                        {packLabel} <span style={{ color: "var(--gn-dim)" }}>({list.length})</span>
                      </div>
                      <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                        {list.map((it, i) => (
                          <li key={i} style={{ fontSize: 13, color: "var(--gn-ink)", display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {it.label}{" "}
                              <span style={{ color: "var(--gn-dim)" }}>
                                {"·"} {it.eventTitle}{it.date ? ` · ${shortDate(it.date)}` : ""}
                              </span>
                            </span>
                            <span style={{ flexShrink: 0, color: it.isWinner ? "var(--gn-gold)" : "var(--gn-dim)" }}>
                              {it.isWinner ? "🏆 won" : it.placement != null ? ordinal(it.placement) : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button onClick={confirm} disabled={busy} className="gn-btn gn-btn--p1" style={{ minHeight: 44, flex: 1 }}>
                    {busy ? "Crediting..." : `Credit ${preview.total} to ${memberName}`}
                  </button>
                  <button onClick={() => setPreview(null)} disabled={busy} className="gn-btn gn-btn--ghost" style={{ minHeight: 44 }}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {done && (
          <div
            style={{
              marginTop: 20, padding: 16, borderRadius: 12,
              background: "var(--gn-surf)", border: "1px solid var(--gn-p2)",
            }}
          >
            <p style={{ fontWeight: 700, color: "var(--gn-ink)" }}>
              {done.written === 0
                ? "Nothing new to credit (already up to date)."
                : `Credited ${done.written} game${done.written === 1 ? "" : "s"} to ${memberName}.`}
            </p>
            <p className="gn-hint" style={{ fontSize: 12, marginTop: 4 }}>
              Re-running the same link credits nothing new. It may take a moment for open stats pages to refresh.
            </p>
            <button
              onClick={() => { setGuestName(""); setMemberId(""); resetResult(); }}
              className="gn-btn gn-btn--ghost"
              style={{ minHeight: 40, marginTop: 12 }}
            >
              Link another guest
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

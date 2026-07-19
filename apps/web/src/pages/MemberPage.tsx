import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type Me } from "../api";
import BackButton from "../BackButton";
import { ensureRecapFonts } from "../recap";

// One page, two faces. Tapping yourself in the crew list shows your
// profile; tapping anyone else shows the rivalry comparison (you vs them)
// with a shareable card. Both read the same lifetime ledger the stats
// screen uses, so numbers always agree.

interface SideStats {
  userId: string;
  displayName: string;
  played: number;
  wins: number;
  podiums: number;
  best: number | null;
  winRate: number;
  avgPlacement: number | null;
  byGame: { name: string; played: number; wins: number }[];
}

interface Rivalry {
  me: SideStats;
  them: SideStats;
  h2h: {
    meetings: number;
    wins: number;
    losses: number;
    ties: number;
    byGame: { name: string; meetings: number; myWins: number; theirWins: number }[];
  };
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

export default function MemberPage({ me }: { me: Me | null }) {
  const { id: groupId, userId } = useParams();
  const isSelf = !!me && userId === me.id;
  const [profile, setProfile] = useState<SideStats | null>(null);
  const [rivalry, setRivalry] = useState<Rivalry | null>(null);
  const [groupName, setGroupName] = useState("");
  const [err, setErr] = useState("");
  const [showCard, setShowCard] = useState(false);

  useEffect(() => {
    if (!groupId || !userId) return;
    let cancelled = false;
    api<{ name: string }>(`/api/groups/${groupId}`)
      .then((g) => {
        if (!cancelled) setGroupName(g.name ?? "");
      })
      .catch(() => {});
    api<SideStats>(`/api/groups/${groupId}/members/${userId}/stats`)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Couldn't load");
      });
    if (!isSelf) {
      api<Rivalry>(`/api/groups/${groupId}/rivalry/${userId}`)
        .then((r) => {
          if (!cancelled) setRivalry(r);
        })
        .catch((e) => {
          if (!cancelled) setErr(e instanceof Error ? e.message : "Couldn't load");
        });
    }
    return () => {
      cancelled = true;
    };
  }, [groupId, userId, isSelf]);

  return (
    <main className="gn-app">
      <div className="gn-wrap space-y-6">
        <BackButton />
        {err && <p className="gn-hint">{err}</p>}

        {isSelf && profile && <Profile stats={profile} title="Your stats" />}
        {!isSelf && !rivalry && !err && <p className="gn-hint">Loading...</p>}

        {rivalry && (
          <>
            <header className="space-y-1">
              <h1 className="gn-h1">Rivalry</h1>
              <p className="gn-hint">
                {rivalry.me.displayName} vs {rivalry.them.displayName}
                {groupName ? ` · ${groupName}` : ""}
              </p>
            </header>

            <RecordBanner r={rivalry} />
            <Compare r={rivalry} />
            <H2hByGame r={rivalry} />

            <button className="gn-btn gn-btn--p1 w-full" onClick={() => setShowCard(true)}>
              Share rivalry card
            </button>
          </>
        )}
      </div>
      {showCard && rivalry && (
        <RivalryCardModal r={rivalry} groupName={groupName} onClose={() => setShowCard(false)} />
      )}
    </main>
  );
}

// ---------- Self profile ----------

function Profile({ stats, title }: { stats: SideStats; title: string }) {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="gn-h1">{title}</h1>
        <p className="gn-hint">{stats.displayName}</p>
      </header>
      {stats.played === 0 ? (
        <p className="gn-hint">No recorded games in this crew yet. Play something!</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="games" value={String(stats.played)} />
            <Stat label="wins" value={String(stats.wins)} accent="var(--gn-gold)" />
            <Stat label="win rate" value={pct(stats.winRate)} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="podiums" value={String(stats.podiums)} />
            <Stat label="best finish" value={stats.best ? `#${stats.best}` : "-"} />
            <Stat
              label="avg place"
              value={stats.avgPlacement ? stats.avgPlacement.toFixed(1) : "-"}
            />
          </div>
          <div className="gn-card space-y-2">
            <h2 className="gn-h2">By game</h2>
            {stats.byGame.map((g) => (
              <div key={g.name} className="flex justify-between items-baseline">
                <span style={{ fontWeight: 700 }}>{g.name}</span>
                <span className="gn-hint">
                  {g.wins}W · {g.played} played
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        background: "var(--gn-raise)",
        border: "2px solid var(--gn-line)",
        borderRadius: "12px",
        padding: "10px 6px",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: "22px", color: accent ?? "var(--gn-ink)" }}>{value}</div>
      <div className="gn-hint" style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
    </div>
  );
}

// ---------- Rivalry pieces ----------

// You are always teal, the opponent is always red/coral — here and on the card.
const P1 = "var(--gn-teal, #2dd4bf)"; // me
const P2 = "var(--gn-coral, #ff5a5f)"; // them

function RecordBanner({ r }: { r: Rivalry }) {
  const { wins, losses, ties, meetings } = r.h2h;
  return (
    <div
      className="text-center space-y-1"
      style={{
        background: "var(--gn-raise)",
        border: "2px solid var(--gn-line)",
        borderRadius: "14px",
        padding: "16px 12px",
      }}
    >
      <div className="gn-hint" style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        head to head
      </div>
      {meetings === 0 ? (
        <p className="gn-hint" style={{ padding: "6px 0" }}>
          You two haven't met in a recorded game yet. First blood pending.
        </p>
      ) : (
        <>
          <div style={{ fontWeight: 900, fontSize: "40px", lineHeight: 1.1 }}>
            <span style={{ color: P1 }}>{wins}</span>
            <span className="gn-hint" style={{ fontSize: "24px", padding: "0 10px" }}>-</span>
            <span style={{ color: P2 }}>{losses}</span>
          </div>
          <div className="gn-hint" style={{ fontSize: "12px" }}>
            {meetings} meeting{meetings === 1 ? "" : "s"}
            {ties ? ` · ${ties} tied` : ""}
          </div>
        </>
      )}
    </div>
  );
}

function Compare({ r }: { r: Rivalry }) {
  const rows: { label: string; a: string; b: string; aWins: boolean; bWins: boolean }[] = [];
  const add = (label: string, av: number | null, bv: number | null, fmt: (n: number) => string, lowerBetter = false) => {
    const a = av === null ? "-" : fmt(av);
    const b = bv === null ? "-" : fmt(bv);
    let aWins = false;
    let bWins = false;
    if (av !== null && bv !== null && av !== bv) {
      const aBetter = lowerBetter ? av < bv : av > bv;
      aWins = aBetter;
      bWins = !aBetter;
    }
    rows.push({ label, a, b, aWins, bWins });
  };
  add("wins", r.me.wins, r.them.wins, String);
  add("win rate", r.me.winRate, r.them.winRate, pct);
  add("games", r.me.played, r.them.played, String);
  add("podiums", r.me.podiums, r.them.podiums, String);
  add("best finish", r.me.best, r.them.best, (n) => `#${n}`, true);
  add("avg place", r.me.avgPlacement, r.them.avgPlacement, (n) => n.toFixed(1), true);

  return (
    <div className="gn-card space-y-2">
      <div className="flex justify-between" style={{ fontWeight: 800 }}>
        <span style={{ color: P1 }}>{r.me.displayName}</span>
        <span style={{ color: P2 }}>{r.them.displayName}</span>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between items-baseline gap-2">
          <span style={{ fontWeight: row.aWins ? 800 : 500, color: row.aWins ? P1 : "var(--gn-ink)", minWidth: "56px" }}>
            {row.a}
          </span>
          <span className="gn-hint" style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {row.label}
          </span>
          <span
            style={{
              fontWeight: row.bWins ? 800 : 500,
              color: row.bWins ? P2 : "var(--gn-ink)",
              minWidth: "56px",
              textAlign: "right",
            }}
          >
            {row.b}
          </span>
        </div>
      ))}
    </div>
  );
}

function H2hByGame({ r }: { r: Rivalry }) {
  if (!r.h2h.byGame.length) return null;
  return (
    <div className="gn-card space-y-2">
      <h2 className="gn-h2">Where you've met</h2>
      {r.h2h.byGame.map((g) => (
        <div key={g.name} className="flex justify-between items-baseline">
          <span style={{ fontWeight: 700 }}>{g.name}</span>
          <span style={{ fontWeight: 800 }}>
            <span style={{ color: P1 }}>{g.myWins}</span>
            <span className="gn-hint"> - </span>
            <span style={{ color: P2 }}>{g.theirWins}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Shareable card (canvas-to-JPG, same pipeline as the recap) ----------

const FONT_DISPLAY = `"Luckiest Guy", system-ui`;
const FONT_HEAD = `"Fredoka", system-ui`;
const FONT_BODY = `"Fredoka", system-ui`;
const C = {
  bg: "#1b1030",
  surf: "#251743",
  line: "#3a2a5e",
  ink: "#f5efff",
  dim: "#b3a5d6",
  gold: "#ffc857",
  coral: "#ff5a5f",
  teal: "#2dd4bf",
};

function drawRivalryCard(r: Rivalry, groupName: string): HTMLCanvasElement {
  const games = r.h2h.byGame.slice(0, 4);
  const scale = 2;
  const W = 800;
  const PAD = 40;
  const HEAD = 118;
  const NAMES = 84;
  const RECORD = 150;
  const STATS = 3 * 44 + 18;
  const GAMES = games.length ? 46 + games.length * 40 : 0;
  const FOOT = 64;
  const H = HEAD + NAMES + RECORD + STATS + GAMES + FOOT;

  const cv = document.createElement("canvas");
  cv.width = W * scale;
  cv.height = H * scale;
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  ctx.scale(scale, scale);

  // Background: deep plum, teal glow left (you), coral glow right (them).
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const gl = ctx.createRadialGradient(80, -40, 30, 80, -40, 420);
  gl.addColorStop(0, "rgba(45,212,191,0.18)");
  gl.addColorStop(1, "rgba(45,212,191,0)");
  ctx.fillStyle = gl;
  ctx.fillRect(0, 0, W, 260);
  const gr = ctx.createRadialGradient(W - 80, -40, 30, W - 80, -40, 420);
  gr.addColorStop(0, "rgba(255,90,95,0.20)");
  gr.addColorStop(1, "rgba(255,90,95,0)");
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, 260);

  // Header
  ctx.textAlign = "right";
  ctx.fillStyle = C.gold;
  ctx.font = `400 20px ${FONT_DISPLAY}`;
  ctx.fillText("GAMENIGHT OS", W - PAD, 44);
  ctx.textAlign = "left";
  ctx.fillStyle = C.ink;
  ctx.font = `400 44px ${FONT_DISPLAY}`;
  ctx.fillText("RIVALRY", PAD, 66);
  ctx.fillStyle = C.dim;
  ctx.font = `700 16px ${FONT_BODY}`;
  const date = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  ctx.fillText(`${groupName || "GameNight"} · ${date}`, PAD, 96);
  ctx.fillStyle = C.gold;
  ctx.fillRect(PAD, HEAD - 10, W - PAD * 2, 3);

  // Names, corner to corner
  let y = HEAD + 52;
  const name = (t: string, color: string, align: CanvasTextAlign, x: number) => {
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.font = `700 34px ${FONT_HEAD}`;
    ctx.fillText(t.slice(0, 14), x, y);
  };
  name(r.me.displayName, C.teal, "left", PAD);
  ctx.fillStyle = C.dim;
  ctx.textAlign = "center";
  ctx.font = `700 22px ${FONT_HEAD}`;
  ctx.fillText("VS", W / 2, y);
  name(r.them.displayName, C.coral, "right", W - PAD);

  // The record, huge
  y = HEAD + NAMES;
  ctx.textAlign = "center";
  if (r.h2h.meetings === 0) {
    ctx.fillStyle = C.dim;
    ctx.font = `700 24px ${FONT_HEAD}`;
    ctx.fillText("No meetings yet", W / 2, y + 88);
  } else {
    ctx.fillStyle = C.ink;
    ctx.font = `400 96px ${FONT_DISPLAY}`;
    const rec = `${r.h2h.wins} - ${r.h2h.losses}`;
    ctx.fillText(rec, W / 2, y + 96);
    ctx.fillStyle = C.dim;
    ctx.font = `700 17px ${FONT_BODY}`;
    ctx.fillText(
      `${r.h2h.meetings} meeting${r.h2h.meetings === 1 ? "" : "s"}${r.h2h.ties ? ` · ${r.h2h.ties} tied` : ""}`,
      W / 2,
      y + 130,
    );
  }

  // Three stat rows: wins, win rate, games
  y = HEAD + NAMES + RECORD;
  const statRow = (label: string, a: string, b: string, aWins: boolean, bWins: boolean) => {
    ctx.textAlign = "left";
    ctx.fillStyle = aWins ? C.teal : C.ink;
    ctx.font = `${aWins ? 800 : 600} 26px ${FONT_HEAD}`;
    ctx.fillText(a, PAD, y);
    ctx.textAlign = "center";
    ctx.fillStyle = C.dim;
    ctx.font = `700 14px ${FONT_BODY}`;
    ctx.fillText(label.toUpperCase(), W / 2, y - 3);
    ctx.textAlign = "right";
    ctx.fillStyle = bWins ? C.coral : C.ink;
    ctx.font = `${bWins ? 800 : 600} 26px ${FONT_HEAD}`;
    ctx.fillText(b, W - PAD, y);
    y += 44;
  };
  const better = (a: number, b: number) => [a > b, b > a] as const;
  let [aw, bw] = better(r.me.wins, r.them.wins);
  statRow("wins", String(r.me.wins), String(r.them.wins), aw, bw);
  [aw, bw] = better(r.me.winRate, r.them.winRate);
  statRow("win rate", pct(r.me.winRate), pct(r.them.winRate), aw, bw);
  [aw, bw] = better(r.me.played, r.them.played);
  statRow("games", String(r.me.played), String(r.them.played), false, false);

  // Per-game head to head
  if (games.length) {
    y += 10;
    ctx.fillStyle = C.line;
    ctx.fillRect(PAD, y - 24, W - PAD * 2, 2);
    ctx.textAlign = "left";
    ctx.fillStyle = C.gold;
    ctx.font = `700 16px ${FONT_BODY}`;
    ctx.fillText("HEAD TO HEAD BY GAME", PAD, y + 4);
    y += 40;
    for (const g of games) {
      ctx.textAlign = "left";
      ctx.fillStyle = C.ink;
      ctx.font = `600 20px ${FONT_HEAD}`;
      ctx.fillText(g.name.slice(0, 26), PAD, y);
      ctx.textAlign = "right";
      ctx.font = `800 20px ${FONT_HEAD}`;
      const rec = `${g.myWins} - ${g.theirWins}`;
      ctx.fillStyle = g.myWins > g.theirWins ? C.teal : g.theirWins > g.myWins ? C.coral : C.dim;
      ctx.fillText(rec, W - PAD, y);
      y += 40;
    }
  }

  // Footer
  ctx.fillStyle = C.gold;
  ctx.fillRect(PAD, H - FOOT + 8, W - PAD * 2, 3);
  ctx.textAlign = "center";
  ctx.fillStyle = C.dim;
  ctx.font = `700 14px ${FONT_BODY}`;
  ctx.fillText("settle it at the next game night", W / 2, H - 26);

  return cv;
}

function RivalryCardModal({ r, groupName, onClose }: { r: Rivalry; groupName: string; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureRecapFonts().then(() => {
      if (cancelled) return;
      const cv = drawRivalryCard(r, groupName);
      cv.toBlob(
        (b) => {
          if (!b || cancelled) return;
          setBlob(b);
          setUrl(URL.createObjectURL(b));
        },
        "image/jpeg",
        0.92,
      );
    });
    return () => {
      cancelled = true;
      setUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return "";
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fname = `rivalry-${new Date().toISOString().slice(0, 10)}.jpg`;

  async function share() {
    if (!blob) return;
    const file = new File([blob], fname, { type: "image/jpeg" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${r.me.displayName} vs ${r.them.displayName}`,
        });
        return;
      }
    } catch {
      // User cancelled or share failed; fall through to the hint.
    }
    setMsg("Sharing not available here; use Download instead.");
    setTimeout(() => setMsg(""), 2500);
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 z-50"
      style={{ background: "rgba(10,6,15,0.72)" }}
      onClick={onClose}
    >
      <div className="gn-card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h2 className="gn-h2">Rivalry card</h2>
          <button className="gn-textbtn" onClick={onClose}>
            close
          </button>
        </div>
        {url ? (
          <img
            src={url}
            alt="Rivalry card"
            className="w-full rounded-lg"
            style={{ border: "2px solid var(--gn-line)" }}
          />
        ) : (
          <p className="gn-hint py-8 text-center">Building your card...</p>
        )}
        {msg && (
          <p className="text-sm" style={{ color: "var(--gn-gold)" }}>
            {msg}
          </p>
        )}
        <div className="flex gap-2">
          <button onClick={share} className="gn-btn gn-btn--p1 flex-1">
            Share
          </button>
          <a
            href={url || undefined}
            download={fname}
            className="gn-btn gn-btn--ghost flex-1 text-center"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}
          >
            Download
          </a>
        </div>
      </div>
    </div>
  );
}

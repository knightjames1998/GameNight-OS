import { useEffect, useRef, useState } from "react";
import type { BracketMatchView, BracketSlot, BracketView, EventRecap } from "./api";

// The recap card, third generation of the Beerio Kart canvas-to-JPG
// pipeline: draw offscreen at 2x, toBlob as JPEG, share via the Web Share
// API (files), fall back to a download link.

// ---------- Pure derivations (tested headlessly) ----------

export interface StandingRow {
  name: string;
  seed: number;
  label: string; // Champion / Runner-up / Out in Semifinals / ...
  rank: number; // 1 = champion; ties share rank
}

const player = (s: BracketSlot) => (s.kind === "player" ? s : null);

/** How far everyone got, best finish first. */
export function computeStandings(view: BracketView): StandingRow[] {
  if (view.format === "double_elim") return computeStandingsDouble(view);
  const rows: StandingRow[] = [];
  const totalRounds = view.rounds.length;

  view.rounds.forEach((round, i) => {
    const roundNo = i + 1;
    const fromEnd = totalRounds - roundNo;
    const outLabel =
      fromEnd === 0
        ? "Runner-up"
        : fromEnd === 1
          ? "Out in Semifinals"
          : fromEnd === 2
            ? "Out in Quarterfinals"
            : `Out in Round ${roundNo}`;
    for (const m of round.matches) {
      if (!m.decided || m.auto) continue;
      const a = player(m.a);
      const b = player(m.b);
      const w = player(m.winner ?? { kind: "tbd" });
      if (!a || !b || !w) continue;
      const loser = w.seed === a.seed ? b : a;
      rows.push({
        name: loser.displayName,
        seed: loser.seed,
        label: outLabel,
        rank: Math.pow(2, fromEnd) + 1, // runner-up 2, semis 3, quarters 5...
      });
    }
  });

  const champ = player(view.champion ?? { kind: "tbd" });
  if (champ) {
    rows.push({ name: champ.displayName, seed: champ.seed, label: "Champion", rank: 1 });
  }
  rows.sort((x, y) => x.rank - y.rank || x.seed - y.seed);
  return rows;
}

/**
 * Double elim: only losers-bracket losses eliminate (a winners-bracket loss
 * drops you down), the runner-up is the loser of whichever grand final
 * actually decided it (the reset if one was forced).
 */
function computeStandingsDouble(view: BracketView): StandingRow[] {
  const rows: StandingRow[] = [];

  const champ = player(view.champion ?? { kind: "tbd" });
  if (champ) {
    rows.push({ name: champ.displayName, seed: champ.seed, label: "Champion", rank: 1 });
  }

  // The server hides an unneeded reset, so the deciding grand final is
  // simply the last one visible.
  const gfs = view.rounds.find((r) => r.side === "GF")?.matches ?? [];
  const decider = gfs[gfs.length - 1];
  if (decider && decider.decided && !decider.auto) {
    const a = player(decider.a);
    const b = player(decider.b);
    const w = player(decider.winner ?? { kind: "tbd" });
    if (a && b && w) {
      const loser = w.seed === a.seed ? b : a;
      rows.push({ name: loser.displayName, seed: loser.seed, label: "Runner-up", rank: 2 });
    }
  }

  const lRounds = view.rounds.filter((r) => r.side === "L");
  let rank = 3;
  for (let i = lRounds.length - 1; i >= 0; i--) {
    const round = lRounds[i]!;
    let outs = 0;
    for (const m of round.matches) {
      if (!m.decided || m.auto) continue;
      const a = player(m.a);
      const b = player(m.b);
      const w = player(m.winner ?? { kind: "tbd" });
      if (!a || !b || !w) continue;
      const loser = w.seed === a.seed ? b : a;
      rows.push({ name: loser.displayName, seed: loser.seed, label: `Out in ${round.title}`, rank });
      outs++;
    }
    rank += outs; // ties share rank within a round
  }

  rows.sort((x, y) => x.rank - y.rank || x.seed - y.seed);
  return rows;
}

export interface Upset {
  winner: string;
  winnerSeed: number;
  loser: string;
  loserSeed: number;
  diff: number;
}

/** Biggest seed upset of the night, if any (higher number beat lower). */
export function biggestUpset(view: BracketView): Upset | null {
  let best: Upset | null = null;
  const all: BracketMatchView[] = view.rounds.flatMap((r) => r.matches);
  for (const m of all) {
    if (!m.decided || m.auto) continue;
    const a = player(m.a);
    const b = player(m.b);
    const w = player(m.winner ?? { kind: "tbd" });
    if (!a || !b || !w) continue;
    const loser = w.seed === a.seed ? b : a;
    const diff = w.seed - loser.seed;
    if (diff > 0 && (!best || diff > best.diff)) {
      best = {
        winner: w.displayName,
        winnerSeed: w.seed,
        loser: loser.displayName,
        loserSeed: loser.seed,
        diff,
      };
    }
  }
  return best;
}

// ---------- Canvas drawing ----------

// Arcade palette (mirrors the --gn-* tokens; canvas can't read CSS vars).
const RECAP = {
  bg: "#17111f",
  surf: "#241a30",
  line: "#3a2c4d",
  ink: "#f4ecff",
  dim: "#c3b6d6",
  gold: "#ffcf3f",
  coral: "#ff5a5f",
  teal: "#35e0c4",
};
const FONT_DISPLAY = '"Luckiest Guy", system-ui, cursive';
const FONT_HEAD = '"Fredoka", system-ui, sans-serif';
const FONT_BODY = '"Nunito", system-ui, sans-serif';

/** Load the webfonts the card draws with, so the canvas isn't a fallback. */
export async function ensureRecapFonts(): Promise<void> {
  const faces = [
    `400 46px ${FONT_DISPLAY}`,
    `700 42px ${FONT_HEAD}`,
    `700 21px ${FONT_HEAD}`,
    `700 15px ${FONT_BODY}`,
  ];
  try {
    await Promise.all(faces.map((f) => (document as any).fonts?.load(f)));
  } catch {
    // Fonts unavailable (offline etc.); the card falls back to system-ui.
  }
}

export function drawRecapCard(view: BracketView): HTMLCanvasElement {
  const standings = computeStandings(view);
  const upset = biggestUpset(view);

  const scale = 2;
  const W = 800;
  const PAD = 40;
  const HEAD = 128;
  const CHAMP = 132;
  const ROW = 58;
  const UPSET = upset ? 64 : 0;
  const FOOT = 70;
  const H = HEAD + CHAMP + standings.length * ROW + UPSET + FOOT + PAD;

  const cv = document.createElement("canvas");
  cv.width = W * scale;
  cv.height = H * scale;
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  ctx.scale(scale, scale);

  const { ink, dim, gold, surf, line, coral, teal } = RECAP;

  const rowRadius = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  // Background: deep plum with a soft coral glow up top, matching the app.
  ctx.fillStyle = RECAP.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, -60, 40, W / 2, -60, 520);
  glow.addColorStop(0, "rgba(255,90,95,0.16)");
  glow.addColorStop(1, "rgba(255,90,95,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 260);

  // Wordmark (top-right) + title
  ctx.textAlign = "right";
  ctx.fillStyle = gold;
  ctx.font = `400 20px ${FONT_DISPLAY}`;
  ctx.fillText("GAMENIGHT OS", W - PAD, 44);
  ctx.textAlign = "left";

  ctx.fillStyle = ink;
  ctx.font = `700 42px ${FONT_HEAD}`;
  ctx.fillText(view.gameName.slice(0, 22), PAD, 62);
  ctx.fillStyle = dim;
  ctx.font = `700 17px ${FONT_BODY}`;
  const date = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const fmt = view.format === "double_elim" ? "double elim" : "single elim";
  ctx.fillText(`${view.groupName} · ${date} · ${view.entrantCount} players · ${fmt}`, PAD, 94);

  // Gold divider with a teal accent tick (the two player accents).
  ctx.fillStyle = gold;
  ctx.fillRect(PAD, HEAD - 12, W - PAD * 2, 3);
  ctx.fillStyle = teal;
  ctx.fillRect(PAD, HEAD - 12, 54, 3);

  // Champion block
  const champ = standings.find((s) => s.rank === 1);
  ctx.fillStyle = gold;
  ctx.font = `700 15px ${FONT_HEAD}`;
  ctx.fillText("CHAMPION", PAD, HEAD + 32);
  ctx.fillStyle = ink;
  ctx.font = `400 46px ${FONT_DISPLAY}`;
  ctx.fillText(`\u{1F3C6} ${champ ? champ.name.slice(0, 18) : "?"}`, PAD, HEAD + 88);

  // Standings rows
  const y = HEAD + CHAMP;
  standings.forEach((s, i) => {
    const top = y + i * ROW;
    const isChamp = s.rank === 1;
    ctx.fillStyle = isChamp ? "rgba(255,207,63,0.12)" : surf;
    ctx.strokeStyle = isChamp ? gold : line;
    ctx.lineWidth = 2;
    rowRadius(PAD, top, W - PAD * 2, ROW - 10, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isChamp ? gold : ink;
    ctx.font = `700 21px ${FONT_HEAD}`;
    ctx.fillText(s.name.slice(0, 20), PAD + 20, top + 31);

    ctx.fillStyle = dim;
    ctx.font = `700 15px ${FONT_BODY}`;
    const label = `${s.label} · #${s.seed} seed`;
    ctx.textAlign = "right";
    ctx.fillText(label, W - PAD - 20, top + 30);
    ctx.textAlign = "left";
  });

  // Upset callout
  if (upset) {
    const top = y + standings.length * ROW + 8;
    ctx.fillStyle = coral;
    ctx.font = `700 15px ${FONT_HEAD}`;
    ctx.fillText("BIGGEST UPSET", PAD, top + 12);
    ctx.fillStyle = ink;
    ctx.font = `700 19px ${FONT_BODY}`;
    ctx.fillText(
      `${upset.winner} (#${upset.winnerSeed}) took out ${upset.loser} (#${upset.loserSeed})`,
      PAD,
      top + 40,
    );
  }

  // Footer
  ctx.fillStyle = dim;
  ctx.font = `700 14px ${FONT_BODY}`;
  ctx.fillText("made with GameNight OS", PAD, H - 28);

  return cv;
}

// ---------- Night recap card (event-level, all packs) ----------
// Same canvas-to-JPG pipeline as the bracket card above: same Arcade
// palette, same webfonts, same rounded-row drawing. Different data (games
// list + player rollups + MVP) so it gets its own draw function, not a
// second renderer.

/**
 * Turn a raw ledger label into words: bo1 -> Free play, bo{N} -> Best of N,
 * gp{N} -> Cup N (Grand Prix). Anything else (a Mario Party board name) is
 * shown as-is. null when the pack stores no label.
 */
function humanizeLabel(label: string | null): string | null {
  if (!label) return null;
  if (label === "bo1") return "Free play";
  const bo = /^bo(\d+)$/.exec(label);
  if (bo) return `Best of ${bo[1]}`;
  const gp = /^gp(\d+)$/.exec(label);
  if (gp) return `Cup ${gp[1]}`;
  return label;
}

const PACK_EMOJI: Record<string, string> = {
  pingpong: "\u{1F3D3}", // 🏓
  smash: "\u{1F94A}", // 🥊
  mario_kart: "\u{1F3CE}\u{FE0F}", // 🏎️
  mario_party: "\u{1F3B2}", // 🎲
  beerio: "\u{1F37A}", // 🍺
};
const packEmoji = (pack: string): string => PACK_EMOJI[pack] ?? "\u{1F3C6}"; // 🏆

const FORMAT_NAME: Record<string, string> = {
  free: "Free Play",
  bestof: "Best Of",
  koth: "King of the Hill",
  ffa: "Free-for-all",
  grandprix: "Grand Prix",
  board: "Board night",
};
const unitNoun: Record<string, string> = { grandprix: "races", bestof: "sets", board: "boards" };
const sessionUnit = (format: string | null): string => (format && unitNoun[format]) || "games";

/** Title line for one session row: "Ping Pong · King of the Hill". */
function sessionTitle(s: EventRecap["sessions"][number]): string {
  if (s.format === "board") return s.gameName;
  const fmt = s.format ? FORMAT_NAME[s.format] : null;
  return fmt ? `${s.gameName} · ${fmt}` : s.gameName;
}

/** Detail line for one session row (cup / board / how dominant). */
function sessionSub(s: EventRecap["sessions"][number]): string {
  const parts: string[] = [];
  if (s.format === "grandprix") parts.push(humanizeLabel(s.label) ?? "Cup");
  else if (s.format === "board" && s.label) parts.push(s.label);
  else if (s.format === "bestof" && s.matches === 1) parts.push(humanizeLabel(s.label) ?? "");
  if (s.matches > 1 && s.winnerName) parts.push(`won ${s.winnerWins} of ${s.matches} ${sessionUnit(s.format)}`);
  return parts.filter(Boolean).join(" · ");
}

// Style A "Podium Night": MVP hero, a 1-2-3 podium, then a line per thing
// actually played (grouped by session/cup) with its winner.
export function drawNightRecapCard(recap: EventRecap): HTMLCanvasElement {
  const scale = 2;
  const W = 800;
  const PAD = 44;
  const HEAD = 122;
  const MVPH = recap.mvp ? 122 : 24;
  const players = recap.players.slice(0, 8);
  const podiumPeople = players.slice(0, 3);
  const PODH = podiumPeople.length ? 196 : 0;
  const sessions = recap.sessions.slice(0, 8);
  const SHEAD = 42;
  const SROW = 50;
  const SECTION = sessions.length ? SHEAD + sessions.length * SROW : 0;
  const FOOT = 60;
  const H = HEAD + MVPH + PODH + SECTION + FOOT;

  const cv = document.createElement("canvas");
  cv.width = W * scale;
  cv.height = H * scale;
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  ctx.scale(scale, scale);

  const { ink, dim, gold, surf, line, teal } = RECAP;
  const SILVER = "#c9d2e0";
  const BRONZE = "#e0a06a";

  const rowRadius = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  // Background + violet glow.
  ctx.fillStyle = RECAP.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, -60, 40, W / 2, -60, 560);
  glow.addColorStop(0, "rgba(120,70,210,0.28)");
  glow.addColorStop(1, "rgba(120,70,210,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 300);

  // Header: title left, wordmark right, meta under.
  ctx.textAlign = "right";
  ctx.fillStyle = teal;
  ctx.font = `700 13px ${FONT_HEAD}`;
  ctx.fillText("NIGHT RECAP", W - PAD, 40);
  ctx.fillStyle = gold;
  ctx.font = `400 20px ${FONT_DISPLAY}`;
  ctx.fillText("GAMENIGHT OS", W - PAD, 66);
  ctx.textAlign = "left";

  ctx.fillStyle = ink;
  ctx.font = `700 40px ${FONT_HEAD}`;
  ctx.fillText(recap.title.slice(0, 24), PAD, 60);
  ctx.fillStyle = dim;
  ctx.font = `700 16px ${FONT_BODY}`;
  const date = recap.scheduledFor
    ? new Date(recap.scheduledFor).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "Date TBD";
  const packs = new Set(recap.sessions.map((s) => s.pack)).size;
  const meta = `${recap.groupName} · ${date} · ${recap.totalGames} game${recap.totalGames === 1 ? "" : "s"}${packs ? ` across ${packs} pack${packs === 1 ? "" : "s"}` : ""}`;
  ctx.fillText(meta, PAD, 90);

  ctx.fillStyle = line;
  ctx.fillRect(PAD, HEAD - 14, W - PAD * 2, 2);

  // MVP hero.
  if (recap.mvp) {
    const my = HEAD;
    ctx.fillStyle = "rgba(255,207,63,0.10)";
    ctx.strokeStyle = "rgba(255,207,63,0.45)";
    ctx.lineWidth = 2;
    rowRadius(PAD, my, W - PAD * 2, 98, 16);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = gold;
    ctx.font = `700 13px ${FONT_HEAD}`;
    ctx.fillText("M V P   O F   T H E   N I G H T", W / 2, my + 30);
    ctx.fillStyle = ink;
    ctx.font = `400 40px ${FONT_DISPLAY}`;
    ctx.fillText(`\u{1F3C6} ${recap.mvp.name.slice(0, 18)}`, W / 2, my + 70);
    const mvpP = players.find((p) => p.userId === recap.mvp!.userId);
    if (mvpP) {
      ctx.fillStyle = dim;
      ctx.font = `700 15px ${FONT_BODY}`;
      const fmts = new Set(recap.sessions.map((s) => s.format).filter(Boolean)).size;
      ctx.fillText(`${mvpP.wins} wins${fmts ? ` across ${fmts} format${fmts === 1 ? "" : "s"}` : ""}`, W / 2, my + 90);
    }
    ctx.textAlign = "left";
  }

  // Podium (2nd, 1st, 3rd).
  if (podiumPeople.length) {
    const order = [podiumPeople[1], podiumPeople[0], podiumPeople[2]]; // left, mid, right
    const ranks = [2, 1, 3];
    const barH = [78, 108, 62];
    const colors = [SILVER, gold, BRONZE];
    const gap = 16;
    const colW = (W - PAD * 2 - gap * 2) / 3;
    const py0 = HEAD + MVPH;
    const baseline = py0 + 150;
    order.forEach((p, i) => {
      if (!p) return;
      const x = PAD + i * (colW + gap);
      const h = barH[i]!;
      const top = baseline - h;
      // name above the bar
      ctx.textAlign = "center";
      ctx.fillStyle = i === 1 ? gold : ink;
      ctx.font = `700 17px ${FONT_HEAD}`;
      ctx.fillText(p.name.slice(0, 14), x + colW / 2, top - 10);
      // bar
      const grad = ctx.createLinearGradient(0, top, 0, baseline);
      grad.addColorStop(0, colors[i]!);
      grad.addColorStop(1, "rgba(0,0,0,0.25)");
      ctx.fillStyle = colors[i]!;
      rowRadius(x, top, colW, h, 12);
      ctx.fill();
      ctx.fillStyle = "#241a30";
      ctx.font = `400 30px ${FONT_DISPLAY}`;
      ctx.fillText(String(ranks[i]), x + colW / 2, top + 34);
      ctx.font = `700 14px ${FONT_BODY}`;
      ctx.fillText(`${p.wins} win${p.wins === 1 ? "" : "s"}`, x + colW / 2, top + 56);
      ctx.textAlign = "left";
    });
  }

  // How the night played out (per session/cup).
  if (sessions.length) {
    const sy = HEAD + MVPH + PODH;
    ctx.fillStyle = teal;
    ctx.font = `700 14px ${FONT_HEAD}`;
    ctx.fillText("HOW THE NIGHT PLAYED OUT", PAD, sy + 24);
    sessions.forEach((s, i) => {
      const top = sy + SHEAD + i * SROW;
      if (i > 0) {
        ctx.fillStyle = line;
        ctx.fillRect(PAD, top - 8, W - PAD * 2, 1);
      }
      ctx.textAlign = "left";
      ctx.font = `400 22px ${FONT_BODY}`;
      ctx.fillText(packEmoji(s.pack), PAD, top + 18);
      ctx.fillStyle = ink;
      ctx.font = `700 18px ${FONT_HEAD}`;
      ctx.fillText(sessionTitle(s).slice(0, 34), PAD + 40, top + 12);
      const sub = sessionSub(s);
      if (sub) {
        ctx.fillStyle = dim;
        ctx.font = `700 13px ${FONT_BODY}`;
        ctx.fillText(sub.slice(0, 46), PAD + 40, top + 32);
      }
      ctx.textAlign = "right";
      ctx.fillStyle = gold;
      ctx.font = `700 17px ${FONT_HEAD}`;
      ctx.fillText(s.winnerName ? `\u{1F947} ${s.winnerName.slice(0, 14)}` : "no winner", W - PAD, top + 16);
      ctx.textAlign = "left";
    });
  }

  // Footer.
  ctx.fillStyle = dim;
  ctx.font = `700 13px ${FONT_BODY}`;
  ctx.fillText("gamenightos.app", PAD, H - 24);
  if (recap.mvp) {
    ctx.textAlign = "right";
    ctx.fillStyle = gold;
    ctx.fillText(`\u{1F3C6} ${recap.mvp.name.slice(0, 16)}'s night`, W - PAD, H - 24);
    ctx.textAlign = "left";
  }

  return cv;
}

// ---------- Share modal ----------

export function RecapModal({ view, onClose }: { view: BracketView; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");
  const blobRef = useRef<Blob | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Wait for the Arcade webfonts so the card doesn't bake in system-ui.
    ensureRecapFonts().then(() => {
      if (cancelled) return;
      const cv = drawRecapCard(view);
      cv.toBlob(
        (b) => {
          if (!b || cancelled) return;
          blobRef.current = b;
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

  const fname = `gamenight-${new Date().toISOString().slice(0, 10)}.jpg`;

  async function share() {
    const b = blobRef.current;
    if (!b) return;
    const file = new File([b], fname, { type: "image/jpeg" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `${view.gameName} results` });
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
      <div
        className="gn-card w-full max-w-md space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="gn-h2">Recap card</h2>
          <button className="gn-textbtn" onClick={onClose}>
            close
          </button>
        </div>
        {url ? (
          <img src={url} alt="Tournament recap" className="w-full rounded-lg" style={{ border: "2px solid var(--gn-line)" }} />
        ) : (
          <p className="gn-hint py-8 text-center">Building your card...</p>
        )}
        {msg && <p className="text-sm" style={{ color: "var(--gn-gold)" }}>{msg}</p>}
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

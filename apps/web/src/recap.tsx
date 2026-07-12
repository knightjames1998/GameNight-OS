import { useEffect, useRef, useState } from "react";
import type { BracketMatchView, BracketSlot, BracketView } from "./api";

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

export function drawRecapCard(view: BracketView): HTMLCanvasElement {
  const standings = computeStandings(view);
  const upset = biggestUpset(view);

  const scale = 2;
  const W = 800;
  const PAD = 40;
  const HEAD = 120;
  const CHAMP = 130;
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

  const ink = "#f5f5f5";
  const dim = "#8b8b8b";
  const gold = "#f0b429";
  const card = "#171717";
  const line = "#2a2a2a";

  // Background
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = ink;
  ctx.font = "900 44px system-ui, sans-serif";
  ctx.fillText(view.gameName.slice(0, 24), PAD, 66);
  ctx.fillStyle = dim;
  ctx.font = "600 18px system-ui, sans-serif";
  const date = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  ctx.fillText(
    `${view.groupName} · ${date} · ${view.entrantCount} players · single elim`,
    PAD,
    98,
  );
  ctx.fillStyle = gold;
  ctx.fillRect(PAD, HEAD - 8, W - PAD * 2, 3);

  // Champion block
  const champ = standings.find((s) => s.rank === 1);
  ctx.fillStyle = gold;
  ctx.font = "700 16px system-ui, sans-serif";
  ctx.fillText("CHAMPION", PAD, HEAD + 34);
  ctx.font = "900 46px system-ui, sans-serif";
  ctx.fillText(`\u{1F3C6} ${champ ? champ.name.slice(0, 18) : "?"}`, PAD, HEAD + 86);

  // Standings rows
  const rowRadius = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  let y = HEAD + CHAMP;
  standings.forEach((s, i) => {
    const top = y + i * ROW;
    ctx.fillStyle = s.rank === 1 ? "rgba(240,180,41,0.12)" : card;
    ctx.strokeStyle = s.rank === 1 ? gold : line;
    ctx.lineWidth = 2;
    rowRadius(PAD, top, W - PAD * 2, ROW - 10, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = s.rank === 1 ? gold : ink;
    ctx.font = "700 21px system-ui, sans-serif";
    ctx.fillText(s.name.slice(0, 20), PAD + 20, top + 31);

    ctx.fillStyle = dim;
    ctx.font = "600 15px system-ui, sans-serif";
    const label = `${s.label} · #${s.seed} seed`;
    const w = ctx.measureText(label).width;
    ctx.fillText(label, W - PAD - 20 - w, top + 30);
  });

  // Upset callout
  if (upset) {
    const top = y + standings.length * ROW + 8;
    ctx.fillStyle = "#e05d5d";
    ctx.font = "700 15px system-ui, sans-serif";
    ctx.fillText("BIGGEST UPSET", PAD, top + 12);
    ctx.fillStyle = ink;
    ctx.font = "600 19px system-ui, sans-serif";
    ctx.fillText(
      `${upset.winner} (#${upset.winnerSeed}) took out ${upset.loser} (#${upset.loserSeed})`,
      PAD,
      top + 40,
    );
  }

  // Footer
  ctx.fillStyle = "#4a4a4a";
  ctx.font = "600 14px system-ui, sans-serif";
  ctx.fillText("made with GameNight OS", PAD, H - 28);

  return cv;
}

// ---------- Share modal ----------

export function RecapModal({ view, onClose }: { view: BracketView; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");
  const blobRef = useRef<Blob | null>(null);

  useEffect(() => {
    const cv = drawRecapCard(view);
    cv.toBlob(
      (b) => {
        if (!b) return;
        blobRef.current = b;
        setUrl(URL.createObjectURL(b));
      },
      "image/jpeg",
      0.92,
    );
    return () => {
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
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 w-full max-w-md space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="font-semibold">Recap card</h2>
          <button className="text-neutral-500 text-sm" onClick={onClose}>
            close
          </button>
        </div>
        {url ? (
          <img src={url} alt="Tournament recap" className="w-full rounded-lg border border-neutral-800" />
        ) : (
          <p className="text-neutral-500 text-sm py-8 text-center">Building your card...</p>
        )}
        {msg && <p className="text-yellow-500 text-sm">{msg}</p>}
        <div className="flex gap-2">
          <button
            onClick={share}
            className="flex-1 rounded-lg bg-neutral-100 text-neutral-950 font-semibold py-3"
          >
            Share
          </button>
          <a
            href={url || undefined}
            download={fname}
            className="flex-1 rounded-lg bg-neutral-800 text-center font-semibold py-3"
          >
            Download
          </a>
        </div>
      </div>
    </div>
  );
}

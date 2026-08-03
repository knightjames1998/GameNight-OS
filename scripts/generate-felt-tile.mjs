// Generates apps/web/src/textures/felt.webp, the Tabletop theme's cloth.
//
// EDIT THIS FILE, NEVER THE BINARY. Same rule as project-map.excalidraw and its
// generator: a checked-in image nobody can regenerate is a dead end the first
// time the weave needs tuning, and "make it slightly less busy" is exactly the
// note this will get.
//
//   node scripts/generate-felt-tile.mjs
//
// WHY AN IMAGE AT ALL, given stage 3 ruled one out. James overturned that, and
// his reasoning is the better one: felt is a GREY TEXTURE PLUS A COLOUR, so one
// tile serves every pack. Ping Pong's green, poker's oxblood and a pool blue are
// the same file tinted differently, which is why this costs one request for the
// whole theme rather than one per pack. Stage 3's objection (bytes on a
// deliberately trimmed bundle) was answered by that: the alternative was nine
// pack-specific treatments, and the cross-hatch it chose instead did not read as
// cloth. See the DECISION LOG.
//
// HOW IT IS USED. Greyscale, centred on mid grey, and tinted at the use site:
//
//   background-color: <the felt colour>;
//   background-image: url(felt.webp);
//   background-blend-mode: overlay;
//
// Overlay is the reason this is greyscale rather than green: mid grey is the
// identity value of an overlay blend, so a pixel at exactly 128 leaves the base
// colour untouched and everything else lifts or deepens it proportionally. A
// coloured tile would fight every pack it was tinted for.
//
// ---------------------------------------------------------------------------
// THE AMPLITUDE BOUND, and do not raise it without redoing this arithmetic.
//
// The texture sits between the colours theme-contrast.test.ts measures, and
// that test compares flat colour against flat colour: it will go on passing
// while the screen gets harder to read, because it cannot see the cloth at all.
// So the bound is enforced here, against the tile that is actually written.
//
// THE BOUND IS RELATIVE, NOT ABSOLUTE, and the first version of it was absolute
// and wrong. A flat "no pair may lose more than 0.15 ratio points" is far too
// strict on a pair sitting at 15.2, where losing half a point is imperceptible,
// and far too lax on one sitting at 4.37, where a fifth of a point is the
// difference between comfortable and not. What matters is the FRACTION of a
// pair's contrast the cloth eats, plus a hard floor nothing may cross.
//
// THE TILE IS ASYMMETRIC ABOUT MID GREY, and that is the trick that makes both
// halves of this affordable. Only the LIGHT pixels cost contrast: every surface
// in this theme is dark and every text colour on it is light, so lifting the
// surface closes the gap and deepening it opens the gap. Felt is mostly dark
// gaps between lit fibres anyway, so the tile is allowed to travel twice as far
// down as up. That buys visible texture on the cheap side of the ledger.
//
// For a dark base (b < 0.5) overlay resolves to 2*b*g, so a tile pixel at
// 0.5 + a moves the surface up by 2*b*a in linear terms, which is why UP is the
// number to watch and DOWN is nearly free.
// ---------------------------------------------------------------------------
//
// WHAT MAKES IT READ AS CLOTH rather than as television static: three layers at
// different frequencies. Fine per-pixel noise alone is static. Felt is fibre
// (short directional strands), nap (the direction the pile lies, which catches
// light in bands) and slow unevenness (the cloth is not perfectly flat).
//
// SEAMLESSNESS IS BY CONSTRUCTION, not by blurring the edges. Every strand is
// drawn nine times, offset by the tile size in each direction, so anything
// crossing an edge arrives on the far side; and the low-frequency layers are
// sums of sinusoids with INTEGER periods across the tile, which wrap exactly.
//
// THE FAILURE MODE IS REPETITION, NOT SEAMS. A small tile repeated across a
// 1920px television shows its lattice immediately even when no single seam is
// visible. That is why SIZE is 512 rather than 200, and why the stylesheet
// gives the TV a larger background-size so it repeats fewer times.

import { writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "apps/web/src/textures/felt.webp");
const CHROME = "/opt/pw-browsers/chromium";
const CDP_PORT = 9351;

const SIZE = 512;
// How far the cloth travels from mid grey, up and down. See the note above for
// why these are not the same number.
const AMPLITUDE_UP = 0.018;
const AMPLITUDE_DOWN = 0.075;
// Lossy, and the amplitude above is budgeted around it. WebP rings the extremes
// outward: at quality 0.9 a tile drawn to 133 decodes at 139. Quality 1.0 lands
// exactly on the budget and costs 139KB, which is larger than the whole main
// stylesheet for a decoration; 0.9 costs 33KB and the ringing is simply priced
// in. The guard measures the DECODED file, so the number that matters is
// checked whatever the encoder does.
const QUALITY = 0.9;
/** The most of its own contrast, as a fraction, the cloth may cost any pair. */
const MAX_RELATIVE_COST = 0.04;
/** And nothing may cross its floor, whatever the fraction says. */
const FLOORS = { "--gn-faint on --gn-surf (tabletop)": 3.0 };
const DEFAULT_FLOOR = 4.5;

// --------------------------------------------------------------- the drawing
//
// Runs inside the browser: it needs a canvas to draw on and, more usefully, the
// browser's own WebP encoder, which saves this script a native dependency that
// is not otherwise in the repo (there is no sharp, no cwebp and no ImageMagick
// here, and adding one to draw a single tile would be the tail wagging the dog).
const DRAW = (size, up, down, quality) => `(async () => {
  const S = ${size}, UP = ${up}, DOWN = ${down};
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true });

  // Deterministic noise: the same tile every run, so regenerating it produces
  // no diff unless a parameter actually changed.
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5;  seed >>>= 0;
    return seed / 0x100000000;
  };

  const field = new Float32Array(S * S);

  // --- 1. SLOW UNEVENNESS -------------------------------------------------
  // Sums of sinusoids with INTEGER periods, so the field wraps exactly. Low
  // frequencies only: this is the cloth not lying perfectly flat, the thing
  // that stops a large expanse looking like a printed swatch.
  const waves = [];
  for (let i = 0; i < 7; i++) {
    waves.push({
      nx: 1 + Math.floor(rnd() * 3), ny: 1 + Math.floor(rnd() * 3),
      px: rnd() * Math.PI * 2, py: rnd() * Math.PI * 2,
      amp: 0.5 / (i + 1),
    });
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const w of waves) {
        v += w.amp
          * Math.sin((2 * Math.PI * w.nx * x) / S + w.px)
          * Math.sin((2 * Math.PI * w.ny * y) / S + w.py);
      }
      // DAMPED HARD, and this number is the difference between cloth and a
      // visible grid. Large-scale structure inside a tile is what a repeat
      // exposes: at 0.42 more than half the tile's variance sat at coarse
      // scales and 1920px of it read as a lattice of blobs rather than as
      // felt. The unevenness has to be present but faint; the fibre carries
      // the texture, and fibre is too fine to repeat visibly.
      field[y * S + x] = v * 0.10;
    }
  }

  // --- 2. NAP -------------------------------------------------------------
  // The direction the pile lies. Broad soft bands running across the weave at a
  // shallow angle, so light catches unevenly the way it does on a real table.
  //
  // THE DIRECTION COEFFICIENTS MUST BE INTEGERS. The first cut used (0.35,
  // 0.94) to get a pleasing angle and that single choice broke the tile: at
  // three cycles it puts 1.05 cycles across the width, so the pattern arrives
  // at the right-hand edge a twentieth of a cycle out of phase with the left
  // and the repeat shows as a hard vertical line. The seam check measured it at
  // 29x a normal pixel step. With integers the wrap is exact by construction,
  // and 1:3 is still a shallow angle.
  const NAP_X = 1, NAP_Y = 3;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x * NAP_X + y * NAP_Y) / S;
      field[y * S + x] += 0.10 * Math.sin(2 * Math.PI * 3 * u) * Math.sin(2 * Math.PI * 5 * u + 1.1);
    }
  }

  // --- 3. FIBRE -----------------------------------------------------------
  // Short strands, mostly along the nap with a wide spread, each a shallow ramp
  // so it has a lit side and a shadowed one. Wrapped by drawing every strand
  // into the field with modulo addressing, which is what makes the tile seam
  // free without any edge treatment.
  const STRANDS = S * 26;
  const plot = (x, y, v) => {
    const xi = ((x | 0) % S + S) % S, yi = ((y | 0) % S + S) % S;
    field[yi * S + xi] += v;
  };
  for (let i = 0; i < STRANDS; i++) {
    const x0 = rnd() * S, y0 = rnd() * S;
    const ang = 1.216 + (rnd() - 0.5) * 1.5;   // along the nap, widely spread
    const len = 3 + rnd() * 7;
    const bright = (rnd() - 0.42) * 1.15;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let t = 0; t < len; t++) {
      const f = 1 - t / len;
      plot(x0 + dx * t, y0 + dy * t, bright * f * 0.5);
      // The strand's own shadow, one pixel off-axis: a lit fibre next to a dark
      // gap is what reads as pile rather than as speckle.
      plot(x0 + dx * t - dy, y0 + dy * t + dx, -bright * f * 0.28);
    }
  }

  // --- normalise to +/- A about mid grey ----------------------------------
  //
  // NORMALISED BY SPREAD, NOT BY THE EXTREME. Dividing by the single largest
  // value in the field is the obvious thing and it produced a dead tile: a
  // handful of bright fibre crossings set the scale and squashed everything
  // else into a band under one grey level wide, so the amplitude budget was
  // spent entirely on outliers nobody can see. Mapping 2.5 standard deviations
  // onto the budget and clipping the rest puts the range where the pixels
  // actually are. The clip is deliberate: a few saturated fibres is what a lit
  // pile looks like.
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += field[i];
  const mu = sum / field.length;
  let acc = 0;
  for (let i = 0; i < field.length; i++) acc += (field[i] - mu) ** 2;
  const sigma = Math.sqrt(acc / field.length) || 1;
  const span = sigma * 2.5;
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < field.length; i++) {
    const n = Math.max(-1, Math.min(1, (field[i] - mu) / span));
    const g = Math.round(255 * (0.5 + n * (n >= 0 ? UP : DOWN)));
    img.data[i * 4] = g; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = g; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const blob = await new Promise((r) => cv.toBlob(r, 'image/webp', ${quality}));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);

  // MEASURE THE ENCODED FILE, NOT THE CANVAS. Lossy WebP does not preserve the
  // extremes: it ringed a tile budgeted to 136 out to 147, so a bound checked
  // against the canvas was checking bytes that never shipped. Decode what was
  // actually written and report those figures to the guard.
  const back = new Image();
  back.src = URL.createObjectURL(blob);
  await back.decode();
  const cv2 = new OffscreenCanvas(S, S);
  const c2 = cv2.getContext('2d', { willReadFrequently: true });
  c2.drawImage(back, 0, 0);
  const dec = c2.getImageData(0, 0, S, S).data;
  let min = 255, max = 0;
  for (let i = 0; i < dec.length; i += 4) { if (dec[i] < min) min = dec[i]; if (dec[i] > max) max = dec[i]; }
  let sum2 = 0;
  for (let i = 0; i < dec.length; i += 4) sum2 += dec[i];
  const mean2 = sum2 / (dec.length / 4);
  let ss2 = 0;
  for (let i = 0; i < dec.length; i += 4) ss2 += (dec[i] - mean2) ** 2;
  const sd = Math.sqrt(ss2 / (dec.length / 4));
  return { b64: btoa(bin), min, max, sd: +sd.toFixed(2), bytes: buf.length };
})()`;

// ------------------------------------------------------------ contrast guard

const hexToRgb = (h) => {
  let s = h.replace("#", "");
  if (s.length === 3) s = [...s].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

/** Overlay one greyscale value g (0-255) onto a base channel c (0-255). */
const overlay = (c, g) => {
  const b = c / 255, s = g / 255;
  const r = b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
  return Math.max(0, Math.min(255, r * 255));
};

/**
 * Every pair the contrast test measures where the BACKGROUND is a surface the
 * cloth actually covers. Text is not textured; the surface under it is.
 */
const GUARDED = [
  { fg: "#f7f0e2", bg: "#15110b", what: "--gn-ink on --gn-bg (tabletop)" },
  { fg: "#f7f0e2", bg: "#201a12", what: "--gn-ink on --gn-surf (tabletop)" },
  { fg: "#c6b99f", bg: "#201a12", what: "--gn-dim on --gn-surf (tabletop)" },
  { fg: "#948870", bg: "#201a12", what: "--gn-place on --gn-surf (tabletop)" },
  { fg: "#8a7f68", bg: "#201a12", what: "--gn-faint on --gn-surf (tabletop)" },
  { fg: "#ff7a1a", bg: "#0d262b", what: "--pp-accent on --pp-felt (tabletop)" },
  { fg: "#f7f0e2", bg: "#0d262b", what: "--gn-ink on --pp-felt (tabletop)" },
];

function checkContrast(min, max) {
  const rows = [];
  for (const { fg, bg, what } of GUARDED) {
    const base = hexToRgb(bg), text = hexToRgb(fg);
    const flat = ratio(text, base);
    // Worst case is whichever extreme of the cloth moves the surface TOWARDS
    // the text, since that is the direction that costs contrast.
    const lightest = base.map((c) => overlay(c, max));
    const darkest = base.map((c) => overlay(c, min));
    const worst = Math.min(ratio(text, lightest), ratio(text, darkest));
    rows.push({ what, flat, worst, cost: flat - worst, rel: (flat - worst) / flat, floor: FLOORS[what] ?? DEFAULT_FLOOR });
  }
  return rows;
}

// --------------------------------------------------------------------- main

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      const slot = pending.get(m.id);
      if (!slot) return;
      pending.delete(m.id);
      m.error ? slot.reject(new Error(JSON.stringify(m.error))) : slot.resolve(m.result);
    });
    ws.addEventListener("error", reject);
    ws.addEventListener("open", () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
        close: () => ws.close(),
      }));
  });
}

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--no-sandbox", "--disable-gpu", "about:blank"], { stdio: "ignore" });
try {
  let tab = null;
  for (let i = 0; i < 60 && !tab; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      tab = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
  }
  if (!tab) throw new Error("chromium did not start");
  const cdp = await connect(tab.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression: DRAW(SIZE, AMPLITUDE_UP, AMPLITUDE_DOWN, QUALITY), returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
  const { b64, min, max, sd, bytes } = result.value;

  const rows = checkContrast(min, max);
  console.log(`tile ${SIZE}x${SIZE}, decoded grey ${min}..${max} (mid 128), sd ${sd}, ${(bytes / 1024).toFixed(1)}KB webp\n`);
  console.log("contrast cost of the cloth, per guarded pair:");
  let worstRel = 0;
  const under = [];
  for (const r of rows) {
    worstRel = Math.max(worstRel, r.rel);
    if (r.worst < r.floor) under.push(`${r.what}: ${r.worst.toFixed(2)} is under its ${r.floor} floor`);
    console.log(`  ${r.what.padEnd(34)} ${r.flat.toFixed(2)} -> ${r.worst.toFixed(2)}  (${(r.rel * 100).toFixed(1)}% of it)`);
  }
  if (worstRel > MAX_RELATIVE_COST || under.length) {
    console.error(`\nREFUSING TO WRITE.`);
    if (worstRel > MAX_RELATIVE_COST) console.error(`  worst relative cost ${(worstRel * 100).toFixed(1)}%, over the ${MAX_RELATIVE_COST * 100}% bound.`);
    for (const u of under) console.error("  " + u);
    console.error("Lower AMPLITUDE_UP, or raise the bound deliberately and say why.");
    process.exit(1);
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.from(b64, "base64"));
  console.log(`\nworst relative cost ${(worstRel * 100).toFixed(1)}% of the ${MAX_RELATIVE_COST * 100}% allowed`);
  console.log(`wrote ${OUT}`);
  cdp.close();
} finally {
  chrome.kill("SIGKILL");
}

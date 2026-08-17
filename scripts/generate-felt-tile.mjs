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
// AND THE BOUND APPLIES TO THE SURFACE THE CLOTH ACTUALLY COVERS, WHICH IS NOT
// EVERY SURFACE. That is the correction of 2026-08-03, and it was costing real
// texture. The first version listed every pair theme-contrast.test.ts measures,
// including text on --gn-surf and on Ping Pong's felt, and capped the tile so
// that none of them moved. None of them is textured: the ambient layer is
// `.gn-app::before` at z-index 0 and `.gn-app > *` sits at z-index 1, so every
// card, input and button paints ON TOP of the cloth, and a pack root is not
// inside the shell's texture host at all. So the cap was being set by surfaces
// the tile never touches, which is how it ended up at a standard deviation of
// 4.6: cloth so flat that, once multiplied into a base as dark as the one it
// was pointed at, its entire range came to six levels out of 255.
//
// The gate is now the FLOOR, on the surfaces the cloth genuinely covers: the
// felt, the felt under the lamp, and (since the card became a translucent
// darkening rather than a colour) a card sitting on that lit felt. The lit ones
// are the binding cases, since every text colour here is light and a brighter
// surface is a smaller gap. The
// relative cost is still computed and printed, and still has a cap, but it is a
// backstop against a tile that has gone wild rather than the thing deciding how
// much weave the theme is allowed. Raise the amplitude and check the pairs;
// never cap the amplitude to avoid having to check them.
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
// How far the cloth travels from mid grey, in GREY LEVELS of standard
// deviation. One symmetric number, because the pair this replaced (0.032 up
// against 0.130 down) was a dark skew that turned fibre into speckle. At 4.0 the
// tile runs 109..146 and the average step between neighbours is under one level:
// visible as cloth, invisible as grain.
//
// IT CAME DOWN FROM 6.4 IN TWO STEPS AND NEITHER WAS TASTE. First the lamp
// became a pool, which put its centre inside the viewport at full --gn-felt-lit
// (see FELT_CROWN below) and moved the surface --gn-dim is read against up by
// 0.32 of a ratio point; 6.4 spent contrast that surface no longer had and the
// script refused to write. Then the low-frequency terms in the field came down a
// fifth to kill a diagonal lattice, and that CHANGES WHAT A GIVEN SD COSTS: the
// same deviation built out of fine fibre has far longer tails than one built out
// of smooth sinusoids, and this guard's worst case is the single most extreme
// pixel. 5.4 of the old field ran 112..144; 5.4 of this one runs 104..153 and
// breaches both the floor and the 20% bound. 4.0 runs 109..146, clears the crown
// pair at 4.59, and measures 4.48 on screen against felt-variance's 2.5 floor.
// The bytes go up with it (9.8KB to 19.5KB) because noise is what a lossy codec
// cannot compress, which is the trade being made knowingly.
const TARGET_SD = 4.0;
const QUALITY = 0.9;
/**
 * A backstop, not the design constraint. See the note above: the floors decide
 * how much weave is affordable, and this only catches a tile that has gone wild
 * enough to be eating a fifth of a pair's contrast on its own.
 */
const MAX_RELATIVE_COST = 0.2;
/** And nothing GATED may cross its floor, whatever the fraction says. */
const FLOORS = {
  // The third text level, "present but not read" in its own comment, and
  // exempt at 3.0 in theme-contrast.test.ts for the same reason and since
  // stage 1. Repeated here rather than inferred, so exactly one pair is
  // exempt and it is obvious which.
  "--gn-faint on a card at the crown": 3.0,
  // Board Game's two television-only pairs. See the note beside them in
  // GUARDED: both are painted at 28px and up, which is WCAG's large-text
  // threshold, and 3.0 is the floor that applies to text that size.
  "--tn-accent on the olive crown (TV)": 3.0,
  "--tn-tv-muted on the olive crown (TV)": 3.0,
};
const DEFAULT_FLOOR = 4.5;

// --------------------------------------------------------------- the drawing
//
// Runs inside the browser: it needs a canvas to draw on and, more usefully, the
// browser's own WebP encoder, which saves this script a native dependency that
// is not otherwise in the repo (there is no sharp, no cwebp and no ImageMagick
// here, and adding one to draw a single tile would be the tail wagging the dog).
const DRAW = (size, targetSd, quality) => `(async () => {
  const S = ${size}, TARGET_SD = ${targetSd};
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true });

  // Deterministic noise: the same tile every run, so regenerating it produces
  // no diff unless a parameter actually changed. mulberry32 rather than the
  // xorshift this used before, purely so the identical field can be produced
  // outside a browser and checked against what ships.
  let a0 = 0x9e3779b9;
  const rnd = () => {
    a0 |= 0; a0 = (a0 + 0x6d2b79f5) | 0;
    let t = Math.imul(a0 ^ (a0 >>> 15), 1 | a0);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // --- CLOTH, NOT PLASTER --------------------------------------------------
  //
  // The version this replaces drew fibre as single-pixel strands, each with a
  // hard one-pixel shadow beside it, over seven octaves of low-frequency
  // blobbing, then normalised it ASYMMETRICALLY: 0.032 up against 0.130 down.
  // Every one of those choices pushes the same way. Hard pixel pairs never get
  // smoothed, coarse blobs dominate the variance, and a dark-skewed map turns
  // the whole thing into speckle. Measured on the shipped tile, the average
  // step between neighbouring pixels was 5.4 grey levels: that is not cloth,
  // that is grit, and it is why the surface read as stucco.
  //
  // This builds the same amount of variance out of SMOOTH, HIGH-FREQUENCY
  // material instead. Same standard deviation, average neighbour step 0.94.
  // Softness is not less texture, it is texture with the sharp edges taken off.
  let f = new Float64Array(S * S);
  for (let i = 0; i < S * S; i++) {
    // Four uniforms averaged: normal-ish, so most fibre sits near the middle
    // and the extremes are rare, the way a pile lies.
    f[i] = (rnd() + rnd() + rnd() + rnd() - 2) * 0.5;
  }

  // WRAPPED 1-2-1 BLUR. Wrapping is the entire seam treatment: every lookup is
  // modulo S, so the tile is continuous across its own edges by construction
  // rather than by a fix-up pass.
  const blur = (src, horizontal) => {
    const out = new Float64Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let l, m, r;
        if (horizontal) {
          l = src[y * S + ((x - 1 + S) % S)];
          m = src[y * S + x];
          r = src[y * S + ((x + 1) % S)];
        } else {
          l = src[((y - 1 + S) % S) * S + x];
          m = src[y * S + x];
          r = src[((y + 1) % S) * S + x];
        }
        out[y * S + x] = (l + 2 * m + r) * 0.25;
      }
    }
    return out;
  };

  // Two full passes, then ONE extra along x. The extra pass is the NAP: cloth
  // has a direction and an isotropic tile reads as stone. This is a cheaper and
  // far more stable way to get direction than the sinusoid bands it replaces,
  // which had to have integer coefficients or the tile seamed.
  for (let p = 0; p < 2; p++) { f = blur(f, true); f = blur(f, false); }
  f = blur(f, true);

  // A whisper of unevenness, at integer periods so it still wraps. Kept tiny on
  // purpose: coarse structure inside a tile is what a repeat exposes as a
  // lattice across 1920px, and it is what made the last one look blotchy.
  //
  // 0.30 AND 0.18 WERE NOT TINY ENOUGH ONCE THE STYLESHEET PAINTED THE TILE AT
  // 150px, and this is the whole lesson of that pair of numbers. A 512px tile
  // painted at 150 is downscaled 3.4x, which averages the fine fibre away and
  // leaves the coarse terms almost untouched: normalising on the total standard
  // deviation then means the SURVIVING structure is nearly all sinusoid, and the
  // second term is diagonal at half the tile's period, so the screen filled with
  // regular diagonal streaks every 75px. Cloth became brushed metal. Screenshot
  // it at the size the stylesheet actually paints, never at 1:1: at 1:1 both
  // versions look like felt, which is exactly why this shipped once already.
  // The amplitudes are now a fifth of what they were, which puts the variance
  // back into the fibre where the weave is.
  const w = (2 * Math.PI) / S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      f[y * S + x] += Math.sin(x * w) * Math.cos(y * w) * 0.06
                    + Math.sin((x + y) * w * 2) * 0.035;
    }
  }

  // NORMALISE SYMMETRICALLY, ON THE STANDARD DEVIATION. TARGET_SD is in grey
  // levels, so the amplitude bound is stated in the same units the contrast
  // guard measures, instead of in two different fractions pulling opposite ways.
  let mean = 0;
  for (let i = 0; i < f.length; i++) mean += f[i];
  mean /= f.length;
  let acc = 0;
  for (let i = 0; i < f.length; i++) acc += (f[i] - mean) * (f[i] - mean);
  const sd = Math.sqrt(acc / f.length) || 1;
  const k = TARGET_SD / sd;

  const img = ctx.createImageData(S, S);
  for (let i = 0; i < f.length; i++) {
    const g = Math.max(0, Math.min(255, Math.round(128 + (f[i] - mean) * k)));
    img.data[i * 4] = g; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
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
  // sdDec, NOT sd. The pre-normalise deviation above is already a const in this
  // same scope, and shadowing it here threw
  // "SyntaxError: Identifier 'sd' has already been declared" before a single
  // pixel was drawn, which is why the tile in the repo was a placeholder for a
  // week: this script could not run, so nobody could regenerate it, and nothing
  // downstream could tell a broken image from a working one.
  const sdDec = Math.sqrt(ss2 / (dec.length / 4));
  return { b64: btoa(bin), min, max, sd: +sdDec.toFixed(2), bytes: buf.length };
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
 * The pairs that decide how much weave is affordable, and the ones that are
 * only reported.
 *
 * GATED are text colours on a surface the cloth genuinely covers: the felt, and
 * the felt under the lamp. `--gn-place` and `--gn-faint` are not here on
 * purpose and it is not an oversight. Place is `.gn-input::placeholder` and
 * faint is bracket slots and seed numbers, both of which sit inside cards and
 * inputs, which paint above the texture layer. A pair that is never rendered on
 * cloth must not be allowed to set the cloth's amplitude.
 *
 * THE LIT CROWN IS THE BINDING CASE and is where the ceiling actually comes
 * from: every text colour in this theme is light, so the brighter the surface
 * the smaller the gap, and the lamp is the brightest the felt ever gets. Its
 * value here is the lamp colour at the strength the stylesheet paints it,
 * composited over the felt, kept in step with `--gn-felt` and `--gn-felt-lit`
 * by hand, which is why both are spelled out with their token names.
 */
const FELT = "#16402c";       // --gn-felt
// THE CROWN IS NOW THE FULL --gn-felt-lit, AND THAT IS THE LAMP MOVING, NOT A
// TIGHTENING FOR ITS OWN SAKE. This was #24563b, the lit colour at 85%, because
// the shipped lamp's brightest stop was 88% and its centre sat ON the top edge
// of the screen at `at 50% 0%`, so nothing on the page ever saw the full value.
// The revised lamp is a pool rather than a wash: its centre is at `50% 5%`,
// which is inside the viewport, and its first stop is the lit colour at full
// strength. The brightest pixel a person can read text against is therefore
// exactly --gn-felt-lit, and gating on anything darker gates on a screen that
// no longer exists.
const FELT_CROWN = "#265a3e"; // --gn-felt-lit, at the centre of the pool
// THE CARD IS TEXTURED TOO, since 2026-08-03: it is a darkening of whatever it
// is laid on, so the weave carries straight through it. The card ON THE CROWN is
// the worst of the four surfaces here for a light ink. At the revised
// rgba(22,15,8,.62) it is far darker than the rgba(0,0,0,.24) card this
// replaces, which is what buys back the accent contrast the .24 card gave away.
const CARD_ON_CROWN = "#1c2c1d";
const INK = "#f7f0e2", DIM = "#ddd3bd", PLACE = "#baae99", FAINT = "#998e79";
// Board Game's baize and its crown, from apps/web/src/boardgame/boardgame.css,
// plus the two pack colours that land on them.
const BG_FELT = "#232819", BG_CROWN = "#3a4129";
const TN_DISPLAY = "#f4e7cf", TN_ACCENT = "#e0a54a", TN_TV_MUTED = "#c2ab8a";
const GUARDED = [
  { fg: INK, bg: FELT, what: "--gn-ink on --gn-felt", gate: true },
  { fg: DIM, bg: FELT, what: "--gn-dim on --gn-felt", gate: true },
  { fg: INK, bg: FELT_CROWN, what: "--gn-ink on the lit crown", gate: true },
  { fg: DIM, bg: FELT_CROWN, what: "--gn-dim on the lit crown", gate: true },
  { fg: INK, bg: CARD_ON_CROWN, what: "--gn-ink on a card at the crown", gate: true },
  { fg: DIM, bg: CARD_ON_CROWN, what: "--gn-dim on a card at the crown", gate: true },
  { fg: PLACE, bg: CARD_ON_CROWN, what: "--gn-place on a card at the crown", gate: true },
  { fg: FAINT, bg: CARD_ON_CROWN, what: "--gn-faint on a card at the crown", gate: true },

  // BOARD GAME, AND THIS IS THE LIST GROWING THE WAY IT WAS ALWAYS GOING TO.
  // The note above says the bound applies to the surface the cloth actually
  // covers, and until now that was the shell alone: a pack root is not inside
  // `.gn-app::before`, so nothing painted a pack through the weave. Board Game
  // is the first pack to compose the tile into its own backdrop, so its baize
  // is now a textured surface and belongs here. One block per converted pack.
  //
  // The values are --bg-felt and --bg-felt-lit from boardgame.css, spelled out
  // and kept in step by hand, exactly as the shell's two are.
  { fg: INK, bg: BG_FELT, what: "--gn-ink on the olive baize", gate: true },
  { fg: DIM, bg: BG_FELT, what: "--gn-dim on the olive baize", gate: true },
  { fg: INK, bg: BG_CROWN, what: "--gn-ink on the olive crown", gate: true },
  { fg: DIM, bg: BG_CROWN, what: "--gn-dim on the olive crown", gate: true },
  { fg: TN_DISPLAY, bg: BG_CROWN, what: "--tn-display on the olive crown", gate: true },
  // THE TV'S OWN TWO, AT THE LARGE-TEXT FLOOR. Both of these are only ever
  // painted on a television: --tn-accent is `.tn-tv__title` at 7.4vmin and
  // --tn-tv-muted is `.tn-tv__label` at 2.6vmin, which are about 80px and 28px
  // on a 1080 screen. WCAG's floor for text that size is 3.0, not 4.5, and
  // holding an 80px title to the body-copy floor would set this whole pack's
  // palette from a constraint that does not apply to it. Gated rather than
  // merely reported, because "large" is a property of these two selectors and
  // a future weave still must not eat them.
  { fg: TN_ACCENT, bg: BG_CROWN, what: "--tn-accent on the olive crown (TV)", gate: true },
  { fg: TN_TV_MUTED, bg: BG_CROWN, what: "--tn-tv-muted on the olive crown (TV)", gate: true },

  // Reported, not gated: Ping Pong's table is not textured yet. It is here so
  // that the day its conversion lands, the numbers are already on the page.
  { fg: "#ff7a1a", bg: "#0d262b", what: "--pp-accent on --pp-felt (not textured yet)", gate: false },
  { fg: INK, bg: "#0d262b", what: "--gn-ink on --pp-felt (not textured yet)", gate: false },
];

function checkContrast(min, max) {
  const rows = [];
  for (const { fg, bg, what, gate } of GUARDED) {
    const base = hexToRgb(bg), text = hexToRgb(fg);
    const flat = ratio(text, base);
    // Worst case is whichever extreme of the cloth moves the surface TOWARDS
    // the text, since that is the direction that costs contrast.
    const lightest = base.map((c) => overlay(c, max));
    const darkest = base.map((c) => overlay(c, min));
    const worst = Math.min(ratio(text, lightest), ratio(text, darkest));
    rows.push({ what, gate, flat, worst, cost: flat - worst, rel: (flat - worst) / flat, floor: FLOORS[what] ?? DEFAULT_FLOOR });
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
    expression: DRAW(SIZE, TARGET_SD, QUALITY), returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
  const { b64, min, max, sd, bytes } = result.value;

  const rows = checkContrast(min, max);
  console.log(`tile ${SIZE}x${SIZE}, decoded grey ${min}..${max} (mid 128), sd ${sd}, ${(bytes / 1024).toFixed(1)}KB webp\n`);
  console.log("contrast cost of the cloth, per guarded pair:");
  let worstRel = 0;
  const under = [];
  for (const r of rows) {
    if (r.gate) {
      worstRel = Math.max(worstRel, r.rel);
      if (r.worst < r.floor) under.push(`${r.what}: ${r.worst.toFixed(2)} is under its ${r.floor} floor`);
    }
    console.log(`  ${r.gate ? "GATE" : "    "} ${r.what.padEnd(42)} ${r.flat.toFixed(2)} -> ${r.worst.toFixed(2)}  (${(r.rel * 100).toFixed(1)}% of it)`);
  }
  if (worstRel > MAX_RELATIVE_COST || under.length) {
    console.error(`\nREFUSING TO WRITE.`);
    if (worstRel > MAX_RELATIVE_COST) console.error(`  worst relative cost ${(worstRel * 100).toFixed(1)}%, over the ${MAX_RELATIVE_COST * 100}% bound.`);
    for (const u of under) console.error("  " + u);
    console.error("Lower TARGET_SD, or raise the bound deliberately and say why.");
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

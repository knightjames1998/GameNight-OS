// Does the cloth actually have a weave IN PIXELS?
//
// WHY THIS EXISTS, and it is the lesson of the session that shipped the felt.
// `theme-sweep.mjs` compares computed CSS values, and every value in that
// session matched its specification exactly: the tile was loaded, the tint was
// set, the blend mode was `overlay`. The sweep was green and the screen was
// flat, because a sweep cannot catch a correct implementation of a WRONG SPEC.
// The spec was wrong by arithmetic: `overlay` against a base darker than 50%
// resolves to `2 x base x texture`, and the tint pointed at the page's darkest
// walnut (#15110b, channels 0.082/0.067/0.043), so the tile's entire 102..139
// range collapsed to a swing of 6, 5 and 3 levels out of 255, below what a
// phone shows in a lit room.
//
// So this measures the thing a person actually sees: it screenshots the real
// built app, samples a rectangle of surface with no content on it, and reports
// the standard deviation of the pixels. Same family as the money board being
// measured against the last rendered element rather than the footer, and the
// stage 4 sweep being made to run on a route where the stylesheet was actually
// loaded.
//
// USAGE
//   node scripts/felt-variance.mjs            both themes, exit 1 if Tabletop is flat
//   node scripts/felt-variance.mjs --json     the same numbers as JSON
//
// THE FLOOR IS A PER-CHANNEL STANDARD DEVIATION, not a range. A range is the
// two most extreme pixels in the sample and is therefore one dust speck away
// from passing a flat surface; a standard deviation describes the whole
// sample, which is what "does this look like cloth" is asking about.
//
// IT IS A FLOOR AGAINST FLATNESS, NOT A SCORE, and reading it as a score will
// send somebody the wrong way. A per-pixel deviation necessarily FALLS as the
// grain gets finer at constant amplitude, because painting a 512px tile at
// 220px averages neighbouring pixels together: the same build measured 4.04 at
// the old coarse paint size and 2.86 at the finer one, and the finer one is the
// one that stopped looking like stucco. Do not "improve" this number by making
// the weave coarser again.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4191);
const CDP_PORT = Number(process.env.CDP || 9353);
const CHROME = "/opt/pw-browsers/chromium";
const JSON_OUT = process.argv.includes("--json");

// A desktop-ish viewport rather than a phone, because the shell's content
// column is centred and narrow there, which leaves a genuinely empty gutter of
// surface on both sides to sample.
const VIEW = { width: 1280, height: 800 };

// The sample window, in CSS pixels, inside the left gutter. Clear of the rail
// (14px of timber plus its shadow) and clear of the content column, and tall
// enough to cross more than one repeat of a 512px tile.
const SAMPLE = { x: 60, y: 180, w: 180, h: 560 };

// The floor, and it was SET FROM THE NEGATIVE CONTROL rather than guessed. The
// first number here was 1.2, which looked generous against a screen measuring
// 0.42, and was worthless: with the tile's amplitude raised, pointing the tint
// back at the dark walnut (the exact bug this check exists to catch) still
// measured 1.36 and still passed. A floor that a known-broken build clears is
// decoration.
//
// The three numbers this sits between, all measured on the real built bundle:
//   0.42  the shipped-flat build (dark tint, tight tile): the bug
//   1.36  the same dark tint with the raised tile: still flat, still wrong
//   4.04  felt on its own lit surface: cloth
const FLOOR = 2.5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------- CDP plumbing

const preview = spawn("pnpm", ["--filter", "@gamenight/web", "exec", "vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--no-sandbox", "--disable-gpu", "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });
const bail = (code) => { chrome.kill("SIGKILL"); preview.kill("SIGKILL"); process.exit(code); };
await sleep(5000);

const tab = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map(), handlers = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method) return handlers.get(m.method)?.(m.params);
  pending.get(m.id)?.(m); pending.delete(m.id);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.result?.value;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { ...VIEW, deviceScaleFactor: 1, mobile: false });

// Signed out is the right state to measure in: it is the screen with the least
// content on it, so the gutter is unambiguously surface. A hard 404 on
// everything keeps both themes on the same screen.
handlers.set("Fetch.requestPaused", ({ requestId, request }) => {
  const p = new URL(request.url).pathname;
  if (!p.startsWith("/api/")) { send("Fetch.continueRequest", { requestId }).catch(() => {}); return; }
  send("Fetch.fulfillRequest", {
    requestId, responseCode: 404,
    responseHeaders: [{ name: "content-type", value: "application/json" }],
    body: Buffer.from('{"error":"no"}').toString("base64"),
  }).catch(() => {});
});
await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });

// ------------------------------------------------------------------ measuring

/**
 * The sample has to be SURFACE. If a card, a button or a heading drifts into
 * the window, its flat fill drags the deviation down (or its edge spikes it
 * up) and the number stops being about the cloth. Asked of the document rather
 * than assumed from the layout, on a grid across the window.
 */
const EMPTY_CHECK = `(() => {
  const { x, y, w, h } = ${JSON.stringify(SAMPLE)};
  const hits = new Set();
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 12; j++) {
    const el = document.elementFromPoint(x + (w * i) / 6, y + (h * j) / 12);
    if (el) hits.add(el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).join(".") : ""));
  }
  return [...hits];
})()`;

/**
 * Decode the screenshot back inside the browser, because Node has no PNG
 * decoder in its standard library and this script deliberately has no
 * dependencies (same rule as theme-sweep.mjs and the tile generator).
 */
const MEASURE = (b64) => `(async () => {
  const img = new Image();
  img.src = "data:image/png;base64,${b64}";
  await img.decode();
  const { x, y, w, h } = ${JSON.stringify(SAMPLE)};
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const sum = [0, 0, 0], sq = [0, 0, 0], lo = [255, 255, 255], hi = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const v = d[i + k];
      sum[k] += v; sq[k] += v * v;
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  const mean = sum.map((s) => s / n);
  const sd = sq.map((s, k) => Math.sqrt(Math.max(0, s / n - mean[k] * mean[k])));
  return { mean, sd, lo, hi, n };
})()`;

// The theme is seeded by a document-start script rather than by writing
// localStorage from wherever the browser happens to be sitting. Writing it
// while the page is `about:blank` stores it against the about: origin, which
// the app never reads, so BOTH runs come back as Arcade and the check reports
// a healthy number about the wrong theme. Same trap the font check hit.
//
// The wait after navigating is load bearing too: a screenshot taken before the
// tile has decoded measures a flat surface and blames the theme for it.
let seeder = null;
async function load(theme) {
  if (seeder) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seeder });
  ({ identifier: seeder } = (await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem("gamenight.pref.theme",${JSON.stringify(theme)})}catch(e){}`,
  })).result);
  await send("Page.navigate", { url: "about:blank" });
  await sleep(200);
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
  await sleep(3000);
}

const results = {};
for (const theme of ["arcade", "tabletop"]) {
  await load(theme);
  const over = await evaluate(EMPTY_CHECK);
  const shot = (await send("Page.captureScreenshot", { format: "png" })).result.data;
  // The screenshot goes back into a blank page to be decoded, so the app's own
  // CSP and the page's memory are out of the way.
  await send("Page.navigate", { url: "about:blank" });
  await sleep(200);
  const m = await evaluate(MEASURE(shot));
  results[theme] = { ...m, over };
}

if (JSON_OUT) {
  console.log(JSON.stringify({ sample: SAMPLE, view: VIEW, floor: FLOOR, results }, null, 2));
} else {
  const f = (a) => a.map((v) => v.toFixed(2).padStart(6)).join(" ");
  console.log(`sample ${SAMPLE.w}x${SAMPLE.h} at (${SAMPLE.x},${SAMPLE.y}) in a ${VIEW.width}x${VIEW.height} viewport, ${SAMPLE.w * SAMPLE.h} px\n`);
  for (const [theme, r] of Object.entries(results)) {
    console.log(`  ${theme}`);
    console.log(`    mean  r g b   ${f(r.mean)}`);
    console.log(`    sd    r g b   ${f(r.sd)}`);
    console.log(`    range r g b   ${r.lo.map((v, k) => `${v}..${r.hi[k]}`).join("  ")}`);
    console.log(`    elements under the sample: ${r.over.join(", ")}`);
  }
}

const tt = results.tabletop;
const best = Math.max(...tt.sd);
const clean = tt.over.length <= 2;   // <main class="gn-app ..."> and at most its wrapper
const ok = best >= FLOOR && clean;
console.log(`\n${ok ? "PASS" : "FAIL"}  Tabletop's cloth reads as cloth: best channel sd ${best.toFixed(2)}, floor ${FLOOR}`);
if (!clean) console.log(`      the sample is not clear surface: ${tt.over.join(", ")}`);
bail(ok ? 0 : 1);

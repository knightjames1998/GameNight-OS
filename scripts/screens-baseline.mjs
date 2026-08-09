// Board Game's SCREENS and Ping Pong's TEAM PICKER, captured from the real built
// bundle over CDP.
//
// The title-night engine is already pinned by unit fixtures. What is not, and
// what the screens extraction is about to move, is what the PAGE, the TV view
// and the STATS PANEL actually render. None of that is visible to a unit test,
// and the extraction has to prove it changed nothing.
//
//   pnpm --filter @gamenight/web build       (the harness serves the BUILT bundle)
//   node scripts/screens-baseline.mjs            record scripts/screens-baseline.json
//   node scripts/screens-baseline.mjs --compare  exit non-zero if any screen moved
//
// The baseline JSON is COMMITTED next to this file, on purpose: the extraction
// runs across several sessions, and a baseline that lives in a temp directory
// proves nothing to whoever reads the diff afterwards.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = "/home/user/GameNight-OS";
const CHROME = "/opt/pw-browsers/chromium";
const PORT = Number(process.env.PORT || 4323);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const HERE = new URL(".", import.meta.url).pathname;
const OUT = HERE + "screens-baseline.json";
const COMPARE = process.argv.includes("--compare");

const NAMES = ["Ann", "Ben", "Cal", "Dee", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jo", "Kit", "Lou"];
const player = (i) => ({ id: `p${i}`, kind: "member", userId: `u${i}`, name: NAMES[i] });
const roster = (n) => Array.from({ length: n }, (_, i) => player(i));
const singleton = (ids) => ids.map((id, i) => ({ id: String.fromCharCode(97 + i), name: `Side ${String.fromCharCode(65 + i)}`, memberIds: [id] }));

const ctx = (n, recents = ["Settlers of Catan", "Wingspan"]) => ({
  groupId: "g1", canHost: true, viewerId: "u0",
  prefill: roster(n).map((p) => ({ userId: p.userId, name: p.name })),
  members: roster(n).map((p) => ({ userId: p.userId, name: p.name })),
  live: false,
  recentTitles: recents,
});

/** A live Board Game night with two games played. */
function bgSession(n) {
  const rs = roster(n);
  const sides = singleton(rs.map((p) => p.id));
  const line = (i, place, score) => ({ playerId: rs[i].id, placement: place, isWinner: place === 1, side: null, score: score ?? null });
  const game = (idx, title, order) => ({
    idx, title, at: `2026-08-09T2${idx}:00:00.000Z`, grain: "player",
    sides: order.map((i) => sides[i]),
    lines: order.map((i, k) => line(i, k + 1, k === 0 ? 92 : null)),
  });
  const games = [game(0, "Catan", rs.map((_, i) => i)), game(1, "Wingspan", rs.map((_, i) => i).reverse())];
  const players = rs.map((p, i) => ({
    playerId: p.id, name: p.name,
    games: 2, wins: i === 0 || i === n - 1 ? 1 : 0,
    avgPlacement: (i + 1 + (n - i)) / 2,
  })).sort((a, b) => b.wins - a.wins);
  return {
    status: "live", groupId: "g1", openScoring: false, nowPlaying: "Azul",
    roster: rs, sideSets: [{ fromIdx: 0, sides }], grain: "player", games,
    summary: {
      players,
      titles: [{ title: "Catan", games: 1 }, { title: "Wingspan", games: 1 }],
      last: { title: "Wingspan", lines: [{ name: NAMES[n - 1], placement: 1, score: 92 }, { name: NAMES[0], placement: n, score: null }] },
    },
  };
}

const bgStats = {
  games: 7, titles: 3,
  byPlayer: [{ userId: "u0", name: "Ann", games: 7, wins: 3, winRate: 3 / 7, avgPlacement: 1.9, titles: 3 }],
  byTitle: [
    { title: "Catan", games: 4, winners: [{ name: "Ann", wins: 3 }, { name: "Ben", wins: 1 }], champion: "Ann", championWins: 3 },
    { title: "Wingspan", games: 2, winners: [{ name: "Ben", wins: 2 }], champion: "Ben", championWins: 2 },
    { title: "Azul", games: 1, winners: [{ name: "Cal", wins: 1 }], champion: "Cal", championWins: 1 },
  ],
  mostPlayed: { title: "Catan", games: 4 },
};
const groupStats = {
  tournaments: 7, leaderboard: [],
  games: [{ name: "Board Game", tournaments: 7, formats: [], leaderboard: [
    { userId: "u0", displayName: "Ann", played: 7, wins: 3, best: 1, winRate: 0.43, avgPlacement: 1.9, byGame: [] },
  ] }],
};

let msgId = 0;
async function cdp(ws, method, params = {}, sessionId) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`timeout ${method}`)), 30000);
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        clearTimeout(to); ws.removeEventListener("message", onMsg);
        m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result);
      }
    };
    ws.addEventListener("message", onMsg);
  });
}

async function main() {
  try {
    if ((await fetch(ORIGIN + "/", { signal: AbortSignal.timeout(1500) })).ok) {
      console.error(`something already serves ${ORIGIN}; it would serve a STALE bundle. Kill it.`);
      process.exit(2);
    }
  } catch {}

  const preview = spawn("node", ["node_modules/vite/bin/vite.js", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT + "/apps/web", stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  const killAll = () => { try { process.kill(-preview.pid, "SIGKILL"); } catch {} try { preview.kill("SIGKILL"); } catch {} };
  process.on("exit", killAll);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(ORIGIN + "/")).ok) break; } catch {} await sleep(500); }

  const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9337", "--no-sandbox", "--disable-gpu", "--hide-scrollbars"], { stdio: ["ignore", "pipe", "pipe"] });
  chrome.stderr.on("data", () => {});
  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    try { wsUrl = (await (await fetch("http://127.0.0.1:9337/json/version")).json()).webSocketDebuggerUrl; if (wsUrl) break; } catch {}
    await sleep(500);
  }
  const ws = new globalThis.WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  const { targetId } = await cdp(ws, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp(ws, "Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => cdp(ws, m, p, sessionId);
  await S("Page.enable"); await S("Runtime.enable");
  await S("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });

  let bgPayload = null;
  let ppPayload = null;
  let rosterN = 4;
  ws.addEventListener("message", async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method !== "Fetch.requestPaused" || m.sessionId !== sessionId) return;
    const { requestId, request } = m.params;
    const u = request.url;
    let body = {};
    if (u.includes("/api/boardgame-context/")) body = ctx(rosterN);
    else if (u.includes("/api/pingpong-context/")) body = ctx(5);
    else if (u.includes("/api/auth/me")) body = { user: { id: "u0", displayName: "Ann" } };
    else if (u.includes("/boardgame-stats")) body = bgStats;
    else if (u.includes("/stats")) body = groupStats;
    else if (u.includes("boardgame/")) body = { session: bgPayload };
    else if (u.includes("pingpong/")) body = { session: ppPayload };
    await cdp(ws, "Fetch.fulfillRequest", {
      requestId, responseCode: 200,
      responseHeaders: [{ name: "content-type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    }, sessionId);
  });

  const evalJs = async (e) => (await S("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
  const view = (w, h) => S("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const goto = async (url) => { await S("Page.navigate", { url }); await sleep(1800); };
  /** Text with volatile bits removed, so a snapshot is comparable run to run. */
  const text = () => evalJs(`document.body.innerText.replace(/\\s+$/gm,'').trim()`);

  const snap = {};

  // ---- Board Game: setup, live page, TV at 4 / 8 / 12, stats panel ----
  await view(390, 844);
  bgPayload = null;
  await goto(`${ORIGIN}/boardgame?event=e1`);
  snap.bgSetup = await text();

  for (const n of [4, 8, 12]) {
    rosterN = n;
    bgPayload = bgSession(n);
    await view(390, 844);
    await goto(`${ORIGIN}/boardgame?event=e1`);
    if (n === 4) snap.bgLive = await text();

    await view(1920, 1080);
    await goto(`${ORIGIN}/boardgame/tv/e1`);
    snap[`bgTv${n}`] = await evalJs(`(() => {
      const back = [...document.querySelectorAll('button, a')].find(b => /back|←/i.test(b.textContent));
      const r = back ? back.getBoundingClientRect() : null;
      return {
        text: document.body.innerText.replace(/\\s+$/gm,'').trim(),
        backBottom: r ? Math.round(r.bottom + window.scrollY) : null,
        pageBottom: Math.round(document.documentElement.getBoundingClientRect().height),
      };
    })()`);
  }

  bgPayload = null;
  await view(390, 844);
  await goto(`${ORIGIN}/g/g1/stats`);
  await evalJs(`(() => { const t=[...document.querySelectorAll('button.gn-tab')].find(b=>b.textContent.trim()==='Board Game'); if(t) t.click(); return !!t; })()`);
  await sleep(900);
  snap.bgPanel = await text();

  // ---- Ping Pong's team picker ----
  ppPayload = null;
  await view(390, 844);
  await goto(`${ORIGIN}/pingpong?event=e1`);
  const readPicker = () => evalJs(`(() => {
    const t = document.body.innerText;
    const sides = [...t.matchAll(/SIDE ([A-H]) \\((\\d)\\)\\n([^]*?)(?=\\nSIDE [A-H] \\(|\\nNOT ON A SIDE|\\n🎲|$)/g)]
      .map(m => ({ side: m[1], count: Number(m[2]), body: m[3].trim().replace(/\\s+/g,' ') }));
    const b = [...document.querySelectorAll('button.pp-btn')].find(x => /^(Start |\\d+ still)/.test(x.textContent.trim()));
    return { sides, warning: /Uneven sides \\(([^)]*)\\)/.exec(t)?.[1] ?? null,
             startLabel: b ? b.textContent.trim() : null, startEnabled: b ? !b.disabled : null };
  })()`);
  const click = (label) => evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); if(!b) return false; b.click(); return true; })()`);
  await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-pressed')!==null&&/ON|OFF/.test(x.textContent)); if(b) b.click(); return !!b; })()`);
  await sleep(400);
  snap.pickerOpen = await readPicker();
  for (const t of ["A", "A", "A", "B", "B"]) {
    await evalJs(`(() => { const row=[...document.querySelectorAll('.pp-row')].find(r=>r.querySelector('.pp-seg button')); if(!row) return false; const b=[...row.querySelectorAll('.pp-seg button')].find(x=>x.textContent.trim()===${JSON.stringify(t)}); if(!b) return false; b.click(); return true; })()`);
    await sleep(220);
  }
  await sleep(300);
  snap.pickerUneven = await readPicker();
  await click("+ Side"); await sleep(350);
  snap.pickerThree = await readPicker();

  // REMOVING AN ASSIGNED PLAYER, which is the picker's one genuinely dangerous
  // operation. Sides are held as ROSTER INDICES (slot ids are minted by the
  // server and this screen has never seen one), so dropping the first player
  // has to renumber every index above them. Get it wrong and the screen looks
  // completely correct with the wrong two people on a side, and nothing errors.
  // Ann is on side A, so A must lose exactly Ann and B must be untouched.
  await evalJs(`(() => {
    const row = [...document.querySelectorAll('.pp-row')].find(r => r.querySelector('.pp-name')?.textContent.trim() === 'Ann');
    const b = row && [...row.querySelectorAll('button')].find(x => x.textContent.trim() === 'remove');
    if (!b) return false; b.click(); return true;
  })()`);
  await sleep(400);
  snap.pickerAfterRemove = await readPicker();

  await click("🎲 Shuffle"); await sleep(400);
  const sh = await readPicker();
  snap.pickerShuffle = { counts: sh.sides.map((x) => x.count).sort(), startEnabled: sh.startEnabled };

  const out = JSON.stringify(snap, null, 1);
  if (COMPARE) {
    const want = JSON.parse(readFileSync(OUT, "utf8"));
    const got = JSON.parse(out);
    const diffs = Object.keys(want).filter((k) => JSON.stringify(want[k]) !== JSON.stringify(got[k]));
    if (diffs.length === 0) console.log(`screens UNCHANGED against the baseline (${Object.keys(want).length} snapshots)`);
    else {
      console.log("SCREENS CHANGED in: " + diffs.join(", "));
      for (const k of diffs) console.log(`\n--- ${k} baseline ---\n${JSON.stringify(want[k], null, 1)}\n--- ${k} now ---\n${JSON.stringify(got[k], null, 1)}`);
      chrome.kill("SIGKILL"); killAll(); process.exit(1);
    }
  } else {
    writeFileSync(OUT, out + "\n");
    console.log(`wrote ${Object.keys(snap).length} snapshots`);
    for (const n of [4, 8, 12]) console.log(`  bgTv${n}: back ${snap[`bgTv${n}`].backBottom}px, page ${snap[`bgTv${n}`].pageBottom}px`);
  }
  chrome.kill("SIGKILL"); killAll();
  process.exit(0);
}
main().catch((e) => { console.error("harness error:", e); process.exit(2); });

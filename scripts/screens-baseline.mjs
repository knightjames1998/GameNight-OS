// Board Game's SCREENS, Ping Pong's TEAM PICKER and the TOURNAMENT SETUP
// screen, captured from the real built bundle over CDP.
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
    // `sides` is the arrangement IN FORCE, flattened out of the sideSets log by
    // the server's extras. The record form taps sides rather than players (on a
    // free-for-all night they are the same thing), so a stub without it renders
    // the error boundary, which is what happened the first time this ran after
    // the field was added.
    roster: rs, sides, sideSets: [{ fromIdx: 0, sides }], grain: "player", games,
    summary: {
      players,
      titles: [{ title: "Catan", games: 1 }, { title: "Wingspan", games: 1 }],
      last: { title: "Wingspan", lines: [{ name: NAMES[n - 1], placement: 1, score: 92 }, { name: NAMES[0], placement: n, score: null }] },
    },
  };
}

/**
 * A live CARD TABLE night mid-Euchre: four players in two pairs, one hand
 * recorded. The pack's whole reason for existing is that the arrangement here
 * is NOT one side per player, so a stub that shipped singletons would prove
 * nothing about the pack that ships partnerships.
 */
function ctSession() {
  const rs = roster(4);
  const sides = [
    { id: "a", name: "Side A", memberIds: [rs[0].id, rs[2].id] },
    { id: "b", name: "Side B", memberIds: [rs[1].id, rs[3].id] },
  ];
  const line = (i, place) => ({ playerId: rs[i].id, placement: place, isWinner: place === 1, side: place === 1 ? "a" : "b", score: null });
  const games = [{
    idx: 0, title: "Euchre", at: "2026-08-09T20:00:00.000Z", grain: "side", sides,
    lines: [line(0, 1), line(2, 1), line(1, 2), line(3, 2)],
  }];
  return {
    status: "live", groupId: "g1", openScoring: false, nowPlaying: "Euchre",
    roster: rs, sides, sideSets: [{ fromIdx: 0, sides }], grain: "side", games,
    summary: {
      players: [
        { playerId: rs[0].id, name: rs[0].name, games: 1, wins: 1, avgPlacement: 1 },
        { playerId: rs[2].id, name: rs[2].name, games: 1, wins: 1, avgPlacement: 1 },
        { playerId: rs[1].id, name: rs[1].name, games: 1, wins: 0, avgPlacement: 2 },
        { playerId: rs[3].id, name: rs[3].name, games: 1, wins: 0, avgPlacement: 2 },
      ],
      titles: [{ title: "Euchre", games: 1 }],
      last: { title: "Euchre", lines: [{ name: "Ann + Cal", placement: 1, score: null }, { name: "Ben + Dee", placement: 2, score: null }] },
    },
  };
}

/**
 * A live SOCIAL DEDUCTION night mid-game: nine players, dealt, the board on,
 * two out and one of them revealed.
 *
 * WHAT MAKES THIS WORTH PINNING is not the layout, it is the SECRET. The page
 * has three cards whose whole job is showing a role to exactly one person, and
 * a snapshot of its rendered TEXT is the check that a role never appears where
 * it should not: the session payload below carries no role at all, so any role
 * word in the snapshot arrived from somewhere it should not have.
 *
 * The `deal` here is the SUMMARY, which is public by design (the moderator
 * announces the setup out loud). Who has what is not in it, because it is not
 * in the real payload either.
 */
function sdSession() {
  const rs = roster(9);
  const board = {
    day: 2,
    phase: "day",
    startedAt: "2026-08-10T20:00:00.000Z",
    outOrder: [rs[4].id, rs[7].id],
    players: rs.map((p, i) => ({
      playerId: p.id,
      alive: i !== 4 && i !== 7,
      out: i === 4 ? "voted" : i === 7 ? "night" : null,
      outDay: i === 4 ? 1 : i === 7 ? 2 : null,
      revealedRoleId: i === 4 ? "werewolf" : null,
    })),
  };
  return {
    status: "live", groupId: "g1", openScoring: false, nowPlaying: "Werewolf",
    roster: rs,
    deal: {
      dealNo: 1, title: "Werewolf", at: "2026-08-10T20:00:00.000Z",
      composition: [{ roleId: "villager", count: 7 }, { roleId: "werewolf", count: 2 }],
    },
    boardEnabled: true,
    board,
    games: [],
    summary: {
      players: rs.map((p, i) => ({
        playerId: p.id, name: p.name, games: 1, wins: i < 2 ? 1 : 0,
        townGames: 1, townWins: i < 2 ? 1 : 0, evilGames: 0, evilWins: 0, soloGames: 0, soloWins: 0,
      })),
      titles: [{ title: "Werewolf", games: 1 }],
      byAlignment: [{ alignment: "town", games: 9, wins: 7 }],
      last: null,
    },
  };
}

/**
 * The same night BEFORE the host has dealt, which is where the DEAL FORM lives.
 *
 * Worth its own snapshot because the live stub above has a deal in place, so it
 * renders the "Dealt" branch and never draws the form at all. The typed-role
 * input shipped on 2026-08-10 and the baseline reported UNCHANGED, which is the
 * harness saying it cannot see the screen rather than that the screen did not
 * move.
 */
function sdUndealt() {
  return { ...sdSession(), nowPlaying: "Salem", deal: null, board: null, boardEnabled: false };
}

/**
 * A night on a title the catalogue has never heard of.
 *
 * THE SCREEN THIS PINS is the 2026-08-14 fix: an uncurated title used to be
 * handed a Villager/Wolf catalogue, so a host who accepted it wrote
 * `meta.role: "villager"` permanently for a game that has neither. It now opens
 * EMPTY and tells the host to type the roles. A snapshot with no role rows in
 * it is the point rather than a gap.
 */
function sdUncurated() {
  return { ...sdSession(), nowPlaying: "One Night Ultimate Werewolf", deal: null, board: null, boardEnabled: false };
}

/** The same night as the PUBLIC TV sees it. Roles only where revealed. */
function sdTv() {
  const s = sdSession();
  const nameOf = new Map(s.roster.map((p) => [p.id, p.name]));
  return {
    status: "live", title: "Werewolf",
    composition: [{ name: "Villager", count: 7 }, { name: "Werewolf", count: 2 }],
    board: {
      day: 2, phase: "day",
      alive: s.board.players.filter((p) => p.alive).length,
      outTotal: 2,
      players: s.board.players.map((p) => ({
        playerId: p.playerId, name: nameOf.get(p.playerId),
        alive: p.alive, out: p.out, outDay: p.outDay,
        revealed: p.revealedRoleId === "werewolf" ? "Werewolf" : null,
        alignment: p.revealedRoleId === "werewolf" ? "evil" : null,
      })),
    },
    roster: s.roster.map((p) => ({ playerId: p.id, name: p.name })),
    games: 0,
    summary: s.summary,
  };
}

/**
 * The event payload the TOURNAMENT SETUP screen builds its roster from.
 *
 * The shape matters more than the numbers here. Three yes RSVPs (the prefill,
 * in answer order, which is the seeding), one maybe and two who never answered:
 * that is FOUR people the old tournament could not have entered at all, and the
 * whole point of the screen is that they are one tap away. `bracket: null`
 * because a night that already has one gets the "already has a tournament"
 * card instead of a roster.
 */
const trEvent = () => ({
  id: "e1", groupId: "g1", title: "Thursday night", bracket: null, beerioCode: null,
  sessions: [], myRole: "owner", createdBy: "u0",
  groupName: "The Thursday Crew", inviteCode: "ABCD",
  scheduledFor: null, status: "scheduled",
  rsvps: [
    { userId: "u0", displayName: NAMES[0], status: "yes" },
    { userId: "u1", displayName: NAMES[1], status: "yes" },
    { userId: "u2", displayName: NAMES[2], status: "yes" },
    { userId: "u3", displayName: NAMES[3], status: "maybe" },
  ],
  noResponse: [
    { userId: "u4", displayName: NAMES[4] },
    { userId: "u5", displayName: NAMES[5] },
  ],
  myStatus: "yes", myAttendance: null,
});

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
  let ctPayload = null;
  let ppPayload = null;
  let sdPayload = null;
  let sdTvPayload = null;
  let rosterN = 4;
  ws.addEventListener("message", async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method !== "Fetch.requestPaused" || m.sessionId !== sessionId) return;
    const { requestId, request } = m.params;
    const u = request.url;
    let body = {};
    if (u.includes("/api/tv/deduction/")) body = { session: sdTvPayload };
    else if (u.includes("/api/deduction-context/")) body = ctx(9, ["Werewolf"]);
    else if (u.includes("/api/deduction/") && u.includes("/deal")) body = { dealNo: null, title: null, lines: [] };
    else if (u.includes("/api/deduction/") && u.includes("/my-role")) body = { dealNo: null, title: null, playerId: null, role: null };
    else if (u.includes("/api/deduction/")) body = { session: sdPayload };
    else if (u.includes("/api/boardgame-context/")) body = ctx(rosterN);
    else if (u.includes("/api/cardtable-context/")) body = ctx(4, ["Euchre"]);
    else if (u.includes("/api/pingpong-context/")) body = ctx(5);
    else if (u.includes("/api/auth/me")) body = { user: { id: "u0", displayName: "Ann" } };
    else if (u.includes("/api/events/")) body = trEvent();
    else if (u.includes("/boardgame-stats")) body = bgStats;
    else if (u.includes("/stats")) body = groupStats;
    else if (u.includes("boardgame/")) body = { session: bgPayload };
    else if (u.includes("cardtable/")) body = { session: ctPayload };
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

  // ---- Card Table: setup, a live Euchre night in pairs, its TV ----
  ctPayload = null;
  await view(390, 844);
  await goto(`${ORIGIN}/cardtable?event=e1`);
  snap.ctSetup = await text();

  ctPayload = ctSession();
  await goto(`${ORIGIN}/cardtable?event=e1`);
  snap.ctLive = await text();

  await view(1920, 1080);
  await goto(`${ORIGIN}/cardtable/tv/e1`);
  snap.ctTv = await evalJs(`(() => {
    const back = [...document.querySelectorAll('button, a')].find(b => /back|←/i.test(b.textContent));
    const r = back ? back.getBoundingClientRect() : null;
    return {
      text: document.body.innerText.replace(/\\s+$/gm,'').trim(),
      backBottom: r ? Math.round(r.bottom + window.scrollY) : null,
      pageBottom: Math.round(document.documentElement.getBoundingClientRect().height),
    };
  })()`);

  // ---- Social Deduction: setup, a live dealt night with the board on, its TV ----
  sdPayload = null;
  await view(390, 844);
  await goto(`${ORIGIN}/deduction?event=e1`);
  snap.sdSetup = await text();

  sdPayload = sdSession();
  await goto(`${ORIGIN}/deduction?event=e1`);
  snap.sdLive = await text();

  // The DEAL FORM, with the typed-role input on it.
  sdPayload = sdUndealt();
  await goto(`${ORIGIN}/deduction?event=e1`);
  snap.sdDealForm = await text();

  // The EMPTY CATALOGUE, which is what an uncurated title now opens with.
  sdPayload = sdUncurated();
  await goto(`${ORIGIN}/deduction?event=e1`);
  snap.sdUncurated = await text();

  sdTvPayload = sdTv();
  await view(1920, 1080);
  await goto(`${ORIGIN}/deduction/tv/e1`);
  snap.sdTv = await evalJs(`(() => {
    const back = [...document.querySelectorAll('button, a')].find(b => /back|←/i.test(b.textContent));
    const r = back ? back.getBoundingClientRect() : null;
    const grid = document.querySelector('.sd-tv__board');
    return {
      text: document.body.innerText.replace(/\\s+$/gm,'').trim(),
      backBottom: r ? Math.round(r.bottom + window.scrollY) : null,
      pageBottom: Math.round(document.documentElement.getBoundingClientRect().height),
      tiles: document.querySelectorAll('.sd-p').length,
      boardBottom: grid ? Math.round(grid.getBoundingClientRect().bottom) : null,
    };
  })()`);

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

  // ---- the tournament setup screen ----
  //
  // FOUR SNAPSHOTS, because the four things this screen exists to do are all
  // invisible to a unit test: the prefill and its seed numbers, adding somebody
  // who never RSVP'd, adding a guest and having them MARKED as one, and
  // removing an entrant so the seeds below them renumber. The shuffle is
  // recorded as a multiset rather than an order, since a pinned order would
  // either be a broken test or a broken shuffle.
  await view(390, 844);
  await goto(`${ORIGIN}/tournament?event=e1&format=double_elim`);
  snap.trSetup = await text();

  const clickText = (label) => evalJs(`(() => { const b=[...document.querySelectorAll('button, a')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); if(!b) return false; b.click(); return true; })()`);
  const trRoster = () => evalJs(`(() => [...document.querySelectorAll('.tr-row')].map(r => ({
    seed: r.querySelector('.tr-seed')?.textContent.trim(),
    name: r.querySelector('.tr-name')?.textContent.trim(),
    guest: !!r.querySelector('.tr-pill'),
  })))()`);

  // Somebody who never answered, which the yes-RSVP bracket could not enter.
  await clickText(`+ ${NAMES[4]}`);
  await sleep(300);
  snap.trAddedNonRsvp = await trRoster();

  // A guest, who must be visibly marked as one: they play and earn nothing.
  await evalJs(`(() => {
    const i = document.querySelector('.tr-guest input');
    if (!i) return false;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(i, 'Ziggy');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(200);
  await clickText("Add");
  await sleep(300);
  snap.trWithGuest = await trRoster();

  // Removing the TOP SEED, which is the operation that renumbers everybody.
  await evalJs(`(() => {
    const row = [...document.querySelectorAll('.tr-row')][0];
    const b = row && [...row.querySelectorAll('button')].find(x => x.textContent.trim() === 'remove');
    if (!b) return false; b.click(); return true;
  })()`);
  await sleep(300);
  snap.trAfterRemove = await trRoster();

  await clickText("🎲 Shuffle the seeding");
  await sleep(300);
  const trShuffled = await trRoster();
  snap.trShuffle = {
    names: trShuffled.map((r) => r.name).sort(),
    seeds: trShuffled.map((r) => r.seed),
  };

  // TEAMS, from a FRESH load so the roster is the deterministic prefill again
  // (the shuffle above left it in a random order, which is the one thing that
  // must never reach a snapshot). Three players into a 2v1 is the mixed case
  // the ledger rules care most about: a pair takes one slot and the odd person
  // out is a side of one.
  await goto(`${ORIGIN}/tournament?event=e1&format=single_elim`);
  const trPicker = () => evalJs(`(() => {
    const labs = [...document.querySelectorAll('.tr-lab')].filter(l => /^Side /.test(l.textContent.trim()));
    const sides = labs.map(l => ({
      label: l.textContent.trim().replace(/\\s*remove$/, ''),
      body: l.nextElementSibling ? l.nextElementSibling.textContent.trim().replace(/\\s+/g, ' ') : '',
    }));
    const rows = [...document.querySelectorAll('.tr-row')].filter(r => r.querySelector('.tr-seg button'));
    const b = [...document.querySelectorAll('button.gn-btn')]
      .find(x => /^(Start the tournament|\\d+ still|A side holds|Need at least|At most|Add at least)/.test(x.textContent.trim()));
    return {
      sides,
      unplaced: rows.map(r => r.querySelector('.tr-name')?.textContent.trim()),
      startLabel: b ? b.textContent.trim() : null,
      startEnabled: b ? !b.disabled : null,
    };
  })()`);
  await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-pressed')!==null&&/ON|OFF/.test(x.textContent)); if(b) b.click(); return !!b; })()`);
  await sleep(400);
  snap.trTeamsOpen = await trPicker();

  // Ann and Ben onto side A, Cal onto side B. Always the FIRST unplaced row,
  // because placing somebody removes their row and the list closes up.
  for (const letter of ["A", "A", "B"]) {
    await evalJs(`(() => {
      const row = [...document.querySelectorAll('.tr-row')].filter(r => r.querySelector('.tr-seg button'))[0];
      const b = row && [...row.querySelectorAll('.tr-seg button')].find(x => x.textContent.trim() === ${JSON.stringify(letter)});
      if (!b) return false; b.click(); return true;
    })()`);
    await sleep(250);
  }
  await sleep(250);
  snap.trTeamsPlaced = await trPicker();

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
    console.log(`  ctTv:  back ${snap.ctTv.backBottom}px, page ${snap.ctTv.pageBottom}px`);
    console.log(`  sdTv:  back ${snap.sdTv.backBottom}px, page ${snap.sdTv.pageBottom}px, ${snap.sdTv.tiles} tiles ending ${snap.sdTv.boardBottom}px`);
  }
  chrome.kill("SIGKILL"); killAll();
  process.exit(0);
}
main().catch((e) => { console.error("harness error:", e); process.exit(2); });

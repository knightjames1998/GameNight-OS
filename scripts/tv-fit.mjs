// The three measured TV layouts, at 1920x1080, asked TWO questions.
//
//   FITS     does the layout end inside the screen
//   IS SEEN  is anything the layout placed still COVERED by a fixed overlay
//
// The first is the old question and it is measured against the LOWEST PAINTED
// PIXEL rather than the footer. The casino money board taught that: its 07-30
// numbers were taken against the footer and the back button sits below it, so a
// board that "fit" put the control a person needs off screen.
//
// THE SECOND QUESTION EXISTS BECAUSE OF THE RAIL, and it is the same mistake in
// a new costume. A fixed frame cannot MOVE an element, so every number in the
// first column was unchanged the day the rail shipped, and that was true and
// beside the point: the rail paints on top of whatever the layout put at the
// edge. A fit check that measures layout while a fixed overlay eats the result
// is measuring where the element was placed, not what a person can see.
//
// Standing rule 4 puts a way back on every screen including TV, so the back
// button is called out by name rather than left in the general sweep.
//
//   node scripts/tv-fit.mjs        exits non-zero on a NEW overlap
//
// KNOWN AND LOGGED (see BACKLOG, BUGS): a handful of screens are named in the
// KNOWN set below with their measured numbers, and a name comes OUT of that set
// on the commit that fixes it rather than when somebody remembers.
//
// PING PONG WAS THE FIRST ENTRY HERE AND IS GONE (fixed 2026-08-22). It did not
// fit past six players and never had: 1126px at seven, over by 46, with the
// back button 3px into the rail under Arcade and 17px under Tabletop. It now
// has its own ladder (apps/web/src/pingpong/pingpong-tv-band.ts) and fits to
// sixteen with the button clear in both themes.

import { spawn } from "node:child_process";
// THE REAL ENGINE, imported straight from source (node strips the types), so
// the two bracketed cases below are measured against a bracket the app could
// actually produce. Hand-rolling a rounds payload for a 16-entrant double elim
// is exactly the shape of fixture that goes stale without saying so, which is
// the failure this file already carries a `rendered` assertion for.
import { buildStructure, computeBracket } from "../packages/shared/src/bracket.ts";
const PORT = Number(process.env.PORT || 4185), CDP = Number(process.env.CDP || 9340);
const ROOT = "/home/user/GameNight-OS";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn("pnpm", ["--filter", "@gamenight/web", "exec", "vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const chrome = spawn("/opt/pw-browsers/chromium", ["--headless=new", `--remote-debugging-port=${CDP}`, "--no-sandbox", "--disable-gpu", "about:blank"], { stdio: "ignore" });
await sleep(5000);
const tab = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(), on = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method) return on.get(m.method)?.(m.params); pend.get(m.id)?.(m); pend.delete(m.id); });
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.result?.value;

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

// ---- payloads -------------------------------------------------------------
const money = (n, mods) => {
  const players = Array.from({ length: n }, (_, i) => ({
    playerId: "p" + i, name: "Player Nameiskindalong " + (i + 1), kind: "member",
    isBanker: i === 0, buyIn: 2000, rebuys: i % 2, rebuyTotal: (i % 2) * 2000,
    totalIn: 2000 + (i % 2) * 2000, cashOut: i % 3 === 0 ? 3000 : null,
    cashedOut: i % 3 === 0, net: i % 3 === 0 ? 1000 : null, events: 12 + i,
    detail: { hands: 12 + i, blackjacks: i % 3, busts: i % 4 },
  }));
  return { session: { status: "live", tracker: false, summary: {
    bank: { held: 10000, owed: 0, kind: "player" }, bankerId: "p0",
    modifiers: mods, defaultBuyIn: 2000, stakes: "real",
    players, totalIn: 2000 * n, totalOut: 3000, onTable: 2000 * n - 3000,
    stillIn: n - 1, cashedOut: 1, events: 40,
    balance: { ok: true, delta: 0 }, warning: null,
  } } };
};
// POKER'S TV IS THE MONEY BOARD PLUS A SETTLEMENT BAND, and the band is what
// this payload exists to measure: it is the pack's `hero`, so it spends the same
// 1080px the board does. Everybody is cashed out and the table squares, which is
// the WORST case for height rather than the happy one: that is the only state in
// which the transfer list is non-null, and a greedy settlement of n players runs
// to n-1 rows before the four-row cap in PokerTvPage clips it.
const poker = (n) => {
  const players = Array.from({ length: n }, (_, i) => ({
    playerId: "p" + i, name: "Player Nameiskindalong " + (i + 1), kind: "member",
    isBanker: false, buyIn: 2000, rebuys: i % 2, rebuyTotal: (i % 2) * 2000,
    totalIn: 2000 + (i % 2) * 2000, cashOut: 2000, cashedOut: true,
    net: i % 2 === 0 ? 1000 : -1000, events: i, detail: { dealt: i },
    derived: false, placement: i + 1,
  }));
  const transfers = Array.from({ length: n - 1 }, (_, i) => ({
    fromId: "p" + ((i + 1) % n), toId: "p" + (i % n), cents: 1000 + i * 100,
  }));
  return { session: { status: "live", summary: {
    bank: "table", bankerId: null, modifiers: [], defaultBuyIn: 2000, stakes: "real",
    players, totalIn: 2000 * n, totalOut: 2000 * n, onTable: 0,
    stillIn: 0, cashedOut: n, events: n * 2,
    balance: { checked: true, balanced: true, delta: 0 }, warning: null,
  }, variants: [{ variant: "Texas Hold'em", games: 8 }, { variant: "Omaha", games: 3 }], transfers } };
};

// UPDATED 2026-08-09 to the post-doubles shape. Ping Pong's TV moved to SIDES on
// 2026-08-05 and this payload stayed on the old aId/bId/kingId one, so from that
// day both ping pong cases rendered the short "waiting" state and measured
// nothing while continuing to pass. The `rendered` assertion below is what makes
// that fail loudly next time; this is the fix for the instance.
const pingpong = (n) => {
  const r = Array.from({ length: n }, (_, i) => ({ id: "p" + i, kind: "member", userId: "u" + i, name: "Player Nameiskindalong " + (i + 1) }));
  const sides = r.map((p, i) => ({ id: String.fromCharCode(97 + i), name: "Side", memberIds: [p.id] }));
  const match = (i) => ({
    idx: i, a: sides[i % n], b: sides[(i + 1) % n],
    games: [{ winnerSideId: sides[i % n].id, loserPoints: 17 }],
    winnerSideId: sides[i % n].id, at: "2026-08-09T20:00:00Z",
  });
  return { session: {
    status: "live", mode: "koth", bestOf: 3, needed: 2, roster: r,
    sides, doubles: false,
    sideSets: [{ fromIdx: 0, sides }],
    matches: Array.from({ length: 8 }, (_, i) => match(i)),
    current: { idx: -1, a: sides[0], b: sides[1], games: [{ winnerSideId: sides[0].id, loserPoints: 12 }], winnerSideId: null, at: null },
    koth: { kingSideId: sides[0].id, queue: sides.slice(1).map((x) => x.id) },
    summary: {
      players: r.map((p, i) => ({ playerId: p.id, name: p.name, matches: 9, wins: 9 - i, gameWins: 20 - i, currentStreak: i % 3, longestReign: i % 5 })),
      bestReign: { sideId: sides[0].id, memberIds: [r[0].id], reign: 4 },
    },
  } };
};


// MARIO KART, added 2026-08-16 when karts arrived. This TV had never been in
// the ladder, which is exactly the gap this file exists to close: a pack with a
// TV and no fit case is a pack whose fit nobody owns, and Board Game was 176px
// over at twelve for five days for that reason.
//
// The pairs case is the one that matters and it is measured at the CAP: this
// pack seats sixteen, and eight karts of two is the widest night it offers
// (MAX_SIDES is eight). The Players panel is per racer either way, so sixteen
// racers is the tallest that column ever gets, and the Karts panel that
// replaces Racers on a pairs night is at most eight lines against the Racers
// panel's eight, so it is a swap rather than an addition.
const mariokart = (n, pairs, format = "free") => {
  const r = Array.from({ length: n }, (_, i) => ({
    id: "p" + i, kind: "member", userId: "u" + i,
    name: "Player Nameiskindalong " + (i + 1),
    character: ["Mario", "Yoshi", "Peach", "Toad", "Bowser", "Waluigi"][i % 6],
  }));
  const sides = pairs
    ? Array.from({ length: Math.ceil(n / 2) }, (_, i) => ({
        id: String.fromCharCode(97 + i), name: "Kart",
        memberIds: r.slice(i * 2, i * 2 + 2).map((p) => p.id),
      }))
    : r.map((p, i) => ({ id: String.fromCharCode(97 + i), name: "Kart", memberIds: [p.id] }));
  return { session: {
    status: "live", groupId: "g1", format, mode: format === "koth" ? "koth" : "ffa",
    titleId: "mkdd", assignment: "self", resultDetail: "placement", openScoring: false,
    roster: r, sides, pairs, sideSets: [{ fromIdx: 0, sides }], bestOf: 3,
    games: Array.from({ length: 6 }, (_, i) => ({ idx: i })),
    koth: format === "koth" ? { kingSideId: sides[0].id, queue: sides.slice(1).map((s) => s.id), streak: 3 } : null,
    series: null, seriesLog: [], seriesStandings: [], cup: null,
    summary: {
      characters: ["Mario", "Yoshi", "Peach", "Toad", "Bowser", "Waluigi", "Luigi", "Daisy"].map((c, i) => ({ character: c, played: 6 - i > 0 ? 6 - i : 1, wins: i % 3 })),
      players: r.map((p, i) => ({ playerId: p.id, name: p.name, played: 6, wins: 6 - i > 0 ? 6 - i : 0, mainCharacter: p.character })),
    },
  } };
};

// Casino Run's summary is a different animal from the cash packs': a ladder, a
// progress block, per-stage rows and a leg trail. Built out in full rather than
// approximated, because a payload the page rejects renders the short "waiting"
// state, which fits trivially and measures nothing. Mid-run on purpose, which is
// the state its back button is already logged as escaping in.
const crun = (n) => {
  const leg = (i, bank) => ({ delta: i % 3 === 0 ? -1500 : 2200, game: "Blackjack", playerId: "p" + (i % n), at: "2026-08-03T20:0" + (i % 9) + ":00Z", kind: "leg", bank, stage: Math.min(2, Math.floor(i / 4)) });
  const legs = Array.from({ length: 11 }, (_, i) => leg(i, 20000 + i * 900));
  return { session: { status: "live", summary: {
    bank: 29900, stage: 2, attempt: 2, legsUsed: 3, quota: 46000, toGo: 16100,
    legsLeft: 2, attemptsLeft: 1, status: "live", ending: null, cleared: 2, missed: 1,
    ante: { cents: 500, why: "stage 3" }, held: ["reroll"], peak: 31000,
    stakes: "real", modifiers: ["m1", "m2"], difficulty: "standard",
    ladder: { key: "standard", name: "Standard", escalation: 0.15, stages: 5, legsPerStage: 5, attempts: 2 },
    startingBank: 20000, floor: 5000,
    players: Array.from({ length: n }, (_, i) => ({ playerId: "p" + i, name: "Player Nameiskindalong " + (i + 1), kind: "member", legs: 3 + i, delta: (i % 2 ? 1 : -1) * (1200 + i * 300), best: 2600, worst: -1800 })),
    stages: Array.from({ length: 3 }, (_, i) => ({ index: i, quota: 25000 + i * 7000, cleared: i < 2, attempts: i === 2 ? 2 : 1, legs: legs.slice(i * 3, i * 3 + 3) })),
    legs,
    headline: "Two stages down",
  } } };
};

// BOARD GAME shipped a TV on 2026-08-04 and was never added here, which is the
// gap this harness exists to close: a pack with a TV that nothing measures is a
// pack whose fit is nobody's job. It seats TWELVE, so the twelve case is
// reachable rather than theoretical.
const titlenight = (n) => {
  const r = Array.from({ length: n }, (_, i) => ({ id: "p" + i, kind: "member", userId: "u" + i, name: "Player Nameiskindalong " + (i + 1) }));
  const sides = r.map((p, i) => ({ id: String.fromCharCode(97 + i), name: "Side", memberIds: [p.id] }));
  const lines = r.map((p, i) => ({ playerId: p.id, placement: i + 1, isWinner: i === 0, side: null, score: i === 0 ? 92 : null }));
  return { session: {
    status: "live", groupId: "g1", openScoring: false, nowPlaying: "Ticket to Ride",
    roster: r, sides, sideSets: [{ fromIdx: 0, sides }], grain: "player",
    games: Array.from({ length: 4 }, (_, g) => ({ idx: g, title: ["Catan", "Wingspan", "Azul", "7 Wonders"][g], at: "2026-08-09T20:0" + g + ":00Z", grain: "player", sides, lines })),
    summary: {
      players: r.map((p, i) => ({ playerId: p.id, name: p.name, games: 4, wins: 4 - i > 0 ? 4 - i : 0, avgPlacement: i + 1 })),
      titles: [{ title: "Catan", games: 1 }, { title: "Wingspan", games: 1 }, { title: "Azul", games: 1 }, { title: "7 Wonders", games: 1 }],
      last: { title: "7 Wonders", lines: lines.map((l, i) => ({ name: r[i].name, placement: l.placement, score: l.score })) },
    },
  } };
};

// SOCIAL DEDUCTION seats TWENTY, the largest cap in the app, and its TV shows
// every player at once by design. That makes it the most fit-hostile screen
// anybody has built here, so it is measured AT TWENTY from the commit that
// shipped it rather than at a comfortable eight. Board Game's TV was measured
// at four and eight for five days and turned out to be 176px over at twelve.
//
// Mid-game on purpose: board on, a few people out, one revealed, which is the
// state with the most ink on the screen.
const deduction = (n) => {
  const names = Array.from({ length: n }, (_, i) => "Player Nameiskindalong " + (i + 1));
  const players = names.map((name, i) => {
    const out = i % 4 === 1;
    return {
      playerId: "p" + i, name,
      alive: !out,
      out: out ? (i % 8 === 1 ? "voted" : "night") : null,
      outDay: out ? 1 + (i % 3) : null,
      // A REVEALED role on some of the dead, which is the only role that ever
      // reaches this screen, and the longest string a tile has to hold.
      revealed: out ? (i % 8 === 1 ? "Alpha Werewolf" : "Villager") : null,
      alignment: out ? (i % 8 === 1 ? "evil" : "town") : null,
    };
  });
  const alive = players.filter((p) => p.alive).length;
  return { session: {
    status: "live",
    title: "Blood on the Clocktower",
    composition: [{ name: "Villager", count: n - 3 }, { name: "Seer", count: 1 }, { name: "Alpha Werewolf", count: 2 }],
    board: { day: 3, phase: "day", alive, outTotal: n - alive, players },
    roster: names.map((name, i) => ({ playerId: "p" + i, name })),
    games: 3,
    summary: {
      players: names.map((name, i) => ({
        playerId: "p" + i, name, games: 3, wins: 3 - (i % 4),
        townGames: 2, townWins: 1, evilGames: 1, evilWins: i % 2, soloGames: 0, soloWins: 0,
      })),
      titles: [{ title: "Werewolf", games: 2 }, { title: "Blood on the Clocktower", games: 1 }],
      byAlignment: [{ alignment: "town", games: 20, wins: 8 }, { alignment: "evil", games: 6, wins: 3 }],
      last: { title: "Werewolf", factions: [{ name: "Werewolves", placement: 1, names: names.slice(0, 2) }] },
    },
  } };
};

// THE EVENT TV, /e/:id/tv, AND IT HAD NO CASE HERE AT ALL UNTIL 2026-08-22.
//
// THIS IS THE FIFTH INSTANCE OF ONE ROOT CAUSE, and BUGS keeps that count
// itself rather than each session restarting it: Board Game (2026-08-09) was
// the first, both bracketed TVs (08-15) the second, Mario Kart (08-16) says
// "the third time", Beerio's Grand Prix (08-19) says "the fourth time", and
// the event TV is the fifth. THE TWO BRACKETED TVs ARE ONE INSTANCE, not two:
// one session, one finding, one BUGS entry. Counting them separately is exactly
// how a first draft of this comment said "sixth".
// A SCREEN WITH NO HARNESS CASE HAS NO OWNER. The event TV is in
// theme-sweep's ROUTES, so it has been colour-swept for weeks, and nothing had
// ever asked whether it fits a television. It is also not a pack, so the
// ADDING A PACK checklist could never have caught it.
//
// TWO STATES, because `now: null` is not one screen, it is two:
//
//   lobby   nothing played yet. The yes-RSVP list, which WRAPS rather than
//           scrolls, so it grows with the roster and is the binding column.
//   night   the between-games screen. Standings on the left, latest results on
//           the right, both capped today by hardcoded slices rather than by a
//           ladder, which is its own finding: recap.players.slice(0, 8) drops
//           the ninth player off a television with nothing on screen saying so.
//           That is an overflow arrived at from the other side.
//
// MEASURED AT 4, 8, 12 AND 16 in both themes. Sixteen is what the shell's
// bracket can reach off an uncapped yes list, and twelve is where the player
// slice starts silently discarding people.
const eventTv = (n, withRecap, crew) => {
  const names = Array.from({ length: n }, (_, i) => "Player Nameiskindalong " + (i + 1));
  const event = {
    id: "e1",
    title: "Thursday Night Games At Someone Elses House",
    scheduledFor: "2026-08-27T19:30:00.000Z",
    groupName: "The Thursday Crew",
  };
  // MORE GAMES THAN THE SLICE SHOWS, deliberately. The results column caps at
  // six today with no ladder behind it, so a fixture of six would measure the
  // cap rather than the screen.
  const games = Array.from({ length: 14 }, (_, i) => ({
    gameName: ["Mario Kart 8 Deluxe", "Super Smash Bros Ultimate", "Ping Pong", "Settlers of Catan"][i % 4],
    label: i % 3 === 0 ? "Grand Prix" : null,
    format: "ffa",
    pack: "mariokart",
    winnerName: names[i % n],
  }));
  return {
    event,
    now: null,
    lobby: {
      yes: names,
      inviteCode: "ABCD",
      recap: withRecap
        ? {
            eventId: event.id, title: event.title, scheduledFor: event.scheduledFor,
            groupName: event.groupName, totalGames: games.length, games,
            sessions: games.slice(0, 4).map((g) => ({
              gameName: g.gameName, pack: g.pack, format: g.format, label: g.label,
              matches: 4, winnerName: g.winnerName, winnerWins: 3,
            })),
            players: names.map((name, i) => ({
              userId: "u" + i, name, games: 14 - i > 0 ? 14 - i : 1,
              wins: 9 - i > 0 ? 9 - i : 0, avgPlacement: 1 + i * 0.3,
            })),
            mvp: { userId: "u0", name: names[0] },
          }
        : null,
      // THE CREW'S LIFETIME BOARD, which the left column alternates with
      // tonight's every 12s. Defaults LONGER than the night's roster because
      // that is the normal case (everybody who has ever played, against
      // everybody playing tonight) and it is the one that binds: the band is
      // taken off the larger of the two, or the screen fits tonight and
      // overflows twelve seconds later with nobody holding the device.
      lifetime: withRecap
        ? Array.from({ length: crew ?? n }, (_, i) => ({
            userId: "L" + i, name: "Player Nameiskindalong " + (i + 1),
            games: 40 - i, wins: 22 - i > 0 ? 22 - i : 0, avgPlacement: 1 + i * 0.2,
          }))
        : null,
    },
  };
};

// THE TWO OLDEST TV VIEWS IN THE APP, and until 2026-08-15 neither was in this
// harness: /tv/:id shipped with the bracket engine and /beerio/tv/:code came in
// with the vendored pack, both long before this file existed, so the gap was
// never a pack that forgot a step. It was the two screens nobody thought to
// add. Same finding as Board Game's on 2026-08-09, in an older costume.
//
// MEASURED AT 4, 8, 12 AND 16, IN FOUR STATES EACH. The first pass measured two
// counts in one state, which is how a band boundary lands in the wrong place
// and nothing says so: a ladder proved at its endpoints and not in the middle
// is a ladder proved nowhere. Sixteen is Beerio's MAX_PLAYERS and a realistic
// full crew on the shell's bracket, whose entrants come off the yes-RSVP list
// with no cap at all.
//
// THE FOUR STATES ARE THE ONES A NIGHT ACTUALLY PASSES THROUGH, which is Casino
// Run's lesson (its TV was pinned at one state and broke at another):
//
//   fresh   nothing played. Every first-round match is ready at once, so the
//           on-deck column is at its fullest and the board is one group.
//   mid     two waves in. All three alive groups populated, which is the
//           board's worst state, and the strip has done / now / not-yet cells.
//   late    everything but the last match. The board is nearly all struck out
//           and the grand final's "needs 2" note is on the on-deck card.
//   champ   somebody won. The champion panel takes over and the board is gone.
const playN = (n, structure, waves) => {
  const results = {};
  for (let w = 0; w < waves; w++) {
    const open = Object.values(computeBracket(n, structure, results).matches)
      .filter((m) => m.playable && m.active);
    if (open.length === 0) break;
    for (const m of open) results[m.def.id] = "A";
  }
  return results;
};
/** Play until only `leave` matches are still undecided, or to a champion. */
const playDown = (n, structure, leave) => {
  const results = {};
  for (let guard = 0; guard < 400; guard++) {
    const c = computeBracket(n, structure, results);
    if (c.championSeed != null) return results;
    const open = Object.values(c.matches).filter((m) => m.playable && m.active);
    const undecided = Object.values(c.matches).filter((m) => m.active && !m.decided);
    if (open.length === 0 || undecided.length <= leave) return results;
    results[open[0].def.id] = "A";
  }
  return results;
};
const STATES = ["fresh", "mid", "late", "champ"];
const resultsFor = (n, structure, state) =>
  state === "fresh" ? {}
  : state === "mid" ? playN(n, structure, 2)
  : state === "late" ? playDown(n, structure, 1)
  : playDown(n, structure, 0);

// The shell's /tv/:id payload, built through the same serializer shape
// apps/server/src/brackets.ts deriveView() emits.
const bracketTv = (n, state = "mid", format = "double_elim", teamSize = 1) => {
  const structure = buildStructure(format, n);
  const results = resultsFor(n, structure, state);
  const computed = computeBracket(n, structure, results);
  // EVERY SLOT CARRIES `members`, which is what deriveView emits: a solo slot's
  // is a list of one holding its own userId and displayName, and a team slot's
  // is its people with the joined label above. teamSize > 1 is the doubles
  // board, and the label is deliberately the LONGEST thing this screen can be
  // asked to draw: two long names joined is the case that binds.
  const person = (seed, k) => ({
    userId: `u${seed}-${k}`,
    displayName: `Player Nameiskindalong ${seed}${teamSize > 1 ? String.fromCharCode(97 + k) : ""}`,
  });
  const slot = (s) => {
    if (s.kind !== "player") return { kind: s.kind };
    const members = Array.from({ length: teamSize }, (_, k) => person(s.seed, k));
    return {
      kind: "player",
      seed: s.seed,
      userId: teamSize > 1 ? null : members[0].userId,
      displayName: members.map((m) => m.displayName).join(" + "),
      members,
    };
  };
  return {
    id: "b1", eventId: "e1", groupId: "g1",
    gameName: "Mario Kart 8 Deluxe", groupName: "The Thursday Crew",
    status: "live", format, openScoring: false, canScore: false, canManage: false,
    entrantCount: n,
    rounds: structure.groups
      .map((g) => ({
        title: g.title, side: g.side,
        matches: g.ids
          .map((id) => computed.matches[id])
          .filter((m) => m.active && !(m.a.kind === "bye" && m.b.kind === "bye"))
          .map((m) => ({
            id: m.def.id, a: slot(m.a), b: slot(m.b),
            // The serializer's exact shape, feeder provenance included. A
            // fixture missing these measures a screen the app does not have.
            aFrom: m.def.a, bFrom: m.def.b,
            winner: m.decided ? slot(m.winner) : null,
            decided: m.decided, auto: m.auto, playable: m.playable,
            undoable: m.def.id in results, reset: !!m.def.resetOf,
          })),
      }))
      .filter((g) => g.matches.length > 0),
    champion: computed.championSeed ? slot({ kind: "player", seed: computed.championSeed }) : null,
  };
};

// Beerio Kart's /beerio/tv/:code payload: the pack's own SavedState, which the
// page feeds to its OWN engine. THE MATCH IDS ARE THE SAME BY CONSTRUCTION —
// packages/shared/src/bracket.ts is that engine generalized, so W{r}M{i} /
// L{r}M{i} / GF and the seed order are identical for double elim — which is
// why one results map serves both screens and why this fixture cannot drift
// into naming matches the pack does not have.
//
// TWO SPECTATORS WHO VOTED ON EVERYTHING, because a card carrying its crowd
// bars is the tallest an Up next card ever gets and those are up on exactly the
// nights people are watching. A ladder tuned against a card with no votes would
// be wrong when it matters most.
const BEERIO_COLORS = ["#E5352B", "#3B7BE8", "#2FB969", "#FFC02E", "#9B59D0", "#FF7BAC", "#00B7C2", "#F2751A"];
// BEERIO'S GRAND PRIX, WHICH SHARES /beerio/tv/:code WITH THE BRACKET BOARD AND
// HAD NO CASE AT ALL. `beerioTv` below hardcodes format.mode "bracket", so half
// of that one route was unmeasured, which is exactly how a 1206px overflow sat
// there unnoticed until somebody looked at a real television on 2026-08-19.
//
// GP HAS NO LADDER TO TIGHTEN, which is what makes it the largest gap of the
// five: `GpBoard` renders Shell and Header at band="roomy" HARDCODED, while the
// bracket board in the same file computes a band per payload. So there is
// nothing to spend even if there were a case.
//
// The prediction bar is up, because a race everybody voted on is the tallest
// this board gets and those are up on exactly the nights people are watching.
const beerioGp = (n, races = 3, voted = true) => {
  const seeds = Array.from({ length: n }, (_, i) => i);
  // One finishing order per race. Rotated so the standings are not a straight
  // line, which is what makes the rank column render at its real width.
  const gpLog = Array.from({ length: races }, (_, r) => [...seeds.slice(r % n), ...seeds.slice(0, r % n)]);
  return {
    state: {
      playerCount: n,
      names: Array.from({ length: n }, (_, i) => "Player Nameiskindalong " + (i + 1)),
      colors: Array.from({ length: n }, (_, i) => BEERIO_COLORS[i % BEERIO_COLORS.length]),
      results: {}, series: {}, gpLog,
      format: { series: 1, mode: "gp", gpRaces: 4 },
      seeded: true,
    },
    // Keyed H:{racesSoFar}, which is what GpBoard tallies for the next race.
    predictions: voted
      ? {
          s1: { name: "Spectator One", picks: { [`H:${races}`]: "0" } },
          s2: { name: "Spectator Two", picks: { [`H:${races}`]: "1" } },
        }
      : {},
  };
};
const beerioTv = (n, state = "mid") => {
  const structure = buildStructure("double_elim", n);
  const results = resultsFor(n, structure, state);
  const picks = Object.fromEntries(structure.defs.map((d) => [`M:${d.id}`, "A"]));
  return {
    state: {
      playerCount: n,
      names: Array.from({ length: n }, (_, i) => "Player Nameiskindalong " + (i + 1)),
      colors: Array.from({ length: n }, (_, i) => BEERIO_COLORS[i % BEERIO_COLORS.length]),
      results, series: {}, gpLog: [],
      format: { series: 1, mode: "bracket", gpRaces: 4 },
      seeded: true,
    },
    predictions: {
      s1: { name: "Spectator One", picks },
      s2: { name: "Spectator Two", picks: { ...picks, "M:W1M0": "B" } },
    },
  };
};

let PAYLOAD = money(4, []);
on.set("Fetch.requestPaused", ({ requestId, request }) => {
  const p = new URL(request.url).pathname;
  if (!p.startsWith("/api/")) { send("Fetch.continueRequest", { requestId }).catch(() => {}); return; }
  let body = { error: "no" }, code = 404;
  if (p.startsWith("/api/tv/")) { body = PAYLOAD; code = 200; }
  // Beerio reads the shared public live-session endpoint, not /api/tv, and it
  // reads predictions from a second one. Both are answered from the same
  // payload so a case cannot serve a state and a prediction set that disagree.
  if (p.startsWith("/api/sessions/")) {
    body = p.endsWith("/predictions")
      ? { predictions: PAYLOAD.predictions ?? {} }
      : { state: PAYLOAD.state ?? {} };
    code = 200;
  }
  if (p === "/api/auth/me") { body = { id: "u1", email: "a@b.c", displayName: "S", hasPassword: true }; code = 200; }
  send("Fetch.fulfillRequest", { requestId, responseCode: code, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(() => {});
});
await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });

// A FIT CHECK THAT ONLY MEASURES LAYOUT IS MEASURING THE WRONG THING once a
// fixed overlay exists. The rail cannot move an element, so every number below
// was unchanged when it shipped and that was true and beside the point: it
// paints ON TOP of whatever the layout put at the edge. Same class of miss as
// measuring to the footer instead of to the back button. So this now asks two
// separate questions:
//
//   FITS      does the layout end inside the screen (what it always asked)
//   IS SEEN   is anything the layout placed still COVERED by a fixed overlay
//
// The rail's own width is read off the live document rather than assumed, so a
// theme that widens it, or a future overlay of any kind, is caught by the same
// check.
/**
 * The candidate overlay's size, in CSS pixels at 1920x1080.
 *
 * DELIBERATELY GENEROUS. ETV_QR's largest band is a 130px code, and a corner
 * overlay wants padding and a line of label beside it, so 170x200 is an upper
 * bound on anything this session would ship. Measuring the biggest plausible
 * rectangle means a corner that comes back clear is clear for every smaller one
 * too, which is the only direction this measurement is safe to be wrong in.
 */
const PROBE_W = Number(process.env.PROBE_W || 170), PROBE_H = Number(process.env.PROBE_H || 200);

const MEASURE = (PROOF) => `(()=>{
  const PROOF = ${JSON.stringify(PROOF)};
  const railW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gn-rail-w')) || 0;
  const vh = window.innerHeight, vw = window.innerWidth;
  const covered = [];
  // The connection pill, which is only ever on screen when a live screen has
  // stopped hearing the hub. In the healthy state it renders NOTHING, so on
  // every ordinary case below this is null and costs nothing.
  const pillEl = document.querySelector('.gn-connpill');
  const pillRect = pillEl ? pillEl.getBoundingClientRect() : null;
  const pillCovers = [];
  // A THIRD FIXED OVERLAY, ASKED ABOUT BEFORE IT EXISTS. The rail and the pill
  // are measured above because they are already on screen; this one is a
  // CANDIDATE, and the whole point is to find out where it could go before
  // anything is built. "Never overlaps relevant information" cannot be
  // guaranteed by a fixed overlay by construction; it can only be proven, and
  // this is the instrument that proves it.
  //
  // ALL FOUR CORNERS IN ONE PASS, so the answer costs one page render rather
  // than four. Bottom-centre is not a corner and is separately unavailable: the
  // connection pill lives there, intermittently, which is the worst kind of
  // collision because every screenshot looks clear.
  //
  // INSET BY THE RAIL, read off the document like everything else here, because
  // a corner is inside the rail's band by definition and an overlay that
  // ignores it is under the timber in Tabletop and fine in Arcade.
  const PROBE_W = ${PROBE_W}, PROBE_H = ${PROBE_H}, PROBE_PAD = 12;
  const lvwP = document.documentElement.clientWidth, lvhP = document.documentElement.clientHeight;
  const inset = railW + PROBE_PAD;
  const probeRects = {
    'top-left':     { left: inset, top: inset, right: inset + PROBE_W, bottom: inset + PROBE_H },
    'top-right':    { left: lvwP - inset - PROBE_W, top: inset, right: lvwP - inset, bottom: inset + PROBE_H },
    'bottom-left':  { left: inset, top: lvhP - inset - PROBE_H, right: inset + PROBE_W, bottom: lvhP - inset },
    'bottom-right': { left: lvwP - inset - PROBE_W, top: lvhP - inset - PROBE_H, right: lvwP - inset, bottom: lvhP - inset },
  };
  const probeCovers = { 'top-left': [], 'top-right': [], 'bottom-left': [], 'bottom-right': [] };
  let low = 0, lowWho = null;
  // THE LOWEST ELEMENT IS ALMOST ALWAYS #root, which names nothing: it is the
  // page, and its height is the number already in the first column. What a
  // person needs when a case is over is which INK is at the bottom, so the
  // lowest classed leaves are collected beside it. It was measured and thrown
  // away before, which is a session's difference: a board 297px past 1080 says
  // nothing about whether a row got taller or a chip got wider and wrapped the
  // alive board onto more lines, and those want opposite fixes.
  const ink = [];
  const who = (el) => {
    const parts = [];
    for (let n = el; n && parts.length < 3; n = n.parentElement) {
      const c = (n.className || "").toString().trim();
      parts.unshift(c ? "." + c.split(/\s+/).join(".") : n.tagName);
    }
    return parts.join(" > ").slice(0, 90);
  };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.height && !r.width) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (cs.position === 'fixed') continue;
    const b = r.bottom + window.scrollY;
    if (b > low) { low = b; lowWho = who(el); }
    if (el.children.length === 0 && (el.textContent || "").trim() && (el.className || "").toString().trim()) {
      ink.push({ b: Math.round(b), who: who(el), text: (el.textContent || "").trim().slice(0, 24) });
    }
    // Does this element have PAINT of its own inside a rail band? A container
    // whose box merely extends under the timber is not covered in any way a
    // person can see; ink and fills are.
    const paints = (el.textContent || '').trim().length > 0 && el.children.length === 0
      || cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
      || cs.borderTopWidth !== '0px' || cs.borderBottomWidth !== '0px';
    if (!paints) continue;
    // Full-bleed roots are the page itself, not something sitting on it.
    //
    // MEASURED AGAINST THE LAYOUT VIEWPORT, NOT window.innerWidth, and the
    // difference is a scrollbar. innerWidth INCLUDES the classic scrollbar and a
    // block root's width does not, so on exactly the cases this escape exists
    // for (the ones tall enough to overflow, which is when a scrollbar appears)
    // a full-bleed root measured 15px short of vw and was reported as content
    // covered by the rail. It went unnoticed while every pack root painted its
    // backdrop as gradients alone, because a background shorthand with no
    // colour leaves background-color transparent and the paint test above never
    // fired. Board Game's Tabletop backdrop is the first with an opaque
    // background-color under it, and it lit this up immediately as
    // "tn-tv bg-tv by 170": the page painting under its own rail, which is what
    // a page does. documentElement.clientWidth/Height is the layout viewport
    // with the scrollbar already taken off.
    const lvw = document.documentElement.clientWidth, lvh = document.documentElement.clientHeight;
    if (r.width >= lvw - 1 && r.height >= lvh - 1) continue;
    if (railW) {
      const into = Math.max(
        railW - r.top,                 // under the top timber
        r.bottom - (vh - railW),       // under the bottom timber
        railW - r.left,
        r.right - (vw - railW),
      );
      if (into > 0) covered.push((el.className || el.tagName).toString().slice(0, 34) + ' by ' + Math.round(into));
    }
    // THE SECOND FIXED OVERLAY THIS SCREEN CAN HAVE. Until 2026-08-24 the rail
    // was the only one, and IS SEEN was written against it by name. The
    // connection pill is fixed too, and the loop above SKIPS fixed elements, so
    // nothing here could have seen it sitting on a board: it would have shipped
    // unmeasured and looked like a pass. Same question, asked of the pill.
    if (pillRect && !pillEl.contains(el)) {
      // ITS OWN CHILDREN ARE NOT SOMETHING IT COVERS. The dot and the label are
      // static elements inside a fixed parent, so the loop sees them as ordinary
      // ink sitting exactly where the pill is, and the first run reported the
      // pill covering itself on every case.
      const ox = Math.min(r.right, pillRect.right) - Math.max(r.left, pillRect.left);
      const oy = Math.min(r.bottom, pillRect.bottom) - Math.max(r.top, pillRect.top);
      if (ox > 1 && oy > 1) {
        pillCovers.push((el.className || el.tagName).toString().slice(0, 34) + ' by ' + Math.round(Math.min(ox, oy)));
      }
    }
    // WHAT WOULD THE CANDIDATE COVER? Same overlap test the pill gets, asked of
    // four rectangles that are not there yet. Only PAINTED elements count, by
    // the same paints rule above: a container whose box merely reaches into
    // the corner is not something a person can see being covered.
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      const pr = probeRects[corner];
      const ox = Math.min(r.right, pr.right) - Math.max(r.left, pr.left);
      const oy = Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top);
      if (ox > 1 && oy > 1) {
        probeCovers[corner].push((el.className || el.tagName).toString().slice(0, 30) + ' by ' + Math.round(Math.min(ox, oy)));
      }
    }
  }
  // EVERY BackButton emits .gn-textbtn as its base class, so this is the one
  // hook that cannot go stale. It used to be a hardcoded list of per-pack class
  // names, which silently reported "no button" for any pack nobody remembered
  // to add, which is the same shape of miss this whole file exists to catch.
  //
  // .beerio-tv-back joined on 2026-08-15. That pack's TV does NOT use the
  // shared BackButton (standing rule 4 says so in as many words: "Beerio has
  // its own styled one in its header"), so the sentence above was true of every
  // BackButton and quietly false of the one screen that does not have one. It
  // reported "no button" the first time it was ever measured.
  const back = document.querySelector('.gn-textbtn, .cg-tv__back, .beerio-tv-back');
  const bb = back ? back.getBoundingClientRect() : null;
  const lvw2 = document.documentElement.clientWidth, lvh2 = document.documentElement.clientHeight;
  return {
    railW,
    lowest: Math.round(low),
    lowWho: String(lowWho),
    lowInk: ink.sort((x, y) => y.b - x.b).slice(0, 3).map((i) => i.b + "px  " + i.who + "  " + JSON.stringify(i.text)),
    backBottom: bb ? Math.round(bb.bottom + window.scrollY) : null,
    // How far the back button reaches into the bottom timber. Negative is
    // clearance, positive is a control with wood painted over it.
    backIntoRail: bb ? Math.round(bb.bottom - (vh - railW)) : null,
    // Where the way back actually sits, so a fixed overlay's placement is
    // decided against a number rather than against an assumption about it.
    backBox: bb
      ? { left: Math.round(bb.left), right: Math.round(lvw2 - bb.right), bottom: Math.round(lvh2 - bb.bottom) }
      : null,
    covered: covered.slice(0, 6),
    pill: pillRect
      ? {
          text: (pillEl.textContent || '').trim().slice(0, 40),
          // Clearance from each edge of the LAYOUT viewport, so a negative
          // number is a pill hanging off the screen.
          right: Math.round(document.documentElement.clientWidth - pillRect.right),
          bottom: Math.round(document.documentElement.clientHeight - pillRect.bottom),
          // How far it reaches into the bottom or right timber. Negative is
          // clearance, positive is a pill with wood painted over it.
          intoRail: railW
            ? Math.round(Math.max(pillRect.bottom - (vh - railW), pillRect.right - (vw - railW)))
            : null,
        }
      : null,
    pillCovers: pillCovers.slice(0, 6),
    probeCovers: Object.fromEntries(
      Object.entries(probeCovers).map(([k, v]) => [k, v.slice(0, 6)]),
    ),
    rendered: !!document.querySelector(PROOF),
  };
})()`;

let seeder = null;
async function measure(theme, route, payload, proof, waitMs) {
  PAYLOAD = payload;
  if (seeder) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seeder });
  ({ identifier: seeder } = (await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("gamenight.pref.theme","${theme}")}catch(e){}` })).result);
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}${route}` });
  // 2300ms is enough for every screen here to paint. ONE case needs longer: the
  // event TV's left column alternates on a 12s timer, and the LIFETIME face is
  // the taller of the two, so measuring it means waiting for the flip rather
  // than measuring the face that happens to be up first.
  await sleep(waitMs ?? 2300);
  return await ev(MEASURE(proof));
}

// Past DOWN_GRACE_MS (4000ms) plus one staleness tick (2000ms), so the pill has
// definitely had its chance to appear. Every other case waits 2300ms and is
// therefore measured with no pill at all, which is what keeps their numbers
// comparable to the runs before this existed.
const PILL_WAIT = 8000;

const CASES = [
  ["money board  4 seats", "/blackjack/tv/x", money(4, []), ".cg-tv__line"],
  ["money board  6 seats", "/blackjack/tv/x", money(6, []), ".cg-tv__line"],
  ["money board  8 seats", "/blackjack/tv/x", money(8, []), ".cg-tv__line"],
  ["money board 12 seats", "/blackjack/tv/x", money(12, []), ".cg-tv__line"],
  ["money board 12 + 5 mods", "/blackjack/tv/x", money(12, ["m1", "m2", "m3", "m4", "m5"]), ".cg-tv__line"],
  ["poker        4 seats", "/poker/tv/x", poker(4), ".cg-tv__line"],
  ["poker        8 seats", "/poker/tv/x", poker(8), ".cg-tv__line"],
  ["poker       12 seats", "/poker/tv/x", poker(12), ".cg-tv__line"],
  ["ping pong    6 players", "/pingpong/tv/x", pingpong(6), ".pp-tv__panel"],
  ["ping pong    7 players", "/pingpong/tv/x", pingpong(7), ".pp-tv__panel"],
  // ADDED 2026-08-22 WITH THE LADDER. Six and seven were the old boundary and
  // the old failure; a ladder measured only at the count it was built for is a
  // ladder proved at one point. These are the other three rungs and the top of
  // what it was measured to.
  ["ping pong    9 players", "/pingpong/tv/x", pingpong(9), ".pp-tv__panel"],
  ["ping pong   12 players", "/pingpong/tv/x", pingpong(12), ".pp-tv__panel"],
  ["ping pong   16 players", "/pingpong/tv/x", pingpong(16), ".pp-tv__panel"],
  ["mario kart   8 solo", "/mariokart/tv/x", mariokart(8, false), ".mk-tv__panel"],
  ["mario kart   8 karts", "/mariokart/tv/x", mariokart(8, true), ".mk-tv__panel"],
  ["mario kart  12 solo", "/mariokart/tv/x", mariokart(12, false), ".mk-tv__panel"],
  ["mario kart  16 solo", "/mariokart/tv/x", mariokart(16, false), ".mk-tv__panel"],
  ["mario kart  16 karts", "/mariokart/tv/x", mariokart(16, true), ".mk-tv__panel"],
  ["mario kart  16 koth", "/mariokart/tv/x", mariokart(16, true, "koth"), ".mk-tv__panel"],
  // The two rungs between eight and sixteen, added with the ladder: a ladder
  // proved at its endpoints is a ladder proved nowhere, which is written down
  // at the top of this file about the bracketed TVs and applies here too.
  ["mario kart  10 solo", "/mariokart/tv/x", mariokart(10, false), ".mk-tv__panel"],
  ["mario kart  14 solo", "/mariokart/tv/x", mariokart(14, false), ".mk-tv__panel"],
  ["casino run   6 mid-run", "/casinorun/tv/x", crun(6), ".crun-tv"],
  ["casino run  12 mid-run", "/casinorun/tv/x", crun(12), ".crun-tv"],
  ["board game   4 players", "/boardgame/tv/x", titlenight(4), ".tn-tv__panel"],
  ["board game   8 players", "/boardgame/tv/x", titlenight(8), ".tn-tv__panel"],
  ["board game  12 players", "/boardgame/tv/x", titlenight(12), ".tn-tv__panel"],
  ["board game  16 players", "/boardgame/tv/x", titlenight(16), ".tn-tv__panel"],
  // Card Table draws the SAME TV component, so the interesting case is not
  // whether the layout fits (it is the same layout) but whether the pack's own
  // theme changed the density. Twelve is the one that matters and it is the one
  // Board Game is already over at, so a passing four and eight here with a
  // failing twelve would be the expected shape rather than a surprise.
  ["card table   4 players", "/cardtable/tv/x", titlenight(4), ".tn-tv__panel"],
  ["card table   8 players", "/cardtable/tv/x", titlenight(8), ".tn-tv__panel"],
  // TWELVE, added 2026-08-22. BUGS has said since 08-09 that Card Table draws
  // the same component and that this is one bug on two packs, and only ONE of
  // the two was measured at the count it fails at. A shared component measured
  // on one of its two consumers is a component measured on a coin flip: the
  // packs set different tokens on the same sheet, so "same layout" is an
  // assumption until the second one prints a number.
  ["card table  12 players", "/cardtable/tv/x", titlenight(12), ".tn-tv__panel"],
  // SIXTEEN on both, added with the ladder. Both packs seat twelve, so this is
  // past the cap on purpose: it does not have to be reachable, it has to
  // degrade at the tightest band rather than paint off the bottom.
  ["card table  16 players", "/cardtable/tv/x", titlenight(16), ".tn-tv__panel"],
  // The column count steps with the roster (2 / 3 / 4 / 5), so the interesting
  // cases are the step boundaries and the cap. TWENTY IS THE ONE THAT MATTERS
  // and it is the reason this pack was designed against a 1080p screen rather
  // than measured after the fact.
  ["deduction   6 players", "/deduction/tv/x", deduction(6), ".sd-p"],
  ["deduction  12 players", "/deduction/tv/x", deduction(12), ".sd-p"],
  ["deduction  16 players", "/deduction/tv/x", deduction(16), ".sd-p"],
  ["deduction  20 players", "/deduction/tv/x", deduction(20), ".sd-p"],
  // THE TWO BRACKETED TVs, four counts by four states each. The proof selector
  // is a round-strip cell: it needs a real rounds payload to exist at all, so a
  // stale fixture takes the waiting state and fails loudly rather than quietly
  // measuring a loading screen. The champion state has no strip on Beerio's
  // side of the grid but does have one above it, so the same hook serves.
  //
  // BEERIO IS MEASURED IN ONE THEME ONLY, and that is not an oversight: the
  // pack is permanently exempt from the Tabletop conversion (STANDING RULES /
  // NEXT UP), so it paints identically under both and a second pass would cost
  // sixteen navigations to prove nothing.
  ...[4, 8, 12, 16].flatMap((n) =>
    STATES.map((st) => [
      `bracket tv ${String(n).padStart(2)} ${st.padEnd(5)}`, "/tv/x", bracketTv(n, st), ".gn-tvst",
    ]),
  ),
  ...[4, 8, 12, 16].flatMap((n) =>
    STATES.map((st) => [
      `beerio tv  ${String(n).padStart(2)} ${st.padEnd(5)}`, "/beerio/tv/ABCD", beerioTv(n, st), ".beerio-tv-strip", ["arcade"],
    ]),
  ),
  // OUT OF CONTRACT, REPORTED ANYWAY. The shell's bracket takes its entrants
  // off the yes-RSVP list with no cap, so twenty-four is reachable even though
  // the ladder was only measured to sixteen. It does not have to fit; it has to
  // degrade at the tightest band rather than silently paint off the bottom.
  ["bracket tv 24 mid  ", "/tv/x", bracketTv(24, "mid"), ".gn-tvst", ["arcade"]],
  // Single elim is the other board shape, and its column is shorter (two groups
  // rather than three), so it is measured at the count that binds rather than
  // at every one.
  ["bracket tv 16 single", "/tv/x", bracketTv(16, "mid", "single_elim"), ".gn-tvst", ["arcade"]],
  // DOUBLES, added 2026-08-17 with team entrants. A team slot is still ONE slot
  // on the board, so the column count is unchanged and the only thing that grew
  // is the height of a row: two names stacked instead of one. Eight pairs is a
  // full doubles night and sixteen is the top of what the ladder was ever
  // measured to, both with names as long as this screen can be handed.
  //
  // MEASURED RATHER THAN EYEBALLED, and deliberately so: both bracketed TVs
  // were hundreds of pixels over 1080p for months before the 08-15 fit pass,
  // and a team label is longer than a person's name. If these do not fit, that
  // is a BUGS entry and its own ladder session, not something to tune here.
  ...[8, 16].flatMap((n) =>
    STATES.map((st) => [
      `bracket tv ${String(n).padStart(2)} pairs ${st.padEnd(5)}`,
      "/tv/x",
      bracketTv(n, st, "double_elim", 2),
      ".gn-tvst",
      ["arcade"],
    ]),
  ),
  // ---- THE CONNECTION PILL, which is the only state it has ----------------
  //
  // WHY THESE CASES EXIST AT ALL: the pill renders NOTHING while a screen is
  // hearing the hub, so its one visible state is invisible to every case above
  // and would have shipped unmeasured on eleven TV routes. The checklist says
  // the harness ships in the same commit as the screen, and a screen with one
  // state nobody measured is exactly what that rule is for.
  //
  // HOW THEY ARE FORCED, with no flag and no stub: `vite preview` serves the
  // built bundle and has no /ws endpoint, so every one of these pages genuinely
  // cannot connect. The pill waits DOWN_GRACE_MS before saying so, which is
  // longer than the 2300ms every other case waits, which is why those cases
  // stay pill-free and comparable to their old numbers rather than all silently
  // gaining an overlay.
  //
  // FIVE ROUTES, chosen for what is at the bottom of each: a money board's
  // settlement lines, the bracket's alive board, a title-night panel, the
  // densest deduction board, and Beerio.
  ["pill money board 12", "/blackjack/tv/x", money(12, []), ".cg-tv__line", null, PILL_WAIT],
  ["pill bracket 16 mid", "/tv/x", bracketTv(16, "mid"), ".gn-tvst", ["arcade"], PILL_WAIT],
  ["pill board game 12", "/boardgame/tv/x", titlenight(12), ".tn-tv__panel", null, PILL_WAIT],
  ["pill deduction 20", "/deduction/tv/x", deduction(20), ".sd-p", null, PILL_WAIT],
  // BEERIO MUST SHOW NO PILL, and that is a property rather than an exemption:
  // it polls on its own timer and never mounts the live hook, so the store sees
  // nobody subscribed and reports `idle`. Nothing special-cases this pack; this
  // case is here to prove that staying true, because the day it stops being
  // true is the day a vendored 1:1 replica quietly grows an overlay.
  ["pill beerio 16 mid", "/beerio/tv/ABCD", beerioTv(16, "mid"), ".beerio-tv-strip", ["arcade"], PILL_WAIT],

  // THE EVENT TV, both states, four counts, both themes. See eventTv above for
  // why this had no case for weeks despite being colour-swept the whole time.
  ...[4, 8, 12, 16].flatMap((n) => [
    [`event tv lobby ${String(n).padStart(2)}`, "/e/x/tv", eventTv(n, false), ".gn-tv-name"],
    [`event tv night ${String(n).padStart(2)}`, "/e/x/tv", eventTv(n, true), ".gn-tvs"],
  ]),
  // A SMALL NIGHT INSIDE A BIG CREW, which is the shape the band has to serve:
  // four people playing, sixteen on the all-time board. Arcade only and one
  // count, because what is being proved is the band's INPUT (the larger of the
  // two lists) rather than a new layout.
  ["event tv 4 of crew 16", "/e/x/tv", eventTv(4, true, 16), ".gn-tvs", ["arcade"]],
  // THE ROTATED FACE, measured AFTER the 12s flip rather than assumed. This is
  // the only case in this file that waits, and it waits because the taller of
  // the two columns is the one nobody is holding a device for when it appears.
  ["event tv lifetime 16", "/e/x/tv", eventTv(4, true, 16), ".gn-tvs", ["arcade"], 14500],
  // BEERIO GRAND PRIX, the other half of a route that has been half-measured
  // since it was added. Arcade only, for the same reason every other Beerio
  // case is: the pack is permanently exempt from theming and paints identically
  // in both, so a second pass costs navigations and proves nothing.
  ...[4, 8, 12, 16].flatMap((n) => [
    [`beerio gp  ${String(n).padStart(2)} racers`, "/beerio/tv/ABCD", beerioGp(n), ".beerio-tv-gp", ["arcade"]],
  ]),
  // NO VOTES, because the prediction bar is an OPTIONAL BLOCK the band charges
  // two racer-rows for, and a ladder that has only ever seen it up has never
  // been asked what happens when it is down.
  ["beerio gp  16 no votes", "/beerio/tv/ABCD", beerioGp(16, 3, false), ".beerio-tv-gp", ["arcade"]],
];

// A case that is ALREADY over before any rail exists cannot be made to pass by
// anything in a theme, so it is named rather than allowed to fail the run.
// BOARD GAME AT TWELVE joined this list on 2026-08-09, the day it was first
// measured: it shipped a TV on 08-04 and was never added here, which is how a
// pack with a TV ends up with a fit nobody owns. It seats twelve, so this is
// reachable rather than theoretical, and it is over by 176px with the back
// button 144px into the rail. Logged in BACKLOG under BUGS.
//
// NOT FIXED HERE, and the reason is the extraction rather than the clock: Board
// Game's and Card Table's TVs are about to become ONE component, so the density
// ladder this needs gets built once for both packs in its own session instead of
// twice. A fit ladder has been its own session every time (the money board's,
// which is the worked example) and this is no different.
//
// MARIO KART AT TWELVE AND SIXTEEN WAS HERE AND IS FIXED (2026-08-22). It had
// been named since 08-16, the day this TV was first measured at all, and for
// the same reason Board Game was: it shipped a TV and was never added here. It
// seats sixteen through the server's roster cap, so both failing counts were
// reachable rather than theoretical. 1179px at twelve (over by 99) and 1447 at
// sixteen (over by 367, back button 334px into the rail); now 8 / 10 / 12 / 14 /
// 16 all fit in both themes with the button clear by at least 194px.
//
// IT WAS NEVER THE KARTS, AND THAT WAS MEASURED RATHER THAN ASSUMED. The pairs
// session checked out the PREVIOUS commit's TV component and ran the same three
// payloads through it: 1447px, identical to the digit. The Players panel is per
// RACER whether or not karts are shared, and the Karts panel REPLACES the
// Racers panel rather than sitting beside it. The kart work added zero pixels,
// and the ladder is about the roster.
//
// THE EXEMPTION IS BY NAME AND STAYS THAT WAY. A new pack does not get added to
// this set: if Card Table's TV does not fit, that is a new bug in new code and
// it fails the run.
//
// SIXTEEN PAIRS WAS HERE AND IS FIXED (2026-08-22). It joined on 08-17 with
// team entrants, at three specific states, and the finding was narrow and
// MEASURED rather than guessed at:
//
//   what was over   the ALIVE BOARD, not the match cards. The lowest ink in
//                   every failing state was .gn-tva: chips are auto-width and
//                   the row wraps, so a doubled label made each chip wider,
//                   sixteen of them wrapped onto more rows, and the board grew
//                   about 300px. The cards did not move, because a team slot
//                   keeps ONE line.
//   how far          fresh 1309 (over by 229), mid and late 1377 (over by 297).
//   what fitted      EIGHT pairs in all four states, and SIXTEEN SOLO
//                   unchanged. So it was about LABEL WIDTH, not slot count.
//
// THE FIX IS A THIRD ANSWER, not a tighter rung: `bracketChipBand` caps
// --gn-tv-chip-max on its own [data-chip] attribute, so a long joined label
// ellipsises instead of wrapping the board off the screen. It rides a separate
// attribute because sixteen SOLO already sits at [data-band="tight"] and
// capping there would have truncated 24-character solo names to fix a board
// they are not on; and it does nothing at eight entrants or fewer, because
// eight pairs was measured fitting. Both of those are pinned by unit tests in
// bracket-tv-fit.test.ts, since both were mistakes made while building it.
//
// AND THE FOUR-ENTRANT FRESH REGRESSION IS FIXED WITH IT. DECK_CEILINGS put
// four on-deck cards at "roomy" and four cards do not fit there; the ceiling
// had never been exercised because until 2026-08-21 a four-entrant fresh
// bracket held two cards, not four.
//
// BEERIO'S GRAND PRIX WAS HERE AND IS FIXED (2026-08-22), and it was the last
// name in this set. Measured for the first time on 08-22: 1148 / 1717 / 2286px
// at 4 / 8 / 12 racers, over by 68 / 637 / 1206. BUGS recorded only the twelve,
// found from a photo of a real television on 08-19, and measuring the other two
// found IT HAD NEVER FITTED AT ANY COUNT. Largest gap of the five and the only
// one with nothing to tighten: GpBoard rendered Shell and Header at
// band="roomy" HARDCODED while the bracket board in the same file computed one
// per payload, and half of this route had no case here at all. It now has
// `beerioGpBand` and its own --bt-gp-* rungs, and fits at 4, 6, 8, 10, 12, 14
// and 16 with the prediction bar up and down.
//
// THE LAST TWO RUNGS GO TWO COLUMNS, which is a layout decision the ladder
// makes rather than a shrink: a GP row carries a rank, a dot, a NAME, a record
// and a points total, so it cannot go under this pack's 1.25vw name floor, and
// sixteen single-column rows at that floor do not fit 1080p however tight the
// padding gets. Sixteen in two columns do, at a size readable from a sofa.
//
// THE SET IS EMPTY NOW, for the first time since it was written. That is not a
// promise that nothing will ever be added: it is what "KNOWN shrinks, never
// grows, except for a genuinely new finding recorded with its numbers" looks
// like when a session actually finishes the list.
const KNOWN = new Set([]);
let newOverlaps = 0;
let stale = 0;
// THE FIT WAS REPORTED AND NEVER ENFORCED until 2026-08-15. This file has asked
// two questions since the rail shipped, and only the SECOND one (is anything
// covered) could fail the run: a case could print "OVER by 468" in the first
// column and the script would still exit 0. That is the same shape of miss as
// the `rendered` flag being computed and not read, and it is why four bracketed
// cases could be added in one session, all four over, and the exit code said
// nothing about it. Now a case that runs past 1080px fails unless it is named in
// KNOWN, which is where the two pre-existing pack overflows already live.
let overs = 0;
// THE CORNER TABLE, and it is the reason this run exists on 2026-08-29 rather
// than a by-product of it. "Never overlaps relevant information" is not a thing
// a fixed overlay can promise; it is a thing a measurement can prove or refuse.
// So every case is asked, in both themes, what a candidate overlay would cover
// in each of the four corners, and the placement decision comes out of the
// table rather than out of anybody's idea of where a QR goes.
const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];
const cornerHits = Object.fromEntries(CORNERS.map((c) => [c, []]));

console.log("case                      theme     rail  lowest  backBtm  vs 1080      back v rail   covered by the rail");
const pillLines = [];
for (const theme of ["arcade", "tabletop"]) {
  for (const [label, route, payload, proof, themes, waitMs] of CASES) {
    // A case may name the themes it is measured in. Only Beerio does, because
    // it is permanently exempt from theming and paints identically in both.
    if (themes && !themes.includes(theme)) continue;
    const m = await measure(theme, route, payload, proof, waitMs);
    const over = m.lowest - 1080;
    const back = m.backIntoRail === null ? "no button"
      : m.backIntoRail > 0 ? `UNDER by ${m.backIntoRail}` : `clear by ${-m.backIntoRail}`;
    console.log(
      `  ${label.padEnd(24)}${theme.padEnd(10)}${String(m.railW + "px").padEnd(6)}${String(m.lowest).padEnd(8)}` +
      `${String(m.backBottom).padEnd(9)}${(over > 0 ? "OVER by " + over : "fits").padEnd(13)}${back.padEnd(14)}${m.covered.join(" | ") || "nothing"}`,
    );
    // A PAYLOAD THE PAGE REJECTS RENDERS THE SHORT WAITING STATE, which fits
    // trivially and measures nothing. That was written down at the top of this
    // file and then not enforced: `rendered` was computed and never read, so
    // when Ping Pong's TV moved to sides on 2026-08-05 and this file's payload
    // stayed on the old aId/bId shape, both ping pong cases quietly stopped
    // measuring a scoreboard and kept passing. Now a stale payload FAILS.
    if (!m.rendered) { console.log(`      ^ DID NOT RENDER: payload is stale for ${route} (looked for ${proof})`); stale++; }
    // WHICH ELEMENT IS ACTUALLY LOWEST, printed for the cases that are over.
    // It was measured and thrown away, which cost a session: a board 297px past
    // 1080 says nothing about WHERE the height went, and the two candidates
    // (a taller row, or a wider chip wrapping the alive board onto more lines)
    // want completely different fixes.
    if (over > 0) {
      console.log(`      ^ lowest box: ${m.lowWho}`);
      for (const line of m.lowInk) console.log(`        lowest ink: ${line}`);
    }
    // Record what each candidate corner would have covered on this case.
    for (const corner of CORNERS) {
      const hits = m.probeCovers?.[corner] ?? [];
      if (hits.length) cornerHits[corner].push(`${label.trim()}  ${theme}  ${hits.join(" | ")}`);
    }
    if ((m.covered.length || (m.backIntoRail ?? -1) > 0) && !KNOWN.has(label)) newOverlaps++;
    if (over > 0 && !KNOWN.has(label)) overs++;
    // THE PILL'S OWN TWO QUESTIONS, reported in their own block because they
    // are asked of five cases rather than of every one, and because a column
    // that is empty eighty times is a column nobody reads.
    if (label.startsWith("pill ")) {
      const p = m.pill;
      pillLines.push(
        `  ${label.padEnd(24)}${theme.padEnd(10)}` +
        (p
          ? `up  right ${String(p.right).padStart(4)}  bottom ${String(p.bottom).padStart(4)}  ` +
            `rail ${p.intoRail === null ? "n/a" : p.intoRail > 0 ? "UNDER by " + p.intoRail : "clear by " + -p.intoRail}  ` +
            `covers ${m.pillCovers.join(" | ") || "nothing"}` +
            (m.backBox ? `  [back: left ${m.backBox.left} right ${m.backBox.right} bottom ${m.backBox.bottom}]` : "")
          : "no pill"),
      );
      // A pill that sits on a board's ink, or under the timber, is the same
      // class of fault the rail check exists for. Beerio is the one case that
      // is expected to have no pill, and it fails loudly if it grows one.
      const wantsPill = !label.includes("beerio");
      if (wantsPill && !p) { console.log(`      ^ NO PILL on ${label}: the degraded state did not render`); newOverlaps++; }
      if (!wantsPill && p) { console.log(`      ^ BEERIO GREW A PILL: it polls and must never mount the live hook`); newOverlaps++; }
      if (p && (m.pillCovers.length || (p.intoRail ?? -1) > 0 || p.right < 0 || p.bottom < 0)) newOverlaps++;
    }
  }
}
if (pillLines.length) {
  console.log("\nCONNECTION PILL (forced by a preview server with no /ws)");
  for (const line of pillLines) console.log(line);
}

// ---- the negative control -------------------------------------------------
//
// EVERY FIT CLAIM IN THIS REPO THAT TURNED OUT TO BE FALSE PASSED A CHECK THAT
// COULD NOT SEE THE FAULT. Ping Pong's payload went stale and both its cases
// kept passing while measuring a waiting screen; the money board was measured
// to a footer that was not the lowest thing on the page. So before this script
// is allowed to report that the ladder works, it proves it can still see the
// ladder NOT working: the band variables are pinned back to their base (roomy)
// values on every band, which is exactly the pre-ladder screen, and the case
// that binds hardest must go over. If it does not, the check has stopped
// measuring something and says so instead of passing.
// THE METRICS AS THEY SHIPPED ON 2026-08-15, before the ladder, restored on top
// of every band. Not the current base block: that block IS the roomy rung and is
// already denser than what shipped, so pinning to it proved almost nothing (it
// put the binding case 18px over instead of 468, and Beerio's not at all). The
// numbers below are read off the previous commit.
//
// THE SELECTORS ARE DOUBLED ON PURPOSE. `.gn-tv[data-band="tight"]` is one class
// plus one attribute, so a plain `.gn-tv[data-band]` ties on specificity and
// then loses or wins on source order, and a pack stylesheet arrives on a LAZY
// CHUNK long after this style tag does. Beerio's control silently did nothing
// the first time it ran, which is the whole reason a negative control is worth
// having: it caught itself.
const NEUTRALISE = `
  .gn-tv.gn-tv[data-chip]{--gn-tv-chip-max:100%}
  .gn-tv.gn-tv[data-band]{
    --gn-tv-nm:3vmin;--gn-tv-rt:1.7vmin;--gn-tv-row-pad:1.5vmin;--gn-tv-stack-gap:1.6vmin;
    --gn-tv-note:1.7vmin;
    --gn-tv-chip:2.4vmin;--gn-tv-chip-pad:.7vmin;--gn-tv-chip-padx:1.8vmin;--gn-tv-chip-gap:1.1vmin;
    --gn-tv-grp-gap:2vmin;--gn-tv-lbl:1.7vmin;--gn-tv-lbl-mb:1vmin;
    --gn-tv-strip-nm:1.5vmin;--gn-tv-strip-n:1.4vmin;--gn-tv-strip-pad:.8vmin;
    --gn-tv-strip-mt:2.4vmin;--gn-tv-cols-mt:3vmin;--gn-tv-h2:3vmin;--gn-tv-h2-mb:1.8vmin;
  }
  .beerio-root.beerio-tv.beerio-tv[data-band]{
    --bt-gp-cols:1;
    --bt-gp-row-pad:.9vw;--bt-gp-row-padx:1.5vw;--bt-gp-row-gap:1.5vw;--bt-gp-stack-gap:.8vw;
    --bt-gp-rank:2.6vw;--bt-gp-rank-w:4vw;--bt-gp-dot:2.2vw;--bt-gp-nm:2.4vw;
    --bt-gp-sub:1.4vw;--bt-gp-pts:3vw;--bt-gp-pts-w:6vw;
    --bt-gp-h2:2vw;--bt-gp-h2-mb:1vw;
    --bt-gp-pred-mb:1vw;--bt-gp-pred-pt:.8vw;--bt-gp-pred-lbl:1.4vw;
    --bt-brand:5.5vw;--bt-brand-sh:6px;--bt-pill:1.5vw;--bt-pill-pad:.5vw;
    --bt-h2:2vw;--bt-h2-mb:1vw;--bt-shell-pad:2vw;--bt-shell-gap:1.5vw;--bt-board-gap:1.2vw;
    --bt-nm:1.9vw;--bt-row-pad:.7vw;--bt-dot:1.6vw;--bt-card-gap:1vw;
    --bt-pb-l:1vw;--bt-pb-bar:1.4vw;--bt-pb-pad:1.2vw;
    --bt-chip:1.6vw;--bt-chip-pad:.4vw;--bt-chip-padx:1vw;--bt-chip-dot:1.3vw;
    --bt-chip-gap:.7vw;--bt-grp-gap:1vw;--bt-lbl:1.2vw;--bt-lbl-mb:.5vw;
    --bt-st-nm:1vw;--bt-st-n:.9vw;--bt-st-pad:.45vw;--bt-st-top:.7vw;
  }
  /* THE EVENT TV, added 2026-08-22 with its ladder. Unlike the two above, these
     ARE the roomy rung's values, and that is correct for this screen rather
     than sloppy: /e/:id/tv had NO ladder at all, so its base block was written
     to be the pre-ladder screen exactly (3vmin names, 1.3vmin row padding,
     1.4vmin chip gaps, the lot). Pinning every band back to it restores the
     screen as it shipped, which is the thing a control has to be able to see.
     Doubled selector for the same specificity reason as the two above. */
  .mk-tv.mk-tv[data-mkband]{
    --mk-tv-pad-y:3vmin;--mk-tv-pad-x:4vmin;--mk-tv-brand:6vmin;--mk-tv-meta:2.4vmin;
    --mk-tv-lbl:2.6vmin;--mk-tv-grid-mt:3vmin;--mk-tv-grid-gap:2vmin;--mk-tv-panel-pad:2.4vmin;
    --mk-tv-h3:2.6vmin;--mk-tv-h3-mb:1.4vmin;
    --mk-tv-line:3vmin;--mk-tv-line-pad:.8vmin;--mk-tv-sub:2.2vmin;--mk-tv-back-mt:3vmin;
  }
  .tn-tv.tn-tv[data-tnband]{
    --tn-tv-pad-y:3vmin;--tn-tv-pad-x:4vmin;--tn-tv-brand:5.4vmin;--tn-tv-meta:2.4vmin;
    --tn-tv-label:2.6vmin;--tn-tv-title:9vmin;--tn-tv-title-idle:5.6vmin;
    --tn-tv-grid-mt:2.6vmin;--tn-tv-grid-gap:2vmin;--tn-tv-panel-pad:2.2vmin;
    --tn-tv-h3:2.4vmin;--tn-tv-h3-mb:1.2vmin;
    --tn-tv-line-size:2.8vmin;--tn-tv-line-pad:.7vmin;--tn-tv-line-gap:2vmin;--tn-tv-back-mt:3vmin;
  }
  .pp-tv.pp-tv[data-ppband]{
    --pp-tv-pad:4vmin;--pp-tv-brand:6vmin;--pp-tv-meta:2.4vmin;
    --pp-tv-now-mt:3vmin;--pp-tv-now-pad:3vmin;--pp-tv-now-lbl:2.4vmin;
    --pp-tv-vs-gap:4vmin;--pp-tv-vs-mt:1.5vmin;--pp-tv-pl:5vmin;--pp-tv-sc:7vmin;
    --pp-tv-grid-mt:3vmin;--pp-tv-grid-gap:2vmin;
    --pp-tv-panel-pad:2vmin;--pp-tv-panel-padx:2.5vmin;
    --pp-tv-h3:2.6vmin;--pp-tv-h3-mb:1.5vmin;
    --pp-tv-line:3vmin;--pp-tv-line-pad:.8vmin;--pp-tv-back-mt:3vmin;
  }
  .gn-tv.gn-tv[data-eband]{
    --gn-etv-chip:3vmin;--gn-etv-chip-pad:1vmin;--gn-etv-chip-padx:2.2vmin;--gn-etv-chip-gap:1.4vmin;
    --gn-etv-nm:3vmin;--gn-etv-rank:2.8vmin;--gn-etv-rank-w:3.4vmin;
    --gn-etv-w:2.6vmin;--gn-etv-sub:1.7vmin;
    --gn-etv-row-pad:1.3vmin;--gn-etv-row-padx:1.8vmin;--gn-etv-row-gap:1.6vmin;
    --gn-etv-res:2.4vmin;--gn-etv-title:6vmin;--gn-etv-meta:2.2vmin;
    --gn-etv-foot:3vmin;--gn-etv-gap:3vmin;--gn-etv-more:1.8vmin;
    --gn-tv-stack-gap:1.3vmin;--gn-tv-cols-mt:2.6vmin;--gn-tv-h2:3vmin;--gn-tv-h2-mb:1.6vmin;
  }`;
// ---- the corner table -----------------------------------------------------
console.log(`\ncandidate overlay ${PROBE_W}x${PROBE_H} inset by the rail plus 12px, per corner:`);
for (const corner of CORNERS) {
  const hits = cornerHits[corner];
  console.log(`\n  ${corner.toUpperCase()}  ${hits.length === 0 ? "CLEAR ON EVERY CASE IN BOTH THEMES" : hits.length + " case/theme collisions"}`);
  for (const h of hits) console.log(`     ${h}`);
}

let control = 0;
console.log("\nnegative control: the ladder pinned back to its base metrics, which must NOT fit");
{
  const inject = (await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `addEventListener("DOMContentLoaded",()=>{const s=document.createElement("style");s.textContent=${JSON.stringify(NEUTRALISE)};document.head.appendChild(s)})`,
  })).result.identifier;
  for (const [label, route, payload, proof] of [
    ["bracket tv 16 mid  ", "/tv/x", bracketTv(16, "mid"), ".gn-tvst"],
    ["beerio tv  16 mid  ", "/beerio/tv/ABCD", beerioTv(16, "mid"), ".beerio-tv-strip"],
    // TWELVE, not sixteen, and that is the case that binds rather than the
    // biggest one. At sixteen the component draws eleven rows and a "+5 more"
    // line; at twelve it draws all twelve, which is the most rows this screen
    // ever puts on a television and therefore the hardest thing for the pinned
    // metrics to fit.
    ["event tv night 12 ", "/e/x/tv", eventTv(12, true), ".gn-tvs"],
    ["ping pong  16      ", "/pingpong/tv/x", pingpong(16), ".pp-tv__panel"],
    // CARD TABLE, not Board Game: the ladder is tuned against the TALLER of the
    // two packs and the control should bind on the same one.
    ["card table 12      ", "/cardtable/tv/x", titlenight(12), ".tn-tv__panel"],
    ["mario kart 16 solo ", "/mariokart/tv/x", mariokart(16, false), ".mk-tv__panel"],
    // SIXTEEN PAIRS, whose fix is the CHIP CAP rather than the band, so the
    // neutraliser above has to pin --gn-tv-chip-max back to 100% as well. It
    // did not at first and this control reported "FITS, so this check is
    // blind", which is the control catching itself for the second time in this
    // file's life (Beerio's did the same on 2026-08-15).
    ["bracket 16 pairs   ", "/tv/x", bracketTv(16, "mid", "double_elim", 2), ".gn-tvst"],
    ["beerio gp 12       ", "/beerio/tv/ABCD", beerioGp(12), ".beerio-tv-gp"],
  ]) {
    const m = await measure("arcade", route, payload, proof);
    const over = m.lowest - 1080;
    console.log(`  ${label.padEnd(24)}${String(m.lowest).padEnd(8)}${over > 0 ? "OVER by " + over + "  (control holds)" : "FITS, so this check is blind"}`);
    if (over <= 0) control++;
  }
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: inject });
}

const ok = newOverlaps === 0 && stale === 0 && overs === 0 && control === 0;
console.log(
  ok
    ? "\nPASS  every case fits 1080p and nothing is covered by a fixed overlay (everything still named in KNOWN excepted, and logged in BUGS)"
    : [
        overs ? `FAIL  ${overs} case(s) run past 1080px` : "",
        newOverlaps ? `FAIL  ${newOverlaps} case(s) have painted content under a fixed overlay` : "",
        stale ? `FAIL  ${stale} case(s) never rendered: the payload no longer matches the page` : "",
        control ? `FAIL  ${control} negative control(s) FIT without the ladder, so this check cannot see the fault it exists for` : "",
      ].filter(Boolean).join("\n"),
);
chrome.kill("SIGKILL"); preview.kill("SIGKILL"); process.exit(ok ? 0 : 1);

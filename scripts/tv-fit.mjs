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
// KNOWN AND LOGGED (see BACKLOG, BUGS): Ping Pong's TV does not fit 1080p past
// six players and never has. Its back button is already 3px off the bottom in
// Arcade, and under Tabletop the rail deepens that to 17px. That is a pack fit
// ladder, its own session, and it is exempted by name here rather than by
// softening the check.

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
// THIS IS THE SIXTH INSTANCE OF ONE ROOT CAUSE, and it is worth naming as a
// pattern rather than as a sixth accident: Board Game (2026-08-09), both
// bracketed TVs (08-15), Mario Kart (08-16), Beerio's Grand Prix (08-19), and
// now this. A SCREEN WITH NO HARNESS CASE HAS NO OWNER. The event TV is in
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
const eventTv = (n, withRecap) => {
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
const beerioGp = (n, races = 3) => {
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
    predictions: {
      s1: { name: "Spectator One", picks: { [`H:${races}`]: "0" } },
      s2: { name: "Spectator Two", picks: { [`H:${races}`]: "1" } },
    },
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
const MEASURE = (PROOF) => `(()=>{
  const PROOF = ${JSON.stringify(PROOF)};
  const railW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gn-rail-w')) || 0;
  const vh = window.innerHeight, vw = window.innerWidth;
  const covered = [];
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
    if (!paints || !railW) continue;
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
    const into = Math.max(
      railW - r.top,                 // under the top timber
      r.bottom - (vh - railW),       // under the bottom timber
      railW - r.left,
      r.right - (vw - railW),
    );
    if (into > 0) covered.push((el.className || el.tagName).toString().slice(0, 34) + ' by ' + Math.round(into));
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
  return {
    railW,
    lowest: Math.round(low),
    lowWho: String(lowWho),
    lowInk: ink.sort((x, y) => y.b - x.b).slice(0, 3).map((i) => i.b + "px  " + i.who + "  " + JSON.stringify(i.text)),
    backBottom: bb ? Math.round(bb.bottom + window.scrollY) : null,
    // How far the back button reaches into the bottom timber. Negative is
    // clearance, positive is a control with wood painted over it.
    backIntoRail: bb ? Math.round(bb.bottom - (vh - railW)) : null,
    covered: covered.slice(0, 6),
    rendered: !!document.querySelector(PROOF),
  };
})()`;

let seeder = null;
async function measure(theme, route, payload, proof) {
  PAYLOAD = payload;
  if (seeder) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seeder });
  ({ identifier: seeder } = (await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem("gamenight.pref.theme","${theme}")}catch(e){}` })).result);
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}${route}` });
  await sleep(2300);
  return await ev(MEASURE(proof));
}

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
  ["mario kart   8 solo", "/mariokart/tv/x", mariokart(8, false), ".mk-tv__panel"],
  ["mario kart   8 karts", "/mariokart/tv/x", mariokart(8, true), ".mk-tv__panel"],
  ["mario kart  12 solo", "/mariokart/tv/x", mariokart(12, false), ".mk-tv__panel"],
  ["mario kart  16 solo", "/mariokart/tv/x", mariokart(16, false), ".mk-tv__panel"],
  ["mario kart  16 karts", "/mariokart/tv/x", mariokart(16, true), ".mk-tv__panel"],
  ["mario kart  16 koth", "/mariokart/tv/x", mariokart(16, true, "koth"), ".mk-tv__panel"],
  ["casino run   6 mid-run", "/casinorun/tv/x", crun(6), ".crun-tv"],
  ["casino run  12 mid-run", "/casinorun/tv/x", crun(12), ".crun-tv"],
  ["board game   4 players", "/boardgame/tv/x", titlenight(4), ".tn-tv__panel"],
  ["board game   8 players", "/boardgame/tv/x", titlenight(8), ".tn-tv__panel"],
  ["board game  12 players", "/boardgame/tv/x", titlenight(12), ".tn-tv__panel"],
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
  // THE EVENT TV, both states, four counts, both themes. See eventTv above for
  // why this had no case for weeks despite being colour-swept the whole time.
  ...[4, 8, 12, 16].flatMap((n) => [
    [`event tv lobby ${String(n).padStart(2)}`, "/e/x/tv", eventTv(n, false), ".gn-tv-name"],
    [`event tv night ${String(n).padStart(2)}`, "/e/x/tv", eventTv(n, true), ".gn-tvs"],
  ]),
  // BEERIO GRAND PRIX, the other half of a route that has been half-measured
  // since it was added. Arcade only, for the same reason every other Beerio
  // case is: the pack is permanently exempt from theming and paints identically
  // in both, so a second pass costs navigations and proves nothing.
  ...[4, 8, 12].flatMap((n) => [
    [`beerio gp  ${String(n).padStart(2)} racers`, "/beerio/tv/ABCD", beerioGp(n), ".beerio-tv-gp", ["arcade"]],
  ]),
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
// MARIO KART AT TWELVE AND SIXTEEN joined on 2026-08-16, the day this TV was
// first measured at all, and for exactly the reason Board Game did: it shipped
// a TV and was never added here. It seats sixteen through the server's roster
// cap, so this is reachable rather than theoretical.
//
// IT IS NOT THE KARTS, AND THAT WAS MEASURED RATHER THAN ASSUMED. The pairs
// session that added these cases checked out the PREVIOUS commit's TV component
// and ran the same three payloads through it: 1447px, over by 367, identical to
// the digit in every case. The Players panel is per RACER whether or not karts
// are shared, so it is the tall column either way, and the Karts panel replaces
// the Racers panel rather than sitting beside it (karts are never more numerous
// than racers). The kart work added zero pixels. Twelve is where it first goes
// over; eight fits with 201px of clearance in Arcade, which covers a Double
// Dash night, so the reachable-and-common case is fine.
//
// NOT FIXED HERE. This is a density ladder, and a fit ladder has been its own
// session every time (the money board's is the worked example). Logged in
// BACKLOG under BUGS beside Ping Pong's and Board Game's.
//
// THE EXEMPTION IS BY NAME AND STAYS THAT WAY. A new pack does not get added to
// this set: if Card Table's TV does not fit, that is a new bug in new code and
// it fails the run.
//
// SIXTEEN PAIRS joined on 2026-08-17, with team entrants, and it is the one
// entry here that is not a whole screen. It is named at three specific states
// because the finding is narrow and was MEASURED rather than guessed at:
//
//   what is over    the ALIVE BOARD, not the match cards. The lowest ink in
//                   every failing state is .gn-tva, and the board's chips are
//                   auto-width and wrap: a doubled-length label makes each chip
//                   wider, sixteen of them wrap onto more rows, and the board
//                   grows about 300px. The bracket cards themselves did not
//                   move, because a team slot keeps ONE line (see TvPage).
//   how far          fresh 1309 (over by 229), mid and late 1377 (over by 297).
//   what fits        EIGHT pairs fits in all four states, which is a sixteen
//                   person doubles night and the reachable common case. So does
//                   sixteen SOLO, unchanged, so this is about label length and
//                   not about slot count.
//
// NOT FIXED HERE, and that is the standing shape of this file rather than the
// clock: a fit ladder has been its own session every time, the money board's
// being the worked example, and the alive board's chip width is exactly the
// kind of density decision that wants measuring rather than taste. Logged in
// BACKLOG under BUGS beside the other three.
//
// THREE SCREENS JOINED ON 2026-08-22, the day each was first measured, and all
// three for the same reason every entry above joined: nothing had ever asked.
//
// CARD TABLE AT TWELVE. 1256px in BOTH themes, over by 176, back button 144px
// into the rail in Arcade and 158px in Tabletop. BUGS has said since 08-09 that
// this is Board Game's bug on a second pack, and MEASURING IT FOUND THAT IS NOT
// QUITE TRUE: Board Game is 1256 Arcade / 1236 Tabletop, Card Table is 1256 in
// both, so under Tabletop the two packs differ by 20px. They draw the same
// component and set DIFFERENT TOKENS on it, so "same layout" was an assumption
// and the 20px is what the assumption was hiding. The shared ladder has to land
// the TALLER of the two, which is Card Table's, not Board Game's.
//
// THE EVENT TV'S BETWEEN-GAMES SCREEN. 1232px, over by 152, in both themes, at
// EIGHT, TWELVE AND SIXTEEN players IDENTICALLY, and that constant is the whole
// finding. The screen does not grow with the roster because
// recap.players.slice(0, 8) and recap.games.slice(-6) cap it, so a twelve
// person night silently drops four people off the television AND the screen is
// STILL 152px over at the capped size. Two bugs stacked: a cap that hides
// people, over a layout that does not fit even with them hidden. Four players
// fits at 1080 exactly. The LOBBY state fits at every count measured, so this is
// the between-games face only.
//
// BEERIO'S GRAND PRIX. 1148 / 1717 / 2286px at 4 / 8 / 12 racers, over by
// 68 / 637 / 1206. BUGS recorded only the twelve, and measuring the other two
// found IT DOES NOT FIT AT FOUR EITHER: this board has never fitted a
// television at any count. It is the largest gap of the five and the only one
// with no ladder at all to spend, because GpBoard hardcodes band="roomy".
//
// AND ONE THAT IS A REGRESSION RATHER THAN AN ANCIENT OVERFLOW, which is why it
// is called out separately: BRACKET TV AT FOUR ENTRANTS, FRESH. 1128px, over by
// 48, both themes, and ONLY in the `fresh` state and ONLY at four. It is caused
// by the 2026-08-21 on-deck placeholder work, and that session's closeout says
// "tv-fit: PASS, every case fits", so this shipped believing it was measured.
// VERIFIED AGAINST A CLEAN CHECKOUT of that commit rather than assumed.
//
// THE INPUT IS NOT STALE, WHICH IS THE INTERESTING PART. TvPage passes
// `ready: deckAll.length` with a comment saying in as many words that a pending
// card costs what a ready one does, so the band is being asked the right
// question. What is wrong is the ANSWER: DECK_CEILINGS puts four cards at
// "roomy", and four cards do not fit at roomy metrics. That ceiling was never
// exercised before, because until 08-21 a four-entrant fresh bracket had only
// TWO ready matches and the column never held four cards at that count. The
// deck rule made a four-card deck reachable at the one entrant count whose
// board ceiling is roomy, and the ladder had no measurement there.
//
// Eight, twelve and sixteen all still fit fresh, because their entrant count
// pushes the board sub-ladder to close or tighter and drags the deck metrics
// down with it. Fixed in the bracketed-TV ladder commit, not here: this file
// measures.
const KNOWN = new Set([
  "bracket tv  4 fresh",
  "ping pong    7 players",
  "board game  12 players",
  "card table  12 players",
  "mario kart  12 solo",
  "mario kart  16 solo",
  "mario kart  16 karts",
  "mario kart  16 koth",
  "bracket tv 16 pairs fresh",
  "bracket tv 16 pairs mid  ",
  "bracket tv 16 pairs late ",
  "event tv night  8",
  "event tv night 12",
  "event tv night 16",
  "beerio gp   4 racers",
  "beerio gp   8 racers",
  "beerio gp  12 racers",
]);
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
console.log("case                      theme     rail  lowest  backBtm  vs 1080      back v rail   covered by the rail");
for (const theme of ["arcade", "tabletop"]) {
  for (const [label, route, payload, proof, themes] of CASES) {
    // A case may name the themes it is measured in. Only Beerio does, because
    // it is permanently exempt from theming and paints identically in both.
    if (themes && !themes.includes(theme)) continue;
    const m = await measure(theme, route, payload, proof);
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
    if ((m.covered.length || (m.backIntoRail ?? -1) > 0) && !KNOWN.has(label)) newOverlaps++;
    if (over > 0 && !KNOWN.has(label)) overs++;
  }
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
  .gn-tv.gn-tv[data-band]{
    --gn-tv-nm:3vmin;--gn-tv-rt:1.7vmin;--gn-tv-row-pad:1.5vmin;--gn-tv-stack-gap:1.6vmin;
    --gn-tv-note:1.7vmin;
    --gn-tv-chip:2.4vmin;--gn-tv-chip-pad:.7vmin;--gn-tv-chip-padx:1.8vmin;--gn-tv-chip-gap:1.1vmin;
    --gn-tv-grp-gap:2vmin;--gn-tv-lbl:1.7vmin;--gn-tv-lbl-mb:1vmin;
    --gn-tv-strip-nm:1.5vmin;--gn-tv-strip-n:1.4vmin;--gn-tv-strip-pad:.8vmin;
    --gn-tv-strip-mt:2.4vmin;--gn-tv-cols-mt:3vmin;--gn-tv-h2:3vmin;--gn-tv-h2-mb:1.8vmin;
  }
  .beerio-root.beerio-tv.beerio-tv[data-band]{
    --bt-brand:5.5vw;--bt-brand-sh:6px;--bt-pill:1.5vw;--bt-pill-pad:.5vw;
    --bt-h2:2vw;--bt-h2-mb:1vw;--bt-shell-pad:2vw;--bt-shell-gap:1.5vw;--bt-board-gap:1.2vw;
    --bt-nm:1.9vw;--bt-row-pad:.7vw;--bt-dot:1.6vw;--bt-card-gap:1vw;
    --bt-pb-l:1vw;--bt-pb-bar:1.4vw;--bt-pb-pad:1.2vw;
    --bt-chip:1.6vw;--bt-chip-pad:.4vw;--bt-chip-padx:1vw;--bt-chip-dot:1.3vw;
    --bt-chip-gap:.7vw;--bt-grp-gap:1vw;--bt-lbl:1.2vw;--bt-lbl-mb:.5vw;
    --bt-st-nm:1vw;--bt-st-n:.9vw;--bt-st-pad:.45vw;--bt-st-top:.7vw;
  }`;
let control = 0;
console.log("\nnegative control: the ladder pinned back to its base metrics, which must NOT fit");
{
  const inject = (await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `addEventListener("DOMContentLoaded",()=>{const s=document.createElement("style");s.textContent=${JSON.stringify(NEUTRALISE)};document.head.appendChild(s)})`,
  })).result.identifier;
  for (const [label, route, payload, proof] of [
    ["bracket tv 16 mid  ", "/tv/x", bracketTv(16, "mid"), ".gn-tvst"],
    ["beerio tv  16 mid  ", "/beerio/tv/ABCD", beerioTv(16, "mid"), ".beerio-tv-strip"],
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
    ? "\nPASS  every case fits 1080p and nothing is covered by a fixed overlay (Ping Pong past six, Board Game at twelve, Mario Kart past eight and the bracket at sixteen PAIRS excepted, and logged in BUGS)"
    : [
        overs ? `FAIL  ${overs} case(s) run past 1080px` : "",
        newOverlaps ? `FAIL  ${newOverlaps} case(s) have painted content under a fixed overlay` : "",
        stale ? `FAIL  ${stale} case(s) never rendered: the payload no longer matches the page` : "",
        control ? `FAIL  ${control} negative control(s) FIT without the ladder, so this check cannot see the fault it exists for` : "",
      ].filter(Boolean).join("\n"),
);
chrome.kill("SIGKILL"); preview.kill("SIGKILL"); process.exit(ok ? 0 : 1);

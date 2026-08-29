// Computed-style sweep: proves a theming change did not move the theme it was
// supposed to leave alone.
//
// WHY THIS EXISTS AND WHY IT IS NOT A SCREENSHOT DIFF. The tabletop theme is
// being landed in three stages, and stage 1 deliberately changed no colours at
// all: it only replaced hardcoded literals in index.css with the tokens they
// were already equal to. The whole risk of that pass is silently wrecking the
// theme that is already shipped, and a diff of the stylesheet cannot tell you
// whether it did. A screenshot diff can, but a screenshot diff on this app is
// noisy (webfonts swap in, .gn-pulse animates, the skeleton shimmer never
// stops), so it produces small differences on every run and trains whoever
// runs it to wave them through. A computed colour either matches or it does
// not.
//
// TWO PASSES, because neither one alone is enough:
//
//   ROUTES  walks every route in App.tsx in a real browser on the real built
//           bundle and records the resolved colour properties of every element
//           that renders. This is the evidence about actual screens. There is
//           no database here, so /api is stubbed over CDP: enough of an answer
//           to get past the signed-out gate and paint real screens, and a hard
//           404 for everything else so the pages that cannot be fed take their
//           error path the same way on both runs. Without the stub every route
//           renders the same loading fallback and the pass proves nothing.
//
//   FIXTURE builds one element per .gn-* class straight out of the stylesheet
//           and reads the colours back off it. This is the cascade check: the
//           rule pass would still pass if a rule's specificity changed and it
//           stopped winning, and this would not.
//
//   RULES   takes every style rule in the loaded stylesheets, applies it to a
//           probe element, and records what the browser resolves it to. This
//           is what makes the sweep exhaustive: it reaches :hover, :active,
//           :disabled, rules inside @media blocks, and every rule belonging to
//           a screen this harness cannot reach at all. The route pass covers
//           what a person sees; the rule pass covers the file.
//
// USAGE
//   node scripts/theme-sweep.mjs <out.json>     capture
//   node scripts/theme-sweep.mjs --compare <before.json> <after.json>
//
// Capture builds apps/web, serves dist with vite preview, and drives the
// pre-installed Chromium over CDP. Comparison is colour-space aware: a value
// is normalised to an rgba tuple before it is compared, because a browser is
// free to serialise the result of a color-mix() differently from the rgba()
// literal it replaced while painting exactly the same pixels. Stage 2 runs
// this again against [data-theme="tabletop"], where the interesting output is
// the opposite one: anything that did NOT move.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Node's own global WebSocket, so this script has no dependencies at all and
// runs before (or without) an install. `ws` is in the workspace, but only
// under apps/server, and reaching across for it is how a tool like this ends
// up broken in the one session that needs it.

const PORT = 4178;
const CDP_PORT = 9333;
const CHROME = "/opt/pw-browsers/chromium";

/**
 * Every route in App.tsx, with ids filled in. The ids are deliberately
 * nonsense: without a database behind it the app renders its signed-out,
 * empty and error states, and those states are themed too. What matters is
 * that the same route reaches the same state on both runs, not that the state
 * is the interesting one.
 */
const ROUTES = [
  "/",
  // THE HELP MODAL, OPEN. It is a fixed overlay that exists only while a search
  // param is set, which is the exact shape that has shipped unmeasured here five
  // times: a component the route pass never reaches because nothing on the page
  // has been tapped. It needs no interaction step precisely BECAUSE the open
  // state lives in the URL, so this is a plain route like any other, and it
  // measures the deep-linked case (param present at load) into the bargain.
  "/?help=1",
  "/g/x", "/e/x", "/e/x/recap", "/e/x/tv", "/b/x", "/tv/x",
  // The tournament's setup step, added 2026-08-17 with the roster screen. It is
  // a shell screen rather than a pack one, so it paints out of index.css and the
  // interesting question here is the same as for /b/x: that it followed.
  "/tournament",
  // "/quick" came out on 2026-08-18 when its page was deleted. The address
  // survives as a REDIRECT into /tournament, which is already in both lists
  // below, so sweeping it would visit a screen that paints one line of hint
  // text and then navigates away, which is a race rather than a measurement.
  "/beerio", "/g/x/stats", "/g/x/link-guest", "/me/stats",
  "/g/x/member/y", "/friend/y", "/beerio/tv/ABCD",
  "/smash", "/smash/tv/x",
  "/mariokart", "/mariokart/tv/x",
  "/marioparty", "/marioparty/tv/x",
  "/pingpong", "/pingpong/tv/x",
  "/blackjack", "/blackjack/tv/x",
  "/poker", "/poker/tv/x",
  "/roulette", "/roulette/tv/x",
  "/craps", "/craps/tv/x",
  "/casinorun", "/casinorun/tv/x",
  // Added 2026-08-09 with the title-night screens extraction. Board Game
  // shipped on 08-04 and was never listed here, which is the same gap tv-fit
  // had: a pack nobody added is a pack no harness covers, and this one was
  // about to have every class name on both its screens replaced.
  "/boardgame", "/boardgame/tv/x",
  "/cardtable", "/cardtable/tv/x",
  // Added 2026-08-10 with the pack, in the same commit, rather than five days
  // later the way Board Game was.
  "/deduction", "/deduction/tv/x",
  "/join/ABCD",
  "/nope",
];

/**
 * One route per stylesheet in the app, for the rule pass. Every pack ships its
 * CSS inside its own lazy chunk, so a stylesheet only exists in the document
 * once a route that imports it has been visited. Visiting one route per pack is
 * what makes the rule pass cover the pack files at all; without it a pack
 * conversion is checked only by whatever its empty state happens to render.
 */
const RULE_ROUTES = [
  "/",
  // tournament.css rides the setup screen's own lazy chunk, so the rule pass
  // cannot see it until a route that imports it has been visited. Its whole
  // palette is aliases of the shell's tokens, which is exactly the shape that
  // would fail SILENTLY if an alias were dropped: the rules keep working and
  // resolve to whatever the browser falls back to.
  "/tournament",
  "/pingpong",
  "/pingpong/tv/x",
  "/smash",
  "/mariokart",
  "/marioparty",
  "/blackjack",
  "/poker",
  "/roulette",
  "/craps",
  "/casinorun",
  // Both, because the page and the TV import the same shared stylesheet but
  // set different tokens on it, and the rule pass only sees a stylesheet once
  // a route that imports it has been visited.
  "/boardgame",
  "/boardgame/tv/x",
  "/cardtable",
  "/cardtable/tv/x",
  // Both, for the same reason: the page and the TV import deduction.css and set
  // different roots on it, and the rule pass only sees a stylesheet once a
  // route that imports it has been visited.
  "/deduction",
  "/deduction/tv/x",
  // BOTH BEERIO ROUTES, added 2026-08-15 with the alive board and the round
  // strip. The TV imports the same beerio.css the page does, so this adds no
  // stylesheet the pass could not already see; it is here because listing a
  // pack's page WITHOUT its TV is the habit that let Board Game go five days
  // unmeasured, and because this pack's TV is now a screen somebody edits.
  // /tv/x is deliberately NOT here: the shell TV paints out of index.css,
  // which "/" already loads, so a second visit would cost a route and prove
  // nothing. It is in ROUTES, which is the pass that walks screens.
  "/beerio",
  "/beerio/tv/ABCD",
  // /e/x/tv WAS ADDED HERE ON 2026-08-22 AND TAKEN BACK OUT THE SAME DAY, which
  // is worth a note because the reasoning for adding it was wrong in a way that
  // looked right. The argument was: the event TV now carries [data-eband]
  // blocks, so a rule pass that never visits it cannot notice the day one stops
  // resolving. THIS PASS DOES NOT DO THAT. It collects RULE DECLARATIONS from
  // the loaded stylesheets, keyed by stylesheet, and the event TV's ladder
  // lives in index.css, which "/" already loads. Visiting the route collects
  // the identical declarations a second time and proves nothing, for the same
  // reason /tv/x is deliberately absent two lines up. Whether a SCREEN spends
  // its variables is a question for scripts/tv-fit.mjs, which measures the
  // rendered page, and which now has ten cases for this route.
];

/**
 * The stub backend. Only the handful of endpoints that decide whether a screen
 * paints at all: /auth/me gets past the signed-out gate, and the three Home
 * reads fill the crew list, the friends cabinet and the stats tile, which is
 * where most of the shell's classes actually appear. Everything else answers
 * 404 so its screen takes an error or empty state, deterministically.
 */
const API_STUB = {
  "/api/auth/me": { id: "u1", email: "sweep@example.com", displayName: "Sweep", hasPassword: true },
  "/api/groups": [
    { id: "g1", name: "Crew A", slug: "crew-a", inviteCode: "AAAA", role: "owner" },
    { id: "g2", name: "Crew B", slug: "crew-b", inviteCode: "BBBB", role: "admin" },
    { id: "g3", name: "Crew C", slug: "crew-c", inviteCode: "CCCC", role: "member" },
  ],
  "/api/friends": [
    { userId: "u2", displayName: "Ana", crews: ["Crew A"] },
    { userId: "u3", displayName: "Bo", crews: ["Crew A", "Crew B"] },
  ],
  "/api/me/stats": { played: 12, wins: 5, winRate: 0.4166 },
  /**
   * THE EVENT PAGE HAD NO STUB AT ALL, so `/e/x` has been in ROUTES since that
   * list was written and sweeping its ERROR STATE the whole time: a 404 payload
   * renders "Event not found", which is about six elements out of a page with
   * dozens. Every colour on the real event page has been unmeasured.
   *
   * IT CARRIES A LOCATION AND A MAP LINK deliberately: the anchor is the one
   * link in this app and it only exists in the DOM when both a `locationUrl`
   * that passes the https guard and something to hang it on are present. A stub
   * without them sweeps a page with no anchor and reports that the link colour
   * is fine because it never saw one.
   */
  "/api/events/x": {
    id: "x",
    groupId: "g1",
    title: "Sweep Night",
    bracket: null,
    beerioCode: null,
    sessions: [],
    myRole: "owner",
    createdBy: "u1",
    groupName: "Crew A",
    inviteCode: "AAAA",
    // Past, so the attendance block and the host check-in list render too.
    scheduledFor: "2026-08-20T18:00:00.000Z",
    status: "scheduled",
    location: "Dave's place",
    locationUrl: "https://maps.example.com/dave",
    notes: "Park on the street, not the driveway.",
    rsvps: [
      { userId: "u1", displayName: "Sweep", status: "yes" },
      { userId: "u2", displayName: "Ana", status: "maybe" },
      { userId: "u3", displayName: "Bo", status: "no" },
    ],
    noResponse: [{ userId: "u4", displayName: "Cass" }],
    myStatus: "yes",
    myAttendance: null,
    attendance: [{ userId: "u2", showed: true }],
  },
};

/**
 * The properties a theme can move. Longhands only, so shorthands cannot hide.
 *
 * IT IS NOT ONLY COLOUR, and it stopped being only colour the moment a theme
 * was allowed to change what a surface is MADE of. Stage 3 turns the scanline
 * raster into a woven texture, the neon glow off, the moulded bevel into a
 * contact shadow, the pill into a card and the arcade face into woodtype. Every
 * one of those is geometry or type rather than a colour, so a sweep that
 * captured colour alone would have watched the entire session go past and
 * reported that nothing happened. The radius, font and opacity entries below
 * were added BEFORE any of that work started, and the Arcade baseline was taken
 * with them in place; a sweep extended afterwards can only tell you that the
 * two trees you already changed agree with each other.
 */
/**
 * ROUTES WITH SOMETHING BEHIND A TAP, and the reason this exists at all.
 *
 * The route pass navigates and measures what paints. That misses every control
 * that only exists once somebody has interacted, and this app has a history
 * there: five separate TV overflows shipped unmeasured because the harness never
 * reached the state that overflowed.
 *
 * EMPTY IS NOT THE SAME AS UNUSED. This was built for the place search list and
 * outlived it: the list came out on 2026-08-28 and the mechanism stayed, because
 * the next control that only exists behind a tap should not have to invent it
 * again. Add a route here rather than accepting that its interactive state goes
 * unmeasured.
 *
 * Each step runs in the page after the route has settled and returns nothing;
 * anything it cannot find is left alone rather than thrown, because a sweep that
 * dies on one route reports nothing about the other forty.
 */
const AFTER_NAVIGATE = {
  // THE FIRST-VISIT CUE ON THE HELP TRIGGER, forced on rather than waited for.
  //
  // It would in fact appear here on its own, because a fresh Chromium profile
  // has no seen-flag and the flag is not written until 4.2s in, well past this
  // pass's 600ms settle. RELYING ON THAT WOULD BE THE BUG: the route order, the
  // settle time and the cue duration are three numbers in three files, and the
  // day any of them moves, the gold silently stops being measured and the sweep
  // still passes. Forcing the class is idempotent and says what it wants.
  //
  // The rules and fixture passes reach .gn-cue on their own, but only as a bare
  // probe element; this is the one that measures it ON the trigger, where the
  // gold has to win against .gn-helpbtn's own colour and border by source order.
  "/": `(() => {
    const b = document.querySelector('.gn-helpbtn');
    if (b) b.classList.add('gn-cue');
  })()`,
};

const TRACKED_PROPS = [
  "color",
  "background-color",
  "background-image",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "box-shadow",
  "text-shadow",
  "text-decoration-color",
  "caret-color",
  "fill",
  "stroke",
  "-webkit-text-fill-color",
  // Structure, added for stage 3.
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "font-family",
  "opacity",
  // Material, added for the felt + rail session and BEFORE it was used. A
  // tinted tile is background-color plus background-image plus a blend mode,
  // and the rail is layered backgrounds at set sizes and positions; with none
  // of these captured, the sweep would have watched a CRT raster become a
  // blended felt weave and a timber frame appear, and reported that only the
  // background-image string changed.
  "background-size",
  "background-repeat",
  "background-position",
  "background-blend-mode",
  "mix-blend-mode",
];

// ---------------------------------------------------------------- CDP client

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    const listeners = new Map();
    let id = 0;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method) {
        listeners.get(msg.method)?.(msg.params);
        return;
      }
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(JSON.stringify(msg.error)));
      else slot.resolve(msg.result);
    });
    ws.addEventListener("error", reject);
    ws.addEventListener("open", () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const mine = ++id;
            pending.set(mine, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id: mine, method, params }));
          });
        },
        on: (method, fn) => listeners.set(method, fn),
        close: () => ws.close(),
      }),
    );
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Run an expression in the page and return its (JSON) value. */
async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
  return result.value;
}

// ------------------------------------------------------- in-page collectors

/**
 * Every element in the document, keyed by a stable path. The key is structural
 * (tag + class list + sibling index, up the tree), so it survives a rebuild
 * and only changes if the DOM itself changed.
 */
const COLLECT_DOM = (props) => `(() => {
  const PROPS = ${JSON.stringify(props)};
  const key = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      const idx = n.parentElement ? [...n.parentElement.children].indexOf(n) : 0;
      parts.unshift(n.tagName.toLowerCase() + (n.className && typeof n.className === 'string'
        ? '.' + n.className.trim().split(/\\s+/).join('.') : '') + '#' + idx);
    }
    return parts.join(' > ');
  };
  const out = {};
  for (const el of [document.documentElement, document.body, ...document.body.querySelectorAll('*')]) {
    // <head> is skipped entirely: nothing in it paints, and its children are
    // the one part of the document a non-visual change reorders. Adding the
    // pre-paint theme script shifted every later <meta> by one index and
    // produced 4700 phantom differences about the colour of a <meta> tag.
    // INSIDE BEERIO IS NOT SWEPT, and the reason is not only that it is the
    // permanently exempt vendored replica. It assigns its four player colours
    // at random on mount, so capturing it makes the harness disagree with
    // itself between two runs of the SAME tree: 12 differences on /beerio and
    // nowhere else, which is exactly the "small differences every time" that
    // teaches a reader to wave real ones through. Its root element is still
    // captured, so the shell leaking a background or a border into it would
    // still be caught.
    if (el.parentElement && el.parentElement.closest('.beerio-root')) continue;
    // THE PSEUDO-ELEMENTS ARE NOT OPTIONAL HERE. The ambient texture is painted
    // by .gn-app::before and .gn-tv::before, so a pass that only reads elements
    // cannot see the single most theme-defining surface in the app: it would
    // have watched a CRT raster become a woven felt and reported no change.
    // Only pseudos that actually exist are recorded, which is what a set
    // \`content\` tells us.
    for (const pseudo of [null, '::before', '::after']) {
      const cs = getComputedStyle(el, pseudo);
      if (pseudo && (cs.content === 'none' || !cs.content)) continue;
      const rec = {};
      for (const p of PROPS) {
        const v = cs.getPropertyValue(p);
        if (!v || v === 'none' || v === 'auto') continue;
        // opacity is 1 on essentially every element, so recording it there says
        // nothing and buries the one place it matters (the texture overlay).
        if (p === 'opacity' && v === '1') continue;
        rec[p] = v.trim();
      }
      if (Object.keys(rec).length) out[key(el) + (pseudo ?? '')] = rec;
    }
  }
  return out;
})()`;

/**
 * One element per .gn-* class in the stylesheet, built from the class names
 * themselves so nothing has to be remembered by hand and a class added later
 * is covered the day it lands.
 *
 * The class names are BEM, which is what makes this automatic: `gn-cab__name`
 * belongs inside a `gn-cab`, and `gn-btn--go` is a `gn-btn`. Reconstructing
 * that gives each element the ancestors and the base class its rules were
 * written to sit on, so the value read back is the one the cascade actually
 * produces rather than the modifier's declarations in isolation.
 */
const COLLECT_FIXTURE = (props) => `(() => {
  const PROPS = ${JSON.stringify(props)};
  const names = new Set();
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules) walk(rule.cssRules);
      if (!rule.selectorText) continue;
      for (const m of rule.selectorText.matchAll(/\\.(gn-[a-zA-Z0-9_-]+)/g)) names.add(m[1]);
    }
  };
  for (const sheet of document.styleSheets) {
    try { if (sheet.cssRules) walk(sheet.cssRules); } catch { /* cross-origin */ }
  }

  const host = document.createElement('div');
  host.className = 'gn-app';
  document.body.appendChild(host);

  // Same baseline idea as the rule pass: an unclassed element of the same kind,
  // so properties nothing in the stylesheet ever sets (fill and stroke are SVG
  // defaults and appear on all 137 classes) do not pad every snapshot.
  const plain = document.createElement('button');
  host.appendChild(plain);
  const BASE = {};
  for (const p of PROPS) BASE[p] = getComputedStyle(plain).getPropertyValue(p).trim();
  plain.remove();

  const out = {};
  for (const cls of [...names].sort()) {
    // gn-block__el--mod  ->  block "gn-block", base class "gn-block__el"
    const base = cls.includes('--') ? cls.slice(0, cls.indexOf('--')) : null;
    const block = cls.includes('__') ? cls.slice(0, cls.indexOf('__')) : null;
    let mount = host;
    if (block) {
      const wrap = document.createElement('div');
      wrap.className = block;
      host.appendChild(wrap);
      mount = wrap;
    }
    const el = document.createElement('button');
    el.className = [base, cls].filter(Boolean).join(' ');
    el.textContent = 'x';
    mount.appendChild(el);
    const cs = getComputedStyle(el);
    const rec = {};
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p).trim();
      if (v && v !== 'none' && v !== 'auto' && v !== BASE[p]) rec[p] = v;
    }
    out[cls] = rec;
    if (mount !== host) mount.remove(); else el.remove();
  }
  host.remove();
  return out;
})()`;

/**
 * Every style rule in every same-origin stylesheet, resolved.
 *
 * THIS READS THE STYLESHEET AS TEXT AND DOES NOT TOUCH THE CSSOM, which looks
 * like the long way round and is not. The obvious implementation is to copy
 * `rule.style.cssText` onto a probe element and read the result back. It gives
 * the wrong answer here: Chromium re-serialises a declaration whose value
 * contains a var() by collapsing it to the bare reference, so
 *
 *     background: color-mix(in srgb, var(--gn-act) 10%, transparent)
 *
 * reads back out of the CSSOM as `background: var(--gn-act)`. The tint is
 * gone, and a sweep that replaces rgba() literals with color-mix() would
 * report a thousand differences that the browser is not actually painting.
 * That happened on the first run of this pass, and the only reason it was not
 * believed is that the two passes over real elements disagreed with it.
 *
 * Re-parsing the raw text sidesteps the round trip entirely: the declaration
 * block goes back to the browser as source, exactly as the file wrote it.
 *
 * IT ALSO HAS TO MODEL THE CASCADE, for the same reason. Tailwind v4 runs
 * Lightning CSS over this stylesheet, and Lightning splits every color-mix()
 * declaration in two: an opaque var() fallback, then the real value inside
 * `@supports (color:color-mix(in lab,red,red))`. Read one rule at a time and
 * you read the fallback and call it a regression. So rules are grouped by
 * selector and their bodies concatenated IN DOCUMENT ORDER, which is what the
 * cascade does at equal specificity, and an @supports or @media block is
 * entered only when the browser actually satisfies it.
 *
 * Rules are keyed by "sheet-name || selector", so adding a rule cannot shift
 * every later key and drown the diff.
 */
const COLLECT_RULES = (props) => `(async () => {
  const PROPS = ${JSON.stringify(props)};

  /** Split CSS source into { selector, body } style rules in document order,
      descending into at-rules THIS BROWSER SATISFIES and skipping the rest. */
  const split = (css, out = []) => {
    let i = 0;
    while (i < css.length) {
      const open = css.indexOf('{', i);
      if (open === -1) break;
      const selector = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      const body = css.slice(open + 1, j - 1);
      i = j;
      if (selector.startsWith('@')) {
        if (!body.includes('{')) continue;               // @font-face, @property
        const cond = selector.replace(/^@\\w+\\s*/, '').trim();
        if (/^@supports/.test(selector) && !CSS.supports(cond)) continue;
        if (/^@media/.test(selector) && !matchMedia(cond).matches) continue;
        split(body, out);
      } else if (selector) {
        out.push({ selector, body });
      }
    }
    return out;
  };

  // Collect the sheets first, because the probe needs an ancestor before it can
  // be measured and the ancestor is derived from what the sheets declare.
  const sheets = [];
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    try {
      sheets.push({
        name: link.href.split('/').pop().replace(/-[A-Za-z0-9_-]{8}\\.css$/, '.css'),
        css: await (await fetch(link.href)).text(),
      });
    } catch { /* cross-origin or gone */ }
  }

  // THE PROBE NEEDS THE PACK'S ANCESTRY OR ITS TOKENS DO NOT EXIST. A pack
  // declares --pp-* on .pp-root, not on :root, so a probe hanging off <html>
  // resolves every one of them to nothing and every pack rule reads as invalid
  // and disappears from the snapshot. That is the same descendant-scope trap
  // that ate --gn-btn-sh in stage 3, and here it would have silently emptied
  // the sweep of the entire file this session changed.
  //
  // A token block is recognised structurally rather than by a list of known
  // selectors: it is a rule whose declarations are ALL custom properties. Every
  // class named in one goes on a wrapper the probe sits inside. There is no
  // cross-pack collision to worry about because pack CSS rides a lazy chunk, so
  // the sheets loaded on a pack route are that pack's and the shell's.
  //
  // The tokens are copied onto the host as INLINE custom properties rather than
  // by giving it the pack's class. Wearing .pp-root would also make the host
  // match every .pp-root STYLE rule, so the probe would inherit the pack's own
  // colour and font, the baseline would shift under it, and real values would
  // be filtered out as "same as base". Inline properties inherit to the probe
  // while the host still matches no selector at all.
  const host = document.createElement('div');
  const themeMatches = (selector) => {
    const scoped = selector.match(/^\\s*(:root\\[[^\\]]*\\])/);
    return !scoped || document.documentElement.matches(scoped[1]);
  };
  for (const { css } of sheets) {
    for (const { selector, body } of split(css)) {
      // :root blocks already sit on the document and inherit for free; what the
      // probe cannot see without help is a block scoped to a pack's own root.
      if (!selector.includes('.') || !themeMatches(selector)) continue;
      const decls = body.split(';').map((d) => d.trim()).filter(Boolean);
      if (!decls.length || !decls.every((d) => d.startsWith('--'))) continue;
      for (const d of decls) {
        const at = d.indexOf(':');
        host.style.setProperty(d.slice(0, at).trim(), d.slice(at + 1).trim());
      }
    }
  }
  const probe = document.createElement('div');
  probe.id = 'gn-theme-probe';
  // READ THE PROBE AT REST. One probe is reused for every rule in the file and
  // the computed style is read IMMEDIATELY after the rule is swapped in, so a
  // rule that declares a transition on a tracked property (.gn-cab carries
  // a .12s box-shadow transition) is read mid-interpolation
  // and records the value it is coming FROM rather than the one it paints.
  //
  // WHICH MADE THE WHOLE PASS RULE-ORDER DEPENDENT, and that is the actual bug
  // rather than the wrong number: what a transitioned property starts from is
  // whatever the PREVIOUS rule left on the probe, so inserting any rule
  // anywhere in the file could change the recorded value of an unrelated
  // selector further down. Caught on 2026-08-26 by adding one rule after
  // .gn-card, which moved .gn-cab's box-shadow from its real two-layer bevel to
  // a pair of transparent zero-length layers: a difference in a selector that
  // session never touched, on a run that was otherwise clean.
  //
  // Inline, so it beats the #id rule the loop writes without needing
  // !important, and neither property is tracked, so suppressing them costs the
  // snapshot nothing.
  probe.style.transition = 'none';
  probe.style.animation = 'none';
  host.appendChild(probe);
  document.body.appendChild(host);
  const style = document.createElement('style');
  document.head.appendChild(style);

  // What the probe resolves to with NO rule applied. Every reading below is
  // recorded only if it differs from this. Without it, a rule that sets one
  // background contributes fifteen rows, fourteen of them the probe's own
  // inherited black, and the report is 90% noise that hides the finding.
  const BASE = {};
  for (const p of PROPS) BASE[p] = getComputedStyle(probe).getPropertyValue(p).trim();

  const out = {};
  for (const { name, css } of sheets) {
    const merged = new Map();
    for (const { selector, body } of split(css)) {
      merged.set(selector, (merged.get(selector) ?? []).concat(body));
    }
    for (const [selector, bodies] of merged) {
      // The token blocks declare custom properties and paint nothing. Probing
      // them records the probe's own inherited defaults, which is noise, and
      // the filter below matches them anyway once a token is called
      // --gn-shadow-depth.
      if (/^(:root|\\[data-theme)/.test(selector)) continue;
      // Only rules that speak to paint at all. Without this the snapshot fills
      // up with thousands of identical inherited defaults from layout rules,
      // and a real difference has somewhere to hide.
      if (!/(color|background|border|shadow|outline|fill|stroke|font|opacity|radius)/i.test(bodies.join(';'))) continue;
      // ONE RULE PER ORIGINAL RULE, not one merged block, and the difference is
      // not cosmetic. Lightning CSS emits a color-mix() twice, as an opaque
      // var() fallback and again inside @supports. Concatenated into a single
      // block, two \`background:\` shorthands that both contain a var() resolve
      // to transparent instead of to the second one, so every washed background
      // in the file read as "unthemed" while the real elements were painting it
      // correctly. Emitting separate rules lets the browser's own cascade pick
      // the winner, which is the thing being modelled in the first place.
      style.textContent = bodies.map((b) => '#gn-theme-probe{' + b + '}').join('');
      const cs = getComputedStyle(probe);
      const rec = {};
      for (const p of PROPS) {
        const v = cs.getPropertyValue(p).trim();
        if (v && v !== 'none' && v !== 'auto' && v !== BASE[p]) rec[p] = v;
      }
      if (!Object.keys(rec).length) continue;
      out[name + ' || ' + selector] = rec;
    }
  }
  style.remove();
  host.remove();
  return out;
})()`;

// ------------------------------------------------------------------ capture

async function capture(outFile, theme) {
  // A LEFTOVER PREVIEW SERVES A STALE BUNDLE AND THIS HARNESS CANNOT TELL.
  // `pnpm exec vite preview` is pnpm -> node -> vite, and killing the pnpm
  // process leaves the grandchild holding the port. The next run's own preview
  // then fails --strictPort, the readiness probe below finds :PORT answering
  // anyway, and the capture measures the PREVIOUS build while reporting
  // success. That produced a byte-identical before/after pair on 2026-08-09
  // and an "IDENTICAL. Nothing moved." on a run where every class name in the
  // pack had in fact been replaced, which is the most expensive kind of green.
  // So: refuse to start on an occupied port, and kill the whole process group
  // on the way out.
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      console.error(
        `something already serves :${PORT}. It would serve a STALE bundle and this run would ` +
          `report a false IDENTICAL. Kill it and re-run.`,
      );
      process.exit(2);
    }
  } catch {}

  console.log("building apps/web ...");
  await run("pnpm", ["--filter", "@gamenight/web", "build"], ROOT);

  console.log(`serving dist on :${PORT} ...`);
  const preview = spawn(
    "pnpm",
    ["--filter", "@gamenight/web", "exec", "vite", "preview", "--port", String(PORT), "--strictPort"],
    { cwd: ROOT, stdio: "ignore", detached: true },
  );
  const killPreview = () => {
    try { process.kill(-preview.pid, "SIGKILL"); } catch {}
    try { preview.kill("SIGKILL"); } catch {}
  };
  process.on("exit", killPreview);

  console.log("launching chromium ...");
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=1280,900",
      "--force-prefers-reduced-motion",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let cdp;
  try {
    await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${PORT}/`);
      return r.ok;
    }, "vite preview");

    // Talk to the tab's own debugger socket rather than the browser's. A
    // per-target connection needs no sessionId routing, which keeps this
    // client small enough to be obviously correct.
    const tab = await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (!r.ok) return null;
      return (await r.json()).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    }, "chromium");

    cdp = await connectCdp(tab.webSocketDebuggerUrl);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
    });

    // Stand in for the backend.
    cdp.on("Fetch.requestPaused", ({ requestId, request }) => {
      const pathname = new URL(request.url).pathname;
      const body = API_STUB[pathname];
      const status = body === undefined ? 404 : 200;
      const payload = body === undefined ? { error: "not found" } : body;
      cdp
        .send("Fetch.fulfillRequest", {
          requestId,
          responseCode: status,
          responseHeaders: [{ name: "content-type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(payload)).toString("base64"),
        })
        .catch(() => {
          /* navigated away mid-flight */
        });
    });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });

    // Pick the theme the way a phone does: write the preference and let the
    // app's own pre-paint script read it. Forcing data-theme onto <html> from
    // here would be one line shorter and would test the token block while
    // skipping the mechanism that delivers it, which is the half that broke
    // last time.
    if (theme) {
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `try{localStorage.setItem("gamenight.pref.theme",${JSON.stringify(theme)})}catch(e){}`,
      });
      console.log(`theme: ${theme}`);
    }

    const snapshot = { theme: theme ?? "default", routes: {}, fixture: {}, rules: {} };

    for (const route of ROUTES) {
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}${route}` });
      // Let the lazy chunk land, the fetches fail, and the error/empty state
      // settle. The app has no timers past this point on any route.
      await waitFor(
        () => evaluate(cdp, `document.readyState === 'complete' && !!document.querySelector('#root > *')`),
        `route ${route}`,
        40,
      ).catch(() => null);
      await sleep(600);
      if (AFTER_NAVIGATE[route]) {
        // Deliberately tolerant: a step that cannot find what it is looking for
        // leaves the route measured as it was rather than failing the run.
        await evaluate(cdp, AFTER_NAVIGATE[route]).catch(() => null);
      }
      snapshot.routes[route] = await evaluate(cdp, COLLECT_DOM(TRACKED_PROPS));
      process.stdout.write(`  ${route} (${Object.keys(snapshot.routes[route]).length} elements)\n`);
    }

    // The fixture pass runs on "/", where exactly the shell stylesheet is
    // loaded, because it builds one element per .gn-* class.
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
    await sleep(1200);
    snapshot.fixture = await evaluate(cdp, COLLECT_FIXTURE(TRACKED_PROPS));
    console.log(`  fixture: ${Object.keys(snapshot.fixture).length} classes`);

    // THE RULE PASS RUNS ON EVERY ROUTE THAT CARRIES A STYLESHEET, not just on
    // "/". It used to run on "/" alone, which was right while only index.css
    // was being themed and became quietly wrong the moment a PACK was: the pack
    // stylesheets ride lazy chunks, so on "/" they are not loaded and the pass
    // cannot see a single rule in them. The route pass does reach the pack
    // pages, but without a database it reaches their empty and error states, so
    // it renders four or five elements out of a 129-line stylesheet. Between
    // the two, "Arcade is identical" would have been true and nearly vacuous
    // for the file the session actually changed. Rules are keyed by sheet name,
    // so visiting several routes merges cleanly instead of colliding.
    for (const route of RULE_ROUTES) {
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}${route}` });
      await sleep(1400);
      Object.assign(snapshot.rules, await evaluate(cdp, COLLECT_RULES(TRACKED_PROPS)));
    }
    const sheets = new Set(Object.keys(snapshot.rules).map((k) => k.split(" || ")[0]));
    console.log(
      `  rules: ${Object.keys(snapshot.rules).length} declarations across ${sheets.size} stylesheets`,
    );

    writeFileSync(outFile, JSON.stringify(snapshot, null, 2));
    console.log(`wrote ${outFile}`);
  } finally {
    try { cdp?.close(); } catch { /* already gone */ }
    chrome.kill("SIGKILL");
    killPreview();
  }
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

// ---------------------------------------------------------------- comparison

/**
 * Normalise a colour-bearing value so two spellings of the same paint compare
 * equal. THIS IS THE PART THAT DECIDES WHETHER THE WHOLE SWEEP IS BELIEVABLE,
 * because a browser picks its serialisation from how a value was WRITTEN, not
 * from what it paints. Replacing rgba(255,90,95,.45) with an identical
 * color-mix() makes Chromium answer in oklab(), and the same pixels then look
 * like a thousand regressions. Every recognised space is converted to an
 * 8-bit rgba tuple; anything unrecognised is compared as text, so a format
 * this does not know about shows up as a difference rather than being waved
 * through.
 */
function normalise(value) {
  return value
    .replace(/color\(srgb ([^)]+)\)/g, (_, body) => {
      const { c, a } = channels(body);
      return rgbaText(c[0] * 255, c[1] * 255, c[2] * 255, a);
    })
    .replace(/oklab\(([^)]+)\)/g, (_, body) => {
      const { c, a } = channels(body);
      const [r, g, b] = oklabToSrgb(c[0], c[1], c[2]);
      return rgbaText(r, g, b, a);
    })
    .replace(/rgba?\(([^)]+)\)/g, (_, body) => {
      const { c, a } = channels(body);
      return rgbaText(c[0], c[1], c[2], a);
    });
}

/** "0.83 -0.004 -0.084 / 0.45" or "255, 90, 95, .45" -> channels + alpha. */
function channels(body) {
  const [head, tail] = body.split("/");
  const nums = head.trim().split(/[,\s]+/).map(Number);
  const a = tail !== undefined ? Number(tail) : nums.length > 3 ? nums[3] : 1;
  return { c: nums, a };
}

/** OKLab to sRGB, 0-255. The standard matrices; no clamping beyond the byte. */
function oklabToSrgb(L, A, B) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => {
    const enc = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, enc * 255));
  });
}

/**
 * Round to a whole 8-bit channel and 3 decimal places of alpha. A color-mix()
 * lands on 254.99999 where the literal said 255; that is a serialisation
 * artefact, not a colour change. Anything that differs by a whole channel is
 * still a difference and is still reported.
 */
function rgbaText(r, g, b, a) {
  const c = (n) => Math.round(n);
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${Number(a.toFixed(3))})`;
}

function compare(beforeFile, afterFile) {
  const before = JSON.parse(readFileSync(beforeFile, "utf8"));
  const after = JSON.parse(readFileSync(afterFile, "utf8"));
  const diffs = [];
  let compared = 0;

  for (const section of ["routes", "fixture", "rules"]) {
    const walkPairs = (b, a, trail) => {
      for (const key of new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])) {
        const bv = b?.[key];
        const av = a?.[key];
        if (typeof bv === "object" || typeof av === "object") {
          walkPairs(bv, av, [...trail, key]);
          continue;
        }
        compared++;
        if (bv === undefined) diffs.push({ where: [...trail, key].join(" | "), before: "(absent)", after: av });
        else if (av === undefined) diffs.push({ where: [...trail, key].join(" | "), before: bv, after: "(absent)" });
        else if (normalise(bv) !== normalise(av))
          diffs.push({ where: [...trail, key].join(" | "), before: bv, after: av });
      }
    };
    walkPairs(before[section], after[section], [section]);
  }

  console.log(`compared ${compared} resolved colour values`);
  if (!diffs.length) {
    console.log("IDENTICAL. Nothing moved.");
    return 0;
  }
  console.log(`${diffs.length} DIFFERENCES:\n`);
  for (const d of diffs) console.log(`  ${d.where}\n    before: ${d.before}\n    after:  ${d.after}\n`);
  return 1;
}

/**
 * The INVERSE report, and the one stage 2 needs. Comparing two THEMES, a value
 * that is identical in both is the suspicious one: either it does not depend on
 * the palette at all, or it is a colour that never got tokenised and is quietly
 * still Arcade under Tabletop. Nothing errors either way, which is why it needs
 * a report rather than a test.
 *
 * Values that cannot move are filtered out or they would bury the finding:
 * fully transparent paint, and the shadow/gradient entries whose colour parts
 * are transparent. What is left is bucketed by source, because the answer for
 * `index.css` ("a stage 1 miss, fix it now") is completely different from the
 * answer for a pack stylesheet ("stage 3, expected, leave it").
 */
/**
 * True if the value is worth reporting. A colour has to actually paint (a fully
 * transparent one cannot differ between themes in any way a person sees), but a
 * structural value (a radius, a font stack, an opacity) carries no colour at
 * all and is always worth reporting: since stage 3 those are exactly the values
 * a theme is expected to move.
 */
function visible(value) {
  const colours = normalise(value).match(/rgba\([^)]*\)/g);
  if (!colours) return true;
  return colours.some((c) => Number(c.slice(0, -1).split(",")[3]) > 0);
}

function same(aFile, bFile) {
  const a = JSON.parse(readFileSync(aFile, "utf8"));
  const b = JSON.parse(readFileSync(bFile, "utf8"));
  const buckets = new Map();
  let compared = 0;
  let moved = 0;

  const walk = (x, y, trail) => {
    for (const key of Object.keys(x ?? {})) {
      const xv = x[key];
      const yv = y?.[key];
      if (typeof xv === "object") {
        walk(xv, yv, [...trail, key]);
        continue;
      }
      if (yv === undefined) continue;
      compared++;
      if (normalise(xv) !== normalise(yv)) {
        moved++;
        continue;
      }
      // Nothing to theme: paint that is entirely invisible either way.
      if (!visible(xv)) continue;
      // The shell's own component layer is bucketed apart from everything else
      // in the same built file. index.css compiles to Tailwind's reset plus our
      // .gn-* rules, and only the second half is what stage 1 tokenised: a
      // Tailwind reset rule not following the theme is not a finding.
      let bucket = trail[0];
      if (trail[0] === "rules") {
        const key = String(trail[1]);
        const sheet = key.split(" || ")[0];
        bucket = sheet === "index.css" && /\.gn-|:where\(#root\)/.test(key) ? "index.css (shell)" : sheet;
      }
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push({ where: [...trail, key].join(" | "), value: xv });
    }
  };
  for (const section of ["routes", "fixture", "rules"]) walk(a[section], b[section], [section]);

  console.log(`compared ${compared} resolved colour values; ${moved} moved with the theme`);
  const total = [...buckets.values()].reduce((n, v) => n + v.length, 0);
  console.log(`${total} identical in both themes, by source:\n`);
  for (const [bucket, rows] of [...buckets].sort((p, q) => q[1].length - p[1].length)) {
    console.log(`  ${bucket}: ${rows.length}`);
  }
  // The shell's own rules are the ones a human has to read: an entry here is a
  // colour index.css failed to tokenise. Everything else is stage 3 by design.
  const shell = buckets.get("index.css (shell)") ?? [];
  if (shell.length) {
    console.log(`\nshell (.gn-*) entries that did not follow the theme (${shell.length}):\n`);
    for (const r of shell) console.log(`  ${r.where}\n    ${r.value}`);
  } else {
    console.log("\nshell (.gn-*): nothing stayed behind. Every shell colour followed the theme.");
  }
  return 0;
}

// --------------------------------------------------------------------- main

const argv = process.argv.slice(2);
const themeArg = argv.find((a) => a.startsWith("--theme="))?.slice("--theme=".length);
const positional = argv.filter((a) => !a.startsWith("--"));

if (argv.includes("--compare")) {
  process.exit(compare(positional[0], positional[1]));
} else if (argv.includes("--same")) {
  process.exit(same(positional[0], positional[1]));
} else if (positional[0]) {
  await capture(positional[0], themeArg);
} else {
  console.error(
    "usage:\n" +
      "  theme-sweep.mjs <out.json> [--theme=<name>]      capture\n" +
      "  theme-sweep.mjs --compare <a.json> <b.json>      what MOVED (stage 1's question)\n" +
      "  theme-sweep.mjs --same <a.json> <b.json>         what did NOT (stage 2's question)",
  );
  process.exit(2);
}

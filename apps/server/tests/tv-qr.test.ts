// THE ONE SLOT TWELVE TELEVISIONS SHARE, and the four things about it that a
// screenshot cannot tell you and the fit harness does not ask.
//
// tv-fit.mjs measures where the block LANDS: how tall the header row got, what
// it covers, whether anything is cut off. It cannot tell you that the code is
// big enough to scan, that its quiet zone is clear on every side, that the URL
// it carries is a page a signed-out phone can actually open, or that the white
// plate is white in both themes. Those four are the feature; the layout is only
// where it sits.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// liveUrl reads window.location.origin, which node has no opinion about. Set
// before the dynamic import rather than importing at the top, because a static
// import is hoisted above this line.
(globalThis as Record<string, unknown>).window = { location: { origin: "https://gamenightos.app" } };
// tsx compiles JSX to React.createElement (the classic runtime) rather than the
// automatic one Vite uses, so calling the component in node needs a React in
// scope. A createElement that just records what it was handed is enough and is
// better than pulling react in: this asks what the component PASSES DOWN, which
// is the whole question, and it cannot start depending on a real render.
(globalThis as Record<string, unknown>).React = {
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({
    type,
    props: { ...props, children },
  }),
};
const tvqr = () => import("../../web/src/TvQr.js");

const read = (rel: string) =>
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), rel), "utf8");
/** Source with comments stripped: these are rules about code, not about prose. */
const bare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const css = () => bare(read("../../web/src/index.css"));

// ---------- the code is big enough to scan ----------

test("NO LADDER CAN ASK FOR A CODE BELOW THE FLOOR", async () => {
  const { TV_QR_MIN, default: TvQr } = await tvqr();
  assert.equal(typeof TV_QR_MIN, "number");
  // The clamp, not the constant, is what protects this: a pack computes its
  // size from a density band, and a band that gets denser later is exactly how
  // a screen quietly ends up with a code nobody can scan from the sofa. Read
  // off the rendered element rather than trusting the source to still say
  // Math.max next year.
  const el = TvQr({ eventId: "e1", size: 12 }) as { props: { children: unknown[] } };
  const code = el.props.children.find(
    (c): c is { props: { size: number } } =>
      !!c && typeof c === "object" && "props" in c && typeof (c as { props: { size?: unknown } }).props.size === "number",
  );
  assert.ok(code, "the block no longer renders a child with a size");
  assert.equal(code.props.size, TV_QR_MIN, "a size under the floor was passed straight through");
});

test("THE FLOOR IS NOT ABOVE WHAT THE TWO SHIPPED LADDERS ALREADY PAY", async () => {
  const { TV_QR_MIN } = await tvqr();
  const { ETV_QR } = await import("../../web/src/pages/event-tv-band.js");
  const { BEERIO_QR_PX } = await import("../../web/src/beerio/band.js");
  // A floor above the smallest code already on a television would mean this
  // session picked a number the app itself has been contradicting in production.
  const shipped = Math.min(...Object.values(ETV_QR), ...Object.values(BEERIO_QR_PX));
  assert.ok(
    TV_QR_MIN <= shipped,
    `TV_QR_MIN is ${TV_QR_MIN} but a code as small as ${shipped} is already shipping`,
  );
});

// ---------- the quiet zone ----------

test("THE QUIET ZONE IS THE SAME ON EVERY SIDE OF THE CODE", () => {
  const rule = css().slice(css().indexOf(".gn-tvqr{"), css().indexOf(".gn-tvqr__cap"));
  const pad = rule.match(/padding:\s*([\d.]+)vmin/);
  const gap = rule.match(/gap:\s*([\d.]+)vmin/);
  assert.ok(pad && gap, ".gn-tvqr no longer sets both padding and gap in vmin");
  // Three sides of the code are cleared by the plate's padding and the fourth
  // by the gap to the caption, so the two are one measurement wearing two
  // property names. A caption nudged closer is a quiet zone eaten on one side
  // only, which is the side a camera happens to be reading from.
  assert.equal(
    gap[1],
    pad[1],
    `the caption sits ${gap[1]}vmin from the code while the plate clears ${pad[1]}vmin`,
  );
  // Four modules is what the spec asks for. At the 88px floor this renders 25
  // modules, so a module is 3.52px and four of them are 14.1px, which is
  // 1.31vmin at 1080. Anything under that is short on the one part of this that
  // either works or does not.
  assert.ok(
    parseFloat(pad[1]!) >= 1.31,
    `${pad[1]}vmin is under four modules of quiet zone at the 88px floor`,
  );
});

// ---------- the URL is a page a signed-out phone can open ----------

test("THE CODE POINTS AT THE PUBLIC PAGE, NOT THE AUTHED EVENT SCREEN", async () => {
  const { liveUrl } = await tvqr();
  const url = liveUrl("abc123");
  // /e/:id is behind the authed router. A television in a room full of guests
  // pointing at it means every phone that scans lands on a sign-in wall, which
  // looks exactly like the feature working right up until somebody tries it.
  assert.equal(url, "https://gamenightos.app/e/abc123/live");
  assert.match(url, /\/live$/, "the code no longer points at the live page");
});

// ---------- the plate is functional, so it is not themed ----------

test("THE PLATE AND THE INK ARE THE SAME IN BOTH THEMES", () => {
  const sheet = css();
  const values = (name: string) => [...sheet.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g"))].map((m) => m[1]!.trim());
  for (const token of ["--gn-qr-plate", "--gn-qr-ink"]) {
    const found = values(token);
    // Defined twice on purpose: once per theme block, identically, so the theme
    // sweep MEASURES the exemption instead of being blind to it. One definition
    // would pass the sweep by not existing in the place it looks.
    assert.equal(found.length, 2, `${token} is defined ${found.length} times, expected once per theme`);
    assert.equal(found[0], found[1], `${token} differs by theme: a camera does not change with the furniture`);
  }
});

test("THE COMPONENT SPENDS THE TOKENS RATHER THAN RESTATING THE HEX", () => {
  const src = bare(read("../../web/src/TvQr.tsx"));
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, "a colour literal is back in TvQr.tsx");
  assert.match(src, /var\(--gn-qr-ink\)/);
  assert.match(src, /var\(--gn-qr-plate\)/);
});

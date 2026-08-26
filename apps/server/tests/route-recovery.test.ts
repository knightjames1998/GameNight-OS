// THE BOUNDARY'S ONE SELF-RECOVERY, and the reason it is exactly one.
//
// WHAT WAS WRONG. The route boundary catches anything a route throws while
// RENDERING, not only a chunk that failed to arrive, and every cached screen in
// this app paints from localStorage before it fetches anything (cache.ts hands
// back a stored payload synchronously so the first paint is not a spinner). So
// a malformed cached payload throws during the FIRST render, ahead of the
// revalidation that would have replaced it, and the boundary's Reload button
// re-ran that same first render off that same entry. The screen said reloading
// fixes it. For that one cause it did not: the app stayed dead until a deploy
// changed the cache namespace. Reported 2026-08-26 as "it keeps crashing".
//
// WHY THE BOUND IS THE HALF WORTH TESTING. A boundary that reloads itself
// without a claim it can run out of is a reload loop, which is strictly worse
// than the screen it was trying to replace: the reader cannot even read the
// error, and on a phone it burns battery in the middle of a game night. The
// claim is therefore taken BEFORE the reload, and a sessionStorage that cannot
// record it means NO automatic reload rather than an unlimited one.
//
// Source assertions, the same split live-status.test.ts uses for the socket
// half: the mechanism is a browser one, so its behaviour was verified on-device
// against the real built bundle (a poisoned cache clears itself in one extra
// page load; an unrenderable payload stops after that one and shows the second
// screen). What a test can hold still is that the pieces are still wired the
// way that run proved out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const boundary = () => read("../../web/src/RouteBoundary.tsx");

// ---------- it recovers ----------

test("A FAILURE DROPS THE CACHE, because that is the cause a reload cannot fix", () => {
  const src = boundary();
  assert.match(src, /import \{ dropAll \} from "\.\/cache";/);
  assert.match(src, /dropAll\(\);\s*\n\s*window\.location\.reload\(\);/, "the drop must come with the reload");
});

test("the recovery runs from componentDidCatch, not from render", () => {
  // getDerivedStateFromError runs DURING render, where a side effect is not
  // allowed to happen and a reload would fire mid-commit.
  const src = boundary();
  const caught = src.slice(src.indexOf("componentDidCatch"), src.indexOf("render()"));
  assert.match(caught, /dropAll\(\)/, "the recovery is not in componentDidCatch");
  const derived = src.slice(src.indexOf("getDerivedStateFromError"), src.indexOf("componentDidCatch"));
  assert.doesNotMatch(derived, /dropAll|reload/, "a side effect has moved into the render path");
});

// ---------- and it is bounded ----------

test("THE RECOVERY IS CLAIMED BEFORE IT IS USED, which is what bounds it", () => {
  // Ordering, not decoration: a reload that fires before the claim is written
  // never records that it happened, so every load reloads again forever.
  const src = boundary();
  const claim = src.slice(src.indexOf("function claimRecovery"), src.indexOf("function recoverySpent"));
  const set = claim.indexOf("sessionStorage.setItem");
  const ret = claim.indexOf("return true");
  assert.ok(set > 0 && ret > set, "claimRecovery must write its claim before it returns true");
  assert.match(src, /if \(claimRecovery\(\)\) \{/, "the recovery must be gated on the claim");
});

test("A SESSIONSTORAGE THAT CANNOT RECORD THE CLAIM GETS NO RELOAD AT ALL", () => {
  // Private mode, and the direction of the failure is the whole point: a
  // recovery nothing can count is a loop, so an unusable store means the
  // screen, not an unlimited retry.
  const src = boundary();
  const claim = src.slice(src.indexOf("function claimRecovery"), src.indexOf("function recoverySpent"));
  const failurePath = claim.slice(claim.indexOf("} catch {"));
  assert.match(failurePath, /return false;/, "a failed claim must refuse the recovery");
  assert.doesNotMatch(failurePath, /return true;/, "the claim is granting itself a recovery it cannot count");
});

test("there is exactly ONE automatic reload in the file", () => {
  // The two others are buttons a person presses. An automatic one that got
  // duplicated is the loop arriving by a different door.
  const src = boundary();
  const auto = src.slice(src.indexOf("componentDidCatch"), src.indexOf("render()"));
  assert.equal(auto.match(/window\.location\.reload\(\)/g)?.length, 1);
});

// ---------- and it stops promising what it already tried ----------

test("THE SECOND SCREEN DOES NOT REPEAT THE PROMISE THAT JUST FAILED", () => {
  // The copy is the part that was actually wrong. "Reloading fixes both" was
  // said to a host who had reloaded four times.
  const src = boundary();
  const cleared = src.slice(src.indexOf("this.state.cleared ? ("), src.indexOf(") : ("));
  assert.doesNotMatch(cleared, /Reloading fixes/);
  assert.match(cleared, /cleared what it had saved and reloaded once/);
  // A way out of one dead route, because by this point reloading has visibly
  // not worked and a host needs a door rather than the same handle again.
  assert.match(cleared, /window\.location\.assign\("\/"\)/);
});

test("the first screen keeps the copy it always had", () => {
  // It is still right for the two causes it was written for, and this branch is
  // the one nobody normally sees now: the recovery fires from under it.
  const src = boundary();
  assert.match(src, /Usually the connection dropped, or the app updated while this tab was open\./);
});

// ---------- the control ----------

test("CACHED DATA REALLY IS READ DURING THE FIRST RENDER, which is why any of this is needed", () => {
  // Without this line the crash would land after a fetch, the boundary would be
  // clearable by a reload, and everything above would be guarding nothing.
  const cache = read("../../web/src/cache.ts");
  assert.match(
    cache,
    /useState<T \| undefined>\(\(\) => \(key \? readCache<T>\(key\) : undefined\)\)/,
    "useCachedApi no longer seeds its state from the cache during render",
  );
});

function read(rel: string): string {
  return readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), rel), "utf8");
}

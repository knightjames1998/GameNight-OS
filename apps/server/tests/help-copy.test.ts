// THE GUIDE'S CONTENT RULE, ASSERTED RATHER THAN ASKED FOR.
//
// NO PACK NAMES AND NO COUNTS. The reason is not style: every pack name and
// every number in a guide is a thing that must be edited on the next pack ship,
// and it WILL NOT BE. Then the guide is quietly wrong, and it is wrong to the
// one person who opened it because they were already confused. A comment asking
// a future session not to do that is a comment a future session will write past;
// this file is what actually stops it.
//
// THE PACK NAMES COME FROM THE REGISTRY, not from a list typed in here, so a
// pack added next month is covered by this test the day it is added rather than
// the day somebody remembers to update it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SESSION_PACKS, SESSION_PACK_KEYS } from "@gamenight/shared";

const body = () =>
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../web/src/HelpBody.tsx"),
    "utf8",
  );

/** The prose only: a rule about what the guide SAYS, not about its comments. */
const prose = () =>
  body()
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");

test("NO PACK IS NAMED IN THE GUIDE, and the list comes from the registry", () => {
  const text = prose();
  const named = SESSION_PACK_KEYS.map((k) => SESSION_PACKS[k].name).filter((n) =>
    new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text),
  );
  assert.deepEqual(
    named,
    [],
    `the guide names ${named.join(", ")}. Describe the picker instead: it is always right ` +
      "and this file cannot be.",
  );
  // The two that are not session packs and so are not in that loop.
  for (const extra of ["Beerio", "Tournament"]) {
    assert.doesNotMatch(text, new RegExp(`\\b${extra}\\b`, "i"), `the guide names ${extra}`);
  }
});

test("NO COUNT IS GIVEN, in digits or in words", () => {
  // "fourteen packs" and "14 packs" are the same lie with different spelling,
  // and the second is the one a scan for digits alone would miss.
  const text = prose();
  const words =
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|dozens?)\s+(of\s+)?(packs?|games?|modes?|formats?|screens?|views?)\b/i;
  assert.doesNotMatch(text, words, "the guide counts something that will change");
  assert.doesNotMatch(
    text,
    /\b\d+\s*(\+\s*)?(packs?|games?|modes?|formats?|screens?|views?)\b/i,
    "the guide counts something that will change",
  );
});

test("THE SCANS HAVE SOMETHING TO FIND, or they pass forever against nothing", () => {
  // The control every source scan in this repo carries. Three of these assert by
  // finding NOTHING, which is exactly the shape that keeps passing after the
  // file it points at has been renamed or emptied.
  const text = prose();
  assert.ok(text.length > 800, "the guide got much shorter, or the prose filter ate it");
  assert.ok(SESSION_PACK_KEYS.length > 5, "the registry is the source of the names above");
  // And the filter really does strip comments, or the rule above would fail on
  // this file's own header, which names packs in order to forbid them.
  assert.match(body(), /Smash, Mario Kart and\s*\n\/\/ Blackjack/, "the header names them");
  assert.doesNotMatch(text, /Blackjack/, "and the prose filter removes that from the scan");
});

test("the five sections are all there, in the order somebody meets them", () => {
  const text = prose();
  const order = ["Crews", "Game nights", "Playing a game", "The TV view", "Stats"];
  let at = -1;
  for (const heading of order) {
    const next = text.indexOf(`>${heading}<`);
    assert.ok(next > at, `${heading} is missing or out of order`);
    at = next;
  }
});

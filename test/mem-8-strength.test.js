import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DUST_PERIODS,
  STRENGTH_WEIGHTS,
  ageLabel,
  createOpenStore,
  dustAge,
  dusty,
  edgeOpens,
  explain,
  strengthScore,
  strokeFor,
} from "../src/model/strength.js";
import { applyDust, applyStrength, clearLens } from "../src/view/strength-lens.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const DAY = 86400000;
const NOW = new Date(2026, 9, 6, 12).getTime();

test("MEM-8: the score is the documented refs, shared, and recency weights", () => {
  assert.equal(STRENGTH_WEIGHTS.refs + STRENGTH_WEIGHTS.shared + STRENGTH_WEIGHTS.recency, 1);
  assert.equal(strengthScore({ refs: 12, now: NOW }, { now: NOW }), 0.6);
  assert.equal(strengthScore({ shared: 3, now: NOW }, { now: NOW }), 0.25);
  assert.equal(strengthScore({ editTime: NOW, now: NOW }, { now: NOW }), 0.15);
  assert.equal(strengthScore({ refs: 0, shared: 0, opens: 40, now: NOW }, { now: NOW, trackOpens: false }), 0);
  const half = strengthScore({ editTime: NOW - 180 * DAY, now: NOW }, { now: NOW });
  assert.ok(Math.abs(half - 0.075) < 1e-9, String(half));
  const tracked = strengthScore({ opens: 10, now: NOW }, { now: NOW, trackOpens: true });
  assert.equal(tracked, 0.15);
  assert.deepEqual(strokeFor(0), { width: 1, opacity: 0.5 });
  assert.deepEqual(strokeFor(1), { width: 4, opacity: 1 });
  assert.equal(strokeFor(0.6).width, 3);
  assert.equal(strokeFor(4).width, 4);
  assert.equal(strokeFor(-1).width, 1);
});

test("MEM-8: explain names the three components", () => {
  const components = { refs: 12, shared: 2, editTime: NOW - 90 * DAY, now: NOW };
  assert.equal(explain(components), "12 refs, 2 shared boards, edited 3 months ago");
  assert.equal(explain({ refs: 1, shared: 1, editTime: NOW - DAY, now: NOW }), "1 ref, 1 shared board, edited 1 day ago");
  assert.equal(explain({ now: NOW }), "0 refs, 0 shared boards, not edited");
  assert.equal(ageLabel(200 * DAY), "7 months");
});

test("MEM-8: dust thresholds are 6 months, 1 year, and 2 years", () => {
  assert.equal(DUST_PERIODS["6 months"], 180 * DAY);
  assert.equal(DUST_PERIODS["1 year"], 365 * DAY);
  assert.equal(DUST_PERIODS["2 years"], 730 * DAY);
  const recent = { editTime: NOW - 2 * DAY, createTime: NOW - 800 * DAY, now: NOW };
  const quiet = { editTime: NOW - 200 * DAY, createTime: NOW - 800 * DAY, now: NOW };
  const yearOld = { editTime: NOW - 400 * DAY, now: NOW };
  const ancient = { editTime: NOW - 800 * DAY, now: NOW };
  assert.equal(dusty(recent, "6 months"), false);
  assert.equal(dusty(quiet, "6m"), true);
  assert.equal(dusty({ editTime: NOW - 179 * DAY, now: NOW }, "6 months"), false);
  assert.equal(dusty({ editTime: NOW - 180 * DAY, now: NOW }, "6 months"), true);
  assert.equal(dusty(yearOld, "1 year"), true);
  assert.equal(dusty(yearOld, "2 years"), false);
  assert.equal(dusty(ancient, "2y"), true);
  assert.equal(dusty({ now: NOW }, "6 months"), false);
  assert.equal(dusty(ancient, "nope"), false);
  assert.equal(dustAge(NOW - 800 * DAY, NOW - DAY, NOW), DAY);
  assert.equal(dustAge(null, null, NOW), null);
});

test("MEM-8: opened counts stay off until track-opens is on, and the key is the graph", () => {
  const writes = [];
  const storage = {
    getItem() { return null; },
    setItem(key, value) { writes.push([key, value]); },
  };
  const off = createOpenStore({ storage, graph: "notes" });
  assert.equal(off.enabled, false);
  assert.equal(off.bump("card"), 0);
  assert.deepEqual(writes, []);
  off.setEnabled(true);
  assert.equal(off.bump("card"), 1);
  assert.equal(writes[0][0], "plexus-diagram:opens:notes");
  const box = new Map();
  const memory = {
    getItem(key) { return box.has(key) ? box.get(key) : null; },
    setItem(key, value) { box.set(key, String(value)); },
  };
  const notes = createOpenStore({ storage: memory, graph: "notes", enabled: true });
  const svy = createOpenStore({ storage: memory, graph: "svy", enabled: true });
  assert.equal(notes.bump("card"), 1);
  assert.equal(notes.bump("card"), 2);
  assert.equal(svy.get("card"), 0);
  notes.setEnabled(false);
  assert.equal(notes.bump("card"), 2);
  assert.equal(edgeOpens(notes, "card", "other"), 2);
});

test("MEM-8: strength draws a heavy pair wider than a bare pair, and clear puts the stroke back", () => {
  const stub = createDomStub();
  const heavy = stub.document.createElement("g");
  heavy.setAttribute("data-uid", "heavy");
  const heavyLine = stub.document.createElement("path");
  heavyLine.className = "pxd-edge__line";
  heavyLine.style.strokeWidth = "2px";
  heavy.append(heavyLine);
  const bare = stub.document.createElement("g");
  bare.setAttribute("data-uid", "bare");
  const bareLine = stub.document.createElement("path");
  bareLine.className = "pxd-edge__line";
  bareLine.style.strokeWidth = "2px";
  bare.append(bareLine);
  const heavyParts = { refs: 12, shared: 2, editTime: NOW, now: NOW };
  const bareParts = { refs: 0, shared: 0, now: NOW };
  applyStrength([heavy, bare], new Map([
    ["heavy", heavyParts],
    ["bare", bareParts],
  ]));
  assert.ok(parseFloat(heavyLine.style.strokeWidth) >= 3, heavyLine.style.strokeWidth);
  assert.equal(parseFloat(bareLine.style.strokeWidth), 1);
  assert.ok(parseFloat(heavyLine.style.strokeOpacity) > 0.5);
  assert.equal(parseFloat(bareLine.style.strokeOpacity), 0.5);
  assert.equal(heavy.getAttribute("title"), `${explain(heavyParts)} Heuristic.`);
  assert.equal(heavy.listeners.get("click"), undefined);
  assert.equal(bare.listeners.get("click"), undefined);
  clearLens([heavy, bare]);
  assert.equal(heavyLine.style.strokeWidth, "2px");
  assert.equal(heavyLine.style.strokeOpacity, "");
  assert.equal(heavy.getAttribute("title"), null);
  assert.equal(bareLine.style.strokeWidth, "2px");
});

test("MEM-8: dust dims an untouched card, leaves a recent one, and clear restores it", () => {
  const stub = createDomStub();
  const oldCard = stub.document.createElement("div");
  oldCard.className = "pxd-item";
  oldCard.setAttribute("data-uid", "old");
  oldCard.setAttribute("title", "Keep me");
  const fresh = stub.document.createElement("div");
  fresh.className = "pxd-item";
  fresh.setAttribute("data-uid", "fresh");
  const ages = new Map([
    ["old", { editTime: NOW - 200 * DAY, createTime: NOW - 800 * DAY, now: NOW }],
    ["fresh", { editTime: NOW - 2 * DAY, createTime: NOW - 800 * DAY, now: NOW }],
  ]);
  applyDust([oldCard, fresh], ages, "6 months");
  assert.equal(oldCard.classList.contains("pxd-item--dust"), true);
  assert.equal(oldCard.getAttribute("data-dust-age"), "7 months");
  assert.match(oldCard.getAttribute("title"), /7 months/);
  assert.match(oldCard.getAttribute("title"), /Heuristic/);
  assert.equal(fresh.classList.contains("pxd-item--dust"), false);
  assert.equal(fresh.getAttribute("data-dust-age"), null);
  assert.equal(oldCard.listeners.get("click"), undefined);
  const css = readFileSync(new URL("../src/css/strength.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-item--dust/);
  assert.match(css, /opacity:\s*0\.35/);
  assert.match(css, /grayscale\(1\)/);
  clearLens({ cards: [oldCard, fresh] });
  assert.equal(oldCard.classList.contains("pxd-item--dust"), false);
  assert.equal(oldCard.getAttribute("data-dust-age"), null);
  assert.equal(oldCard.getAttribute("title"), "Keep me");
  applyDust([oldCard], new Map([["old", 200 * DAY]]), "6 months");
  assert.equal(oldCard.classList.contains("pxd-item--dust"), true);
  applyDust([oldCard], new Map([["old", 200 * DAY]]), "nope");
  assert.equal(oldCard.classList.contains("pxd-item--dust"), false);
});

test("MEM-8: an SVG tip with read-only className does not stop the next edge painting", () => {
  const svgTitle = () => {
    const attrs = new Map();
    const node = { textContent: "", classList: {}, setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => attrs.get(k) ?? null };
    Object.defineProperty(node, "className", { get: () => ({ baseVal: attrs.get("class") || "" }) });
    return node;
  };
  const doc = { createElement: svgTitle, createElementNS: () => svgTitle() };
  const edge = (uid) => {
    const attrs = new Map([["data-uid", uid]]);
    const kids = [];
    const line = { style: {}, setAttribute() {}, hasAttribute: () => false };
    const g = {
      ownerDocument: doc,
      style: {},
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      hasAttribute: (k) => attrs.has(k),
      querySelector: (sel) => (sel === ".pxd-edge__line" ? line : kids.find((k) => k.getAttribute("class") === sel.slice(1)) || null),
      append: (n) => kids.push(n),
    };
    return { g, line };
  };
  const a = edge("a");
  const b = edge("b");
  applyStrength([a.g, b.g], new Map([
    ["a", { refs: 12, shared: 2, editTime: NOW, now: NOW }],
    ["b", { refs: 0, shared: 0, now: NOW }],
  ]));
  assert.equal(parseFloat(b.line.style.strokeWidth), 1);
  assert.ok(b.g.getAttribute("title"));
});

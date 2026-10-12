// Parse motion: pure progress/count/box maths, the motion surface, the card relay, and the parse view's events.
import assert from "node:assert/strict";
import test from "node:test";

import {
  MOTION_TIMING,
  beamPlan,
  countLabel,
  createParseMotion,
  createThrottle,
  docCounts,
  motionMode,
  overallFraction,
  pageSweepMs,
  partBoxes,
  partCounts,
  partKind,
  prefersReducedMotion,
  ringOffset,
} from "../src/view/parse-motion.js";
import { createCardMotionRelay } from "../src/view/card-parse-motion.js";
import { createParseView } from "../src/view/parse-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("part kinds and counts: tables, figures, formulas; every text kind is a paragraph", () => {
  assert.equal(partKind("table"), "table");
  assert.equal(partKind("image"), "figure");
  assert.equal(partKind("equation"), "formula");
  assert.equal(partKind("heading"), "heading");
  assert.equal(partKind("caption"), "caption");
  assert.equal(partKind("para"), "text");
  assert.equal(partKind(undefined), "text");
  const counts = partCounts([{ type: "table" }, { type: "para" }, { type: "heading" }, { type: "list" }, { type: "figure" }, { type: "formula" }, null]);
  assert.deepEqual(counts, { tables: 1, paragraphs: 3, figures: 1, formulas: 1 });
  const doc = { order: ["a", "b", "x"], blocks: { a: { type: "table" }, b: { type: "para" } } };
  assert.deepEqual(docCounts(doc), { tables: 1, paragraphs: 1, figures: 0, formulas: 0 });
});

test("count label: plural words, zero kinds left out, time with one decimal", () => {
  assert.equal(countLabel({ tables: 3, paragraphs: 18, figures: 2 }), "3 tables · 18 paragraphs · 2 figures");
  assert.equal(countLabel({ tables: 1, paragraphs: 1, figures: 0, formulas: 1 }), "1 table · 1 paragraph · 1 formula");
  assert.equal(countLabel({ tables: 3, paragraphs: 18, figures: 2 }, 4210), "3 tables · 18 paragraphs · 2 figures · 4.2 s");
  assert.equal(countLabel({}), "Reading…");
  assert.equal(countLabel({}, 900), "No parts found · 0.9 s");
});

test("progress → fraction, ring offset and beam plan", () => {
  assert.equal(overallFraction({ fraction: 0.25 }), 0.25);
  assert.equal(overallFraction({ fraction: 7 }), 1);
  assert.equal(overallFraction({ page: 3, pageCount: 12 }), 0.25);
  assert.equal(overallFraction({}), null);
  assert.equal(ringOffset(0), 100);
  assert.equal(ringOffset(0.42), 58);
  assert.equal(ringOffset(1), 0);
  assert.equal(ringOffset(null), 75, "unknown progress is a quarter arc");
  assert.deepEqual(beamPlan({ page: 2, pageCount: 5 }, 1), { kind: "page", restart: true });
  assert.deepEqual(beamPlan({ page: 2, pageCount: 5 }, 2), { kind: "page", restart: false });
  assert.deepEqual(beamPlan({ page: 1, pageCount: 1, fraction: 0.5 }, 0), { kind: "fraction", y: 0.5 });
  assert.deepEqual(beamPlan({ fraction: 0.3 }), { kind: "fraction", y: 0.3 });
  assert.deepEqual(beamPlan({}), { kind: "loop" });
  assert.equal(pageSweepMs([]), MOTION_TIMING.pageMs);
  assert.equal(pageSweepMs([100, 200, 300, 900]), Math.round((200 + 300 + 900) / 3));
  assert.equal(pageSweepMs([10]), MOTION_TIMING.minPageMs);
  assert.equal(pageSweepMs([99999]), MOTION_TIMING.maxPageMs);
});

test("part boxes: page percent geometry, stagger delays, fade past the cap", () => {
  const page = { w: 100, h: 200, rotation: 0 };
  const blocks = [
    { id: "t", type: "table", bbox: [10, 20, 60, 70] },
    { id: "bad", type: "para" },
    { id: "z", type: "para", bbox: [0, 0, 0, 10] },
    { id: "f", type: "figure", bbox: [0, 100, 50, 200] },
    { id: "p", type: "para", bbox: [0, 0, 100, 10] },
  ];
  const boxes = partBoxes(blocks, page, { cap: 2, staggerMs: 25 });
  assert.deepEqual(boxes.map((b) => b.id), ["t", "f", "p"]);
  assert.deepEqual(boxes[0], { id: "t", kind: "table", left: 10, top: 10, width: 50, height: 25, draw: true, delay: 0 });
  assert.equal(boxes[1].kind, "figure");
  assert.equal(boxes[1].delay, 25);
  assert.equal(boxes[2].draw, false, "past the cap fades in together");
  assert.equal(boxes[2].delay, 0);
});

test("reduced motion and visibility switch the mode", () => {
  assert.equal(motionMode({}), "full");
  assert.equal(motionMode({ reduced: true }), "quiet");
  assert.equal(motionMode({ visible: false }), "off");
  assert.equal(motionMode({ lod: "map" }), "off");
  assert.equal(motionMode({ lod: "detail", reduced: true }), "quiet");
  assert.equal(prefersReducedMotion({ matchMedia: (q) => ({ matches: q.includes("reduce") }) }), true);
  assert.equal(prefersReducedMotion({}), false);
  assert.equal(prefersReducedMotion(null), false);
});

test("count throttle: at most one paint per window, the last value lands", () => {
  let t = 0;
  const timers = [];
  const painted = [];
  const th = createThrottle({
    minMs: 150,
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h; },
    clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    paint: (v) => painted.push(v),
  });
  th.push("a");
  assert.deepEqual(painted, ["a"]);
  t = 50;
  th.push("b");
  th.push("c");
  assert.deepEqual(painted, ["a"], "inside the window nothing paints");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 100);
  t = 150;
  timers.shift().fn();
  assert.deepEqual(painted, ["a", "c"]);
  t = 400;
  th.push("d");
  assert.deepEqual(painted, ["a", "c", "d"]);
  th.push("e");
  th.cancel();
  assert.equal(timers.length, 0);
  th.flush();
  assert.deepEqual(painted, ["a", "c", "d"], "a cancelled value never paints");
});

function surfaceRig({ mode = "full" } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const page = doc.createElement("div");
  page.className = "page";
  const head = doc.createElement("div");
  doc.body.append(page, head);
  let clock = 1000;
  let currentMode = mode;
  const m = createParseMotion({ doc, overlayHost: page, overlayPage: 1, headHost: head, mode: () => currentMode, now: () => clock });
  return { stub, restore, doc, page, head, m, tick: (ms) => { clock += ms; }, setMode: (v) => { currentMode = v; } };
}

test("motion surface: start, beam sweep per page, parts draw in, done summary, then nothing left", () => {
  const h = surfaceRig();
  try {
    assert.equal(h.page.querySelectorAll(".pxd-pmotion").length, 0, "no nodes before a parse");
    h.m.start();
    const overlay = h.page.querySelector(".pxd-pmotion");
    const head = h.head.querySelector(".pxd-pmotion-head");
    assert.ok(overlay && head);
    assert.equal(overlay.style.pointerEvents, "none");
    assert.equal(head.querySelector(".pxd-pmotion-head__text").textContent, "Reading…");
    h.m.progress({ page: 1, pageCount: 3, fraction: 0 });
    const carrier = overlay.querySelector(".pxd-pmotion__carrier");
    assert.equal(carrier.style.transform, "translateY(0%)");
    h.stub.flushFrames();
    h.stub.flushFrames();
    assert.equal(carrier.style.transform, "translateY(100%)", "one sweep per page");
    assert.match(carrier.style.transition, /^transform \d+ms linear$/);
    const boxes = partBoxes([{ id: "t", type: "table", bbox: [0, 0, 50, 50] }, { id: "p", type: "para", bbox: [0, 60, 50, 80] }], { w: 100, h: 100 });
    h.m.parts(1, boxes);
    h.m.parts(2, boxes);
    const rects = overlay.querySelectorAll(".pxd-pmotion__part");
    assert.equal(rects.length, 2, "parts of another page are not drawn here");
    assert.ok(rects[0].classList.contains("pxd-pmotion__part--table"));
    assert.equal(rects[1].style.transitionDelay, "25ms");
    assert.equal(rects[0].classList.contains("pxd-pmotion__part--in"), false);
    h.stub.flushFrames();
    h.stub.flushFrames();
    assert.ok(rects.every((r) => r.classList.contains("pxd-pmotion__part--in")), "stroke draws in on the next frames");
    h.tick(800);
    h.m.progress({ page: 2, pageCount: 3, fraction: 1 / 3, counts: { tables: 1, paragraphs: 1 } });
    const fill = head.querySelector(".pxd-pmotion-head__fill");
    assert.equal(fill.style.strokeDashoffset, String(ringOffset(1 / 3)));
    assert.equal(head.querySelector(".pxd-pmotion-head__text").textContent, "1 table · 1 paragraph");
    h.m.done({ counts: { tables: 3, paragraphs: 18, figures: 2 }, ms: 4200, boxes });
    assert.ok(overlay.classList.contains("pxd-pmotion--done"));
    assert.equal(head.querySelector(".pxd-pmotion-head__text").textContent, "3 tables · 18 paragraphs · 2 figures · 4.2 s");
    assert.equal(fill.style.strokeDashoffset, "0");
    assert.equal(overlay.querySelectorAll(".pxd-pmotion__part").length, 2, "the final boxes pulse");
    let guard = 0;
    while (h.stub.timers.size && guard < 10) { h.stub.flushTimers(); guard += 1; }
    assert.equal(h.page.querySelectorAll(".pxd-pmotion").length, 0);
    assert.equal(h.head.querySelectorAll(".pxd-pmotion-head").length, 0);
    assert.equal(h.m.state(), "idle");
    assert.deepEqual(h.m.pending(), { timers: 0, frames: 0 });
  } finally { h.m.dispose(); h.restore(); }
});

test("motion surface: no per-page data falls back to overall fraction, nothing known loops", () => {
  const h = surfaceRig();
  try {
    h.m.start();
    h.m.progress({ fraction: 0.4 });
    const overlay = h.page.querySelector(".pxd-pmotion");
    const carrier = overlay.querySelector(".pxd-pmotion__carrier");
    assert.equal(carrier.style.transform, "translateY(40.00%)");
    h.m.progress({});
    assert.ok(overlay.classList.contains("pxd-pmotion--loop"));
    assert.ok(h.head.querySelector(".pxd-pmotion-head").classList.contains("pxd-pmotion-head--spin"));
  } finally { h.m.dispose(); h.restore(); }
});

test("motion surface: reduced motion shows the ring and counts only; off shows nothing", () => {
  const h = surfaceRig({ mode: "quiet" });
  try {
    h.m.start();
    h.m.progress({ page: 1, pageCount: 2, counts: { tables: 2 } });
    h.m.parts(1, [{ id: "a", kind: "text", left: 0, top: 0, width: 10, height: 10, draw: true, delay: 0 }]);
    assert.equal(h.page.querySelectorAll(".pxd-pmotion").length, 0, "no beam, no outlines");
    const head = h.head.querySelector(".pxd-pmotion-head");
    assert.ok(head.classList.contains("pxd-pmotion-head--quiet"));
    assert.equal(head.querySelector(".pxd-pmotion-head__text").textContent, "2 tables");
    assert.equal(h.stub.frames.length, 0, "no frames requested");
    h.setMode("off");
    h.m.progress({ page: 2, pageCount: 2 });
    assert.equal(h.head.querySelectorAll(".pxd-pmotion-head").length, 0, "offscreen or map zoom: nothing");
  } finally { h.m.dispose(); h.restore(); }
});

test("motion surface: an error ends the motion with the warn state; dispose clears timers and nodes", () => {
  const h = surfaceRig();
  try {
    h.m.start();
    h.m.progress({ page: 1, pageCount: 4 });
    h.m.fail();
    assert.equal(h.page.querySelectorAll(".pxd-pmotion").length, 0, "the beam stops");
    const head = h.head.querySelector(".pxd-pmotion-head");
    assert.ok(head.classList.contains("pxd-pmotion--error"));
    assert.equal(head.querySelector(".pxd-pmotion-head__text").textContent, "Parse stopped");
    assert.equal(h.m.state(), "error");
    h.m.dispose();
    assert.equal(h.head.querySelectorAll(".pxd-pmotion-head").length, 0);
    assert.deepEqual(h.m.pending(), { timers: 0, frames: 0 });
    h.m.start();
    assert.equal(h.head.querySelectorAll(".pxd-pmotion-head").length, 0, "a disposed surface stays dead");
  } finally { h.restore(); }
});

test("card relay: the PDF card gets the beam on its paper and the ring on its cover; map zoom stays still", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  try {
    const root = doc.createElement("div");
    root.className = "pxd-root";
    root.setAttribute("data-pxd-lod", "detail");
    const card = doc.createElement("div");
    card.className = "pxd-item pxd-item--pdf";
    card.setAttribute("data-uid", "pdf1");
    card._rect = { left: 10, top: 10, width: 200, height: 260, right: 210, bottom: 270 };
    const cover = doc.createElement("div");
    cover.className = "pxd-pdf-cover";
    const paper = doc.createElement("div");
    paper.className = "pxd-pdf-paper";
    cover.append(paper);
    card.append(cover);
    root.append(card);
    doc.body.append(root);
    const relay = createCardMotionRelay({ doc, root, pageOf: () => 1 });
    relay.handle("pdf1", { type: "start" });
    assert.ok(paper.querySelector(".pxd-pmotion"), "beam overlay on the paper");
    assert.ok(cover.querySelector(".pxd-pmotion-head"), "ring on the cover");
    const boxes = [{ id: "a", kind: "table", left: 0, top: 0, width: 50, height: 20, draw: true, delay: 0 }];
    relay.handle("pdf1", { type: "page", page: 1, pageCount: 2, fraction: 0.5, boxes, counts: { tables: 1 } });
    assert.equal(paper.querySelectorAll(".pxd-pmotion__part").length, 1);
    relay.handle("pdf1", { type: "page", page: 2, pageCount: 2, fraction: 1, boxes, counts: { tables: 2 } });
    assert.equal(paper.querySelectorAll(".pxd-pmotion__part").length, 1, "page 2 parts do not land on the page 1 cover");
    root.setAttribute("data-pxd-lod", "map");
    relay.handle("pdf1", { type: "progress", page: 2, pageCount: 2 });
    assert.equal(paper.querySelectorAll(".pxd-pmotion").length, 0, "map zoom: nothing animates");
    assert.equal(cover.querySelectorAll(".pxd-pmotion-head").length, 0);
    root.setAttribute("data-pxd-lod", "detail");
    relay.handle("pdf1", { type: "done", counts: { tables: 2 }, ms: 1200, boxesOf: () => boxes });
    assert.match(cover.querySelector(".pxd-pmotion-head__text").textContent, /2 tables · 1\.2 s/);
    relay.handle("pdf1", { type: "cancel" });
    assert.deepEqual(relay.active(), []);
    assert.equal(cover.querySelectorAll(".pxd-pmotion-head").length, 0);
    relay.handle("other", { type: "progress", page: 1 });
    assert.deepEqual(relay.active(), [], "no motion without a start");
    relay.dispose();
  } finally { restore(); }
});

function pageData(text) {
  return {
    items: [{ str: text, transform: [10, 0, 0, 10, 72, 700], width: text.length * 5, height: 10, fontName: "f1", hasEOL: false }],
    ops: { fnArray: [], argsArray: [] },
    w: 612,
    h: 792,
    fonts: { f1: { name: "Helvetica" } },
  };
}

test("parse view motion events: start, progress and page per page, then one done with counts and boxes", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const events = [];
    const view = createParseView({
      doc: stub.document,
      getPdf: async () => ({ numPages: 2 }),
      loadGeometry: (n) => Promise.resolve(pageData(n === 1 ? "Hello page one" : "Second page text")),
      onMotion: (event) => events.push(event),
    });
    await view.parseBuiltin();
    const types = events.map((e) => e.type);
    assert.equal(types[0], "start");
    assert.equal(types[types.length - 1], "done");
    assert.equal(types.filter((t) => t === "done").length, 1);
    assert.equal(types.filter((t) => t === "error" || t === "cancel").length, 0);
    const pages = events.filter((e) => e.type === "page");
    assert.deepEqual(pages.map((e) => e.page), [1, 2]);
    assert.deepEqual(pages.map((e) => e.fraction), [0.5, 1]);
    const progress = events.filter((e) => e.type === "progress");
    assert.deepEqual(progress.map((e) => e.fraction), [0, 0.5], "a page reports its start before its parts");
    assert.ok(pages[0].counts.paragraphs >= 1);
    assert.ok(Array.isArray(pages[0].boxes) && pages[0].boxes.length >= 1);
    const done = events[events.length - 1];
    assert.ok(done.counts.paragraphs >= 2);
    assert.equal(typeof done.ms, "number");
    assert.ok(done.boxesOf(1).length >= 1);
    view.dispose();
    assert.equal(events.filter((e) => e.type === "cancel").length, 0, "a finished parse emits nothing on dispose");
  } finally { restore(); }
});

test("parse view motion events: a page that throws ends with error; a cancel ends with cancel", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const events = [];
    const view = createParseView({
      doc: stub.document,
      getPdf: async () => ({ numPages: 2 }),
      loadGeometry: (n) => (n === 1 ? Promise.resolve(pageData("ok")) : Promise.reject(new Error("broken page"))),
      onMotion: (event) => events.push(event),
    });
    await assert.rejects(view.parseBuiltin(), /broken page/);
    assert.equal(events[events.length - 1].type, "error");
    assert.equal(view.isBusy(), false, "the chip stops too");
    view.dispose();

    const cancelled = [];
    let release = null;
    const gate = new Promise((resolve) => { release = resolve; });
    const slow = createParseView({
      doc: stub.document,
      getPdf: async () => ({ numPages: 2 }),
      loadGeometry: (n) => (n === 1 ? Promise.resolve(pageData("first")) : gate.then(() => pageData("second"))),
      onMotion: (event) => cancelled.push(event),
    });
    const pending = slow.parseBuiltin();
    await new Promise((resolve) => setTimeout(resolve, 20));
    slow.dispose();
    release();
    await pending;
    const types = cancelled.map((e) => e.type);
    assert.equal(types[0], "start");
    assert.equal(types[types.length - 1], "cancel");
    assert.equal(types.includes("done"), false);
  } finally { restore(); }
});

test("parse view without onMotion emits nothing and builds no motion state", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const view = createParseView({
      doc: stub.document,
      getPdf: async () => ({ numPages: 1 }),
      loadGeometry: () => Promise.resolve(pageData("plain")),
    });
    await view.parseBuiltin();
    assert.equal(stub.document.body.querySelectorAll(".pxd-pmotion").length, 0);
    view.dispose();
  } finally { restore(); }
});

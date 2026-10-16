// Fix round 1. Quiet freezes the current rendered DOM. It does not swap a live card for plain text.
// enterEdit and quiet() are the real entry points. The clock in the cost test does not follow wall time.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const blk = (uid, string, order) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": { ":plexus": { ":x": order * 24, ":y": 0, ":w": 200, ":h": 80 } },
  ":block/children": [],
});
const rawBoard = (uid, children) => ({
  ":block/uid": uid,
  ":block/string": "{{[[diagram]]:Test}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": children,
});
const visible = { x: -10000, y: -10000, w: 20000, h: 20000 };

function shape(node) {
  if (!node || node.nodeType !== 1) return null;
  const cls = String(node.className || "").split(/\s+/).filter((c) => c && c !== "pxd-quiet").sort();
  const kids = [];
  const list = node.children;
  for (let i = 0; i < (list?.length || 0); i += 1) {
    if (list[i].nodeType === 1) kids.push(shape(list[i]));
  }
  return {
    tag: node.tagName,
    cls,
    color: node.style?.color || "",
    src: node.tagName === "IMG" ? node.getAttribute("src") : "",
    text: kids.length ? "" : (node.textContent || ""),
    kids,
  };
}

function imgCount(node) {
  let n = node.tagName === "IMG" ? 1 : 0;
  const list = node.children;
  for (let i = 0; i < (list?.length || 0); i += 1) if (list[i].nodeType === 1) n += imgCount(list[i]);
  return n;
}

function assertStripped(node) {
  const names = node.attributes && typeof node.attributes.keys === "function" ? [...node.attributes.keys()] : [];
  for (const name of names) {
    assert.equal(name === "id" || name === "contenteditable" || name === "tabindex" || /^on/i.test(name), false, name);
  }
  const list = node.children;
  for (let i = 0; i < (list?.length || 0); i += 1) if (list[i].nodeType === 1) assertStripped(list[i]);
}

function renderer(stub, doc, strings, { frame = null, onClone = null } = {}) {
  const host = {
    connected: new Set(),
    renderString(node, string) {
      host.connected.add(node);
      node.replaceChildren?.();
      node.setAttribute("id", `live-${string}`);
      node.setAttribute("contenteditable", "true");
      node.setAttribute("tabindex", "0");
      node.setAttribute("onclick", "nope()");
      node.style.color = "rgb(1, 2, 3)";
      const span = doc.createElement("span");
      span.className = "rm-bold";
      span.textContent = string;
      node.append(span);
      if (String(string).startsWith("IMG ")) {
        const img = doc.createElement("img");
        img.className = "rm-inline-img";
        img.setAttribute("src", "cover.png");
        node.append(img);
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "rm-svg");
        node.append(svg);
      }
    },
    unmount(node) { if (node) host.connected.delete(node); },
    renderBlock(el) {
      const input = doc.createElement("textarea");
      input.className = "rm-block__input";
      input.value = "Alpha";
      input.setSelectionRange = () => {};
      el.append(input);
    },
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pageUid: (title) => `uid-${title}`,
    openBlock() {},
    openPage() {},
    watchPage() { return () => {}; },
    api: { ui: {} },
  };
  if (onClone) {
    const orig = doc.createElement.bind(doc);
    doc.createElement = (tag) => {
      const el = orig(tag);
      const inner = el.cloneNode?.bind(el);
      if (inner) el.cloneNode = (deep) => { onClone(); return inner(deep); };
      return el;
    };
  }
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const frames = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => { const i = idleQueue.indexOf(fn); if (i >= 0) idleQueue.splice(i, 1); }; },
    later() { return () => {}; },
  };
  // null means this board has no frame timer, so a quiet pass has to finish in the same turn.
  if (frame !== null) {
    timers.frame = frame || ((fn) => { frames.push(fn); return () => { const i = frames.indexOf(fn); if (i >= 0) frames.splice(i, 1); }; });
  }
  const uid = "boardA001";
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
  const board = buildBoard(rawBoard(uid, strings.map((string, i) => blk(`c${String(i).padStart(3, "0")}`, string, i))));
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 400) idleQueue.shift()({ timeRemaining: () => 50, didTimeout: false });
  };
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: visible, zoom: 1, tier: "detail" });
  flush();
  return { r, host, doc, flush, frames, itemsLayer, uids: board.order.slice() };
}

function open(strings, opts) {
  const stub = createDomStub();
  const restore = stub.install();
  const view = renderer(stub, stub.document, strings, opts);
  return {
    stub, ...view,
    done() { view.r.dispose(); restore(); noteSpeedFlags(null); },
  };
}

async function settle(h, promise) {
  let done = false;
  let value;
  promise.then((v) => { done = true; value = v; });
  for (let i = 0; i < 80 && !done; i += 1) {
    h.stub.flushFrames();
    const batch = h.frames.splice(0, h.frames.length);
    for (const fn of batch) fn();
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  assert.equal(done, true);
  return value;
}

function watchEmpties(body) {
  let empty = 0;
  const origReplace = body.replaceChildren.bind(body);
  body.replaceChildren = (...nodes) => {
    origReplace(...nodes);
    if (!body.children?.length) empty += 1;
  };
  const arm = (node) => {
    if (!node || node.nodeType !== 1 || node.__pxdWatch) return;
    node.__pxdWatch = true;
    const orig = node.remove.bind(node);
    node.remove = () => {
      const parent = node.parentElement;
      orig();
      if (parent === body && !body.children?.length) empty += 1;
    };
    const list = node.children;
    for (let i = 0; i < (list?.length || 0); i += 1) arm(list[i]);
  };
  arm(body);
  return () => empty;
}

test("entering edit freezes sibling markup, and exit puts the live root back in the same element", async () => {
  const h = open(["Alpha", "IMG Beta", "Gamma", "Plain"]);
  try {
    const [editUid, beta, gamma] = h.uids;
    const betaBody = h.r.shellOf(beta).querySelector(".pxd-item__body");
    const gammaBody = h.r.shellOf(gamma).querySelector(".pxd-item__body");
    const rect = { x: 4, y: 8, left: 4, top: 8, width: 200, height: 80, right: 204, bottom: 88 };
    betaBody._rect = rect;
    const beforeBeta = shape(betaBody);
    const beforeGamma = shape(gammaBody);
    assert.equal(imgCount(betaBody), 1);
    assert.equal(h.r.mountedUids().includes(beta), true);

    const entered = await settle(h, h.r.enterEdit(editUid));
    assert.equal(entered, true);
    assert.deepEqual(shape(betaBody), beforeBeta);
    assert.deepEqual(shape(gammaBody), beforeGamma);
    assert.equal(imgCount(betaBody), 1);
    assert.equal(betaBody.querySelector("img").getAttribute("src"), "cover.png");
    assert.ok(betaBody.querySelector("svg"));
    assert.ok(betaBody.querySelector(".pxd-quiet"));
    assert.ok(gammaBody.querySelector(".pxd-quiet"));
    assertStripped(betaBody.querySelector(".pxd-quiet"));
    assert.equal(h.r.shellOf(beta).querySelector(".pxd-item__body"), betaBody);

    const empties = watchEmpties(betaBody);
    await settle(h, h.r.exitEdit());
    h.flush();
    assert.equal(empties(), 0);
    const live = betaBody.querySelector(".pxd-rs__live");
    assert.ok(live);
    assert.equal(live.closest(".pxd-item__body"), betaBody);
    assert.equal(h.host.connected.has(live), true);
    assert.deepEqual(betaBody.getBoundingClientRect(), rect);
    assert.equal(betaBody.querySelector(".pxd-quiet"), null);
  } finally {
    h.done();
  }
});

test("a shell with no live root is left alone, and clones stay within the mounted cap", async () => {
  const strings = Array.from({ length: 90 }, (_, i) => (i === 1 ? "IMG Beta" : `Card ${i}`));
  const h = open(strings, { frame: null });
  try {
    const mounted = new Set(h.r.mountedUids());
    assert.equal(mounted.size, 80);
    const bare = h.uids.filter((uid) => !mounted.has(uid));
    assert.ok(bare.length >= 1);
    const bareBody = h.r.shellOf(bare[0]).querySelector(".pxd-item__body");
    const before = shape(bareBody);
    assert.equal(bareBody.querySelector(".pxd-rs__live"), null);

    const entered = await settle(h, h.r.enterEdit(h.uids[0]));
    assert.equal(entered, true);
    const clones = h.doc.body.querySelectorAll(".pxd-quiet").length;
    assert.ok(clones <= 80);
    assert.equal(clones, [...mounted].filter((uid) => uid !== h.uids[0] && h.r.shellOf(uid)?.querySelector(".pxd-rs__live, .pxd-quiet")).length);
    assert.deepEqual(shape(bareBody), before);
    assert.equal(bareBody.querySelector(".pxd-quiet"), null);
    assert.equal(h.r.shellOf(h.uids[1]).querySelector("img")?.getAttribute("src"), "cover.png");
  } finally {
    h.done();
  }
});

test("eighty frozen clones stay inside an 8 ms slice of a stepped clock", () => {
  let t = 1000;
  let clones = 0;
  const prev = globalThis.performance;
  globalThis.performance = { now: () => t };
  const slices = [];
  const frames = [];
  const h = open(Array.from({ length: 80 }, (_, i) => `Card ${i}`), {
    onClone: () => { clones += 1; t += 0.25; },
    frame: (fn) => { frames.push(fn); return () => { const i = frames.indexOf(fn); if (i >= 0) frames.splice(i, 1); }; },
  });
  try {
    assert.equal(h.r.mountedUids().length, 80);
    frames.length = 0;
    const start = t;
    h.r.quiet(true);
    slices.push(t - start);
    let guard = 0;
    while (frames.length && guard++ < 20) {
      const fn = frames.shift();
      const at = t;
      fn();
      slices.push(t - at);
    }
    assert.equal(frames.length, 0);
    assert.equal(clones, 80);
    assert.ok(h.r.shellOf(h.uids[1]).querySelector(".pxd-quiet .rm-bold"));
    assert.ok(slices.length >= 2, `expected more than one slice, got ${slices.join(",")}`);
    assert.ok(slices.every((ms) => ms <= 8), slices.join(","));
    assert.equal(h.doc.body.querySelectorAll(".pxd-quiet").length, 80);
    assert.ok(t - 1000 <= slices.length * 8);
  } finally {
    h.done();
    globalThis.performance = prev;
  }
});

test("eighty frozen clones finish in one turn when the clock does not move", () => {
  const prev = globalThis.performance;
  globalThis.performance = { now: () => 5000 };
  let clones = 0;
  const frames = [];
  const h = open(Array.from({ length: 80 }, (_, i) => `Card ${i}`), {
    onClone: () => { clones += 1; },
    frame: (fn) => { frames.push(fn); return () => { const i = frames.indexOf(fn); if (i >= 0) frames.splice(i, 1); }; },
  });
  try {
    assert.equal(h.r.mountedUids().length, 80);
    frames.length = 0;
    const start = globalThis.performance.now();
    h.r.quiet(true);
    assert.equal(globalThis.performance.now() - start, 0);
    assert.equal(frames.length, 0);
    assert.equal(clones, 80);
    assert.equal(h.doc.body.querySelectorAll(".pxd-quiet").length, 80);
    assert.ok(h.r.shellOf(h.uids[3]).querySelector(".pxd-quiet .rm-bold"));
  } finally {
    h.done();
    globalThis.performance = prev;
  }
});

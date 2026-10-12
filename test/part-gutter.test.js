// Per-part gutter (Ask AI + Copy): placement maths, hover intent and bridge, button paths, the page-chips and
// parse-view wiring, and the shared Ask AI icon.
import assert from "node:assert/strict";
import test from "node:test";

import { GUTTER, GUTTER_H, GUTTER_W, createPartGutter, gutterSpot } from "../src/view/part-gutter.js";
import { ASK_AI_BUBBLE, ASK_AI_SPARKLE, askAiIcon } from "../src/view/ask-icon.js";
import { createPageChips } from "../src/view/page-chips.js";
import { createParseView } from "../src/view/parse-view.js";
import { buildMenu } from "../src/view/menu-model.js";
import { SETUP_HINT } from "../src/host/liveai.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("gutter spot: 6 px outside the part's left edge, top aligned, clamped into the visible area", () => {
  const host = { left: 0, top: 0, right: 400, bottom: 300 };
  const spot = gutterSpot({ left: 100, top: 50, right: 300, bottom: 90 }, host);
  assert.deepEqual(spot, { x: 100 - GUTTER.gap - GUTTER_W, y: 50, inside: false, visible: true });
  const tight = gutterSpot({ left: 10, top: 50, right: 300, bottom: 90 }, host);
  assert.equal(tight.x, GUTTER.pad, "no room on the left: inside the pane");
  assert.equal(tight.inside, true);
  const high = gutterSpot({ left: 100, top: -40, right: 300, bottom: 20 }, host);
  assert.equal(high.y, GUTTER.pad, "a part scrolled half out keeps the pill at the top");
  const low = gutterSpot({ left: 100, top: 290, right: 300, bottom: 330 }, host);
  assert.equal(low.y, 300 - GUTTER_H - GUTTER.pad);
  const right = gutterSpot({ left: 100, top: 50, right: 300, bottom: 90 }, host, { side: "right" });
  assert.equal(right.x, 300 - GUTTER_W - GUTTER.gap);
  assert.equal(gutterSpot({ left: 100, top: 400, right: 300, bottom: 450 }, host).visible, false);
});

test("Ask AI icon: 16 px viewBox, currentColor bubble and sparkle, sized on request", () => {
  const stub = createDomStub();
  const svg = askAiIcon(stub.document, 14);
  assert.equal(svg.getAttribute("viewBox"), "0 0 16 16");
  assert.equal(svg.getAttribute("width"), "14");
  assert.equal(svg.getAttribute("aria-hidden"), "true");
  const paths = svg.querySelectorAll("path");
  assert.equal(paths.length, 2);
  assert.equal(paths[0].getAttribute("d"), ASK_AI_BUBBLE);
  assert.equal(paths[0].getAttribute("stroke"), "currentColor");
  assert.equal(paths[0].getAttribute("stroke-width"), "1.5");
  assert.equal(paths[1].getAttribute("d"), ASK_AI_SPARKLE);
  assert.equal(paths[1].getAttribute("fill"), "currentColor");
  assert.equal(askAiIcon(null), null);
  const pdfMenu = buildMenu("card", { isPdf: true, hasParse: true });
  assert.equal(pdfMenu.find((row) => row.id === "ask-ai").icon, "ask-ai", "the card menu uses the same mark");
});

function gutterRig() {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const mount = doc.createElement("div");
  mount._rect = { left: 100, top: 50, width: 500, height: 400, right: 600, bottom: 450 };
  doc.body.append(mount);
  const asked = [];
  const copied = [];
  const menus = [];
  let copyResult = true;
  const before = stub.listenerCount();
  const gutter = createPartGutter({
    doc,
    mount,
    onAsk: (block, opts) => asked.push([block.id, opts.shift]),
    onCopy: (block) => { copied.push(block.id); return Promise.resolve(copyResult); },
    onMenu: (block, anchor) => menus.push([block.id, anchor]),
  });
  return { stub, restore, doc, mount, gutter, asked, copied, menus, before, failCopy: () => { copyResult = false; } };
}

const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("gutter: built on first use, shows after hover intent, one element moved with a transform", () => {
  const h = gutterRig();
  try {
    assert.equal(h.mount.querySelectorAll(".pxd-pgutter").length, 0, "nothing until a part is hovered");
    const block = { id: "p1" };
    h.gutter.intent(block, rect(300, 120, 500, 160), { host: rect(100, 50, 600, 450) });
    assert.equal(h.mount.querySelectorAll(".pxd-pgutter").length, 0, "waits for intent");
    const pending = [...h.stub.timers];
    assert.equal(pending.length, 1);
    assert.equal(pending[0].ms, GUTTER.intentMs);
    h.stub.flushTimers();
    const pill = h.mount.querySelector(".pxd-pgutter");
    assert.ok(pill);
    assert.ok(pill.classList.contains("pxd-pgutter--show"));
    assert.equal(pill.getAttribute("aria-hidden"), "false");
    assert.equal(pill.style.transform, `translate(${300 - GUTTER.gap - GUTTER_W - 100}px, ${120 - 50}px)`);
    assert.equal(h.gutter.current(), block);
    h.gutter.intent({ id: "p2" }, rect(300, 200, 500, 240), { host: rect(100, 50, 600, 450) });
    assert.equal(h.gutter.current().id, "p2", "moving between parts follows at once");
    assert.equal(h.mount.querySelectorAll(".pxd-pgutter").length, 1, "one element per pane");
    const buttons = pill.querySelectorAll("button");
    assert.deepEqual(buttons.map((b) => b.getAttribute("data-tip")), ["gutter.ask", "gutter.copy"]);
    assert.ok(buttons[0].querySelector(".pxd-ask-icon"));
  } finally { h.gutter.dispose(); h.restore(); }
});

test("gutter: leaving hides after a beat, the pill itself is a hover bridge, a quick pass never shows", () => {
  const h = gutterRig();
  try {
    h.gutter.intent({ id: "p1" }, rect(300, 120, 500, 160), { immediate: true });
    const pill = h.mount.querySelector(".pxd-pgutter");
    assert.ok(pill.classList.contains("pxd-pgutter--show"), "keyboard focus shows at once");
    h.gutter.leave();
    h.stub.dispatch(pill, "pointerenter");
    h.stub.flushTimers();
    assert.ok(pill.classList.contains("pxd-pgutter--show"), "the pointer reached the pill: it stays");
    h.stub.dispatch(pill, "pointerleave");
    h.stub.flushTimers();
    assert.equal(pill.classList.contains("pxd-pgutter--show"), false);
    h.gutter.intent({ id: "p3" }, rect(300, 120, 500, 160));
    h.gutter.leave();
    h.stub.flushTimers();
    assert.equal(pill.classList.contains("pxd-pgutter--show"), false, "left before the intent delay");
  } finally { h.gutter.dispose(); h.restore(); }
});

test("gutter buttons: Ask, Shift-Ask to the basket, Copy marks done or failed, right-click opens the copy menu", async () => {
  const h = gutterRig();
  try {
    h.gutter.intent({ id: "t1" }, rect(300, 120, 500, 160), { immediate: true });
    const [ask, copy] = h.mount.querySelector(".pxd-pgutter").querySelectorAll("button");
    const down = h.stub.dispatch(ask, "pointerdown");
    assert.equal(down.defaultPrevented, true, "a press never starts a text selection");
    assert.equal(down.propagationStopped, true);
    h.stub.dispatch(ask, "click");
    h.stub.dispatch(ask, "click", { shiftKey: true });
    assert.deepEqual(h.asked, [["t1", false], ["t1", true]]);
    h.stub.dispatch(copy, "click");
    await settle();
    assert.deepEqual(h.copied, ["t1"]);
    assert.ok(copy.classList.contains("pxd-pgutter__copy--done"));
    assert.equal(copy.getAttribute("aria-label"), "Copied");
    h.failCopy();
    h.stub.dispatch(copy, "click");
    await settle();
    assert.ok(copy.classList.contains("pxd-pgutter__copy--fail"));
    h.stub.dispatch(copy, "contextmenu");
    assert.equal(h.menus.length, 1);
    assert.equal(h.menus[0][0], "t1");
    assert.equal(h.menus[0][1], copy);
  } finally { h.gutter.dispose(); h.restore(); }
});

test("gutter dispose removes the element, its listeners and timers", () => {
  const h = gutterRig();
  h.gutter.intent({ id: "p1" }, rect(300, 120, 500, 160));
  h.stub.flushTimers();
  h.gutter.intent({ id: "p2" }, rect(300, 120, 500, 160));
  h.gutter.leave();
  h.gutter.dispose();
  try {
    assert.equal(h.mount.querySelectorAll(".pxd-pgutter").length, 0);
    assert.equal(h.stub.listenerCount(), h.before);
    assert.equal(h.stub.timers.size, 0);
    h.gutter.intent({ id: "p3" }, rect(300, 120, 500, 160), { immediate: true });
    assert.equal(h.mount.querySelectorAll(".pxd-pgutter").length, 0, "dead after dispose");
  } finally { h.restore(); }
});

function parsedSample() {
  return {
    schema: "pxd-parse/1",
    engine: "builtin",
    sha256: "abc",
    pageCount: 1,
    pages: [{ n: 1, w: 100, h: 200, rotation: 0, kind: "text" }],
    order: ["h1", "p1", "t1"],
    blocks: {
      h1: { id: "h1", type: "heading", level: 1, page: 1, text: "Introduction", bbox: [0, 0, 100, 10] },
      p1: { id: "p1", type: "para", page: 1, text: "Body text that is long enough", bbox: [20, 30, 100, 60] },
      t1: {
        id: "t1", type: "table", page: 1, bbox: [0, 100, 100, 160], rows: 2, cols: 2, headerRows: 1,
        cells: [
          { r: 0, c: 0, text: "Head A", header: true, bbox: [0, 100, 50, 130] },
          { r: 0, c: 1, text: "Head B", header: true, bbox: [50, 100, 100, 130] },
          { r: 1, c: 0, text: "1", bbox: [0, 130, 50, 160] },
          { r: 1, c: 1, text: "2", bbox: [50, 130, 100, 160] },
        ],
        grid: { xs: [0, 50, 100], ys: [100, 130, 160] },
      },
    },
    stats: { ms: 10 },
  };
}

test("page chips with a gutter: any part under the pointer brings the pill, paragraphs included", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  try {
    const pane = doc.createElement("div");
    pane._rect = { left: 0, top: 0, width: 600, height: 500, right: 600, bottom: 500 };
    const reader = doc.createElement("div");
    reader._rect = { left: 0, top: 0, width: 600, height: 500, right: 600, bottom: 500 };
    const page = doc.createElement("div");
    page.className = "page";
    page.setAttribute("data-page-number", "1");
    page._rect = { left: 100, top: 20, width: 100, height: 200, right: 200, bottom: 220 };
    reader.append(page);
    pane.append(reader);
    doc.body.append(pane);
    const seen = [];
    const gutter = createPartGutter({ doc, mount: pane, onAsk: (block) => seen.push(block.id) });
    const chips = createPageChips({
      doc,
      host: reader,
      getParsed: () => parsedSample(),
      pageEl: (n) => (n === 1 ? page : null),
      pageOf: () => ({ w: 100, h: 200, rotation: 0 }),
      run() {},
      gutter,
      gutterHost: reader,
    });
    stub.flushFrames();
    stub.dispatch(page, "pointermove", { clientX: 150, clientY: 60 });
    stub.flushTimers();
    assert.equal(gutter.current()?.id, "p1", "a paragraph gets the gutter");
    const pill = pane.querySelector(".pxd-pgutter");
    assert.equal(pill.style.transform, `translate(${100 + 20 - 3 - GUTTER.gap - GUTTER_W}px, ${20 + 30 - 3}px)`);
    const icons = page.querySelectorAll(".pxd-parsed-copy");
    assert.ok(icons.length > 0, "Show parsed boxes still paint");
    assert.ok(icons.every((n) => !n.classList.contains("pxd-parsed-copy--show")), "the per-box icon gives way to the gutter");
    stub.dispatch(pill.querySelector(".pxd-pgutter__ask"), "click");
    assert.deepEqual(seen, ["p1"]);
    stub.dispatch(page, "pointermove", { clientX: 150, clientY: 150 });
    assert.equal(gutter.current()?.id, "t1");
    stub.dispatch(reader, "scroll");
    assert.equal(gutter.current(), null, "a scroll hides it");
    chips.dispose();
    gutter.dispose();
  } finally { restore(); }
});

function viewRig() {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const pane = doc.createElement("div");
  pane._rect = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
  const reader = doc.createElement("div");
  reader._rect = { left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600 };
  const page = doc.createElement("div");
  page.className = "page";
  page.setAttribute("data-page-number", "1");
  page._rect = { left: 100, top: 20, width: 100, height: 200, right: 200, bottom: 220 };
  reader.append(page);
  pane.append(reader);
  doc.body.append(pane);
  const toasts = [];
  const clip = [];
  const view = createParseView({
    doc,
    readerEl: reader,
    pageEl: (n) => (n === 1 ? page : null),
    gutterMount: pane,
    outline: false,
    onToast: (message) => toasts.push(message),
    writeText: async (text) => { clip.push(text); },
  });
  pane.append(view.element());
  view.showDoc(parsedSample());
  stub.flushFrames();
  return { stub, restore, doc, pane, page, view, toasts, clip };
}

test("parse view gutter: Ask without Live AI says how to turn it on; Shift-click adds to the question", () => {
  const h = viewRig();
  try {
    delete h.stub.window.LiveAI_API;
    h.stub.dispatch(h.page, "pointermove", { clientX: 150, clientY: 60 });
    h.stub.flushTimers();
    const ask = h.pane.querySelector(".pxd-pgutter__ask");
    assert.ok(ask, "the gutter lives in the pane");
    h.stub.dispatch(ask, "click");
    assert.deepEqual(h.toasts, [SETUP_HINT]);
    h.stub.dispatch(ask, "click", { shiftKey: true });
    assert.equal(h.toasts.length, 2);
    assert.notEqual(h.toasts[1], SETUP_HINT, "the basket path, not the setup hint");
  } finally { h.view.dispose(); h.restore(); }
});

test("parse view gutter: Ask with Live AI opens the Ask AI dialog on that part", () => {
  const h = viewRig();
  try {
    h.stub.window.LiveAI_API = { generate: async () => ({ text: "" }), isAvailable: () => true, getModels: () => [] };
    globalThis.window.LiveAI_API = h.stub.window.LiveAI_API;
    h.stub.dispatch(h.page, "pointermove", { clientX: 150, clientY: 60 });
    h.stub.flushTimers();
    h.stub.dispatch(h.pane.querySelector(".pxd-pgutter__ask"), "click");
    assert.equal(h.toasts.includes(SETUP_HINT), false);
    assert.ok(h.doc.body.querySelector(".pxd-ask"), "the Ask AI dialog opened");
  } finally {
    for (const node of h.doc.body.querySelectorAll(".pxd-ask")) node.remove();
    delete h.stub.window.LiveAI_API;
    h.view.dispose();
    h.restore();
  }
});

test("parse view gutter: Copy on a table copies a {{[[table]]}} outline; a paragraph copies its text", async () => {
  const h = viewRig();
  try {
    h.stub.dispatch(h.page, "pointermove", { clientX: 150, clientY: 150 });
    h.stub.flushTimers();
    h.stub.dispatch(h.pane.querySelector(".pxd-pgutter__copy"), "click");
    await settle();
    assert.match(h.clip[0], /\{\{\[\[table\]\]\}\}/);
    assert.match(h.clip[0], /Head A/);
    assert.deepEqual(h.toasts, ["Copied"]);
    h.stub.dispatch(h.page, "pointermove", { clientX: 150, clientY: 60 });
    h.stub.dispatch(h.pane.querySelector(".pxd-pgutter__copy"), "click");
    await settle();
    assert.match(h.clip[1], /Body text/);
    h.view.dispose();
    assert.equal(h.pane.querySelectorAll(".pxd-pgutter").length, 0, "disposed with the view");
  } finally { h.restore(); }
});

test("parse view gutter: keyboard focus on an outline row shows the pill at the row's right edge", () => {
  const h = viewRig();
  try {
    const row = h.view.element().querySelector('.pxd-parse__block[data-id="p1"]');
    assert.ok(row);
    row._rect = { left: 420, top: 100, width: 300, height: 40, right: 720, bottom: 140 };
    const body = h.view.element().querySelector(".pxd-parse__body");
    body._rect = { left: 400, top: 60, width: 380, height: 500, right: 780, bottom: 560 };
    h.stub.dispatch(row, "focusin");
    const pill = h.pane.querySelector(".pxd-pgutter");
    assert.ok(pill.classList.contains("pxd-pgutter--show"), "focus shows it without the hover delay");
    assert.equal(pill.style.transform, `translate(${720 - GUTTER_W - GUTTER.gap}px, 100px)`);
  } finally { h.view.dispose(); h.restore(); }
});

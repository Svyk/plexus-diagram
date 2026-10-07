// G2. A PDF click selects and flips pages in the card. The pane opens only from Open,
// double-click, Enter, the card menu, or a highlight/page chip. Dark mode filters the canvas.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { coverModel } from "../src/model/pdf.js";
import { createSettingsPanel, settingsDefaults } from "../src/settings.js";
import { createItemRenderer } from "../src/view/cards.js";
import { mountBoardView } from "../src/view/board-view.js";
import {
  PDF_DARK_CLASSES,
  createPdfFlip,
  flipFromKey,
  flipFromWheel,
  flipStep,
  normalizePdfDark,
  pageBarText,
  pdfDarkClass,
  pickFlipTarget,
  renderPixels,
} from "../src/view/pdf-flip.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const SELF = "{{[[pdf]]: https://example.test/self.pdf}}";
const REF = "{{[[pdf]]: https://example.test/ref.pdf}}";
const PAPER = "https://example.test/paper.pdf";

function ruleBody(css, needle) {
  const at = css.indexOf(needle);
  assert.ok(at >= 0, needle);
  const open = css.lastIndexOf("{", at);
  const close = css.indexOf("}", at);
  return css.slice(open, close + 1);
}

function fakePdf(pages = 3) {
  const made = [];
  const lib = {
    made,
    GlobalWorkerOptions: { workerSrc: "https://example.test/pdf.worker.js" },
    getDocument({ url }) {
      const doc = {
        url,
        numPages: pages,
        destroyed: false,
        getPage(n) {
          return Promise.resolve({
            number: n,
            getViewport({ scale }) {
              return { width: 100 * scale, height: 140 * scale, scale };
            },
            render() {
              return { promise: Promise.resolve(true), cancel() {} };
            },
          });
        },
        destroy() { doc.destroyed = true; },
      };
      made.push(doc);
      return {
        promise: Promise.resolve(doc),
        destroy() { doc.destroyed = true; },
      };
    },
  };
  return lib;
}

function paperOf(doc, w = 320, h = 240) {
  const host = doc.createElement("div");
  host.className = "pxd-pdf-paper";
  return { host, size: () => ({ cssW: w, cssH: h, dpr: 2 }) };
}

test("pdf dark mode defaults to dim and only accepts off, dim, or invert", () => {
  assert.equal(normalizePdfDark(undefined), "dim");
  assert.equal(normalizePdfDark("nope"), "dim");
  assert.equal(normalizePdfDark("off"), "off");
  assert.equal(pdfDarkClass("invert"), "pxd-pdf-dark--invert");
  assert.deepEqual([...PDF_DARK_CLASSES], ["pxd-pdf-dark--off", "pxd-pdf-dark--dim", "pxd-pdf-dark--invert"]);
  assert.equal(settingsDefaults()["pdf-dark"], "dim");
  const row = createSettingsPanel().settings.find((entry) => entry.id === "pdf-dark");
  assert.equal(row.name, "PDF pages in dark mode");
  assert.equal(row.action.type, "select");
  assert.deepEqual(row.action.items, ["off", "dim", "invert"]);
});

test("flipper page math clamps, and wheel and arrow keys step one page", () => {
  assert.equal(flipStep(1, 9, -1), 1);
  assert.equal(flipStep(3, 9, 1), 4);
  assert.equal(flipStep(9, 9, 1), 9);
  assert.equal(flipStep(0, 4, 1), 1);
  assert.equal(pageBarText(3, 9), "3 / 9");
  assert.equal(flipFromKey("ArrowLeft"), -1);
  assert.equal(flipFromKey("ArrowRight"), 1);
  assert.equal(flipFromKey("ArrowUp"), 0);
  assert.equal(flipFromKey("Enter"), 0);
  assert.equal(flipFromWheel(12), 1);
  assert.equal(flipFromWheel(-4), -1);
  assert.equal(flipFromWheel(0), 0);
  assert.equal(renderPixels({ cssW: 1, cssH: 40, dpr: 2 }), null);
  assert.deepEqual(renderPixels({ cssW: 320, cssH: 180, dpr: 2 }), {
    cssW: 320, cssH: 180, dpr: 2, backingW: 640, backingH: 360,
  });
  assert.equal(renderPixels({ cssW: 10, cssH: 10 }).dpr, 1);
  const urls = { a: "https://example.test/a.pdf", b: "https://example.test/b.enc", c: "blob:https://example.test/c" };
  assert.equal(pickFlipTarget({ selected: "a", hovered: "c", lod: "detail", urls }), "c");
  assert.equal(pickFlipTarget({ selected: "a", hovered: "a", lod: "detail", urls }), "a");
  assert.equal(pickFlipTarget({ selected: "b", hovered: "", lod: "detail", urls }), "");
  assert.equal(pickFlipTarget({ selected: "a", hovered: "c", lod: "map", urls }), "");
  assert.equal(pickFlipTarget({ selected: "", hovered: "a", lod: "overview", urls }), "");
});

test("the flipper draws one page, wheels and arrows only when selected, and destroys on deselect", async () => {
  const stub = createDomStub();
  const lib = fakePdf(9);
  const hosts = new Map();
  const live = [];
  const a = paperOf(stub.document, 320, 240);
  const b = paperOf(stub.document, 200, 200);
  hosts.set("a", a);
  hosts.set("b", b);
  const flip = createPdfFlip({
    doc: stub.document,
    win: stub.window,
    lib,
    urlOf: (uid) => (uid === "b" ? "https://example.test/b.pdf" : "https://example.test/a.pdf"),
    hostOf: (uid) => hosts.get(uid)?.host || null,
    sizeOf: (uid) => hosts.get(uid)?.size() || null,
    onLive: (on) => { live.push(on); },
  });
  flip.setSelected("a");
  await flip.idle();
  const canvas = a.host.querySelector("canvas");
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 480);
  assert.equal(a.host.querySelector(".pxd-pdf-bar__pages").textContent, "1 / 9");
  assert.equal(live.includes(true), true);
  assert.equal(lib.made.length, 1);

  const wheeled = stub.dispatch(a.host, "wheel", { deltaY: 20 });
  assert.equal(wheeled.propagationStopped, true);
  assert.equal(wheeled.defaultPrevented, true);
  await flip.idle();
  assert.equal(a.host.querySelector(".pxd-pdf-bar__pages").textContent, "2 / 9");
  assert.equal(flip.consumeKey("ArrowRight"), true);
  await flip.idle();
  assert.equal(a.host.querySelector(".pxd-pdf-bar__pages").textContent, "3 / 9");
  assert.equal(flip.consumeKey("ArrowLeft"), true);
  await flip.idle();
  assert.equal(a.host.querySelector(".pxd-pdf-bar__pages").textContent, "2 / 9");
  assert.equal(flip.consumeKey("ArrowUp"), false);
  assert.equal(flip.consumeKey(" "), false);

  const pinch = stub.dispatch(a.host, "wheel", { deltaY: 20, ctrlKey: true });
  assert.equal(pinch.propagationStopped, false);
  await flip.idle();
  assert.equal(a.host.querySelector(".pxd-pdf-bar__pages").textContent, "2 / 9");

  a.host.querySelectorAll("button.pxd-pdf-bar__step")[1].click();
  await flip.idle();
  assert.equal(a.host.querySelector(".pxd-pdf-bar__pages").textContent, "3 / 9");

  const first = lib.made[0];
  flip.setSelected("b");
  await flip.idle();
  assert.equal(first.destroyed, true);
  assert.equal(a.host.querySelector(".pxd-pdf-bar"), null);
  assert.equal(b.host.querySelector(".pxd-pdf-bar__pages").textContent, "1 / 9");
  assert.equal(lib.made.length, 2);
  assert.equal(flip.liveUid(), "b");

  flip.setLod("map");
  await flip.idle();
  assert.equal(lib.made[1].destroyed, true);
  assert.equal(b.host.querySelector(".pxd-pdf-flip"), null);
  assert.equal(flip.live(), false);

  flip.setLod("detail");
  await flip.idle();
  assert.equal(b.host.querySelector(".pxd-pdf-bar__pages").textContent, "1 / 9");
  hosts.get("b").size = () => ({ cssW: 100, cssH: 80, dpr: 1 });
  flip.settle();
  await flip.idle();
  assert.equal(b.host.querySelector("canvas").width, 100);
  assert.equal(b.host.querySelector("canvas").height, 80);

  flip.setSelected("");
  await flip.idle();
  assert.equal(b.host.querySelector(".pxd-pdf-bar"), null);
  assert.equal(flip.live(), false);
  assert.equal(lib.made.at(-1).destroyed, true);
});

test("hover can show a page, but the wheel stays with the board until the card is selected", async () => {
  const stub = createDomStub();
  const lib = fakePdf(4);
  const host = stub.document.createElement("div");
  let delay = null;
  const flip = createPdfFlip({
    doc: stub.document,
    lib,
    timers: { later(fn, ms) { delay = { fn, ms }; return () => { delay = null; }; } },
    urlOf: () => "https://example.test/a.pdf",
    hostOf: () => host,
    sizeOf: () => ({ cssW: 80, cssH: 80, dpr: 1 }),
  });
  flip.setHover("a");
  assert.equal(delay.ms, 120);
  assert.equal(lib.made.length, 0);
  flip.setHover("");
  assert.equal(delay, null);
  flip.setHover("a");
  delay.fn();
  delay = null;
  await flip.idle();
  assert.equal(host.querySelector(".pxd-pdf-bar__pages").textContent, "1 / 4");
  const wheeled = stub.dispatch(host, "wheel", { deltaY: 8 });
  assert.equal(wheeled.propagationStopped, false);
  await flip.idle();
  assert.equal(host.querySelector(".pxd-pdf-bar__pages").textContent, "1 / 4");
  host.querySelector("button.pxd-pdf-bar__step").click();
  await flip.idle();
  assert.equal(host.querySelector(".pxd-pdf-bar__pages").textContent, "1 / 4", "the previous chevron stays on page 1");
  [...host.querySelectorAll("button.pxd-pdf-bar__step")].at(-1).click();
  await flip.idle();
  assert.equal(host.querySelector(".pxd-pdf-bar__pages").textContent, "2 / 4");
  flip.destroy();
  await flip.idle();
  assert.equal(lib.made[0].destroyed, true);
  assert.equal(host.querySelector(".pxd-pdf-flip"), null);
});

test("an encrypted url and a missing pdf.js leave the cover alone", async () => {
  const stub = createDomStub();
  const lib = fakePdf(2);
  const host = stub.document.createElement("div");
  const enc = createPdfFlip({
    doc: stub.document,
    lib,
    urlOf: () => "https://example.test/secret.enc",
    hostOf: () => host,
    sizeOf: () => ({ cssW: 80, cssH: 80, dpr: 1 }),
  });
  enc.setSelected("a");
  await enc.idle();
  assert.equal(lib.made.length, 0);
  assert.equal(host.querySelector("canvas"), null);
  const bare = createPdfFlip({
    doc: stub.document,
    win: {},
    urlOf: () => "https://example.test/a.pdf",
    hostOf: () => host,
    sizeOf: () => ({ cssW: 80, cssH: 80, dpr: 1 }),
  });
  bare.setSelected("a");
  await bare.idle();
  assert.equal(host.querySelector(".pxd-pdf-bar"), null);
  assert.equal(bare.live(), false);
});

test("dark filters hit the page canvas only, and the cover paper token stays white", () => {
  const cover = readFileSync(new URL("../src/css/pdf-cover.css", import.meta.url), "utf8");
  const pane = readFileSync(new URL("../src/css/read-pane.css", import.meta.url), "utf8");
  assert.equal(cover.includes("prefers-color-scheme"), false);
  assert.match(cover, /\.pxd-root\.pxd-root--dark \{[\s\S]*--pxd-pdf-paper:\s*#ffffff/);
  for (const css of [cover, pane]) {
    const dim = ruleBody(css, "filter: brightness(.82) contrast(1.05)");
    const invert = ruleBody(css, "filter: invert(.9) hue-rotate(180deg)");
    assert.equal(dim.includes("Highlight"), false);
    assert.equal(dim.includes("textLayer"), false);
    assert.equal(invert.includes("Highlight"), false);
    assert.equal(invert.includes("textLayer"), false);
    assert.match(css, /pxd-pdf-dark--off[\s\S]*filter:\s*none/);
  }
  assert.match(cover, /pxd-pdf-dark--dim[\s\S]*\.pxd-pdf-flip canvas/);
  assert.match(cover, /pxd-pdf-dark--dim[\s\S]*\.pxd-pdf-img/);
  assert.match(pane, /\.page > canvas[\s\S]*filter:\s*brightness\(\.82\) contrast\(1\.05\)/);
  assert.match(pane, /pxd-pdf-dark--dim[\s\S]*--pxd-read-bed:\s*#14171b/);
  assert.match(pane, /\.textLayer[\s\S]*z-index:\s*2/);
  assert.match(pane, /\.Highlight[\s\S]*z-index:\s*2/);
});

function raw(children) {
  return {
    ":block/uid": "boardpdfu",
    ":block/string": "{{[[diagram]]:PDFs}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  };
}

function child(uid, string, order) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": { ":plexus": { ":x": order * 320, ":y": 0, ":w": 240, ":h": 320 } },
    ":block/children": [],
  };
}

function mountCards(opts = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const pane = [];
  const opened = [];
  const requested = [];
  const toasts = [];
  const r = createItemRenderer({
    doc,
    host: {
      renderString(node, string) { node.textContent = string; },
      renderBlock(node) {
        const box = doc.createElement("div");
        box.className = "rm-pdf-container";
        node.append(box);
      },
      unmount() {},
      blockString() { return ""; },
      pdfCover(string) {
        if (string === SELF) return coverModel({ title: "Self paper", url: "https://example.test/self.pdf", count: 2 });
        if (string === REF) return coverModel({ title: "Ref paper", url: "https://example.test/ref.pdf", count: 1 });
        return coverModel({ count: 0 });
      },
      updateProps() {},
    },
    session: { updateProps() {}, setString() {} },
    itemsLayer,
    sectionsLayer,
    timers: { idle(fn) { idleQueue.push(fn); return () => {}; }, later() { return () => {}; } },
    pdfChips: opts.pdfChips,
    onPdfOpen(uid, page) { opened.push([uid, page]); },
    onPdfOpenRequest(uid) { requested.push(uid); },
    onToast(message) { toasts.push(message); },
    onReadPane: opts.onReadPane === false ? undefined : (detail) => { pane.push(detail); },
    coverImage(url) {
      if (opts.ticks && url === "https://example.test/self.pdf") {
        return { state: "ready", src: "https://example.test/self.jpg", ticks: [{ y01: 0.2, page: 4, color: "yellow" }] };
      }
      return null;
    },
  });
  const board = buildBoard(raw(opts.children || [child("pdfself01", SELF, 0), child("pdfref001", REF, 1)]), { resolve: () => "" });
  const rects = worldRects(board);
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 30) idleQueue.shift()({ timeRemaining: () => 10 });
  };
  r.sync({ board, rects, structural: true });
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: { x: -400, y: -400, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
  flush();
  return {
    stub, r, pane, opened, requested, toasts, flush,
    shell: (uid = "pdfself01") => r.shellOf(uid),
    restore() { r.dispose(); restore(); },
  };
}

test("selecting or focusing a PDF does not open the pane; the pill, chip, tick, and double-click do", () => {
  const ctx = mountCards({
    ticks: true,
    pdfChips: () => [{ page: 3, count: 1, uids: ["hlone0001"] }],
  });
  try {
    const shell = ctx.shell();
    const cover = shell.querySelector(".pxd-pdf-cover");
    ctx.r.setSelection(["pdfself01"]);
    ctx.stub.dispatch(cover, "focusin");
    ctx.stub.dispatch(shell, "focusin");
    assert.equal(ctx.pane.length, 0);
    assert.deepEqual(ctx.toasts, []);
    assert.equal(shell.querySelector(".pxd-pdf-reader"), null);

    cover.querySelector("button.pxd-pdf-open").click();
    assert.equal(ctx.pane.length, 1);
    assert.equal(ctx.pane[0].open, true);
    assert.equal(ctx.pane[0].cardUid, "pdfself01");

    ctx.r.setSelection(["pdfref001"]);
    ctx.stub.dispatch(ctx.shell("pdfref001").querySelector(".pxd-pdf-cover"), "focusin");
    assert.equal(ctx.pane.length, 1, "selecting the other PDF leaves the open pane alone");
    assert.deepEqual(ctx.toasts, []);

    ctx.r.setSelection(["pdfself01"]);
    ctx.stub.dispatch(shell, "keydown", { key: "Enter" });
    ctx.stub.dispatch(shell.querySelector(".pxd-pdf-paper"), "dblclick");
    assert.deepEqual(ctx.requested, ["pdfself01", "pdfself01"]);
    const chip = cover.querySelector("button.pxd-pdf-chip");
    ctx.stub.dispatch(chip, "dblclick");
    cover.querySelector("button.pxd-pdf-tick").click();
    assert.deepEqual(ctx.opened, [["pdfself01", 3], ["pdfself01", 4]]);
  } finally {
    ctx.restore();
  }
});

test("without a side pane, focusing the cover still mounts the inline reader", () => {
  const ctx = mountCards({ onReadPane: false });
  try {
    const shell = ctx.shell();
    assert.equal(shell.querySelector(".pxd-pdf-reader"), null);
    ctx.stub.dispatch(shell.querySelector(".pxd-pdf-cover"), "focusin");
    assert.equal(shell.querySelector(".pxd-pdf-reader") != null, true);
  } finally {
    ctx.restore();
  }
});

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function boardItem(uid, string, plexus, order) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": plexus ? { ":plexus": plexus } : {},
    ":block/children": [],
  };
}

function mountBoard() {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const lib = fakePdf(5);
  stub.window.pdfjsLib = lib;
  stub.window.devicePixelRatio = 2;
  const pulled = {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      boardItem("cardAAAA1", "Alpha", { ":x": 0, ":y": 0, ":w": 200, ":h": 100 }, 0),
      boardItem("pdfcard01", `{{[[pdf]]: ${PAPER}}}`, { ":x": 20, ":y": 20, ":w": 240, ":h": 320 }, 1),
    ],
  };
  const board = buildBoard(pulled);
  const handlers = new Map();
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    emit(name, payload) { for (const fn of [...(handlers.get(name) || [])]) fn(payload); },
    setLinkMode() {},
    setBoard(next) { session.board = next; session.rects = worldRects(next); },
  };
  for (const name of ["commitMove", "commitRects", "setString", "updateProps", "addRefCards", "deleteItems", "undo", "redo"]) {
    session[name] = () => Promise.resolve(null);
  }
  const host = {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock(node) {
      const box = stub.document.createElement("div");
      box.className = "rm-pdf-container";
      node.append(box);
    },
    renderPage() {},
    unmount() {},
    pagePreview: () => ({ uid: "pg", exists: true, blocks: [] }),
    pullTree: () => [],
    blockString: () => null,
    pageUid: () => "pgBeta001",
    pdfCover() { return coverModel({ title: "Paper", url: PAPER, count: 1, pageUid: "pgBeta001" }); },
    openBlock() {},
    openInSidebar() {},
    searchPages: () => [],
    searchBlocks: () => [],
    related: () => [],
  };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: (k) => (k === "pdf-dark" ? undefined : undefined) },
    version: "3.2.0",
    autofocus: true,
  });
  const flush = async () => {
    stub.flushFrames();
    await tick();
    stub.flushIdle();
    stub.flushFrames();
  };
  return { stub, restore, view, lib, root: view.root, flush };
}

async function drain() {
  for (let i = 0; i < 16; i += 1) await Promise.resolve();
}

test("a click selects the PDF and does not open the pane; Open, Enter, double-click, and the menu do", async () => {
  const f = mountBoard();
  try {
    await f.flush();
    assert.equal(f.root.classList.contains("pxd-pdf-dark--dim"), true);
    const card = f.root.querySelector('[data-uid="pdfcard01"]');
    const paper = card.querySelector(".pxd-pdf-paper");
    assert.ok(paper);
    f.stub.dispatch(paper, "pointerdown", { button: 0, clientX: 30, clientY: 40, pointerId: 1 });
    f.stub.dispatch(f.stub.document, "pointerup", { button: 0, clientX: 30, clientY: 40, pointerId: 1 });
    f.stub.flushFrames();
    await drain();
    assert.equal(card.classList.contains("pxd-item--selected"), true);
    assert.equal(f.root.querySelector(".pxd-read"), null);
    assert.equal(f.root.querySelector(".pxd-pdf-bar__pages").textContent, "1 / 5");
    assert.equal(f.root.querySelector(".pxd-pdf-flip canvas").width, 480);

    const right = f.stub.dispatch(f.stub.window, "keydown", { key: "ArrowRight" });
    assert.equal(right.defaultPrevented, true);
    await drain();
    assert.equal(f.root.querySelector(".pxd-pdf-bar__pages").textContent, "2 / 5");
    assert.equal(f.root.querySelector(".pxd-read"), null);
    f.stub.dispatch(f.stub.window, "keydown", { key: "ArrowRight", shiftKey: true });
    await drain();
    assert.equal(f.root.querySelector(".pxd-pdf-bar__pages").textContent, "2 / 5");

    f.stub.dispatch(f.stub.window, "keydown", { key: "Enter" });
    f.stub.flushFrames();
    assert.ok(f.root.querySelector(".pxd-read"), "Enter opens the pane");

    f.view.setSettings({ get: (k) => (k === "pdf-dark" ? "invert" : undefined) });
    assert.equal(f.root.classList.contains("pxd-pdf-dark--invert"), true);
    assert.equal(f.root.classList.contains("pxd-pdf-dark--dim"), false);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("double-click and the card menu open the pane after a select-only click", async () => {
  const dbl = mountBoard();
  try {
    await dbl.flush();
    const card = dbl.root.querySelector('[data-uid="pdfcard01"]');
    const paper = card.querySelector(".pxd-pdf-paper");
    dbl.stub.dispatch(paper, "pointerdown", { button: 0, clientX: 30, clientY: 40, pointerId: 1 });
    dbl.stub.dispatch(dbl.stub.document, "pointerup", { button: 0, clientX: 30, clientY: 40, pointerId: 1 });
    dbl.stub.flushFrames();
    assert.equal(dbl.root.querySelector(".pxd-read"), null);
    dbl.stub.dispatch(paper, "dblclick", { button: 0, clientX: 30, clientY: 40 });
    dbl.stub.flushFrames();
    assert.ok(dbl.root.querySelector(".pxd-read"));
  } finally {
    dbl.view.dispose();
    dbl.restore();
  }

  const menu = mountBoard();
  try {
    await menu.flush();
    const card = menu.root.querySelector('[data-uid="pdfcard01"]');
    const paper = card.querySelector(".pxd-pdf-paper");
    menu.stub.dispatch(paper, "pointerdown", { button: 0, clientX: 30, clientY: 40, pointerId: 1 });
    menu.stub.dispatch(menu.stub.document, "pointerup", { button: 0, clientX: 30, clientY: 40, pointerId: 1 });
    menu.stub.flushFrames();
    assert.equal(menu.root.querySelector(".pxd-read"), null);
    menu.stub.dispatch(paper, "contextmenu", { button: 2, clientX: 30, clientY: 40 });
    const row = [...menu.root.querySelectorAll(".pxd-menu__item")].find((node) => node.getAttribute("data-id") === "open");
    assert.ok(row);
    row.click();
    menu.stub.flushFrames();
    assert.ok(menu.root.querySelector(".pxd-read"));
  } finally {
    menu.view.dispose();
    menu.restore();
  }
});

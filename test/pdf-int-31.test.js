// PDF-INT: cover store and warm stay off the mount path. The first paint asks for a cover.
import assert from "node:assert/strict";
import test from "node:test";

import { COVER_LS_KEY } from "../src/host/cover-store.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { DEFAULT_SIZES } from "../src/model/schema.js";
import { createSettingsPanel, settingsDefaults } from "../src/settings.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const BOARD = "board0001";
const PDF_URL = "https://example.com/notes.pdf";
const PDF = `{{[[pdf]]: ${PDF_URL}}}`;
const HL = "hlmark001";
const PAGE = "pagepdf01";
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function card(uid, string, order, plexus = {}) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": { ":plexus": { ":x": 40, ":y": 40, ":w": 240, ":h": 320, ...plexus } },
    ":block/children": [],
  };
}

function pulled(children) {
  return {
    ":block/uid": BOARD,
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  };
}

function textProps(page) {
  return {
    ":pdf-highlight": {
      ":type": "text",
      ":content": { ":text": "selected passage" },
      ":position": { ":boundingRect": { ":pageNumber": page, ":x1": 1, ":y1": 2, ":x2": 9, ":y2": 4 } },
    },
  };
}

function dataUrl(bytes) {
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
}

function imageBytes(value) {
  const text = String(value || "");
  const at = text.indexOf(",");
  if (at < 0) return "";
  return Buffer.from(text.slice(at + 1), "base64").toString();
}

function seedCover(storage, extra = {}) {
  storage.setItem(COVER_LS_KEY, JSON.stringify({
    order: [PDF_URL],
    items: {
      [PDF_URL]: {
        url: PDF_URL,
        hash: "",
        first: dataUrl("seed-first"),
        last: null,
        lastPage: 2,
        pageCount: 10,
        w: 120,
        h: 160,
        ts: 1,
        ...extra,
      },
    },
  }));
}

function storedCover(storage) {
  const raw = storage.getItem(COVER_LS_KEY);
  if (!raw) return null;
  return JSON.parse(raw).items[PDF_URL] || null;
}

function fakeHost(overrides = {}) {
  return {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock() {},
    renderPage() {},
    unmount() {},
    pagePreview: () => ({ uid: "pg", exists: true, blocks: [] }),
    pullTree: () => [],
    blockString: (uid) => (uid === "pdfcard01" || uid === "pdfAAAAA1" || uid === "pdfBBBBB2" ? PDF : null),
    pageUid: () => "pgBeta001",
    openBlock() {},
    openInSidebar() {},
    searchPages: () => [],
    searchBlocks: () => [],
    related: () => [],
    cardStringForUid: (uid) => `((${uid}))`,
    blockPageUid: (uid) => (uid === HL ? PAGE : ""),
    pdfPageUrl: (uid) => (uid === PAGE ? PDF_URL : ""),
    pdfCover: () => ({ title: "Notes", pageUid: PAGE }),
    ...overrides,
  };
}

function fakeSession(board) {
  const handlers = new Map();
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    busy: false,
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    emit(name, payload) { for (const fn of [...(handlers.get(name) || [])]) fn(payload); },
    release() {},
    setLinkMode() {},
    setBoard(next) { session.board = next; session.rects = worldRects(next); },
  };
  for (const name of ["commitMove", "commitRects", "createCard", "addRefCards", "setString"]) {
    session[name] = () => Promise.resolve(`${name}-uid`);
  }
  return session;
}

function installFileReader() {
  const prev = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      Promise.resolve(blob?.arrayBuffer?.()).then((buf) => {
        if (!buf) { this.onerror?.(); return; }
        const type = typeof blob.type === "string" && blob.type ? blob.type : "image/jpeg";
        this.result = `data:${type};base64,${Buffer.from(buf).toString("base64")}`;
        this.onload?.();
      }).catch(() => { this.onerror?.(); });
    }
  };
  return () => {
    if (prev) globalThis.FileReader = prev;
    else delete globalThis.FileReader;
  };
}

function mountPdf({ children, settings = {}, hostOverrides = {}, prepare } = {}) {
  const restoreReader = installFileReader();
  const stub = createDomStub();
  const restoreDom = stub.install();
  prepare?.(stub);
  stub.localStorage.setItem(`plexus-diagram:vp:Svy:${BOARD}`, JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const highlights = new Map(children.filter((row) => row[":block/string"] === `((${HL}))`).map(() => [HL, 3]));
  const board = buildBoard(pulled(children), {
    resolve(uid) { return uid === HL ? "selected passage #h/yellow" : ""; },
    propsOf(uid) {
      if (uid !== HL || !highlights.has(uid)) return null;
      return { props: textProps(highlights.get(uid)), string: "selected passage #h/yellow", pageTitle: "Notes.pdf" };
    },
  });
  const session = fakeSession(board);
  const host = fakeHost(hostOverrides);
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: (key) => settings[key] },
    version: "3.1.0",
    autofocus: true,
  });
  const flush = () => {
    stub.flushFrames();
    stub.flushIdle();
    stub.flushFrames();
  };
  return {
    stub,
    board,
    host,
    view,
    flush,
    root: view.root,
    restore() { restoreDom(); restoreReader(); },
  };
}

async function until(pred, label) {
  for (let i = 0; i < 40; i += 1) {
    if (pred()) return;
    await tick(0);
  }
  assert.ok(pred(), label);
}

function patchCanvas(stub) {
  const orig = stub.document.createElement.bind(stub.document);
  stub.document.createElement = (tag) => {
    const el = orig(tag);
    if (String(tag).toLowerCase() !== "canvas") return el;
    el.toBlob = (cb) => { cb(new Blob([`jpeg-${el.width}x${el.height}`])); };
    const prev = el.getContext.bind(el);
    el.getContext = () => {
      const ctx = prev() || {};
      ctx.drawImage = () => {};
      return ctx;
    };
    return el;
  };
}

function patchTabStrip(stub) {
  const orig = stub.document.createElement.bind(stub.document);
  stub.document.createElement = (tag) => {
    const el = orig(tag);
    const desc = Object.getOwnPropertyDescriptor(el, "className");
    if (!desc?.set || !desc?.get) return el;
    Object.defineProperty(el, "className", {
      configurable: true,
      get: desc.get,
      set(value) {
        desc.set.call(el, value);
        if (String(desc.get.call(el)).split(/\s+/).includes("pxd-fstabs")) {
          el._rect = { left: 0, top: 0, width: 800, height: 36, right: 800, bottom: 36, x: 0, y: 0 };
        }
      },
    });
    return el;
  };
}

function readerDom(stub) {
  const box = stub.document.createElement("div");
  box.className = "rm-pdf-container";
  const bar = stub.document.createElement("div");
  bar.className = "rm-pdf-toolbar";
  const input = stub.document.createElement("input");
  input.className = "bp3-input";
  input.value = "4";
  const total = stub.document.createElement("span");
  total.textContent = "/ 9";
  bar.append(input, total);
  const page = (n, w, h) => {
    const node = stub.document.createElement("div");
    node.className = "page";
    node.setAttribute("data-page-number", String(n));
    const canvas = stub.document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    node.append(canvas);
    return node;
  };
  box.append(bar, page(1, 100, 140), page(4, 80, 110));
  return box;
}

test("mount does not open IndexedDB, read the cover book, or mount a warm holder", async () => {
  let opens = 0;
  let coverReads = 0;
  const f = mountPdf({
    children: [card("pdfcard01", PDF, 0)],
    prepare(stub) {
      const orig = stub.localStorage.getItem.bind(stub.localStorage);
      stub.localStorage.getItem = (key) => {
        if (key === COVER_LS_KEY) coverReads += 1;
        return orig(key);
      };
      stub.window.indexedDB = { open() { opens += 1; return null; } };
    },
  });
  try {
    assert.equal(opens, 0);
    assert.equal(coverReads, 0);
    assert.equal(f.root.querySelector(".pxd-pdf-warm"), null);
    await tick(0);
    assert.equal(opens, 0);
    assert.equal(coverReads, 0);
    assert.equal(f.root.querySelector(".pxd-pdf-warm"), null);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("a cover loads as a data URL and a tick carries its page", async () => {
  const f = mountPdf({
    children: [
      card("pdfcard01", PDF, 0),
      card("hlcard001", `((${HL}))`, 1, { ":x": 400 }),
    ],
    prepare(stub) { seedCover(stub.localStorage); },
  });
  try {
    f.flush();
    const cover = f.root.querySelector(".pxd-pdf-cover");
    assert.equal(cover?.getAttribute("data-cover"), "loading");
    await until(() => f.root.querySelector(".pxd-pdf-cover")?.getAttribute("data-cover") === "ready", "cover ready");
    const img = f.root.querySelector(".pxd-pdf-img");
    const src = img?.getAttribute("src") || "";
    assert.equal(src.startsWith("data:"), true);
    assert.equal(src.startsWith("blob:"), false);
    assert.equal(imageBytes(src), "seed-first");
    const mark = f.root.querySelector(".pxd-pdf-tick");
    assert.equal(mark?.getAttribute("data-page"), "3");
    assert.equal(mark?.style.top, "20%");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("background covers stay off unless the setting is on", async () => {
  const off = mountPdf({ children: [card("pdfcard01", PDF, 0)] });
  try {
    off.flush();
    await tick(1800);
    off.stub.flushTimers();
    await tick(0);
    assert.equal(off.root.querySelector(".pxd-pdf-warm"), null);
  } finally {
    off.view.dispose();
    off.restore();
  }

  const rendered = [];
  const on = mountPdf({
    children: [card("pdfcard01", PDF, 0)],
    settings: { "pdf-cover-warm": true },
    hostOverrides: { renderBlock(el, uid) { rendered.push(uid); } },
  });
  try {
    on.flush();
    await tick(1800);
    on.stub.flushTimers();
    // P32-2: the warm starts from an idle callback (flushIdle), then arms its begin timer (flushTimers once).
    // Flushing timers again inside the poll would fire the 8 s kill timer and tear the holder down.
    on.stub.flushIdle();
    on.stub.flushTimers();
    await until(() => on.root.querySelector(".pxd-pdf-warm"), "warm holder");
    assert.ok(rendered.includes("pdfcard01"));
    const probe = on.view.pdfProbe();
    assert.equal(probe.covers.on, true);
    assert.equal(probe.covers.pdfjs.found, false);
    assert.deepEqual(probe.covers.warm.paths, { pdfjs: 0, reader: 1 });
  } finally {
    on.view.dispose();
    on.restore();
  }
});

test("settle stores page 1 and close stores the open page, then the card drops its cached face", async () => {
  const f = mountPdf({
    children: [card("pdfcard01", PDF, 0)],
    prepare(stub) {
      patchCanvas(stub);
      seedCover(stub.localStorage);
    },
  });
  try {
    f.flush();
    await until(() => f.root.querySelector(".pxd-pdf-cover")?.getAttribute("data-cover") === "ready", "seed ready");
    f.root.querySelector(".pxd-pdf-open").click();
    const live = f.root.querySelector(".pxd-read__live");
    assert.ok(live);
    live.append(readerDom(f.stub));
    f.stub.flushTimers();
    await until(() => imageBytes(storedCover(f.stub.localStorage)?.first) === "jpeg-100x140", "settle first");
    const settled = storedCover(f.stub.localStorage);
    assert.equal(settled.last, null);
    assert.equal(settled.lastPage, 2);
    assert.equal(settled.pageCount, 9);
    const fresh = dataUrl("jpeg-100x140");
    await until(() => (f.root.querySelector(".pxd-pdf-img")?.getAttribute("src") || "").includes(fresh.slice(fresh.indexOf(","))), "cache drop");
    f.root.querySelector(".pxd-read__close").click();
    await until(() => imageBytes(storedCover(f.stub.localStorage)?.last) === "jpeg-80x110", "close last");
    const closed = storedCover(f.stub.localStorage);
    assert.equal(imageBytes(closed.first), "jpeg-100x140");
    assert.equal(closed.lastPage, 4);
    assert.equal(closed.pageCount, 9);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("the reading class follows the open card, including the pane switcher", async () => {
  const f = mountPdf({
    children: [
      card("pdfAAAAA1", PDF, 0),
      card("pdfBBBBB2", PDF, 1, { ":x": 320 }),
    ],
  });
  try {
    f.flush();
    const shell = (uid) => f.root.querySelector(`[data-uid=${uid}]`);
    shell("pdfAAAAA1").querySelector(".pxd-pdf-open").click();
    assert.equal(shell("pdfAAAAA1").classList.contains("pxd-item--reading"), true);
    assert.equal(shell("pdfBBBBB2").classList.contains("pxd-item--reading"), false);
    const select = f.root.querySelector(".pxd-read__switch");
    select.value = "pdfBBBBB2";
    f.stub.dispatch(select, "change");
    assert.equal(shell("pdfAAAAA1").classList.contains("pxd-item--reading"), false);
    assert.equal(shell("pdfBBBBB2").classList.contains("pxd-item--reading"), true);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("hovering a highlight card flashes its mark and does not scroll the reader", async () => {
  const f = mountPdf({
    children: [
      card("pdfcard01", PDF, 0),
      card("hlcard001", `((${HL}))`, 1, { ":x": 400 }),
    ],
  });
  try {
    f.flush();
    f.root.querySelector(".pxd-pdf-open").click();
    const live = f.root.querySelector(".pxd-read__live");
    const box = f.stub.document.createElement("div");
    box.className = "PdfHighlighter";
    box.scrollTop = 12;
    const mark = f.stub.document.createElement("div");
    mark.className = "TextHighlight__part";
    mark.__reactFiber$test = { memoizedProps: { value: { highlight: { id: HL } } }, return: null };
    box.append(mark);
    live.append(box);
    const shell = f.root.querySelector("[data-uid=hlcard001]");
    f.stub.dispatch(shell, "mouseenter");
    assert.equal(mark.classList.contains("pxd-read__mark-flash"), true);
    assert.equal(box.scrollTop, 12);
    f.stub.dispatch(shell, "mouseleave");
    assert.equal(mark.classList.contains("pxd-read__mark-flash"), false);
    assert.equal(box.scrollTop, 12);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("the tab strip height is the --pxd-tabs-h variable", async () => {
  const f = mountPdf({
    children: [card("pdfcard01", PDF, 0)],
    prepare: patchTabStrip,
  });
  try {
    assert.equal(f.root.style["--pxd-tabs-h"], "0px");
    // P32-6: one tab (this board) paints no strip and reserves nothing.
    f.view.setFullscreen(true);
    assert.equal(f.root.style["--pxd-tabs-h"], "0px");
    assert.equal(f.root.querySelector(".pxd-fstabs"), null);
    assert.equal(f.root.classList.contains("pxd-root--fstabs"), false);
    f.view.setFullscreen(false);
    assert.equal(f.root.style["--pxd-tabs-h"], "0px");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("a new PDF card's default size is 240 by 320", () => {
  assert.deepEqual(DEFAULT_SIZES.pdf, { w: 240, h: 320 });
});

test("PDF cover settings default off the warm pass and offer first or last-read", () => {
  const defaults = settingsDefaults();
  assert.equal(defaults["pdf-cover"], "first");
  assert.equal(defaults["pdf-cover-warm"], true);
  const rows = createSettingsPanel().settings;
  const cover = rows.find((row) => row.id === "pdf-cover");
  const warm = rows.find((row) => row.id === "pdf-cover-warm");
  assert.equal(cover.name, "PDF card cover");
  assert.deepEqual(cover.action.items, ["first", "last-read"]);
  assert.equal(warm.name, "Prepare PDF covers in the background");
  assert.equal(warm.action.type, "switch");
});

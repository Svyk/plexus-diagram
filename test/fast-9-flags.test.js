// FAST-9. Hidden speed-flags. Tests pass a settings object and do not open the panel.
import assert from "node:assert/strict";
import test from "node:test";

import { createLifecycle } from "../src/lifecycle.js";
import { installPlexusDiagram } from "../src/feature.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { coverModel, heavyEmbed, postersEnabled } from "../src/model/pdf.js";
import {
  bindSpeedFlagSource,
  createSettingsPanel,
  defaultSpeedFlags as flagsDefault,
  noteSpeedFlags,
  parseSpeedFlags,
  readSettings,
  settingsDefaults,
} from "../src/settings.js";
import { packSketch, sketchKey } from "../src/view/sketch.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const VIDEO = "{{[[video]]: https://cdn.example/clip.mp4}}";
const PDF = "{{[[pdf]]: https://example.test/paper.pdf}}";
const HOVER = ".pxd-cardchip, .pxd-boardchip, .pxd-crumb, .rm-block-ref, .rm-page-ref, [data-link-title], .pxd-item--board";
const ALL_ON = {
  posters: true,
  parking: true,
  keepAlive: true,
  prefetch: true,
  sketch: true,
  budgetedMount: true,
};

test("the panel has no speed-flags control, and bad JSON leaves all six on", () => {
  assert.equal(createSettingsPanel().settings.some((row) => row.id === "speed-flags"), false);
  assert.equal(Object.hasOwn(settingsDefaults(), "speed-flags"), false);
  assert.deepEqual(flagsDefault(), ALL_ON);
  assert.deepEqual(parseSpeedFlags(null), ALL_ON);
  assert.deepEqual(parseSpeedFlags(""), ALL_ON);
  assert.deepEqual(parseSpeedFlags("not json"), ALL_ON);
  assert.deepEqual(parseSpeedFlags("{nope"), ALL_ON);
  assert.deepEqual(parseSpeedFlags("false"), ALL_ON);
  assert.deepEqual(parseSpeedFlags([]), ALL_ON);
  assert.deepEqual(parseSpeedFlags({ posters: false }), { ...ALL_ON, posters: false });
  assert.deepEqual(parseSpeedFlags('{"sketch":"false","parking":true}'), { ...ALL_ON, sketch: false });
  const read = readSettings({ settings: { get: (id) => (id === "speed-flags" ? "not-json" : null) } });
  assert.deepEqual(read["speed-flags"], ALL_ON);
  noteSpeedFlags(null);
  bindSpeedFlagSource(null);
});

test("posters off mounts the embed, and an option object can turn the helper off", () => {
  assert.equal(postersEnabled(null), true);
  assert.equal(postersEnabled({ posters: false }), false);
  assert.ok(heavyEmbed(VIDEO));
  assert.equal(heavyEmbed(VIDEO, { posters: false }), null);
});

class El {
  constructor(doc, tag = "div") {
    this.doc = doc;
    this.tag = tag;
    this.children = [];
    this.parentElement = null;
    this.nodeType = 1;
    this.style = { display: "" };
    this.dataset = {};
    this.id = "";
    this.textContent = "";
    this.cls = new Set();
    this.closestMap = {};
    this.attrs = new Map();
    const cls = this.cls;
    this.classList = {
      add: (...names) => names.forEach((n) => cls.add(n)),
      remove: (...names) => names.forEach((n) => cls.delete(n)),
      contains: (n) => cls.has(n),
    };
  }
  get tagName() { return this.tag.toUpperCase(); }
  getBoundingClientRect() {
    return this.box || { x: 0, y: 0, width: 400, height: 480, top: 0, left: 0, right: 400, bottom: 480 };
  }
  addEventListener() {}
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }
  set className(value) { this.cls.clear(); String(value).split(/\s+/).filter(Boolean).forEach((n) => this.cls.add(n)); }
  get className() { return [...this.cls].join(" "); }
  get isConnected() {
    let node = this;
    while (node.parentElement) node = node.parentElement;
    return node === this.doc.root;
  }
  append(child) { child.remove(); child.parentElement = this; this.children.push(child); }
  appendChild(child) { this.append(child); return child; }
  after(node) {
    node.remove();
    const parent = this.parentElement;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
    node.parentElement = parent;
  }
  remove() {
    const parent = this.parentElement;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
  }
  closest(selector) { return this.closestMap[selector] ?? null; }
  matches(selector) {
    if (selector === '[id^="block-input-"]') return this.id.startsWith("block-input-");
    return selector.startsWith(".") && this.cls.has(selector.slice(1));
  }
  contains(node) {
    for (let cur = node; cur; cur = cur.parentElement) if (cur === this) return true;
    return false;
  }
  querySelectorAll(selector) {
    const out = [];
    for (const child of this.children) {
      if (child.matches(selector)) out.push(child);
      out.push(...child.querySelectorAll(selector));
    }
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

function makeDoc() {
  const doc = {};
  doc.root = new El(doc, "html");
  doc.head = new El(doc, "head");
  doc.body = new El(doc, "body");
  doc.app = new El(doc, "div");
  doc.app.cls.add("roam-app");
  doc.root.append(doc.head);
  doc.root.append(doc.body);
  doc.body.append(doc.app);
  doc.activeElement = null;
  doc.listeners = new Map();
  doc.addEventListener = (type, fn) => {
    if (!doc.listeners.has(type)) doc.listeners.set(type, new Set());
    doc.listeners.get(type).add(fn);
  };
  doc.removeEventListener = (type, fn) => doc.listeners.get(type)?.delete(fn);
  doc.createElement = (tag) => new El(doc, tag);
  doc.getElementById = () => null;
  doc.querySelector = (selector) => doc.root.querySelector(selector);
  doc.querySelectorAll = (selector) => doc.root.querySelectorAll(selector);
  return doc;
}

function addBoard(doc, uid) {
  const container = doc.createElement("div");
  container.cls.add("roam-block-container");
  const main = doc.createElement("div");
  main.cls.add("rm-block-main");
  container.append(main);
  const inputEl = doc.createElement("div");
  inputEl.id = `block-input-w-body-outline-${uid}`;
  main.append(inputEl);
  const native = doc.createElement("div");
  native.cls.add("rm-diagram");
  native.closestMap['[id^="block-input-"]'] = { id: inputEl.id };
  native.closestMap[".roam-block-container"] = container;
  const panel = doc.createElement("div");
  panel.cls.add("rm-diagram-title-panel");
  main.append(native);
  native.after(panel);
  doc.app.append(container);
  return native;
}

function setup({ flags = null, boards = ["boardAAA1"] } = {}) {
  const saved = {};
  const globals = ["document", "window", "location", "MutationObserver", "IntersectionObserver", "setInterval", "clearInterval"];
  for (const key of globals) saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const doc = makeDoc();
  const win = {
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
  };
  const io = [];
  define("document", doc);
  define("window", win);
  define("location", { hash: "#/app/Svy/page" });
  define("MutationObserver", class {
    observe() {}
    disconnect() {}
  });
  define("IntersectionObserver", class {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      io.push(this);
    }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  });
  const intervals = new Map();
  let nextInterval = 1;
  define("setInterval", (callback) => { const id = nextInterval++; intervals.set(id, callback); return id; });
  define("clearInterval", (id) => intervals.delete(id));

  const props = new Map(boards.map((uid) => [uid, { ":plexus": { ":v": 2 } }]));
  const pulls = [];
  const storageReads = [];
  const storageWrites = [];
  const storageMap = new Map();
  const host = {
    api: {
      data: {
        pull(pattern, ref) {
          if (pattern === "[:block/props]") return { ":block/props": props.get(ref[1]) ?? null };
          return null;
        },
      },
      ui: { getFocusedBlock: () => null, rightSidebar: { getWindows: () => null } },
    },
    graph: "Svy",
    stats: { writes: 0, watches: 0, renders: 0 },
    blockString: () => null,
    q: () => [],
    generateUid: () => "newBoard01",
    createBlock: async () => "newBoard01",
    openBlock: async () => {},
    setOpen: async () => {},
    pullBoard(uid) { pulls.push(uid); return null; },
    prefetchBoard(uid) { return host.pullBoard(uid); },
  };
  host.prefetchBoard.warm = () => true;
  const views = [];
  const mountView = (args) => {
    const root = doc.createElement("div");
    root.cls.add("pxd-root");
    const item = doc.createElement("div");
    item.cls.add("pxd-item");
    root.append(item);
    args.mountEl.append(root);
    const view = {
      args,
      root,
      disposed: 0,
      suspended: false,
      viewport() { return { x: 1, y: 2, zoom: 1 }; },
      suspend() { this.suspended = true; },
      resume() { this.suspended = false; },
      dispose() { this.disposed += 1; root.remove(); },
      setFullscreen() {},
      focusUid() {},
      setSettings() {},
    };
    views.push(view);
    return view;
  };
  const registry = () => ({ addCommand: async () => {}, removeCommand: async () => {} });
  const values = {
    "auto-enhance": false,
    "collapse-outline": false,
    "fullscreen-on-zoom": false,
    "speed-log": false,
    "speed-flags": flags,
  };
  const extensionAPI = {
    settings: { get: (id) => (Object.hasOwn(values, id) ? values[id] : null) },
    ui: { commandPalette: registry(), slashCommand: registry(), blockContextMenu: registry() },
    platform: { isMobile: () => false },
  };
  const storage = {
    getItem: (key) => { storageReads.push(key); return storageMap.get(key) ?? null; },
    setItem: (key, value) => { storageWrites.push(key); storageMap.set(key, String(value)); },
  };
  const lifecycle = createLifecycle();
  const fire = (target, isIntersecting) => {
    for (const obs of io) {
      if (obs.targets.has(target)) obs.callback([{ target, isIntersecting }]);
    }
  };
  const restore = () => {
    bindSpeedFlagSource(null);
    noteSpeedFlags(null);
    for (const key of globals) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  };
  return {
    doc, host, views, pulls, values, storageMap, storageReads, storageWrites, lifecycle, fire, restore,
    install: () => installPlexusDiagram({ extensionAPI, lifecycle, version: "x", mountView, host, acquireSession: (uid) => ({
      uid,
      board: { uid, enhanced: true, virtual: false, items: new Map() },
      on: () => () => {},
      release() {},
    }), storage }),
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rootIn = (mountEl) => mountEl.querySelector(".pxd-root");

function hover(doc, uid) {
  const chip = doc.createElement("div");
  chip.cls.add("pxd-cardchip");
  chip.setAttribute("data-board", uid);
  chip.closestMap[HOVER] = chip;
  chip.closestMap[".pxd-cardchip"] = chip;
  doc.app.append(chip);
  for (const fn of doc.listeners.get("pointerover") || []) fn({ target: chip, relatedTarget: null });
}

test("parking off leaves .pxd-root mounted when the board scrolls away", async () => {
  const t = setup({ flags: '{"parking":false}' });
  try {
    addBoard(t.doc, "boardAAA1");
    await t.install();
    const mountEl = t.views[0].args.mountEl;
    assert.ok(rootIn(mountEl));
    t.fire(mountEl, false);
    assert.ok(rootIn(mountEl));
    assert.equal(t.views[0].disposed, 0);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("parking on still drops the canvas, and turning it off later skips the next hibernate", async () => {
  const t = setup({ boards: ["boardAAA1", "boardBBB2"] });
  try {
    addBoard(t.doc, "boardAAA1");
    addBoard(t.doc, "boardBBB2");
    await t.install();
    const first = t.views[0].args.mountEl;
    t.fire(first, false);
    assert.equal(rootIn(first), null);
    const second = t.views[1].args.mountEl;
    assert.ok(rootIn(second));
    t.values["speed-flags"] = '{"parking":false}';
    t.fire(second, false);
    assert.ok(rootIn(second));
    assert.equal(t.views[1].disposed, 0);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("keep-alive off disposes the leaving view on navigate", async () => {
  const t = setup({ flags: '{"keepAlive":false}', boards: ["boardAAA1", "boardBBB2"] });
  try {
    addBoard(t.doc, "boardAAA1");
    await t.install();
    assert.equal(t.views.length, 1);
    t.views[0].args.onOpenBoard("boardBBB2");
    await settle();
    assert.equal(t.views.length, 2);
    assert.equal(t.views[0].disposed, 1);
    assert.equal(t.views[0].suspended, false);
    assert.equal(t.views[1].disposed, 0);
    assert.equal(rootIn(t.views[1].args.mountEl) != null, true);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("prefetch off calls pullBoard zero times, and the hover listener stays", async () => {
  const t = setup({ flags: '{"prefetch":false}' });
  try {
    addBoard(t.doc, "boardAAA1");
    await t.install();
    assert.ok(t.doc.listeners.get("pointerover")?.size >= 1);
    hover(t.doc, "warmboard1");
    await wait(150);
    assert.equal(t.pulls.length, 0);
    t.values["speed-flags"] = "{}";
    hover(t.doc, "warmboard1");
    await wait(150);
    assert.equal(t.pulls.length, 1);
    assert.equal(t.pulls[0], "warmboard1");
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("sketch off does not read or write the sketch key and mounts in this turn", async () => {
  const key = sketchKey("Svy", "boardAAA1");
  const packed = packSketch({ items: [{ uid: "card0001", x: 0, y: 0, w: 80, h: 40, title: "A" }] });
  const off = setup({ flags: '{"sketch":false}' });
  off.storageMap.set(key, packed);
  try {
    addBoard(off.doc, "boardAAA1");
    await off.install();
    assert.equal(off.views.length, 1);
    assert.equal(off.storageReads.includes(key), false);
    assert.equal(off.storageWrites.includes(key), false);
  } finally {
    await off.lifecycle.dispose().catch(() => {});
    off.restore();
  }

  const on = setup();
  on.storageMap.set(key, packed);
  try {
    addBoard(on.doc, "boardAAA1");
    await on.install();
    assert.equal(on.views.length, 0);
    assert.equal(on.storageReads.includes(key), true);
    assert.equal(on.storageWrites.includes(key), false);
  } finally {
    await on.lifecycle.dispose().catch(() => {});
    on.restore();
  }
});

function cardMount(children, { settings = null, pageOutline = null, renderBlock } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  root.append(sectionsLayer, itemsLayer);
  doc.body.append(root);
  const idleQueue = [];
  const rendered = [];
  const strings = [];
  const host = {
    renderString(node, string) {
      strings.push(string);
      node.textContent = string;
    },
    renderBlock(node, uid) {
      rendered.push(uid);
      if (renderBlock) { renderBlock(doc, node, uid); return; }
      node.textContent = uid;
    },
    unmount() {},
    blockString: () => "",
    pdfCover(string) {
      if (String(string).includes("pdf")) return coverModel({ title: "Paper", url: "https://example.test/paper.pdf", count: 2 });
      return coverModel({ count: 0 });
    },
    pageOutline,
  };
  const board = buildBoard({
    ":block/uid": "boardperf9",
    ":block/string": "{{[[diagram]]:Flags}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  });
  const r = createItemRenderer({
    doc,
    host,
    session: {},
    itemsLayer,
    sectionsLayer,
    settings,
    timers: { idle(fn) { idleQueue.push(fn); return () => {}; }, later() { return () => {}; } },
  });
  const show = () => {
    r.sync({ board, rects: worldRects(board), structural: true });
    r.setLod("detail", 1);
    r.scheduleContent({ visibleRect: { x: -100, y: -100, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
  };
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 30) idleQueue.shift()({ timeRemaining: () => 10 });
  };
  return { root, r, rendered, strings, idleQueue, show, flush, restore };
}

function child(uid, string, order, plexus = {}) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": { ":plexus": { ":x": order * 260, ":y": 0, ":w": 240, ":h": 160, ...plexus } },
    ":block/children": [],
  };
}

test("posters off puts the embed node in the card on open", () => {
  const f = cardMount([
    child("videocard1", VIDEO, 0),
    child("pdfcard01", PDF, 1),
  ], {
    settings: { posters: false },
    renderBlock(doc, node, uid) {
      if (uid === "videocard1") node.append(doc.createElement("video"));
      else if (uid === "pdfcard01") {
        const live = doc.createElement("div");
        live.className = "rm-pdf-container";
        node.append(live);
      }
    },
  });
  try {
    f.show();
    f.flush();
    const videoCard = f.root.querySelector("[data-uid=videocard1]");
    assert.equal(videoCard.querySelectorAll("video").length, 1);
    assert.equal(videoCard.querySelector(".pxd-embed-poster"), null);
    const pdfCard = f.root.querySelector("[data-uid=pdfcard01]");
    assert.ok(pdfCard.querySelector(".rm-pdf-container"));
    assert.equal(pdfCard.querySelector(".pxd-pdf-cover"), null);
    assert.equal(f.root.querySelector(".pxd-embed-poster"), null);
  } finally {
    f.r.dispose();
    f.restore();
  }
});

test("budgeted mounting off mounts every card body in one turn, and page rows stay idle", () => {
  const f = cardMount([
    child("noteA0001", "Note one", 0),
    child("noteB0002", "Note two", 1),
    child("noteC0003", "Note three", 2),
    child("pagecard1", "[[Lab Page]]", 3),
  ], {
    settings: { "speed-flags": '{"budgetedMount":false}' },
    pageOutline() {
      return {
        uid: "labpage1",
        title: "Lab Page",
        exists: true,
        blocks: [child("rowplain1", "A plain row", 0)],
      };
    },
  });
  try {
    f.show();
    assert.equal(f.strings.includes("Note one"), true);
    assert.equal(f.strings.includes("Note two"), true);
    assert.equal(f.strings.includes("Note three"), true);
    assert.equal(f.rendered.includes("rowplain1"), false);
    assert.ok(f.idleQueue.length >= 1);
  } finally {
    f.r.dispose();
    f.restore();
  }
});

// PERF-6: one viewport observer parks every board that is off screen, inside a
// collapsed sidebar window, or under a closed ancestor block. Park and wake do not write.
import assert from "node:assert/strict";
import test from "node:test";

import { createLifecycle } from "../src/lifecycle.js";
import { installPlexusDiagram } from "../src/feature.js";

const WATCHES = 2;

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
    this.box = null;
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
  addEventListener(type, fn) { (this.handlers ??= {})[type] = [...(this.handlers[type] || []), fn]; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
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
  doc.addEventListener = (type, fn) => { if (!doc.listeners.has(type)) doc.listeners.set(type, new Set()); doc.listeners.get(type).add(fn); };
  doc.removeEventListener = (type, fn) => doc.listeners.get(type)?.delete(fn);
  doc.createElement = (tag) => new El(doc, tag);
  doc.getElementById = (id) => doc.root.querySelectorAll("*").find((n) => n.id === id) ?? null;
  doc.querySelector = (selector) => doc.root.querySelector(selector);
  doc.querySelectorAll = (selector) => doc.root.querySelectorAll(selector);
  const originalMatches = El.prototype.matches;
  El.prototype.matches = function matches(selector) {
    return selector === "*" ? true : originalMatches.call(this, selector);
  };
  return doc;
}

function addNative(doc, uid, { parent = doc.app } = {}) {
  const native = doc.createElement("div");
  native.cls.add("rm-diagram");
  native.closestMap['[id^="block-input-"]'] = { id: `block-input-w-body-outline-${uid}` };
  const panel = doc.createElement("div");
  panel.cls.add("rm-diagram-title-panel");
  parent.append(native);
  native.after(panel);
  return { native, panel };
}

function addBlock(doc, uid, { parent = doc.app } = {}) {
  const container = doc.createElement("div");
  container.cls.add("roam-block-container");
  const main = doc.createElement("div");
  main.cls.add("rm-block-main");
  container.append(main);
  const inputEl = doc.createElement("div");
  inputEl.id = `block-input-w-body-outline-${uid}`;
  main.append(inputEl);
  const kids = doc.createElement("div");
  kids.cls.add("rm-block-children");
  container.append(kids);
  parent.append(container);
  return { container, main, kids };
}

function addBoard(doc, uid, { parent = doc.app } = {}) {
  const block = addBlock(doc, uid, { parent });
  const placed = addNative(doc, uid, { parent: block.main });
  placed.native.closestMap[".roam-block-container"] = block.container;
  return { ...block, ...placed };
}

function setup({ enhanced = [], hash = "" } = {}) {
  const saved = {};
  const globals = ["document", "window", "location", "MutationObserver", "IntersectionObserver", "setInterval", "clearInterval"];
  for (const key of globals) saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });

  const doc = makeDoc();
  const listeners = new Map();
  const win = {
    innerHeight: 800,
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
  };
  const io = [];
  const env = { doc, win, hash, observers: new Set(), io, intervals: new Map(), nextInterval: 1, editTime: 5000, windows: null };
  define("document", doc);
  define("window", win);
  define("location", { hash });
  define("MutationObserver", class {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.target = target; env.observers.add(this); }
    disconnect() { env.observers.delete(this); }
  });
  define("IntersectionObserver", class {
    constructor(callback, opts) {
      this.callback = callback;
      this.opts = opts;
      this.targets = new Set();
      io.push(this);
    }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  });
  define("setInterval", (callback) => { const id = env.nextInterval++; env.intervals.set(id, callback); return id; });
  define("clearInterval", (id) => env.intervals.delete(id));

  const props = new Map(enhanced.map((uid) => [uid, { ":plexus": { ":v": 2 } }]));
  const writes = { createBlock: [], openBlock: [], setOpen: [], other: 0 };
  const host = {
    api: {
      data: {
        pull(pattern, ref) {
          if (pattern.startsWith("[:block/open")) return env.openState?.[ref[1]] ?? null;
          if (pattern === "[:block/props]") return { ":block/props": props.get(ref[1]) ?? null };
          return null;
        },
      },
      ui: {
        getFocusedBlock: () => null,
        rightSidebar: { getWindows: () => env.windows },
      },
    },
    stats: { writes: 0, watches: 0, renders: 0, pageWatches: 0 },
    pageUid: () => null,
    blockString: () => null,
    q: () => [],
    generateUid: () => "newBoard01",
    createBlock: async (args) => { writes.createBlock.push(args); env.editTime += 1; return args.uid; },
    openBlock: async (uid) => { writes.openBlock.push(uid); env.editTime += 1; },
    setOpen: async (uid, open) => { writes.setOpen.push([uid, open]); env.editTime += 1; },
  };
  const sessions = { acquired: 0, released: 0 };
  const acquireSession = (uid) => {
    sessions.acquired += 1;
    const session = {
      uid,
      board: { enhanced: true, uid, items: new Map() },
      on: () => () => {},
      release: () => { sessions.released += 1; },
    };
    return session;
  };
  const views = [];
  const mountView = (args) => {
    const root = doc.createElement("div");
    root.cls.add("pxd-root");
    const area = doc.createElement("textarea");
    root.append(area);
    args.mountEl.append(root);
    host.stats.pageWatches += WATCHES;
    let dropped = false;
    const view = {
      args,
      root,
      area,
      cam: { x: 0, y: 0, zoom: 1 },
      disposed: 0,
      viewport() { return this.cam; },
      dispose() {
        if (dropped) return;
        dropped = true;
        this.disposed += 1;
        root.remove();
        host.stats.pageWatches -= WATCHES;
      },
    };
    views.push(view);
    return view;
  };
  const registry = () => ({ addCommand: async () => {}, removeCommand: async () => {} });
  const extensionAPI = {
    settings: { get: () => null },
    ui: { commandPalette: registry(), slashCommand: registry(), blockContextMenu: registry() },
    platform: { isMobile: () => false },
  };
  const storageMap = new Map();
  const storage = {
    getItem: (k) => storageMap.get(k) ?? null,
    setItem: (k, v) => { storageMap.set(k, String(v)); },
  };
  const lifecycle = createLifecycle();
  const tick = () => { for (const callback of [...env.intervals.values()]) callback(); };
  const fire = (target, isIntersecting) => {
    for (const obs of io) {
      if (obs.targets.has(target)) obs.callback([{ target, isIntersecting }]);
    }
  };
  const restore = () => {
    for (const key of globals) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  };
  return {
    env, doc, host, writes, sessions, views, lifecycle, tick, fire, restore,
    install: () => installPlexusDiagram({ extensionAPI, lifecycle, version: "x", mountView, host, acquireSession, storage }),
  };
}

async function withEnv(options, fn) {
  const ctx = setup(options);
  try {
    await fn(ctx);
  } finally {
    await ctx.lifecycle.dispose().catch(() => {});
    ctx.restore();
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const rootIn = (mountEl) => mountEl.querySelector(".pxd-root");
const gapOf = (mountEl) => Number.parseFloat(mountEl.style.minHeight);

test("a scrolled-away board drops its canvas and keeps a gap; the other board stays", async () => {
  await withEnv({ enhanced: ["boardAAA1", "boardBBB2"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    addNative(t.doc, "boardBBB2");
    await t.install();
    assert.equal(t.env.io.length, 1);
    assert.equal(t.env.io[0].opts.rootMargin, "60px");
    assert.equal(t.views.length, 2);
    assert.equal(t.host.stats.pageWatches, WATCHES * 2);
    const first = t.views[0].args.mountEl;
    const second = t.views[1].args.mountEl;
    first.box = { x: 0, y: 0, width: 400, height: 80, top: 0, left: 0, right: 400, bottom: 80 };
    t.fire(first, false);
    assert.equal(rootIn(first), null);
    assert.ok(gapOf(first) >= 40);
    assert.equal(gapOf(first), 80);
    assert.equal(t.host.stats.pageWatches, WATCHES);
    assert.ok(rootIn(second));
    assert.equal(t.views[1].disposed, 0);
    t.tick();
    assert.equal(rootIn(first), null, "reconcile does not rebuild a board that is still off screen");
    assert.ok(rootIn(second));
  });
});

test("scrolling a parked board back restores the canvas and the in-memory camera", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    await t.install();
    const view = t.views[0];
    const shot = { x: 80, y: -15, zoom: 0.5 };
    view.cam.x = shot.x;
    view.cam.y = shot.y;
    view.cam.zoom = shot.zoom;
    const mountEl = view.args.mountEl;
    mountEl.box = { x: 0, y: 0, width: 400, height: 220, top: 0, left: 0, right: 400, bottom: 220 };
    t.fire(mountEl, false);
    assert.equal(rootIn(mountEl), null);
    view.cam.x = 999;
    t.fire(mountEl, true);
    const again = t.views.at(-1);
    assert.ok(rootIn(mountEl));
    assert.equal(again.args.mountEl, mountEl);
    assert.deepEqual(again.args.initialViewport, shot);
    assert.equal(mountEl.style.minHeight, "");
    assert.equal(t.host.stats.pageWatches, WATCHES);
    t.tick();
    assert.ok(rootIn(mountEl));
  });
});

test("collapsing the sidebar window parks that board until the window expands", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    const side = t.doc.createElement("div");
    side.id = "right-sidebar";
    t.doc.body.append(side);
    const win = t.doc.createElement("div");
    win.cls.add("rm-sidebar-window");
    win.id = "sidebar-window-sidebar-block-boardAAA1";
    side.append(win);
    const { native } = addNative(t.doc, "boardAAA1", { parent: win });
    await t.install();
    const mountEl = native.parentElement.children[native.parentElement.children.indexOf(native) + 1];
    assert.equal(t.views.length, 0);
    assert.equal(rootIn(mountEl), null);
    t.fire(mountEl, true);
    assert.ok(rootIn(mountEl));
    assert.equal(t.host.stats.pageWatches, WATCHES);
    win.classList.add("rm-sidebar-window--collapsed");
    t.tick();
    assert.equal(rootIn(mountEl), null);
    assert.equal(t.host.stats.pageWatches, 0);
    win.classList.remove("rm-sidebar-window--collapsed");
    t.tick();
    assert.ok(rootIn(mountEl));
    assert.equal(t.host.stats.pageWatches, WATCHES);
  });
});

test("a collapsed sidebar window parks from its header caret, with no Roam API call", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    const side = t.doc.createElement("div");
    side.id = "right-sidebar";
    t.doc.body.append(side);
    const win = t.doc.createElement("div");
    win.cls.add("rm-sidebar-window");
    win.id = "sidebar-window-sidebar-block-boardAAA1";
    const head = t.doc.createElement("div");
    head.cls.add("window-headers");
    const caret = t.doc.createElement("span");
    caret.cls.add("rm-caret");
    caret.cls.add("rm-caret-open");
    head.append(caret);
    win.append(head);
    side.append(win);
    const { native } = addNative(t.doc, "boardAAA1", { parent: win });
    await t.install();
    const mountEl = native.parentElement.children[native.parentElement.children.indexOf(native) + 1];
    t.fire(mountEl, true);
    assert.ok(rootIn(mountEl));
    t.env.windows = [{ "window-id": win.id, collapsed: true }];
    t.tick();
    assert.ok(rootIn(mountEl), "getWindows is not consulted");
    caret.classList.remove("rm-caret-open");
    caret.classList.add("rm-caret-closed");
    t.tick();
    assert.equal(rootIn(mountEl), null);
    caret.classList.remove("rm-caret-closed");
    caret.classList.add("rm-caret-open");
    t.tick();
    assert.ok(rootIn(mountEl));
    win.classList.add("collapsed");
    t.tick();
    assert.equal(rootIn(mountEl), null);
    win.classList.remove("collapsed");
    t.tick();
    assert.ok(rootIn(mountEl));
  });
});

test("closing an ancestor block drops that board's page watches and reopening brings them back", async () => {
  await withEnv({ enhanced: ["boardAAA1", "boardBBB2"] }, async (t) => {
    const outer = addBlock(t.doc, "parentCCC1");
    const board = addBoard(t.doc, "boardAAA1", { parent: outer.kids });
    addNative(t.doc, "boardBBB2");
    await t.install();
    const mountEl = t.views.find((view) => view.args.session.uid === "boardAAA1").args.mountEl;
    const other = t.views.find((view) => view.args.session.uid === "boardBBB2").args.mountEl;
    assert.equal(t.host.stats.pageWatches, WATCHES * 2);
    assert.ok(rootIn(mountEl));
    board.container.classList.add("rm-block--closed");
    t.tick();
    assert.ok(rootIn(mountEl), "the board's own closed block is its outline, not a park");
    assert.equal(t.host.stats.pageWatches, WATCHES * 2);
    const ownBullet = t.doc.createElement("span");
    ownBullet.classList.add("rm-bullet", "rm-bullet--closed");
    board.main.append(ownBullet);
    t.tick();
    assert.ok(rootIn(mountEl));
    ownBullet.remove();
    outer.container.classList.add("rm-block--closed");
    t.tick();
    assert.equal(rootIn(mountEl), null);
    assert.equal(t.host.stats.pageWatches, WATCHES);
    assert.ok(rootIn(other));
    outer.container.classList.remove("rm-block--closed");
    t.tick();
    assert.ok(rootIn(mountEl));
    assert.equal(t.host.stats.pageWatches, WATCHES * 2);
    const bullet = t.doc.createElement("span");
    bullet.classList.add("rm-bullet", "rm-bullet--closed");
    outer.main.append(bullet);
    t.tick();
    assert.equal(rootIn(mountEl), null);
    assert.equal(t.host.stats.pageWatches, WATCHES);
    bullet.remove();
    t.tick();
    assert.ok(rootIn(mountEl));
    const caret = t.doc.createElement("span");
    caret.classList.add("rm-caret-closed");
    outer.main.append(caret);
    t.tick();
    assert.equal(rootIn(mountEl), null);
    assert.equal(t.host.stats.pageWatches, WATCHES);
    caret.remove();
    t.tick();
    assert.ok(rootIn(mountEl));
    assert.equal(t.host.stats.pageWatches, WATCHES * 2);
    assert.ok(rootIn(other));
  });
});

test("a board mounted under an already closed ancestor stays parked until that block opens", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    const outer = addBlock(t.doc, "parentCCC1");
    outer.container.classList.add("rm-block--closed");
    addBoard(t.doc, "boardAAA1", { parent: outer.kids });
    await t.install();
    const mountEl = t.doc.querySelector(".pxd-mount");
    assert.equal(rootIn(mountEl), null);
    assert.equal(t.host.stats.pageWatches, 0);
    assert.ok(gapOf(mountEl) >= 40);
    outer.container.classList.remove("rm-block--closed");
    t.tick();
    assert.ok(rootIn(mountEl));
    assert.equal(t.host.stats.pageWatches, WATCHES);
  });
});

test("a board that holds the focused textarea keeps its canvas while a sibling parks", async () => {
  await withEnv({ enhanced: ["boardAAA1", "boardBBB2"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    addNative(t.doc, "boardBBB2");
    await t.install();
    const focused = t.views[0];
    const other = t.views[1];
    t.doc.activeElement = focused.area;
    t.fire(focused.args.mountEl, false);
    t.fire(other.args.mountEl, false);
    assert.ok(rootIn(focused.args.mountEl));
    assert.equal(focused.disposed, 0);
    assert.equal(rootIn(other.args.mountEl), null);
    assert.equal(t.host.stats.pageWatches, WATCHES);
    t.tick();
    assert.ok(rootIn(focused.args.mountEl));
    t.doc.activeElement = t.doc.body;
    t.fire(focused.args.mountEl, false);
    assert.equal(rootIn(focused.args.mountEl), null);
    assert.equal(t.host.stats.pageWatches, 0);
  });
});

test("fullscreen stays awake when the board is scrolled out of view", async () => {
  await withEnv({ enhanced: ["boardAAA1"], hash: "#/app/g/page/boardAAA1" }, async (t) => {
    addNative(t.doc, "boardAAA1");
    await t.install();
    assert.equal(t.env.win.__plexusDiagram.mounts()[0].fullscreen, true);
    const mountEl = t.views[0].args.mountEl;
    t.fire(mountEl, false);
    t.tick();
    assert.ok(rootIn(mountEl));
    assert.equal(t.views[0].disposed, 0);
    assert.equal(t.host.stats.pageWatches, WATCHES);
  });
});

test("park and wake do not write, so the board block's edit time stays put", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    t.env.openState = { boardAAA1: { ":block/open": true } };
    await t.install();
    await settle();
    assert.equal(t.writes.setOpen.length, 1);
    assert.deepEqual(t.writes.setOpen[0], ["boardAAA1", false]);
    const editTime = t.env.editTime;
    const writes = t.writes.setOpen.length;
    const mountEl = t.views[0].args.mountEl;
    mountEl.box = { x: 0, y: 0, width: 400, height: 80, top: 0, left: 0, right: 400, bottom: 80 };
    t.fire(mountEl, false);
    t.fire(mountEl, true);
    await settle();
    t.tick();
    await settle();
    assert.equal(t.env.editTime, editTime);
    assert.equal(t.writes.setOpen.length, writes);
    assert.equal(t.writes.createBlock.length, 0);
    assert.equal(t.writes.openBlock.length, 0);
    assert.ok(rootIn(mountEl));
  });
});

test("opening the right sidebar stays parked across reconcile", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    const article = t.doc.createElement("div");
    article.cls.add("rm-article-wrapper");
    t.doc.app.append(article);
    addNative(t.doc, "boardAAA1", { parent: article });
    await t.install();
    const mountEl = t.views[0].args.mountEl;
    t.fire(mountEl, true);
    assert.equal(t.views.length, 1);
    const watch = [...t.env.observers].find((observer) => observer.target === article);
    assert.ok(watch);
    article.classList.add("rm-spacing--right-sidebar-open");
    watch.callback();
    assert.equal(t.views[0].disposed, 1);
    assert.equal(rootIn(mountEl), null);
    t.tick();
    assert.equal(t.views.length, 1);
    assert.equal(rootIn(mountEl), null);
    assert.equal(t.host.stats.pageWatches, 0);
  });
});

// FAST-5: navigate detaches the last two canvases. Parking still disposes them.
import assert from "node:assert/strict";
import test from "node:test";

import { createLifecycle } from "../src/lifecycle.js";
import { installPlexusDiagram } from "../src/feature.js";
import { sketchKey } from "../src/view/sketch.js";

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

function setup({ enhanced = [], speedLog = false } = {}) {
  const saved = {};
  const globals = ["document", "window", "location", "MutationObserver", "IntersectionObserver", "PerformanceObserver", "setInterval", "clearInterval"];
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
  const env = { doc, win, io, observers: new Set(), intervals: new Map(), nextInterval: 1, editTime: 5000 };
  define("document", doc);
  define("window", win);
  define("location", { hash: "#/app/Svy/page" });
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
  define("PerformanceObserver", class {
    observe() {}
    disconnect() {}
  });
  define("setInterval", (callback) => { const id = env.nextInterval++; env.intervals.set(id, callback); return id; });
  define("clearInterval", (id) => env.intervals.delete(id));

  const props = new Map(enhanced.map((uid) => [uid, { ":plexus": { ":v": 2 }, ":edit/time": 5000 }]));
  const writes = { createBlock: [], openBlock: [], setOpen: [] };
  const created = [];
  const releases = [];
  const pulls = [];
  const sessions = new Map();
  const acquireSession = (uid) => {
    const hit = sessions.get(uid);
    if (hit && hit.refs > 0) {
      hit.refs += 1;
      hit.session.retain();
      return hit.session;
    }
    created.push(uid);
    const handlers = new Set();
    const record = { refs: 1, pausedHolds: 0, watchOff: false };
    const session = {
      uid,
      pending: false,
      board: { uid, enhanced: true, virtual: false, items: new Map(), rev: 0 },
      rebuilds: 0,
      on(name, fn) {
        if (name !== "change") return () => {};
        handlers.add(fn);
        return () => handlers.delete(fn);
      },
      emitChange() {
        session.board = { ...session.board, rev: session.board.rev + 1 };
        session.rebuilds += 1;
        for (const fn of handlers) fn({ structural: true });
      },
      retain() { record.refs += 1; },
      pauseWatches() {
        if (record.pausedHolds >= record.refs) return;
        record.pausedHolds += 1;
        if (record.pausedHolds >= record.refs && !record.watchOff) {
          record.watchOff = true;
          host.stats.watches -= 1;
        }
      },
      resumeWatches() {
        pulls.push(uid);
        if (record.pausedHolds > 0) record.pausedHolds -= 1;
        if (record.pausedHolds < record.refs && record.watchOff) {
          record.watchOff = false;
          host.stats.watches += 1;
        }
        if (session.pending) {
          session.pending = false;
          session.emitChange();
        }
      },
      release(opts) {
        if (record.refs <= 0) return;
        if (opts?.paused === true && record.pausedHolds > 0) record.pausedHolds -= 1;
        record.refs -= 1;
        releases.push({ uid, paused: opts?.paused === true });
        if (record.refs <= 0) {
          if (!record.watchOff) host.stats.watches -= 1;
          record.watchOff = true;
          sessions.delete(uid);
          return;
        }
        if (record.pausedHolds >= record.refs && !record.watchOff) {
          record.watchOff = true;
          host.stats.watches -= 1;
        }
      },
    };
    host.stats.watches += 1;
    sessions.set(uid, { refs: record.refs, session, record });
    // retain/release mutate `record`, which is the same object sessions stores.
    sessions.get(uid).refs = record.refs;
    return session;
  };
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
    stats: { writes: 0, watches: 0, renders: 0, pageWatches: 0 },
    blockString: () => null,
    q: () => [],
    renderBlock() { host.stats.renders += 1; },
    generateUid: () => "newBoard01",
    createBlock: async (args) => { writes.createBlock.push(args); env.editTime += 1; return args.uid; },
    openBlock: async (uid) => { writes.openBlock.push(uid); env.editTime += 1; },
    setOpen: async (uid, open) => { writes.setOpen.push([uid, open]); env.editTime += 1; },
  };
  const views = [];
  const mountView = (args) => {
    const root = doc.createElement("div");
    root.cls.add("pxd-root");
    const item = doc.createElement("div");
    item.cls.add("pxd-item");
    root.append(item);
    const area = doc.createElement("textarea");
    root.append(area);
    args.mountEl.append(root);
    host.renderBlock(item, args.session?.uid);
    const observer = { connected: false, target: null, observe(target) { this.connected = true; this.target = target; }, disconnect() { this.connected = false; this.target = null; } };
    observer.observe(root);
    let rebuilds = 0;
    args.session.on?.("change", () => { rebuilds += 1; });
    const gate = { suspended: false };
    const hits = { key: 0, pointer: 0, wheel: 0 };
    const onKey = () => { if (gate.suspended) return; hits.key += 1; };
    const onPointer = () => { if (gate.suspended) return; hits.pointer += 1; };
    const onWheel = () => { if (gate.suspended) return; hits.wheel += 1; };
    win.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onPointer, true);
    doc.addEventListener("wheel", onWheel, true);
    const view = {
      args,
      root,
      area,
      observer,
      hits,
      raf: 1,
      disposed: 0,
      suspended: false,
      cam: { x: 12, y: 34, zoom: 1 },
      restored: null,
      rebuilds: () => rebuilds,
      viewport() { return this.cam; },
      restoreViewport(next) { this.restored = next; },
      suspend() {
        gate.suspended = true;
        this.suspended = true;
        this.raf = 0;
        observer.disconnect();
      },
      resume() {
        gate.suspended = false;
        this.suspended = false;
        this.raf = 1;
        observer.observe(root);
      },
      dispose() {
        this.disposed += 1;
        this.raf = 0;
        observer.disconnect();
        win.removeEventListener("keydown", onKey, true);
        doc.removeEventListener("pointerdown", onPointer, true);
        doc.removeEventListener("wheel", onWheel, true);
        root.remove();
      },
      setFullscreen(on) { (view.fullscreenCalls ||= []).push(on); },
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
    "speed-log": speedLog,
  };
  const extensionAPI = {
    settings: { get: (id) => (Object.hasOwn(values, id) ? values[id] : null) },
    ui: { commandPalette: registry(), slashCommand: registry(), blockContextMenu: registry() },
    platform: { isMobile: () => false },
  };
  const storageMap = new Map();
  const storage = {
    getItem: (key) => storageMap.get(key) ?? null,
    setItem: (key, value) => { storageMap.set(key, String(value)); },
  };
  const lifecycle = createLifecycle();
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
    env, doc, win, winListeners: listeners, host, writes, created, releases, pulls, views, props, storage, storageMap, lifecycle, fire, restore,
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
const BOARDS = ["boardAAA1", "boardBBB2", "boardCCC3", "boardDDD4"];

async function openBoards() {
  const ctx = setup({ enhanced: BOARDS });
  addNative(ctx.doc, "boardAAA1");
  await ctx.install();
  return ctx;
}

async function go(view, uid) {
  view.args.onOpenBoard(uid);
  await settle();
}

test("navigating A to B to C detaches A and B and mounts C once", async () => {
  const t = await openBoards();
  try {
    const mount = t.views[0].args.mountEl;
    const rootA = t.views[0].root;
    await go(t.views[0], "boardBBB2");
    const rootB = t.views[1].root;
    await go(t.views[1], "boardCCC3");
    assert.equal(t.views.length, 3, "mountRecView ran for C and not again for A or B");
    assert.equal(t.created.filter((uid) => uid === "boardAAA1").length, 1);
    assert.equal(t.created.filter((uid) => uid === "boardBBB2").length, 1);
    assert.equal(t.views[0].disposed, 0);
    assert.equal(t.views[1].disposed, 0);
    assert.equal(t.views[2].disposed, 0);
    assert.equal(rootA.isConnected, false);
    assert.equal(rootB.isConnected, false);
    assert.equal(t.views[0].suspended, true);
    assert.equal(t.views[0].raf, 0);
    assert.equal(t.views[0].observer.connected, false);
    assert.equal(t.views[1].observer.connected, false);
    assert.equal(mount.querySelector(".pxd-root"), t.views[2].root);
    assert.equal(t.doc.querySelectorAll(".pxd-root").length, 1);
    assert.equal(t.host.stats.watches, 1, "detached pull watches are paused");
    assert.equal(t.releases.length, 0);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("navigating back reattaches the same root and does not create the session again", async () => {
  const t = await openBoards();
  try {
    const rootA = t.views[0].root;
    await go(t.views[0], "boardBBB2");
    await go(t.views[1], "boardCCC3");
    const created = t.created.length;
    t.views[2].args.onCrumb(0);
    await settle();
    assert.equal(t.views.length, 3);
    assert.equal(t.created.length, created);
    assert.equal(t.created.filter((uid) => uid === "boardAAA1").length, 1);
    assert.equal(mountOf(t), rootA.parentElement);
    assert.equal(rootA.isConnected, true);
    assert.equal(t.views[0].suspended, false);
    assert.equal(t.views[0].raf, 1);
    assert.equal(t.views[0].observer.connected, true);
    assert.equal(t.views[0].disposed, 0);
    assert.deepEqual(t.pulls, ["boardAAA1"]);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("a kept board reattaches without a sketch or a second mount", async () => {
  const t = await openBoards();
  try {
    await go(t.views[0], "boardBBB2");
    t.storage.setItem(sketchKey("Svy", "boardAAA1"), JSON.stringify({
      items: [{ uid: "cardAAAA1", x: 10, y: 24, w: 280, h: 80, title: "Cached" }],
      edges: [],
    }));
    t.views[1].args.onCrumb(0);
    await settle();
    assert.equal(t.views.length, 2);
    assert.equal(mountOf(t).querySelector(".pxd-sketch"), null);
    assert.ok(mountOf(t).querySelector(".pxd-item"));
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("an instant reattach records its own open sample", async () => {
  const t = setup({ enhanced: BOARDS, speedLog: true });
  addNative(t.doc, "boardAAA1");
  try {
    await t.install();
    assert.equal(t.host.stats.perf.open.n, 1);
    await go(t.views[0], "boardBBB2");
    const before = t.host.stats.perf.open.n;
    t.views[1].args.onCrumb(0);
    await settle();
    assert.equal(t.views.length, 2);
    assert.equal(t.host.stats.perf.open.n, before + 1);
    assert.equal(typeof t.host.stats.perf.open.p50, "number");
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("reattach applies one pull and does not rebuild when nothing changed", async () => {
  const t = await openBoards();
  try {
    await go(t.views[0], "boardBBB2");
    t.views[1].args.onCrumb(0);
    await settle();
    assert.deepEqual(t.pulls, ["boardAAA1"]);
    assert.equal(t.views[0].rebuilds(), 0);
    assert.equal(t.views.length, 2);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("a change that arrived while detached is applied on reattach, not by mounting again", async () => {
  const t = await openBoards();
  try {
    const sessionA = t.views[0].args.session;
    await go(t.views[0], "boardBBB2");
    sessionA.pending = true;
    t.views[1].args.onCrumb(0);
    await settle();
    assert.equal(t.views.length, 2);
    assert.equal(t.views[0].rebuilds(), 1);
    assert.equal(sessionA.board.rev, 1);
    assert.deepEqual(t.pulls, ["boardAAA1"]);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("a fourth distinct board disposes the oldest detached view once", async () => {
  const t = await openBoards();
  try {
    await go(t.views[0], "boardBBB2");
    await go(t.views[1], "boardCCC3");
    await go(t.views[2], "boardDDD4");
    assert.equal(t.views[0].disposed, 1);
    assert.equal(t.views[1].disposed, 0);
    assert.equal(t.views[2].disposed, 0);
    assert.equal(t.views[3].disposed, 0);
    assert.equal(t.views.length, 4);
    const gone = t.releases.filter((row) => row.uid === "boardAAA1");
    assert.equal(gone.length, 1);
    assert.equal(gone[0].paused, true);
    assert.equal(t.releases.length, 1);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("a detached view is disposed at 300000 ms and kept if it reattaches first", async (t) => {
  const env = await openBoards();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await go(env.views[0], "boardBBB2");
    t.mock.timers.tick(299999);
    assert.equal(env.views[0].disposed, 0);
    t.mock.timers.tick(1);
    assert.equal(env.views[0].disposed, 1);
    assert.equal(env.releases.filter((row) => row.uid === "boardAAA1").length, 1);
    assert.equal(env.views[0].root.isConnected, false);

    await go(env.views[1], "boardCCC3");
    const rootB = env.views[1].root;
    t.mock.timers.tick(100000);
    env.views[2].args.onCrumb(1);
    await settle();
    assert.equal(rootB.isConnected, true);
    t.mock.timers.tick(300000);
    assert.equal(env.views[1].disposed, 0, "reattach clears the idle timer");
  } finally {
    t.mock.timers.reset();
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("scrolling the mount away disposes pooled views and drops their watches", async () => {
  const t = await openBoards();
  try {
    const mount = t.views[0].args.mountEl;
    await go(t.views[0], "boardBBB2");
    await go(t.views[1], "boardCCC3");
    assert.equal(t.host.stats.watches, 1);
    mount.box = { x: 0, y: 0, width: 400, height: 80, top: 0, left: 0, right: 400, bottom: 80 };
    t.fire(mount, false);
    assert.equal(mount.querySelector(".pxd-root"), null);
    assert.equal(t.doc.querySelectorAll(".pxd-root").length, 0);
    assert.equal(t.views[0].disposed, 1);
    assert.equal(t.views[1].disposed, 1);
    assert.equal(t.views[2].disposed, 1);
    assert.equal(t.host.stats.watches, 0);
    assert.equal(t.env.editTime, 5000);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("detach and reattach do not change :edit/time", async () => {
  const t = await openBoards();
  try {
    const edit = t.props.get("boardAAA1")[":edit/time"];
    await go(t.views[0], "boardBBB2");
    t.views[1].args.onCrumb(0);
    await settle();
    assert.equal(t.props.get("boardAAA1")[":edit/time"], edit);
    assert.equal(t.props.get("boardBBB2")[":edit/time"], edit);
    assert.equal(t.env.editTime, 5000);
    assert.equal(t.writes.createBlock.length, 0);
    assert.equal(t.writes.openBlock.length, 0);
    assert.equal(t.writes.setOpen.length, 0);
    assert.equal(t.host.stats.writes, 0);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("a fullscreen mount and a focused mount are disposed instead of detached", async () => {
  const t = await openBoards();
  try {
    t.views[0].args.onRequestFullscreen(true);
    await go(t.views[0], "boardBBB2");
    assert.equal(t.views[0].disposed, 1);
    assert.equal(t.releases.filter((row) => row.uid === "boardAAA1" && row.paused === false).length, 1);

    t.views[1].args.onRequestFullscreen(false);
    t.doc.activeElement = t.views[1].area;
    await go(t.views[1], "boardCCC3");
    assert.equal(t.views[1].disposed, 1);
    assert.equal(t.views[1].root.isConnected, false);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("the main column and the sidebar do not share a view, and parking does not keep one", async () => {
  const t = setup({ enhanced: ["boardAAA1", "boardBBB2"] });
  try {
    addNative(t.doc, "boardAAA1");
    const side = t.doc.createElement("div");
    side.id = "right-sidebar";
    t.doc.body.append(side);
    const placed = addNative(t.doc, "boardAAA1", { parent: side });
    await t.install();
    const main = t.views[0];
    const sideMount = placed.native.parentElement.children[placed.native.parentElement.children.indexOf(placed.native) + 1];
    t.fire(sideMount, true);
    const sideView = t.views[1];
    assert.notEqual(main.root, sideView.root);
    assert.equal(main.args.session.uid, sideView.args.session.uid);
    await go(main, "boardBBB2");
    assert.equal(main.root.isConnected, false);
    assert.equal(sideView.root.isConnected, true);
    assert.equal(sideView.root.parentElement, sideMount);
    assert.notEqual(main.root, sideView.root);
    const mount = main.args.mountEl;
    mount.box = { x: 0, y: 0, width: 400, height: 80, top: 0, left: 0, right: 400, bottom: 80 };
    t.fire(mount, false);
    assert.equal(main.disposed, 1, "a parked board is not kept alive as well");
    assert.equal(mount.querySelector(".pxd-root"), null);
    assert.equal(sideView.disposed, 0);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

function mountOf(t) {
  return t.views[0].args.mountEl;
}

function runIntervals(t) {
  for (const cb of [...t.env.intervals.values()]) cb();
}

function leaveNative(t, native) {
  native.remove();
  runIntervals(t);
}

function arrive(t, uid, parent = t.doc.app) {
  const placed = addNative(t.doc, uid, { parent });
  runIntervals(t);
  return placed;
}

function poke(t) {
  const ev = () => ({});
  for (const fn of [...(t.winListeners.get("keydown") || [])]) fn(ev());
  for (const fn of [...(t.doc.listeners.get("pointerdown") || [])]) fn(ev());
  for (const fn of [...(t.doc.listeners.get("wheel") || [])]) fn(ev());
}

function diagramNative(parent) {
  return parent.children.find((node) => node.classList?.contains?.("rm-diagram")) || null;
}

test("a page change pools the board instead of disposing it", async () => {
  const t = await openBoards();
  try {
    const view = t.views[0];
    const native = diagramNative(t.doc.app);
    leaveNative(t, native);
    assert.equal(view.disposed, 0);
    assert.equal(view.suspended, true);
    assert.equal(view.raf, 0);
    assert.equal(view.observer.connected, false);
    assert.equal(view.root.isConnected, false);
    assert.equal(t.doc.querySelectorAll(".pxd-root").length, 0);
    assert.equal(t.releases.length, 0);
    assert.equal(t.host.stats.watches, 0);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("returning to the page reattaches the same view without mounting again", async () => {
  const t = setup({ enhanced: BOARDS, speedLog: true });
  addNative(t.doc, "boardAAA1");
  try {
    await t.install();
    const view = t.views[0];
    const renders = t.host.stats.renders;
    const created = t.created.length;
    const opened = t.host.stats.perf.open.n;
    assert.equal(renders, 1);
    assert.equal(opened, 1);
    leaveNative(t, diagramNative(t.doc.app));
    const placed = arrive(t, "boardAAA1");
    assert.equal(t.views.length, 1);
    assert.equal(t.created.length, created);
    assert.equal(t.host.stats.renders, renders);
    assert.equal(view.disposed, 0);
    assert.equal(view.suspended, false);
    assert.equal(view.root.isConnected, true);
    assert.equal(view.root.parentElement, placed.native.parentElement.children[placed.native.parentElement.children.indexOf(placed.native) + 1]);
    assert.equal(view.root.parentElement.querySelector(".pxd-sketch"), null);
    assert.ok(view.root.parentElement.querySelector(".pxd-item"));
    assert.deepEqual(view.restored, { x: 12, y: 34, zoom: 1 });
    assert.equal(t.host.stats.perf.open.n, opened + 1);
    assert.deepEqual(t.pulls, ["boardAAA1"]);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("a pooled view ignores key, pointer, and wheel until it is back", async () => {
  const t = await openBoards();
  try {
    const view = t.views[0];
    poke(t);
    assert.deepEqual(view.hits, { key: 1, pointer: 1, wheel: 1 });
    leaveNative(t, diagramNative(t.doc.app));
    poke(t);
    assert.deepEqual(view.hits, { key: 1, pointer: 1, wheel: 1 });
    arrive(t, "boardAAA1");
    poke(t);
    assert.deepEqual(view.hits, { key: 2, pointer: 2, wheel: 2 });
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("a third pooled board disposes the oldest", async () => {
  const t = await openBoards();
  try {
    leaveNative(t, diagramNative(t.doc.app));
    arrive(t, "boardBBB2");
    leaveNative(t, diagramNative(t.doc.app));
    arrive(t, "boardCCC3");
    leaveNative(t, diagramNative(t.doc.app));
    assert.equal(t.views[0].disposed, 1);
    assert.equal(t.views[1].disposed, 0);
    assert.equal(t.views[2].disposed, 0);
    assert.equal(t.views[0].root.isConnected, false);
    assert.equal(t.views[1].root.isConnected, false);
    assert.equal(t.views[2].root.isConnected, false);
    const gone = t.releases.filter((row) => row.uid === "boardAAA1");
    assert.equal(gone.length, 1);
    assert.equal(gone[0].paused, true);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("a pooled board is disposed after 300000 ms of idle", async (t) => {
  const env = await openBoards();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    leaveNative(env, diagramNative(env.doc.app));
    t.mock.timers.tick(299999);
    assert.equal(env.views[0].disposed, 0);
    t.mock.timers.tick(1);
    assert.equal(env.views[0].disposed, 1);
    assert.equal(env.releases.filter((row) => row.uid === "boardAAA1" && row.paused === true).length, 1);

    arrive(env, "boardBBB2");
    leaveNative(env, diagramNative(env.doc.app));
    t.mock.timers.tick(100000);
    arrive(env, "boardBBB2");
    assert.equal(env.views[1].disposed, 0);
    assert.equal(env.views[1].root.isConnected, true);
    t.mock.timers.tick(300000);
    assert.equal(env.views[1].disposed, 0, "return clears the idle timer");
  } finally {
    t.mock.timers.reset();
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("a change that arrived while pooled is applied on return", async () => {
  const t = await openBoards();
  try {
    const session = t.views[0].args.session;
    leaveNative(t, diagramNative(t.doc.app));
    session.pending = true;
    arrive(t, "boardAAA1");
    assert.equal(t.views.length, 1);
    assert.equal(t.views[0].rebuilds(), 1);
    assert.equal(session.board.rev, 1);
    assert.deepEqual(t.pulls, ["boardAAA1"]);
    assert.equal(t.host.stats.renders, 1);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("the main column and the sidebar keep separate pooled views", async () => {
  const t = setup({ enhanced: ["boardAAA1", "boardBBB2"] });
  try {
    addNative(t.doc, "boardAAA1");
    const side = t.doc.createElement("div");
    side.id = "right-sidebar";
    t.doc.body.append(side);
    const placed = addNative(t.doc, "boardAAA1", { parent: side });
    await t.install();
    const sideMount = placed.native.parentElement.children[placed.native.parentElement.children.indexOf(placed.native) + 1];
    t.fire(sideMount, true);
    const main = t.views[0];
    const sideView = t.views[1];
    assert.notEqual(main.root, sideView.root);
    leaveNative(t, diagramNative(t.doc.app));
    assert.equal(main.disposed, 0);
    assert.equal(main.suspended, true);
    assert.equal(sideView.disposed, 0);
    assert.equal(sideView.root.isConnected, true);
    leaveNative(t, placed.native);
    assert.equal(sideView.disposed, 0);
    assert.equal(sideView.suspended, true);
    assert.equal(main.disposed, 0);
    arrive(t, "boardAAA1");
    assert.equal(t.views.length, 2);
    assert.equal(main.root.isConnected, true);
    assert.equal(main.suspended, false);
    assert.equal(sideView.suspended, true);
    assert.equal(sideView.root.isConnected, false);
    const again = arrive(t, "boardAAA1", side);
    const nextMount = again.native.parentElement.children[again.native.parentElement.children.indexOf(again.native) + 1];
    t.fire(nextMount, true);
    assert.equal(t.views.length, 2);
    assert.equal(sideView.root.isConnected, true);
    assert.equal(sideView.suspended, false);
    assert.equal(sideView.root.parentElement, nextMount);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("an embed and the main column do not share a pooled view", async () => {
  const t = setup({ enhanced: ["boardAAA1"] });
  try {
    addNative(t.doc, "boardAAA1");
    const wrap = t.doc.createElement("div");
    wrap.cls.add("rm-embed-container");
    t.doc.app.append(wrap);
    const placed = addNative(t.doc, "boardAAA1", { parent: wrap });
    placed.native.closestMap[".rm-embed-container"] = wrap;
    await t.install();
    const main = t.views[0];
    const embed = t.views[1];
    assert.notEqual(main.root, embed.root);
    leaveNative(t, diagramNative(t.doc.app));
    assert.equal(main.disposed, 0);
    assert.equal(main.suspended, true);
    assert.equal(embed.root.isConnected, true);
    leaveNative(t, placed.native);
    assert.equal(embed.disposed, 0);
    assert.equal(embed.suspended, true);
    assert.equal(main.disposed, 0);
    arrive(t, "boardAAA1");
    assert.equal(main.suspended, false);
    assert.equal(main.root.isConnected, true);
    assert.equal(embed.suspended, true);
    assert.equal(t.views.length, 2);
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("a fullscreen board leaves fullscreen on page leave and is kept", async () => {
  const t = await openBoards();
  try {
    t.views[0].args.onRequestFullscreen(true);
    leaveNative(t, diagramNative(t.doc.app));
    assert.equal(t.views[0].disposed, 0, "a zoomed board is pooled like any other");
    assert.deepEqual(t.views[0].fullscreenCalls?.slice(-1), [false], "fullscreen is left before the board is pooled");
    arrive(t, "boardAAA1");
    assert.equal(t.views.length, 1, "coming back reattaches the same view");
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("feature unload disposes the pool", async () => {
  const t = await openBoards();
  try {
    const view = t.views[0];
    leaveNative(t, diagramNative(t.doc.app));
    assert.equal(view.disposed, 0);
    await t.lifecycle.dispose();
    assert.equal(view.disposed, 1);
    assert.equal(view.root.isConnected, false);
    assert.equal(t.releases.filter((row) => row.uid === "boardAAA1" && row.paused === true).length, 1);
  } finally {
    t.restore();
  }
});

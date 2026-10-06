// HUNT-5: typing outside an on-screen board quiets it and leaves it mounted.
// Off-screen boards still park through the viewport observer. A diagram that
// was already classified is not pulled again on every reconcile.
import assert from "node:assert/strict";
import test from "node:test";

import { createLifecycle } from "../src/lifecycle.js";
import { installPlexusDiagram } from "../src/feature.js";

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

function setup({ enhanced = [], hash = "", settings = {} } = {}) {
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
  const env = { doc, win, hash, io, intervals: new Map(), nextInterval: 1, pulls: [] };
  define("document", doc);
  define("window", win);
  define("location", { hash });
  define("MutationObserver", class {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.target = target; }
    disconnect() {}
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
  const strings = new Map();
  const host = {
    api: {
      data: {
        pull(pattern, ref) {
          env.pulls.push(pattern);
          if (pattern.startsWith("[:block/open")) return null;
          if (pattern === "[:block/props]") return { ":block/props": props.get(ref[1]) ?? null };
          if (String(pattern).startsWith("[:block/props")) return { ":block/props": props.get(ref[1]) ?? null, ":block/children": [] };
          return null;
        },
      },
      ui: { getFocusedBlock: () => null, rightSidebar: { getWindows: () => null } },
    },
    stats: { writes: 0, watches: 0, renders: 0, pageWatches: 0 },
    pageUid: () => null,
    blockString: (uid) => strings.get(uid) ?? null,
    pullNative: (uid) => env.native?.[uid] ?? null,
    q: () => [],
    generateUid: () => "newBoard01",
    createBlock: async () => null,
    openBlock: async () => {},
    setOpen: async () => {},
  };
  const sessions = { acquired: 0, released: 0 };
  const acquireSession = (uid) => {
    sessions.acquired += 1;
    return {
      uid,
      board: { enhanced: true, uid, items: new Map() },
      on: () => () => {},
      release: () => { sessions.released += 1; },
    };
  };
  const views = [];
  const mountView = (args) => {
    const root = doc.createElement("div");
    root.cls.add("pxd-root");
    args.mountEl.append(root);
    const view = {
      args,
      root,
      disposed: 0,
      quietCalls: [],
      quiet(on) { this.quietCalls.push(Boolean(on)); },
      viewport() { return { x: 0, y: 0, zoom: 1 }; },
      dispose() {
        this.disposed += 1;
        root.remove();
      },
    };
    views.push(view);
    return view;
  };
  const registry = () => ({ addCommand: async () => {}, removeCommand: async () => {} });
  const extensionAPI = {
    settings: { get: (id) => (id in settings ? settings[id] : null) },
    ui: { commandPalette: registry(), slashCommand: registry(), blockContextMenu: registry() },
    platform: { isMobile: () => false },
  };
  const storage = { getItem: () => null, setItem: () => {} };
  const lifecycle = createLifecycle();
  const tick = () => { for (const callback of [...env.intervals.values()]) callback(); };
  const fire = (target, isIntersecting) => {
    for (const obs of io) {
      if (obs.targets.has(target)) obs.callback([{ target, isIntersecting }]);
    }
  };
  const emit = (type, target) => {
    for (const fn of doc.listeners.get(type) || []) fn({ type, target });
  };
  const emitWin = (type, event) => {
    for (const fn of listeners.get(type) || []) fn(event);
  };
  const restore = () => {
    for (const key of globals) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  };
  return {
    env, doc, host, strings, sessions, views, lifecycle, tick, fire, emit, emitWin, restore,
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

const propsPulls = (t) => t.env.pulls.filter((pattern) => pattern === "[:block/props]").length;

test("typing in an outside block quiets a visible board and does not dispose it", async () => {
  await withEnv({ enhanced: ["boardAAA1"], hash: "#/app/Svy" }, async (t) => {
    t.strings.set("boardAAA1", "{{[[diagram]]}}");
    addNative(t.doc, "boardAAA1");
    await t.install();
    const view = t.views[0];
    assert.equal(t.sessions.acquired, 1);
    assert.equal(t.sessions.released, 0);
    const outside = t.doc.createElement("textarea");
    t.doc.app.append(outside);
    t.emit("keydown", outside);
    t.emit("input", outside);
    assert.equal(view.disposed, 0);
    assert.equal(t.sessions.released, 0);
    assert.equal(t.sessions.acquired, 1);
    assert.equal(t.views.length, 1);
    assert.ok(view.quietCalls.includes(true), "quiet is requested");
    const inside = t.doc.createElement("textarea");
    view.root.append(inside);
    const before = view.quietCalls.length;
    t.emit("input", inside);
    assert.equal(view.quietCalls.length, before, "typing in the board does not quiet it");
    assert.equal(view.disposed, 0);
    assert.equal(t.sessions.released, 0);
  });
});

test("an off-screen board still parks through the viewport observer", async () => {
  await withEnv({ enhanced: ["boardAAA1"], hash: "#/app/Svy" }, async (t) => {
    t.strings.set("boardAAA1", "{{[[diagram]]}}");
    addNative(t.doc, "boardAAA1");
    await t.install();
    const view = t.views[0];
    const mountEl = view.args.mountEl;
    mountEl.box = { x: 0, y: 0, width: 400, height: 200, top: 900, left: 0, right: 400, bottom: 1100 };
    t.fire(mountEl, false);
    assert.equal(view.disposed, 1);
    assert.equal(t.sessions.released, 1);
    assert.equal(mountEl.querySelector(".pxd-root"), null);
    t.tick();
    assert.equal(t.sessions.acquired, 1, "reconcile does not open a board that is still off screen");
    assert.equal(t.views.length, 1);
  });
});

test("reconcile does not re-pull a classified native diagram", async () => {
  const origNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    await withEnv({ hash: "#/app/Svy", settings: { "auto-enhance": true } }, async (t) => {
      t.strings.set("nativeDD01", "{{[[diagram]]}}");
      t.env.native = { nativeDD01: { ":diagram/nodes": [{ ":db/id": 1 }] } };
      addNative(t.doc, "nativeDD01");
      await t.install();
      assert.equal(t.views.length, 0, "a native diagram with shapes stays native");
      const first = propsPulls(t);
      assert.equal(first, 1);
      for (let i = 0; i < 10; i += 1) {
        now += 2000;
        t.tick();
      }
      assert.ok(propsPulls(t) <= 1, "ten reconciles, two seconds apart, stay inside the 30s classification");
      assert.equal(propsPulls(t), 1);
      t.emitWin("hashchange", { type: "hashchange", newURL: "https://roamresearch.com/#/app/Svy/page/otherPAGE" });
      assert.equal(propsPulls(t), 2, "hashchange clears the classification and reads props again");
      t.emitWin("popstate", { type: "popstate" });
      assert.equal(propsPulls(t), 3, "popstate clears the classification and reads props again");
    });
  } finally {
    Date.now = origNow;
  }
});

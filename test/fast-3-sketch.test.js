import assert from "node:assert/strict";
import test from "node:test";

import { createLifecycle } from "../src/lifecycle.js";
import { installPlexusDiagram } from "../src/feature.js";
import { worldToScreen } from "../src/model/geometry.js";
import {
  SKETCH_DEBOUNCE_MS,
  SKETCH_HOLD_MS,
  SKETCH_MAX_BYTES,
  SKETCH_MAX_ITEMS,
  SKETCH_ROOT_BORDER,
  captureSketch,
  createSketchStore,
  packSketch,
  paintSketch,
  parseSketch,
  removeSketch,
  resolveSketchViewport,
  sketchKey,
  sketchScreenRect,
} from "../src/view/sketch.js";

const UID = "boardAAA1";
const KEY = sketchKey("Svy", UID);

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
    this.handlers = {};
    const cls = this.cls;
    this.classList = {
      add: (...names) => names.forEach((name) => cls.add(name)),
      remove: (...names) => names.forEach((name) => cls.delete(name)),
      contains: (name) => cls.has(name),
    };
  }
  set className(value) {
    this.cls.clear();
    String(value).split(/\s+/).filter(Boolean).forEach((name) => this.cls.add(name));
  }
  get className() { return [...this.cls].join(" "); }
  get isConnected() {
    let node = this;
    while (node.parentElement) node = node.parentElement;
    return node === this.doc.root;
  }
  addEventListener(type, fn) { this.handlers[type] = [...(this.handlers[type] || []), fn]; }
  removeEventListener(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter((one) => one !== fn); }
  dispatchEvent(event) {
    if (event && event.target == null) event.target = this;
    for (const fn of [...(this.handlers[event?.type] || [])]) {
      fn(event);
      if (event?.immediateStopped) break;
    }
    return true;
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name === "class") this.className = String(value);
  }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : name === "class" ? this.className : null; }
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
    if (selector.startsWith(".") && !selector.includes(" ")) return this.cls.has(selector.slice(1));
    if (selector === '[id^="block-input-"]') return this.id.startsWith("block-input-");
    return false;
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
  doc.listeners = new Map();
  doc.addEventListener = (type, fn) => { if (!doc.listeners.has(type)) doc.listeners.set(type, new Set()); doc.listeners.get(type).add(fn); };
  doc.removeEventListener = (type, fn) => doc.listeners.get(type)?.delete(fn);
  doc.createElement = (tag) => new El(doc, tag);
  doc.createElementNS = (_ns, tag) => new El(doc, tag);
  doc.getElementById = (id) => {
    const all = [];
    const walk = (node) => { all.push(node); for (const child of node.children) walk(child); };
    walk(doc.root);
    return all.find((node) => node.id === id) ?? null;
  };
  doc.querySelector = (selector) => doc.root.querySelector(selector);
  doc.querySelectorAll = (selector) => doc.root.querySelectorAll(selector);
  return doc;
}

function memoryStorage(map = new Map()) {
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)); },
  };
}

function card(uid, patch) {
  return {
    uid,
    type: "card",
    parentUid: UID,
    x: 10.4,
    y: 24,
    w: 281,
    h: 80,
    title: "Live",
    color: "blue",
    fill: "",
    ...patch,
  };
}

function boardWith() {
  const a = card("cardAAAA1", { title: "Live", color: "blue", fill: "" });
  const b = card("cardBBBB2", { x: 420, y: 30, w: 200, h: 96, title: "Other", color: "", fill: "#ffb366" });
  return {
    uid: UID,
    enhanced: true,
    items: new Map([[a.uid, a], [b.uid, b]]),
    order: [a.uid, b.uid],
    edges: new Map([[
      "edgeCCCC3",
      { uid: "edgeCCCC3", from: a.uid, to: b.uid, fromSide: "right", toSide: "left", route: "curve" },
    ]]),
  };
}

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= 1, `${label}: ${actual} vs ${expected}`);
}

test("the store key, cap, corrupt read, and quota skip", () => {
  assert.equal(KEY, "plexus-diagram:sketch:Svy:boardAAA1");
  const items = [];
  for (let i = 0; i < SKETCH_MAX_ITEMS + 1; i += 1) {
    items.push({ uid: `c${i}`, x: i, y: 1, w: 20, h: 20, title: "t", color: "blue", fill: "x".repeat(1000) });
  }
  const packed = packSketch({ items, edges: [{ from: "a", to: "b", path: "M0 0".repeat(5000) }] });
  assert.ok(packed);
  assert.ok(packed.length <= SKETCH_MAX_BYTES);
  const parsed = parseSketch(packed);
  assert.ok(parsed.items.length <= SKETCH_MAX_ITEMS);
  assert.ok(parsed.items.length < items.length);
  assert.equal(parsed.edges.length, 0);
  assert.equal(parseSketch("{"), null);
  assert.equal(parseSketch(JSON.stringify({ items: [{ uid: "a", x: 1 }] })), null);

  const map = new Map();
  let fail = false;
  const storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { if (fail) throw new Error("quota"); map.set(key, String(value)); },
  };
  const store = createSketchStore({ storage, graph: "Svy" });
  const first = { items: [{ uid: "cardAAAA1", x: 1, y: 2, w: 3, h: 4, title: "A", color: "", fill: "" }], edges: [] };
  store.set(UID, first);
  assert.equal(parseSketch(storage.getItem(KEY)).items[0].title, "A");
  fail = true;
  assert.doesNotThrow(() => {
    store.set(UID, { items: [{ uid: "cardAAAA1", x: 9, y: 9, w: 9, h: 9, title: "B", color: "", fill: "" }], edges: [] });
    store.flushAll();
  });
  assert.equal(parseSketch(storage.getItem(KEY)).items[0].title, "A");
  store.dispose();
});

test("a second write inside 500 ms waits, and flushAll lands it", async () => {
  const storage = memoryStorage();
  const store = createSketchStore({ storage, graph: "Svy" });
  const item = (title) => ({ items: [{ uid: "cardAAAA1", x: 1, y: 2, w: 3, h: 4, title, color: "", fill: "" }], edges: [] });
  store.set(UID, item("A"));
  store.set(UID, item("B"));
  assert.equal(parseSketch(storage.getItem(KEY)).items[0].title, "A");
  store.flushAll();
  assert.equal(parseSketch(storage.getItem(KEY)).items[0].title, "B");
  store.dispose();
});

test("sketched cards match the live screen rect at four zooms", () => {
  const board = boardWith();
  const sketch = captureSketch(board);
  assert.equal(sketch.items.length, 2);
  assert.equal(sketch.items[0].title, "Live");
  assert.equal(sketch.items[0].x, 10.4);
  assert.equal(sketch.items[1].fill, "#ffb366");
  assert.ok(sketch.edges[0].path.startsWith("M") || sketch.edges[0].path.startsWith("m"));
  const doc = makeDoc();
  for (const zoom of [0.25, 0.5, 1, 2]) {
    for (const inset of [0, SKETCH_ROOT_BORDER]) {
      const vp = { x: 12.5, y: -8, zoom };
      const layer = paintSketch(doc, doc.app, sketch, vp, { inset });
      assert.equal(layer.style.left, `${inset}px`);
      assert.equal(layer.style.pointerEvents, "none");
      assert.equal(doc.app.querySelector(".pxd-item"), null);
      const world = layer.querySelector(".pxd-sketch__world");
      assert.equal(world.style.transform, `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`);
      assert.equal(world.style.transformOrigin, "0 0");
      const cards = layer.querySelectorAll(".pxd-sketch__card");
      assert.equal(cards.length, 2);
      sketch.items.forEach((item, index) => {
        const live = worldToScreen(vp, { x: item.x, y: item.y });
        const screen = sketchScreenRect(item, vp, inset);
        near(screen.x, live.x + inset, "x");
        near(screen.y, live.y + inset, "y");
        near(screen.w, item.w * zoom, "w");
        near(screen.h, item.h * zoom, "h");
        const cardEl = cards[index];
        assert.equal(cardEl.style.transform, `translate(${item.x}px, ${item.y}px)`);
        assert.equal(cardEl.style.width, `${item.w}px`);
        assert.equal(cardEl.style.height, `${item.h}px`);
        assert.equal(cardEl.style.boxSizing, "border-box");
        assert.equal(cardEl.querySelector(".pxd-sketch__title").textContent, item.title);
        const paintedX = inset + vp.x + item.x * zoom;
        const paintedY = inset + vp.y + item.y * zoom;
        near(paintedX, live.x + inset, "painted x");
        near(paintedY, live.y + inset, "painted y");
        near(item.w * zoom, item.w * zoom, "painted w");
        near(item.h * zoom, item.h * zoom, "painted h");
      });
      const edge = layer.querySelector(".pxd-sketch__edge");
      assert.equal(edge.getAttribute("d"), sketch.edges[0].path);
      assert.equal(cards[0].classList.contains("pxd-c-blue"), true);
      assert.equal(cards[1].style.background, "#ffb366");
      let listens = 0;
      const walk = (node) => {
        listens += Object.values(node.handlers).reduce((sum, list) => sum + list.length, 0);
        for (const child of node.children) walk(child);
      };
      walk(layer);
      assert.equal(listens, 0);
      removeSketch(doc.app);
      assert.equal(doc.app.querySelector(".pxd-sketch"), null);
    }
  }
  const stored = { x: 1, y: 2, zoom: 1 };
  const initial = { x: 9, y: 8, zoom: 2 };
  assert.deepEqual(resolveSketchViewport({ stored, initial, board }), initial);
  assert.deepEqual(resolveSketchViewport({ stored, initial: { x: 1, y: 1, zoom: 0 }, board }), stored);
});

function addNative(doc, uid) {
  const native = doc.createElement("div");
  native.cls.add("rm-diagram");
  native.closestMap['[id^="block-input-"]'] = { id: `block-input-w-body-outline-${uid}` };
  const panel = doc.createElement("div");
  panel.cls.add("rm-diagram-title-panel");
  doc.app.append(native);
  native.after(panel);
  return native;
}

function installClock() {
  const keys = ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"];
  const saved = {};
  for (const key of keys) saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  let now = 0;
  let nextId = 1;
  const rafQueue = [];
  const timers = [];
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  define("requestAnimationFrame", (fn) => {
    const id = nextId++;
    rafQueue.push({ id, fn });
    return id;
  });
  define("cancelAnimationFrame", (id) => {
    const index = rafQueue.findIndex((entry) => entry.id === id);
    if (index >= 0) rafQueue.splice(index, 1);
  });
  define("setTimeout", (fn, ms = 0, ...args) => {
    const id = nextId++;
    timers.push({ id, at: now + Number(ms || 0), fn, args });
    return id;
  });
  define("clearTimeout", (id) => {
    const index = timers.findIndex((entry) => entry.id === id);
    if (index >= 0) timers.splice(index, 1);
  });
  const flushDue = () => {
    let guard = 0;
    while (guard < 1000) {
      let index = -1;
      for (let i = 0; i < timers.length; i += 1) {
        if (timers[i].at <= now && (index < 0 || timers[i].at < timers[index].at)) index = i;
      }
      if (index < 0) break;
      const entry = timers.splice(index, 1)[0];
      entry.fn(...entry.args);
      guard += 1;
    }
  };
  return {
    rafPending: () => rafQueue.length,
    timerPending: () => timers.length,
    flushRaf() {
      const batch = rafQueue.splice(0, rafQueue.length);
      for (const entry of batch) entry.fn(now);
    },
    flushDue,
    advance(ms) {
      now += ms;
      flushDue();
    },
    restore() {
      for (const key of keys) {
        if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
        else delete globalThis[key];
      }
    },
  };
}

function fakeEvent(type, extra = {}) {
  const event = {
    type,
    ...extra,
    preventDefault() {},
    stopPropagation() { event.stopped = true; },
    stopImmediatePropagation() { event.stopped = true; event.immediateStopped = true; },
  };
  return event;
}

const CACHED = { items: [{ uid: "cardAAAA1", x: 10.4, y: 24, w: 281, h: 80, title: "Cached", color: "blue", fill: "" }], edges: [] };

function installEnv({ sketch = null, corrupt = false, failMount = false, gesturing = false, omitItems = false, clock = false } = {}) {
  const saved = {};
  const globals = ["document", "window", "location", "MutationObserver"];
  for (const key of globals) saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const doc = makeDoc();
  const listeners = new Map();
  const win = {
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    dispatchEvent(event) {
      if (event && event.target == null) event.target = win;
      for (const fn of [...(listeners.get(event?.type) || [])]) {
        fn(event);
        if (event?.immediateStopped) break;
      }
      return true;
    },
  };
  define("document", doc);
  define("window", win);
  define("location", { hash: "#/app/Svy" });
  define("MutationObserver", class {
    observe() {}
    disconnect() {}
  });
  const block = { ":block/props": { ":plexus": { ":v": 2 } }, ":edit/time": 42 };
  const writes = [];
  const host = {
    api: { data: { pull: (pattern) => (pattern === "[:block/props]" ? block : pattern.startsWith("[:block/open") ? { ":block/open": false } : null) } },
    stats: { writes: 0, watches: 0, renders: 0 },
    pageUid: () => null,
    blockString: () => null,
    q: () => [],
    generateUid: () => "newBoard01",
    createBlock: async (args) => { writes.push(["create", args]); return args.uid; },
    openBlock: async (uid) => { writes.push(["open", uid]); },
    setOpen: async (uid, open) => { writes.push(["open-state", uid, open]); },
    viewports: { get: (id) => (id === UID ? { x: 12.5, y: -8, zoom: 0.5 } : null) },
  };
  const board = boardWith();
  const acquireSession = (uid) => ({
    uid,
    board,
    on: () => () => {},
    release() {},
  });
  const seen = [];
  const handed = [];
  const pointers = [];
  const mountView = (args) => {
    if (failMount) throw new Error("mount failed");
    const sketchEl = args.mountEl.querySelector(".pxd-sketch");
    const shot = {
      sketch: Boolean(sketchEl),
      items: args.mountEl.querySelectorAll(".pxd-item").length,
      title: sketchEl?.querySelector(".pxd-sketch__title")?.textContent ?? null,
      transform: sketchEl?.querySelector(".pxd-sketch__world")?.style.transform ?? null,
      inset: sketchEl?.style.left ?? null,
      pointerEvents: sketchEl?.style.pointerEvents ?? null,
      live: 0,
      during: 0,
      sketchKeys: 0,
    };
    seen.push(shot);
    const onKey = (event) => { shot.live += 1; handed.push(event?.key); };
    win.addEventListener("keydown", onKey);
    const walk = (node) => {
      for (const fn of node.handlers?.keydown || []) { shot.sketchKeys += 1; fn({ key: "a" }); }
      for (const child of node.children || []) walk(child);
    };
    if (sketchEl) walk(sketchEl);
    for (const fn of [...(listeners.get("keydown") || [])]) fn({ key: "a" });
    shot.during = shot.live;
    if (!omitItems) {
      const item = doc.createElement("div");
      item.className = "pxd-item";
      args.mountEl.append(item);
    }
    const root = doc.createElement("div");
    root.className = gesturing ? "pxd-root pxd-root--gesturing" : "pxd-root";
    root.addEventListener("pointerdown", (event) => { pointers.push(event?.type); });
    args.mountEl.append(root);
    return {
      args,
      root,
      viewport: () => ({ x: 12.5, y: -8, zoom: 0.5 }),
      dispose() { win.removeEventListener("keydown", onKey); root.remove(); },
    };
  };
  const registry = () => ({ addCommand: async () => {}, removeCommand: async () => {} });
  const extensionAPI = {
    settings: { get: (id) => (id === "fullscreen-on-zoom" || id === "auto-enhance" ? false : null) },
    ui: { commandPalette: registry(), slashCommand: registry(), blockContextMenu: registry() },
    platform: { isMobile: () => false },
  };
  const storage = memoryStorage();
  storage.setItem(`plexus-diagram:collapsed:Svy:${UID}`, "1");
  if (corrupt) storage.setItem(KEY, "{");
  else if (sketch) storage.setItem(KEY, JSON.stringify(sketch));
  const lifecycle = createLifecycle();
  addNative(doc, UID);
  const clocked = clock ? installClock() : null;
  const restore = () => {
    clocked?.restore();
    for (const key of globals) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  };
  return {
    doc, host, block, writes, seen, handed, pointers, storage, lifecycle, board, mountView, win,
    clock: clocked,
    install: () => installPlexusDiagram({ extensionAPI, lifecycle, version: "x", mountView, host, acquireSession, storage }),
    restore,
  };
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

test("mount shows the sketch first, the handoff key hits the live board once, then a settled paint is stored", async () => {
  const env = installEnv({ clock: true, sketch: CACHED });
  try {
    await env.install();
    const mount = env.doc.querySelector(".pxd-mount");
    assert.equal(env.seen.length, 0);
    assert.ok(mount.querySelector(".pxd-sketch"));
    assert.equal(mount.querySelector(".pxd-item"), null);
    assert.equal(mount.querySelector(".pxd-sketch").style.pointerEvents, "none");
    assert.equal(mount.style.position, "relative");
    let early = 0;
    env.win.addEventListener("keydown", (event) => { if (event.key === "b") early += 1; });
    // Input aimed at a Roam block outside the board passes through untouched.
    const elsewhere = env.doc.createElement("textarea");
    env.doc.body.append(elsewhere);
    let roamGot = 0;
    env.win.addEventListener("keydown", (event) => { if (event.key === "x") roamGot += 1; });
    const outside = fakeEvent("keydown", { key: "x", target: elsewhere });
    env.win.dispatchEvent(outside);
    assert.equal(outside.stopped, undefined, "a key typed in a Roam block is not held");
    assert.equal(roamGot, 1);
    env.win.dispatchEvent(fakeEvent("keydown", { key: "b", target: mount }));
    env.win.dispatchEvent(fakeEvent("pointerdown", { pointerId: 1, clientX: 4, clientY: 8, target: mount }));
    assert.equal(early, 0);
    assert.equal(env.seen.length, 0);
    env.clock.flushRaf();
    assert.equal(env.seen.length, 0, "mountView waits until the frame after the sketch can paint");
    assert.ok(mount.querySelector(".pxd-sketch"));
    env.clock.flushDue();
    const shot = env.seen[0];
    assert.equal(shot.sketch, true);
    assert.equal(shot.items, 0);
    assert.equal(shot.title, "Cached");
    assert.equal(shot.inset, "1px");
    assert.equal(shot.pointerEvents, "none");
    assert.equal(shot.transform, "translate(12.5px, -8px) scale(0.5)");
    assert.equal(shot.during, 1);
    assert.equal(shot.sketchKeys, 0);
    assert.ok(mount.querySelector(".pxd-sketch"), "the sketch stays through the live mount");
    assert.ok(mount.querySelector(".pxd-item"));
    // The replay targets the mount; this fake DOM does not bubble to window, so the live board's count is the check.
    assert.deepEqual(env.handed.filter((key) => key === "b"), ["b"]);
    assert.deepEqual(env.pointers, ["pointerdown"]);
    env.clock.flushRaf();
    assert.equal(mount.querySelector(".pxd-sketch"), null);
    assert.ok(mount.querySelector(".pxd-item"));
    env.clock.advance(SKETCH_DEBOUNCE_MS);
    const saved = parseSketch(env.storage.getItem(KEY));
    assert.equal(saved.items.find((item) => item.uid === "cardAAAA1").title, "Live");
    assert.equal(env.block[":edit/time"], 42);
    assert.deepEqual(env.writes, []);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("a pan frame does not write the sketch; the write lands after the gesture", async () => {
  const env = installEnv({ gesturing: true });
  try {
    await env.install();
    await wait(700);
    assert.equal(env.storage.getItem(KEY), null);
    env.doc.querySelector(".pxd-root").classList.remove("pxd-root--gesturing");
    await wait(700);
    const saved = parseSketch(env.storage.getItem(KEY));
    assert.equal(saved.items.length, 2);
    assert.equal(saved.edges.length, 1);
    assert.equal(env.block[":edit/time"], 42);
    assert.deepEqual(env.writes, []);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("a corrupt sketch string still mounts the live board", async () => {
  const env = installEnv({ corrupt: true });
  try {
    await env.install();
    assert.equal(env.seen[0].sketch, false);
    assert.equal(env.seen[0].items, 0);
    const mount = env.doc.querySelector(".pxd-mount");
    assert.equal(mount.querySelector(".pxd-sketch"), null);
    assert.ok(mount.querySelector(".pxd-item"));
    assert.equal(env.block[":edit/time"], 42);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("a mount that throws removes the sketch and does not escape install", async () => {
  const env = installEnv({
    clock: true,
    failMount: true,
    sketch: { items: [{ uid: "cardAAAA1", x: 1, y: 2, w: 3, h: 4, title: "Cached", color: "", fill: "" }], edges: [] },
  });
  try {
    await env.install();
    assert.ok(env.doc.querySelector(".pxd-sketch"));
    env.clock.flushRaf();
    env.clock.flushDue();
    assert.equal(env.doc.querySelector(".pxd-sketch"), null);
    assert.equal(env.seen.length, 0);
    assert.equal(env.block[":edit/time"], 42);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("the sketch comes off on the 2s timeout when no live card appears", async () => {
  const env = installEnv({ clock: true, omitItems: true, sketch: CACHED });
  try {
    await env.install();
    env.clock.flushRaf();
    env.clock.flushDue();
    const mount = env.doc.querySelector(".pxd-mount");
    assert.ok(mount.querySelector(".pxd-sketch"));
    assert.equal(mount.querySelector(".pxd-item"), null);
    env.clock.advance(SKETCH_HOLD_MS - 1);
    assert.ok(mount.querySelector(".pxd-sketch"));
    env.clock.advance(1);
    assert.equal(mount.querySelector(".pxd-sketch"), null);
    assert.equal(env.block[":edit/time"], 42);
    assert.deepEqual(env.writes, []);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("a late live card keeps the sketch until one more frame", async () => {
  const env = installEnv({ clock: true, omitItems: true, sketch: CACHED });
  const observed = [];
  class RecordingObserver {
    constructor(cb) { this.cb = cb; observed.push(this); }
    observe() {}
    disconnect() { this.dead = true; }
    fire() { if (!this.dead) this.cb(); }
  }
  try {
    await env.install();
    globalThis.MutationObserver = RecordingObserver;
    env.clock.flushRaf();
    env.clock.flushDue();
    const mount = env.doc.querySelector(".pxd-mount");
    assert.ok(mount.querySelector(".pxd-sketch"));
    assert.equal(observed.length, 1);
    const item = env.doc.createElement("div");
    item.className = "pxd-item";
    mount.append(item);
    observed[0].fire();
    assert.ok(mount.querySelector(".pxd-sketch"));
    env.clock.flushRaf();
    assert.equal(mount.querySelector(".pxd-sketch"), null);
    assert.equal(observed[0].dead, true);
    assert.ok(mount.querySelector(".pxd-item"));
    assert.equal(env.block[":edit/time"], 42);
    assert.deepEqual(env.writes, []);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("dispose during the sketch frame cancels mountView and leaves no timer", async () => {
  const env = installEnv({ clock: true, sketch: CACHED });
  try {
    await env.install();
    assert.equal(env.seen.length, 0);
    assert.equal(env.clock.rafPending(), 1);
    assert.ok(env.doc.querySelector(".pxd-sketch"));
    await env.lifecycle.dispose();
    assert.equal(env.doc.querySelector(".pxd-sketch"), null);
    assert.equal(env.clock.rafPending(), 0);
    env.clock.flushRaf();
    env.clock.advance(SKETCH_HOLD_MS + 1000);
    assert.equal(env.seen.length, 0);
    assert.equal(env.clock.timerPending(), 0);
    assert.equal(env.clock.rafPending(), 0);
    assert.equal(env.block[":edit/time"], 42);
  } finally {
    env.restore();
  }
});

test("no sketch mounts in the same turn", async () => {
  const env = installEnv({ clock: true });
  try {
    await env.install();
    assert.equal(env.seen.length, 1);
    assert.equal(env.seen[0].sketch, false);
    assert.equal(env.clock.rafPending(), 0);
    const mount = env.doc.querySelector(".pxd-mount");
    assert.equal(mount.querySelector(".pxd-sketch"), null);
    assert.ok(mount.querySelector(".pxd-item"));
    assert.equal(env.block[":edit/time"], 42);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

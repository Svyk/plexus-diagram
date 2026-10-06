import assert from "node:assert/strict";
import test from "node:test";

import { createLifecycle } from "../src/lifecycle.js";
import { installPlexusDiagram } from "../src/feature.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import {
  PERF_CAP,
  clickInsideRoot,
  createPerfLog,
  isPlexusExtensionUrl,
  isPlexusLongTask,
  panFps,
  percentile,
  perfReadoutText,
} from "../src/perf-log.js";
import { createSettingsPanel, initializeSettings, normalizeSetting, settingsDefaults } from "../src/settings.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const EXTENSION = "https://svyk.github.io/plexus-diagram/extension.js";
const BLOB = "blob:https://roamresearch.com/abc";

class FakePO {
  static made = [];
  static active = new Set();
  constructor(cb) { this.cb = cb; this.opts = null; FakePO.made.push(this); }
  observe(opts) { this.opts = opts; FakePO.active.add(this); }
  disconnect() { FakePO.active.delete(this); }
  static reset() { FakePO.made = []; FakePO.active = new Set(); }
}

function withFakePO() {
  const prev = globalThis.PerformanceObserver;
  FakePO.reset();
  globalThis.PerformanceObserver = FakePO;
  return () => {
    if (prev === undefined) delete globalThis.PerformanceObserver;
    else globalThis.PerformanceObserver = prev;
    FakePO.reset();
  };
}

test("percentiles use floor((n - 1) * p) on a sorted copy, and the ring keeps 256", () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([10], 0.5), 10);
  assert.equal(percentile([10], 0.75), 10);
  assert.equal(percentile([10, 30, 20], 0.5), 20);
  assert.equal(percentile([10, 30, 20], 0.75), 20);
  assert.equal(percentile([4, 1, 3, 2], 0.5), 2);
  assert.equal(percentile([4, 1, 3, 2], 0.75), 3);
  assert.equal(PERF_CAP, 256);
  assert.equal(panFps([16]), 1000 / 16);
  assert.equal(panFps([10, 30]), 1000 / 10);
  assert.equal(panFps([0, -1]), null);
  assert.equal(isPlexusExtensionUrl(EXTENSION), true);
  assert.equal(isPlexusExtensionUrl(`${EXTENSION}?v=1`), true);
  assert.equal(isPlexusExtensionUrl(BLOB), false);
  assert.equal(isPlexusExtensionUrl("blob:https://roamresearch.com/extension.js"), false);
  assert.equal(isPlexusExtensionUrl("https://svyk.github.io/roam-plexus/extension.js"), false, "a sibling extension.js is not Plexus");
  assert.equal(isPlexusExtensionUrl("blob:https://roamresearch.com/own-build", "blob:https://roamresearch.com/own-build"), true, "an injected build counts by its own blob URL");
  assert.equal(isPlexusExtensionUrl("https://cdn.example/not-extension.js"), false);
  assert.equal(isPlexusLongTask({ attribution: [{ containerSrc: BLOB }] }), false);
  assert.equal(isPlexusLongTask({ attribution: [{ sourceURL: EXTENSION }] }), true);
  assert.equal(clickInsideRoot({ name: "click", target: { closest: (sel) => (sel === ".pxd-root" ? {} : null) } }), true);
  assert.equal(clickInsideRoot({ name: "click", target: { closest: () => null } }), false);
  assert.equal(clickInsideRoot({ name: "pointerdown", target: { closest: () => ({}) } }), false);
  assert.match(perfReadoutText(null), /Open p50 — p75 —/);
  assert.match(perfReadoutText(null), /p50/);
  assert.match(perfReadoutText(null), /p75/);
});

test("speed-log defaults off, seeds only a missing id, and the Performance row prints p50 and p75", async () => {
  assert.equal(settingsDefaults()["speed-log"], false);
  assert.equal(normalizeSetting("speed-log", null), false);
  assert.equal(normalizeSetting("speed-log", "true"), true);
  assert.equal(normalizeSetting("speed-log", "false"), false);
  const store = new Map([["enabled", true]]);
  await initializeSettings({
    settings: {
      get: (id) => store.get(id) ?? null,
      set: async (id, value) => { store.set(id, value); },
    },
  });
  assert.equal(store.get("speed-log"), false);
  assert.equal(store.get("enabled"), true);
  const row = createSettingsPanel().settings.find((entry) => entry.id === "group-performance");
  assert.equal(row.name, "Performance");
  assert.match(row.description, /p50/);
  assert.match(row.description, /p75/);
  assert.match(String(row.action.component()), /p50/);
  assert.match(String(row.action.component()), /p75/);
  const sw = createSettingsPanel().settings.find((entry) => entry.id === "speed-log");
  assert.equal(sw.action.type, "switch");
});

test("off builds no observer and schedules no frame; a blob long task does not count", async () => {
  const restore = withFakePO();
  const prevRaf = globalThis.requestAnimationFrame;
  let frames = 0;
  globalThis.requestAnimationFrame = () => { frames += 1; return 1; };
  const lifecycle = createLifecycle();
  try {
    const stats = { writes: 0 };
    const log = createPerfLog();
    log.bind(stats);
    assert.equal(log.enabled, false);
    assert.equal(stats.perf, null);
    assert.equal(log.beginPan(), false);
    log.watchOpen({ querySelector() { return null; } }, 0);
    assert.equal(frames, 0);
    assert.equal(FakePO.made.length, 0);

    log.start({ stats, lifecycle });
    assert.equal(FakePO.made.length, 2);
    assert.ok(FakePO.made.some((obs) => obs.opts?.type === "event"));
    assert.ok(FakePO.made.some((obs) => obs.opts?.type === "longtask"));
    const events = FakePO.made.find((obs) => obs.opts?.type === "event");
    const tasks = FakePO.made.find((obs) => obs.opts?.type === "longtask");
    const inside = { closest: (sel) => (sel === ".pxd-root" ? {} : null) };
    const outside = { closest: () => null };
    events.cb({ getEntries: () => [
      { name: "click", duration: 21, target: inside },
      { name: "click", duration: 40, target: outside },
      { name: "pointerdown", duration: 12, target: inside },
    ] });
    assert.equal(stats.perf.click.n, 1);
    assert.equal(stats.perf.click.p50, 21);
    tasks.cb({ getEntries: () => [
      { duration: 80, attribution: [{ containerSrc: BLOB, name: "script" }] },
      { duration: 90, attribution: [{ sourceURL: "blob:https://roamresearch.com/extension.js" }] },
    ] });
    assert.equal(stats.perf.longtask.count, 0);
    assert.equal(stats.perf.longtask.n, 0);
    tasks.cb({ getEntries: () => [{ duration: 70, attribution: [{ sourceURL: EXTENSION }] }] });
    assert.equal(stats.perf.longtask.count, 1);
    assert.equal(stats.perf.longtask.p50, 70);

    const q = [];
    globalThis.requestAnimationFrame = (fn) => { q.push(fn); return q.length; };
    globalThis.cancelAnimationFrame = () => {};
    log.beginPan();
    q.shift()(100);
    q.shift()(116);
    assert.equal(log.endPan(), 1000 / 16);
    assert.equal(stats.perf.fps.n, 1);
    assert.equal(stats.perf.fps.p50, 1000 / 16);

    await lifecycle.dispose();
    assert.equal(FakePO.active.size, 0);
    assert.equal(stats.perf, null);
    assert.equal(log.enabled, false);
  } finally {
    globalThis.requestAnimationFrame = prevRaf;
    restore();
  }
});

test("the ring keeps the newest 256 pan samples", () => {
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancel = globalThis.cancelAnimationFrame;
  const q = [];
  globalThis.requestAnimationFrame = (fn) => { q.push(fn); return q.length; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const stats = {};
    const log = createPerfLog({ cap: 3 });
    log.start({ stats, events: false, tasks: false });
    const pan = (delta) => {
      q.length = 0;
      log.beginPan();
      q.shift()(0);
      q.shift()(delta);
      log.endPan();
    };
    pan(10);
    pan(20);
    pan(40);
    pan(50);
    assert.equal(stats.perf.fps.n, 3);
    assert.equal(stats.perf.fps.p50, 25);
    log.stop();
    assert.equal(stats.perf, null);
    const queued = q.length;
    assert.equal(log.beginPan(), false);
    assert.equal(q.length, queued);
  } finally {
    globalThis.requestAnimationFrame = prevRaf;
    if (prevCancel === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = prevCancel;
  }
});

// ---- feature install ------------------------------------------------------------------------

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
      toggle: (n, force) => { const next = force ?? !cls.has(n); if (next) cls.add(n); else cls.delete(n); return next; },
    };
  }
  get className() { return [...this.cls].join(" "); }
  set className(value) { this.cls.clear(); String(value).split(/\s+/).filter(Boolean).forEach((n) => this.cls.add(n)); }
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
  matches(selector) { return selector.startsWith(".") && this.cls.has(selector.slice(1)); }
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
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
}

function featureEnv({ speedLog = false } = {}) {
  const saved = {};
  for (const key of ["document", "window", "location", "PerformanceObserver", "fetch"]) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  }
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const doc = {};
  doc.root = new El(doc, "html");
  doc.head = new El(doc, "head");
  doc.body = new El(doc, "body");
  doc.app = new El(doc, "div");
  doc.app.cls.add("roam-app");
  doc.root.append(doc.head);
  doc.root.append(doc.body);
  doc.body.append(doc.app);
  doc.createElement = (tag) => new El(doc, tag);
  doc.querySelector = (selector) => doc.root.querySelector(selector);
  doc.querySelectorAll = (selector) => doc.root.querySelectorAll(selector);
  doc.getElementById = () => null;
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};
  const listeners = new Map();
  const win = {
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
  };
  define("document", doc);
  define("window", win);
  define("location", { hash: "#/app/Svy" });
  FakePO.reset();
  define("PerformanceObserver", FakePO);
  const fetches = [];
  define("fetch", (...args) => { fetches.push(args); return Promise.resolve({ ok: true }); });

  const uid = "boardAAA1";
  const props = new Map([[uid, { ":plexus": { ":v": 2 } }]]);
  const strings = new Map([[uid, "{{[[diagram]]}}" ]]);
  const writes = { createBlock: [], setOpen: [], other: 0 };
  const stored = [];
  const host = {
    api: {
      data: {
        pull(pattern, ref) {
          if (pattern === "[:block/props]") return { ":block/props": props.get(ref[1]) ?? null };
          return null;
        },
      },
      ui: { getFocusedBlock: () => null },
    },
    stats: { writes: 0, watches: 0, renders: 0 },
    blockString: (id) => strings.get(id) ?? null,
    q: () => [],
    generateUid: () => "newBoard01",
    createBlock: async (args) => { writes.createBlock.push(args); return args.uid; },
    setOpen: async (id, open) => { writes.setOpen.push([id, open]); },
    graph: "Svy",
  };
  const values = {
    "speed-log": speedLog,
    "auto-enhance": false,
    "collapse-outline": false,
    "fullscreen-on-zoom": false,
  };
  const extensionAPI = {
    settings: { get: (id) => (Object.hasOwn(values, id) ? values[id] : null) },
    ui: {
      commandPalette: { addCommand: async () => {}, removeCommand: async () => {} },
      slashCommand: { addCommand: async () => {}, removeCommand: async () => {} },
      blockContextMenu: { addCommand: async () => {}, removeCommand: async () => {} },
    },
    platform: { isMobile: () => false },
  };
  const storage = {
    getItem: () => null,
    setItem: (key) => { stored.push(key); },
  };
  const native = doc.createElement("div");
  native.cls.add("rm-diagram");
  native.closestMap['[id^="block-input-"]'] = { id: `block-input-w-body-outline-${uid}` };
  doc.app.append(native);
  const lifecycle = createLifecycle();
  const acquireSession = () => ({
    uid,
    board: { uid, enhanced: true, virtual: false, items: new Map() },
    on: () => () => {},
    release() {},
  });
  const install = () => installPlexusDiagram({
    extensionAPI,
    lifecycle,
    version: "x",
    host,
    storage,
    acquireSession,
    mountView: (args) => {
      const item = args.mountEl.doc.createElement("div");
      item.cls.add("pxd-item");
      args.mountEl.append(item);
      return { args, dispose() {}, setFullscreen() {}, focusUid() {}, setSettings() {} };
    },
  });
  const restore = () => {
    for (const key of Object.keys(saved)) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  };
  return { doc, win, host, writes, stored, fetches, lifecycle, install, restore, native };
}

test("default settings leave stats.perf null and register no event or longtask observer", async () => {
  const env = featureEnv({ speedLog: false });
  try {
    await env.install();
    assert.equal(env.win.__plexusDiagram.stats.perf, null);
    assert.equal(FakePO.made.length, 0);
    assert.equal(env.fetches.length, 0);
    assert.equal(env.writes.createBlock.length, 0);
    assert.equal(env.writes.setOpen.length, 0);
    assert.equal(env.host.stats.writes, 0);
    assert.equal(env.stored.some((key) => /perf|speed-log/.test(key)), false);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("speed-log on records open, the Performance row shows p50 and p75, and unload clears it", async () => {
  const env = featureEnv({ speedLog: true });
  try {
    await env.install();
    const perf = env.win.__plexusDiagram.stats.perf;
    assert.equal(typeof perf.open.p50, "number");
    assert.equal(typeof perf.open.p75, "number");
    assert.equal(FakePO.active.size, 3);
    const row = createSettingsPanel().settings.find((entry) => entry.id === "group-performance");
    assert.match(row.description, /p50/);
    assert.match(row.description, /p75/);
    assert.match(row.description, /Open p50 \d/);
    assert.match(String(row.action.component()), /Open p50 \d/);
    assert.match(String(row.action.component()), /p75/);
    assert.equal(env.fetches.length, 0);
    assert.equal(env.writes.createBlock.length, 0);
    assert.equal(env.writes.setOpen.length, 0);
    assert.equal(env.host.stats.writes, 0);
    const baseline = 0;
    await env.lifecycle.dispose();
    assert.equal(env.host.stats.perf, null);
    assert.equal(FakePO.active.size, baseline);
    assert.equal(env.win.__plexusDiagram, undefined);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("turning speed-log on arms observers and turning it off returns to the baseline", async () => {
  const env = featureEnv({ speedLog: false });
  try {
    await env.install();
    assert.equal(FakePO.made.length, 0);
    const sw = createSettingsPanel().settings.find((entry) => entry.id === "speed-log");
    sw.action.onChange({ target: { checked: true } });
    assert.equal(FakePO.active.size, 3);
    assert.ok(env.win.__plexusDiagram.stats.perf);
    assert.equal(env.win.__plexusDiagram.stats.perf.open.p50, null);
    sw.action.onChange({ target: { checked: false } });
    assert.equal(FakePO.active.size, 0);
    assert.equal(env.win.__plexusDiagram.stats.perf, null);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

// ---- board view -------------------------------------------------------------------------------

const pull = (children) => ({
  ":block/uid": "board0001",
  ":block/string": "{{[[diagram]]:Empty}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": children,
});

function boardSession(board) {
  const handlers = new Map();
  return {
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
    release() {},
  };
}

test("a board with speed-log off adds no event observer and no pan frame loop", () => {
  const restorePO = withFakePO();
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const board = buildBoard(pull([]));
    const mountEl = stub.document.createElement("div");
    stub.document.body.append(mountEl);
    const stats = {};
    const log = createPerfLog();
    log.bind(stats);
    let began = 0;
    const begin = log.beginPan;
    log.beginPan = () => { began += 1; return begin(); };
    const view = mountBoardView({
      host: { graph: "Svy", stats, renderString(el, string) { el.textContent = string; }, renderBlock() {}, unmount() {} },
      session: boardSession(board),
      mountEl,
      settings: { get: () => undefined },
      perfLog: log,
      version: "2.17.0",
    });
    stub.flushFrames();
    stub.dispatch(view.root, "pointerdown", { button: 1, clientX: 20, clientY: 30 });
    stub.flushFrames();
    const again = stub.flushFrames();
    stub.dispatch(stub.document, "pointerup", { button: 1, clientX: 40, clientY: 30 });
    assert.equal(began, 0);
    assert.equal(again, 0);
    assert.equal(FakePO.made.length, 0);
    assert.equal(stats.perf, null);
    view.dispose();
  } finally {
    restore();
    restorePO();
  }
});

test("one click inside .pxd-root adds a sample, one outside does not, and one pan adds an fps sample", () => {
  const restorePO = withFakePO();
  const stub = createDomStub();
  const restore = stub.install();
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancel = globalThis.cancelAnimationFrame;
  try {
    const board = buildBoard(pull([]));
    const mountEl = stub.document.createElement("div");
    stub.document.body.append(mountEl);
    const stats = {};
    const log = createPerfLog();
    log.start({ stats, events: false, tasks: false });
    const view = mountBoardView({
      host: { graph: "Svy", stats, renderString(el, string) { el.textContent = string; }, renderBlock() {}, unmount() {} },
      session: boardSession(board),
      mountEl,
      settings: { get: (key) => (key === "speed-log" ? true : undefined) },
      perfLog: log,
      version: "2.17.0",
    });
    stub.flushFrames();
    const eventObs = FakePO.made.find((obs) => obs.opts?.type === "event");
    assert.ok(eventObs);
    assert.equal(FakePO.made.filter((obs) => obs.opts?.type === "longtask").length, 0);
    const card = stub.document.createElement("div");
    card.className = "pxd-item";
    view.root.append(card);
    eventObs.cb({ getEntries: () => [
      { name: "click", duration: 18, target: card },
      { name: "click", duration: 44, target: stub.document.body },
    ] });
    assert.equal(stats.perf.click.n, 1);
    assert.equal(stats.perf.click.p50, 18);
    assert.equal(stats.perf.click.p75, 18);

    const q = [];
    const raf = (fn) => { q.push(fn); return q.length; };
    const cancel = (id) => { const i = q.findIndex((fn, index) => index + 1 === id); if (i >= 0) q.splice(i, 1); };
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = cancel;
    stub.window.requestAnimationFrame = raf;
    stub.window.cancelAnimationFrame = cancel;
    stub.dispatch(view.root, "pointerdown", { button: 1, clientX: 30, clientY: 40 });
    q.shift()?.(100);
    q.shift()?.(116);
    stub.dispatch(stub.document, "pointerup", { button: 1, clientX: 80, clientY: 40 });
    assert.equal(stats.perf.fps.n, 1);
    assert.equal(stats.perf.fps.p50, 1000 / 16);
    view.dispose();
    log.stop();
    assert.equal(stats.perf, null);
  } finally {
    globalThis.requestAnimationFrame = prevRaf;
    if (prevCancel === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = prevCancel;
    restore();
    restorePO();
  }
});

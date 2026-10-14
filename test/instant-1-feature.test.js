// INSTANT-1: the feature paints a stored snapshot before it reads the board, hands the
// snapshot shells to the live mount one frame later, and writes nothing on the way.
import assert from "node:assert/strict";
import test from "node:test";
import v8 from "node:v8";
import vm from "node:vm";

import { createLifecycle } from "../src/lifecycle.js";
import { installPlexusDiagram } from "../src/feature.js";
import { createBoardSnapStore } from "../src/host/boardsnap-store.js";
import { SNAP_VERSION, boardStamp } from "../src/model/boardsnap.js";
import { createFakeIDB } from "./fixtures/fake-idb.js";

const UID = "boardAAA1";
const tick = (ms = 5) => new Promise((resolve) => { setTimeout(resolve, ms); });

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
      toggle: (name, force) => {
        const on = force ?? !cls.has(name);
        if (on) cls.add(name); else cls.delete(name);
        return on;
      },
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


const SNAP = {
  v: SNAP_VERSION,
  uid: UID,
  stamp: "s",
  savedAt: 1,
  height: 480,
  width: 800,
  vp: { x: 0, y: 0, zoom: 1 },
  rootCls: "pxd-root pxd-root--light",
  rootStyle: {},
  items: [{
    uid: "cardAAAA1",
    section: false,
    x: 10,
    y: 20,
    w: 200,
    h: 100,
    cls: "pxd-item pxd-item--card pxd-item--note",
    sig: "x",
    face: { t: "div", k: [
      { t: "div", c: "pxd-item__header", k: ["Snap title"] },
      { t: "div", c: "pxd-item__body", k: [{ t: "div", c: "rm-block-main", k: ["Snap words"] }] },
    ] },
  }],
};

async function seededIdb(snap = SNAP, more = []) {
  const idb = createFakeIDB();
  const store = createBoardSnapStore({ indexedDB: idb, graph: "Svy", debounceMs: 0, idle: (fn) => fn() });
  await store.ready;
  store.set(UID, snap);
  for (const extra of more) store.set(extra.uid, extra);
  await tick(10);
  await store.dispose();
  idb.opens.length = 0;
  return idb;
}

function installEnv({ idb, flags = null, sidebar = false } = {}) {
  const saved = {};
  const globals = ["document", "window", "location", "MutationObserver", "IntersectionObserver"];
  for (const key of globals) saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const doc = makeDoc();
  const listeners = new Map();
  const win = {
    indexedDB: idb,
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    dispatchEvent() { return true; },
    fire(type, event) { for (const fn of [...(listeners.get(type) || [])]) fn({ type, ...event }); },
  };
  define("document", doc);
  define("window", win);
  define("location", { hash: "#/app/Svy" });
  define("MutationObserver", class { observe() {} disconnect() {} });
  const watchers = [];
  if (sidebar) {
    define("IntersectionObserver", class {
      constructor(cb) { this.cb = cb; this.targets = []; watchers.push(this); }
      observe(target) { this.targets.push(target); }
      unobserve(target) { this.targets = this.targets.filter((t) => t !== target); }
      disconnect() { this.targets = []; }
    });
  } else define("IntersectionObserver", undefined);
  const block = { ":block/props": { ":plexus": { ":v": 2 } } };
  const writes = [];
  const reads = { n: 0 };
  const host = {
    api: { data: { pull: (pattern) => { reads.n += 1; return pattern === "[:block/props]" ? block : pattern.startsWith("[:block/open") ? { ":block/open": false } : null; } } },
    stats: { writes: 0, watches: 0, renders: 0, reads: 0 },
    pageUid: () => null,
    blockString: () => { reads.n += 1; return null; },
    q: () => { reads.n += 1; return []; },
    generateUid: () => "newBoard01",
    createBlock: async (args) => { writes.push(["create", args]); return args.uid; },
    openBlock: async (uid) => { writes.push(["open", uid]); },
    setOpen: async (uid, open) => { writes.push(["open-state", uid, open]); },
    viewports: { get: () => null },
  };
  const board = {
    uid: UID,
    enhanced: true,
    items: new Map([["cardAAAA1", { uid: "cardAAAA1", type: "card", parentUid: UID, x: 10, y: 20, w: 200, h: 100, title: "Live", string: "Live" }]]),
    order: ["cardAAAA1"],
    edges: new Map(),
  };
  const acquired = [];
  const boards = new Map([[UID, board]]);
  const acquireSession = (uid) => {
    acquired.push({ uid, readsAtAcquire: reads.n });
    const own = boards.get(uid) || {
      uid,
      enhanced: true,
      items: new Map([["cardCCCC3", { uid: "cardCCCC3", type: "card", parentUid: uid, x: 0, y: 0, w: 100, h: 60, title: "Child", string: "Child" }]]),
      order: ["cardCCCC3"],
      edges: new Map(),
    };
    return { uid, board: own, on: () => () => {}, release() {} };
  };
  const seen = [];
  const mountView = (args) => {
    const shot = {
      args,
      snapRoot: Boolean(args.mountEl.querySelector(".pxd-snap-root")),
      shells: args.snapshot?.shells instanceof Map ? [...args.snapshot.shells.keys()] : null,
    };
    seen.push(shot);
    const root = doc.createElement("div");
    root.className = "pxd-root";
    shot.replayed = [];
    root.addEventListener("pointerdown", (event) => shot.replayed.push(event.type));
    root.addEventListener("pointerup", (event) => shot.replayed.push(event.type));
    args.mountEl.append(root);
    return { root, viewport: () => ({ x: 0, y: 0, zoom: 1 }), snapshotSource: () => (typeof shot.snapSource === "function" ? shot.snapSource() : null), dispose() { root.remove(); } };
  };
  const registry = () => ({ addCommand: async () => {}, removeCommand: async () => {} });
  const extensionAPI = {
    settings: { get: (id) => (id === "fullscreen-on-zoom" || id === "auto-enhance" ? false : id === "speed-flags" ? flags : null) },
    ui: { commandPalette: registry(), slashCommand: registry(), blockContextMenu: registry() },
    platform: { isMobile: () => false },
  };
  const storage = memoryStorage();
  storage.setItem(`plexus-diagram:collapsed:Svy:${UID}`, "1");
  const lifecycle = createLifecycle();
  const native = addNative(doc, UID);
  if (sidebar) {
    const pane = doc.createElement("div");
    pane.cls.add("rm-sidebar-window");
    pane.id = "sidebar-window-sidebar-block-x";
    doc.app.append(pane);
    pane.append(native);
    native.closestMap[".rm-sidebar-window"] = pane;
  }
  return {
    doc, host, writes, seen, acquired, reads, lifecycle, win, watchers,
    install: () => installPlexusDiagram({ extensionAPI, lifecycle, version: "x", mountView, host, acquireSession, storage }),
    restore() {
      for (const key of globals) {
        if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
        else delete globalThis[key];
      }
    },
  };
}

test("a stored snapshot paints before any board read; the live mount adopts its shells a frame later", async () => {
  const idb = await seededIdb();
  const env = installEnv({ idb });
  try {
    await env.install();
    const mount = env.doc.querySelector(".pxd-mount");
    const snapRoot = mount.querySelector(".pxd-snap-root");
    assert.ok(snapRoot, "the snapshot is on screen when install returns");
    const shell = snapRoot.querySelector(".pxd-item--snap");
    assert.ok(shell);
    assert.equal(shell.getAttribute("data-uid"), "cardAAAA1");
    assert.equal(shell.querySelector(".rm-block-main").children.length + 1 > 0, true);
    assert.equal(env.acquired.length, 0, "the session is not read before the snapshot paints");
    assert.equal(env.seen.length, 0);
    const api = env.win.__plexusDiagram;
    assert.equal(api.perf.lastOpen, null, "the open is recorded once the live board is in");

    await tick(20);
    assert.equal(env.acquired.length, 1, "the board is read on the next turn");
    assert.equal(env.seen.length, 1);
    const shot = env.seen[0];
    assert.equal(shot.snapRoot, true, "the snapshot stays up through the live mount");
    assert.deepEqual(shot.shells, ["cardAAAA1"], "the live mount gets the snapshot shells");
    assert.equal(typeof shot.args.onFirstPaint, "function");
    shot.args.onFirstPaint();
    assert.equal(mount.querySelector(".pxd-snap-root"), null, "the snapshot leaves on the live first paint");
    const open = api.perf.lastOpen;
    assert.equal(open.snap, true);
    assert.equal(open.queriesBeforePaint, 0);
    assert.ok(open.firstPaintMs <= open.liveMs);
    assert.deepEqual(env.writes.filter((w) => w[0] !== "open-state"), [], "nothing is written from snapshot data");
    for (const [name, version] of idb.opens) assert.ok(name !== "plexus-diagram" || version <= 2, `${name}@${version}`);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("a wheel pans the snapshot; the first click is kept for the live board, later ones and drags are not", async () => {
  const idb = await seededIdb();
  const env = installEnv({ idb });
  try {
    await env.install();
    const root = env.doc.querySelector(".pxd-mount").querySelector(".pxd-snap-root");
    const fire = (type, extra) => {
      for (const fn of [...(root.handlers?.[type] || [])]) fn({ type, button: 0, clientX: 0, clientY: 0, stopPropagation() {}, preventDefault() {}, ...extra });
    };
    fire("wheel", { deltaX: 30, deltaY: 10 });
    assert.equal(root.querySelector(".pxd-world").style.transform, "translate(-30px, -10px) scale(1)");
    // A drag pans and is not replayed.
    fire("pointerdown", { clientX: 100, clientY: 100 });
    env.win.fire("pointermove", { clientX: 140, clientY: 100 });
    env.win.fire("pointerup", { clientX: 140, clientY: 100 });
    assert.equal(root.querySelector(".pxd-world").style.transform, "translate(10px, -10px) scale(1)");
    // The first click is kept; the second is not.
    fire("pointerdown", { clientX: 50, clientY: 60 });
    env.win.fire("pointerup", { clientX: 50, clientY: 60 });
    fire("pointerdown", { clientX: 70, clientY: 80 });
    env.win.fire("pointerup", { clientX: 70, clientY: 80 });
    await tick(20);
    const shot = env.seen[0];
    assert.deepEqual(shot.args.initialViewport, { x: 10, y: -10, zoom: 1 }, "the live board opens where the snapshot was panned to");
    assert.deepEqual(shot.replayed, [], "nothing replays before the live first paint");
    shot.args.onFirstPaint();
    assert.deepEqual(shot.replayed, ["pointerdown", "pointerup"]);
    assert.deepEqual(env.writes.filter((w) => w[0] !== "open-state"), []);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("the snapshot flag off falls back to the old path", async () => {
  const idb = await seededIdb();
  const env = installEnv({ idb, flags: '{"snapshot":false}' });
  try {
    await env.install();
    const mount = env.doc.querySelector(".pxd-mount");
    assert.equal(mount.querySelector(".pxd-snap-root"), null);
    assert.equal(env.acquired.length, 1);
    assert.equal(env.seen.length, 1);
    assert.equal(env.seen[0].shells, null);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("dispose during the snapshot frame cancels the live mount and removes the snapshot", async () => {
  const idb = await seededIdb();
  const env = installEnv({ idb });
  try {
    await env.install();
    assert.ok(env.doc.querySelector(".pxd-snap-root"));
    await env.lifecycle.dispose();
    assert.equal(env.doc.querySelector(".pxd-snap-root"), null);
    await tick(20);
    assert.equal(env.seen.length, 0);
    assert.equal(env.acquired.length, 0);
  } finally {
    env.restore();
  }
});

test("a nested board with a snapshot paints it before its session is read", async () => {
  const child = {
    ...SNAP,
    uid: "childBBB2",
    items: [{ ...SNAP.items[0], uid: "cardCCCC3", face: { t: "div", k: [{ t: "div", c: "pxd-item__header", k: ["Child snap"] }] } }],
  };
  const idb = await seededIdb(SNAP, [child]);
  const env = installEnv({ idb });
  try {
    await env.install();
    await tick(20);
    env.seen[0].args.onFirstPaint();
    assert.equal(env.acquired.length, 1);
    env.seen[0].args.onOpenBoard("childBBB2");
    await tick(0);
    const mount = env.doc.querySelector(".pxd-mount");
    const root = mount.querySelector(".pxd-snap-root");
    assert.ok(root, "the nested board's snapshot is up");
    assert.equal(root.querySelector(".pxd-item--snap").getAttribute("data-uid"), "cardCCCC3");
    assert.equal(env.acquired.length, 1, "the nested session is not read yet");
    await tick(20);
    assert.equal(env.acquired.length, 2);
    assert.equal(env.acquired[1].uid, "childBBB2");
    assert.deepEqual(env.seen[1].shells, ["cardCCCC3"]);
    env.seen[1].args.onFirstPaint();
    assert.equal(mount.querySelector(".pxd-snap-root"), null);
    assert.equal(env.win.__plexusDiagram.perf.lastOpen.kind, "nested");
    assert.deepEqual(env.writes.filter((w) => w[0] !== "open-state"), []);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("a sidebar copy paints its snapshot while dormant; the viewport watcher brings the live board", async () => {
  const idb = await seededIdb();
  const env = installEnv({ idb, sidebar: true });
  try {
    await env.install();
    const mount = env.doc.querySelector(".pxd-mount");
    assert.ok(mount.querySelector(".pxd-snap-root"), "painted at mount, before the watcher fires");
    assert.equal(mount.style.minHeight, "480px", "the gap is the snapshot's height, no layout read");
    await tick(20);
    assert.equal(env.acquired.length, 0, "a dormant copy reads nothing");
    const io = env.watchers[0];
    assert.ok(io);
    io.cb([{ target: mount, isIntersecting: true }]);
    await tick(20);
    assert.equal(env.acquired.length, 1);
    assert.deepEqual(env.seen[0].shells, ["cardAAAA1"]);
    env.seen[0].args.onFirstPaint();
    assert.equal(mount.querySelector(".pxd-snap-root"), null);
    const open = env.win.__plexusDiagram.perf.lastOpen;
    assert.equal(open.kind, "sidebar");
    assert.equal(open.snap, true);
    assert.equal(open.queriesBeforePaint, 0);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

// verify 3.28 heap protocol: a kept-alive MAIN view held the first page render's native diagram (86k detached nodes)
// through the onFirstPaint callback of its snapshot mount, whose closure context held that mount record.
test("the snapshot mount's onFirstPaint does not keep the first mount record and its native diagram alive", async () => {
  const gcNow = async () => {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc");
    for (let i = 0; i < 3; i += 1) { gc(); await tick(5); }
  };
  const idb = await seededIdb();
  const held = await (async () => {
    const env = installEnv({ idb });
    try {
      await env.install();
      await tick(20);
      const onFirstPaint = env.seen[0].args.onFirstPaint;
      onFirstPaint();
      const native = env.doc.querySelector(".rm-diagram");
      const ref = new WeakRef(native);
      native.remove();
      env.seen.length = 0;
      return { onFirstPaint, ref };
    } finally {
      await env.lifecycle.dispose().catch(() => {});
      env.restore();
    }
  })();
  await gcNow();
  assert.equal(typeof held.onFirstPaint, "function", "the view still holds its callback");
  assert.equal(held.ref.deref(), undefined, "the first mount's native diagram was collected");
});

// P8 U3: the board read of the acquire runs in several tasks while the snapshot shows; acquire comes after the last.
function slicedReader(env, steps) {
  const log = { calls: [], cancelled: 0, turns: [] };
  let turn = 0;
  const bump = setInterval(() => { turn += 1; }, 0);
  env.host.prereadBoard = (uid) => {
    log.calls.push(uid);
    let left = steps;
    return {
      step() {
        log.turns.push({ turn, acquired: env.acquired.length });
        left -= 1;
        return left <= 0;
      },
      cancel() { log.cancelled += 1; },
    };
  };
  log.stop = () => clearInterval(bump);
  return log;
}

test("slicedMount: the snapshot open reads the board in steps on separate tasks, then acquires", async () => {
  const idb = await seededIdb();
  const env = installEnv({ idb });
  const log = slicedReader(env, 4);
  const seenAtAcquire = [];
  const acquired = env.acquired;
  const push = acquired.push.bind(acquired);
  acquired.push = (...x) => { seenAtAcquire.push(env.seen.length); return push(...x); };
  try {
    await env.install();
    assert.ok(env.doc.querySelector(".pxd-snap-root"));
    for (let i = 0; i < 100 && env.seen.length === 0; i += 1) await tick(10);
    assert.deepEqual(log.calls, [UID]);
    assert.equal(log.turns.length, 4);
    assert.ok(log.turns.every((t) => t.acquired === 0), "every read step runs before the acquire");
    assert.equal(env.acquired.length, 1);
    assert.equal(env.seen.length, 1, "the live view mounts after the read");
    assert.ok(seenAtAcquire.every((n) => n === 0), "the view mounts in a later task than the acquire");
  } finally {
    log.stop();
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
  }
});

test("slicedMount off: no sliced read; dispose during the read cancels it and never acquires", async () => {
  const idbA = await seededIdb();
  const off = installEnv({ idb: idbA, flags: '{"slicedMount":false}' });
  const logA = slicedReader(off, 3);
  try {
    await off.install();
    await tick(30);
    assert.deepEqual(logA.calls, []);
    assert.equal(off.acquired.length, 1);
  } finally {
    logA.stop();
    await off.lifecycle.dispose().catch(() => {});
    off.restore();
  }
  const idbB = await seededIdb();
  const env = installEnv({ idb: idbB });
  const log = slicedReader(env, 1000);
  try {
    await env.install();
    await tick(15);
    assert.ok(log.turns.length >= 1, "the read started");
    await env.lifecycle.dispose();
    const n = log.turns.length;
    await tick(20);
    assert.equal(log.turns.length, n, "no step after dispose");
    assert.ok(log.cancelled >= 1);
    assert.equal(env.acquired.length, 0);
  } finally {
    log.stop();
    env.restore();
  }
});

// P8 U2: the first settle after an open from a snapshot skips the capture when board and camera are what it holds.
test("the first settle after a snapshot open skips the capture when the board and camera did not change", async () => {
  const liveBoard = {
    uid: UID,
    enhanced: true,
    items: new Map([["cardAAAA1", { uid: "cardAAAA1", type: "card", parentUid: UID, x: 10, y: 20, w: 200, h: 100, title: "Live", string: "Live" }]]),
    order: ["cardAAAA1"],
    edges: new Map(),
  };
  const rects = new Map([["cardAAAA1", { x: 10, y: 20, w: 200, h: 100 }]]);
  for (const moved of [false, true]) {
    const idb = await seededIdb({ ...SNAP, stamp: boardStamp(liveBoard, rects) });
    const env = installEnv({ idb });
    try {
      await env.install();
      for (let i = 0; i < 100 && env.seen.length === 0; i += 1) await tick(10);
      const shot = env.seen[0];
      shot.snapSource = () => ({ board: liveBoard, rects, vp: moved ? { x: 50, y: 0, zoom: 1 } : { x: 0, y: 0, zoom: 1 }, shellOf: () => null, root: shot.args.mountEl, height: 480, width: 800 });
      shot.args.onSettled();
      await tick(1300);
      assert.equal(env.host.stats.snapSkips || 0, moved ? 0 : 1, moved ? "a moved camera captures" : "an unchanged board skips");
    } finally {
      await env.lifecycle.dispose().catch(() => {});
      env.restore();
    }
  }
});

test("P8 U2: a capture in parts is stored once though snapshotSource() makes a new rects map on every call", async () => {
  const liveBoard = {
    uid: UID,
    enhanced: true,
    items: new Map([["cardAAAA1", { uid: "cardAAAA1", type: "card", parentUid: UID, x: 10, y: 20, w: 200, h: 100, title: "Live", string: "Live" }]]),
    order: ["cardAAAA1"],
    edges: new Map(),
  };
  const savedRic = Object.getOwnPropertyDescriptor(globalThis, "requestIdleCallback");
  Object.defineProperty(globalThis, "requestIdleCallback", { value: (fn) => setTimeout(() => fn({ timeRemaining: () => 20, didTimeout: false }), 1), configurable: true, writable: true });
  const idb = await seededIdb({ ...SNAP, stamp: "old" });
  const env = installEnv({ idb });
  try {
    await env.install();
    for (let i = 0; i < 100 && env.seen.length === 0; i += 1) await tick(10);
    const shot = env.seen[0];
    let calls = 0;
    shot.snapSource = () => { calls += 1; return { board: liveBoard, rects: new Map([["cardAAAA1", { x: 10, y: 20, w: 200, h: 100 }]]), vp: { x: 50, y: 0, zoom: 1 }, shellOf: () => null, root: shot.args.mountEl, height: 480, width: 800 }; };
    shot.args.onSettled();
    await tick(4500);
    assert.ok(calls >= 2 && calls <= 3, `one capture, then quiet (${calls} snapshotSource calls)`);
  } finally {
    await env.lifecycle.dispose().catch(() => {});
    env.restore();
    if (savedRic) Object.defineProperty(globalThis, "requestIdleCallback", savedRic); else delete globalThis.requestIdleCallback;
  }
});

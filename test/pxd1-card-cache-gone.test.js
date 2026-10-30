// PXD-1: card-cache stamps come from one pullMany; enhanced uids it does not return are gone and are never pulled.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { resetSharedBgBudget } from "../src/bg-budget.js";
import { graphCacheKey, writeEnhancedUidCache } from "../src/discovery.js";
import { installPlexusDiagram } from "../src/feature.js";
import { createLifecycle } from "../src/lifecycle.js";
import { noteSpeedFlags } from "../src/settings.js";

const MOUNTED = "boardMnt1";
const OTHERS = ["boardOth1", "boardOth2", "boardOth3"];
const GONE = ["boardGon1", "boardGon2"];
const tick = (ms = 5) => new Promise((resolve) => { setTimeout(resolve, ms); });

afterEach(() => { noteSpeedFlags(null); resetSharedBgBudget(); });

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



const raw = (uid, cardUid, target) => ({
  ":block/uid": uid,
  ":block/string": `{{[[diagram]]:Board ${uid}}}`,
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": [{
    ":block/uid": cardUid,
    ":block/string": `((${target}))`,
    ":block/order": 0,
    ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 100, ":h": 60 } },
    ":block/children": [],
  }],
});

// idle callbacks are captured so the test decides when a slice runs and how many boards one slice pulled.
function installEnv({ flags = null, pullMany = null } = {}) {
  const saved = {};
  const globals = ["document", "window", "location", "MutationObserver", "IntersectionObserver", "requestIdleCallback", "cancelIdleCallback"];
  for (const key of globals) saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const doc = makeDoc();
  const win = {
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  };
  define("document", doc);
  define("window", win);
  define("location", { hash: "#/app/Svy" });
  define("MutationObserver", class { observe() {} disconnect() {} });
  define("IntersectionObserver", undefined);
  const idleQueue = [];
  let idleId = 0;
  define("requestIdleCallback", (fn) => { idleId += 1; idleQueue.push({ id: idleId, fn }); return idleId; });
  define("cancelIdleCallback", (id) => { const i = idleQueue.findIndex((e) => e.id === id); if (i >= 0) idleQueue.splice(i, 1); });
  const state = { slice: 0, pulls: [], pullManyCalls: [] };
  const block = { ":block/props": { ":plexus": { ":v": 2 } } };
  const host = {
    api: { data: { pull: (pattern) => (pattern === "[:block/props]" ? block : pattern.startsWith("[:block/open") ? { ":block/open": false } : null) } },
    stats: { writes: 0, watches: 0, renders: 0, reads: 0 },
    pageUid: () => null,
    blockString: () => null,
    q: (_query, uids) => (Array.isArray(uids) ? uids.map((u) => [u, 1000]) : []),
    generateUid: () => "newBoard01",
    createBlock: async (args) => args.uid,
    openBlock: async () => {},
    setOpen: async () => {},
    viewports: { get: () => null },
    ...(pullMany ? { pullMany: (pattern, uids) => { state.pullManyCalls.push({ pattern, uids: [...uids] }); return pullMany(pattern, uids); } } : {}),
    pullBoard: (uid) => {
      state.pulls.push({ uid, slice: state.slice });
      const i = OTHERS.indexOf(uid);
      return raw(uid, `card${uid}`, i >= 0 ? `tgt${i}` : "tgtM");
    },
  };
  const liveBoard = {
    uid: MOUNTED,
    enhanced: true,
    items: new Map([["cardMnt01", { uid: "cardMnt01", type: "card", parentUid: MOUNTED, x: 0, y: 0, w: 100, h: 60, title: "Live", string: "Live", target: { kind: "block", uid: "tgtLive" } }]]),
    order: ["cardMnt01"],
    edges: new Map(),
  };
  const acquireSession = (uid) => ({ uid, board: uid === MOUNTED ? liveBoard : { uid, enhanced: true, items: new Map(), order: [], edges: new Map() }, on: () => () => {}, release() {} });
  const views = [];
  const mountView = (args) => {
    views.push(args);
    const root = doc.createElement("div");
    root.className = "pxd-root";
    args.mountEl.append(root);
    return { root, viewport: () => ({ x: 0, y: 0, zoom: 1 }), snapshotSource: () => null, dispose() { root.remove(); } };
  };
  const registry = () => ({ addCommand: async () => {}, removeCommand: async () => {} });
  const extensionAPI = {
    settings: { get: (id) => (id === "fullscreen-on-zoom" || id === "auto-enhance" ? false : id === "speed-flags" ? flags : null) },
    ui: { commandPalette: registry(), slashCommand: registry(), blockContextMenu: registry() },
    platform: { isMobile: () => false },
  };
  const storage = memoryStorage();
  storage.setItem(`plexus-diagram:collapsed:Svy:${MOUNTED}`, "1");
  writeEnhancedUidCache([MOUNTED, ...OTHERS, ...GONE], storage, graphCacheKey("#/app/Svy"));
  const lifecycle = createLifecycle();
  addNative(doc, MOUNTED);
  return {
    host, state, views, lifecycle, win, idleQueue,
    install: () => installPlexusDiagram({ extensionAPI, lifecycle, version: "x", mountView, host, acquireSession, storage }),
    // Runs queued idle callbacks one at a time, counting each as a slice. timeRemaining is 0, so the budget runs exactly one
    // part of a job per slice (it always runs one) and a slice's pulls are the pulls of one part. Runs until nothing is left for `quietMs`.
    async drain(quietMs = 120, maxMs = 5000) {
      const t0 = Date.now();
      let idleFor = 0;
      while (idleFor < quietMs && Date.now() - t0 < maxMs) {
        const next = idleQueue.shift();
        if (next) {
          state.slice += 1;
          next.fn({ timeRemaining: () => 0, didTimeout: false });
          idleFor = 0;
        } else {
          await tick(10);
          idleFor += 10;
        }
      }
    },
    restore() {
      for (const key of globals) {
        if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
        else delete globalThis[key];
      }
    },
  };
}

async function run(opts) {
  const env = installEnv(opts);
  await env.install();
  // The refresh is first scheduled 600 ms after install.
  await tick(700);
  await env.drain();
  return env;
}

const boardsOf = (env, target) => env.views[0].boardsOf(target);
const done = async (env) => { await env.lifecycle.dispose().catch(() => {}); env.restore(); };


const existing = new Set([MOUNTED, ...OTHERS]);

test("pullMany stamps: uids the pull does not return are never pulled; existing unmounted boards still are", async () => {
  const env = await run({ pullMany: (_p, uids) => uids.filter((u) => existing.has(u)).map((u) => ({ ":block/uid": u, ":edit/time": 1000 })) });
  try {
    assert.ok(env.state.pullManyCalls.length > 0, "the stamps came from pullMany");
    assert.equal(env.state.pullManyCalls[0].pattern, "[:block/uid :edit/time]");
    const pulled = new Set(env.state.pulls.map((p) => p.uid));
    for (const uid of GONE) assert.equal(pulled.has(uid), false, `${uid} is gone and not pulled`);
    assert.equal(pulled.has(MOUNTED), false);
    for (const [i, uid] of OTHERS.entries()) {
      assert.equal(pulled.has(uid), true, `${uid} is pulled`);
      assert.deepEqual(boardsOf(env, `tgt${i}`), [uid], `${uid} cards are cached`);
    }
    assert.equal(typeof env.win.__plexusDiagram.cardCacheMs(), "number", "the refresh finished");
  } finally {
    await done(env);
  }
});

test("pullMany returning no rows is a failed read: no uid is gone, every unmounted board is pulled", async () => {
  const env = await run({ pullMany: () => [] });
  try {
    assert.ok(env.state.pullManyCalls.length > 0);
    const pulled = new Set(env.state.pulls.map((p) => p.uid));
    for (const uid of [...OTHERS, ...GONE]) assert.equal(pulled.has(uid), true, `${uid} is pulled`);
    assert.equal(pulled.has(MOUNTED), false);
    for (const [i, uid] of OTHERS.entries()) assert.deepEqual(boardsOf(env, `tgt${i}`), [uid]);
  } finally {
    await done(env);
  }
});

test("pullMany throwing: no uid is gone, every unmounted board is pulled", async () => {
  const env = await run({ pullMany: () => { throw new Error("boom"); } });
  try {
    const pulled = new Set(env.state.pulls.map((p) => p.uid));
    for (const uid of [...OTHERS, ...GONE]) assert.equal(pulled.has(uid), true, `${uid} is pulled`);
  } finally {
    await done(env);
  }
});

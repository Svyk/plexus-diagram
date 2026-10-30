// PXD-1: the card-cache refresh runs one board per background slice and never pulls a board shown in a mount.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { resetSharedBgBudget } from "../src/bg-budget.js";
import { graphCacheKey, writeEnhancedUidCache } from "../src/discovery.js";
import { installPlexusDiagram } from "../src/feature.js";
import { createLifecycle } from "../src/lifecycle.js";
import { noteSpeedFlags } from "../src/settings.js";

const MOUNTED = "boardMnt1";
const OTHERS = ["boardOth1", "boardOth2", "boardOth3"];
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
function installEnv({ flags = null } = {}) {
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
  const state = { slice: 0, pulls: [] };
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
  writeEnhancedUidCache([MOUNTED, ...OTHERS], storage, graphCacheKey("#/app/Svy"));
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

async function run(flags) {
  const env = installEnv({ flags });
  await env.install();
  // The refresh is first scheduled 600 ms after install.
  await tick(700);
  await env.drain();
  return env;
}

const boardsOf = (env, target) => env.views[0].boardsOf(target);
const done = async (env) => { await env.lifecycle.dispose().catch(() => {}); env.restore(); };

test("a board shown in a mount is never pulled by the card-cache refresh; the other boards' cards still land", async () => {
  const env = await run(null);
  try {
    assert.ok(env.views.length >= 1, "the board is mounted");
    assert.ok(env.state.pulls.length > 0, "the refresh pulled something");
    assert.deepEqual(env.state.pulls.filter((p) => p.uid === MOUNTED), [], "the mounted board is not pulled");
    for (const [i, uid] of OTHERS.entries()) assert.deepEqual(boardsOf(env, `tgt${i}`), [uid], `${uid} cards are cached`);
    assert.deepEqual(boardsOf(env, "tgtLive"), [MOUNTED], "the mounted board's cards come from its session");
    assert.equal(typeof env.win.__plexusDiagram.cardCacheMs(), "number", "the refresh finished");
  } finally {
    await done(env);
  }
});

test("slicedCards on: no idle slice pulls more than one board", async () => {
  const env = await run(null);
  try {
    const pulled = env.state.pulls.filter((p) => OTHERS.includes(p.uid));
    assert.deepEqual([...new Set(pulled.map((p) => p.uid))].sort(), OTHERS.slice().sort());
    const perSlice = new Map();
    for (const p of pulled) perSlice.set(p.slice, (perSlice.get(p.slice) || 0) + 1);
    assert.ok(!perSlice.has(0), "no pull runs outside an idle slice");
    assert.ok(perSlice.size >= OTHERS.length, `one slice per board, got ${JSON.stringify([...perSlice])}`);
    for (const [slice, n] of perSlice) assert.ok(n <= 1, `slice ${slice} pulled ${n} boards`);
  } finally {
    await done(env);
  }
});

test("slicedCards off: the old one-task refresh still fills the cache, outside any idle slice", async () => {
  const env = await run(JSON.stringify({ slicedCards: false }));
  try {
    const pulled = env.state.pulls.filter((p) => OTHERS.includes(p.uid));
    assert.deepEqual([...new Set(pulled.map((p) => p.uid))].sort(), OTHERS.slice().sort());
    assert.ok(pulled.every((p) => p.slice === 0), "the old path pulls in one task, no idle slice");
    for (const [i, uid] of OTHERS.entries()) assert.deepEqual(boardsOf(env, `tgt${i}`), [uid]);
    assert.equal(typeof env.win.__plexusDiagram.cardCacheMs(), "number");
  } finally {
    await done(env);
  }
});

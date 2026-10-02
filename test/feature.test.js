import assert from "node:assert/strict";
import test from "node:test";

import { createLifecycle } from "../src/lifecycle.js";
import { installPlexusDiagram, PACKAGE_VERSION } from "../src/feature.js";
import { mergePropsForWrite } from "../src/model/schema.js";
import { PREPAINT_STYLE_ID } from "../src/discovery.js";

// ---- minimal DOM ------------------------------------------------------------------------------

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
  get previousElementSibling() {
    const siblings = this.parentElement?.children;
    return siblings ? siblings[siblings.indexOf(this) - 1] ?? null : null;
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); this.attrWrites = (this.attrWrites || 0) + 1; }
  removeAttribute(name) { this.attrs.delete(name); this.attrWrites = (this.attrWrites || 0) + 1; }
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

// Roam's block DOM: .roam-block-container > .rm-block-main (block input + the diagram) + .rm-block-children.
function addBlock(doc, uid, { parent = doc.app, children = true, input = true } = {}) {
  const container = doc.createElement("div");
  container.cls.add("roam-block-container");
  const main = doc.createElement("div");
  main.cls.add("rm-block-main");
  container.append(main);
  if (input) {
    const inputEl = doc.createElement("div");
    inputEl.id = `block-input-w-body-outline-${uid}`;
    main.append(inputEl);
  }
  let kids = null;
  if (children) {
    kids = doc.createElement("div");
    kids.cls.add("rm-block-children");
    container.append(kids);
  }
  parent.append(container);
  parent.closestMap[".roam-block-container"] = parent.cls.has("roam-block-container") ? parent : parent.closestMap[".roam-block-container"] ?? null;
  return { container, main, kids };
}

function addBoardBlock(doc, uid, opts) {
  const block = addBlock(doc, uid, opts);
  const { native, panel } = addNative(doc, uid, { parent: block.main });
  native.closestMap[".roam-block-container"] = block.container;
  return { ...block, native, panel };
}

// A board block rendered inside another block's .rm-block-children (Roam's outline copy of a card).
function addOutlineBoard(doc, uid, parentBlock, opts) {
  const block = addBoardBlock(doc, uid, { ...opts, parent: parentBlock.kids });
  parentBlock.kids.closestMap[".roam-block-container"] = parentBlock.container;
  return block;
}

// ---- environment fixture ------------------------------------------------------------------------

function setup({ enhanced = [], legacy = null, settings = {}, hash = "" } = {}) {
  const saved = {};
  const globals = ["document", "window", "location", "MutationObserver", "setInterval", "clearInterval"];
  for (const key of globals) saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });

  const doc = makeDoc();
  const listeners = new Map();
  const win = {
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
  };
  const env = { doc, win, hash, observers: new Set(), intervals: new Map(), nextInterval: 1 };
  define("document", doc);
  define("window", win);
  define("location", { hash });
  define("MutationObserver", class {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.target = target; env.observers.add(this); }
    disconnect() { env.observers.delete(this); }
  });
  define("setInterval", (callback) => { const id = env.nextInterval++; env.intervals.set(id, callback); return id; });
  define("clearInterval", (id) => env.intervals.delete(id));

  const props = new Map(enhanced.map((uid) => [uid, { ":plexus": { ":v": 2 }, ":rf-diagram": { ":x": 1 } }]));
  const strings = new Map();
  const writes = { createBlock: [], openBlock: [], setOpen: [], other: 0 };
  const legacyTree = legacy && {
    ":block/uid": "meta",
    ":block/children": [
      { ":block/string": "schema-version:: 1", ":block/children": [] },
      {
        ":block/string": "enhanced::",
        ":block/children": legacy.map(({ uid, migrated }) => ({
          ":block/string": uid,
          ":block/children": migrated
            ? [{ ":block/string": "node abc", ":block/children": [{ ":block/string": "migrated:: 2" }] }]
            : [{ ":block/string": "node abc", ":block/children": [{ ":block/string": "pos:: 1,2" }] }],
        })),
      },
    ],
  };
  const host = {
    api: {
      data: {
        pull(pattern, ref) {
          if (pattern.startsWith("[:block/open")) return env.openState?.[ref[1]] ?? null;
          if (pattern === "[:block/props]") return { ":block/props": props.get(ref[1]) ?? null };
          if (pattern.includes(":block/parents")) return env.ancestors?.[ref[1]] ?? null;
          if (pattern.includes("...")) return legacyTree;
          return null;
        },
      },
      ui: { getFocusedBlock: () => env.focused ?? null },
    },
    stats: { writes: 0, watches: 0, renders: 0 },
    pageUid: (title) => (title === "plexus-diagram/metadata" && legacyTree ? "meta" : null),
    blockString: (uid) => strings.get(uid) ?? null,
    q: () => env.parents ?? [],
    generateUid: () => "newBoard01",
    createBlock: async (args) => { writes.createBlock.push(args); return args.uid; },
    openBlock: async (uid) => { writes.openBlock.push(uid); },
    setOpen: async (uid, open) => { writes.setOpen.push([uid, open]); },
  };

  const sessions = { acquired: 0, released: 0, enhance: 0, restore: 0, live: new Map(), made: [], options: [] };
  const acquireSession = (uid, options) => {
    sessions.acquired += 1;
    sessions.options.push(options);
    sessions.live.set(uid, (sessions.live.get(uid) || 0) + 1);
    const handlers = new Set();
    const goneHandlers = new Set();
    const session = {
      uid,
      board: env.ghost?.has(uid) ? null : { enhanced: props.has(uid) },
      on: (name, fn) => {
        const set = name === "change" ? handlers : name === "gone" ? goneHandlers : null;
        set?.add(fn);
        return () => set?.delete(fn);
      },
      emitGone: () => goneHandlers.forEach((fn) => fn()),
      emitChange: () => handlers.forEach((fn) => fn()),
      handlerCount: () => handlers.size,
      enhance: async () => { sessions.enhance += 1; props.set(uid, { ":plexus": { ":v": 2 } }); },
      restoreNative: async () => {
        sessions.restore += 1;
        const next = mergePropsForWrite(props.get(uid), null);
        if (Object.keys(next).length) props.set(uid, Object.fromEntries(Object.entries(next).map(([k, v]) => [k.startsWith(":") ? k : `:${k}`, v])));
        else props.delete(uid);
      },
      release: () => { sessions.released += 1; sessions.live.set(uid, sessions.live.get(uid) - 1); },
    };
    sessions.made.push(session);
    return session;
  };

  const views = [];
  const mountView = (args) => {
    const view = { args, disposed: 0, fullscreen: [], dispose() { this.disposed += 1; }, setFullscreen(v) { this.fullscreen.push(v); } };
    views.push(view);
    return view;
  };

  const commands = { palette: new Map(), slash: new Map(), context: new Map(), removed: [] };
  const registry = (map, kind) => ({
    addCommand: async (config) => { map.set(config.label, config); },
    removeCommand: async ({ label }) => { map.delete(label); commands.removed.push([kind, label]); },
  });
  const values = { ...settings };
  const extensionAPI = {
    settings: { get: (id) => values[id] ?? null },
    ui: {
      commandPalette: registry(commands.palette, "palette"),
      slashCommand: registry(commands.slash, "slash"),
      blockContextMenu: registry(commands.context, "context"),
    },
    platform: { isMobile: () => false },
  };

  const storageMap = new Map();
  const storage = {
    getItem: (k) => storageMap.get(k) ?? null,
    setItem: (k, v) => { storageMap.set(k, String(v)); },
  };

  const lifecycle = createLifecycle();
  const tick = () => { for (const callback of [...env.intervals.values()]) callback(); };
  const restore = () => {
    for (const key of globals) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  };
  return {
    env, doc, host, extensionAPI, props, strings, writes, sessions, views, commands, storage, storageMap, lifecycle, tick, restore,
    install: () => installPlexusDiagram({ extensionAPI, lifecycle, version: "x", mountView, host, acquireSession, storage }),
    setHash(next) { globalThis.location = { hash: next }; for (const fn of [...(listeners.get("hashchange") || [])]) fn(); },
    listeners,
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

// ---- tests ------------------------------------------------------------------------------------

test("session() acquires a board session and the caller releases it", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    await t.install();
    const before = t.sessions.acquired;
    const session = t.env.win.__plexusDiagram.session("boardAAA1");
    assert.equal(session.uid, "boardAAA1");
    assert.equal(t.sessions.acquired, before + 1);
    assert.equal(t.env.win.__plexusDiagram.session(""), null);
    session.release();
    assert.equal(t.sessions.released, 1);
  });
});

test("PACKAGE_VERSION comes from package.json", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(PACKAGE_VERSION, pkg.version);
});

test("an enhanced diagram mounts exactly once and hides the native surfaces", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    const { native, panel } = addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    t.tick();
    assert.equal(t.views.length, 1);
    assert.equal(t.sessions.acquired, 1);
    assert.ok(native.classList.contains("pxd-native-hidden"));
    assert.equal(panel.style.display, "none");
    const mountEl = t.views[0].args.mountEl;
    assert.equal(mountEl.parentElement, native.parentElement);
    assert.equal(native.parentElement.children.indexOf(mountEl), native.parentElement.children.indexOf(native) + 1);
    assert.equal(t.views[0].args.nativeEl, native);
    assert.equal(t.views[0].args.version, PACKAGE_VERSION);
    assert.equal(t.views[0].args.settings["graph-links"], "all");
    assert.deepEqual(t.env.win.__plexusDiagram.mounts(), [{ uid: "boardAAA1", current: "boardAAA1", crumbs: ["boardAAA1"], fullscreen: false, connected: true, state: null }]);
    assert.equal(t.env.win.__plexusDiagram.version, PACKAGE_VERSION);
    assert.equal(t.env.win.__plexusDiagram.stats, t.host.stats);
    assert.match(t.doc.getElementById(PREPAINT_STYLE_ID).textContent, /boardAAA1/);
  });
});

test("a native diagram that is not enhanced is never touched", async () => {
  await withEnv({ enhanced: [] }, async (t) => {
    const { native, panel } = addNative(t.doc, "plainBBB1");
    const siblings = native.parentElement.children.length;
    await t.install();
    t.tick();
    t.tick();
    assert.equal(t.views.length, 0);
    assert.equal(t.sessions.acquired, 0);
    assert.equal(native.cls.size, 1);
    assert.equal(panel.style.display, "");
    assert.equal(native.parentElement.children.length, siblings);
    assert.equal(t.writes.createBlock.length, 0);
    assert.equal(t.sessions.enhance + t.sessions.restore, 0);
  });
});

test("restore unmounts, releases the session and removes only the plexus key", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    const { native, panel } = addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    const mountEl = t.views[0].args.mountEl;
    t.env.focused = { "block-uid": "boardAAA1" };
    t.strings.set("boardAAA1", "{{[[diagram]]:Board}}");
    await t.commands.palette.get("Plexus: Restore native diagram").callback({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(t.sessions.restore, 1);
    assert.equal(t.views[0].disposed, 1);
    assert.equal(t.sessions.released, t.sessions.acquired);
    assert.equal(mountEl.isConnected, false);
    assert.ok(!native.classList.contains("pxd-native-hidden"));
    assert.equal(panel.style.display, "");
    assert.deepEqual(t.props.get("boardAAA1"), { ":rf-diagram": { x: 1 } });
    t.tick();
    assert.equal(t.views.length, 1, "a restored board is not remounted");
    assert.doesNotMatch(t.doc.getElementById(PREPAINT_STYLE_ID).textContent, /boardAAA1/);
  });
});

test("an unmounted native element (route change) unmounts the view", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    const { native } = addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    native.remove();
    t.tick();
    assert.equal(t.views[0].disposed, 1);
    assert.equal(t.sessions.released, 1);
    assert.deepEqual(t.env.win.__plexusDiagram.mounts(), []);
  });
});

test("dispose leaves zero mounts, observers, intervals, listeners, tags and globals", async () => {
  const t = setup({ enhanced: ["boardAAA1"] });
  try {
    const { native, panel } = addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    assert.ok(t.env.observers.size >= 1);
    assert.equal(t.env.intervals.size, 1);
    assert.ok([...t.listeners.values()].some((set) => set.size > 0));
    await t.lifecycle.dispose();
    assert.equal(t.env.observers.size, 0);
    assert.equal(t.env.intervals.size, 0);
    assert.ok([...t.listeners.values()].every((set) => set.size === 0));
    assert.equal(t.views[0].disposed, 1);
    assert.equal(t.sessions.released, t.sessions.acquired);
    assert.equal(t.doc.getElementById(PREPAINT_STYLE_ID), null);
    assert.equal(t.env.win.__plexusDiagram, undefined);
    assert.ok(!native.classList.contains("pxd-native-hidden"));
    assert.equal(panel.style.display, "");
    assert.equal(native.parentElement.children.filter((n) => n.cls.has("pxd-mount")).length, 0);
    assert.equal(t.commands.palette.size + t.commands.slash.size + t.commands.context.size, 0);
  } finally {
    t.restore();
  }
});

test("commands register in palette and slash, the context menu gets Enhance, and all are removed", async () => {
  const t = setup();
  try {
    await t.install();
    const labels = ["Plexus: Enhance this diagram", "Plexus: New whiteboard here", "Plexus: Restore native diagram", "Plexus: Fullscreen this diagram", "Plexus: Export board as SVG", "Plexus: Copy board as text"];
    assert.deepEqual([...t.commands.palette.keys()], labels);
    assert.deepEqual([...t.commands.slash.keys()], labels);
    assert.deepEqual([...t.commands.context.keys()], ["Plexus: Enhance", "Show on board"]);
    const context = t.commands.context.get("Plexus: Enhance");
    assert.equal(context["display-conditional"]({ "block-string": "{{[[diagram]]}}" }), true);
    assert.equal(context["display-conditional"]({ "block-string": "plain" }), false);
    assert.equal(t.commands.context.get("Show on board")["display-conditional"]({ "block-uid": "plain" }), false);
    await t.lifecycle.dispose();
    assert.equal(t.commands.palette.size + t.commands.slash.size + t.commands.context.size, 0);
    assert.equal(t.commands.removed.length, 14);
  } finally {
    t.restore();
  }
});

test("Show on board is hidden for an ordinary block and opens the card deep link", async () => {
  const t = setup({ hash: "#/app/Readwisenotes/page/otherPAGE" });
  const hits = {
    cardAAAA1: { boardUid: "board0001", pageUid: "pageLAB99", cardUid: "cardAAAA1" },
    srcBLOCK1: { boardUid: "boardZZZ9", pageUid: "pageLAB99", cardUid: "cardREF01" },
  };
  t.host.graph = "Readwisenotes";
  t.host.showOnBoard = (uid) => hits[uid] || null;
  let same = 0;
  t.env.win.dispatchEvent = () => { same += 1; };
  try {
    await t.install();
    const cmd = t.commands.context.get("Show on board");
    t.host.showOnBoard = () => { throw new Error("query failed"); };
    assert.equal(cmd["display-conditional"]({ "block-uid": "cardAAAA1" }), false);
    t.host.showOnBoard = (uid) => hits[uid] || null;
    assert.equal(cmd["display-conditional"]({ "block-uid": "cardAAAA1" }), true);
    assert.equal(cmd["display-conditional"]({ "block-uid": "srcBLOCK1" }), true);
    assert.equal(cmd["display-conditional"]({ "block-uid": "plainBLOCK" }), false);
    assert.equal(cmd["display-conditional"]({}), false);
    cmd.callback({ "block-uid": "srcBLOCK1" });
    assert.equal(globalThis.location.hash, "#/app/Readwisenotes/page/pageLAB99?pxd=cardREF01");
    assert.equal(same, 0);
    cmd.callback({ "block-uid": "cardAAAA1" });
    assert.equal(globalThis.location.hash, "#/app/Readwisenotes/page/pageLAB99?pxd=cardAAAA1");
    cmd.callback({ "block-uid": "cardAAAA1" });
    assert.equal(same, 1, "the same link asks the open board to pulse again");
    cmd.callback({ "block-uid": "plainBLOCK" });
    assert.equal(globalThis.location.hash, "#/app/Readwisenotes/page/pageLAB99?pxd=cardAAAA1");
  } finally {
    await t.lifecycle.dispose().catch(() => {});
    t.restore();
  }
});

test("Enhance runs session.enhance once, then mounts the diagram", async () => {
  await withEnv({ enhanced: [] }, async (t) => {
    const { native } = addNative(t.doc, "plainBBB1");
    await t.install();
    t.tick();
    assert.equal(t.views.length, 0);
    t.env.focused = { "block-uid": "plainBBB1" };
    t.strings.set("plainBBB1", "{{[[diagram]]:Plain}}");
    await t.commands.palette.get("Plexus: Enhance this diagram").callback({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(t.sessions.enhance, 1);
    assert.equal(t.views.length, 1);
    assert.ok(native.classList.contains("pxd-native-hidden"));
    assert.match(t.doc.getElementById(PREPAINT_STYLE_ID).textContent, /plainBBB1/);
  });
});

test("Enhance finds the diagram ancestor of a focused child block", async () => {
  await withEnv({ enhanced: [] }, async (t) => {
    addNative(t.doc, "plainBBB1");
    await t.install();
    t.env.focused = { "block-uid": "childCCC1" };
    t.env.parents = [["otherPar1", "just text"], ["plainBBB1", "{{[[diagram]]}}"]];
    await t.commands.slash.get("Plexus: Enhance this diagram").callback({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(t.sessions.enhance, 1);
    assert.equal(t.views[0].args.session.uid, "plainBBB1");
  });
});

test("New whiteboard creates one block with props in the create call, then opens it", async () => {
  await withEnv({}, async (t) => {
    await t.install();
    t.env.focused = { "block-uid": "parentPP1" };
    await t.commands.palette.get("Plexus: New whiteboard here").callback({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(t.writes.createBlock.length, 1);
    assert.deepEqual(t.writes.createBlock[0], {
      parentUid: "parentPP1",
      order: "last",
      uid: "newBoard01",
      string: "{{[[diagram]]:Untitled board}}",
      props: { plexus: { v: 2 } },
      open: false,
    });
    assert.deepEqual(t.writes.openBlock, ["newBoard01"]);
    assert.equal(t.sessions.enhance, 0);
  });
});

test("New whiteboard with collapse-outline off creates the block without open", async () => {
  await withEnv({ settings: { "collapse-outline": false } }, async (t) => {
    await t.install();
    t.env.focused = { "block-uid": "parentPP1" };
    await t.commands.palette.get("Plexus: New whiteboard here").callback({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(t.writes.createBlock[0].open, undefined);
  });
});

test("New whiteboard without a focused block writes nothing", async () => {
  await withEnv({}, async (t) => {
    await t.install();
    await t.commands.palette.get("Plexus: New whiteboard here").callback({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(t.writes.createBlock.length, 0);
  });
});

test("a 0.6-enhanced board mounts and triggers exactly one enhance; a later mount does not", async () => {
  await withEnv({
    enhanced: [],
    legacy: [{ uid: "legacyLL01", migrated: false }, { uid: "doneDDD01", migrated: true }],
    hash: "#/app/Svy",
  }, async (t) => {
    const first = addNative(t.doc, "legacyLL01");
    const done = addNative(t.doc, "doneDDD01");
    await t.install();
    assert.match(t.doc.getElementById(PREPAINT_STYLE_ID).textContent, /legacyLL01/);
    assert.doesNotMatch(t.doc.getElementById(PREPAINT_STYLE_ID).textContent, /doneDDD01/);
    t.tick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(t.views.length, 1);
    assert.equal(t.sessions.enhance, 1);
    assert.ok(t.storageMap.has("plexus-diagram:migrated:Svy:legacyLL01"));
    assert.ok(!done.native.classList.contains("pxd-native-hidden"), "already-migrated 0.6 entries are not treated as enhanced");

    first.native.remove();
    t.tick();
    assert.equal(t.views[0].disposed, 1);
    addNative(t.doc, "legacyLL01");
    t.tick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(t.views.length, 2);
    assert.equal(t.sessions.enhance, 1, "second mount must not enhance again");
  });
});

test("a failing 0.6 import is not retried on the next mount", async () => {
  await withEnv({ legacy: [{ uid: "legacyLL01", migrated: false }], hash: "#/app/Svy" }, async (t) => {
    const first = addNative(t.doc, "legacyLL01");
    const originalError = console.warn;
    console.warn = () => {};
    try {
      let calls = 0;
      const failing = () => ({ uid: "legacyLL01", board: null, on: () => () => {}, enhance: async () => { calls += 1; throw new Error("import failed"); }, release() {} });
      await installPlexusDiagram({
        extensionAPI: { settings: { get: () => null }, ui: { commandPalette: { addCommand() {}, removeCommand() {} } } },
        lifecycle: t.lifecycle,
        host: t.host,
        acquireSession: failing,
        mountView: () => ({ dispose() {}, setFullscreen() {} }),
        storage: t.storage,
      });
      t.tick();
      await new Promise((resolve) => setImmediate(resolve));
      first.native.remove();
      t.tick();
      addNative(t.doc, "legacyLL01");
      t.tick();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls, 1);
    } finally {
      console.warn = originalError;
    }
  });
});

test("fullscreen-on-zoom opens the zoomed board fullscreen and leaving the route exits", async () => {
  await withEnv({ enhanced: ["boardAAA1"], hash: "#/app/Svy/page/boardAAA1" }, async (t) => {
    addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    assert.equal(t.views[0].args.fullscreen, true);
    t.setHash("#/app/Svy/page/08-27-2026");
    assert.deepEqual(t.views[0].fullscreen, [false]);
    assert.equal(t.env.win.__plexusDiagram.mounts()[0].fullscreen, false);
    t.setHash("#/app/Svy/page/boardAAA1");
    assert.deepEqual(t.views[0].fullscreen, [false, true]);
  });
});

test("fullscreen-on-zoom off keeps the zoomed board inline", async () => {
  await withEnv({ enhanced: ["boardAAA1"], hash: "#/app/Svy/page/boardAAA1", settings: { "fullscreen-on-zoom": false } }, async (t) => {
    addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    assert.equal(t.views[0].args.fullscreen, false);
  });
});

test("onRequestFullscreen and the Fullscreen command drive view.setFullscreen", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    t.views[0].args.onRequestFullscreen(true);
    assert.deepEqual(t.views[0].fullscreen, [true]);
    t.strings.set("boardAAA1", "{{[[diagram]]}}");
    t.env.focused = { "block-uid": "boardAAA1" };
    await t.commands.palette.get("Plexus: Fullscreen this diagram").callback({});
    assert.deepEqual(t.views[0].fullscreen, [true, false]);
  });
});

test("disable-on-mobile and enabled=false keep every board native", async () => {
  await withEnv({ enhanced: ["boardAAA1"], settings: { enabled: false } }, async (t) => {
    const { native } = addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    assert.equal(t.views.length, 0);
    assert.ok(!native.classList.contains("pxd-native-hidden"));
  });
});

test("settings changes reach mounted views through setSettings, else remount", async () => {
  const { createSettingsPanel } = await import("../src/settings.js");
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    const { native } = addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    const rows = Object.fromEntries(createSettingsPanel().settings.map((row) => [row.id, row]));
    rows.wheel.action.onChange("zoom");
    assert.equal(t.views.length, 2, "no setSettings on the stub view: remount");
    assert.equal(t.views[1].args.settings.wheel, "zoom");
    assert.ok(native.classList.contains("pxd-native-hidden"));

    t.views[1].setSettings = (value) => { t.views[1].received = value; };
    rows["graph-links"].action.onChange("off");
    assert.equal(t.views.length, 2);
    assert.equal(t.views[1].received["graph-links"], "off");

    rows.enabled.action.onChange({ target: { checked: false } });
    assert.ok(!native.classList.contains("pxd-native-hidden"));
    assert.deepEqual(t.env.win.__plexusDiagram.mounts(), []);
  });
});

test("sessions read settings live: a change reaches an already-acquired session without a remount", async () => {
  const { createSettingsPanel } = await import("../src/settings.js");
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    const acquired = t.sessions.options[0].settings;
    assert.equal(typeof acquired.get, "function", "sessions get an accessor, not a snapshot");
    assert.notEqual(acquired.get("auto-fit-sections"), false);
    t.views[0].setSettings = () => {};
    const rows = Object.fromEntries(createSettingsPanel().settings.map((row) => [row.id, row]));
    rows["auto-fit-sections"].action.onChange({ target: { checked: false } });
    assert.equal(acquired.get("auto-fit-sections"), false, "the same accessor now answers with the new value");
    assert.equal(t.sessions.acquired, 1, "no second session was needed");
  });
});

test("onSetDefaults writes settings and reaches setSettings on every mount that has it", async () => {
  await withEnv({ enhanced: ["boardAAA1", "boardCCC1"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    addNative(t.doc, "boardCCC1");
    const saved = [];
    t.extensionAPI.settings.set = async (id, value) => { saved.push([id, value]); };
    await t.install();
    t.tick();
    assert.equal(t.views.length, 2);
    t.views[0].setSettings = (value) => { t.views[0].received = value; };
    await t.views[1].args.onSetDefaults({ grid: "grid", "board-tone": "teal" });
    assert.deepEqual(saved, [["grid", "grid"], ["board-tone", "teal"]]);
    assert.equal(t.views[0].received.grid, "grid");
    assert.equal(t.views[0].received["board-tone"], "teal");
    assert.equal(t.views.length, 2, "a view without setSettings is not remounted");
    assert.equal(t.views[1].received, undefined);
  });
});

test("onSetDefaults ignores a failing settings.set and still updates the mounts", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    t.extensionAPI.settings.set = async () => { throw new Error("nope"); };
    await t.install();
    t.tick();
    t.views[0].setSettings = (value) => { t.views[0].received = value; };
    const warn = console.warn;
    console.warn = () => {};
    try {
      await t.views[0].args.onSetDefaults({ "map-zoom": "0.6" });
    } finally {
      console.warn = warn;
    }
    assert.equal(t.views[0].received["map-zoom"], "0.6");
  });
});

test("Export as SVG and Copy as text commands call the current view and skip when disabled", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    const calls = [];
    t.views[0].exportSvg = (opts) => { calls.push(["svg", opts]); };
    t.views[0].copyOutline = () => { calls.push(["text"]); };
    t.strings.set("boardAAA1", "{{[[diagram]]}}");
    t.env.focused = { "block-uid": "boardAAA1" };
    for (const kind of ["palette", "slash"]) {
      await t.commands[kind].get("Plexus: Export board as SVG").callback({});
      await t.commands[kind].get("Plexus: Copy board as text").callback({});
    }
    assert.deepEqual(calls, [["svg", { download: true }], ["text"], ["svg", { download: true }], ["text"]]);
    const { createSettingsPanel } = await import("../src/settings.js");
    createSettingsPanel().settings.find((row) => row.id === "enabled").action.onChange(false);
    await t.commands.palette.get("Plexus: Export board as SVG").callback({});
    assert.equal(calls.length, 4);
  });
});

test("mounts() reports the live view state", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    assert.equal(t.env.win.__plexusDiagram.mounts()[0].state, null);
    t.views[0].state = () => ({ lod: "map", pattern: "grid", tone: "teal", focus: false });
    assert.deepEqual(t.env.win.__plexusDiagram.mounts()[0].state, { lod: "map", pattern: "grid", tone: "teal", focus: false });
  });
});

// ---- nested boards ----------------------------------------------------------------------------

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("F5 onOpenBoard swaps the view and session in place: same mount, old view disposed once, old session released once", async () => {
  await withEnv({ enhanced: ["boardAAA1", "childBBB1"] }, async (t) => {
    const { native } = addNative(t.doc, "boardAAA1");
    t.strings.set("boardAAA1", "{{[[diagram]]:Root}}");
    t.strings.set("childBBB1", "{{[[diagram]]:Child}}");
    await t.install();
    t.tick();
    const first = t.views[0];
    assert.deepEqual(first.args.crumbs, [{ uid: "boardAAA1", title: "Root" }]);
    assert.equal(first.args.routeUid, "boardAAA1");
    const mountEl = first.args.mountEl;
    first.args.onOpenBoard("childBBB1");
    assert.equal(t.views.length, 1, "navigation is deferred out of the caller's handler stack");
    await settle();
    assert.equal(t.views.length, 2);
    assert.equal(first.disposed, 1);
    assert.equal(t.sessions.acquired, 2);
    assert.equal(t.sessions.released, 1);
    assert.equal(t.sessions.live.get("boardAAA1"), 0);
    assert.equal(t.sessions.live.get("childBBB1"), 1);
    const second = t.views[1];
    assert.equal(second.args.mountEl, mountEl, "same mount element");
    assert.equal(second.args.nativeEl, native);
    assert.equal(second.args.session.uid, "childBBB1");
    assert.equal(second.args.routeUid, "boardAAA1", "the route board stays the zoomed block");
    assert.equal(second.args.autofocus, true);
    assert.deepEqual(second.args.crumbs, [{ uid: "boardAAA1", title: "Root" }, { uid: "childBBB1", title: "Child" }]);
    assert.ok(native.classList.contains("pxd-native-hidden"));
    assert.equal(t.doc.root.querySelectorAll(".pxd-mount").length, 1);
    assert.deepEqual(t.env.win.__plexusDiagram.mounts(), [{ uid: "boardAAA1", current: "childBBB1", crumbs: ["boardAAA1", "childBBB1"], fullscreen: false, connected: true, state: null }]);
    assert.equal(t.writes.createBlock.length + t.sessions.enhance, 0, "navigation writes nothing");
  });
});

test("F5 onCrumb goes back in place, and a click on the current crumb is a no-op", async () => {
  await withEnv({ enhanced: ["boardAAA1", "childBBB1"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    t.views[0].args.onOpenBoard("childBBB1");
    await settle();
    const nested = t.views[1];
    nested.args.onCrumb(1);
    await settle();
    assert.equal(t.views.length, 2, "the current board is not re-mounted");
    nested.args.onCrumb(0);
    await settle();
    assert.equal(t.views.length, 3);
    assert.equal(nested.disposed, 1);
    assert.equal(t.views[2].args.session.uid, "boardAAA1");
    assert.deepEqual(t.views[2].args.crumbs.map((c) => c.uid), ["boardAAA1"]);
    assert.equal(t.sessions.live.get("childBBB1"), 0);
    assert.equal(t.sessions.live.get("boardAAA1"), 1);
    assert.equal(t.env.win.__plexusDiagram.mounts()[0].current, "boardAAA1");
  });
});

test("F5 opening a child that is not enhanced hands it to Roam and never enhances it", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    t.views[0].args.onOpenBoard("nativeCCC1");
    await settle();
    assert.deepEqual(t.writes.openBlock, ["nativeCCC1"]);
    assert.equal(t.views.length, 1);
    assert.equal(t.views[0].disposed, 0);
    assert.equal(t.sessions.acquired, 1);
    assert.equal(t.sessions.enhance, 0);
    assert.equal(t.writes.createBlock.length, 0);
  });
});

test("F5 opening a child whose board cannot be loaded releases it and stays put", async () => {
  await withEnv({ enhanced: ["boardAAA1", "ghostDDD1"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    await t.install();
    t.env.ghost = new Set(["ghostDDD1"]);
    t.tick();
    t.views[0].args.onOpenBoard("ghostDDD1");
    await settle();
    assert.equal(t.views.length, 1);
    assert.equal(t.views[0].disposed, 0, "still showing the previous board");
    assert.equal(t.sessions.live.get("ghostDDD1"), 0, "the failed acquire was released");
    assert.equal(t.sessions.live.get("boardAAA1"), 1);
    assert.equal(t.env.win.__plexusDiagram.mounts()[0].current, "boardAAA1");
  });
});

test("F5 a zoomed nested board seeds its breadcrumbs root-first from the diagram ancestors", async () => {
  await withEnv({ enhanced: ["childBBB1"] }, async (t) => {
    t.env.ancestors = {
      childBBB1: {
        ":block/uid": "childBBB1",
        ":block/parents": [
          { ":block/uid": "pageBlk01", ":block/string": "just a bullet", ":block/parents": [{ ":db/id": 1 }] },
          { ":block/uid": "midMMM001", ":block/string": "{{[[diagram]]:Middle}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/parents": [{ ":db/id": 1 }, { ":db/id": 2 }] },
          { ":block/uid": "boardAAA1", ":block/string": "{{[[diagram]]:Root}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/parents": [{ ":db/id": 1 }] },
          { ":block/uid": "nativeNN01", ":block/string": "{{[[diagram]]:Native}}", ":block/props": {}, ":block/parents": [] },
        ],
      },
    };
    t.strings.set("childBBB1", "{{[[diagram]]}}");
    addNative(t.doc, "childBBB1");
    await t.install();
    t.tick();
    assert.deepEqual(t.views[0].args.crumbs, [
      { uid: "boardAAA1", title: "Root" },
      { uid: "midMMM001", title: "Middle" },
      { uid: "childBBB1", title: "Untitled board" },
    ]);
    assert.equal(t.views[0].args.routeUid, "childBBB1");
    assert.equal(t.views[0].args.session.uid, "childBBB1");
    // clicking the root crumb navigates in place; the route board stays the mount's uid
    t.props.set("boardAAA1", { ":plexus": { ":v": 2 } });
    t.views[0].args.onCrumb(0);
    await settle();
    assert.equal(t.views[1].args.session.uid, "boardAAA1");
    assert.equal(t.views[1].args.routeUid, "childBBB1");
    assert.deepEqual(t.views[1].args.crumbs.map((c) => c.uid), ["boardAAA1"]);
  });
});

test("F5 a native diagram nested inside a hidden native or our overlay is not mounted", async () => {
  await withEnv({ enhanced: ["boardAAA1", "innerNNN1"] }, async (t) => {
    const { native } = addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    const inner = addNative(t.doc, "innerNNN1", { parent: native });
    inner.native.parentElement.closestMap[".pxd-native-hidden, .pxd-root"] = native;
    t.tick();
    t.tick();
    assert.equal(t.views.length, 1);
    assert.equal(t.sessions.live.get("innerNNN1"), undefined);
  });
});

test("F5 unmount after navigation releases the current session exactly once", async () => {
  await withEnv({ enhanced: ["boardAAA1", "childBBB1"] }, async (t) => {
    const { native } = addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    t.views[0].args.onOpenBoard("childBBB1");
    await settle();
    native.remove();
    t.tick();
    assert.equal(t.views[1].disposed, 1);
    assert.equal(t.sessions.acquired, 2);
    assert.equal(t.sessions.released, 2);
    assert.equal(t.sessions.live.get("childBBB1"), 0);
    assert.deepEqual(t.env.win.__plexusDiagram.mounts(), []);
    t.views[1].args.onCrumb(0);
    await settle();
    assert.equal(t.views.length, 2, "a stale view cannot navigate a removed mount");
  });
});

test("F5 dispose while nested tears down the current view and session", async () => {
  const t = setup({ enhanced: ["boardAAA1", "childBBB1"] });
  try {
    addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    t.views[0].args.onOpenBoard("childBBB1");
    await settle();
    await t.lifecycle.dispose();
    assert.equal(t.views[1].disposed, 1);
    assert.equal(t.sessions.released, t.sessions.acquired);
    t.views[1].args.onCrumb(0);
    await settle();
    assert.equal(t.views.length, 2, "nothing mounts after teardown");
  } finally {
    t.restore();
  }
});

test("F5 a settings remount keeps the in-place navigation stack", async () => {
  const { createSettingsPanel } = await import("../src/settings.js");
  await withEnv({ enhanced: ["boardAAA1", "childBBB1"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    t.views[0].args.onOpenBoard("childBBB1");
    await settle();
    const rows = Object.fromEntries(createSettingsPanel().settings.map((row) => [row.id, row]));
    rows.wheel.action.onChange("zoom");
    const last = t.views.at(-1);
    assert.equal(last.args.session.uid, "childBBB1");
    assert.deepEqual(last.args.crumbs.map((c) => c.uid), ["boardAAA1", "childBBB1"]);
    assert.equal(last.args.routeUid, "boardAAA1");
    assert.equal(t.sessions.released, t.sessions.acquired - 1);
  });
});

test("F5 a nested board that loses its marker pops one level; the route board falls back to native", async () => {
  await withEnv({ enhanced: ["boardAAA1", "childBBB1"] }, async (t) => {
    const { native } = addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    t.views[0].args.onOpenBoard("childBBB1");
    await settle();
    const child = t.sessions.made.find((s) => s.uid === "childBBB1");
    const root = t.sessions.made.find((s) => s.uid === "boardAAA1");
    assert.equal(root.handlerCount(), 0, "the old session is no longer watched");
    assert.equal(child.handlerCount(), 1);
    child.board.enhanced = false;
    child.emitChange();
    await settle();
    assert.equal(t.env.win.__plexusDiagram.mounts()[0].current, "boardAAA1", "popped back to the parent board");
    assert.ok(native.classList.contains("pxd-native-hidden"), "still enhanced at the route board");
    const rootAgain = t.sessions.made.filter((s) => s.uid === "boardAAA1").at(-1);
    rootAgain.board.enhanced = false;
    rootAgain.emitChange();
    assert.ok(!native.classList.contains("pxd-native-hidden"), "the route board itself restores the native diagram");
    assert.deepEqual(t.env.win.__plexusDiagram.mounts(), []);
  });
});

test("F5 a 0.6 board mounted under an already migrated ancestor still imports", async () => {
  await withEnv({ enhanced: [], legacy: [{ uid: "legacyLL01", migrated: false }], hash: "#/app/Svy" }, async (t) => {
    t.env.ancestors = {
      legacyLL01: {
        ":block/uid": "legacyLL01",
        ":block/parents": [
          { ":block/uid": "boardAAA1", ":block/string": "{{[[diagram]]:Root}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/parents": [{ ":db/id": 1 }] },
        ],
      },
    };
    addNative(t.doc, "legacyLL01");
    await t.install();
    t.tick();
    await settle();
    assert.equal(t.views[0].args.crumbs.length, 2);
    assert.equal(t.sessions.enhance, 1);
  });
});

test("F5 a nested board whose block disappears pops to the parent; a vanished route board unmounts", async () => {
  await withEnv({ enhanced: ["boardAAA1", "childBBB1"] }, async (t) => {
    addNative(t.doc, "boardAAA1");
    await t.install();
    t.tick();
    t.views[0].args.onOpenBoard("childBBB1");
    await settle();
    const child = t.sessions.made.find((s) => s.uid === "childBBB1");
    child.emitGone();
    await settle();
    assert.equal(t.env.win.__plexusDiagram.mounts()[0].current, "boardAAA1");
    const root = t.sessions.made.filter((s) => s.uid === "boardAAA1").at(-1);
    root.emitGone();
    assert.deepEqual(t.env.win.__plexusDiagram.mounts(), []);
  });
});

// ---- 1.1: nested boards inside an enhanced board's rendered children ------------------------------------

test("1.1 a nested enhanced diagram inside the root's outline is not mounted", async () => {
  await withEnv({ enhanced: ["boardAAA1", "childBBB1"] }, async (t) => {
    t.strings.set("boardAAA1", "{{[[diagram]]}}");
    t.strings.set("childBBB1", "{{[[diagram]]:Untitled board}}");
    const root = addBoardBlock(t.doc, "boardAAA1");
    const nested = addOutlineBoard(t.doc, "childBBB1", root);
    await t.install();
    t.tick();
    t.tick();
    assert.equal(t.views.length, 1);
    assert.equal(t.views[0].args.session.uid, "boardAAA1");
    assert.equal(t.sessions.live.get("childBBB1"), undefined);
    assert.ok(!nested.native.classList.contains("pxd-native-hidden"));
    assert.ok(nested.native.classList.contains("pxd-outline-native"), "outline copy is exempted from the pre-paint guard");
    assert.ok(nested.panel.classList.contains("pxd-outline-native"));
    assert.deepEqual(t.env.win.__plexusDiagram.mounts().map((m) => m.uid), ["boardAAA1"]);
    assert.match(t.doc.getElementById(PREPAINT_STYLE_ID).textContent, /not\(\.pxd-outline-native\)/);
  });
});

test("1.1 a nested board that mounted before its parent is unmounted when the parent mounts", async () => {
  await withEnv({ enhanced: ["boardAAA1", "childBBB1"] }, async (t) => {
    t.strings.set("boardAAA1", "{{[[diagram]]}}");
    t.strings.set("childBBB1", "{{[[diagram]]:Untitled board}}");
    // The parent's block input has not rendered yet, so the child looks like a root.
    const root = addBlock(t.doc, "boardAAA1", { input: false });
    const nested = addOutlineBoard(t.doc, "childBBB1", root);
    await t.install();
    t.tick();
    assert.deepEqual(t.env.win.__plexusDiagram.mounts().map((m) => m.uid), ["childBBB1"]);
    const inputEl = t.doc.createElement("div");
    inputEl.id = "block-input-w-body-outline-boardAAA1";
    root.main.append(inputEl);
    const { native } = addNative(t.doc, "boardAAA1", { parent: root.main });
    native.closestMap[".roam-block-container"] = root.container;
    t.tick();
    assert.deepEqual(t.env.win.__plexusDiagram.mounts().map((m) => m.uid), ["boardAAA1"]);
    assert.equal(t.sessions.live.get("childBBB1"), 0, "the nested session was released");
    assert.equal(t.views[0].disposed, 1);
    assert.ok(!nested.native.classList.contains("pxd-native-hidden"));
    t.tick();
    assert.equal(t.views.length, 2, "and it does not mount again");
  });
});

test("1.1 a nested board with no enhanced ancestor container (zoomed or sidebar root) still mounts", async () => {
  await withEnv({ enhanced: ["childBBB1"] }, async (t) => {
    t.strings.set("childBBB1", "{{[[diagram]]:Untitled board}}");
    t.strings.set("boardAAA1", "{{[[diagram]]}}");
    // Roots render the block on its own, and a non-enhanced diagram ancestor never blocks a mount.
    const zoomed = addBoardBlock(t.doc, "childBBB1");
    const plainAncestor = addBlock(t.doc, "plainPP01");
    const inSidebar = addOutlineBoard(t.doc, "childBBB1", plainAncestor);
    await t.install();
    t.tick();
    assert.equal(t.views.length, 2);
    assert.ok(zoomed.native.classList.contains("pxd-native-hidden"));
    assert.ok(inSidebar.native.classList.contains("pxd-native-hidden"));
  });
});

// ---- 1.1: collapse the board block instead of hiding its outline -------------------------------------

const collapseKeys = (t) => [...t.storageMap.keys()].filter((k) => k.startsWith("plexus-diagram:collapsed:"));
const openBoard = (t, uid = "boardAAA1", state = { ":block/open": true, ":block/children": [{ ":block/uid": "cardCCC01" }] }) => {
  t.strings.set(uid, "{{[[diagram]]}}");
  t.env.openState = { ...(t.env.openState || {}), [uid]: state };
  return addBoardBlock(t.doc, uid);
};

test("1.1 the first mount of an open enhanced board with children collapses it once and sets the key first", async () => {
  await withEnv({ enhanced: ["boardAAA1"], hash: "#/app/Svy" }, async (t) => {
    const block = openBoard(t);
    const order = [];
    const setItem = t.storage.setItem;
    t.storage.setItem = (k, v) => { if (k.startsWith("plexus-diagram:collapsed:")) order.push("key"); setItem(k, v); };
    const setOpen = t.host.setOpen;
    t.host.setOpen = async (uid, open) => { order.push("open"); return setOpen(uid, open); };
    await t.install();
    t.tick();
    await settle();
    assert.deepEqual(t.writes.setOpen, [["boardAAA1", false]]);
    assert.deepEqual(order, ["key", "open"]);
    assert.deepEqual(collapseKeys(t), ["plexus-diagram:collapsed:Svy:boardAAA1"]);
    // Remount: the user may have expanded it on purpose, so nothing is written again.
    block.native.remove();
    t.tick();
    assert.deepEqual(t.env.win.__plexusDiagram.mounts(), []);
    addNative(t.doc, "boardAAA1", { parent: block.main });
    t.tick();
    await settle();
    assert.equal(t.views.length, 2);
    assert.equal(t.writes.setOpen.length, 1);
  });
});

test("1.1 an empty open board is collapsed too; an already-collapsed one is never written but records the key", async () => {
  await withEnv({ enhanced: ["boardAAA1", "boardBBB1"], hash: "#/app/Svy" }, async (t) => {
    openBoard(t, "boardAAA1", { ":block/open": true, ":block/children": [] });
    openBoard(t, "boardBBB1", { ":block/open": false, ":block/children": [{ ":block/uid": "x" }] });
    await t.install();
    t.tick();
    await settle();
    assert.equal(t.views.length, 2);
    assert.deepEqual(t.writes.setOpen, [["boardAAA1", false]]);
    assert.deepEqual(collapseKeys(t).sort(), ["plexus-diagram:collapsed:Svy:boardAAA1", "plexus-diagram:collapsed:Svy:boardBBB1"]);
  });
});

test("1.1 a passive mount inside a portal (hover preview) never collapses", async () => {
  await withEnv({ enhanced: ["boardAAA1"], hash: "#/app/Svy" }, async (t) => {
    const block = openBoard(t);
    block.native.closestMap[".bp3-portal"] = t.doc.createElement("div");
    await t.install();
    t.tick();
    await settle();
    assert.equal(t.views.length, 1);
    assert.equal(t.writes.setOpen.length, 0);
    assert.deepEqual(collapseKeys(t), []);
  });
});

test("1.1 collapse-outline false never collapses", async () => {
  await withEnv({ enhanced: ["boardAAA1"], settings: { "collapse-outline": false } }, async (t) => {
    openBoard(t);
    await t.install();
    t.tick();
    await settle();
    assert.equal(t.views.length, 1);
    assert.equal(t.writes.setOpen.length, 0);
    assert.deepEqual(collapseKeys(t), []);
  });
});

test("1.1 a native diagram that is not enhanced never gets setOpen", async () => {
  await withEnv({ enhanced: [] }, async (t) => {
    openBoard(t);
    await t.install();
    t.tick();
    t.tick();
    await settle();
    assert.equal(t.views.length, 0);
    assert.equal(t.writes.setOpen.length, 0);
    assert.deepEqual(collapseKeys(t), []);
  });
});

test("1.1 a failing setOpen is logged and does not unmount or retry", async () => {
  await withEnv({ enhanced: ["boardAAA1"] }, async (t) => {
    openBoard(t);
    t.host.setOpen = async () => { throw new Error("nope"); };
    const warn = console.warn;
    const seen = [];
    console.warn = (...args) => seen.push(args);
    try {
      await t.install();
      t.tick();
      await settle();
      t.tick();
      await settle();
    } finally {
      console.warn = warn;
    }
    assert.equal(seen.length, 1);
    assert.equal(t.views.length, 1);
  });
});

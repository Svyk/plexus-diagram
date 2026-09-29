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
    const cls = this.cls;
    this.classList = {
      add: (...names) => names.forEach((n) => cls.add(n)),
      remove: (...names) => names.forEach((n) => cls.delete(n)),
      contains: (n) => cls.has(n),
    };
  }
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
  matches(selector) { return selector.startsWith(".") && this.cls.has(selector.slice(1)); }
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
    observe() { env.observers.add(this); }
    disconnect() { env.observers.delete(this); }
  });
  define("setInterval", (callback) => { const id = env.nextInterval++; env.intervals.set(id, callback); return id; });
  define("clearInterval", (id) => env.intervals.delete(id));

  const props = new Map(enhanced.map((uid) => [uid, { ":plexus": { ":v": 2 }, ":rf-diagram": { ":x": 1 } }]));
  const strings = new Map();
  const writes = { createBlock: [], openBlock: [], other: 0 };
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
          if (pattern === "[:block/props]") return { ":block/props": props.get(ref[1]) ?? null };
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
  };

  const sessions = { acquired: 0, released: 0, enhance: 0, restore: 0, live: new Map() };
  const acquireSession = (uid) => {
    sessions.acquired += 1;
    sessions.live.set(uid, (sessions.live.get(uid) || 0) + 1);
    return {
      uid,
      board: { enhanced: props.has(uid) },
      on: () => () => {},
      enhance: async () => { sessions.enhance += 1; props.set(uid, { ":plexus": { ":v": 2 } }); },
      restoreNative: async () => {
        sessions.restore += 1;
        const next = mergePropsForWrite(props.get(uid), null);
        if (Object.keys(next).length) props.set(uid, Object.fromEntries(Object.entries(next).map(([k, v]) => [k.startsWith(":") ? k : `:${k}`, v])));
        else props.delete(uid);
      },
      release: () => { sessions.released += 1; sessions.live.set(uid, sessions.live.get(uid) - 1); },
    };
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
    env, doc, host, props, strings, writes, sessions, views, commands, storage, storageMap, lifecycle, tick, restore,
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
    assert.deepEqual(t.env.win.__plexusDiagram.mounts(), [{ uid: "boardAAA1", fullscreen: false, connected: true }]);
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
    const labels = ["Plexus: Enhance this diagram", "Plexus: New whiteboard here", "Plexus: Restore native diagram", "Plexus: Fullscreen this diagram"];
    assert.deepEqual([...t.commands.palette.keys()], labels);
    assert.deepEqual([...t.commands.slash.keys()], labels);
    assert.deepEqual([...t.commands.context.keys()], ["Plexus: Enhance"]);
    const context = t.commands.context.get("Plexus: Enhance");
    assert.equal(context["display-conditional"]({ "block-string": "{{[[diagram]]}}" }), true);
    assert.equal(context["display-conditional"]({ "block-string": "plain" }), false);
    await t.lifecycle.dispose();
    assert.equal(t.commands.palette.size + t.commands.slash.size + t.commands.context.size, 0);
    assert.equal(t.commands.removed.length, 9);
  } finally {
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
    });
    assert.deepEqual(t.writes.openBlock, ["newBoard01"]);
    assert.equal(t.sessions.enhance, 0);
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

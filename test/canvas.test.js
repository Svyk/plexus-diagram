import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasRoot, shouldCommitPulledString, topbarOffset, sidebarOffset, applyFullscreenChrome } from "../src/canvas.js";
import { settingsDefaults } from "../src/settings.js";
import { releaseScratch } from "../src/metadata.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

function createDomStub() {
  const elements = new Map();
  let id = 0;
  const makeEl = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      className: "",
      classList: {
        add(...names) { names.forEach((n) => { if (!el.className.includes(n)) el.className += ` ${n}`; }); },
        remove(...names) { names.forEach((n) => { el.className = el.className.replace(n, "").trim(); }); },
        contains(name) { return el.className.split(/\s+/).includes(name); },
        toggle(name, force) {
          const has = el.className.includes(name);
          const next = force ?? !has;
          if (next && !has) el.classList.add(name);
          if (!next && has) el.classList.remove(name);
        },
      },
      style: {
        setProperty() {},
      },
      dataset: {},
      children: [],
      append(...nodes) { el.children.push(...nodes); nodes.forEach((n) => { n.parentElement = el; }); },
      appendChild(node) { el.append(node); },
      prepend(node) { el.children.unshift(node); node.parentElement = el; },
      addEventListener() {},
      removeEventListener() {},
      remove() { el.isConnected = false; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      closest() { return null; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      setAttribute() {},
      getAttribute() { return null; },
      textContent: "",
      innerHTML: "",
      isConnected: true,
      parentElement: null,
      id: `el-${id += 1}`,
    };
    if (tag === "button") el.type = "button";
    return el;
  };

  const document = {
    createElement(tag) {
      const el = makeEl(tag);
      elements.set(el.id, el);
      return el;
    },
    createElementNS(_ns, tag) {
      return makeEl(tag);
    },
    querySelector() { return null; },
  };

  const window = {
    addEventListener() {},
    removeEventListener() {},
  };

  return { document, window, elements };
}

test("shouldCommitPulledString refuses empty pulls over known card text", () => {
  assert.equal(shouldCommitPulledString("Test of this", ""), false);
  assert.equal(shouldCommitPulledString("Test of this", "   "), false);
  assert.equal(shouldCommitPulledString("Test of this", "Test of this"), false);
  assert.equal(shouldCommitPulledString("Test of this", "Edited"), true);
  assert.equal(shouldCommitPulledString("", "hello"), true);
  assert.equal(shouldCommitPulledString("x", null), false);
});

test("fullscreen CSS hides breadcrumbs only under body.pxd-has-fullscreen", async () => {
  const css = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../src/extension.css"), "utf8");
  assert.match(css, /body\.pxd-has-fullscreen #roam-breadcrumbs-panel/);
  assert.match(css, /body\.pxd-has-fullscreen \.breadcrumbs-content/);
  assert.match(css, /display:\s*none\s*!important/);
  assert.match(css, /\.pxd-toolbar\s*\{[^}]*flex-wrap:\s*nowrap/s);
});

test("topbarOffset uses the bottom of .rm-topbar; breadcrumbs are hidden in fullscreen, not kept clickable", () => {
  const root = {
    querySelector(sel) {
      if (sel === ".rm-topbar") return { getBoundingClientRect: () => ({ bottom: 48 }) };
      return null;
    },
  };
  assert.equal(topbarOffset(root), 48);
  assert.equal(topbarOffset({ querySelector: () => null }), 0);
});

test("sidebarOffset uses the sidebar rect and is 0 when width is 0", () => {
  const root = {
    querySelector(sel) {
      if (sel === ".roam-sidebar-container") {
        return { getBoundingClientRect: () => ({ right: 232, width: 232 }) };
      }
      return null;
    },
  };
  assert.equal(sidebarOffset(root), 232);
  assert.equal(sidebarOffset({
    querySelector(sel) {
      if (sel === ".rm-left-sidebar") return { getBoundingClientRect: () => ({ right: 180, width: 180 }) };
      return null;
    },
  }), 180);
  assert.equal(sidebarOffset({
    querySelector() {
      return { getBoundingClientRect: () => ({ right: 232, width: 0 }) };
    },
  }), 0);
  assert.equal(sidebarOffset({ querySelector: () => null }), 0);
});

test("applyFullscreenChrome sets left to the sidebar right, not 0, when a sidebar mock exists", () => {
  const classSet = new Set();
  const mount = {
    classList: {
      toggle(name, force) {
        if (force) classSet.add(name);
        else classSet.delete(name);
      },
    },
    style: {},
  };
  const bodyClass = new Set();
  const root = {
    body: {
      classList: {
        toggle(name, force) {
          if (force) bodyClass.add(name);
          else bodyClass.delete(name);
        },
      },
    },
    querySelector(sel) {
      if (sel === ".rm-topbar") return { getBoundingClientRect: () => ({ bottom: 45 }) };
      if (sel === ".roam-sidebar-container") return { getBoundingClientRect: () => ({ right: 232, width: 232 }) };
      return null;
    },
  };
  applyFullscreenChrome(mount, true, root);
  assert.equal(mount.style.left, "232px");
  assert.notEqual(mount.style.left, "0px");
  assert.equal(mount.style.top, "45px");
  assert.equal(mount.style.right, "0px");
  assert.equal(mount.style.bottom, "0px");
  assert.ok(classSet.has("pxd-mount--fullscreen"));
  assert.ok(bodyClass.has("pxd-has-fullscreen"));
});

test("settings defaults use 560px height and hide card titles", () => {
  const defaults = settingsDefaults();
  assert.equal(defaults["default-height"], "560");
  assert.equal(defaults["show-card-title"], false);
});

test("toolbar buttons use full labels including Select", () => {
  const { document, window } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;

  try {
    const session = {
      model: {
        activeTool: "select",
        viewport: { x: 0, y: 0, zoom: 1 },
        children: [],
        nodes: new Map(),
        edges: [],
        sections: new Map(),
        selected: new Set(),
        ensureNode(uid, defaults) {
          const node = { pos: { x: 0, y: 0 }, size: { width: defaults.width, height: defaults.height } };
          this.nodes.set(uid, node);
          return node;
        },
        isNestedDiagram: () => false,
      },
    };
    const settings = {
      get(key) {
        const defaults = settingsDefaults();
        return defaults[key];
      },
    };
    const canvas = createCanvasRoot({ session, settings, version: "0.3.0" });
    try {
    const toolbar = canvas.root.children.find((child) => child.className === "pxd-toolbar");
    const buttons = toolbar.children.flatMap((child) => (
      child.className?.includes("pxd-toolbar__group") ? child.children : [child]
    ));
    const labels = buttons
      .filter((child) => child.className?.includes("pxd-toolbar__btn"))
      .map((child) => child.textContent);
    assert.ok(labels.includes("Select"));
    assert.ok(!labels.includes("S"));
    assert.ok(labels.includes("Zoom+"));
    assert.ok(labels.includes("Fit"));
    assert.ok(labels.includes("Fullscreen"));
    const hintEl = canvas.root.children.find((child) => child.className?.includes("pxd-hint"));
    assert.ok(hintEl, "hint overlay is mounted");
    assert.ok(hintEl.className.includes("pxd-hint--visible"), "hint shows on an empty select-tool board");
    assert.equal(typeof canvas.editCard, "function");
    assert.equal(typeof canvas.fitToView, "function");
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

function findByClass(el, name) {
  if (String(el?.className || "").split(/\s+/).includes(name)) return el;
  for (const child of el?.children || []) {
    const found = findByClass(child, name);
    if (found) return found;
  }
  return null;
}

function cardSession(edges = []) {
  const children = [
    { uid: "card-a", string: "Hello card" },
    { uid: "card-b", string: "Other" },
  ];
  const nodes = new Map([
    ["card-a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 } }],
    ["card-b", { pos: { x: 400, y: 0 }, size: { width: 280, height: 160 } }],
  ]);
  return {
    model: {
      activeTool: "select",
      viewport: { x: 0, y: 0, zoom: 1 },
      children,
      nodes,
      edges,
      sections: new Map(),
      selected: new Set(),
      getCard(uid) { return children.find((child) => child.uid === uid) || null; },
      ensureNode(uid, defaults) {
        if (nodes.has(uid)) return nodes.get(uid);
        const node = { pos: { x: 0, y: 0 }, size: { width: defaults.width, height: defaults.height } };
        nodes.set(uid, node);
        return node;
      },
      isNestedDiagram: () => false,
    },
  };
}

test("show-edge-labels defaults true", () => {
  assert.equal(settingsDefaults()["show-edge-labels"], true);
});

test("renderEdges creates a pill when the edge label is non-empty", () => {
  const { document, window } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    const session = cardSession([{ source: "card-a", target: "card-b", kind: "bezier", label: "because" }]);
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({ session, settings, version: "0.4.0" });
    try {
      const pill = findByClass(canvas.root, "pxd-edge-label");
      assert.ok(pill, "labeled edge should render a midpoint pill");
      assert.equal(pill.textContent, "because");
      const unlabeled = createCanvasRoot({
        session: cardSession([{ source: "card-a", target: "card-b", kind: "bezier", label: "" }]),
        settings,
        version: "0.4.0",
      });
      try {
        assert.equal(findByClass(unlabeled.root, "pxd-edge-label"), null);
      } finally {
        unlabeled.dispose();
      }
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("enterEdit calls renderBlock with the scratch uid, not the card uid", async () => {
  const { document, window } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousRoam = globalThis.roamAlphaAPI;
  const renderUids = [];
  globalThis.document = document;
  globalThis.window = window;
  globalThis.roamAlphaAPI = {
    util: { generateUID: () => "generated" },
    data: {
      q: () => [["meta-page"]],
      pull: (_pattern, ref) => {
        const uid = Array.isArray(ref) ? ref[1] : ref;
        if (uid === "meta-page") {
          return {
            ":block/uid": "meta-page",
            ":block/string": "",
            ":block/children": [{
              ":block/uid": "scratch-marker",
              ":block/string": "pxd:scratch",
              ":block/order": 0,
              ":block/children": [{
                ":block/uid": "scratch-host",
                ":block/string": " ",
                ":block/order": 0,
              }],
            }],
          };
        }
        if (uid === "scratch-marker") {
          return {
            ":block/uid": "scratch-marker",
            ":block/string": "pxd:scratch",
            ":block/children": [{
              ":block/uid": "scratch-host",
              ":block/string": " ",
              ":block/order": 0,
            }],
          };
        }
        return { ":block/uid": uid, ":block/string": "Hello card" };
      },
      page: { create: async () => {} },
      block: {
        create: async () => {},
        update: async () => {},
        delete: async () => {},
      },
    },
    ui: {
      components: {
        renderBlock: ({ uid }) => { renderUids.push(uid); },
        unmountNode: () => {},
      },
    },
  };
  try {
    const session = cardSession();
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({ session, settings, version: "0.4.0" });
    try {
      await canvas.editCard("card-a");
      assert.ok(renderUids.includes("scratch-host"), "renderBlock should mount the scratch uid");
      assert.ok(!renderUids.includes("card-a"), "renderBlock must not mount the card uid");
      const fallback = findByClass(canvas.root, "pxd-card__edit-fallback");
      assert.ok(fallback, "fallback class still exists until hydrate is quiet");
      assert.equal(fallback.textContent, "Hello card");
    } finally {
      canvas.dispose();
    }
  } finally {
    await releaseScratch();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.roamAlphaAPI = previousRoam;
  }
});

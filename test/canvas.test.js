import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasRoot, shouldCommitPulledString, topbarOffset, sidebarOffset, applyFullscreenChrome, fullscreenInsets, cardUidFromHitStack, parseDropPayload, parseDiagramTitle, focusRoamInput } from "../src/canvas.js";
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
      querySelector(sel) {
        const match = (node) => {
          const s = String(sel || "");
          if (s.startsWith(".")) return node.classList?.contains?.(s.slice(1).split(/[\s.#[]/)[0]);
          if (s.startsWith("#")) return node.id === s.slice(1);
          return String(node.tagName || "").toLowerCase() === s.toLowerCase();
        };
        for (const child of el.children || []) {
          if (match(child)) return child;
          const found = child.querySelector?.(sel);
          if (found) return found;
        }
        return null;
      },
      querySelectorAll() { return []; },
      closest(sel) {
        const name = String(sel || "").startsWith(".") ? String(sel).slice(1).split(/[\s.#[]/)[0] : "";
        let node = el;
        while (node) {
          if (name && node.classList?.contains?.(name)) return node;
          node = node.parentElement;
        }
        return null;
      },
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
    addEventListener() {},
    removeEventListener() {},
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

test("applyFullscreenChrome uses article-wrapper left when the article is inset 232px", () => {
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
      if (sel === ".rm-article-wrapper") {
        return { getBoundingClientRect: () => ({ top: 45, left: 232, right: 1400, bottom: 900, width: 1168 }) };
      }
      if (sel === ".roam-sidebar-container") return { getBoundingClientRect: () => ({ right: 232, width: 232 }) };
      return null;
    },
  };
  applyFullscreenChrome(mount, true, root);
  assert.equal(mount.style.left, "232px");
  assert.notEqual(mount.style.left, "0px");
  assert.equal(mount.style.top, "45px");
  assert.ok(classSet.has("pxd-mount--fullscreen"));
  assert.ok(bodyClass.has("pxd-has-fullscreen"));
});

test("applyFullscreenChrome left is 0px when the article is full-width even if the sidebar still reports width 232", () => {
  const mount = {
    classList: { toggle() {} },
    style: {},
  };
  const root = {
    body: { classList: { toggle() {} } },
    querySelector(sel) {
      if (sel === ".rm-topbar") return { getBoundingClientRect: () => ({ bottom: 45 }) };
      if (sel === ".rm-article-wrapper") {
        return { getBoundingClientRect: () => ({ top: 45, left: 0, right: 1400, bottom: 900, width: 1400 }) };
      }
      if (sel === ".roam-sidebar-container") {
        return { getBoundingClientRect: () => ({ left: -232, right: 0, width: 232 }) };
      }
      return null;
    },
  };
  applyFullscreenChrome(mount, true, root);
  assert.equal(mount.style.left, "0px");
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

function cardSession(edges = [], extras = {}) {
  const children = extras.children || [
    { uid: "card-a", string: "Hello card" },
    { uid: "card-b", string: "Other" },
  ];
  const nodes = extras.nodes || new Map([
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
      sections: extras.sections || new Map(),
      selected: new Set(),
      tree: extras.tree || { string: "{{[[diagram]]}}", children },
      getCard(uid) { return children.find((child) => child.uid === uid) || null; },
      ensureNode(uid, defaults) {
        if (nodes.has(uid)) return nodes.get(uid);
        const node = { pos: { x: 0, y: 0 }, size: { width: defaults.width, height: defaults.height } };
        nodes.set(uid, node);
        return node;
      },
      addEdge(source, target, kind = "bezier") {
        if (this.edges.some((edge) => edge.source === source && edge.target === target)) return null;
        const edge = { source, target, kind, label: "" };
        this.edges.push(edge);
        return edge;
      },
      removeEdge(source, target) {
        this.edges = this.edges.filter((edge) => !(edge.source === source && edge.target === target));
      },
      isNestedDiagram(uid) {
        const card = children.find((child) => child.uid === uid);
        return /\{\{\s*(\[\[)?diagram/i.test(card?.string || "");
      },
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

test("default section CSS is pointer-events auto, not none", async () => {
  const css = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../src/extension.css"), "utf8");
  const block = css.match(/\.pxd-section\s*\{[^}]+\}/);
  assert.ok(block, ".pxd-section rule exists");
  assert.match(block[0], /pointer-events:\s*auto/);
  assert.doesNotMatch(block[0], /pointer-events:\s*none/);
  assert.match(css, /\.pxd-library-drawer\s*\{[^}]*#ffffff/s);
  assert.match(css, /\.pxd-root\[data-tool="connect"\]\s+\.pxd-handle/);
  assert.match(css, /\.pxd-edge--temp\s*\{[^}]*pointer-events:\s*none/s);
});

test("renderSections emits a Section label even when title is empty", () => {
  const { document, window } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    const session = cardSession([], {
      sections: new Map([["s1", { pos: { x: 10, y: 10 }, size: { width: 320, height: 240 }, title: "" }]]),
    });
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({ session, settings, version: "0.4.1" });
    try {
      const label = findByClass(canvas.root, "pxd-section__label");
      assert.ok(label, "section should render a label");
      assert.equal(label.textContent, "Section");
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("nested card with only the macro shows a name field, not Nested diagram", () => {
  const { document, window } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    const session = cardSession([], {
      children: [{ uid: "nested-1", string: "{{[[diagram]]}}" }],
      nodes: new Map([["nested-1", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 } }]]),
    });
    assert.equal(session.model.isNestedDiagram("nested-1"), true);
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({ session, settings, version: "0.4.1" });
    try {
      const name = findByClass(canvas.root, "pxd-card__nested-name");
      assert.ok(name, "unnamed nested card should paint an inline name field");
      assert.equal(name.placeholder, "Name this board…");
      assert.equal(findByClass(canvas.root, "pxd-card__nested-label"), null);
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("cardUidFromHitStack skips edge-hit nodes and returns the card uid", () => {
  const { document } = createDomStub();
  const cardsLayer = document.createElement("div");
  cardsLayer.className = "pxd-cards";
  const card = document.createElement("div");
  card.className = "pxd-card";
  card.dataset.uid = "card-a";
  cardsLayer.append(card);
  const hit = document.createElement("path");
  hit.classList.add("pxd-edge-hit");
  assert.equal(cardUidFromHitStack([hit, card], cardsLayer), "card-a");
  assert.equal(cardUidFromHitStack([hit], cardsLayer), null);
});

test("adding an edge increases model.edges and render creates a .pxd-edge", () => {
  const { document, window } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    const session = cardSession();
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({ session, settings, version: "0.4.1" });
    try {
      assert.equal(findByClass(canvas.root, "pxd-edge"), null);
      const added = session.model.addEdge("card-a", "card-b", "bezier");
      assert.ok(added);
      assert.equal(session.model.edges.length, 1);
      canvas.render();
      assert.ok(findByClass(canvas.root, "pxd-edge"), "render should create a .pxd-edge path");
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("parseDropPayload reads [[page]] and block uids", () => {
  assert.deepEqual(parseDropPayload({ getData: (type) => (type === "text/plain" ? "See [[Page Title]]" : ""), types: ["text/plain"] }).string, "[[Page Title]]");
  assert.deepEqual(parseDropPayload({ getData: (type) => (type === "text/html" ? "((abcdefgh))" : ""), types: ["text/html"] }).string, "((abcdefgh))");
  assert.equal(parseDropPayload({ getData: () => "", types: [] }), null);
});

test("parseDropPayload ignores incidental 9-char tokens but accepts bare uids", () => {
  assert.equal(
    parseDropPayload({
      getData: (type) => (type === "text/plain" ? "hello ABCDEFGHI world" : ""),
      types: ["text/plain"],
    }),
    null,
  );
  assert.deepEqual(
    parseDropPayload({
      getData: (type) => (type === "text/html" ? "((ABCDEFGHI))" : ""),
      types: ["text/html"],
    }).string,
    "((ABCDEFGHI))",
  );
  assert.deepEqual(
    parseDropPayload({
      getData: (type) => (type === "text/plain" ? "ABCDEFGHI" : ""),
      types: ["text/plain"],
    }).string,
    "((ABCDEFGHI))",
  );
});

test("parseDiagramTitle reads named macros and strips unnamed ones", () => {
  assert.equal(parseDiagramTitle("{{[[diagram]]:Foo}}"), "Foo");
  assert.equal(parseDiagramTitle("{{[[diagram]]: Board name }}"), "Board name");
  assert.equal(parseDiagramTitle("{{[[diagram]]}}"), "");
  assert.equal(parseDiagramTitle("  Hello cards  "), "Hello cards");
  assert.equal(parseDiagramTitle("{{[[diagram]]}} leftover"), "leftover");
});

test("focusRoamInput uses preventScroll so the outline copy does not jump", () => {
  const calls = [];
  const el = {
    focus(opts) { calls.push(opts); },
    dispatchEvent() { return true; },
    getBoundingClientRect: () => ({ left: 0, top: 0, height: 20 }),
  };
  assert.equal(focusRoamInput(el), true);
  assert.deepEqual(calls[0], { preventScroll: true });
});

test("overlay CSS leaves Beam the caret and uses 12px connect handles", async () => {
  const css = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../src/extension.css"), "utf8");
  assert.doesNotMatch(css, /caret-color:\s*#1c2127/);
  assert.doesNotMatch(css, /:root:not\(\.svy-off-beam\) \.pxd-root textarea/);
  assert.match(css, /\.pxd-handle\s*\{[^}]*width:\s*12px/s);
  assert.match(css, /\.pxd-edges-temp\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.pxd-handle::before\s*\{/);
});

test("fullscreenInsets right is the sidebar gap, or 0 when the article is flush", () => {
  const open = {
    defaultView: { innerWidth: 1382, innerHeight: 900 },
    querySelector(sel) {
      if (sel === ".rm-topbar") return { getBoundingClientRect: () => ({ bottom: 45 }) };
      if (sel === ".rm-article-wrapper") {
        return { getBoundingClientRect: () => ({ top: 45, left: 0, right: 1100, bottom: 900 }) };
      }
      return null;
    },
  };
  assert.equal(fullscreenInsets(open).right, 282);
  const collapsed = {
    defaultView: { innerWidth: 1382, innerHeight: 900 },
    querySelector(sel) {
      if (sel === ".rm-topbar") return { getBoundingClientRect: () => ({ bottom: 45 }) };
      if (sel === ".rm-article-wrapper") {
        return { getBoundingClientRect: () => ({ top: 45, left: 0, right: 1382, bottom: 900 }) };
      }
      return null;
    },
  };
  assert.equal(fullscreenInsets(collapsed).right, 0);
  const mount = { classList: { toggle() {} }, style: {} };
  applyFullscreenChrome(mount, true, open);
  assert.equal(mount.style.right, "282px");
  applyFullscreenChrome(mount, true, collapsed);
  assert.equal(mount.style.right, "0px");
});

test("crumb row appears when nest stack has a parent", () => {
  const { document, window } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    const session = cardSession([], { tree: { string: "{{[[diagram]]:Child}}" } });
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({
      session,
      settings,
      version: "0.4.2",
      nestStack: [{ uid: "parent-uid", title: "Parent board" }],
    });
    try {
      const crumb = findByClass(canvas.root, "pxd-crumb");
      assert.ok(crumb, "crumb row should render when the nest stack is non-empty");
      assert.ok(!String(crumb.className).includes("pxd-crumb--empty"));
      const texts = [];
      const walk = (el) => {
        if (el?.textContent) texts.push(el.textContent);
        for (const child of el?.children || []) walk(child);
      };
      walk(crumb);
      assert.ok(texts.some((text) => String(text).includes("Parent board")));
      assert.ok(texts.some((text) => String(text).includes("Child")));
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("connect-to-empty invokes onPersist addCard and addEdge", async () => {
  const { document, window } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    const session = cardSession([], {
      children: [{ uid: "card-a", string: "Hello card" }],
      nodes: new Map([["card-a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 } }]]),
    });
    const settings = { get: (key) => settingsDefaults()[key] };
    const actions = [];
    const canvas = createCanvasRoot({
      session,
      settings,
      version: "0.4.2",
      nestStack: [],
      onPersist: async (action) => { actions.push(action); },
    });
    try {
      await canvas.completeConnect({
        moved: true,
        sourceUid: "card-a",
        targetUid: null,
        clientX: 500,
        clientY: 300,
      });
      assert.equal(actions.length, 1);
      assert.ok(actions[0].addCard, "connect-to-empty should add a card at the drop point");
      assert.equal(actions[0].addEdge?.source, "card-a");
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("crumb row exists in the toolbar even when nest stack is empty", () => {
  const { document, window } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    const session = cardSession([], { tree: { string: "{{[[diagram]]:Child}}" } });
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({
      session,
      settings,
      version: "0.5.0",
      nestStack: [],
    });
    try {
      const crumb = findByClass(canvas.root, "pxd-crumb");
      assert.ok(crumb, "crumb row should exist even when the nest stack is empty");
      assert.ok(String(crumb.className).includes("pxd-crumb--empty"));
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("completeConnect card to card adds an edge and a .pxd-edge", async () => {
  const { document, window } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    const session = cardSession([]);
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({ session, settings, version: "0.5.0", nestStack: [] });
    try {
      await canvas.completeConnect({
        moved: true,
        sourceUid: "card-a",
        targetUid: "card-b",
        clientX: 400,
        clientY: 80,
      });
      assert.equal(session.model.edges.length, 1);
      assert.equal(session.model.edges[0].source, "card-a");
      assert.equal(session.model.edges[0].target, "card-b");
      assert.ok(findByClass(canvas.root, "pxd-edge"), "connected pair should paint a .pxd-edge");
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("armConnect then completeConnect to another card creates an edge", async () => {
  const { document, window } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    const session = cardSession([]);
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({ session, settings, version: "0.5.0", nestStack: [] });
    try {
      canvas.armConnect("card-a");
      assert.equal(canvas.getConnectArm()?.uid, "card-a");
      await canvas.completeConnect({
        moved: false,
        sourceUid: "card-a",
        targetUid: "card-b",
        clientX: 400,
        clientY: 80,
      });
      assert.equal(session.model.edges.length, 1);
      assert.equal(session.model.edges[0].target, "card-b");
      assert.equal(canvas.getConnectArm(), null);
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("attachSession swaps cards from session A to session B", () => {
  const { document, window } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    const sessionA = cardSession([], {
      children: [{ uid: "card-a", string: "Alpha" }],
      nodes: new Map([["card-a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 } }]]),
    });
    const sessionB = cardSession([], {
      children: [{ uid: "card-b", string: "Beta" }],
      nodes: new Map([["card-b", { pos: { x: 40, y: 40 }, size: { width: 280, height: 160 } }]]),
    });
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({ session: sessionA, settings, version: "0.5.0", nestStack: [] });
    try {
      const cards = findByClass(canvas.root, "pxd-cards");
      assert.ok(cards.children.some((child) => child.dataset?.uid === "card-a"));
      canvas.attachSession(sessionB);
      assert.ok(!cards.children.some((child) => child.dataset?.uid === "card-a"), "A's card node is gone");
      assert.ok(cards.children.some((child) => child.dataset?.uid === "card-b"), "B's card is present");
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("selected card with color teal paints a border", () => {
  const { document, window } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    const session = cardSession([], {
      children: [{ uid: "card-a", string: "Hello card" }],
      nodes: new Map([["card-a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 }, color: "teal" }]]),
    });
    session.model.selected.add("card-a");
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({ session, settings, version: "0.5.0", nestStack: [] });
    try {
      const cards = findByClass(canvas.root, "pxd-cards");
      const card = cards.children.find((child) => child.dataset?.uid === "card-a");
      assert.ok(card);
      const painted = card.style.borderColor === "#00b3a4"
        || card.style["--pxd-card-color"] === "#00b3a4"
        || (typeof card.style.getPropertyValue === "function" && card.style.getPropertyValue("--pxd-card-color") === "#00b3a4");
      assert.ok(painted, "teal card should set border-color or --pxd-card-color");
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("named nested card shows the parsed title, not the raw macro", () => {
  const { document, window } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    const session = cardSession([], {
      children: [{ uid: "nested-1", string: "{{[[diagram]]:Research}}" }],
      nodes: new Map([["nested-1", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 } }]]),
    });
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({ session, settings, version: "0.5.0", nestStack: [] });
    try {
      const label = findByClass(canvas.root, "pxd-card__nested-label");
      assert.ok(label);
      assert.equal(label.textContent, "Research");
      assert.notEqual(label.textContent, "{{[[diagram]]:Research}}");
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

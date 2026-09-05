import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasRoot, isDarkHost, resolveEdgeColor, shouldCommitPulledString, topbarOffset, sidebarOffset, applyFullscreenChrome, fullscreenInsets, cardUidFromHitStack, parseDropPayload, parseDiagramTitle, focusRoamInput } from "../src/canvas.js";
import { edgeEndpoints } from "../src/edges.js";
import { settingsDefaults } from "../src/settings.js";
import { releaseScratch } from "../src/metadata.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

function createDomStub() {
  const elements = new Map();
  const theme = {};
  let id = 0;
  const matchSimple = (node, token) => {
    const s = String(token || "");
    if (s.startsWith(".")) return Boolean(node.classList?.contains?.(s.slice(1).split(/[\s.#[]/)[0]));
    if (s.startsWith("#")) return node.id === s.slice(1);
    if (s.startsWith("[")) return Boolean(node.hasAttribute?.(s.slice(1).split(/[=\]]/)[0]));
    return String(node.tagName || "").toLowerCase() === s.toLowerCase();
  };
  // Supports comma lists and descendant chains ("A B C"); each token is one simple selector.
  const matchSelector = (node, sel) => String(sel || "").split(",").some((part) => {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length || !matchSimple(node, tokens[tokens.length - 1])) return false;
    let ancestor = node.parentElement;
    for (let i = tokens.length - 2; i >= 0; i -= 1) {
      while (ancestor && !matchSimple(ancestor, tokens[i])) ancestor = ancestor.parentElement;
      if (!ancestor) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
  const makeListeners = (target) => {
    const registry = new Map();
    target.listeners = registry;
    target.addEventListener = (type, fn) => {
      if (!registry.has(type)) registry.set(type, new Set());
      registry.get(type).add(fn);
    };
    target.removeEventListener = (type, fn) => {
      registry.get(type)?.delete(fn);
    };
  };
  const makeEl = (tag) => {
    let html = "";
    const attrs = new Map();
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
        setProperty(name, value) { el.style[name] = value; },
      },
      dataset: {},
      children: [],
      append(...nodes) { el.children.push(...nodes); nodes.forEach((n) => { n.parentElement = el; }); },
      appendChild(node) { el.append(node); },
      prepend(node) { el.children.unshift(node); node.parentElement = el; },
      replaceChildren(...nodes) {
        el.children.forEach((child) => { child.parentElement = null; });
        el.children = [];
        el.append(...nodes);
      },
      remove() {
        el.isConnected = false;
        const parent = el.parentElement;
        if (parent) {
          parent.children = parent.children.filter((child) => child !== el);
          el.parentElement = null;
        }
      },
      querySelector(sel) {
        for (const child of el.children || []) {
          if (matchSelector(child, sel)) return child;
          const found = child.querySelector?.(sel);
          if (found) return found;
        }
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (node) => {
          for (const child of node.children || []) {
            if (matchSelector(child, sel)) out.push(child);
            walk(child);
          }
        };
        walk(el);
        return out;
      },
      closest(sel) {
        const name = String(sel || "").startsWith(".") ? String(sel).slice(1).split(/[\s.#[]/)[0] : "";
        let node = el;
        while (node) {
          if (name && node.classList?.contains?.(name)) return node;
          node = node.parentElement;
        }
        return null;
      },
      // Cards report an unpainted (zero) rect unless a test pins `el._rect`, so
      // DOM hit-testing falls through to elementsFromPoint / world rects by default.
      getBoundingClientRect: () => {
        if (el._rect) return el._rect;
        if (el.classList.contains("pxd-card")) return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
        return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
      },
      attributes: attrs,
      setAttribute(name, value) {
        attrs.set(String(name), String(value));
        if (name === "id") el.id = String(value);
      },
      getAttribute(name) { return attrs.has(String(name)) ? attrs.get(String(name)) : null; },
      hasAttribute(name) { return attrs.has(String(name)); },
      removeAttribute(name) { attrs.delete(String(name)); },
      textContent: "",
      isConnected: true,
      parentElement: null,
      id: `el-${id += 1}`,
    };
    Object.defineProperty(el, "innerHTML", {
      get() { return html; },
      set(value) {
        html = String(value ?? "");
        el.children.forEach((child) => { child.parentElement = null; });
        el.children = [];
      },
      enumerable: true,
    });
    makeListeners(el);
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
    querySelectorAll() { return []; },
    elementsFromPoint: null,
  };
  document.body = makeEl("body");
  makeListeners(document);

  const getComputedStyle = (el) => ({
    getPropertyValue(name) {
      const own = el?.style?.[name];
      if (own != null && own !== "") return String(own);
      return theme[name] ?? "";
    },
  });
  const window = { getComputedStyle };
  makeListeners(window);

  const dispatch = (target, type, event = {}) => {
    const ev = {
      type,
      button: 0,
      target,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { ev.defaultPrevented = true; },
      stopPropagation() { ev.propagationStopped = true; },
      stopImmediatePropagation() { ev.propagationStopped = true; },
      ...event,
    };
    let node = target;
    while (node) {
      ev.currentTarget = node;
      for (const fn of [...(node.listeners?.get(type) || [])]) {
        if (typeof fn === "function") fn(ev);
        else fn?.handleEvent?.(ev);
      }
      if (ev.propagationStopped) break;
      node = node === document || node === window ? null : node.parentElement;
    }
    return ev;
  };

  return { document, window, elements, theme, dispatch, getComputedStyle };
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
      addEdge(source, target, kind = "bezier", label = "", extra = {}) {
        if (this.edges.some((edge) => edge.source === source && edge.target === target)) return null;
        const edge = {
          source,
          target,
          kind,
          label: label || "",
          from: extra.from || "auto",
          to: extra.to || "auto",
          direction: extra.direction || "",
          color: extra.color || "",
        };
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
      const beforeEdit = renderUids.length;
      await canvas.editCard("card-a");
      const editMounts = renderUids.slice(beforeEdit);
      assert.ok(editMounts.includes("scratch-host"), "renderBlock should mount the scratch uid");
      assert.ok(!editMounts.includes("card-a"), "renderBlock must not mount the card uid during edit");
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

test("idle paint uses renderBlock for a card with children but no string", () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousRoam = globalThis.roamAlphaAPI;
  const renderUids = [];
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  globalThis.roamAlphaAPI = {
    ui: {
      components: {
        renderBlock: ({ uid }) => { renderUids.push(uid); },
        unmountNode: () => {},
      },
    },
  };
  try {
    const session = cardSession([], {
      children: [{
        uid: "card-a",
        string: "",
        children: [{ uid: "child-1", string: "bullet", order: 0 }],
      }],
    });
    const canvas = createCanvasRoot({ session, settings: defaultSettings(), version: "0.6.3" });
    try {
      canvas.render();
      assert.ok(renderUids.includes("card-a"), "children-only card should idle-render the card uid");
      assert.equal(findByClass(canvas.root, "pxd-card__placeholder"), null, "should not show empty placeholder");
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.roamAlphaAPI = previousRoam;
  }
});

test("exitEdit paints idle renderBlock with the card uid after scratch edit", async () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousRoam = globalThis.roamAlphaAPI;
  const renderUids = [];
  globalThis.document = stub.document;
  globalThis.window = stub.window;
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
                ":block/children": [{
                  ":block/uid": "scratch-child",
                  ":block/string": "nested bullet",
                  ":block/order": 0,
                }],
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
        if (uid === "scratch-host") {
          return {
            ":block/uid": "scratch-host",
            ":block/string": "Hello card",
            ":block/children": [{
              ":block/uid": "scratch-child",
              ":block/string": "nested bullet",
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
    const canvas = createCanvasRoot({ session, settings: defaultSettings(), version: "0.6.3" });
    try {
      await canvas.editCard("card-a");
      assert.ok(renderUids.includes("scratch-host"), "edit should mount scratch uid");
      stub.dispatch(canvas.root, "pointerenter");
      stub.dispatch(stub.window, "keydown", { key: "Escape", preventDefault() {} });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.ok(renderUids.includes("card-a"), "idle paint after exit should renderBlock the card uid");
      assert.ok(renderUids.lastIndexOf("card-a") > renderUids.indexOf("scratch-host"),
        "card uid idle paint should follow scratch edit mount");
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

test("port capture: pointerdown on handle arms connect with side", () => {
  const { document, window, dispatch } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    const session = cardSession([]);
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({ session, settings, version: "0.5.0", nestStack: [] });
    try {
      const cards = findByClass(canvas.root, "pxd-cards");
      const cardEl = cards.children.find((child) => child.dataset?.uid === "card-a");
      const handle = cardEl.children.find((child) => child.className?.includes("pxd-handle--right"));
      assert.ok(handle);
      handle.dataset.side = "right";
      document.elementsFromPoint = () => [handle, cardEl];
      dispatch(handle, "pointerdown", { button: 0 });
      dispatch(document, "pointerup", { button: 0, clientX: 0, clientY: 0 });
      assert.deepEqual(canvas.getConnectArm(), { uid: "card-a", side: "right" });
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("completeConnect stores fromSide and toSide on the model edge", async () => {
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
        fromSide: "right",
        toSide: "left",
      });
      assert.equal(session.model.edges.length, 1);
      assert.equal(session.model.edges[0].from, "right");
      assert.equal(session.model.edges[0].to, "left");
      assert.equal(session.model.edges[0].direction, "oneWay");
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("completeConnect paints settled edge through stored ports", async () => {
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
        fromSide: "right",
        toSide: "left",
      });
      const edgePath = findByClass(canvas.root, "pxd-edge");
      assert.ok(edgePath, "connected pair should paint a .pxd-edge");
      const source = { x: 0, y: 0, width: 280, height: 160 };
      const target = { x: 400, y: 0, width: 280, height: 160 };
      const { sx, sy, tx, ty } = edgeEndpoints(source, target, "right", "left");
      const d = edgePath.getAttribute("d");
      assert.match(d, new RegExp(`^M ${sx} ${sy}`));
      assert.ok(d.includes(`${tx}`) && d.includes(`${ty}`));
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

// ------------------------------------------------------------- U2 arrows

function withStubDom(stub, fn) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  try {
    return fn();
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
}

function svgLayer(canvas, className) {
  return findByClass(canvas.root, className);
}

function walkAll(el, out = []) {
  for (const child of el?.children || []) {
    out.push(child);
    walkAll(child, out);
  }
  return out;
}

const defaultSettings = () => ({ get: (key) => settingsDefaults()[key] });

test("edge CSS is scoped to .pxd-root and sets stroke/fill from --pxd-edge", async () => {
  const css = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../src/extension.css"), "utf8");
  assert.match(css, /\.pxd-root \.pxd-edge\s*\{[^}]*stroke:\s*var\(--pxd-edge\)/s);
  assert.match(css, /\.pxd-root \.pxd-arrow\s*\{[^}]*fill:\s*var\(--pxd-edge\)/s);
});

test("rendered edges and markers carry literal colors, never var()", () => {
  const stub = createDomStub();
  withStubDom(stub, () => {
    const session = cardSession([{ source: "card-a", target: "card-b", kind: "bezier", label: "" }]);
    const canvas = createCanvasRoot({ session, settings: defaultSettings(), version: "0.5.0", nestStack: [] });
    try {
      const edges = svgLayer(canvas, "pxd-edges");
      const arrow = findByClass(edges, "pxd-arrow");
      assert.ok(arrow, "marker path rendered");
      assert.match(arrow.style.fill, /^#[0-9a-f]{6}$/);
      const edge = findByClass(edges, "pxd-edge");
      assert.match(edge.style.stroke, /^#[0-9a-f]{6}$/);
      assert.equal(edge.getAttribute("stroke"), null, "stroke lives in style, not a presentation attribute");
      for (const node of walkAll(edges)) {
        for (const [name, value] of node.attributes) {
          assert.ok(!String(value).includes("var("), `${node.tagName} ${name} must not use var()`);
        }
        for (const value of Object.values(node.style)) {
          if (typeof value === "string") assert.ok(!value.includes("var("), "inline style must not use var()");
        }
      }
    } finally {
      canvas.dispose();
    }
  });
});

test("edge color follows the host --pxd-edge, then dark/light fallbacks", () => {
  const themed = createDomStub();
  themed.theme["--pxd-edge"] = "#a7b6c2";
  withStubDom(themed, () => {
    const canvas = createCanvasRoot({
      session: cardSession([{ source: "card-a", target: "card-b", kind: "bezier", label: "" }]),
      settings: defaultSettings(),
      version: "0.5.0",
      nestStack: [],
    });
    try {
      assert.equal(findByClass(canvas.root, "pxd-arrow").style.fill, "#a7b6c2");
      assert.equal(findByClass(canvas.root, "pxd-edge").style.stroke, "#a7b6c2");
    } finally {
      canvas.dispose();
    }
  });

  const dark = createDomStub();
  dark.document.body.classList.add("bt-theme-dark");
  withStubDom(dark, () => {
    const canvas = createCanvasRoot({
      session: cardSession([{ source: "card-a", target: "card-b", kind: "bezier", label: "" }]),
      settings: defaultSettings(),
      version: "0.5.0",
      nestStack: [],
    });
    try {
      assert.equal(findByClass(canvas.root, "pxd-arrow").style.fill, "#a7b6c2");
    } finally {
      canvas.dispose();
    }
  });

  const light = createDomStub();
  withStubDom(light, () => {
    const canvas = createCanvasRoot({
      session: cardSession([{ source: "card-a", target: "card-b", kind: "bezier", label: "" }]),
      settings: defaultSettings(),
      version: "0.5.0",
      nestStack: [],
    });
    try {
      assert.equal(findByClass(canvas.root, "pxd-arrow").style.fill, "#738694");
      assert.equal(findByClass(canvas.root, "pxd-edge").style.stroke, "#738694");
    } finally {
      canvas.dispose();
    }
  });
});

test("isDarkHost matches every dark selector and swatch colors win over the theme", () => {
  const stub = createDomStub();
  withStubDom(stub, () => {
    const plain = stub.document.createElement("div");
    assert.equal(isDarkHost(plain), false);
    for (const marker of ["bp3-dark", "rm-dark-theme", "bt-theme-dark"]) {
      const host = stub.document.createElement("div");
      host.classList.add(marker);
      const child = stub.document.createElement("div");
      host.append(child);
      assert.equal(isDarkHost(child), true, marker);
    }
    const roamBody = stub.document.createElement("div");
    roamBody.classList.add("roam-body", "dark");
    const inner = stub.document.createElement("div");
    roamBody.append(inner);
    assert.equal(isDarkHost(inner), true);
    assert.equal(resolveEdgeColor(plain, "teal"), "#00b3a4");
    assert.equal(resolveEdgeColor(plain, ""), "#738694");
    stub.theme["--pxd-edge"] = "rgb(1, 2, 3)";
    assert.equal(resolveEdgeColor(plain, ""), "rgb(1, 2, 3)");
    assert.equal(resolveEdgeColor(plain, "teal"), "#00b3a4");
  });
});

test("edge.direction drives marker-start/marker-end with canvas-scoped ids", () => {
  const stub = createDomStub();
  withStubDom(stub, () => {
    const session = cardSession([
      { source: "card-a", target: "card-b", kind: "bezier", label: "", direction: "twoWay" },
    ]);
    const canvas = createCanvasRoot({ session, settings: defaultSettings(), version: "0.5.0", nestStack: [] });
    try {
      const edgeOf = () => findByClass(canvas.root, "pxd-edge");
      let edge = edgeOf();
      assert.match(edge.getAttribute("marker-end"), /^url\(#pxd-arrow-end-pxd\d+-default\)$/);
      assert.match(edge.getAttribute("marker-start"), /^url\(#pxd-arrow-start-pxd\d+-default\)$/);
      const endId = edge.getAttribute("marker-end").slice(5, -1);
      const defs = svgLayer(canvas, "pxd-edges").querySelector("defs");
      assert.ok(defs.querySelector(`#${endId}`), "marker-end resolves inside this canvas defs");

      session.model.edges[0].direction = "none";
      canvas.render();
      edge = edgeOf();
      assert.equal(edge.getAttribute("marker-end"), null);
      assert.equal(edge.getAttribute("marker-start"), null);

      delete session.model.edges[0].direction;
      canvas.render();
      edge = edgeOf();
      assert.match(edge.getAttribute("marker-end"), /^url\(#pxd-arrow-end-pxd\d+-default\)$/);
      assert.equal(edge.getAttribute("marker-start"), null, "default arrowheads setting is end-only");

      session.model.edges[0].color = "teal";
      canvas.render();
      edge = edgeOf();
      assert.match(edge.getAttribute("marker-end"), /^url\(#pxd-arrow-end-pxd\d+-teal\)$/);
      assert.equal(edge.style.stroke, "#00b3a4");
      const tealId = edge.getAttribute("marker-end").slice(5, -1);
      const tealMarker = svgLayer(canvas, "pxd-edges").querySelector("defs").querySelector(`#${tealId}`);
      assert.equal(findByClass(tealMarker, "pxd-arrow").style.fill, "#00b3a4");
    } finally {
      canvas.dispose();
    }
  });
});

test("two canvas roots use disjoint marker ids", () => {
  const stub = createDomStub();
  withStubDom(stub, () => {
    const make = () => createCanvasRoot({
      session: cardSession([{ source: "card-a", target: "card-b", kind: "bezier", label: "" }]),
      settings: defaultSettings(),
      version: "0.5.0",
      nestStack: [],
    });
    const first = make();
    const second = make();
    try {
      const a = findByClass(first.root, "pxd-edge").getAttribute("marker-end");
      const b = findByClass(second.root, "pxd-edge").getAttribute("marker-end");
      assert.match(a, /^url\(#pxd-arrow-end-/);
      assert.match(b, /^url\(#pxd-arrow-end-/);
      assert.notEqual(a, b);
      const idsA = walkAll(svgLayer(first, "pxd-edges")).filter((n) => n.tagName === "MARKER").map((n) => n.id);
      const idsB = walkAll(svgLayer(second, "pxd-edges")).filter((n) => n.tagName === "MARKER").map((n) => n.id);
      assert.ok(idsA.length && idsB.length);
      assert.equal(idsA.filter((id) => idsB.includes(id)).length, 0, "no shared marker ids");
    } finally {
      first.dispose();
      second.dispose();
    }
  });
});

test("temp wire points its marker-end at a marker inside tempSvg", () => {
  const stub = createDomStub();
  withStubDom(stub, () => {
    const canvas = createCanvasRoot({ session: cardSession([]), settings: defaultSettings(), version: "0.5.0", nestStack: [] });
    try {
      canvas.armConnect("card-a");
      stub.dispatch(stub.document, "pointermove", { clientX: 500, clientY: 200 });
      const temp = svgLayer(canvas, "pxd-edges-temp");
      const wire = findByClass(temp, "pxd-edge--temp");
      assert.ok(wire, "temp wire painted");
      assert.equal(wire.getAttribute("stroke"), null);
      assert.match(wire.style.stroke, /^#[0-9a-f]{6}$/);
      const markerRef = wire.getAttribute("marker-end");
      assert.match(markerRef, /^url\(#pxd-arrow-temp-pxd\d+\)$/);
      const markerId = markerRef.slice(5, -1);
      const marker = temp.querySelector("defs")?.querySelector(`#${markerId}`);
      assert.ok(marker, "temp marker lives in tempSvg defs");
      assert.match(findByClass(marker, "pxd-arrow").style.fill, /^#[0-9a-f]{6}$/);
      assert.equal(svgLayer(canvas, "pxd-edges").querySelector("defs")?.querySelector(`#${markerId}`) ?? null, null);

      canvas.clearConnectArm();
      assert.equal(temp.children.length, 0, "clearTempEdge wipes tempSvg including defs");
      canvas.armConnect("card-a");
      stub.dispatch(stub.document, "pointermove", { clientX: 520, clientY: 220 });
      assert.ok(temp.querySelector("defs")?.querySelector(`#${markerId}`), "defs re-ensured after clear");
    } finally {
      canvas.dispose();
    }
  });
});

test("markers rescale on zoom changes of 5 percent or more", () => {
  const stub = createDomStub();
  withStubDom(stub, () => {
    const session = cardSession([{ source: "card-a", target: "card-b", kind: "bezier", label: "" }]);
    const canvas = createCanvasRoot({ session, settings: defaultSettings(), version: "0.5.0", nestStack: [] });
    try {
      const marker = () => walkAll(svgLayer(canvas, "pxd-edges")).find((n) => n.tagName === "MARKER");
      assert.equal(marker().getAttribute("markerWidth"), "10");
      session.model.viewport.zoom = 1.03;
      canvas.applyTransform();
      assert.equal(marker().getAttribute("markerWidth"), "10", "3 percent change leaves markers alone");
      session.model.viewport.zoom = 0.4;
      canvas.applyTransform();
      assert.equal(marker().getAttribute("markerWidth"), "24");
      assert.equal(marker().getAttribute("markerHeight"), "24");
      assert.equal(marker().getAttribute("refY"), "12");
      assert.match(findByClass(marker(), "pxd-arrow").getAttribute("d"), /L24,12/);
      session.model.viewport.zoom = 3;
      canvas.applyTransform();
      assert.equal(marker().getAttribute("markerWidth"), "6");
    } finally {
      canvas.dispose();
    }
  });
});

// ------------------------------------------------------------- U5a inspector chrome

function inspectorOnRoot(root) {
  return root.children.find((child) => String(child.className || "").split(/\s+/).includes("pxd-edge-inspector"));
}

test("selectEdge selects the path, mounts inspector on root, and clearEdgeSelection removes both", () => {
  const stub = createDomStub();
  withStubDom(stub, () => {
    const session = cardSession([{ source: "card-a", target: "card-b", kind: "bezier", label: "" }]);
    const canvas = createCanvasRoot({ session, settings: defaultSettings(), version: "0.5.0", nestStack: [] });
    try {
      canvas.selectEdge("card-a->card-b");
      const path = findByClass(canvas.root, "pxd-edge");
      assert.ok(path.classList.contains("pxd-edge--selected"));
      assert.ok(inspectorOnRoot(canvas.root), ".pxd-edge-inspector is a root child");
      assert.equal(canvas.getSelectedEdgeKey(), "card-a->card-b");
      canvas.clearEdgeSelection();
      assert.ok(!path.classList.contains("pxd-edge--selected"));
      assert.equal(inspectorOnRoot(canvas.root), undefined);
      assert.equal(canvas.getSelectedEdgeKey(), null);
    } finally {
      canvas.dispose();
    }
  });
});

test("Esc dismisses edge selection when the overlay has the pointer, not when focus is outside", () => {
  const stub = createDomStub();
  withStubDom(stub, () => {
    const session = cardSession([{ source: "card-a", target: "card-b", kind: "bezier", label: "" }]);
    const canvas = createCanvasRoot({ session, settings: defaultSettings(), version: "0.5.0", nestStack: [] });
    try {
      canvas.selectEdge("card-a->card-b");
      stub.dispatch(canvas.root, "pointerenter");
      stub.dispatch(stub.window, "keydown", { key: "Escape" });
      assert.equal(canvas.getSelectedEdgeKey(), null, "Esc after pointerenter dismisses");
      assert.equal(inspectorOnRoot(canvas.root), undefined);

      canvas.selectEdge("card-a->card-b");
      stub.dispatch(canvas.root, "pointerleave");
      stub.document.activeElement = stub.document.body;
      stub.dispatch(stub.window, "keydown", { key: "Escape" });
      assert.equal(canvas.getSelectedEdgeKey(), "card-a->card-b", "Esc with focus outside keeps selection");
      assert.ok(inspectorOnRoot(canvas.root));
    } finally {
      canvas.dispose();
    }
  });
});

test("attachSession clears edge selection; dispose removes the inspector element", () => {
  const stub = createDomStub();
  withStubDom(stub, () => {
    const session = cardSession([{ source: "card-a", target: "card-b", kind: "bezier", label: "" }]);
    const other = cardSession([], {
      children: [{ uid: "card-c", string: "Other diagram" }],
      nodes: new Map([["card-c", { pos: { x: 10, y: 10 }, size: { width: 280, height: 160 } }]]),
    });
    const canvas = createCanvasRoot({ session, settings: defaultSettings(), version: "0.5.0", nestStack: [] });
    try {
      canvas.selectEdge("card-a->card-b");
      assert.ok(inspectorOnRoot(canvas.root));
      canvas.attachSession(other);
      assert.equal(canvas.getSelectedEdgeKey(), null);
      assert.equal(inspectorOnRoot(canvas.root), undefined);

      canvas.attachSession(session);
      canvas.selectEdge("card-a->card-b");
      const inspector = inspectorOnRoot(canvas.root);
      assert.ok(inspector);
      canvas.dispose();
      assert.equal(inspector.isConnected, false);
      assert.equal(inspector.parentElement, null);
    } finally {
      /* dispose already ran */
    }
  });
});

// ------------------------------------------------------------- U5b inspector mutations

function inspectorButton(inspector, label) {
  return inspector.children.find((child) => child.textContent === label);
}

async function clickInspectorButton(stub, button) {
  stub.dispatch(button, "click");
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function persistLayoutCalls(actions) {
  return actions.filter((action) => action.persistLayout);
}

test("inspector direction button cycles direction and persists once", async () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  try {
    const session = cardSession([{ source: "card-a", target: "card-b", kind: "bezier", label: "" }]);
    const persists = [];
    const canvas = createCanvasRoot({
      session,
      settings: defaultSettings(),
      version: "0.5.0",
      nestStack: [],
      onPersist: async (action) => { persists.push(action); },
    });
    try {
      canvas.selectEdge("card-a->card-b");
      stub.dispatch(canvas.root, "pointerenter");
      const inspector = inspectorOnRoot(canvas.root);
      await clickInspectorButton(stub, inspectorButton(inspector, "Direction"));
      assert.equal(session.model.edges[0].direction, "twoWay");
      assert.equal(persistLayoutCalls(persists).length, 1);
      await clickInspectorButton(stub, inspectorButton(inspector, "Direction"));
      assert.equal(session.model.edges[0].direction, "none");
      assert.equal(persistLayoutCalls(persists).length, 2);
      await clickInspectorButton(stub, inspectorButton(inspector, "Direction"));
      assert.equal(session.model.edges[0].direction, "oneWay");
      assert.equal(persistLayoutCalls(persists).length, 3);
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("inspector Flip swaps endpoints and keeps label; disabled when reverse exists", async () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  try {
    const session = cardSession([{
      source: "card-a",
      target: "card-b",
      kind: "bezier",
      label: "keep",
      from: "right",
      to: "left",
      direction: "oneWay",
      color: "teal",
    }]);
    const persists = [];
    const canvas = createCanvasRoot({
      session,
      settings: defaultSettings(),
      version: "0.5.0",
      nestStack: [],
      onPersist: async (action) => { persists.push(action); },
    });
    try {
      canvas.selectEdge("card-a->card-b");
      stub.dispatch(canvas.root, "pointerenter");
      const inspector = inspectorOnRoot(canvas.root);
      const flipBtn = inspectorButton(inspector, "Flip");
      assert.equal(flipBtn.disabled, false);
      await clickInspectorButton(stub, flipBtn);
      assert.equal(session.model.edges.length, 1);
      const flipped = session.model.edges[0];
      assert.equal(flipped.source, "card-b");
      assert.equal(flipped.target, "card-a");
      assert.equal(flipped.from, "left");
      assert.equal(flipped.to, "right");
      assert.equal(flipped.label, "keep");
      assert.equal(flipped.kind, "bezier");
      assert.equal(flipped.direction, "oneWay");
      assert.equal(flipped.color, "teal");
      assert.equal(canvas.getSelectedEdgeKey(), "card-b->card-a");
      assert.equal(persistLayoutCalls(persists).length, 1);

      session.model.edges.push({
        source: "card-a",
        target: "card-b",
        kind: "bezier",
        label: "",
        from: "auto",
        to: "auto",
        direction: "",
        color: "",
      });
      canvas.selectEdge("card-b->card-a");
      const blockedFlip = inspectorButton(inspectorOnRoot(canvas.root), "Flip");
      assert.equal(blockedFlip.disabled, true);
      assert.equal(blockedFlip.title, "Reverse connection already exists");
      const edgeCount = session.model.edges.length;
      await clickInspectorButton(stub, blockedFlip);
      assert.equal(session.model.edges.length, edgeCount);
      assert.equal(persistLayoutCalls(persists).length, 1);
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("inspector Route and color swatch mutate the edge with one persist each", async () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  try {
    const session = cardSession([{ source: "card-a", target: "card-b", kind: "bezier", label: "" }]);
    const persists = [];
    const canvas = createCanvasRoot({
      session,
      settings: defaultSettings(),
      version: "0.5.0",
      nestStack: [],
      onPersist: async (action) => { persists.push(action); },
    });
    try {
      canvas.selectEdge("card-a->card-b");
      stub.dispatch(canvas.root, "pointerenter");
      const inspector = inspectorOnRoot(canvas.root);
      await clickInspectorButton(stub, inspectorButton(inspector, "Route"));
      assert.equal(session.model.edges[0].kind, "elbow");
      assert.equal(persistLayoutCalls(persists).length, 1);
      const tealSwatch = inspector.children.find((child) => child.dataset?.color === "teal");
      await clickInspectorButton(stub, tealSwatch);
      assert.equal(session.model.edges[0].color, "teal");
      assert.equal(persistLayoutCalls(persists).length, 2);
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("inspector Comment converts oneWay label to Roam comment on target", async () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousRoam = globalThis.roamAlphaAPI;
  const commentCalls = [];
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  globalThis.roamAlphaAPI = {
    data: {
      block: {
        addComment: async (payload) => { commentCalls.push(payload); },
      },
    },
  };
  try {
    const session = cardSession([{
      source: "card-a",
      target: "card-b",
      kind: "bezier",
      label: "because",
      direction: "oneWay",
    }]);
    const persists = [];
    const canvas = createCanvasRoot({
      session,
      settings: defaultSettings(),
      version: "0.6.4",
      nestStack: [],
      onPersist: async (action) => { persists.push(action); },
    });
    try {
      canvas.selectEdge("card-a->card-b");
      stub.dispatch(canvas.root, "pointerenter");
      const inspector = inspectorOnRoot(canvas.root);
      const commentBtn = inspectorButton(inspector, "Comment");
      assert.equal(commentBtn.disabled, false);
      await clickInspectorButton(stub, commentBtn);
      assert.equal(commentCalls.length, 1);
      assert.deepEqual(commentCalls[0], {
        "block-uid": "card-b",
        "reply-string": "((card-a)) because",
      });
      assert.equal(session.model.edges[0].label, "");
      assert.equal(persistLayoutCalls(persists).length, 1);
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.roamAlphaAPI = previousRoam;
  }
});

test("inspector Comment on twoWay edge comments both endpoints", async () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousRoam = globalThis.roamAlphaAPI;
  const commentCalls = [];
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  globalThis.roamAlphaAPI = {
    data: {
      block: {
        addComment: async (payload) => { commentCalls.push(payload); },
      },
    },
  };
  try {
    const session = cardSession([{
      source: "card-a",
      target: "card-b",
      kind: "bezier",
      label: "because",
      direction: "twoWay",
    }]);
    const persists = [];
    const canvas = createCanvasRoot({
      session,
      settings: defaultSettings(),
      version: "0.6.4",
      nestStack: [],
      onPersist: async (action) => { persists.push(action); },
    });
    try {
      canvas.selectEdge("card-a->card-b");
      stub.dispatch(canvas.root, "pointerenter");
      await clickInspectorButton(stub, inspectorButton(inspectorOnRoot(canvas.root), "Comment"));
      assert.equal(commentCalls.length, 2);
      assert.deepEqual(commentCalls[0], {
        "block-uid": "card-a",
        "reply-string": "((card-b)) because",
      });
      assert.deepEqual(commentCalls[1], {
        "block-uid": "card-b",
        "reply-string": "((card-a)) because",
      });
      assert.equal(session.model.edges[0].label, "");
      assert.equal(persistLayoutCalls(persists).length, 1);
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.roamAlphaAPI = previousRoam;
  }
});

test("inspector Comment disabled for none direction and keeps label", async () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousRoam = globalThis.roamAlphaAPI;
  const commentCalls = [];
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  globalThis.roamAlphaAPI = {
    data: {
      block: {
        addComment: async (payload) => { commentCalls.push(payload); },
      },
    },
  };
  try {
    const session = cardSession([{
      source: "card-a",
      target: "card-b",
      kind: "bezier",
      label: "because",
      direction: "none",
    }]);
    const persists = [];
    const canvas = createCanvasRoot({
      session,
      settings: defaultSettings(),
      version: "0.6.4",
      nestStack: [],
      onPersist: async (action) => { persists.push(action); },
    });
    try {
      canvas.selectEdge("card-a->card-b");
      stub.dispatch(canvas.root, "pointerenter");
      const commentBtn = inspectorButton(inspectorOnRoot(canvas.root), "Comment");
      assert.equal(commentBtn.disabled, true);
      assert.equal(commentBtn.title, "Set Direction to one-way or two-way first");
      await clickInspectorButton(stub, commentBtn);
      assert.equal(commentCalls.length, 0);
      assert.equal(session.model.edges[0].label, "because");
      assert.equal(persistLayoutCalls(persists).length, 0);
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.roamAlphaAPI = previousRoam;
  }
});

test("inspector Comment keeps label when addComment throws", async () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousRoam = globalThis.roamAlphaAPI;
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  globalThis.roamAlphaAPI = {
    data: {
      block: {
        addComment: async () => { throw new Error("roam failed"); },
      },
    },
  };
  try {
    const session = cardSession([{
      source: "card-a",
      target: "card-b",
      kind: "bezier",
      label: "because",
      direction: "oneWay",
    }]);
    const persists = [];
    const canvas = createCanvasRoot({
      session,
      settings: defaultSettings(),
      version: "0.6.4",
      nestStack: [],
      onPersist: async (action) => { persists.push(action); },
    });
    try {
      canvas.selectEdge("card-a->card-b");
      stub.dispatch(canvas.root, "pointerenter");
      await clickInspectorButton(stub, inspectorButton(inspectorOnRoot(canvas.root), "Comment"));
      assert.equal(session.model.edges[0].label, "because");
      assert.equal(persistLayoutCalls(persists).length, 0);
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.roamAlphaAPI = previousRoam;
  }
});

test("inspector Delete and keyboard Delete remove the edge and clear selection", async () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  try {
    const session = cardSession([{ source: "card-a", target: "card-b", kind: "bezier", label: "" }]);
    const persists = [];
    const canvas = createCanvasRoot({
      session,
      settings: defaultSettings(),
      version: "0.5.0",
      nestStack: [],
      onPersist: async (action) => { persists.push(action); },
    });
    try {
      canvas.selectEdge("card-a->card-b");
      stub.dispatch(canvas.root, "pointerenter");
      await clickInspectorButton(stub, inspectorButton(inspectorOnRoot(canvas.root), "Delete"));
      assert.equal(session.model.edges.length, 0);
      assert.equal(canvas.getSelectedEdgeKey(), null);
      assert.equal(inspectorOnRoot(canvas.root), undefined);
      assert.equal(persistLayoutCalls(persists).length, 1);

      session.model.edges.push({ source: "card-a", target: "card-b", kind: "bezier", label: "" });
      canvas.render();
      canvas.selectEdge("card-a->card-b");
      stub.dispatch(stub.window, "keydown", { key: "Delete" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(session.model.edges.length, 0);
      assert.equal(canvas.getSelectedEdgeKey(), null);
      assert.equal(persistLayoutCalls(persists).length, 2);
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("connect click-click arms when elementsFromPoint misses", () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  try {
    const session = cardSession([]);
    session.model.activeTool = "connect";
    const canvas = createCanvasRoot({
      session,
      settings: defaultSettings(),
      version: "0.6.1",
      nestStack: [],
    });
    try {
      const cards = findByClass(canvas.root, "pxd-cards");
      const cardA = cards.children.find((c) => c.dataset?.uid === "card-a");
      const handle = cardA.children.find((c) => c.className?.includes("pxd-handle--right"));
      stub.document.elementsFromPoint = () => [];
      stub.dispatch(handle, "pointerdown", { button: 0, clientX: 280, clientY: 80 });
      stub.dispatch(stub.document, "pointerup", { button: 0, clientX: 280, clientY: 80, target: handle });
      assert.equal(canvas.getConnectArm()?.uid, "card-a", "first click should arm connect");
      assert.ok(findByClass(canvas.root, "pxd-edge--temp"), "armed connect should show a temp wire");
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("connect drag resolves target via world rects when elementsFromPoint misses", () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  try {
    const session = cardSession([]);
    session.model.activeTool = "connect";
    const canvas = createCanvasRoot({
      session,
      settings: defaultSettings(),
      version: "0.6.1",
      nestStack: [],
    });
    try {
      const cards = findByClass(canvas.root, "pxd-cards");
      const cardA = cards.children.find((c) => c.dataset?.uid === "card-a");
      const handle = cardA.children.find((c) => c.className?.includes("pxd-handle--right"));
      stub.document.elementsFromPoint = () => [];
      stub.dispatch(handle, "pointerdown", { button: 0, clientX: 280, clientY: 80 });
      stub.dispatch(stub.document, "pointermove", { button: 0, clientX: 500, clientY: 80 });
      stub.dispatch(stub.document, "pointerup", { button: 0, clientX: 500, clientY: 80, target: handle });
      assert.equal(session.model.edges.length, 1);
      assert.equal(session.model.edges[0].source, "card-a");
      assert.equal(session.model.edges[0].target, "card-b");
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("Delete on selected card persists deleteCards", async () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  try {
    const session = cardSession([]);
    session.model.activeTool = "select";
    const persists = [];
    const canvas = createCanvasRoot({
      session,
      settings: defaultSettings(),
      version: "0.6.1",
      nestStack: [],
      onPersist: async (action) => { persists.push(action); },
    });
    try {
      session.model.selected.add("card-a");
      canvas.render();
      stub.dispatch(canvas.root, "pointerenter");
      stub.dispatch(stub.window, "keydown", { key: "Delete" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.ok(persists.some((a) => a.deleteCards), "Delete should persist deleteCards");
      assert.deepEqual(persists.find((a) => a.deleteCards)?.deleteCards, ["card-a"]);
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

// Panned board: card-b paints at screen 500–780 while world math puts the
// pointer in the gap between A and B and elementsFromPoint returns [].
function pannedConnectCanvas(stub, persists) {
  const session = cardSession([]);
  session.model.activeTool = "connect";
  session.model.viewport = { x: 200, y: 0, zoom: 1 };
  const canvas = createCanvasRoot({
    session,
    settings: defaultSettings(),
    version: "0.6.2",
    nestStack: [],
    onPersist: async (action) => { persists.push(action); },
  });
  const cards = findByClass(canvas.root, "pxd-cards");
  const cardA = cards.children.find((c) => c.dataset?.uid === "card-a");
  const cardB = cards.children.find((c) => c.dataset?.uid === "card-b");
  cardA._rect = { left: 200, top: 0, width: 280, height: 160, right: 480, bottom: 160 };
  cardB._rect = { left: 500, top: 0, width: 280, height: 160, right: 780, bottom: 160 };
  canvas.root._rect = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
  stub.document.elementsFromPoint = () => [];
  const handle = cardA.children.find((c) => c.className?.includes("pxd-handle--right"));
  return { session, canvas, cardA, cardB, handle };
}

test("connect drag onto a painted card adds an edge, not a card, when world math and elementsFromPoint miss", async () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  try {
    const persists = [];
    const { session, canvas, handle } = pannedConnectCanvas(stub, persists);
    try {
      stub.dispatch(handle, "pointerdown", { button: 0, clientX: 280, clientY: 80 });
      stub.dispatch(stub.document, "pointermove", { clientX: 400, clientY: 80 });
      stub.dispatch(stub.document, "pointermove", { clientX: 540, clientY: 80 });
      const temp = findByClass(canvas.root, "pxd-edge--temp");
      assert.ok(temp, "rubber-band paints during the drag");
      assert.ok(String(temp.getAttribute("d") || "").length > 0, "temp wire has a path");
      await stub.dispatch(stub.document, "pointerup", { button: 0, clientX: 540, clientY: 80, target: stub.document.body });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(session.model.edges.length, 1, "drop on visible card-b must add an edge");
      assert.equal(session.model.edges[0].source, "card-a");
      assert.equal(session.model.edges[0].target, "card-b");
      assert.equal(persists.some((a) => a.addCard), false, "must not connect-to-empty over a card");
      assert.equal(findByClass(canvas.root, "pxd-edge--temp"), null, "temp wire clears after the drop");
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("connect pointerup uses the card hovered on the last pointermove when the up-event misses", async () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  try {
    const persists = [];
    const { session, canvas, cardB, handle } = pannedConnectCanvas(stub, persists);
    try {
      stub.dispatch(handle, "pointerdown", { button: 0, clientX: 280, clientY: 80 });
      stub.dispatch(stub.document, "pointermove", { clientX: 540, clientY: 80 });
      // Roam re-rendered under the pointer: the card no longer reports a rect at pointerup.
      cardB._rect = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
      await stub.dispatch(stub.document, "pointerup", { button: 0, clientX: 540, clientY: 80, target: stub.document.body });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(session.model.edges.length, 1);
      assert.equal(session.model.edges[0].target, "card-b");
      assert.equal(persists.some((a) => a.addCard), false);
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("connect click-click onto empty board cancels the arm and does not add a card", async () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  try {
    const persists = [];
    const { session, canvas, handle } = pannedConnectCanvas(stub, persists);
    try {
      stub.dispatch(handle, "pointerdown", { button: 0, clientX: 480, clientY: 80 });
      stub.dispatch(stub.document, "pointerup", { button: 0, clientX: 480, clientY: 80, target: handle });
      assert.equal(canvas.getConnectArm()?.uid, "card-a", "first click arms");
      // Second click well below both painted cards (y=400; cards end at y=160).
      stub.dispatch(canvas.root, "pointerdown", { button: 0, clientX: 490, clientY: 400 });
      await stub.dispatch(stub.document, "pointerup", { button: 0, clientX: 490, clientY: 400, target: canvas.root });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(canvas.getConnectArm(), null, "click-click miss clears the arm");
      assert.equal(session.model.edges.length, 0);
      assert.equal(persists.some((a) => a.addCard), false, "click-click onto empty must not spawn a card");
      assert.equal(findByClass(canvas.root, "pxd-edge--temp"), null);
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("connect drag onto empty board still creates a linked card", async () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  try {
    const persists = [];
    const { session, canvas, handle } = pannedConnectCanvas(stub, persists);
    try {
      stub.dispatch(handle, "pointerdown", { button: 0, clientX: 480, clientY: 80 });
      stub.dispatch(stub.document, "pointermove", { clientX: 600, clientY: 400 });
      await stub.dispatch(stub.document, "pointerup", { button: 0, clientX: 600, clientY: 400, target: stub.document.body });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const add = persists.find((a) => a.addCard);
      assert.ok(add, "drag from a port into empty board adds a card");
      assert.equal(add.addEdge?.source, "card-a");
      assert.equal(session.model.edges.length, 0, "edge is created by the host after the card exists");
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("edge SVG layers cover content and viewport so a panned rubber-band is not clipped", () => {
  const stub = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = stub.document;
  globalThis.window = stub.window;
  try {
    const session = cardSession([]);
    session.model.viewport = { x: -3000, y: 0, zoom: 1 };
    const canvas = createCanvasRoot({ session, settings: defaultSettings(), version: "0.6.2", nestStack: [] });
    try {
      canvas.render();
      for (const name of ["pxd-edges", "pxd-edges-temp"]) {
        const svg = findByClass(canvas.root, name);
        const viewBox = String(svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
        assert.equal(viewBox.length, 4, `${name} has a viewBox`);
        const [minX, , width] = viewBox;
        assert.ok(minX <= -2000, `${name} viewBox starts before the content (${minX})`);
        assert.ok(minX + width >= 3800, `${name} viewBox reaches the visible viewport (${minX + width})`);
        assert.equal(svg.style.left, `${minX}px`);
        assert.equal(svg.style.width, `${width}px`);
      }
    } finally {
      canvas.dispose();
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

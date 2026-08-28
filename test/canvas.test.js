import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasRoot } from "../src/canvas.js";
import { settingsDefaults } from "../src/settings.js";

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
    const canvas = createCanvasRoot({ session, settings, version: "0.2.0" });
    const toolbar = canvas.root.children.find((child) => child.className === "pxd-toolbar");
    const labels = toolbar.children
      .filter((child) => child.className?.includes("pxd-toolbar__btn"))
      .map((child) => child.textContent);
    assert.ok(labels.includes("Select"));
    assert.ok(!labels.includes("S"));
    assert.ok(labels.includes("Zoom+"));
    assert.ok(labels.includes("Fit"));
    canvas.dispose();
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { NATIVE_HIDDEN_CLASS } from "../src/discovery.js";
import { createLifecycle } from "../src/lifecycle.js";
import { settingsDefaults } from "../src/settings.js";
import { mountDiagramView } from "../src/view.js";

function createDomStub() {
  const elements = new Map();
  let id = 0;
  const makeEl = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      className: "",
      classList: {
        _set: new Set(),
        add(...names) {
          names.forEach((name) => el.classList._set.add(name));
          el.className = [...el.classList._set].join(" ");
        },
        remove(...names) {
          names.forEach((name) => el.classList._set.delete(name));
          el.className = [...el.classList._set].join(" ");
        },
        contains(name) {
          return el.classList._set.has(name);
        },
        toggle(name, force) {
          const has = el.classList.contains(name);
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
      append(...nodes) {
        el.children.push(...nodes);
        nodes.forEach((node) => {
          node.parentElement = el;
        });
      },
      appendChild(node) {
        el.append(node);
      },
      prepend(node) {
        el.children.unshift(node);
        node.parentElement = el;
      },
      insertBefore(node, ref) {
        const index = ref ? el.children.indexOf(ref) : el.children.length;
        el.children.splice(index < 0 ? el.children.length : index, 0, node);
        node.parentElement = el;
      },
      listeners: new Map(),
      addEventListener(type, fn) {
        if (!el.listeners.has(type)) el.listeners.set(type, new Set());
        el.listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        el.listeners.get(type)?.delete(fn);
      },
      remove() {
        el.isConnected = false;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      closest() {
        return null;
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      setAttribute() {},
      textContent: "",
      innerHTML: "",
      isConnected: true,
      parentElement: null,
      nextElementSibling: null,
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
    querySelector() {
      return null;
    },
  };

  const window = {
    listeners: new Map(),
    addEventListener(type, fn) {
      if (!window.listeners.has(type)) window.listeners.set(type, new Set());
      window.listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      window.listeners.get(type)?.delete(fn);
    },
  };

  const dispatch = (target, type, event = {}) => {
    const ev = { type, button: 0, target, preventDefault() {}, ...event };
    let node = target;
    while (node) {
      for (const fn of [...(node.listeners?.get(type) || [])]) fn(ev);
      node = node === document || node === window ? null : node.parentElement;
    }
  };

  return { document, window, makeEl, dispatch };
}

function makeNativeElement(makeEl, nativeHeight) {
  const nativeElement = makeEl("div");
  nativeElement.className = "rm-diagram";
  nativeElement.getBoundingClientRect = () => {
    if (nativeElement.classList.contains(NATIVE_HIDDEN_CLASS)) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
    return { left: 0, top: 0, width: 800, height: nativeHeight };
  };
  return nativeElement;
}

function findButtonByTitle(root, title) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node.title === title) return node;
    stack.push(...(node.children || []));
  }
  return null;
}

function mountWithNativeHeight(nativeHeight, { onAction } = {}) {
  const { document, window, makeEl } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;

  const nativeElement = makeNativeElement(makeEl, nativeHeight);
  const host = makeEl("div");
  host.appendChild(nativeElement);
  nativeElement.parentElement = host;

  const session = {
    diagramUid: "viewtestuid",
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
    addView() {},
    persistLayout: async () => {},
    persistViewport: async () => {},
    addCard: async () => {},
    addSection: async () => {},
  };
  const defaults = settingsDefaults();
  const settings = {
    get(key) {
      return defaults[key];
    },
  };
  const lifecycle = createLifecycle();

  try {
    const mounted = mountDiagramView({
      nativeElement,
      session,
      settings,
      version: "0.2.0",
      lifecycle,
      onAction,
    });
    return { mounted, nativeElement, restore: () => {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    } };
  } catch (error) {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    throw error;
  }
}

test("mountDiagramView measures native height before hiding", () => {
  const tall = mountWithNativeHeight(800);
  try {
    assert.equal(tall.mounted.wrapper.style.width, "100%");
    assert.equal(tall.mounted.wrapper.style.height, "800px");
    assert.equal(tall.nativeElement.classList.contains(NATIVE_HIDDEN_CLASS), true);
    assert.equal(tall.mounted.wrapper.dataset.diagramUid, "viewtestuid");
    tall.mounted.dispose();
  } finally {
    tall.restore();
  }

  const short = mountWithNativeHeight(400);
  try {
    assert.equal(short.mounted.wrapper.style.height, "560px");
    assert.equal(short.nativeElement.classList.contains(NATIVE_HIDDEN_CLASS), true);
    short.mounted.dispose();
  } finally {
    short.restore();
  }
});

test("setSetting onPersist awaits onAction before canvas.render", async () => {
  const { document, window, makeEl, dispatch } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;

  let resolveSet;
  const setPromise = new Promise((resolve) => { resolveSet = resolve; });
  let renderCalls = 0;

  const nativeElement = makeNativeElement(makeEl, 800);
  const host = makeEl("div");
  host.appendChild(nativeElement);
  nativeElement.parentElement = host;

  const session = {
    diagramUid: "viewtestuid",
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
    addView() {},
    persistLayout: async () => {},
    persistViewport: async () => {},
    addCard: async () => {},
    addSection: async () => {},
  };
  const defaults = settingsDefaults();
  const settings = { get(key) { return defaults[key]; } };
  const lifecycle = createLifecycle();

  try {
    const mounted = mountDiagramView({
      nativeElement,
      session,
      settings,
      version: "0.2.0",
      lifecycle,
      onAction: async (action) => {
        if (action.type === "set-setting") await setPromise;
      },
    });
    const origRender = mounted.canvas.render.bind(mounted.canvas);
    mounted.canvas.render = (...args) => {
      renderCalls += 1;
      return origRender(...args);
    };

    const gridBtn = findButtonByTitle(mounted.canvas.root, "Board background");
    assert.ok(gridBtn);
    dispatch(gridBtn, "click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(renderCalls, 0);

    resolveSet();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(renderCalls, 1);

    mounted.dispose();
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

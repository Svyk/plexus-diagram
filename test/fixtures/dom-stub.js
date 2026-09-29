// Minimal DOM stub for node:test. Extracted from test/canvas.test.js (createDomStub) and
// extended with capture-phase dispatch, focus tracking, observers, rAF and timer ledgers so
// view tests can prove that dispose() leaves nothing behind.

export function createDomStub({ width = 800, height = 600 } = {}) {
  const elements = new Map();
  const theme = {};
  let id = 0;
  const allListeners = new Set();
  const observers = new Set();
  const frames = [];
  const timers = new Set();
  const idle = [];

  const matchSimple = (node, token) => {
    const s = String(token || "");
    if (!node || typeof node !== "object") return false;
    if (s === "*") return true;
    if (s.startsWith(".")) {
      const parts = s.slice(1).split(".");
      return parts.every((p) => node.classList?.contains?.(p.split(/[\s#[:]/)[0]));
    }
    if (s.startsWith("#")) return node.id === s.slice(1);
    if (s.startsWith("[")) {
      const inner = s.slice(1, -1);
      const [name, value] = inner.split("=");
      if (!node.hasAttribute?.(name)) return false;
      if (value === undefined) return true;
      return node.getAttribute(name) === value.replace(/^"|"$/g, "");
    }
    const dot = s.indexOf(".");
    if (dot > 0) return matchSimple(node, s.slice(0, dot)) && matchSimple(node, `.${s.slice(dot + 1)}`);
    return String(node.tagName || "").toLowerCase() === s.toLowerCase();
  };
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
    target.addEventListener = (type, fn, opts) => {
      if (!fn) return;
      const capture = typeof opts === "boolean" ? opts : Boolean(opts?.capture);
      if (!registry.has(type)) registry.set(type, new Map());
      const entry = { fn, capture, target, type };
      registry.get(type).set(fn, entry);
      allListeners.add(entry);
    };
    target.removeEventListener = (type, fn) => {
      const entry = registry.get(type)?.get(fn);
      if (!entry) return;
      registry.get(type).delete(fn);
      allListeners.delete(entry);
    };
    target.dispatchEvent = (ev) => dispatch(target, ev.type, ev);
  };

  const makeStyle = () => {
    const style = {
      cssText: "",
      setProperty(name, value) { style[name] = String(value); },
      removeProperty(name) { delete style[name]; },
    };
    return style;
  };

  const makeEl = (tag, ns) => {
    let html = "";
    const attrs = new Map();
    const classSet = new Set();
    const el = {
      tagName: tag.toUpperCase(),
      namespaceURI: ns || "http://www.w3.org/1999/xhtml",
      nodeType: 1,
      get className() { return [...classSet].join(" "); },
      set className(v) { classSet.clear(); String(v || "").split(/\s+/).filter(Boolean).forEach((c) => classSet.add(c)); },
      classList: {
        add(...names) { names.forEach((n) => { if (n) classSet.add(n); }); },
        remove(...names) { names.forEach((n) => classSet.delete(n)); },
        contains(name) { return classSet.has(name); },
        toggle(name, force) {
          const next = force ?? !classSet.has(name);
          if (next) classSet.add(name); else classSet.delete(name);
          return next;
        },
      },
      style: makeStyle(),
      dataset: {},
      children: [],
      get childNodes() { return el.children; },
      get firstChild() { return el.children[0] || null; },
      get lastChild() { return el.children[el.children.length - 1] || null; },
      get childElementCount() { return el.children.length; },
      get isConnected() {
        let n = el;
        while (n) { if (n === document.body || n === document) return true; n = n.parentElement; }
        return false;
      },
      append(...nodes) {
        nodes.forEach((n) => {
          if (n == null) return;
          const node = typeof n === "string" ? document.createTextNode(n) : n;
          node.parentElement?.children && node.parentElement !== el && node.remove();
          if (node.parentElement === el) el.children = el.children.filter((c) => c !== node);
          el.children.push(node);
          node.parentElement = el;
        });
      },
      appendChild(node) { el.append(node); return node; },
      prepend(...nodes) {
        nodes.slice().reverse().forEach((node) => {
          if (node.parentElement) node.remove();
          el.children.unshift(node);
          node.parentElement = el;
        });
      },
      insertBefore(node, ref) {
        if (node.parentElement) node.remove();
        const i = ref ? el.children.indexOf(ref) : -1;
        if (i < 0) el.children.push(node); else el.children.splice(i, 0, node);
        node.parentElement = el;
        return node;
      },
      replaceChildren(...nodes) {
        el.children.forEach((child) => { child.parentElement = null; });
        el.children = [];
        el.append(...nodes);
      },
      removeChild(node) { node.remove(); return node; },
      remove() {
        const parent = el.parentElement;
        if (parent) {
          parent.children = parent.children.filter((child) => child !== el);
          el.parentElement = null;
        }
      },
      contains(node) {
        let n = node;
        while (n) { if (n === el) return true; n = n.parentElement; }
        return false;
      },
      matches(sel) { return matchSelector(el, sel); },
      querySelector(sel) {
        for (const child of el.children || []) {
          if (child.nodeType !== 1) continue;
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
            if (child.nodeType !== 1) continue;
            if (matchSelector(child, sel)) out.push(child);
            walk(child);
          }
        };
        walk(el);
        return out;
      },
      closest(sel) {
        let node = el;
        while (node && node.nodeType === 1) {
          if (matchSelector(node, sel)) return node;
          node = node.parentElement;
        }
        return null;
      },
      getBoundingClientRect: () => {
        if (el._rect) return el._rect;
        if (el.classList.contains("pxd-root") || el.classList.contains("pxd-viewport") || el.classList.contains("pxd-mount")) {
          return { left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0 };
        }
        return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
      },
      get clientWidth() { return el.getBoundingClientRect().width; },
      get clientHeight() { return el.getBoundingClientRect().height; },
      get offsetWidth() { return el.getBoundingClientRect().width; },
      get offsetHeight() { return el.getBoundingClientRect().height; },
      scrollHeight: 0,
      scrollWidth: 0,
      attributes: attrs,
      setAttribute(name, value) {
        attrs.set(String(name), String(value));
        if (name === "id") el.id = String(value);
        if (name === "class") el.className = String(value);
      },
      getAttribute(name) {
        if (name === "class") return el.className;
        return attrs.has(String(name)) ? attrs.get(String(name)) : null;
      },
      hasAttribute(name) { return name === "class" ? classSet.size > 0 : attrs.has(String(name)); },
      removeAttribute(name) { attrs.delete(String(name)); },
      setPointerCapture() {},
      releasePointerCapture() {},
      hasPointerCapture() { return false; },
      focus() { document.activeElement = el; },
      blur() { if (document.activeElement === el) document.activeElement = document.body; },
      click() { dispatch(el, "click", { button: 0 }); },
      getContext() {
        return {
          clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, rect() {}, fill() {}, stroke() {},
          save() {}, restore() {}, scale() {}, translate() {}, setTransform() {},
          fillStyle: "", strokeStyle: "", lineWidth: 1,
        };
      },
      textContent: "",
      parentElement: null,
      id: `el-${id += 1}`,
      _rect: null,
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
    Object.defineProperty(el, "textContent", {
      get() { return el._text ?? el.children.map((c) => c.textContent ?? "").join(""); },
      set(v) { el._text = String(v ?? ""); el.children.forEach((child) => { child.parentElement = null; }); el.children = []; },
      enumerable: true,
    });
    Object.defineProperty(el, "value", {
      get() { return el._value ?? ""; },
      set(v) { el._value = String(v ?? ""); },
      enumerable: true,
    });
    makeListeners(el);
    if (tag === "button") el.type = "button";
    if (tag === "canvas") { el.width = 0; el.height = 0; }
    return el;
  };

  const document = {
    nodeType: 9,
    createElement(tag) {
      const el = makeEl(tag);
      elements.set(el.id, el);
      return el;
    },
    createElementNS(ns, tag) {
      const el = makeEl(tag, ns);
      elements.set(el.id, el);
      return el;
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text), parentElement: null, remove() { const p = this.parentElement; if (p) { p.children = p.children.filter((c) => c !== this); this.parentElement = null; } } };
    },
    querySelector(sel) { return document.body.querySelector(sel); },
    querySelectorAll(sel) { return document.body.querySelectorAll(sel); },
    elementsFromPoint: null,
    activeElement: null,
    contains(node) { return document.body.contains(node) || node === document.body; },
  };
  document.body = makeEl("body");
  document.documentElement = makeEl("html");
  document.documentElement.append(document.body);
  document.activeElement = document.body;
  document.defaultView = null;
  makeListeners(document);

  const getComputedStyle = (el) => ({
    getPropertyValue(name) {
      const own = el?.style?.[name];
      if (own != null && own !== "") return String(own);
      return theme[name] ?? "";
    },
  });

  const storageMap = new Map();
  const localStorage = {
    getItem(k) { return storageMap.has(k) ? storageMap.get(k) : null; },
    setItem(k, v) { storageMap.set(k, String(v)); },
    removeItem(k) { storageMap.delete(k); },
  };

  const window = {
    innerWidth: width,
    innerHeight: height,
    getComputedStyle,
    localStorage,
    location: { hash: "#/app/Svy/page/board0001" },
    requestAnimationFrame(fn) {
      const handle = { fn, id: frames.length + 1 };
      frames.push(handle);
      return handle.id;
    },
    cancelAnimationFrame(idv) {
      const i = frames.findIndex((f) => f.id === idv);
      if (i >= 0) frames.splice(i, 1);
    },
    requestIdleCallback(fn) {
      const handle = { fn, id: idle.length + 1 };
      idle.push(handle);
      return handle.id;
    },
    cancelIdleCallback(idv) {
      const i = idle.findIndex((f) => f.id === idv);
      if (i >= 0) idle.splice(i, 1);
    },
    setTimeout(fn, ms) {
      const t = { fn, ms, id: timers.size + Math.random() };
      timers.add(t);
      return t;
    },
    clearTimeout(t) { timers.delete(t); },
  };
  document.defaultView = window;
  makeListeners(window);

  class StubObserver {
    constructor(cb) { this.cb = cb; this.active = false; observers.add(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; observers.delete(this); }
    takeRecords() { return []; }
  }
  window.ResizeObserver = StubObserver;
  window.MutationObserver = StubObserver;

  const dispatch = (target, type, init = {}) => {
    const ev = {
      type,
      button: 0,
      buttons: 0,
      clientX: 0,
      clientY: 0,
      target,
      defaultPrevented: false,
      propagationStopped: false,
      immediateStopped: false,
      preventDefault() { ev.defaultPrevented = true; },
      stopPropagation() { ev.propagationStopped = true; },
      stopImmediatePropagation() { ev.propagationStopped = true; ev.immediateStopped = true; },
      composedPath() { return path; },
      ...init,
    };
    const path = [];
    let node = target;
    while (node) {
      path.push(node);
      node = node === document ? window : node === window ? null : (node.parentElement || (node === document.documentElement ? document : null));
    }
    const run = (n, capture) => {
      ev.currentTarget = n;
      for (const entry of [...(n.listeners?.get(type)?.values() || [])]) {
        if (entry.capture !== capture) continue;
        if (typeof entry.fn === "function") entry.fn(ev);
        else entry.fn?.handleEvent?.(ev);
        if (ev.immediateStopped) return;
      }
    };
    for (let i = path.length - 1; i >= 0 && !ev.propagationStopped; i -= 1) run(path[i], true);
    for (let i = 0; i < path.length && !ev.propagationStopped; i += 1) run(path[i], false);
    return ev;
  };

  const flushFrames = () => {
    const pending = frames.splice(0, frames.length);
    pending.forEach((f) => f.fn(16));
    return pending.length;
  };
  const flushIdle = () => {
    const pending = idle.splice(0, idle.length);
    pending.forEach((f) => f.fn({ timeRemaining: () => 8, didTimeout: false }));
    return pending.length;
  };
  const flushTimers = () => {
    const pending = [...timers];
    timers.clear();
    pending.forEach((t) => t.fn());
    return pending.length;
  };

  const install = () => {
    const prev = {
      document: globalThis.document,
      window: globalThis.window,
      localStorage: globalThis.localStorage,
      ResizeObserver: globalThis.ResizeObserver,
      MutationObserver: globalThis.MutationObserver,
      requestAnimationFrame: globalThis.requestAnimationFrame,
      cancelAnimationFrame: globalThis.cancelAnimationFrame,
      requestIdleCallback: globalThis.requestIdleCallback,
      cancelIdleCallback: globalThis.cancelIdleCallback,
      getComputedStyle: globalThis.getComputedStyle,
    };
    globalThis.document = document;
    globalThis.window = window;
    globalThis.localStorage = localStorage;
    globalThis.ResizeObserver = StubObserver;
    globalThis.MutationObserver = StubObserver;
    globalThis.requestAnimationFrame = window.requestAnimationFrame;
    globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
    globalThis.requestIdleCallback = window.requestIdleCallback;
    globalThis.cancelIdleCallback = window.cancelIdleCallback;
    globalThis.getComputedStyle = getComputedStyle;
    return () => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete globalThis[k]; else globalThis[k] = v;
      }
    };
  };

  return {
    document,
    window,
    localStorage,
    elements,
    theme,
    dispatch,
    getComputedStyle,
    install,
    flushFrames,
    flushIdle,
    flushTimers,
    frames,
    idle,
    timers,
    observers,
    listenerCount: () => allListeners.size,
    listeners: allListeners,
    pxdNodes: () => document.body.querySelectorAll("[class]").filter((el) => String(el.className).split(/\s+/).some((c) => c.startsWith("pxd-"))),
  };
}

export function withStubDom(stub, fn) {
  const restore = stub.install();
  try {
    return fn();
  } finally {
    restore();
  }
}

// FAST-1 counters. One pullBoard, then select / drag / type / one pan frame
// on a mounted board. Ceilings are whatever this harness counts.
import { createHost } from "../src/host/roam.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { edgeString } from "../src/model/schema.js";
import { stressBoardTree } from "../src/model/stress-board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const node = (id, string, plexus, children = []) => ({
  ":block/uid": id,
  ":block/string": string,
  ":block/props": plexus ? { plexus } : undefined,
  ":block/children": children,
  ":block/open": false,
});

// Same node shape as stressBoardTree: 4 sections x 10 notes, plus a Connections list.
export function boardTree40() {
  const cards = [];
  const sections = [];
  for (let s = 0; s < 4; s += 1) {
    const kids = [];
    for (let c = 0; c < 10; c += 1) {
      const id = `card-${s}-${c}`;
      kids.push(node(id, `Card ${s + 1}.${c + 1}`, {
        type: "card",
        x: 24 + (c % 5) * 220,
        y: 48 + Math.floor(c / 5) * 150,
        w: 200,
        h: 120,
        v: 2,
      }));
      cards.push(id);
    }
    const col = s % 5;
    const row = Math.floor(s / 5);
    sections.push(node(`sec-${s}`, `Section ${s + 1}`, {
      type: "section",
      x: 40 + col * 1240,
      y: 40 + row * 600,
      w: 1200,
      h: 560,
      v: 2,
    }, kids));
  }
  const edges = [];
  for (let i = 0; i < 20; i += 1) {
    const from = cards[i];
    const to = cards[i + 1];
    edges.push(node(
      `edge-${i}`,
      edgeString({ srcRef: `((${from}))`, dstRef: `((${to}))` }),
      { type: "edge", from, to, dir: "one" },
    ));
  }
  const connections = node("edges", "Connections", { type: "edges" }, edges);
  return node("root40", "{{[[diagram]]:FAST-1 40}}", { v: 2 }, [...sections, connections]);
}

export function countCards(tree) {
  let n = 0;
  const walk = (cur) => {
    if (!cur || typeof cur !== "object") return;
    if (cur[":block/props"]?.plexus?.type === "card") n += 1;
    for (const kid of cur[":block/children"] || []) walk(kid);
  };
  walk(tree);
  return n;
}

function indexTree(root) {
  const byUid = new Map();
  const walk = (cur) => {
    if (!cur || typeof cur !== "object") return;
    const uid = cur[":block/uid"];
    if (typeof uid === "string") byUid.set(uid, cur);
    for (const kid of cur[":block/children"] || []) walk(kid);
  };
  walk(root);
  return byUid;
}

function stamp(treeNode, ids) {
  if (!treeNode || typeof treeNode !== "object") return treeNode;
  const copy = { ...treeNode };
  const uid = copy[":block/uid"];
  if (typeof uid === "string") {
    if (!ids.has(uid)) ids.set(uid, ids.size + 1);
    copy[":db/id"] = ids.get(uid);
  }
  if (Array.isArray(treeNode[":block/children"])) {
    copy[":block/children"] = treeNode[":block/children"].map((kid) => stamp(kid, ids));
  }
  return copy;
}

function entityOf(entity) {
  if (Array.isArray(entity)) return { key: entity[0], value: entity[1] };
  return null;
}

// Counts the original data functions. createHost wraps pull, so a cache hit is not a call.
function countingData(tree) {
  const byUid = indexTree(tree);
  const ids = new Map();
  const trace = [];
  let on = false;
  const note = (name) => { if (on) trace.push(name); };
  const blockOf = (uid) => {
    const found = byUid.get(uid);
    return found ? stamp(found, ids) : null;
  };
  const data = {
    pull(_pattern, entity) {
      note("pull");
      const parsed = entityOf(entity);
      if (parsed?.key === ":block/uid") return blockOf(parsed.value);
      return null;
    },
    q() { note("q"); return []; },
    pull_many(_pattern, eids) {
      note("pull_many");
      const out = [];
      for (const entity of eids || []) {
        const parsed = entityOf(entity);
        if (parsed?.key !== ":block/uid") continue;
        const found = blockOf(parsed.value);
        if (found) out.push(found);
      }
      return out;
    },
    fast: { q() { note("fast.q"); return []; } },
  };
  return {
    data,
    trace,
    run(fn) {
      on = true;
      try { return fn(); }
      finally { on = false; }
    },
  };
}

function rawRect(el, width, height) {
  if (el?._rect) return el._rect;
  const cls = el?.classList;
  if (cls?.contains?.("pxd-root") || cls?.contains?.("pxd-viewport") || cls?.contains?.("pxd-mount")) {
    return { left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0 };
  }
  return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
}

// Mutations nest (setAttribute writes className). The outer call counts once.
function instrument(stub) {
  const hooked = new WeakSet();
  const state = {
    mutOn: false,
    listenOn: false,
    readOn: false,
    mutDepth: 0,
    readDepth: 0,
    mutations: 0,
    listeners: 0,
    reads: 0,
  };
  const bumpMut = () => {
    if (!state.mutOn || state.mutDepth) return false;
    state.mutDepth += 1;
    state.mutations += 1;
    return true;
  };
  const endMut = (entered) => { if (entered) state.mutDepth -= 1; };
  const counted = (fn) => function countedCall(...args) {
    const entered = bumpMut();
    try { return fn.apply(this, args); }
    finally { endMut(entered); }
  };
  const hookListen = (target) => {
    if (!target || hooked.has(target) || typeof target.addEventListener !== "function") return;
    hooked.add(target);
    const orig = target.addEventListener;
    target.addEventListener = function addEventListener(...args) {
      if (state.listenOn) state.listeners += 1;
      return orig.apply(this, args);
    };
  };
  const hookEl = (el) => {
    if (!el || el.nodeType !== 1 || hooked.has(el)) return el;
    hookListen(el);
    const origRect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect.bind(el) : () => rawRect(el, 800, 600);
    const rectOf = () => {
      state.readDepth += 1;
      try { return origRect(); }
      finally { state.readDepth -= 1; }
    };
    const countRead = () => {
      if (state.readOn && !state.readDepth) state.reads += 1;
    };
    el.getBoundingClientRect = () => {
      countRead();
      return rectOf();
    };
    // The stub getters call getBoundingClientRect. Count the entry the app used, once.
    for (const key of ["offsetWidth", "offsetHeight", "clientWidth"]) {
      Object.defineProperty(el, key, {
        configurable: true,
        get() {
          countRead();
          const rect = rectOf();
          return key === "offsetHeight" ? rect.height : rect.width;
        },
      });
    }
    Object.defineProperty(el, "clientHeight", {
      configurable: true,
      get() { return rectOf().height; },
    });
    for (const name of ["append", "prepend", "insertBefore", "remove", "setAttribute", "removeAttribute"]) {
      if (typeof el[name] === "function") el[name] = counted(el[name]);
    }
    if (el.classList) {
      for (const name of ["add", "remove", "toggle"]) {
        if (typeof el.classList[name] === "function") el.classList[name] = counted(el.classList[name]);
      }
    }
    if (el.style && typeof el.style === "object") {
      const raw = el.style;
      if (typeof raw.setProperty === "function") raw.setProperty = counted(raw.setProperty);
      el.style = new Proxy(raw, {
        set(box, prop, value) {
          const entered = bumpMut();
          try { box[prop] = value; }
          finally { endMut(entered); }
          return true;
        },
      });
    }
    return el;
  };
  // textContent / innerHTML are non-configurable on the stub. A face counts those
  // assignments, then writes through to the element the stub stored.
  const faces = new WeakMap();
  const textKey = new Set(["className", "textContent", "innerHTML"]);
  const face = (el) => {
    if (!el || el.nodeType !== 1) return el;
    hookEl(el);
    const cached = faces.get(el);
    if (cached) return cached;
    const proxy = new Proxy(el, {
      set(target, prop, value) {
        if (textKey.has(prop)) {
          const entered = bumpMut();
          try { target[prop] = value; }
          finally { endMut(entered); }
          return true;
        }
        target[prop] = value;
        return true;
      },
      get(target, prop, receiver) {
        const val = Reflect.get(target, prop, receiver);
        return typeof val === "function" ? val.bind(target) : val;
      },
    });
    faces.set(el, proxy);
    return proxy;
  };
  stub.document.body = face(stub.document.body);
  stub.document.documentElement = face(stub.document.documentElement);
  hookListen(stub.document);
  hookListen(stub.window);
  const origCreate = stub.document.createElement.bind(stub.document);
  stub.document.createElement = (tag) => face(origCreate(tag));
  const origNS = stub.document.createElementNS.bind(stub.document);
  stub.document.createElementNS = (ns, tag) => face(origNS(ns, tag));
  return state;
}

function components() {
  return {
    renderString({ el, string }) { if (el) el.textContent = String(string ?? ""); },
    renderBlock({ el }) {
      const doc = el?.ownerDocument || globalThis.document;
      const input = doc.createElement("textarea");
      input.className = "rm-block__input";
      el?.append?.(input);
    },
    renderPage() {},
    unmountNode() {},
  };
}

function makeHost(data, storage) {
  let n = 0;
  return createHost({
    api: {
      data,
      util: { generateUID: () => `fast1-${n += 1}` },
      ui: {
        components: components(),
        rightSidebar: { addWindow() {}, removeWindow() {}, getWindows: () => [] },
        mainWindow: { openBlock() {}, openPage() {} },
      },
    },
    storage,
    graph: "Svy",
  });
}

function fakeSession(board) {
  const handlers = new Map();
  const rec = () => () => Promise.resolve("uid");
  const recList = () => () => Promise.resolve(["uid"]);
  return {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    busy: false,
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    emit(name, payload) { for (const fn of [...(handlers.get(name) || [])]) fn(payload); },
    release() {},
    setEditing() {},
    setLinkMode() {},
    commitMove: rec(),
    commitRects: rec(),
    createCard: rec(),
    createText: rec(),
    createSection: rec(),
    wrapInSection: rec(),
    createBoard: rec(),
    wrapInBoard: rec(),
    renameBoard: rec(),
    moveIntoBoard: () => Promise.resolve({ moved: [], title: "Inner", boardUid: "b", undo() {} }),
    addRefCards: rec(),
    deleteItems: rec(),
    deleteEdges: rec(),
    setColor: rec(),
    setCollapsed: rec(),
    setBlockOpen: rec(),
    setKids: rec(),
    setFontSize: rec(),
    setString: rec(),
    growToFit: rec(),
    addEdge: rec(),
    updateEdge: rec(),
    flipEdge: rec(),
    undo: rec(),
    redo: rec(),
    setCollapsedMany: rec(),
    collapseAll: rec(),
    setPinned: rec(),
    setBoardBackground: rec(),
    setFit: rec(),
    fitSection: rec(),
    tidyItems: rec(),
    sameSize: rec(),
    resetSize: rec(),
    fitToContent: rec(),
    duplicateItems: recList(),
    pasteItems: recList(),
    pasteText: recList(),
    addDailyCards: recList(),
    sendToBoard: () => Promise.resolve({ added: 0, title: "Inner" }),
    expandOutline: () => Promise.resolve({ added: 0, edges: 0 }),
  };
}

async function quiet(stub) {
  const start = Date.now();
  while (Date.now() - start < 700) {
    stub.flushFrames();
    stub.flushIdle();
    await tick(25);
  }
  for (let i = 0; i < 4; i += 1) {
    stub.flushFrames();
    stub.flushIdle();
    await tick(15);
  }
}

function cardEl(root) {
  return root.querySelector("[data-uid=card-0-0]");
}

async function measureBoard(tree) {
  const stub = createDomStub();
  const restore = stub.install();
  const meter = instrument(stub);
  const counter = countingData(tree);
  let view = null;
  try {
    const host = makeHost(counter.data, stub.localStorage);
    const from = counter.trace.length;
    counter.run(() => host.pullBoard(tree[":block/uid"]));
    const trace = counter.trace.slice(from);
    const board = buildBoard(tree);
    const session = fakeSession(board);
    const mountEl = stub.document.createElement("div");
    mountEl.className = "pxd-mount";
    stub.document.body.append(mountEl);
    meter.listenOn = true;
    try {
      view = mountBoardView({
        host,
        session,
        mountEl,
        settings: { get: () => undefined },
        version: "2.17.0",
        initialViewport: { x: 0, y: 0, zoom: 1 },
      });
    } finally {
      meter.listenOn = false;
    }
    await quiet(stub);
    const root = view.root;
    const card = cardEl(root);
    if (!card) throw new Error(`card-0-0 was not mounted (${root.querySelectorAll(".pxd-item").length} items)`);

    const span = async (fn) => {
      const renders0 = host.stats.renders;
      const mutations0 = meter.mutations;
      meter.mutOn = true;
      try { await fn(); }
      finally { meter.mutOn = false; }
      return { renders: host.stats.renders - renders0, mutations: meter.mutations - mutations0 };
    };

    const select = await span(async () => {
      stub.dispatch(card, "pointerdown", { button: 0, clientX: 40, clientY: 40, pointerId: 1 });
      stub.dispatch(stub.document, "pointerup", { button: 0, clientX: 40, clientY: 40, pointerId: 1 });
      await tick(320);
      stub.flushFrames();
      stub.flushIdle();
    });
    if (!card.classList.contains("pxd-item--selected")) throw new Error("select did not mark card-0-0");

    const drag = await span(async () => {
      stub.dispatch(card, "pointerdown", { button: 0, clientX: 40, clientY: 40, pointerId: 2 });
      stub.dispatch(stub.document, "pointermove", { button: 0, buttons: 1, clientX: 64, clientY: 40, pointerId: 2 });
      stub.flushFrames();
    });
    stub.dispatch(stub.document, "pointerup", { button: 0, clientX: 64, clientY: 40, pointerId: 2 });
    await quiet(stub);

    const viewport = root.querySelector(".pxd-viewport");
    stub.dispatch(viewport, "pointerdown", { button: 1, buttons: 4, clientX: 100, clientY: 100, pointerId: 3 });
    stub.flushFrames();
    stub.flushIdle();
    if (!root.classList.contains("pxd-root--gesturing")) throw new Error("pan pointerdown did not gesture");
    const reads0 = meter.reads;
    stub.dispatch(stub.document, "pointermove", { button: 1, buttons: 4, clientX: 140, clientY: 110, pointerId: 3 });
    const queued = stub.frames.length;
    if (!queued) throw new Error("pan move scheduled no frame");
    meter.readOn = true;
    try { stub.flushFrames(); }
    finally { meter.readOn = false; }
    const layoutReadsPerPanFrame = meter.reads - reads0;
    stub.dispatch(stub.document, "pointerup", { button: 1, clientX: 140, clientY: 110, pointerId: 3 });
    await quiet(stub);

    stub.dispatch(card, "dblclick", { button: 0, clientX: 40, clientY: 40 });
    let editor = null;
    const opened = Date.now();
    while (Date.now() - opened < 900) {
      stub.flushFrames();
      stub.flushIdle();
      await tick(20);
      editor = root.querySelector("textarea.rm-block__input, textarea");
      if (editor && card.classList.contains("pxd-item--editing")) break;
    }
    if (!editor) throw new Error("editor textarea did not open");
    await quiet(stub);
    editor = root.querySelector("textarea.rm-block__input, textarea");
    if (!editor) throw new Error("editor closed before the type count");

    const typed = await span(async () => {
      editor.value = `${editor.value || ""}a`;
      stub.dispatch(editor, "keydown", { key: "a", code: "KeyA" });
      stub.dispatch(editor, "input", { data: "a", inputType: "insertText" });
      stub.flushFrames();
      await tick(40);
      stub.flushFrames();
    });

    return {
      trace,
      counts: {
        dataCallsPerOpen: trace.length,
        rendersSelect: select.renders,
        rendersDrag: drag.renders,
        rendersType: typed.renders,
        domMutationsSelect: select.mutations,
        domMutationsDrag: drag.mutations,
        domMutationsType: typed.mutations,
        listenersPerBoard: meter.listeners,
        layoutReadsPerPanFrame,
      },
    };
  } finally {
    try { view?.dispose(); } catch { /* already disposing */ }
    restore();
  }
}

export let lastTraces = {};

export async function measureCounts() {
  const counts = {};
  const traces = {};
  const small = await measureBoard(boardTree40());
  counts["40"] = small.counts;
  traces["40"] = small.trace;
  const large = await measureBoard(stressBoardTree());
  counts["300"] = large.counts;
  traces["300"] = large.trace;
  lastTraces = traces;
  return counts;
}

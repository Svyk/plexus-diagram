import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasRoot } from "../src/canvas.js";
import { MetadataStore, serializeDiagramMetadata } from "../src/metadata.js";
import { settingsDefaults } from "../src/settings.js";
import { NativeDiagramSession } from "../src/session.js";

function roamWriteCounts() {
  const counts = { create: 0, update: 0, delete: 0, updateViewport: 0 };
  return counts;
}

function installMetadataRoamMock(treeState, counts = roamWriteCounts()) {
  let n = 0;
  globalThis.roamAlphaAPI = {
    util: { generateUID: () => `uid-${++n}` },
    data: {
      q: (query) => {
        if (String(query).includes("plexus-diagram/metadata")) return [["meta-page"]];
        return [];
      },
      pull: (_pattern, ref) => {
        const uid = Array.isArray(ref) ? ref[1] : ref;
        if (uid === "meta-page") return treeState.page;
        if (uid === treeState.diagramBlockUid) return treeState.diagramBlock;
        return null;
      },
      page: { create: async () => {} },
      block: {
        create: async () => { counts.create += 1; },
        update: async () => { counts.update += 1; },
        delete: async () => { counts.delete += 1; },
      },
    },
    updateBlock: async () => { counts.updateViewport += 1; },
  };
  return counts;
}

function sampleLayout() {
  const nodes = new Map([["card-1", { pos: { x: 10, y: 20 }, size: { width: 280, height: 160 }, color: "" }]]);
  return {
    viewport: { x: 100, y: 200, zoom: 1.25 },
    nodes,
    edges: [{ source: "card-1", target: "card-2", kind: "bezier" }],
    sections: new Map(),
  };
}

test("MetadataStore.set skips when serialized layout matches stored", async () => {
  const layout = sampleLayout();
  const treeState = {
    page: {
      uid: "meta-page",
      string: "",
      children: [
        { uid: "schema", string: "schema-version:: 1", children: [] },
        {
          uid: "enhanced",
          string: "enhanced::",
          children: [{ uid: "diagram-block", string: "diagram-1", children: [] }],
        },
      ],
    },
    diagramBlockUid: "diagram-block",
    diagramBlock: { uid: "diagram-block", string: "diagram-1", children: [] },
  };
  const counts = installMetadataRoamMock(treeState);
  const store = new MetadataStore();
  store.pageUid = "meta-page";
  store.reload();
  store.diagrams.set("diagram-1", layout);
  store.diagramBlockUids.set("diagram-1", "diagram-block");

  const wrote = await store.set("diagram-1", layout);
  assert.equal(wrote, false);
  assert.equal(counts.create, 0);
  assert.equal(counts.update, 0);
  assert.equal(counts.delete, 0);
});

test("persistViewport with identical x,y,zoom performs zero writes", async () => {
  const layout = sampleLayout();
  const treeState = {
    page: {
      uid: "meta-page",
      string: "",
      children: [
        { uid: "schema", string: "schema-version:: 1", children: [] },
        {
          uid: "enhanced",
          string: "enhanced::",
          children: [{ uid: "diagram-block", string: "diagram-1", children: [] }],
        },
      ],
    },
    diagramBlockUid: "diagram-block",
    diagramBlock: {
      uid: "diagram-block",
      string: "diagram-1",
      children: [{
        uid: "vp",
        string: "viewport:: 100,200,1.25",
        children: [],
      }, {
        uid: "node-block",
        string: "node card-1",
        children: [{ uid: "pos", string: "pos:: 10,20", children: [] }],
      }],
    },
  };
  const counts = installMetadataRoamMock(treeState);
  const store = new MetadataStore();
  store.pageUid = "meta-page";
  store.reload();
  store.diagrams.set("diagram-1", layout);
  store.diagramBlockUids.set("diagram-1", "diagram-block");

  const session = new NativeDiagramSession({
    diagramUid: "diagram-1",
    metadataStore: store,
    settings: { get: () => undefined },
  });
  session.model = { viewport: { ...layout.viewport } };

  const wrote = await session.persistViewport();
  assert.equal(wrote, undefined);
  assert.equal(counts.create, 0);
  assert.equal(counts.update, 0);
  assert.equal(counts.delete, 0);
  assert.equal(counts.updateViewport, 0);
});

test("persistViewport with changed zoom updates viewport only, not node children", async () => {
  const layout = sampleLayout();
  const treeState = {
    page: {
      uid: "meta-page",
      string: "",
      children: [
        { uid: "schema", string: "schema-version:: 1", children: [] },
        {
          uid: "enhanced",
          string: "enhanced::",
          children: [{ uid: "diagram-block", string: "diagram-1", children: [] }],
        },
      ],
    },
    diagramBlockUid: "diagram-block",
    diagramBlock: {
      uid: "diagram-block",
      string: "diagram-1",
      children: [{
        uid: "vp",
        string: "viewport:: 100,200,1.25",
        children: [],
      }, {
        uid: "node-block",
        string: "node card-1",
        children: [{ uid: "pos", string: "pos:: 10,20", children: [] }],
      }],
    },
  };
  const counts = installMetadataRoamMock(treeState);
  const store = new MetadataStore();
  store.pageUid = "meta-page";
  store.reload();
  store.diagrams.set("diagram-1", layout);
  store.diagramBlockUids.set("diagram-1", "diagram-block");

  const session = new NativeDiagramSession({
    diagramUid: "diagram-1",
    metadataStore: store,
    settings: { get: () => undefined },
  });
  session.model = { viewport: { x: 100, y: 200, zoom: 1.5 } };

  await session.persistViewport();
  assert.equal(counts.delete, 0);
  assert.equal(counts.update, 1);
  assert.equal(counts.create, 0);
  assert.equal(counts.updateViewport, 0);
});

test("persistLayout skips when serialized snapshot equals stored", async () => {
  const layout = sampleLayout();
  const treeState = {
    page: {
      uid: "meta-page",
      string: "",
      children: [
        { uid: "schema", string: "schema-version:: 1", children: [] },
        {
          uid: "enhanced",
          string: "enhanced::",
          children: [{ uid: "diagram-block", string: "diagram-1", children: [] }],
        },
      ],
    },
    diagramBlockUid: "diagram-block",
    diagramBlock: { uid: "diagram-block", string: "diagram-1", children: [] },
  };
  const counts = installMetadataRoamMock(treeState);
  const store = new MetadataStore();
  store.pageUid = "meta-page";
  store.reload();
  store.diagrams.set("diagram-1", layout);
  store.diagramBlockUids.set("diagram-1", "diagram-block");

  const session = new NativeDiagramSession({
    diagramUid: "diagram-1",
    metadataStore: store,
    settings: { get: () => undefined },
  });
  session.model = { layoutSnapshot: () => layout };

  await session.persistLayout();
  assert.equal(counts.create, 0);
  assert.equal(counts.update, 0);
  assert.equal(counts.delete, 0);
});

test("layoutMatchesStored uses serializeDiagramMetadata equality", () => {
  const store = new MetadataStore();
  const layout = sampleLayout();
  store.diagrams.set("diagram-1", layout);
  assert.equal(store.layoutMatchesStored("diagram-1", layout), true);
  const changed = {
    ...layout,
    viewport: { x: 101, y: 200, zoom: 1.25 },
  };
  assert.equal(store.layoutMatchesStored("diagram-1", changed), false);
  assert.equal(
    serializeDiagramMetadata("diagram-1", layout),
    serializeDiagramMetadata("diagram-1", layout),
  );
});

function createDomStub() {
  let rafCb = null;
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
      style: { setProperty() {} },
      dataset: {},
      children: [],
      append(...nodes) { el.children.push(...nodes); nodes.forEach((n) => { n.parentElement = el; }); },
      appendChild(node) { el.append(node); },
      prepend(node) { el.children.unshift(node); node.parentElement = el; },
      addEventListener(type, handler) {
        if (type === "click") {
          el._clickHandlers = el._clickHandlers || [];
          el._clickHandlers.push(handler);
        }
      },
      removeEventListener() {},
      remove() { el.isConnected = false; },
      querySelector() { return null; },
      querySelectorAll() { return [] },
      closest() { return null; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      setAttribute() {},
      textContent: "",
      innerHTML: "",
      isConnected: true,
      parentElement: null,
    };
    if (tag === "button") {
      el.type = "button";
      el.click = () => {
        for (const handler of el._clickHandlers || []) handler({ preventDefault() {}, stopPropagation() {} });
      };
    }
    return el;
  };
  const document = {
    createElement(tag) { return makeEl(tag); },
    createElementNS(_ns, tag) { return makeEl(tag); },
    querySelector() { return null; },
  };
  const window = {
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(cb) { rafCb = cb; return 1; },
    cancelAnimationFrame() { rafCb = null; },
  };
  const flushRaf = () => { if (rafCb) { const cb = rafCb; rafCb = null; cb(); } };
  return { document, window, flushRaf };
}

function makeSession(viewport, nodes) {
  return {
    model: {
      activeTool: "select",
      viewport: { ...viewport },
      viewportSource: "metadata",
      children: [...nodes.keys()].map((uid) => ({ uid, string: "card" })),
      nodes,
      edges: [],
      sections: new Map(),
      selected: new Set(),
      ensureNode(uid, defaults) {
        const node = nodes.get(uid) || { pos: { x: 0, y: 0 }, size: { width: defaults.width, height: defaults.height } };
        this.nodes.set(uid, node);
        return node;
      },
      isNestedDiagram: () => false,
    },
  };
}

test("scheduleInitialFit does not invoke persistViewport", () => {
  const { document, window, flushRaf } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  const persistCalls = [];
  try {
    const nodes = new Map([["a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 } }]]);
    const session = makeSession({ x: 228, y: 185, zoom: 0.43 }, nodes);
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({
      session,
      settings,
      version: "0.3.2",
      onPersist: (action) => { persistCalls.push(action); },
    });
    flushRaf();
    assert.equal(persistCalls.some((a) => a.persistViewport), false);
    canvas.dispose();
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("dispose with no dirty flags does not invoke onPersist", () => {
  const { document, window, flushRaf } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  const persistCalls = [];
  try {
    const nodes = new Map([["a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 } }]]);
    const session = makeSession({ x: 10, y: 10, zoom: 1 }, nodes);
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({
      session,
      settings,
      version: "0.3.2",
      onPersist: (action) => { persistCalls.push(action); },
    });
    flushRaf();
    persistCalls.length = 0;
    canvas.dispose();
    assert.equal(persistCalls.length, 0);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("Fit button still invokes persistViewport", async () => {
  const { document, window, flushRaf } = createDomStub();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  const persistCalls = [];
  let resolvePersist;
  const persistDone = new Promise((resolve) => { resolvePersist = resolve; });
  try {
    const nodes = new Map([["a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 } }]]);
    const session = makeSession({ x: 10, y: 10, zoom: 1 }, nodes);
    const settings = { get: (key) => settingsDefaults()[key] };
    const canvas = createCanvasRoot({
      session,
      settings,
      version: "0.3.2",
      onPersist: (action) => {
        persistCalls.push(action);
        if (action.persistViewport) resolvePersist();
      },
    });
    flushRaf();
    const toolbar = canvas.root.children.find((child) => child.className === "pxd-toolbar");
    const fitBtn = toolbar.children
      .flatMap((child) => (child.className?.includes("pxd-toolbar__group") ? child.children : [child]))
      .find((btn) => btn.textContent === "Fit");
    assert.ok(fitBtn, "Fit button should exist");
    fitBtn.click();
    await Promise.race([
      persistDone,
      new Promise((_, reject) => setTimeout(() => reject(new Error("persistViewport timeout")), 500)),
    ]);
    assert.ok(persistCalls.some((a) => a.persistViewport));
    canvas.dispose();
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

function twoNodeLayout(pos1 = { x: 10, y: 20 }) {
  return {
    viewport: { x: 100, y: 200, zoom: 1.25 },
    nodes: new Map([
      ["card-1", { pos: { ...pos1 }, size: { width: 280, height: 160 }, color: "" }],
      ["card-2", { pos: { x: 400, y: 50 }, size: { width: 280, height: 160 }, color: "" }],
    ]),
    edges: [],
    sections: new Map(),
  };
}

function twoNodePageTree() {
  return {
    uid: "meta-page",
    string: "",
    children: [
      { uid: "schema", string: "schema-version:: 1", children: [] },
      {
        uid: "enhanced",
        string: "enhanced::",
        children: [{
          uid: "diagram-block",
          string: "diagram-1",
          children: [
            { uid: "vp", string: "viewport:: 100,200,1.25", children: [] },
            {
              uid: "node-1",
              string: "node card-1",
              children: [
                { uid: "pos-1", string: "pos:: 10,20", children: [] },
                { uid: "size-1", string: "size:: 280,160", children: [] },
              ],
            },
            {
              uid: "node-2",
              string: "node card-2",
              children: [
                { uid: "pos-2", string: "pos:: 400,50", children: [] },
                { uid: "size-2", string: "size:: 280,160", children: [] },
              ],
            },
          ],
        }],
      },
    ],
  };
}

function twoNodePageTreeWithEdge() {
  const tree = twoNodePageTree();
  tree.children[1].children[0].children.push({
    uid: "edge-1",
    string: "edge card-1->card-2",
    children: [
      { uid: "kind-1", string: "kind:: straight", children: [] },
      { uid: "label-1", string: "label:: because", children: [] },
    ],
  });
  return tree;
}

function twoNodeLayoutWithEdge(direction = "") {
  return {
    viewport: { x: 100, y: 200, zoom: 1.25 },
    nodes: new Map([
      ["card-1", { pos: { x: 10, y: 20 }, size: { width: 280, height: 160 }, color: "" }],
      ["card-2", { pos: { x: 400, y: 50 }, size: { width: 280, height: 160 }, color: "" }],
    ]),
    edges: [{
      source: "card-1",
      target: "card-2",
      kind: "straight",
      label: "because",
      from: "auto",
      to: "auto",
      direction,
      color: "",
    }],
    sections: new Map(),
  };
}

function installMutableMetadataRoamMock(pageTree) {
  const blocks = new Map();
  const counts = { create: 0, update: 0, delete: 0, deletedUids: [], updated: [] };
  let n = 0;
  const register = (node, parentUid = null) => {
    if (!node?.uid) return;
    const rec = { uid: node.uid, string: node.string ?? "", children: [], parentUid };
    blocks.set(node.uid, rec);
    for (const child of node.children || []) {
      rec.children.push(child.uid);
      register(child, node.uid);
    }
  };
  register(pageTree);
  const toPull = (uid) => {
    const rec = blocks.get(uid);
    if (!rec) return null;
    return {
      uid: rec.uid,
      string: rec.string,
      children: rec.children.map((id) => toPull(id)).filter(Boolean),
    };
  };
  const drop = (uid) => {
    const rec = blocks.get(uid);
    if (!rec) return;
    for (const child of [...rec.children]) drop(child);
    if (rec.parentUid) {
      const parent = blocks.get(rec.parentUid);
      if (parent) parent.children = parent.children.filter((id) => id !== uid);
    }
    blocks.delete(uid);
  };
  globalThis.roamAlphaAPI = {
    util: { generateUID: () => `uid-${++n}` },
    data: {
      q: (query) => (String(query).includes("plexus-diagram/metadata") ? [["meta-page"]] : []),
      pull: (_pattern, ref) => {
        const uid = Array.isArray(ref) ? ref[1] : ref;
        return toPull(uid);
      },
      page: { create: async () => {} },
      block: {
        create: async (opts) => {
          counts.create += 1;
          const uid = opts.block.uid;
          const parentUid = opts.location["parent-uid"];
          blocks.set(uid, { uid, string: opts.block.string, children: [], parentUid });
          const parent = blocks.get(parentUid);
          if (parent) parent.children.push(uid);
        },
        update: async (opts) => {
          counts.update += 1;
          counts.updated.push({ uid: opts.block.uid, string: opts.block.string });
          const rec = blocks.get(opts.block.uid);
          if (rec) rec.string = opts.block.string;
        },
        delete: async (opts) => {
          counts.delete += 1;
          counts.deletedUids.push(opts.block.uid);
          drop(opts.block.uid);
        },
      },
    },
    updateBlock: async () => { counts.updateViewport = (counts.updateViewport || 0) + 1; },
  };
  return { counts, blocks, toPull };
}

test("persistLayout that moves one node does not delete unrelated node children", async () => {
  const { counts, blocks } = installMutableMetadataRoamMock(twoNodePageTree());
  const store = new MetadataStore();
  store.pageUid = "meta-page";
  store.reload();
  store.diagrams.set("diagram-1", twoNodeLayout({ x: 10, y: 20 }));
  store.diagramBlockUids.set("diagram-1", "diagram-block");

  const session = new NativeDiagramSession({
    diagramUid: "diagram-1",
    metadataStore: store,
    settings: { get: () => undefined },
  });
  session.model = { layoutSnapshot: () => twoNodeLayout({ x: 40, y: 20 }) };

  await session.persistLayout();

  for (const uid of ["node-2", "pos-2", "size-2"]) {
    assert.equal(counts.deletedUids.includes(uid), false, `must not delete ${uid}`);
    assert.ok(blocks.has(uid), `must keep ${uid} in the tree`);
  }
  assert.equal(counts.delete, 0);
  assert.equal(counts.create, 0);
  assert.equal(counts.update, 1);
  assert.equal(counts.updated[0].uid, "pos-1");
  assert.equal(counts.updated[0].string, "pos:: 40,20");
  assert.equal(blocks.get("node-2")?.string, "node card-2");
});

test("MetadataStore.set direction-only change creates one child and reverts cleanly", async () => {
  const { counts, blocks } = installMutableMetadataRoamMock(twoNodePageTreeWithEdge());
  const store = new MetadataStore();
  store.pageUid = "meta-page";
  store.reload();
  store.diagrams.set("diagram-1", twoNodeLayoutWithEdge());
  store.diagramBlockUids.set("diagram-1", "diagram-block");

  const wrote = await store.set("diagram-1", twoNodeLayoutWithEdge("twoWay"));
  assert.equal(wrote, true);
  assert.equal(counts.create, 1);
  assert.equal(counts.delete, 0);
  assert.equal(counts.update, 0);
  assert.ok(blocks.has("kind-1"));
  assert.ok(blocks.has("label-1"));
  const directionChild = [...blocks.values()].find((block) => block.string === "direction:: twoWay");
  assert.ok(directionChild);

  counts.create = 0;
  counts.delete = 0;
  counts.update = 0;
  const reverted = await store.set("diagram-1", twoNodeLayoutWithEdge());
  assert.equal(reverted, true);
  assert.equal(counts.create, 0);
  assert.equal(counts.delete, 1);
  assert.equal(counts.update, 0);
  assert.ok(blocks.has("kind-1"));
  assert.ok(blocks.has("label-1"));
  assert.equal([...blocks.values()].some((block) => block.string.startsWith("direction::")), false);
});

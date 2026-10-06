import assert from "node:assert/strict";
import test from "node:test";

import { registerEditorMenus } from "../src/view/editor-menus.js";
import { createItemRenderer } from "../src/view/cards.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const ofType = (stub, target, type) => [...stub.listeners].filter((entry) => entry.target === target && entry.type === type).length;

test("50 menu renderers share one pointerup listener and one animation frame", () => {
  const stub = createDomStub();
  const doc = stub.document;
  const stops = [];
  for (let i = 0; i < 50; i += 1) {
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    stops.push(registerEditorMenus(doc, { root, anchor: () => null }));
  }
  try {
    assert.equal(ofType(stub, doc, "pointerup"), 1);
    stub.dispatch(doc, "pointerup");
    assert.equal(stub.frames.length, 1, "the click starts one frame, not one per renderer");
    let ran = 0;
    for (let i = 0; i < 20; i += 1) {
      const n = stub.flushFrames();
      assert.ok(n <= 1);
      if (!n) break;
      ran += 1;
    }
    assert.equal(ran, 12, "the loop stops after 12 empty frames");
    assert.equal(stub.frames.length, 0);
  } finally {
    for (const stop of stops) stop();
  }
});

test("a disconnected renderer is pruned on pointerup and its anchor is not queried again", () => {
  const stub = createDomStub();
  const doc = stub.document;
  let dead = 0;
  let live = 0;
  const gone = doc.createElement("div");
  const stay = doc.createElement("div");
  doc.body.append(gone, stay);
  const stopGone = registerEditorMenus(doc, { root: gone, anchor() { dead += 1; return null; } });
  const stopStay = registerEditorMenus(doc, { root: stay, anchor() { live += 1; return null; } });
  try {
    gone.remove();
    stub.dispatch(doc, "pointerup");
    assert.equal(dead, 0);
    assert.ok(live >= 1);
    for (let i = 0; i < 20 && stub.flushFrames(); i += 1) { /* drain */ }
    assert.equal(dead, 0);
    const after = dead;
    stub.dispatch(doc, "pointerup");
    for (let i = 0; i < 20 && stub.flushFrames(); i += 1) { /* drain */ }
    assert.equal(dead, after);
  } finally {
    stopGone();
    stopStay();
  }
});

test("roam-plexus events fan out to live renderers and stay one pair on the window", () => {
  const stub = createDomStub();
  const doc = stub.document;
  const win = stub.window;
  const renderers = [];
  const roots = [];
  for (let i = 0; i < 50; i += 1) {
    const root = doc.createElement("div");
    root.className = "pxd-root";
    const items = doc.createElement("div");
    const sections = doc.createElement("div");
    root.append(sections, items);
    doc.body.append(root);
    roots.push(root);
    renderers.push(createItemRenderer({
      doc,
      host: {},
      session: {},
      itemsLayer: items,
      sectionsLayer: sections,
      timers: {},
    }));
  }
  try {
    assert.equal(ofType(stub, doc, "pointerup"), 1);
    assert.equal(ofType(stub, win, "roam-plexus:ready"), 1);
    assert.equal(ofType(stub, win, "roam-plexus:unload"), 1);
    roots[0].remove();
    const hits = [];
    win.RoamPlexus = {
      addEventListener(type) { hits.push(type); },
      removeEventListener() {},
    };
    stub.dispatch(win, "roam-plexus:ready");
    assert.equal(hits.length, 49);
    assert.ok(hits.every((type) => type === "change"));
    assert.equal(ofType(stub, win, "roam-plexus:ready") + ofType(stub, win, "roam-plexus:unload"), 2);
  } finally {
    for (const renderer of renderers) renderer.dispose();
    delete win.RoamPlexus;
    assert.equal(ofType(stub, doc, "pointerup"), 0);
    assert.equal(ofType(stub, win, "roam-plexus:ready"), 0);
    assert.equal(ofType(stub, win, "roam-plexus:unload"), 0);
  }
});

test("a mount that throws after the item renderer leaves no document or window listeners", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const win = stub.window;
  let sawPointer = false;
  let sawReady = false;
  const origDoc = doc.addEventListener;
  const origWin = win.addEventListener;
  doc.addEventListener = function (type, fn, opts) {
    if (type === "pointerup") sawPointer = true;
    return origDoc.call(this, type, fn, opts);
  };
  win.addEventListener = function (type, fn, opts) {
    if (type === "roam-plexus:ready") sawReady = true;
    return origWin.call(this, type, fn, opts);
  };
  const beforeDoc = stub.listenerCount();
  const beforeWin = ofType(stub, win, "roam-plexus:ready") + ofType(stub, win, "roam-plexus:unload");
  const mountEl = doc.createElement("div");
  doc.body.append(mountEl);
  try {
    assert.throws(() => mountBoardView({
      host: { graph: "Svy", stats: {} },
      session: { uid: "board0001", board: { uid: "board0001", items: new Map(), edges: new Map() } },
      mountEl,
      settings: {
        get(key) {
          if (key === "better-tasks") return true;
          if (key === "task-chips") throw new Error("mount blew up");
          return undefined;
        },
      },
      version: "0",
    }), /mount blew up/);
    assert.equal(sawPointer, true);
    assert.equal(sawReady, true);
    assert.equal(stub.listenerCount(), beforeDoc);
    assert.equal(ofType(stub, win, "roam-plexus:ready") + ofType(stub, win, "roam-plexus:unload"), beforeWin);
    assert.equal(ofType(stub, doc, "pointerup"), 0);
  } finally {
    restore();
  }
});

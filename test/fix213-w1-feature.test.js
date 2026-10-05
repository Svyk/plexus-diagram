// 2.13.0 fix W1: feature glue (A4 unload of foreign nodes, D8 failed region write, pinned toast on unload).
import assert from "node:assert/strict";
import test from "node:test";

import { createLifecycle } from "../src/lifecycle.js";
import { installPlexusDiagram } from "../src/feature.js";
import { OUTLINE_TOAST } from "../src/view/region-outline.js";
import { pinAnnotateToast } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const IMAGE = "![](https://example.com/leg.png)";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function install(dom, { acquireSession = () => null, strings = new Map() } = {}) {
  dom.document.head = dom.document.createElement("head");
  const commands = { context: new Map() };
  const extensionAPI = {
    settings: { get: () => null },
    ui: {
      commandPalette: { addCommand: async () => {}, removeCommand: async () => {} },
      blockContextMenu: {
        addCommand: async (config) => { commands.context.set(config.label, config); },
        removeCommand: async () => {},
      },
    },
    platform: { isMobile: () => false },
  };
  const lifecycle = createLifecycle();
  await installPlexusDiagram({
    extensionAPI,
    lifecycle,
    host: { blockString: (uid) => strings.get(uid) ?? null, getFile: async () => null, generateUid: () => "regNEW01", pageUid: () => null },
    acquireSession,
    storage: { getItem: () => null, setItem() {} },
    mountView: () => ({ dispose() {} }),
  });
  return { commands, lifecycle };
}

test("A4: unload strips our classes from a Roam-owned diagram and removes only nodes we made", async () => {
  const dom = createDomStub();
  const restore = dom.install();
  let lifecycle;
  try {
    ({ lifecycle } = await install(dom));
    const foreign = dom.document.createElement("div");
    foreign.className = "rm-diagram pxd-native-hidden";
    const ours = dom.document.createElement("div");
    ours.className = "pxd-mount";
    dom.document.body.append(foreign, ours);
    await lifecycle.dispose();
    lifecycle = null;
    assert.equal(foreign.isConnected, true);
    assert.equal(foreign.className, "rm-diagram");
    assert.equal(ours.isConnected, false);
  } finally {
    await lifecycle?.dispose();
    restore();
  }
});

test("A4/C12: unload within six seconds leaves no pinned toast", async () => {
  const dom = createDomStub();
  const restore = dom.install();
  let lifecycle;
  try {
    ({ lifecycle } = await install(dom));
    pinAnnotateToast(dom.document, dom.window);
    assert.ok(dom.document.body.querySelector(".pxd-toast--pin"));
    await lifecycle.dispose();
    lifecycle = null;
    assert.equal(dom.document.body.querySelector(".pxd-toast--pin"), null);
  } finally {
    await lifecycle?.dispose();
    restore();
  }
});

test("D8: a failed region write toasts the failure and copies nothing", async () => {
  const dom = createDomStub();
  const restore = dom.install();
  const clips = [];
  const hadNav = globalThis.navigator != null;
  const prevClip = hadNav ? Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard") : null;
  if (!hadNav) Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: {} });
  Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, writable: true, value: { writeText: (t) => { clips.push(t); return Promise.resolve(); } } });
  let lifecycle;
  try {
    const container = dom.document.createElement("div");
    container.className = "roam-block-container";
    container.setAttribute("data-block-uid", "imgBlock1");
    const img = dom.document.createElement("img");
    img.className = "rm-inline-img";
    const box = { x: 40, y: 80, left: 40, top: 80, width: 200, height: 100, right: 240, bottom: 180 };
    img._rect = box;
    container.append(img);
    dom.document.body.append(container);
    let released = 0;
    let commands;
    ({ lifecycle, commands } = await install(dom, {
      acquireSession: () => ({ addImageRegion: () => Promise.reject(new Error("write failed")), release: () => { released += 1; } }),
    }));
    commands.context.get("Plexus: Mark image region").callback({ "block-uid": "imgBlock1", "block-string": IMAGE });
    const root = dom.document.querySelector(".pxd-root");
    root._rect = box;
    dom.dispatch(root.querySelector(".pxd-region-layer"), "pointerdown", { clientX: 90, clientY: 105, button: 0 });
    dom.dispatch(dom.document, "pointermove", { clientX: 130, clientY: 130 });
    dom.dispatch(dom.document, "pointerup", { clientX: 130, clientY: 130 });
    root.querySelector(".pxd-region-confirm").click();
    await tick();
    assert.equal(dom.document.querySelector(".pxd-outline-toast").textContent, OUTLINE_TOAST.failed);
    assert.deepEqual(clips, []);
    assert.equal(released, 1);
  } finally {
    await lifecycle?.dispose();
    if (prevClip) Object.defineProperty(globalThis.navigator, "clipboard", prevClip);
    else delete globalThis.navigator.clipboard;
    if (!hadNav) delete globalThis.navigator;
    restore();
  }
});

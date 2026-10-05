// REG-3 and REG-4: the menu and the button scan call the shipped outline and crop.
import assert from "node:assert/strict";
import test from "node:test";

import { createLifecycle } from "../src/lifecycle.js";
import { installPlexusDiagram } from "../src/feature.js";
import { OUTLINE_TOAST } from "../src/view/region-outline.js";
import { resetCropUrls } from "../src/view/region-crop.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const REGION = "{{[[plexus-region]]: k=img d=imgBlock1 f=0.25,0.3,0.2,0.25}} hamstring";
const IMAGE = "![](https://example.com/leg.png)";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Node 20 on CI has no navigator. Node 22 has one, and clipboard is getter-only.
function stubClipboard(writeText) {
  const hadNav = globalThis.navigator != null;
  const prevNav = hadNav ? null : Object.getOwnPropertyDescriptor(globalThis, "navigator");
  if (!hadNav) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: {} });
  }
  const prevClip = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: { writeText },
  });
  return () => {
    if (prevClip) Object.defineProperty(globalThis.navigator, "clipboard", prevClip);
    else delete globalThis.navigator.clipboard;
    if (!hadNav) {
      if (prevNav) Object.defineProperty(globalThis, "navigator", prevNav);
      else delete globalThis.navigator;
    }
  };
}

function rect(x, y, width, height) {
  return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height };
}

function at(box, px, py) {
  return [box.x + box.width * px, box.y + box.height * py];
}

async function install(dom, { strings, getFile, acquireSession, generateUid = () => "regNEW01" }) {
  dom.document.head = dom.document.createElement("head");
  const commands = { palette: new Map(), context: new Map() };
  const extensionAPI = {
    settings: { get: () => null },
    ui: {
      commandPalette: {
        addCommand: async (config) => { commands.palette.set(config.label, config); },
        removeCommand: async ({ label }) => { commands.palette.delete(label); },
      },
      blockContextMenu: {
        addCommand: async (config) => { commands.context.set(config.label, config); },
        removeCommand: async ({ label }) => { commands.context.delete(label); },
      },
    },
    platform: { isMobile: () => false },
  };
  const host = {
    blockString: (uid) => strings.get(uid) ?? null,
    getFile,
    generateUid,
    pageUid: () => null,
  };
  const storage = { getItem: () => null, setItem() {} };
  const lifecycle = createLifecycle();
  await installPlexusDiagram({
    extensionAPI,
    lifecycle,
    host,
    acquireSession,
    storage,
    mountView: () => ({ dispose() {} }),
  });
  return { commands, lifecycle, host };
}

test("REG-3: Mark image region confirms on the image block and keeps two palette commands", async () => {
  const dom = createDomStub();
  const restore = dom.install();
  const calls = [];
  const clips = [];
  const restoreClip = stubClipboard((text) => { clips.push(text); return Promise.resolve(); });
  const box = rect(40, 80, 200, 100);
  const container = dom.document.createElement("div");
  container.className = "roam-block-container";
  container.setAttribute("data-block-uid", "imgBlock1");
  const img = dom.document.createElement("img");
  img.className = "rm-inline-img";
  img._rect = box;
  container.append(img);
  dom.document.body.append(container);
  const acquireSession = (uid) => {
    calls.push(["acquire", uid]);
    return {
      addImageRegion: (cardUid, frac, caption, regionUid) => {
        calls.push(["write", cardUid, frac, caption, regionUid, clips.slice()]);
        return Promise.resolve(regionUid);
      },
      release: () => { calls.push(["release"]); },
    };
  };
  let lifecycle;
  try {
    const installed = await install(dom, {
      strings: new Map([["imgBlock1", IMAGE]]),
      getFile: async () => null,
      acquireSession,
    });
    lifecycle = installed.lifecycle;
    const { commands } = installed;
    assert.deepEqual([...commands.palette.keys()], ["Plexus: Commands…", "Plexus: New whiteboard here"]);
    const mark = commands.context.get("Plexus: Mark image region");
    assert.equal(mark["display-conditional"]({ "block-string": IMAGE }), true);
    assert.equal(mark["display-conditional"]({ "block-string": "a note" }), false);
    mark.callback({ "block-uid": "imgBlock1", "block-string": "a note" });
    assert.equal(calls.length, 0);
    assert.equal(dom.document.querySelector(".pxd-outline-toast").textContent, OUTLINE_TOAST.notImage);
    dom.document.querySelector(".pxd-outline-toast").remove();

    mark.callback({ "block-uid": "missing00", "block-string": IMAGE });
    assert.equal(calls.length, 0);
    assert.equal(dom.document.querySelector(".pxd-outline-toast").textContent, OUTLINE_TOAST.ready);
    dom.document.querySelector(".pxd-outline-toast").remove();

    mark.callback({ "block-uid": "imgBlock1", "block-string": IMAGE });
    const root = dom.document.querySelector(".pxd-root");
    assert.equal(root.style.position, "fixed");
    assert.equal(root.style.left, "40px");
    assert.equal(root.style.width, "200px");
    assert.equal(root.style.overflow, "visible");
    root._rect = box;
    const [x0, y0] = at(box, 0.25, 0.3);
    const [x1, y1] = at(box, 0.45, 0.55);
    const layer = root.querySelector(".pxd-region-layer");
    dom.dispatch(layer, "pointerdown", { clientX: x0, clientY: y0, button: 0 });
    dom.dispatch(dom.document, "pointermove", { clientX: x1, clientY: y1 });
    dom.dispatch(dom.document, "pointerup", { clientX: x1, clientY: y1 });
    root.querySelector(".pxd-region-caption").value = "hamstring";
    root.querySelector(".pxd-region-confirm").click();
    assert.equal(dom.document.querySelector(".pxd-outline-toast"), null, "no toast before the write has a result");
    assert.deepEqual(clips, [], "nothing is copied before the write has a result");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(calls, [
      ["acquire", "imgBlock1"],
      ["write", "imgBlock1", { rx: 0.25, ry: 0.3, rw: 0.2, rh: 0.25 }, "hamstring", "regNEW01", []],
      ["release"],
    ]);
    assert.deepEqual(clips, ["((regNEW01))"]);
    assert.equal(dom.document.querySelector(".pxd-root"), null);
    assert.equal(dom.document.querySelector(".pxd-outline-toast").textContent, OUTLINE_TOAST.copied);
    await lifecycle.dispose();
    lifecycle = null;
    assert.equal(dom.document.querySelector(".pxd-outline-toast"), null);
    assert.equal(dom.document.querySelector(".pxd-root"), null);
    assert.equal(commands.palette.size, 0);
    assert.equal(commands.context.size, 0);
  } finally {
    await lifecycle?.dispose();
    restoreClip();
    restore();
  }
});

test("REG-4: install claims the ref button before the file returns, and unload restores it", async () => {
  const dom = createDomStub();
  const restore = dom.install();
  const prevCreate = URL.createObjectURL;
  const prevRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:crop";
  URL.revokeObjectURL = () => {};
  resetCropUrls();
  const container = dom.document.createElement("div");
  container.className = "roam-block-container";
  container.setAttribute("data-block-uid", "refBlock1");
  const ref = dom.document.createElement("span");
  ref.className = "rm-block-ref";
  ref.setAttribute("data-uid", "region001");
  const button = dom.document.createElement("button");
  button.className = "bp3-button rm-xparser-default-plexus-region";
  button.textContent = "plexus-region";
  ref.append(button);
  container.append(ref);
  const portal = dom.document.createElement("div");
  portal.className = "bp3-portal";
  const side = dom.document.createElement("div");
  side.className = "roam-block-container";
  side.setAttribute("data-block-uid", "sideBlock");
  const sideRef = dom.document.createElement("span");
  sideRef.className = "rm-block-ref";
  sideRef.setAttribute("data-uid", "region001");
  const sideButton = dom.document.createElement("button");
  sideButton.className = "rm-xparser-default-plexus-region";
  sideButton.textContent = "plexus-region";
  sideRef.append(sideButton);
  side.append(sideRef);
  portal.append(side);
  const theirs = dom.document.createElement("button");
  theirs.className = "rm-xparser-default-plexus-region";
  theirs.setAttribute("data-plexus-owner", "roam-plexus");
  theirs.textContent = "plexus-region";
  dom.document.body.append(container, portal, theirs);

  let releaseFile;
  const pending = new Promise((resolve) => { releaseFile = resolve; });
  const reads = [];
  let lifecycle;
  try {
    const installed = await install(dom, {
      strings: new Map([
        ["region001", REGION],
        ["refBlock1", "((region001))"],
        ["imgBlock1", IMAGE],
      ]),
      getFile: (url) => { reads.push(url); return pending; },
      acquireSession: () => { throw new Error("scan must not open a session"); },
    });
    lifecycle = installed.lifecycle;
    await tick();
    assert.equal(button.getAttribute("data-plexus-owner"), "plexus-diagram");
    assert.equal(button.style.display, "none");
    assert.equal(sideButton.getAttribute("data-plexus-owner"), "plexus-diagram");
    assert.equal(theirs.getAttribute("data-plexus-owner"), "roam-plexus");
    assert.notEqual(theirs.style.display, "none");
    assert.equal(dom.document.querySelector(".pxd-region-crop"), null);
    assert.deepEqual(reads, ["https://example.com/leg.png", "https://example.com/leg.png"]);
    releaseFile(new Blob(["png"], { type: "image/png" }));
    await pending;
    await tick();
    const crops = dom.document.querySelectorAll(".pxd-region-crop");
    assert.equal(crops.length, 2);
    for (const crop of crops) {
      assert.equal(crop.querySelector(".pxd-region-crop__caption").textContent, "hamstring");
    }
    const img = crops[0].querySelector(".pxd-region-crop__img");
    img.naturalWidth = 1600;
    img.naturalHeight = 1000;
    dom.dispatch(img, "load", {});
    assert.equal(crops[0].querySelector(".pxd-region-crop__frame").style.height, "160px");
    await lifecycle.dispose();
    lifecycle = null;
    assert.equal(button.style.display, "");
    assert.equal(button.getAttribute("data-plexus-owner"), null);
    assert.equal(button.textContent, "plexus-region");
    assert.equal(sideButton.style.display, "");
    assert.equal(dom.document.querySelectorAll(".pxd-region-crop").length, 0);
    assert.equal(dom.pxdNodes().filter((node) => String(node.className).includes("pxd-region")).length, 0);
  } finally {
    await lifecycle?.dispose();
    resetCropUrls();
    if (prevCreate) URL.createObjectURL = prevCreate; else delete URL.createObjectURL;
    if (prevRevoke) URL.revokeObjectURL = prevRevoke; else delete URL.revokeObjectURL;
    restore();
  }
});

test("REG-4: a failed file shows the caption and image unavailable", async () => {
  const dom = createDomStub();
  const restore = dom.install();
  const button = dom.document.createElement("button");
  button.className = "rm-xparser-default-plexus-region";
  button.textContent = "plexus-region";
  const container = dom.document.createElement("div");
  container.className = "roam-block-container";
  container.setAttribute("data-block-uid", "region001");
  container.append(button);
  dom.document.body.append(container);
  let lifecycle;
  try {
    const installed = await install(dom, {
      strings: new Map([["region001", REGION], ["imgBlock1", IMAGE]]),
      getFile: async () => null,
      acquireSession: () => null,
    });
    lifecycle = installed.lifecycle;
    await tick();
    const crop = dom.document.querySelector(".pxd-region-crop");
    assert.equal(crop.querySelector(".pxd-region-crop__caption").textContent, "hamstring");
    assert.equal(crop.querySelector(".pxd-region-crop__missing").textContent, "image unavailable");
    assert.equal(button.style.display, "none");
    await lifecycle.dispose();
    lifecycle = null;
    assert.equal(button.style.display, "");
    assert.equal(button.textContent, "plexus-region");
  } finally {
    await lifecycle?.dispose();
    restore();
  }
});

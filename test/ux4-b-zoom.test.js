// UX4 lane B6: zoom-in from overview to detail on a big board. A page card's body stayed empty until the content
// pass mounted it (seconds on MAIN, after the wheel burst settles). It now shows its last rows as plain text from the
// tier flip, and the mount replaces them in one task.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { UNMOUNT_GRACE_MS } from "../src/view/offscreen.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { noteSpeedFlags } from "../src/settings.js";

const outline = (title) => ({
  uid: `uid-${title}`,
  exists: true,
  blocks: [
    { uid: "rowA00001", string: "**type:** #Concept", children: [] },
    { uid: "rowB00001", string: "Cronobacter is the flagship pathogen for [[PIF]]", children: [
      { uid: "rowC00001", string: "child row", children: [] },
    ] },
  ],
});

const withClock = (fn) => {
  const real = Object.getOwnPropertyDescriptor(globalThis, "performance");
  const clock = { t: 1000 };
  const base = globalThis.performance;
  const t0 = base.now();
  Object.defineProperty(globalThis, "performance", { value: { now: () => clock.t + (base.now() - t0) }, configurable: true, writable: true });
  return Promise.resolve().then(() => fn(clock)).finally(() => Object.defineProperty(globalThis, "performance", real));
};

function renderer(flags) {
  noteSpeedFlags(flags);
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  root.append(sectionsLayer, itemsLayer);
  doc.body.append(root);
  const idleQueue = [];
  const laters = [];
  let roamRoots = 0;
  const host = {
    renderString(node, string) { roamRoots += 1; node.textContent = string; },
    renderBlock(node) { node.textContent = "x"; },
    unmount() {},
    blockString: () => "",
    pullTree: () => [],
    pageUid: (t) => `uid-${t}`,
    watchPage: () => () => {},
    pageOutline: outline,
    pagePreview: outline,
  };
  const r = createItemRenderer({
    doc, host, session: {}, itemsLayer, sectionsLayer,
    timers: {
      idle(fn) { idleQueue.push(fn); return () => {}; },
      later(fn, ms) { const rec = { fn, ms, off: false }; laters.push(rec); return () => { rec.off = true; }; },
      bgRun() { return () => {}; },
    },
  });
  const flush = () => { let guard = 0; while (idleQueue.length && guard++ < 50) idleQueue.shift()({ timeRemaining: () => 10 }); };
  const done = () => { restore(); noteSpeedFlags(null); };
  return { r, laters, flush, done, itemsLayer, roamRoots: () => roamRoots };
}

const board = buildBoard({
  ":block/uid": "boardz0001", ":block/string": "{{[[diagram]]:Z}}", ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": [{ ":block/uid": "cardPG001", ":block/string": "[[Cronobacter]]", ":block/order": 0, ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 260, ":h": 240 } }, ":block/children": [] }],
});
const wide = { x: -100, y: -100, w: 4000, h: 3000 };

async function zoomTrip(flags) {
  return withClock((clock) => {
    const t = renderer(flags);
    t.r.sync({ board, rects: worldRects(board), structural: true });
    t.r.setLod("detail", 1);
    t.r.scheduleContent({ visibleRect: wide, zoom: 1, tier: "detail" });
    t.flush();
    const body = t.itemsLayer.querySelector("[data-uid=cardPG001] .pxd-item__body");
    assert.match(body.textContent, /flagship pathogen/, "mounted at detail");
    t.r.setLod("overview", 0.08);
    t.r.scheduleContent({ visibleRect: wide, zoom: 0.08, tier: "overview" });
    clock.t += UNMOUNT_GRACE_MS + 100;
    for (const rec of t.laters.filter((x) => x.ms === UNMOUNT_GRACE_MS && !x.off)) rec.fn();
    assert.equal(body.textContent.trim(), "", "the overview tier unmounts the page body");
    const roots = t.roamRoots();
    // The flip to detail. The content pass waits for the wheel burst to settle.
    t.r.setLod("detail", 1);
    return { t, body, roots };
  });
}

test("B6: zooming back in, a page card shows its last rows (plain, no Roam roots) from the tier flip; the mount replaces them", async () => {
  const { t, body, roots } = await zoomTrip(null);
  try {
    const preview = body.querySelector(".pxd-item__page--preview");
    assert.ok(preview, "rows on the first detail frame, not an empty box");
    assert.match(preview.textContent, /flagship pathogen/);
    assert.match(preview.textContent, /child row/);
    assert.equal(preview.querySelector("[data-pxd-row]"), null, "preview rows are not arrow targets");
    assert.equal(t.roamRoots(), roots, "the preview mounts no Roam root");
    t.r.scheduleContent({ visibleRect: wide, zoom: 1, tier: "detail" });
    t.flush();
    assert.equal(body.querySelector(".pxd-item__page--preview"), null, "the mount replaces the preview");
    assert.match(body.textContent, /flagship pathogen/);
  } finally {
    t.done();
  }
});

test("B6: steadyRows off keeps the 3.35.0 empty body until the content pass", async () => {
  const { t, body } = await zoomTrip({ steadyRows: false });
  try {
    assert.equal(body.querySelector(".pxd-item__page--preview"), null);
    assert.equal(body.textContent.trim(), "");
  } finally {
    t.done();
  }
});

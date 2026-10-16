// R4 (bucketLayers): on a big board the shell, edge and label layers hold their children in buckets, so a mid-list
// attach or detach restyles one bucket. Roam's Tailwind `~` rules restyle every later sibling of a changed child
// (headless Chromium with Roam's CSS, 1,560-card fixture: a mid-list edge 83 ms, in buckets of 64: 19 ms).
import assert from "node:assert/strict";
import test from "node:test";

import { BUCKET_SIZE, createBucketHost } from "../src/view/buckets.js";
import { mountBig, zoomBurst, settledIn } from "./fixtures/big-mount.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const kids = (el) => [...(el?.children || [])];
const isBucket = (el) => String(el?.getAttribute?.("class") || el?.className || "").split(/\s+/).includes("pxd-bucket");

function layerShape(layer, itemClass) {
  const direct = kids(layer).filter((el) => !isBucket(el) && String(el.className || el.getAttribute?.("class") || "").includes(itemClass));
  const buckets = kids(layer).filter(isBucket);
  return { direct: direct.length, buckets: buckets.length, max: Math.max(0, ...buckets.map((b) => kids(b).length)) };
}

function shellOrder(m) {
  return [...m.view.root.querySelectorAll(".pxd-items .pxd-item")].map((el) => el.getAttribute("data-uid"));
}

test("R4: a big board puts shells, edges and labels in buckets, in board order", async () => {
  const m = mountBig({ x: 40, y: 40, zoom: 0.3 });
  try {
    await settledIn(m);
    const root = m.view.root;
    const items = layerShape(root.querySelector(".pxd-items"), "pxd-item");
    assert.equal(items.direct, 0, "no shell is a direct child of the items layer");
    assert.ok(items.buckets > 1 && items.max <= BUCKET_SIZE * 2, JSON.stringify(items));
    const edges = layerShape(root.querySelector("svg.pxd-edges"), "pxd-edge");
    assert.equal(edges.direct, 0, JSON.stringify(edges));
    assert.ok(edges.buckets >= 1 && edges.max <= BUCKET_SIZE * 2, JSON.stringify(edges));
    const labels = layerShape(root.querySelector(".pxd-labels"), "pxd-label");
    assert.equal(labels.direct, 0, JSON.stringify(labels));
    const order = shellOrder(m);
    const rank = new Map(m.board.order.map((u, i) => [u, i]));
    for (let i = 1; i < order.length; i += 1) assert.ok(rank.get(order[i - 1]) < rank.get(order[i]), `DOM order breaks at ${order[i - 1]} / ${order[i]}`);
    // A zoom in and back out attaches and detaches mid-list; order and bucket bounds hold.
    await zoomBurst(m, -1, 8);
    await zoomBurst(m, 1, 8);
    await settledIn(m);
    const after = shellOrder(m);
    for (let i = 1; i < after.length; i += 1) assert.ok(rank.get(after[i - 1]) < rank.get(after[i]), `DOM order after zoom breaks at ${after[i - 1]}`);
    const again = layerShape(root.querySelector(".pxd-items"), "pxd-item");
    assert.equal(again.direct, 0);
    assert.ok(again.max <= BUCKET_SIZE * 2, JSON.stringify(again));
  } finally {
    m.done();
  }
});

test("R4: bucketLayers off keeps shells and edges as direct children (3.34.0 layout)", async () => {
  const m = mountBig({ x: 40, y: 40, zoom: 0.3 }, { flags: { bucketLayers: false } });
  try {
    await settledIn(m);
    const root = m.view.root;
    const items = layerShape(root.querySelector(".pxd-items"), "pxd-item");
    assert.equal(items.buckets, 0, JSON.stringify(items));
    assert.ok(items.direct > 0);
    assert.equal(layerShape(root.querySelector("svg.pxd-edges"), "pxd-edge").buckets, 0);
  } finally {
    m.done();
  }
});

test("R4: a bucket host inserts before a child in another bucket and splits a bucket past twice the size", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const layer = stub.document.createElement("div");
    const host = createBucketHost(layer, { doc: stub.document, size: 4 });
    const els = Array.from({ length: 10 }, (_, i) => { const e = stub.document.createElement("div"); e.id = `e${i}`; return e; });
    host.appendAll(els);
    assert.deepEqual(kids(layer).map((b) => kids(b).length), [4, 4, 2]);
    const extra = Array.from({ length: 5 }, (_, i) => { const e = stub.document.createElement("div"); e.id = `x${i}`; return e; });
    for (const e of extra) host.insertBefore(e, els[1]);
    const flat = kids(layer).flatMap((b) => kids(b).map((e) => e.id));
    assert.deepEqual(flat, ["e0", "x0", "x1", "x2", "x3", "x4", "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9"]);
    assert.ok(kids(layer).every((b) => kids(b).length <= 8), JSON.stringify(kids(layer).map((b) => kids(b).length)));
    assert.equal(host.has(els[5]), true);
    els[5].remove();
    assert.equal(host.has(els[5]), false);
  } finally {
    restore();
  }
});

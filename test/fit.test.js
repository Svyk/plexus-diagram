import assert from "node:assert/strict";
import test from "node:test";

import {
  DiagramModel,
  fitViewport,
  flooredCardSize,
  importNativeLayout,
  parsePullResult,
  viewportNeedsFit,
} from "../src/model.js";
import { isZoomedDiagramPage } from "../src/view.js";

function nativeTree({ width, height, viewport } = {}) {
  return parsePullResult({
    ":block/uid": "1IIx5sG4L",
    ":block/string": "{{[[diagram]]}}",
    ":block/props": viewport ? { ":rf-diagram": { ":viewport": viewport } } : {},
    ":block/children": [{ ":block/uid": "NPwuc_Rm8", ":block/string": "Test of this", ":block/order": 0 }],
    ":diagram/nodes": [{
      ":block/uid": "node-1",
      ":diagram.node/data": { position: { x: 240, y: 72 }, width, height },
      ":diagram.node/block": { ":block/uid": "NPwuc_Rm8" },
    }],
    ":diagram/edges": [],
  });
}

test("importNativeLayout floors tiny native node sizes up to the defaults", () => {
  const imported = importNativeLayout(nativeTree({ width: 165, height: 83 }), null, { width: 280, height: 160 });
  assert.deepEqual(imported.nodes.get("NPwuc_Rm8").size, { width: 280, height: 160 });
  assert.deepEqual(imported.nodes.get("NPwuc_Rm8").pos, { x: 240, y: 72 });
});

test("importNativeLayout keeps native sizes that already meet the 240x140 floor", () => {
  const imported = importNativeLayout(nativeTree({ width: 300, height: 180 }), null, { width: 280, height: 160 });
  assert.deepEqual(imported.nodes.get("NPwuc_Rm8").size, { width: 300, height: 180 });
});

test("flooredCardSize floors each axis independently and tolerates missing values", () => {
  assert.deepEqual(flooredCardSize(250, 83), { width: 250, height: 160 });
  assert.deepEqual(flooredCardSize(undefined, undefined), { width: 280, height: 160 });
  assert.deepEqual(flooredCardSize("nope", 200), { width: 280, height: 200 });
});

test("viewportNeedsFit rejects the live zoomed-out native viewport", () => {
  const nodes = new Map([["NPwuc_Rm8", { pos: { x: 240, y: 72 }, size: { width: 165, height: 83 } }]]);
  assert.equal(viewportNeedsFit({ x: 228.149, y: 185.372, zoom: 0.432563 }, nodes, { width: 662, height: 629 }), true);
});

test("viewportNeedsFit rejects zoom below 0.7 even with floored cards", () => {
  const nodes = new Map([["a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 } }]]);
  assert.equal(viewportNeedsFit({ x: 0, y: 0, zoom: 0.6 }, nodes, { width: 660, height: 630 }), true);
});

test("viewportNeedsFit rejects viewports that paint a card under 140px on either axis", () => {
  const nodes = new Map([["a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 } }]]);
  assert.equal(viewportNeedsFit({ x: 0, y: 0, zoom: 0.8 }, nodes, { width: 660, height: 630 }), true);
  assert.equal(viewportNeedsFit({ x: 0, y: 0, zoom: 0.9 }, nodes, { width: 660, height: 630 }), false);
});

test("viewportNeedsFit rejects a viewport where every card is off-screen", () => {
  const nodes = new Map([["a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 } }]]);
  assert.equal(viewportNeedsFit({ x: -2000, y: -2000, zoom: 1 }, nodes, { width: 660, height: 630 }), true);
  assert.equal(viewportNeedsFit({ x: 10, y: 10, zoom: 1 }, nodes, { width: 660, height: 630 }), false);
});

test("viewportNeedsFit accepts a sane viewport on an empty board and rejects a missing one", () => {
  assert.equal(viewportNeedsFit({ x: 0, y: 0, zoom: 1 }, new Map(), { width: 660, height: 630 }), false);
  assert.equal(viewportNeedsFit(null, new Map(), { width: 660, height: 630 }), true);
  assert.equal(viewportNeedsFit({ x: 0, y: 0, zoom: Number.NaN }, new Map()), true);
});

test("fitViewport makes a single 280x160 card large and centred in a 660x630 view", () => {
  const nodes = new Map([["a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 } }]]);
  const viewport = fitViewport(nodes, { width: 660, height: 630 });
  assert.ok(viewport.zoom >= 1, `zoom ${viewport.zoom} should be >= 1`);
  assert.ok(viewport.zoom <= 2, `zoom ${viewport.zoom} should stay readable`);
  const left = 0 * viewport.zoom + viewport.x;
  const right = 280 * viewport.zoom + viewport.x;
  const top = 0 * viewport.zoom + viewport.y;
  const bottom = 160 * viewport.zoom + viewport.y;
  assert.ok(Math.abs((left + right) / 2 - 330) < 0.001, "horizontally centred");
  assert.ok(Math.abs((top + bottom) / 2 - 315) < 0.001, "vertically centred");
  assert.ok(right - left >= 280, "card is painted at least at native size");
  assert.equal(viewportNeedsFit(viewport, nodes, { width: 660, height: 630 }), false);
});

test("fitViewport fits many cards inside the padded view", () => {
  const nodes = new Map();
  for (let i = 0; i < 12; i += 1) {
    nodes.set(`c${i}`, { pos: { x: (i % 4) * 320, y: Math.floor(i / 4) * 200 }, size: { width: 280, height: 160 } });
  }
  const viewport = fitViewport(nodes, { width: 1400, height: 900 }, { padding: 48 });
  const bounds = { minX: 0, minY: 0, maxX: 3 * 320 + 280, maxY: 2 * 200 + 160 };
  assert.ok(bounds.minX * viewport.zoom + viewport.x >= 48 - 0.001);
  assert.ok(bounds.maxX * viewport.zoom + viewport.x <= 1400 - 48 + 0.001);
  assert.ok(bounds.maxY * viewport.zoom + viewport.y <= 900 - 48 + 0.001);
});

test("fitViewport on an empty board resets to 1:1", () => {
  assert.deepEqual(fitViewport(new Map(), { width: 660, height: 630 }), { x: 48, y: 48, zoom: 1 });
});

test("DiagramModel prefers the overlay's metadata viewport over the native one", () => {
  const tree = nativeTree({ width: 165, height: 83, viewport: { ":x": 228, ":y": 185, ":zoom": 0.43 } });
  const withMetadata = new DiagramModel({
    diagramUid: tree.uid,
    tree,
    metadataLayout: { viewport: { x: 120, y: 195, zoom: 1.5 }, nodes: new Map(), edges: [], sections: new Map() },
  });
  assert.deepEqual(withMetadata.viewport, { x: 120, y: 195, zoom: 1.5 });
  assert.equal(withMetadata.viewportSource, "metadata");
  const nativeOnly = new DiagramModel({ diagramUid: tree.uid, tree, metadataLayout: null });
  assert.equal(nativeOnly.viewportSource, "native");
  assert.equal(nativeOnly.needsFit({ width: 662, height: 629 }), true);
  nativeOnly.fitTo({ width: 662, height: 629 });
  assert.equal(nativeOnly.viewportSource, "fit");
  assert.equal(nativeOnly.needsFit({ width: 662, height: 629 }), false);
});

test("applyPull refreshes content but keeps in-memory layout and viewport", () => {
  const tree = nativeTree({ width: 165, height: 83, viewport: { ":x": 228, ":y": 185, ":zoom": 0.43 } });
  const model = new DiagramModel({ diagramUid: tree.uid, tree, metadataLayout: null });
  model.fitTo({ width: 662, height: 629 });
  model.setNodePosition("NPwuc_Rm8", { x: 999, y: 111 });
  model.setNodeSize("NPwuc_Rm8", { width: 100, height: 50 });
  model.addEdge("NPwuc_Rm8", "NPwuc_Rm8", "elbow");
  const fitted = { ...model.viewport };
  const pulled = parsePullResult({
    ":block/uid": "1IIx5sG4L",
    ":block/string": "{{[[diagram]]}}",
    ":block/props": { ":rf-diagram": { ":viewport": { ":x": 0, ":y": 0, ":zoom": 0.3 } } },
    ":block/children": [
      { ":block/uid": "NPwuc_Rm8", ":block/string": "Test of this, edited", ":block/order": 0 },
      { ":block/uid": "new-card", ":block/string": "Second", ":block/order": 1 },
    ],
    ":diagram/nodes": [],
    ":diagram/edges": [],
  });
  model.applyPull(pulled, { viewport: { x: 5, y: 5, zoom: 0.5 }, nodes: new Map([["NPwuc_Rm8", { pos: { x: 1, y: 1 }, size: { width: 280, height: 160 }, color: "" }]]), edges: [], sections: new Map() });
  assert.equal(model.getCard("NPwuc_Rm8").string, "Test of this, edited");
  assert.equal(model.children.length, 2);
  assert.deepEqual(model.viewport, fitted);
  assert.deepEqual(model.nodes.get("NPwuc_Rm8").pos, { x: 999, y: 111 });
  assert.deepEqual(model.nodes.get("NPwuc_Rm8").size, { width: 240, height: 140 });
  assert.equal(model.edges.length, 1);
});

test("isZoomedDiagramPage is true for the hash page uid or a zoom wrapper, not inline embeds", () => {
  const inline = { closest: () => null };
  const wrapped = { closest: (selector) => (selector === ".rm-zoom-block-wrapper" ? {} : null) };
  assert.equal(isZoomedDiagramPage(inline, "1IIx5sG4L", "#/app/Svy/page/1IIx5sG4L"), true);
  assert.equal(isZoomedDiagramPage(inline, "1IIx5sG4L", "#/app/Svy/page/08-28-2026"), false);
  assert.equal(isZoomedDiagramPage(inline, "1IIx5sG4L", "#/app/Svy"), false);
  assert.equal(isZoomedDiagramPage(wrapped, "1IIx5sG4L", "#/app/Svy"), true);
});

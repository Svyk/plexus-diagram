import assert from "node:assert/strict";
import test from "node:test";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test("a fit view wanting more bodies than the LRU cap settles instead of mounting and evicting forever", async () => {
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  const children = Array.from({ length: 400 }, (_, i) => ({
    ":block/uid": `img${String(i).padStart(6, "0")}`,
    ":block/string": `![](https://example.test/${i}.png)`,
    ":block/order": i,
    ":block/props": { ":plexus": { ":x": (i % 20) * 260, ":y": Math.floor(i / 20) * 200, ":w": 240, ":h": 180 } },
    ":block/children": [],
  }));
  const raw = { ":block/uid": "board0001", ":block/string": "{{[[diagram]]:Big}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": children };
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 0.25 }));
  const board = buildBoard(raw);
  const calls = { renderString: 0, unmount: 0 };
  const host = {
    stats: {}, graph: "Svy",
    renderString(el, string) { calls.renderString += 1; el.textContent = string; },
    renderBlock(el, uid) { el.textContent = uid; },
    unmount() { calls.unmount += 1; },
    pagePreview: () => ({ exists: false, blocks: [] }), pullTree: () => [], blockString: () => null,
    openBlock() {}, openInSidebar() {}, searchPages: () => [], searchBlocks: () => [], related: () => [],
  };
  const session = { uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), on() { return () => {}; }, release() {}, setLinkMode() {} };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0" });
  try {
    const pump = async (n) => { for (let i = 0; i < n; i += 1) { stub.flushFrames(); stub.flushIdle(); await tick(); } };
    await pump(120);
    const settled = { ...calls };
    await pump(120);
    assert.ok(settled.renderString > 0, "bodies mounted");
    assert.ok(settled.renderString <= 100, `mounted at most the cap, got ${settled.renderString}`);
    assert.equal(calls.renderString, settled.renderString, "no more mounts once settled");
    assert.equal(calls.unmount, settled.unmount, "no more unmounts once settled");
  } finally {
    view.dispose();
    restore();
  }
});

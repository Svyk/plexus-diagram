// B2. A loaded cover must not repaint PDF shells whose body is not on screen.
// Overview hides the body. A detached shell and a shell outside the attach rect stay put.
// The highlight count is its own part, after the paint parts.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { resetSharedBgBudget } from "../src/bg-budget.js";
import { COVER_LS_KEY } from "../src/host/cover-store.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { rectsIntersect, visibleWorldRect } from "../src/model/geometry.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createCoverRepaintJob, mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const PDF_URL = "https://example.test/paper.pdf";
const PDF = `{{[[pdf]]: ${PDF_URL}}}`;
const SIZE = { width: 800, height: 600 };
const DATA = "data:image/png;base64,aaaa";

const blk = (uid, string, plexus, order) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {},
  ":block/children": [],
});

const rawBoard = (children) => ({
  ":block/uid": "cvboard01",
  ":block/string": "{{[[diagram]]:Covers}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": children,
});

function camCenter(vp) {
  return {
    x: (SIZE.width / 2 - vp.x) / vp.zoom,
    y: (SIZE.height / 2 - vp.y) / vp.zoom,
  };
}

// 420 notes far from the camera, plus three PDF cards that share one cover url.
// `edge` sits inside the attach rect but farther from the camera than the near notes.
function coverBoard(vp) {
  const center = camCenter(vp);
  const attach = visibleWorldRect(vp, SIZE, 0.35);
  const children = [];
  for (let i = 0; i < 380; i += 1) {
    const col = i % 20;
    const row = Math.floor(i / 20);
    children.push(blk(
      `far${String(i).padStart(4, "0")}`,
      `far ${i}`,
      { ":x": 200000 + col * 40, ":y": 200000 + row * 30, ":w": 36, ":h": 24 },
      i,
    ));
  }
  for (let i = 0; i < 40; i += 1) {
    const col = i % 8;
    const row = Math.floor(i / 8);
    children.push(blk(
      `near${String(i).padStart(2, "0")}`,
      `near ${i}`,
      { ":x": center.x + 70 + col * 28, ":y": center.y + 60 + row * 22, ":w": 24, ":h": 16 },
      380 + i,
    ));
  }
  children.push(blk("pdfNear", PDF, {
    ":x": center.x - 80,
    ":y": center.y - 50,
    ":w": 160,
    ":h": 100,
  }, 420));
  children.push(blk("pdfEdge", PDF, {
    ":x": attach.x + attach.w - 200,
    ":y": attach.y + 40,
    ":w": 160,
    ":h": 100,
  }, 421));
  children.push(blk("pdfFar", PDF, {
    ":x": 400000,
    ":y": 400000,
    ":w": 160,
    ":h": 100,
  }, 422));
  return buildBoard(rawBoard(children));
}

function seedCover(storage) {
  storage.setItem(COVER_LS_KEY, JSON.stringify({
    order: [PDF_URL],
    items: {
      [PDF_URL]: {
        url: PDF_URL,
        hash: "",
        first: DATA,
        last: null,
        w: 120,
        h: 160,
        ts: 1,
      },
    },
  }));
}

function hostOf() {
  return {
    graph: "g",
    stats: {},
    renderString(node, string) { node.textContent = string; },
    renderBlock(node, uid) { node.textContent = uid; },
    unmount() {},
    pagePreview: () => ({ exists: false, blocks: [] }),
    pullTree: () => [],
    blockString: () => null,
    openBlock() {},
    openInSidebar() {},
    searchPages: () => [],
    searchBlocks: () => [],
    related: () => [],
  };
}

function attachedInRect(view, board, vp) {
  const attach = visibleWorldRect(vp, SIZE, 0.35);
  const uids = [];
  for (const item of board.items.values()) {
    if (item?.kind !== "pdf") continue;
    const shell = view.root.querySelector(`[data-uid="${item.uid}"]`);
    if (!shell) continue;
    const rect = { x: item.x, y: item.y, w: item.w, h: item.h };
    if (rectsIntersect(rect, attach)) uids.push(item.uid);
  }
  return uids;
}

// One frame builds the first shell chunk. Later frames would attach the edge PDF before the cover job runs.
function paintFirstChunk(stub, view) {
  for (let i = 0; i < 6 && view.stats().shells === 0; i += 1) {
    if (stub.flushFrames() === 0) break;
  }
}

async function finishCoverJob(stub, view) {
  const start = Date.now();
  while (Date.now() - start < 1500) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    stub.flushIdle();
    if ((view.stats().coverRepaintCalls || 0) >= 1) {
      stub.flushIdle();
      return;
    }
  }
}

function openAt(vp) {
  resetSharedBgBudget();
  const stub = createDomStub();
  const restore = stub.install();
  seedCover(stub.localStorage);
  const board = coverBoard(vp);
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    on() { return () => {}; },
    release() {},
    setLinkMode() {},
  };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host: hostOf(),
    session,
    mountEl,
    settings: { get: () => undefined },
    version: "3.34.0",
    initialViewport: vp,
  });
  paintFirstChunk(stub, view);
  return { stub, restore, board, view };
}

describe("cover cull", { concurrency: 1 }, () => {
  afterEach(() => {
    noteSpeedFlags(null);
    resetSharedBgBudget();
  });

  test("an empty cover job counts highlights in the next part", () => {
    let counts = 0;
    const step = createCoverRepaintJob({
      takeUrls: () => [],
      repaint() {},
      count() { counts += 1; },
    });
    assert.equal(step(), false);
    assert.equal(counts, 0);
    assert.equal(step(), true);
    assert.equal(counts, 1);
  });

  test("overview repaint runs and keeps every PDF body", async () => {
    const vp = { x: 0, y: 0, zoom: 0.05 };
    const live = openAt(vp);
    try {
      assert.ok(live.board.items.size > 400);
      assert.equal(live.view.state().lod, "overview");
      assert.ok(live.view.root.querySelector('[data-uid="pdfNear"]'), "the in-chunk PDF shell was painted");
      await finishCoverJob(live.stub, live.view);
      const stats = live.view.stats();
      assert.ok(stats.coverRepaintCalls >= 1, "loadCover reached repaintForCover");
      assert.deepEqual(stats.coverRepaintUids, []);
      assert.equal(stats.coverRepaints, 0);
    } finally {
      live.view.dispose();
      live.restore();
    }
  });

  test("map repaint keeps only attached PDF cards inside the attach rect", async () => {
    const vp = { x: 0, y: 0, zoom: 0.4 };
    const live = openAt(vp);
    try {
      assert.equal(live.view.state().lod, "map");
      assert.equal(live.view.state().zoom, 0.4);
      assert.ok(live.view.root.querySelector('[data-uid="pdfNear"]'));
      assert.equal(live.view.root.querySelector('[data-uid="pdfEdge"]'), null);
      assert.equal(live.view.root.querySelector('[data-uid="pdfFar"]'), null);
      const want = attachedInRect(live.view, live.board, vp);
      assert.deepEqual(want, ["pdfNear"]);
      await finishCoverJob(live.stub, live.view);
      const stats = live.view.stats();
      assert.ok(stats.coverRepaintCalls >= 1);
      assert.deepEqual(stats.coverRepaintUids, want);
    } finally {
      live.view.dispose();
      live.restore();
    }
  });

  test("detail still repaints the PDF whose body is in view", async () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    const live = openAt(vp);
    try {
      assert.equal(live.view.state().lod, "detail");
      assert.ok(live.view.root.querySelector('[data-uid="pdfNear"]'));
      await finishCoverJob(live.stub, live.view);
      const stats = live.view.stats();
      assert.ok(stats.coverRepaintUids.includes("pdfNear"));
      assert.equal(stats.coverRepaintUids.includes("pdfFar"), false);
    } finally {
      live.view.dispose();
      live.restore();
    }
  });

  test("storedDerived off repaints the far PDF too", async () => {
    noteSpeedFlags({ storedDerived: false });
    const vp = { x: 0, y: 0, zoom: 0.4 };
    const live = openAt(vp);
    try {
      await finishCoverJob(live.stub, live.view);
      const stats = live.view.stats();
      assert.ok(stats.coverRepaintCalls >= 1);
      assert.ok(stats.coverRepaintUids.includes("pdfFar"));
      assert.ok(stats.coverRepaintUids.includes("pdfNear"));
      assert.ok(stats.coverRepaintUids.includes("pdfEdge"));
    } finally {
      live.view.dispose();
      live.restore();
    }
  });
});

// PXD-1: canvas painting of PDF covers asks the host nothing per frame. Based on r4-canvas-covers.
// (r4) a PDF card with a cached cover is drawn with its cover on the overview canvas, so the shell that
// lands on the box at the hand-back does not pop the cover in (QA5 C ovmap: covers popped in at #24-#30).
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { resetSharedBgBudget } from "../src/bg-budget.js";
import { COVER_LS_KEY } from "../src/host/cover-store.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { rectsIntersect, visibleWorldRect } from "../src/model/geometry.js";
import { noteSpeedFlags } from "../src/settings.js";
import { mountBoardView } from "../src/view/board-view.js";
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
  const board = buildBoard(rawBoard(children));
  // Highlight items on the PDF: every cover face with ticks walks these and asks the host for each one's page.
  for (let i = 0; i < 12; i += 1) {
    const uid = `hl${String(i).padStart(2, "0")}`;
    board.items.set(uid, {
      uid, type: "card", kind: "highlight", title: `hl ${i}`, string: `((hlsrc${i}))`,
      x: 300000 + i * 40, y: 300000, w: 36, h: 24,
      target: { kind: "block", uid: `hlsrc${i}` },
      highlight: { page: 1 + (i % 3), color: "yellow", text: `h${i}` },
    });
    board.order?.push?.(uid);
  }
  return board;
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

const calls = { blockPageUid: 0, pdfPageUrl: 0 };

function hostOf() {
  return {
    graph: "g",
    blockPageUid: () => { calls.blockPageUid += 1; return "pdfpage01"; },
    pdfPageUrl: () => { calls.pdfPageUrl += 1; return PDF_URL; },
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


const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

class FakeImage {
  constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; this.onload = null; }
  set src(v) {
    this._src = v;
    queueMicrotask(() => { this.complete = true; this.naturalWidth = 120; this.naturalHeight = 160; this.onload?.(); });
  }
  get src() { return this._src; }
}

async function openCanvas(flags) {
  resetSharedBgBudget();
  noteSpeedFlags({ overviewCanvas: true, ...flags });
  const vp = { x: 0, y: 0, zoom: 0.1 };
  const stub = createDomStub();
  const restore = stub.install();
  stub.window.Image = FakeImage;
  // The cover store hands a Blob back; the view reads it as a data URL.
  const realReader = globalThis.FileReader;
  globalThis.FileReader = class { readAsDataURL() { this.result = DATA; queueMicrotask(() => this.onload?.()); } };
  seedCover(stub.localStorage);
  const board = coverBoard(vp);
  const session = { uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), on() { return () => {}; }, release() {}, setLinkMode() {} };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host: hostOf(), session, mountEl, settings: { get: () => undefined }, version: "3.34.0", initialViewport: vp });
  for (let i = 0; i < 30; i += 1) { stub.flushFrames(); stub.flushIdle(); stub.flushTimers(); await tick(5); }
  return { stub, restore: () => { globalThis.FileReader = realReader; restore(); }, view };
}


describe("canvas cover cost", { concurrency: 1 }, () => {
  afterEach(() => { noteSpeedFlags(null); resetSharedBgBudget(); calls.blockPageUid = 0; calls.pdfPageUrl = 0; });

  test("PXD-1: panning the overview canvas draws the cover without a host read per frame", async () => {
    const f = await openCanvas({});
    try {
      assert.equal(f.view.state().lod, "overview");
      const canvas = f.view.root.querySelector(".pxd-underlay");
      assert.ok(canvas, "the overview canvas is up");
      const draws = () => canvas.__ctx.ops.filter((op) => op[0] === "drawImage" && op[1] === DATA).length;
      assert.ok(draws() > 0, "the cover is drawn once the canvas is up");
      calls.blockPageUid = 0;
      calls.pdfPageUrl = 0;
      const vp0 = { ...f.view.viewport() };
      // Cover rows may be memoized for 30 s: step the clock past that on every frame so each frame counts.
      const realNow = Date.now;
      let skew = 0;
      Date.now = () => realNow() + skew;
      try {
      for (let i = 1; i <= 8; i += 1) {
        skew += 31000;
        f.stub.dispatch(f.view.root, "wheel", { deltaX: 40, deltaY: 60, deltaMode: 0, clientX: 600, clientY: 400 });
        for (let k = 0; k < 4; k += 1) { f.stub.flushFrames(); f.stub.flushIdle(); f.stub.flushTimers(); await tick(2); }
      }
      } finally { Date.now = realNow; }
      const vp1 = f.view.viewport();
      assert.ok(vp1.x !== vp0.x || vp1.y !== vp0.y, "the camera moved");
      assert.ok(draws() > 0, "the cover is still drawn on the panned frames (the canvas clears its ops each frame)");
      assert.equal(calls.blockPageUid, 0, `blockPageUid calls from canvas painting: ${calls.blockPageUid}`);
      assert.equal(calls.pdfPageUrl, 0, `pdfPageUrl calls from canvas painting: ${calls.pdfPageUrl}`);
    } finally {
      f.view.dispose();
      f.restore();
    }
  });
});

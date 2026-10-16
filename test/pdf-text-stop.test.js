import assert from "node:assert/strict";
import test from "node:test";

import { resetSharedBgBudget } from "../src/bg-budget.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const BOARD = "board0001";
const PDF_URL = "https://example.com/notes.pdf";
const PDF = `{{[[pdf]]: ${PDF_URL}}}`;

test("closing the search panel closes a pdf.js document that is still opening", async (t) => {
  resetSharedBgBudget();
  t.after(() => resetSharedBgBudget());
  const stub = createDomStub();
  const restore = stub.install();
  t.after(restore);
  const tasks = [];
  stub.window.pdfjsLib = {
    GlobalWorkerOptions: { workerSrc: "worker.js" },
    getDocument(arg) {
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      let destroyed = 0;
      let pages = 0;
      const pdf = {
        numPages: 3,
        getPage() {
          pages += 1;
          return Promise.resolve({
            getTextContent: async () => ({ items: [] }),
            getViewport: () => ({ width: 100, height: 100 }),
            cleanup() {},
          });
        },
        destroy() { destroyed += 1; return Promise.resolve(); },
      };
      const task = {
        arg,
        promise,
        destroy() { destroyed += 1; return Promise.resolve(); },
        resolve: () => resolve(pdf),
        destroyed: () => destroyed,
        pages: () => pages,
      };
      tasks.push(task);
      return task;
    },
  };
  const board = buildBoard({
    ":block/uid": BOARD,
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [{
      ":block/uid": "pdfcard01",
      ":block/string": PDF,
      ":block/order": 0,
      ":block/props": { ":plexus": { ":x": 40, ":y": 40, ":w": 240, ":h": 320 } },
      ":block/children": [],
    }],
  }, { resolve: () => "", propsOf: () => null });
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false,
    on() { return () => {}; }, emit() {}, release() {}, setLinkMode() {},
    setBoard(next) { session.board = next; session.rects = worldRects(next); },
  };
  for (const name of ["commitMove", "commitRects", "createCard", "addRefCards", "setString"]) {
    session[name] = () => Promise.resolve(`${name}-uid`);
  }
  const host = {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock() {}, renderPage() {}, unmount() {},
    pagePreview: () => ({ uid: "pg", exists: true, blocks: [] }),
    pullTree: () => [],
    blockString: (uid) => (uid === "pdfcard01" ? PDF : null),
    pageUid: () => "pgBeta001",
    openBlock() {}, openInSidebar() {},
    searchPages: () => [], searchBlocks: () => [], related: () => [],
    cardStringForUid: (uid) => `((${uid}))`,
    listPdfBlocks: () => [{ url: PDF_URL, uid: "pdfcard01", pageTitle: "Notes" }],
  };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  mountEl._rect = { left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700, x: 0, y: 0 };
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "3.33.0" });
  t.after(() => { try { view.dispose(); } catch { /* already gone */ } });
  const flush = () => { stub.flushFrames(); stub.flushIdle(); stub.flushTimers(); stub.flushFrames(); };
  flush();
  await tick();
  const before = tasks.length;
  view.root.querySelector(".pxd-toolbar__add").click();
  const textTask = () => tasks.slice(before).find((task) => task.arg && task.arg.isEvalSupported === false);
  for (let i = 0; i < 40 && !textTask(); i += 1) {
    flush();
    await tick(5);
  }
  const mine = textTask();
  assert.ok(mine, "opening search starts reading an unparsed PDF");
  view.root.querySelector(".pxd-panel__close").click();
  mine.resolve();
  for (let i = 0; i < 8; i += 1) {
    flush();
    await tick();
  }
  assert.equal(mine.pages(), 0);
  assert.ok(mine.destroyed() >= 1, "the in-flight document was closed");
});

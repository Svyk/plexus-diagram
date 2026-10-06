// PERF-5 outline rows. A heavy embed in a row stays a poster until Open. Plain rows still render when near.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { coverModel } from "../src/model/pdf.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const BOARD = "board0001";
const MODE_KEY = `plexus-diagram:sidebar-mode:Svy:${BOARD}`;
const PDF = "{{[[pdf]]: https://example.test/paper.pdf}}";
const VIDEO = "{{[[video]]: https://cdn.example/clip.mp4}}";

const block = (uid, string, order, plexus = {}, children = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": { ":plexus": { ":x": order * 40, ":y": 0, ":w": 220, ":h": 120, ...plexus } },
  ":block/children": children,
});

function pulled() {
  return {
    ":block/uid": BOARD,
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      block("sect00001", "Notes", 0, { ":type": "section", ":w": 420, ":h": 280 }, [
        block("pdfcard01", "((pdfblock1))", 0, { ":x": 16, ":y": 48, ":w": 200, ":h": 80 }),
      ]),
      block("cardAAAA1", "Alpha", 1),
      block("videocard1", VIDEO, 2),
    ],
  };
}

class ScrollWatch {
  static all = [];
  constructor(cb, opts) {
    this.cb = cb;
    this.opts = opts;
    this.root = opts?.root;
    this.rootMargin = opts?.rootMargin;
    this.rows = new Set();
    this.disconnected = false;
    ScrollWatch.all.push(this);
  }
  observe(el) { this.rows.add(el); }
  unobserve(el) { this.rows.delete(el); }
  disconnect() { this.disconnected = true; this.rows.clear(); }
  fire(el, isIntersecting) { this.cb([{ target: el, isIntersecting }], this); }
}

function mount() {
  ScrollWatch.all = [];
  const stub = createDomStub();
  const restoreDom = stub.install();
  const prevIO = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = ScrollWatch;
  stub.localStorage.setItem(MODE_KEY, "outline");
  const renders = [];
  const board = buildBoard(pulled(), { resolve: (uid) => (uid === "pdfblock1" ? PDF : "") });
  const handlers = new Map();
  const mutations = [];
  const rec = (name) => (...args) => { mutations.push([name, ...args]); return Promise.resolve(`${name}-uid`); };
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    busy: false,
    mutations,
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    emit(name, payload) { for (const fn of [...(handlers.get(name) || [])]) fn(payload); },
    release() {},
    setLinkMode() {},
  };
  for (const name of ["commitMove", "commitRects", "createCard", "createText", "createSection", "setBlockOpen", "setString", "undo", "redo"]) {
    session[name] = rec(name);
  }
  const host = {
    graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock(el, uid) {
      renders.push({ el, uid });
      const doc = el.ownerDocument || globalThis.document;
      if (uid === "pdfblock1" || uid === "pdfcard01") {
        const box = doc.createElement("div");
        box.className = "rm-pdf-container";
        el.append(box);
        return;
      }
      if (uid === "videocard1") {
        el.append(doc.createElement("video"));
        return;
      }
      const mark = doc.createElement("div");
      mark.className = "rm-block";
      el.append(mark);
    },
    renderPage() {},
    unmount() {},
    blockString(uid) { return uid === "pdfblock1" ? PDF : ""; },
    pdfCover(string) {
      if (typeof string === "string" && string.includes("paper.pdf")) return coverModel({ title: "Paper", url: "https://example.test/paper.pdf", count: 4 });
      return coverModel({ count: 0 });
    },
    pageUid: () => null,
    openBlock() {},
    openInSidebar() {},
    searchPages: () => [],
    searchBlocks: () => [],
    related: () => [],
    cardStringForUid: (uid) => `((${uid}))`,
    pullTree: () => [],
    pagePreview: () => ({ uid: "pg", exists: true, blocks: [] }),
  };
  const sidebar = stub.document.createElement("div");
  sidebar.className = "rm-sidebar-window";
  const nativeEl = stub.document.createElement("div");
  sidebar.append(nativeEl);
  stub.document.body.append(sidebar);
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    nativeEl,
    settings: { get: () => undefined },
  });
  const done = () => {
    try { view.dispose(); } catch { /* already disposed */ }
    if (prevIO === undefined) delete globalThis.IntersectionObserver;
    else globalThis.IntersectionObserver = prevIO;
    restoreDom();
  };
  return { stub, view, root: view.root, renders, mutations, done };
}

test("an outline pdf ref and a video stay posters until Open, and a plain row still renders", () => {
  const f = mount();
  try {
    const root = f.root;
    const rows = [...root.querySelectorAll(".pxd-sidebar-outline__row")];
    assert.deepEqual(rows.map((row) => row.dataset.uid), ["sect00001", "cardAAAA1", "videocard1"]);
    assert.equal(f.renders.length, 0);
    const near = ScrollWatch.all.find((io) => io.rootMargin === "100% 0px");
    assert.ok(near);
    for (const row of rows) near.fire(row, true);
    assert.deepEqual(f.renders.map((hit) => hit.uid), ["cardAAAA1"]);
    assert.equal(root.querySelectorAll(".rm-pdf-container").length, 0);
    assert.equal(root.querySelectorAll("video").length, 0);
    const section = rows.find((row) => row.dataset.uid === "sect00001");
    const video = rows.find((row) => row.dataset.uid === "videocard1");
    assert.equal(section.querySelector(".pxd-embed-poster__title").textContent, "Paper");
    assert.equal(section.querySelector(".pxd-embed-poster__count").textContent, "4 highlights");
    assert.equal(video.querySelector(".pxd-embed-poster__title").textContent, "clip");
    assert.equal(section.textContent.includes("{{[[pdf]]"), false);

    section.querySelector("button.pxd-embed-open").click();
    assert.equal(root.querySelectorAll(".rm-pdf-container").length, 1);
    assert.deepEqual(f.renders.map((hit) => hit.uid), ["cardAAAA1", "pdfblock1"]);
    assert.equal(root.querySelectorAll("video").length, 0);

    video.querySelector("button.pxd-embed-open").click();
    assert.equal(root.querySelectorAll(".rm-pdf-container").length, 0);
    assert.equal(root.querySelectorAll("video").length, 1);
    assert.equal(section.querySelector(".pxd-embed-poster__title").textContent, "Paper");
    assert.equal(f.mutations.some((row) => row[0] === "setBlockOpen" || row[0] === "setString"), false);
  } finally {
    f.done();
  }
});

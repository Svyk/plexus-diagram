// PERF-5 cards. Heavy embeds stay posters until Open or focus. One live node per board. No graph write.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { coverModel } from "../src/model/pdf.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const PDF = "{{[[pdf]]: https://example.test/paper.pdf}}";
const VIDEO = "{{[[video]]: https://cdn.example/clip.mp4}}";
const TWEET = "{{tweet: https://twitter.com/jack/status/20}}";
const FRAME = "{{[[youtube]]: dQw4w9WgXcQ}}";

function raw(children) {
  return {
    ":block/uid": "boardperf5",
    ":block/string": "{{[[diagram]]:Embeds}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  };
}

function child(uid, string, order, plexus = {}, children = []) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": { ":plexus": { ":x": order * 260, ":y": 0, ":w": 240, ":h": 160, ...plexus } },
    ":block/children": children,
  };
}

function mount(children, { pageOutline = null } = {}) {
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
  const writes = [];
  const rendered = [];
  const strings = [];
  const host = {
    renderString(node, string) {
      strings.push(string);
      node.textContent = string;
    },
    renderBlock(node, uid) {
      rendered.push(uid);
      const live = doc.createElement("div");
      if (uid === "pdfcard01" || uid === "pdfblock1") live.className = "rm-pdf-container";
      else if (uid === "videocard1" || uid === "rowvideo1") {
        const video = doc.createElement("video");
        node.append(video);
        return;
      } else if (uid === "framecard1") {
        node.append(doc.createElement("iframe"));
        return;
      } else if (uid === "tweetcard1") live.className = "rm-xparser-default-tweet";
      else live.className = "rm-block";
      node.append(live);
    },
    unmount() {},
    blockString(uid) {
      if (uid === "pdfblock1") return PDF;
      return "";
    },
    pdfCover(string) {
      if (string === PDF) return coverModel({ title: "Paper", url: "https://example.test/paper.pdf", count: 4 });
      return coverModel({ count: 0 });
    },
    pageOutline,
    updateProps() { writes.push("host.updateProps"); },
  };
  const session = {
    updateProps() { writes.push("session.updateProps"); },
    setString() { writes.push("session.setString"); },
    setBlockOpen() { writes.push("session.setBlockOpen"); },
  };
  const board = buildBoard(raw(children), { resolve: (uid) => (uid === "pdfblock1" ? PDF : "") });
  const r = createItemRenderer({
    doc,
    host,
    session,
    itemsLayer,
    sectionsLayer,
    timers: {
      idle(fn) { idleQueue.push(fn); return () => {}; },
      later() { return () => {}; },
    },
  });
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 30) idleQueue.shift()({ timeRemaining: () => 10 });
  };
  r.sync({ board, rects: worldRects(board), structural: true });
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: { x: -100, y: -100, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
  flush();
  return { stub, doc, root, r, rendered, strings, writes, flush, restore };
}

test("a pdf, a video, and a tweet open as posters, and one Open replaces the previous live embed", () => {
  const f = mount([
    child("pdfcard01", "((pdfblock1))", 0),
    child("videocard1", VIDEO, 1),
    child("tweetcard1", TWEET, 2),
    child("framecard1", FRAME, 3),
    child("plain0001", "Hello", 4),
  ]);
  try {
    assert.equal(f.root.querySelectorAll(".rm-pdf-container").length, 0);
    assert.equal(f.root.querySelectorAll("iframe").length, 0);
    assert.equal(f.root.querySelectorAll("video").length, 0);
    assert.equal(f.root.querySelector("[data-uid=pdfcard01] .pxd-pdf-title").textContent, "Paper");
    assert.equal(f.root.querySelector("[data-uid=pdfcard01] .pxd-pdf-count").textContent, "4");
    assert.equal(f.root.querySelector("[data-uid=pdfcard01] .pxd-pdf-count").getAttribute("aria-label"), "4 highlights");
    assert.equal(f.root.querySelector("[data-uid=videocard1] .pxd-embed-poster__title").textContent, "clip");
    assert.equal(f.root.querySelector("[data-uid=tweetcard1] .pxd-embed-poster__title").textContent, "@jack");
    assert.equal(f.root.querySelector("[data-uid=framecard1] .pxd-embed-poster__title").textContent, "YouTube");
    assert.equal(f.root.querySelector("[data-uid=videocard1] .pxd-embed-poster__count"), null);
    assert.equal(f.strings.some((s) => s.includes("{{[[video]]") || s.includes("{{tweet:") || s.includes("{{[[youtube]]")), false);
    assert.equal(f.rendered.includes("videocard1"), false);
    assert.equal(f.rendered.includes("tweetcard1"), false);
    assert.equal(f.rendered.includes("framecard1"), false);
    assert.equal(f.rendered.includes("pdfblock1"), false);

    f.root.querySelector("[data-uid=pdfcard01] button.pxd-pdf-open").click();
    assert.equal(f.root.querySelectorAll(".rm-pdf-container").length, 1);
    assert.equal(f.root.querySelectorAll("video").length, 0);
    assert.equal(f.root.querySelectorAll("iframe").length, 0);
    assert.equal(f.rendered.at(-1), "pdfblock1");

    f.root.querySelector("[data-uid=videocard1] button.pxd-embed-open").click();
    assert.equal(f.root.querySelectorAll(".rm-pdf-container").length, 0);
    assert.equal(f.root.querySelectorAll("video").length, 1);
    assert.equal(f.root.querySelectorAll("iframe").length, 0);
    assert.equal(f.root.querySelector("[data-uid=pdfcard01] .pxd-pdf-cover") != null, true);

    f.r.setFocus(["framecard1"]);
    assert.equal(f.root.querySelectorAll("iframe").length, 1);
    assert.equal(f.root.querySelectorAll("video").length, 0);
    assert.equal(f.root.querySelectorAll(".rm-pdf-container").length, 0);

    f.r.setSelection(["plain0001"]);
    assert.equal(f.root.querySelectorAll("iframe").length, 1);
    assert.equal(f.root.querySelectorAll("video").length, 0);
    assert.deepEqual(f.writes, []);
  } finally {
    f.r.dispose();
    f.restore();
  }
});

test("a page row with a video macro is a poster until Open", () => {
  const f = mount([
    child("pagecard1", "[[Lab Page]]", 0, { ":w": 320, ":h": 240 }),
  ], {
    pageOutline() {
      return {
        uid: "labpage1",
        title: "Lab Page",
        exists: true,
        blocks: [child("rowvideo1", VIDEO, 0)],
      };
    },
  });
  try {
    const card = f.root.querySelector("[data-uid=pagecard1]");
    assert.equal(card.querySelector(".pxd-embed-poster__title").textContent, "clip");
    assert.equal(card.querySelector("video"), null);
    assert.equal(f.rendered.includes("rowvideo1"), false);
    assert.equal(f.strings.includes(VIDEO), false);
    card.querySelector("button.pxd-embed-open").click();
    assert.equal(card.querySelectorAll("video").length, 1);
    assert.equal(f.rendered.filter((uid) => uid === "rowvideo1").length, 1);
    assert.deepEqual(f.writes, []);
  } finally {
    f.r.dispose();
    f.restore();
  }
});

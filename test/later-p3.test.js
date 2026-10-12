// WO N (Later list): P3 parse motion goes to the run's card; the relay keeps no entry after a run ends.
import assert from "node:assert/strict";
import test from "node:test";

import { createCardMotionRelay, motionRouter } from "../src/view/card-parse-motion.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("P3: a run's reports go to the card it started on, even after the reader switched cards", () => {
  let current = "cardA";
  const route = motionRouter(() => current);
  assert.equal(route({ type: "start" }), "cardA");
  current = "cardB";
  assert.equal(route({ type: "progress", page: 2 }), "cardA");
  assert.equal(route({ type: "cancel" }), "cardA", "the cancel ends cardA's motion, not cardB's");
  assert.equal(route({ type: "start" }), "cardB", "the next run belongs to the new card");
  assert.equal(route({ type: "done" }), "cardB");
  current = "cardC";
  assert.equal(route({ type: "progress" }), "cardC", "outside a run: the current card");
});

test("P3: the card relay drops its entry once a run is done, failed or cancelled", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.setAttribute("data-pxd-lod", "detail");
    root._rect = { left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 };
    doc.body.append(root);
    const card = doc.createElement("div");
    card.className = "pxd-item";
    card.setAttribute("data-uid", "pdf1");
    card._rect = { left: 10, top: 10, width: 200, height: 260, right: 210, bottom: 270 };
    const paper = doc.createElement("div");
    paper.className = "pxd-pdf-paper";
    const cover = doc.createElement("div");
    cover.className = "pxd-pdf-cover";
    card.append(paper, cover);
    root.append(card);
    const relay = createCardMotionRelay({ doc, root, pageOf: () => 1 });
    relay.handle("pdf1", { type: "start" });
    assert.deepEqual(relay.active(), ["pdf1"]);
    relay.handle("pdf1", { type: "done", counts: { tables: 1 }, ms: 500, boxesOf: () => [] });
    assert.deepEqual(relay.active(), [], "done: no live entry left");
    assert.ok(cover.querySelector(".pxd-pmotion-head"), "the summary still shows");
    relay.handle("pdf1", { type: "start" });
    assert.equal(cover.querySelectorAll(".pxd-pmotion-head").length, 1, "a new run replaces the finishing summary");
    relay.handle("pdf1", { type: "error" });
    assert.deepEqual(relay.active(), [], "error: no live entry left");
    relay.handle("pdf1", { type: "start" });
    relay.handle("pdf1", { type: "cancel" });
    assert.deepEqual(relay.active(), []);
    assert.equal(cover.querySelectorAll(".pxd-pmotion-head").length, 0);
    relay.dispose();
    assert.equal(cover.querySelectorAll(".pxd-pmotion-head").length, 0);
  } finally { restore(); }
});

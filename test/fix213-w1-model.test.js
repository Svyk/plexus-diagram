// 2.13.0 fix W1: public API (C2, C3), halo refs (A13), region mark (D2), crop scan cap (D11).
import assert from "node:assert/strict";
import test from "node:test";

import { HALO_REF_CAP, haloRefs, refsLine } from "../src/model/halo.js";
import { boardsFromRefRows, createPublicApi, emitPublicEvent } from "../src/model/public-api.js";
import { eachRegionButton } from "../src/view/region-crop.js";
import { mountRegionMark } from "../src/view/region-mark.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("C2: a ref inside a child bullet or a connection resolves to the placed card, or to none", () => {
  const pulled = {
    ":block/uid": "boardA",
    ":block/props": { plexus: { v: 2 } },
    ":block/children": [
      { ":block/uid": "cardX", ":block/props": { plexus: { x: 1, y: 2 } }, ":block/children": [{ ":block/uid": "bullet" }] },
      { ":block/uid": "edges", ":block/props": { plexus: { type: "edges" } }, ":block/children": [{ ":block/uid": "edgeBlock" }] },
    ],
  };
  const pick = (card) => boardsFromRefRows([["boardA", "p", card]], () => pulled)[0].card;
  assert.equal(pick("bullet"), "cardX");
  assert.equal(pick("cardX"), "cardX");
  assert.equal(pick("edgeBlock"), undefined);
  assert.equal(pick("elsewhere"), "elsewhere");
});

test("C3: the host can emit mount, unmount and change to listeners, and unknown types are ignored", () => {
  const api = createPublicApi({ host: {} });
  const seen = [];
  for (const type of ["mount", "unmount", "change"]) api.addEventListener(type, (detail) => seen.push([type, detail.boardUid]));
  emitPublicEvent(api, "mount", { boardUid: "b" });
  emitPublicEvent(api, "unmount", { boardUid: "b" });
  emitPublicEvent(api, "change", { boardUid: "b" });
  emitPublicEvent(api, "bogus", { boardUid: "b" });
  assert.deepEqual(seen, [["mount", "b"], ["unmount", "b"], ["change", "b"]]);
  assert.equal("emit" in api, false);
});

test("A13: haloRefs reads an aggregate and caps the fetched times", () => {
  const rows = [];
  for (let i = 0; i < 500; i += 1) rows.push([`r${i}`, 1000 + i]);
  const q = (query) => (query.includes("count") ? [[500, 1000, 1499]] : rows);
  const got = haloRefs(q, "u");
  assert.equal(got.total, 500);
  assert.ok(got.times.length <= HALO_REF_CAP + 2);
  assert.equal(got.times.includes(1499), true);
  assert.equal(got.times.includes(1000), true);
  assert.equal(refsLine(got.times, got.total).startsWith("Referenced 500 times"), true);
  assert.deepEqual(haloRefs(() => [[0, null, null]], "u"), { total: 0, times: [] });
});

test("D2: the drag is kept as image fractions, so a scroll before Confirm does not shift it", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    const img = stub.document.createElement("img");
    const box = (left, top) => ({ left, top, x: left, y: top, width: 200, height: 100, right: left + 200, bottom: top + 100 });
    img._rect = box(40, 80);
    root._rect = box(40, 80);
    stub.document.body.append(root);
    let got = null;
    mountRegionMark({ doc: stub.document, root, img, onConfirm: (v) => { got = v; } });
    const layer = root.querySelector(".pxd-region-layer");
    stub.dispatch(layer, "pointerdown", { clientX: 90, clientY: 105, button: 0 });
    stub.dispatch(stub.document, "pointermove", { clientX: 130, clientY: 130 });
    stub.dispatch(stub.document, "pointerup", { clientX: 130, clientY: 130 });
    img._rect = box(40, 30); // the page scrolled 50px
    root.querySelector(".pxd-region-confirm").click();
    assert.deepEqual(got.frac, { rx: 0.25, ry: 0.25, rw: 0.2, rh: 0.25 });
  } finally {
    restore();
  }
});

test("D11: claimed region buttons do not count against the scan cap", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    stub.document.body.append(root);
    for (let i = 0; i < 5; i += 1) {
      const b = stub.document.createElement("button");
      b.className = "rm-xparser-default-plexus-region";
      b.setAttribute("data-n", String(i));
      if (i < 3) b.setAttribute("data-plexus-owner", "plexus-diagram");
      root.append(b);
    }
    const seen = [];
    eachRegionButton(root, (b) => seen.push(b.getAttribute("data-n")), 2);
    assert.deepEqual(seen, ["3", "4"]);
  } finally {
    restore();
  }
});

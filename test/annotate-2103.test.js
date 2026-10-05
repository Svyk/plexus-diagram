// ECO-7: drawing create, ref card to the right, annotates edge. The drawing uid is not an end.
import assert from "node:assert/strict";
import test from "node:test";

import { annotatePlan } from "../src/model/annotate.js";
import { edgeString } from "../src/model/schema.js";
import { chipText } from "../src/relchips.js";

const DRAWING = "Dwg9kLm2p";
const BOARD = "Brd2wXe5a";

test("annotatePlan creates on the board, places the ref card 40 to the right, and annotates the image", () => {
  const images = [
    { uid: "Img4nQr8s", x: 0, y: 0, w: 280, h: 160, drawingUid: DRAWING },
    { uid: "Img8pLs1c", x: -20, y: 15.5, w: 100, h: 40, drawingUid: DRAWING },
  ];
  for (const image of images) {
    const plan = annotatePlan(image, BOARD);
    assert.deepEqual(plan.create, { parentUid: BOARD, order: "last" });
    assert.deepEqual(Object.keys(plan.create), ["parentUid", "order"]);
    assert.equal(plan.card.x - (image.x + image.w), 40);
    assert.equal(plan.card.y, image.y);
    assert.equal(plan.card.w, image.w);
    assert.equal(plan.card.h, image.h);
    assert.deepEqual(Object.keys(plan.card), ["x", "y", "w", "h"]);
    assert.equal(plan.edge.label, "annotates");
    assert.equal(plan.edge.to, image.uid);
    assert.equal(Object.hasOwn(plan.edge, "from"), false);
    assert.equal(Object.hasOwn(plan.edge, "fromBlock"), false);
    assert.equal(Object.hasOwn(plan.edge, "toBlock"), false);
    assert.equal(JSON.stringify(plan).includes(DRAWING), false);

    const cardUid = "Crd7tYu3v";
    const text = plan.edge.string(cardUid);
    assert.equal(text, edgeString({ srcRef: `((${cardUid}))`, dstRef: `((${image.uid}))`, label: "annotates" }));
    assert.equal(text.includes(cardUid), true);
    assert.equal(text.includes(image.uid), true);
    assert.equal(text.includes(DRAWING), false);
    assert.equal(text.includes("annotates"), true);
  }
});

test("the outline chip is chipText and keeps the annotates mark between the names", () => {
  const plan = annotatePlan({ uid: "Img4nQr8s", x: 0, y: 0, w: 10, h: 10 }, BOARD);
  assert.equal(chipText({ from: "Floor", to: "Photo", label: plan.edge.label }), "↗ Floor —annotates→ Photo");
});

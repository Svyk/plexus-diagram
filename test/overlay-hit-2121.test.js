import assert from "node:assert/strict";
import test from "node:test";

import { leavesBoardPointer } from "../src/view/overlay-hit.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("the contexts drawer and the memory lane keep their own clicks", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    const drawer = stub.document.createElement("button");
    drawer.className = "pxd-contexts__row";
    const lane = stub.document.createElement("button");
    lane.className = "pxd-memory__play";
    const card = stub.document.createElement("div");
    card.className = "pxd-item";
    const wrap = stub.document.createElement("div");
    wrap.className = "pxd-contexts";
    wrap.append(drawer);
    const bar = stub.document.createElement("div");
    bar.className = "pxd-memory";
    bar.append(lane);
    root.append(wrap, bar, card);
    stub.document.body.append(root);
    assert.equal(leavesBoardPointer(drawer), true);
    assert.equal(leavesBoardPointer(lane), true);
    assert.equal(leavesBoardPointer(card), false);
  } finally {
    restore();
  }
});

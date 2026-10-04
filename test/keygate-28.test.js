import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

// A window key whose target is outside every board, with nothing selected, must
// return before the handler looks the board up. Typing in Roam still quiets the
// live card renders on the way out.

const raw = {
  ":block/uid": "board0001",
  ":block/string": "{{[[diagram]]:Test}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": [
    { ":block/uid": "cardAAAA1", ":block/string": "Alpha", ":block/order": 0, ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 200, ":h": 100 } }, ":block/children": [] },
  ],
};

function sessionFor(board) {
  const reads = [];
  const base = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    on() { return () => {}; },
  };
  const session = new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "symbol") return undefined;
      reads.push(String(prop));
      return () => {};
    },
  });
  return { session, reads };
}

test("a key outside the board with nothing selected returns before a model read", () => {
  const board = buildBoard(raw);
  const { session, reads } = sessionFor(board);
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const mountEl = doc.createElement("div");
    mountEl.className = "pxd-mount";
    doc.body.append(mountEl);
    const view = mountBoardView({
      host: {
        graph: "Readwisenotes",
        renderString(el, string) { el.textContent = string; },
        renderBlock() {},
        renderPage() {},
        unmount() {},
        pagePreview: () => ({ exists: false, blocks: [] }),
        pullTree: () => [],
        blockString: () => null,
      },
      session,
      mountEl,
      settings: { get: () => undefined },
      version: "2.8.0",
    });
    stub.flushFrames();
    stub.flushIdle();
    stub.flushFrames();

    const typing = doc.createElement("textarea");
    typing.className = "rm-block__input";
    doc.body.append(typing);
    typing.dispatchEvent({ type: "keydown", key: "a", code: "KeyA" });
    const card = view.root.querySelector("[data-uid=cardAAAA1] .pxd-item__body");
    assert.ok(card?.querySelector(".pxd-quiet"), "typing outside still quiets the mounted card");

    const outside = doc.createElement("div");
    outside.className = "rm-block";
    doc.body.append(outside);
    const orig = doc.querySelector.bind(doc);
    let lookups = 0;
    doc.querySelector = (sel) => {
      if (String(sel).includes("pxd-addboard")) lookups += 1;
      return orig(sel);
    };
    const mark = reads.length;
    outside.dispatchEvent({ type: "keydown", key: "a", code: "KeyA" });
    assert.equal(lookups, 0, "the handler returns before it searches the open board");
    assert.deepEqual(reads.slice(mark), [], "no session read on a key outside the board");
    view.dispose();
  } finally {
    restore();
  }
});

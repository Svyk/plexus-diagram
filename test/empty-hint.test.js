import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { EMPTY_HINT, syncEmptyHint } from "../src/view/empty-hint.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const pull = (children) => ({
  ":block/uid": "board0001",
  ":block/string": "{{[[diagram]]:Empty}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": children,
});

const card = {
  ":block/uid": "cardAAAA1",
  ":block/string": "Alpha",
  ":block/order": 0,
  ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 200, ":h": 100 } },
  ":block/children": [],
};

function sessionFor(board) {
  const handlers = new Map();
  return {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    emit(name, payload) { for (const fn of [...(handlers.get(name) || [])]) fn(payload); },
    setBoard(next) { this.board = next; this.rects = worldRects(next); },
    release() {},
  };
}

function mount(children) {
  const stub = createDomStub();
  const restore = stub.install();
  const board = buildBoard(pull(children));
  const session = sessionFor(board);
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host: { graph: "Svy", renderString(el, string) { el.textContent = string; }, renderBlock() {}, unmount() {} },
    session,
    mountEl,
    settings: { get: () => undefined },
    version: "1.3.0",
  });
  stub.flushFrames();
  return { stub, restore, session, view };
}

test("UI-5: the empty hint shows on a new board and hides after the first item", () => {
  const empty = mount([]);
  const hint = empty.view.root.querySelector(".pxd-empty");
  assert.equal(hint.textContent, EMPTY_HINT);
  assert.equal(hint.hidden, false);
  assert.equal(empty.session.mutations, undefined);
  const filled = buildBoard(pull([card]));
  empty.session.setBoard(filled);
  empty.session.emit("change", {});
  empty.stub.flushFrames();
  assert.equal(hint.hidden, true);
  assert.equal(hint.getAttribute("hidden"), "");
  empty.view.dispose();
  empty.restore();

  const busy = mount([card]);
  const gone = busy.view.root.querySelector(".pxd-empty");
  assert.equal(gone.hidden, true);
  busy.view.dispose();
  busy.restore();
});

test("UI-5: syncEmptyHint follows the item count", () => {
  const node = { hidden: true, textContent: "", attrs: new Map(), setAttribute(n, v) { this.attrs.set(n, v); }, removeAttribute(n) { this.attrs.delete(n); }, getAttribute(n) { return this.attrs.get(n); } };
  assert.equal(syncEmptyHint(node, { items: new Map() }), true);
  assert.equal(node.textContent, EMPTY_HINT);
  assert.equal(node.hidden, false);
  assert.equal(syncEmptyHint(node, { items: new Map([["a", {}]]) }), false);
  assert.equal(node.hidden, true);
});

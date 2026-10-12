// WO N (Later list): K6 the outline follows the reader's page once per frame, never inside the scroll task.
import assert from "node:assert/strict";
import test from "node:test";

import { createParseView } from "../src/view/parse-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("K6: page field changes during a reader scroll move the outline once, in the next frame", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const view = createParseView({ doc });
    doc.body.append(view.element());
    const body = view.element().querySelector(".pxd-parse__body");
    let writes = 0;
    let top = 0;
    Object.defineProperty(body, "scrollTop", { get: () => top, set: (v) => { writes += 1; top = v; }, configurable: true });
    const input = doc.createElement("input");
    input.value = "1";
    doc.body.append(input);
    view.watchPageInput(input);
    stub.flushFrames();
    writes = 0;
    for (const page of ["2", "3", "4", "5"]) {
      input.value = page;
      stub.dispatch(input, "input");
    }
    assert.equal(writes, 0, "nothing inside the scroll task");
    stub.flushFrames();
    assert.equal(writes, 1, "one outline move per frame");
    view.dispose();
    input.value = "9";
    stub.dispatch(input, "input");
    stub.flushFrames();
    assert.equal(writes, 1, "disposed: no follow");
  } finally {
    restore();
  }
});

import { createHost, sameButReaderState } from "../src/host/roam.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

test("K6: equal but for :pdf-settings, anywhere in the tree; any other change counts", () => {
  const tree = (page, text = "a") => ({
    ":block/uid": "b",
    ":block/children": [{ ":block/uid": "c", ":block/string": text, ":block/refs": [{ ":block/uid": "pdf", ":block/props": { ":pdf-settings": { ":current-page": page }, ":plexus-reads": { x: 1 } } }] }],
  });
  assert.equal(sameButReaderState(tree(1), tree(7)), true);
  assert.equal(sameButReaderState(tree(1), tree(1, "b")), false);
  const gone = tree(1);
  delete gone[":block/children"][0][":block/refs"][0][":block/props"][":plexus-reads"];
  assert.equal(sameButReaderState(tree(1), gone), false);
  assert.equal(sameButReaderState([1, 2], [1, 2, 3]), false);
  assert.equal(sameButReaderState({ a: [1] }, { a: { 0: 1 } }), false);
});

test("K6: a board that covers its refs ignores a PDF reader's page write, and hears every other change", () => {
  const fake = createFakeRoam();
  const tree = (page, text = "((pdfblk001))") => ({
    ":block/uid": "board0001",
    ":block/string": "",
    ":block/children": [{ ":block/uid": "card00001", ":block/string": text, ":block/refs": [{ ":block/uid": "pdfblk001", ":block/string": "{{[[pdf]]: https://example.test/a.pdf}}", ":block/props": { ":pdf-settings": { ":current-page": page } } }] }],
  });
  fake.api.data.pull = () => tree(1);
  let fire = null;
  fake.api.data.addPullWatch = (_pattern, _entity, cb) => { fire = cb; };
  fake.api.data.removePullWatch = () => {};
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  assert.ok(host.pullBoard("board0001"));
  const seen = [];
  const off = host.watchBoard("board0001", (after) => seen.push(after));
  fire(tree(1), tree(2));
  assert.equal(seen.length, 0, "the reader's page write repaints nothing");
  fire(tree(2), tree(2, "((pdfblk001)) note"));
  assert.equal(seen.length, 1, "a real change still arrives");
  off();
});

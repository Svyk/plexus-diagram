// P5-B memory-leak guards: view-lifetime lists must not grow per refresh / gesture / page return.
import assert from "node:assert/strict";
import test from "node:test";
import { createPropsPanel } from "../src/view/props-panel.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("1b: the props panel releases the old body's listeners on every refresh", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    let active = 0;
    const create = doc.createElement.bind(doc);
    doc.createElement = (tag) => {
      const node = create(tag);
      const add = node.addEventListener?.bind(node);
      const remove = node.removeEventListener?.bind(node);
      node.addEventListener = (...a) => { active += 1; return add?.(...a); };
      node.removeEventListener = (...a) => { active -= 1; return remove?.(...a); };
      return node;
    };
    const root = create("div");
    doc.body.append(root);
    const panel = createPropsPanel({ doc, root, storage: null, on: {} });
    const state = { items: [{ type: "card", uid: "c1", fontSize: 14 }], edge: null, board: { plexus: {}, defaults: {} } };
    panel.refresh(state);
    const once = active;
    for (let i = 0; i < 20; i += 1) panel.refresh(state);
    assert.equal(active, once, "listener count is flat across refreshes");
    panel.dispose();
  } finally {
    restore();
  }
});

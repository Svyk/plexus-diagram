// PERF5-P3: the search count must change in place. Replacing its text node is a child-list change inside the board:
// Roam's :has() anchors above the board then restyle every element with an inline style (live: every shell, per key).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountBig } from "./fixtures/big-mount.js";

test("P3: typing in board search and pressing Enter keep the count's one text node (no child-list change per key)", async () => {
  const m = mountBig({ x: 0, y: 0, zoom: 0.5 }, { virtualClock: true });
  try {
    await m.pump(4);
    m.view.root.focus();
    m.stub.dispatch(m.stub.window, "keydown", { key: "f", metaKey: true });
    const input = m.view.root.querySelector(".pxd-search__input");
    const count = m.view.root.querySelector(".pxd-search__count");
    assert.ok(input && count);
    input.value = "card 1";
    m.stub.dispatch(input, "input", {});
    const node = count.firstChild;
    assert.ok(node && node.nodeType === 3, "the count is one text node");
    const first = count.textContent;
    assert.ok(Number(first) > 0, `hits counted (${first})`);
    input.value = "card 12";
    m.stub.dispatch(input, "input", {});
    assert.equal(count.firstChild, node, "same text node after a second key");
    assert.notEqual(count.textContent, first);
    m.stub.dispatch(input, "keydown", { key: "Enter" });
    assert.equal(count.firstChild, node, "same text node after Enter");
    assert.match(count.textContent, /^1\/\d+$/);
    m.stub.dispatch(input, "keydown", { key: "Escape" });
    assert.equal(count.textContent, "");
    assert.equal(count.firstChild, node, "same text node after close");
  } finally {
    m.done();
  }
});

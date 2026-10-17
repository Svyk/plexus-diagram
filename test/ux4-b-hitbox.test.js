// UX4 B1: the bullet's hit box is the whole bullet gutter, and a press there focuses the block.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { crumbLabels, mount as mountWith, pulled, show, testTree } from "./fixtures/ux4-b.js";

const css = readFileSync(new URL("../src/css/ux3-outline.css", import.meta.url), "utf8");
const rule = (sel) => {
  const at = css.indexOf(sel);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

test("B1 hit box: the bullet gutter is a full-row-height target from the row edge to the text start", () => {
  const box = rule(".pxd-outline__line > .pxd-outline__bullet::after");
  assert.match(box, /position:\s*absolute/);
  assert.match(box, /left:\s*0/);
  assert.match(box, /right:\s*calc\(-1 \* var\(--pxd-ol-gap\)\)/, "reaches the text: 16px box + 4px gap");
  assert.match(box, /top:\s*calc\(-1 \* var\(--pxd-ol-pad\)\)/, "covers the row's top padding");
  assert.match(box, /bottom:\s*calc\(-1 \* var\(--pxd-ol-pad\)\)/, "covers the row's bottom padding");
  assert.match(box, /cursor:\s*pointer/);
  assert.match(rule(".pxd-block__children .pxd-outline__line > .pxd-outline__bullet::after"), /left:\s*calc\(-1 \* var\(--pxd-ol-indent\)\)/);
  assert.match(rule(".pxd-outline__caret,\n.pxd-root .pxd-item.pxd-item--ol .pxd-row__fold"), /z-index:\s*1/, "the caret stays above the gutter");
});

test("B1 hit box: pointerdown and click 6px right of the dot, 2px below the row top, focus the block", async () => {
  const f = mountWith({ cards: [{ uid: "cardTT001", string: "This is a test", plexus: { ":kids": true, ":h": 260 }, children: testTree() }] });
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardTT001]");
    const bullet = card.querySelector("[data-pxd-row=kidZ00001] .pxd-outline__bullet");
    const base = { clientX: 8 + 6, clientY: 2, pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0 };
    f.stub.dispatch(bullet, "pointerdown", { ...base, buttons: 1 });
    f.stub.dispatch(bullet, "mousedown", { ...base, buttons: 1 });
    f.stub.dispatch(bullet, "mouseup", { ...base, buttons: 0 });
    f.stub.dispatch(bullet, "click", { ...base, buttons: 0, detail: 1 });
    await show(f);
    assert.deepEqual(crumbLabels(card), ["This is a test", "test", "Todd Zenger"]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

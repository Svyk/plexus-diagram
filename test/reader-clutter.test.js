// Narrow board chrome beside the reader: the dock stays one row ("…" overflow) and the context bar steps
// around the dock, the minimap and the zoom rail.
import assert from "node:assert/strict";
import test from "node:test";

import { avoidObstacles, dockOverflow } from "../src/model/card-face.js";
import { createChrome } from "../src/view/chrome.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("dockOverflow: nothing hides when it fits, trailing tools hide first, the active tool stays", () => {
  const w = Array(10).fill(36);
  assert.deepEqual(dockOverflow(w, 600), []);
  const hidden = dockOverflow(w, 200, { gap: 4, pad: 14, more: 36 });
  const shown = 10 - hidden.length;
  assert.ok(14 + shown * 36 + 4 * (shown - 1) + 4 + 36 <= 200, "kept tools plus the … button fit");
  assert.deepEqual(hidden, [...hidden].sort((a, b) => a - b));
  assert.equal(hidden[hidden.length - 1], 9, "the trailing tool goes first");
  assert.ok(!hidden.includes(0));
  const keepLast = dockOverflow(w, 200, { gap: 4, pad: 14, more: 36, keep: 9 });
  assert.ok(!keepLast.includes(9), "the active tool is never hidden");
  assert.ok(keepLast.length >= 1);
  assert.deepEqual(dockOverflow(w, 10, { keep: 0 }).includes(0), false);
  assert.ok(dockOverflow(w, 10).length <= 9, "one tool always stays");
});

test("avoidObstacles: steps left of the minimap, above it when there is no room, unchanged when clear", () => {
  const bar = { left: 100, top: 300, w: 200, h: 36 };
  const minimap = { left: 220, top: 280, right: 340, bottom: 360 };
  assert.equal(avoidObstacles(bar, [], {}), bar);
  assert.equal(avoidObstacles(bar, [{ left: 0, top: 0, right: 10, bottom: 10 }], {}), bar);
  const left = avoidObstacles(bar, [minimap], { topLimit: 60, margin: 8, bounds: { right: 400, bottom: 500 } });
  assert.equal(left.left + left.w + 8, minimap.left, "left of the minimap");
  assert.equal(left.top, bar.top);
  const tight = avoidObstacles({ left: 100, top: 300, w: 200, h: 36 }, [{ ...minimap, left: 150 }], { topLimit: 60, margin: 8, bounds: { right: 400, bottom: 500 } });
  assert.equal(tight.top + tight.h + 8, minimap.top, "no room on the left: above");
  assert.equal(tight.left, 100);
  const rail = { left: 360, top: 60, right: 400, bottom: 400 };
  const both = avoidObstacles({ left: 180, top: 300, w: 200, h: 36 }, [minimap, rail], { topLimit: 60, margin: 8, bounds: { right: 400, bottom: 500 } });
  for (const o of [minimap, rail]) {
    assert.ok(both.left + both.w <= o.left || both.left >= o.right || both.top + both.h <= o.top || both.top >= o.bottom, "clear of every obstacle");
  }
  const none = avoidObstacles({ left: 10, top: 10, w: 380, h: 36 }, [{ left: 0, top: 0, right: 400, bottom: 500 }], { topLimit: 0, margin: 8, bounds: { right: 400, bottom: 500 } });
  assert.deepEqual(none, { left: 10, top: 10, w: 380, h: 36 }, "nothing fits: unchanged");
});

function dockRig(width) {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root pxd-root--docked pxd-root--dock-bottom";
  stub.document.body.append(root);
  const picked = [];
  const chrome = createChrome({
    doc: stub.document,
    root,
    version: "1",
    settings: {},
    timers: { later: () => () => {}, frame: () => () => {} },
    on: { setTool: (id, lock) => picked.push([id, lock]) },
  });
  const palette = root.querySelector(".pxd-palette");
  palette._rect = { left: 0, top: 0, width, height: 50, right: width, bottom: 50 };
  for (const b of root.querySelectorAll(".pxd-dock__btn")) b._rect = { left: 0, top: 0, width: 36, height: 36, right: 36, bottom: 36 };
  return { stub, restore, root, chrome, palette, picked };
}

test("a narrow board keeps the dock to one row: labels drop, trailing tools sit behind a … menu", () => {
  const f = dockRig(330);
  try {
    f.chrome.toolbar.layoutDock();
    assert.ok(f.palette.classList.contains("pxd-palette--tight"), "labels and separators drop first");
    const hidden = f.root.querySelectorAll(".pxd-dock__btn--overflow");
    assert.ok(hidden.length > 0);
    const more = f.root.querySelector(".pxd-dock__more");
    assert.ok(more, "… button");
    assert.equal(more.getAttribute("aria-label"), "More tools");
    const visible = [...f.palette.querySelectorAll(".pxd-dock__btn")].filter((b) => !b.classList.contains("pxd-dock__btn--overflow") && !b.classList.contains("pxd-dock__more"));
    assert.ok(14 + (visible.length + 1) * 36 + 4 * visible.length <= 330, "the row fits the board");
    assert.ok(visible.some((b) => b.getAttribute("data-tool") === "select"), "the active tool stays");
    more.click();
    const items = f.root.querySelectorAll(".pxd-dock__more-item");
    assert.deepEqual(items.map((i) => i.getAttribute("data-tool")).sort(), hidden.map((b) => b.getAttribute("data-tool")).sort());
    items[0].click();
    assert.deepEqual(f.picked, [[items[0].getAttribute("data-tool"), false]]);
    assert.equal(f.root.querySelector(".pxd-dock__more-menu"), null, "the menu closes after a pick");
  } finally { f.chrome.dispose(); f.restore(); }
});

test("a wide board shows every tool and no … button; widening again undoes the overflow", () => {
  const f = dockRig(330);
  try {
    f.chrome.toolbar.layoutDock();
    assert.ok(f.root.querySelector(".pxd-dock__more"));
    f.palette._rect = { left: 0, top: 0, width: 1000, height: 50, right: 1000, bottom: 50 };
    f.chrome.toolbar.layoutDock();
    assert.equal(f.root.querySelector(".pxd-dock__more"), null);
    assert.equal(f.root.querySelectorAll(".pxd-dock__btn--overflow").length, 0);
    assert.ok(!f.palette.classList.contains("pxd-palette--tight"));
  } finally { f.chrome.dispose(); f.restore(); }
});

test("the context bar placed next to the minimap and the rail steps clear of both", () => {
  const f = dockRig(400);
  try {
    const { root } = f;
    root._rect = { left: 0, top: 0, width: 400, height: 500, right: 400, bottom: 500, x: 0, y: 0 };
    const minimap = root.querySelector(".pxd-minimap");
    minimap._rect = { left: 280, top: 300, width: 110, height: 110, right: 390, bottom: 410, x: 280, y: 300 };
    const rail = root.querySelector(".pxd-rail");
    rail._rect = { left: 360, top: 60, width: 40, height: 220, right: 400, bottom: 280, x: 360, y: 60 };
    f.palette.style.display = "none";
    const ctx = root.querySelector(".pxd-ctx");
    ctx._rect = { left: 0, top: 0, width: 200, height: 36, right: 200, bottom: 36, x: 0, y: 0 };
    f.chrome.ctx.show("card", {}, () => ({ kind: "card", rect: { x: 250, y: 360, w: 100, h: 80 } }));
    const left = Number.parseFloat(ctx.style.left);
    const top = Number.parseFloat(ctx.style.top);
    const bar = { left, top, right: left + 200, bottom: top + 36 };
    for (const [name, o] of [["minimap", minimap._rect], ["rail", rail._rect]]) {
      const hit = bar.left < o.right && o.left < bar.right && bar.top < o.bottom && o.top < bar.bottom;
      assert.equal(hit, false, `bar ${JSON.stringify(bar)} stays off the ${name}`);
    }
  } finally { f.chrome.dispose(); f.restore(); }
});

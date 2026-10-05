// 2.13.0 fix pass, worker W2: contexts drawer, kanban, camera geometry, region-delete dialog, panel.
import assert from "node:assert/strict";
import test from "node:test";

import { viewportFromWorldRect, visibleWorldRect } from "../src/model/geometry.js";
import { planKanbanMove, HIGHLIGHT_FIELD } from "../src/model/kanban.js";
import { mountContextsDrawer } from "../src/view/contexts-drawer.js";
import { createPanel } from "../src/view/panel.js";
import { openRegionDeleteDialog } from "../src/view/region-delete-dialog.js";
import { setCameraFromView } from "../src/view/region-hover-geom.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("A3: the year header is printed once across chunks, and an undated first row still gets one", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const queued = [];
  try {
    const parent = stub.document.createElement("div");
    stub.document.body.append(parent);
    const rows = Array.from({ length: 60 }, (_, i) => ({ uid: `r${i}`, time: new Date(2026, 5, 15).getTime() - i, crumb: `row ${i}`, snippet: "" }));
    const handle = mountContextsDrawer({ doc: stub.document, parent, rows, schedule: (fn) => queued.push(fn) });
    while (queued.length) queued.shift()();
    assert.equal(handle.el.querySelectorAll(".pxd-contexts__row").length, 60, "every chunk painted");
    assert.deepEqual([...handle.el.querySelectorAll(".pxd-contexts__year")].map((n) => n.textContent), ["2026"]);
    handle.close();

    const undated = mountContextsDrawer({ doc: stub.document, parent, rows: [{ uid: "u1", time: NaN, crumb: "x", snippet: "" }] });
    assert.deepEqual([...undated.el.querySelectorAll(".pxd-contexts__year")].map((n) => n.textContent), ["Undated"]);
  } finally {
    restore();
  }
});

test("B14: a highlight dropped on a lane outside the seven colours plans no write", () => {
  const row = { uid: "c1", kind: "highlight", highlightColor: "yellow", targetUid: "hl1", targetString: "passage #h/yellow" };
  for (const lane of ["gray", "teal", "indigo"]) {
    assert.equal(planKanbanMove({ field: HIGHLIGHT_FIELD, column: lane, row }), null, lane);
  }
  assert.deepEqual(planKanbanMove({ field: HIGHLIGHT_FIELD, column: "green", row }), { op: "string", uid: "hl1", string: "passage #h/green" });
});

test("D14: one camera formula fits both axes, for a saved view and for a region view", () => {
  const wide = { width: 800, height: 200 };
  const rect = { x: 10, y: 20, w: 400, h: 300 };
  const cam = viewportFromWorldRect(rect, wide);
  const seen = visibleWorldRect(cam, wide, 0);
  assert.ok(seen.w >= rect.w - 0.001 && seen.h >= rect.h - 0.001, "the whole rect stays on screen");
  assert.deepEqual(setCameraFromView([10, 20, 400, 300], wide), cam, "both entry points agree");
  const tall = { width: 200, height: 800 };
  assert.deepEqual(setCameraFromView(rect, tall), viewportFromWorldRect(rect, tall));
  assert.equal(viewportFromWorldRect(rect, { width: 800 }).zoom, 2, "a size without a height still falls back to the width");
});

test("D10: the region-delete dialog hands focus to Cancel", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const dialog = openRegionDeleteDialog(stub.document, { message: "Delete?" });
    stub.document.body.append(dialog.el);
    dialog.focus();
    assert.equal(stub.document.activeElement, dialog.el.querySelector(".pxd-region-delete-cancel"));
  } finally {
    restore();
  }
});

test("D6: refreshViews does not read the views while the panel is closed", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  let reads = 0;
  const panel = createPanel({
    doc: stub.document,
    root,
    timers: { later: (fn) => { fn(); return () => {}; }, frame: (fn) => { fn(); return () => {}; }, idle: (fn) => { fn(); return () => {}; }, count: () => 0, cancelAll() {} },
    on: { listBoards: async () => [], listViews: () => { reads += 1; return []; } },
  });
  try {
    panel.open("boards");
    const opened = reads;
    panel.close();
    panel.refreshViews();
    assert.equal(reads, opened, "a closed panel does not walk the board");
    panel.open("boards");
    assert.ok(reads > opened, "it reads again when reopened on the Boards tab");
  } finally {
    panel.dispose();
    restore();
  }
});

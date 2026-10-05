// REG-6: save a view block, restore the camera from it, list it in the Boards tab.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { parseRegion } from "../src/model/regions.js";
import { viewportFromWorldRect, visibleWorldRect } from "../src/model/geometry.js";
import { diffBoards } from "../src/model/board.js";
import { captionForView, selectionViewRect, viewBlockString } from "../src/model/view-save.js";
import { findShortcut } from "../src/view/shortcuts.js";
import { buildMenu } from "../src/view/menu-model.js";
import { openViewDialog } from "../src/view/view-dialog.js";
import { minimapSvg } from "../src/view/minimap-svg.js";
import { createPanel } from "../src/view/panel.js";
import "../src/views.js";

const timers = { later: () => () => {}, frame: () => () => {} };

function seed(uid, children) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid,
    string: "Lab board",
    props: { plexus: { v: 2 } },
    children,
  });
  return { fake, session: acquireSession(uid, { host, linkDelay: 0 }) };
}

test("REG-6: Save view creates the container last and reuses it", async () => {
  const { fake, session } = seed("b1", [
    { uid: "c1", string: "note", props: { plexus: { type: "card", x: 0, y: 0, w: 100, h: 40 } } },
    { uid: "ed", string: "Connections", props: { plexus: { type: "edges" } } },
  ]);
  try {
    const pending = session.addView({ caption: "Corner", v: { x: 10.04, y: -3.04, w: 200, h: 80 }, ids: [] });
    assert.equal(typeof pending.uid, "string");
    const uid = await pending;
    assert.equal(uid, pending.uid);
    const kids = fake.children("b1");
    assert.deepEqual(kids.slice(0, 2), ["c1", "ed"]);
    const box = kids[2];
    assert.equal(fake.block(box).string, "{{[[plexus-regions]]}}");
    assert.deepEqual(fake.children(box), [uid]);
    const region = parseRegion(fake.block(uid).string);
    assert.equal(region.kind, "view");
    assert.equal(region.caption, "Corner");
    assert.deepEqual(region.v, [10, -3, 200, 80]);
    assert.equal(session.board.views[0].uid, uid);
    const second = session.addView({ caption: "Other", v: [0, 0, 40, 20] });
    await second;
    assert.deepEqual(fake.children("b1"), ["c1", "ed", box]);
    assert.deepEqual(fake.children(box), [uid, second.uid]);
  } finally {
    session.release();
    resetSessions();
  }
});

test("REG-6: a string container is reused and a selection view keeps three ids", async () => {
  const { fake, session } = seed("b2", [
    { uid: "c1", string: "a", props: { plexus: { type: "card", x: 0, y: 0, w: 10, h: 10 } } },
    { uid: "c2", string: "b", props: { plexus: { type: "card", x: 100, y: 40, w: 20, h: 20 } } },
    { uid: "c3", string: "c", props: { plexus: { type: "card", x: 40, y: 80, w: 10, h: 30 } } },
    { uid: "box", string: "{{[[plexus-regions]]}}" },
  ]);
  try {
    const ids = ["c1", "c2", "c3"];
    const rect = selectionViewRect(ids.map((id) => session.board.items.get(id)));
    assert.equal(rect.x, -48);
    assert.equal(rect.y, -48);
    const pending = session.addView({ caption: "Sel", v: rect, ids });
    const uid = await pending;
    assert.deepEqual(fake.children("b2"), ["c1", "c2", "c3", "box"]);
    assert.deepEqual(fake.children("box"), [uid]);
    const region = parseRegion(fake.block(uid).string);
    assert.deepEqual(region.ids, ids);
    assert.equal(region.v[0], rect.x);
    assert.ok(await session.deleteView(uid));
    assert.deepEqual(fake.children("box"), []);
    assert.equal(await session.deleteView("c1"), false);
    assert.equal(fake.block("c1").string, "a");
    const renamed = session.addView({ caption: "Old", v: [1, 2, 30, 40] });
    await renamed;
    assert.equal(await session.renameView(renamed.uid, "New name"), true);
    assert.equal(parseRegion(fake.block(renamed.uid).string).caption, "New name");
    assert.equal(await session.renameView("c1", "nope"), false);
  } finally {
    session.release();
    resetSessions();
  }
});

test("REG-6: a bad rect writes nothing and ids stop at 24", async () => {
  const { fake, session } = seed("b3", [
    { uid: "c1", string: "note", props: { plexus: { type: "card", x: 0, y: 0, w: 10, h: 10 } } },
  ]);
  try {
    const pending = session.addView({ caption: "Bad", v: { x: 0, y: 0, w: 0, h: 10 } });
    assert.equal(pending.uid, undefined);
    assert.equal(await pending, null);
    assert.deepEqual(fake.children("b3"), ["c1"]);
    const ids = Array.from({ length: 25 }, (_, i) => `card${i}`);
    const text = viewBlockString({ drawingUid: "b3", caption: "Cap", v: [0, 0, 10, 10], ids: [...ids, "bad id"] });
    assert.equal(parseRegion(text).ids.length, 24);
    assert.equal(parseRegion(text).ids.includes("card24"), false);
  } finally {
    session.release();
    resetSessions();
  }
});

test("REG-6: Go is the inverse of the visible rect, within a pixel after rounding", () => {
  const size = { width: 800, height: 600 };
  const vp = { x: -40, y: 15, zoom: 1.25 };
  const seen = visibleWorldRect(vp, size, 0);
  const back = viewportFromWorldRect(seen, size);
  assert.ok(Math.abs(back.x - vp.x) < 0.01);
  assert.ok(Math.abs(back.y - vp.y) < 0.01);
  assert.ok(Math.abs(back.zoom - vp.zoom) < 0.001);
  const text = viewBlockString({ drawingUid: "b3", v: [seen.x, seen.y, seen.w, seen.h] });
  const stored = parseRegion(text).v;
  const restored = viewportFromWorldRect({ x: stored[0], y: stored[1], w: stored[2], h: stored[3] }, size);
  assert.ok(Math.abs(restored.x - vp.x) < 1, `x ${restored.x}`);
  assert.ok(Math.abs(restored.y - vp.y) < 1, `y ${restored.y}`);
});

test("REG-6: the caption is the smallest section that holds the centre", () => {
  const sections = [
    { title: "Wide", rect: { x: 0, y: 0, w: 400, h: 300 } },
    { title: "Tight", rect: { x: 40, y: 40, w: 80, h: 50 } },
  ];
  assert.equal(captionForView(sections, { x: 50, y: 50 }, "Lab"), "Tight");
  assert.equal(captionForView(sections, { x: 300, y: 200 }, "Lab"), "Wide");
  assert.equal(captionForView(sections, { x: -10, y: 0 }, "Lab"), "View of Lab");
});

test("REG-6: Shift+V saves a view and V still selects", () => {
  assert.equal(findShortcut({ key: "V", shift: true }).action, "saveView");
  assert.equal(findShortcut({ key: "v" }).action, "tool");
  assert.equal(findShortcut({ key: "v" }).tool, "select");
  const menu = buildMenu("board-menu", {});
  assert.ok(menu.some((item) => item.id === "save-view"));
  const multi = buildMenu("multi", { count: 3 });
  assert.ok(multi.some((item) => item.id === "save-view-selection"));
  assert.equal(buildMenu("canvas", {}).some((item) => item.id === "save-view"), false);
});

test("REG-6: Save calls back inside the click and Cancel writes nothing", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const saved = [];
    const dialog = openViewDialog(stub.document, {
      caption: "Corner",
      onSave: (result) => saved.push(result),
    });
    stub.document.body.append(dialog.el);
    assert.equal(dialog.el.querySelector(".pxd-view-dialog__copy input").checked, true);
    dialog.el.querySelector(".pxd-view-save").click();
    assert.deepEqual(saved, [{ caption: "Corner", copy: true }]);
    assert.equal(dialog.el.isConnected, false);

    const cancelled = [];
    const again = openViewDialog(stub.document, {
      caption: "Nope",
      onSave: (result) => cancelled.push(result),
    });
    stub.document.body.append(again.el);
    again.el.querySelector(".pxd-view-cancel").click();
    assert.deepEqual(cancelled, []);
    const esc = openViewDialog(stub.document, { caption: "Esc", onSave: (result) => cancelled.push(result) });
    stub.document.body.append(esc.el);
    esc.el.dispatchEvent({ type: "keydown", key: "Escape" });
    assert.deepEqual(cancelled, []);
  } finally {
    restore();
  }
});

test("REG-6: the map is strokes only and Go does not ask for a write", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const calls = [];
  const panel = createPanel({
    doc: stub.document,
    root,
    timers,
    on: {
      listBoards: async () => [],
      listViews: () => [{ uid: "view1", caption: "Corner", v: [0, 0, 100, 80], ids: [], items: [{ x: 10, y: 10, w: 20, h: 10 }] }],
      goView: (uid) => calls.push(["go", uid]),
      deleteView: (uid) => calls.push(["del", uid]),
    },
  });
  try {
    const svg = minimapSvg(stub.document, { v: [0, 0, 100, 80], items: [{ x: 1, y: 2, w: 3, h: 4 }] });
    assert.equal(svg.getAttribute("class"), "pxd-view-map");
    for (const rect of svg.querySelectorAll("rect")) assert.equal(rect.getAttribute("fill"), "none");
    const css = readFileSync(new URL("../src/css/chrome.css", import.meta.url), "utf8");
    assert.match(css, /\.pxd-root \.pxd-view-map \{[^}]*width: 96px;/s);
    assert.doesNotMatch(css, /\.pxd-root \.pxd-minimap \{[^}]*width: 96px/s);
    panel.open("boards");
    const row = root.querySelector("[data-view=view1]");
    assert.ok(row);
    assert.equal(row.querySelector(".pxd-view-map").getAttribute("class"), "pxd-view-map");
    assert.equal(row.querySelector(".pxd-view-caption").textContent, "Corner");
    row.querySelector(".pxd-view-go").click();
    row.querySelector(".pxd-view-delete").click();
    assert.deepEqual(calls, [["go", "view1"], ["del", "view1"]]);
  } finally {
    panel.dispose();
    restore();
  }
});

test("REG-6: refreshViews puts an undone view back on the list", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  let views = [{ uid: "view1", caption: "Corner", v: [0, 0, 10, 10], ids: [] }];
  const panel = createPanel({
    doc: stub.document,
    root,
    timers,
    on: { listBoards: async () => [], listViews: () => views },
  });
  try {
    panel.open("boards");
    assert.equal(root.querySelectorAll(".pxd-view-row").length, 1);
    views = views.concat([{ uid: "view2", caption: "Three", v: [1, 1, 4, 4], ids: ["a", "b", "c"] }]);
    panel.refreshViews();
    assert.deepEqual([...root.querySelectorAll(".pxd-view-row")].map((row) => row.getAttribute("data-view")), ["view1", "view2"]);
    const before = root.querySelector("[data-view=view1]");
    panel.refreshViews();
    assert.equal(root.querySelector("[data-view=view1]"), before);
  } finally {
    panel.dispose();
    restore();
  }
});

test("REG-6: a view block change is a board change", () => {
  const prev = { uid: "b", string: "", plexus: {}, containerUid: null, items: new Map(), edges: new Map(), roots: [], order: [], views: [] };
  const next = { ...prev, views: [{ uid: "v1", caption: "Corner", v: [1, 2, 3, 4], ids: [] }] };
  assert.equal(diffBoards(prev, next).structural, true);
  assert.equal(diffBoards(next, { ...next, views: next.views }).structural, false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { PLEXUS_MIME } from "../src/model/clipboard.js";
import { createEdgeLayer } from "../src/view/edges.js";
import { createClipboardIO, dragHasImages, filesFromDataTransfer } from "../src/view/clipboard-io.js";
import { createPresenter } from "../src/view/present.js";
import { createQuickLook } from "../src/view/quicklook.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const setup = () => {
  const stub = createDomStub();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  return { stub, root, doc: stub.document };
};

const plexus = (o) => ({ plexus: o });
const blk = (uid, string, props, kids = []) => ({ ":block/uid": uid, ":block/string": string, ":block/order": 0, ":block/props": props, ":block/children": kids });

const item = (extra) => ({ uid: "u1", title: "T", string: "hello", kind: "card", type: "card", content: [], target: { kind: "self", uid: "u1" }, ...extra });

test("quick look: open, read-only render, unmount on close", () => {
  const { stub, root, doc } = setup();
  const rendered = [];
  const unmounted = [];
  const host = {
    renderString: (n, s) => rendered.push(s),
    unmount: (n) => unmounted.push(n),
    pullTree: () => [{ ":block/uid": "k1", ":block/string": "child", ":block/children": [] }],
  };
  const ql = createQuickLook({ doc, root, host, on: { getRefCount: () => 3 } });
  assert.equal(ql.isOpen(), false);
  ql.open(item());
  assert.equal(ql.isOpen(), true);
  const node = root.querySelector(".pxd-quicklook");
  assert.ok(node);
  assert.ok(node.classList.contains("pxd-chrome"));
  assert.deepEqual(rendered, ["hello", "child"]);
  assert.equal(root.querySelector(".pxd-ql__refs").textContent, "3");
  assert.equal(node.querySelector("[contenteditable]"), null);
  const ev = stub.dispatch(node, "wheel");
  assert.equal(ev.propagationStopped, true);
  ql.close();
  assert.equal(ql.isOpen(), false);
  assert.equal(root.querySelector(".pxd-quicklook"), null);
  assert.equal(unmounted.length, 2);
  ql.dispose();
});

test("quick look: Esc, outside pointerdown and second toggle close it; inside pointerdown does not", () => {
  const { stub, root, doc } = setup();
  const ql = createQuickLook({ doc, root, host: {} });
  ql.open(item());
  stub.dispatch(root.querySelector(".pxd-quicklook"), "pointerdown");
  assert.equal(ql.isOpen(), true);
  stub.dispatch(doc.body, "keydown", { key: "Escape" });
  assert.equal(ql.isOpen(), false);
  ql.open(item());
  stub.dispatch(root, "pointerdown");
  assert.equal(ql.isOpen(), false);
  ql.toggle(item());
  assert.equal(ql.isOpen(), true);
  ql.toggle(item());
  assert.equal(ql.isOpen(), false);
  ql.open(item());
  ql.dispose();
  assert.equal(stub.listenerCount(), 0);
});

test("quick look: board card shows an item count without renderString; page card uses pagePreview", () => {
  const { root, doc } = setup();
  let renders = 0;
  const host = { renderString: () => { renders++; }, pagePreview: () => ({ exists: true, blocks: [{ uid: "p", string: "pg", children: [] }] }) };
  const ql = createQuickLook({ doc, root, host });
  ql.open(item({ kind: "board", title: "Sub", string: "{{[[diagram]]:Sub}}", content: [] }));
  assert.match(root.querySelector(".pxd-ql__summary").textContent, /^\d+ items?$/);
  assert.equal(renders, 0);
  ql.open(item({ kind: "page", title: "P", target: { kind: "page", title: "P" } }));
  assert.equal(renders, 1);
  assert.equal(root.querySelectorAll(".pxd-quicklook").length, 1);
  ql.dispose();
});

const sectionBoard = () => buildBoard(blk("b1", "{{[[diagram]]:B}}", null, [
  blk("s2", "Second", plexus({ type: "section", x: 0, y: 500, w: 300, h: 200 }), [blk("c2", "in second", plexus({ x: 10, y: 40, w: 100, h: 60 }))]),
  blk("c0", "loose", plexus({ x: 900, y: 0, w: 100, h: 60 })),
  blk("s1", "First", plexus({ type: "section", x: 0, y: 0, w: 300, h: 200 }), [blk("c1", "in first", plexus({ x: 10, y: 40, w: 100, h: 60 }))]),
]));

test("presenter: steps are top-level sections in outline order; HUD lifecycle; exit callback", () => {
  const { stub, root, doc } = setup();
  const board = sectionBoard();
  const rects = worldRects(board);
  const steps = [];
  let exited = 0;
  const p = createPresenter({ doc, root, on: { step: (s) => steps.push(s), exit: () => { exited++; } } });
  assert.equal(p.isActive(), false);
  assert.equal(p.start(board, rects), true);
  assert.equal(p.total(), 2);
  assert.equal(p.index(), 0);
  assert.equal(steps[0].title, "Second");
  assert.equal(steps[0].total, 2);
  assert.deepEqual([...steps[0].members].sort(), ["c2", "s2"]);
  const hud = root.querySelector(".pxd-present-hud");
  assert.ok(hud && hud.classList.contains("pxd-chrome"));
  assert.equal(root.querySelector(".pxd-present-hud__count").textContent, "1 / 2");
  p.next();
  assert.equal(steps[1].uid, "s1");
  assert.equal(root.querySelector(".pxd-present-hud__count").textContent, "2 / 2");
  assert.equal(p.next(), true);
  assert.equal(p.index(), 1);
  p.prev();
  assert.equal(p.index(), 0);
  root.querySelector(".pxd-present-hud__next").click();
  assert.equal(p.index(), 1);
  root.querySelector(".pxd-present-hud__exit").click();
  assert.equal(p.isActive(), false);
  assert.equal(exited, 1);
  assert.equal(root.querySelector(".pxd-present-hud"), null);
  assert.equal(stub.listenerCount(), 0);
});

test("presenter: no sections gives one whole-board step; empty board refuses", () => {
  const { root, doc } = setup();
  const board = buildBoard(blk("b1", "{{[[diagram]]:B}}", null, [blk("c0", "x", plexus({ x: 0, y: 0, w: 100, h: 60 })), blk("c1", "y", plexus({ x: 200, y: 0, w: 100, h: 60 }))]));
  const steps = [];
  const p = createPresenter({ doc, root, on: { step: (s) => steps.push(s) } });
  assert.equal(p.start(board, worldRects(board)), true);
  assert.equal(p.total(), 1);
  assert.equal(steps[0].uid, null);
  assert.equal(steps[0].members.size, 2);
  assert.equal(steps[0].rect.w, 300);
  p.stop();
  const empty = buildBoard(blk("b2", "{{[[diagram]]:E}}", null, []));
  assert.equal(p.start(empty, worldRects(empty)), false);
  assert.equal(root.querySelector(".pxd-present-hud"), null);
});

const clip = (data = {}, files = []) => {
  const written = {};
  return { written, getData: (t) => data[t] ?? "", setData: (t, v) => { written[t] = v; }, files, types: Object.keys(data) };
};
const plexusJson = JSON.stringify({ v: 1, board: "b", bounds: { x: 0, y: 0, w: 10, h: 10 }, items: [{ uid: "a", type: "card", kind: "block", string: "((a))", x: 0, y: 0, w: 10, h: 10 }] });

const clipSetup = (over = {}) => {
  const ctx = setup();
  const calls = [];
  let owns = true;
  let clock = 1000;
  const io = createClipboardIO({
    doc: ctx.doc,
    root: ctx.root,
    ownsKeyboard: () => owns,
    isTextEntry: () => false,
    now: () => clock,
    on: {
      getPayload: () => ({ mime: "{}", text: "((a))" }),
      cutDone: () => calls.push(["cut"]),
      pastePlexus: (d, o) => calls.push(["plexus", d.items.length, o.clone]),
      pasteImages: (f) => calls.push(["images", f.length]),
      pasteText: (t) => calls.push(["text", t.length]),
    },
    ...over,
  });
  return { ...ctx, io, calls, setOwns: (v) => { owns = v; }, tick: (n) => { clock += n; } };
};

test("clipboard-io: copy sets both types and prevents default; cut also calls cutDone", () => {
  const { stub, doc, io, calls } = clipSetup();
  const cd = clip();
  const ev = stub.dispatch(doc.body, "copy", { clipboardData: cd });
  assert.equal(ev.defaultPrevented, true);
  assert.equal(cd.written[PLEXUS_MIME], "{}");
  assert.equal(cd.written["text/plain"], "((a))");
  const cd2 = clip();
  stub.dispatch(doc.body, "cut", { clipboardData: cd2 });
  assert.equal(cd2.written["text/plain"], "((a))");
  assert.deepEqual(calls, [["cut"]]);
  io.dispose();
});

test("clipboard-io: paste kinds and clone flag window", () => {
  const { stub, doc, io, calls, tick } = clipSetup();
  const png = { type: "image/png" };
  stub.dispatch(doc.body, "paste", { clipboardData: clip({ [PLEXUS_MIME]: plexusJson }) });
  stub.dispatch(doc.body, "paste", { clipboardData: clip({}, [png]) });
  stub.dispatch(doc.body, "paste", { clipboardData: clip({ "text/plain": "- a\n- b" }) });
  stub.dispatch(stub.window, "keydown", { key: "v", metaKey: true, shiftKey: true });
  tick(100);
  stub.dispatch(doc.body, "paste", { clipboardData: clip({ [PLEXUS_MIME]: plexusJson }) });
  tick(500);
  stub.dispatch(doc.body, "paste", { clipboardData: clip({ [PLEXUS_MIME]: plexusJson }) });
  assert.deepEqual(calls, [["plexus", 1, false], ["images", 1], ["text", 2], ["plexus", 1, true], ["plexus", 1, false]]);
  const ev = stub.dispatch(doc.body, "paste", { clipboardData: clip({ [PLEXUS_MIME]: plexusJson }) });
  assert.equal(ev.defaultPrevented, true);
  const none = stub.dispatch(doc.body, "paste", { clipboardData: clip() });
  assert.equal(none.defaultPrevented, false);
  io.dispose();
});

test("clipboard-io: ignored when a text input is focused or the board does not own the keyboard", () => {
  const { stub, doc, root, io, calls, setOwns } = clipSetup();
  const input = doc.createElement("input");
  root.append(input);
  input.focus();
  const ev = stub.dispatch(input, "paste", { clipboardData: clip({ [PLEXUS_MIME]: plexusJson }) });
  assert.equal(ev.defaultPrevented, false);
  const cd = clip();
  stub.dispatch(input, "copy", { clipboardData: cd });
  assert.deepEqual(cd.written, {});
  doc.activeElement = doc.body;
  setOwns(false);
  stub.dispatch(doc.body, "paste", { clipboardData: clip({ [PLEXUS_MIME]: plexusJson }) });
  const cd2 = clip();
  stub.dispatch(doc.body, "copy", { clipboardData: cd2 });
  assert.deepEqual(cd2.written, {});
  assert.deepEqual(calls, []);
  io.dispose();
});

test("clipboard-io: dispose leaves no listeners; filesFromDataTransfer keeps images only, max 10", () => {
  const { stub, io } = clipSetup();
  assert.ok(stub.listenerCount() > 0);
  io.dispose();
  assert.equal(stub.listenerCount(), 0);
  const files = Array.from({ length: 12 }, (_, i) => ({ type: "image/png", name: String(i) }));
  files.push({ type: "text/plain" });
  assert.equal(filesFromDataTransfer({ files }).length, 10);
  assert.deepEqual(filesFromDataTransfer({ files: [{ type: "application/pdf" }] }), []);
  const viaItems = { files: [], items: [{ kind: "file", getAsFile: () => ({ type: "image/jpeg" }) }, { kind: "string" }] };
  assert.equal(filesFromDataTransfer(viaItems).length, 1);
  assert.deepEqual(filesFromDataTransfer(null), []);
  const one = { type: "image/png", name: "image.png" };
  const both = { files: [one], items: [{ kind: "file", getAsFile: () => ({ type: "image/png", name: "image.png" }) }] };
  assert.deepEqual(filesFromDataTransfer(both), [one], "one pasted image is one upload, not two");
  const dragging = { files: [], items: [{ kind: "file", type: "image/png", getAsFile: () => null }] };
  assert.equal(dragHasImages(dragging), true, "dragover hides file contents but still shows the image type");
  assert.equal(dragHasImages({ files: [], items: [{ kind: "file", type: "application/pdf", getAsFile: () => null }] }), false);
  assert.equal(dragHasImages({ files: [], items: [{ kind: "string", type: "text/plain" }] }), false);
});

const edgeBoard = () => buildBoard(blk("b1", "{{[[diagram]]:B}}", null, [
  blk("c1", "a", plexus({ x: 0, y: 0, w: 100, h: 60 })),
  blk("c2", "b", plexus({ x: 300, y: 0, w: 100, h: 60 })),
  blk("c3", "c", plexus({ x: 600, y: 0, w: 100, h: 60 })),
  blk("ec", "Connections", plexus({ type: "edges" }), [
    blk("e12", "", plexus({ type: "edge", from: "c1", to: "c2" })),
    blk("e23", "", plexus({ type: "edge", from: "c2", to: "c3" })),
  ]),
]));

test("edges: ghosts are drawn, resized and cleared; focus dims edges outside the set and survives re-render", () => {
  const { stub, doc } = setup();
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  const over = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  const labels = doc.createElement("div");
  doc.body.append(svg, over, labels);
  const layer = createEdgeLayer({ doc, svg, labelsLayer: labels, overlaySvg: over });
  layer.setGhosts([{ x: 1, y: 2, w: 3, h: 4 }, { x: 5, y: 6, w: 7, h: 8 }]);
  assert.equal(over.querySelectorAll(".pxd-ghost").length, 2);
  assert.equal(over.querySelector(".pxd-ghost").getAttribute("width"), "3");
  layer.setGhosts([{ x: 1, y: 2, w: 3, h: 4 }]);
  assert.equal(over.querySelectorAll(".pxd-ghost").length, 1);
  layer.setGhosts(null);
  assert.equal(over.querySelectorAll(".pxd-ghost").length, 0);

  const board = edgeBoard();
  const rects = worldRects(board);
  layer.render({ board, rects });
  const dim = (uid) => layer._els.get(uid).g.classList.contains("pxd-edge--dim");
  layer.setFocus(new Set(["c1", "c2"]));
  assert.equal(dim("e12"), false);
  assert.equal(dim("e23"), true);
  assert.equal(layer._els.get("e23").label.classList.contains("pxd-label--dim"), true);
  layer.setFocus(new Set(["c1", "c2"]));
  assert.equal(dim("e23"), true);
  layer.render({ board, rects });
  assert.equal(dim("e23"), true);
  assert.equal(dim("e12"), false);
  layer.setFocus(null);
  assert.equal(dim("e23"), false);
  assert.equal(layer._els.get("e23").label.classList.contains("pxd-label--dim"), false);
  layer.setFocus(new Set(["c1"]));
  layer.setGhosts([{ x: 0, y: 0, w: 1, h: 1 }]);
  layer.dispose();
  assert.equal(over.querySelectorAll(".pxd-ghost").length, 0);
  assert.equal(stub.listenerCount(), 0);
});

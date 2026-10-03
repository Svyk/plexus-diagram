import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { DEFAULT_SIZES } from "../src/model/schema.js";
import { mountBoardView } from "../src/view/board-view.js";
import { CARD_MIME, parseDropPayload } from "../src/view/panel.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const dt = (data, extra = {}) => ({
  getData(type) { if (data[type] instanceof Error) throw data[type]; return data[type] ?? ""; },
  types: Object.keys(data),
  ...extra,
});
const resolveUid = (u) => (u === "pageuid-1" ? "[[Page One]]" : u === "gone" ? null : `((${u}))`);
const strings = (list) => list.map((x) => x.string);

test("roam single-block payload", () => {
  const d = dt({ "text/plain": " ", "roam/block-uid-list": "abcDEF123", "roam/block-uid-list-only-parents": "abcDEF123", "text/uri-list": "https://roamresearch.com/#/app/g/page/abcDEF123" });
  assert.deepEqual(parseDropPayload(d, { resolveUid }), [{ string: "((abcDEF123))" }]);
});

test("multi-select uses only-parents", () => {
  const d = dt({ "roam/block-uid-list": "aaaaaaaaa\nbbbbbbbbb\nccccccccc", "roam/block-uid-list-only-parents": "aaaaaaaaa\nccccccccc" });
  assert.deepEqual(strings(parseDropPayload(d, { resolveUid })), ["((aaaaaaaaa))", "((ccccccccc))"]);
});

test("block-uid-list used when only-parents is absent", () => {
  const d = dt({ "roam/block-uid-list": "aaaaaaaaa bbbbbbbbb" });
  assert.equal(parseDropPayload(d, { resolveUid }).length, 2);
});

test("page uid (not 9 chars) resolves to [[Title]]", () => {
  const d = dt({ "roam/roam-uri-list": "roam://#/app/g/page/pageuid-1" });
  assert.deepEqual(parseDropPayload(d, { resolveUid }), [{ string: "[[Page One]]" }]);
});

test("uri-list only, comments skipped", () => {
  const d = dt({ "text/uri-list": "# c\nhttps://roamresearch.com/#/app/g/page/09-29-2026" });
  assert.deepEqual(parseDropPayload(d, { resolveUid }), [{ string: "((09-29-2026))" }]);
});

test("resolver returning null skips the uid", () => {
  const d = dt({ "roam/block-uid-list-only-parents": "gone\nkeepkeep1" });
  assert.deepEqual(strings(parseDropPayload(d, { resolveUid })), ["((keepkeep1))"]);
});

test("CARD_MIME wins", () => {
  const d = dt({ [CARD_MIME]: "[[Own]]", "roam/block-uid-list": "aaaaaaaaa" });
  assert.deepEqual(parseDropPayload(d, { resolveUid }), [{ string: "[[Own]]" }]);
});

test("text fallbacks", () => {
  assert.deepEqual(parseDropPayload(dt({ "text/plain": "see [[x]] now" }), { resolveUid }), [{ string: "[[x]]" }]);
  assert.deepEqual(parseDropPayload(dt({ "text/plain": "see ((y)) now" }), { resolveUid }), [{ string: "((y))" }]);
  assert.deepEqual(parseDropPayload(dt({ "text/plain": "abcDEF123" }), { resolveUid }), [{ string: "((abcDEF123))" }]);
  assert.deepEqual(parseDropPayload(dt({ "text/plain": " " }), { resolveUid }), []);
  assert.deepEqual(parseDropPayload(null), []);
});

test("dedupe and cap at 50", () => {
  assert.equal(parseDropPayload(dt({ "roam/block-uid-list": "aaaaaaaaa aaaaaaaaa" }), { resolveUid }).length, 1);
  const many = Array.from({ length: 80 }, (_, i) => `u${i}`).join("\n");
  assert.equal(parseDropPayload(dt({ "roam/block-uid-list": many }), { resolveUid }).length, 50);
});

test("getData throwing yields empty", () => {
  const d = dt({ "roam/block-uid-list": new Error("x"), "text/plain": new Error("y"), [CARD_MIME]: new Error("z") });
  assert.deepEqual(parseDropPayload(d, { resolveUid }), []);
});

// ---- view
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function mount(hostOverrides = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const board = buildBoard({
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [],
  });
  const mutations = [];
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false, mutations,
    on: () => () => {},
    release() {},
    setLinkMode() {},
    addRefCards(list) { mutations.push(["addRefCards", list]); return Promise.resolve(["n1", "n2"]); },
  };
  const host = {
    graph: "Svy",
    renderString() {}, renderBlock() {}, renderPage() {}, unmount() {},
    pagePreview: () => null, pullTree: () => [], blockString: () => null, pageUid: () => null,
    openBlock() {}, openInSidebar() {}, searchPages: () => [], searchBlocks: () => [], related: () => [],
    cardStringForUid: resolveUid,
    ...hostOverrides,
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.1.0" });
  return { stub, restore, session, view, mutations, host };
}

test("RG-9: dropping a namespaced page offers Group under its parent", async () => {
  const f = mount();
  const grouped = [];
  f.session.groupUnder = (uids, title) => { grouped.push([uids, title]); return Promise.resolve("sec"); };
  try {
    stubFlush(f);
    const d = dt({ "text/plain": "[[Project/Sub]]" });
    f.stub.dispatch(f.view.root, "drop", { clientX: 400, clientY: 300, dataTransfer: d });
    await tick();
    const btn = [...f.view.root.querySelectorAll(".pxd-toast__action")].find((node) => node.textContent === "Group under Project");
    assert.ok(btn);
    btn.click();
    assert.deepEqual(grouped, [[["n1"], "Project"]]);
    const plain = dt({ "text/plain": "[[Plain]]" });
    f.stub.dispatch(f.view.root, "drop", { clientX: 400, clientY: 300, dataTransfer: plain });
    await tick();
    const buttons = [...f.view.root.querySelectorAll(".pxd-toast__action")].map((node) => node.textContent);
    assert.equal(buttons.includes("Group under Plain"), false);
    assert.deepEqual(grouped, [[["n1"], "Project"]]);
  } finally { f.view.dispose(); f.restore(); }
});

test("view: dropping two uids stacks cards centred on the drop point", async () => {
  const f = mount();
  try {
    stubFlush(f);
    const d = dt({ "text/plain": " ", "roam/block-uid-list-only-parents": "aaaaaaaaa\npageuid-1" }, { effectAllowed: "move" });
    const ev = f.stub.dispatch(f.view.root, "drop", { clientX: 400, clientY: 300, dataTransfer: d });
    assert.ok(ev.defaultPrevented);
    const [, list] = f.mutations[0];
    assert.deepEqual(list.map((c) => c.string), ["((aaaaaaaaa))", "[[Page One]]"]);
    const { w, h } = DEFAULT_SIZES.card;
    assert.equal(list[0].x, 400 - w / 2);
    assert.equal(list[0].y, 300 - h / 2);
    assert.equal(list[1].y - list[0].y, h + 24);
  } finally { f.view.dispose(); f.restore(); }
});

test("view: dropEffect follows effectAllowed", () => {
  const f = mount();
  try {
    for (const [allowed, want] of [["move", "move"], ["copyMove", "copy"], ["all", "copy"], ["uninitialized", "copy"], ["link", "link"]]) {
      const d = dt({}, { effectAllowed: allowed, dropEffect: "none" });
      const ev = f.stub.dispatch(f.view.root, "dragover", { dataTransfer: d });
      assert.ok(ev.defaultPrevented);
      assert.equal(d.dropEffect, want, allowed);
    }
  } finally { f.view.dispose(); f.restore(); }
});

test("view: drop inside an editor is left to Roam", () => {
  const f = mount();
  try {
    const editor = f.stub.document.createElement("div");
    editor.className = "pxd-item__editor";
    f.view.root.append(editor);
    const d = dt({ "roam/block-uid-list": "aaaaaaaaa" }, { effectAllowed: "move", dropEffect: "none" });
    const ev = f.stub.dispatch(editor, "drop", { clientX: 10, clientY: 10, dataTransfer: d });
    assert.equal(ev.defaultPrevented, false);
    assert.equal(f.mutations.length, 0);
    const over = f.stub.dispatch(editor, "dragover", { dataTransfer: d });
    assert.equal(over.defaultPrevented, false);
    assert.equal(d.dropEffect, "none");
  } finally { f.view.dispose(); f.restore(); }
});

function stubFlush(f) { f.stub.flushFrames(); }

// 1.2: an image file dropped from the desktop is uploaded through the host and becomes an image card at the drop point.
test("view: dropping image files uploads them and adds one image ref card each at the drop point", async () => {
  const uploaded = [];
  const f = mount({ uploadFile: async (file) => { uploaded.push(file.name); return `https://files.test/${file.name}`; } });
  try {
    stubFlush(f);
    const files = [{ type: "image/png", name: "a.png" }, { type: "image/gif", name: "b.gif" }, { type: "text/plain", name: "notes.txt" }];
    const d = dt({}, { effectAllowed: "all", files });
    const ev = f.stub.dispatch(f.view.root, "drop", { clientX: 400, clientY: 300, dataTransfer: d });
    assert.ok(ev.defaultPrevented);
    await tick(5);
    assert.deepEqual(uploaded, ["a.png", "b.gif"], "only image files are uploaded");
    const [, list] = f.mutations[0];
    assert.deepEqual(list.map((c) => c.string), ["![](https://files.test/a.png)", "![](https://files.test/b.gif)"]);
    assert.equal(list[0].x, 400);
    assert.equal(list[0].y, 300);
    assert.equal(list[1].y - list[0].y, DEFAULT_SIZES.card.h + 24);
    assert.equal(f.view.root.querySelector(".pxd-toast__text").textContent, "Added 2 images");
    assert.deepEqual(f.view.controller.getSelection().items, ["n1", "n2"], "the new cards are selected");
  } finally { f.view.dispose(); f.restore(); }
});

test("view: dropping an image where uploads are unavailable says so and adds nothing", async () => {
  const f = mount({ uploadFile: async () => { throw new Error("upload-unavailable"); } });
  try {
    stubFlush(f);
    const d = dt({}, { effectAllowed: "all", files: [{ type: "image/png", name: "a.png" }] });
    f.stub.dispatch(f.view.root, "drop", { clientX: 10, clientY: 10, dataTransfer: d });
    await tick(5);
    assert.equal(f.mutations.length, 0);
    assert.match(f.view.root.querySelector(".pxd-toast__text").textContent, /not available/);
  } finally { f.view.dispose(); f.restore(); }
});

test("ED-7: an image dragged over a card is accepted although dragover hides the file", () => {
  const f = mount();
  try {
    const editor = f.stub.document.createElement("div");
    editor.className = "pxd-item__editor";
    f.view.root.append(editor);
    const d = dt({}, { files: [], items: [{ kind: "file", type: "image/png", getAsFile: () => null }], dropEffect: "none" });
    const over = f.stub.dispatch(editor, "dragover", { dataTransfer: d });
    assert.equal(over.defaultPrevented, true, "without this the browser never fires drop");
    assert.equal(d.dropEffect, "copy");
  } finally { f.view.dispose(); f.restore(); }
});

test("ED-7: an image dropped on a card that is not being edited is appended, never replacing its text", async () => {
  const writes = [];
  const f = mount({
    uploadFile: async (file) => `https://files.test/${file.name}`,
    blockString: (uid) => (uid === "cardaaaa1" ? "keep me" : null),
    updateString: async (uid, s) => { writes.push([uid, s]); },
  });
  try {
    const card = f.stub.document.createElement("div");
    card.className = "pxd-item pxd-item--card";
    card.setAttribute("data-uid", "cardaaaa1");
    const editor = f.stub.document.createElement("div");
    editor.className = "pxd-item__editor";
    card.append(editor);
    f.view.root.append(card);
    const d = dt({}, { files: [{ type: "image/png", name: "d.png" }] });
    const ev = f.stub.dispatch(editor, "drop", { clientX: 10, clientY: 10, dataTransfer: d });
    assert.ok(ev.defaultPrevented);
    await tick(5);
    assert.deepEqual(writes, [["cardaaaa1", "keep me![](https://files.test/d.png)"]]);
    assert.equal(f.mutations.length, 0, "no new card");
  } finally { f.view.dispose(); f.restore(); }
});

test("view: a drop with image files and no host upload also stays a no-op with a toast", async () => {
  const f = mount();
  try {
    stubFlush(f);
    const d = dt({}, { effectAllowed: "all", files: [{ type: "image/webp", name: "c.webp" }] });
    f.stub.dispatch(f.view.root, "drop", { clientX: 10, clientY: 10, dataTransfer: d });
    await tick(5);
    assert.equal(f.mutations.length, 0);
    assert.match(f.view.root.querySelector(".pxd-toast__text").textContent, /not available/);
  } finally { f.view.dispose(); f.restore(); }
});

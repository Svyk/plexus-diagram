// PDFH-5: show the note Roam already stored. No create, no :pdf-highlight write.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { highlightModel, highlightNote } from "../src/model/highlight.js";
import { highlightRows } from "../src/model/highlight-pick.js";
import { createItemRenderer } from "../src/view/cards.js";
import { openHighlightDialog } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const TEXT = "selected passage";
const TITLE = "Risk model.pdf";
const NOTE = "why this passage";

const textProps = {
  ":pdf-highlight": {
    ":type": "text",
    ":content": { ":text": TEXT },
    ":position": { ":boundingRect": { ":pageNumber": 1 } },
  },
};

function card(uid, string, order, refs) {
  const node = {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": { ":plexus": { ":x": order * 320, ":y": 0, ":w": 240, ":h": 160 } },
    ":block/children": [],
  };
  if (refs) node[":block/refs"] = refs;
  return node;
}

function refOf(uid, string, props, children) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/props": props,
    ":block/page": { ":node/title": TITLE },
    ":block/children": children,
  };
}

test("highlightNote is the first child that is not a highlight, in block order", () => {
  const props = structuredClone(textProps);
  const before = structuredClone(props);
  assert.equal(highlightNote(), "");
  assert.equal(highlightNote(null), "");
  assert.equal(highlightNote([]), "");
  assert.equal(highlightNote([
    { string: "", props: {} },
    { string: "later", props: {} },
  ]), "");
  assert.equal(highlightNote([
    { string: "also highlighted", props: { ":pdf-highlight": { type: "text" } } },
    { string: NOTE, props: {} },
  ]), NOTE);
  assert.equal(highlightNote([
    { ":block/string": "second", ":block/order": 2, ":block/props": {} },
    { ":block/string": "first", ":block/order": 0, ":block/props": {} },
  ]), "first");

  const model = highlightModel({
    props,
    string: `${TEXT} #h/yellow`,
    pageTitle: TITLE,
    children: [{ uid: "note0001", string: NOTE, props: {} }],
  });
  assert.equal(model.note, NOTE);
  assert.equal(model.text, TEXT);
  assert.deepEqual(props, before);

  const bare = highlightModel({ props, string: `${TEXT} #h/yellow`, pageTitle: TITLE });
  assert.equal(bare.note, "");
});

test("highlightRows carries the note and does not list that child as its own row", () => {
  const rows = highlightRows([{
    uid: "hl01",
    string: `${TEXT} #h/yellow`,
    props: textProps,
    children: [
      { uid: "kidhl01", string: "inner #h/green", props: { ":pdf-highlight": { ":type": "text" } }, children: [] },
      { uid: "note0001", string: NOTE, props: {}, children: [] },
    ],
  }, {
    uid: "hl02",
    string: "plain passage #h/blue",
    props: textProps,
    children: [],
  }]);
  assert.deepEqual(rows.map((row) => row.uid), ["hl01", "kidhl01", "hl02"]);
  assert.equal(rows[0].note, NOTE);
  assert.equal(rows[1].note, "");
  assert.equal(rows[2].note, "");
});

test("the highlight card renders the stored note under the quote and writes nothing", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const rendered = [];
  const writes = [];
  const noted = refOf("hltext01", `${TEXT} #h/yellow`, textProps, [
    { ":block/uid": "note0001", ":block/string": NOTE, ":block/order": 0, ":block/props": {} },
  ]);
  const empty = refOf("hlempty1", `${TEXT} #h/green`, textProps, []);
  const propsSnapshot = structuredClone(noted[":block/props"]);
  const host = {
    renderString(node, string) {
      rendered.push(string);
      node.textContent = string;
    },
    unmount() {},
    blockString(uid) {
      if (uid === "hltext01" || uid === "hlempty1") return `${TEXT} #h/yellow`;
      return "";
    },
    createBlock(...args) { writes.push(["create", ...args]); },
    updateBlock(...args) { writes.push(["update", ...args]); },
    deleteBlock(...args) { writes.push(["delete", ...args]); },
  };
  const r = createItemRenderer({
    doc,
    host,
    session: { updateProps() { writes.push(["props"]); }, setString() { writes.push(["string"]); } },
    itemsLayer,
    sectionsLayer,
    timers: {
      idle(fn) { idleQueue.push(fn); return () => {}; },
      later() { return () => {}; },
    },
  });
  const board = buildBoard({
    ":block/uid": "boardhl01",
    ":block/string": "{{[[diagram]]:Highlights}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      card("hlcard01", "((hltext01))", 0, [noted]),
      card("emptycd1", "((hlempty1))", 1, [empty]),
    ],
  }, {
    resolve: (uid) => (uid === "hltext01" || uid === "hlempty1" ? `${TEXT} #h/yellow` : ""),
    propsOf: () => { writes.push(["propsOf"]); return null; },
  });
  const rects = worldRects(board);
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 20) idleQueue.shift()({ timeRemaining: () => 10 });
  };
  const show = () => {
    r.scheduleContent({ visibleRect: { x: -100, y: -100, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
    flush();
  };
  try {
    assert.equal(board.items.get("hlcard01").highlight.note, NOTE);
    assert.equal(board.items.get("emptycd1").highlight.note, "");
    r.sync({ board, rects, structural: true });
    r.setLod("detail", 1);
    show();

    const body = r.shellOf("hlcard01").querySelector(".pxd-item__body");
    const kids = [...body.children];
    const noteAt = kids.findIndex((node) => node.classList.contains("pxd-highlight-note"));
    const footAt = kids.findIndex((node) => node.classList.contains("pxd-highlight-foot"));
    const quoteAt = kids.findIndex((node) => node.classList.contains("pxd-item__string"));
    assert.ok(quoteAt >= 0 && noteAt > quoteAt && footAt > noteAt);
    assert.equal(body.querySelector(".pxd-highlight-note .pxd-rs__live").textContent, NOTE);
    assert.equal(rendered.includes(NOTE), true);
    assert.equal(rendered.includes(TEXT), true);
    assert.equal([...body.querySelectorAll("button")].some((node) => /note/i.test(node.textContent || "")), false);

    const emptyBody = r.shellOf("emptycd1").querySelector(".pxd-item__body");
    assert.equal(emptyBody.querySelector(".pxd-highlight-note"), null);
    assert.equal(writes.length, 0);
    assert.deepEqual(noted[":block/props"], propsSnapshot);

    const item = board.items.get("hlcard01");
    item.highlight = { ...item.highlight, note: "changed why" };
    r.sync({ board, rects, structural: false });
    show();
    assert.equal(r.shellOf("hlcard01").querySelector(".pxd-highlight-note .pxd-rs__live").textContent, "changed why");

    const before = rendered.length;
    r.setLod("map", 0.3);
    flush();
    const map = r.shellOf("hlcard01");
    assert.equal(map.querySelector(".pxd-highlight-note"), null);
    assert.equal(map.textContent.includes("changed why"), false);
    assert.equal(rendered.length, before);
    assert.equal(writes.length, 0);
  } finally {
    r.dispose();
    restore();
  }
});

test("a list row shows a note mark only when the note is non-empty", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const dialog = openHighlightDialog(stub.document, {
      rows: [
        { uid: "hl01", color: "yellow", snippet: TEXT, page: 1, group: "", placed: false, note: NOTE },
        { uid: "hl02", color: "green", snippet: "other", page: 2, group: "", placed: false, note: "" },
      ],
      origin: { x: 0, y: 0 },
    });
    stub.document.body.append(dialog);
    const rows = [...dialog.querySelectorAll(".pxd-hl-row")];
    const noted = rows.find((row) => row.getAttribute("data-uid") === "hl01");
    const plain = rows.find((row) => row.getAttribute("data-uid") === "hl02");
    assert.equal(noted.querySelector(".pxd-hl-note").textContent, "Note");
    assert.equal(noted.querySelector(".pxd-hl-note").getAttribute("aria-label"), "Note");
    assert.equal(plain.querySelector(".pxd-hl-note"), null);
  } finally {
    restore();
  }
});

test("the note clip is about four lines", () => {
  const css = readFileSync(new URL("../src/css/highlight-card.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-root \.pxd-highlight-note \{[\s\S]*-webkit-line-clamp:\s*4;/);
});

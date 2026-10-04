// P11 polish: PL-1 board rows in page cards and card children, PL-2 render-failure fallback rows.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const blk = (uid, string, plexus, order, children = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {},
  ":block/children": children,
});
const rawBoard = (children) => ({
  ":block/uid": "board0001",
  ":block/string": "{{[[diagram]]:Test}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": children,
});
const visible = { x: -10000, y: -10000, w: 20000, h: 20000 };
const cardKid = (uid, x) => ({ ":block/uid": uid, ":block/string": `card ${uid}`, ":block/order": 0, ":block/props": { ":plexus": { ":x": x, ":y": 0, ":w": 200, ":h": 100 } }, ":block/children": [] });

function harness({ pageBlocks, cardKids, hostOverrides = {}, openBoard } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const calls = { renderString: [], sidebar: [], opened: [], pull: [], boardOpened: [] };
  const host = {
    renderString(node, string) {
      calls.renderString.push(string);
      if (/^\{\{\[\[(diagram|excalidraw|roam\/render)/.test(string)) node.textContent = "Failed to render";
      else node.textContent = string;
    },
    unmount() {},
    renderPage() {},
    renderBlock() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard(uid) { calls.pull.push(uid); return { ":block/uid": uid, ":block/string": "{{[[diagram]]:Inner}}", ":block/children": [cardKid("c0000001", 0), cardKid("c0000002", 260)] }; },
    pageOutline: () => ({ uid: "uid-Alpha", exists: true, blocks: pageBlocks || [] }),
    pageUid: (t) => `uid-${t}`,
    openPage: (uid) => calls.opened.push(uid),
    openBlock: (uid) => calls.opened.push(uid),
    openInSidebar: (uid, type) => calls.sidebar.push([uid, type]),
    watchPage: () => () => {},
    ...hostOverrides,
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer);
  doc.body.append(itemsLayer);
  const idleQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => {}; },
    later(fn) { return () => {}; },
  };
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers, onOpenBoard: openBoard || ((uid) => calls.boardOpened.push(uid)) });
  const children = pageBlocks
    ? [blk("pg0000001", "[[Alpha]]", { ":x": 0, ":y": 0, ":w": 360, ":h": 480 }, 0)]
    : [blk("nk0000001", "parent text", { ":x": 0, ":y": 0, ":w": 360, ":h": 300, ":kids": true }, 0, cardKids)];
  const board = buildBoard(rawBoard(children));
  const rects = worldRects(board);
  r.sync({ board, rects, dirty: null, structural: true });
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: visible, zoom: 1, tier: "detail" });
  let guard = 0;
  while (idleQueue.length && guard++ < 100) idleQueue.shift()({ timeRemaining: () => 1000, didTimeout: false });
  return { doc, calls, r, board, shell: () => r.shellOf(board.order[0]), done() { r.dispose(); restore(); } };
}

const boardBlock = (uid, title = "Test Lab") => ({ uid, string: `{{[[diagram]]:${title}}}`, children: [] });

test("PL-1: a board row in a page card is a thumbnail row, never a renderString of the macro", () => {
  const h = harness({ pageBlocks: [{ uid: "plain0001", string: "hello", children: [] }, boardBlock("brd000002")] });
  try {
    const row = h.shell().querySelector("[data-pxd-row=brd000002]");
    assert.ok(row, "the row keeps data-pxd-row");
    assert.ok(row.querySelector(".pxd-board-row"), "mini-map row");
    assert.ok(row.querySelector(".pxd-mini"), "thumbnail minis");
    assert.equal(row.querySelector(".pxd-item__board-count").textContent, "2 items");
    assert.ok(!h.calls.renderString.some((s) => s.includes("diagram")), "the diagram macro never went through renderString");
    assert.ok(!h.shell().textContent.includes("Failed to render"));
    assert.ok(h.calls.renderString.includes("hello"));
  } finally { h.done(); }
});

test("PL-1: the board on screen is a chip with 'this board', and is never pulled", () => {
  const h = harness({ pageBlocks: [boardBlock("board0001", "Self")] });
  try {
    const chip = h.shell().querySelector("[data-pxd-row=board0001] .pxd-board-row--chip");
    assert.ok(chip);
    assert.ok(chip.textContent.includes("this board"));
    assert.ok(chip.textContent.includes("Self"));
    assert.ok(!h.calls.pull.includes("board0001"));
  } finally { h.done(); }
});

test("PL-1: past the thumbnail budget a board row is a chip with the item count", () => {
  const rows = Array.from({ length: 6 }, (_, i) => boardBlock(`brd00000${i}`, `B${i}`));
  const h = harness({ pageBlocks: rows });
  try {
    const card = h.shell();
    assert.equal(card.querySelectorAll(".pxd-board-row .pxd-board-preview").length, 4);
    const chips = card.querySelectorAll(".pxd-board-row--chip");
    assert.equal(chips.length, 2);
    assert.ok(/^▦ B4 · 2 items$/.test(chips[0].textContent));
  } finally { h.done(); }
});

test("PL-1: click opens the board, Shift-click opens it in the sidebar", () => {
  const h = harness({ pageBlocks: [boardBlock("brd000002")] });
  try {
    const open = h.shell().querySelector("[data-pxd-row=brd000002] .pxd-item__open");
    open.click();
    assert.deepEqual(h.calls.boardOpened, ["brd000002"]);
    const wrap = h.shell().querySelector("[data-pxd-row=brd000002] .pxd-board-row");
    wrap.dispatchEvent({ type: "click", shiftKey: true, target: wrap, stopPropagation() {}, preventDefault() {} });
    assert.deepEqual(h.calls.sidebar, [["brd000002", "block"]]);
  } finally { h.done(); }
});

test("PL-1: card children (CH-2) render a board child as a board row", () => {
  const kids = [{ ":block/uid": "kidbrd001", ":block/string": "{{[[diagram]]:Kid board}}", ":block/order": 0, ":block/children": [] }];
  const h = harness({ cardKids: kids });
  try {
    const row = h.shell().querySelector("[data-pxd-row=kidbrd001]");
    assert.ok(row.querySelector(".pxd-board-row"));
    assert.ok(!h.calls.renderString.some((s) => s.includes("diagram")));
  } finally { h.done(); }
});

test("PL-1: an embed of a board is a board row", () => {
  const h = harness({
    pageBlocks: [{ uid: "emb000001", string: "{{[[embed]]: ((brd000009))}}", children: [] }],
    hostOverrides: { blockString: (u) => (u === "brd000009" ? "{{[[diagram]]:Embedded}}" : null) },
  });
  try {
    const row = h.shell().querySelector("[data-pxd-row=emb000001]");
    assert.ok(row.querySelector(".pxd-board-row"));
    assert.ok(h.calls.pull.includes("brd000009"));
  } finally { h.done(); }
});

test("PL-2: a macro that fails to render becomes muted plain text, not a grey box or a chip", () => {
  const h = harness({ pageBlocks: [{ uid: "exc000001", string: "{{[[excalidraw]]}}", children: [] }, { uid: "rr0000001", string: "{{[[roam/render]]: ((x))}}", children: [] }] });
  try {
    const card = h.shell();
    for (const uid of ["exc000001", "rr0000001"]) {
      const plain = card.querySelector(`[data-pxd-row=${uid}] .pxd-rs--plain`);
      assert.ok(plain, uid);
    }
    assert.equal(card.querySelector("[data-pxd-row=exc000001] .pxd-rs__plain").textContent, "{{[[excalidraw]]}}");
    assert.ok(!card.textContent.includes("Failed to render"));
    assert.equal(card.querySelector(".pxd-render-chip"), null);
  } finally { h.done(); }
});

test("PL-3: the children badge and the block-arrow marker carry tooltip ids", () => {
  const kids = [{ ":block/uid": "kid000001", ":block/string": "child", ":block/order": 0, ":block/children": [] }];
  const h = harness({ cardKids: kids });
  try {
    const badge = h.shell().querySelector(".pxd-kids");
    assert.equal(badge.getAttribute("data-tip"), "kids");
    assert.equal(badge.getAttribute("data-tip-state"), "on");
    assert.ok(!badge.title, "no native title");
  } finally { h.done(); }
});

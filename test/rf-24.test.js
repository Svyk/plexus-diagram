import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildBoard } from "../src/model/board.js";
import { createPanel } from "../src/view/panel.js";
import { tipEntry } from "../src/view/tooltip-text.js";
import {
  chipText,
  createConnectionCache,
  createRelChips,
  previewModel,
  relationOf,
  uidFromElementId,
} from "../src/relchips.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const css = (name) => readFile(new URL(`../src/css/${name}`, import.meta.url), "utf8");
const timers = { later: () => () => {}, frame: () => () => {} };

// ------------------------------------------------------------------ RF-1 panel beside the rail
test("RF-1: the panel sits left of the rail (rail width plus gap), 8px from the edge otherwise", async () => {
  const rail = await css("rail.css");
  assert.match(rail, /\.pxd-root \{[^}]*--pxd-rail-w: 38px;[^}]*--pxd-panel-gap: 8px;[^}]*--pxd-panel-right: 8px;/);
  assert.match(rail, /\.pxd-root\.pxd-root--rail \{\s*--pxd-panel-right: calc\(8px \+ var\(--pxd-rail-w\) \+ var\(--pxd-panel-gap\)\);/);
  assert.match(rail, /\.pxd-root \.pxd-panel \{[^}]*right: var\(--pxd-panel-right\);/);
  assert.match(rail, /\.pxd-root\.pxd-root--panel-open \.pxd-minimap \{\s*right: calc\(var\(--pxd-panel-right\) \+ var\(--pxd-panel-w, 340px\) \+ var\(--pxd-panel-gap\)\);/);
  const railBlock = /\.pxd-root \.pxd-rail \{[^}]*\}/.exec(rail)[0];
  assert.match(railBlock, /right: 8px;/, "the rail stays put");
});

test("RF-1: opening the panel marks the root and publishes its width for the minimap; closing clears the mark", (t) => {
  const stub = createDomStub();
  const restore = stub.install();
  t.after(restore);
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const panel = createPanel({ doc: stub.document, root, host: {}, timers, width: 400 });
  assert.equal(root.style["--pxd-panel-w"], "400px");
  assert.ok(!root.classList.contains("pxd-root--panel-open"));
  panel.open();
  assert.ok(root.classList.contains("pxd-root--panel-open"));
  panel.close();
  assert.ok(!root.classList.contains("pxd-root--panel-open"));
});

// ------------------------------------------------------------------ RF-5 generous page-card grips
test("RF-5: page cards get a 12px grip band and a 16px corner above the scrollbar; the Hand tool shows the grips", async () => {
  const page = await css("page-card.css");
  assert.match(page, /\.pxd-item\.pxd-item--page > \.pxd-grip \{\s*z-index: 4;/);
  assert.match(page, /\.pxd-grip\.pxd-grip--right \{\s*right: -6px;\s*width: 12px;/);
  assert.match(page, /\.pxd-grip\.pxd-grip--bottom \{\s*bottom: -6px;\s*height: 12px;/);
  assert.match(page, /\.pxd-grip\.pxd-grip--corner \{\s*right: -6px;\s*bottom: -6px;\s*width: 16px;\s*height: 16px;/);
  assert.match(page, /\.pxd-root\[data-tool="hand"\] \.pxd-item:hover > \.pxd-grip\.pxd-grip--corner/);
});

// ------------------------------------------------------------------ RF-6 strings
test("RF-6: the chip, the preview buttons and the linked row have tooltip text", () => {
  for (const id of ["relchip", "relpop.board", "relpop.sidebar", "edge.row"]) {
    const entry = tipEntry(id);
    assert.ok(entry?.desc, id);
  }
  assert.ok(tipEntry("edge.bend", "clamped")?.desc, "the clamped pill reuses the clamped end text");
});

// ------------------------------------------------------------------ RF-3 relation chips
const plx = (o) => ({ plexus: o });
const raw = (uid, string, props, kids = [], order = 0) => ({ ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": props, ":block/children": kids });
const rawBoard = () => raw("board001", "{{[[diagram]]:Roadmap}}", plx({ v: 2 }), [
  raw("cardA001", "Alpha idea", plx({ x: 0, y: 0, w: 200, h: 100 }), [], 0),
  raw("cardB001", "[[Beta page]]", plx({ x: 500, y: 0, w: 360, h: 480 }), [], 1),
  raw("cardC001", "Far away", plx({ x: 3000, y: 3000, w: 200, h: 100 }), [], 2),
  raw("conn0001", "Connections", plx({ type: "edges" }), [
    raw("edge0001", "((cardA001)) → causes → ((rowBlk001))", plx({ type: "edge", from: "cardA001", to: "cardB001", toBlock: "rowBlk001", color: "blue" }), [], 0),
    raw("edge0002", "((cardA001)) → [[Beta page]]", plx({ type: "edge", from: "cardA001", to: "cardB001" }), [], 1),
  ], 3),
]);
const texts = { rowBlk001: "The target sentence in the block" };

test("RF-3 uidFromElementId finds a known uid at the end of Roam's block input id, even with dashes in it", () => {
  const uids = new Set(["edge0001", "ab-cd_9Z"]);
  assert.equal(uidFromElementId("block-input-Svy-body-outline-page00001-edge0001", uids), "edge0001");
  assert.equal(uidFromElementId("block-input-Svy-sidebar-1234-ab-cd_9Z", uids), "ab-cd_9Z");
  assert.equal(uidFromElementId("block-input-Svy-body-outline-page00001-other0001", uids), null);
  assert.equal(uidFromElementId("", uids), null);
});

test("RF-3 chipText names both ends, the label, the board and the block when an end is a block", () => {
  assert.equal(chipText({ from: "Alpha", to: "Beta", label: "causes", boardTitle: "Roadmap" }), "↗ Alpha —causes→ Beta · on Roadmap");
  assert.equal(chipText({ from: "Alpha", to: "Beta", boardTitle: "Roadmap" }), "↗ Alpha → Beta · on Roadmap");
  assert.equal(
    chipText({ from: "Alpha", to: "Beta page", label: "cites", boardTitle: "Roadmap", toBlockText: "The target sentence in the block" }),
    "↗ Alpha —cites→ Beta page ▸ “The target sentence in…” · on Roadmap",
  );
  assert.ok(chipText({ from: "x".repeat(80), to: "y", boardTitle: "" }).length < 70, "long names are cut");
});

test("RF-3 relationOf and previewModel read the connection off the board", () => {
  const board = buildBoard(rawBoard());
  const rel = relationOf(board, "edge0001", { blockText: (uid) => texts[uid] });
  assert.equal(rel.from, "Alpha idea");
  assert.equal(rel.to, "Beta page");
  assert.equal(rel.label, "causes");
  assert.equal(rel.toBlockText, "The target sentence in the block");
  assert.equal(rel.boardTitle, "Roadmap");
  assert.equal(relationOf(board, "missing", {}), null);
  const model = previewModel(board, "edge0001", { blockText: (uid) => texts[uid] });
  assert.deepEqual(model.cards.map((c) => [c.uid, c.role]).sort(), [["cardA001", "from"], ["cardB001", "to"]], "the far card is outside the crop");
  assert.equal(model.color, "blue");
  assert.equal(model.toBlockText, "The target sentence in the block");
  const v = model.viewBox;
  assert.ok(v.x < 0 && v.x + v.w > 860, "the crop holds both cards with padding");
  assert.match(model.path, /^M/);
});

test("RF-3 the uid cache loads from the host query and follows a board's connection set", () => {
  const cache = createConnectionCache({ host: { listConnectionBlocks: () => [["edge0001", "board001"], ["edge0002", "board001"], ["edgeZ001", "board002"]] } });
  assert.equal(cache.size(), 0);
  assert.equal(cache.load(), 3);
  assert.equal(cache.boardOf("edge0002"), "board001");
  cache.setBoard("board001", ["edge0001", "edgeNEW01"]);
  assert.equal(cache.has("edge0002"), false, "a removed connection leaves the cache");
  assert.equal(cache.has("edgeNEW01"), true, "a new one joins");
  assert.equal(cache.has("edgeZ001"), true, "other boards are untouched");
  const failing = createConnectionCache({ host: { listConnectionBlocks() { throw new Error("no datalog"); } } });
  assert.equal(failing.load(), 0, "a failing query leaves an empty cache");
});

function chipFixture({ boards = { board001: rawBoard() } } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const opened = [];
  const host = {
    graph: "Svy",
    listConnectionBlocks: () => [["edge0001", "board001"], ["edge0002", "board001"]],
    pullBoard: (uid) => boards[uid] ?? null,
    blockString: (uid) => texts[uid] ?? null,
    blockPageUid: () => "pageUID01",
    openInSidebar: (uid, type) => opened.push(["sidebar", uid, type]),
    openBlock: (uid) => opened.push(["block", uid]),
  };
  const chips = createRelChips({ doc, win: stub.window, host, graph: () => "Svy", timers });
  const outline = (uid, { withChildren = true } = {}) => {
    const container = doc.createElement("div");
    container.className = "roam-block-container";
    const main = doc.createElement("div");
    main.className = "rm-block-main";
    const input = doc.createElement("div");
    input.className = "rm-block__input roam-block";
    input.id = `block-input-Svy-body-outline-pageUID01-${uid}`;
    main.append(input);
    container.append(main);
    if (withChildren) {
      const kids = doc.createElement("div");
      kids.className = "rm-block-children";
      container.append(kids);
    }
    doc.body.append(container);
    return { container, input };
  };
  return { stub, restore, doc, host, chips, outline, opened };
}

test("RF-3 a rendered connection block gets one chip before its children; other blocks get none; no writes happen", (t) => {
  const f = chipFixture();
  t.after(f.restore);
  f.chips.start();
  const a = f.outline("edge0001");
  const other = f.outline("plain0001");
  f.chips.scan(a.container);
  f.chips.scan(other.container);
  f.chips.scan(a.container);
  const mine = a.container.children.filter((c) => c.classList.contains("pxd-relchip"));
  assert.equal(mine.length, 1, "scanning twice adds one chip");
  assert.equal(a.container.children.indexOf(mine[0]), 1, "after the block text, before the children");
  assert.equal(other.container.children.filter((c) => c.classList.contains("pxd-relchip")).length, 0);
  assert.equal(mine[0].textContent, "↗ Alpha idea —causes→ Beta page ▸ “The target sentence in…” · on Roadmap");
  assert.equal(mine[0].getAttribute("role"), "button");
  assert.equal(mine[0].parentElement, a.container, "never inside the editable block text");
});

test("RF-3 the chip opens a preview popover with a map and two buttons; Escape, an outside press and scroll close it", (t) => {
  const f = chipFixture();
  t.after(f.restore);
  f.chips.start();
  const a = f.outline("edge0001");
  f.chips.scan(a.container);
  const chip = a.container.children.find((c) => c.classList.contains("pxd-relchip"));
  f.stub.dispatch(chip, "click", {});
  const pop = f.doc.body.querySelector(".pxd-relpop");
  assert.ok(pop, "popover on document.body");
  assert.ok(pop.classList.contains("pxd-root"), "under a .pxd- root so it takes the board tokens");
  assert.equal(pop.querySelectorAll(".pxd-relpop__card").length, 2, "both connected cards are drawn");
  assert.equal(pop.querySelectorAll(".pxd-relpop__card--from").length, 1);
  assert.equal(pop.querySelectorAll(".pxd-relpop__line").length, 1, "the arrow");
  assert.equal(pop.querySelectorAll(".pxd-relpop__row").length, 1, "the target block is named");
  const buttons = pop.querySelectorAll(".pxd-relpop__btn").map((b) => b.textContent);
  assert.deepEqual(buttons, ["Open on board", "Open in sidebar"]);
  for (const b of pop.querySelectorAll(".pxd-relpop__btn")) assert.ok(tipEntry(b.getAttribute("data-tip")), b.getAttribute("data-tip"));
  f.stub.dispatch(f.doc, "keydown", { key: "Escape" });
  assert.equal(f.doc.body.querySelector(".pxd-relpop"), null, "Escape closes");
  f.stub.dispatch(chip, "click", {});
  f.stub.dispatch(f.doc.body, "pointerdown", {});
  assert.equal(f.doc.body.querySelector(".pxd-relpop"), null, "an outside press closes");
  f.stub.dispatch(chip, "click", {});
  f.stub.dispatch(f.stub.window, "scroll", {});
  assert.equal(f.doc.body.querySelector(".pxd-relpop"), null, "scroll closes");
});

test("RF-3 Open in sidebar and Open on board go through the host and the deep link", (t) => {
  const f = chipFixture();
  t.after(f.restore);
  f.stub.window.location = { hash: "" };
  f.chips.start();
  const a = f.outline("edge0001");
  f.chips.scan(a.container);
  const chip = a.container.children.find((c) => c.classList.contains("pxd-relchip"));
  f.stub.dispatch(chip, "click", {});
  f.stub.dispatch(f.doc.body.querySelectorAll(".pxd-relpop__btn")[1], "click", {});
  assert.deepEqual(f.opened, [["sidebar", "board001", "block"]]);
  assert.equal(f.doc.body.querySelector(".pxd-relpop"), null);
  f.stub.dispatch(chip, "click", {});
  f.stub.dispatch(f.doc.body.querySelectorAll(".pxd-relpop__btn")[0], "click", {});
  assert.equal(f.stub.window.location.hash, "#/app/Svy/page/pageUID01?pxd=edge0001");
});

test("RF-3 unload removes every chip and popover, and nothing is written", (t) => {
  const f = chipFixture();
  t.after(f.restore);
  f.chips.start();
  const a = f.outline("edge0001");
  const b = f.outline("edge0002");
  f.chips.scan(a.container);
  f.chips.scan(b.container);
  assert.equal(f.chips.chipCount(), 2);
  f.stub.dispatch(a.container.children.find((c) => c.classList.contains("pxd-relchip")), "click", {});
  const before = f.stub.listenerCount();
  assert.ok(before > 0);
  f.chips.dispose();
  assert.equal(f.doc.body.querySelectorAll(".pxd-relchip").length, 0);
  assert.equal(f.doc.body.querySelectorAll(".pxd-relpop").length, 0);
  assert.equal(f.chips.chipCount(), 0);
  f.chips.scan(a.container);
  assert.equal(f.doc.body.querySelectorAll(".pxd-relchip").length, 0, "a disposed layer adds nothing");
  assert.equal(Object.keys(f.host).some((k) => /^(create|update|delete|move|write|set)/.test(k)), false, "the host seam has no write method");
});

test("RF-3 with no connection blocks in the graph a scan does no work", (t) => {
  const f = chipFixture();
  t.after(f.restore);
  f.host.listConnectionBlocks = () => [];
  const chips = createRelChips({ doc: f.doc, win: f.stub.window, host: f.host, timers });
  chips.start();
  let queried = 0;
  const node = f.doc.createElement("div");
  node.querySelectorAll = () => { queried += 1; return []; };
  chips.scan(node);
  assert.equal(queried, 0);
});

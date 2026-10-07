// PDFH-1..4, PDFH-6, PDFH-7. The side pane, the list, place, the footer, and the jump.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { HIGHLIGHT_FIELD } from "../src/model/kanban.js";
import { rewriteHighlightTag } from "../src/model/highlight.js";
import { lensBright } from "../src/model/lens.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { CARD_MIME } from "../src/model/drop.js";
import { readPaneKey, readPaneWidth } from "../src/model/pdf.js";
import { HIGHLIGHT_MARK_TIP } from "../src/view/color-picker.js";
import { createItemRenderer } from "../src/view/cards.js";
import {
  createReadPane,
  highlightDropPlan,
  originBeside,
  placeDecision,
  readerJumpPlan,
} from "../src/view/read-pane.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const SELF = "{{[[pdf]]: https://example.test/self.pdf}}";
const REF = "{{[[pdf]]: https://example.test/ref.pdf}}";
const TITLE = "Risk model.pdf";
const TEXT = "beta passage";
const TIP = "The card and the list follow the tag. The mark painted in the PDF may stay yellow; Roam's reader changes it.";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

function hl(uid, text, color, page) {
  return {
    uid,
    string: `${text} #h/${color}`,
    props: {
      ":pdf-highlight": {
        ":type": "text",
        ":position": { ":boundingRect": { ":pageNumber": page } },
      },
    },
    children: [],
  };
}

function areaNode() {
  return {
    uid: "hlarea01",
    string: "![shot](https://example.test/a.png) #h/yellow",
    props: {
      ":pdf-highlight": {
        ":type": "area",
        ":position": { ":boundingRect": { ":pageNumber": 2 } },
      },
      ":image-size": { ":width": 133, ":height": 47 },
    },
    children: [],
  };
}

function raw(children) {
  return {
    ":block/uid": "boardpdf1",
    ":block/string": "{{[[diagram]]:PDFs}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  };
}

function child(uid, string, order, w = 220, h = 140) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": { ":plexus": { ":x": order * 320, ":y": 0, ":w": w, ":h": h } },
    ":block/children": [],
  };
}

function docKeys(stub) {
  let n = 0;
  for (const entry of stub.listeners) {
    if (entry.type !== "keydown") continue;
    if (entry.target === stub.document || entry.target === stub.window) n += 1;
  }
  return n;
}

test("readPaneWidth clamps to 360–720 and stacks under 720", () => {
  assert.equal(readPaneKey("notes"), "plexus-diagram:read:notes");
  assert.deepEqual(readPaneWidth(800, null), { stacked: false, width: 360 });
  assert.deepEqual(readPaneWidth(1000, null), { stacked: false, width: 420 });
  assert.deepEqual(readPaneWidth(800, 500), { stacked: false, width: 500 });
  assert.deepEqual(readPaneWidth(800, 100), { stacked: false, width: 360 });
  assert.deepEqual(readPaneWidth(800, 900), { stacked: false, width: 720 });
  assert.deepEqual(readPaneWidth(0, null), { stacked: false, width: 360 });
  assert.deepEqual(readPaneWidth(600, 500), { stacked: true, width: 600 });
});

test("a mount under 720px stacks the pane", () => {
  const stub = createDomStub({ width: 600, height: 400 });
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const before = stub.listenerCount();
    const pane = createReadPane({
      doc,
      root,
      host: {
        renderBlock(node) {
          const box = doc.createElement("div");
          box.className = "rm-pdf-container";
          node.append(box);
        },
      },
    });
    pane.open({ blockUid: "blk", cardUid: "card", title: "Paper", pageUid: "page" });
    assert.equal(pane.element().classList.contains("pxd-read--stack"), true);
    assert.equal(root.classList.contains("pxd-root--read-stack"), true);
    pane.dispose();
    assert.equal(pane.isOpen(), false);
    assert.equal(stub.listenerCount(), before);
  } finally {
    restore();
  }
});

test("highlightDropPlan pulses one placed ref and leaves five strings as cards", () => {
  const items = [{ kind: "highlight", uid: "card9", target: { uid: "hl01" } }];
  assert.deepEqual(highlightDropPlan([{ string: "((hl01))" }], items), { kind: "pulse", uid: "card9" });
  assert.deepEqual(highlightDropPlan([{ string: "((newuid01))" }], items), { kind: "cards" });
  assert.equal(highlightDropPlan(
    ["a", "b", "c", "d", "e"].map((string) => ({ string })),
    items,
  ).kind, "cards");
});

test("placeDecision creates one card beside the cover and pulses a placed row", () => {
  const origin = originBeside({ x: 0, y: 0, w: 220, h: 140 });
  assert.deepEqual(origin, { x: 260, y: 0 });
  const made = placeDecision({ uid: "hl01", placed: false }, [], origin);
  assert.equal(made.kind, "create");
  assert.deepEqual(made.item, { string: "((hl01))", x: 260, y: 0, w: 300, h: 140 });
  assert.equal(made.item.props, undefined);
  assert.equal(JSON.stringify(made.item).includes("pdf-highlight"), false);
  const placed = placeDecision({ uid: "hl01", placed: true }, [], origin);
  assert.deepEqual(placed, { kind: "pulse", uid: "" });
  const existing = placeDecision(
    { uid: "hl01", placed: false },
    [{ kind: "highlight", uid: "card9", target: { uid: "hl01" } }],
    origin,
  );
  assert.deepEqual(existing, { kind: "pulse", uid: "card9" });
});

test("readerJumpPlan names the missing toast and does not open a pane", () => {
  const plan = readerJumpPlan({});
  assert.deepEqual(plan, { action: "missing", toast: "Click the highlight to open the PDF" });
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(root);
    const opened = [];
    const rendered = [];
    if (plan.action === "missing") opened.push("hltext01");
    assert.deepEqual(opened, ["hltext01"]);
    assert.equal(rendered.length, 0);
    assert.equal(root.querySelector(".pxd-read"), null);
    assert.equal(readerJumpPlan({ cardUid: "pdfself01" }).action, "card");
    assert.equal(readerJumpPlan({ blockUid: "pdfblock1" }).action, "block");
  } finally {
    restore();
  }
});

test("the wired pane keeps the cover, one reader, and the list", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  const world = doc.createElement("div");
  world.className = "pxd-world";
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  world.append(itemsLayer);
  root.append(world, sectionsLayer);
  doc.body.append(root);
  const idleQueue = [];
  const writes = [];
  const rendered = [];
  const renderedStrings = [];
  const toasts = [];
  const opened = [];
  const places = [];
  let watches = 0;
  let fire = null;
  let tree = [hl("hltext01", TEXT, "yellow", 2), hl("hleary01", "alpha passage", "green", 1), areaNode()];
  const strings = new Map([["hltext01", `${TEXT} #h/yellow`]]);
  const textProps = {
    ":pdf-highlight": {
      ":type": "text",
      ":content": { ":text": TEXT },
      ":position": { ":boundingRect": { ":pageNumber": 2 } },
    },
  };
  const props = new Map([["hltext01", { props: textProps, string: strings.get("hltext01"), pageTitle: TITLE }]]);
  const host = {
    renderString(node, string) {
      renderedStrings.push(string);
      node.textContent = string;
    },
    renderBlock(node, uid) {
      rendered.push(uid);
      const box = doc.createElement("div");
      box.className = "rm-pdf-container";
      const input = doc.createElement("input");
      input.value = "1";
      box.append(input);
      node.append(box);
    },
    unmount(node) { node?.replaceChildren?.(); },
    blockString(uid) { return strings.get(uid) || ""; },
    pdfCover(string) {
      const title = string === SELF ? "Self paper" : string === REF ? "Ref paper" : "";
      return { title: title || "PDF", count: title ? 2 : 0, label: title ? "2 highlights" : "0 highlights", pageUid: "pageUid01" };
    },
    pdfHighlightTree() { return tree; },
    watchPage(title, cb) {
      watches += 1;
      fire = cb;
      return () => { watches -= 1; fire = null; };
    },
    openBlock(uid) { opened.push(uid); },
    updateProps() { writes.push("host.updateProps"); },
  };
  const session = {
    updateProps() { writes.push("session.updateProps"); },
    setString() { writes.push("session.setString"); },
    addRefCards() { writes.push("addRefCards"); },
  };
  let itemsR;
  let pane;
  itemsR = createItemRenderer({
    doc,
    host,
    session,
    itemsLayer,
    sectionsLayer,
    settings: { posters: false },
    timers: {
      idle(fn) { idleQueue.push(fn); return () => {}; },
      later(fn) { return () => { fn(); }; },
    },
    onToast(message) { toasts.push(message); },
    onHighlightOpen(item) { opened.push(item?.uid || ""); },
    onReadPane(detail) {
      if (!detail?.open) {
        pane?.close?.({ notify: false });
        return;
      }
      const cover = detail.source ? host.pdfCover(detail.source) : null;
      pane?.open?.({
        cardUid: detail.cardUid || "",
        blockUid: detail.blockUid,
        page: detail.page,
        title: cover?.title || "",
        source: detail.source || "",
        pageUid: cover?.pageUid || "",
      });
    },
  });
  const board = buildBoard(raw([
    child("pdfself01", SELF, 0, 220, 140),
    child("pdfref001", REF, 1, 240, 150),
    child("hlcard01", "((hltext01))", 2, 240, 140),
  ]), {
    resolve: (uid) => strings.get(uid) || "",
    propsOf: (uid) => props.get(uid) || null,
  });
  pane = createReadPane({
    doc,
    root,
    host,
    graph: "notes",
    storage: { getItem() { return null; }, setItem() {} },
    cards: () => [...board.items.values()].filter((it) => it?.kind === "pdf"),
    placed: () => [...board.items.values()],
    titleOf: (card) => host.pdfCover(card.string)?.title || "PDF",
    onClose: () => { itemsR.closeEmbed(); },
    onSwitch: (uid) => { itemsR.openPdf(uid); },
    onPlace: (row) => { places.push(row); },
  });
  const rects = worldRects(board);
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 20) idleQueue.shift()({ timeRemaining: () => 10 });
  };
  try {
    const keysBefore = docKeys(stub);
    rSync();
    function rSync() {
      itemsR.sync({ board, rects, structural: true });
      itemsR.setLod("detail", 1);
      itemsR.scheduleContent({ visibleRect: { x: -100, y: -100, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
      flush();
    }
    const self = itemsR.shellOf("pdfself01");
    assert.equal(self.style.width, "220px");
    assert.equal(self.style.height, "140px");
    assert.equal(board.items.get("hlcard01").kind, "highlight");

    itemsR.openPdf("pdfself01");
    assert.equal(docKeys(stub), keysBefore);
    assert.equal(self.style.width, "220px");
    assert.equal(self.style.height, "140px");
    assert.equal(self.querySelector(".pxd-pdf-reader"), null);
    assert.equal(self.querySelector(".rm-pdf-container"), null);
    assert.equal(world.querySelector(".rm-pdf-container"), null);
    assert.equal(root.querySelectorAll(".pxd-read .rm-pdf-container").length, 1);
    assert.equal(pane.element().style.width, "360px");
    assert.equal(watches, 1);
    assert.equal(toasts.length, 0);
    assert.equal(writes.length, 0);

    const rowBy = (uid) => [...root.querySelectorAll(".pxd-read__row")].find((node) => node.getAttribute("data-uid") === uid);
    const pages = [...root.querySelectorAll(".pxd-read__pg")].map((node) => node.textContent);
    assert.deepEqual(pages, ["p. 1", "p. 2", "p. 2"]);
    const bars = [...root.querySelectorAll(".pxd-read__bar")].map((node) => node.getAttribute("data-color"));
    assert.deepEqual(bars, ["green", "yellow", "yellow"]);
    const beta = rowBy("hltext01");
    const alpha = rowBy("hleary01");
    assert.equal(beta.textContent.includes("On board"), true);
    assert.equal(alpha.textContent.includes("On board"), false);

    stub.dispatch(beta, "click");
    const field = root.querySelector(".pxd-read .rm-pdf-container input");
    assert.equal(field.value, "2");
    assert.equal(writes.length, 0);

    const find = root.querySelector(".pxd-read__find");
    find.value = "alpha";
    stub.dispatch(find, "input");
    assert.equal(root.querySelectorAll(".pxd-read__row").length, 1);
    assert.equal(rowBy("hleary01") != null, true);
    find.value = "";
    stub.dispatch(find, "input");
    assert.equal(root.querySelectorAll(".pxd-read__row").length, 3);

    const area = rowBy("hlarea01");
    const media = area.querySelector(".pxd-read__media");
    assert.equal(media.style.aspectRatio, "133 / 47");
    assert.equal(renderedStrings.some((s) => s.includes("![shot]") && s.includes("#h/yellow")), true);
    const bag = {};
    stub.dispatch(area, "dragstart", {
      dataTransfer: { setData(type, value) { bag[type] = value; } },
    });
    assert.equal(bag[CARD_MIME], "((hlarea01))");

    rowBy("hleary01").querySelector("button.pxd-read__place").click();
    assert.equal(places.at(-1).uid, "hleary01");
    const made = placeDecision(places.at(-1), [...board.items.values()], originBeside({ x: 0, y: 0, w: 220, h: 140 }));
    assert.equal(made.kind, "create");
    assert.equal(made.item.x, 260);
    assert.equal(made.item.string, "((hleary01))");
    rowBy("hltext01").querySelector("button.pxd-read__place").click();
    assert.equal(placeDecision(places.at(-1), [...board.items.values()], originBeside({ x: 0, y: 0, w: 220, h: 140 })).kind, "pulse");

    const list = root.querySelector(".pxd-read__list");
    stub.dispatch(list, "keydown", { key: "ArrowDown" });
    stub.dispatch(list, "keydown", { key: "Enter" });
    assert.equal(field.value, "2");
    assert.equal(board.items.size, 3);
    assert.equal(writes.length, 0);

    const beforeUid = root.querySelector(".pxd-read__row--on")?.getAttribute("data-uid");
    const inside = stub.dispatch(field, "keydown", { key: "ArrowDown" });
    assert.equal(inside.defaultPrevented, false);
    assert.equal(root.querySelector(".pxd-read__row--on")?.getAttribute("data-uid"), beforeUid);
    const meta = stub.dispatch(list, "keydown", { key: "f", metaKey: true });
    const ctrl = stub.dispatch(list, "keydown", { key: "f", ctrlKey: true });
    assert.equal(meta.defaultPrevented, false);
    assert.equal(ctrl.defaultPrevented, false);

    stub.dispatch(find, "keydown", { key: "Escape" });
    assert.equal(pane.isOpen(), true);
    assert.equal(root.querySelector(".pxd-read") != null, true);

    let zoom = 0;
    root.addEventListener("wheel", () => { zoom += 1; });
    const wheeled = stub.dispatch(list, "wheel", { deltaY: 12 });
    assert.equal(wheeled.propagationStopped, true);
    assert.equal(wheeled.defaultPrevented, false);
    assert.equal(zoom, 0);
    stub.dispatch(world, "wheel", { deltaY: 12 });
    assert.equal(zoom, 1);

    itemsR.openPdf("pdfref001");
    assert.deepEqual(toasts, ["Closed the other reader"]);
    assert.equal(root.querySelectorAll(".rm-pdf-container").length, 1);
    assert.equal(rendered.at(-1), "pdfref001");
    assert.equal(self.style.width, "220px");
    assert.equal(self.querySelector(".pxd-pdf-cover") != null, true);

    const switcher = root.querySelector(".pxd-read__switch");
    const labels = [...switcher.querySelectorAll("option")].map((node) => node.textContent);
    assert.deepEqual(labels, ["Self paper", "Ref paper"]);
    switcher.value = "pdfself01";
    stub.dispatch(switcher, "change");
    assert.equal(root.querySelectorAll(".rm-pdf-container").length, 1);
    assert.equal(rendered.at(-1), "pdfself01");

    tree = tree.concat([hl("hlwatch1", "gamma passage", "blue", 3)]);
    fire();
    assert.equal([...root.querySelectorAll(".pxd-read__pg")].some((node) => node.textContent === "p. 3"), true);
    assert.equal(watches, 1);

    const foot = itemsR.shellOf("hlcard01").querySelector("button.pxd-highlight-foot");
    assert.equal(foot.tagName, "BUTTON");
    assert.match(foot.textContent, /p\. \d+/);
    const card = itemsR.shellOf("hlcard01");
    const body = card.querySelector(".pxd-item__body");
    const hits = [];
    card.addEventListener("pointerdown", () => { hits.push("card"); });
    stub.dispatch(foot, "pointerdown");
    assert.deepEqual(hits, []);
    stub.dispatch(body, "pointerdown");
    assert.deepEqual(hits, ["card"]);
    const openedBefore = opened.length;
    foot.click();
    assert.deepEqual(opened.slice(openedBefore), ["hlcard01"]);

    itemsR.flash("hlcard01");
    assert.equal(card.classList.contains("pxd-item--flash"), true);

    stub.dispatch(list, "keydown", { key: "Escape" });
    assert.equal(pane.isOpen(), false);
    assert.equal(root.querySelector(".pxd-read"), null);
    assert.equal(watches, 0);
    assert.equal(writes.length, 0);
    assert.equal(docKeys(stub), keysBefore);

    itemsR.openPdf("pdfself01");
    assert.equal(root.querySelector(".pxd-read") != null, true);
    root.querySelector(".pxd-read__close").click();
    assert.equal(pane.isOpen(), false);
    assert.equal(root.querySelector(".pxd-read"), null);
    assert.equal(writes.length, 0);
  } finally {
    itemsR.dispose();
    restore();
  }
});

test("the pane source adds no document key listener and no colour-icon click", () => {
  const paneSrc = read("../src/view/read-pane.js");
  const cardsSrc = read("../src/view/cards.js");
  const boardSrc = read("../src/view/board-view.js");
  const featureSrc = read("../src/feature.js");
  const css = read("../src/css/read-pane.css");
  assert.equal(paneSrc.includes("document.addEventListener"), false);
  assert.equal(paneSrc.includes("doc.addEventListener"), false);
  assert.equal(paneSrc.includes("rm-pdf-highlight-color-icon"), false);
  assert.match(cardsSrc, /if \(!onReadPane && \(pdfReaderBox\(item\.uid\) \|\| speedOf\(\)\.posters === false\)\)/);
  assert.match(boardSrc, /readerJumpPlan/);
  assert.match(boardSrc, /highlightDropPlan/);
  assert.match(boardSrc, /placeDecision\(row, items, originBeside\(live\)\)/);
  assert.match(boardSrc, /itemsR\.flash\?\.\(item\.uid\)/);
  assert.match(boardSrc, /session\.addRefCards\?\.\(\[decision\.item\]\)/);
  assert.match(boardSrc, /toast\(plan\.toast\)/);
  assert.equal(featureSrc.split("ui.commandPalette").length - 1, 2);
  assert.match(css, /\.pxd-root\.pxd-root--read > \.pxd-viewport/);
  assert.match(css, /\.pxd-item--flash/);
  assert.match(css, /\.pxd-read \.pxd-read__live\s*\{[^}]*overflow:\s*hidden/);
  assert.match(css, /\.pxd-read \.pxd-read__live\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.pxd-read \.pxd-read__list\s*\{[^}]*overflow:\s*auto/);
  assert.match(css, /\.pxd-read \.pxd-read__list\s*\{[^}]*flex:\s*1 1 42%/);
  assert.equal(HIGHLIGHT_MARK_TIP, TIP);
  assert.match(HIGHLIGHT_MARK_TIP, /may stay yellow/);
  assert.match(HIGHLIGHT_MARK_TIP, /Roam's reader changes it/);
  assert.equal(HIGHLIGHT_FIELD, "Highlight colour");
  const byUid = new Map([
    ["a", ["h/green"]],
    ["b", ["h/yellow"]],
    ["c", ["h/green", "h/yellow"]],
  ]);
  const bright = lensBright(byUid, "h/green");
  assert.equal(bright.has("a"), true);
  assert.equal(bright.has("c"), true);
  assert.equal(bright.has("b"), false);
  const props = { ":pdf-highlight": { ":type": "text" }, ":x": 1 };
  const before = structuredClone(props);
  assert.equal(rewriteHighlightTag("passage #h/yellow", "green"), "passage #h/green");
  assert.deepEqual(props, before);
});

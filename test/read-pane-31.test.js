// PDF-U3. Pane header, tucked Roam toolbar, pill proxies, fit-once, keys, snapshot.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readPaneKey } from "../src/model/pdf.js";
import { fitDecision, pageIndicator, pillActions } from "../src/model/read-pane-model.js";
import { createReadPane } from "../src/view/read-pane.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

function iconButton(doc, icon) {
  const button = doc.createElement("button");
  button.className = "bp3-button bp3-minimal";
  if (icon) {
    const mark = doc.createElement("span");
    mark.className = icon;
    button.append(mark);
  }
  return button;
}

function unnamedButton(doc) {
  const button = doc.createElement("button");
  button.className = "bp3-button bp3-minimal";
  button.append(doc.createElement("svg"));
  return button;
}

test("pageIndicator reads the page field and the / total beside it", () => {
  assert.deepEqual(pageIndicator("3", "/ 9"), { page: 3, total: 9 });
  assert.deepEqual(pageIndicator(" 3 ", " / 9"), { page: 3, total: 9 });
  assert.deepEqual(pageIndicator("3", "/9"), { page: 3, total: 9 });
  assert.deepEqual(pageIndicator("", ""), { page: null, total: null });
  assert.deepEqual(pageIndicator("3a", "/ 9"), { page: null, total: 9 });
  assert.deepEqual(pageIndicator("0", "/ 9"), { page: null, total: 9 });
});

test("fit runs only after settle, and only when a fit control exists and the user has not zoomed", () => {
  assert.equal(fitDecision({ userZoomed: false, hasFit: true, settled: true }), true);
  assert.equal(fitDecision({ userZoomed: true, hasFit: true, settled: true }), false);
  assert.equal(fitDecision({ userZoomed: false, hasFit: false, settled: true }), false);
  assert.equal(fitDecision({ userZoomed: false, hasFit: true, settled: false }), false);
});

test("pillActions binds the measured zoom, fit and search icons and skips the unnamed button", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const highlight = iconButton(doc, "bp3-icon bp3-icon-highlight");
    const area = iconButton(doc, "bp3-icon bp3-icon-widget");
    const color = doc.createElement("button");
    color.className = "bp3-button bp3-minimal rm-pdf-color-button";
    const eye = iconButton(doc, "bp3-icon bp3-icon-eye-open");
    const zoomOut = iconButton(doc, "bp3-icon bp3-icon-zoom-out");
    const zoomIn = iconButton(doc, "bp3-icon bp3-icon-zoom-in");
    const fit = iconButton(doc, "bp3-icon bp3-icon-zoom-to-fit");
    const unnamed = unnamedButton(doc);
    const prev = iconButton(doc, "bp3-icon bp3-icon-chevron-left");
    const next = iconButton(doc, "bp3-icon bp3-icon-chevron-right");
    const search = iconButton(doc, "bp3-icon bp3-icon-search");
    const full = iconButton(doc, "bp3-icon bp3-icon-fullscreen");
    const more = iconButton(doc, "bp3-icon bp3-icon-more");
    const buttons = [highlight, area, color, eye, zoomOut, zoomIn, fit, unnamed, prev, next, search, full, more];
    assert.equal(buttons.indexOf(unnamed), 7);
    const actions = pillActions(buttons);
    assert.equal(actions.zoomOut, zoomOut);
    assert.equal(actions.zoomIn, zoomIn);
    assert.equal(actions.fit, fit);
    assert.equal(actions.search, search);
    for (const skipped of [unnamed, full, color, highlight, more, eye]) {
      assert.equal(Object.values(actions).includes(skipped), false);
    }
    const custom = pillActions([iconButton(doc, "bp3-icon my-zoom-out")], {
      zoomOut: { icon: "my-zoom-out" },
    });
    assert.equal(custom.zoomOut.className.includes("my-zoom-out") || custom.zoomOut.querySelector("span").className.includes("my-zoom-out"), true);
    assert.equal(custom.zoomIn, null);
  } finally {
    restore();
  }
});

function readerBox(doc, { page = true, pageValue = "3", total = "/ 9" } = {}) {
  const box = doc.createElement("div");
  box.className = "rm-pdf-container";
  const bar = doc.createElement("div");
  bar.className = "rm-pdf-toolbar";
  const buttons = {
    highlight: iconButton(doc, "bp3-icon bp3-icon-highlight"),
    zoomOut: iconButton(doc, "bp3-icon bp3-icon-zoom-out"),
    zoomIn: iconButton(doc, "bp3-icon bp3-icon-zoom-in"),
    fit: iconButton(doc, "bp3-icon bp3-icon-zoom-to-fit"),
    unnamed: unnamedButton(doc),
    search: iconButton(doc, "bp3-icon bp3-icon-search"),
    full: iconButton(doc, "bp3-icon bp3-icon-fullscreen"),
  };
  const hits = { zoomOut: 0, zoomIn: 0, fit: 0, search: 0, unnamed: 0, full: 0, highlight: 0 };
  for (const [name, button] of Object.entries(buttons)) {
    button.click = () => { hits[name] += 1; };
  }
  const input = doc.createElement("input");
  input.className = "bp3-input";
  input.value = pageValue;
  const side = doc.createElement("span");
  side.textContent = total;
  const find = doc.createElement("input");
  find.value = "";
  bar.append(buttons.highlight, buttons.zoomOut, buttons.zoomIn, buttons.fit, buttons.unnamed, input, side, buttons.search, find, buttons.full);
  box.append(bar);
  const scroller = doc.createElement("div");
  scroller.className = "PdfHighlighter";
  box.append(scroller);
  if (page) {
    const leaf = doc.createElement("div");
    leaf.className = "page";
    leaf.setAttribute("data-page-number", pageValue);
    box.append(leaf);
  }
  return { box, buttons, hits, input, find, scroller };
}

test("header, tools class, pill proxies and the page pill", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    let built = null;
    const before = stub.listenerCount();
    const pane = createReadPane({
      doc,
      root,
      graph: "notes",
      host: {
        renderBlock(node) {
          built = readerBox(doc);
          node.append(built.box);
        },
      },
    });
    pane.open({ blockUid: "blk", cardUid: "card", title: "Novel risk", pageUid: "page", source: "{{[[pdf]]: https://example.test/a.pdf}}" });
    const head = root.querySelector(".pxd-read__head");
    assert.ok(head.querySelector(".pxd-read__dot"));
    assert.ok(head.querySelector(".pxd-read__glyph"));
    assert.equal(head.querySelector(".pxd-read__title").textContent, "Novel risk");
    assert.equal(head.querySelector(".pxd-read__switch").tagName, "SELECT");
    assert.equal(head.querySelector(".pxd-read__highlights").getAttribute("aria-label"), "Highlights");
    assert.equal(head.querySelector(".pxd-read__tools").getAttribute("aria-label"), "Tools");
    assert.equal(head.querySelector(".pxd-read__close").getAttribute("aria-label"), "Close");
    assert.equal(root.querySelector(".pxd-read__pages").textContent, "3 / 9");
    assert.equal(built.hits.fit, 1);
    assert.equal(built.hits.unnamed, 0);
    assert.equal(built.hits.full, 0);

    const tools = head.querySelector(".pxd-read__tools");
    tools.click();
    assert.equal(pane.element().classList.contains("pxd-read--tools"), true);
    assert.ok(root.querySelector(".rm-pdf-toolbar"));
    assert.notEqual(root.querySelector(".rm-pdf-toolbar").style.display, "none");
    tools.click();
    assert.equal(pane.element().classList.contains("pxd-read--tools"), false);
    assert.ok(root.querySelector(".rm-pdf-toolbar"));

    const pillBtn = (label) => [...root.querySelectorAll(".pxd-read__pillbtn")].find((node) => node.getAttribute("aria-label") === label);
    pillBtn("Zoom out").click();
    pillBtn("Zoom in").click();
    pillBtn("Fit width").click();
    assert.equal(built.hits.zoomOut, 1);
    assert.equal(built.hits.zoomIn, 1);
    assert.equal(built.hits.fit, 2);
    assert.equal(built.hits.unnamed, 0);
    assert.equal(built.hits.full, 0);
    assert.equal(built.hits.highlight, 0);
    stub.flushTimers();
    assert.equal(built.hits.fit, 2);

    pillBtn("Search").click();
    assert.equal(built.hits.search, 1);
    assert.equal(pane.element().classList.contains("pxd-read--tools"), true);
    assert.equal(doc.activeElement, built.find);
    stub.dispatch(built.find, "focusout");
    assert.equal(pane.element().classList.contains("pxd-read--tools"), false);

    const drawer = root.querySelector(".pxd-read__drawer");
    assert.ok(drawer);
    assert.ok(drawer.querySelector(".pxd-read__list"));
    pane.dispose();
    assert.equal(root.querySelector(".pxd-read"), null);
    assert.equal(stub.listenerCount(), before);
  } finally {
    restore();
  }
});

test("fit is skipped once the user zoomed, and a missing fit control is left alone", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    let showPage = false;
    let built = null;
    const pane = createReadPane({
      doc,
      root,
      host: {
        renderBlock(node) {
          built = readerBox(doc, { page: showPage });
          node.append(built.box);
        },
      },
    });
    pane.open({ blockUid: "blk", cardUid: "card", title: "Paper", pageUid: "page" });
    assert.equal(built.hits.fit, 0);
    const zoomIn = [...root.querySelectorAll(".pxd-read__pillbtn")].find((node) => node.getAttribute("aria-label") === "Zoom in");
    zoomIn.click();
    assert.equal(built.hits.zoomIn, 1);
    const leaf = doc.createElement("div");
    leaf.className = "page";
    built.box.append(leaf);
    stub.flushTimers();
    assert.equal(built.hits.fit, 0);
    pane.dispose();

    showPage = true;
    const bare = createReadPane({
      doc,
      root,
      host: {
        renderBlock(node) {
          const box = doc.createElement("div");
          box.className = "rm-pdf-container";
          const input = doc.createElement("input");
          input.value = "2";
          const leaf = doc.createElement("div");
          leaf.className = "page";
          box.append(input, leaf);
          node.append(box);
        },
      },
    });
    bare.open({ blockUid: "blk2", cardUid: "card2", title: "Paper", pageUid: "page" });
    assert.equal(root.querySelector(".rm-pdf-toolbar"), null);
    bare.dispose();
  } finally {
    restore();
  }
});

test("keys stay on the pane, ignore the reader, and the stub drawer is mounted", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const shots = [];
    const reading = [];
    let hooks = null;
    let toggles = 0;
    let focuses = 0;
    const before = stub.listenerCount();
    const docKeys = () => [...stub.listeners].filter((entry) => entry.type === "keydown" && (entry.target === stub.document || entry.target === stub.window)).length;
    const pane = createReadPane({
      doc,
      root,
      graph: "notes",
      onSnapshot(el, info) { shots.push({ el, info }); },
      onReadingChange(uid) { reading.push(uid); },
      createDrawer(next) {
        hooks = next;
        return {
          refresh() { next.rows(); },
          open() {},
          close() {},
          toggle() { toggles += 1; },
          isOpen: () => toggles % 2 === 1,
          focusSearch() { focuses += 1; },
          setCount() {},
          element: () => next.mount,
          dispose() {},
        };
      },
      host: {
        renderBlock(node) {
          const built = readerBox(doc);
          node.append(built.box);
          node._built = built;
        },
      },
    });
    assert.equal(hooks.mount.classList.contains("pxd-read__drawer"), true);
    assert.equal(hooks.key, readPaneKey("notes"));
    assert.equal(typeof hooks.onLocate, "function");
    assert.equal(typeof hooks.onPlace, "function");
    assert.equal(typeof hooks.onNote, "function");
    pane.open({ blockUid: "blk", cardUid: "cardA", title: "Paper", pageUid: "page", source: "https://example.test/a.pdf" });
    assert.deepEqual(reading, ["cardA"]);
    assert.equal(shots.length, 1);
    assert.equal(shots[0].info.as, "settle");
    assert.equal(shots[0].info.page, 3);
    assert.equal(shots[0].info.pageCount, 9);
    assert.equal(shots[0].info.url, "https://example.test/a.pdf");
    assert.equal(shots[0].el.classList.contains("pxd-read__live"), true);
    const keys = [...stub.listeners].filter((entry) => entry.type === "keydown");
    assert.equal(keys.length, 1);
    assert.equal(keys[0].target, pane.element());
    assert.equal(docKeys(), 0);

    const page = root.querySelector(".page");
    const field = root.querySelector(".rm-pdf-container input");
    stub.dispatch(page, "keydown", { key: "[" });
    stub.dispatch(page, "keydown", { key: "/" });
    stub.dispatch(page, "keydown", { key: "h" });
    stub.dispatch(page, "keydown", { key: "Escape" });
    assert.equal(field.value, "3");
    assert.equal(focuses, 0);
    assert.equal(toggles, 0);
    assert.equal(pane.isOpen(), true);

    const title = root.querySelector(".pxd-read__title");
    stub.dispatch(title, "keydown", { key: "[", metaKey: true });
    assert.equal(field.value, "3");
    stub.dispatch(title, "keydown", { key: "[" });
    assert.equal(field.value, "2");
    stub.dispatch(title, "keydown", { key: "]" });
    assert.equal(field.value, "3");
    field.value = "9";
    stub.dispatch(title, "keydown", { key: "]" });
    assert.equal(field.value, "9");
    field.value = "1";
    stub.dispatch(title, "keydown", { key: "[" });
    assert.equal(field.value, "1");
    stub.dispatch(title, "keydown", { key: "/" });
    stub.dispatch(title, "keydown", { key: "h" });
    assert.equal(focuses, 1);
    assert.equal(toggles, 1);
    assert.equal(root.querySelector(".pxd-read__highlights").getAttribute("aria-pressed"), "true");

    hooks.onLocate({ uid: "hl1", page: 4 });
    assert.equal(root.querySelector(".bp3-input").value, "4");

    pane.open({ blockUid: "blk2", cardUid: "cardB", title: "Other", pageUid: "page" });
    assert.deepEqual(reading, ["cardA", "cardB"]);
    pane.close({ notify: false });
    assert.equal(reading.at(-1), "");
    const closed = shots.filter((shot) => shot.info.as === "close");
    assert.equal(closed.length, 1);
    pane.dispose();
    assert.equal(shots.filter((shot) => shot.info.as === "close").length, 1);
    assert.equal(root.querySelector(".pxd-read"), null);
    assert.equal(stub.listenerCount(), before);
    assert.equal(docKeys(), 0);
  } finally {
    restore();
  }
});

test("the pane source adds no document listener and the toolbar is tucked without display none", () => {
  const paneSrc = read("../src/view/read-pane.js");
  const css = read("../src/css/read-pane.css");
  assert.equal(paneSrc.includes("document.addEventListener"), false);
  assert.equal(paneSrc.includes("doc.addEventListener"), false);
  assert.equal(paneSrc.includes("setPointerCapture"), false);
  assert.equal(paneSrc.includes("rm-pdf-highlight-color-icon"), false);
  assert.match(paneSrc, /import\("\.\/read-drawer\.js"\)/);
  assert.match(paneSrc, /createReadDrawer/);
  assert.match(css, /top:\s*var\(--pxd-tabs-h,\s*0px\)/);
  assert.match(css, /cubic-bezier\(\.2,\s*\.7,\s*\.2,\s*1\)/);
  assert.match(css, /\.pxd-root\.pxd-root--motion-off\s*\{[^}]*--pxd-pdf-ms:\s*0ms/);
  const tucked = css.match(/\.pxd-read \.rm-pdf-toolbar\s*\{[^}]*\}/);
  assert.ok(tucked);
  assert.match(tucked[0], /height:\s*0/);
  assert.match(tucked[0], /visibility:\s*hidden/);
  assert.equal(tucked[0].includes("display"), false);
  assert.match(css, /\.pxd-read\.pxd-read--tools \.rm-pdf-toolbar\s*\{[^}]*height:\s*40px/);
  assert.match(css, /\.pxd-read \.pxd-read__live\s*\{[^}]*overflow:\s*hidden/);
  assert.match(css, /\.pxd-read \.pxd-read__list\s*\{[^}]*flex:\s*1 1 42%/);
});

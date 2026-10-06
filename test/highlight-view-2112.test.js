// PDF-6 / PDF-5 / PDF-3 view wiring. Imports the shipped pick, lens, and view functions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { HIGHLIGHT_COLORS } from "../src/model/highlight.js";
import { expandDateHighlights, highlightRows, placeHighlights } from "../src/model/highlight-pick.js";
import { highlightLensTag } from "../src/model/lens.js";
import { DEFAULT_SIZES, PAGE_CARD } from "../src/model/schema.js";
import {
  PDF_HIGHLIGHTS_LABEL,
  dateDropExpansion,
  highlightPickerList,
  isDateBlockString,
  lensRowLabel,
  openHighlightDialog,
  pdfHighlightButton,
  planDroppedCards,
} from "../src/view/board-view.js";
import { createChrome } from "../src/view/chrome.js";
import { HIGHLIGHT_MARK_TIP, buildColorPicker } from "../src/view/color-picker.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const TIP = "The card and the list follow the tag. The mark inside the PDF keeps the colour Roam painted.";
const timers = { later: () => () => {}, frame: () => () => {} };
const boardSrc = readFileSync(new URL("../src/view/board-view.js", import.meta.url), "utf8");

function highlightBlock(uid, { text, color, page, plain = false } = {}) {
  const body = text ?? uid;
  const name = color ?? "yellow";
  const props = plain
    ? { "pdf-highlight": { type: "text", content: { text: body }, position: { boundingRect: { pageNumber: page } } } }
    : {
      ":pdf-highlight": {
        ":type": "text",
        ":content": { ":text": body },
        ":position": { ":boundingRect": { ":pageNumber": page } },
      },
    };
  return { uid, string: `${body} #h/${name}`, props, children: [] };
}

function pageTree() {
  const spec = [
    ["hl01", "passage one", "yellow", 2],
    ["hl02", "passage two", "green", 2],
    ["hl03", "passage three", "blue", 3],
    ["hl04", "passage four", "pink", 3],
    ["hl05", "passage five", "purple", 4],
    ["hl06", "passage six", "orange", 4],
    ["hl07", "passage seven", "red", 5],
  ];
  const blocks = spec.map(([uid, text, color, page], index) => highlightBlock(uid, {
    text, color, page, plain: index === 6,
  }));
  return [{
    uid: "pdfpage",
    string: "[[Risk model.pdf]]",
    props: {},
    children: [{
      uid: "notes",
      string: "Notes by [[Svy]]",
      props: {},
      children: [
        { uid: "oct5", string: "[[October 5th, 2026]]", props: {}, children: blocks.slice(0, 5) },
        { uid: "oct4", string: "[[October 4th, 2026]]", props: {}, children: blocks.slice(5) },
      ],
    }],
  }];
}

function placedCards() {
  return [
    { uid: "card-hl06", target: { uid: "hl06" } },
    { uid: "card-hl07", target: { uid: "hl07" } },
  ];
}

function dateBlock() {
  return {
    uid: "oct5",
    string: "[[October 5th, 2026]]",
    children: [
      highlightBlock("h1", { text: "a", color: "yellow", page: 1 }),
      highlightBlock("h2", { text: "b", color: "green", page: 1 }),
    ],
  };
}

const CARD = DEFAULT_SIZES.card;
const AT = { x: 400, y: 300 };

function withDom(fn) {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    return fn(stub);
  } finally {
    restore();
  }
}

test("picker list is 5 enabled of 7 when two target uids are placed", () => {
  const rows = highlightRows(pageTree(), { placed: placedCards() });
  const list = highlightPickerList(rows);
  assert.equal(list.length, 7);
  assert.equal(list.filter((row) => row.enabled).length, 5);
  assert.equal(list.filter((row) => row.disabled && row.checked && row.placed).length, 2);
  assert.deepEqual(list.filter((row) => row.placed).map((row) => row.uid), ["hl06", "hl07"]);
  const byCardUid = highlightRows(pageTree(), {
    placed: [
      { uid: "hl06", target: { uid: "card-hl06" } },
      { uid: "hl07", target: { uid: "card-hl07" } },
    ],
  });
  assert.equal(byCardUid.some((row) => row.placed), false);
  assert.equal(PDF_HIGHLIGHTS_LABEL, "Add highlights\u2026");
});

test("the PDF header button label is Add highlights…", () => {
  withDom((stub) => {
    const btn = pdfHighlightButton(stub.document, () => {});
    assert.equal(btn.textContent, "Add highlights\u2026");
    assert.equal(btn.getAttribute("aria-label"), PDF_HIGHLIGHTS_LABEL);
    assert.equal(btn.classList.contains("pxd-pdf-highlights"), true);
  });
});

test("the dialog checks placed rows, filters, and places the unplaced refs", () => {
  withDom((stub) => {
    let confirms = 0;
    stub.window.confirm = () => { confirms += 1; return true; };
    const rows = highlightRows(pageTree(), { placed: placedCards() });
    const origin = { x: 100, y: 200 };
    let placedItems = null;
    const dialog = openHighlightDialog(stub.document, {
      rows,
      origin,
      onPlace: (items) => { placedItems = items; },
    });
    stub.document.body.append(dialog);
    const checks = [...dialog.querySelectorAll(".pxd-hl-check")];
    assert.equal(checks.length, 7);
    assert.equal(checks.filter((box) => box.disabled !== true).length, 5);
    const disabled = checks.filter((box) => box.disabled === true);
    assert.equal(disabled.length, 2);
    assert.equal(disabled.every((box) => box.checked === true), true);
    assert.deepEqual(
      [...dialog.querySelectorAll(".pxd-hl-group")].map((node) => node.textContent),
      ["[[October 5th, 2026]]", "[[October 4th, 2026]]"],
    );
    const first = dialog.querySelector(".pxd-hl-row");
    assert.equal(first.querySelector(".pxd-hl-bar").getAttribute("data-color"), "yellow");
    assert.equal(first.querySelector(".pxd-hl-rowpage").textContent, "p. 2");
    assert.equal(first.querySelector(".pxd-hl-row__text").textContent, "passage one");
    assert.deepEqual(
      [...dialog.querySelectorAll('[data-enabled="false"]')].map((row) => row.getAttribute("data-uid")),
      ["hl06", "hl07"],
    );

    dialog.querySelector(".pxd-hl-grid").click();
    assert.equal(placedItems, null);
    assert.equal(dialog.parentElement, stub.document.body);

    const pageSel = dialog.querySelector(".pxd-hl-page");
    pageSel.value = "4";
    pageSel.dispatchEvent({ type: "change" });
    assert.deepEqual(
      [...dialog.querySelectorAll(".pxd-hl-row")].map((row) => row.getAttribute("data-uid")),
      ["hl05", "hl06"],
    );
    dialog.querySelector(".pxd-hl-all").click();
    dialog.querySelector(".pxd-hl-grid").click();
    const pageItems = placeHighlights(
      rows.map((row) => ({ ...row, selected: row.uid === "hl05" })),
      { mode: "grid", origin },
    ).items;
    assert.deepEqual(placedItems, pageItems);
    assert.deepEqual(placedItems.map((item) => item.string), ["((hl05))"]);
    assert.equal(confirms, 0);
  });
});

test("place as grid and place as column call placeHighlights and skip placed rows", () => {
  withDom((stub) => {
    const rows = highlightRows(pageTree(), { placed: placedCards() });
    const origin = { x: 100, y: 200 };
    const open = () => {
      let placedItems = null;
      const dialog = openHighlightDialog(stub.document, {
        rows,
        origin,
        onPlace: (items) => { placedItems = items; },
      });
      stub.document.body.append(dialog);
      return {
        dialog,
        take: () => placedItems,
      };
    };
    const selected = rows.map((row) => ({ ...row, selected: row.placed !== true }));
    const grid = open();
    grid.dialog.querySelector(".pxd-hl-all").click();
    grid.dialog.querySelector(".pxd-hl-grid").click();
    assert.deepEqual(grid.take(), placeHighlights(selected, { mode: "grid", origin }).items);
    assert.equal(grid.take().some((item) => item.string === "((hl06))" || item.string === "((hl07))"), false);
    assert.equal(new Set(grid.take().map((item) => item.x)).size, 3);

    const column = open();
    const colorSel = column.dialog.querySelector(".pxd-hl-color");
    colorSel.value = "pink";
    colorSel.dispatchEvent({ type: "change" });
    assert.deepEqual(
      [...column.dialog.querySelectorAll(".pxd-hl-row")].map((row) => row.getAttribute("data-uid")),
      ["hl04"],
    );
    column.dialog.querySelector(".pxd-hl-all").click();
    column.dialog.querySelector(".pxd-hl-column").click();
    const columnItems = placeHighlights(
      rows.map((row) => ({ ...row, selected: row.uid === "hl04" })),
      { mode: "column", origin },
    ).items;
    assert.deepEqual(column.take(), columnItems);
    assert.equal(new Set(column.take().map((item) => item.x)).size, 1);
  });
});

test("highlight swatches are the seven names first and do not call onPick", () => {
  withDom((stub) => {
    const picked = [];
    const highlighted = [];
    const box = buildColorPicker(stub.document, (color) => picked.push(color), null, {
      onHighlight: (name) => highlighted.push(name),
    });
    const labels = [...box.querySelectorAll("button")]
      .map((btn) => btn.getAttribute("aria-label"))
      .filter((label) => String(label).startsWith("#h/"));
    assert.deepEqual(labels, HIGHLIGHT_COLORS.map((name) => `#h/${name}`));
    assert.equal(box.querySelector(".pxd-picker__cap").textContent, "Highlight");
    const pink = box.querySelector('[aria-label="#h/pink"]');
    assert.equal(pink.getAttribute("title"), TIP);
    assert.equal(pink.getAttribute("data-tip-extra"), HIGHLIGHT_MARK_TIP);
    assert.equal(HIGHLIGHT_MARK_TIP, TIP);
    pink.click();
    assert.deepEqual(highlighted, ["pink"]);
    assert.deepEqual(picked, []);
    const plain = buildColorPicker(stub.document, (color) => picked.push(color));
    assert.equal(plain.querySelector(".pxd-picker__cap").textContent, "Colors");
    assert.equal(plain.querySelector('[aria-label="#h/yellow"]'), null);
  });
});

test("Mark region shows for an image and an area highlight, and the colour row calls setHighlightColor", () => {
  withDom((stub) => {
    const calls = [];
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(root);
    const chrome = createChrome({
      doc: stub.document,
      root,
      version: "2.11.2",
      settings: {},
      timers,
      on: {
        markRegion: () => calls.push("mark"),
        setColor: (color) => calls.push(["setColor", color]),
        setHighlightColor: (name) => calls.push(["setHighlightColor", name]),
      },
    });
    const show = (model) => {
      chrome.ctx.show("card", model, () => ({ kind: "card", rect: { x: 40, y: 40, w: 120, h: 80 } }));
      return root.querySelector(".pxd-ctx__mark-region");
    };
    const image = show({ kind: "image" });
    assert.equal(image?.getAttribute("aria-label"), "Mark region");
    image.click();
    assert.deepEqual(calls, ["mark"]);
    assert.ok(show({ kind: "highlight", highlight: { image: true } }));
    assert.equal(show({ kind: "highlight", highlight: { image: false } }), null);
    assert.equal(show({ kind: "highlight", highlight: { image: "https://example.test/a.png" } }), null);
    for (const kind of ["note", "block", "page", "board"]) assert.equal(show({ kind }), null, kind);

    show({ kind: "highlight", highlight: { image: false, color: "yellow" } });
    root.querySelector(".pxd-ctx__color").click();
    const picker = root.querySelector(".pxd-picker");
    assert.equal(picker.querySelector(".pxd-picker__cap").textContent, "Highlight");
    assert.deepEqual(
      [...picker.querySelectorAll("button")].map((btn) => btn.getAttribute("aria-label")).filter((label) => String(label).startsWith("#h/")),
      HIGHLIGHT_COLORS.map((name) => `#h/${name}`),
    );
    picker.querySelector('[aria-label="#h/green"]').click();
    assert.deepEqual(calls.at(-1), ["setHighlightColor", "green"]);
    assert.equal(calls.some((entry) => Array.isArray(entry) && entry[0] === "setColor"), false);

    show({ kind: "note" });
    root.querySelector(".pxd-ctx__color").click();
    assert.equal(root.querySelector(".pxd-picker__cap").textContent, "Colors");
    assert.equal(root.querySelector('[aria-label="#h/yellow"]'), null);
  });
});

test("a date block confirms and places highlight refs; a page and a bullet stay one card", () => {
  const block = dateBlock();
  const uids = expandDateHighlights(block);
  assert.deepEqual(uids, ["h1", "h2"]);
  const expansion = dateDropExpansion("((oct5))", block);
  assert.deepEqual(expansion.uids, uids);
  assert.equal(expansion.message, `Add ${uids.length} highlights under this date?`);
  assert.equal(dateDropExpansion("[[October 5th, 2026]]", block), null);
  assert.equal(dateDropExpansion("[[Notes]]", block), null);
  assert.equal(isDateBlockString("[[October 5th, 2026]]"), true);
  assert.equal(isDateBlockString("[[Notes]]"), false);

  const messages = [];
  const planned = planDroppedCards([{ string: "((oct5))" }], {
    blockOf: () => block,
    confirm: (message) => { messages.push(message); return true; },
    card: CARD,
    page: PAGE_CARD,
    at: AT,
  });
  assert.deepEqual(messages, ["Add 2 highlights under this date?"]);
  assert.equal(planned.some((row) => row.string.includes("oct5")), false);
  assert.deepEqual(planned, [
    { string: "((h1))", x: AT.x - CARD.w / 2, y: AT.y - CARD.h / 2 },
    { string: "((h2))", x: AT.x - CARD.w / 2, y: AT.y - CARD.h / 2 + CARD.h + 24 },
  ]);

  assert.equal(planDroppedCards([{ string: "((oct5))" }, { string: "[[Notes]]" }], {
    blockOf: () => block,
    confirm: () => false,
    card: CARD,
    page: PAGE_CARD,
    at: AT,
  }), null);
  assert.equal(planDroppedCards([{ string: "((oct5))" }], {
    blockOf: () => block,
    card: CARD,
    page: PAGE_CARD,
    at: AT,
  }), null);

  let asked = 0;
  const ask = () => { asked += 1; return true; };
  const page = planDroppedCards([{ string: "[[Notes]]" }], {
    blockOf: () => block,
    confirm: ask,
    card: CARD,
    page: PAGE_CARD,
    at: AT,
  });
  assert.equal(asked, 0);
  assert.deepEqual(page, [{
    string: "[[Notes]]",
    x: AT.x - PAGE_CARD.w / 2,
    y: AT.y - CARD.h / 2,
    w: PAGE_CARD.w,
    h: PAGE_CARD.h,
  }]);
  const datePage = planDroppedCards([{ string: "[[October 5th, 2026]]" }], {
    blockOf: () => block,
    confirm: ask,
    card: CARD,
    page: PAGE_CARD,
    at: AT,
  });
  assert.equal(asked, 0);
  assert.equal(datePage[0].string, "[[October 5th, 2026]]");
  assert.equal(datePage[0].w, PAGE_CARD.w);

  const bullet = {
    uid: "hl01",
    string: "passage one #h/yellow",
    children: block.children,
  };
  assert.ok(expandDateHighlights(bullet));
  assert.equal(dateDropExpansion("((hl01))", bullet), null);
  const one = planDroppedCards([{ string: "((hl01))" }], {
    blockOf: () => bullet,
    confirm: ask,
    card: CARD,
    page: PAGE_CARD,
    at: AT,
  });
  assert.equal(asked, 0);
  assert.deepEqual(one, [{ string: "((hl01))", x: AT.x - CARD.w / 2, y: AT.y - CARD.h / 2 }]);
});

test("lens label is the colour name and data-tag stays h/name", () => {
  const tag = highlightLensTag("pink");
  assert.equal(tag, "h/pink");
  assert.equal(lensRowLabel(tag), "pink");
  assert.equal(lensRowLabel("rg8b"), "#rg8b");
  assert.equal(lensRowLabel("h/gray"), "#h/gray");
  assert.equal(highlightLensTag("gray"), "");
  assert.match(boardSrc, /highlightLensTag\(item\.highlight\?\.color\)/);
  assert.match(boardSrc, /if \(item\?\.kind === "highlight"\) return "";/);
  assert.match(boardSrc, /row\.dataset\.tag = tag/);
  assert.match(boardSrc, /row\.setAttribute\("data-tag", tag\)/);
  assert.match(boardSrc, /row\.textContent = label/);
  assert.match(boardSrc, /const tag = row\.dataset\?\.tag \|\| row\.getAttribute\?\.\("data-tag"\)/);
});

test("colour write, mark region, and the date confirm sit on the shipped paths", () => {
  const colorAt = boardSrc.indexOf("setHighlightColor:");
  const colorBody = boardSrc.slice(colorAt, boardSrc.indexOf("onTag:", colorAt));
  assert.match(colorBody, /session\.setHighlightColor\?\.\(it\.target\.uid, name\)/);
  assert.equal(colorBody.includes("setColor"), false);
  assert.equal(colorBody.includes(".color"), false);

  const markAt = boardSrc.indexOf("markRegion:");
  const markBody = boardSrc.slice(markAt, boardSrc.indexOf("duplicate:", markAt));
  assert.match(markBody, /it\.highlight\?\.image === true/);
  assert.match(markBody, /img\.rm-inline-img/);
  assert.match(markBody, /The image is not ready/);
  assert.match(markBody, /host\.generateUid\(\)/);
  assert.match(markBody, /navigator\.clipboard\.writeText\(\s*`\(\(\$\{uid\}\)\)`\s*\)/);
  assert.match(markBody, /session\.addHighlightRegion\(parentUid, frac, caption, uid\)/);
  assert.match(markBody, /session\.addImageRegion\(\s*cardUid,\s*frac,\s*caption,\s*uid\s*\)/);
  assert.match(markBody, /Region made, ref copied/);
  assert.equal(markBody.includes("await"), false);
  assert.equal(markBody.includes("file.get"), false);
  assert.equal(boardSrc.split("duplicate:").length, 2);

  const dropAt = boardSrc.indexOf("planDroppedCards(list");
  const guardAt = boardSrc.indexOf("if (!planned) return", dropAt);
  const addAt = boardSrc.indexOf("addRefCards?.(planned)", guardAt);
  assert.ok(dropAt > 0 && guardAt > dropAt && addAt > guardAt);
  assert.match(boardSrc, /Add \$\{uids\.length\} highlights under this date\?/);
  assert.match(boardSrc, /highlightRows\(tree, \{ placed \}\)/);
  assert.match(boardSrc, /const placed = \[\.\.\.\(board\(\)\?\.items\.values\(\) \|\| \[\]\)\];/);
});

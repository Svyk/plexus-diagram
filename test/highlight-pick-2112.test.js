// PDF-3: group picker rows, place 5 of 7, leave placed rows out, cap at 45, 3 columns.
import assert from "node:assert/strict";
import test from "node:test";

import { expandDateHighlights, highlightRows, placeHighlights } from "../src/model/highlight-pick.js";

function highlightBlock(uid, { text, color, page, plain = false, children = [] } = {}) {
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
  return { uid, string: `${body} #h/${name}`, props, children };
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
    text,
    color,
    page,
    plain: index === 6,
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

test("a date parent groups the nearest [[...]] ancestor", () => {
  const rows = highlightRows(pageTree(), { placed: new Set(["hl06", "hl07"]) });
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((row) => row.uid), ["hl01", "hl02", "hl03", "hl04", "hl05", "hl06", "hl07"]);
  assert.deepEqual(rows.slice(0, 5).map((row) => row.group), Array(5).fill("[[October 5th, 2026]]"));
  assert.deepEqual(rows.slice(5).map((row) => row.group), ["[[October 4th, 2026]]", "[[October 4th, 2026]]"]);
  assert.equal(rows.some((row) => row.group === "[[Risk model.pdf]]" || row.group === "Notes by [[Svy]]"), false);
  assert.deepEqual(rows[0], {
    uid: "hl01",
    color: "yellow",
    snippet: "passage one",
    page: 2,
    group: "[[October 5th, 2026]]",
    placed: false,
  });
  assert.equal(rows[6].color, "red");
  assert.equal(rows[6].page, 5);
  assert.equal(rows[6].snippet, "passage seven");
  assert.equal(rows[5].placed, true);
  assert.equal(rows[6].placed, true);
});

test("snippet drops the #h token and stops at 80 chars; an unknown name stays gray", () => {
  const long = `${"word ".repeat(30).trim()} #h/Yellow`;
  const rows = highlightRows([
    {
      uid: "long01",
      string: long,
      props: { ":pdf-highlight": { ":type": "text", ":position": { ":boundingRect": { ":pageNumber": 8 } } } },
      children: [],
    },
    {
      uid: "odd01",
      string: "note #h/lime extra",
      props: { "pdf-highlight": { type: "text" } },
      children: [],
    },
  ], { placed: [] });
  assert.equal(rows[0].snippet.includes("#h"), false);
  assert.equal(rows[0].snippet.length, 80);
  assert.equal(rows[0].snippet, "word ".repeat(30).trim().slice(0, 80));
  assert.equal(rows[0].color, "yellow");
  assert.equal(rows[0].page, 8);
  assert.equal(rows[1].color, "gray");
  assert.equal(rows[1].snippet, "note extra");
  assert.equal(rows[1].page, null);
  assert.equal(rows[1].group, "");
  assert.equal(rows[1].placed, false);
});

test("seven rows place five selected in three columns and two placed stay out", () => {
  const rows = highlightRows(pageTree(), {
    placed: [{ target: { uid: "hl06" } }, { target: { uid: "hl07" } }],
  });
  assert.equal(rows.length, 7);
  for (const row of rows) row.selected = !row.placed;
  assert.equal(rows.filter((row) => row.selected).length, 5);
  const placed = placeHighlights(rows, { mode: "grid", origin: { x: 100, y: 200 } });
  assert.equal(placed.omitted, 0);
  assert.equal(placed.items.length, 5);
  assert.deepEqual(placed.items, [
    { string: "((hl01))", x: 100, y: 200, w: 300, h: 140 },
    { string: "((hl02))", x: 424, y: 200, w: 300, h: 140 },
    { string: "((hl03))", x: 748, y: 200, w: 300, h: 140 },
    { string: "((hl04))", x: 100, y: 364, w: 300, h: 140 },
    { string: "((hl05))", x: 424, y: 364, w: 300, h: 140 },
  ]);
  assert.equal(new Set(placed.items.map((item) => item.x)).size, 3);
  assert.equal(placed.items.some((item) => item.string === "((hl06))" || item.string === "((hl07))"), false);
  assert.equal(placed.items.some((item) => Object.prototype.hasOwnProperty.call(item, "color")), false);
  for (const row of rows) row.selected = true;
  const again = placeHighlights(rows, { mode: "grid", origin: { x: 100, y: 200 } });
  assert.equal(again.items.length, 5);
  assert.equal(again.omitted, 0);
  assert.equal(again.items.some((item) => item.string === "((hl06))" || item.string === "((hl07))"), false);
});

test("a column stack shares one x", () => {
  const rows = ["a", "b", "c"].map((uid) => ({ uid, selected: true, placed: false }));
  const { items, omitted } = placeHighlights(rows, { mode: "column", origin: { x: 100, y: 200 } });
  assert.equal(omitted, 0);
  assert.deepEqual(items.map((item) => item.x), [100, 100, 100]);
  assert.deepEqual(items.map((item) => item.y), [200, 364, 528]);
  assert.deepEqual(items.map((item) => item.string), ["((a))", "((b))", "((c))"]);
});

test("50 selected returns 45 and omitted 5", () => {
  const rows = Array.from({ length: 50 }, (_, index) => ({
    uid: `u${index}`,
    selected: true,
    placed: false,
  }));
  rows.push({ uid: "skip", selected: false, placed: false });
  const placed = placeHighlights(rows, { mode: "grid", origin: { x: 0, y: 0 }, cap: 80 });
  assert.equal(placed.items.length, 45);
  assert.equal(placed.omitted, 5);
  assert.equal(placed.items[0].string, "((u0))");
  assert.equal(placed.items[44].string, "((u44))");
  assert.equal(placed.items.some((item) => item.string === "((u45))" || item.string === "((skip))"), false);
  assert.equal(new Set(placed.items.map((item) => item.x)).size, 3);
  const fewer = placeHighlights(rows.slice(0, 10), { cap: 4, origin: { x: 0, y: 0 } });
  assert.equal(fewer.items.length, 4);
  assert.equal(fewer.omitted, 6);
});

test("a block with no highlight children returns null, and a date returns those children", () => {
  assert.equal(expandDateHighlights(null), null);
  assert.equal(expandDateHighlights({ uid: "empty", string: "[[October 5th, 2026]]", children: [] }), null);
  assert.equal(expandDateHighlights({
    uid: "notes",
    string: "Notes by [[Svy]]",
    children: [{ uid: "plain", string: "a note", props: {} }],
  }), null);
  assert.equal(expandDateHighlights({
    uid: "pdfpage",
    string: "[[Risk model.pdf]]",
    children: [{
      uid: "oct5",
      string: "[[October 5th, 2026]]",
      children: [highlightBlock("hl01", { text: "passage", color: "yellow", page: 2 })],
    }],
  }), null);
  assert.equal(expandDateHighlights({
    uid: "hlarea",
    string: "figure #h/pink",
    props: { ":pdf-highlight": { ":type": "area" } },
    children: [{
      uid: "box",
      string: "{{[[plexus-regions]]}}",
      props: { plexus: { type: "regions" } },
      children: [{ uid: "reg1", string: "{{[[plexus-region]]: k=img}", props: {} }],
    }],
  }), null);
  assert.deepEqual(expandDateHighlights({
    uid: "oct5",
    string: "[[October 5th, 2026]]",
    children: [
      highlightBlock("hl01", { text: "one", color: "yellow", page: 2 }),
      { uid: "plain", string: "not a highlight", props: {} },
      highlightBlock("hl02", { text: "two", color: "green", page: 3, plain: true }),
    ],
  }), ["hl01", "hl02"]);
});

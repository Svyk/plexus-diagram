import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createParseActions, freeSpotBeside } from "../src/view/parse-actions.js";
import { cropRect, createCropQueue, dataUrlToBlob } from "../src/view/parse-crop.js";
import { imageKey } from "../src/host/parse-store.js";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function makeDoc() {
  const blocks = {
    h1: { id: "h1", type: "heading", level: 1, page: 1, text: "Intro" },
    p1: { id: "p1", type: "para", page: 1, text: "Hello" },
    h2: { id: "h2", type: "heading", level: 1, page: 2, text: "Methods" },
    p2: { id: "p2", type: "para", page: 2, text: "World" },
    t1: {
      id: "t1", type: "table", page: 2, rows: 2, cols: 2,
      cells: [
        { r: 0, c: 0, rowSpan: 1, colSpan: 2, text: "A" },
        { r: 1, c: 0, text: "b" }, { r: 1, c: 1, text: "c" },
      ],
    },
    t2: { id: "t2", type: "table", page: 3, rows: 1, cols: 1, cells: [{ r: 0, c: 0, text: "x" }] },
    f1: { id: "f1", type: "figure", page: 4, text: "A figure", bbox: [10, 10, 100, 100] },
  };
  return { sha256: "s", engine: "builtin", optsHash: "o", pageCount: 4, blocks, order: Object.keys(blocks) };
}

function setup({ doc = makeDoc(), upload } = {}) {
  const calls = [];
  const toasts = [];
  const selected = [];
  const images = new Map();
  const store = {
    getParse: async () => doc,
    getImage: async (key) => images.get(key) ?? null,
  };
  const session = {
    insertParsedBelow: async (a) => { calls.push(["below", a]); return { ok: true, uids: ["u1", "u2"] }; },
    insertParsedCard: async (a) => { calls.push(["card", a]); return { ok: true, uid: "c1" }; },
    insertParsedTable: async (a) => { calls.push(["table", a]); return { ok: true, uid: "t", path: "grid" }; },
    sendParsedToBoard: async (a) => { calls.push(["send", a]); return { ok: true, uids: ["s1", "s2"] }; },
  };
  const actions = createParseActions({
    session, store, upload,
    placeBeside: () => ({ x: 500, y: 40 }),
    toast: (m) => toasts.push(m),
    select: (u) => selected.push(u),
  });
  return { actions, calls, toasts, selected, images, store };
}

const base = { sha256: "s", engine: "builtin", optsHash: "o", pdfUid: "pdf1" };

test("missing cache toasts and returns ok:false", async () => {
  const { actions, toasts, calls } = setup();
  const miss = createParseActions({ session: {}, store: { getParse: async () => null }, toast: (m) => toasts.push(m) });
  const res = await miss.insertParsedBelow({ ...base, ids: ["p1"] });
  assert.equal(res.ok, false);
  assert.deepEqual(toasts, ["Parse result not found; parse the PDF again"]);
  assert.equal(calls.length, 0);
  assert.ok(actions);
});

test("insertParsedBelow converts ids to markdown and selects uids", async () => {
  const { actions, calls, toasts, selected } = setup();
  const res = await actions.insertParsedBelow({ ...base, ids: ["h1", "p1"], kind: "blocks" });
  assert.equal(res.ok, true);
  assert.equal(calls[0][0], "below");
  assert.equal(calls[0][1].pdfUid, "pdf1");
  assert.match(calls[0][1].markdown, /Intro/);
  assert.match(calls[0][1].markdown, /Hello/);
  assert.equal(calls[0][1].blockEstimate, 2);
  assert.deepEqual(selected, [["u1", "u2"]]);
  assert.deepEqual(toasts, ["Inserted 2 blocks below the PDF"]);
});

test("insertParsedTable passes the table, mode, and position beside the PDF", async () => {
  const { actions, calls, toasts, selected } = setup();
  await actions.insertParsedTable({ ...base, ids: ["t1"], mode: "native", kind: "table" });
  assert.equal(calls[0][0], "table");
  assert.equal(calls[0][1].mode, "native");
  assert.equal(calls[0][1].table.id, "t1");
  assert.equal(calls[0][1].x, 500);
  assert.deepEqual(selected, [["t"]]);
  assert.equal(toasts[0], "Table inserted · Roam Grid with 1 merged cell");
  await actions.insertParsedTable({ ...base, ids: ["t2"] });
  assert.equal(calls[1][1].mode, "auto");
  const none = await actions.insertParsedTable({ ...base, ids: ["p1"] });
  assert.equal(none.ok, false);
});

test("sendParsedToBoard picks sections, a card, or a table", async () => {
  const { actions, calls, toasts } = setup();
  await actions.sendParsedToBoard({ ...base, ids: ["h1", "p1", "h2", "p2"] });
  assert.equal(calls[0][0], "send");
  assert.equal(calls[0][1].sections.length, 2);
  assert.equal(calls[0][1].sections[1].title, "Methods");
  assert.equal(calls[0][1].x, 500);
  assert.equal(toasts.at(-1), "Sent 2 cards to the board");
  await actions.sendParsedToBoard({ ...base, ids: ["p1", "p2"] });
  assert.equal(calls[1][0], "card");
  assert.match(calls[1][1].markdown, /Hello/);
  await actions.sendParsedToBoard({ ...base, ids: ["t1"] });
  assert.equal(calls[2][0], "table");
});

test("insertParsedCard uploads a cached figure crop at insert time", async () => {
  const uploaded = [];
  const { actions, calls, images } = setup({ upload: async (file) => { uploaded.push(file); return "https://x/f.png"; } });
  images.set(imageKey("s", "f1"), PNG);
  const res = await actions.insertParsedCard({ ...base, ids: ["f1"], kind: "figure" });
  assert.equal(res.ok, true);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].name, "figure-p4.png");
  assert.equal(uploaded[0].type, "image/png");
  assert.match(calls[0][1].markdown, /!\[A figure\]\(https:\/\/x\/f\.png\)/);
});

test("figure upload failure or missing crop falls back to caption text", async () => {
  const failing = setup({ upload: async () => { throw new Error("nope"); } });
  failing.images.set(imageKey("s", "f1"), PNG);
  await failing.actions.insertParsedCard({ ...base, ids: ["f1"] });
  assert.match(failing.calls[0][1].markdown, /A figure \(figure, p\. 4\)/);
  assert.doesNotMatch(failing.calls[0][1].markdown, /!\[/);
  const nocrop = setup({ upload: async () => "https://x/y.png" });
  await nocrop.actions.insertParsedCard({ ...base, ids: ["f1"] });
  assert.match(nocrop.calls[0][1].markdown, /A figure \(figure, p\. 4\)/);
});

test("freeSpotBeside steps down past occupied rects", () => {
  const pdf = { x: 0, y: 0, w: 300, h: 400 };
  assert.deepEqual(freeSpotBeside(pdf, { w: 280, h: 160 }, []), { x: 340, y: 0 });
  const spot = freeSpotBeside(pdf, { w: 280, h: 160 }, [{ x: 340, y: 0, w: 280, h: 160 }]);
  assert.deepEqual(spot, { x: 340, y: 200 });
  assert.equal(freeSpotBeside(null, {}, []), null);
});

test("cropRect scales a point bbox into a 2x viewport", () => {
  const r = cropRect([10, 20, 110, 70], 612, 792, 1224, 1584);
  assert.deepEqual(r, { sx: 2, sy: 2, left: 20, top: 40, width: 200, height: 100 });
  assert.equal(cropRect([0, 0], 612, 792, 1224, 1584), null);
  assert.equal(cropRect([0, 0, 5, 5], 612, 792, 0, 0), null);
  assert.equal(cropRect([5, 5, 5, 5], 100, 100, 100, 100).width, 1);
});

test("crop queue runs at most two jobs at once", async () => {
  const q = createCropQueue(2);
  let running = 0;
  let peak = 0;
  const gates = [];
  const jobs = Array.from({ length: 5 }, () => q.add(() => new Promise((resolve) => {
    running += 1; peak = Math.max(peak, running);
    gates.push(() => { running -= 1; resolve(); });
  })));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(gates.length, 2);
  while (gates.length) { gates.shift()(); await new Promise((r) => setTimeout(r, 5)); }
  await Promise.all(jobs);
  assert.equal(peak, 2);
});

test("dataUrlToBlob decodes a base64 PNG", () => {
  const blob = dataUrlToBlob(PNG);
  assert.equal(blob.type, "image/png");
  assert.equal(blob.size, 8);
  assert.equal(dataUrlToBlob("nope"), null);
});

test("board-view hands createReadPane the actions object, not the raw session", () => {
  const src = readFileSync(new URL("../src/view/board-view.js", import.meta.url), "utf8");
  const start = src.indexOf("const makeReadPane = () => (createReadPane({");
  const call = src.slice(start, src.indexOf("onPlace:", start));
  assert.match(call, /session: parseActions\(\),/);
  assert.doesNotMatch(call, /^\s*session,$/m);
  assert.match(src, /createParseActions\(\{[^}]*session,/s);
});

test("board-view gives every parse store the page's IndexedDB, so it sees what the parsed view saved", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/view/board-view.js", import.meta.url), "utf8");
  const calls = src.match(/createParseStore\([^)]*\)/g) || [];
  assert.ok(calls.length >= 2);
  for (const call of calls) assert.match(call, /indexedDB/);
});

import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { createHost } from "../src/host/roam.js";
import { parsedTableSize, isRoamTableString } from "../src/model/roam-table.js";
import {
  PARSE_MIME,
  PARSE_MISSING_TOAST,
  handleParseDrop,
  parseDropPayload,
  planParseInsert,
} from "../src/model/drop.js";
import {
  PARSE_SECTION_CAP,
  acquireSession,
  nestMarkdownUnderFirst,
  resetSessions,
} from "../src/session.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => {
  resetSessions();
  delete globalThis.roamGrid;
});

const dt = (data) => ({
  getData(type) { return data[type] ?? ""; },
  types: Object.keys(data),
});

function bullets(n) {
  let out = "";
  for (let i = 0; i < n; i += 1) out += `- b${i}\n`;
  return out;
}

function wideTree(children) {
  let out = "- root\n";
  for (let i = 0; i < children; i += 1) out += `  - c${i}\n`;
  return out;
}

function setup(extra = []) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "note", props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } },
      ...extra,
    ],
  });
  fake.seedPage({
    uid: "page1",
    title: "Lab",
    children: [
      { uid: "pdf1", string: "{{[[pdf]]: http://x/y.pdf}}" },
      { uid: "old1", string: "keep me" },
    ],
  });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  return { fake, host, session };
}

function table(rows, cols, extra = {}) {
  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) cells.push({ r, c, text: `r${r}c${c}` });
  }
  return { id: "t1", type: "table", rows, cols, headerRows: 0, cells, ...extra };
}

const merged = {
  id: "m1",
  type: "table",
  rows: 2,
  cols: 2,
  headerRows: 1,
  cells: [
    { r: 0, c: 0, text: "H", rowSpan: 1, colSpan: 2 },
    { r: 1, c: 0, text: "A", rowSpan: 1, colSpan: 1 },
    { r: 1, c: 1, text: "B", rowSpan: 1, colSpan: 1 },
  ],
};

function docOf(blocks, order) {
  return { sha256: "sha", engine: "docling", optsHash: "opt", order, blocks };
}

test("parsed table size follows the text, the grid, and the caps", () => {
  const plain = parsedTableSize(table(3, 3));
  assert.equal(plain.w, 3 * 56 + 16);
  assert.equal(plain.h, 28 + 3 * 32 + 8);
  assert.equal(plain.widths, null);
  const five = parsedTableSize(table(3, 5));
  assert.equal(five.w, 5 * 56 + 16);
  assert.equal(five.h, 28 + 3 * 32 + 8);
  const twenty = parsedTableSize(table(3, 20));
  assert.equal(twenty.w, 20 * 56 + 16);
  assert.ok(twenty.w <= 1200 + 16);
  const tall = parsedTableSize(table(10, 3));
  assert.equal(tall.w, 3 * 56 + 16);
  assert.equal(tall.h, 28 + 10 * 32 + 8);
  const capped = parsedTableSize(table(30, 3));
  assert.equal(capped.h, 800);
  const grid = parsedTableSize(table(2, 2, { grid: { xs: [0, 80, 200] } }));
  assert.deepEqual(grid.widths, { 0: 112, 1: 168 });
  assert.equal(grid.w, 112 + 168 + 42 + 16);
  assert.equal(grid.h, 28 + 2 * 32 + 8);
  const wide = parsedTableSize(table(1, 2, { grid: { xs: [0, 500, 1400] } }));
  assert.equal(wide.widths[0] + wide.widths[1], 1200);
  assert.ok(wide.widths[0] <= 640 && wide.widths[1] <= 640);
  assert.ok(wide.widths[0] >= 56 && wide.widths[1] >= 56);
  const floor = parsedTableSize(table(1, 22, { grid: { xs: Array.from({ length: 23 }, (_, i) => i) } }));
  assert.equal(Object.values(floor.widths).every((n) => n === 56), true);
  assert.equal(floor.w, 1200);
});

test("nestMarkdownUnderFirst keeps a single root and indents the rest", () => {
  assert.equal(nestMarkdownUnderFirst("- only\n  - child"), "- only\n  - child");
  assert.equal(nestMarkdownUnderFirst("- A\n- B\n  - C"), "- A\n  - B\n    - C");
});

test("fromMarkdown is one undo for every root", async () => {
  const { fake, host } = setup();
  const roots = await host.group(() => host.fromMarkdown({
    parentUid: "page1",
    order: 1,
    markdown: "- a\n- b\n- c",
  }));
  assert.equal(roots.length, 3);
  assert.equal(host.stats.lastAction.writes, 1);
  assert.deepEqual(fake.children("page1"), ["pdf1", ...roots, "old1"]);
  fake.calls.length = 0;
  await host.undo();
  assert.equal(fake.calls.filter((row) => row[0] === "undo").length, 1);
  for (const uid of roots) assert.equal(fake.has(uid), false);
  assert.deepEqual(fake.children("page1"), ["pdf1", "old1"]);
});

test("insert below the PDF chunks at 400 and stays one undo step", async () => {
  const { fake, host, session } = setup();
  const res = await session.insertParsedBelow({ pdfUid: "pdf1", markdown: bullets(401), blockEstimate: 401 });
  assert.equal(res.ok, true);
  assert.equal(res.writes, 2);
  assert.equal(res.uids.length, 401);
  const logs = fake.writesLog().filter((row) => row[0] === "fromMarkdown");
  assert.deepEqual(logs.map((row) => row[2]), [400, 1]);
  const kids = fake.children("page1");
  assert.equal(kids[0], "pdf1");
  assert.equal(kids[kids.length - 1], "old1");
  assert.equal(kids.length, 403);
  fake.calls.length = 0;
  await session.undo();
  assert.equal(fake.calls.filter((row) => row[0] === "undo").length, 2);
  assert.deepEqual(fake.children("page1"), ["pdf1", "old1"]);
  assert.equal(host.stats.lastAction.writes, 2);
});

test("a nested tree larger than 400 stays one fromMarkdown", async () => {
  const { fake, session } = setup();
  const res = await session.insertParsedBelow({ pdfUid: "pdf1", markdown: wideTree(401) });
  assert.equal(res.ok, true);
  assert.equal(res.writes, 1);
  const logs = fake.writesLog().filter((row) => row[0] === "fromMarkdown");
  assert.deepEqual(logs.map((row) => row[2]), [1]);
  assert.equal(fake.children(res.uids[0]).length, 401);
});

test("more than 4000 blocks or 10 chunks writes nothing", async () => {
  const { fake, session } = setup();
  const toasts = [];
  session.on("toast", (t) => toasts.push(t.message));
  const over = await session.insertParsedBelow({ pdfUid: "pdf1", markdown: bullets(1), blockEstimate: 4001 });
  assert.deepEqual(over, { ok: false, reason: "too-large" });
  const many = await session.insertParsedBelow({ pdfUid: "pdf1", markdown: bullets(4001) });
  assert.equal(many.ok, false);
  let wide = "";
  for (let i = 0; i < 11; i += 1) wide += wideTree(200);
  const chunks = await session.insertParsedBelow({ pdfUid: "pdf1", markdown: wide });
  assert.equal(chunks.reason, "too-large");
  assert.equal(fake.writesLog().some((row) => row[0] === "fromMarkdown"), false);
  assert.equal(toasts.length, 3);
  assert.match(toasts[0], /too large/i);
  const missing = await session.insertParsedBelow({ pdfUid: "nope", markdown: "- a" });
  assert.deepEqual(missing, { ok: false, reason: "missing" });
  assert.equal(fake.writesLog().some((row) => row[0] === "fromMarkdown"), false);
});

test("ten chunks of 400 is the cap and one undo", async () => {
  const { fake, session } = setup();
  const res = await session.insertParsedBelow({ pdfUid: "pdf1", markdown: bullets(4000), blockEstimate: 4000 });
  assert.equal(res.ok, true);
  assert.equal(res.writes, 10);
  assert.equal(res.uids.length, 4000);
  fake.calls.length = 0;
  await session.undo();
  assert.equal(fake.calls.filter((row) => row[0] === "undo").length, 10);
  assert.deepEqual(fake.children("page1"), ["pdf1", "old1"]);
});

test("a board-hosted PDF inserts a note card beside it", async () => {
  const { fake, session } = setup([
    { uid: "pdfcard", string: "{{[[pdf]]: http://x/a.pdf}}", props: { plexus: { x: 10, y: 20, w: 240, h: 320 } } },
  ]);
  const res = await session.insertParsedBelow({ pdfUid: "pdfcard", markdown: "- Beside\n- More" });
  assert.equal(res.ok, true);
  assert.equal(res.path, "card");
  assert.deepEqual(res.uids, [res.uid]);
  assert.equal(res.writes, 2);
  assert.equal(fake.block(res.uid).string, "Beside");
  assert.equal(session.board.items.has(res.uid), true);
  const props = fake.props(res.uid);
  assert.equal(props.plexus.x, 10 + 240 + 40);
  assert.equal(props.plexus.y, 20);
  assert.equal(fake.children("page1").includes(res.uid), false);
});

test("a parsed card is two writes and one undo, children without the kids flag", async () => {
  const { fake, session } = setup();
  const res = await session.insertParsedCard({ x: 48, y: 64, markdown: "- Alpha\n- Beta\n  - Gamma" });
  assert.equal(res.ok, true);
  assert.equal(res.writes, 2);
  assert.equal(fake.block(res.uid).string, "Alpha");
  assert.deepEqual(fake.children(res.uid).map((uid) => fake.block(uid).string), ["Beta"]);
  assert.equal(fake.block(fake.children(res.uid)[0]).children.map((uid) => fake.block(uid).string).join(), "Gamma");
  const item = session.board.items.get(res.uid);
  assert.equal(item.kids, false);
  assert.equal(item.string, "Alpha");
  const props = fake.props(res.uid);
  assert.equal(props.plexus.x, 48);
  assert.equal(props.plexus.y, 64);
  assert.equal(props.plexus.w, 280);
  assert.equal(props.plexus.h, 160);
  assert.equal(JSON.stringify(props).includes(":diagram"), false);
  assert.equal(JSON.stringify(props).includes("BT_attr"), false);
  fake.calls.length = 0;
  await session.undo();
  assert.equal(fake.calls.filter((row) => row[0] === "undo").length, 2);
  assert.equal(fake.has(res.uid), false);
});

test("props merge keeps unknown keys", async () => {
  const { fake, session } = setup();
  fake.onFromMarkdown = (uids) => {
    fake.stampProps(uids[0], { custom: 1, "pdf-highlight": { color: "yellow" } });
  };
  const res = await session.insertParsedCard({ x: 10, y: 12, markdown: "- Kept" });
  const props = fake.props(res.uid);
  assert.equal(props.custom, 1);
  assert.deepEqual(props["pdf-highlight"], { color: "yellow" });
  assert.equal(props.plexus.x, 10);
  assert.equal(Object.keys(props.plexus).some((key) => key.startsWith("pdf") || key.includes("diagram") || key.startsWith("BT_")), false);
});

test("native, flat, and grid table cards", async () => {
  const { fake, host, session } = setup();
  const native = await session.insertParsedTable({ x: 2000, y: 2000, table: table(3, 3), mode: "native" });
  assert.equal(native.ok, true);
  assert.equal(native.path, "native");
  assert.equal(native.writes, 2);
  assert.equal(native.w, 200);
  assert.equal(native.h, 28 + 3 * 32 + 8);
  assert.equal(isRoamTableString(fake.block(native.uid).string), true);
  assert.equal(session.board.items.get(native.uid).w, 200);
  assert.equal(fake.props(native.uid).plexus.look, undefined);

  const flat = await session.insertParsedTable({ x: 2000, y: 2400, table: merged, mode: "flat" });
  assert.equal(flat.path, "flat");
  assert.equal(flat.writes, 2);
  const flatRows = fake.children(flat.uid);
  assert.equal(fake.block(fake.children(flatRows[0])[0]).string, "H");

  const covered = await session.insertParsedTable({ x: 2000, y: 2800, table: merged, mode: "native" });
  const nativeRows = fake.children(covered.uid);
  assert.equal(fake.block(fake.children(nativeRows[0])[0]).string, "");

  assert.equal(host.canCreateGridTable(), false);
  const fallback = await session.insertParsedTable({ x: 2000, y: 3200, table: table(3, 5), mode: "auto" });
  assert.equal(fallback.path, "native");
  assert.equal(fallback.w, 5 * 56 + 16);
  assert.equal(fallback.writes, 2);
});

test("Roam Grid table is three undos and one step removes the table and the metadata block", async () => {
  const { fake, session } = setup();
  const numeric = table(2, 2, {
    headerRows: 1,
    cells: [
      { r: 0, c: 0, text: "Name" },
      { r: 0, c: 1, text: "N" },
      { r: 1, c: 0, text: "a" },
      { r: 1, c: 1, text: "12" },
    ],
  });
  let metaUid = null;
  let seen = null;
  globalThis.roamGrid = {
    v1: {
      capabilities: ["createTableFromModel"],
      async createTableFromModel(spec) {
        seen = spec;
        const made = await fake.api.data.block.fromMarkdown({
          location: { "parent-uid": spec.parentUid, order: spec.order },
          "markdown-string": "- {{[[table]]}}\n  - a\n    - b",
        });
        metaUid = fake.generateUid();
        const madeMeta = metaUid;
        await fake.api.data.block.create({
          location: { "parent-uid": spec.parentUid, order: "last" },
          block: { uid: madeMeta, string: "grid-meta" },
        });
        fake.pushUndo(() => fake.dropTree(madeMeta));
        return { uid: made.uids[0], writes: 1, path: "markdown" };
      },
    },
  };
  const grid = await session.insertParsedTable({ x: 2000, y: 3600, table: numeric, mode: "auto" });
  assert.equal(grid.path, "grid");
  assert.equal(grid.writes, 3);
  assert.equal(seen.headerRows, 1);
  assert.equal(seen.widths, undefined);
  assert.deepEqual(seen.columnAlignments, [null, "right"]);
  fake.calls.length = 0;
  await session.undo();
  assert.equal(fake.calls.filter((row) => row[0] === "undo").length, 3);
  assert.equal(fake.has(grid.uid), false);
  assert.equal(fake.has(metaUid), false);
});

test("a measured grid passes column widths and one undo removes that table", async () => {
  const { fake, session } = setup();
  let metaUid = null;
  let seen = null;
  globalThis.roamGrid = {
    v1: {
      capabilities: ["createTableFromModel"],
      async createTableFromModel(spec) {
        seen = spec;
        const made = await fake.api.data.block.fromMarkdown({
          location: { "parent-uid": spec.parentUid, order: spec.order },
          "markdown-string": "- {{[[table]]}}\n  - a\n    - b",
        });
        metaUid = fake.generateUid();
        const madeMeta = metaUid;
        await fake.api.data.block.create({
          location: { "parent-uid": spec.parentUid, order: "last" },
          block: { uid: madeMeta, string: "grid-meta" },
        });
        fake.pushUndo(() => fake.dropTree(madeMeta));
        return { uid: made.uids[0], writes: 1, path: "markdown" };
      },
    },
  };
  const measured = table(2, 2, { grid: { xs: [0, 80, 200] }, headerRows: 1 });
  const sized = await session.insertParsedTable({ x: 2000, y: 4000, table: measured, mode: "grid" });
  assert.equal(sized.path, "grid");
  assert.deepEqual(seen.widths, { 0: 112, 1: 168 });
  fake.calls.length = 0;
  await session.undo();
  assert.equal(fake.calls.filter((row) => row[0] === "undo").length, 3);
  assert.equal(fake.has(sized.uid), false);
  assert.equal(fake.has(metaUid), false);
});

test("send to board stacks sections and stops at 22 cards", async () => {
  const { fake, session } = setup();
  assert.equal(PARSE_SECTION_CAP, 22);
  const two = await session.sendParsedToBoard({
    x: 30,
    y: 40,
    sections: [{ title: "One", markdown: "- One" }, { title: "Two", markdown: "- Two" }],
  });
  assert.equal(two.writes, 4);
  assert.equal(two.uids.length, 2);
  assert.equal(fake.props(two.uids[0]).plexus.y, 40);
  assert.equal(fake.props(two.uids[1]).plexus.y, 40 + 160 + 24);
  assert.equal(fake.props(two.uids[1]).plexus.x, 30);
  const toasts = [];
  session.on("toast", (t) => toasts.push(t.message));
  const sections = Array.from({ length: 23 }, (_, i) => ({ title: `S${i}`, markdown: `- S${i}` }));
  fake.clearLog();
  const many = await session.sendParsedToBoard({ x: 80, y: 90, sections });
  assert.equal(many.uids.length, 22);
  assert.equal(many.writes, 44);
  assert.match(toasts[0], /Added 22 of 23/);
  fake.calls.length = 0;
  await session.undo();
  assert.equal(fake.calls.filter((row) => row[0] === "undo").length, 44);
  for (const uid of many.uids) assert.equal(fake.has(uid), false);
});

test("parse drop payload, plan, and missing cache", async () => {
  const payload = { sha256: "sha", engine: "docling", optsHash: "opt", ids: ["a"], pdfUid: "pdf1", kind: "blocks" };
  const raw = JSON.stringify(payload);
  assert.deepEqual(parseDropPayload(dt({ [PARSE_MIME]: raw, "text/plain": "[[Nope]]", "application/x-plexus-card": "((no))" })), [{ parse: payload }]);
  assert.deepEqual(parseDropPayload(dt({ [PARSE_MIME]: "{", "text/plain": "[[Nope]]" })), []);
  assert.deepEqual(parseDropPayload(dt({ "text/plain": "[[Page]]" })), [{ string: "[[Page]]" }]);

  const doc = docOf({
    h1: { id: "h1", type: "heading", level: 1, text: "One" },
    p1: { id: "p1", type: "para", text: "Alpha" },
    h2: { id: "h2", type: "heading", level: 2, text: "Two" },
    p2: { id: "p2", type: "para", text: "Beta" },
    t1: { ...table(3, 3) },
  }, ["h1", "p1", "h2", "p2", "t1"]);
  const sections = planParseInsert(doc, { kind: "blocks", ids: ["h1", "p1", "h2", "p2"] });
  assert.equal(sections.action, "sections");
  assert.deepEqual(sections.sections.map((section) => section.title), ["One", "Two"]);
  const card = planParseInsert(doc, { kind: "blocks", ids: ["p1"] });
  assert.equal(card.action, "card");
  assert.match(card.markdown, /Alpha/);
  const onlyTable = planParseInsert(doc, { kind: "blocks", ids: ["t1"] });
  assert.equal(onlyTable.action, "card");
  const asTable = planParseInsert(doc, { kind: "table", ids: ["t1"] });
  assert.equal(asTable.action, "table");
  assert.equal(planParseInsert(doc, { kind: "table", ids: ["p1"] }).action, "empty");

  const { fake, session } = setup();
  const toasts = [];
  const missed = await handleParseDrop({
    payload,
    store: { async getParse() { return null; } },
    session,
    point: { x: 1, y: 2 },
    toast: (message) => toasts.push(message),
  });
  assert.equal(missed.reason, "missing-cache");
  assert.deepEqual(toasts, [PARSE_MISSING_TOAST]);
  assert.equal(PARSE_MISSING_TOAST, "Parse result not found; parse the PDF again");
  assert.equal(fake.writesLog().length, 0);

  const dropped = await handleParseDrop({
    payload: { ...payload, kind: "blocks", ids: ["h1", "p1", "h2", "p2"] },
    store: { async getParse() { return doc; } },
    session,
    point: { x: 15, y: 25 },
    toast: () => {},
  });
  assert.equal(dropped.ok, true);
  assert.equal(dropped.uids.length, 2);
  assert.equal(dropped.writes, 4);
  assert.equal(fake.block(dropped.uids[0]).string.includes("One"), true);

  const tableDrop = await handleParseDrop({
    payload: { ...payload, kind: "table", ids: ["t1"] },
    store: { async getParse() { return doc; } },
    session,
    point: { x: 2000, y: 2000 },
    toast: () => {},
  });
  assert.equal(tableDrop.path, "native");
  assert.equal(isRoamTableString(fake.block(tableDrop.uid).string), true);
  // 3 short columns floor at 56, plus 16 of native padding, then the card minimum of 200.
  assert.equal(tableDrop.w, 200);
  assert.equal(tableDrop.h, 132);
});

// Table cards as a folded caption block with the {{[[table]]}} under it: detection, render, creation, duplicate,
// copy/export, and the "Fold tables under captions" migration (plan, apply, second run, undo/redo, edges, sections).
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildBoard, worldRects } from "../src/model/board.js";
import { tableGrid } from "../src/model/boardsnap.js";
import { copyPayload } from "../src/model/clipboard.js";
import { boardToMarkdown } from "../src/model/export.js";
import { captionTableKid, parsedTableCaption, rowsCaption, tableUidOf, wrapTableNode } from "../src/model/roam-table.js";
import { isOldTableCard, oldTableCards, planTableCaptions, tableCaptionLines } from "../src/model/table-captions.js";
import { chartToTable } from "../src/model/chart-data.js";
import { buildMenu } from "../src/view/menu-model.js";
import { mountBoardView } from "../src/view/board-view.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/session-clip.js";
import { createHost } from "../src/host/roam.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";

afterEach(() => resetSessions());

const node = (uid, string, order, children = [], extra = {}) => ({
  ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/children": children, ...extra,
});
const rowsOf = (prefix, n) => Array.from({ length: n }, (_, i) => node(`${prefix}r${i}`, `R${i}`, i, [node(`${prefix}c${i}`, `C${i}`, 0)]));
const layout = (x, y = 0) => ({ ":block/props": { ":plexus": { ":type": "card", ":x": x, ":y": y, ":w": 480, ":h": 260 } } });

function pulled() {
  return {
    ":block/uid": "b1",
    ":block/string": "{{[[diagram]]}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      node("old", "{{[[table]]}}", 0, rowsOf("o", 3), layout(0)),
      node("cap", "Quarterly sales", 1, [node("tbl", "{{[[table]]}}", 0, rowsOf("t", 2))], { ...layout(600), ":block/open": false }),
      node("note", "a note", 2, [node("kid", "just a child", 0)], layout(1200)),
      node("two", "two kids", 3, [node("t2", "{{[[table]]}}", 0), node("x2", "more", 1)], layout(1800)),
    ],
  };
}

// ---- detection ----

test("detection: old-form and caption-form table cards; a caption form exposes its inner table, rows and caption", () => {
  const board = buildBoard(pulled());
  const old = board.items.get("old");
  assert.equal(old.tableUid, undefined);
  assert.equal(tableUidOf(old), "old");
  assert.equal(old.title, "Table · 3 rows");
  assert.equal(old.content.length, 3);
  const cap = board.items.get("cap");
  assert.equal(cap.tableUid, "tbl");
  assert.equal(tableUidOf(cap), "tbl");
  assert.equal(cap.string, "Quarterly sales");
  assert.equal(cap.title, "Quarterly sales");
  assert.equal(cap.open, false);
  assert.deepEqual(cap.content.map((k) => k[":block/uid"]), ["tr0", "tr1"]);
  assert.equal(board.items.has("tbl"), false, "the inner table is not a card");
  assert.equal(tableUidOf(board.items.get("note")), null);
  assert.equal(tableUidOf(board.items.get("two")), null, "a table is a caption's ONLY child");
  assert.equal(captionTableKid("{{[[table]]}}", [{ ":block/string": "{{[[table]]}}" }]), null);
  assert.equal(isOldTableCard(old), true);
  assert.equal(isOldTableCard(cap), false);
  assert.deepEqual(oldTableCards(board).map((i) => i.uid), ["old"]);
});

test("detection: an empty caption falls back to the row count; a section is never a table card", () => {
  const tree = pulled();
  tree[":block/children"][1][":block/string"] = "";
  tree[":block/children"].push(node("sec", "Group", 4, [node("t9", "{{[[table]]}}", 0)], { ":block/props": { ":plexus": { ":type": "section", ":x": 0, ":y": 900, ":w": 400, ":h": 300 } } }));
  const board = buildBoard(tree);
  assert.equal(board.items.get("cap").title, "Table · 2 rows");
  assert.equal(board.items.get("sec").type, "section");
  assert.equal(tableUidOf(board.items.get("sec")), null);
  assert.equal(board.items.get("t9").tableUid, undefined);
  assert.equal(tableUidOf(board.items.get("t9")), "t9", "an old-form card inside a section");
});

test("thumbnails, copy and export read the inner table of a caption card", () => {
  const board = buildBoard(pulled());
  const cap = board.items.get("cap");
  assert.deepEqual(tableGrid(cap), [["R0", "C0"], ["R1", "C1"]]);
  const payload = JSON.parse(copyPayload(board, ["cap", "old"], worldRects(board)).mime);
  assert.deepEqual(payload.items.find((i) => i.uid === "cap").target, { kind: "block", uid: "tbl" });
  assert.equal(copyPayload(board, ["cap"], worldRects(board)).text, "((tbl))");
  const md = boardToMarkdown(board, worldRects(board));
  assert.match(md, /- Quarterly sales\n {2}- \{\{\[\[table\]\]\}\}\n {4}- R0\n {6}- C0/);
  assert.match(md, /- Table · 3 rows\n {2}- R0/, "old-form export is unchanged");
});

test("captions: parse caption block, own caption, merged title row (chart -> table), else Table · N rows", () => {
  const t = { id: "t1", type: "table", rows: 3, cols: 2, cells: [{ r: 0, c: 0, text: "a" }] };
  assert.equal(parsedTableCaption(t), "Table · 3 rows");
  const doc = { blocks: { t1: t, c1: { id: "c1", type: "caption", for: "t1", text: " Table 2.  Yields " } }, order: ["t1", "c1"] };
  assert.equal(parsedTableCaption(t, doc), "Table 2. Yields");
  assert.equal(parsedTableCaption({ ...t, caption: { text: "Own" } }), "Own");
  const chart = chartToTable({ x: { label: "Year" }, y: { label: "N" }, series: [{ name: "A", points: [{ x: 1, y: 2 }, { x: 2, y: 3 }] }] }, { title: "Figure 3 · p. 4" });
  assert.equal(parsedTableCaption(chart), "Figure 3 · p. 4");
  assert.equal(rowsCaption(1), "Table · 1 row");
});

test("wrapTableNode: the caption keeps the card uid and layout, the table loses only the layout", () => {
  const wrapped = wrapTableNode(node("old", "{{[[table]]}}", 2, rowsOf("o", 1), { ":block/props": { ":plexus": { ":x": 1 }, ":rg": { w: 1 } } }), "Cap");
  assert.equal(wrapped[":block/uid"], "old");
  assert.equal(wrapped[":block/string"], "Cap");
  assert.equal(wrapped[":block/open"], false);
  assert.deepEqual(wrapped[":block/props"], { ":plexus": { ":x": 1 } });
  const inner = wrapped[":block/children"][0];
  assert.equal(inner[":block/string"], "{{[[table]]}}");
  assert.deepEqual(inner[":block/props"], { ":rg": { w: 1 } });
  assert.equal(inner[":block/children"].length, 1);
});

// ---- pull and render ----

function seeded({ extra = [] } = {}) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  host.graphName = () => "g";
  fake.seedPage({ title: "Lab", uid: "lab", children: [] });
  const rows = (p, n) => Array.from({ length: n }, (_, i) => ({ uid: `${p}r${i}`, string: `R${i}`, children: [{ uid: `${p}c${i}`, string: `C${i}` }] }));
  fake.seedBoard({
    uid: "b1",
    parent: "lab",
    props: { plexus: { v: 2 } },
    children: [
      {
        uid: "sec", string: "Tables", heading: 1, props: { plexus: { type: "section", x: 0, y: 0, w: 1400, h: 700 } },
        children: [
          { uid: "n0", string: "before", props: { plexus: { type: "card", x: 10, y: 10 } } },
          { uid: "tA", string: "{{[[table]]}}", props: { plexus: { type: "card", x: 10, y: 200, w: 480, h: 260 }, "roam-grid": { w: 3 } }, children: rows("a", 3) },
          { uid: "n1", string: "between", props: { plexus: { type: "card", x: 600, y: 10 } } },
          { uid: "tB", string: "{{[[table]]}}", props: { plexus: { type: "card", x: 600, y: 200, w: 480, h: 260 } }, children: rows("b", 2) },
        ],
      },
      { uid: "tC", string: "{{[[table]]}}", props: { plexus: { type: "card", x: 1600, y: 0, w: 480, h: 260 } }, children: rows("c", 1) },
      { uid: "cap", string: "Done already", open: false, props: { plexus: { type: "card", x: 1600, y: 600 } }, children: [{ uid: "tD", string: "{{[[table]]}}", children: rows("d", 2) }] },
      { uid: "n2", string: "a note", props: { plexus: { type: "card", x: 2400, y: 0 } } },
      ...extra,
      {
        uid: "E", string: "Connections", props: { plexus: { type: "edges" } }, open: false,
        children: [
          { uid: "e1", string: "((tA)) → feeds → ((n2))", props: { plexus: { type: "edge", from: "tA", to: "n2" } } },
          { uid: "e2", string: "((n0)) → ((ac1))", props: { plexus: { type: "edge", from: "n0", to: "tA", toBlock: "ac1" } } },
          { uid: "e3", string: "((n1)) → ((n2))", props: { plexus: { type: "edge", from: "n1", to: "n2" } } },
        ],
      },
    ],
  });
  fake.seedPage({ title: "Elsewhere", uid: "else", children: [{ uid: "tX", string: "{{[[table]]}}", children: [{ uid: "xr", string: "x" }] }] });
  const session = acquireSession("b1", { host, raf: (fn) => fn(), linkDelay: 0, settings: { "graph-links": "off" } });
  return { fake, host, session };
}

test("pull: the board pull carries a caption card's table rows one level deeper", () => {
  const { session, host } = seeded();
  const cap = session.board.items.get("cap");
  assert.equal(cap.tableUid, "tD");
  assert.deepEqual(cap.content.map((k) => k[":block/uid"]), ["dr0", "dr1"]);
  assert.deepEqual(tableGrid(cap), [["R0", "C0"], ["R1", "C1"]]);
  const raw = host.pullBoard("b1");
  const capNode = raw[":block/children"].find((k) => k[":block/uid"] === "cap");
  assert.equal(capNode[":block/children"][0][":block/children"][0][":block/children"][0][":block/string"], "C0");
});

test("render: a caption card mounts its inner table; an old-form card renders unchanged", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    // Two cards side by side, so the fitted zoom is the detail tier and both mount live.
    const tree = pulled();
    tree[":block/children"] = tree[":block/children"].slice(0, 2);
    tree[":block/children"][0][":block/props"] = { ":plexus": { ":type": "card", ":x": 0, ":y": 0, ":w": 300, ":h": 200 } };
    tree[":block/children"][1][":block/props"] = { ":plexus": { ":type": "card", ":x": 320, ":y": 0, ":w": 300, ":h": 200 } };
    const board = buildBoard(tree);
    const session = {
      uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false,
      on() { return () => {}; }, emit() {}, handlerCount: () => 0, release() {}, setLinkMode() {},
      setString: () => Promise.resolve(), createCard: () => Promise.resolve("x"), createTable: () => Promise.resolve("x"),
      undo: () => Promise.resolve(), redo: () => Promise.resolve(),
    };
    const rendered = [];
    const host = {
      graph: "Svy",
      renderString(el, string) { el.textContent = string; },
      renderBlock(el, uid) { rendered.push(uid); el.textContent = `[block ${uid}]`; },
      renderPage() {}, unmount() {}, blockString: () => null, pullTree: () => [],
      pagePreview: () => ({ exists: false, blocks: [] }), openBlock() {}, openInSidebar() {},
    };
    const mountEl = stub.document.createElement("div");
    stub.document.body.append(mountEl);
    const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0" });
    for (let i = 0; i < 8; i += 1) {
      stub.flushFrames();
      await new Promise((r) => setTimeout(r, 0));
      stub.flushIdle();
      stub.flushFrames();
    }
    const capCard = view.root.querySelector('.pxd-item[data-uid="cap"]');
    assert.ok(capCard.classList.contains("pxd-item--roam-table"));
    assert.ok(capCard.querySelector('.pxd-roam-table[data-pxd-table="tbl"]'));
    const body = capCard.querySelector(".pxd-item__body");
    assert.equal(body.textContent.includes("Quarterly sales"), false, "the caption is not an extra body line");
    const oldCard = view.root.querySelector('.pxd-item[data-uid="old"]');
    assert.ok(oldCard.querySelector('.pxd-roam-table[data-pxd-table="old"]'));
    assert.ok(rendered.includes("tbl") && rendered.includes("old"));
    assert.equal(rendered.includes("cap"), false);
    view.dispose();
  } finally {
    restore();
  }
});

// ---- creation ----

test("duplicate: an old-form table card copies as a folded caption over the table; a caption card copies as one", async () => {
  const { fake, session } = seeded();
  const [fresh] = await session.duplicateItems(["tC"]);
  assert.equal(fake.block(fresh).string, "Table · 1 row");
  assert.equal(fake.block(fresh).open, false);
  assert.equal(fake.props(fresh).plexus.w, 480);
  const [inner] = fake.children(fresh);
  assert.equal(fake.children(fresh).length, 1);
  assert.equal(fake.block(inner).string, "{{[[table]]}}");
  assert.equal(fake.props(inner)?.plexus, undefined);
  assert.equal(fake.children(inner).length, 1);
  assert.equal(session.board.items.get(fresh).tableUid, inner);
  const [again] = await session.duplicateItems(["cap"]);
  assert.equal(fake.block(again).string, "Done already");
  assert.equal(fake.block(again).open, false);
  assert.equal(session.board.items.get(again).tableUid, fake.children(again)[0]);
  const [ref] = await session.duplicateItems(["cap"], { asRef: true });
  assert.equal(fake.block(ref).string, "((tD))");
});

// ---- migration ----

const planFor = (session, host) => planTableCaptions(session.board, {
  graph: "g",
  layoutOf: (id) => session.layoutOf(id),
  newUid: () => host.generateUid(),
});

test("menu: Fold tables under captions shows only while the board has old-form table cards", () => {
  const labels = (c) => buildMenu("board-menu", c).filter(Boolean).map((e) => e.label);
  assert.ok(labels({ oldTables: 2 }).includes("Fold tables under captions"));
  assert.ok(!labels({ oldTables: 0 }).includes("Fold tables under captions"));
});

test("plan: every old-form card on this board (sections too), edges that name one, nothing else", () => {
  const { session, host } = seeded();
  const plan = planFor(session, host);
  assert.deepEqual(plan.folds.map((f) => f.tableUid), ["tA", "tB", "tC"]);
  const a = plan.folds[0];
  assert.equal(a.parentUid, "sec");
  assert.equal(a.caption, "Table · 3 rows");
  assert.equal(a.layout.x, 10);
  assert.deepEqual(plan.edges.map((e) => e.uid), ["e1", "e2"]);
  assert.equal(plan.edges[0].from, a.captionUid);
  assert.equal(plan.edges[0].string, `((${a.captionUid})) → feeds → ((n2))`);
  // A connection to a cell: the card end moves to the caption, the cell end keeps its uid.
  assert.equal(plan.edges[1].to, a.captionUid);
  assert.equal(plan.edges[1].toBlock, "ac1");
  assert.equal(plan.edges[1].string, "((n0)) → ((ac1))");
  assert.deepEqual(tableCaptionLines(plan), ["Table · 3 rows: folded under a caption", "Table · 2 rows: folded under a caption", "Table · 1 row: folded under a caption", "2 connections rewritten"]);
});

test("apply: caption in the table's place with its layout, table under it without layout, edges follow, second run writes nothing", async () => {
  const { fake, host, session } = seeded();
  const plan = planFor(session, host);
  // e2 ends on a cell of tA: its `to` is the card, so it moves to the caption while toBlock stays the cell.
  assert.equal(session.board.edges.get("e2").to, "tA");
  const [a, b, c] = plan.folds;
  fake.clearLog();
  const res = await session.foldTableCaptions(plan);
  assert.equal(res.folded, 3);
  assert.deepEqual(fake.children("sec"), ["n0", a.captionUid, "n1", b.captionUid]);
  assert.deepEqual(fake.children(a.captionUid), ["tA"]);
  assert.equal(fake.block(a.captionUid).string, "Table · 3 rows");
  assert.equal(fake.block(a.captionUid).open, false);
  assert.equal(fake.props(a.captionUid).plexus.x, 10);
  assert.equal(fake.props(a.captionUid).plexus.w, 480);
  assert.equal(fake.props("tA").plexus, undefined);
  assert.deepEqual(fake.props("tA")["roam-grid"], { w: 3 }, "other props on the table stay");
  assert.deepEqual(fake.children("tA"), ["ar0", "ar1", "ar2"], "rows and cells keep their uids");
  assert.equal(fake.block(c.captionUid).parent, "b1");
  assert.equal(fake.block("e1").string, `((${a.captionUid})) → feeds → ((n2))`);
  assert.equal(fake.props("e1").plexus.from, a.captionUid);
  assert.equal(fake.props("e2").plexus.to, a.captionUid);
  assert.equal(fake.props("e2").plexus.toBlock, "ac1");
  assert.equal(session.board.edges.get("e2").valid, true);
  assert.equal(fake.block("e3").string, "((n1)) → ((n2))");
  // The board reads the new form.
  const item = session.board.items.get(a.captionUid);
  assert.equal(item.tableUid, "tA");
  assert.equal(item.parentUid, "sec");
  assert.equal(session.board.items.has("tA"), false);
  assert.equal(session.board.edges.get("e1").valid, true);
  // Tables that are not cards of this board are untouched.
  assert.equal(fake.block("tX").parent, "else");
  assert.equal(fake.block("tD").parent, "cap");
  // Second run: nothing to plan, and the stale plan writes nothing.
  assert.equal(planFor(session, host).folds.length, 0);
  fake.clearLog();
  assert.deepEqual(await session.foldTableCaptions(plan), { folded: 0 });
  assert.equal(fake.writesLog().length, 0);
});

test("apply: refuses a plan for another graph or another board", async () => {
  const { fake, host, session } = seeded();
  const plan = planFor(session, host);
  fake.clearLog();
  assert.deepEqual(await session.foldTableCaptions({ ...plan, graph: "other" }), { folded: 0, refused: "graph" });
  assert.deepEqual(await session.foldTableCaptions({ ...plan, boardUid: "b2" }), { folded: 0, refused: "board" });
  assert.equal(fake.writesLog().length, 0);
});

test("undo: one undo restores every table, its props and order and the edges; redo folds again", async () => {
  const { fake, host, session } = seeded();
  fake.trackUndo = true;
  const snap = () => ({
    sec: fake.children("sec"),
    top: fake.children("b1"),
    props: Object.fromEntries(["tA", "tB", "tC"].map((u) => [u, structuredClone(fake.props(u))])),
    rows: fake.children("tA"),
    edge: [fake.block("e1").string, structuredClone(fake.props("e1")), structuredClone(fake.props("e2"))],
  });
  const before = snap();
  const plan = planFor(session, host);
  await session.foldTableCaptions(plan);
  const after = snap();
  assert.notDeepEqual(after, before);
  await session.undo();
  assert.deepEqual(snap(), before);
  assert.ok(plan.folds.every((f) => !fake.has(f.captionUid)), "every caption is gone");
  assert.equal(fake.block("tA").parent, "sec");
  await session.redo();
  assert.deepEqual(snap(), after);
  await session.undo();
  assert.deepEqual(snap(), before);
});

test("insertParsedTable: chart -> table and a captioned parse both land as a folded caption over the table", async () => {
  const { fake, session } = seeded();
  const chart = chartToTable({ x: { label: "Year" }, y: { label: "N" }, series: [{ name: "A", points: [{ x: 1, y: 2 }, { x: 2, y: 3 }] }] }, { title: "Figure 3 · p. 4" });
  const res = await session.insertParsedTable({ x: 4000, y: 0, table: chart, mode: "native" });
  assert.equal(res.ok, true);
  assert.equal(fake.block(res.uid).string, "Figure 3 · p. 4");
  assert.equal(fake.block(res.uid).open, false);
  assert.deepEqual(fake.children(res.uid), [res.tableUid]);
  assert.equal(fake.block(res.tableUid).string, "{{[[table]]}}");
  assert.equal(fake.props(res.uid).plexus.x, 4000);
  const t = { id: "t1", type: "table", rows: 2, cols: 2, cells: [{ r: 0, c: 0, text: "a" }, { r: 1, c: 1, text: "b" }] };
  const named = await session.insertParsedTable({ x: 4000, y: 600, table: t, mode: "native", caption: "Table 4. Results" });
  assert.equal(fake.block(named.uid).string, "Table 4. Results");
  assert.equal(session.board.items.get(named.uid).tableUid, named.tableUid);
});

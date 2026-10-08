import test from "node:test";
import assert from "node:assert/strict";
import { cellUidOf, cellElementOf, findCell, forgetTableCells, measureCell } from "../src/view/table-cells.js";
import { createDomStub } from "./fixtures/dom-stub.js";

// Roam tables nest columns: a row block is column 1, its child column 2, and so on.
const chain = (uidPrefix, strings) => {
  let node = null;
  for (let i = strings.length - 1; i >= 0; i -= 1) node = { uid: `${uidPrefix}${i}`.padEnd(9, "x"), string: strings[i], children: node ? [node] : [] };
  return node;
};
const ROWS = [
  ["Food category", "Micro-organisms", "n", "c", "Method"],
  ["Powder", "Cronobacter", "30", "0", "ISO 22964"],
  ["Powder", "Salmonella", "60", "0", "ISO 4833"],
];
const tree = () => ROWS.map((r, i) => chain(`r${i}c`, r));

function render(doc, rows, { rowBase, colBase, tableUid = "tblnat001" }) {
  const host = doc.createElement("div");
  host.className = "pxd-roam-table";
  host.setAttribute("data-pxd-table", tableUid);
  const table = doc.createElement("table");
  table.className = "rm-table";
  rows.forEach((row, r) => {
    const tr = doc.createElement("tr");
    row.forEach((text, c) => {
      const td = doc.createElement("td");
      td.setAttribute("data-row", String(r + rowBase));
      td.setAttribute("data-col", String(c + colBase));
      const wrap = doc.createElement("div");
      wrap.className = "rm-table__cell";
      const span = doc.createElement("span");
      span.textContent = text;
      wrap.append(span);
      td.append(wrap);
      tr.append(td);
    });
    table.append(tr);
  });
  host.append(table);
  doc.body.append(host);
  return host;
}

for (const [rowBase, colBase] of [[0, 0], [1, 1], [1, 0], [0, 1]]) {
  test(`native cells map through the block tree (data-row base ${rowBase}, data-col base ${colBase})`, () => {
    const stub = createDomStub();
    const restore = stub.install();
    try {
      forgetTableCells();
      const doc = stub.document;
      const host = render(doc, ROWS, { rowBase, colBase });
      let pulls = 0;
      const pullTree = (uid, depth, limit) => { pulls += 1; assert.equal(uid, "tblnat001"); assert.ok(depth >= 4 && limit >= 12); return tree(); };
      const tds = host.querySelectorAll("td");
      const at = (r, c) => tds[r * 5 + c];
      assert.equal(cellUidOf(at(2, 4).querySelector("span"), { pullTree }), "r2c4xxxxx", "ISO 4833: row 2, col 4 from the block chain");
      assert.equal(cellUidOf(at(0, 0), { pullTree }), "r0c0xxxxx", "header row maps to the first table child");
      assert.equal(cellUidOf(at(1, 1), { pullTree }), "r1c1xxxxx");
      for (let c = 0; c < 5; c += 1) assert.equal(cellUidOf(at(1, c), { pullTree }), `r1c${c}xxxxx`, `nested column ${c + 1}`);
      assert.equal(pulls, 1, "the table is pulled once and cached");
      assert.equal(findCell(host, "r2c4xxxxx", { pullTree }), at(2, 4), "inverse: uid to td");
      assert.equal(findCell(host, "r0c0xxxxx", { pullTree }), at(0, 0));
      assert.equal(cellElementOf(at(2, 4).querySelector("span")), at(2, 4));
    } finally { restore(); }
  });
}

test("native cells: no pull, a deleted block, and an unknown uid all resolve to null", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    forgetTableCells();
    const doc = stub.document;
    const host = render(doc, ROWS, { rowBase: 0, colBase: 0 });
    const tds = host.querySelectorAll("td");
    assert.equal(cellUidOf(tds[3]), null, "without a pull the native cell has no uid (old behavior)");
    assert.equal(findCell(host, "r1c3xxxxx"), null);
    const trimmed = () => tree().map((r, i) => (i === 2 ? chain("r2c", ROWS[2].slice(0, 3)) : r));
    forgetTableCells();
    assert.equal(cellUidOf(tds[2 * 5 + 4], { pullTree: trimmed }), null, "the block behind the cell is gone");
    assert.equal(findCell(host, "r2c4xxxxx", { pullTree: trimmed }), null, "a deleted block has no cell: the edge falls back to the card");
    assert.equal(findCell(host, "nope00001", { pullTree: trimmed }), null);
    forgetTableCells();
    assert.equal(cellUidOf(tds[0], { pullTree: () => { throw new Error("pull failed"); } }), null);
  } finally { restore(); }
});

test("measureCell follows a native cell through the pull and reports an unmapped uid as unrendered", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    forgetTableCells();
    const doc = stub.document;
    const host = render(doc, ROWS, { rowBase: 0, colBase: 0 });
    const td = host.querySelectorAll("td")[2 * 5 + 4];
    const rect = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h });
    const card = doc.createElement("div");
    const body = doc.createElement("div");
    card.getBoundingClientRect = () => rect(0, 0, 480, 260);
    body.getBoundingClientRect = () => rect(0, 30, 480, 230);
    host.getBoundingClientRect = () => rect(0, 30, 480, 230);
    td.getBoundingClientRect = () => rect(300, 100, 100, 24);
    const pullTree = () => tree();
    const m = measureCell({ card, host, body, uid: "r2c4xxxxx", zoom: 1, pullTree });
    assert.equal(m.rendered, true);
    assert.equal(m.rowTop, 100);
    assert.equal(m.rowHeight, 24);
    assert.equal(m.rowLeft, 300);
    assert.equal(measureCell({ card, host, body, uid: "gone00001", zoom: 1, pullTree }).rendered, false);
  } finally { restore(); }
});

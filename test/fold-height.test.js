import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, displayRects, worldRects, COLLAPSED_CARD_H, anchorUid } from "../src/model/board.js";

const blk = (uid, string, plexus, order, children = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {},
  ":block/children": children,
});
const raw = (children) => ({
  ":block/uid": "board0001",
  ":block/string": "{{[[diagram]]:Test}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": children,
});
const rows = (n) => Array.from({ length: n }, (_, i) => blk(`row${i}0000`, `r${i}`, null, i));
const card = (extra) => ({ ":type": "card", ":x": 10, ":y": 20, ":w": 300, ":h": 279, ...extra });

test("a folded note card paints at header height and keeps its stored h", () => {
  const board = buildBoard(raw([
    blk("note00001", "A note about things", card({ ":collapsed": true }), 0),
    blk("note00002", "Open note", card({}), 1),
  ]));
  const item = board.items.get("note00001");
  assert.equal(item.collapsed, true);
  assert.equal(item.h, 279, "stored h untouched");
  assert.ok(item.title.length > 0);
  const shown = displayRects(board, worldRects(board));
  assert.equal(shown.get("note00001").h, COLLAPSED_CARD_H);
  assert.equal(shown.get("note00001").w, 300);
  assert.equal(shown.get("note00002").h, 279, "an open card keeps its height");
  assert.equal(worldRects(board).get("note00001").h, 279);
  assert.equal(anchorUid(board, "note00001"), "note00001", "edges attach to the folded card itself");
});

test("a folded table card has a title and paints at header height", () => {
  const board = buildBoard(raw([
    blk("tbl000001", "{{[[table]]}}", card({ ":collapsed": true, ":h": 799 }), 0, rows(4)),
    blk("tbl000002", "{{[[table]]}}", card({ ":collapsed": true }), 1, rows(1)),
    blk("tbl000003", "{{[[table]]}}", card({}), 2),
  ]));
  const t = board.items.get("tbl000001");
  assert.equal(t.title, "Table · 4 rows");
  assert.equal(board.items.get("tbl000002").title, "Table · 1 row");
  assert.equal(board.items.get("tbl000003").title, "Table");
  assert.equal(t.h, 799);
  assert.equal(displayRects(board, worldRects(board)).get("tbl000001").h, COLLAPSED_CARD_H);
});

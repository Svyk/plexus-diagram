import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard } from "../src/model/board.js";
import { blockUidFromDomId, isQueryString, queryResultLayout, queryResultUids, QUERY_CARD_CAP } from "../src/model/query.js";

test("RG-1: both query forms count, and a note or diagram does not", () => {
  assert.equal(isQueryString("{{[[query]]: {and: [[HACCP]]}}}"), true);
  assert.equal(isQueryString("{{query: {and: [[HACCP]]}}}"), true);
  assert.equal(isQueryString("{{query}}"), true);
  assert.equal(isQueryString("  {{[[query]]}}  "), true);
  assert.equal(isQueryString("{{[[diagram]]:Flow}}"), false);
  assert.equal(isQueryString("see {{query: {and: [[A]]}}} later"), false);
  assert.equal(isQueryString("{{queries}}"), false);
  assert.equal(isQueryString(""), false);
});

test("RG-1: a block id yields its 9-character uid, including a leading hyphen", () => {
  assert.equal(blockUidFromDomId("block-input-db-body-outline-xxnGb6SEj-SQo1XCFLi"), "SQo1XCFLi");
  assert.equal(blockUidFromDomId("block-input-db-body-outline-xxnGb6SEj--vHHNhkc0"), "-vHHNhkc0");
  assert.equal(blockUidFromDomId("block-input-6sW6RitOQegKal2aRqf6pKUspse2-roam-query-ka3EDzkIb-u7c6PQotz"), "u7c6PQotz");
  assert.equal(blockUidFromDomId("block-input-render-block-path-ka3EDzkIb-uuid4fa27c31-4792-400b-a4fd-de63b311804b-ka3EDzkIb"), "ka3EDzkIb");
  assert.equal(blockUidFromDomId("SQo1XCFLi"), "SQo1XCFLi");
  assert.equal(blockUidFromDomId("not-a-block"), null);
  assert.equal(blockUidFromDomId("de63b311804b"), null);
});

test("RG-1: result uids skip the query itself and duplicates", () => {
  const nodes = [];
  const root = {
    querySelectorAll() { return nodes; },
  };
  const add = (id) => nodes.push({ id });
  add("block-input-db-body-outline-pageUID01-queryCCC3");
  add("block-input-db-body-outline-pageUID01-resultAA1");
  add("block-input-db-body-outline-pageUID01-resultAA1");
  add("block-input-db-body-outline-pageUID01-resultBB2");
  assert.deepEqual(queryResultUids(root, "queryCCC3"), ["resultAA1", "resultBB2"]);
  assert.deepEqual(queryResultUids(null, "queryCCC3"), []);
});

test("RG-1: results sit in a ring and stop at 45", () => {
  const one = queryResultLayout({ x: 0, y: 0, w: 280, h: 160 }, ["resultAA1"]);
  assert.deepEqual(one, [{ string: "((resultAA1))", x: 0, y: -380 }]);
  const uids = Array.from({ length: 50 }, (_, i) => `u${String(i).padStart(8, "0")}`);
  const many = queryResultLayout({ x: 10, y: 20, w: 200, h: 100 }, [...uids, uids[0]]);
  assert.equal(many.length, QUERY_CARD_CAP);
  assert.equal(many[0].string, "((u00000000))");
  assert.equal(many[44].string, "((u00000044))");
  assert.ok(many.every((card) => Number.isFinite(card.x) && Number.isFinite(card.y)));
  assert.deepEqual(queryResultLayout(null, ["resultAA1"]), []);
});

test("RG-1: a query block is titled Query", () => {
  const board = buildBoard({
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [{
      ":block/uid": "queryCCC3",
      ":block/string": "{{[[query]]: {and: [[HACCP]]}}}",
      ":block/order": 0,
      ":block/props": { ":plexus": { ":x": 40, ":y": 40, ":w": 280, ":h": 160 } },
      ":block/children": [],
    }],
  });
  assert.equal(board.items.get("queryCCC3").title, "Query");
  assert.equal(board.items.get("queryCCC3").kind, "note");
});

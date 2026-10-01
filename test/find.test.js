import assert from "node:assert/strict";
import test from "node:test";
import { buildBoard } from "../src/model/board.js";
import { findOnBoard } from "../src/model/find.js";

function block(uid, string, plexus, order, children = []) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": plexus ? { ":plexus": plexus } : {},
    ":block/children": children,
  };
}

function sample() {
  return buildBoard({
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      block("cardAAAA1", "Alpha", { ":x": 0, ":y": 0, ":w": 200, ":h": 80 }, 0, [
        { ":block/uid": "kidAAAA01", ":block/string": "child pebble", ":block/order": 0 },
      ]),
      block("sectCCCC3", "Evidence", { ":type": "section", ":x": 0, ":y": 200, ":w": 400, ":h": 200 }, 1),
      block("edgesEEE5", "Connections", { ":type": "edges" }, 2, [
        block("edgeFFFF6", "((cardAAAA1)) → causes → [[Evidence]]", { ":type": "edge", ":from": "cardAAAA1", ":to": "sectCCCC3" }, 0),
      ]),
    ],
  });
}

test("findOnBoard matches card text, a child line, a section title, and an edge label", () => {
  const board = sample();
  assert.deepEqual(findOnBoard(board, "pebble").map((h) => h.uid), ["cardAAAA1"]);
  const evidence = findOnBoard(board, "evidence");
  assert.ok(evidence.some((h) => h.uid === "sectCCCC3" && h.kind === "section"));
  const edge = findOnBoard(board, "causes");
  assert.equal(edge.length, 1);
  assert.equal(edge[0].kind, "edge");
  assert.equal(edge[0].uid, "edgeFFFF6");
  assert.equal(edge[0].focus, "cardAAAA1");
  assert.equal(findOnBoard(board, "   ").length, 0);
  assert.equal(findOnBoard(null, "alpha").length, 0);
});

test("findOnBoard searches one nested board and focuses the card on this board", () => {
  const board = sample();
  const child = buildBoard({
    ":block/uid": "nest0001",
    ":block/string": "{{[[diagram]]:Inner}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      block("deepCARD1", "nested quartz", { ":x": 0, ":y": 0, ":w": 200, ":h": 80 }, 0),
    ],
  });
  const deeper = buildBoard({
    ":block/uid": "deep0001",
    ":block/string": "{{[[diagram]]:Deep}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      block("secret001", "hidden garnet", { ":x": 0, ":y": 0, ":w": 80, ":h": 40 }, 0),
    ],
  });
  const oneLevel = findOnBoard(board, "quartz", [{ parentUid: "nestCARD9", board: child }]);
  assert.deepEqual(oneLevel.map((h) => [h.uid, h.focus, h.kind]), [["deepCARD1", "nestCARD9", "nested"]]);
  const stopped = findOnBoard(board, "garnet", [{ parentUid: "nestCARD9", board: child }]);
  assert.equal(stopped.length, 0);
  const tooDeep = findOnBoard(child, "garnet", [{ parentUid: "deepCARD1", board: deeper }]);
  assert.equal(tooDeep[0].focus, "deepCARD1");
});

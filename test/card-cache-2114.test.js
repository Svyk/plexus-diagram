import assert from "node:assert/strict";
import test from "node:test";

import { createCardCache } from "../src/model/card-cache.js";

test("a block ref keys its target, and setBoard replaces that board", () => {
  const cache = createCardCache();
  cache.setBoard("board1", "Board", [
    { uid: "card1", string: "((hid))" },
    { uid: "card2", target: "other" },
  ]);
  assert.equal(cache.hasChild("card1"), true);
  assert.equal(cache.hasTarget("hid"), true);
  assert.deepEqual(cache.boardsOf("hid"), ["board1"]);
  assert.equal(cache.hasTarget("other"), true);

  cache.setBoard("board2", "Other", [{ uid: "card9", target: "hid" }]);
  assert.deepEqual(cache.boardsOf("hid").sort(), ["board1", "board2"]);

  cache.setBoard("board1", "Board", []);
  assert.equal(cache.hasChild("card1"), false);
  assert.equal(cache.hasTarget("other"), false);
  assert.deepEqual(cache.boardsOf("hid"), ["board2"]);

  cache.clear();
  assert.equal(cache.hasTarget("hid"), false);
  assert.equal(cache.hasChild("card9"), false);
});

test("setBoard stores the title and the card that points at a block", () => {
  const cache = createCardCache();
  cache.setBoard("board1", "P18 fixture", [{ uid: "card1", target: "block1" }]);
  cache.setBoard("board2", "   ", [{ uid: "card2", target: "block1" }]);
  assert.equal(cache.titleOf("board1"), "P18 fixture");
  assert.equal(cache.titleOf("board2"), "Untitled board");
  assert.equal(cache.titleOf("missing"), "Untitled board");
  assert.equal(cache.cardOn("board1", "block1"), "card1");
  assert.equal(cache.cardOn("board2", "block1"), "card2");
  assert.deepEqual(cache.boardsOf("block1").sort(), ["board1", "board2"]);
  cache.setBoard("board1", "P18 fixture", []);
  assert.equal(cache.cardOn("board1", "block1"), "");
  assert.equal(cache.hasTarget("card1"), false);
  assert.deepEqual(cache.boardsOf("block1"), ["board2"]);
});

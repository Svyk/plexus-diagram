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

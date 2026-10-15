import assert from "node:assert/strict";
import test from "node:test";

import { boardPath } from "../src/model/board-path.js";

function diagram(uid, title, depth, props = { ":plexus": { ":v": 2 } }) {
  return {
    ":block/uid": uid,
    ":block/string": `{{[[diagram]]:${title}}}`,
    ":block/props": props,
    ":block/parents": Array.from({ length: depth }, (_, i) => ({ ":db/id": i + 1 })),
  };
}

test("boardPath keeps every v2 diagram ancestor, root first, and drops the rest", () => {
  const parents = [
    diagram("midDDD001", "Four", 4),
    { ":block/uid": "pageBlk01", ":block/string": "just a bullet", ":block/parents": [{ ":db/id": 1 }] },
    diagram("boardAAA1", "Root", 1),
    diagram("nativeNN01", "Native", 0, {}),
    diagram("midCCC001", "Three", 3),
    diagram("midBBB001", "Two", 2),
  ];
  assert.deepEqual(
    boardPath(parents, { uid: "leafEEE01", title: "Leaf" }),
    [
      { uid: "boardAAA1", title: "Root" },
      { uid: "midBBB001", title: "Two" },
      { uid: "midCCC001", title: "Three" },
      { uid: "midDDD001", title: "Four" },
      { uid: "leafEEE01", title: "Leaf" },
    ],
  );
});

test("boardPath of a top-level board is just that board", () => {
  assert.deepEqual(boardPath([], { uid: "boardAAA1", title: "Root" }), [{ uid: "boardAAA1", title: "Root" }]);
  assert.deepEqual(
    boardPath(
      [{ ":block/uid": "pageBlk01", ":block/string": "a page bullet", ":block/parents": [] }],
      { uid: "boardAAA1", title: "Root" },
    ),
    [{ uid: "boardAAA1", title: "Root" }],
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { childrenFingerprint, DiagramModel, importNativeLayout, parsePullResult } from "../src/model.js";

const fixtureDir = dirname(fileURLToPath(import.meta.url));

test("parsePullResult maps live diagram pull shape into model", async () => {
  const raw = JSON.parse(await readFile(resolve(fixtureDir, "fixtures/diagram-pull.json"), "utf8"));
  const tree = parsePullResult(raw);
  const model = new DiagramModel({ diagramUid: tree.uid, tree, metadataLayout: null });
  assert.equal(model.children.length, 2);
  assert.equal(model.children[0].uid, "child-a");
  assert.deepEqual(model.viewport, { x: 10, y: 20, zoom: 1.25 });
  assert.equal(model.nodes.get("child-a")?.pos.x, 100);
});

test("childrenFingerprint changes when a child string changes", () => {
  const before = [{ uid: "a", string: "one", order: 0 }];
  const after = [{ uid: "a", string: "two", order: 0 }];
  assert.notEqual(childrenFingerprint(before), childrenFingerprint(after));
});

test("importNativeLayout does not clobber metadata positions", () => {
  const tree = parsePullResult({
    ":block/uid": "d1",
    ":block/children": [{ ":block/uid": "child-a", ":block/string": "A", ":block/order": 0 }],
    ":diagram/nodes": [{
      ":block/uid": "node-a",
      ":diagram.node/data": { position: { x: 40, y: 40 }, width: 200, height: 120 },
      ":diagram.node/block": { ":block/uid": "child-a" },
    }],
    ":diagram/edges": [],
  });
  const metadata = {
    nodes: new Map([["child-a", { pos: { x: 5, y: 5 }, size: { width: 100, height: 100 }, color: "" }]]),
    edges: [],
  };
  const imported = importNativeLayout(tree, metadata);
  assert.deepEqual(imported.nodes.get("child-a").pos, { x: 5, y: 5 });
});

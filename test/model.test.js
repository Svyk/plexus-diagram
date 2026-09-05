import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { childrenFingerprint, DiagramModel, DIAGRAM_PULL_PATTERN, importNativeLayout, parsePullResult, stripKeywords } from "../src/model.js";
import { MetadataStore } from "../src/metadata.js";

const fixtureDir = dirname(fileURLToPath(import.meta.url));

test("DIAGRAM_PULL_PATTERN is an EDN string for roamAlphaAPI.data.pull", () => {
  assert.equal(typeof DIAGRAM_PULL_PATTERN, "string");
  assert.match(DIAGRAM_PULL_PATTERN, /^\[:block\/uid/);
});

test("stripKeywords removes leading colons from object keys", () => {
  assert.deepEqual(stripKeywords({ ":x": 1, nested: { ":y": 2 } }), { x: 1, nested: { y: 2 } });
});

test("parsePullResult reads viewport from colon-keyed rf-diagram props", () => {
  const tree = parsePullResult({
    ":block/uid": "d1",
    ":block/props": {
      ":rf-diagram": {
        ":viewport": { ":x": 0, ":y": 0, ":zoom": 1 },
      },
    },
    ":block/children": [],
  });
  const model = new DiagramModel({ diagramUid: "d1", tree, metadataLayout: null });
  assert.deepEqual(model.viewport, { x: 0, y: 0, zoom: 1 });
});

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

test("addEdge keeps a label on the edge shape", () => {
  const model = new DiagramModel({
    diagramUid: "d1",
    tree: { uid: "d1", string: "{{[[diagram]]}}", children: [], props: {}, diagramNodes: [], diagramEdges: [] },
    metadataLayout: null,
  });
  const edge = model.addEdge("a", "b", "bezier", "because");
  assert.equal(edge.label, "because");
  assert.equal(model.addEdge("a", "b", "bezier"), null);
  assert.equal(model.edges[0].label, "because");
  const unlabeled = model.addEdge("b", "a");
  assert.equal(unlabeled.label, "");
});

test("applyPull does not drop an in-memory label for a known edge", () => {
  const tree = {
    uid: "d1",
    string: "{{[[diagram]]}}",
    children: [{ uid: "a", string: "A", order: 0 }, { uid: "b", string: "B", order: 1 }],
    props: {},
    diagramNodes: [],
    diagramEdges: [],
  };
  const model = new DiagramModel({
    diagramUid: "d1",
    tree,
    metadataLayout: {
      nodes: new Map(),
      edges: [{ source: "a", target: "b", kind: "bezier", label: "kept" }],
      sections: new Map(),
    },
  });
  assert.equal(model.edges[0].label, "kept");
  model.applyPull(tree, { nodes: new Map(), edges: [{ source: "a", target: "b", kind: "bezier" }], sections: new Map() });
  assert.equal(model.edges[0].label, "kept");
});

test("addEdge stores from/to/direction/color from extra argument", () => {
  const model = new DiagramModel({
    diagramUid: "d1",
    tree: { uid: "d1", string: "{{[[diagram]]}}", children: [], props: {}, diagramNodes: [], diagramEdges: [] },
    metadataLayout: null,
  });
  const edge = model.addEdge("a", "b", "bezier", "", {
    from: "right",
    to: "left",
    direction: "twoWay",
    color: "teal",
  });
  assert.equal(edge.from, "right");
  assert.equal(edge.to, "left");
  assert.equal(edge.direction, "twoWay");
  assert.equal(edge.color, "teal");
  assert.equal(model.addEdge("a", "b", "bezier", "", { direction: "oneWay" }), null);
});

test("applyPull adopts from/to/direction/color for new edges but not existing", () => {
  const tree = {
    uid: "d1",
    string: "{{[[diagram]]}}",
    children: [
      { uid: "a", string: "A", order: 0 },
      { uid: "b", string: "B", order: 1 },
      { uid: "c", string: "C", order: 2 },
    ],
    props: {},
    diagramNodes: [],
    diagramEdges: [],
  };
  const model = new DiagramModel({
    diagramUid: "d1",
    tree,
    metadataLayout: {
      nodes: new Map(),
      edges: [{
        source: "a",
        target: "b",
        kind: "bezier",
        label: "",
        from: "auto",
        to: "auto",
        direction: "oneWay",
        color: "",
      }],
      sections: new Map(),
    },
  });
  assert.equal(model.edges[0].direction, "oneWay");
  model.applyPull(tree, {
    nodes: new Map(),
    edges: [
      {
        source: "a",
        target: "b",
        kind: "bezier",
        label: "",
        from: "right",
        to: "left",
        direction: "twoWay",
        color: "teal",
      },
      {
        source: "b",
        target: "c",
        kind: "bezier",
        label: "",
        from: "top",
        to: "bottom",
        direction: "none",
        color: "rose",
      },
    ],
    sections: new Map(),
  });
  assert.equal(model.edges[0].direction, "oneWay");
  const newEdge = model.edges.find((edge) => edge.source === "b" && edge.target === "c");
  assert.equal(newEdge.from, "top");
  assert.equal(newEdge.to, "bottom");
  assert.equal(newEdge.direction, "none");
  assert.equal(newEdge.color, "rose");
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

test("importNativeLayout deep-copies edges so model mutations detect store drift", () => {
  const metadataLayout = {
    nodes: new Map([["a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 }, color: "" }]]),
    edges: [{
      source: "a",
      target: "b",
      kind: "bezier",
      label: "",
      from: "auto",
      to: "auto",
      direction: "oneWay",
      color: "",
    }],
    sections: new Map(),
  };
  const store = new MetadataStore();
  store.diagrams.set("d1", metadataLayout);
  const model = new DiagramModel({
    diagramUid: "d1",
    tree: { uid: "d1", string: "{{[[diagram]]}}", children: [], props: {}, diagramNodes: [], diagramEdges: [] },
    metadataLayout,
  });
  model.edges[0].direction = "twoWay";
  assert.equal(store.layoutMatchesStored("d1", model.layoutSnapshot()), false);
});

test("applyPull drops a node whose uid is gone from children", () => {
  const tree = {
    uid: "d1",
    string: "{{[[diagram]]}}",
    children: [{ uid: "a", string: "A", order: 0 }],
    props: {},
    diagramNodes: [],
    diagramEdges: [],
  };
  const model = new DiagramModel({
    diagramUid: "d1",
    tree: {
      ...tree,
      children: [
        { uid: "a", string: "A", order: 0 },
        { uid: "b", string: "B", order: 1 },
      ],
    },
    metadataLayout: {
      nodes: new Map([
        ["a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 }, color: "" }],
        ["b", { pos: { x: 100, y: 0 }, size: { width: 280, height: 160 }, color: "" }],
      ]),
      edges: [{ source: "a", target: "b", kind: "bezier", label: "" }],
      sections: new Map(),
    },
  });
  assert.ok(model.nodes.has("b"));
  assert.equal(model.edges.length, 1);
  model.applyPull(tree, { nodes: new Map(), edges: [], sections: new Map() });
  assert.ok(!model.nodes.has("b"));
  assert.equal(model.edges.length, 0);
});

test("removeCard drops node, edges, selection, and children", () => {
  const model = new DiagramModel({
    diagramUid: "d1",
    tree: {
      uid: "d1",
      string: "{{[[diagram]]}}",
      children: [
        { uid: "a", string: "A", order: 0 },
        { uid: "b", string: "B", order: 1 },
      ],
      props: {},
      diagramNodes: [],
      diagramEdges: [],
    },
    metadataLayout: {
      nodes: new Map([
        ["a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 }, color: "" }],
        ["b", { pos: { x: 100, y: 0 }, size: { width: 280, height: 160 }, color: "" }],
      ]),
      edges: [{ source: "a", target: "b", kind: "bezier", label: "" }],
      sections: new Map(),
    },
  });
  model.selected.add("a");
  model.removeCard("a");
  assert.ok(!model.nodes.has("a"));
  assert.ok(!model.selected.has("a"));
  assert.equal(model.children.length, 1);
  assert.equal(model.children[0].uid, "b");
  assert.equal(model.edges.length, 0);
});

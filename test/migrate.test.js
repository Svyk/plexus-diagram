import test from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { buildBoard } from "../src/model/board.js";
import { executeImport, planImport, readNative, readV06Entry } from "../src/host/migrate.js";

function setup() {
  const fake = createFakeRoam({ echoDelay: 1 });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  return { fake, host };
}

const row = (string, children = []) => ({ string, children });

function seedV06(fake) {
  fake.seedPage({
    title: "plexus-diagram/metadata",
    children: [
      row("enhanced::", [
        { uid: "entry1", string: "b1", children: [
          row("viewport:: 5,6,0.5"),
          row("node c1", [row("pos:: 10,10"), row("size:: 280,160"), row("color:: teal")]),
          row("node c2", [row("pos:: 700,20"), row("size:: 300,100")]),
          row("node c3", [row("pos:: 900,900")]),
          row("edge c1->c2", [row("kind:: bezier"), row("label:: causes"), row("direction:: twoWay"), row("from:: right"), row("to:: left"), row("color:: red")]),
          row("edge c2->c3", [row("kind:: step"), row("direction:: none")]),
          row("section s-old", [row("pos:: 0,0"), row("size:: 400,300"), row("title:: Group"), row("color:: blue")]),
        ] },
      ]),
    ],
  });
  fake.seedBoard({
    uid: "b1",
    props: { "rf-diagram": { keep: true } },
    children: [
      { uid: "c1", string: "[[A]]" },
      { uid: "c2", string: "[[B]]" },
      { uid: "c3", string: "((blk123))" },
    ],
  });
}

test("readV06Entry parses rows per spec", () => {
  const { fake, host } = setup();
  seedV06(fake);
  const src = readV06Entry(host, "b1");
  assert.equal(src.entryUid, "entry1");
  assert.deepEqual(src.viewport, { x: 5, y: 6, zoom: 0.5 });
  assert.deepEqual(src.nodes.get("c1"), { x: 10, y: 10, w: 280, h: 160, color: "teal" });
  assert.equal(src.sections.length, 1);
  assert.equal(src.sections[0].title, "Group");
  const [e1, e2] = src.edges;
  assert.equal(e1.route, "curve");
  assert.equal(e1.dir, "two");
  assert.equal(e1.fromSide, "right");
  assert.equal(e1.label, "causes");
  assert.equal(e2.route, "elbow");
  assert.equal(e2.dir, "none");
  assert.equal(readV06Entry(host, "other"), null);
});

test("planImport v06: sections adopt cards by center, relative coords, edges carry strings", () => {
  const { fake, host } = setup();
  seedV06(fake);
  const board = buildBoard(host.pullBoard("b1"));
  const plan = planImport(board, readV06Entry(host, "b1"), { gen: () => "sec1" });
  assert.equal(plan.sections.length, 1);
  assert.equal(plan.sections[0].uid, "sec1");
  assert.deepEqual(plan.sections[0].members, ["c1"]);
  assert.deepEqual(plan.memberLayouts.map((m) => m.uid), ["c1"]);
  assert.equal(plan.memberLayouts[0].layout.x, 10);
  assert.deepEqual(plan.itemLayouts.map((m) => m.uid).sort(), ["c2", "c3"]);
  assert.equal(plan.edges.length, 2);
  assert.equal(plan.edges[0].string, "[[A]] ↔ causes ↔ [[B]]");
  assert.equal(plan.edges[1].string, "[[B]] — ((blk123))");
  assert.deepEqual(plan.viewport, { x: 5, y: 6, zoom: 0.5 });
  assert.equal(plan.markMigratedUid, "entry1");
});

test("executeImport writes v06 import and merges board props", async () => {
  const { fake, host } = setup();
  seedV06(fake);
  const board = buildBoard(host.pullBoard("b1"));
  let n = 0;
  const plan = planImport(board, readV06Entry(host, "b1"), { gen: () => `sec${++n}` });
  const counts = await executeImport(plan, host, board);
  assert.deepEqual(counts, { sections: 1, members: 1, items: 2, edges: 2 });
  assert.deepEqual(fake.props("b1"), { "rf-diagram": { keep: true }, plexus: { v: 2 } });
  assert.equal(fake.block("c1").parent, "sec1");
  assert.deepEqual(fake.props("sec1").plexus, { type: "section", x: 0, y: 0, w: 400, h: 300, color: "blue" });
  assert.equal(fake.block("sec1").string, "Group");
  assert.equal(fake.block("c1").props.plexus.color, "teal");
  const container = fake.children("b1").at(-1);
  assert.deepEqual(fake.props(container).plexus, { type: "edges" });
  assert.equal(fake.block(container).open, false);
  assert.equal(fake.children(container).length, 2);
  const first = fake.block(fake.children(container)[0]);
  assert.equal(first.string, "[[A]] ↔ causes ↔ [[B]]");
  assert.deepEqual(first.props.plexus, { type: "edge", from: "c1", to: "c2", fromSide: "right", toSide: "left", dir: "two", color: "red" });
  const entryKids = fake.children("entry1").map((u) => fake.block(u).string);
  assert.ok(entryKids.includes("migrated:: 2"));
  assert.deepEqual(host.viewports.get("b1"), { x: 5, y: 6, zoom: 0.5 });
  const after = buildBoard(host.pullBoard("b1"));
  assert.equal(after.enhanced, true);
  assert.equal(after.edges.size, 2);
});

function seedNative(fake) {
  fake.seedBoard({
    uid: "n1",
    children: [
      { uid: "a", string: "[[A]]" },
      { uid: "b", string: "[[B]]" },
      { uid: "g", string: "Group" },
      { uid: "in", string: "[[Inner]]" },
    ],
    diagram: {
      nodes: [
        { id: 1, blockUid: "a", data: { position: { x: 0, y: 0 }, width: 120, height: 60 } },
        { id: 2, blockUid: "b", data: JSON.stringify({ position: { x: 300, y: 100 }, width: 120, height: 60 }) },
        { id: 3, blockUid: "g", data: { position: { x: 0, y: 300 }, width: 400, height: 300, type: "group" } },
        { id: 4, blockUid: "in", data: { position: { x: 20, y: 40 }, width: 120, height: 60 }, parentId: 3 },
      ],
      edges: [{ source: 1, target: 2, data: { label: "leads to" } }],
    },
  });
}

test("readNative parses nodes, groups, and edges", () => {
  const { fake, host } = setup();
  seedNative(fake);
  const src = readNative(host, "n1");
  assert.equal(src.nodes.length, 4);
  assert.equal(src.nodes.find((n) => n.blockUid === "g").type, "group");
  assert.equal(src.nodes.find((n) => n.blockUid === "in").parentNode, "g");
  assert.equal(src.nodes.find((n) => n.blockUid === "b").x, 300);
  assert.deepEqual(src.edges, [{ from: "a", to: "b", label: "leads to" }]);
});

test("planImport native scales positions by 240/width and nests groups", () => {
  const { fake, host } = setup();
  seedNative(fake);
  const board = buildBoard(host.pullBoard("n1"));
  const plan = planImport(board, readNative(host, "n1"), { gen: () => "unused" });
  const b = plan.itemLayouts.find((i) => i.uid === "b").layout;
  assert.equal(b.x, 600);
  assert.equal(b.y, 200);
  assert.equal(b.w, 240);
  assert.equal(b.h, 120);
  const g = plan.sections[0];
  assert.equal(g.uid, "g");
  assert.equal(g.existing, true);
  assert.equal(g.layout.x, 0);
  assert.equal(g.layout.y, 600);
  assert.equal(g.layout.w, 800);
  assert.deepEqual(g.members, ["in"]);
  const inner = plan.memberLayouts.find((m) => m.uid === "in").layout;
  assert.equal(inner.x, 40);
  assert.equal(inner.y, 80);
  assert.equal(plan.edges[0].string, "[[A]] → leads to → [[B]]");
  assert.equal(plan.markMigratedUid, null);
});

test("executeImport native converts existing group block in place", async () => {
  const { fake, host } = setup();
  seedNative(fake);
  const board = buildBoard(host.pullBoard("n1"));
  const plan = planImport(board, readNative(host, "n1"), { gen: () => "x" });
  await executeImport(plan, host, board);
  assert.equal(fake.block("in").parent, "g");
  assert.equal(fake.props("g").plexus.type, "section");
  assert.equal(fake.props("n1").plexus.v, 2);
  assert.equal(fake.has("x"), false);
});

test("planImport with no source yields an empty plan", () => {
  const { fake, host } = setup();
  fake.seedBoard({ uid: "e1" });
  const board = buildBoard(host.pullBoard("e1"));
  const plan = planImport(board, null);
  assert.deepEqual([plan.itemLayouts, plan.sections, plan.edges], [[], [], []]);
});

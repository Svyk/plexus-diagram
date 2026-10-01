import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { buildBoard } from "../src/model/board.js";
import { executeImport, nativeColor, planImport, readNative, readV06Entry } from "../src/host/migrate.js";

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
  assert.deepEqual(src.edges, [{ from: "a", to: "b", label: "leads to", dir: "one", dash: "solid", route: "straight" }]);
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

test("enhancing a nested, not yet enhanced board keeps its card layout keys", async () => {
  const { fake, host } = setup();
  fake.seedBoard({ uid: "root1", props: { plexus: { v: 2 } } });
  fake.seedBoard({
    uid: "nested1",
    string: "{{[[diagram]]:Inner}}",
    parent: "root1",
    props: { "rf-diagram": { keep: true }, plexus: { x: 40, y: 60, w: 320, h: 220 } },
    children: [{ uid: "k1", string: "kid" }],
  });
  const board = buildBoard(host.pullBoard("nested1"));
  assert.equal(board.enhanced, false);
  const plan = planImport(board, null, { gen: () => "x" });
  await executeImport(plan, host, board);
  assert.deepEqual(fake.props("nested1"), { "rf-diagram": { keep: true }, plexus: { x: 40, y: 60, w: 320, h: 220, v: 2 } });
});

test("executeImport keeps the v marker on an already enhanced child board", async () => {
  const { fake, host } = setup();
  fake.seedBoard({
    uid: "n1",
    children: [{ uid: "a", string: "[[A]]" }],
    diagram: { nodes: [{ id: 1, blockUid: "a", data: { position: { x: 10, y: 10 }, width: 300, height: 200 } }], edges: [] },
  });
  fake.seedBoard({ uid: "kid", string: "{{[[diagram]]:Inner}}", parent: "n1", props: { plexus: { v: 2 } } });
  const board = buildBoard(host.pullBoard("n1"));
  const plan = planImport(board, readNative(host, "n1"), { gen: () => "x" });
  plan.itemLayouts.push({ uid: "kid", layout: { x: 5, y: 5, w: 300, h: 200 } });
  await executeImport(plan, host, board);
  assert.equal(fake.props("kid").plexus.v, 2);
  assert.equal(fake.props("kid").plexus.x, 5);
});

const capturedNative = JSON.parse(readFileSync(new URL("./fixtures/native-2ZkxxgO7I.json", import.meta.url), "utf8"));

test("nativeColor keeps palette and hex, and drops anything else", () => {
  assert.equal(nativeColor("black"), "#000000");
  assert.equal(nativeColor("white"), "#ffffff");
  assert.equal(nativeColor("#F55656"), "#f55656");
  assert.equal(nativeColor("#abc"), "#aabbcc");
  assert.equal(nativeColor("#A7B6C23F"), "#a7b6c2");
  assert.equal(nativeColor("rgb(72, 175, 240)"), "#48aff0");
  assert.equal(nativeColor("rgba(225, 232, 237, 0.2)"), "#e1e8ed");
  assert.equal(nativeColor("teal"), "teal");
  assert.equal(nativeColor("var(--x)"), undefined);
  assert.equal(nativeColor("not-a-color"), undefined);
});

test("readNative on the captured unstyled diagram invents no colors", () => {
  const src = readNative({ pullNative: () => capturedNative }, "2ZkxxgO7I");
  assert.equal(src.nodes.length, 3);
  assert.equal(src.edges.length, 1);
  assert.deepEqual(src.boardStyle, {});
  for (const n of src.nodes) assert.deepEqual(n.style, {});
  const byUid = Object.fromEntries(src.nodes.map((n) => [n.blockUid, n]));
  assert.equal(byUid.b0U1aGvkN.x, 73.0592041015625);
  assert.equal(byUid.b0U1aGvkN.y, 575.9983177185059);
  assert.equal(byUid.b0U1aGvkN.w, 334);
  assert.equal(byUid.b0U1aGvkN.h, 280);
  assert.equal(byUid.djnPeF1zP.w, 873);
  assert.equal(byUid["3nMhsYFxi"].h, 204);
  assert.deepEqual(src.edges[0], {
    from: "djnPeF1zP", to: "3nMhsYFxi", label: "", dir: "one", dash: "solid", route: "straight",
  });
  assert.equal(src.edges[0].color, undefined);
});

test("executeImport maps stored native styles and leaves :diagram data untouched", async () => {
  const { fake, host } = setup();
  fake.seedBoard({
    uid: "s1",
    children: [
      { uid: "a", string: "[[A]]" },
      { uid: "b", string: "[[B]]" },
      { uid: "g", string: "Group" },
      { uid: "in", string: "[[Inner]]" },
    ],
    props: {
      "rf-diagram": {
        "diagram-property-data": {
          "diagram-background-color": "#112233",
          "diagram-background-texture": "lines",
        },
        "overridden-data-defaults": { block: { "block-text-align": "center" } },
      },
    },
    diagram: {
      nodes: [
        { id: 1, blockUid: "a", data: { position: { x: 0, y: 0 }, width: 120, height: 60, data: {
          "block-font-size": 20, "block-text-color": "black", "block-text-align": "left",
          "block-fill-color": "#F55656", "block-border-color": "rgb(72, 175, 240)",
        } } },
        { id: 2, blockUid: "b", data: { position: { x: 300, y: 0 }, width: 120, height: 60, data: { "block-font-size": 14 } } },
        { id: 3, blockUid: "g", data: { position: { x: 0, y: 300 }, width: 400, height: 300, type: "group", data: {
          "group-title-font-size": 22, "group-title-text-color": "white", "group-title-fill-color": "#A7B6C23F",
          "group-area-fill-color": "rgba(225, 232, 237, 0.2)", "group-border-color": "teal",
        } } },
        { id: 4, blockUid: "in", data: { position: { x: 20, y: 40 }, width: 120, height: 60, data: {
          "block-font-size": 4, "block-text-align": "start", "block-fill-color": "var(--blue)",
        } }, parentId: 3 },
      ],
      edges: [
        { source: 1, target: 2, data: { label: "styled", data: {
          "edge-direction-type": "bidirected", "edge-decoration": "animated",
          "edge-type": "floating-bezier", "edge-stroke-color": "#F55656",
        } } },
        { source: 1, target: 3, data: { type: "floating-smooth-step", animated: true, style: { stroke: "#00ff00" } } },
      ],
    },
  });
  const before = host.pullNative("s1");
  const board = buildBoard(host.pullBoard("s1"));
  const src = readNative(host, "s1");
  assert.equal(src.nodes.find((n) => n.blockUid === "b").style.align, "center");
  assert.equal(src.nodes.find((n) => n.blockUid === "a").style.align, "left");
  assert.deepEqual(src.boardStyle, { bg: "lines", bgColor: "#112233" });
  const plan = planImport(board, src, { gen: () => "x" });
  await executeImport(plan, host, board);
  const after = host.pullNative("s1");
  assert.deepEqual(after[":diagram/nodes"], before[":diagram/nodes"]);
  assert.deepEqual(after[":diagram/edges"], before[":diagram/edges"]);
  assert.deepEqual(after[":block/props"][":rf-diagram"], before[":block/props"][":rf-diagram"]);
  assert.equal(fake.props("s1").plexus.v, 2);
  assert.equal(fake.props("s1").plexus.bg, "lines");
  assert.equal(fake.props("s1").plexus.bgColor, "#112233");
  assert.deepEqual(
    (({ fontSize, textColor, align, fill, border }) => ({ fontSize, textColor, align, fill, border }))(fake.props("a").plexus),
    { fontSize: 20, textColor: "#000000", align: "left", fill: "#f55656", border: "#48aff0" },
  );
  assert.equal(fake.props("b").plexus.align, "center");
  assert.equal(fake.props("b").plexus.fontSize, undefined);
  assert.deepEqual(
    (({ titleSize, titleColor, titleFill, areaFill, border }) => ({ titleSize, titleColor, titleFill, areaFill, border }))(fake.props("g").plexus),
    { titleSize: 22, titleColor: "#ffffff", titleFill: "#a7b6c2", areaFill: "#e1e8ed", border: "teal" },
  );
  assert.equal(fake.props("in").plexus.fontSize, 10);
  assert.equal(fake.props("in").plexus.align, undefined);
  assert.equal(fake.props("in").plexus.fill, undefined);
  const box = fake.children("s1").map((u) => fake.block(u)).find((b) => b.string === "Connections");
  const edges = fake.children(box.uid).map((u) => fake.props(u).plexus);
  const styled = edges.find((e) => e.to === "b");
  const fallback = edges.find((e) => e.to === "g");
  assert.equal(styled.dir, "two");
  assert.equal(styled.dash, "animated");
  assert.equal(styled.route, undefined);
  assert.equal(styled.color, "#f55656");
  assert.equal(fallback.dir, undefined);
  assert.equal(fallback.dash, "animated");
  assert.equal(fallback.route, "elbow");
  assert.equal(fallback.color, "#00ff00");
});

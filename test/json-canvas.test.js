import test from "node:test";
import assert from "node:assert/strict";

import { buildBoard, worldRects } from "../src/model/board.js";
import {
  blocksToText, boardToCanvas, boardToCanvasText, canvasFileName, canvasTitle, canvasToTree, exportCanvas,
  mdToRoam, parseCanvas, roamToMd, textToBlocks,
} from "../src/model/json-canvas.js";
import { planCopy, starterById } from "../src/model/templates.js";
import { parseBoardTitle } from "../src/model/schema.js";

const SAMPLE = {
  nodes: [
    { id: "g1", type: "group", x: -40, y: -60, width: 900, height: 500, label: "Research", color: "4" },
    { id: "g2", type: "group", x: 0, y: 0, width: 400, height: 300, label: "Inner" },
    { id: "t1", type: "text", x: 20, y: 40, width: 250, height: 120, text: "Idea **one**\n- point a\n  - detail\n- point *b*", color: "1" },
    { id: "f1", type: "file", x: 450, y: 40, width: 300, height: 160, file: "Notes/Reading list.md" },
    { id: "l1", type: "link", x: 1000, y: 0, width: 300, height: 200, url: "https://jsoncanvas.org/spec/1.0/", color: "#3355ff" },
    { id: "t2", type: "text", x: 1000, y: 400, width: 260, height: 100, text: "Loose ==note==" },
  ],
  edges: [
    { id: "e1", fromNode: "t1", toNode: "f1", fromSide: "right", toSide: "left", label: "reads" },
    { id: "e2", fromNode: "f1", toNode: "l1", fromEnd: "arrow", toEnd: "arrow", color: "6" },
    { id: "e3", fromNode: "t2", toNode: "g1", toEnd: "none" },
    { id: "e4", fromNode: "l1", toNode: "t2", fromSide: "bottom" },
  ],
};

function boardFromCanvas(canvas, title = "Sample") {
  const parsed = parseCanvas(JSON.stringify(canvas));
  assert.equal(parsed.error, undefined);
  const { tree, counts } = canvasToTree(parsed, { title });
  const board = buildBoard(tree);
  return { board, rects: worldRects(board), counts, tree, parsed };
}

// Ids differ after a trip (blocks get their own uids); compare by position in the node list.
function normalize(canvas) {
  const index = new Map(canvas.nodes.map((n, i) => [n.id, i]));
  const nodes = canvas.nodes.map(({ id, ...rest }) => rest);
  const edges = canvas.edges.map(({ id, fromNode, toNode, ...rest }) => ({ from: index.get(fromNode), to: index.get(toNode), ...rest }));
  return { nodes, edges };
}

test("JC-1: canvas → board → canvas keeps every node, group, color, side, end and label", () => {
  const { board, rects, counts } = boardFromCanvas(SAMPLE);
  assert.deepEqual(counts, { cards: 4, sections: 2, arrows: 4 });
  const back = boardToCanvas(board, rects);
  const want = normalize(SAMPLE);
  const got = normalize(back);
  const byKey = (n) => `${n.type}:${n.x}:${n.y}`;
  const sortNodes = (list) => [...list].sort((a, b) => byKey(a).localeCompare(byKey(b)));
  assert.deepEqual(sortNodes(got.nodes), sortNodes(want.nodes));
  // The arrow ends name the same nodes as before (by their content).
  const label = (canvas, id) => {
    const n = canvas.nodes.find((x) => x.id === id);
    return n.text ?? n.file ?? n.url ?? n.label;
  };
  const ends = (canvas) => canvas.edges.map((e) => {
    const { id, fromNode, toNode, ...rest } = e;
    return { a: label(canvas, fromNode), b: label(canvas, toNode), ...rest };
  });
  const sortEdges = (list) => [...list].sort((x, y) => `${x.a}${x.b}`.localeCompare(`${y.a}${y.b}`));
  const wantEdges = ends(SAMPLE).map((e) => {
    // fromEnd none / toEnd arrow are the defaults and are left out on export.
    const out = { ...e };
    if (out.fromEnd === "none") delete out.fromEnd;
    if (out.toEnd === "arrow") delete out.toEnd;
    return out;
  });
  assert.deepEqual(sortEdges(ends(back)), sortEdges(wantEdges));
});

test("JC-2: groups become sections that hold the nodes they contain, at relative positions", () => {
  const { board } = boardFromCanvas(SAMPLE);
  const byString = (s) => [...board.items.values()].find((i) => i.string === s);
  const outer = byString("Research");
  const inner = byString("Inner");
  assert.equal(outer.type, "section");
  assert.equal(outer.color, "green");
  assert.equal(inner.parentUid, outer.uid);
  assert.deepEqual([inner.x, inner.y], [40, 60]);
  const idea = byString("Idea **one**");
  assert.equal(idea.parentUid, inner.uid);
  assert.equal(idea.color, "red");
  assert.deepEqual(idea.content.map((c) => c[":block/string"]), ["point a", "point __b__"]);
  assert.equal(idea.content[0][":block/children"][0][":block/string"], "detail");
  const file = byString("[[Notes/Reading list]]");
  assert.equal(file.kind, "page");
  assert.equal(file.parentUid, outer.uid);
  assert.equal(byString("https://jsoncanvas.org/spec/1.0/").parentUid, board.uid);
});

test("JC-3: arrows read back with their labels, directions and colors", () => {
  const { board } = boardFromCanvas(SAMPLE);
  const edges = [...board.edges.values()];
  assert.equal(edges.length, 4);
  assert.ok(edges.every((e) => e.valid));
  const reads = edges.find((e) => e.label === "reads");
  assert.deepEqual([reads.fromSide, reads.toSide, reads.dir], ["right", "left", "one"]);
  assert.ok(edges.some((e) => e.dir === "two" && e.color === "purple"));
  assert.ok(edges.some((e) => e.dir === "none"));
  // No uid or page ref leaks into a label.
  assert.ok(edges.every((e) => !/\(\(|\[\[/.test(e.label)));
});

test("JC-4: an arrow drawn only at its start end flips so the head stays on the same node", () => {
  const canvas = {
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "A" },
      { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "B" },
    ],
    edges: [{ id: "e", fromNode: "a", toNode: "b", fromSide: "right", toSide: "left", fromEnd: "arrow", toEnd: "none" }],
  };
  const { board, rects } = boardFromCanvas(canvas);
  const [edge] = board.edges.values();
  assert.equal(board.items.get(edge.from).string, "B");
  assert.deepEqual([edge.fromSide, edge.toSide], ["left", "right"]);
  const back = boardToCanvas(board, rects);
  const e = back.edges[0];
  const text = (id) => back.nodes.find((n) => n.id === id).text;
  assert.deepEqual([text(e.fromNode), text(e.toNode), e.fromSide, e.toSide, e.fromEnd, e.toEnd], ["B", "A", "left", "right", undefined, undefined]);
});

test("JC-5: a Plexus board → canvas → board keeps sections, cards, rects and arrows", () => {
  const starter = starterById("process").tree;
  const first = buildBoard(starter);
  const firstRects = worldRects(first);
  const text = boardToCanvasText(first, firstRects);
  const canvas = JSON.parse(text);
  assert.equal(canvas.nodes.filter((n) => n.type === "group").length, 3);
  assert.equal(canvas.edges.length, 6);
  // Groups come first so Obsidian draws them behind their cards.
  assert.ok(canvas.nodes.slice(0, 3).every((n) => n.type === "group"));
  const { board: second, rects: secondRects } = boardFromCanvas(canvas, "Process flow");
  const shape = (board, rects) => [...board.items.values()].map((i) => ({
    type: i.type, string: i.string, rect: [rects.get(i.uid).x, rects.get(i.uid).y, rects.get(i.uid).w, rects.get(i.uid).h],
    parent: board.items.get(i.parentUid)?.string ?? null,
  })).sort((a, b) => a.string.localeCompare(b.string));
  const flat = (rows) => rows.map((r) => ({ ...r, type: r.type === "text" ? "card" : r.type }));
  assert.deepEqual(flat(shape(second, secondRects)), flat(shape(first, firstRects)));
  const arrows = (board) => [...board.edges.values()].map((e) => ({
    a: board.items.get(e.from).string, b: board.items.get(e.to).string, label: e.label, fromSide: e.fromSide, toSide: e.toSide,
  })).sort((x, y) => `${x.a}${x.b}`.localeCompare(`${y.a}${y.b}`));
  assert.deepEqual(arrows(second), arrows(first));
});

test("JC-6: planCopy gives the import fresh uids and keeps arrow ends and refs on them", () => {
  const { tree } = boardFromCanvas(SAMPLE);
  let n = 0;
  const plan = planCopy(tree, { genUid: () => `u${n += 1}`, parentUid: "host", plexusPatch: { x: 10, y: 20, w: 320, h: 220, v: 2 } });
  const uids = new Set(plan.creates.map((c) => c.uid));
  assert.equal(uids.size, plan.creates.length);
  assert.equal(plan.creates[0].parent, "host");
  assert.equal(parseBoardTitle(plan.creates[0].string), "Sample");
  const edges = plan.creates.filter((c) => c.props?.plexus?.type === "edge");
  assert.equal(edges.length, 4);
  for (const e of edges) {
    assert.ok(uids.has(e.props.plexus.from) && uids.has(e.props.plexus.to));
    assert.ok(!/\(\(jc/.test(e.string), e.string);
  }
  assert.ok(plan.creates.every((c) => !String(c.uid).startsWith("jc")));
});

test("JC-7: parseCanvas rejects what is not a canvas and skips broken nodes and edges", () => {
  assert.ok(parseCanvas("nope").error);
  assert.ok(parseCanvas("[]").error);
  assert.ok(parseCanvas(JSON.stringify({ nodes: {} })).error);
  assert.deepEqual(parseCanvas("{}"), { nodes: [], edges: [], skipped: 0 });
  const parsed = parseCanvas(JSON.stringify({
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "ok" },
      { id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "dupe" },
      { id: "b", type: "widget", x: 0, y: 0, width: 10, height: 10 },
      { id: "c", type: "text", x: "0", y: 0, width: 10, height: 10 },
    ],
    edges: [{ id: "e", fromNode: "a", toNode: "zz" }, { id: "f", fromNode: "a", toNode: "a" }],
  }));
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.edges.length, 0);
  assert.equal(parsed.skipped, 5);
});

test("JC-8: Markdown and Roam inline marks convert both ways", () => {
  assert.equal(mdToRoam("*it* **bold** ==hi== [[Page|alias]]"), "__it__ **bold** ^^hi^^ [alias]([[Page]])");
  assert.equal(roamToMd("__it__ **bold** ^^hi^^ [alias]([[Page]])"), "*it* **bold** ==hi== [[Page|alias]]");
  const blocks = textToBlocks("# Title\n\nPara\n- a\n    - b\n1. c");
  assert.equal(blocks.string, "Title");
  assert.deepEqual(blocks.children.map((c) => c.string), ["Para", "a", "c"]);
  assert.equal(blocks.children[1].children[0].string, "b");
  assert.equal(blocksToText("Title", [{ ":block/string": "a", ":block/order": 0, ":block/children": [{ ":block/string": "b" }] }]), "Title\n- a\n  - b");
});

test("JC-9: file names and titles", () => {
  assert.equal(canvasTitle("/x/Project map.canvas"), "Project map");
  assert.equal(canvasTitle(""), "Untitled board");
  assert.equal(canvasFileName("A/B: c"), "A-B- c.canvas");
});

test("JC-10: export writes what a card shows, not Roam markup", () => {
  const strings = { abcdefghi: "Target **text** with ((zzzzzzzzz))", zzzzzzzzz: "inner" };
  const board = buildBoard({
    ":block/uid": "b", ":block/string": "{{[[diagram]]:B}}", ":block/props": { plexus: { v: 2 } },
    ":block/children": [
      { ":block/uid": "c1", ":block/string": "((abcdefghi))", ":block/order": 0, ":block/props": { plexus: { type: "card", x: 0, y: 0, w: 200, h: 100 } } },
      { ":block/uid": "c2", ":block/string": "{{[[TODO]]}} do it ((abcdefghi))", ":block/order": 1, ":block/props": { plexus: { type: "card", x: 300, y: 0, w: 200, h: 100 } } },
      { ":block/uid": "c3", ":block/string": "{{[[pdf]]: https://x.org/y.pdf}}", ":block/order": 2, ":block/props": { plexus: { type: "card", x: 600, y: 0, w: 200, h: 100 } } },
    ],
  }, { resolve: (id) => strings[id] ?? null });
  const canvas = boardToCanvas(board, worldRects(board), { resolve: (id) => strings[id] ?? null });
  const by = (id) => canvas.nodes.find((n) => n.id === id);
  assert.equal(by("c1").text, "Target **text** with inner");
  assert.equal(by("c2").text, "[ ] do it Target **text** with inner");
  assert.deepEqual([by("c3").type, by("c3").url], ["link", "https://x.org/y.pdf"]);
  assert.ok(canvas.nodes.every((n) => !/\(\(|\{\{/.test(n.text ?? "")));
});

test("JC-11: an arrow to an arrow is counted as left out", () => {
  const board = buildBoard({
    ":block/uid": "b", ":block/string": "{{[[diagram]]:B}}", ":block/props": { plexus: { v: 2 } },
    ":block/children": [
      { ":block/uid": "a", ":block/string": "A", ":block/order": 0, ":block/props": { plexus: { type: "card", x: 0, y: 0, w: 200, h: 100 } } },
      { ":block/uid": "c", ":block/string": "C", ":block/order": 1, ":block/props": { plexus: { type: "card", x: 400, y: 0, w: 200, h: 100 } } },
      { ":block/uid": "d", ":block/string": "D", ":block/order": 2, ":block/props": { plexus: { type: "card", x: 400, y: 300, w: 200, h: 100 } } },
      { ":block/uid": "E", ":block/string": "Connections", ":block/order": 3, ":block/props": { plexus: { type: "edges" } }, ":block/children": [
        { ":block/uid": "e1", ":block/string": "((a)) → ((c))", ":block/order": 0, ":block/props": { plexus: { type: "edge", from: "a", to: "c" } } },
        { ":block/uid": "e2", ":block/string": "((d)) → ((e1))", ":block/order": 1, ":block/props": { plexus: { type: "edge", from: "d", to: "e1" } } },
      ] },
    ],
  });
  const { canvas, leftOut } = exportCanvas(board, worldRects(board));
  assert.deepEqual(canvas.edges.map((e) => e.id), ["e1"]);
  assert.equal(board.edges.get("e2").valid, true);
  assert.equal(leftOut, 1);
});

test("JC-12: inline marks leave URLs and code alone; tasks, bold and code fences survive a trip", () => {
  assert.equal(mdToRoam("see https://x.com/*a*/b and `x *y*` but *z*"), "see https://x.com/*a*/b and `x *y*` but __z__");
  assert.equal(mdToRoam("__bold__ _it_"), "**bold** __it__");
  assert.equal(roamToMd(mdToRoam("__bold__ *it*")), "**bold** *it*");
  const blocks = textToBlocks("Plan\n- [ ] buy\n- [x] sold\n```js\nconst a = 1;\n\nconst b = 2;\n```\nafter");
  assert.deepEqual(blocks.children.map((c) => c.string), ["{{[[TODO]]}} buy", "{{[[DONE]]}} sold", "```js\nconst a = 1;\n\nconst b = 2;\n```", "after"]);
  const tree = blocks.children.map((c, i) => ({ ":block/string": c.string, ":block/order": i }));
  assert.equal(blocksToText(blocks.string, tree), "Plan\n- [ ] buy\n- [x] sold\n```js\nconst a = 1;\n\nconst b = 2;\n```\n- after");
});

test("JC-13: link and file nodes with nothing to point at are skipped", () => {
  const parsed = parseCanvas(JSON.stringify({ nodes: [
    { id: "l", type: "link", x: 0, y: 0, width: 10, height: 10, url: "  " },
    { id: "f", type: "file", x: 0, y: 0, width: 10, height: 10 },
  ] }));
  assert.deepEqual([parsed.nodes.length, parsed.skipped], [0, 2]);
});

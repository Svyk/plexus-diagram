import assert from "node:assert/strict";
import test from "node:test";
import { buildBoard, worldRects } from "../src/model/board.js";
import { boardToMarkdown, boardToSvg } from "../src/model/export.js";

const blk = (uid, order, string, plexus, extra = {}) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ...(plexus ? { ":block/props": { ":plexus": Object.fromEntries(Object.entries(plexus).map(([k, v]) => [`:${k}`, v])) } } : {}),
  ...extra,
});

function board() {
  return buildBoard({
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:B}}",
    ":block/children": [
      blk("c1", 0, "Alpha <b> & \"q\"\nsecond line", { x: 0, y: 0, w: 200, h: 100, color: "teal" }, {
        ":block/children": [blk("k1", 0, "detail one", null, { ":block/children": [blk("k2", 0, "deeper", null)] })],
      }),
      blk("s1", 1, "Evidence", { type: "section", x: 0, y: 300, w: 500, h: 400, color: "indigo" }, {
        ":block/children": [
          blk("m2", 1, "Second", { x: 250, y: 50, w: 200, h: 100 }),
          blk("m1", 0, "[[First]]", { x: 20, y: 50, w: 200, h: 100 }),
        ],
      }),
      blk("cont", 2, "Connections", { type: "edges" }, {
        ":block/children": [
          blk("e1", 0, "((c1)) ↔ [[First]]", { type: "edge", from: "c1", to: "m1", dir: "two", color: "red" }),
          blk("e2", 1, "[[First]] → ((m2))", { type: "edge", from: "m1", to: "m2" }),
        ],
      }),
    ],
  });
}

test("boardToSvg is a standalone escaped document with a viewBox from bounds and padding", () => {
  const b = board();
  const svg = boardToSvg(b, worldRects(b), { padding: 10 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="-10 -10 520 720"/);
  assert.match(svg, /Alpha &lt;b&gt; &amp; &quot;q&quot;/);
  assert.doesNotMatch(svg, /<b>/);
  assert.match(svg, /<clipPath id="pxd-clip-\d+">/);
  assert.match(svg, /clip-path="url\(#pxd-clip-\d+\)"/);
  assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org)/);
  assert.doesNotMatch(svg, /href=|<image|<style/);
  assert.ok(svg.endsWith("</svg>"));
});

test("boardToSvg draws sections, connections, arrowheads, and switches palette for dark", () => {
  const b = board();
  const rects = worldRects(b);
  const light = boardToSvg(b, rects);
  const dark = boardToSvg(b, rects, { dark: true });
  assert.match(light, /#4f46e5/);
  assert.match(light, /Evidence/);
  assert.match(dark, /#818cf8/);
  assert.match(dark, /#1e2a35/);
  assert.notEqual(light, dark);
  // two edges: e1 has two arrowheads, e2 one, plus two connection paths
  assert.equal((light.match(/Z" fill=/g) ?? []).length, 3);
  assert.equal((light.match(/<path d="M[^"]*[CL][^"]*" fill="none"/g) ?? []).length, 2);
});

test("boardToSvg honors maxItems and handles an empty board", () => {
  const b = board();
  const svg = boardToSvg(b, worldRects(b), { maxItems: 1 });
  assert.match(svg, /Evidence/);
  assert.doesNotMatch(svg, /Alpha/);
  const empty = buildBoard({ ":block/uid": "e", ":block/string": "", ":block/children": [] });
  const out = boardToSvg(empty, worldRects(empty));
  assert.match(out, /viewBox="-48 -48 96 96"/);
});

test("boardToMarkdown builds headings, bullets, indented content, and connections", () => {
  const b = board();
  const md = boardToMarkdown(b, worldRects(b));
  assert.equal(md, [
    "- Alpha <b> & \"q\"",
    "  - detail one",
    "    - deeper",
    "",
    "# Evidence",
    "- First",
    "- Second",
    "",
    "## Connections",
    "Alpha <b> & \"q\" -> First",
    "First -> Second",
    "",
  ].join("\n"));
});

test("boardToMarkdown nests section headings by depth and labels connections", () => {
  const nested = buildBoard({
    ":block/uid": "b",
    ":block/string": "",
    ":block/children": [
      blk("s1", 0, "Outer", { type: "section", x: 0, y: 0, w: 800, h: 600 }, {
        ":block/children": [blk("s2", 0, "Inner", { type: "section", x: 20, y: 20, w: 400, h: 300 }, {
          ":block/children": [blk("a", 0, "A", { x: 10, y: 10 }), blk("b", 1, "B", { x: 250, y: 10 })],
        })],
      }),
      blk("cont", 1, "Connections", { type: "edges" }, {
        ":block/children": [blk("e1", 0, "((a)) → why → ((b))", { type: "edge", from: "a", to: "b" })],
      }),
    ],
  });
  const md = boardToMarkdown(nested, worldRects(nested));
  assert.match(md, /^# Outer\n\n## Inner\n- A\n- B\n\n## Connections\nA -> .* -> B\n$/);
});

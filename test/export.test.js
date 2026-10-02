import assert from "node:assert/strict";
import test from "node:test";
import { buildBoard, displayRects, worldRects } from "../src/model/board.js";
import { sidePoint } from "../src/model/geometry.js";
import { boardToMarkdown, boardToSvg, dropExternalImages, imageSrc, pngFileName, sliceBoard } from "../src/model/export.js";
import { SHAPES, shapePath } from "../src/model/shapes.js";
import { starterById } from "../src/model/templates.js";

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

test("png names use the board title, then the page title, and strip path characters", () => {
  assert.equal(pngFileName({ boardTitle: "P1 fixture", pageTitle: "Plexus Diagram/Test Lab", date: "2026-10-01" }), "P1 fixture 2026-10-01.png");
  assert.equal(pngFileName({ boardTitle: "", pageTitle: "Plexus Diagram/Test Lab", date: "2026-10-01" }), "Plexus Diagram-Test Lab 2026-10-01.png");
  assert.equal(pngFileName({ boardTitle: "Untitled board", pageTitle: "Notes: today", date: "2026-10-01" }), "Notes- today 2026-10-01.png");
  assert.equal(pngFileName({ boardTitle: "", pageTitle: "", date: "nope" }), "board 1970-01-01.png");
});

test("image cards embed a data URL and never a remote href", () => {
  const src = "https://firebasestorage.googleapis.com/v0/b/x/o/a.png?alt=media&token=t";
  assert.equal(imageSrc(`![](${src})`), src);
  const b = buildBoard({
    ":block/uid": "boardimg",
    ":block/string": "{{[[diagram]]:Pics}}",
    ":block/children": [
      blk("img", 0, `![](${src})`, { x: 10, y: 20, w: 120, h: 80 }),
      blk("note", 1, "beside", { x: 200, y: 20, w: 80, h: 40 }),
    ],
  });
  const rects = worldRects(b);
  const plain = boardToSvg(b, rects);
  assert.match(plain, />Image</);
  assert.doesNotMatch(plain, /firebasestorage|<image|href=/);
  const png = boardToSvg(b, rects, { imageHrefs: new Map([["img", "data:image/png;base64,aaaa"]]) });
  assert.match(png, /<image href="data:image\/png;base64,aaaa"/);
  assert.doesNotMatch(png, /firebasestorage/);
  const rejected = boardToSvg(b, rects, { imageHrefs: new Map([["img", src]]) });
  assert.doesNotMatch(rejected, /<image|firebasestorage/);
  const tainted = `<image href="${src}" x="0" y="0" width="10" height="10"/>`;
  assert.equal(dropExternalImages(`${tainted}<image href="data:image/png;base64,aa" x="1" y="1" width="2" height="2"/>`), `<image href="data:image/png;base64,aa" x="1" y="1" width="2" height="2"/>`);
});

test("sliceBoard keeps the selection and the edge between its ends", () => {
  const b = board();
  const slice = sliceBoard(b, ["c1", "m1"]);
  assert.deepEqual([...slice.items.keys()], ["c1", "m1"]);
  assert.equal(slice.edges.size, 1);
  const edge = [...slice.edges.values()][0];
  assert.equal(edge.from, "c1");
  assert.equal(edge.to, "m1");
  const svg = boardToSvg(slice, worldRects(b));
  assert.match(svg, /Alpha/);
  assert.match(svg, /First/);
  assert.doesNotMatch(svg, /Second/);
  assert.equal(sliceBoard(b, []).edges.size, 0);
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

test("TP-6: a six-shape flow exports each outline and the Yes/No labels", () => {
  const b = buildBoard(starterById("process").tree);
  const rects = worldRects(b);
  const shown = displayRects(b, rects);
  const texts = [...b.items.values()].filter((item) => item.type === "text");
  assert.deepEqual(texts.map((item) => item.shape).sort(), [...SHAPES].sort());
  const svg = boardToSvg(b, rects);
  for (const item of texts) {
    const r = rects.get(item.uid);
    assert.equal(r.shape, item.shape);
    assert.equal(shown.get(item.uid).shape, item.shape);
    assert.ok(svg.includes(shapePath(r, item.shape)), item.shape);
    assert.ok(svg.includes(`>${item.title}<`), item.title);
  }
  assert.match(svg, />Yes</);
  assert.match(svg, />No</);
  const vb = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const noY = Number(svg.match(/y="([^"]+)"[^>]*>No</)[1]);
  assert.ok(noY > vb[1] && noY < vb[1] + vb[3], `No label ${noY} outside ${vb.join(" ")}`);
  const recv = texts.find((item) => item.title === "Receiving");
  const anchor = sidePoint(rects.get(recv.uid), "right");
  assert.ok(anchor.x < rects.get(recv.uid).x + rects.get(recv.uid).w - 1);
  assert.ok(svg.includes(`M${anchor.x} ${anchor.y}`), `${anchor.x} ${anchor.y}`);
  const plain = buildBoard({
    ":block/uid": "b",
    ":block/string": "{{[[diagram]]:Plain}}",
    ":block/children": [blk("t", 0, "Just text", { type: "text", x: 0, y: 0, w: 80, h: 24 })],
  });
  const bare = boardToSvg(plain, worldRects(plain));
  assert.match(bare, />Just text</);
  assert.doesNotMatch(bare, /<path /);
  const card = buildBoard({
    ":block/uid": "b",
    ":block/string": "{{[[diagram]]:Card}}",
    ":block/children": [blk("c", 0, "Card", { type: "card", x: 0, y: 0, w: 80, h: 40, shape: "diamond" })],
  });
  assert.equal(card.items.get("c").shape, undefined);
  assert.equal(worldRects(card).get("c").shape, undefined);
});

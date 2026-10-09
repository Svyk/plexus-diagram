// Figure extract: panel union, page clip, label grow, drawing sheets, caption lists.
// Synthetic geometry only. No fixture PDFs.
import test from "node:test";
import assert from "node:assert/strict";

import { OP } from "../src/model/parse/rules.js";
import { assembleDocument, parsePageGeometry } from "../src/model/parse/index.js";
import { demoteFalseCaptions, drawingSheetPage, findFigures, rasterScanPage } from "../src/model/parse/figures.js";

const H = 792;
const W = 612;
const FONTS = {
  f1: { name: "Helvetica", fontFamily: "sans-serif" },
  fb: { name: "Helvetica-Bold", fontFamily: "sans-serif" },
};

const item = (str, x, y, size = 10, font = "f1", width = str.length * size * 0.5) => ({ str, transform: [size, 0, 0, size, x, y], width, height: size, fontName: font, hasEOL: false });
const row = (y, cells, size = 10, font = "f1", h = H) => cells.map(([text, x]) => item(text, x, h - y, size, font));

function ops(rules = [], boxes = [], images = [], h = H) {
  const fnArray = [];
  const argsArray = [];
  for (const r of rules) {
    const [x0, y0, x1, y1] = r;
    const thick = 0.8;
    const w = x1 - x0 || thick;
    const hh = y1 - y0 || thick;
    fnArray.push(OP.setFillGray, OP.rectangle, OP.fill);
    argsArray.push([0], [x0, h - y1 - (hh === thick ? thick : 0), w, hh], null);
  }
  for (const b of boxes) {
    const [x0, y0, x1, y1, gray] = b;
    fnArray.push(OP.setFillGray, OP.rectangle, OP.fill);
    argsArray.push([gray], [x0, h - y1, x1 - x0, y1 - y0], null);
  }
  for (const im of images) {
    const [x0, y0, x1, y1] = im;
    fnArray.push(OP.save, OP.transform, OP.paintImageXObject, OP.restore);
    argsArray.push(null, [x1 - x0, 0, 0, y1 - y0, x0, h - y1], ["img", 1, 1], null);
  }
  return { fnArray, argsArray };
}

function page(items, { rules = [], boxes = [], images = [], w = W, h = H } = {}, n = 1) {
  return parsePageGeometry({ items, ops: ops(rules, boxes, images, h), w, h, fonts: FONTS }, n);
}

function doc(pages) {
  return assembleDocument(pages, { numPages: pages.length });
}

function ofType(d, type) {
  return d.order.map((id) => d.blocks[id]).filter((b) => b.type === type);
}

const word = (text, x0, y0, x1, y1, size = 9) => ({ text, x0, y0, x1, y1, size, base: y1 });

test("four panels with one caption become one figure that covers the letters", () => {
  const images = [0, 1, 2, 3].map((i) => ({ x0: 40 + i * 122, y0: 120, x1: 150 + i * 122, y1: 230 }));
  const words = [
    ...["a", "b", "c", "d"].map((t, i) => word(t, 48 + i * 122, 102, 58 + i * 122, 114, 9)),
    word("Fig. 3. Four panels of one figure", 40, 242, 280, 254, 10),
  ];
  const { figures, used } = findFigures({ graphics: { images, shapes: [], boxes: [], rules: [] }, words, bodySize: 10, pageW: W, pageH: H });
  assert.equal(figures.length, 1);
  assert.ok(figures[0].bbox[0] <= 48, "left letter is inside");
  assert.ok(figures[0].bbox[2] >= 150 + 3 * 122, "right panel is inside");
  assert.ok(figures[0].bbox[1] <= 114, "panel letters are inside");
  assert.equal(used.has(words[4]), false, "the caption stays out of the crop");
});

test("panels with different figure numbers stay separate, and a wide gap stays separate", () => {
  const images = [
    { x0: 40, y0: 80, x1: 200, y1: 220 },
    { x0: 220, y0: 80, x1: 380, y1: 220 },
  ];
  const words = [
    word("Figure", 40, 228, 80, 240, 10),
    word("1.", 84, 228, 100, 240, 10),
    word("Left", 104, 228, 130, 240, 10),
    word("Figure", 230, 228, 270, 240, 10),
    word("2.", 274, 228, 290, 240, 10),
    word("Right", 294, 228, 330, 240, 10),
  ];
  const split = findFigures({ graphics: { images, shapes: [], boxes: [], rules: [] }, words, bodySize: 10, pageW: W, pageH: H });
  assert.equal(split.figures.length, 2);
  const far = findFigures({
    graphics: { images: [{ x0: 40, y0: 80, x1: 180, y1: 200 }, { x0: 280, y0: 80, x1: 420, y1: 200 }], shapes: [], boxes: [], rules: [] },
    words: [],
    bodySize: 10,
    pageW: W,
    pageH: H,
  });
  assert.equal(far.figures.length, 2);
});

test("a figure box is clipped to the page", () => {
  const { figures } = findFigures({
    graphics: { images: [{ x0: -40, y0: -20, x1: 200, y1: 180 }], shapes: [], boxes: [], rules: [] },
    words: [],
    bodySize: 10,
    pageW: 180,
    pageH: 160,
  });
  assert.equal(figures.length, 1);
  assert.deepEqual(figures[0].bbox, [0, 0, 180, 160]);
});

test("a short legend beside the art joins the box and a body line does not", () => {
  const images = [{ x0: 100, y0: 100, x1: 280, y1: 260 }];
  const legend = [
    word("conv", 300, 140, 328, 150, 8),
    word("3x3", 300, 156, 322, 166, 8),
    word("ReLU", 300, 172, 330, 182, 8),
  ];
  const body = "This is the body paragraph of the page today".split(" ").map((t, i) => word(t, 100 + i * 28, 400, 124 + i * 28, 412, 10));
  const { figures, used } = findFigures({ graphics: { images, shapes: [], boxes: [], rules: [] }, words: [...legend, ...body], bodySize: 10, pageW: W, pageH: H });
  assert.equal(figures.length, 1);
  assert.ok(figures[0].bbox[2] >= 328, "legend is inside the crop");
  assert.ok(figures[0].bbox[3] < 390, "body line stays below the crop");
  assert.equal(body.some((w) => used.has(w)), false);
});

test("a shared axis title under two charts does not pull one box across the other", () => {
  const images = [
    { x0: 120, y0: 300, x1: 300, y1: 440 },
    { x0: 380, y0: 300, x1: 540, y1: 440 },
  ];
  const axis = [
    word("Total", 200, 448, 240, 458, 8),
    word("compute", 250, 448, 310, 458, 8),
    word("exaFLOPs", 400, 448, 470, 458, 8),
  ];
  const { figures } = findFigures({ graphics: { images, shapes: [], boxes: [], rules: [] }, words: axis, bodySize: 10, pageW: W, pageH: H });
  assert.equal(figures.length, 2);
  const left = figures.find((f) => f.bbox[0] < 200);
  const right = figures.find((f) => f.bbox[0] >= 200);
  assert.ok(left.bbox[2] < right.bbox[0], "left crop stops before the right chart");
  assert.ok(left.bbox[3] >= 448, "left crop includes its axis words");
  assert.ok(right.bbox[3] >= 448, "right crop includes its axis words");
  assert.ok(right.bbox[2] >= 470, "right crop includes the rest of the title");
});

test("tiled images with no text are a scan, and a labelled page image is a drawing", () => {
  const tiles = [
    [0, 0, 310, 400],
    [300, 0, W, 400],
    [0, 390, 310, H],
    [300, 390, W, H],
  ];
  assert.equal(rasterScanPage({
    images: tiles.map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1 })),
    shapes: [],
    words: [],
    pageW: W,
    pageH: H,
  }), true);
  const scan = page([], { images: tiles });
  assert.equal(scan.kind, "scan");
  assert.equal(scan.figures.length, 0);
  const sheet = page([
    ...row(80, [["FIG.", 40], ["2A", 80]]),
    ...row(200, [["FIG.", 300], ["3", 340]]),
    ...row(700, [["Sheet", 40], ["5", 80], ["of", 100], ["6", 120]]),
  ], { images: [[-2, 0, W + 2, H]] });
  assert.equal(sheet.scanLayer, true);
  assert.equal(sheet.figures.length, 1);
  const box = sheet.figures[0].bbox;
  assert.ok(box[0] >= 0 && box[1] >= 0 && box[2] <= W && box[3] <= H);
  const tabled = page([
    ...row(40, [["Disease", 60], ["1980", 200], ["1979", 260]]),
    ...row(54, [["Amebiasis", 60], ["2.38", 200], ["1.90", 260]]),
    ...row(68, [["Anthrax", 60], ["0.00", 200], ["0.00", 260]]),
    ...row(82, [["Cholera", 60], ["0.00", 200], ["0.01", 260]]),
    ...row(96, [["Malaria", 60], ["0.91", 200], ["0.34", 260]]),
  ], { images: [[0, 0, W, H]] });
  assert.equal(tabled.figures.length, 0);
  assert.equal(drawingSheetPage({
    images: [{ x0: 0, y0: 0, x1: W, y1: H }],
    lines: tabled.lines,
    tables: [],
    pageW: W,
    pageH: H,
    textChars: 400,
  }), false);
});

test("a contents run is not a caption, and a figure line next to art is", () => {
  const toc = [1, 2, 3, 4].map((n, i) => ({
    type: "caption",
    text: `Figure ${n}. Topic ${n}`,
    bbox: { x0: 72, y0: 100 + i * 16, x1: 280, y1: 112 + i * 16 },
  }));
  demoteFalseCaptions(toc, 10, []);
  assert.equal(toc.every((b) => b.type === "para"), true);
  const lead = [{ type: "caption", text: "Figure 1. Population .... 8", bbox: { x0: 72, y0: 100, x1: 300, y1: 112 } }];
  demoteFalseCaptions(lead, 10, [{ bbox: [70, 90, 300, 140] }]);
  assert.equal(lead[0].type, "para");
  const real = [1, 2, 3].map((n, i) => ({
    type: "caption",
    text: `Figure ${n}. Panel`,
    bbox: { x0: 72, y0: 200 + i * 180, x1: 240, y1: 214 + i * 180 },
  }));
  const figures = real.map((b) => ({ bbox: [72, b.bbox.y0 - 150, 400, b.bbox.y0 - 4] }));
  demoteFalseCaptions(real, 10, figures);
  assert.equal(real.every((b) => b.type === "caption"), true);

  const chart = doc([page([
    item("Figure 1. Chart of the sample", 80, H - 318),
  ], { images: [[80, 120, 400, 300]] })]);
  const fig = ofType(chart, "figure");
  const cap = ofType(chart, "caption");
  assert.equal(fig.length, 1);
  assert.equal(cap.length, 1);
  assert.equal(cap[0].for, fig[0].id);
  assert.equal(fig[0].caption, cap[0].id);

  const bare = doc([page([
    item("Figure", 70, H - 80, 9),
  ], { images: [[50, 50, 500, 400]] })]);
  const bareFig = ofType(bare, "figure")[0];
  const bareCap = ofType(bare, "caption");
  assert.equal(bareCap.length, 1);
  assert.equal(bareCap[0].for, bareFig.id);

  const contents = doc([page([
    ...[1, 2, 3, 4, 5, 6].flatMap((n, i) => row(80 + i * 18, [[`Figure ${n}.`, 72], ["A contents entry for this chart", 140]])),
    ...row(220, [["More words of the contents page sit here in a paragraph", 72]]),
    ...row(240, [["and continue so the page reads as text rather than a drawing", 72]]),
  ], {
    boxes: [[40, 40, 560, 740, 0.2]],
    rules: [[40, 40, 560, 40], [40, 80, 560, 80], [40, 120, 560, 120], [40, 160, 560, 160], [40, 200, 560, 200], [40, 240, 560, 240], [40, 40, 40, 240], [200, 40, 200, 240]],
  })]);
  assert.equal(ofType(contents, "figure").length, 0);
  assert.equal(ofType(contents, "caption").some((b) => /^fig/i.test(b.text)), false);
});

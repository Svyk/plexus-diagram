// Figure extract: panel union, page clip, label grow, drawing sheets, caption lists.
// Synthetic geometry only. No fixture PDFs.
import test from "node:test";
import assert from "node:assert/strict";

import { OP } from "../src/model/parse/rules.js";
import { assembleDocument, parsePageGeometry } from "../src/model/parse/index.js";
import { demoteFalseCaptions, drawingSheetPage, falseFigureReason, figCaptionKey, findFigures, normalizeFigSpelling, rasterScanPage, rejectFalseFigures, sheetRegions } from "../src/model/parse/figures.js";
import { absorbFigureTables, figureLabels, sparseContentsTable } from "../src/model/parse/index.js";

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

test("two plots under one caption are one figure; two captions stay two figures", () => {
  const plots = [
    { x0: 136, y0: 311, x1: 300, y1: 450 },
    { x0: 312, y0: 311, x1: 483, y1: 450 },
  ];
  const above = [
    word("Figure", 108, 220, 150, 232, 10), word("3:", 154, 220, 174, 232, 10), word("Transfer", 180, 220, 230, 232, 10),
    word("Figure", 330, 220, 372, 232, 10), word("4:", 376, 220, 396, 232, 10), word("Linear", 400, 220, 440, 232, 10),
  ];
  let x = 108;
  const cap5 = "Figure 5: Performance versus pre-training compute".split(" ").map((t) => {
    const w = word(t, x, 470, x + t.length * 5.2, 482, 10);
    x += t.length * 5.2 + 3.5;
    return w;
  });
  const one = findFigures({ graphics: { images: plots, shapes: [], boxes: [], rules: [] }, words: [...above, ...cap5], bodySize: 10, pageW: W, pageH: H });
  assert.equal(one.figures.length, 1, "Figure 5's two plots share one caption");
  assert.ok(one.figures[0].bbox[0] <= 140 && one.figures[0].bbox[2] >= 480);
  const side = [
    { x0: 120, y0: 80, x1: 290, y1: 200 },
    { x0: 310, y0: 84, x1: 490, y1: 200 },
  ];
  let sx = 108;
  const cap34 = "Figure 3: Transfer to ImageNet. While Figure 4: Linear few-shot evaluation".split(" ").map((t) => {
    const w = word(t, sx, 214, sx + t.length * 4.6, 226, 10);
    sx += t.length * 4.6 + 3;
    return w;
  });
  const two = findFigures({ graphics: { images: side, shapes: [], boxes: [], rules: [] }, words: cap34, bodySize: 10, pageW: W, pageH: H });
  assert.equal(two.figures.length, 2, "Figure 3 and Figure 4 keep their own boxes");
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

test("a fold-out of horizontal strips is a scan layer, not one page-sized figure", () => {
  const strips = [];
  for (let i = 0; i < 8; i++) strips.push([0, i * 96, W, i * 96 + 90]);
  const labelled = page([
    ...row(40, [["Fig.", 80], ["2", 120]]),
    ...row(700, [["viscosity", 80], ["versus", 160], ["temperature", 240]]),
  ], { images: strips });
  assert.equal(labelled.scanLayer, true);
  assert.equal(labelled.kind, "mixed");
  assert.equal(labelled.figures.length, 0);
  const blank = page([], { images: strips });
  assert.equal(blank.kind, "scan");
  assert.equal(blank.figures.length, 0);
});

test("tick labels on a chart grid are a figure, not a table", () => {
  const rules = [];
  for (let y = 120; y <= 560; y += 40) rules.push([70, y, 540, y]);
  for (let x = 100; x <= 500; x += 80) rules.push([x, 120, x, 560]);
  const items = [];
  for (const y of [140, 500]) items.push(...row(y, [["0.2", 90], ["0.4", 180], [".6", 270], ["0.8", 360], ["1", 450]], 8));
  for (let i = 1; i < 9; i++) items.push(...row(140 + i * 40, [["0.2", 90]], 8));
  const parsed = page(items, { rules });
  assert.equal(parsed.tables.length, 0);
  assert.equal(parsed.figures.length, 1);
  const box = parsed.figures[0].bbox;
  assert.ok(box[2] - box[0] > 300, "the figure spans the grid, not one axis");
  assert.ok(box[3] - box[1] > 300);
});

test("a dense numeric grid stays a table", () => {
  const rules = [];
  for (let y = 120; y <= 560; y += 40) rules.push([70, y, 540, y]);
  for (let x = 100; x <= 500; x += 80) rules.push([x, 120, x, 560]);
  const items = [];
  for (let i = 0; i < 10; i++) {
    const y = 140 + i * 40;
    items.push(...row(y, [["0.2", 90], ["0.4", 180], [".6", 270], ["0.8", 360], ["1", 450]], 8));
  }
  const parsed = page(items, { rules });
  assert.ok(parsed.tables.length >= 1);
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
  assert.equal(sheet.figures.length, 2, "separated FIG labels are two figures");
  for (const fig of sheet.figures) {
    const box = fig.bbox;
    assert.ok(box[0] >= 0 && box[1] >= 0 && box[2] <= W && box[3] <= H);
  }
  assert.ok(sheet.figures[0].bbox[2] <= sheet.figures[1].bbox[0] + 0.1);
  const close = page([
    ...row(80, [["FIG.", 40], ["2A", 70]]),
    ...row(100, [["FIG.", 40], ["2B", 70]]),
    ...row(700, [["Sheet", 40], ["1", 80], ["of", 100], ["2", 120]]),
  ], { images: [[0, 0, W, H]] });
  assert.equal(close.figures.length, 1, "FIG labels closer than the split stay one sheet");
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

function wideLine(text, x0, x1, y, size = 10) {
  return word(text, x0, y, x1, y + size, size);
}

test("label growth stays in the figure's column and leaves the header and the other column's equation number", () => {
  const left = Array.from({ length: 6 }, (_, i) => wideLine("left column body text of this page", 40, 280, 420 + i * 14));
  const right = Array.from({ length: 6 }, (_, i) => wideLine("right column body text of this page", 300, 560, 420 + i * 14));
  const images = [{ x0: 306, y0: 40, x1: 500, y1: 280 }];
  const eq = word("(14)", 250, 160, 278, 172, 10);
  const header = word("Science 877 (2023) 162730", 400, 22, 540, 32, 6);
  const legend = word("ReLU", 508, 100, 536, 110, 8);
  const { figures, used } = findFigures({
    graphics: { images, shapes: [], boxes: [], rules: [] },
    words: [...left, ...right, eq, header, legend],
    bodySize: 10,
    pageW: W,
    pageH: H,
  });
  assert.equal(figures.length, 1);
  const box = figures[0].bbox;
  assert.ok(box[0] >= 300, `left edge ${box[0]} stays in the right column`);
  assert.ok(box[0] > eq.x1, "equation number stays out");
  assert.ok(box[1] >= 40, `top ${box[1]} does not take the running header`);
  assert.ok(box[2] >= 536, "same-column legend joins the crop");
  assert.equal(used.has(eq), false);
  assert.equal(used.has(header), false);
  assert.equal(used.has(legend), true);
});

test("an equation number in the figure's own column does not join the crop", () => {
  const left = Array.from({ length: 6 }, (_, i) => wideLine("left column body text of this page", 40, 250, 620 + i * 14));
  const right = Array.from({ length: 6 }, (_, i) => wideLine("right column body text of this page", 310, 560, 620 + i * 14));
  const images = [{ x0: 40, y0: 200, x1: 200, y1: 380 }];
  const eq = word("(14)", 206, 280, 228, 292, 10);
  const axis = word("kg", 70, 384, 86, 394, 8);
  const { figures, used } = findFigures({
    graphics: { images, shapes: [], boxes: [], rules: [] },
    words: [...left, ...right, eq, axis],
    bodySize: 10,
    pageW: W,
    pageH: H,
  });
  assert.equal(figures.length, 1);
  const box = figures[0].bbox;
  assert.ok(box[2] < eq.x0, `right edge ${box[2]} stops before the equation number`);
  assert.ok(box[3] >= 394, "axis label under the art still joins");
  assert.equal(used.has(eq), false);
  assert.equal(used.has(axis), true);
});

test("side-by-side figure captions on one baseline split onto the figure above each", () => {
  const left = "Figure 3: Transfer to ImageNet. While";
  const right = "Figure 4: Linear few-shot evaluation on Ima-";
  const pageRec = page([
    item(left, 108, H - 226, 10, "f1", 186),
    item(right, 308, H - 226, 10, "f1", 180),
    item("large ViT models perform worse than BiT", 108, H - 240, 10, "f1", 186),
    item("geNet versus pre-training size.", 308, H - 240, 10, "f1", 170),
    item("The models in this experiment share one full line of body text.", 108, H - 280, 10, "f1", 396),
  ], { images: [[120, 80, 290, 210], [320, 80, 490, 210]] });
  const d = doc([pageRec]);
  const caps = ofType(d, "caption");
  const figs = ofType(d, "figure");
  assert.equal(figs.length, 2);
  const fig3 = caps.find((c) => c.text.startsWith("Figure 3"));
  const fig4 = caps.find((c) => c.text.startsWith("Figure 4"));
  assert.ok(fig3, `left caption: ${caps.map((c) => c.text).join(" | ")}`);
  assert.ok(fig4, `right caption: ${caps.map((c) => c.text).join(" | ")}`);
  assert.equal(/Figure 4/.test(fig3.text), false);
  assert.equal(/Figure 3/.test(fig4.text), false);
  assert.match(fig3.text, /large ViT/);
  assert.match(fig4.text, /ImageNet/);
  assert.equal(d.blocks[fig3.for]?.type, "figure");
  assert.equal(d.blocks[fig4.for]?.type, "figure");
  assert.ok(d.blocks[fig3.for].bbox[2] < d.blocks[fig4.for].bbox[0]);
  const body = ofType(d, "para").map((b) => b.text).join(" ");
  assert.match(body, /share one full line/);
});

test("a drawing sheet keeps each FIG label as a caption, including a reversed 2.FIG", () => {
  const sheet = page([
    ...row(80, [["FIG.", 40], ["2A", 80]]),
    item("3", 471, H - 200, 10, "f1", 8),
    item(".", 475, H - 200, 10, "f1", 4),
    item("FIG", 478, H - 200, 10, "f1", 22),
    ...row(700, [["Sheet", 200], ["5", 240], ["of", 260], ["6", 280]]),
  ], { images: [[0, 0, W, H]] });
  const d = doc([sheet]);
  const caps = ofType(d, "caption").map((c) => c.text);
  assert.ok(caps.some((t) => /^FIG\.?\s*2A/.test(t)), `FIG.2A caption: ${caps.join(" | ")}`);
  assert.ok(caps.some((t) => /^FIG\.?\s*3/.test(t)), `reversed FIG caption: ${caps.join(" | ")}`);
  assert.equal(ofType(d, "figure").length, 2);
});

test("OCR spellings of a figure line are captions", () => {
  assert.equal(normalizeFigSpelling("F1g. 2"), "Fig. 2");
  assert.equal(normalizeFigSpelling("FIG,2"), "FIG. 2");
  assert.equal(figCaptionKey("Fig.2 The chart"), "2");
  assert.equal(figCaptionKey("Figs. 5 & 6"), null);
  assert.equal(figCaptionKey("Figure 5.—Distribution of pressure on 8-inch cylinder at sections 9, 10, 11, and 12"), "5");
  assert.equal(figCaptionKey("FiGune 5.--Distribution"), "5");
  assert.equal(normalizeFigSpelling("Fig. l. Showing the springs"), "Fig. 1. Showing the springs");
  assert.equal(normalizeFigSpelling("FiG. II.—Graphs of pressure"), "FiG. 11.—Graphs of pressure");
  assert.equal(normalizeFigSpelling("FIG. III. Something"), "FIG. III. Something");
  assert.equal(normalizeFigSpelling("fig. ii. lower"), "fig. ii. lower");
  assert.equal(figCaptionKey("FiG. II.—Graphs of pressure"), "11");
  const spelled = doc([page([
    item("F1g. 2 Chart of the sample", 80, H - 318),
  ], { images: [[80, 120, 400, 300]] })]);
  const cap = ofType(spelled, "caption");
  const fig = ofType(spelled, "figure");
  assert.equal(cap.length, 1);
  assert.equal(cap[0].for, fig[0].id);
  const comma = doc([page([
    item("FIG,2 Chart of the sample", 80, H - 318),
  ], { images: [[80, 120, 400, 300]] })]);
  assert.equal(ofType(comma, "caption")[0].for, ofType(comma, "figure")[0].id);
});

test("a Fig. line just outside the rules links, and a closer caption is not stolen", () => {
  const beside = doc([page([
    item("Fig. 4", 410, H - 220),
    item("notes", 80, H - 400),
  ], { images: [[80, 140, 400, 340]] })]);
  const cap = ofType(beside, "caption");
  assert.equal(cap.length, 1, `caption: ${cap.map((c) => c.text).join(" | ")}`);
  assert.equal(cap[0].text, "Fig. 4");
  assert.equal(cap[0].for, ofType(beside, "figure")[0].id);
  const pair = doc([page([
    item("Fig. 1", 80, H - 40),
    item("Fig. 1 The springs and the axes.", 80, H - 248),
    item("Fig. 2 The mirrors.", 80, H - 518),
  ], { images: [[70, 90, 400, 230], [70, 280, 420, 500]] })]);
  const caps = ofType(pair, "caption");
  const figs = ofType(pair, "figure");
  assert.equal(figs.length, 2);
  const top = figs.find((f) => f.bbox[1] < 250);
  const bot = figs.find((f) => f.bbox[1] >= 250);
  const linked = new Map(caps.filter((c) => c.for).map((c) => [c.for, c.text]));
  assert.match(linked.get(top.id) || "", /springs/);
  assert.match(linked.get(bot.id) || "", /mirrors/);
});

test("sparse ink on one plate is one figure, and two captions stay apart", () => {
  const top = Array.from({ length: 8 }, (_, i) => ({ x0: 60 + (i % 4) * 70, y0: 80 + Math.floor(i / 4) * 50, x1: 100 + (i % 4) * 70, y1: 120 + Math.floor(i / 4) * 50 }));
  const bot = Array.from({ length: 8 }, (_, i) => ({ x0: 60 + (i % 4) * 70, y0: 430 + Math.floor(i / 4) * 50, x1: 100 + (i % 4) * 70, y1: 470 + Math.floor(i / 4) * 50 }));
  const cap = (text, x, y) => text.split(" ").map((t, i) => word(t, x + i * 36, y, x + i * 36 + 32, y + 12, 10));
  const one = findFigures({
    graphics: { images: [], shapes: [], boxes: [], rules: [], ink: [...top, ...bot] },
    words: cap("Fig. 3 Sketches of ice", 70, 560),
    bodySize: 10, pageW: W, pageH: H, plates: true,
  });
  assert.equal(one.figures.length, 1);
  assert.ok(one.figures[0].bbox[1] <= 80, "the plate reaches the upper sketches");
  assert.ok(one.figures[0].bbox[3] >= 470, "the plate reaches the lower sketches");
  assert.ok(one.figures[0].bbox[3] >= 560, "the plate reaches its caption");
  assert.ok(one.figures[0].bbox[3] < H - 8, "the plate stops at the caption");
  const two = findFigures({
    graphics: { images: [], shapes: [], boxes: [], rules: [], ink: [...top, ...bot] },
    words: [...cap("Fig. 5 upper chart", 70, 250), ...cap("Fig. 6 lower chart", 70, 560)],
    bodySize: 10, pageW: W, pageH: H, plates: true,
  });
  assert.equal(two.figures.length, 2, "two captioned charts stay two");
  const upper = two.figures.find((f) => f.bbox[1] < 200);
  const lower = two.figures.find((f) => f.bbox[1] >= 200);
  assert.ok(upper.bbox[3] < lower.bbox[1] + 4, "the plates do not swallow each other");
  assert.ok(upper.bbox[3] < 430, "Fig. 5 stops before the lower chart");
  const bare = findFigures({
    graphics: { images: [], shapes: [], boxes: [], rules: [], ink: [...top, ...bot] },
    words: [...cap("Fig.", 400, 40), ...cap("Fig. 3 Sketches of ice", 70, 560)],
    bodySize: 10, pageW: W, pageH: H, plates: true,
  });
  assert.equal(bare.figures.length, 1, "a header that lost its digit does not split the plate");
  const mention = findFigures({
    graphics: { images: [], shapes: [], boxes: [], rules: [], ink: [...top, ...bot] },
    words: cap("see Fig. 3 on the next page of this note", 70, 400),
    bodySize: 10, pageW: W, pageH: H, plates: true,
  });
  assert.equal(mention.figures.length, 0, "a body mention of a figure is not a plate");
  const header = findFigures({
    graphics: { images: [], shapes: [], boxes: [], rules: [], ink: [...top, ...bot] },
    words: cap("Note No. 315 Fig. 3", 70, 36),
    bodySize: 10, pageW: W, pageH: H, plates: true,
  });
  assert.equal(header.figures.length, 1, "a short header that ends in Fig. 3 is the plate caption");
});

test("a plate absorbs the tick table inside it and leaves a table of names", () => {
  const plate = { fromPlate: true, bbox: [40, 80, 500, 640] };
  const ticks = { type: "table", bbox: [80, 200, 460, 520], rows: 10, cols: 6, cells: Array.from({ length: 12 }, (_, i) => ({ text: i % 2 ? "0.2" : "—" })) };
  const names = {
    type: "table", bbox: [80, 120, 400, 400], rows: 8, cols: 4,
    cells: ["Disease", "Amebiasis", "Anthrax", "Cholera", "Mumps", "Smallpox", "Measles", "Typhoid", "1980", "2.38"].map((text) => ({ text })),
  };
  const tables = [ticks];
  absorbFigureTables(tables, [plate]);
  assert.equal(tables.length, 0, "ticks inside the plate are the drawing");
  const kept = [names];
  absorbFigureTables(kept, [plate]);
  assert.equal(kept.length, 1, "a name table that fills the plate stays");
  const ruled = {
    type: "table", bbox: [80, 160, 460, 560], rows: 14, cols: 5,
    cells: [
      ...Array.from({ length: 6 }, () => ({ text: "Diameter of outlet tube d" })),
      ...Array.from({ length: 10 }, (_, i) => ({ text: i % 2 ? "0.1654" : "8.059" })),
    ],
  };
  const ruledTables = [ruled];
  absorbFigureTables(ruledTables, [plate]);
  assert.equal(ruledTables.length, 1, "a ruled table of labels and numbers stays");
  const labels = {
    bbox: [80, 300, 500, 420], rows: 4, cols: 3,
    cells: Array.from({ length: 12 }, (_, i) => ({ r: Math.floor(i / 3), c: i % 3, text: i % 3 ? "Formation" : "on round wire" })),
  };
  assert.equal(figureLabels(labels, [{ fromPlate: true, bbox: [40, 80, 560, 640] }]), true);
  assert.equal(figureLabels(labels, [{ bbox: [40, 80, 560, 640] }]), false);
  const contents = {
    bbox: [70, 140, 420, 420], rows: 6, cols: 2,
    cells: [
      { r: 0, c: 0, text: "Page." },
      { r: 1, c: 0, text: "Introduction" }, { r: 1, c: 1, text: "5" },
      { r: 2, c: 0, text: "Composition of natural gas" },
      { r: 3, c: 0, text: "methane" }, { r: 3, c: 1, text: "6" },
      { r: 4, c: 0, text: "Experiments made." },
      { r: 5, c: 0, text: "Publications" }, { r: 5, c: 1, text: "11" },
    ],
  };
  assert.equal(figureLabels(contents, [{ bbox: [40, 100, 560, 640] }]), false, "a contents list under a plate box stays a table");
  assert.equal(sparseContentsTable({ ...contents, method: "stream" }), false, "two columns of contents stay a table");
  const wide = {
    method: "stream", bbox: [40, 300, 400, 420], rows: 5, cols: 6,
    cells: [
      { r: 0, c: 0, text: "Explanation of tables" }, { r: 0, c: 5, text: "23" },
      { r: 1, c: 1, text: "TABLES" },
      { r: 2, c: 0, text: "annealed copper" },
      { r: 3, c: 0, text: "Temperature" }, { r: 3, c: 3, text: "different" }, { r: 3, c: 5, text: "33" },
      { r: 4, c: 0, text: "copper" }, { r: 4, c: 4, text: "temperatures" }, { r: 4, c: 5, text: "34" },
    ],
  };
  assert.equal(sparseContentsTable(wide), true);
  const measured = {
    method: "stream", rows: 5, cols: 4,
    cells: Array.from({ length: 8 }, (_, i) => ({ text: i % 2 ? "1.25" : "Diameter" })),
  };
  assert.equal(sparseContentsTable(measured), false, "a decimal grid stays a table");
});

test("a disconnected ink speck does not pull the plate to the page origin", () => {
  const drawing = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      drawing.push({ x0: 80 + col * 70, y0: 220 + row * 60, x1: 140 + col * 70, y1: 270 + row * 60 });
    }
  }
  const speck = { x0: 0, y0: 0, x1: 1, y1: 27 };
  const words = ["Fig.", "1", "Drawing", "of", "the", "plate"].map((t, i) => word(t, 80 + i * 42, 430, 116 + i * 42, 442, 10));
  const found = findFigures({
    graphics: { images: [], shapes: [], boxes: [], rules: [], ink: [...drawing, speck] },
    words, bodySize: 10, pageW: W, pageH: H, plates: true,
  });
  assert.equal(found.figures.length, 1);
  assert.ok(found.figures[0].bbox[0] > 10, "the speck is not the left edge");
  assert.ok(found.figures[0].bbox[1] > 40, "the speck is not the top edge");
});

test("a stroke that crosses both caption baselines does not join the two drawings", () => {
  const top = Array.from({ length: 8 }, (_, i) => ({ x0: 60 + (i % 4) * 70, y0: 80 + Math.floor(i / 4) * 50, x1: 100 + (i % 4) * 70, y1: 120 + Math.floor(i / 4) * 50 }));
  const bot = Array.from({ length: 8 }, (_, i) => ({ x0: 60 + (i % 4) * 70, y0: 430 + Math.floor(i / 4) * 50, x1: 100 + (i % 4) * 70, y1: 470 + Math.floor(i / 4) * 50 }));
  const cap = (text, x, y) => text.split(" ").map((t, i) => word(t, x + i * 36, y, x + i * 36 + 32, y + 12, 10));
  const bridged = findFigures({
    graphics: { images: [], shapes: [], boxes: [], rules: [], ink: [...top, ...bot, { x0: 300, y0: 40, x1: 308, y1: 640 }] },
    words: [...cap("Fig. 5 upper chart", 70, 250), ...cap("Fig. 6 lower chart", 70, 560)],
    bodySize: 10, pageW: W, pageH: H, plates: true,
  });
  assert.equal(bridged.figures.length, 2);
  const upper = bridged.figures.find((f) => f.bbox[1] < 200);
  const lower = bridged.figures.find((f) => f.bbox[1] >= 200);
  assert.ok(upper && lower);
  assert.ok(upper.bbox[3] < 430, "Fig. 5 stops before the lower drawing");
  assert.ok(lower.bbox[1] > 250, "Fig. 6 starts under its own caption cut");
});

test("table rules are not a figure when the only figure word is a sentence", () => {
  const segs = [
    ...[400, 430, 460, 490, 520].map((y) => ({ axis: "h", a: 40, b: 360, pos: y })),
    ...[40, 200, 360].map((x) => ({ axis: "v", a: 400, b: 520, pos: x })),
  ];
  const words = "1918, is shown in Figure 1.".split(" ").map((t, i) => word(t, 40 + i * 42, 36, 78 + i * 42, 48, 10));
  const prose = findFigures({
    graphics: { images: [], shapes: [], boxes: [], rules: [], ink: [] },
    ruleSegments: segs, words, bodySize: 10, pageW: W, pageH: H, plates: true,
  });
  assert.equal(prose.figures.length, 1, "the grid still clusters; the sentence is not a caption");
  assert.ok(prose.figures[0].bbox[1] > 300, "the sentence does not pull the box up the page");
  const clustered = findFigures({
    graphics: { images: [], shapes: [], boxes: [], rules: [], ink: [] },
    ruleSegments: segs, words: [], bodySize: 10, pageW: W, pageH: H, plates: false,
  });
  assert.equal(clustered.figures.length, 1, "the same strokes still cluster when the page is not a plate");
  const line = (text, y) => text.split(" ").map((t, i) => word(t, 40 + i * 36, y, 72 + i * 36, y + 12, 10));
  const noPlate = (words) => findFigures({
    graphics: { images: [], shapes: [], boxes: [], rules: [], ink: [] },
    ruleSegments: segs, words, bodySize: 10, pageW: W, pageH: H, plates: true,
  });
  assert.equal(noPlate(line("plate 14 inches square and 38 inch thick", 400)).figures.length, 0, "a steel plate's size is not Plate 14");
  const sentence = noPlate(line("Figure 1 is a side elevation of the mandrel", 200));
  assert.ok(sentence.figures.every((f) => f.bbox[1] > 300), "a sentence is not the caption under a drawing");
  assert.ok(noPlate(line("Figure 2 herewith.", 300)).figures.every((f) => f.bbox[1] > 300));
  assert.ok(noPlate(line("Fig. 7 shows a record taken in the air", 280)).figures.every((f) => f.bbox[1] > 300));
  const body = [];
  for (let row = 0; row < 12; row++) body.push(...line("the yield of the south plat was higher than the north plat", 40 + row * 16));
  assert.equal(noPlate([...body, ...line("1918, is shown in Figure 1.", 36)]).figures.length, 0, "a text page does not keep an uncaptioned rule grid");
  const kept = findFigures({
    graphics: { images: [], shapes: [], boxes: [], rules: [], ink: [] },
    ruleSegments: segs, words: line("Fig. 7 Record of the flight", 540),
    bodySize: 10, pageW: W, pageH: H, plates: true,
  });
  assert.equal(kept.figures.length, 1, "a caption under the strokes still makes the plate");
});

function ocrItem(str, x, y, size = 10, width = str.length * size * 0.5) {
  return { str, transform: [size, 0, 0, size, x, y], width, height: size, y0: y - size * 0.8, y1: y + size * 0.2, fontName: "ocr", conf: 1 };
}

function plateInk(y0, y1) {
  const ink = [];
  for (let i = 0; i < 8; i++) {
    const x = 70 + (i % 4) * 80;
    const y = y0 + Math.floor(i / 4) * ((y1 - y0) / 2);
    ink.push({ x0: x, y0: y, x1: x + 60, y1: y + Math.min(50, (y1 - y0) / 2 - 4) });
  }
  return ink;
}

function scanDoc(items, ink = []) {
  const body = [];
  const sentence = "The instrument records the motion of the springs during the run today".split(" ");
  for (let i = 0; i < 6; i++) sentence.forEach((t, k) => body.push(ocrItem(t, 72 + k * 36, 80 + i * 16)));
  const page = parsePageGeometry({
    n: 1, w: W, h: H, rotation: 0, transform: [1, 0, 0, 1, 0, 0], scan: true, dpi: 300, deskew: 0,
    fonts: { ocr: { name: "ocr" } }, items: [...body, ...items], rules: [], ink, ops: { fnArray: [], argsArray: [] },
  }, 1);
  return assembleDocument([page], { numPages: 1 });
}

function captionText(d) {
  return d.order.map((id) => d.blocks[id]).filter((b) => b.type === "caption").map((b) => b.text);
}

test("a dropped figure digit on the next header stays on the caption", () => {
  const rest = "Showing the means for transferring the motion".split(" ");
  const d = scanDoc([
    ocrItem("Fig.", 116, 620, 16, 25),
    ocrItem("2.", 153, 612, 10, 16),
    ...rest.map((t, i) => ocrItem(t, 176 + i * 42, 612, 10, 38)),
  ], plateInk(430, 650));
  const caps = captionText(d);
  assert.ok(caps.some((t) => /^Fig\. 2\. Showing the means/.test(t)), caps.join(" | "));
});

test("a label-only caption does not swallow the next paragraph", () => {
  const d = scanDoc([
    ocrItem("Fig.", 95, 541, 10, 22),
    ocrItem("1", 120, 541, 10, 8),
    ocrItem("now", 105, 556, 10, 24),
    ocrItem("dropping", 132, 556, 10, 56),
    ocrItem("the", 192, 556, 10, 22),
    ocrItem("wire", 218, 556, 10, 28),
    ocrItem("gages", 250, 556, 10, 36),
    ocrItem("altogether", 290, 556, 10, 64),
  ], plateInk(160, 520));
  const caps = captionText(d);
  assert.ok(caps.some((t) => t === "Fig. 1"), caps.join(" | "));
  assert.ok(caps.every((t) => !/dropping/.test(t)), caps.join(" | "));
});

test("a split ordinate note returns to the caption and the next line stays out", () => {
  const d = scanDoc([
    ocrItem("F1g.5", 84, 281, 10, 36),
    ocrItem("Navy", 124, 281, 10, 36),
    ocrItem("section", 249, 281, 10, 48),
    ocrItem("curve.", 302, 281, 10, 42),
    ocrItem("Ordinates", 348, 281, 10, 64),
    ocrItem("in", 416, 281, 10, 12),
    ocrItem("terms", 432, 281, 10, 36),
    ocrItem("of", 472, 281, 10, 14),
    ocrItem("maximum", 140, 296, 10, 56),
    ocrItem("orainate.", 200, 296, 10, 58),
  ], plateInk(100, 260));
  const caps = captionText(d);
  assert.ok(caps.some((t) => /Ordinates in terms of/.test(t)), caps.join(" | "));
  assert.ok(caps.every((t) => !/orainate/.test(t)), caps.join(" | "));
});

test("Abb., Tafel and Plate captions link, and a steel plate size does not", () => {
  assert.equal(figCaptionKey("Abb. 2 Schnitt durch die Achse"), "2");
  assert.equal(figCaptionKey("Tafel III"), "III");
  assert.equal(figCaptionKey("Plate I. Bureau of Mines"), "1");
  assert.equal(figCaptionKey("plate 14 inches square and 38 inch thick"), null);
  const abb = scanDoc([
    ocrItem("Abb.", 90, 452, 12, 28),
    ocrItem("2.", 122, 452, 12, 16),
    ocrItem("Schnitt", 146, 452, 12, 52),
  ], plateInk(180, 580));
  const caps = captionText(abb);
  assert.ok(caps.some((t) => /Abb\. 2/.test(t) && /Schnitt/.test(t)), caps.join(" | "));
  assert.equal(ofType(abb, "caption")[0].for, ofType(abb, "figure")[0].id);
});

test("a short all-caps title above a page-sized drawing is the plate caption", () => {
  const ink = [];
  for (let y = 140; y < 640; y += 36) {
    for (let x = 70; x < 500; x += 36) ink.push({ x0: x, y0: y, x1: x + 28, y1: y + 24 });
  }
  const words = "W. A. McCOOL. METAL DRAWING MACHINE.".split(" ").map((t, i) => word(t, 80 + i * 52, 90, 128 + i * 52, 102, 10));
  const got = findFigures({
    graphics: { images: [], shapes: [], boxes: [], rules: [], ink },
    words, bodySize: 10, pageW: W, pageH: H, plates: true,
  });
  assert.ok(got.figures.some((f) => f.fromPlate), "the title above a full plate is a caption");
});

test("an all-caps heading above the ink is not a plate title", () => {
  const head = "THE COMPRESSIBILITY OF NATURAL GAS AT HIGH".split(" ");
  const d = scanDoc(head.map((t, i) => ocrItem(t, 70 + i * 36, 120, 11, 32)), plateInk(200, 520));
  assert.equal(ofType(d, "figure").length, 0);
  assert.equal(captionText(d).length, 0);
});

test("a running head with the page number at one end is not a plate title", () => {
  const ink = plateInk(140, 640);
  const run = (text) => findFigures({
    graphics: { images: [], shapes: [], boxes: [], rules: [], ink },
    words: text.split(" ").map((t, i) => word(t, 72 + i * 40, 96, 108 + i * 40, 108, 10)),
    bodySize: 10, pageW: W, pageH: H, plates: true,
  });
  assert.ok(run("420 CALIFORNIA BLUE BOOK, OR STATE ROSTER.").figures.every((f) => !f.fromPlate));
  assert.ok(run("MEMBERS OF STATE BOARDS AND COMMISSIONS. 421").figures.every((f) => !f.fromPlate));
  assert.ok(run("HEALTH, STATE BOARD OF. 1870-1924 Continued.").figures.every((f) => !f.fromPlate));
  assert.ok(run("HISTORICAL SURVEY COMMISSION, CALIFORNIA. 1915-1924.").figures.every((f) => !f.fromPlate));
});

test("an all-caps plate title under the drawing becomes the caption", () => {
  const title = "RENEWAL OF THE GIRDERS OF THE EAST ROW".split(" ");
  const d = scanDoc(title.map((t, i) => ocrItem(t, 70 + i * 46, 455, 11, 42)), plateInk(160, 600));
  const caps = captionText(d);
  assert.ok(caps.some((t) => /RENEWAL OF THE GIRDERS/.test(t)), caps.join(" | "));
  const fig = ofType(d, "figure")[0];
  const cap = ofType(d, "caption").find((c) => /RENEWAL/.test(c.text));
  assert.equal(cap.for, fig.id);
});

test("the next sentence under a caption stays a paragraph", () => {
  const d = scanDoc([
    ocrItem("Fig.", 90, 432, 11, 24),
    ocrItem("5", 118, 432, 11, 10),
    ocrItem("Ice", 136, 432, 11, 24),
    ocrItem("formation", 164, 432, 11, 60),
    ocrItem("on", 228, 432, 11, 16),
    ocrItem("wing", 248, 432, 11, 32),
    ocrItem("The", 90, 454, 11, 24),
    ocrItem("deposit", 118, 454, 11, 48),
    ocrItem("was", 170, 454, 11, 24),
    ocrItem("accumulated", 198, 454, 11, 72),
    ocrItem("during", 274, 454, 11, 40),
    ocrItem("a", 318, 454, 11, 10),
    ocrItem("flight", 332, 454, 11, 36),
    ocrItem("through", 372, 454, 11, 48),
  ], plateInk(160, 560));
  const caps = captionText(d);
  assert.ok(caps.some((t) => /Fig\. 5 Ice formation on wing/.test(t)), caps.join(" | "));
  assert.ok(caps.every((t) => !/deposit/.test(t)), caps.join(" | "));
});

test("a finished caption does not take the next paragraph", () => {
  const pack = (words, y) => {
    let x = 72;
    return words.map((t) => {
      const w = Math.max(12, t.length * 5);
      const item = ocrItem(t, x, y, 10, w);
      x += w + 4;
      return item;
    });
  };
  const d = scanDoc([
    ...pack("FIGURE 1.—Apparatus for determining compressibility of natural gas.".split(" "), 430),
    ...pack("manometer. The tube contained the natural gas and the rest".split(" "), 448),
  ], plateInk(160, 400));
  const caps = captionText(d);
  assert.ok(caps.some((t) => /Figure 1/.test(t) && /natural gas\./.test(t)), caps.join(" | "));
  assert.ok(caps.every((t) => !/manometer/.test(t)), caps.join(" | "));
});

test("a contents line with leaders is not a plate, and a corner stamp is not a figure", () => {
  const words = "FIGURE 1. Apparatus ............ 7".split(" ").map((t, i) => word(t, 70 + i * 48, 560, 110 + i * 48, 572, 10));
  const led = findFigures({
    graphics: { images: [], shapes: [], boxes: [], rules: [], ink: plateInk(200, 480) },
    words, bodySize: 10, pageW: W, pageH: H, plates: true,
  });
  assert.ok(led.figures.every((f) => !f.fromPlate), "leaders do not caption a plate");
  const stamp = { x0: 20, y0: 700, x1: 90, y1: 770 };
  assert.equal(falseFigureReason(stamp, { pageW: W, pageH: H }), "stamp");
  const ruled = { x0: 40, y0: 200, x1: 280, y1: 360 };
  assert.equal(falseFigureReason(ruled, { pageW: W, pageH: H, tables: [{ bbox: [30, 180, 300, 400] }] }), "table-border");
  const plate = { x0: 40, y0: 80, x1: 420, y1: 520, fromPlate: true };
  assert.equal(falseFigureReason(plate, { pageW: W, pageH: H }), null);
});

test("a numbered Fig. line beats an all-caps part label, and a plate title beats a reversed fragment", () => {
  const face = "FACE ALL READY FOR PUSHING".split(" ");
  const labelled = scanDoc([
    ...face.map((t, i) => ocrItem(t, 80 + i * 70, 440, 11, 60)),
    ocrItem("Figs.", 80, 500, 11, 36),
    ocrItem("20.", 120, 500, 11, 24),
  ], plateInk(220, 470));
  const linked = ofType(labelled, "caption").find((c) => c.for);
  assert.ok(linked, captionText(labelled).join(" | "));
  assert.match(linked.text, /Figs\. 20/);
  const title = "W. A. McCOOL. METAL DRAWING MACHINE.".split(" ");
  const ink = [];
  for (let y = 230; y < 680; y += 40) {
    for (let x = 60; x < 520; x += 50) ink.push({ x0: x, y0: y, x1: x + 36, y1: y + 28 });
  }
  const plate = scanDoc([
    ...title.map((t, i) => ocrItem(t, 70 + i * 48, 214, 11, 44)),
    ocrItem("1.", 200, 400, 10, 16),
    ocrItem("Fig.", 220, 400, 10, 28),
  ], ink);
  const titled = ofType(plate, "caption").find((c) => c.for);
  assert.ok(titled, captionText(plate).join(" | "));
  assert.match(titled.text, /METAL DRAWING MACHINE/);
});

test("a paragraph under a running head is clipped off the top of a plate", () => {
  const prose = (y, text) => ({ text, x0: 40, x1: 500, y0: y, y1: y + 12 });
  const lines = [
    prose(100, "It has been shown by earlier work that the field is wide"),
    prose(116, "The network stands over the south plat and the control plat"),
    prose(132, "Winter wheat was sown on both plats during the same week"),
  ];
  const fig = { x0: 0, y0: 0, x1: 320, y1: 420, fromPlate: true };
  const kept = rejectFalseFigures([fig], { lines, pageW: 360, pageH: 620 });
  assert.equal(kept.length, 1);
  assert.ok(kept[0].y0 > 140, `clipped under the paragraph, y0=${kept[0].y0}`);
  const mid = [
    prose(400, "It has been shown by earlier work that the field is wide"),
    prose(416, "The network stands over the south plat and the control plat"),
    prose(432, "Winter wheat was sown on both plats during the same week"),
  ];
  const deep = { x0: 40, y0: 40, x1: 400, y1: 740, fromPlate: true };
  const left = rejectFalseFigures([deep], { lines: mid, pageW: W, pageH: H });
  assert.equal(left[0].y0, 40, "prose in the lower half stays inside the drawing");
});

test("a thin edge band split off a drawing sheet is dropped", () => {
  const top = { words: [word("Fig.", 40, 24, 70, 36, 10), word("3", 74, 24, 86, 36, 10)], text: "Fig. 3", x0: 40, x1: 86, y0: 24, y1: 36, base: 36, size: 10 };
  const low = { words: [word("Fig.", 80, 640, 110, 652, 10), word("3", 114, 640, 128, 652, 10), word("Sketch", 140, 640, 190, 652, 10)], text: "Fig. 3 Sketch", x0: 80, x1: 190, y0: 640, y1: 652, base: 652, size: 10 };
  const regions = sheetRegions([top, low], W, H);
  const figures = regions.map((r) => ({ bbox: [r.x0, r.y0, r.x1, r.y1], kind: "image" }));
  assert.ok(figures.length >= 2, "two anchors split the sheet");
  const kept = rejectFalseFigures(figures, { pageW: W, pageH: H });
  assert.equal(kept.length, 1);
  assert.ok(kept[0].bbox[1] > 40, "the edge band is the one that goes");
});

test("a caption and the paragraphs across a chart are not a side column, and the ink stays a figure", () => {
  const prose = (y, text) => ({ text, x0: 70, x1: 390, y0: y, y1: y + 12 });
  const lines = [
    prose(40, "as the viscosity at the moment when the spindle was withdrawn was not"),
    prose(520, "Figure 7 Relations of temperature to fluidity and viscosity shown in experiments"),
    prose(548, "The separation of metallic iron owing to the strongly reducing atmosphere of the"),
  ];
  const fig = { x0: 64, y0: 0, x1: 431, y1: 585, fromPlate: true };
  const ink = [{ x0: 106, y0: 94, x1: 350, y1: 512, kind: "ink" }];
  const kept = rejectFalseFigures([fig], { lines, pageW: 431, pageH: 657, strokes: ink });
  assert.equal(kept.length, 1);
  assert.ok(kept[0].x0 < 120, `the chart stays, x0=${kept[0].x0}`);
  assert.ok(kept[0].x1 > 340, `the chart's right side stays, x1=${kept[0].x1}`);
  assert.equal(falseFigureReason(fig, { lines, pageW: 431, pageH: 657, strokes: ink }), null);
});

test("axes, a curve, and hatching are figures on a table, in a corner, and on an edge", () => {
  const chart = { x0: 40, y0: 200, x1: 280, y1: 360 };
  const axes = [
    { x0: 50, y0: 340, x1: 260, y1: 340, kind: "rule" },
    { x0: 50, y0: 210, x1: 50, y1: 340, kind: "rule" },
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ x0: 50, y0: 220 + i * 16, x1: 62, y1: 220 + i * 16, kind: "rule" })),
  ];
  assert.equal(falseFigureReason(chart, { pageW: W, pageH: H, tables: [{ bbox: [30, 180, 300, 400] }] }), "table-border");
  assert.equal(falseFigureReason(chart, { pageW: W, pageH: H, tables: [{ bbox: [30, 180, 300, 400] }], strokes: axes }), null);
  const stampBox = { x0: 20, y0: 700, x1: 90, y1: 770 };
  assert.equal(falseFigureReason(stampBox, { pageW: W, pageH: H, strokes: [{ x0: 22, y0: 704, x1: 86, y1: 764, kind: "ink" }] }), "stamp");
  assert.equal(falseFigureReason(stampBox, { pageW: W, pageH: H, strokes: [{ x0: 22, y0: 704, x1: 86, y1: 764, kind: "shape", segs: 24 }] }), null);
  const band = { x0: 0, y0: 0, x1: 600, y1: 28 };
  const hatch = [];
  for (let x = 20; x < 580; x += 16) hatch.push({ x0: x, y0: 4, x1: x, y1: 24, kind: "rule" });
  assert.equal(falseFigureReason(band, { pageW: W, pageH: H }), "edge-stripe");
  assert.equal(falseFigureReason(band, { pageW: W, pageH: H, strokes: hatch }), null);
});

test("a paragraph above a plate still clips when the ink sits below it", () => {
  const prose = (y, text) => ({ text, x0: 40, x1: 300, y0: y, y1: y + 12 });
  const lines = [
    prose(100, "It has been shown by earlier work that the field is wide"),
    prose(116, "The network stands over the south plat and the control plat"),
    prose(132, "Winter wheat was sown on both plats during the same week"),
  ];
  const fig = { x0: 0, y0: 0, x1: 320, y1: 420, fromPlate: true };
  const ink = [{ x0: 30, y0: 160, x1: 300, y1: 400, kind: "ink" }];
  const kept = rejectFalseFigures([fig], { lines, pageW: 360, pageH: 620, strokes: ink });
  assert.equal(kept.length, 1);
  assert.ok(kept[0].y0 > 140, `clipped under the paragraph, y0=${kept[0].y0}`);
  assert.ok(kept[0].y1 >= 400);
});

test("a text page with a small sketch is not carved into a false figure", () => {
  const lines = [];
  for (let i = 0; i < 10; i++) {
    lines.push({
      text: "The wire gage is described in the paragraph beside the picture of it",
      x0: 140, x1: 400, y0: 140 + i * 36, y1: 152 + i * 36,
    });
  }
  const fig = { x0: 40, y0: 120, x1: 420, y1: 520 };
  const ink = [];
  for (let y = 180; y < 460; y += 28) ink.push({ x0: 60, y0: y, x1: 110, y1: y + 20, kind: "ink" });
  const kept = rejectFalseFigures([fig], { lines, pageW: 432, pageH: 665, strokes: ink });
  assert.equal(kept.length, 0);
});

test("a text column beside a drawing is clipped and the ink stays", () => {
  const lines = [180, 200, 220, 240].map((y) => ({
    text: "The notes in this column describe the plate and its parts",
    x0: 340, x1: 520, y0: y, y1: y + 12,
  }));
  const fig = { x0: 40, y0: 80, x1: 540, y1: 500, fromPlate: true };
  const ink = [{ x0: 60, y0: 100, x1: 300, y1: 460, kind: "ink" }];
  const kept = rejectFalseFigures([fig], { lines, pageW: W, pageH: H, strokes: ink });
  assert.equal(kept.length, 1);
  assert.ok(kept[0].x1 < 360, `column clipped, x1=${kept[0].x1}`);
  assert.ok(kept[0].x0 <= 60 && kept[0].x1 >= 300, `ink stays inside ${kept[0].x0}..${kept[0].x1}`);
});

test("axis ticks in front of FIG stay out of the caption, and a lowercase tail on the same baseline joins", () => {
  const ticks = "-4 -3 FIG. 2.—Diagram for determining cooling error".split(" ");
  const d = scanDoc(ticks.map((t, i) => ocrItem(t, 80 + i * 42, 448, 10, 36)), plateInk(160, 560));
  const caps = captionText(d);
  assert.ok(caps.some((t) => /^FIG\. 2/.test(t) && /cooling error/.test(t) && !/^-4/.test(t)), caps.join(" | "));
  const side = scanDoc([
    ocrItem("Fig.", 90, 448, 11, 28),
    ocrItem("of", 280, 448, 11, 16),
    ocrItem("propeller", 300, 448, 11, 64),
    ocrItem("section", 368, 448, 11, 52),
  ], plateInk(160, 560));
  const sideCaps = captionText(side);
  assert.ok(sideCaps.some((t) => /Fig\. of propeller section/.test(t)), sideCaps.join(" | "));
});

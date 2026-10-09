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

// Regression: an article-info sidebar (short lines) beside a shaded abstract (justified lines at a
// different pitch) read as two columns, not interleaved line by line. Synthetic page data only.
import test from "node:test";
import assert from "node:assert/strict";

import { assembleDocument, parsePageGeometry } from "../src/model/parse/index.js";
import { detectColumns, orderUnits, ruleCuts } from "../src/model/parse/xycut.js";
import { groupParagraphs } from "../src/model/parse/blocks.js";
import { makeLine } from "../src/model/parse/lines.js";
import { OP } from "../src/model/parse/rules.js";

const H = 792;
const W = 595;
const FONTS = { f1: { name: "Times", fontFamily: "serif" }, fb: { name: "Times-Bold", fontFamily: "serif" } };
const item = (str, x, top, size, width = str.length * size * 0.5, font = "f1") => ({ str, transform: [size, 0, 0, size, x, H - top], width, height: size, fontName: font, hasEOL: false });

function ops(rules, boxes) {
  const fnArray = [];
  const argsArray = [];
  for (const [x0, y, x1] of rules) {
    fnArray.push(OP.setFillGray, OP.rectangle, OP.fill);
    argsArray.push([0], [x0, H - y - 0.5, x1 - x0, 0.5], null);
  }
  for (const [x0, y0, x1, y1, gray] of boxes) {
    fnArray.push(OP.setFillGray, OP.rectangle, OP.fill);
    argsArray.push([gray], [x0, H - y1, x1 - x0, y1 - y0], null);
  }
  return { fnArray, argsArray };
}

const SIDEBAR = ["Editor: Jacopo Bacenetti", "", "Keywords:", "Risk assessment", "Coefficient of variation method", "Entropy weight method", "Physical-chemical indexes", "Pollutant indexes", "Food safety"];
const ABSTRACT = [
  "Food safety is important for sustainable social and economic development and the",
  "health of people. The traditional food safety risk assessment model is one-sided to the",
  "weight distribution of physical-chemical indexes and pollutant indexes, which cannot",
  "comprehensively assess food safety risks. Therefore, a novel food safety risk assess-",
  "ment model combining the coefficient of variation integrating the entropy weight is",
  "proposed in this paper. The two methods are used to calculate the objective weight",
  "of each index with physical-chemical and pollutant indexes effecting food safety,",
  "respectively. Then the weights determined by both methods are coupled by the Lagrange",
  "multiplier method, and the ratio of the square root of the product of two weights and",
  "the weighted sum of the square root of the product is regarded as the combined weight.",
  "Thus the risk assessment model is constructed to comprehensively assess food safety risk.",
];

function sciencePage() {
  const items = [];
  items.push(item("Novel risk assessment model of food quality and safety considering", 38, 178, 13.5, 388));
  items.push(item("physical-chemical and pollutant indexes based on coefficient of", 38, 195, 13.5, 419));
  items.push(item("integrating entropy weight", 38, 212, 13.5, 155));
  items.push(item("Yongming Han, Jiaxin Liu, Jiatong Li, Zhiying Jiang, Bo Ma, Chong Chu, Zhiqiang Geng", 38, 235, 10.5, 479));
  items.push(item("a College of Information Science and Technology, Beijing University of Chemical Technology", 38, 250, 6.5, 267));
  items.push(item("ARTICLE INFO", 38, 507, 7, 81, "fb"));
  items.push(item("ABSTRACT", 202, 507, 7, 56, "fb"));
  SIDEBAR.forEach((t, i) => { if (t) items.push(item(t, 38, 526 + i * 8.6, 6.5)); });
  ABSTRACT.forEach((t, i) => items.push(item(t, 202, 527 + i * 9.57, 7, i === ABSTRACT.length - 1 ? 300 : 356)));
  items.push(item("*", 42, 672.5, 6.5, 4));
  items.push(item("Corresponding authors.", 50, 675.6, 6.5, 63));
  items.push(item("**", 39, 681.1, 6.5, 6.3));
  items.push(item("Correspondence to: Z. Geng, College of Information Science and Technology, Beijing, China.", 50, 684.1, 6.5, 363));
  items.push(item("E-mail addresses: jiangzy@mail.buct.edu.cn (Z. Jiang), mabo@mail.buct.edu.cn (B. Ma).", 50, 692.7, 6.5, 353));
  items.push(item("Received 8 November 2022; Received in revised form 18 February 2023; Accepted 5 March 2023", 38, 723, 7, 298));
  // A front-matter line far below the abstract that runs to within 1.5 pt of its left edge.
  items.push(item("0048-9697/© 2023 Elsevier B.V. All rights reserved.", 38, 742, 7, 162.5));
  const rules = [[38, 485, 172], [202, 485, 558], [38, 518, 171], [202, 518, 558], [38, 667, 558]];
  const boxes = [[200, 500, 560, 640, 0.93]];
  return parsePageGeometry({ items, ops: ops(rules, boxes), w: W, h: H, fonts: FONTS }, 1);
}

test("an article-info sidebar beside a justified abstract reads as two columns", () => {
  const d = assembleDocument([sciencePage()], { numPages: 1 });
  const blocks = d.order.map((id) => d.blocks[id]).filter((b) => b.text);
  const texts = blocks.map((b) => b.text);
  const abstract = blocks.filter((b) => b.text.includes("Lagrange") || b.text.startsWith("Food safety is important"));
  assert.equal(abstract.length, 1, `abstract is one block: ${JSON.stringify(texts)}`);
  assert.ok(abstract[0].text.startsWith("Food safety is important") && abstract[0].text.endsWith("food safety risk."));
  const keywords = blocks.find((b) => b.text.startsWith("Keywords:"));
  assert.ok(keywords, "keywords block");
  assert.match(keywords.text, /Risk assessment Coefficient of variation method Entropy weight method Physical-chemical indexes Pollutant indexes Food safety$/);
  // No line of the abstract is split off between sidebar lines.
  assert.ok(!texts.some((t) => /^(ment model|weight distribution|respectively\.)/.test(t)));
  const at = (re) => texts.findIndex((t) => re.test(t));
  const order = [/^ARTICLE INFO$/, /^Editor:/, /^Keywords:/, /^ABSTRACT$/, /^Food safety is important/, /Corresponding authors\.$/, /^\*\* Correspondence to:/, /^Received/];
  const idx = order.map(at);
  assert.ok(idx.every((i) => i >= 0), `all found: ${idx} in ${JSON.stringify(texts)}`);
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i - 1] < idx[i], `${order[i - 1]} before ${order[i]}: ${JSON.stringify(texts)}`);
  assert.match(texts[at(/^\*\* Correspondence to:/)], /E-mail addresses:/);
  assert.equal(d.pages[0].columns, 2);
});

test("detectColumns: a left line far above or below the right column does not close the gutter", () => {
  const line = (x0, x1, base, size = 7) => makeLine([{ text: "x".repeat(Math.max(8, Math.round((x1 - x0) / 3.5))), x0, x1, base, size, mathChars: 0, mathFontChars: 0 }]);
  const right = Array.from({ length: 6 }, (_, i) => line(202, 558, 527 + i * 9.6));
  const left = Array.from({ length: 6 }, (_, i) => line(38, 120, 526 + i * 8.6, 6.5));
  const wide = [line(38, 426, 178, 13.5), line(38, 457, 195, 13.5), line(38, 517, 235, 10.5)];
  const far = line(38, 200.5, 742);
  const gutters = detectColumns([...wide, ...left, ...right, far], { pageW: 595 });
  assert.equal(gutters.length, 1);
  assert.ok(gutters[0].x0 <= 121 && gutters[0].x1 >= 201);
});

test("ruleCuts: one rule per column at one height cuts; a figure's own frame does not", () => {
  const g = [{ x0: 123, x1: 200 }];
  const units = [{ x0: 38, y0: 300, x1: 172, y1: 420 }, { x0: 202, y0: 317, x1: 558, y1: 484 }, { x0: 38, y0: 500, x1: 120, y1: 600 }, { x0: 202, y0: 500, x1: 558, y1: 660 }];
  const h = (x0, y, x1) => ({ axis: "h", x0, x1, y0: y, y1: y });
  assert.deepEqual(ruleCuts([h(38, 485, 172), h(202, 485, 558), h(38, 667, 558), h(38, 535, 171)], g, units), [485, 667]);
  assert.deepEqual(ruleCuts([h(40, 320, 170), h(210, 330, 550)], g, units), []);
  assert.deepEqual(ruleCuts([h(40, 330, 170), h(210, 330, 550)], g, units), []);
});

test("orderUnits reads bands between rule cuts, and keeps a column-heading row with its text", () => {
  const u = (id, x0, y0, x1, y1) => ({ id, x0, y0, x1, y1 });
  const units = [u("HL", 38, 300, 172, 410), u("GA", 202, 300, 558, 480), u("INFO", 38, 502, 119, 509), u("ABS", 202, 502, 258, 509), u("KW", 38, 520, 120, 600), u("TEXT", 202, 520, 558, 660)];
  const gutters = [{ x0: 123, x1: 200 }];
  const { order } = orderUnits(units, { gutters, cuts: [485, 518], lineHeight: 7 });
  assert.deepEqual(order.map((x) => x.id), ["HL", "GA", "INFO", "KW", "ABS", "TEXT"]);
  assert.deepEqual(orderUnits(units, { gutters }).order.map((x) => x.id), ["HL", "INFO", "KW", "GA", "ABS", "TEXT"]);
});

test("groupParagraphs: a hanging footnote mark does not split the note from its next line", () => {
  const w = (text, x0, x1, base, sup = false) => ({ text, x0, x1, base, size: 6.5, sup, mathChars: 0, mathFontChars: 0 });
  const first = makeLine([w("**", 39, 45.6, 681, true), w("Correspondence to: Z. Geng, Beijing, China.", 49.5, 413, 684)]);
  const next = makeLine([w("E-mail addresses: jiangzy@mail.buct.edu.cn (Z. Jiang).", 49.5, 403, 692.7)]);
  assert.equal(groupParagraphs([first, next], { bodySize: 9 }).length, 1);
});

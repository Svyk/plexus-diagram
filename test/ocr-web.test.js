import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { boxesFromProb, dominantAngle } from "../src/model/ocr/db-boxes.js";
import { rotateRgb } from "../src/model/ocr/image.js";
import { MODEL_FILES, SCHEMA } from "../src/model/ocr/manifest.js";
import { fillsFromCanvas, inkGlyph, rulesFromCanvas } from "../src/model/ocr/rules-from-canvas.js";
import { ctcText, snapOcrItems, wordsFromCtc } from "../src/model/ocr/words-from-ctc.js";
import { createOcrWeb } from "../src/host/ocr-web.js";

function logitsFor(classesByFrame, classes) {
  const time = classesByFrame.length;
  const logits = new Float32Array(time * classes);
  classesByFrame.forEach((cls, t) => { logits[t * classes + cls] = 8; });
  return { logits, time, classes };
}

test("ctc words split on a real space and on a comma the dict cannot emit", () => {
  const spaced = logitsFor([1, 3, 2], 4);
  const items = wordsFromCtc({ ...spaced, dict: ["A", "B", " "], box: { x0: 0, y0: 0, x1: 30, y1: 10 } });
  assert.deepEqual(items.map((item) => item.str), ["A", "B"]);
  assert.ok(items[0].transform[4] < items[1].transform[4]);
  assert.equal(items[0].fontName, "ocr");
  assert.equal(items[0].transform.length, 6);

  const phrase = "Botulism,total";
  const dict = [...new Set(phrase)];
  const frames = [...phrase].map((ch) => dict.indexOf(ch) + 1);
  const joined = wordsFromCtc({ ...logitsFor(frames, dict.length + 1), dict, box: { x0: 10, y0: 0, x1: 80, y1: 8 } });
  assert.deepEqual(joined.map((item) => item.str), ["Botulism,", "total"]);

  const cell = ctcText({ ...logitsFor(frames, dict.length + 1), dict });
  assert.equal(cell.text, "Botulism, total");
  const number = ctcText({ ...logitsFor([1, 2, 3, 4, 3], 5), dict: ["1", ",", "2", "3"] });
  assert.equal(number.text, "1,232");
});

test("a probability row keeps its peak and the extra class is a space", () => {
  const classes = 5;
  const logits = new Float32Array(classes);
  logits[1] = 0.97;
  logits[0] = 0.01;
  logits[2] = 0.01;
  logits[3] = 0.005;
  logits[4] = 0.005;
  const one = wordsFromCtc({ logits, time: 1, classes, dict: ["A", "B", "C", "D"], box: { x0: 0, y0: 0, x1: 10, y1: 8 } });
  assert.equal(one[0].str, "A");
  assert.equal(one[0].conf, 1);

  const time = 3;
  const spaced = new Float32Array(time * 4);
  spaced[1] = 0.9;
  spaced[4 + 3] = 0.9;
  spaced[8 + 2] = 0.9;
  const items = wordsFromCtc({ logits: spaced, time, classes: 4, dict: ["A", "B"], box: { x0: 0, y0: 0, x1: 30, y1: 8 } });
  assert.deepEqual(items.map((item) => item.str), ["A", "B"]);
});

test("snap drops a low-confidence rule echo and does not keep mean", () => {
  const echo = { str: "Yana", transform: [10, 0, 0, 10, 30, 20], width: 8, height: 10, y0: 12, y1: 22, fontName: "ocr", conf: 0.5, mean: 0.4 };
  const keep = { str: "0.12", transform: [10, 0, 0, 10, 10, 20], width: 12, height: 10, y0: 12, y1: 22, fontName: "ocr", conf: 1, mean: 0.95 };
  const kept = snapOcrItems([echo, keep]);
  assert.deepEqual(kept.map((item) => item.str), ["0.12"]);
  assert.equal(kept[0].mean, undefined);
});

test("snap drops a speck and shares one body size", () => {
  const body = { str: "A1", transform: [10, 0, 0, 10, 0, 20], width: 12, height: 10, y0: 12, y1: 22.2, fontName: "ocr", conf: 1 };
  const speck = { str: "x", transform: [2, 0, 0, 2, 20, 20], width: 2, height: 2, y0: 18, y1: 20.4, fontName: "ocr", conf: 0.3 };
  const kept = snapOcrItems([body, speck]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].str, "A1");
});

test("snap shrinks a body taller than the row pitch", () => {
  const items = [];
  for (let row = 0; row < 8; row++) {
    items.push({ str: "0.00", transform: [10, 0, 0, 10, 40, 30 + row * 5.7], width: 14, height: 10, y0: 0, y1: 0, fontName: "ocr", conf: 1 });
    items.push({ str: "Label", transform: [10, 0, 0, 10, 4, 30 + row * 5.7], width: 20, height: 10, y0: 0, y1: 0, fontName: "ocr", conf: 1 });
  }
  const kept = snapOcrItems(items);
  assert.equal(kept.length, 16);
  assert.ok(kept[0].transform[0] < 8, `body ${kept[0].transform[0]}`);
  assert.ok(kept[0].transform[0] > 5);
});

test("rulesFromCanvas finds one horizontal rule", () => {
  const width = 120;
  const height = 40;
  const gray = new Uint8Array(width * height);
  gray.fill(255);
  for (let x = 10; x <= 109; x++) { gray[19 * width + x] = 0; gray[20 * width + x] = 0; }
  const rules = rulesFromCanvas(gray, width, height, 2);
  assert.equal(rules.length, 1);
  assert.ok(Math.abs(rules[0].y0 - 10) <= 2, JSON.stringify(rules[0]));
  assert.ok(Math.abs(rules[0].x0 - 5) <= 2);
  assert.ok(Math.abs(rules[0].x1 - 55) <= 2);
  assert.equal(rules[0].y0, rules[0].y1);
});

function fillPage(width, height) {
  const gray = new Uint8Array(width * height).fill(255);
  const rect = (x0, y0, x1, y1, v) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) gray[y * width + x] = v; };
  return { gray, rect };
}

test("fillsFromCanvas finds a dark header and a light zebra row with text on them", () => {
  const width = 400;
  const height = 300;
  const { gray, rect } = fillPage(width, height);
  rect(40, 40, 360, 80, 80); // header fill
  rect(40, 80, 360, 120, 215); // touching light row, another shade
  rect(60, 52, 70, 68, 250); // white letter on the header
  rect(60, 92, 70, 108, 20); // dark letter on the light row
  rect(39, 40, 40, 200, 80); // 1 px frame in the header colour joins both fills
  rect(360, 40, 361, 200, 80);
  const fills = fillsFromCanvas(gray, width, height, 4);
  assert.equal(fills.length, 2, JSON.stringify(fills));
  const [head, row] = fills;
  assert.ok(Math.abs(head.y0 - 10) <= 1 && Math.abs(head.y1 - 20) <= 1, JSON.stringify(head));
  assert.ok(Math.abs(head.x0 - 10) <= 1 && Math.abs(head.x1 - 90) <= 1, JSON.stringify(head));
  assert.ok(head.gray < 0.4 && row.gray > 0.8);
  assert.ok(Math.abs(row.y0 - 20) <= 1 && Math.abs(row.y1 - 30) <= 1, JSON.stringify(row));
  assert.ok(fills.every((f) => f.x0 >= 0 && f.y0 >= 0 && Number.isFinite(f.gray)), "opened parts stay inside their region");
  const rules = rulesFromCanvas(gray, width, height, 4, { fills });
  assert.ok(rules.every((r) => !(r.y0 === r.y1 && r.y0 > head.y0 + 1 && r.y0 < head.y1 - 1)), "no rules inside the header fill");
});

test("fillsFromCanvas mends the anti-aliased seam between two abutting fills of one colour", () => {
  const width = 400;
  const height = 300;
  const { gray, rect } = fillPage(width, height);
  rect(40, 40, 200, 140, 179);
  rect(42, 100, 198, 101, 197); // lighter seam where two fills meet, short of the region ends
  const fills = fillsFromCanvas(gray, width, height, 4);
  assert.equal(fills.length, 1, JSON.stringify(fills));
  assert.ok(Math.abs(fills[0].y0 - 10) <= 1 && Math.abs(fills[0].y1 - 35) <= 1, JSON.stringify(fills[0]));
});

test("fillsFromCanvas keeps a short shaded cell whole when its text nearly fills the height", () => {
  const width = 400;
  const height = 200;
  const { gray, rect } = fillPage(width, height);
  rect(40, 40, 360, 80, 224); // a 10 pt cell at scale 4
  for (let x = 100; x < 160; x += 9) rect(x, 43, x + 6, 77, 20); // a word whose ink leaves under 1 pt above and below
  const fills = fillsFromCanvas(gray, width, height, 4);
  assert.equal(fills.length, 1, JSON.stringify(fills));
  assert.ok(Math.abs(fills[0].x0 - 10) <= 1 && Math.abs(fills[0].x1 - 90) <= 1, JSON.stringify(fills[0]));
});

test("fillsFromCanvas skips text, a rounded bar and a blank page", () => {
  const width = 400;
  const height = 300;
  const { gray, rect } = fillPage(width, height);
  for (let x = 40; x < 300; x += 12) rect(x, 40, x + 6, 70, 0); // a row of bold glyphs
  rect(40, 200, 360, 232, 40); // a bar with rounded ends
  for (const [cx, cy] of [[40, 200], [359, 200], [40, 231], [359, 231]]) {
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) {
      if (dx + dy >= 6) continue;
      const x = cx === 40 ? cx + dx : cx - dx;
      const y = cy === 200 ? cy + dy : cy - dy;
      gray[y * width + x] = 255;
    }
  }
  assert.deepEqual(fillsFromCanvas(gray, width, height, 4), []);
  assert.deepEqual(fillsFromCanvas(new Uint8Array(width * height).fill(255), width, height, 4), []);
});

test("inkGlyph reads a dash and a star", () => {
  const dash = new Uint8Array(60 * 20);
  dash.fill(255);
  for (let y = 8; y <= 10; y++) for (let x = 10; x <= 45; x++) dash[y * 60 + x] = 0;
  assert.equal(inkGlyph(dash, 60, 20), "—");
  const star = new Uint8Array(40 * 40);
  star.fill(255);
  for (let y = 16; y < 24; y++) for (let x = 16; x < 24; x++) star[y * 40 + x] = 0;
  assert.equal(inkGlyph(star, 40, 40), "*");
  assert.equal(inkGlyph(new Uint8Array(10 * 10).fill(255), 10, 10), null);
});

test("detection boxes keep a bright blob and a horizontal angle", () => {
  const mapW = 64;
  const mapH = 32;
  const prob = new Float32Array(mapW * mapH);
  for (let y = 8; y < 14; y++) for (let x = 4; x < 40; x++) prob[y * mapW + x] = 0.95;
  const boxes = boxesFromProb(prob, mapW, mapH, mapW, mapH);
  assert.equal(boxes.length, 1);
  assert.ok(boxes[0].x1 > boxes[0].x0);
  assert.ok(Math.abs(dominantAngle(boxes)) < 5);
});

test("rotateRgb 90 counter-clockwise moves the right edge to the top", () => {
  const rgb = new Uint8Array(3 * 3 * 3);
  rgb.fill(255);
  const i = (1 * 3 + 2) * 3;
  rgb[i] = 10;
  rgb[i + 1] = 20;
  rgb[i + 2] = 30;
  const turned = rotateRgb(rgb, 3, 3, 90);
  const top = (0 * 3 + 1) * 3;
  assert.equal(turned.rgb[top], 10);
  assert.equal(turned.rgb[top + 1], 20);
  assert.equal(turned.rgb[top + 2], 30);
});

test("model manifest hashes match the files on disk", () => {
  for (const spec of Object.values(MODEL_FILES)) {
    const buf = readFileSync(new URL(`../assets/ocr/${spec.file}`, import.meta.url));
    assert.equal(buf.length, spec.bytes, spec.file);
    assert.equal(createHash("sha256").update(buf).digest("hex"), spec.sha256, spec.file);
  }
});

test("createOcrWeb fetches nothing until ocr()", async () => {
  let fetches = 0;
  const source = createOcrWeb({
    useWorker: false,
    fetch: async () => { fetches += 1; throw new Error("must not fetch"); },
  });
  const health = await source.health();
  assert.equal(health.state, "cold");
  assert.equal(health.schema, SCHEMA);
  assert.equal(health.engine, "ppocr-web");
  assert.equal(fetches, 0);
  assert.deepEqual(source.fetches(), []);
});

test("a hash mismatch is rejected and not cached", async () => {
  const puts = [];
  const caches = { async open() { return { async match() { return null; }, async put(url) { puts.push(String(url)); } }; } };
  const source = createOcrWeb({
    useWorker: false,
    assetBase: "https://example.test/",
    ortBase: "https://example.test/ort/",
    caches,
    fetch: async () => new Response(new Uint8Array([1, 2, 3, 4])),
  });
  await assert.rejects(() => source.ocr({ pages: [1], bytes: new Uint8Array([9]) }), /sha256 mismatch/);
  assert.equal(puts.length, 0);
});

test("an aborted ocr() does not call the runner", async () => {
  let ran = false;
  const source = createOcrWeb({
    useWorker: false,
    inline: {
      dict: ["H"],
      runDet: async () => { ran = true; return new Float32Array(0); },
      runRec: async () => ({ logits: new Float32Array(0), time: 0, classes: 1 }),
    },
  });
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(() => source.ocr({ pages: [1], signal: ctrl.signal }), (error) => error.name === "AbortError");
  assert.equal(ran, false);
});

test("inline runners emit a pxd-ocr/1 page without fetching", async () => {
  let fetches = 0;
  const width = 64;
  const height = 32;
  const rgb = new Uint8Array(width * height * 3);
  rgb.fill(255);
  const dict = ["H", "i"];
  const source = createOcrWeb({
    useWorker: false,
    fetch: async () => { fetches += 1; throw new Error("must not fetch"); },
    renderPage: async () => ({ rgb, width, height, dpi: 72, pointW: width, pointH: height }),
    inline: {
      dict,
      async runDet(_data, dims) {
        const prob = new Float32Array(dims[2] * dims[3]);
        const mapW = dims[3];
        for (let y = 8; y < 20; y++) for (let x = 4; x < 48; x++) prob[y * mapW + x] = 0.95;
        return prob;
      },
      async runRec() {
        const spec = logitsFor([1, 2], 3);
        return { logits: spec.logits, batch: 1, time: spec.time, classes: spec.classes };
      },
    },
  });
  const result = await source.ocr({ pages: [1], bytes: new Uint8Array([1]), sha256: "abc" });
  assert.equal(fetches, 0);
  assert.equal(result.schema, "pxd-ocr/1");
  assert.equal(result.engine, "ppocr-web");
  assert.equal(result.sha256, "abc");
  assert.equal(result.pages.length, 1);
  const page = result.pages[0];
  assert.equal(page.scan, true);
  assert.equal(page.n, 1);
  assert.deepEqual(page.transform, [1, 0, 0, 1, 0, 0]);
  assert.equal(page.fonts.ocr.name, "ocr");
  assert.ok(Array.isArray(page.rules));
  assert.ok(page.items.length >= 1);
  assert.equal(page.items[0].str, "Hi");
  assert.equal(page.items[0].fontName, "ocr");
  const cells = await source.ocr({ cells: [{ page: 1, bbox: [0, 0, 10, 4] }] });
  assert.equal(cells.cells[0].text, "Hi");
  assert.equal("glyph" in cells.cells[0], true);
});

test("parse view shows Read the scan for an OCR source with no helper", async () => {
  const { createParseView } = await import("../src/view/parse-view.js");
  const { createDomStub } = await import("./fixtures/dom-stub.js");
  const stub = createDomStub();
  const parsed = {
    schema: "pxd-parse/1", engine: "builtin", pageCount: 1,
    pages: [{ n: 1, kind: "scan", parsed: true }],
    order: ["s1"], blocks: { s1: { id: "s1", type: "scan", page: 1, bbox: [0, 0, 10, 10] } }, removed: [], stats: {},
  };
  const view = createParseView({ doc: stub.document || stub, helper: null, ocrSource: { async ocr() { return { pages: [] }; } } });
  view.showDoc(parsed);
  const btn = view.element().querySelector(".pxd-parse__scan");
  assert.equal(btn.hidden, false);
  assert.equal(btn.textContent, "Read the scan (p. 1)");
});

test("the extension entry does not import the OCR runtime", () => {
  const src = readFileSync(new URL("../src/extension.js", import.meta.url), "utf8");
  assert.equal(src.includes("ocr-web"), false);
  assert.equal(src.includes("onnxruntime"), false);
});

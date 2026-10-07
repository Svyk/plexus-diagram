// Fixture helpers shared by test/parse-engine.test.js and tools/parse-score.mjs (no tests here).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePdf } from "../src/model/parse/index.js";
import { loadPageData } from "../src/view/parse-engine.js";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIX = join(root, "test/fixtures/pdf");
export const ATTENTION = "/tmp/wo/pxd9/pdfs/attention.pdf";
export const ATTENTION_EXPECTED = "/tmp/wo/pxd9/attention.expected.json";

async function pdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

export async function parseFile(path, { pages } = {}) {
  const { getDocument } = await pdfjs();
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
  const info = (await doc.getMetadata()).info;
  const adapterMs = [];
  const parsed = await parsePdf({
    numPages: doc.numPages, pages, info,
    getPage: async (n) => { const t = performance.now(); const d = await loadPageData(await doc.getPage(n)); adapterMs.push(performance.now() - t); return d; },
  });
  parsed.stats.adapterMs = adapterMs;
  await doc.destroy();
  return parsed;
}

// Reading order ground truth comes from the HTML source: block elements in document order.
export function htmlOrder(html) {
  const body = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<table[\s\S]*?<\/table>/g, "").replace(/<div class="run-(head|foot)">[\s\S]*?<\/div>/g, "");
  const order = [];
  for (const m of body.matchAll(/<(h1|h2|h3|p|li|figcaption|div class="authors"|div class="abstract")[^>]*>([\s\S]*?)<\/(h1|h2|h3|p|li|figcaption|div)>/g)) {
    const text = m[2].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (text) order.push(text);
  }
  return order;
}

export function reportTruth() {
  const truth = JSON.parse(readFileSync(join(FIX, "report.truth.json"), "utf8"));
  truth.order = htmlOrder(readFileSync(join(FIX, "src/report.html"), "utf8"));
  truth.body = truth.order;
  truth.furniture = ["BlendHouse QA Technical Report 2026-07 · Environmental Monitoring Program review", "Page 1 of 3 — Internal use", "Page 2 of 3 — Internal use", "Page 3 of 3 — Internal use"];
  truth.footnotes = [{ mark: "3", text: "A harborage site is a niche where organisms survive cleaning, such as a cracked seal or a hollow roller." }];
  truth.tables[1].numericCols = [1, 2, 3, 4, 5, 6];
  truth.tables[2].numericCols = [4];
  return truth;
}


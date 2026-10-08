// Word accuracy for text outside tables (headings, notes, captions, paragraphs). Dev only.
// Truth is a list of lines in reading order; the document's non-table blocks are read in order.
// Word accuracy = longest common subsequence of word tokens / truth words. A line is "exact"
// when a block's text equals it after whitespace trimming.
import { readFileSync } from "node:fs";

import { readingTexts, tokens } from "../../test/parse-metrics.js";
import { htmlOrder } from "../../test/parse-engine-fixtures.js";

export function lcs(a, b) {
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]);
      diag = up;
    }
  }
  return prev[b.length];
}

export function textTruth(path) {
  const raw = readFileSync(path, "utf8");
  if (path.endsWith(".html")) return htmlOrder(raw);
  const body = JSON.parse(raw);
  return Array.isArray(body) ? body : body.lines;
}

export function scoreTextLines(doc, truthLines) {
  const texts = readingTexts(doc).map((t) => t.text);
  const pred = texts.flatMap((t) => tokens(t));
  const truth = truthLines.flatMap((t) => tokens(t));
  const matched = lcs(truth, pred);
  const have = new Set(texts.map((t) => t.trim()));
  const exact = truthLines.filter((t) => have.has(t.trim())).length;
  return { words: truth.length, matched, accuracy: truth.length ? Math.round((matched / truth.length) * 1000) / 1000 : 0, exact, lines: truthLines.length };
}

// Scorer for the scanned-technical-PDF corpus. Truth pages use the report.truth.json
// table shape, plus optional figures and lines:
//   figures: [{ bbox: [x0, y0, x1, y1], caption }]  page-normalised, origin top-left
//   lines: ["..."] or [{ text, unsure }]            non-table body text, reading order
//   textComplete: true                               lines are the whole body (CER/WER/τ)
// A cell or line with unsure:true is left out of the score.
// Figure hit: IoU >= 0.5. Caption linked: token Jaccard >= 0.5 against the truth caption.

import { jaccard, normText, r3, readingTexts, scoreOrder, scoreTable, tokens } from "../../test/parse-metrics.js";
import { lcs } from "./text-lines.mjs";

export function cellKey(c) {
  return `${c.r},${c.c},${c.rowSpan || 1},${c.colSpan || 1}`;
}

function lineText(line) {
  return typeof line === "string" ? line : line.text || "";
}

export function truthLines(truth) {
  return (truth.lines || []).filter((line) => !(line && line.unsure)).map(lineText).filter((t) => t.trim());
}

// Drop unsure truth cells, and the predicted cell at the same anchor, from both sides.
export function withoutUnsure(pred, truth) {
  const skip = new Set((truth.cells || []).filter((c) => c.unsure).map(cellKey));
  const cells = (truth.cells || []).filter((c) => !c.unsure);
  const predCells = pred && pred.cells ? pred.cells.filter((c) => !skip.has(cellKey(c))) : [];
  return {
    truth: { ...truth, cells },
    pred: pred ? { ...pred, cells: predCells } : null,
  };
}

export function tableCounts(pred, truth) {
  const cleaned = withoutUnsure(pred, truth);
  const scored = scoreTable(cleaned.pred, cleaned.truth);
  const predCells = cleaned.pred ? cleaned.pred.cells : [];
  const truthCells = cleaned.truth.cells;
  const truthByKey = new Map(truthCells.map((c) => [cellKey(c), c]));
  let structureTp = 0;
  let cellTp = 0;
  let cellSoftTp = 0;
  let cellSimSum = 0;
  for (const c of predCells) {
    const t = truthByKey.get(cellKey(c));
    if (!t) continue;
    structureTp++;
    const sim = cellSimilarity(t.text, c.text);
    cellSimSum += sim;
    if (sim >= 0.9) cellSoftTp++;
    if (normText(t.text) === normText(c.text)) cellTp++;
  }
  return { structureTp, cellTp, cellSoftTp, cellSimSum, predN: predCells.length, truthN: truthCells.length, score: scored };
}

// 1 when the normalised strings match, else 1 minus the edit distance over the longer one.
export function cellSimilarity(a, b) {
  const x = normText(a);
  const y = normText(b);
  if (x === y) return 1;
  const n = Math.max(x.length, y.length);
  if (!n) return 1;
  return 1 - levenshtein(x, y) / n;
}

export function boxIou(a, b) {
  if (!a || !b || a.length < 4 || b.length < 4) return 0;
  const x0 = Math.max(a[0], b[0]);
  const y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[2], b[2]);
  const y1 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

export function normBox(bbox, pageW, pageH) {
  if (!bbox || bbox.length < 4 || !(pageW > 0) || !(pageH > 0)) return null;
  // Already page-normalised (all corners in 0..1.5).
  if (Math.max(...bbox.map(Math.abs)) <= 1.5) return bbox;
  return [bbox[0] / pageW, bbox[1] / pageH, bbox[2] / pageW, bbox[3] / pageH];
}

function captionOf(doc, fig) {
  if (!fig) return "";
  const block = fig.caption && doc.blocks ? doc.blocks[fig.caption] : null;
  if (block && block.text) return block.text;
  return typeof fig.caption === "string" ? fig.caption : "";
}

export function pageSize(doc, pageNo) {
  const page = (doc.pages || []).find((p) => p.n === pageNo) || (doc.pages || [])[0];
  return page ? { w: page.w, h: page.h } : { w: 0, h: 0 };
}

export function predFigures(doc) {
  const out = [];
  for (const id of doc.order || []) {
    const b = doc.blocks[id];
    if (!b || b.type !== "figure") continue;
    const size = pageSize(doc, b.page);
    out.push({ id, bbox: normBox(b.bbox, size.w, size.h), caption: captionOf(doc, b), page: b.page });
  }
  return out;
}

const IOU_HIT = 0.5;

// Jaccard, or the shorter caption's tokens all sit inside the longer one ("Fig. 2" inside the full line).
function captionTokens(text) {
  // "Fig.2" and "Fig. 2" are the same caption token pair.
  return tokens(String(text || "").replace(/([A-Za-z])\.?(?=\d)/g, "$1 "));
}

export function captionLinked(truth, pred) {
  const tt = captionTokens(truth);
  const pt = captionTokens(pred);
  if (!tt.length) return !pt.length;
  if (jaccard(tt, pt) >= 0.5) return true;
  const small = tt.length <= pt.length ? tt : pt;
  const big = new Set(tt.length <= pt.length ? pt : tt);
  return small.length >= 2 && small.every((t) => big.has(t));
}

// Greedy one-to-one match. A caption counts as linked when the matched pair's texts agree.
export function figureCounts(doc, truthFigs) {
  const truth = (truthFigs || []).filter((f) => !f.unsure);
  const preds = predFigures(doc).filter((f) => f.bbox);
  const used = new Set();
  let hits = 0;
  let linked = 0;
  const pairs = [];
  for (const t of truth) {
    let best = -1;
    let bestIou = IOU_HIT - 1e-9;
    for (let i = 0; i < preds.length; i++) {
      if (used.has(i)) continue;
      const iou = boxIou(t.bbox, preds[i].bbox);
      if (iou > bestIou) { bestIou = iou; best = i; }
    }
    if (best >= 0 && bestIou >= IOU_HIT) {
      used.add(best);
      hits++;
      const cap = captionLinked(t.caption || "", preds[best].caption || "");
      if (cap) linked++;
      pairs.push({ truth: t, pred: preds[best], iou: r3(bestIou), caption: cap });
    } else pairs.push({ truth: t, pred: null, iou: r3(Math.max(0, bestIou)), caption: false });
  }
  return { hits, linked, truthN: truth.length, predN: preds.length, pairs, extra: preds.filter((_, i) => !used.has(i)) };
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      const cost = ai === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

export function textCounts(doc, lines) {
  const truth = lines.join("\n");
  const pred = readingTexts(doc).map((t) => t.text).join("\n");
  const tChars = normText(truth).replace(/ /g, "");
  const pChars = normText(pred).replace(/ /g, "");
  const tWords = tokens(truth);
  const pWords = tokens(pred);
  const charDist = levenshtein(tChars, pChars);
  const wordDist = levenshtein(tWords.join("\n"), pWords.join("\n"));
  const matched = lcs(tWords, pWords);
  return {
    charDist,
    charN: tChars.length,
    wordDist,
    wordN: tWords.length,
    matched,
    cer: tChars.length ? charDist / tChars.length : (pChars.length ? 1 : 0),
    wer: tWords.length ? wordDist / tWords.length : (pWords.length ? 1 : 0),
    accuracy: tWords.length ? matched / tWords.length : (pWords.length ? 0 : 1),
  };
}

function prfFrom(tp, predN, truthN) {
  const precision = predN ? tp / predN : (truthN ? 0 : 1);
  const recall = truthN ? tp / truthN : (predN ? 0 : 1);
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision: r3(precision), recall: r3(recall), f1: r3(f1), tp, predN, truthN };
}

export function predTables(doc) {
  return (doc.order || []).map((id) => doc.blocks[id]).filter((b) => b && b.type === "table");
}

// One truth page against one parsed document.
export function scorePage(doc, truth) {
  const out = { id: truth.id || null };
  if (Array.isArray(truth.tables)) {
    if (!truth.tables.length) {
      const extras = predTables(doc);
      const predN = extras.reduce((n, t) => n + (t.cells ? t.cells.length : 0), 0);
      out.tables = { ...prfFrom(0, predN, 0), structure: prfFrom(0, predN, 0), cellAt09: prfFrom(0, predN, 0), cellSim: null, extras: extras.length, misses: [] };
      out.tableCounts = { structureTp: 0, cellTp: 0, cellSoftTp: 0, cellSimSum: 0, predN, truthN: 0 };
    } else {
      let structureTp = 0;
      let cellTp = 0;
      let cellSoftTp = 0;
      let cellSimSum = 0;
      let predN = 0;
      let truthN = 0;
      const misses = [];
      const per = [];
      // Match each truth table to a predicted one via scoreDoc's caption/text overlap by
      // reusing scoreTable after a local match (same rule as matchTables, minus unsure cells).
      const preds = predTables(doc);
      const used = new Set();
      for (const t of truth.tables) {
        let best = null;
        for (const p of preds) {
          if (used.has(p.id)) continue;
          const textScore = jaccard(
            (p.cells || []).map((c) => normText(c.text)).filter(Boolean),
            (t.cells || []).filter((c) => !c.unsure).map((c) => normText(c.text)).filter(Boolean),
          );
          if (!best || textScore > best.score) best = { p, score: textScore };
        }
        const pred = best && best.score > 0.2 ? best.p : null;
        if (pred) used.add(pred.id);
        const counts = tableCounts(pred, t);
        structureTp += counts.structureTp;
        cellTp += counts.cellTp;
        cellSoftTp += counts.cellSoftTp;
        cellSimSum += counts.cellSimSum;
        predN += counts.predN;
        truthN += counts.truthN;
        per.push({ caption: t.caption || "", id: pred ? pred.id : null, rows: pred ? pred.rows : 0, cols: pred ? pred.cols : 0, ...counts.score });
        for (const m of counts.score.misses) if (m.reason !== "no-cell" || m.truth) misses.push(m);
      }
      for (const p of preds) if (!used.has(p.id)) predN += (p.cells || []).length;
      out.tables = {
        ...prfFrom(cellTp, predN, truthN),
        structure: prfFrom(structureTp, predN, truthN),
        cellAt09: prfFrom(cellSoftTp, predN, truthN),
        cellSim: structureTp ? Math.round((cellSimSum / structureTp) * 1000) / 1000 : null,
        extras: preds.filter((p) => !used.has(p.id)).length,
        per,
        misses: misses.slice(0, 40),
      };
      out.tableCounts = { structureTp, cellTp, cellSoftTp, cellSimSum, predN, truthN };
    }
  }
  if (Array.isArray(truth.figures)) {
    const fig = figureCounts(doc, truth.figures);
    out.figures = {
      ...prfFrom(fig.hits, fig.predN, fig.truthN),
      caption: prfFrom(fig.linked, fig.hits, fig.truthN),
      pairs: fig.pairs,
    };
    out.figureCounts = fig;
  }
  const lines = truthLines(truth);
  if (truth.textComplete && lines.length) {
    const text = textCounts(doc, lines);
    out.text = {
      cer: r3(text.cer),
      wer: r3(text.wer),
      accuracy: r3(text.accuracy),
      words: text.wordN,
      matched: text.matched,
    };
    out.textCounts = text;
    out.order = scoreOrder(doc, lines);
  }
  return out;
}

export function micro(pages, pick) {
  let tp = 0;
  let predN = 0;
  let truthN = 0;
  for (const page of pages) {
    const c = pick(page);
    if (!c) continue;
    tp += c.tp;
    predN += c.predN;
    truthN += c.truthN;
  }
  return prfFrom(tp, predN, truthN);
}

export function fmt(n) {
  return n == null || Number.isNaN(n) ? "—" : Number(n).toFixed(3);
}

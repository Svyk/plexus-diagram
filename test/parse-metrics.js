// Pure scorer for pxd-parse/1 documents against a truth JSON (report.truth.json shape plus
// optional order / furniture / footnotes). Used by test/parse-engine*.test.js and tools/parse-score.mjs.

export function normText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*([,.;:)])/g, "$1")
    .replace(/(\d)\s+([.,])\s*(\d)/g, "$1$2$3")
    .replace(/(\d)([.,])\s+(\d)/g, "$1$2$3")
    .replace(/[¹²³⁰⁴-⁹†‡*]+$/g, "")
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])\s+(?=\d)/g, "$1");
}

export function tokens(text) {
  return normText(text).split(/[^a-z0-9%.,-]+/).map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9%]+$/g, "")).filter(Boolean);
}

export function jaccard(a, b) {
  const A = new Set(a); const B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function cellKey(c) {
  return `${c.r},${c.c},${c.rowSpan || 1},${c.colSpan || 1}`;
}

function prf(tp, predN, truthN) {
  const precision = predN ? tp / predN : 0;
  const recall = truthN ? tp / truthN : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision: r3(precision), recall: r3(recall), f1: r3(f1) };
}

export function scoreTable(pred, truth, { loose = false } = {}) {
  const norm = loose ? (t) => normText(t).replace(/\s+/g, "") : normText;
  const predCells = (pred && pred.cells) || [];
  const truthCells = truth.cells || [];
  const truthByKey = new Map(truthCells.map((c) => [cellKey(c), c]));
  let structure = 0;
  let full = 0;
  const misses = [];
  for (const c of predCells) {
    const t = truthByKey.get(cellKey(c));
    if (!t) { misses.push({ pred: c, reason: "no-cell" }); continue; }
    structure++;
    if (norm(t.text) === norm(c.text)) full++;
    else misses.push({ pred: c, truth: t, reason: "text" });
  }
  const predKeys = new Set(predCells.map(cellKey));
  for (const t of truthCells) if (!predKeys.has(cellKey(t))) misses.push({ truth: t, reason: "missing" });
  const alignChecks = [];
  if (truth.numericCols) {
    for (const col of truth.numericCols) {
      const body = predCells.filter((c) => c.c === col && !c.header && (c.colSpan || 1) === 1 && c.text);
      alignChecks.push({ col, right: body.length > 0 && body.every((c) => c.align === "right") });
    }
  }
  return {
    structure: prf(structure, predCells.length, truthCells.length),
    cells: prf(full, predCells.length, truthCells.length),
    rowsOk: pred ? pred.rows === truth.rows : false,
    colsOk: pred ? pred.cols === truth.cols : false,
    headerRowsOk: pred ? pred.headerRows === truth.headerRows : false,
    alignChecks,
    misses,
  };
}

function captionText(doc, block) {
  if (!block || !block.caption) return "";
  const cap = doc.blocks[block.caption];
  return cap ? cap.text : "";
}

// Match predicted tables to truth tables by caption, then by best cell overlap.
export function matchTables(doc, truthTables) {
  const predTables = doc.order.map((id) => doc.blocks[id]).filter((b) => b && b.type === "table");
  const used = new Set();
  const matches = [];
  for (const truth of truthTables) {
    let best = null;
    for (const p of predTables) {
      if (used.has(p.id)) continue;
      const cap = captionText(doc, p);
      const capScore = truth.caption && cap ? jaccard(tokens(truth.caption), tokens(cap)) : 0;
      const textScore = jaccard(p.cells.map((c) => normText(c.text)).filter(Boolean), truth.cells.map((c) => normText(c.text)).filter(Boolean));
      const score = Math.max(capScore, textScore);
      if (score > 0.2 && (!best || score > best.score)) best = { p, score };
    }
    if (best) used.add(best.p.id);
    matches.push({ truth, pred: best ? best.p : null, score: best ? r3(best.score) : 0 });
  }
  return { matches, extra: predTables.filter((p) => !used.has(p.id)) };
}

export function scoreHeadings(doc, truthHeadings) {
  const preds = doc.order.map((id) => doc.blocks[id]).filter((b) => b && b.type === "heading");
  let matched = 0;
  let levelOk = 0;
  const details = [];
  for (const t of truthHeadings) {
    const p = preds.find((h) => jaccard(tokens(h.text), tokens(t.text)) >= 0.8);
    if (p) { matched++; if (p.level === t.level) levelOk++; }
    details.push({ text: t.text, level: t.level, pred: p ? p.level : null });
  }
  return { total: truthHeadings.length, matched, levelOk, accuracy: r3(truthHeadings.length ? levelOk / truthHeadings.length : 0), extra: preds.length - matched, details };
}

// Flatten the document's text in reading order: one string per block, list items separately.
export function readingTexts(doc) {
  const out = [];
  for (const id of doc.order) {
    const b = doc.blocks[id];
    if (!b) continue;
    if (b.type === "list") { for (const it of b.items) out.push({ id, text: it.text }); continue; }
    if (b.type === "table") { continue; }
    if (b.text) out.push({ id, text: b.text });
  }
  return out;
}

export function kendallTau(ranks) {
  // ranks: array of truth positions in predicted order.
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < ranks.length; i++) for (let j = i + 1; j < ranks.length; j++) {
    if (ranks[i] < ranks[j]) concordant++; else if (ranks[i] > ranks[j]) discordant++;
  }
  const n = concordant + discordant;
  return n ? (concordant - discordant) / n : 1;
}

// truthOrder: array of texts in reading order. Matches by token Jaccard >= 0.8 (or containment for long blocks).
export function scoreOrder(doc, truthOrder, { threshold = 0.8 } = {}) {
  const preds = readingTexts(doc);
  const truthToks = truthOrder.map((t) => tokens(t));
  const usedTruth = new Set();
  const ranks = [];
  const unmatched = [];
  for (const p of preds) {
    const pt = tokens(p.text);
    if (pt.length < 2) continue;
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < truthToks.length; i++) {
      if (usedTruth.has(i)) continue;
      const score = jaccard(pt, truthToks[i]);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0 && bestScore >= threshold) { usedTruth.add(best); ranks.push(best); }
    else unmatched.push({ id: p.id, text: p.text.slice(0, 60), best: best >= 0 ? truthOrder[best].slice(0, 60) : null, score: r3(bestScore) });
  }
  return { tau: r3(kendallTau(ranks)), matched: ranks.length, truthCount: truthOrder.length, predCount: preds.length, unmatched };
}

export function scoreFurniture(doc, truthFurniture = [], truthBody = []) {
  const removed = doc.removed || [];
  const removedTexts = removed.map((r) => normText(r.text));
  const missing = truthFurniture.filter((t) => !removedTexts.some((r) => r.includes(normText(t)) || normText(t).includes(r)));
  const leaked = truthBody.filter((t) => removedTexts.some((r) => r === normText(t)));
  return { removed: removed.length, missing, leaked, ok: missing.length === 0 && leaked.length === 0 };
}

export function scoreFootnotes(doc, truthFootnotes = []) {
  const notes = Object.values(doc.blocks).filter((b) => b.type === "footnote");
  const refs = Object.values(doc.blocks).flatMap((b) => (b.footnoteRefs || []).map((r) => ({ ...r, block: b.id })));
  let linked = 0;
  const details = [];
  for (const t of truthFootnotes) {
    const note = notes.find((n) => String(n.mark) === String(t.mark) && jaccard(tokens(n.text), tokens(t.text)) >= 0.6);
    const ref = refs.find((r) => String(r.mark) === String(t.mark) && note && r.to === note.id);
    if (note && ref) linked++;
    details.push({ mark: t.mark, note: Boolean(note), ref: Boolean(ref) });
  }
  return { total: truthFootnotes.length, linked, details };
}

export function scoreDoc(doc, truth) {
  const out = { tables: [], extraTables: 0 };
  if (truth.tables) {
    const { matches, extra } = matchTables(doc, truth.tables);
    out.extraTables = extra.length;
    for (const m of matches) {
      const s = scoreTable(m.pred, m.truth, { loose: Boolean(truth.loose) });
      out.tables.push({ caption: m.truth.caption, matched: Boolean(m.pred), id: m.pred ? m.pred.id : null, method: m.pred ? m.pred.method : null, ...s });
    }
  }
  if (truth.headings) out.headings = scoreHeadings(doc, truth.headings);
  if (truth.order) out.order = scoreOrder(doc, truth.order);
  if (truth.furniture || truth.body) out.furniture = scoreFurniture(doc, truth.furniture || [], truth.body || []);
  if (truth.footnotes) out.footnotes = scoreFootnotes(doc, truth.footnotes);
  out.pages = (doc.pages || []).map((p) => p.kind);
  out.counts = countTypes(doc);
  return out;
}

export function countTypes(doc) {
  const counts = {};
  for (const b of Object.values(doc.blocks || {})) counts[b.type] = (counts[b.type] || 0) + 1;
  return counts;
}

export function r3(v) {
  return Math.round(v * 1000) / 1000;
}

// Build a table from a structure model's cells plus OCR words. A word belongs to the
// smallest cell that contains its centre. Rule assembly stays the fallback when a region
// has no structure. Pure: no network, no graph writes.

// One Vision / pxd-ocr word. `transform[4]` is the left edge, `y0`/`y1` the box.
export function wordsFromOcrPage(page) {
  const out = [];
  for (const it of page?.items || []) {
    const text = it.str || "";
    if (!text.trim()) continue;
    const size = Number(it.height) || Math.abs(Number(it.transform?.[0]) || 0) || 6;
    const x0 = Number(it.transform?.[4]);
    const width = Number(it.width) || 0;
    if (!Number.isFinite(x0)) continue;
    const y0 = Number(it.y0);
    const y1 = Number(it.y1);
    const base = Number(it.transform?.[5]);
    out.push({
      text,
      x0,
      x1: x0 + width,
      y0: Number.isFinite(y0) ? y0 : base - 0.8 * size,
      y1: Number.isFinite(y1) ? y1 : base + 0.22 * size,
      base: Number.isFinite(base) ? base : y1,
      size,
      conf: it.conf,
    });
  }
  return out;
}

function centre(word) {
  return { x: (word.x0 + word.x1) / 2, y: (word.y0 + word.y1) / 2 };
}

function area(box) {
  return Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
}

function contains(box, x, y) {
  return box && box.length >= 4 && x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
}

// Words on one baseline join with spaces; a later baseline starts a new line, also joined
// with a space, because truth cells are single strings.
export function cellText(words) {
  const sorted = [...words].sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const lines = [];
  for (const word of sorted) {
    const last = lines[lines.length - 1];
    const limit = 0.45 * Math.max(word.size || 6, last?.size || 0, 4);
    if (last && Math.abs(word.base - last.base) <= limit) last.words.push(word);
    else lines.push({ base: word.base, size: word.size || 6, words: [word] });
  }
  return lines.map((line) => line.words.sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(" ")).join(" ").replace(/\s+/g, " ").trim();
}

// `cells` carry { r, c, rowSpan, colSpan, bbox } in the same point space as `words`.
export function fillStructureCells(cells, words) {
  const buckets = (cells || []).map(() => []);
  for (const word of words || []) {
    const { x, y } = centre(word);
    let best = -1;
    let bestArea = Infinity;
    for (let i = 0; i < cells.length; i++) {
      const box = cells[i].bbox;
      if (!contains(box, x, y)) continue;
      const a = area(box);
      if (a < bestArea) { bestArea = a; best = i; }
    }
    if (best >= 0) buckets[best].push(word);
  }
  return (cells || []).map((cell, i) => {
    const spanR = cell.rowSpan || 1;
    const spanC = cell.colSpan || 1;
    const text = cellText(buckets[i]);
    const used = buckets[i];
    return {
      r: cell.r,
      c: cell.c,
      rowSpan: spanR,
      colSpan: spanC,
      text,
      bbox: cell.bbox,
      header: Boolean(cell.header),
      conf: used.length ? Math.min(...used.map((w) => w.conf ?? 1)) : 0,
      wbase: used.length ? used.reduce((s, w) => s + w.base, 0) / used.length : undefined,
      wsize: used.length ? Math.max(...used.map((w) => w.size || 0)) : undefined,
      wbox: used.length ? [Math.min(...used.map((w) => w.x0)), Math.min(...used.map((w) => w.y0)), Math.max(...used.map((w) => w.x1)), Math.max(...used.map((w) => w.y1))] : undefined,
    };
  });
}

export function headerRowCount(cells, rows) {
  let n = 0;
  for (let r = 0; r < rows; r++) {
    const row = cells.filter((c) => c.r === r);
    if (!row.length || !row.every((c) => c.header)) break;
    n++;
  }
  return n;
}

// One structure region plus the page's words → a table block. `rows`/`cols` come from the
// model when it sent them, otherwise from the cell spans.
export function tableFromStructure(structure, words, { id = "ts", method = "structure" } = {}) {
  const cells = fillStructureCells(structure.cells || [], words);
  const rows = structure.rows || cells.reduce((m, c) => Math.max(m, c.r + (c.rowSpan || 1)), 0);
  const cols = structure.cols || cells.reduce((m, c) => Math.max(m, c.c + (c.colSpan || 1)), 0);
  const boxes = cells.map((c) => c.bbox).filter((b) => b && b.length >= 4);
  const bbox = structure.bbox || (boxes.length
    ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]
    : [0, 0, 0, 0]);
  return {
    id,
    type: "table",
    page: structure.page,
    bbox,
    rows,
    cols,
    headerRows: structure.headerRows ?? headerRowCount(cells, rows),
    headerCols: 0,
    cells,
    method,
    confidence: structure.confidence ?? 0.75,
    engine: "builtin",
  };
}

function normCell(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function textJaccard(a, b) {
  const A = new Set((a?.cells || []).map((c) => normCell(c.text)).filter(Boolean));
  const B = new Set((b?.cells || []).map((c) => normCell(c.text)).filter(Boolean));
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// Rule-assembly tables on the requested pages. These are the crops the helper structure
// model sees: lattice boxes and the stream tables found while the document is assembled.
export function tableRegions(doc, pages) {
  const want = pages && pages.length ? new Set(pages) : null;
  const out = [];
  for (const id of doc?.order || []) {
    const block = doc.blocks?.[id];
    if (!block || block.type !== "table" || !block.bbox) continue;
    if (want && !want.has(block.page)) continue;
    const bbox = Array.isArray(block.bbox) ? block.bbox : [block.bbox.x0, block.bbox.y0, block.bbox.x1, block.bbox.y1];
    if (bbox.length < 4 || bbox.some((n) => !Number.isFinite(n))) continue;
    out.push({ page: block.page, bbox });
  }
  return out;
}

function iou(a, b) {
  if (!a || !b) return 0;
  const ix = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const iy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (ix <= 0 || iy <= 0) return 0;
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

// Replace each rule-assembly table that overlaps a structure region. The replacement
// stands only when its filled text still looks like the rule table (`minTextJaccard`,
// default 0.15): a scrambled grid would otherwise wipe a table the rules already read.
// A structure region with no overlap is inserted. Tables the model did not see stay.
export function applyStructureTables(doc, structures, wordsByPage, { method = "structure", minTextJaccard = 0.15 } = {}) {
  if (!doc || !structures?.length) return { doc, applied: [] };
  const blocks = { ...doc.blocks };
  const order = [...(doc.order || [])];
  const applied = [];
  const used = new Set();
  let seq = 0;
  for (const structure of structures) {
    if (!structure?.cells?.length) continue;
    const words = wordsByPage.get(structure.page) || [];
    const built = tableFromStructure(structure, words, { id: `struct${seq++}`, method });
    let host = null;
    let best = 0.15;
    for (const id of order) {
      const block = blocks[id];
      if (!block || block.type !== "table" || block.page !== structure.page || used.has(id)) continue;
      const overlap = iou(block.bbox, built.bbox);
      if (overlap > best) { best = overlap; host = block; }
    }
    if (host) {
      if (textJaccard(host, built) < minTextJaccard) continue;
      used.add(host.id);
      blocks[host.id] = {
        ...host,
        bbox: built.bbox,
        rows: built.rows,
        cols: built.cols,
        headerRows: built.headerRows,
        cells: built.cells,
        method,
        confidence: built.confidence,
        grid: undefined,
        repairs: undefined,
        ocrSource: host.ocrSource || "fresh",
      };
      applied.push({ id: host.id, page: structure.page, rows: built.rows, cols: built.cols });
    } else {
      const id = built.id;
      while (blocks[id]) built.id = `${id}b`;
      blocks[built.id] = { ...built, ocrSource: "fresh" };
      const at = order.findIndex((oid) => blocks[oid]?.page > structure.page);
      if (at < 0) order.push(built.id);
      else order.splice(at, 0, built.id);
      applied.push({ id: built.id, page: structure.page, rows: built.rows, cols: built.cols, inserted: true });
    }
  }
  return { doc: { ...doc, blocks, order }, applied };
}

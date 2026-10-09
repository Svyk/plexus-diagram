// Replace a rule-assembly table with a local VLM reading of the same box.
// The helper returns cells that already contain text. Rule assembly stays when the
// reading does not look like the same table.
//
// applyStructureTables (the TableFormer path) accepts a replacement only when the
// set of full cell strings has Jaccard ≥ 0.15. A VLM often fixes a word the rules
// mis-read, so that set misses even when the grid is the same table. Here the
// replacement also stands when the tokens of the concatenated cell text have
// Jaccard ≥ 0.15. Below both thresholds the rule table is kept.

function normCell(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function setJaccard(a, b) {
  const A = new Set((a?.cells || []).map((c) => normCell(c.text)).filter(Boolean));
  const B = new Set((b?.cells || []).map((c) => normCell(c.text)).filter(Boolean));
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function tokenJaccard(a, b) {
  const tokens = (table) => {
    const out = new Set();
    for (const piece of (table?.cells || []).map((c) => normCell(c.text)).join(" ").split(/[^a-z0-9%.,-]+/)) {
      if (piece) out.add(piece);
    }
    return out;
  };
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
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

function headerRowsOf(cells, rows) {
  let n = 0;
  for (let r = 0; r < rows; r++) {
    const row = (cells || []).filter((c) => c.r === r);
    if (!row.length || !row.every((c) => c.header)) break;
    n++;
  }
  return n;
}

function tableFromVlm(structure, { id = "vlm", method = "vlm" } = {}) {
  const cells = (structure.cells || []).map((cell) => ({
    r: cell.r,
    c: cell.c,
    rowSpan: cell.rowSpan || 1,
    colSpan: cell.colSpan || 1,
    text: cell.text || "",
    header: Boolean(cell.header),
  }));
  const rows = structure.rows || cells.reduce((m, c) => Math.max(m, c.r + (c.rowSpan || 1)), 0);
  const cols = structure.cols || cells.reduce((m, c) => Math.max(m, c.c + (c.colSpan || 1)), 0);
  return {
    id,
    type: "table",
    page: structure.page,
    bbox: structure.bbox,
    rows,
    cols,
    headerRows: structure.headerRows ?? headerRowsOf(cells, rows),
    headerCols: 0,
    cells,
    method,
    confidence: structure.confidence ?? 0.7,
    engine: "builtin",
  };
}

// `minJaccard` applies to both the full-string set and the token set. Either one
// is enough to replace. A region with no overlapping rule table is inserted.
export function applyVlmTables(doc, structures, { method = "vlm", minJaccard = 0.15 } = {}) {
  if (!doc || !structures?.length) return { doc, applied: [] };
  const blocks = { ...doc.blocks };
  const order = [...(doc.order || [])];
  const applied = [];
  const used = new Set();
  let seq = 0;
  for (const structure of structures) {
    if (!structure?.cells?.length || !structure.bbox) continue;
    const built = tableFromVlm(structure, { id: `vlm${seq++}`, method });
    let host = null;
    let best = 0.15;
    for (const id of order) {
      const block = blocks[id];
      if (!block || block.type !== "table" || block.page !== structure.page || used.has(id)) continue;
      const overlap = iou(block.bbox, built.bbox);
      if (overlap > best) { best = overlap; host = block; }
    }
    // Full-string set Jaccard is what TableFormer uses. Token Jaccard is also
    // accepted: on this corpus that raised cell F1 from 0.140 to 0.155 and
    // left structure F1 at 0.606 versus 0.610.
    const same = host && (setJaccard(host, built) >= minJaccard || tokenJaccard(host, built) >= minJaccard);
    if (host && !same) continue;
    if (host) {
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
      };
      applied.push({ id: host.id, page: structure.page, rows: built.rows, cols: built.cols });
    } else {
      const id = built.id;
      while (blocks[id]) built.id = `${id}b`;
      blocks[built.id] = built;
      const at = order.findIndex((oid) => blocks[oid]?.page > structure.page);
      if (at < 0) order.push(built.id);
      else order.splice(at, 0, built.id);
      applied.push({ id: built.id, page: structure.page, rows: built.rows, cols: built.cols, inserted: true });
    }
  }
  return { doc: { ...doc, blocks, order }, applied };
}

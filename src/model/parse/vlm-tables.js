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
// `trust` replaces every overlapping rule table and inserts the reading. The
// high-accuracy path uses it: the crop is the layout box, so a low overlap
// with the rule text means the rules were wrong, not the reading.
export function applyVlmTables(doc, structures, { method = "vlm", minJaccard = 0.15, trust = false } = {}) {
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
    if (host && !same && !trust) continue;
    if (trust) {
      for (const id of [...order]) {
        const block = blocks[id];
        if (!block || block.type !== "table" || block.page !== structure.page) continue;
        if (iou(block.bbox, built.bbox) < 0.1) continue;
        delete blocks[id];
        const at = order.indexOf(id);
        if (at >= 0) order.splice(at, 1);
      }
      host = null;
    }
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

function centerOf(bbox) {
  if (!bbox || bbox.length < 4) return null;
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function splitByWidth(text, widths) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!widths.length) return [];
  if (!words.length) return widths.map(() => "");
  if (widths.length === 1) return [words.join(" ")];
  const total = widths.reduce((sum, w) => sum + w, 0) || 1;
  const counts = widths.map((w) => Math.max(1, Math.round((words.length * w) / total)));
  let drift = words.length - counts.reduce((sum, n) => sum + n, 0);
  counts[counts.length - 1] = Math.max(0, counts[counts.length - 1] + drift);
  const out = [];
  let at = 0;
  for (const n of counts) {
    out.push(words.slice(at, at + n).join(" "));
    at += n;
  }
  if (at < words.length) {
    const rest = words.slice(at).join(" ");
    out[out.length - 1] = [out[out.length - 1], rest].filter(Boolean).join(" ");
  }
  return out;
}

// Replace the text of Vision lines whose centres sit in a VLM text region.
// The line boxes stay. `regions` are `{page, bbox, text}` in top-left PDF points.
export function alignVlmText(doc, regions) {
  if (!doc || !regions?.length) return { doc, applied: [] };
  const blocks = { ...doc.blocks };
  const applied = [];
  const kinds = new Set(["para", "heading", "caption", "footnote"]);
  for (const region of regions) {
    if (!region?.text || !region.bbox) continue;
    const inside = [];
    for (const id of doc.order || []) {
      const block = blocks[id];
      if (!block || block.page !== region.page || !kinds.has(block.type) || !block.bbox) continue;
      const c = centerOf(block.bbox);
      if (!c) continue;
      if (c[0] < region.bbox[0] || c[0] > region.bbox[2] || c[1] < region.bbox[1] || c[1] > region.bbox[3]) continue;
      inside.push(block);
    }
    if (!inside.length) continue;
    inside.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
    const parts = splitByWidth(region.text, inside.map((b) => Math.max(1, b.bbox[2] - b.bbox[0])));
    inside.forEach((block, i) => {
      const text = parts[i] || "";
      if (!text || text === block.text) return;
      blocks[block.id] = { ...block, text };
      applied.push(block.id);
    });
  }
  return { doc: { ...doc, blocks }, applied };
}

// A layout figure is added only on a page that has none. An existing figure
// stays, so a hint cannot pull figure F1 down by adding a second box.
export function hintLayoutFigures(doc, hints) {
  if (!doc || !hints?.length) return { doc, applied: [] };
  const blocks = { ...doc.blocks };
  const order = [...(doc.order || [])];
  const pagesWith = new Set();
  for (const id of order) {
    const block = blocks[id];
    if (block?.type === "figure") pagesWith.add(block.page);
  }
  const applied = [];
  let seq = 0;
  for (const hint of hints) {
    if (!hint?.bbox || pagesWith.has(hint.page)) continue;
    if (hint.label && hint.label !== "image" && hint.label !== "chart") continue;
    const id = `vfig${seq++}`;
    const block = {
      id,
      type: "figure",
      page: hint.page,
      bbox: hint.bbox,
      caption: null,
      image: { kind: "crop", source: hint.label || "image" },
      confidence: hint.score ?? 0.6,
      method: "vlm-layout",
      engine: "builtin",
    };
    blocks[id] = block;
    const at = order.findIndex((oid) => blocks[oid]?.page > hint.page);
    if (at < 0) order.push(id);
    else order.splice(at, 0, id);
    pagesWith.add(hint.page);
    applied.push({ id, page: hint.page });
  }
  return { doc: { ...doc, blocks, order }, applied };
}

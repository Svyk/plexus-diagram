// pxd-parse/1. Pure checks, the scoped-reparse merge, and the table grid.
// No DOM, no graph writes.

export const SCHEMA = "pxd-parse/1";
export const IOU_MIN = 0.5;

export const BLOCK_TYPES = Object.freeze([
  "heading", "para", "list", "table", "figure", "formula", "caption", "footnote", "code", "scan",
]);

const TYPE_SET = new Set(BLOCK_TYPES);
const ENGINES = new Set(["builtin", "docling", "mixed"]);

function boxOf(value) {
  if (!Array.isArray(value) || value.length < 4) return null;
  const [x0, y0, x1, y1] = value;
  if (![x0, y0, x1, y1].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

export function iou(a, b) {
  const A = boxOf(a);
  const B = boxOf(b);
  if (!A || !B) return 0;
  const ix0 = Math.max(A[0], B[0]);
  const iy0 = Math.max(A[1], B[1]);
  const ix1 = Math.min(A[2], B[2]);
  const iy1 = Math.min(A[3], B[3]);
  const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
  const areaA = (A[2] - A[0]) * (A[3] - A[1]);
  const areaB = (B[2] - B[0]) * (B[3] - B[1]);
  const union = areaA + areaB - inter;
  if (union <= 0) return 0;
  return inter / union;
}

function targetOf(bbox) {
  if (Array.isArray(bbox)) return { page: null, bbox: boxOf(bbox) };
  if (bbox && typeof bbox === "object") {
    const page = Number.isInteger(bbox.page) ? bbox.page : null;
    const box = Array.isArray(bbox.bbox) ? boxOf(bbox.bbox) : boxOf(bbox);
    return { page, bbox: box };
  }
  return { page: null, bbox: null };
}

function samePage(block, page) {
  if (page == null) return true;
  return block?.page === page;
}

export function validateParse(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: ["schema"] };
  }
  if (doc.schema !== SCHEMA) errors.push("schema");
  if (doc.engine != null && !ENGINES.has(doc.engine)) errors.push("engine");
  const blocks = doc.blocks;
  if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) {
    errors.push("blocks");
  }
  const order = doc.order;
  if (!Array.isArray(order)) {
    errors.push("order");
  } else if (blocks && typeof blocks === "object") {
    const seen = new Set();
    for (const id of order) {
      if (seen.has(id)) errors.push(`order-duplicate:${id}`);
      seen.add(id);
      if (!Object.prototype.hasOwnProperty.call(blocks, id)) errors.push(`order-missing:${id}`);
    }
  }
  if (blocks && typeof blocks === "object" && !Array.isArray(blocks)) {
    for (const [key, block] of Object.entries(blocks)) {
      if (!block || typeof block !== "object") {
        errors.push(`block-type:${key}`);
        continue;
      }
      if (block.id != null && block.id !== key) errors.push(`block-id:${key}`);
      if (!TYPE_SET.has(block.type)) errors.push(`block-type:${key}`);
      if (block.confidence != null) {
        const c = block.confidence;
        if (typeof c !== "number" || c < 0 || c > 1) errors.push(`confidence:${key}`);
      }
      if (block.type === "table") validateTable(key, block, errors);
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateTable(id, table, errors) {
  const rows = table.rows;
  const cols = table.cols;
  if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(cols) || cols < 1) {
    errors.push(`cell-range:${id}`);
    return;
  }
  const grid = Array.from({ length: rows }, () => Array(cols).fill(null));
  const cells = Array.isArray(table.cells) ? table.cells : [];
  for (const cell of cells) {
    const r = cell?.r;
    const c = cell?.c;
    const rs = cell?.rowSpan ?? 1;
    const cs = cell?.colSpan ?? 1;
    const inRange = Number.isInteger(r) && Number.isInteger(c) && Number.isInteger(rs) && Number.isInteger(cs)
      && r >= 0 && c >= 0 && rs >= 1 && cs >= 1
      && r + rs <= rows && c + cs <= cols;
    if (!inRange) {
      errors.push(`cell-range:${id}:${r}:${c}`);
      continue;
    }
    for (let dr = 0; dr < rs; dr += 1) {
      for (let dc = 0; dc < cs; dc += 1) {
        const rr = r + dr;
        const cc = c + dc;
        if (grid[rr][cc]) {
          errors.push(`cell-overlap:${id}:${rr}:${cc}`);
        } else {
          grid[rr][cc] = true;
        }
      }
    }
  }
}

export function blocksInRange(doc, fromPage, toPage) {
  const from = Math.min(fromPage, toPage);
  const to = Math.max(fromPage, toPage);
  const blocks = doc?.blocks || {};
  const order = Array.isArray(doc?.order) ? doc.order : [];
  const out = [];
  for (const id of order) {
    const block = blocks[id];
    if (!block) continue;
    if (block.page >= from && block.page <= to) out.push(block);
  }
  return out;
}

// ids: string[] in that order. Range: [fromPage, toPage], or { fromPage, toPage } / { from, to }.
// Null selects every block in reading order.
export function selectBlocks(doc, idsOrRange) {
  const blocks = doc?.blocks || {};
  if (idsOrRange == null) {
    const order = Array.isArray(doc?.order) ? doc.order : [];
    return order.map((id) => blocks[id]).filter(Boolean);
  }
  if (Array.isArray(idsOrRange)) {
    if (idsOrRange.length === 2 && idsOrRange.every((n) => typeof n === "number")) {
      return blocksInRange(doc, idsOrRange[0], idsOrRange[1]);
    }
    return idsOrRange.map((id) => blocks[id]).filter(Boolean);
  }
  if (typeof idsOrRange === "object") {
    const from = idsOrRange.fromPage ?? idsOrRange.from;
    const to = idsOrRange.toPage ?? idsOrRange.to;
    if (from != null && to != null) return blocksInRange(doc, from, to);
  }
  return [];
}

// 2D array, rows × cols. Anchor slot: { anchor: true, covered: false, cell, text }.
// Covered slot: { anchor: false, covered: true, cell (the anchor), text (the anchor's text) }.
// A hole is { anchor: false, covered: false, cell: null, text: "" }.
export function tableGrid(table) {
  const rows = Number.isInteger(table?.rows) ? table.rows : 0;
  const cols = Number.isInteger(table?.cols) ? table.cols : 0;
  const grid = Array.from({ length: rows }, (_, r) => (
    Array.from({ length: cols }, (_, c) => ({ anchor: false, covered: false, cell: null, text: "", r, c }))
  ));
  for (const cell of table?.cells || []) {
    const rs = cell.rowSpan ?? 1;
    const cs = cell.colSpan ?? 1;
    for (let dr = 0; dr < rs; dr += 1) {
      for (let dc = 0; dc < cs; dc += 1) {
        const r = cell.r + dr;
        const c = cell.c + dc;
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        const covered = dr !== 0 || dc !== 0;
        grid[r][c] = {
          anchor: !covered,
          covered,
          cell,
          text: cell.text ?? "",
          r,
          c,
        };
      }
    }
  }
  return grid;
}

function freshId(used) {
  let n = 1;
  while (used.has(`d${n}`)) n += 1;
  const id = `d${n}`;
  used.add(id);
  return id;
}

// Replace base blocks whose bbox IoU with the requested table is ≥ 0.5.
// Incoming blocks (also IoU ≥ 0.5, same page) get fresh ids d1, d2, … and engine "docling".
// They take the place of the first removed id in `order`. The document engine becomes "mixed".
// bbox is [x0, y0, x1, y1] or { page, bbox }. Page-local boxes never match another page.
// When the scoped result has nothing overlapping, the base document is returned as-is.
export function mergeScoped(baseDoc, scopedPageResult, bbox) {
  const target = targetOf(bbox);
  const base = baseDoc && typeof baseDoc === "object" ? baseDoc : {};
  const baseBlocks = base.blocks && typeof base.blocks === "object" ? base.blocks : {};
  const baseOrder = Array.isArray(base.order) ? base.order : [];
  let page = target.page;
  if (page == null && target.bbox) {
    let best = 0;
    for (const block of Object.values(baseBlocks)) {
      const score = iou(block?.bbox, target.bbox);
      if (score > best) {
        best = score;
        page = block.page;
      }
    }
  }
  const scopedBlocks = scopedPageResult?.blocks && typeof scopedPageResult.blocks === "object"
    ? scopedPageResult.blocks
    : {};
  const scopedOrder = Array.isArray(scopedPageResult?.order) ? scopedPageResult.order : Object.keys(scopedBlocks);
  const incoming = [];
  for (const id of scopedOrder) {
    const block = scopedBlocks[id];
    if (!block || !samePage(block, page)) continue;
    if (target.bbox && iou(block.bbox, target.bbox) >= IOU_MIN) incoming.push(block);
  }
  if (!incoming.length || !target.bbox) return baseDoc;

  const drop = new Set();
  const consider = new Set([...baseOrder, ...Object.keys(baseBlocks)]);
  for (const id of consider) {
    const block = baseBlocks[id];
    if (!block || !samePage(block, page)) continue;
    if (iou(block.bbox, target.bbox) >= IOU_MIN) drop.add(id);
  }

  const used = new Set(Object.keys(baseBlocks).filter((id) => !drop.has(id)));
  const fresh = incoming.map((block) => {
    const id = freshId(used);
    return { ...block, id, engine: "docling" };
  });

  const order = [];
  let inserted = false;
  for (const id of baseOrder) {
    if (drop.has(id)) {
      if (!inserted) {
        for (const block of fresh) order.push(block.id);
        inserted = true;
      }
      continue;
    }
    order.push(id);
  }
  if (!inserted) {
    for (const block of fresh) order.push(block.id);
  }

  const blocks = {};
  for (const [id, block] of Object.entries(baseBlocks)) {
    if (!drop.has(id)) blocks[id] = block;
  }
  for (const block of fresh) blocks[block.id] = block;

  const grouped = [];
  const index = new Map();
  for (const id of order) {
    const engine = blocks[id]?.engine || base.engine || "builtin";
    if (!index.has(engine)) {
      const entry = { engine, ids: [] };
      if (engine === "docling") {
        entry.engineVersion = scopedPageResult?.engineVersion || null;
        entry.bbox = target.bbox;
        if (page != null) entry.page = page;
      } else if (base.engineVersion) {
        entry.engineVersion = base.engineVersion;
      }
      index.set(engine, entry);
      grouped.push(entry);
    }
    index.get(engine).ids.push(id);
  }

  return {
    ...base,
    schema: SCHEMA,
    engine: "mixed",
    sources: grouped,
    order,
    blocks,
  };
}

// A truth-file table (report.truth.json) as a pxd-parse table block.
export function tableFromTruth(truthTable, { id = "t1", page = 1, bbox = [72, 200, 540, 420] } = {}) {
  return {
    id,
    type: "table",
    page,
    bbox,
    rows: truthTable.rows,
    cols: truthTable.cols,
    headerRows: truthTable.headerRows ?? 0,
    headerCols: 0,
    cells: (truthTable.cells || []).map((cell) => ({
      r: cell.r,
      c: cell.c,
      rowSpan: cell.rowSpan ?? 1,
      colSpan: cell.colSpan ?? 1,
      text: cell.text ?? "",
      header: Boolean(cell.header),
    })),
    caption: truthTable.caption || null,
    method: "lattice",
    confidence: 1,
  };
}

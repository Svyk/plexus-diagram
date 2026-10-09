// LlamaParse v2 JSON (expand=items, optional grounded_pages) → pxd-parse/1.
// Synthetic fixtures are fine. No DOM, no fetch, no graph writes.

import { SCHEMA, validateParse } from "./parse-schema.js";

const ENGINE = "cloud";

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}

function oneBox(box) {
  if (!box || typeof box !== "object" || Array.isArray(box)) return null;
  const x = Number(box.x);
  const y = Number(box.y);
  const w = Number(box.w);
  const h = Number(box.h);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  return [x, y, x + Math.max(0, w), y + Math.max(0, h)];
}

export function llamaBox(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  const boxes = list.map(oneBox).filter(Boolean);
  if (!boxes.length) return null;
  let [x0, y0, x1, y1] = boxes[0];
  let confidence = null;
  for (const box of boxes) {
    x0 = Math.min(x0, box[0]);
    y0 = Math.min(y0, box[1]);
    x1 = Math.max(x1, box[2]);
    y1 = Math.max(y1, box[3]);
  }
  for (const raw of list) {
    const c = Number(raw?.confidence);
    if (Number.isFinite(c)) confidence = confidence == null ? c : Math.min(confidence, c);
  }
  return {
    bbox: [round(x0), round(y0), round(x1), round(y1)],
    confidence: confidence == null ? null : Math.max(0, Math.min(1, confidence)),
  };
}

function stripTags(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function plainItem(item) {
  if (!item || typeof item !== "object") return "";
  if (typeof item.value === "string" && item.value.trim()) return item.value.replace(/\s+/g, " ").trim();
  if (typeof item.text === "string" && item.text.trim()) return item.text.replace(/\s+/g, " ").trim();
  if (typeof item.md === "string") {
    return item.md.replace(/^#{1,6}\s+/, "").replace(/\s+/g, " ").trim();
  }
  return "";
}

function cellsFromHtml(html) {
  const source = String(html || "");
  if (!/<table\b/i.test(source)) return null;
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(source))) {
    const cells = [];
    const cellRe = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[2] || "";
      const colSpan = Math.max(1, Number(/colspan\s*=\s*["']?(\d+)/i.exec(attrs)?.[1] || 1));
      const rowSpan = Math.max(1, Number(/rowspan\s*=\s*["']?(\d+)/i.exec(attrs)?.[1] || 1));
      cells.push({
        header: cellMatch[1].toLowerCase() === "th",
        colSpan,
        rowSpan,
        text: stripTags(cellMatch[3]),
      });
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return null;
  const occupied = [];
  const placed = [];
  let cols = 0;
  const taken = (r, c) => occupied[r]?.[c];
  const mark = (r, c) => {
    if (!occupied[r]) occupied[r] = [];
    occupied[r][c] = true;
  };
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of row) {
      while (taken(r, c)) c += 1;
      placed.push({ r, c, rowSpan: cell.rowSpan, colSpan: cell.colSpan, text: cell.text, header: cell.header });
      for (let dr = 0; dr < cell.rowSpan; dr += 1) {
        for (let dc = 0; dc < cell.colSpan; dc += 1) mark(r + dr, c + dc);
      }
      cols = Math.max(cols, c + cell.colSpan);
      c += cell.colSpan;
    }
  });
  const headerRows = rows[0]?.every((cell) => cell.header) ? 1 : 0;
  return { rows: rows.length, cols, headerRows, cells: placed };
}

function cellsFromRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const width = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  if (!width) return null;
  const cells = [];
  rows.forEach((row, r) => {
    const values = Array.isArray(row) ? row : [];
    for (let c = 0; c < width; c += 1) {
      const value = values[c];
      cells.push({
        r,
        c,
        rowSpan: 1,
        colSpan: 1,
        text: value == null ? "" : String(value),
        header: false,
      });
    }
  });
  return { rows: rows.length, cols: width, headerRows: 0, cells };
}

function applyGrounding(table, grounding) {
  const matrix = grounding?.rows;
  if (!Array.isArray(matrix)) return;
  for (const cell of table.cells) {
    const slot = matrix[cell.r]?.[cell.c];
    const box = llamaBox(slot?.bbox);
    if (box) cell.bbox = box.bbox;
  }
}

function flattenList(items, level, out) {
  for (const item of items || []) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "list") flattenList(item.items, level + 1, out);
    else out.push({ text: plainItem(item), level, marker: "" });
  }
}

function groundedTables(pageNumber, pages) {
  const page = (pages || []).find((entry) => entry && entry.page_number === pageNumber && entry.success !== false);
  return (page?.items || []).filter((item) => item?.type === "table");
}

export function llamaparseToParse(provider, { sha256 = null, tier = "agentic", region = "us" } = {}) {
  const pagesIn = provider?.items?.pages || [];
  const grounded = provider?.grounded_pages || [];
  const blocks = {};
  const order = [];
  const removed = [];
  const pages = [];
  let n = 0;
  const nextId = (prefix) => {
    n += 1;
    return `${prefix}${n}`;
  };
  let title = null;

  const push = (block) => {
    blocks[block.id] = block;
    order.push(block.id);
    return block;
  };

  const walk = (item, pageNumber, fallback) => {
    if (!item || typeof item !== "object") return;
    const type = item.type;
    if (type === "header" || type === "footer") {
      const box = llamaBox(item.bbox);
      removed.push({
        reason: type === "header" ? "running-header" : "running-footer",
        page: pageNumber,
        text: plainItem(item) || (item.items || []).map(plainItem).filter(Boolean).join(" "),
        bbox: box?.bbox || null,
      });
      return;
    }
    const box = llamaBox(item.bbox) || (fallback ? { bbox: fallback, confidence: null } : null);
    const confidence = box?.confidence == null ? 0.9 : box.confidence;
    const bbox = box?.bbox || [0, 0, 0, 0];
    if (type === "heading") {
      const level = Math.min(6, Math.max(1, Math.floor(Number(item.level) || 1)));
      const text = plainItem(item);
      const block = push({
        id: nextId("h"), type: "heading", level, text, page: pageNumber, bbox, confidence, engine: ENGINE,
      });
      if (!title && level === 1 && pageNumber === 1 && text) title = text;
      return block;
    }
    if (type === "list") {
      const items = [];
      flattenList(item.items, 0, items);
      return push({
        id: nextId("l"),
        type: "list",
        ordered: Boolean(item.ordered),
        items,
        text: items.map((entry) => entry.text).filter(Boolean).join(" "),
        page: pageNumber,
        bbox,
        confidence,
        engine: ENGINE,
      });
    }
    if (type === "table") {
      const parsed = cellsFromHtml(item.html) || cellsFromRows(item.rows);
      if (!parsed) return null;
      const id = nextId("t");
      const block = {
        id,
        type: "table",
        page: pageNumber,
        bbox,
        rows: parsed.rows,
        cols: parsed.cols,
        headerRows: parsed.headerRows,
        headerCols: 0,
        cells: parsed.cells,
        caption: null,
        method: "llamaparse",
        confidence,
        engine: ENGINE,
      };
      push(block);
      return block;
    }
    if (type === "image") {
      const id = nextId("f");
      const captionText = typeof item.caption === "string" ? item.caption.replace(/\s+/g, " ").trim() : "";
      let captionId = null;
      const block = push({
        id,
        type: "figure",
        page: pageNumber,
        bbox,
        caption: null,
        image: { kind: "crop", source: "llamaparse" },
        confidence,
        engine: ENGINE,
      });
      if (captionText) {
        captionId = nextId("c");
        push({
          id: captionId,
          type: "caption",
          page: pageNumber,
          bbox,
          text: captionText,
          for: id,
          confidence,
          engine: ENGINE,
        });
        block.caption = captionId;
      }
      return block;
    }
    if (type === "code") {
      return push({
        id: nextId("k"),
        type: "code",
        text: typeof item.value === "string" ? item.value : plainItem(item),
        page: pageNumber,
        bbox,
        confidence,
        engine: ENGINE,
      });
    }
    const text = plainItem(item);
    if (!text && type !== "text" && type !== "link") return null;
    return push({
      id: nextId("p"),
      type: "para",
      text,
      page: pageNumber,
      bbox,
      confidence,
      engine: ENGINE,
    });
  };

  for (const page of pagesIn) {
    const pageNumber = Number(page?.page_number);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) continue;
    const width = Number(page.page_width);
    const height = Number(page.page_height);
    const ok = page.success !== false;
    pages.push({
      n: pageNumber,
      w: Number.isFinite(width) ? round(width) : null,
      h: Number.isFinite(height) ? round(height) : null,
      parsed: ok,
    });
    if (!ok || !Array.isArray(page.items)) continue;
    const tables = [];
    for (const item of page.items) {
      const block = walk(item, pageNumber);
      if (block?.type === "table") tables.push(block);
    }
    const groundedRows = groundedTables(pageNumber, grounded);
    tables.forEach((block, index) => applyGrounding(block, groundedRows[index]?.grounding));
  }

  const doc = {
    schema: SCHEMA,
    sha256,
    engine: ENGINE,
    engineVersion: `llamaparse/${tier}`,
    options: {
      provider: "llamaparse",
      tier,
      region: region === "eu" ? "eu" : "us",
      ocr: "none",
      formula: false,
      tables: "llamaparse",
    },
    createdAt: null,
    pageCount: pages.length,
    title,
    pages,
    order,
    blocks,
    removed,
    stats: { ms: 0, perPage: [] },
  };
  const check = validateParse(doc);
  if (!check.ok) {
    const error = new Error(`cloud parse schema: ${check.errors.join(",")}`);
    error.code = "schema";
    error.errors = check.errors;
    throw error;
  }
  return doc;
}

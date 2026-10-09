// LlamaParse v2 JSON (expand=items,markdown,usage,images_content_metadata,
// optional grounded_pages) → pxd-parse/1. A layout image becomes a figure.
// Synthetic fixtures are fine. No DOM, no fetch, no graph writes.

import { parseMarkdownBlocks } from "./anydoc-to-parse.js";
import { SCHEMA, iou, validateParse } from "./parse-schema.js";

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
  return fitCells({ rows: rows.length, cols, headerRows, cells: placed });
}

// A rowspan past the last <tr> (or a cell origin past the grid) used to fail
// validateParse as cell-range. Keep the cell, grow the grid to its origin, and
// clamp the span so it stays inside. A later cell that still overlaps is dropped.
function fitCells(parsed) {
  if (!parsed) return null;
  let rows = parsed.rows;
  let cols = parsed.cols;
  if (!Number.isInteger(rows) || rows < 0 || !Number.isInteger(cols) || cols < 0) return null;
  const incoming = [];
  for (const cell of parsed.cells || []) {
    const r = cell?.r;
    const c = cell?.c;
    let rowSpan = cell?.rowSpan ?? 1;
    let colSpan = cell?.colSpan ?? 1;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0) continue;
    if (!Number.isInteger(rowSpan) || rowSpan < 1) rowSpan = 1;
    if (!Number.isInteger(colSpan) || colSpan < 1) colSpan = 1;
    rows = Math.max(rows, r + 1);
    cols = Math.max(cols, c + 1);
    incoming.push({ ...cell, r, c, rowSpan, colSpan });
  }
  if (!rows || !cols || !incoming.length) return null;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(false));
  const hits = (r, c, rowSpan, colSpan) => {
    for (let dr = 0; dr < rowSpan; dr += 1) {
      for (let dc = 0; dc < colSpan; dc += 1) {
        if (grid[r + dr][c + dc]) return true;
      }
    }
    return false;
  };
  const cells = [];
  for (const cell of incoming) {
    let rowSpan = Math.min(cell.rowSpan, rows - cell.r);
    let colSpan = Math.min(cell.colSpan, cols - cell.c);
    while ((rowSpan > 1 || colSpan > 1) && hits(cell.r, cell.c, rowSpan, colSpan)) {
      if (rowSpan > 1) rowSpan -= 1;
      else colSpan -= 1;
    }
    if (rowSpan < 1 || colSpan < 1 || hits(cell.r, cell.c, rowSpan, colSpan)) continue;
    for (let dr = 0; dr < rowSpan; dr += 1) {
      for (let dc = 0; dc < colSpan; dc += 1) grid[cell.r + dr][cell.c + dc] = true;
    }
    cells.push({ ...cell, rowSpan, colSpan });
  }
  if (!cells.length) return null;
  return { ...parsed, rows, cols, cells };
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
  return fitCells({ rows: rows.length, cols: width, headerRows: 0, cells });
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

const FIG_RE = /^(?:fig(?:ure)?)\.?\s*\d+\b/i;

function boxLabel(item) {
  const list = Array.isArray(item?.bbox) ? item.bbox : (item?.bbox && typeof item.bbox === "object" ? [item.bbox] : []);
  for (const raw of list) {
    if (raw && typeof raw.label === "string" && raw.label.trim()) return raw.label.trim().toLowerCase();
  }
  return "";
}

function isCaptionItem(item) {
  if (!item || typeof item !== "object") return false;
  if (item.type === "header" || item.type === "footer") return false;
  const label = boxLabel(item);
  if (label === "header" || label === "footer") return false;
  if (label === "caption") return true;
  return FIG_RE.test(plainItem(item));
}

function layoutImagesOf(provider) {
  const images = provider?.images_content_metadata?.images;
  if (!Array.isArray(images)) return [];
  return images.filter((image) => {
    if (!image || typeof image !== "object") return false;
    if (image.category != null && image.category !== "layout") return false;
    return Boolean(llamaBox(image.bbox));
  });
}

function pageNumbersOf(pages) {
  return (pages || [])
    .map((page) => Number(page?.page_number))
    .filter((n) => Number.isInteger(n) && n >= 1);
}

// `page_N` in a layout filename. N is the absolute PDF page when it matches a
// returned page_number and is not also a 1-based index into this result.
// N is the Nth returned page when it is only an index (a one-page job for PDF
// page 10 comes back as page_number 10 with filename page_1). When both
// readings name a returned page, N is the absolute page_number.
export function layoutImagePage(filename, pageNumbers) {
  const nums = (pageNumbers || []).map(Number).filter((n) => Number.isInteger(n) && n >= 1);
  if (!nums.length) return null;
  const match = /(?:^|[^\d])page_(\d+)(?=[^\d]|$)/i.exec(String(filename || ""));
  const n = match ? Number(match[1]) : null;
  if (n == null) return nums.length === 1 ? nums[0] : null;
  const absolute = nums.includes(n);
  const relative = n >= 1 && n <= nums.length;
  if (absolute && !relative) return n;
  if (relative && !absolute) return nums[n - 1];
  if (absolute && relative) return n;
  return nums.length === 1 ? nums[0] : null;
}

function verticalGap(fig, cand) {
  const slack = 12;
  const below = cand[1] - fig[3];
  const above = fig[1] - cand[3];
  const belowOk = below >= -slack;
  const aboveOk = above >= -slack;
  if (belowOk && (!aboveOk || below <= above)) return { dir: "below", gap: Math.max(0, below) };
  if (aboveOk) return { dir: "above", gap: Math.max(0, above) };
  return null;
}

function assignCaptions(images, items) {
  const pairs = new Map();
  const used = new Set();
  const sorted = images.slice().sort((a, b) => (llamaBox(a.bbox)?.bbox[1] || 0) - (llamaBox(b.bbox)?.bbox[1] || 0));
  for (const image of sorted) {
    const fig = llamaBox(image.bbox)?.bbox;
    if (!fig) continue;
    let best = null;
    let bestScore = Infinity;
    for (const item of items) {
      if (used.has(item)) continue;
      const cand = llamaBox(item.bbox)?.bbox;
      if (!cand) continue;
      const gap = verticalGap(fig, cand);
      if (!gap) continue;
      const overlapX = cand[2] > fig[0] && cand[0] < fig[2];
      const score = gap.gap + (gap.dir === "below" ? 0 : 0.5) + (overlapX ? 0 : 400);
      if (score < bestScore) {
        bestScore = score;
        best = item;
      }
    }
    if (best) {
      used.add(best);
      pairs.set(best, image);
    }
  }
  return pairs;
}

function emptyBox(box) {
  return !box || box[2] - box[0] <= 0 || box[3] - box[1] <= 0;
}

function chartTable(item, block, images) {
  if (!images.length) return false;
  if (!emptyBox(block.bbox)) {
    for (const image of images) {
      const other = llamaBox(image.bbox)?.bbox;
      if (other && iou(block.bbox, other) >= 0.15) return true;
    }
  }
  return Boolean(item?.parse_concerns) && /chart/i.test(JSON.stringify(item.parse_concerns));
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
  const layoutImages = layoutImagesOf(provider);
  const pageNums = pageNumbersOf(pagesIn);
  let pageLayout = [];

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
      const covered = pageLayout.some((image) => {
        const other = llamaBox(image.bbox)?.bbox;
        return other && iou(bbox, other) >= 0.5;
      });
      if (covered) return null;
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
    pageLayout = layoutImages.filter((image) => layoutImagePage(image.filename, pageNums) === pageNumber);
    const assigned = assignCaptions(pageLayout, page.items.filter(isCaptionItem));
    const paired = new Set(assigned.values());
    const emitLayout = (image, captionItem) => {
      const box = llamaBox(image?.bbox);
      if (!box) return;
      const id = nextId("f");
      const block = push({
        id,
        type: "figure",
        page: pageNumber,
        bbox: box.bbox,
        caption: null,
        image: { kind: "crop", source: "llamaparse" },
        confidence: box.confidence == null ? 0.9 : box.confidence,
        engine: ENGINE,
      });
      const text = captionItem ? plainItem(captionItem) : "";
      if (!text) return;
      const capBox = llamaBox(captionItem.bbox);
      const captionId = nextId("c");
      push({
        id: captionId,
        type: "caption",
        page: pageNumber,
        bbox: capBox?.bbox || box.bbox,
        text,
        for: id,
        confidence: capBox?.confidence == null ? block.confidence : capBox.confidence,
        engine: ENGINE,
      });
      block.caption = captionId;
    };
    const tables = [];
    for (const item of page.items) {
      const image = assigned.get(item);
      if (image) {
        emitLayout(image, item);
        continue;
      }
      const block = walk(item, pageNumber);
      if (block?.type === "table") tables.push({ block, item });
    }
    for (const image of pageLayout) {
      if (!paired.has(image)) emitLayout(image, null);
    }
    const groundedRows = groundedTables(pageNumber, grounded);
    tables.forEach(({ block }, index) => applyGrounding(block, groundedRows[index]?.grounding));
    for (const { block, item } of tables) {
      if (chartTable(item, block, pageLayout)) block.fromChart = true;
    }
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

const MISTRAL_KIND = Object.freeze({
  title: "heading",
  text: "para",
  list: "list",
  table: "table",
  image: "figure",
  equation: "formula",
  code: "code",
  references: "para",
  aside_text: "para",
  signature: "para",
  caption: "caption",
});

function cornerBox(raw) {
  if (!raw || typeof raw !== "object") return null;
  const x0 = Number(raw.top_left_x);
  const y0 = Number(raw.top_left_y);
  const x1 = Number(raw.bottom_right_x);
  const y1 = Number(raw.bottom_right_y);
  if (![x0, y0, x1, y1].every((n) => Number.isFinite(n))) return null;
  return [round(Math.min(x0, x1)), round(Math.min(y0, y1)), round(Math.max(x0, x1)), round(Math.max(y0, y1))];
}

function blockConfidence(raw) {
  const score = Number(raw?.confidence_scores?.average_content_confidence_score);
  if (!Number.isFinite(score)) return null;
  return Math.max(0, Math.min(1, score));
}

function imageLine(line) {
  const match = /^\s*!\[[^\]]*\]\(([^)\s]+)\)\s*$/.exec(line || "");
  return match ? { id: match[1] } : null;
}

function tablePlaceholder(line) {
  const match = /^\s*\[(tbl-[^\]\s]+)\]\(\1\)\s*$/.exec(line || "");
  return match ? { id: match[1] } : null;
}

function plainLine(line) {
  const text = String(line || "");
  if (!text.trim()) return false;
  if (imageLine(text) || tablePlaceholder(text)) return false;
  if (/^(#{1,6})\s+/.test(text) || /^(\s*)([-*+]|\d+\.)\s+\S/.test(text)) return false;
  if (/<table\b/i.test(text) || text.includes("|")) return false;
  return true;
}

function neighborBelow(lines, index) {
  let i = index + 1;
  while (i < lines.length && !lines[i].trim()) i += 1;
  return plainLine(lines[i]) ? i : -1;
}

function captionAbove(lines, index) {
  let i = index - 1;
  while (i >= 0 && !lines[i].trim()) i -= 1;
  if (i < 0 || !plainLine(lines[i])) return -1;
  return /^(figure|fig\.|caption|table)\b/i.test(lines[i].trim()) ? i : -1;
}

function byId(list, id) {
  const want = String(id || "");
  return (list || []).find((entry) => entry && (entry.id === want || entry.id === want.split("/").pop()));
}

function tableFromContent(content) {
  const source = String(content || "");
  if (!source.trim()) return null;
  const html = cellsFromHtml(source);
  if (html) return html;
  const table = parseMarkdownBlocks(source).find((block) => block.type === "table");
  if (!table) return null;
  return { rows: table.rows, cols: table.cols, headerRows: table.headerRows, cells: table.cells };
}

function splitHtml(text) {
  const parts = [];
  const re = /<table\b[\s\S]*?<\/table>/gi;
  let last = 0;
  let match;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push({ kind: "md", text: text.slice(last, match.index) });
    parts.push({ kind: "html", html: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "md", text: text.slice(last) });
  if (!parts.length) parts.push({ kind: "md", text });
  return parts;
}

function markdownNodes(text) {
  const nodes = [];
  for (const part of splitHtml(text)) {
    if (part.kind === "html") {
      const parsed = cellsFromHtml(part.html);
      if (parsed) nodes.push({ type: "table", ...parsed });
      continue;
    }
    for (const block of parseMarkdownBlocks(part.text)) nodes.push(block);
  }
  return nodes;
}

function pageNodes(page) {
  const lines = String(page?.markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const consumed = new Set();
  const captions = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    if (!imageLine(lines[i])) continue;
    const below = neighborBelow(lines, i);
    const above = below < 0 ? captionAbove(lines, i) : -1;
    const at = below >= 0 ? below : above;
    if (at >= 0) {
      consumed.add(at);
      captions.set(i, lines[at].replace(/\s+/g, " ").trim());
    }
  }
  const nodes = [];
  let buf = [];
  const flush = () => {
    const text = buf.join("\n");
    buf = [];
    if (text.trim()) nodes.push(...markdownNodes(text));
  };
  for (let i = 0; i < lines.length; i += 1) {
    if (consumed.has(i)) continue;
    const image = imageLine(lines[i]);
    if (image) {
      flush();
      const found = byId(page?.images, image.id);
      nodes.push({ type: "figure", bbox: cornerBox(found), caption: captions.get(i) || "" });
      continue;
    }
    const placeholder = tablePlaceholder(lines[i]);
    if (placeholder) {
      flush();
      const entry = byId(page?.tables, placeholder.id);
      const parsed = tableFromContent(entry?.content || entry?.html || entry?.markdown || "");
      if (parsed) nodes.push({ type: "table", ...parsed });
      continue;
    }
    buf.push(lines[i]);
  }
  flush();
  const queues = new Map();
  for (const block of page?.blocks || []) {
    const kind = MISTRAL_KIND[block?.type];
    if (!kind) continue;
    if (!queues.has(kind)) queues.set(kind, []);
    queues.get(kind).push(block);
  }
  for (const node of nodes) {
    const src = queues.get(node.type)?.shift();
    if (!src) continue;
    if (!node.bbox) node.bbox = cornerBox(src);
    const score = blockConfidence(src);
    if (score != null) node.confidence = score;
  }
  return nodes;
}

function pageIndexBase(pages) {
  return (pages || []).some((page) => Number(page?.index) === 0) ? 0 : 1;
}

function furniture(page, blocks) {
  const fromBlocks = (type) => (blocks || [])
    .filter((block) => block?.type === type)
    .map((block) => String(block.content || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  const header = String(page?.header || "").replace(/\s+/g, " ").trim() || fromBlocks("header");
  const footer = String(page?.footer || "").replace(/\s+/g, " ").trim() || fromBlocks("footer");
  return { header, footer };
}

// Mistral OCR JSON → pxd-parse/1. Markdown is the reading order. Image boxes come
// from images[]. Block boxes fill headings and tables when include_blocks is set.
// HTML tables keep colspan and rowspan. A caption is the plain line under the
// image, or a Figure/Caption/Table line above it.
export function mistralToParse(provider, { sha256 = null } = {}) {
  const pagesIn = Array.isArray(provider?.pages) ? provider.pages : [];
  const zeroBased = pageIndexBase(pagesIn) === 0;
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
  const model = typeof provider?.model === "string" && provider.model ? provider.model : "mistral-ocr-latest";

  const push = (block) => {
    blocks[block.id] = block;
    order.push(block.id);
    return block;
  };

  pagesIn.forEach((page, position) => {
    const index = Number(page?.index);
    const pageNumber = Number.isInteger(index) && index >= 0
      ? (zeroBased ? index + 1 : index)
      : position + 1;
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return;
    const width = Number(page?.dimensions?.width);
    const height = Number(page?.dimensions?.height);
    pages.push({
      n: pageNumber,
      w: Number.isFinite(width) ? round(width) : null,
      h: Number.isFinite(height) ? round(height) : null,
      parsed: page?.error == null,
    });
    if (page?.error != null) return;
    const side = furniture(page, page?.blocks);
    if (side.header) removed.push({ reason: "running-header", page: pageNumber, text: side.header, bbox: null });
    if (side.footer) removed.push({ reason: "running-footer", page: pageNumber, text: side.footer, bbox: null });
    for (const node of pageNodes(page)) {
      const confidence = node.confidence == null ? 0.9 : node.confidence;
      const bbox = node.bbox || [0, 0, 0, 0];
      if (node.type === "heading") {
        const level = Math.min(6, Math.max(1, Math.floor(Number(node.level) || 1)));
        const text = String(node.text || "").replace(/\s+/g, " ").trim();
        push({ id: nextId("h"), type: "heading", level, text, page: pageNumber, bbox, confidence, engine: ENGINE });
        if (!title && level === 1 && pageNumber === 1 && text) title = text;
        continue;
      }
      if (node.type === "list") {
        const items = (node.items || []).map((item) => ({
          text: String(item?.text || "").replace(/\s+/g, " ").trim(),
          level: Math.max(0, Math.floor(Number(item?.level) || 0)),
          marker: String(item?.marker || ""),
        }));
        push({
          id: nextId("l"),
          type: "list",
          ordered: Boolean(node.ordered),
          items,
          text: items.map((item) => item.text).filter(Boolean).join(" "),
          page: pageNumber,
          bbox,
          confidence,
          engine: ENGINE,
        });
        continue;
      }
      if (node.type === "table" && node.rows && node.cols) {
        push({
          id: nextId("t"),
          type: "table",
          page: pageNumber,
          bbox,
          rows: node.rows,
          cols: node.cols,
          headerRows: node.headerRows || 0,
          headerCols: 0,
          cells: node.cells || [],
          caption: null,
          method: "mistral",
          confidence,
          engine: ENGINE,
        });
        continue;
      }
      if (node.type === "figure") {
        const id = nextId("f");
        const block = push({
          id,
          type: "figure",
          page: pageNumber,
          bbox,
          caption: null,
          image: { kind: "crop", source: "mistral" },
          confidence,
          engine: ENGINE,
        });
        const captionText = String(node.caption || "").replace(/\s+/g, " ").trim();
        if (captionText) {
          const captionId = nextId("c");
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
        continue;
      }
      if (node.type === "code") {
        push({
          id: nextId("k"),
          type: "code",
          text: typeof node.text === "string" ? node.text : "",
          page: pageNumber,
          bbox,
          confidence,
          engine: ENGINE,
        });
        continue;
      }
      if (node.type === "formula") {
        const latex = String(node.latex || node.text || "").trim();
        if (!latex) continue;
        push({
          id: nextId("q"),
          type: "formula",
          latex,
          text: latex,
          page: pageNumber,
          bbox,
          confidence,
          engine: ENGINE,
        });
        continue;
      }
      const text = String(node.text || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      push({
        id: nextId("p"),
        type: "para",
        text,
        page: pageNumber,
        bbox,
        confidence,
        engine: ENGINE,
      });
    }
  });

  const doc = {
    schema: SCHEMA,
    sha256,
    engine: ENGINE,
    engineVersion: model,
    options: {
      provider: "mistral",
      model,
      ocr: "none",
      formula: false,
      tables: "mistral",
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
    const error = new Error(`mistral parse schema: ${check.errors.join(",")}`);
    error.code = "schema";
    error.errors = check.errors;
    throw error;
  }
  return doc;
}

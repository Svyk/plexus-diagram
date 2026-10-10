// A table of contents read as one table: entries on the left, page numbers at
// one right edge. The stream detector assembles it in pieces when an entry wraps
// onto two lines, when OCR reads a page number as "I5", or when two lines ran
// together. Once a page holds one contents-shaped piece, the text rows around
// it that read as entries, wrapped titles, or page numbers join the same table
// and the rows are built again from scratch: a row that ends in a page number
// is an entry, the rows before it with no page number are the first lines of
// that entry, and "Page." above the first entry is the header.

import { baselineRows, tokenizeLine } from "./stream.js";

const PAGE_RE = /^\d{1,4}(?:\s*[-–]\s*(?:\d{1,4}|[a-z]))?$/;

// A page number, a range ("25-27"), or a lettered page ("48-a"), allowing the
// OCR confusions of a small numeral: I, l and | for 1, O for 0. At least one
// true digit must be there, so "II." (a roman numeral in a title) is not a page.
export function pageToken(text) {
  const raw = String(text || "").trim().replace(/^[.·…\s]+|[.·…\s]+$/g, "");
  if (!raw || raw.length > 7 || !/\d/.test(raw)) return null;
  const fixed = raw.replace(/[Il|]/g, "1").replace(/[Oo]/g, "0");
  return PAGE_RE.test(fixed) ? fixed : null;
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

// The table the stream detector built from part of a contents list: two
// columns, page numbers on the right. One page number is enough for a seed;
// the rebuilt list must still hold three entries.
export function contentsShaped(table, { maxCols = 2 } = {}) {
  if (!table || table.method !== "stream" || !(table.cols >= 2) || table.cols > maxCols || !(table.rows >= 2)) return false;
  const right = (table.cells || []).filter((c) => c.c === table.cols - 1 && String(c.text || "").trim());
  if (!right.length) return false;
  return right.filter((c) => pageToken(c.text)).length >= Math.max(1, 0.5 * right.length);
}

// "CONTENTS.", "LIST OF CHARTS.": a heading over the list. A lone "TABLE" is the
// first word of an entry that OCR cut from its number.
function capsHead(text) {
  const t = String(text || "").trim();
  return /^[A-Z][A-Z .,'’-]{1,40}$/.test(t) && wordCount(t) <= 4 && (wordCount(t) >= 2 || /\.$/.test(t));
}

const HEAD_RE = /^page\.?$/i;

function groupHead(text) {
  return /:$/.test(String(text || "").trim()) && wordCount(text) <= 6;
}

function overlapX(a, b) {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
}

function boxOf(block) {
  const b = block.bbox;
  return Array.isArray(b) ? { x0: b[0], y0: b[1], x1: b[2], y1: b[3] } : b;
}

// What one baseline row is, given where the page column sits.
// entry: label then a page number; num: a page number alone; head: "Page.";
// stop: a capitalised heading or a sentence; title: words (a wrapped entry
// line); junk: a one- or two-word fragment OCR left on its own line.
function classify(row, pageX) {
  const tokens = row.lines.flatMap((l) => tokenizeLine(l)).sort((a, b) => a.x0 - b.x0);
  if (!tokens.length) return { kind: "junk", tokens };
  const text = tokens.map((t) => t.text).join(" ").trim();
  // "Page." alone, or beside the list's heading and a folio ("CONTENTS. 7 Page.").
  if (HEAD_RE.test(text)) return { kind: "head", tokens };
  // "Page." beside the heading and a folio ("CONTENTS. 7 Page."), or beside the
  // first group head ("United States: Page."): the header row, and the group
  // head is the row under it.
  const headAt = tokens.findIndex((t) => HEAD_RE.test(String(t.text).trim()));
  if (headAt >= 0) {
    const rest = tokens.filter((_, i) => i !== headAt);
    const restText = rest.map((t) => t.text).join(" ").trim();
    if (rest.every((t) => capsHead(t.text) || /^\d{1,4}$/.test(String(t.text).trim()))) return { kind: "head", tokens };
    if (groupHead(restText)) return { kind: "head", tokens, group: restText };
  }
  if (capsHead(text) && !/\d/.test(text)) return { kind: "stop", tokens };
  const last = tokens[tokens.length - 1];
  const atPageColumn = Number.isFinite(pageX) && last.x0 >= pageX - 12;
  const lastText = String(last.text).trim();
  // At the page column, a short token with a digit in it is the page number however OCR spelt it ("3б").
  const lastPage = pageToken(lastText) || (atPageColumn && lastText.length <= 5 && wordCount(lastText) === 1 && (/\d/.test(lastText) || /^[—–-]+$/.test(lastText)) ? lastText : null);
  if (lastPage && tokens.length === 1) return { kind: "num", tokens, page: lastPage };
  if (lastPage && last.x0 - tokens[tokens.length - 2].x1 >= 8) return { kind: "entry", tokens, page: lastPage };
  if (wordCount(text) >= 12 && /[.?!]$/.test(text) && !/\d\s*$/.test(text)) return { kind: "stop", tokens };
  if (groupHead(text)) return { kind: "group", tokens };
  if (wordCount(text) >= 3) return { kind: "title", tokens };
  return { kind: "junk", tokens };
}

// Rows to keep, walking out from the seed rows. A title or junk row is kept
// only when an entry (or a lone page number) follows within three rows; the
// list ends at a heading, a sentence, or a gap of three lines.
function selectRows(rows, seedIndexes, size) {
  const keep = new Set(seedIndexes);
  const lo = Math.min(...seedIndexes);
  const hi = Math.max(...seedIndexes);
  const gapBetween = (a, b) => (a < b ? rows[b].row.y0 - rows[a].row.y1 : rows[a].row.y0 - rows[b].row.y1);
  const walk = (start, step) => {
    let last = start;
    let i = start + step;
    let headSeen = false;
    while (i >= 0 && i < rows.length) {
      const r = rows[i];
      if (gapBetween(last, i) > 3 * size) return;
      if (r.kind === "stop") return;
      if (r.kind === "head") {
        if (step < 0 && !headSeen) { keep.add(i); headSeen = true; last = i; i += step; continue; }
        return;
      }
      if (r.kind === "entry" || r.kind === "num") { keep.add(i); last = i; i += step; continue; }
      // title / junk: look ahead for the entry it belongs to.
      let j = i + step;
      let prev = i;
      let found = false;
      let steps = 0;
      while (j >= 0 && j < rows.length && steps < 3) {
        const q = rows[j];
        if (gapBetween(prev, j) > 3 * size || q.kind === "stop") break;
        // Upward, the "Page." header closes the list: the title under it is the first entry's first line.
        if (q.kind === "head") { found = step < 0; break; }
        if (q.kind === "entry" || q.kind === "num") { found = true; break; }
        prev = j;
        j += step;
        steps += 1;
      }
      // Below the last entry, a hanging title line still belongs to it.
      const hangs = step > 0 && r.kind === "title" && !found;
      if (!found && !hangs) return;
      keep.add(i);
      last = i;
      i += step;
      if (hangs) return;
    }
  };
  walk(lo, -1);
  walk(hi, 1);
  return keep;
}

function buildEntries(rows) {
  const out = [];
  let pending = [];
  let pendingRows = [];
  const flush = (label, page, row) => {
    const all = [...pendingRows, row];
    out.push({
      label: [...pending, label].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
      page,
      y0: Math.min(...all.map((r) => r.y0)),
      y1: Math.max(...all.map((r) => r.y1)),
    });
    pending = [];
    pendingRows = [];
  };
  for (const r of rows) {
    const { row, tokens } = r;
    if (r.kind === "head") {
      if (!out.length && !pending.length) out.push({ label: "", page: "Page.", header: true, y0: row.y0, y1: row.y1 });
      if (r.group) out.push({ label: r.group, page: "", y0: row.y0, y1: row.y1 });
      continue;
    }
    if (r.kind === "group") {
      if (pending.length) { out.push({ label: pending.join(" "), page: "", y0: Math.min(...pendingRows.map((q) => q.y0)), y1: Math.max(...pendingRows.map((q) => q.y1)) }); pending = []; pendingRows = []; }
      out.push({ label: tokens.map((t) => t.text).join(" ").trim(), page: "", y0: row.y0, y1: row.y1 });
      continue;
    }
    if (r.kind === "num") {
      if (pending.length) flush("", r.page, row);
      continue;
    }
    if (r.kind === "entry") {
      const label = tokens.slice(0, -1).map((t) => t.text).join(" ");
      // The list's own heading beside the folio ("CONTENTS. 7") is not an entry.
      if (!out.length && !pending.length && capsHead(label)) continue;
      flush(label, r.page, row);
      continue;
    }
    pending.push(tokens.map((t) => t.text).join(" "));
    pendingRows.push(row);
  }
  if (pending.length && out.length) {
    const last = out[out.length - 1];
    if (!last.header) {
      last.label = `${last.label} ${pending.join(" ")}`.replace(/\s+/g, " ").trim();
      last.y1 = Math.max(last.y1, ...pendingRows.map((r) => r.y1));
    }
  }
  return out;
}

// Rebuild every contents-shaped stream table on a page from its own lines and
// the list rows around it. Absorbed text blocks are removed from `textBlocks`;
// absorbed tables are removed from `tables`.
export function growContentsTables(tables, textBlocks, bodySize) {
  const size = bodySize || 10;
  const used = new Set();
  const debug = typeof process !== "undefined" && process.env?.PXD_STREAM_DEBUG;
  const seeds = (tables || []).filter((t) => contentsShaped(t) && Array.isArray(t.sourceLines));
  for (const seed of seeds) {
    if (used.has(seed)) continue;
    const col = { x0: seed.bbox[0], x1: seed.bbox[2] };
    const near = (box) => box && overlapX(col, box) >= 0.5 * Math.min(col.x1 - col.x0, box.x1 - box.x0);
    const blocks = (textBlocks || []).filter((b) => !used.has(b) && ["para", "caption", "heading"].includes(b.type) && b.lines?.length && near(boxOf(b)));
    // A numbered entry ("5. Base periods … 36-44") can come out as three columns.
    const others = (tables || []).filter((t) => t !== seed && !used.has(t) && contentsShaped(t, { maxCols: 3 }) && Array.isArray(t.sourceLines) && near({ x0: t.bbox[0], x1: t.bbox[2] }));
    const owner = new Map();
    for (const b of blocks) for (const l of b.lines) owner.set(l, b);
    for (const t of others) for (const l of t.sourceLines) owner.set(l, t);
    const lines = [...seed.sourceLines, ...blocks.flatMap((b) => b.lines), ...others.flatMap((t) => t.sourceLines)];
    const pageCells = (seed.cells || []).filter((c) => c.c === 1 && pageToken(c.text) && c.bbox);
    const pageX = pageCells.length ? Math.min(...pageCells.map((c) => c.wbox?.[0] ?? c.bbox[0])) : NaN;
    const rows = rowsFrom(lines, pageX);
    const seedSet = new Set(seed.sourceLines);
    const seedIndexes = rows.map((r, i) => (r.row.lines.some((l) => seedSet.has(l)) ? i : -1)).filter((i) => i >= 0);
    if (!seedIndexes.length) continue;
    const keep = selectRows(rows, seedIndexes, size);
    // A block only partly inside the list stays as it is, with all its lines.
    const kept = rows.filter((_, i) => keep.has(i));
    const touched = new Map();
    for (const r of kept) for (const l of r.row.lines) { const o = owner.get(l); if (o) touched.set(o, (touched.get(o) || 0) + 1); }
    const partial = new Set();
    for (const [o, n] of touched) {
      const total = o.lines ? o.lines.length : o.sourceLines.length;
      if (n < total) partial.add(o);
    }
    const chosen = kept.filter((r) => !r.row.lines.some((l) => partial.has(owner.get(l))));
    if (debug) {
      process.stderr.write(`contents seed ${seed.rows}x${seed.cols} y ${Math.round(seed.bbox[1])}..${Math.round(seed.bbox[3])}: rows ${rows.length} kept ${chosen.length} (${chosen.map((r) => r.kind[0]).join("")}) partial ${partial.size}\n`);
      if (process.env.PXD_STREAM_DEBUG === "2") {
        rows.forEach((r, i) => process.stderr.write(`    ${keep.has(i) ? "+" : " "} ${r.kind.padEnd(5)} y ${Math.round(r.row.y0)} ${r.row.lines.map((l) => (partial.has(owner.get(l)) ? "[P]" : "")).join("")} ${r.tokens.map((t) => t.text.slice(0, 24)).join(" | ")}\n`));
      }
    }
    const entries = buildEntries(chosen);
    const bodyRows = entries.filter((e) => e.page && !e.header);
    if (bodyRows.length < 3 || chosen.length <= seedIndexes.length) continue;
    const usedLines = chosen.flatMap((r) => r.row.lines);
    const x0 = Math.min(...usedLines.map((l) => l.x0));
    const x1 = Math.max(...usedLines.map((l) => l.x1));
    const y0 = Math.min(...entries.map((e) => e.y0));
    const y1 = Math.max(...entries.map((e) => e.y1));
    const splitX = Number.isFinite(pageX) ? Math.max(x0 + 1, Math.min(pageX - 4, x1 - 1)) : x1 - 0.1 * (x1 - x0);
    const cells = [];
    entries.forEach((e, i) => {
      cells.push({ r: i, c: 0, rowSpan: 1, colSpan: 1, text: e.label, header: Boolean(e.header), bbox: [x0, e.y0, splitX, e.y1], align: "left", numeric: false });
      cells.push({ r: i, c: 1, rowSpan: 1, colSpan: 1, text: e.page, header: Boolean(e.header), bbox: [splitX, e.y0, x1, e.y1], align: "right", numeric: Boolean(e.page) && !e.header });
    });
    const ys = [entries[0].y0, ...entries.slice(1).map((e, i) => (entries[i].y1 + e.y0) / 2), y1];
    seed.cells = cells;
    seed.rows = entries.length;
    seed.cols = 2;
    seed.headerRows = entries[0]?.header ? 1 : 0;
    seed.headerCols = 0;
    seed.bbox = [x0, y0, x1, y1];
    seed.grid = { xs: [x0, splitX, x1], ys };
    seed.sourceLines = usedLines;
    seed.contents = true;
    used.add(seed);
    for (const o of touched.keys()) {
      if (partial.has(o)) continue;
      used.add(o);
      const list = o.lines ? textBlocks : tables;
      const at = list.indexOf(o);
      if (at >= 0) list.splice(at, 1);
    }
  }
  return tables;
}

function rowsFrom(lines, pageX) {
  return baselineRows(lines, { loose: true }).map((row) => ({ row, ...classify(row, pageX) }));
}

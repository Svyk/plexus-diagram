// Built-in PDF parse engine: page data from pdf.js -> pxd-parse/1 document. Pure except for
// the yield between pages. `getPage(n)` returns { items, ops, w, h, rotation, transform, fonts }.

import { buildLines, lineBox, makeLine, round } from "./lines.js";
import { extractGraphics } from "./rules.js";
import { findLatticeTables } from "./lattice.js";
import { baselineRows, detectStreamRuns, tableFromBand } from "./stream.js";
import { findFigures } from "./figures.js";
import { findFurniture } from "./furniture.js";
import { applyNumbering, bodySizeOf, CAPTION_RE, headingClasses, headingLevel } from "./headings.js";
import { detectLists } from "./lists.js";
import { detectFormulas } from "./formulas.js";
import { FOOTNOTE_MARK_RE, groupParagraphs, joinLines, spansOf } from "./blocks.js";
import { boxOfUnits, crossesGutter, detectColumns, orderUnits, splitAtGutters } from "./xycut.js";

export const SCHEMA = "pxd-parse/1";
export const ENGINE_VERSION = "plexus-builtin/1";

const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

function yieldTick() {
  return new Promise((resolve) => (typeof setTimeout === "function" ? setTimeout(resolve, 0) : resolve()));
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    const err = new Error("parse aborted");
    err.name = "AbortError";
    throw err;
  }
}

export function viewportTransform(w, h, rotation = 0) {
  switch (((rotation % 360) + 360) % 360) {
    case 90: return [0, 1, 1, 0, 0, 0];
    case 180: return [-1, 0, 0, 1, w, 0];
    case 270: return [0, -1, -1, 0, h, w];
    default: return [1, 0, 0, -1, 0, h];
  }
}

// Pass 1 for one page: geometry only.
export function parsePageGeometry(data, n) {
  const t0 = now();
  const w = data.w; const h = data.h;
  const transform = data.transform || viewportTransform(w, h, data.rotation || 0);
  const { lines, rotated } = buildLines(data.items || [], { transform, fonts: data.fonts || {} });
  const graphics = extractGraphics(data.ops, { transform });
  const words = lines.flatMap((l) => l.words);
  const pageArea = w * h;
  const bigImage = graphics.images.some((im) => (im.x1 - im.x0) * (im.y1 - im.y0) >= 0.5 * pageArea);
  const kind = words.length === 0 && bigImage ? "scan" : bigImage ? "mixed" : "text";
  const pageBody = bodySizeOf(lines) || 10;
  const used = new Set();
  const tables = [];
  const lattice = findLatticeTables({ rules: graphics.rules, boxes: graphics.boxes, words });
  for (const t of lattice.tables) { t.page = n; tables.push(t); }
  for (const w of lattice.usedWords) used.add(w);
  const usedRules = new Set(lattice.usedRules);
  for (const band of lattice.bands) {
    const free = words.filter((w) => !used.has(w));
    const t = tableFromBand(band, free);
    if (!t) continue;
    t.page = n;
    for (const w of t.usedWords) used.add(w);
    delete t.usedWords;
    for (const s of band.segs) usedRules.add(s);
    tables.push(t);
  }
  const figs = kind === "scan" ? { figures: [], used: new Set() } : findFigures({ graphics, usedRules, words: words.filter((w) => !used.has(w)), bodySize: pageBody, pageW: w, pageH: h, ruleSegments: lattice.segments });
  for (const w of figs.used) used.add(w);
  const figures = figs.figures.map((f) => ({ ...f, page: n }));
  return { n, w, h, rotation: data.rotation || 0, kind, lines, rotated, words, graphics, tables, figures, used, ms: round(now() - t0) };
}

export async function parsePdf({ getPage, numPages, pages, signal, onPage, info = null, engineVersion = ENGINE_VERSION, sha256 = null, options = {} }) {
  const t0 = now();
  const from = pages ? Math.max(1, pages[0]) : 1;
  const to = pages ? Math.min(numPages, pages[1]) : numPages;
  const pageRecords = [];
  for (let n = from; n <= to; n++) {
    throwIfAborted(signal);
    const data = await getPage(n);
    throwIfAborted(signal);
    const rec = parsePageGeometry(data, n);
    pageRecords.push(rec);
    if (onPage) onPage({ page: n, from, to, ms: rec.ms });
    if (n < to) await yieldTick();
  }
  throwIfAborted(signal);
  const doc = assembleDocument(pageRecords, { numPages, info, engineVersion, sha256, options, from, to });
  doc.stats.ms = round(now() - t0);
  return doc;
}

// Pass 2: document-level structure from the page geometry records. Pure.
export function assembleDocument(pageRecords, { numPages, info = null, engineVersion = ENGINE_VERSION, sha256 = null, options = {}, from = 1, to = numPages } = {}) {
  const t1 = now();
  // Free lines: words not consumed by tables or figures.
  for (const pg of pageRecords) {
    pg.free = [];
    for (const line of pg.lines) {
      const ws = line.words.filter((w) => !pg.used.has(w));
      if (!ws.length) continue;
      pg.free.push(ws.length === line.words.length ? line : makeLine(ws));
    }
  }
  const furniture = findFurniture(pageRecords.map((pg) => ({ n: pg.n, h: pg.h, lines: pg.free })));
  for (const pg of pageRecords) pg.free = pg.free.filter((l) => !furniture.isFurniture(l));
  const allFree = pageRecords.flatMap((pg) => pg.free);
  const bodySize = bodySizeOf(allFree) || 10;
  const bodyFont = dominantFont(allFree);
  let classes = headingClasses(allFree, bodySize);
  // The title class is the largest class seen on the first parsed page; bigger text later
  // (poster labels, figure text) is decoration, not a heading level above the title.
  const firstPage = pageRecords[0];
  if (firstPage && classes.length) {
    const onFirst = classes.filter((k) => firstPage.free.some((l) => Math.round(l.size * 2) / 2 === k && l.chars >= 3));
    if (onFirst.length) classes = classes.filter((k) => k <= onFirst[0]);
  }

  const blocks = {};
  const order = [];
  const counters = {};
  const nextId = (prefix) => { counters[prefix] = (counters[prefix] || 0) + 1; return `${prefix}${counters[prefix]}`; };
  const headings = [];
  const refs = [];
  const footnotes = [];
  const perPage = [];

  for (const pg of pageRecords) {
    const units = [];
    if (pg.kind === "scan") {
      const id = nextId("s");
      blocks[id] = { id, type: "scan", page: pg.n, bbox: [0, 0, round(pg.w), round(pg.h)], confidence: 1, engine: "builtin" };
      units.push({ id, x0: 0, y0: 0, x1: pg.w, y1: pg.h });
    }
    const dots = pg.graphics.dots;
    let gutters = detectColumns(pg.free, { pageW: pg.w });
    if (gutters.length) {
      pg.free = splitAtGutters(pg.free, gutters, makeLine);
      gutters = detectColumns(pg.free, { pageW: pg.w });
    }
    // Column sequences: wide lines (crossing a gutter) form their own sequence.
    const seqs = gutters.map(() => []);
    seqs.push([]);
    const wideSeq = [];
    const byY = [...pg.free].sort((a, b) => a.base - b.base || a.x0 - b.x0);
    // Table-like baseline rows (3+ fragments straddling a gutter) stay together as wide units.
    const rowWide = new Set();
    for (const row of baselineRows(byY)) {
      if (row.lines.length >= 3 && gutters.some((g) => row.x0 < g.x0 - 1 && row.x1 > g.x1 + 1)) for (const l of row.lines) rowWide.add(l);
    }
    let lastWide = null;
    for (let k = 0; k < byY.length; k++) {
      const line = byY[k];
      let wide = rowWide.has(line) || gutters.some((g) => crossesGutter(line, g));
      if (!wide && lastWide && line.base - lastWide.base <= 1.7 * line.size && Math.abs(line.x0 - lastWide.x0) <= 1.5 * line.size && Math.abs(line.size - lastWide.size) <= 0.6) {
        // Short last line of a full-width paragraph: nothing else shares its baseline.
        const shared = byY.some((o) => o !== line && Math.abs(o.base - line.base) <= 0.3 * line.size);
        if (!shared) wide = true;
      }
      if (wide) { wideSeq.push(line); lastWide = line; continue; }
      lastWide = null;
      const mid = (line.x0 + line.x1) / 2;
      let idx = gutters.findIndex((g) => mid < (g.x0 + g.x1) / 2);
      if (idx < 0) idx = gutters.length;
      seqs[idx].push(line);
    }
    const sequences = [...seqs, wideSeq].filter((s) => s.length).map((s) => s.sort((a, b) => a.base - b.base || a.x0 - b.x0));
    const pageTables = [...pg.tables];
    const pageFigures = [...pg.figures];
    const textBlocks = [];
    for (const seq of sequences) {
      let lines = seq;
      // Stream tables.
      for (const t of detectStreamRuns(lines, { dots })) {
        const drop = new Set(t.lines);
        lines = lines.filter((l) => !drop.has(l));
        delete t.lines; delete t.usedWords;
        t.page = pg.n;
        pageTables.push(t);
      }
      // Formulas.
      const column = boxOfUnits(lines.length ? lines : seq);
      const formulaRuns = detectFormulas(lines, { column, bodySize, bodyFont });
      const formulaLines = new Set();
      for (const run of formulaRuns) {
        const fl = lines.slice(run.start, run.end);
        fl.forEach((l) => formulaLines.add(l));
        const box = boxOfUnits(fl);
        textBlocks.push({ type: "formula", lines: fl, number: run.number, bbox: box, text: joinLines(fl, { collectRefs: false }).text });
      }
      lines = lines.filter((l) => !formulaLines.has(l));
      // Lists.
      const listRuns = detectLists(lines, { dots, joinText: (ls) => joinLines(ls).text });
      const listLines = new Set();
      for (const run of listRuns) {
        const ls = lines.slice(run.start, run.end);
        ls.forEach((l) => listLines.add(l));
        const items = run.items.map((it) => {
          const joined = joinLines(it.lines);
          for (const r of joined.footnoteRefs) refs.push({ ...r, page: pg.n, block: null });
          return { text: joined.text, level: it.level, marker: it.marker };
        });
        textBlocks.push({ type: "list", lines: ls, ordered: run.ordered, items, bbox: boxOfUnits(ls) });
      }
      lines = lines.filter((l) => !listLines.has(l));
      // Headings and paragraphs.
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        const next = lines[i + 1];
        const nextIsBody = !next || !next.bold || Math.abs(next.size - line.size) > 0.6;
        const level = headingLevel(line, { bodySize, classes, nextIsBody });
        if (level) {
          const hl = [line];
          let j = i + 1;
          while (j < lines.length && headingLevel(lines[j], { bodySize, classes, nextIsBody: true }) === level && lines[j].base - lines[j - 1].base <= 1.5 * line.size && Math.abs(lines[j].size - line.size) <= 0.6) { hl.push(lines[j]); j++; }
          textBlocks.push({ type: "heading", level, lines: hl, bbox: boxOfUnits(hl), text: joinLines(hl, { collectRefs: false }).text });
          i = j;
          continue;
        }
        let j = i + 1;
        while (j < lines.length && !headingLevel(lines[j], { bodySize, classes, nextIsBody: !lines[j + 1] || !lines[j + 1].bold || Math.abs(lines[j + 1].size - lines[j].size) > 0.6 })) j++;
        const chunk = lines.slice(i, j);
        for (const group of groupParagraphs(chunk, { bodySize })) {
          const joined = joinLines(group);
          const first = group[0].words[0];
          const isCaption = CAPTION_RE.test(joined.text);
          const startsWithMark = first && first.sup && FOOTNOTE_MARK_RE.test(first.text) && group[0].size <= 0.9 * bodySize;
          const lowOnPage = group[0].y0 >= 0.75 * pg.h;
          const lastBase = group[group.length - 1].base;
          const lastInColumn = !seq.some((l) => l.base > lastBase + 1 && l.size >= bodySize - 0.5);
          if (startsWithMark && (lowOnPage || lastInColumn)) {
            const mark = first.text;
            const rest = { ...group[0], words: group[0].words.slice(1) };
            rest.text = rest.words.map((w) => w.text).join(" ");
            const text = joinLines([rest, ...group.slice(1)], { collectRefs: false }).text;
            textBlocks.push({ type: "footnote", lines: group, mark, text, bbox: boxOfUnits(group) });
            continue;
          }
          const block = { type: isCaption ? "caption" : "para", lines: group, text: joined.text, footnoteRefs: joined.footnoteRefs, bbox: boxOfUnits(group) };
          textBlocks.push(block);
        }
        i = j;
      }
    }
    // Captions attach to the nearest table or figure that overlaps horizontally.
    const captionFor = new Map();
    for (const cb of textBlocks) {
      if (cb.type !== "caption") continue;
      let best = null;
      for (const target of [...pageTables, ...pageFigures]) {
        const tb = target.bbox;
        const ox = Math.min(tb[2], cb.bbox.x1) - Math.max(tb[0], cb.bbox.x0);
        if (ox <= 0) continue;
        const gap = cb.bbox.y1 <= tb[1] ? tb[1] - cb.bbox.y1 : cb.bbox.y0 >= tb[3] ? cb.bbox.y0 - tb[3] : 0;
        if (gap > 3 * bodySize) continue;
        const wantsTable = /^table/i.test(cb.text);
        const isTable = target.type === "table";
        if (wantsTable !== isTable) continue;
        if (!best || gap < best.gap) best = { target, gap };
      }
      if (best && !captionFor.has(best.target)) captionFor.set(best.target, cb);
      else if (!best) cb.type = "para";
    }
    // Materialise blocks with ids.
    const unitOf = (b, id) => ({ id, x0: b.bbox.x0 ?? b.bbox[0], y0: b.bbox.y0 ?? b.bbox[1], x1: b.bbox.x1 ?? b.bbox[2], y1: b.bbox.y1 ?? b.bbox[3] });
    const captionIds = new Map();
    for (const tb of textBlocks) {
      const prefix = { heading: "b", para: "b", caption: "c", footnote: "n", list: "l", formula: "e" }[tb.type];
      const id = nextId(prefix);
      const bbox = [round(tb.bbox.x0), round(tb.bbox.y0), round(tb.bbox.x1), round(tb.bbox.y1)];
      const block = { id, type: tb.type, page: pg.n, bbox, confidence: 0.9, engine: "builtin" };
      if (tb.type === "heading") { block.level = tb.level; block.text = tb.text; block.spans = spansOf(tb.lines); headings.push(block); }
      else if (tb.type === "para" || tb.type === "caption") {
        block.text = tb.text; block.spans = spansOf(tb.lines);
        if (tb.footnoteRefs && tb.footnoteRefs.length) { block.footnoteRefs = tb.footnoteRefs.map((r) => ({ ...r, to: null })); for (const r of block.footnoteRefs) refs.push({ ref: r, page: pg.n }); }
        if (tb.type === "caption") captionIds.set(tb, id);
      } else if (tb.type === "footnote") { block.mark = tb.mark; block.text = tb.text; footnotes.push(block); }
      else if (tb.type === "list") { block.ordered = tb.ordered; block.items = tb.items; }
      else if (tb.type === "formula") { block.latex = null; block.number = tb.number; block.text = tb.text; }
      blocks[id] = block;
      units.push(unitOf(tb, id));
    }
    for (const t of pageTables) {
      const id = nextId("t");
      const cap = captionFor.get(t);
      const block = { id, type: "table", page: pg.n, bbox: t.bbox, rows: t.rows, cols: t.cols, headerRows: t.headerRows, headerCols: t.headerCols, cells: t.cells, caption: cap ? captionIds.get(cap) : null, method: t.method, grid: t.grid, confidence: t.confidence, engine: "builtin" };
      if (cap) blocks[captionIds.get(cap)].for = id;
      blocks[id] = block;
      units.push({ id, x0: t.bbox[0], y0: t.bbox[1], x1: t.bbox[2], y1: t.bbox[3] });
    }
    for (const f of pageFigures) {
      const id = nextId("f");
      const cap = captionFor.get(f);
      blocks[id] = { id, type: "figure", page: pg.n, bbox: f.bbox, caption: cap ? captionIds.get(cap) : null, image: { kind: "crop", source: f.kind }, confidence: f.kind === "drawing" ? 0.7 : 0.9, engine: "builtin" };
      if (cap) blocks[captionIds.get(cap)].for = id;
      units.push({ id, x0: f.bbox[0], y0: f.bbox[1], x1: f.bbox[2], y1: f.bbox[3] });
    }
    const ordered = orderUnits(units, { gutters });
    for (const u of ordered.order) order.push(u.id);
    perPage.push({ n: pg.n, w: round(pg.w), h: round(pg.h), rotation: pg.rotation, kind: pg.kind, parsed: true, columns: ordered.columns, ms: pg.ms });
  }
  mergeContinuations(order, blocks);
  applyNumbering(headings);
  // Footnote links: nearest footnote with the same mark on the same or a later page, else earlier.
  for (const entry of refs) {
    if (!entry.ref) continue;
    const same = footnotes.filter((f) => f.mark === entry.ref.mark);
    const after = same.filter((f) => f.page >= entry.page).sort((a, b) => a.page - b.page);
    const pick = after[0] || same[same.length - 1];
    if (pick) entry.ref.to = pick.id;
  }
  // Title: metadata first, then the first level-1 heading on the first parsed page.
  let title = info && typeof info.Title === "string" && info.Title.trim() ? info.Title.trim() : null;
  if (!title) { const h1 = headings.find((h) => h.level === 1 && h.page === (firstPage ? firstPage.n : 1)) || headings.find((h) => h.level === 1); title = h1 ? h1.text : null; }
  const pagesOut = [];
  for (const p of perPage) pagesOut.push({ n: p.n, w: p.w, h: p.h, rotation: p.rotation, kind: p.kind, parsed: true, columns: p.columns });
  return {
    schema: SCHEMA,
    sha256,
    engine: "builtin",
    engineVersion,
    options: { ocr: "none", formula: false, tables: "builtin", ...options },
    createdAt: new Date().toISOString(),
    pageCount: numPages,
    title,
    pages: pagesOut,
    order,
    blocks,
    removed: furniture.removed,
    stats: { ms: 0, perPage: perPage.map((p) => p.ms), assembleMs: round(now() - t1), bodySize, headingSizes: classes, range: [from, to] },
  };
}

function dominantFont(lines) {
  const counts = new Map();
  for (const l of lines) for (const w of l.words) counts.set(w.fontName, (counts.get(w.fontName) || 0) + w.text.length);
  let best = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) { n = v; best = k; }
  return best;
}

// A paragraph cut by a column or page break continues in the next paragraph of the order.
export function mergeContinuations(order, blocks) {
  for (let i = 0; i + 1 < order.length; i++) {
    const a = blocks[order[i]];
    const b = blocks[order[i + 1]];
    if (!a || !b || a.type !== "para" || b.type !== "para") continue;
    if (/[.?!:"”)\]]$/.test(a.text) || !/^[a-z]/.test(b.text)) continue;
    if (Math.abs(a.spans?.[0]?.size - b.spans?.[0]?.size) > 0.6) continue;
    const hyphen = a.text.endsWith("-");
    const offset = a.text.length + (hyphen ? 0 : 1);
    a.text = hyphen ? a.text.slice(0, -1) + b.text : `${a.text} ${b.text}`;
    a.spans = [...(a.spans || []), ...(b.spans || [])];
    if (b.footnoteRefs) {
      // Same ref objects (the footnote linker holds them); only the offsets move.
      for (const r of b.footnoteRefs) r.at += offset - (hyphen ? 1 : 0);
      a.footnoteRefs = [...(a.footnoteRefs || []), ...b.footnoteRefs];
    }
    a.parts = [...(a.parts || [{ page: a.page, bbox: a.bbox }]), { page: b.page, bbox: b.bbox }];
    delete blocks[b.id];
    order.splice(i + 1, 1);
    i--;
  }
}

export { lineBox };

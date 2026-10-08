// U2. OCR text layer. For a scanned page, one transparent span per OCR word goes INSIDE that page's
// `.textLayer` (Roam's own highlighter then works on the scan: U1 spike). Spans are sized the way pdf.js
// sizes its own: font-size from the word box height, scaleX to the box width, PDF points times
// pageEl.clientWidth / page.w. Pages whose `.textLayer` already has text are left alone.
// One MutationObserver on the reader re-mounts after pdf.js rebuilds a page or zooms. No listeners on
// spans, no graph writes, no pointer capture.

export const WORD_CLASS = "pxd-tl-word";
export const WORD_ATTR = "data-pxd-word";
export const MARK_ATTR = "data-pxd-tl";
export const NEAR_EMPTY_CHARS = 8;
const FONT_PX = 100;
const FALLBACK_EM = 0.52;
const ASCENT = 0.8;

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// One record → words in PDF points, origin top-left: { text, x, y, w, h }.
// Takes a pxd-ocr/1 page record (`items`) or a built-in geometry record (`words` with x0/x1/base/size).
export function ocrWords(record) {
  if (!record || typeof record !== "object" || record.textRotation) return [];
  const out = [];
  if (Array.isArray(record.boxes)) {
    for (const box of record.boxes) {
      if (!Array.isArray(box)) continue;
      const text = String(box[0] ?? "").trim();
      const w = num(box[3]);
      const h = num(box[4]);
      if (text && w > 0 && h > 0) out.push({ text, x: num(box[1]), y: num(box[2]), w, h });
    }
    return out;
  }
  if (Array.isArray(record.items)) {
    for (const item of record.items) {
      const text = String(item?.str ?? "").trim();
      if (!text) continue;
      const m = Array.isArray(item.transform) ? item.transform : [0, 0, 0, 0, 0, 0];
      const height = num(item.height, Math.hypot(num(m[2]), num(m[3])));
      const y0 = Number.isFinite(Number(item.y0)) ? Number(item.y0) : num(m[5]) - height;
      const y1 = Number.isFinite(Number(item.y1)) ? Number(item.y1) : num(m[5]);
      const h = y1 - y0 > 0 ? y1 - y0 : height;
      const w = num(item.width);
      if (!(h > 0) || !(w > 0)) continue;
      out.push({ text, x: num(m[4]), y: y0, w, h });
    }
    return out;
  }
  const words = Array.isArray(record.words) ? record.words
    : Array.isArray(record.lines) ? record.lines.flatMap((line) => line?.words || []) : [];
  for (const word of words) {
    const text = String(word?.text ?? "").trim();
    if (!text || word.rotated) continue;
    const size = num(word.size);
    const w = num(word.x1) - num(word.x0);
    if (!(size > 0) || !(w > 0)) continue;
    out.push({ text, x: num(word.x0), y: num(word.base) - size * ASCENT, w, h: size });
  }
  return out;
}

// Reading order for selection: rows by vertical centre, left to right inside a row. `breaks[i]` is true
// when a line ends after word i (a <br> goes there so copied text keeps its lines).
export function orderWords(words) {
  const list = (words || []).slice().sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);
  const rows = [];
  for (const word of list) {
    const mid = word.y + word.h / 2;
    const row = rows.length ? rows[rows.length - 1] : null;
    if (row && Math.abs(mid - row.mid) <= 0.5 * Math.max(row.h, word.h)) {
      row.words.push(word);
      row.h = Math.max(row.h, word.h);
    } else rows.push({ mid, h: word.h, words: [word] });
  }
  const ordered = [];
  const breaks = [];
  for (const row of rows) {
    row.words.sort((a, b) => a.x - b.x);
    row.words.forEach((word, i) => {
      ordered.push(word);
      breaks.push(i === row.words.length - 1);
    });
  }
  return { words: ordered, breaks };
}

// A page needs our layer when Roam's own text layer holds (almost) no text.
export function needsTextLayer(layer, { minChars = NEAR_EMPTY_CHARS } = {}) {
  if (!layer) return false;
  let chars = 0;
  for (const child of layer.children || []) {
    if (child?.hasAttribute?.(WORD_ATTR)) continue;
    chars += String(child?.textContent ?? "").trim().length;
    if (chars >= minChars) return false;
  }
  return true;
}

// Width of `text` at FONT_PX, from one shared 2D context (no layout). Falls back to an em estimate.
export function createMeasure(doc) {
  let ctx = null;
  try {
    const canvas = doc?.createElement?.("canvas");
    const got = canvas?.getContext?.("2d");
    if (got && typeof got.measureText === "function") {
      got.font = `${FONT_PX}px sans-serif`;
      ctx = got;
    }
  } catch { ctx = null; }
  const cache = new Map();
  return (text) => {
    const key = String(text ?? "");
    const hit = cache.get(key);
    if (hit != null) return hit;
    let w = 0;
    if (ctx) {
      try { w = Number(ctx.measureText(key)?.width) || 0; } catch { w = 0; }
    }
    if (!(w > 0)) w = key.length * FALLBACK_EM * FONT_PX;
    if (cache.size < 4000) cache.set(key, w);
    return w;
  };
}

// Inline style for one word span. `scale` is CSS px per PDF point.
export function wordStyle(word, scale, naturalAt100) {
  const font = word.h * scale;
  const natural = (num(naturalAt100) * font) / FONT_PX;
  const target = word.w * scale;
  const sx = natural > 0 ? target / natural : 1;
  return `left:${(word.x * scale).toFixed(2)}px;top:${(word.y * scale).toFixed(2)}px;font-size:${font.toFixed(2)}px;transform:scaleX(${sx.toFixed(4)})`;
}

const prepCache = new WeakMap();
function prepared(record) {
  let hit = prepCache.get(record);
  if (!hit) {
    const ordered = orderWords(ocrWords(record));
    hit = { w: num(record?.w, 612) || 612, words: ordered.words, breaks: ordered.breaks };
    prepCache.set(record, hit);
  }
  return hit;
}

export function removeWords(layer) {
  const nodes = layer?.querySelectorAll?.(`[${WORD_ATTR}]`) || [];
  for (const node of [...nodes]) {
    try { node.remove(); } catch { /* gone */ }
  }
  try { layer?.removeAttribute?.(MARK_ATTR); } catch { /* stub */ }
}

// Mounts the record's words inside `layer`. `widthPx` is the page element's client width.
export function mountWords(layer, record, { doc = layer?.ownerDocument || globalThis.document, widthPx = 0, measure = null, key = "", now = () => Date.now() } = {}) {
  const t0 = now();
  if (!layer || !doc) return { count: 0, ms: 0 };
  const prep = prepared(record);
  removeWords(layer);
  const scale = widthPx > 0 ? widthPx / prep.w : 1;
  const width = measure || createMeasure(doc);
  const frag = typeof doc.createDocumentFragment === "function" ? doc.createDocumentFragment() : null;
  const sink = frag || layer;
  const n = record?.n ?? "";
  prep.words.forEach((word, i) => {
    const span = doc.createElement("span");
    span.className = WORD_CLASS;
    span.setAttribute(WORD_ATTR, String(i));
    span.setAttribute("role", "presentation");
    span.style.cssText = wordStyle(word, scale, width(word.text));
    // A trailing space on every word, line ends too: selected text reads as words, not "reviewEnvironmental".
    span.textContent = `${word.text} `;
    sink.append(span);
    if (prep.breaks[i]) {
      const br = doc.createElement("br");
      br.setAttribute(WORD_ATTR, "br");
      br.setAttribute("role", "presentation");
      sink.append(br);
    }
  });
  if (frag) layer.append(frag);
  layer.setAttribute(MARK_ATTR, key || `${n}:${Math.round(widthPx)}`);
  return { count: prep.words.length, ms: now() - t0 };
}

// Stored form of a text layer page (IndexedDB, parse-images): { n, w, h, boxes: [[text, x, y, w, h], …] }.
export function compactPage(record) {
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    n: Number(record?.n),
    w: num(record?.w, 612) || 612,
    h: num(record?.h, 792) || 792,
    boxes: ocrWords(record).map((word) => [word.text, r2(word.x), r2(word.y), r2(word.w), r2(word.h)]),
  };
}

const pageNumberOf = (pageEl) => Number(pageEl?.getAttribute?.("data-page-number"));

// Accepts a list of page records, a pxd-ocr/1 response ({ schema, pages }) or one record.
export function pageRecords(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.filter((rec) => rec && Number.isFinite(Number(rec.n)));
  if (Array.isArray(input.pages)) return pageRecords(input.pages);
  return Number.isFinite(Number(input.n)) ? [input] : [];
}

export function createTextLayer({ doc = globalThis.document, readerEl = null, measure = null, now = () => globalThis.performance?.now?.() ?? Date.now() } = {}) {
  const view = () => doc?.defaultView || globalThis;
  const records = new Map();
  const width = measure || createMeasure(doc);
  let observer = null;
  let frame = 0;
  let dead = false;
  const stats = { mounts: 0, words: 0, lastMs: 0, maxMs: 0 };

  const ensureObserver = () => {
    if (observer || dead || !readerEl || !records.size) return;
    const MO = view().MutationObserver;
    if (typeof MO !== "function") return;
    observer = new MO((list) => {
      if (onlyOurs(list)) return;
      schedule();
    });
    try { observer.observe(readerEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] }); } catch { observer = null; }
  };
  // refresh() takes its own records, so a record that only adds our spans is a late echo. Anything that
  // removes our spans (pdf.js wiping the layer) or touches Roam's nodes needs a pass.
  const onlyOurs = (list) => {
    for (const rec of list || []) {
      if (rec.type === "attributes") {
        if (rec.target?.classList?.contains?.("page")) return false;
        continue;
      }
      if (rec.removedNodes?.length) return false;
      for (const node of rec.addedNodes || []) {
        if (node?.nodeType !== 1 || !node.hasAttribute?.(WORD_ATTR)) return false;
      }
    }
    return true;
  };
  const schedule = () => {
    if (dead || frame) return;
    const raf = view().requestAnimationFrame;
    if (typeof raf !== "function") { refresh(); return; }
    frame = raf(() => { frame = 0; refresh(); });
  };
  // Reads every page width first, then writes, so mounting several pages costs one layout.
  function refresh() {
    if (dead || !readerEl || !records.size) return [];
    const pages = readerEl.querySelectorAll?.(".page") || [];
    const plan = [];
    for (const pageEl of pages) {
      const n = pageNumberOf(pageEl);
      const record = records.get(n);
      if (!record) continue;
      const layer = pageEl.querySelector?.(".textLayer");
      if (!layer) continue;
      const widthPx = num(pageEl.clientWidth);
      const key = `${n}:${Math.round(widthPx)}`;
      const ours = layer.querySelector?.(`[${WORD_ATTR}]`);
      if (ours && layer.getAttribute?.(MARK_ATTR) === key) continue;
      if (!ours && !needsTextLayer(layer)) continue;
      plan.push({ layer, record, widthPx, key });
    }
    const done = [];
    for (const job of plan) {
      const res = mountWords(job.layer, job.record, { doc, widthPx: job.widthPx, measure: width, key: job.key, now });
      stats.mounts += 1;
      stats.words += res.count;
      stats.lastMs = res.ms;
      stats.maxMs = Math.max(stats.maxMs, res.ms);
      done.push(Number(job.key.split(":")[0]));
    }
    try { observer?.takeRecords?.(); } catch { /* stub */ }
    return done;
  }

  return {
    setPages(input) {
      if (dead) return 0;
      const list = pageRecords(input);
      for (const rec of list) records.set(Number(rec.n), rec);
      if (list.length) {
        ensureObserver();
        schedule();
      }
      return list.length;
    },
    hasPage: (n) => records.has(Number(n)),
    pageNumbers: () => [...records.keys()].sort((a, b) => a - b),
    clear() {
      records.clear();
      const layers = readerEl?.querySelectorAll?.(`[${MARK_ATTR}]`) || [];
      for (const layer of layers) removeWords(layer);
      try { observer?.disconnect?.(); } catch { /* stub */ }
      observer = null;
    },
    refresh,
    schedule,
    stats: () => ({ ...stats }),
    dispose() {
      if (dead) return;
      this.clear();
      dead = true;
      if (frame) {
        try { view().cancelAnimationFrame?.(frame); } catch { /* stub */ }
        frame = 0;
      }
    },
  };
}

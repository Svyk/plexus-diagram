// Locate verbatim highlight text on a PDF page and turn it into Roam's `:pdf-highlight` position
// ({ boundingRect, rects, pageNumber }, viewport coordinates at scale 1 with width/height, like react-pdf-highlighter).
// locate() is pure over pdf.js text items; loadPdfText() reads a file with pdfjs-dist in Node.

// Matching ignores whitespace, hyphens/soft hyphens (line-break hyphenation), case of quotes and ligatures.
const SKIP = /[\s­‐‑‒–—−-]/;
const QUOTES = { "‘": "'", "’": "'", "‚": "'", "‛": "'", "“": '"', "”": '"', "„": '"', "´": "'", "`": "'" };

function normChars(str) {
  const out = [];
  for (const ch of String(str ?? "")) {
    const n = ch.normalize("NFKC");
    for (const c of n) {
      if (SKIP.test(c)) continue;
      out.push(QUOTES[c] || c);
    }
  }
  return out;
}

export function normalizeKey(str) {
  return normChars(str).join("");
}

// Page text index: the normalized stream, and for each stream char the (item, fraction-in-item) it came from.
export function indexPage(items) {
  let text = "";
  const from = [];
  items.forEach((item, idx) => {
    const raw = String(item.str ?? "");
    const chars = Array.from(raw);
    chars.forEach((ch, k) => {
      for (const c of normChars(ch)) {
        text += c;
        from.push({ idx, a: k / Math.max(1, chars.length), b: (k + 1) / Math.max(1, chars.length) });
      }
    });
  });
  return { text, from };
}

// One rect per run of items on the same line. `toViewport([x,y])` maps PDF user space to viewport space.
export function rectsFor(items, hits, toViewport) {
  const parts = [];
  for (const [idx, a, b] of hits) {
    const it = items[idx];
    const [, , , , e, f] = it.transform;
    const h = Number(it.height) || Math.hypot(it.transform[2], it.transform[3]) || 10;
    const w = Number(it.width) || 0;
    const x1 = e + w * a;
    const x2 = e + w * b;
    const p1 = toViewport([x1, f - h * 0.22]);
    const p2 = toViewport([x2, f + h * 0.95]);
    parts.push({ x1: Math.min(p1[0], p2[0]), x2: Math.max(p1[0], p2[0]), y1: Math.min(p1[1], p2[1]), y2: Math.max(p1[1], p2[1]), base: f, h });
  }
  const lines = [];
  for (const p of parts) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.base - p.base) < p.h * 0.5) {
      last.x1 = Math.min(last.x1, p.x1); last.x2 = Math.max(last.x2, p.x2);
      last.y1 = Math.min(last.y1, p.y1); last.y2 = Math.max(last.y2, p.y2);
    } else lines.push({ ...p });
  }
  return lines.map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }));
}

// Like locate(), but when the whole text is not on any page (pdftotext puts a running header or a column break
// inside the quote) the longest run of words found, at least `min` of them, is highlighted instead.
// Returns { ...position, text, partial }.
export function locateLoose(pages, text, hint, { min = 0.6 } = {}) {
  const whole = locate(pages, text, hint);
  if (whole) return { ...whole, text, partial: false };
  const words = String(text).split(/\s+/).filter(Boolean);
  const need = Math.max(6, Math.ceil(words.length * min));
  for (let len = words.length - 1; len >= need; len -= 1) {
    for (let start = 0; start + len <= words.length; start += 1) {
      const part = words.slice(start, start + len).join(" ");
      const hit = locate(pages, part, hint);
      if (hit) return { ...hit, text: part, partial: true };
    }
  }
  return null;
}

// pages: [{ items, width, height, toViewport? }] (index 0 = page 1). Returns { pageNumber, boundingRect, rects } or null.
// The hinted page is tried first, then its neighbours, then every page.
export function locate(pages, text, hint) {
  const needle = normalizeKey(text);
  if (needle.length < 3) return null;
  const order = [];
  const seen = new Set();
  const add = (n) => { if (n >= 1 && n <= pages.length && !seen.has(n)) { seen.add(n); order.push(n); } };
  if (Number.isInteger(hint)) for (const d of [0, -1, 1, -2, 2]) add(hint + d);
  for (let n = 1; n <= pages.length; n += 1) add(n);
  for (const n of order) {
    const page = pages[n - 1];
    page._index ||= indexPage(page.items);
    const at = page._index.text.indexOf(needle);
    if (at < 0) continue;
    const hits = new Map();
    for (let i = at; i < at + needle.length; i += 1) {
      const { idx, a, b } = page._index.from[i];
      const cur = hits.get(idx);
      if (cur) { cur[1] = Math.min(cur[1], a); cur[2] = Math.max(cur[2], b); } else hits.set(idx, [idx, a, b]);
    }
    const toViewport = page.toViewport || (([x, y]) => [x, page.height - y]);
    const rects = rectsFor(page.items, [...hits.values()].sort((p, q) => p[0] - q[0]), toViewport)
      .map((r) => ({ ...r, width: page.width, height: page.height, pageNumber: n }));
    if (!rects.length) continue;
    const boundingRect = {
      x1: Math.min(...rects.map((r) => r.x1)), y1: Math.min(...rects.map((r) => r.y1)),
      x2: Math.max(...rects.map((r) => r.x2)), y2: Math.max(...rects.map((r) => r.y2)),
      width: page.width, height: page.height, pageNumber: n,
    };
    return { pageNumber: n, boundingRect, rects };
  }
  return null;
}

let pdfjsPromise = null;
async function pdfjs() {
  pdfjsPromise ||= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

// Text items of every page, with the scale-1 viewport (rotation and crop box applied).
export async function loadPdfText(bytes) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.filter((it) => typeof it.str === "string" && it.str.length && Array.isArray(it.transform));
    pages.push({ items, width: vp.width, height: vp.height, toViewport: ([x, y]) => vp.convertToViewportPoint(x, y) });
    page.cleanup();
  }
  let title = "";
  try { title = (await doc.getMetadata())?.info?.Title || ""; } catch { title = ""; }
  const numPages = doc.numPages;
  await doc.destroy();
  return { pages, numPages, title };
}

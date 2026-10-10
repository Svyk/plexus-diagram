// Vision keeps its boxes. PP-OCR may replace a word when the boxes agree and the
// replacement is the safer reading. Numbers and words inside a ruled table stay
// with Vision, so cell geometry and cell text are not rewritten from the other engine.
// Page consensus (`preferSpellings`) is the same rule the Python and Rust helpers apply.

const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;
const IOU_MIN = 0.25;
const INSERT_CAP = 16;

export const WEAK_OCR_LOW = 0.15;
export const WEAK_OCR_MIN_WORDS = 12;

// Share of words Vision itself marked below 0.5. Fewer than twelve confidences is
// not a page: a short caption must not look like handwriting.
export function lowConfidenceShare(items) {
  const confs = (items || []).map((it) => it?.conf).filter((c) => Number.isFinite(c));
  if (confs.length < WEAK_OCR_MIN_WORDS) return 0;
  return confs.filter((c) => c < 0.5).length / confs.length;
}

// Handwriting and a page of words the lexicon does not know. The lexicon clause
// needs a little doubt as well: a long confident page in another language is not
// sent for a second reading. A printed name list (confident, some lexicon hits)
// stays on Vision.
export function weakOcrPage(items, lexicon = null) {
  if (lowConfidenceShare(items) >= WEAK_OCR_LOW) return true;
  if (!(lexicon instanceof Set)) return false;
  const cores = (items || []).map((it) => wordCore(it?.str || it?.text || "").toLowerCase()).filter((c) => c.length >= 4);
  if (cores.length < 20) return false;
  const confs = (items || []).map((it) => it?.conf).filter((c) => Number.isFinite(c));
  const low = confs.length ? confs.filter((c) => c < 0.5).length / confs.length : 0;
  if (low < 0.04) return false;
  return cores.filter((c) => lexicon.has(c)).length / cores.length < 0.12;
}

export function wordCore(text) {
  const parts = String(text || "").match(WORD_RE);
  if (!parts || !parts.length) return "";
  return parts.reduce((best, part) => (part.length > best.length ? part : best), "");
}

// Trailing hyphens are line-break marks, not part of the spelling. `success-` and
// `success.` are the same word; the hyphen is what the line joiner needs.
function letterCore(text) {
  return wordCore(text).replace(/[-']+$/g, "");
}

export function digitHeavy(text) {
  const raw = String(text || "");
  let digits = 0;
  let alnum = 0;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") { digits += 1; alnum += 1; }
    else if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) alnum += 1;
  }
  return alnum > 0 && digits * 2 >= alnum;
}

function boxOf(item) {
  const t = item?.transform || [];
  const x = Number(t[4]) || 0;
  const w = Number(item?.width) || 0;
  const y0 = Number(item?.y0);
  const y1 = Number(item?.y1);
  if (Number.isFinite(y0) && Number.isFinite(y1)) return [x, y0, x + w, y1];
  const base = Number(t[5]) || 0;
  const size = Math.abs(Number(t[0]) || 0);
  return [x, base - 0.8 * size, x + w, base + 0.22 * size];
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  if (inter <= 0) return 0;
  const area = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]) + Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]) - inter;
  return area > 0 ? inter / area : 0;
}

function horizRatio(a, b) {
  const overlap = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const width = Math.min(Math.max(0, a[2] - a[0]), Math.max(0, b[2] - b[0]));
  return width > 0 ? overlap / width : 0;
}

export function editDistance(a, b) {
  const s = String(a || "");
  const t = String(b || "");
  const m = s.length;
  const n = t.length;
  const row = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j += 1) {
    let prev = row[0];
    row[0] = j;
    for (let i = 1; i <= m; i += 1) {
      const cur = row[i];
      row[i] = s[i - 1] === t[j - 1] ? prev : 1 + Math.min(prev, row[i], row[i - 1]);
      prev = cur;
    }
  }
  return row[m];
}

function known(lexicon, word) {
  return Boolean(word) && lexicon instanceof Set && lexicon.has(word);
}

// "Hisisan" and "distributingcompanythat" are real words run together. A shorter
// lexicon hit is one piece of that run, not a better spelling.
export function segmentsIntoWords(token, lexicon) {
  const raw = String(token || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!(lexicon instanceof Set) || raw.length < 4) return false;
  const best = new Array(raw.length + 1).fill(0);
  const reach = new Array(raw.length + 1).fill(false);
  reach[0] = true;
  for (let i = 0; i < raw.length; i += 1) {
    if (!reach[i]) continue;
    for (let j = i + 2; j <= raw.length; j += 1) {
      if (!lexicon.has(raw.slice(i, j))) continue;
      reach[j] = true;
      if (best[i] + 1 > best[j]) best[j] = best[i] + 1;
    }
  }
  return reach[raw.length] && best[raw.length] >= 2;
}

// The first word is the second plus a plural s. Adding the s ("glas" → "glass")
// can still be a real correction; stripping a printed plural is not.
function dropsPlural(printed, shorter) {
  const long = String(printed || "").toLowerCase();
  const stem = String(shorter || "").toLowerCase();
  if (stem.length < 3 || long.length <= stem.length) return false;
  return long === `${stem}s` || long === `${stem}es`;
}

function applyCase(sample, word) {
  const letters = String(sample || "").replace(/[^A-Za-z]/g, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) return word.toUpperCase();
  if (sample && sample[0] === sample[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
}

function replaceCore(raw, core, next) {
  const re = new RegExp(core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return String(raw).replace(re, (found) => applyCase(found, next));
}

// Rectangles that have at least two horizontal and two vertical rules. A frame that
// covers most of the page is a border, not a table, and does not protect the body.
export function ruledRegions(rules, pageW = 612, pageH = 792) {
  const horiz = [];
  const vert = [];
  for (const rule of rules || []) {
    const x0 = Math.min(rule.x0, rule.x1);
    const x1 = Math.max(rule.x0, rule.x1);
    const y0 = Math.min(rule.y0, rule.y1);
    const y1 = Math.max(rule.y0, rule.y1);
    if (y1 - y0 <= 1.5 && x1 - x0 >= 36) horiz.push({ x0, x1, y: (y0 + y1) / 2 });
    else if (x1 - x0 <= 1.5 && y1 - y0 >= 36) vert.push({ y0, y1, x: (x0 + x1) / 2 });
  }
  const regions = [];
  const pageArea = Math.max(1, pageW * pageH);
  for (let i = 0; i < horiz.length; i += 1) {
    for (let j = i + 1; j < horiz.length; j += 1) {
      const top = Math.min(horiz[i].y, horiz[j].y);
      const bot = Math.max(horiz[i].y, horiz[j].y);
      if (bot - top < 20) continue;
      const x0 = Math.max(horiz[i].x0, horiz[j].x0);
      const x1 = Math.min(horiz[i].x1, horiz[j].x1);
      if (x1 - x0 < 40) continue;
      if ((x1 - x0) * (bot - top) > 0.65 * pageArea) continue;
      let verts = 0;
      for (const v of vert) {
        if (v.x < x0 - 4 || v.x > x1 + 4) continue;
        const span = Math.min(v.y1, bot) - Math.max(v.y0, top);
        if (span >= 0.6 * (bot - top)) verts += 1;
      }
      if (verts >= 2) regions.push([x0, top, x1, bot]);
    }
  }
  return regions;
}

export function inRuledRegion(box, regions) {
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  return regions.some((r) => cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3]);
}

function betterCount(n, bestN, word, best, knownWord) {
  if (!best || n > bestN) return true;
  if (n < bestN) return false;
  if (knownWord !== best.known) return knownWord;
  return word < best.word;
}

// A repeated spelling on the page replaces a one-edit neighbour that is not itself
// a lexicon word. Lexicon words are left alone (`form` is not rewritten to `from`).
export function preferSpellings(items, lexicon, { rules = null, pageW = 612, pageH = 792, regions = null } = {}) {
  if (!(lexicon instanceof Set) || !items?.length) return items || [];
  const rects = regions || (rules ? ruledRegions(rules, pageW, pageH) : []);
  const cores = items.map((item) => wordCore(item?.str || "").toLowerCase());
  const counts = new Map();
  cores.forEach((core, index) => {
    if (core.length < 4) return;
    if (rects.length && inRuledRegion(boxOf(items[index]), rects)) return;
    counts.set(core, (counts.get(core) || 0) + 1);
  });
  return items.map((item, index) => {
    const core = cores[index];
    if (!item || core.length < 4 || known(lexicon, core)) return item;
    if (rects.length && inRuledRegion(boxOf(item), rects)) return item;
    const mine = counts.get(core) || 0;
    let best = null;
    let bestN = 0;
    for (const [word, n] of counts) {
      if (word === core || Math.abs(word.length - core.length) > 1) continue;
      if (editDistance(core, word) !== 1) continue;
      // Dropping the plural s is not a spelling fix.
      if (dropsPlural(core, word)) continue;
      const inLex = known(lexicon, word);
      const ok = (inLex && n >= 2 && n >= mine * 2) || (!inLex && n >= 3 && n >= mine * 3);
      if (!ok) continue;
      if (betterCount(n, bestN, word, best, inLex)) { best = { word, known: inLex }; bestN = n; }
    }
    if (!best) return item;
    const str = replaceCore(item.str, core, best.word);
    return str === item.str ? item : { ...item, str };
  });
}

export function chooseReading(vision, other, lexicon) {
  const v = vision?.str ?? "";
  const o = other?.str ?? "";
  if (!o) return v;
  if (v.replace(/\s+/g, "").toLowerCase() === o.replace(/\s+/g, "").toLowerCase()) return v;
  // A number stays with Vision when Vision itself read a number (`1.53` vs `l.53`).
  // A letter where the other engine read a number is the number (`energy` vs `39.87`).
  if (digitHeavy(v)) return v;
  if (digitHeavy(o)) return o;
  const vc = letterCore(v);
  const oc = letterCore(o);
  if (!oc) return v;
  if (!vc) return o;
  const vl = known(lexicon, vc.toLowerCase());
  const ol = known(lexicon, oc.toLowerCase());
  const d = editDistance(vc.toLowerCase(), oc.toLowerCase());
  // The printed token is several real words, or a plural the list does not have.
  // Replacing it with the other engine's shorter lexicon word deletes letters.
  const piece = oc.toLowerCase();
  if (!vl && ol && vc.toLowerCase().includes(piece) && vc.length >= piece.length + 2 && segmentsIntoWords(vc, lexicon)) return v;
  if (dropsPlural(vc, oc)) return v;
  if (ol && !vl) return o;
  if (vl && !ol) return v;
  if (d === 0) {
    const hyphen = (text) => /[A-Za-z]-$/.test(String(text).trim());
    if (hyphen(o) && !hyphen(v)) return o;
    return v;
  }
  if (d <= 2) return o;
  if (!vl && !ol && d <= 4) return o;
  return v;
}

function lineClusters(items) {
  const entries = items.map((item, index) => ({ item, index, box: boxOf(item) }));
  entries.sort((a, b) => a.box[3] - b.box[3] || a.box[0] - b.box[0]);
  const lines = [];
  for (const entry of entries) {
    const size = Math.max(6, entry.box[3] - entry.box[1]);
    const line = lines.find((row) => Math.abs(row.base - entry.box[3]) <= 0.45 * size);
    if (line) {
      line.items.push(entry);
      line.base = line.items.reduce((sum, row) => sum + row.box[3], 0) / line.items.length;
    } else lines.push({ base: entry.box[3], items: [entry] });
  }
  return lines;
}

function centersClose(a, b) {
  const size = Math.max(6, Math.min(Math.max(1, a[3] - a[1]), Math.max(1, b[3] - b[1])));
  return Math.abs((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2) <= 0.55 * size && horizRatio(a, b) >= 0.55;
}

function sameSpelling(a, b) {
  const left = letterCore(a).toLowerCase();
  const right = letterCore(b).toLowerCase();
  return Boolean(left) && left.length >= 4 && (left === right || editDistance(left, right) <= 1);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

// An inserted word keeps the host line's size and baseline. A shorter box a couple
// of points off the row is classified as a subscript and glued to the previous word.
function snapOnto(item, line) {
  const hosts = line.items.map((entry) => entry.item).filter((it) => it?.transform);
  if (!hosts.length) return { ...item, fontName: item.fontName || "ocr" };
  const size = median(hosts.map((it) => Math.abs(Number(it.transform[0]) || it.height || 10)));
  const base = median(hosts.map((it) => Number(it.transform[5]) || 0));
  const sample = hosts[hosts.length >> 1];
  const sampleBase = Number(sample.transform[5]) || base;
  const y0 = Number.isFinite(Number(sample.y0)) ? base + (Number(sample.y0) - sampleBase) : base - 0.8 * size;
  const y1 = Number.isFinite(Number(sample.y1)) ? base + (Number(sample.y1) - sampleBase) : base + 0.22 * size;
  const x = Number(item.transform?.[4]) || 0;
  return {
    ...item,
    fontName: item.fontName || "ocr",
    height: Math.max(1, Math.abs(y1 - y0)),
    y0,
    y1,
    transform: [size, 0, 0, size, x, base],
  };
}

function voteItems(visionItems, otherItems, lexicon, regions) {
  const pairs = [];
  const vBoxes = visionItems.map(boxOf);
  const oBoxes = otherItems.map(boxOf);
  for (let i = 0; i < visionItems.length; i += 1) {
    for (let j = 0; j < otherItems.length; j += 1) {
      const score = iou(vBoxes[i], oBoxes[j]);
      if (score >= IOU_MIN) pairs.push([score, i, j]);
    }
  }
  pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const usedV = new Set();
  const usedO = new Set();
  const match = new Map();
  for (const [, i, j] of pairs) {
    if (usedV.has(i) || usedO.has(j)) continue;
    usedV.add(i);
    usedO.add(j);
    match.set(i, j);
  }
  for (let i = 0; i < visionItems.length; i += 1) {
    if (usedV.has(i)) continue;
    let best = -1;
    let bestScore = 0;
    for (let j = 0; j < otherItems.length; j += 1) {
      if (usedO.has(j) || !centersClose(vBoxes[i], oBoxes[j])) continue;
      if (!sameSpelling(visionItems[i]?.str, otherItems[j]?.str)) continue;
      const score = horizRatio(vBoxes[i], oBoxes[j]);
      if (score > bestScore) { best = j; bestScore = score; }
    }
    if (best < 0) continue;
    usedV.add(i);
    usedO.add(best);
    match.set(i, best);
  }
  const next = visionItems.map((item, i) => {
    if (regions.length && inRuledRegion(vBoxes[i], regions)) return item;
    const j = match.get(i);
    if (j == null) return item;
    const str = chooseReading(item, otherItems[j], lexicon);
    return str === item.str ? item : { ...item, str };
  });
  const lines = lineClusters(visionItems);
  const added = [];
  otherItems.forEach((item, j) => {
    if (usedO.has(j) || added.length >= INSERT_CAP) return;
    if (digitHeavy(item?.str)) return;
    const core = wordCore(item?.str || "").toLowerCase();
    if (core.length < 4 || !known(lexicon, core)) return;
    const box = oBoxes[j];
    if (regions.length && inRuledRegion(box, regions)) return;
    const line = lines.find((row) => {
      const top = Math.min(...row.items.map((entry) => entry.box[1]));
      const bot = Math.max(...row.items.map((entry) => entry.box[3]));
      const size = Math.max(6, bot - top);
      return box[3] >= top - 0.3 * size && box[1] <= bot + 0.3 * size;
    });
    if (!line || line.items.length < 2) return;
    if (line.items.some((entry) => horizRatio(box, entry.box) > 0.3)) return;
    const gap = 0.35 * Math.max(6, box[3] - box[1]);
    const crowded = line.items.some((entry) => {
      const host = entry.box;
      const space = box[0] >= host[2] ? box[0] - host[2] : host[0] >= box[2] ? host[0] - box[2] : 0;
      return space < gap;
    });
    if (crowded) return;
    added.push(snapOnto(item, line));
  });
  added.sort((a, b) => boxOf(a)[1] - boxOf(b)[1] || boxOf(a)[0] - boxOf(b)[0]);
  return preferSpellings([...next, ...added], lexicon, { regions });
}

// `otherPages` are PP-OCR page records. Vision pages keep their engine tag (unset
// or whatever the helper wrote). They are not marked `ppocr-web`, so the line
// re-read does not send them back through Vision.
export function voteOcrBodies(visionPages, otherPages, lexicon) {
  const words = lexicon instanceof Set ? lexicon : null;
  const byN = new Map((otherPages || []).map((page) => [page.n, page]));
  return (visionPages || []).map((page) => {
    if (!page || page.engine === "ppocr-web") return page;
    // The printed-text model rewrites unknown words. On a weak page that rewrite
    // is worse than Vision, so the page is left as read and marked for a text model.
    if (weakOcrPage(page.items, words)) return { ...page, weakText: true };
    const other = byN.get(page.n);
    const regions = ruledRegions(page.rules, page.w, page.h);
    const items = voteItems(page.items || [], other?.items || [], words, regions);
    return { ...page, items };
  });
}

// Bench wrapper: page OCR is voted; cell re-reads stay on `vision` alone.
export function votingHelper({ vision, alt = null, lexicon = null } = {}) {
  if (!vision || typeof vision.ocr !== "function") throw new Error("voting helper needs a vision ocr");
  return {
    async ocr(req = {}) {
      const body = await vision.ocr(req);
      if (req.cells || !alt || typeof alt.ocr !== "function" || !body?.pages) return body;
      let words = lexicon;
      if (typeof words === "function") {
        try { words = await words(); } catch { words = null; }
      }
      let otherPages = [];
      try {
        const other = await alt.ocr({ pages: req.pages, signal: req.signal });
        otherPages = other?.pages || [];
      } catch (error) {
        if (error?.name === "AbortError") throw error;
      }
      return { ...body, pages: voteOcrBodies(body.pages, otherPages, words instanceof Set ? words : null) };
    },
  };
}

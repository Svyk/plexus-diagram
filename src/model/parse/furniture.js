// Parse step: running headers, footers and page numbers across parsed pages. Pure.

const PAGE_NUM_RE = /^(\d+|page\s+\d+(\s+of\s+\d+)?|[-–]\s*\d+\s*[-–]|\d+\s*\/\s*\d+)$/i;

// Top and bottom fraction of the page where running headers and footers sit.
export const FURNITURE_BAND = 0.08;
// A single scanned technical note puts its banner a little below the 8% band.
const SCAN_BAND = 0.12;

// A short running banner on a scanned NACA-style note, including Vision's usual
// misreads ("1•A.C.A. Tochnical Noto No. 426"). Not a recurring-header rule.
export function isScanBanner(text) {
  const t = String(text || "").replace(/[•·∙⋅]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length < 8 || t.length > 90) return false;
  const numbered = /\bno\s*\.?\s*\d/i.test(t) || /\b\d{2,4}\b/.test(t);
  if (/\ba\s*\.?\s*c\s*\.?\s*a\b/i.test(t) && /\bno\s*\.?\s*\d/i.test(t)) return true;
  if (/\bt[oe]chnical\s+not[eo]\b/i.test(t) && numbered) return true;
  return false;
}

export function normalizeFurniture(text) {
  return text.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

// A HathiTrust handle, a Google Books footer, or "Original from" on its own line.
// A sentence that merely mentions the project is longer than the stamp.
export function isRepoStamp(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 160) return false;
  if (/hdl\.handle\.net|hathitrust\.org|books\.google\./i.test(t)) return t.length <= 120;
  if (/^original\s+from$/i.test(t)) return true;
  const digitized = t.match(/^digitized\s+(?:by\s+)?google\b(.*)$/i);
  if (!digitized) return false;
  const rest = digitized[1].replace(/^[\s,.:;-]+/, "").trim();
  return !rest || rest.length <= 40 || isInstitutionLine(rest);
}

// "PRINCETON UNIVERSITY": the library named on a Google Books footer, not a sentence.
function isInstitutionLine(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 40 || /[.,:;]/.test(t)) return false;
  const words = t.split(" ");
  if (words.length < 1 || words.length > 5) return false;
  return words.every((word) => word.length >= 2 && /^[A-Z]+$/.test(word));
}

// pages: [{ n, h, lines }] ; returns { removed: [{page, bbox, text, reason}], isFurniture(line, n) }
export function findFurniture(pages, { band = FURNITURE_BAND } = {}) {
  const n = pages.length;
  const need = Math.max(2, Math.min(3, n), Math.ceil(n * 0.5));
  const candidates = new Map(); // key -> [{page, line, y}]
  const cand = (line, page, where) => {
    const key = `${where}|${normalizeFurniture(line.text)}`;
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push({ page, line, y: line.base });
  };
  const alone = new Set();
  for (const pg of pages) {
    for (const line of pg.lines) {
      const mid = (line.y0 + line.y1) / 2;
      if (mid <= pg.h * band) cand(line, pg.n, "top");
      else if (mid >= pg.h * (1 - band)) cand(line, pg.n, "bottom");
      else continue;
      // A page number stands alone on its baseline; a year in a table header row does not.
      if (!pg.lines.some((o) => o !== line && Math.abs(o.base - line.base) <= 0.3 * Math.max(o.size, line.size))) alone.add(line);
    }
  }
  const removed = [];
  const marks = new Set();
  for (const [key, list] of candidates) {
    const pagesSeen = new Set(list.map((e) => e.page));
    const recurring = pagesSeen.size >= need && n >= 2;
    for (const e of list) {
      const text = e.line.text.trim();
      const pageNum = PAGE_NUM_RE.test(text) && alone.has(e.line);
      let ok = pageNum;
      if (recurring) {
        const ys = list.filter((o) => o.page !== e.page).map((o) => o.y);
        ok = ok || ys.some((y) => Math.abs(y - e.y) <= 3) || ys.length === 0;
      }
      if (!ok) continue;
      const where = key.startsWith("top") ? "running-header" : "running-footer";
      marks.add(e.line);
      removed.push({ page: e.page, bbox: [r2(e.line.x0), r2(e.line.y0), r2(e.line.x1), r2(e.line.y1)], text, reason: pageNum && !recurring ? "page-number" : where });
    }
  }
  // One scanned page has no second copy of the banner, so the recurring rule never
  // sees it. Drop that line, and a bare page number that shares its baseline.
  for (const pg of pages) {
    const banners = pg.lines.filter((line) => !marks.has(line) && inTop(line, pg, SCAN_BAND) && isScanBanner(line.text));
    for (const line of banners) {
      marks.add(line);
      removed.push({ page: pg.n, bbox: lineBox(line), text: line.text.trim(), reason: "scan-banner" });
    }
    if (!banners.length) continue;
    for (const line of pg.lines) {
      if (marks.has(line) || !inTop(line, pg, SCAN_BAND)) continue;
      if (!PAGE_NUM_RE.test(String(line.text || "").trim())) continue;
      const size = line.size || 10;
      const others = pg.lines.filter((o) => o !== line && Math.abs(o.base - line.base) <= 0.3 * Math.max(o.size || size, size));
      if (others.length && !others.every((o) => marks.has(o))) continue;
      marks.add(line);
      removed.push({ page: pg.n, bbox: lineBox(line), text: line.text.trim(), reason: "page-number" });
    }
  }
  // One scanned page never sees the footer twice, so a digitization stamp would
  // stay in the text. The stamp is the line itself, not a repeated banner.
  for (const pg of pages) {
    const stamps = pg.lines.filter((line) => !marks.has(line) && isRepoStamp(line.text));
    for (const line of stamps) {
      marks.add(line);
      removed.push({ page: pg.n, bbox: lineBox(line), text: line.text.trim(), reason: "repo-stamp" });
    }
    if (!stamps.length && !pg.lines.some((line) => isRepoStamp(line.text))) continue;
    for (const line of pg.lines) {
      if (marks.has(line) || !isInstitutionLine(line.text)) continue;
      const mid = ((line.y0 || 0) + (line.y1 || 0)) / 2;
      if (!(pg.h > 0) || mid < pg.h * (1 - band)) continue;
      marks.add(line);
      removed.push({ page: pg.n, bbox: lineBox(line), text: line.text.trim(), reason: "repo-stamp" });
    }
  }
  removed.sort((a, b) => a.page - b.page || a.bbox[1] - b.bbox[1]);
  return { removed, isFurniture: (line) => marks.has(line) };
}

function inTop(line, page, band) {
  const mid = ((line.y0 || 0) + (line.y1 || 0)) / 2;
  return page.h > 0 && mid >= 0 && mid <= page.h * band;
}

function lineBox(line) {
  return [r2(line.x0), r2(line.y0), r2(line.x1), r2(line.y1)];
}

function r2(v) { return Math.round(v * 100) / 100; }

// A 90° word stored as an upright OCR item: the helper puts the tall box's height
// in the font size and the short side in the width. A horizontal word of four
// letters is wider than its em. Body-size squeezed words stay under this size.
export function isVerticalOcrWord(word) {
  const text = String(word?.text || "").replace(/\s+/g, "");
  if (text.length < 4) return false;
  const width = (word.x1 ?? 0) - (word.x0 ?? 0);
  const size = Number(word.size) || 0;
  if (size < 14 || !(width > 0)) return false;
  return width < 0.55 * size;
}

function inMargin(x, y, w, h, band) {
  if (!(w > 0) || !(h > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  return x <= w * band || x >= w * (1 - band) || y <= h * band || y >= h * (1 - band);
}

function quarterTurn(angle) {
  const a = Math.abs(Number(angle) || 0);
  return Math.abs(a - Math.PI / 2) < 0.2 || Math.abs(a - (3 * Math.PI) / 2) < 0.2;
}

// A sideways "Fig. 2" or "Tafel III" in the margin is the plate's caption, not a running title.
function marginCaption(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return /^(?:fig(?:ure)?s?|plates?|abb(?:ildung)?|tafeln?|tafel|taf)\b/i.test(t);
}

// Pull 90° margin text out of the line list. OCR often emits the sideways running
// title ("NOTIFIABLE" / "DISEASES") as a huge upright word; a text layer emits it
// with a quarter-turn matrix. Either one is furniture, not a heading or a title.
// `band` is the same edge fraction as running headers. Returns the kept lines and
// `{text, bbox}` rows (page is filled in by the assembler).
// A slash between two tall words is still the sideways running title. A short
// token must not keep the line. A tall box with no tall word is a caption
// fragment, and dropping it moves the lines beside it.
function sidewaysMarginLine(line) {
  const words = line?.words || [];
  const long = words.filter((word) => String(word?.text || "").replace(/\s+/g, "").length >= 4);
  return long.length > 0 && long.every((word) => isVerticalOcrWord(word));
}

export function dropMarginRotated(lines, rotated, { w = 0, h = 0, band = FURNITURE_BAND } = {}) {
  const kept = [];
  const removed = [];
  for (const line of lines || []) {
    const mx = ((line?.x0 ?? 0) + (line?.x1 ?? 0)) / 2;
    const my = line?.base ?? ((line?.y0 ?? 0) + (line?.y1 ?? 0)) / 2;
    if (inMargin(mx, my, w, h, band) && sidewaysMarginLine(line)) {
      const text = String(line.text || "").replace(/\s+/g, " ").trim();
      if (!marginCaption(text)) {
        if (text) removed.push({ text, bbox: [r2(line.x0), r2(line.y0), r2(line.x1), r2(line.y1)] });
        continue;
      }
    }
    kept.push(line);
  }
  for (const piece of rotated || []) {
    if (!quarterTurn(piece?.angle)) continue;
    const text = String(piece.text || "").replace(/\s+/g, " ").trim();
    if (text.length < 4) continue;
    if (!inMargin(piece.x0, piece.base, w, h, band)) continue;
    const advance = Math.abs((piece.x1 ?? piece.x0) - piece.x0);
    const size = piece.size || 8;
    const top = Math.max(0, Math.min(piece.base, piece.base - advance));
    const bot = Math.min(h || Infinity, Math.max(piece.base, piece.base - advance));
    if (marginCaption(text)) {
      const x0 = piece.x0;
      const x1 = Math.min(w || x0 + size, x0 + size);
      kept.push({
        text,
        words: [{ text, x0, x1, y0: top, y1: bot, base: piece.base, size }],
        x0, y0: top, x1, y1: bot, base: piece.base, size, chars: text.length,
      });
      continue;
    }
    removed.push({
      text,
      bbox: [r2(piece.x0), r2(top), r2(Math.min(w || piece.x0 + size, piece.x0 + size)), r2(bot)],
    });
  }
  return { lines: kept, removed };
}

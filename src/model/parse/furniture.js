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

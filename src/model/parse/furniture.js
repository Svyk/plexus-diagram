// Parse step: running headers, footers and page numbers across parsed pages. Pure.

const PAGE_NUM_RE = /^(\d+|page\s+\d+(\s+of\s+\d+)?|[-–]\s*\d+\s*[-–]|\d+\s*\/\s*\d+)$/i;

export function normalizeFurniture(text) {
  return text.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

// pages: [{ n, h, lines }] ; returns { removed: [{page, bbox, text, reason}], isFurniture(line, n) }
export function findFurniture(pages, { band = 0.08 } = {}) {
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
  removed.sort((a, b) => a.page - b.page || a.bbox[1] - b.bbox[1]);
  return { removed, isFurniture: (line) => marks.has(line) };
}

function r2(v) { return Math.round(v * 100) / 100; }

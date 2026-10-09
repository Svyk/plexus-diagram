// Parse step: the paper's title from the page text, not from a running header. Pure.
import { isBannerOf, isGibberishTitle, isJunkTitleText, titleWordCount } from "../title-cap.js";
import { normalizeFurniture } from "./furniture.js";

const MAX_LINES = 6;
const MAX_WORDS = 45;

function textOf(line) {
  return line.words.filter((w) => !w.sup && !w.sub).map((w) => w.text).join(" ").replace(/\s+/g, " ").trim();
}

// Stack consecutive candidate lines of one size and weight into one title block. Returns the
// block with the biggest type, bold before regular at one size, then the one higher on the page.
// A block whose words sit again inside a running header or another line with only volume, year and
// page numbers around them is the journal banner, not the title.
export function findPageTitle(pages, { bodySize = 10, removed = [] } = {}) {
  const furniture = new Set(removed.map((r) => normalizeFurniture(r.text || "")));
  const running = removed.filter((r) => r && r.reason !== "page-number" && r.text).map((r) => r.text);
  const pageLines = pages.flatMap((pg) => (pg && !pg.ocr && pg.kind !== "scan" ? (pg.free || []).map(textOf) : []));
  const banner = (text) => running.some((line) => isBannerOf(text, line, { exact: false }))
    || pageLines.some((line) => isBannerOf(text, line, { exact: false }));
  for (const pg of pages) {
    if (!pg || pg.ocr || pg.kind === "scan") continue;
    const lines = (pg.free || []).map((line) => ({ line, text: textOf(line) }))
      .filter((c) => c.text && !isJunkTitleText(c.text) && !isGibberishTitle(c.text) && !furniture.has(normalizeFurniture(c.text)))
      .sort((a, b) => a.line.base - b.line.base || a.line.x0 - b.line.x0);
    const blocks = [];
    let cur = null;
    for (const c of lines) {
      const { line } = c;
      const prev = cur && cur.items[cur.items.length - 1].line;
      // A wrapped title's second line can be a little smaller (small caps, a patent (54) wrap)
      // when it sits on the next baseline and overlaps the first line.
      const sizeOk = prev && (Math.abs(line.size - prev.size) <= 0.5
        || (line.size <= prev.size && line.size >= 0.8 * prev.size && line.base - prev.base <= 0.95 * prev.size));
      const near = prev && sizeOk && line.base - prev.base <= 2.2 * line.size && line.base > prev.base + 0.5 * line.size
        && Boolean(line.bold) === Boolean(prev.bold)
        && line.x0 < prev.x1 && line.x1 > prev.x0 && cur.items.length < MAX_LINES;
      if (near) cur.items.push(c);
      else { cur = { items: [c] }; blocks.push(cur); }
    }
    let best = null;
    for (const b of blocks) {
      const first = b.items[0].line;
      const text = b.items.map((c) => c.text).join(" ").replace(/^\(\s*\d+\s*\)\s*/, "").replace(/\s+/g, " ").trim();
      const words = titleWordCount(text);
      if (words < 3 || words > MAX_WORDS || isJunkTitleText(text) || isGibberishTitle(text)) continue;
      if (!(first.size > 1.1 * bodySize || (first.bold && first.size >= bodySize - 0.3))) continue;
      if (banner(text)) continue;
      const cand = { text, size: first.size, bold: Boolean(first.bold), y: first.base, page: pg.n };
      if (!best || cand.size > best.size + 0.5 || (Math.abs(cand.size - best.size) <= 0.5 && ((cand.bold && !best.bold) || (cand.bold === best.bold && cand.y < best.y)))) best = cand;
    }
    if (best) return best.text;
  }
  return "";
}

// Lines from a top-band read of a scan, as an ordinary page (not flagged ocr), so the same
// title rule applies. bodySize stays the print body (about 10 pt) when the band is mostly the title.
export function titleFromBand(lines, { bodySize = 10 } = {}) {
  if (!lines?.length) return "";
  return findPageTitle([{ n: 1, free: lines }], { bodySize }) || "";
}

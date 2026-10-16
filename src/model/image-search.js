// Search over images: graph images and parsed-PDF figures. Words match the name, caption, page title, and any text read from
// the image. Colour words (red, #1e90ff) rank by palette. Pure: records come from the host image index.

import { COLOR_MIN_SCORE, colorQuery, colorScore, paletteDistance } from "./color.js";
import { parsePageRange, queryTerms } from "./library.js";
import { partSnippet } from "./parts-search.js";

// { words, colors } from a query. A quoted phrase stays a word.
export function splitImageQuery(text) {
  const words = [];
  const colors = [];
  const raw = String(text ?? "");
  const quoted = new Set();
  for (const m of raw.matchAll(/"([^"]*)"/g)) quoted.add(m[1].replace(/\s+/g, " ").trim().toLowerCase());
  for (const term of queryTerms(raw)) {
    const target = quoted.has(term) ? null : colorQuery(term);
    if (target) colors.push(target); else words.push(term);
  }
  return { words, colors };
}

// The query without its colour tokens, for a host query that only knows words.
export function stripColorWords(text) {
  return splitImageQuery(text).words.map((w) => (/\s/.test(w) ? `"${w}"` : w)).join(" ");
}

// items: [{ key, hay (lowercased name/caption), page?, ...passthrough }]. records: Map key -> index record.
// Ranked by colour score, then word hits, then input order. Each result gets palette (top 3 hex) and colorScore.
export function searchImages(items, records, { text = "", pages = "" } = {}, limit = 40) {
  const { words, colors } = splitImageQuery(text);
  const range = parsePageRange(pages);
  const hits = [];
  let seq = 0;
  for (const item of Array.isArray(items) ? items : []) {
    seq += 1;
    if (range && !(item.page >= range.from && item.page <= range.to)) continue;
    const rec = records?.get?.(item.key) || null;
    const ok = Boolean(rec) && !rec.failed;
    let score = 0;
    if (colors.length) {
      if (!ok || !rec.palette) continue;
      let all = true;
      for (const c of colors) {
        const s = colorScore(rec.palette, c);
        if (s < COLOR_MIN_SCORE) { all = false; break; }
        score += s;
      }
      if (!all) continue;
    }
    let source = "";
    if (words.length) {
      source = ok && rec.text ? `${item.hay}\n${String(rec.text)}` : item.hay;
      const hay = source.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
    }
    hits.push({ item, score, seq, palette: ok ? rec.palette : null, source });
  }
  hits.sort((a, b) => b.score - a.score || a.seq - b.seq);
  return hits.slice(0, Math.max(1, Math.floor(Number(limit) || 40))).map(({ item, palette, score, source }) => {
    const row = {
      ...item,
      palette: palette ? palette.slice(0, 3).map((p) => p.hex) : [],
      colorScore: score,
    };
    if (source) {
      const snip = partSnippet(source, words.join(" "));
      const shown = `${snip.before}${snip.hit}${snip.after}`.trim();
      if (shown) row.snippet = shown;
    }
    return row;
  });
}

export const SIMILAR_LIMIT = 40;

// "More like this": every indexed item except the source, nearest palette first. Items without a palette are left out.
// Same row shape as searchImages. `pages` is not applied; the source is the whole query. Ties keep input order.
export function similarImages(items, records, sourceKey, limit = SIMILAR_LIMIT) {
  const source = records?.get?.(sourceKey) || null;
  if (!source || source.failed || !Array.isArray(source.palette) || !source.palette.length) return { ok: false, rows: [] };
  const hits = [];
  let seq = 0;
  for (const item of Array.isArray(items) ? items : []) {
    seq += 1;
    if (item.key === sourceKey) continue;
    const rec = records.get(item.key);
    if (!rec || rec.failed || !Array.isArray(rec.palette) || !rec.palette.length) continue;
    const distance = paletteDistance(source.palette, rec.palette);
    if (Number.isFinite(distance)) hits.push({ item, distance, seq, palette: rec.palette });
  }
  hits.sort((a, b) => a.distance - b.distance || a.seq - b.seq);
  const rows = hits.slice(0, Math.max(1, Math.floor(Number(limit) || SIMILAR_LIMIT))).map(({ item, palette, distance }) => ({
    ...item,
    palette: palette.slice(0, 3).map((p) => p.hex),
    distance,
  }));
  return { ok: true, rows };
}

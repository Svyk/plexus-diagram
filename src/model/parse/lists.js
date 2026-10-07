// Parse step: bullet and numbered lists from lines (text markers or vector dots). Pure.

export const MARKER_RE = /^([•◦▪■●○–—\-\*·]|\(?\d{1,3}[.)]|\(?[a-z][.)]|\(?[ivx]{1,5}[.)])$/;

export function markerOf(line, dots = []) {
  const first = line.words[0];
  if (!first) return null;
  if (MARKER_RE.test(first.text) && line.words.length > 1) {
    return { marker: first.text, markerX: first.x0, textX: line.words[1].x0, textWords: line.words.slice(1) };
  }
  // Vector bullet drawn left of the line, vertically on its x-height band.
  const yMid = line.base - 0.35 * line.size;
  for (const d of dots) {
    if (d.x < line.x0 - 3 * line.size || d.x >= line.x0) continue;
    if (Math.abs(d.y - yMid) > 0.6 * line.size) continue;
    return { marker: "•", markerX: d.x - d.r, textX: line.x0, textWords: line.words };
  }
  return null;
}

function markerKind(marker) {
  const m = marker.replace(/[().]/g, "");
  if (/^\d+$/.test(m)) return "num";
  if (/^[ivx]+$/i.test(m)) return "roman";
  if (/^[a-z]$/i.test(m)) return "alpha";
  return "bullet";
}

// lines: ordered lines of one column (already free of tables and furniture).
// Returns [{ start, end, items:[{text, level, marker, lines}] , ordered }] over line indexes.
export function detectLists(lines, { dots = [], joinText }) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const m = markerOf(lines[i], dots);
    if (!m) { i++; continue; }
    const items = [];
    let j = i;
    let last = null;
    while (j < lines.length) {
      const line = lines[j];
      const mk = markerOf(line, dots);
      if (mk) {
        if (last && line.base - last.base > 2.2 * line.size) break;
        items.push({ marker: mk.marker, markerX: mk.markerX, textX: mk.textX, lines: [{ ...line, words: mk.textWords, text: mk.textWords.map((w) => w.text).join(" ") }] });
        last = line;
        j++;
        continue;
      }
      const item = items[items.length - 1];
      const cont = item && line.x0 >= item.textX - 0.5 * line.size && line.base - last.base <= 1.7 * line.size
        && Math.abs(line.size - last.size) <= 0.6;
      if (!cont) break;
      item.lines.push(line);
      last = line;
      j++;
    }
    const kinds = items.map((it) => markerKind(it.marker));
    const ordered = kinds.every((k) => k !== "bullet");
    const enough = items.length >= 2 || (items.length === 1 && kinds[0] === "bullet");
    if (enough) {
      const xs = items.map((it) => it.markerX);
      const levels = clusterLevels(xs);
      out.push({
        start: i,
        end: j,
        ordered,
        items: items.map((it, k) => ({
          text: joinText ? joinText(it.lines) : it.lines.map((l) => l.text).join(" "),
          level: levels[k],
          marker: it.marker,
          lines: it.lines,
        })),
      });
    }
    i = j;
  }
  return out;
}

function clusterLevels(xs) {
  const centers = [];
  for (const x of xs) {
    if (!centers.some((c) => Math.abs(c - x) <= 6)) centers.push(x);
  }
  centers.sort((a, b) => a - b);
  return xs.map((x) => {
    let best = 0;
    for (let i = 0; i < centers.length; i++) if (Math.abs(centers[i] - x) < Math.abs(centers[best] - x)) best = i;
    return best;
  });
}

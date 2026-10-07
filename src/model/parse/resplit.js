// User-dragged column boundaries -> rebuilt cells. Pure.

import { cellTextOf, isNumericText } from "./lattice.js";
import { round } from "./lines.js";

// table: pxd-parse table block; words: the table's words (x0,x1,base,size,...); xs: new boundaries.
export function resplitColumns(table, words, xs) {
  const bounds = [...xs].sort((a, b) => a - b);
  if (bounds.length < 2) return table;
  const ys = table.grid && table.grid.ys && table.grid.ys.length >= 2 ? table.grid.ys : [table.bbox[1], table.bbox[3]];
  const rows = ys.length - 1;
  const cols = bounds.length - 1;
  const buckets = new Map();
  for (const w of words) {
    const cx = (w.x0 + w.x1) / 2;
    const cy = w.base - 0.3 * w.size;
    let c = -1;
    for (let i = 0; i < cols; i++) if (cx >= bounds[i] && cx < bounds[i + 1]) { c = i; break; }
    if (c < 0) c = cx < bounds[0] ? 0 : cols - 1;
    let r = -1;
    for (let j = 0; j < rows; j++) if (cy >= ys[j] && cy < ys[j + 1]) { r = j; break; }
    if (r < 0) r = cy < ys[0] ? 0 : rows - 1;
    const key = `${r}:${c}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(w);
  }
  const headerRows = Math.min(table.headerRows || 0, rows);
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ws = buckets.get(`${r}:${c}`) || [];
      const text = cellTextOf(ws);
      cells.push({
        r, c, rowSpan: 1, colSpan: 1, text,
        header: r < headerRows,
        bbox: [round(bounds[c]), round(ys[r]), round(bounds[c + 1]), round(ys[r + 1])],
        align: "left",
        numeric: isNumericText(text),
      });
    }
  }
  for (let c = 0; c < cols; c++) {
    const body = cells.filter((k) => k.c === c && !k.header && k.text);
    if (body.length && body.filter((k) => k.numeric).length >= 0.8 * body.length) for (const k of body) k.align = "right";
  }
  return {
    ...table,
    rows, cols, headerRows, headerCols: 0,
    cells, method: "stream",
    grid: { xs: bounds.map(round), ys: ys.map(round) },
    bbox: [round(bounds[0]), round(ys[0]), round(bounds[cols]), round(ys[rows])],
  };
}

// OCR table repair. Pure. Numeric columns get their digit confusions mapped back, year header
// rows are made consecutive, dotted note rows become one spanning cell, and cells the helper
// re-read at 3x are accepted when they fit the column. Text columns are never "corrected".

import { isNumericText } from "./lattice.js";

export const LOW_CONF = 0.3;
export const NUMERIC_COLUMN_SHARE = 0.8;

// Confusions seen in Vision output on 200 dpi scans. Letters that only look like digits.
const DIGIT_MAP = { O: "0", o: "0", D: "0", Q: "0", B: "8", S: "5", s: "5", l: "1", I: "1", "|": "1", Z: "2", G: "6", "Б": "6", "б": "6", "А": "4" };
const NUMERIC_LIKE_RE = /^[\dOoDQBSslIZGБбА|.,()%+\-–—\s]+$/;
const PLACEHOLDER_RE = /^(?:[-–—]{1,3}|\*{1,3}|n\/?a|nn)$/i;

export function isPlaceholder(text) {
  return PLACEHOLDER_RE.test(String(text || "").trim());
}

// Digit-like characters only, with a real digit somewhere or a decimal mark between two of
// them ("D.OD"): "BOB" is a word, not a number.
export function numericLike(text) {
  const s = String(text || "").trim();
  return s.length > 0 && NUMERIC_LIKE_RE.test(s) && (/\d/.test(s) || /[OoDQBSslIZGБб]\s*[.,]\s*[OoDQBSslIZGБб]/.test(s));
}

// Decimal style of a column: "." when most numeric values use a period, "," when a comma.
export function decimalStyle(values) {
  let period = 0;
  let comma = 0;
  for (const v of values) {
    if (/\d\.\d/.test(v)) period++;
    if (/\d,\d{1,2}(?!\d)/.test(v)) comma++;
  }
  if (!period && !comma) return null;
  return period >= comma ? "." : ",";
}

// Map one token. Returns the repaired text, or null when the result is still not a number.
export function repairNumber(text, { decimal = ".", leadingZero = true } = {}) {
  let s = String(text || "").trim();
  if (!s) return s;
  // A bar on both sides of a digit, or a trailing bar after one, is a cell rule the
  // nearest-neighbour upscale glued on ("|2|", "5|"). A leading bar still stands for 1 ("|0").
  s = s.replace(/^\|+(\d[\d.,]*)\|+$/, "$1").replace(/(\d)\|+$/, "$1");
  // Stray spaces inside a number ("28. 90", "1 .16").
  s = s.replace(/(\d)\s*([.,])\s*(\d)/g, "$1$2$3").replace(/(\d)\s+(\d)/g, "$1$2");
  // The column's decimal mark: "1,5" in a period column is 1.5 (a thousands comma has three digits).
  const toStyle = (v) => (decimal === "." ? v.replace(/^(\d+),(\d{1,2})$/, "$1.$2") : decimal === "," ? v.replace(/^(\d+)\.(\d{1,2})$/, "$1,$2") : v);
  const lead = (v) => (leadingZero ? v.replace(/^([.,])(\d)/, "0$1$2") : v);
  s = lead(toStyle(s));
  if (isNumericText(s) || isPlaceholder(s)) return s;
  if (!numericLike(s)) return null;
  s = lead(toStyle(s.replace(/[OoDQBSslIZGБбА|]/g, (ch) => DIGIT_MAP[ch] ?? ch)));
  return isNumericText(s) ? s : null;
}

function bodyCellsOfColumn(table, c) {
  return table.cells.filter((k) => k.c === c && k.colSpan === 1 && k.r >= (table.headerRows || 0));
}

// Columns where at least `share` of the filled body cells are numbers or placeholders after
// mapping. Repairs cells in place; cells that stay unreadable get `conf` LOW_CONF.
export function repairNumericColumns(table, { share = NUMERIC_COLUMN_SHARE } = {}) {
  const fixed = [];
  const unrepaired = [];
  const numericCols = [];
  for (let c = 0; c < table.cols; c++) {
    const body = bodyCellsOfColumn(table, c).filter((k) => k.text && k.text.trim());
    if (body.length < 2) continue;
    const numeric = body.filter((k) => isNumericText(k.text) || isPlaceholder(k.text));
    const mappable = body.filter((k) => !isNumericText(k.text) && !isPlaceholder(k.text) && numericLike(k.text) && repairNumber(k.text) != null);
    if (numeric.length + mappable.length < share * body.length || numeric.length === 0) continue;
    numericCols.push(c);
    const values = numeric.filter((k) => isNumericText(k.text)).map((k) => k.text);
    const decimal = decimalStyle(values) || ".";
    const leadingZero = !values.some((v) => /^[.,]\d/.test(v));
    for (const cell of body) {
      if (/^[-–—]{1,3}$/.test(cell.text.trim()) && cell.text.trim() !== "—") { cell.text = "—"; cell.numeric = false; continue; }
      if (isNumericText(cell.text) || isPlaceholder(cell.text)) continue;
      const to = repairNumber(cell.text, { decimal, leadingZero });
      if (to != null && to !== cell.text) {
        fixed.push({ r: cell.r, c: cell.c, from: cell.text, to });
        cell.text = to;
        cell.numeric = true;
        cell.repaired = true;
      } else if (to == null) {
        cell.conf = Math.min(cell.conf ?? 1, LOW_CONF);
        unrepaired.push({ r: cell.r, c: cell.c, text: cell.text });
      }
    }
  }
  return { fixed, unrepaired, numericCols };
}

// A header row of four-digit years in steps of ±1: the sequence is fitted by majority vote
// and a cell one character away from its predicted year is a misread ("1876" for 1976).
export function repairYearHeader(table) {
  const fixed = [];
  for (let r = 0; r < (table.headerRows || 0); r++) {
    const row = table.cells.filter((k) => k.r === r && k.colSpan === 1).sort((a, b) => a.c - b.c);
    const years = row.map((k) => (/^\d{4}$/.test(k.text || "") ? Number(k.text) : null));
    if (years.filter((y) => y != null).length < 4) continue;
    for (const step of [-1, 1]) {
      const votes = new Map();
      years.forEach((y, i) => { if (y != null) votes.set(y - step * i, (votes.get(y - step * i) || 0) + 1); });
      let base = null; let n = 0;
      for (const [k, v] of votes) if (v > n) { n = v; base = k; }
      if (n < 0.6 * years.filter((y) => y != null).length || n < 3) continue;
      years.forEach((y, i) => {
        if (y == null) return;
        const want = base + step * i;
        if (want === y || editDistance(String(want), String(y)) !== 1) return;
        fixed.push({ r, c: row[i].c, from: row[i].text, to: String(want) });
        row[i].text = String(want);
        row[i].repaired = true;
      });
      break;
    }
  }
  return fixed;
}

export function editDistance(a, b) {
  const m = a.length; const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

// A body row whose value cells hold one run of words (a note, "NA", "*") and nothing numeric:
// the run spans from the first empty column after the numeric prefix to the last column.
export function spanNoteRows(table, { numericCols = null } = {}) {
  const spans = [];
  const cols = table.cols;
  const numericSet = numericCols ? new Set(numericCols) : null;
  const headerRows = table.headerRows || 0;
  for (let r = headerRows; r < table.rows; r++) {
    const row = table.cells.filter((k) => k.r === r).sort((a, b) => a.c - b.c);
    const values = row.filter((k) => k.c > 0);
    if (values.length < 2) continue;
    const filled = values.filter((k) => k.text && k.text.trim());
    if (!filled.length) continue;
    // Numeric prefix straight after the label.
    let prefixEnd = 0;
    for (const k of values) {
      if (k.c !== prefixEnd + 1 || k.colSpan !== 1 || !isNumericText(k.text)) break;
      prefixEnd = k.c;
    }
    const rest = filled.filter((k) => k.c > prefixEnd);
    if (!rest.length) continue;
    if (rest.some((k) => isNumericText(k.text) && !/^\d{4}$/.test(k.text))) continue;
    let text = rest.map((k) => k.text.trim()).join(" ");
    // The same mark read in two columns ("*" twice) is one mark.
    if (rest.length > 1 && rest.every((k) => isPlaceholder(k.text) && k.text.trim() === rest[0].text.trim())) text = rest[0].text.trim();
    const words = text.split(/\s+/);
    const prose = words.length >= 3 && /[A-Za-z]{3,}/.test(text);
    // A dash is a value of its own cell; "NA" and "*" stand for the rest of the row.
    if (!prose && !(isPlaceholder(text) && !/^[-–—]+$/.test(text))) continue;
    if (numericSet && !rest.every((k) => numericSet.has(k.c) || k.colSpan > 1)) continue;
    const start = prefixEnd + 1;
    const end = cols - 1;
    if (end - start + 1 < 2) continue;
    const first = rest[0];
    const keep = { ...first, c: start, colSpan: end - start + 1, text, align: "center", numeric: false, header: false };
    const removed = new Set(values.filter((k) => k.c >= start).map((k) => `${k.r}:${k.c}`));
    table.cells = table.cells.filter((k) => !(k.r === r && removed.has(`${k.r}:${k.c}`)));
    table.cells.push(keep);
    spans.push({ r, c: start, colSpan: keep.colSpan, text });
  }
  if (spans.length) table.cells.sort((a, b) => a.r - b.r || a.c - b.c);
  return spans;
}

// A body cell spanning columns whose words sit inside one column is a value the stream pass
// widened over an empty neighbour (a digit OCR skipped). Put it back in its column and leave
// the others empty, so the re-read can fill them.
export function unspanNarrowCells(table) {
  const xs = table.grid?.xs;
  if (!xs || xs.length !== table.cols + 1) return [];
  const headerRows = table.headerRows || 0;
  const changed = [];
  const extra = [];
  for (const cell of table.cells) {
    if (cell.r < headerRows || cell.colSpan <= 1 || !cell.wbox || !cell.text) continue;
    const cx = (cell.wbox[0] + cell.wbox[2]) / 2;
    let col = -1;
    for (let c = cell.c; c < cell.c + cell.colSpan; c++) if (cx >= xs[c] && cx <= xs[c + 1]) col = c;
    if (col < 0 || cell.wbox[0] < xs[col] - 1 || cell.wbox[2] > xs[col + 1] + 1) continue;
    for (let c = cell.c; c < cell.c + cell.colSpan; c++) {
      if (c === col) continue;
      extra.push({ r: cell.r, c, rowSpan: cell.rowSpan, colSpan: 1, text: "", header: false, bbox: [xs[c], cell.bbox?.[1] ?? 0, xs[c + 1], cell.bbox?.[3] ?? 0], align: cell.align, numeric: false, conf: 0, wbase: cell.wbase, wsize: cell.wsize });
    }
    changed.push({ r: cell.r, from: cell.c, span: cell.colSpan, to: col });
    cell.c = col;
    cell.colSpan = 1;
    cell.align = "right";
    if (cell.bbox) cell.bbox = [xs[col], cell.bbox[1], xs[col + 1], cell.bbox[3]];
  }
  if (extra.length) { table.cells.push(...extra); table.cells.sort((a, b) => a.r - b.r || a.c - b.c); }
  return changed;
}

// Everything above, in order, for one table on an OCR page.
export function repairOcrTable(table) {
  unspanNarrowCells(table);
  const years = repairYearHeader(table);
  const { fixed, unrepaired, numericCols } = repairNumericColumns(table);
  const spans = spanNoteRows(table, { numericCols });
  return { fixed: [...years, ...fixed], unrepaired, spans, numericCols };
}

// Share of filled body cells in numeric columns that read as numbers or placeholders. The
// scanLayer-vs-fresh choice uses it: more readable numbers wins.
export function tableNumericValidity(table) {
  let total = 0;
  let good = 0;
  for (let c = 1; c < table.cols; c++) {
    const body = bodyCellsOfColumn(table, c).filter((k) => k.text && k.text.trim());
    if (body.length < 2) continue;
    const numeric = body.filter((k) => isNumericText(k.text) || isPlaceholder(k.text));
    if (numeric.length < 0.5 * body.length) continue;
    total += body.length;
    good += numeric.length;
  }
  return { total, good, share: total ? good / total : 0 };
}

// Cells worth a second read: unrepaired numeric cells, and empty body cells of numeric columns
// (a dash or a star the page pass skipped). Each carries the crop box to send to the helper.
export function cellsToReread(table, { numericCols = [] } = {}) {
  const out = [];
  const set = new Set(numericCols);
  for (const cell of table.cells) {
    if (cell.r < (table.headerRows || 0) || cell.colSpan !== 1 || !set.has(cell.c)) continue;
    const empty = !cell.text || !cell.text.trim();
    const low = (cell.conf ?? 1) <= LOW_CONF && !isNumericText(cell.text);
    if (!empty && !low) continue;
    const boxes = !empty && cell.wbox ? [cell.wbox] : cropBoxes(table, cell, empty);
    for (const box of boxes) out.push({ page: table.page, bbox: box, id: table.id, r: cell.r, c: cell.c, empty });
  }
  return out;
}

// Crop box for an empty cell: the column's x-range and the text band of its row (the grid row
// is a full pitch and would take the neighbour's ascenders along).
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function clipBand(cell, y0, y1) {
  y0 = Math.max(y0, cell.bbox[1] + 0.3);
  y1 = Math.min(y1, cell.bbox[3] - 0.3);
  if (!(y1 > y0 + 1)) return null;
  return [cell.bbox[0] + 1, y0, cell.bbox[2] - 1, y1];
}

// Crop boxes for one cell. The wide box covers the row's ink (a clipped digit reads as "||").
// An empty cell also gets the x-height band: a thin "1" centred on a wrapped row is missed
// in the tall crop and read in the band. The wide box is first.
function cropBoxes(table, cell, empty) {
  const row = table.cells.filter((k) => k.r === cell.r && k.wbase != null);
  if (!row.length || !cell.bbox) return [];
  const bases = row.map((k) => k.wbase).sort((a, b) => a - b);
  const base = bases[bases.length >> 1];
  const size = Math.max(...row.map((k) => k.wsize || 0)) || (cell.bbox[3] - cell.bbox[1]);
  const band0 = base - 0.65 * size;
  const band1 = base + 0.12 * size;
  let y0 = band0;
  let y1 = band1;
  const ink = row.map((k) => k.wbox).filter((b) => b && b[3] > b[1]);
  if (ink.length) {
    const top = median(ink.map((b) => b[1]));
    const bot = median(ink.map((b) => b[3]));
    if (top < y0 - 0.4 || bot > y1 + 0.4) {
      y0 = top - 1.2;
      y1 = bot + 1.2;
    }
  }
  const wide = clipBand(cell, y0, y1);
  const tight = clipBand(cell, band0, band1);
  const boxes = [];
  if (wide) boxes.push(wide);
  if (empty && tight && (!wide || Math.abs(tight[1] - wide[1]) + Math.abs(tight[3] - wide[3]) > 1)) boxes.push(tight);
  else if (!wide && tight) boxes.push(tight);
  return boxes;
}

// Apply helper re-reads. A number is accepted when it parses (after mapping) and the column is
// numeric; a placeholder ("—", "*", "NA") is accepted into an empty cell.
export function applyCellOcr(table, results) {
  const applied = [];
  for (const res of results || []) {
    if (res.id && table.id && res.id !== table.id) continue;
    const cell = table.cells.find((k) => k.r === res.r && k.c === res.c);
    if (!cell) continue;
    let text = String(res.text || "").trim().replace(/^[.·•\s]+(?=\S)/, "").replace(/(?<=\S)[.·•\s]+$/, (m) => (/\d$/.test(m) ? m : ""));
    const column = bodyCellsOfColumn(table, cell.c).filter((k) => k !== cell && isNumericText(k.text)).map((k) => k.text);
    // A second crop of the same cell must not replace a number the first crop already accepted.
    if (cell.reread && isNumericText(cell.text) && fitsColumn(cell.text, column)) continue;
    const decimal = decimalStyle(column) || ".";
    const leadingZero = !column.some((v) => /^[.,]\d/.test(v));
    let to = null;
    // A number comes from Vision's reading; a dash or star only from the helper's ink check
    // (`glyph`), since a run of leader dots reads as "-".
    const empty = !cell.text || !cell.text.trim();
    if (text && !/\s/.test(text) && !isPlaceholder(text)) {
      const number = repairNumber(text, { decimal, leadingZero });
      if (number != null && fitsColumn(number, column)) to = number;
    }
    // A confident single letter ("c", or "|c" when the cell rule is in the crop) beats the
    // ink-star: on a nearest-neighbour upscale the letter is one small blob.
    const letter = text.replace(/^\|+/, "").replace(/\|+$/, "");
    if (to == null && empty && /^[A-Za-z]$/.test(letter) && (res.conf ?? 0) >= 0.8) to = letter;
    if (to == null && res.glyph && isPlaceholder(res.glyph) && empty) to = res.glyph;
    if (to == null && /^(?:n\/?a|nn)$/i.test(text) && (!cell.text || !cell.text.trim())) to = text;
    if (to == null || to === cell.text) continue;
    applied.push({ r: cell.r, c: cell.c, from: cell.text, to });
    cell.text = to;
    cell.numeric = isNumericText(to);
    cell.conf = res.conf ?? cell.conf;
    cell.reread = true;
  }
  // A placeholder found by the re-read may complete a note row ("*" after the numeric prefix).
  if (applied.length) spanNoteRows(table, { numericCols: table.repairs?.numericCols || null });
  return applied;
}

// Same decimal count as the column's typical value, and no more integer digits than its
// widest value plus one.
export function fitsColumn(number, column) {
  if (!column.length) return true;
  const decimals = (v) => { const m = /[.,](\d+)$/.exec(v); return m ? m[1].length : 0; };
  const counts = new Map();
  for (const v of column) counts.set(decimals(v), (counts.get(decimals(v)) || 0) + 1);
  let typical = 0; let best = -1;
  for (const [k, n] of counts) if (n > best) { best = n; typical = k; }
  if (decimals(number) !== typical) return false;
  const intDigits = (v) => v.replace(/[^\d.,]/g, "").split(/[.,]/)[0].length;
  const widest = Math.max(...column.map(intDigits));
  return intDigits(number) <= widest + 1;
}

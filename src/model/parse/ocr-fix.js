// OCR table repair. Pure. Numeric columns get their digit confusions mapped back, year header
// rows are made consecutive, dotted note rows become one spanning cell, and cells the helper
// re-read at 3x are accepted when they fit the column. Text columns are never "corrected".

import { isNumericText } from "./lattice.js";
import { damagedIndexColumn } from "./stream.js";

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

const SUBSCRIPTS = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉" };

function subscriptDigits(digits) {
  return String(digits).replace(/\d/g, (ch) => SUBSCRIPTS[ch] || ch);
}

function formulaInner(inner) {
  if (!/\d/.test(inner)) return inner;
  const multi = /^[A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)+$/.test(inner);
  const parenElement = /^[A-Z][a-z]?\d+$/.test(inner);
  if (!multi && !parenElement) return inner;
  return inner.replace(/([A-Z][a-z]?)(\d+)/g, (_, el, digits) => el + subscriptDigits(digits));
}

const ELEMENT = new Set("H He C N O F P S Cl Br I Na K Ca Fe Cu Zn".split(" "));

// CH4, C2H6, CO2, N2, and the same tokens in parentheses, become unicode subscripts.
// A single letter and the digit 1 (H1, a column head) is left as written.
export function chemicalSubscripts(text) {
  let s = String(text || "");
  s = s.replace(/\(([A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)*)\)/g, (m, inner) => `(${formulaInner(inner)})`);
  s = s.replace(/\b([A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)+)\b/g, (m) => formulaInner(m));
  s = s.replace(/\b([A-Z][a-z]?)(\d+)\b/g, (m, el, digits) => (ELEMENT.has(el) && digits !== "1" ? el + subscriptDigits(digits) : m));
  return s;
}

const COMMA_THOUSANDS = /^\d{1,3}(?:,\d{3})+$/;
const DOT_THOUSANDS = /^\d{1,3}(?:\.\d{3})+$/;

// A table that writes thousands with commas reads "1.700" as "1,700", including
// in a column whose other values are smaller than 1,000. A trailing period is
// the cell rule ("1,275."). A real decimal ("0.10", "1.50") keeps every period.
export function normalizeThousands(table) {
  const fixed = [];
  const texts = [];
  for (let c = 0; c < table.cols; c++) {
    for (const k of bodyCellsOfColumn(table, c)) {
      const s = String(k.text || "").trim();
      if (s) texts.push(s);
    }
  }
  const bare = (t) => t.replace(/\.$/, "");
  const comma = texts.filter((t) => COMMA_THOUSANDS.test(bare(t))).length;
  const decimal = texts.some((t) => /\d\.\d{1,2}$/.test(t));
  if (comma < 2) return fixed;
  for (let c = 0; c < table.cols; c++) {
    for (const cell of bodyCellsOfColumn(table, c)) {
      const s = String(cell.text || "").trim();
      if (!s) continue;
      let to = s;
      if (to.endsWith(".") && (COMMA_THOUSANDS.test(bare(to)) || (!decimal && DOT_THOUSANDS.test(bare(to))))) to = bare(to);
      if (!decimal && DOT_THOUSANDS.test(to)) to = to.replace(/\./g, ",");
      if (to === s) continue;
      fixed.push({ r: cell.r, c: cell.c, from: s, to });
      cell.text = to;
      cell.numeric = isNumericText(to);
    }
  }
  return fixed;
}

function restoreDegree(table) {
  const headerRows = Math.max(table.headerRows || 0, 1);
  for (const cell of table.cells || []) {
    if (cell.r >= headerRows) continue;
    const s = String(cell.text || "");
    const next = s.replace(/temperature,\s*C\b\.?/i, (m) => m.replace(/C\b\.?$/, "°C."));
    if (next !== s) cell.text = next;
  }
}

// A header label with empty neighbours, and sub-headers in the next header row,
// covers those neighbours. It stops at a header cell that already has text.
export function spanGroupHeaders(table) {
  const headerRows = table.headerRows || 0;
  if (headerRows < 2) return [];
  const spans = [];
  const textAt = (r, c) => table.cells.find((k) => k.r === r && k.c === c && String(k.text || "").trim());
  const occupied = (c, cell) => table.cells.some((k) => k !== cell && k.r <= 0 && 0 < k.r + (k.rowSpan || 1) && k.c <= c && c < k.c + (k.colSpan || 1) && String(k.text || "").trim());
  for (const cell of [...table.cells]) {
    if (cell.r !== 0 || (cell.rowSpan || 1) !== 1) continue;
    if (!String(cell.text || "").trim() || isNumericText(cell.text)) continue;
    let start = cell.c;
    let end = cell.c + (cell.colSpan || 1) - 1;
    while (start > 0 && !occupied(start - 1, cell) && textAt(1, start - 1)) start--;
    while (end + 1 < table.cols && !occupied(end + 1, cell) && textAt(1, end + 1)) end++;
    if (start === cell.c && end === cell.c + (cell.colSpan || 1) - 1) continue;
    table.cells = table.cells.filter((k) => !(k.r === 0 && k !== cell && !String(k.text || "").trim() && k.c >= start && k.c <= end));
    cell.c = start;
    cell.colSpan = end - start + 1;
    spans.push({ c: start, colSpan: cell.colSpan, text: cell.text });
  }
  if (spans.length) table.cells.sort((a, b) => a.r - b.r || a.c - b.c);
  return spans;
}

// The only number on the last row sits in the stub and the value cell is empty,
// while the other rows put their numbers in the value column. It is the total.
export function moveStubTotal(table) {
  if (!table || table.cols < 2 || table.rows < 3) return null;
  const r = table.rows - 1;
  const label = table.cells.find((k) => k.r === r && k.c === 0 && (k.colSpan || 1) === 1);
  const value = table.cells.find((k) => k.r === r && k.c === table.cols - 1 && (k.colSpan || 1) === 1);
  if (!label || !value || String(value.text || "").trim()) return null;
  const num = String(label.text || "").trim();
  if (!isNumericText(num)) return null;
  let valueNums = 0;
  let labelNums = 0;
  const samples = [];
  for (let i = 0; i < r; i++) {
    const v = table.cells.find((k) => k.r === i && k.c === value.c);
    const lab = table.cells.find((k) => k.r === i && k.c === 0);
    if (v && isNumericText(v.text)) { valueNums++; samples.push(v.text); }
    if (lab && isNumericText(lab.text)) labelNums++;
  }
  if (valueNums < 2 || labelNums > 0 || !fitsColumn(num, samples)) return null;
  value.text = num;
  value.numeric = true;
  label.text = "";
  label.numeric = false;
  return { r, text: num };
}

function deleteRow(table, r) {
  table.cells = table.cells.filter((c) => c.r !== r);
  for (const c of table.cells) {
    if (c.r > r) c.r -= 1;
    else if (c.r < r && c.r + (c.rowSpan || 1) > r) c.rowSpan = Math.max(1, (c.rowSpan || 1) - 1);
  }
  table.rows -= 1;
  if (r < (table.headerRows || 0)) table.headerRows = Math.max(0, table.headerRows - 1);
}

function cellAt(table, r, c) {
  return table.cells.find((k) => k.r === r && k.c <= c && c < k.c + (k.colSpan || 1));
}

function joinFragment(prev, next) {
  const left = String(prev || "").trim();
  const right = String(next || "").trim();
  if (!left) return right;
  if (!right) return left;
  const last = left.split(/\s+/).pop();
  const first = right.split(/\s+/)[0];
  if (/[A-Za-z]$/.test(last) && /^[a-z]{1,4}$/.test(first) && last.length >= 5 && !/^(of|the|and|or|in|on|at|to|for|per|from|by)$/.test(first)) return `${left}${right}`;
  return `${left} ${right}`;
}

// A row of column indices "(1)" "(2)" belongs on the head under it.
function foldIndexHeads(table) {
  let guard = 0;
  while (guard++ < 3 && table.rows > 2) {
    const top = table.cells.filter((c) => c.r === 0 && (c.rowSpan || 1) === 1);
    const texts = top.map((c) => String(c.text || "").trim()).filter(Boolean);
    if (texts.length < 3 || !texts.every((t) => /^\(\d+\)$/.test(t))) break;
    const below = table.cells.filter((c) => c.r === 1 && String(c.text || "").trim() && !/^\(\d+\)$/.test(String(c.text).trim()));
    if (below.length < 2) break;
    for (const c of top) {
      const text = String(c.text || "").trim();
      if (!/^\(\d+\)$/.test(text)) continue;
      const host = table.cells.find((k) => k.r === 1 && k.c === c.c && (k.colSpan || 1) === (c.colSpan || 1));
      if (host) host.text = `${text} ${host.text || ""}`.trim();
    }
    deleteRow(table, 0);
  }
}

// "from MFIs" under "# of loans" is the same head. A lower-case header line
// joins the line above and the extra row goes away.
function foldContinuationHeads(table) {
  const limit = Math.min(table.headerRows || 0, 4);
  for (let r = 1; r < limit && r < table.rows; r++) {
    const row = table.cells.filter((c) => c.r === r && (c.rowSpan || 1) === 1 && (c.colSpan || 1) === 1);
    const filled = row.filter((c) => String(c.text || "").trim());
    if (filled.length < 2 || !filled.every((c) => /^[a-z(]/.test(String(c.text).trim()) && !isNumericText(c.text))) continue;
    // A group head spanning several columns is not the wrapped line of each subhead.
    const hosts = filled.map((c) => {
      const above = cellAt(table, r - 1, c.c);
      if (!above || above.r !== r - 1 || above.c !== c.c || (above.colSpan || 1) !== (c.colSpan || 1)) return null;
      return { c, above };
    });
    if (hosts.some((h) => !h)) continue;
    for (const { c, above } of hosts) above.text = joinFragment(above.text, c.text);
    deleteRow(table, r);
    r -= 1;
  }
}

// "(0.06)" and "[0.9989]" under a coefficient are the same cell, printed on
// the next baselines. An empty stub and a number in parentheses on every
// filled column is that row.
function statText(text) {
  const s = String(text || "").trim();
  return /^\([^()\n]*\d[^()\n]*\)$/.test(s) || /^\[[^\[\]\n]*\d[^\[\]\n]*\]$/.test(s);
}

function stackStatRows(table) {
  let guard = 0;
  while (guard++ < table.rows) {
    let found = -1;
    for (let r = Math.max(1, table.headerRows || 0); r < table.rows; r++) {
      const row = table.cells.filter((c) => c.r === r && (c.rowSpan || 1) === 1);
      const stub = row.find((c) => c.c === 0);
      if (stub && String(stub.text || "").trim()) continue;
      const vals = row.filter((c) => c.c > 0 && String(c.text || "").trim());
      if (vals.length < 2 || !vals.every((c) => statText(c.text) && (c.colSpan || 1) === 1)) continue;
      const prev = table.cells.filter((c) => c.r === r - 1);
      const prevStub = prev.find((c) => c.c === 0 && String(c.text || "").trim());
      const prevNums = prev.filter((c) => c.c > 0 && /[0-9]/.test(c.text || ""));
      if (!prevStub && prevNums.length < 2) continue;
      if (!vals.every((c) => cellAt(table, r - 1, c.c))) continue;
      found = r;
      for (const c of vals) {
        const host = cellAt(table, r - 1, c.c);
        if (!host || host.r !== r - 1) continue;
        host.text = `${String(host.text || "").trim()} ${String(c.text).trim()}`.trim();
      }
      break;
    }
    if (found < 0) break;
    deleteRow(table, found);
  }
}

// A numbered section line that already covers more than one column
// ("Supercharger Speed - 2,500 r.p.m.") is the banner for the whole grid.
// A star or bullet left in the columns it did not reach is not a value.
function wordsOf(text) {
  return String(text || "").toLowerCase().replace(/[^a-z]+/g, " ").split(/\s+/).filter((w) => w.length >= 4);
}

function spanSectionBanners(table) {
  if (!table || table.cols < 2) return;
  const mark = (c) => /^[*•·∙.]$/.test(String(c.text || "").trim());
  for (let r = 0; r < table.rows; r++) {
    const row = table.cells.filter((c) => c.r === r && (c.rowSpan || 1) === 1);
    const filled = row.filter((c) => String(c.text || "").trim());
    const label = filled.find((c) => c.c === 0);
    if (!label) continue;
    const text = String(label.text || "").trim();
    if (!/\d/.test(text) || wordsOf(text).length < 2) continue;
    const rest = filled.filter((c) => c !== label);
    if ((label.colSpan || 1) >= table.cols) continue;
    // A stray mark is the banner cut short. So is a shorter copy of a
    // full-width banner already in the table, with nothing beside it.
    const marks = rest.length > 0 && rest.every(mark);
    const sibling = table.cells.some((c) => c.r !== r && (c.colSpan || 1) >= table.cols && wordsOf(c.text).length >= 2 && /\d/.test(c.text));
    const cutShort = rest.length === 0 && (label.colSpan || 1) >= 2 && sibling;
    if (!marks && !cutShort) continue;
    table.cells = table.cells.filter((c) => c.r !== r || c === label);
    label.c = 0;
    label.colSpan = table.cols;
  }
}

// "Panel A: Full sample" is a section banner, one cell across the grid.
function spanPanelRows(table) {
  for (let r = 0; r < table.rows; r++) {
    const row = table.cells.filter((c) => c.r === r);
    const filled = row.filter((c) => String(c.text || "").trim());
    if (filled.length !== 1 || filled[0].c !== 0) continue;
    const text = String(filled[0].text).trim();
    if (!/^panel\s+[a-z0-9]+\b/i.test(text)) continue;
    if ((filled[0].colSpan || 1) >= table.cols) continue;
    table.cells = table.cells.filter((c) => c === filled[0] || c.r !== r);
    filled[0].c = 0;
    filled[0].colSpan = table.cols;
  }
}

// "Treated. Control." with "3,254 3,139" is two body rows the reader fused.
// A single number beside them (the ratio) covers both rows.
function splitFusedLabelRow(table) {
  const labelsOf = (text) => {
    const m = String(text || "").trim().match(/^([A-Z][a-z]+)\.\s+([A-Z][a-z]+)\.?$/);
    return m ? [m[1], m[2]] : null;
  };
  const numToken = (p) => /^\d{1,3}(?:,\d{3})+$/.test(p) || /^\d+\.\d+$/.test(p) || /^\d{2,}$/.test(p);
  const numsOf = (text) => {
    const parts = String(text || "").trim().split(/\s+/);
    if (parts.length !== 2 || !parts.every(numToken)) return null;
    return parts;
  };
  for (let r = table.headerRows || 0; r < table.rows; r++) {
    const row = table.cells.filter((c) => c.r === r && (c.rowSpan || 1) === 1);
    const stub = row.find((c) => c.c === 0);
    const labels = stub ? labelsOf(stub.text) : null;
    if (!labels) continue;
    const paired = row.filter((c) => c.c > 0 && numsOf(c.text)).map((c) => ({ cell: c, nums: numsOf(c.text) }));
    if (!paired.length) continue;
    stub.text = labels[0];
    for (const c of row) {
      if (c.c === 0) continue;
      const hit = paired.find((p) => p.cell === c);
      if (hit) c.text = hit.nums[0];
      else if (String(c.text || "").trim()) c.rowSpan = 2;
    }
    for (const c of table.cells) if (c.r > r) c.r += 1;
    table.cells.push({ r: r + 1, c: 0, rowSpan: 1, colSpan: 1, text: labels[1], header: false });
    for (const p of paired) {
      table.cells.push({ r: r + 1, c: p.cell.c, rowSpan: 1, colSpan: p.cell.colSpan || 1, text: p.nums[1], header: false });
    }
    table.rows += 1;
    break;
  }
}

// The unit line ("Per cent.") was written on the first city's row and every
// city below took the previous city's numbers. Lift the repeated label into
// its own row and put each stub back with the numbers that were under it.
function unshiftRepeatedUnit(table) {
  const start = table.headerRows || 0;
  for (let r = start; r < table.rows - 2; r++) {
    const row = table.cells.filter((c) => c.r === r && (c.rowSpan || 1) === 1 && (c.colSpan || 1) === 1);
    const stub = row.find((c) => c.c === 0);
    const vals = row.filter((c) => c.c > 0 && String(c.text || "").trim());
    if (!stub || !String(stub.text || "").trim() || vals.length < 3) continue;
    const unit = String(vals[0].text).trim();
    if (/\d/.test(unit) || unit.length > 24 || !/[A-Za-z]/.test(unit)) continue;
    if (!vals.every((c) => String(c.text).trim() === unit)) continue;
    if (String(stub.text).trim() === unit) continue;
    const next = table.cells.filter((c) => c.r === r + 1 && c.c > 0 && /\d/.test(c.text || ""));
    if (next.length < 2) continue;
    // Values stay on their row. Stubs move down one, so each city meets the
    // numbers that were printed under it. The last stub keeps an empty row.
    const values = table.cells.filter((c) => c.c > 0 && c.r >= r);
    for (const c of table.cells) if (c.r >= r) c.r += 1;
    for (const c of values) c.r -= 1;
    table.rows += 1;
    const head = table.cells.find((c) => c.c === 0 && c.r === r - 1);
    if (head && (head.rowSpan || 1) === 1) head.rowSpan = 2;
    if (r === 1 && (table.headerRows || 0) < 2) table.headerRows = 2;
    break;
  }
}

// A section label ("Total:") holds the next row's numbers, and the last row of
// the section is a stub with nothing beside it. Move the values down.
function shiftSectionValues(table) {
  const stubOf = (r) => table.cells.find((c) => c.r === r && c.c === 0 && (c.colSpan || 1) === 1);
  for (let r = table.headerRows || 0; r < table.rows - 1; r++) {
    const stub = stubOf(r);
    const label = String(stub?.text || "").trim();
    if (!/:\s*$/.test(label)) continue;
    const values = table.cells.filter((c) => c.r === r && c.c > 0 && String(c.text || "").trim());
    if (!values.length) continue;
    let end = r;
    for (let k = r + 1; k < table.rows; k++) {
      const next = String(stubOf(k)?.text || "").trim();
      if (/:\s*$/.test(next)) break;
      end = k;
    }
    if (end === r) continue;
    const lastVals = table.cells.filter((c) => c.r === end && c.c > 0 && String(c.text || "").trim() && (c.rowSpan || 1) === 1);
    if (lastVals.length) continue;
    if (!String(stubOf(end)?.text || "").trim()) continue;
    const moving = table.cells.filter((c) => c.c > 0 && c.r >= r && c.r < end && c.r + (c.rowSpan || 1) <= end + 1);
    for (const c of moving) {
      if (c.r + (c.rowSpan || 1) - 1 >= table.rows - 1 && c.r + 1 + (c.rowSpan || 1) > table.rows) continue;
      c.r += 1;
    }
  }
}

// The same short decimal copied across a block of cells is a leader the reader
// filled in. A column that is only that number is left alone.
function blankRepeatedFill(table) {
  const start = table.headerRows || 0;
  const plain = (r, c) => table.cells.find((k) => k.r === r && k.c === c && (k.colSpan || 1) === 1 && (k.rowSpan || 1) === 1);
  const fillOf = (r, c) => {
    const cell = plain(r, c);
    const text = String(cell?.text || "").trim();
    return /^\.\d{2,4}$/.test(text) ? text : "";
  };
  const otherIn = (c0, c1, text) => {
    for (let c = c0; c < c1; c++) {
      for (let r = start; r < table.rows; r++) {
        const t = String(plain(r, c)?.text || "").trim();
        if (t && t !== text) return true;
      }
    }
    return false;
  };
  for (let r = start; r < table.rows; r++) {
    for (let c = 0; c < table.cols - 2; c++) {
      const text = fillOf(r, c);
      if (!text) continue;
      let c1 = c + 1;
      while (c1 < table.cols && fillOf(r, c1) === text) c1++;
      if (c1 - c < 3) continue;
      let r1 = r + 1;
      while (r1 < table.rows) {
        let same = true;
        for (let k = c; k < c1; k++) if (fillOf(r1, k) !== text) same = false;
        if (!same) break;
        r1++;
      }
      if (r1 - r < 3 || !otherIn(c, c1, text)) continue;
      const blank = (rr, k) => { const cell = plain(rr, k); if (cell && String(cell.text || "").trim() === text) cell.text = ""; };
      for (let rr = r; rr < r1; rr++) for (let k = c; k < c1; k++) blank(rr, k);
      for (const rr of [r - 1, r1]) {
        if (rr < start || rr >= table.rows) continue;
        for (let k = c; k < c1; k++) if (fillOf(rr, k) === text) blank(rr, k);
      }
    }
  }
}

function spaceFootnoteMarks(table) {
  for (const c of table.cells) {
    const text = String(c.text || "");
    if (/^[a-z][.\d]/.test(text) && /\d/.test(text)) c.text = text.replace(/^([a-z])(?=[.\d])/, "$1 ");
  }
}

// A space that belongs to the decimal mark ("3. 133", "56. 7"), a bullet
// standing in for the missing point, and the unit "Ibs" read with a capital i.
function tidyMeasuredCells(table) {
  for (const cell of table.cells) {
    let text = String(cell.text || "");
    if (!text) continue;
    text = text.replace(/(?<!\d)(\d{1,3})\s*\.\s*(\d+)/g, "$1.$2");
    text = text.replace(/\bIbs\b/g, "lbs");
    if (/[A-Za-z]/.test(text) && /\d{4}-+\s*$/.test(text)) text = text.replace(/-+\s*$/, "").trim();
    if (text !== cell.text) cell.text = text;
  }
  const start = table.headerRows || 0;
  for (let c = 0; c < table.cols; c++) {
    const cells = table.cells.filter((k) => k.c === c && (k.colSpan || 1) === 1 && k.r >= start);
    const dotted = cells.some((k) => /\d\s*[.,]\s*\d/.test(String(k.text || "")) || /^\s*[.,]\d/.test(String(k.text || "")));
    if (!dotted) continue;
    for (const cell of cells) {
      const m = String(cell.text || "").trim().match(/^[•·∙]\s*(\d+(?:[.,]\d+)?)$/);
      if (m) cell.text = `.${m[1]}`;
    }
  }
}

// The first row of a decimal column kept its point ("0.4804") and the rows
// under it came back as the digits only ("4743"). Put the point back when
// those digits are the same width as the fraction.
function restoreBareDecimals(table) {
  const start = table.headerRows || 0;
  const textOf = (k) => String(k.text || "").trim();
  for (let c = 0; c < table.cols; c++) {
    const cells = table.cells.filter((k) => k.c === c && (k.colSpan || 1) === 1 && (k.rowSpan || 1) === 1 && k.r >= start);
    const dotted = cells.filter((k) => /^(?:0)?\.\d{3,6}$/.test(textOf(k)));
    const bare = cells.filter((k) => /^\d{3,6}$/.test(textOf(k)));
    if (!dotted.length || !bare.length) continue;
    if (bare.some((k) => /^(?:1[89]|20)\d{2}$/.test(textOf(k)))) continue;
    const fracLen = (t) => t.replace(/^0?\./, "").length;
    const anchors = dotted.filter((k) => /^0\.\d{3,6}$/.test(textOf(k)));
    for (const cell of bare) {
      const n = textOf(cell).length;
      const sample = anchors.find((k) => fracLen(textOf(k)) === n);
      if (!sample) continue;
      const mag = Number(textOf(sample).replace(/^0\./, "").replace(/^0+/, "") || "0");
      const bareN = Number(textOf(cell));
      if (!(mag > 0) || bareN > mag * 20 || mag > bareN * 20) continue;
      cell.text = `.${textOf(cell)}`;
      cell.numeric = true;
    }
  }
}

// The same short decimal copied down a mixed column, on rows that have nothing
// else in them, is a leader. A later lone copy of that decimal stays.
function blankDecimalRun(table) {
  const start = table.headerRows || 0;
  const plain = (r, c) => table.cells.find((k) => k.r === r && k.c === c && (k.colSpan || 1) === 1 && (k.rowSpan || 1) === 1);
  const textOf = (r, c) => String(plain(r, c)?.text || "").trim();
  for (let c = 1; c < table.cols; c++) {
    const seen = new Set();
    for (let r = start; r < table.rows; r++) {
      const t = textOf(r, c);
      if (t && /\d/.test(t)) seen.add(t);
    }
    if (seen.size < 2) continue;
    let r = start;
    while (r < table.rows) {
      const token = textOf(r, c);
      if (!/^\.\d{2,4}$/.test(token)) { r++; continue; }
      let r1 = r + 1;
      while (r1 < table.rows && textOf(r1, c) === token) r1++;
      if (r1 - r >= 3) {
        for (let rr = r; rr < r1; rr++) {
          let other = false;
          for (let k = 1; k < table.cols; k++) {
            if (k === c) continue;
            if (textOf(rr, k)) other = true;
          }
          if (!other) {
            const cell = plain(rr, c);
            if (cell) cell.text = "";
          }
        }
      }
      r = r1;
    }
  }
}

const MONTH_RE = /^(?:jan|feb|mar|apr|may|june|july|aug|sept|sep|oct|nov|dec)\.?$/i;
const DAY_YEAR_RE = /^\d{1,2},\s*\d{4}\.?$/;

// "May" in one column and "2, 1900" in the next are one date the gap split.
function joinSplitDates(table) {
  const start = table.headerRows || 0;
  for (let c = 0; c < table.cols - 1; c++) {
    const pairs = [];
    let rows = 0;
    for (let r = start; r < table.rows; r++) {
      const left = table.cells.find((k) => k.r === r && k.c === c && (k.colSpan || 1) === 1 && (k.rowSpan || 1) === 1);
      const right = table.cells.find((k) => k.r === r && k.c === c + 1 && (k.colSpan || 1) === 1 && (k.rowSpan || 1) === 1);
      const lt = String(left?.text || "").trim();
      const rt = String(right?.text || "").trim();
      if (!lt && !rt) continue;
      rows++;
      if (MONTH_RE.test(lt) && DAY_YEAR_RE.test(rt)) pairs.push([left, right]);
    }
    if (rows < 3 || pairs.length < 3 || pairs.length < 0.6 * rows) continue;
    for (const [left, right] of pairs) {
      left.text = `${String(left.text).trim()} ${String(right.text).trim()}`.replace(/\s+/g, " ");
      right.text = "";
    }
    if (!table.cells.some((k) => k.c === c + 1 && String(k.text || "").trim())) deleteColumn(table, c + 1);
  }
}

// A stub that ends a sentence, then lowercase lines that each hold one number
// in a different column, is one wrapped cell the lattice split into rows.
function joinScatteredWrap(table) {
  let guard = 0;
  while (guard++ < table.rows) {
    let found = -1;
    for (let r = 0; r < table.rows - 2; r++) {
      const stub = table.cells.find((k) => k.r === r && k.c === 0 && (k.colSpan || 1) === 1);
      const label = String(stub?.text || "").trim();
      if (!stub || label.length < 12 || !/:\s*$/.test(label)) continue;
      const vals = table.cells.filter((k) => k.r === r && k.c > 0 && String(k.text || "").trim());
      if (vals.length) continue;
      const cont = [];
      for (let k = r + 1; k < table.rows; k++) {
        const next = table.cells.find((cell) => cell.r === k && cell.c === 0 && (cell.colSpan || 1) === 1);
        const text = String(next?.text || "").trim();
        if (!text || !/^[a-z]/.test(text)) break;
        const nums = table.cells.filter((cell) => cell.r === k && cell.c > 0 && String(cell.text || "").trim() && (cell.colSpan || 1) === 1);
        if (nums.length !== 1 || !/\d/.test(nums[0].text)) break;
        cont.push({ row: k, stub: next, num: nums[0] });
      }
      if (cont.length < 2) continue;
      const cols = cont.map((item) => item.num.c);
      if (new Set(cols).size !== cols.length) continue;
      found = r;
      stub.text = [label, ...cont.map((item) => String(item.stub.text).trim())].join(" ");
      for (const item of cont) {
        const host = table.cells.find((cell) => cell.r === r && cell.c === item.num.c && (cell.colSpan || 1) === 1);
        if (host) host.text = String(item.num.text).trim();
        else table.cells.push({ r, c: item.num.c, rowSpan: 1, colSpan: 1, text: String(item.num.text).trim(), header: false });
      }
      for (const item of [...cont].reverse()) deleteRow(table, item.row);
      break;
    }
    if (found < 0) break;
  }
}

function factorKind(text) {
  const s = String(text || "").trim();
  if (!s) return "";
  if (/^\d{1,3}\s+E[+\-−]\d+$/i.test(s)) return "tail";
  if (/^E[+\-−]\d+$/i.test(s)) return "exp";
  if (/^\.?\s*\d[\d.\s]*E[+\-−]\d+$/i.test(s)) return "full";
  return "";
}

function deleteColumn(table, c) {
  if (c < 0 || c >= table.cols) return;
  const kept = [];
  for (const cell of table.cells) {
    const span = cell.colSpan || 1;
    const c0 = cell.c;
    const c1 = c0 + span - 1;
    if (c1 < c) { kept.push(cell); continue; }
    if (c0 > c) { cell.c = c0 - 1; kept.push(cell); continue; }
    if (span === 1) continue;
    cell.colSpan = span - 1;
    if (cell.colSpan >= 1) kept.push(cell);
  }
  if (Array.isArray(table.grid?.xs) && table.grid.xs.length === table.cols + 1) {
    const at = c + 1 < table.grid.xs.length - 1 ? c + 1 : table.grid.xs.length - 1;
    table.grid.xs.splice(at, 1);
  }
  table.cols -= 1;
  table.cells = kept;
}

// "9.806" | "65 E+00" is one factor, and "1.0 E+01" in the column beside an
// empty cell is that same factor. The extra column goes away once it is empty.
function foldScientificSplit(table) {
  const start = table.headerRows || 0;
  for (let c = table.cols - 1; c >= 2; c--) {
    const cells = table.cells.filter((k) => k.r >= start && k.c === c && (k.colSpan || 1) === 1 && (k.rowSpan || 1) === 1);
    const filled = cells.filter((k) => String(k.text || "").trim());
    if (filled.length < 3) continue;
    if (!filled.every((k) => factorKind(k.text))) continue;
    const tails = filled.filter((k) => factorKind(k.text) === "tail");
    if (!tails.length) continue;
    let joined = 0;
    for (const right of filled) {
      const kind = factorKind(right.text);
      const covered = table.cells.find((k) => k.r === right.r && k.c <= c - 1 && c - 1 < k.c + (k.colSpan || 1) && (k.colSpan || 1) > 1);
      if (covered) continue;
      let left = table.cells.find((k) => k.r === right.r && k.c === c - 1 && (k.colSpan || 1) === 1 && (k.rowSpan || 1) === 1);
      const lt = String(left?.text || "").trim();
      if (kind === "tail" && /^\d+\.\d+$/.test(lt)) {
        left.text = `${lt} ${String(right.text).trim()}`;
        right.text = "";
        joined++;
      } else if ((kind === "full" || kind === "exp") && left && !lt) {
        left.text = String(right.text).trim().replace(/^\.\s+(?=\d)/, "");
        right.text = "";
        joined++;
      } else if ((kind === "full" || kind === "exp") && !left) {
        table.cells.push({ r: right.r, c: c - 1, rowSpan: 1, colSpan: 1, text: String(right.text).trim().replace(/^\.\s+(?=\d)/, ""), header: false });
        right.text = "";
        joined++;
      }
    }
    if (joined < 3) continue;
    if (table.cells.some((k) => k.c === c && (k.colSpan || 1) === 1 && String(k.text || "").trim())) continue;
    deleteColumn(table, c);
  }
}

// "Factors in boldface are exact" is a note across the top, not a header row.
function dropBannerNote(table) {
  if ((table.rows || 0) < 3) return;
  const row = table.cells.filter((c) => c.r === 0);
  const filled = row.filter((c) => String(c.text || "").trim());
  if (filled.length !== 1 || (filled[0].colSpan || 1) < table.cols) return;
  const text = String(filled[0].text).trim();
  if (/\d/.test(text) || text.split(/\s+/).length < 4) return;
  if (!/\b(?:are|is|was|were)\b/.test(text)) return;
  const next = table.cells.filter((c) => c.r === 1 && String(c.text || "").trim());
  if (next.length < 2) return;
  deleteRow(table, 0);
}

// Grid repairs that do not need the page's geometry: stacked heads, standard
// errors, section banners, a fused body row, a unit line on the first city,
// a section label holding the next row, a filled-in leader, a wrapped stub
// whose numbers landed on their own rows, a factor split beside its exponent.
// "56." beside "64" and "68-" is a header dot glued onto the integers. Take the
// mark off, and drop a header row that has no digits of its own.
function repairDamagedIndex(table) {
  if (!damagedIndexColumn(table)) return;
  for (const cell of table.cells) {
    if ((cell.colSpan || 1) !== 1) continue;
    let text = String(cell.text || "").trim();
    const doubled = text.match(/^(\d{1,3})-\s+\1$/);
    if (doubled) text = doubled[1];
    else if (/^\d{1,3}[.\-–−]$/.test(text)) text = text.slice(0, -1);
    if (text !== cell.text) cell.text = text;
  }
  while ((table.headerRows || 0) > 0 && table.rows > 2) {
    const texts = table.cells.filter((c) => c.r === 0).map((c) => String(c.text || "").trim()).filter(Boolean);
    if (!texts.length || texts.some((t) => /\d/.test(t))) break;
    deleteRow(table, 0);
  }
}

export function repairTableReading(table, options = {}) {
  if (!table?.cells?.length) return table;
  repairDamagedIndex(table);
  foldIndexHeads(table);
  foldContinuationHeads(table);
  stackStatRows(table);
  spanPanelRows(table);
  spanSectionBanners(table);
  splitFusedLabelRow(table);
  unshiftRepeatedUnit(table);
  shiftSectionValues(table);
  blankRepeatedFill(table);
  blankDecimalRun(table);
  spaceFootnoteMarks(table);
  // A spaced decimal ("3. 133") or a bullet standing in for the point makes the
  // rule grid look tidier. That lift is enough to keep the rule when a VLM
  // reading is actually clearer, so the scan path tidies only after the choice.
  if (options.tidy !== false) tidyMeasuredCells(table);
  restoreBareDecimals(table);
  joinSplitDates(table);
  joinScatteredWrap(table);
  foldScientificSplit(table);
  dropBannerNote(table);
  return table;
}

export function tidyDocumentTables(doc) {
  for (const block of Object.values(doc?.blocks || {})) {
    if (block?.type !== "table") continue;
    spanSectionBanners(block);
    tidyMeasuredCells(block);
  }
  return doc;
}

// Text repairs that do not depend on a fresh OCR pass: formula subscripts,
// thousands marks, a degree sign, group-header spans, a total left in the stub.
export function polishTableText(table, options) {
  if (!table?.cells) return table;
  for (const cell of table.cells) {
    if (!cell.text) continue;
    const next = chemicalSubscripts(cell.text);
    if (next !== cell.text) cell.text = next;
  }
  normalizeThousands(table);
  restoreDegree(table);
  spanGroupHeaders(table);
  moveStubTotal(table);
  repairTableReading(table, options);
  return table;
}

// Everything above, in order, for one table on an OCR page.
export function repairOcrTable(table) {
  unspanNarrowCells(table);
  const years = repairYearHeader(table);
  const { fixed, unrepaired, numericCols } = repairNumericColumns(table);
  const spans = spanNoteRows(table, { numericCols });
  polishTableText(table, { tidy: false });
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

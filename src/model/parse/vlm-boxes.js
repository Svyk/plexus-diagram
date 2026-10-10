// Pages whose words form a numeric grid. The helper reads the whole page when
// its layout model found no table. The constants match vlm_boxes.py.

const NUMERIC = /^[\$£€]?\(?[+-]?(?:\d{1,3}(?:[, ]\d{3})+|\d+)(?:\.\d+)?\)?%?$|^\.\d+%?$/;
const MIN_NUMERIC_ROWS = 4;
const MIN_NUMERIC_COLS = 2;
const ROW_GAP = 4;
// A column of page numbers scattered down a contents list is not a table.
// Table rows sit about a line apart. Same rule as vlm_boxes.py.
const ROW_PITCH_MAX = 36;
// A claim number, a margin line number, or an equation number sits on a
// sentence. A short label beside a count does not. Same rule as vlm_boxes.py.
const PROSE_LETTERS = 8;
// A row label beside a measured value ("Methane" / "84.7") is a few words.
// A full sentence is not a table row. Same rule as vlm_boxes.py.
const LABEL_LETTERS_MAX = 24;

export function isNumericToken(text) {
  const token = String(text || "").replace(/\s+/g, "").replace(/^[.,;:]+|[.,;:]+$/g, "");
  return token.length > 0 && NUMERIC.test(token);
}

function wordBox(word) {
  const bbox = word?.bbox;
  if (Array.isArray(bbox) && bbox.length >= 4) return bbox.map(Number);
  if (word?.x0 == null || word?.y0 == null || word?.x1 == null || word?.y1 == null) return null;
  return [Number(word.x0), Number(word.y0), Number(word.x1), Number(word.y1)];
}

function rowCenters(ys) {
  if (!ys.length) return [];
  const ordered = [...ys].sort((a, b) => a - b);
  const rows = [ordered[0]];
  for (let i = 1; i < ordered.length; i++) if (ordered[i] - rows[rows.length - 1] > ROW_GAP) rows.push(ordered[i]);
  return rows;
}

function tablePitch(ys) {
  const rows = rowCenters(ys);
  if (rows.length < 2) return Infinity;
  const gaps = [];
  for (let i = 1; i < rows.length; i++) gaps.push(rows[i] - rows[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

function letterCount(text) {
  const raw = String(text || "");
  let n = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) n++;
  }
  return n;
}

function listMarker(text) {
  const token = String(text || "").replace(/\s+/g, "").replace(/[.,;:]+$/g, "");
  return /^\d{1,4}$/.test(token);
}

function sameLineLetters(words, y) {
  let n = 0;
  for (const word of words) {
    if (!word || listMarker(word.text) || isNumericToken(word.text)) continue;
    const box = wordBox(word);
    if (!box) continue;
    const cy = (box[1] + box[3]) / 2;
    if (Math.abs(cy - y) > ROW_GAP) continue;
    n += letterCount(word.text);
  }
  return n;
}

// True when numbers line up in at least two columns of several rows.
// One column is a list, not a table.
export function alignedNumericColumns(words, { minRows = MIN_NUMERIC_ROWS, minCols = MIN_NUMERIC_COLS } = {}) {
  const nums = [];
  for (const word of words || []) {
    if (!word || !isNumericToken(word.text)) continue;
    const box = wordBox(word);
    if (!box) continue;
    const cy = (box[1] + box[3]) / 2;
    if (listMarker(word.text) && sameLineLetters(words, cy) >= PROSE_LETTERS) continue;
    nums.push([(box[0] + box[2]) / 2, cy, box[2] - box[0]]);
  }
  if (nums.length < minRows * minCols) return false;
  const widths = nums.map((item) => item[2]).filter((width) => width > 0).sort((a, b) => a - b);
  const median = widths.length ? widths[Math.floor(widths.length / 2)] : 8;
  const tol = Math.max(8, median * 0.6);
  nums.sort((a, b) => a[0] - b[0]);
  const columns = [];
  for (const [x, y] of nums) {
    const last = columns[columns.length - 1];
    if (last && Math.abs(x - last.x) <= tol) {
      last.ys.push(y);
      last.x += (x - last.x) / last.ys.length;
    } else columns.push({ x, ys: [y] });
  }
  const good = columns.filter((col) => rowCenters(col.ys).length >= minRows && tablePitch(col.ys) <= ROW_PITCH_MAX);
  if (good.length < minCols) return false;
  for (let i = 0; i < good.length; i++) {
    const a0 = Math.min(...good[i].ys);
    const a1 = Math.max(...good[i].ys);
    for (let j = i + 1; j < good.length; j++) {
      const b0 = Math.min(...good[j].ys);
      const b1 = Math.max(...good[j].ys);
      const overlap = Math.min(a1, b1) - Math.max(a0, b0);
      const shorter = Math.min(a1 - a0, b1 - b0);
      if (shorter > 0 && overlap / shorter >= 0.5) return true;
    }
  }
  return false;
}

function decimalToken(text) {
  if (!isNumericToken(text)) return false;
  const token = String(text || "").replace(/\s+/g, "").replace(/^[.,;:]+|[.,;:]+$/g, "");
  return token.includes(".") || token.includes("%");
}

// One column of measured values with a short label on the same rows.
// Two numeric columns are alignedNumericColumns, which may read the whole
// page. This one only marks the page so the layout model can run. A list of
// bare integers, or a decimal at the end of a sentence, is not a column.
export function labeledDecimalColumn(words) {
  const nums = [];
  for (const word of words || []) {
    if (!word || !decimalToken(word.text)) continue;
    const box = wordBox(word);
    if (!box) continue;
    nums.push([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2, box[2] - box[0]]);
  }
  if (nums.length < MIN_NUMERIC_ROWS) return false;
  const widths = nums.map((item) => item[2]).filter((width) => width > 0).sort((a, b) => a - b);
  const median = widths.length ? widths[Math.floor(widths.length / 2)] : 8;
  const tol = Math.max(8, median * 0.6);
  nums.sort((a, b) => a[0] - b[0]);
  const columns = [];
  for (const [x, y] of nums) {
    const last = columns[columns.length - 1];
    if (last && Math.abs(x - last.x) <= tol) {
      last.ys.push(y);
      last.x += (x - last.x) / last.ys.length;
    } else columns.push({ x, ys: [y] });
  }
  for (const col of columns) {
    const rows = rowCenters(col.ys);
    if (rows.length < MIN_NUMERIC_ROWS || tablePitch(col.ys) > ROW_PITCH_MAX) continue;
    let labeled = 0;
    for (const y of rows) {
      const letters = sameLineLetters(words, y);
      if (letters >= 2 && letters <= LABEL_LETTERS_MAX) labeled++;
    }
    if (labeled >= MIN_NUMERIC_ROWS) return true;
  }
  return false;
}

function insideFigure(word, page, figures) {
  const box = wordBox(word);
  if (!box) return false;
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  for (const fig of figures) {
    const b = fig?.bbox;
    if (!b || fig.page !== page) continue;
    if (cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]) return true;
  }
  return false;
}

export function numericPagesOf(records, pages, figures = []) {
  const want = pages && pages.length ? new Set(pages) : null;
  const out = [];
  for (const rec of records || []) {
    if (!rec || (want && !want.has(rec.n))) continue;
    const words = [];
    for (const word of rec.words || []) {
      const next = { text: word.text, x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 };
      // Axis ticks and labels inside a drawing are not a missed table.
      if (insideFigure(next, rec.n, figures)) continue;
      words.push(next);
    }
    if (alignedNumericColumns(words)) out.push(rec.n);
  }
  return out;
}

// Pages with one labeled column of measured values. The caller runs layout
// on these pages. They are not numeric pages: a missed layout box must not
// become a whole-page read.
export function decimalColumnPagesOf(records, pages, figures = []) {
  const want = pages && pages.length ? new Set(pages) : null;
  const out = [];
  for (const rec of records || []) {
    if (!rec || (want && !want.has(rec.n))) continue;
    const words = [];
    for (const word of rec.words || []) {
      const next = { text: word.text, x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 };
      if (insideFigure(next, rec.n, figures)) continue;
      words.push(next);
    }
    if (labeledDecimalColumn(words)) out.push(rec.n);
  }
  return out;
}

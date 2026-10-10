// Pages whose words form a numeric grid. The helper reads the whole page when
// its layout model found no table. The constants match vlm_boxes.py.

const NUMERIC = /^[\$£€]?\(?[+-]?(?:\d{1,3}(?:[, ]\d{3})+|\d+)(?:\.\d+)?\)?%?$|^\.\d+%?$/;
const MIN_NUMERIC_ROWS = 4;
const MIN_NUMERIC_COLS = 2;
const ROW_GAP = 4;

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

function distinctRows(ys) {
  if (!ys.length) return 0;
  const ordered = [...ys].sort((a, b) => a - b);
  let count = 1;
  for (let i = 1; i < ordered.length; i++) if (ordered[i] - ordered[i - 1] > ROW_GAP) count++;
  return count;
}

// True when numbers line up in at least two columns of several rows.
// One column is a list, not a table.
export function alignedNumericColumns(words, { minRows = MIN_NUMERIC_ROWS, minCols = MIN_NUMERIC_COLS } = {}) {
  const nums = [];
  for (const word of words || []) {
    if (!word || !isNumericToken(word.text)) continue;
    const box = wordBox(word);
    if (!box) continue;
    nums.push([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2, box[2] - box[0]]);
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
  const good = columns.filter((col) => distinctRows(col.ys) >= minRows);
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

export function numericPagesOf(records, pages) {
  const want = pages && pages.length ? new Set(pages) : null;
  const out = [];
  for (const rec of records || []) {
    if (!rec || (want && !want.has(rec.n))) continue;
    const words = (rec.words || []).map((word) => ({
      text: word.text, x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1,
    }));
    if (alignedNumericColumns(words)) out.push(rec.n);
  }
  return out;
}

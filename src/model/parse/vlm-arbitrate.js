// Keep the better table of {rule assembly, PaddleOCR-VL} from page evidence alone.
// No truth file. A reading that drops OCR rows loses. A cell that fuses two text
// lines, or packs two numbers into one cell, loses. A reading whose body cells
// are stray punctuation ("•0219", "1.20-") loses to one whose cells are single
// numbers. When the VLM body is short but its header is real, the header can sit
// on the rule body. A gap under 0.06 keeps the rule table, unless the other
// reading is clearly the cleaner grid or the only one whose row count fits.

import { isPlaceholder, numericLike, tableNumericValidity } from "./ocr-fix.js";

const CLEAR = 0.06;

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .split(/[^a-z0-9.-]+/)
    .map((part) => part.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((part) => part.length > 0);
}

function near(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (a.length === b.length) { i += 1; j += 1; }
    else if (a.length > b.length) i += 1;
    else j += 1;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function bagHas(bag, key) {
  for (const token of bag) if (near(key, token)) return true;
  return false;
}

function rowKeys(words) {
  const all = [];
  for (const word of words || []) all.push(...tokens(word.text));
  const alpha = all.filter((token) => /[a-z]/.test(token) && token.length >= 3);
  if (alpha.length) return alpha;
  return all.filter((token) => /\d/.test(token));
}

function baselineRows(words) {
  const sorted = [...(words || [])].sort((a, b) => (a.base ?? 0) - (b.base ?? 0) || (a.x0 ?? 0) - (b.x0 ?? 0));
  const rows = [];
  for (const word of sorted) {
    const size = word.size || 8;
    let host = null;
    for (let i = rows.length - 1; i >= 0 && rows[i].base >= (word.base ?? 0) - 2 * size; i -= 1) {
      const row = rows[i];
      if (Math.abs(row.base - (word.base ?? 0)) <= 0.45 * Math.max(size, row.size)) { host = row; break; }
    }
    if (host) {
      host.words.push(word);
      host.size = Math.max(host.size, size);
    } else rows.push({ base: word.base ?? 0, size, words: [word] });
  }
  return rows;
}

function unionBox(a, b) {
  if (!a || a.length < 4) return b || null;
  if (!b || b.length < 4) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

function inside(word, box) {
  if (!box) return false;
  const cx = ((word.x0 ?? 0) + (word.x1 ?? 0)) / 2;
  const cy = word.base != null ? word.base - 0.25 * (word.size || 8) : ((word.y0 ?? 0) + (word.y1 ?? 0)) / 2;
  return cx >= box[0] - 3 && cx <= box[2] + 3 && cy >= box[1] - 3 && cy <= box[3] + 3;
}

function ruleCount(rules, box, axis) {
  if (!box) return 0;
  const span = axis === "h" ? box[2] - box[0] : box[3] - box[1];
  const minLen = 0.55 * span;
  const coords = [];
  for (const rule of rules || []) {
    if (rule.axis !== axis) continue;
    if (axis === "h") {
      const y = ((rule.y0 ?? 0) + (rule.y1 ?? 0)) / 2;
      if (y < box[1] - 2 || y > box[3] + 2) continue;
      const overlap = Math.min(rule.x1 ?? 0, box[2]) - Math.max(rule.x0 ?? 0, box[0]);
      if (overlap < minLen) continue;
      coords.push(y);
    } else {
      const x = ((rule.x0 ?? 0) + (rule.x1 ?? 0)) / 2;
      if (x < box[0] - 2 || x > box[2] + 2) continue;
      const overlap = Math.min(rule.y1 ?? 0, box[3]) - Math.max(rule.y0 ?? 0, box[1]);
      if (overlap < minLen) continue;
      coords.push(x);
    }
  }
  coords.sort((a, b) => a - b);
  const uniq = [];
  for (const coord of coords) if (!uniq.length || coord - uniq[uniq.length - 1] > 2) uniq.push(coord);
  return uniq.length;
}

// Numeric text lines are body rows. The word lines above them are one wrapped
// header, not one table row each. Used when that count is well under the raw
// line count, so a split header does not look like extra body rows.
function bodyTarget(rows) {
  let numeric = 0;
  let words = 0;
  for (const row of rows || []) {
    const all = [];
    for (const word of row.words || []) all.push(...tokens(word.text));
    if (!all.length) continue;
    let nums = 0;
    let alpha = 0;
    for (const key of all) {
      if (/\d/.test(key)) nums += 1;
      else if (/[a-z]/.test(key)) alpha += 1;
    }
    // A disease name plus its numbers is a body row. A header line is words.
    if (nums > 0 && nums > alpha) numeric += 1;
    else if (alpha && nums === 0) words += 1;
  }
  if (numeric < 4) return null;
  return numeric + (words ? 1 : 0);
}

// Ruled line count is rows+1 for a closed grid and rows for an open one.
// Use whichever sits nearer the text rows, and only when the two agree.
function ruledTarget(textCount, lineCount) {
  if (lineCount < 3 || textCount < 2) return textCount;
  const closed = lineCount - 1;
  const open = lineCount;
  const pick = Math.abs(closed - textCount) <= Math.abs(open - textCount) ? closed : open;
  if (Math.abs(pick - textCount) / textCount <= 0.2) return pick;
  return textCount;
}

function fit(actual, target) {
  if (!target) return actual ? 0 : 1;
  return 1 - Math.min(1, Math.abs(actual - target) / target);
}

function cellBag(table) {
  const bag = [];
  for (const cell of table?.cells || []) bag.push(...tokens(cell.text));
  return bag;
}

// A token that sits on exactly one text row can say which row a cell came from.
function distinctiveOwners(rows) {
  const hits = new Map();
  rows.forEach((row, index) => {
    for (const key of rowKeys(row.words)) {
      const cur = hits.get(key);
      if (cur === undefined) hits.set(key, index);
      else if (cur !== index) hits.set(key, -1);
    }
  });
  const owner = new Map();
  for (const [key, index] of hits) if (index >= 0) owner.set(key, index);
  return owner;
}

function ownersOf(text, owner) {
  const found = new Set();
  for (const key of tokens(text)) {
    if (owner.has(key)) { found.add(owner.get(key)); continue; }
    for (const [cand, index] of owner) {
      if (near(key, cand)) { found.add(index); break; }
    }
  }
  return found;
}

function rowKind(row) {
  const keys = rowKeys(row?.words);
  let alpha = 0;
  let numeric = 0;
  for (const key of keys) {
    if (/[a-z]/.test(key)) alpha += 1;
    else if (/\d/.test(key)) numeric += 1;
  }
  if (numeric && !alpha) return "num";
  if (alpha && !numeric) return "word";
  return "mix";
}

// Adjacent word lines in one cell are a wrapped header. A word line fused
// with the number line under it ("Inch" + "0.00") is not.
function cellCovers(hit, rows, cell) {
  if (hit.size <= 1) return true;
  const span = cell?.rowSpan || 1;
  if (span > 1 && hit.size <= span + 1) return true;
  const indexes = [...hit].sort((a, b) => a - b);
  for (let i = 1; i < indexes.length; i += 1) if (indexes[i] - indexes[i - 1] > 1) return false;
  const kinds = indexes.map((index) => rowKind(rows[index]));
  if (kinds.includes("word") && kinds.includes("num")) return false;
  if (kinds.filter((kind) => kind === "num").length >= 2) return false;
  return indexes.length <= 3;
}

// Share of text rows whose tokens sit in a cell that does not also hold
// another text row. A cell that fuses "Inch" with "0.00" covers neither row.
function cleanCoverage(table, rows, owner) {
  const cells = table?.cells || [];
  let covered = 0;
  let counted = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const keys = rowKeys(rows[index].words);
    if (!keys.length) continue;
    counted += 1;
    const bag = [];
    for (const cell of cells) {
      const hit = ownersOf(cell.text, owner);
      if (!hit.has(index) || !cellCovers(hit, rows, cell)) continue;
      bag.push(...tokens(cell.text));
    }
    let got = 0;
    for (const key of keys) if (bagHas(bag, key)) got += 1;
    if (got / keys.length >= 0.5) covered += 1;
  }
  return { covered, counted };
}

function scientificFactor(text) {
  return /^\d[\d.,]*(\s+\d{1,3})?\s+E[+\-−]\d+$/i.test(String(text || "").trim());
}

function plainNumber(text) {
  let s = String(text || "").trim();
  s = s.replace(/\\overline\{([^}]*)\}/g, "$1");
  s = s.replace(/\\\(|\\\)|\\[a-z]+/g, "");
  s = s.replace(/[{}]/g, "").trim();
  if (scientificFactor(s)) return true;
  return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s);
}

function plainPhrase(text) {
  return /^[A-Za-z][A-Za-z .,'’()/-]{0,80}$/.test(String(text || "").trim());
}

function filledShare(table) {
  const header = table?.headerRows || 0;
  const rows = table?.rows || 0;
  const cols = table?.cols || 0;
  if (!rows || !cols) return 1;
  let n = 0;
  let empty = 0;
  for (let r = header; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      n += 1;
      const covering = (table.cells || []).find((cell) => {
        const rs = cell.rowSpan || 1;
        const cs = cell.colSpan || 1;
        return cell.r <= r && r < cell.r + rs && cell.c <= c && c < cell.c + cs;
      });
      if (!covering || !String(covering.text || "").trim()) empty += 1;
    }
  }
  return n ? 1 - empty / n : 1;
}

// A body cell that is one number or a short phrase. "•0219", "1.20-" and
// "0. 0305" are the Vision debris a second reading often cleans up.
function tidyShare(table) {
  const header = table?.headerRows || 0;
  let n = 0;
  let ok = 0;
  for (const cell of table?.cells || []) {
    if ((cell.colSpan || 1) > 1) continue;
    if (header && cell.r < header) continue;
    const raw = String(cell.text || "").trim();
    if (!raw) continue;
    n += 1;
    if (plainNumber(raw) || isPlaceholder(raw) || plainPhrase(raw)) ok += 1;
  }
  return n ? ok / n : 1;
}

// Two numbers from one text line stuffed into one cell ("0.15 0.003").
function singleValues(table) {
  let n = 0;
  let packed = 0;
  for (const cell of table?.cells || []) {
    if ((cell.colSpan || 1) > 1) continue;
    if (cell.header || cell.r < (table.headerRows || 0)) continue;
    if (scientificFactor(cell.text)) { n += 1; continue; }
    const nums = tokens(cell.text).filter((token) => /\d/.test(token) && token.replace(/\D/g, "").length >= 2);
    if (!nums.length) continue;
    n += 1;
    if (nums.length >= 2) packed += 1;
  }
  return n ? 1 - packed / n : 1;
}

function headerRowsOf(cells, rows) {
  let n = 0;
  for (let r = 0; r < rows; r += 1) {
    const row = (cells || []).filter((cell) => cell.r === r);
    if (!row.length || !row.every((cell) => cell.header)) break;
    n += 1;
  }
  return n;
}

function numericConsistency(table) {
  const validity = tableNumericValidity(table);
  if (validity.total >= 4) return validity.share;
  const header = table.headerRows || 0;
  let sum = 0;
  let n = 0;
  for (let c = 0; c < (table.cols || 0); c += 1) {
    const body = (table.cells || []).filter((cell) => cell.c === c && (cell.colSpan || 1) === 1 && cell.r >= header && String(cell.text || "").trim());
    if (body.length < 3) continue;
    const numeric = body.filter((cell) => numericLike(cell.text) || isPlaceholder(cell.text)).length / body.length;
    sum += Math.max(numeric, 1 - numeric);
    n += 1;
  }
  return n ? sum / n : 0.7;
}

function headerScore(table, rows) {
  const marked = headerRowsOf(table.cells, table.rows || 0);
  // An unmarked first row is still the header when it holds the top line.
  let n = table.headerRows || marked;
  if (!n && (table.cells || []).some((cell) => cell.r === 0 && String(cell.text || "").trim())) n = 1;
  const headerCells = (table.cells || []).filter((cell) => (n ? cell.r < n : cell.header));
  const headerText = headerCells.map((cell) => cell.text).join(" ");
  if (!n && !headerCells.length) return 0.65;
  if (!String(headerText).trim()) return 0.15;
  const keys = rows.slice(0, Math.max(1, n)).flatMap((row) => rowKeys(row.words));
  if (!keys.length) return 0.65;
  const bag = tokens(headerText);
  let hit = 0;
  for (const key of keys) if (bagHas(bag, key)) hit += 1;
  return hit / keys.length;
}

export function evidenceFromRecords(records) {
  return (records || []).filter(Boolean).map((rec) => ({
    page: rec.n,
    words: (rec.words || []).map((word) => ({
      text: word.text, x0: word.x0, x1: word.x1, y0: word.y0, y1: word.y1, base: word.base, size: word.size,
    })),
    rules: (rec.graphics?.rules || []).map((rule) => ({
      axis: rule.axis, x0: rule.x0, x1: rule.x1, y0: rule.y0, y1: rule.y1,
    })),
  }));
}

function evidenceIn(page, box) {
  const words = (page?.words || []).filter((word) => inside(word, box));
  return { words, rows: baselineRows(words), rules: page?.rules || [], box };
}

// One candidate against the words and rules inside `box`. Higher is better.
export function scoreTable(table, evidence) {
  const rows = evidence?.rows || [];
  const owner = distinctiveOwners(rows);
  const clean = cleanCoverage(table, rows, owner);
  // A token that never lands in a clean cell still counts when the whole
  // bag has it and no cell fused two rows. Fusion is what cleanCoverage drops.
  const bag = cellBag(table);
  let bagCovered = 0;
  for (const row of rows) {
    const keys = rowKeys(row.words);
    if (!keys.length) continue;
    let hit = 0;
    for (const key of keys) if (bagHas(bag, key)) hit += 1;
    if (hit / keys.length >= 0.5) bagCovered += 1;
  }
  const counted = clean.counted;
  const covered = Math.min(clean.covered, bagCovered);
  const textRows = counted || rows.length;
  const rowTarget = ruledTarget(textRows, ruleCount(evidence?.rules, evidence?.box, "h"));
  const body = bodyTarget(rows);
  const vLines = ruleCount(evidence?.rules, evidence?.box, "v");
  const colsTarget = vLines >= 3 ? vLines - 1 : null;
  const rowCov = counted ? covered / counted : 0.5;
  const rowFit = fit(table?.rows || 0, rowTarget || textRows);
  const colFit = colsTarget ? fit(table?.cols || 0, colsTarget) : 1;
  const numeric = numericConsistency(table || { cells: [], cols: 0, rows: 0, headerRows: 0 });
  const header = headerScore(table || { cells: [], rows: 0 }, rows);
  const single = singleValues(table || { cells: [] });
  const tidy = tidyShare(table || { cells: [] });
  const filled = filledShare(table || { cells: [], rows: 0, cols: 0 });
  const total = 0.28 * rowCov + 0.16 * rowFit + 0.08 * colFit + 0.12 * numeric + 0.08 * header + 0.14 * single + 0.14 * tidy;
  return { total, rowCov, rowFit, colFit, numeric, header, single, tidy, filled, textRows, rowTarget, body, colsTarget };
}

// VLM header (spans included) over the rule body's rows, when the VLM body is short.
function mergeReading(rule, vlm) {
  if (!rule?.cells?.length || !vlm?.cells?.length) return null;
  if (!(vlm.rows > 0) || !(rule.rows > 0) || vlm.rows >= rule.rows * 0.85) return null;
  if (Math.abs((vlm.cols || 0) - (rule.cols || 0)) > 1) return null;
  const headerN = vlm.headerRows || headerRowsOf(vlm.cells, vlm.rows);
  if (headerN < 1) return null;
  const ruleHeader = rule.headerRows || 0;
  const headers = vlm.cells.filter((cell) => cell.r < headerN).map((cell) => ({ ...cell }));
  const body = rule.cells.filter((cell) => cell.r >= ruleHeader).map((cell) => ({
    ...cell,
    r: cell.r - ruleHeader + headerN,
    header: false,
  }));
  if (body.length < 2) return null;
  return {
    ...rule,
    bbox: unionBox(rule.bbox, vlm.bbox) || rule.bbox,
    rows: headerN + (rule.rows - ruleHeader),
    cols: rule.cols,
    headerRows: headerN,
    cells: [...headers, ...body],
  };
}

function closerToBody(candidate, ruleRow) {
  const body = candidate?.score?.body;
  if (!(body > 0)) return false;
  const rows = candidate.table?.rows || 0;
  const ruleRows = ruleRow.table?.rows || 0;
  return Math.abs(rows - body) < Math.abs(ruleRows - body);
}

// Same row count, both readings still hold the text lines, and the other
// reading's cells are plainly cleaner or less empty. A shorter reading also
// wins when it is the one that matches the numeric body.
function sameGridBetter(candidate, ruleRow) {
  const next = candidate?.score;
  const rule = ruleRow?.score;
  if (!next || !rule) return false;
  if (next.rowCov < 0.8 || rule.rowCov < 0.8) return false;
  // A wrapped header split into one row per text line inflates the rule grid.
  // Prefer the reading closer to numeric-lines-plus-one-header when both still
  // hold the text. A short reading that dropped body rows is farther from that
  // count, so it does not win this way.
  if (closerToBody(candidate, ruleRow) && next.rowCov + 0.08 >= rule.rowCov && next.tidy + 0.05 >= rule.tidy) return true;
  const rows = candidate.table?.rows || 0;
  const ruleRows = ruleRow.table?.rows || 0;
  if (!(ruleRows > 0) || rows < ruleRows * 0.9 || rows > ruleRows * 1.15) return false;
  if (next.tidy - rule.tidy >= 0.15) return true;
  if (next.filled - rule.filled >= 0.08 && next.tidy + 0.05 >= rule.tidy) return true;
  // The totals already agree. Cleaner cells then win: a rule grid of the same
  // shape whose numbers are Vision debris ("1,450 -i,") is not the reading.
  if ((rule.total ?? 0) - (next.total ?? 0) < CLEAR && next.tidy - rule.tidy >= 0.12 && next.filled + 0.02 >= rule.filled) return true;
  return false;
}

// A gap under CLEAR keeps the rule table, except when the other reading is
// the one the page can actually support: cleaner cells without a dropped
// grid, or a better row count when the OCR tokens match neither reading.
function clearsRule(best, ruleRow) {
  if (best.score.total - ruleRow.score.total >= CLEAR) return true;
  if (sameGridBetter(best, ruleRow)) return true;
  const rows = best.table?.rows || 0;
  const ruleRows = ruleRow.table?.rows || 0;
  if (Math.max(best.score.rowCov, ruleRow.score.rowCov) < 0.45 && best.score.rowFit - ruleRow.score.rowFit >= 0.12 && rows >= ruleRows) return true;
  // Coverage just above that line is still a weak match. A large row-count
  // miss (the shorter grid left out a band of body lines) then takes the
  // longer reading, when its score is not lower.
  if (best.score.rowCov < 0.6 && ruleRow.score.rowCov < 0.6 && best.score.rowFit - ruleRow.score.rowFit >= 0.2 && rows >= ruleRows && best.score.total >= ruleRow.score.total) return true;
  // Neither reading matches the OCR tokens. A large tidy gap still means the
  // rule cells are stray punctuation and the other grid is the readable one.
  if (Math.max(best.score.rowCov, ruleRow.score.rowCov) < 0.45 && best.score.tidy - ruleRow.score.tidy >= 0.25 && best.score.total >= ruleRow.score.total) return true;
  return false;
}

// Same grid, empty VLM cell, rule text that the page's words actually contain.
// A re-read that comes back blank must not erase the reading the page supports.
function fillEmptyFromRule(chosen, rule, evidence) {
  if (!chosen?.cells || !rule?.cells) return chosen;
  if (chosen.rows !== rule.rows || chosen.cols !== rule.cols) return chosen;
  const bag = [];
  for (const word of evidence?.words || []) bag.push(...tokens(word.text));
  if (!bag.length) return chosen;
  const cells = chosen.cells.map((cell) => ({ ...cell }));
  let filled = 0;
  for (const cell of cells) {
    if (String(cell.text || "").trim()) continue;
    const src = (rule.cells || []).find((k) => k.r === cell.r && k.c === cell.c && (k.colSpan || 1) === (cell.colSpan || 1) && (k.rowSpan || 1) === (cell.rowSpan || 1));
    const text = String(src?.text || "").trim();
    if (!text) continue;
    const keys = tokens(text);
    if (!keys.length || !keys.every((key) => bagHas(bag, key))) continue;
    cell.text = text;
    cell.header = cell.r < (chosen.headerRows || 0);
    filled++;
  }
  if (!filled) return chosen;
  return { ...chosen, cells };
}

// `page` is `{words, rules}` for the table's page. Choice is "rule", "vlm", or "merge".
export function chooseTableReading(rule, vlm, page = {}) {
  const box = unionBox(rule?.bbox, vlm?.bbox);
  const evidence = evidenceIn(page, box);
  if (evidence.rows.length < 2 && rule) {
    return { choice: "rule", table: rule, scores: { rule: null, vlm: null, merge: null } };
  }
  const ranked = [];
  if (rule) ranked.push({ choice: "rule", table: rule, score: scoreTable(rule, evidence) });
  if (vlm) ranked.push({ choice: "vlm", table: vlm, score: scoreTable(vlm, evidence) });
  const merged = mergeReading(rule, vlm);
  if (merged) ranked.push({ choice: "merge", table: merged, score: scoreTable(merged, evidence) });
  ranked.sort((a, b) => b.score.total - a.score.total || (a.choice === "rule" ? -1 : 1));
  let best = ranked[0] || { choice: "rule", table: rule, score: null };
  const ruleRow = ranked.find((row) => row.choice === "rule");
  if (ruleRow && best.choice !== "rule" && !clearsRule(best, ruleRow)) best = ruleRow;
  if (ruleRow && best.choice === "rule") {
    const alt = ranked.find((row) => row.choice !== "rule" && sameGridBetter(row, ruleRow));
    if (alt) best = alt;
  }
  if (rule && best.choice !== "rule" && best.table) best = { ...best, table: fillEmptyFromRule(best.table, rule, evidence) };
  return {
    choice: best.choice,
    table: best.table,
    scores: {
      rule: ruleRow?.score || null,
      vlm: ranked.find((row) => row.choice === "vlm")?.score || null,
      merge: ranked.find((row) => row.choice === "merge")?.score || null,
    },
  };
}

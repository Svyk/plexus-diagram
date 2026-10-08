// CTC greedy decode → word items in the pxd-ocr/1 shape the parse engine already reads.
// A line recogniser emits characters with frame indexes. Frame width is the crop width / T,
// so a word's left edge is its first character's frame and its width runs through its last.

const SPACE = new Set([" ", "\u3000", "\u00a0"]);

export function round2(n) {
  return Math.round(n * 100) / 100;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function softmaxAt(logits, row, classes, index) {
  let max = -Infinity;
  for (let c = 0; c < classes; c++) max = Math.max(max, logits[row + c]);
  let sum = 0;
  for (let c = 0; c < classes; c++) sum += Math.exp(logits[row + c] - max);
  return Math.exp(logits[row + index] - max) / sum;
}

// logits: Float32Array row-major [time, classes]. Index 0 is the CTC blank. dict[i] is class i+1.
// PP-OCRv5 rec ONNX emits a probability row (it sums to 1). Softmax of that row is ~1/classes
// and hides a 0.99 read. Logits (a test, or an older head) still go through softmax.
function confidenceAt(logits, row, classes, index) {
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let c = 0; c < classes; c++) {
    const v = logits[row + c];
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min >= -1e-4 && max <= 1.001 && sum > 0.95 && sum < 1.05) return Math.max(0, logits[row + index]);
  return softmaxAt(logits, row, classes, index);
}

export function ctcDecode(logits, time, classes, dict) {
  const chars = [];
  let prev = -1;
  for (let t = 0; t < time; t++) {
    const row = t * classes;
    let best = 0;
    let bestV = -Infinity;
    for (let c = 0; c < classes; c++) {
      const v = logits[row + c];
      if (v > bestV) { bestV = v; best = c; }
    }
    if (best !== 0 && best !== prev) {
      // The rec head adds a space after the dict. The dict file itself has none.
      const ch = best <= dict.length ? dict[best - 1] : (best === dict.length + 1 ? " " : null);
      if (ch) chars.push({ ch, t, conf: confidenceAt(logits, row, classes, best) });
    }
    prev = best;
  }
  return chars;
}

// Vision's three buckets, so ocr-fix LOW_CONF (0.3) still means "read this cell again".
export function bucketConf(mean) {
  if (mean >= 0.8) return 1;
  if (mean >= 0.5) return 0.5;
  return 0.3;
}

// The English rec dict has no space. A comma or a camel-case join is the break we can see.
export function softenPhrase(text) {
  return String(text || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/,(\S)/g, ", $1")
    .replace(/;(\S)/g, "; $1")
    .replace(/(\S)\(/g, "$1 (")
    .replace(/\)([A-Za-z])/g, ") $1");
}

export function wordItem(text, x0, x1, box, conf) {
  const width = Math.max(0.4, x1 - x0);
  const size = Math.max(0.5, box.y1 - box.y0);
  const base = box.y1 - 0.2 * size;
  const sized = round2(size);
  return {
    str: text,
    transform: [sized, 0, 0, sized, round2(x0), round2(base)],
    width: round2(width),
    height: sized,
    y0: round2(base - 0.8 * sized),
    y1: round2(base + 0.22 * sized),
    fontName: "ocr",
    conf: bucketConf(conf),
    mean: round3(conf),
  };
}

// One cell crop → a single string. Letters get the punctuation breaks; a number is left intact
// so "1,234" is not split into two tokens the numeric repair would then refuse.
export function ctcText({ logits, time, classes, dict }) {
  const chars = ctcDecode(logits, time, classes, dict);
  if (!chars.length) return { text: "", conf: 0 };
  let raw = "";
  let conf = 0;
  let n = 0;
  for (const ch of chars) {
    if (SPACE.has(ch.ch)) raw += " ";
    else { raw += ch.ch; conf += ch.conf; n++; }
  }
  raw = raw.replace(/\s+/g, " ").trim();
  const text = /[A-Za-z]/.test(raw) ? softenPhrase(raw) : raw;
  return { text, conf: n ? Math.round((conf / n) * 1000) / 1000 : 0 };
}

// One detection box → one or more word items. `box` is {x0,y0,x1,y1} in page points.
export function wordsFromCtc({ logits, time, classes, dict, box }) {
  const chars = ctcDecode(logits, time, classes, dict);
  if (!chars.length || !box) return [];
  const span = Math.max(0.4, box.x1 - box.x0);
  const groups = [];
  let cur = [];
  const flush = () => { if (cur.length) groups.push(cur); cur = []; };
  for (const ch of chars) {
    if (SPACE.has(ch.ch)) flush();
    else cur.push(ch);
  }
  flush();
  if (!groups.length) return [];
  // No emitted spaces: one phrase, then split on punctuation / camel case by character share.
  if (groups.length === 1 && !chars.some((ch) => SPACE.has(ch.ch))) {
    const text = groups[0].map((ch) => ch.ch).join("");
    const parts = softenPhrase(text).split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
      const conf = groups[0].reduce((s, ch) => s + ch.conf, 0) / groups[0].length;
      return text ? [wordItem(text, box.x0, box.x1, box, conf)] : [];
    }
    const total = parts.reduce((s, p) => s + p.length, 0);
    let x = box.x0;
    const conf = groups[0].reduce((s, ch) => s + ch.conf, 0) / groups[0].length;
    return parts.map((part) => {
      const w = span * (part.length / total);
      const item = wordItem(part, x, x + w, box, conf);
      x += w;
      return item;
    });
  }
  return groups.map((group) => {
    const text = group.map((ch) => ch.ch).join("");
    const t0 = group[0].t;
    const t1 = group[group.length - 1].t + 1;
    const x0 = box.x0 + (t0 / time) * span;
    const x1 = box.x0 + (t1 / time) * span;
    const conf = group.reduce((s, ch) => s + ch.conf, 0) / group.length;
    return wordItem(text, x0, x1, box, conf);
  }).filter((item) => item.str);
}

const TALL_RE = /[A-Z0-9bdfhklt]/;
const DESC_RE = /[gjpqy,;()[\]{}|/_@]/;
const NUMBERISH_RE = /^[\d.,()%+\-–—OoDQBSslIZG|]+$/;
// English rec reads a ruling-line fragment as a short Y/c run. Real words are longer or more confident.
const ECHO_RE = /^(?:c+|y[aeinm]{0,6}|ge|gae)$/i;

function withoutEchoes(items) {
  const kept = [];
  for (const item of items) {
    const mean = item.mean;
    delete item.mean;
    if (ECHO_RE.test(item.str) && !(mean >= 0.92)) continue;
    kept.push(item);
  }
  return kept;
}

// Body size is the median plain glyph. A detection box is often taller than the glyph, and a
// tight scan then sits closer than 0.7 em, which is the parser's row-split. When the baseline
// pitch is tighter than that, shrink the body so rows stay apart.
function bodySizeOf(items) {
  const wordy = items.filter((item) => item.str.length >= 3 || /\d/.test(item.str));
  const source = wordy.length >= 4 ? wordy : items;
  const plain = source.filter((item) => TALL_RE.test(item.str) && !DESC_RE.test(item.str));
  const pool = (plain.length ? plain : source).map((item) => item.transform[0]).sort((a, b) => a - b);
  const median = pool[pool.length >> 1] || items[0].transform[0];
  let body = median;
  const sorted = items.map((item) => item.transform[5]).sort((a, b) => a - b);
  const bases = [];
  for (const base of sorted) {
    if (!bases.length || base - bases[bases.length - 1] > 0.35 * median) bases.push(base);
  }
  const gaps = [];
  for (let i = 1; i < bases.length; i++) {
    const gap = bases[i] - bases[i - 1];
    if (gap > 0.4 * median && gap < 2.5 * median) gaps.push(gap);
  }
  if (gaps.length >= 4) {
    gaps.sort((a, b) => a - b);
    const pitch = gaps[gaps.length >> 1];
    if (pitch < 0.7 * median) body = pitch / 0.95;
  }
  return { body, median };
}

// Items sorted by baseline → rows. An item joins the row when it sits within 0.3 em of the
// row's last baseline and the row stays under 0.45 em tall.
export function baselineRows(sorted) {
  const rows = [];
  let row = null;
  for (const item of sorted) {
    const base = item.transform[5];
    const size = item.transform[0] || 1;
    if (row && base - row.last <= 0.3 * size && base - row.first <= 0.45 * size) {
      row.items.push(item);
      row.last = base;
      continue;
    }
    row = { first: base, last: base, items: [item] };
    rows.push(row);
  }
  return rows.map((r) => r.items);
}

// Width-weighted median baseline: a superscript mark or a short speck does not move the row.
export function rowBaseline(row) {
  const pairs = row.map((item) => [item.transform[5], Math.max(0.1, item.width || 0)]).sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let acc = 0;
  for (const [base, w] of pairs) {
    acc += w;
    if (acc >= total / 2) return base;
  }
  return pairs[pairs.length - 1][0];
}

// Same idea as the helper: one body size, one baseline per row, specks dropped.
export function snapOcrItems(items) {
  if (!items.length) return [];
  items = withoutEchoes(items);
  if (!items.length) return [];
  const { body, median } = bodySizeOf(items);
  const kept = [];
  for (const item of items) {
    const size = item.transform[0];
    if (size < 0.45 * median && !(item.conf >= 1 && NUMBERISH_RE.test(item.str))) continue;
    if (size >= 0.45 * median && size <= 1.5 * median && body > 0) {
      const base = item.transform[5];
      const sized = round2(body);
      item.transform[0] = sized;
      item.transform[3] = sized;
      item.height = sized;
      item.y0 = round2(base - 0.8 * sized);
      item.y1 = round2(base + 0.22 * sized);
    }
    kept.push(item);
  }
  kept.sort((a, b) => a.transform[5] - b.transform[5] || a.transform[4] - b.transform[4]);
  for (const row of baselineRows(kept)) {
    const anchor = rowBaseline(row);
    for (const item of row) {
      const shift = anchor - item.transform[5];
      item.transform[5] = round2(anchor);
      item.y0 = round2(item.y0 + shift);
      item.y1 = round2(item.y1 + shift);
    }
  }
  kept.sort((a, b) => a.transform[5] - b.transform[5] || a.transform[4] - b.transform[4]);
  return kept;
}

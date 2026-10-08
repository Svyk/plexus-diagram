// Second read for OCR text lines (headings, notes, captions: words outside every table). Pure.
//
// linesToReread(doc, ocrPages, opts) groups each in-browser OCR page's words into lines and
// returns the doubtful ones as crop requests ({ page, bbox, line: true, key }); the OCR source
// reads them whole at 1-3× (recognize.js readLine). applyLineReads keeps a re-read only when it
// leaves fewer suspicious words (or as many, at a higher confidence), then runs the case and
// lexicon fixes. Table words are never touched here: tables have their own cell re-read.

import { cleanWord, correctWord, lineCase, normalizeCase, properNouns, splitJoined, suspiciousWord } from "../ocr/lexicon.js";
import { bucketConf } from "../ocr/words-from-ctc.js";

const LOW_MEAN = 0.8;
const MIN_READ_CONF = 0.75;
const AGREE_CONF = 0.9;
// The rec model reads a crop up to ~40× its height well; longer lines go in pieces.
const MAX_ASPECT = 38;
const PAD_PT = 1.5;

function r2(n) { return Math.round(n * 100) / 100; }

function itemSize(it) { return Math.abs(it.transform?.[0] || it.height || 0); }

function inside(it, boxes) {
  const size = itemSize(it);
  const cx = it.transform[4] + (it.width || 0) / 2;
  const cy = it.transform[5] - 0.35 * size;
  return boxes.some((b) => cx >= b[0] - 1 && cx <= b[2] + 1 && cy >= b[1] - 1 && cy <= b[3] + 1);
}

function wordConf(it) { return it.mean ?? it.conf ?? 1; }

// Lines of one page record: words outside `tableBoxes`, same baseline (±0.5 size), similar size,
// and no gap wider than 2.5 sizes. Returns [{ idx: [item indices], bbox, size }].
export function textLines(page, tableBoxes = []) {
  const items = page?.items || [];
  const cand = [];
  items.forEach((it, i) => {
    if (!it || !it.str || !it.str.trim() || !Array.isArray(it.transform)) return;
    if (it.transform[1] || it.transform[2]) return;
    const size = itemSize(it);
    if (!(size > 0)) return;
    if (it.y0 != null && it.y1 != null && it.y1 - it.y0 > 1.6 * size) return;
    // A rotated word (a page-edge running title) comes back as a tall, narrow box.
    if (it.y0 != null && it.y1 != null && it.str.length >= 3 && it.y1 - it.y0 > 2.5 * it.width) return;
    if (inside(it, tableBoxes)) return;
    cand.push(i);
  });
  cand.sort((a, b) => items[a].transform[5] - items[b].transform[5] || items[a].transform[4] - items[b].transform[4]);
  const rows = [];
  for (const i of cand) {
    const it = items[i];
    const size = itemSize(it);
    const row = rows.find((r) => Math.abs(r.base - it.transform[5]) <= 0.5 * Math.min(size, r.size) && Math.abs(size - r.size) <= 0.3 * Math.max(size, r.size));
    if (row) row.idx.push(i);
    else rows.push({ base: it.transform[5], size, idx: [i] });
  }
  const lines = [];
  for (const row of rows) {
    row.idx.sort((a, b) => items[a].transform[4] - items[b].transform[4]);
    let cur = null;
    for (const i of row.idx) {
      const it = items[i];
      const x0 = it.transform[4];
      if (cur && x0 - cur.x1 <= 2.5 * row.size) {
        cur.idx.push(i);
        cur.x1 = Math.max(cur.x1, x0 + it.width);
      } else {
        cur = { idx: [i], x1: x0 + it.width, size: row.size };
        lines.push(cur);
      }
    }
  }
  const out = lines.map((l) => {
    const its = l.idx.map((i) => items[i]);
    const bases = its.map((t) => t.transform[5]).sort((a, b) => a - b);
    const bbox = [
      Math.min(...its.map((t) => t.transform[4])),
      Math.min(...its.map((t) => t.y0 ?? t.transform[5] - 0.8 * itemSize(t))),
      Math.max(...its.map((t) => t.transform[4] + t.width)),
      Math.max(...its.map((t) => t.y1 ?? t.transform[5] + 0.2 * itemSize(t))),
    ];
    return { idx: l.idx, bbox, size: l.size, base: bases[bases.length >> 1] };
  });
  // Clip each box clear of the lines (descenders, cap tops) and tables above and below it.
  for (const l of out) {
    let [x0, y0, x1, y1] = l.bbox;
    for (const m of out) {
      if (m === l || m.bbox[2] <= x0 || m.bbox[0] >= x1) continue;
      if (m.base > l.base) y1 = Math.min(y1, m.base - 0.72 * m.size);
      else if (m.base < l.base) y0 = Math.max(y0, m.base + 0.22 * m.size);
    }
    for (const t of tableBoxes) {
      if (t[2] <= x0 || t[0] >= x1) continue;
      if (t[3] <= l.base) y0 = Math.max(y0, t[3]);
      else if (t[1] >= l.base) y1 = Math.min(y1, t[1]);
    }
    if (y1 - y0 >= 0.6 * l.size) l.bbox = [x0, y0, x1, y1];
    l.bbox = l.bbox.map(r2);
  }
  return out.map(({ idx, bbox, size }) => ({ idx, bbox, size }));
}

// Split a line into pieces the rec model reads whole, at word gaps.
function pieces(page, line) {
  const items = page.items;
  const h = line.bbox[3] - line.bbox[1] + 2 * PAD_PT;
  const maxW = MAX_ASPECT * h;
  if (line.bbox[2] - line.bbox[0] + 2 * PAD_PT <= maxW) return [line];
  const out = [];
  let cur = [];
  let x0 = 0;
  for (const i of line.idx) {
    const it = items[i];
    if (cur.length && it.transform[4] + it.width - x0 + 2 * PAD_PT > maxW) { out.push(cur); cur = []; }
    if (!cur.length) x0 = it.transform[4];
    cur.push(i);
  }
  if (cur.length) out.push(cur);
  return out.map((idx) => {
    const its = idx.map((i) => items[i]);
    return {
      idx,
      size: line.size,
      bbox: [
        Math.min(...its.map((t) => t.transform[4])), line.bbox[1],
        Math.max(...its.map((t) => t.transform[4] + t.width)), line.bbox[3],
      ].map(r2),
    };
  });
}

function tableBoxesOf(doc, n) {
  return Object.values(doc?.blocks || {}).filter((b) => b && b.type === "table" && b.page === n && Array.isArray(b.bbox)).map((b) => b.bbox);
}

function allWords(pages, doc) {
  const words = [];
  for (const p of pages) {
    const boxes = tableBoxesOf(doc, p.n);
    for (const line of textLines(p, boxes)) for (const i of line.idx) words.push(p.items[i].str);
  }
  return words;
}

const NON_LETTER = /^[^A-Za-z]+$/;

const MARK = /[^\x20-\x7e]/g;

function coreOf(t) { return String(t).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").toLowerCase(); }

// Suspicious words, plus what a candidate lost from the first read: number and dash tokens,
// marks outside ASCII (superscripts, daggers, dashes), and words.
function lineScore(tokens, oldTokens, opts) {
  let n = tokens.reduce((k, w) => k + (suspiciousWord(w, opts) ? 1 : 0), 0);
  for (const t of oldTokens) if (NON_LETTER.test(t) && !tokens.some((w) => w === t || (t.length >= 2 && w.includes(t)))) n++;
  const marks = (list) => list.join(" ").match(MARK) || [];
  const have = marks(tokens);
  for (const m of marks(oldTokens)) {
    const at = have.indexOf(m);
    if (at < 0) n++;
    else have.splice(at, 1);
  }
  // A word of 3+ letters with nothing close to it in the candidate was dropped (names are not in
  // the list, so a read that loses "Portland" must not look cleaner for it).
  const cores = tokens.map(coreOf);
  const pairs = new Set(cores.slice(1).map((k, i) => (/^[a-z]+$/.test(cores[i]) && /^[a-z]+$/.test(k) ? cores[i] + k : "")).filter(Boolean));
  for (const t of oldTokens) {
    const c = coreOf(t);
    if (c.length < 3 || !/^[a-z]+$/.test(c) || pairs.has(c)) continue;
    const reach = Math.max(1, Math.floor(c.length / 3));
    if (!cores.some((k) => k === c || (Math.abs(k.length - c.length) <= reach && editDistance(k, c) <= reach))) n++;
  }
  return n;
}

// A dictionary word of the first read comes back where the chosen read has a close suspicious
// word or one letter different in its place ("Note:" read again as "Not:").
function restoreClean(tokens, oldTokens, opts) {
  if (!opts.lexicon) return tokens;
  const pair = alignTokens(tokens, oldTokens);
  return tokens.map((tok, i) => {
    const j = pair[i];
    if (j < 0) return tok;
    const was = oldTokens[j];
    if (was === tok || !cleanWord(was, opts.lexicon)) return tok;
    const d = editDistance(coreOf(tok), coreOf(was));
    if (d === 1 || (suspiciousWord(tok, opts) && d <= Math.max(2, Math.floor(coreOf(was).length / 3)))) return was;
    return tok;
  });
}

// Pages this pass reads: in-browser OCR records only (the helper's Vision words are left alone).
export function linePages(ocrPages) {
  return (ocrPages || []).filter((p) => p && p.engine === "ppocr-web" && Array.isArray(p.items));
}

// Crop requests for doubtful text lines. A line is doubtful when a word has a low mean
// confidence, odd case inside a word, digits inside letters, or (with a lexicon) a word the list
// does not hold. `key` is "page:i,j,k" (the item indices the read replaces).
export function linesToReread(doc, ocrPages, { lexicon = null } = {}) {
  const pages = linePages(ocrPages);
  const keep = properNouns(allWords(pages, doc));
  const out = [];
  for (const p of pages) {
    const boxes = tableBoxesOf(doc, p.n);
    for (const line of textLines(p, boxes)) {
      const words = line.idx.map((i) => p.items[i]);
      if (!words.some((w) => /[A-Za-z]{2}/.test(w.str))) continue;
      const doubtful = words.some((w) => (/[A-Za-z]/.test(w.str) && wordConf(w) < LOW_MEAN) || suspiciousWord(w.str, { lexicon, keep }));
      if (!doubtful) continue;
      for (const piece of pieces(p, line)) {
        out.push({ page: p.n, bbox: piece.bbox, line: true, key: `${p.n}:${piece.idx.join(",")}` });
      }
    }
  }
  return out;
}

// Case and lexicon fixes over a token list (a run-together pair of words may come back as two). `confs` (optional) are per-character confidences of
// `tokens.join(" ")`; without them a token is corrected only when its own `conf` is low.
export function fixTokens(tokens, { lexicon = null, keep = null, confs = null, wordConfs = null } = {}) {
  const dominant = lineCase(tokens);
  let at = 0;
  return tokens.map((tok, k) => {
    const start = at;
    at += tok.length + 1;
    const cased = normalizeCase(tok.replace(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/, "$2"), dominant);
    let t = tok.replace(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/, (_, a, _b, c) => a + cased + c);
    const m = /^([^A-Za-z0-9]*)([A-Za-z]+)([^A-Za-z0-9]*)$/.exec(t);
    let letterConfs = null;
    if (m && confs) {
      const from = start + m[1].length;
      letterConfs = confs.slice(from, from + m[2].length);
    }
    t = correctWord(t, { lexicon, keep, confs: letterConfs, conf: wordConfs ? wordConfs[k] : 1 });
    return splitJoined(t, lexicon);
  }).flat();
}

function editDistance(a, b) {
  const prev = new Array(b.length + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

// Token alignment (equal tokens free, substitutions and gaps cost 1). Returns, for each token
// of `a`, the index of its partner in `b` or -1.
function alignTokens(a, b) {
  const n = a.length;
  const m = b.length;
  const cost = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cost[i][j] = Math.min(cost[i - 1][j] + 1, cost[i][j - 1] + 1, cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  const pair = new Array(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (cost[i][j] === cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { pair[i - 1] = j - 1; i--; j--; }
    else if (cost[i][j] === cost[i - 1][j] + 1) i--;
    else j--;
  }
  return pair;
}

// A suspicious word of the chosen read takes the same word from another scale's read when that
// one is clean and close (edit distance ≤ 2): the 2× read has "reported" where 1× has "reparted".
export function repairTokens(tokens, others, opts = {}) {
  const out = tokens.slice();
  for (const other of others || []) {
    if (!other || other === tokens) continue;
    const pair = alignTokens(out, other);
    out.forEach((tok, i) => {
      const j = pair[i];
      if (j < 0 || other[j] === tok || !suspiciousWord(tok, opts) || suspiciousWord(other[j], opts)) return;
      const a = tok.toLowerCase();
      const b = other[j].toLowerCase();
      if (/[A-Za-z]/.test(b) && editDistance(a, b) <= Math.min(2, Math.floor(a.length / 3))) out[i] = other[j];
    });
  }
  return out;
}

// A lone hyphen the first read also saw as a lone dash takes the glyph its ink width says
// (as restoreDashes does inside a segment): about an em → "—", half → "–".
function dashGlyphs(tokens, old) {
  const dashes = old.filter((it) => /^[-–—]$/.test(it.str));
  if (!dashes.length) return tokens;
  let k = 0;
  return tokens.map((t) => {
    if (!/^[-–—]$/.test(t) || k >= dashes.length) return t;
    const it = dashes[k++];
    const size = itemSize(it);
    if (!(size > 0)) return t;
    if (it.width >= 0.77 * size) return "—";
    if (it.width >= 0.4 * size) return "–";
    return t;
  });
}

// New word items for a line: the old geometry when the word count holds, else the line's span
// shared out by character count.
function lineItems(old, tokens, confs) {
  const tokConf = [];
  let at = 0;
  for (const tok of tokens) {
    const slice = confs ? confs.slice(at, at + tok.length) : [];
    tokConf.push(slice.length ? slice.reduce((s, c) => s + c, 0) / slice.length : 1);
    at += tok.length + 1;
  }
  if (tokens.length === old.length) {
    // One line, one baseline: a word the page pass placed a little high joins its line again.
    const bases = old.map((t) => t.transform[5]).sort((a, b) => a - b);
    const base = bases[bases.length >> 1];
    return old.map((it, k) => {
      const dy = base - it.transform[5];
      const moved = dy ? { transform: [...it.transform.slice(0, 5), base], ...(it.y0 != null ? { y0: r2(it.y0 + dy), y1: r2(it.y1 + dy) } : {}) } : {};
      return { ...it, ...moved, str: tokens[k], conf: bucketConf(tokConf[k]) };
    });
  }
  const x0 = Math.min(...old.map((t) => t.transform[4]));
  const x1 = Math.max(...old.map((t) => t.transform[4] + t.width));
  const first = old[0];
  const total = tokens.reduce((n, t) => n + t.length, 0) + Math.max(0, tokens.length - 1);
  const unit = (x1 - x0) / Math.max(1, total);
  let x = x0;
  return tokens.map((tok, k) => {
    const w = tok.length * unit;
    const item = {
      ...first,
      str: tok,
      transform: [first.transform[0], 0, 0, first.transform[3], r2(x), first.transform[5]],
      width: r2(w),
      conf: bucketConf(tokConf[k]),
    };
    x += w + unit;
    return item;
  });
}

// Apply line re-reads to copies of the page records. `results` are in request order, each
// { text, conf, confs }. Returns { pages, applied: [{ page, from, to }] }; pages that did not
// change are returned as they were.
export function applyLineReads(ocrPages, requests, results, { lexicon = null, doc = null } = {}) {
  const pages = (ocrPages || []).slice();
  const applied = [];
  const keep = properNouns(allWords(linePages(pages), doc));
  const edits = new Map();
  (requests || []).forEach((req, k) => {
    const res = results?.[k];
    const [pn, list] = String(req.key || "").split(":");
    const idx = (list || "").split(",").filter(Boolean).map(Number);
    const pi = pages.findIndex((p) => p && String(p.n) === pn && p.engine === "ppocr-web");
    if (pi < 0 || !idx.length) return;
    const page = pages[pi];
    const old = idx.map((i) => page.items[i]).filter(Boolean);
    if (old.length !== idx.length) return;
    const oldTokens = old.map((it) => it.str);
    const oldFixed = fixTokens(oldTokens, { lexicon, keep, wordConfs: old.map(wordConf) });
    const oldConf = old.reduce((s, it) => s + wordConf(it) * it.str.length, 0) / Math.max(1, old.reduce((s, it) => s + it.str.length, 0));
    let best = { tokens: oldFixed, score: lineScore(oldFixed, oldTokens, { lexicon, keep }), conf: oldConf, confs: null };
    const reads = Array.isArray(res?.reads) && res.reads.length ? res.reads : (res ? [res] : []);
    const seen = reads.map((read) => String(read?.text || "").trim());
    for (const read of reads) {
      const text = String(read?.text || "").trim();
      if (!text || (read.conf ?? 0) < MIN_READ_CONF) continue;
      const tokens = text.split(" ").filter(Boolean);
      if (Math.abs(tokens.length - old.length) > Math.max(2, Math.round(0.25 * old.length))) continue;
      const fixed = restoreClean(fixTokens(tokens, { lexicon, keep, confs: read.confs || null }), oldFixed, { lexicon, keep });
      const score = lineScore(fixed, oldTokens, { lexicon, keep });
      // Page words carry only Vision's conf buckets, so a tie with them goes to a read two
      // scales agree on.
      const agreed = best.confs === null && score === best.score && read.conf >= AGREE_CONF && seen.filter((t) => t === text).length >= 2;
      if (score < best.score || agreed || (score === best.score && read.conf > best.conf)) best = { tokens: fixed, score, conf: read.conf, confs: read.confs || [] };
    }
    const cands = reads.map((read) => {
      const text = String(read?.text || "").trim();
      if (!text || (read.conf ?? 0) < MIN_READ_CONF) return null;
      return fixTokens(text.split(" ").filter(Boolean), { lexicon, keep, confs: read.confs || null });
    }).filter(Boolean);
    let repaired = repairTokens(best.tokens, cands, { lexicon, keep });
    if (best.confs !== null) repaired = restoreClean(repaired, oldFixed, { lexicon, keep });
    const next = dashGlyphs(repaired, old);
    const nextConfs = best.confs && best.confs.length ? best.confs : null;
    if (next.join(" ") === oldTokens.join(" ")) return;
    if (!edits.has(pi)) edits.set(pi, []);
    edits.get(pi).push({ idx, items: lineItems(old, next, nextConfs && next.join(" ").length === nextConfs.length ? nextConfs : null) });
    applied.push({ page: page.n, from: oldTokens.join(" "), to: next.join(" ") });
  });
  for (const [pi, list] of edits) {
    const page = pages[pi];
    const drop = new Set(list.flatMap((e) => e.idx));
    const items = [];
    page.items.forEach((it, i) => {
      if (!drop.has(i)) { items.push(it); return; }
      const edit = list.find((e) => e.idx[0] === i);
      if (edit) items.push(...edit.items);
    });
    pages[pi] = { ...page, items };
  }
  return { pages, applied };
}

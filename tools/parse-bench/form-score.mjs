#!/usr/bin/env node
// Form scorer for scanned quality-assurance form pages (answer keys in keyspec-v2 shape).
//   node tools/parse-bench/form-score.mjs --keys <dir> --engine name=<dir> [--engine name=<dir> ...]
//     [--json out.json] [--per-page] [--pair a,b] [--detail] [--only id-part]
// <dir> of an engine holds <id>.pxd.json or <id>.json, a Plexus parse result of that page
// (blocks, order, tables with cells, lists with items, figures, removed). A page with no file
// is not scored for that engine and is listed as a gap.
//
// Components, per page and pooled (every one is printed; the composite is a convenience):
//   fields      label-paired values; header / free / review apart; decision items weigh 2
//   hand cells  headline tier (case-folded, confusable-folded for initials), drop rate
//   printed     cells at their anchor, exact (legacy normText)
//   GriTS       Top and Con, bbox-first table matching, twin panels take the best of three readings
//   checks      state (and selected set) equal
//   marks       strike (text found, nothing invented), signature presence F1, footnote-mark recall
//   body        1 - CER of body / note / footnote lines against the page text (semi-global line bag)
//   blank       share of blank pages with no output, characters and figures emitted
//   insertion   emitted characters the key does not support
// Composite weights (synthesis section 4): fields .30, hand cells .25, GriTS-Top .15, marks .15, body .15.
// Paired mode: per component, mean paired delta, bootstrap 95% CI, one-sided Wilcoxon p (paired-stats.mjs).
//
// Matching notes (the rules the spec leaves open):
//   field labels: exact, prefix, contained-before-colon, or edit similarity >= .85; the value is the rest of
//     the unit, else the right then lower cell, else the next unit in the same row band, else the next unit.
//   lines: each key line is matched to its best substring of the page's non-table text (edit distance),
//     so merged paragraphs still match; extra text is charged to the insertion rate, not to the CER.
//   insertion: each emitted word consumes one key word (exact, else edit distance <= 25%); the rest is unsupported.
//   rotated pages: table matching is text only; predicted boxes are mapped to the upright frame (KEYSPEC section 1).
import { homedir } from "node:os";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { normText } from "../../test/parse-metrics.js";
import { gritsCon, gritsTop } from "./grits.mjs";
import { bootstrapCI, mean, wilcoxon } from "./paired-stats.mjs";
import { boxIou, normBox, pageSize } from "./scan-score.mjs";

// ---- normalisation (KEYSPEC section 5) ----

const circled = (s) => s
  .replace(/[①-⑳]/g, (c) => `(${c.codePointAt(0) - 0x2460 + 1})`)
  .replace(/[⑴-⒇]/g, (c) => `(${c.codePointAt(0) - 0x2474 + 1})`)
  .replace(/[❶-❿]/g, (c) => `(${c.codePointAt(0) - 0x2776 + 1})`);

export function norm(text, type) {
  let s = circled(String(text ?? "")).normalize("NFKC").replace(/[‐-―−]/g, "-").replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'");
  s = s.replace(/\s+/g, " ").trim();
  if (type === "tick") {
    if (/^[✓✔√☑]$/.test(s)) s = "✓";
    else if (/^[Xx✗✘×☒]$/.test(s)) s = "X";
  }
  return s;
}

const CONFUSABLE = new Map();
for (const [chars, to] of [["OoQD0", "0"], ["Il1i|!", "1"], ["Zz2", "2"], ["Ss5", "5"], ["Gb6", "6"], ["B8", "8"], ["gq9", "9"], ["UuVv", "u"]]) {
  for (const ch of chars) CONFUSABLE.set(ch, to);
}

function confuse(s) {
  let out = "";
  for (const ch of s) out += ch === "?" ? "?" : (CONFUSABLE.get(ch) ?? ch.toLowerCase());
  return out.replace(/(\d),(?=\d)/g, "$1.");
}

// Edit distance where "?" in the key matches any single character at cost 0.
export function wildDist(key, got) {
  const a = [...key];
  const b = [...got];
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === "?" || a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

// Minimum edit distance between the pattern (key side, "?" is a wildcard) and any substring of text.
export function semiGlobal(pat, text) {
  const m = pat.length;
  if (!m) return 0;
  const n = text.length;
  let col = Array.from({ length: m + 1 }, (_, i) => i);
  let best = col[m];
  for (let j = 1; j <= n; j++) {
    const next = new Array(m + 1);
    next[0] = 0;
    for (let i = 1; i <= m; i++) {
      const cost = pat[i - 1] === "?" || pat[i - 1] === text[j - 1] ? 0 : 1;
      next[i] = Math.min(col[i] + 1, next[i - 1] + 1, col[i - 1] + cost);
    }
    col = next;
    if (col[m] < best) best = col[m];
    if (best === 0) break;
  }
  return best;
}

const sim = (d, a, b) => {
  const n = Math.max([...a].length, [...b].length);
  return n ? 1 - d / n : 1;
};

// Compare an expected (key) value with a read value. Returns the three tiers and the similarity.
export function tiers(expected, got, { type = "text", ink = "hand", strip = false } = {}) {
  let e = norm(expected, type);
  let g = norm(got, type);
  if (strip || type === "date" || type === "time" || ink === "stamp") {
    e = e.replace(/\s+/g, "");
    g = g.replace(/\s+/g, "");
  }
  const exact = wildDist(e, g) === 0;
  const folded = exact || wildDist(e.toLowerCase(), g.toLowerCase()) === 0;
  const dc = wildDist(confuse(e), confuse(g));
  const conf = folded || dc === 0;
  const similarity = sim(wildDist(e.toLowerCase(), g.toLowerCase()), e, g);
  return { exact, folded, conf, sim: similarity };
}

// ---- geometry ----

export function rotBox(box, rot) {
  if (!box || !rot) return box;
  const map = { 90: (x, y) => [1 - y, x], 180: (x, y) => [1 - x, 1 - y], 270: (x, y) => [y, 1 - x] }[rot];
  if (!map) return box;
  const p = [map(box[0], box[1]), map(box[2], box[3])];
  return [Math.min(p[0][0], p[1][0]), Math.min(p[0][1], p[1][1]), Math.max(p[0][0], p[1][0]), Math.max(p[0][1], p[1][1])];
}

const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const centreIn = (a, box, m = 0) => {
  const x = (a[0] + a[2]) / 2;
  const y = (a[1] + a[3]) / 2;
  return x >= box[0] - m && x <= box[2] + m && y >= box[1] - m && y <= box[3] + m;
};

// ---- predicted document -> units ----

function predModel(doc, rot) {
  const units = [];
  const tables = [];
  const figures = [];
  const size = pageSize(doc, (doc.pages && doc.pages[0] && doc.pages[0].n) || 1);
  const nb = (b) => {
    const n = normBox(b, size.w, size.h);
    return n ? rotBox(n, rot) : null;
  };
  let ord = 0;
  const addBlock = (text, bbox, id) => {
    const t = norm(text);
    if (!t) return;
    units.push({ kind: "block", id, text: t, lt: t.toLowerCase(), bbox: nb(bbox), ord: ord++ });
  };
  for (const id of doc.order || []) {
    const b = doc.blocks[id];
    if (!b) continue;
    if (b.type === "table") {
      const cells = [...(b.cells || [])].sort((x, y) => x.r - y.r || x.c - y.c);
      const tb = { id, idx: tables.length, bbox: nb(b.bbox), rows: b.rows, cols: b.cols, headerRows: b.headerRows || 0, cells, units: [] };
      tables.push(tb);
      for (const c of cells) {
        const t = norm(c.text);
        const u = { kind: "cell", id, tbl: tb.idx, r: c.r, c: c.c, rowSpan: c.rowSpan || 1, colSpan: c.colSpan || 1, text: t, lt: t.toLowerCase(), bbox: nb(c.wbox || c.bbox), ord: ord++ };
        units.push(u);
        tb.units.push(u);
      }
    } else if (b.type === "figure") {
      figures.push({ id, bbox: nb(b.bbox) });
    } else if (b.type === "list") {
      for (const it of b.items || []) addBlock(it.text, b.bbox, id);
    } else if (b.type !== "scan" && b.text) {
      addBlock(b.text, b.bbox, id);
    }
  }
  return { units, tables, figures };
}

function cellGrid(cells) {
  const map = new Map();
  for (const c of cells) {
    for (let i = 0; i < (c.rowSpan || 1); i++) for (let j = 0; j < (c.colSpan || 1); j++) if (!map.has(`${c.r + i},${c.c + j}`)) map.set(`${c.r + i},${c.c + j}`, c);
  }
  return map;
}

// ---- tables ----

const LABEL_COL = /^[([]?\d{1,3}[)\].]?$/;

function dropLabelColumn(pred, truthCols) {
  if (!pred || pred.cols <= truthCols) return pred;
  for (const side of ["first", "last"]) {
    const col = side === "first" ? 0 : pred.cols - 1;
    const here = pred.cells.filter((c) => c.c === col && (c.colSpan || 1) === 1);
    const texts = here.map((c) => norm(c.text)).filter(Boolean);
    if (texts.length >= 2 && texts.every((t) => LABEL_COL.test(t)) && pred.cells.every((c) => c.c !== col || (c.colSpan || 1) === 1)) {
      const cells = pred.cells.filter((c) => c.c !== col).map((c) => (side === "first" ? { ...c, c: c.c - 1 } : c));
      return { ...pred, cells, cols: pred.cols - 1 };
    }
  }
  return pred;
}

const textSet = (cells) => cells.map((c) => normText(c.text)).filter(Boolean);
function jacc(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / (A.size + B.size - n);
}

// bbox IoU >= 0.5 first (not on rotated pages), then text Jaccard > 0.2.
function matchTables(truths, preds, used, rotated) {
  const out = new Map();
  if (!rotated) {
    const pairs = [];
    truths.forEach((t, i) => preds.forEach((p) => {
      if (t.bbox && p.bbox && !used.has(p.id)) {
        const v = boxIou(t.bbox, p.bbox);
        if (v >= 0.5) pairs.push({ i, p, v });
      }
    }));
    pairs.sort((a, b) => b.v - a.v);
    for (const { i, p } of pairs) {
      if (out.has(i) || used.has(p.id)) continue;
      out.set(i, p);
      used.add(p.id);
    }
  }
  truths.forEach((t, i) => {
    if (out.has(i)) return;
    let best = null;
    for (const p of preds) {
      if (used.has(p.id)) continue;
      const s = jacc(textSet(p.cells), textSet(t.cells.filter((c) => !c.unsure)));
      if (s > 0.2 && (!best || s > best.s)) best = { p, s };
    }
    if (best) { out.set(i, best.p); used.add(best.p.id); }
  });
  return out;
}

function tag(table, ti) {
  return { ...table, cells: table.cells.map((c) => ({ ...c, _ti: ti, _r: c.r, _c: c.c })) };
}

function mergeTruth(a, b, layout) {
  const cells = a.cells.map((c) => ({ ...c }));
  let mapB;
  let rows;
  let cols;
  if (layout === "side") {
    for (const c of b.cells) cells.push({ ...c, c: c.c + a.cols });
    mapB = (r, c) => [r, c + a.cols];
    rows = Math.max(a.rows, b.rows);
    cols = a.cols + b.cols;
  } else {
    let drop = 0;
    if (b.headerRows && b.headerRows <= a.headerRows) {
      const hs = (t, n) => t.cells.filter((c) => c.r < n).map((c) => normText(c.text)).join("|");
      const x = hs(a, b.headerRows);
      const y = hs(b, b.headerRows);
      if (y && sim(wildDist(x, y), x, y) >= 0.8) drop = b.headerRows;
    }
    for (const c of b.cells) if (c.r >= drop) cells.push({ ...c, r: c.r - drop + a.rows });
    mapB = (r, c) => (r < drop ? null : [r - drop + a.rows, c]);
    rows = a.rows + b.rows - drop;
    cols = Math.max(a.cols, b.cols);
  }
  return { cells, rows, cols, headerRows: a.headerRows, bbox: null, mapB };
}

const gSum = (units) => {
  let m = 0;
  let n = 0;
  for (const u of units) {
    const r = gritsCon(u.pred ? u.pred.cells : [], u.truth.cells);
    m += r.matched;
    n += r.sizeA + r.sizeB;
  }
  return n ? (2 * m) / n : 1;
};

// Returns units [{ truth, pred }] and tmap: key table index -> { pred, map(r, c) }.
function buildUnits(key, model, rotated) {
  const hasRowLabel = new Set(key.marks.filter((m) => m.type === "row-label").map((m) => m.at.table));
  const truthTables = key.tables.map((t, i) => tag(t, i));
  const used = new Set();
  const panelOf = new Map();
  key.tables.forEach((t, i) => {
    if (t.panel && t.panel.group != null) {
      const g = panelOf.get(t.panel.group) || [];
      g.push(i);
      panelOf.set(t.panel.group, g);
    }
  });
  const groups = [...panelOf.values()].filter((g) => g.length === 2).map((g) => g.sort((a, b) => key.tables[a].panel.index - key.tables[b].panel.index));
  const inGroup = new Set(groups.flat());
  const prep = (p, ti) => (p ? (hasRowLabel.has(ti) ? dropLabelColumn(p, key.tables[ti].cols) : p) : null);
  const units = [];
  const tmap = new Array(key.tables.length).fill(null);
  const plain = key.tables.map((_, i) => i).filter((i) => !inGroup.has(i));
  const m1 = matchTables(plain.map((i) => truthTables[i]), model.tables, used, rotated);
  plain.forEach((ti, k) => {
    const p = prep(m1.get(k) || null, ti);
    units.push({ truth: truthTables[ti], pred: p });
    tmap[ti] = { pred: p, map: (r, c) => [r, c] };
  });
  for (const [ia, ib] of groups) {
    const A = truthTables[ia];
    const B = truthTables[ib];
    const free = () => model.tables.filter((p) => !used.has(p.id));
    // reading a: two tables
    const usedA = new Set(used);
    const ma = matchTables([A, B], free(), usedA, rotated);
    const readA = { units: [{ truth: A, pred: prep(ma.get(0) || null, ia) }, { truth: B, pred: prep(ma.get(1) || null, ib) }], maps: [[ia, (r, c) => [r, c]], [ib, (r, c) => [r, c]]], used: usedA };
    const options = [readA];
    for (const layout of ["side", "stack"]) {
      const merged = mergeTruth(A, B, layout);
      let best = null;
      for (const p of free()) {
        const q = prep(p, ia);
        const s = gritsCon(q.cells, merged.cells).score;
        if (s > 0 && (!best || s > best.s)) best = { p: q, s, id: p.id };
      }
      const u = new Set(used);
      if (best) u.add(best.id);
      options.push({ units: [{ truth: merged, pred: best ? best.p : null }], maps: [[ia, (r, c) => [r, c]], [ib, merged.mapB]], used: u });
    }
    let pick = options[0];
    let top = gSum(pick.units);
    for (const o of options.slice(1)) {
      const s = gSum(o.units);
      if (s > top + 1e-9) { top = s; pick = o; }
    }
    for (const id of pick.used) used.add(id);
    units.push(...pick.units);
    const predOf = pick.units.length === 1 ? pick.units[0].pred : null;
    pick.maps.forEach(([ti, map], k) => {
      tmap[ti] = { pred: predOf || pick.units[k].pred, map };
    });
  }
  const extras = model.tables.filter((p) => !used.has(p.id));
  return { units, tmap, extras };
}

// ---- helpers over the key ----

const HAND = new Set(["hand", "mixed", "stamp"]);
const wOf = (x) => (x.decision ? 2 : 1);

function newAcc() {
  return {};
}
function add(acc, name, num, den) {
  const a = acc[name] || (acc[name] = [0, 0]);
  a[0] += num;
  a[1] += den;
}

// ---- field pairing ----

const stripLabel = (s) => s.toLowerCase().replace(/\s+/g, " ").replace(/[\s:;,#.]+$/, "").trim();
const isAlnum = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

function labelHit(label, u, others = []) {
  const lt = stripLabel(u.lt);
  if (!lt || !label) return null;
  if (lt === label) return { u, value: "", only: true, score: 3 };
  if (u.lt.startsWith(label) && !isAlnum(u.lt[label.length])) {
    const rest = u.text.slice(label.length).replace(/^[\s:;,#.-]+/, "");
    return { u, value: rest, only: !rest, score: 2 };
  }
  const at = u.lt.indexOf(`${label}:`);
  const longer = (at2) => others.some((o) => o.length > label.length && o.endsWith(label) && u.lt.slice(at2 + label.length - o.length, at2 + label.length) === o);
  if (at > 0 && !isAlnum(u.lt[at - 1]) && !longer(at)) {
    const rest = u.text.slice(at + label.length + 1).trim();
    return { u, value: rest, only: !rest, score: 1 };
  }
  if (Math.abs(lt.length - label.length) <= Math.max(2, label.length * 0.2) && label.length >= 4 && sim(wildDist(label, lt), label, lt) >= 0.85) return { u, value: "", only: true, score: 1 };
  if (label.length >= 5 && u.lt.length > label.length) {
    const head = u.lt.slice(0, label.length);
    if (sim(wildDist(label, head), label, head) >= 0.9 && !isAlnum(u.lt[label.length])) {
      const rest = u.text.slice(label.length).replace(/^[\s:;,#.-]+/, "");
      return { u, value: rest, only: !rest, score: 1 };
    }
  }
  return null;
}

function cutAtLabel(value, label, allLabels) {
  const lv = value.toLowerCase();
  let cut = value.length;
  for (const o of allLabels) {
    if (o === label || o.length < 3) continue;
    let from = 1;
    for (;;) {
      const at = lv.indexOf(o, from);
      if (at < 0) break;
      if (!isAlnum(lv[at - 1]) && !isAlnum(lv[at + o.length]) && (o.length >= 4 || lv[at + o.length] === ":")) { cut = Math.min(cut, at); break; }
      from = at + 1;
    }
  }
  return cut < value.length ? value.slice(0, cut).replace(/[\s:;,#.-]+$/, "") : value;
}

function neighbour(hit, ctx) {
  const { u } = hit;
  const grid = u.kind === "cell" ? ctx.grids.get(u.tbl) : null;
  const usable = (v) => v && v.text && !ctx.isLabel(v);
  if (grid) {
    const asUnit = (c) => c && ctx.cellUnit.get(`${u.tbl}:${c.r}:${c.c}`);
    const right = asUnit(grid.get(`${u.r},${u.c + u.colSpan}`));
    if (right && right !== u && usable(right)) return right.text;
    const below = asUnit(grid.get(`${u.r + u.rowSpan},${u.c}`));
    if (below && below !== u && usable(below)) return below.text;
    return "";
  }
  if (u.bbox) {
    const h = u.bbox[3] - u.bbox[1];
    let best = null;
    let below = null;
    for (const v of ctx.units) {
      if (v === u || !v.bbox || !v.text) continue;
      const oy = Math.min(u.bbox[3], v.bbox[3]) - Math.max(u.bbox[1], v.bbox[1]);
      if (oy >= 0.5 * Math.min(h, v.bbox[3] - v.bbox[1]) && v.bbox[0] >= u.bbox[2] - 0.02) {
        if (!best || v.bbox[0] < best.bbox[0]) best = v;
      } else if (v.bbox[1] >= u.bbox[3] - 0.005 && v.bbox[1] - u.bbox[3] <= 1.2 * h && Math.min(u.bbox[2], v.bbox[2]) - Math.max(u.bbox[0], v.bbox[0]) > 0) {
        if (!below || v.bbox[1] < below.bbox[1]) below = v;
      }
    }
    if (best && !ctx.isLabel(best)) return best.text;
    if (!best && below && !ctx.isLabel(below)) return below.text;
    return "";
  }
  const next = ctx.units.find((v) => v.ord === u.ord + 1);
  if (next && next.kind === "block" && next.text && !ctx.isLabel(next)) return next.text;
  return "";
}

// ---- the page scorer ----

function tokensOf(s) {
  return norm(s).toLowerCase().split(/[^\p{L}\p{N}?]+/u).filter((t) => t && t !== "?");
}

function keyBag(key) {
  const texts = [];
  for (const f of key.fields) texts.push(f.key, f.value, f.suffix);
  for (const t of key.tables) {
    texts.push(t.caption);
    for (const c of t.cells) texts.push(c.text);
  }
  for (const l of key.lines) texts.push(l.text);
  for (const c of key.checks) texts.push(c.label, ...(c.options || []));
  for (const m of key.marks) texts.push(m.text, m.old, m.new);
  for (const f of key.figures) texts.push(f.caption);
  return texts.filter((t) => typeof t === "string" && t !== "[signature]").flatMap(tokensOf);
}

function consumeTokens(bag, toks) {
  const counts = new Map();
  for (const t of bag) counts.set(t, (counts.get(t) || 0) + 1);
  const wild = bag.filter((t) => t.includes("?"));
  const fuzzy = [...counts.keys()];
  let unsupported = 0;
  let emitted = 0;
  for (const t of toks) {
    emitted += t.length;
    if (counts.get(t) > 0) { counts.set(t, counts.get(t) - 1); continue; }
    let hit = null;
    if (t.length >= 4) {
      const allow = Math.floor(t.length * 0.25);
      for (const k of fuzzy) {
        if (counts.get(k) > 0 && Math.abs(k.length - t.length) <= allow && wildDist(k, t) <= allow) { hit = k; break; }
      }
    } else {
      for (const k of wild) if (counts.get(k) > 0 && k.length === t.length && wildDist(k, t) === 0) { hit = k; break; }
    }
    if (hit) counts.set(hit, counts.get(hit) - 1);
    else unsupported += t.length;
  }
  return { unsupported, emitted };
}

const MARKER = /\[\s*signature\s*\]/i;
const CHECKED = /[✓✔√☑☒✗✘×]|\[\s*[xX]\s*\]/;

function optionsSelected(text, options) {
  const t = norm(text);
  const picked = [];
  for (const o of options) {
    const esc = o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:[✓✔√☑☒✗✘×]|\\[\\s*[xX]\\s*\\])\\s*${esc}\\b|\\b${esc}\\s*(?:[✓✔√☑☒✗✘×])`, "i");
    if (re.test(t)) picked.push(o);
  }
  if (!picked.length) {
    const words = t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const hits = options.filter((o) => words.includes(o.toLowerCase()));
    if (hits.length === 1 && words.length === 1) picked.push(hits[0]);
  }
  return picked;
}

export function scoreFormPage(doc, key) {
  const rot = key.rotation || 0;
  const rotated = rot !== 0;
  const model = predModel(doc, rot);
  const acc = newAcc();
  const detail = { fields: [], cells: [], checks: [], marks: [] };
  const poolUnits = model.units.filter((u) => u.kind === "block");
  const keyBoxes = (why) => key.ignore.filter((g) => g.bbox && (!why || why.includes(g.why))).map((g) => g.bbox);
  const neutralBoxes = [...keyBoxes(["logo", "watermark", "barcode", "other"]), ...key.marks.filter((m) => (m.type === "signature" || m.type === "void-stamp") && m.bbox).map((m) => m.bbox)];
  const ghostBoxes = keyBoxes(["show-through"]);
  const inAny = (u, boxes) => u.bbox && boxes.some((b) => centreIn(u.bbox, b, 0.005));

  // blank page and insertion
  const bag = keyBag(key);
  let unsupported = 0;
  let emitted = 0;
  let ghost = 0;
  const live = [];
  for (const u of model.units) {
    if (inAny(u, ghostBoxes)) { ghost += u.text.replace(/\s/g, "").length; continue; }
    if (inAny(u, neutralBoxes)) continue;
    live.push(u);
  }
  const cons = consumeTokens(key.blank ? [] : bag, live.flatMap((u) => tokensOf(u.text)));
  unsupported = cons.unsupported;
  emitted = cons.emitted;
  add(acc, "insertion", unsupported, emitted);
  const liveFigs = model.figures.filter((f) => !(f.bbox && (neutralBoxes.some((b) => boxIou(f.bbox, b) >= 0.3) || ghostBoxes.some((b) => boxIou(f.bbox, b) >= 0.3))));
  if (ghost) add(acc, "ghostChars", ghost, 1);
  if (key.blank) {
    const chars = model.units.reduce((n, u) => n + u.text.replace(/\s/g, "").length, 0);
    add(acc, "blankClean", chars === 0 && model.figures.length === 0 ? 1 : 0, 1);
    add(acc, "blankChars", chars, 1);
    add(acc, "blankFigures", model.figures.length, 1);
    return { id: key.id, blank: true, rotation: rot, acc, detail };
  }

  // tables
  const { units: tunits, tmap, extras } = buildUnits(key, model, rotated);
  let gm = 0; let gn = 0; let tm = 0; let tn = 0;
  for (const u of tunits) {
    const pc = u.pred ? u.pred.cells : [];
    const c = gritsCon(pc, u.truth.cells);
    const t = gritsTop(pc, u.truth.cells);
    gm += c.matched; gn += c.sizeA + c.sizeB; tm += t.matched; tn += t.sizeA + t.sizeB;
  }
  for (const p of extras) {
    const c = gritsCon(p.cells, []);
    const t = gritsTop(p.cells, []);
    gm += c.matched; gn += c.sizeA + c.sizeB; tm += t.matched; tn += t.sizeA + t.sizeB;
  }
  if (gn) { add(acc, "gritsCon", 2 * gm, gn); add(acc, "gritsTop", 2 * tm, tn); }

  const skip = new Set();
  const spanOf = new Map();
  for (const m of key.marks) {
    if (m.type === "na-strike" && m.at && m.at.table != null) for (let r = m.at.rows[0]; r <= m.at.rows[1]; r++) for (let c = m.at.cols[0]; c <= m.at.cols[1]; c++) skip.add(`${m.at.table}:${r}:${c}`);
    if (m.type === "ditto-line") for (let r = m.at.rows[0]; r <= m.at.rows[1]; r++) skip.add(`${m.at.table}:${r}:${m.at.c}`);
    if (m.type === "span-ink") {
      spanOf.set(`${m.at.table}:${m.at.r}:${m.at.cols[0]}`, m.at.cols);
      for (let c = m.at.cols[0] + 1; c <= m.at.cols[1]; c++) skip.add(`${m.at.table}:${m.at.r}:${c}`);
    }
  }
  const predGrid = new Map();
  const gridOf = (p) => {
    if (!predGrid.has(p)) predGrid.set(p, cellGrid(p.cells));
    return predGrid.get(p);
  };
  const predCell = (ti, r, c) => {
    const tm2 = tmap[ti];
    if (!tm2 || !tm2.pred) return null;
    const rc = tm2.map(r, c);
    return rc ? gridOf(tm2.pred).get(`${rc[0]},${rc[1]}`) || null : null;
  };
  const predText = (ti, r, c) => {
    const x = predCell(ti, r, c);
    return x ? x.text || "" : "";
  };

  for (const u of tunits) {
    const pgrid = u.pred ? gridOf(u.pred) : null;
    const byAnchor = new Map();
    if (u.pred) for (const c of u.pred.cells) byAnchor.set(`${c.r},${c.c},${c.rowSpan || 1},${c.colSpan || 1}`, c);
    for (const tc of u.truth.cells) {
      const id = `${tc._ti}:${tc._r}:${tc._c}`;
      if (skip.has(id) && !tc.text) continue;
      const pc = pgrid ? pgrid.get(`${tc.r},${tc.c}`) : null;
      const got = pc ? pc.text || "" : "";
      if (tc.ink === "printed" && tc.text) {
        const a = byAnchor.get(`${tc.r},${tc.c},${tc.rowSpan || 1},${tc.colSpan || 1}`);
        if (!tc.unsure) add(acc, "printed", a && wildDist(normText(tc.text), normText(a.text)) === 0 ? 1 : 0, 1);
      } else if (tc.ink === "typed" && tc.text) {
        if (!tc.unsure) add(acc, "typed", tiers(tc.text, got, { type: tc.type }).exact ? 1 : 0, 1);
      } else if (HAND.has(tc.ink) && tc.text) {
        const span = spanOf.get(id);
        let value = got;
        if (span) value = Array.from({ length: span[1] - span[0] + 1 }, (_, k) => predText(tc._ti, tc._r, span[0] + k)).join(" ");
        const t = tiers(tc.text, value, { type: tc.type, ink: tc.ink, strip: Boolean(span) });
        const dropped = !value.replace(/\s/g, "") ? 1 : 0;
        add(acc, "handDrop", dropped, 1);
        if (tc.unsure) continue;
        const w = wOf(tc);
        const ok = tc.type === "initials" ? t.conf : t.folded;
        add(acc, "hand", ok ? w : 0, w);
        if (tc.decision) add(acc, "handDecision", ok ? 1 : 0, 1);
        add(acc, "handExact", t.exact ? 1 : 0, 1);
        add(acc, "handFolded", t.folded ? 1 : 0, 1);
        add(acc, "handConf", t.conf ? 1 : 0, 1);
        add(acc, "handSim", t.sim, 1);
        detail.cells.push({ ti: tc._ti, r: tc._r, c: tc._c, exp: tc.text, got: value, ok });
        // struck-read error: the old value emitted instead of the new one
        for (const m of key.marks) {
          if (m.type === "struck-value" && m.at && m.at.table === tc._ti && m.at.r === tc._r && m.at.c === tc._c) {
            add(acc, "struckReadError", !ok && m.old && tiers(m.old, value, { type: tc.type }).folded ? 1 : 0, 1);
          }
        }
      } else if (tc.ink === "empty" && !skip.has(id)) {
        add(acc, "emptyCells", got.replace(/\s/g, "") ? 0 : 1, 1);
      } else if (tc.ink === "filled") {
        add(acc, "filledInserted", got.replace(/\s/g, "").length, 1);
      }
      // (n) tokens inside cells
      for (const tok of norm(tc.text).match(/\(\d+\)/g) || []) add(acc, "footnote", norm(got).includes(tok) ? 1 : 0, 1);
    }
  }

  // fields
  const cellUnit = new Map(model.units.filter((u) => u.kind === "cell").map((u) => [`${u.tbl}:${u.r}:${u.c}`, u]));
  const grids = new Map(model.tables.map((t) => [t.idx, cellGrid(t.cells)]));
  const fieldDefs = key.fields.filter((f) => f.type !== "signature" && f.value !== "[signature]");
  const labelOf = (f) => stripLabel(norm(f.key));
  const allLabels = [...new Set(key.fields.map(labelOf).filter(Boolean))];
  const ctx = { units: model.units, grids, cellUnit, isLabel: (v) => allLabels.some((l) => { const h = labelHit(l, v, allLabels); return h && h.score >= 2; }) };
  const claimed = new Map();
  const order = [...fieldDefs].sort((a, b) => labelOf(b).length - labelOf(a).length);
  const strikeFor = (f) => key.marks.find((m) => m.type === "na-strike" && m.at && m.at.field && stripLabel(norm(m.at.field)) === labelOf(f) && (m.at.n || 1) === (f.n || 1));
  const paired = new Map();
  for (const f of order) {
    const label = labelOf(f);
    const hits = [];
    for (const u of model.units) {
      const h = labelHit(label, u, allLabels);
      if (h && (!claimed.has(u) || claimed.get(u) === label || h.score === 1)) hits.push(h);
    }
    const hit = hits[(f.n || 1) - 1] || null;
    if (hit && !claimed.has(hit.u)) claimed.set(hit.u, label);
    paired.set(f, hit ? { hit, got: cutAtLabel(hit.only ? neighbour(hit, ctx) : hit.value, label, allLabels) } : null);
  }
  for (const f of fieldDefs) {
    const p = paired.get(f);
    const found = Boolean(p);
    const got = p ? p.got : "";
    if (f.unsure) continue;
    if (f.ink === "empty" || f.value === "") {
      const s = strikeFor(f);
      const frag = s && got && semiGlobal(norm(got).toLowerCase().replace(/\s/g, ""), norm(s.text).toLowerCase().replace(/\s/g, "")) <= 1;
      add(acc, "fieldsEmpty", !got.replace(/\s/g, "") || frag ? 1 : 0, 1);
      continue;
    }
    add(acc, "fieldsFound", found ? 1 : 0, 1);
    const t = tiers(f.value, got, { type: f.type, ink: f.ink });
    const handInk = f.ink === "hand" || f.ink === "mixed";
    const ok = handInk ? (f.type === "initials" ? t.conf : t.folded) : t.exact;
    const w = wOf(f);
    add(acc, "fields", ok ? w : 0, w);
    add(acc, f.group === "header" ? "fieldsHeader" : f.group === "review" ? "fieldsReview" : "fieldsFree", ok ? 1 : 0, 1);
    if (f.decision) add(acc, "fieldsDecision", ok ? 1 : 0, 1);
    add(acc, `fields_${f.ink}`, ok ? 1 : 0, 1);
    if (handInk) {
      add(acc, "fieldsHandExact", t.exact ? 1 : 0, 1);
      add(acc, "fieldsHandConf", t.conf ? 1 : 0, 1);
      add(acc, "fieldsHandSim", t.sim, 1);
    }
    detail.fields.push({ key: f.key, n: f.n, group: f.group, exp: f.value, got, ok, found });
  }

  // checks
  for (const c of key.checks) {
    if (c.unsure) continue;
    let text = "";
    if (c.at) text = predText(c.at.table, c.at.r, c.at.c);
    else {
      const label = stripLabel(norm(c.label));
      const hit = label ? model.units.map((u) => labelHit(label, u, allLabels)).find(Boolean) : null;
      if (hit) text = `${hit.u.text} ${hit.only ? neighbour(hit, ctx) : ""}`;
    }
    let ok;
    if (c.options && c.options.length) {
      const picked = optionsSelected(text, c.options);
      const want = (c.selected || []).map((x) => x.toLowerCase()).sort();
      const have = picked.map((x) => x.toLowerCase()).sort();
      ok = c.state === "none" ? have.length === 0 : want.length === have.length && want.every((x, i) => x === have[i]);
    } else {
      ok = CHECKED.test(norm(text)) === (c.state === "checked");
    }
    add(acc, "checks", ok ? 1 : 0, 1);
    if (c.decision) add(acc, "checksDecision", ok ? 1 : 0, 1);
    detail.checks.push({ label: c.label, state: c.state, ok });
  }

  // marks
  const poolText = poolUnits.map((u) => u.text).join("|").toLowerCase().replace(/\s/g, "");
  for (const m of key.marks) {
    if (m.type === "na-strike") {
      const want = norm(m.text).toLowerCase().replace(/\s/g, "");
      let covered = [];
      let tablePool = "";
      if (m.at.table != null) {
        const seen = new Set();
        for (let r = m.at.rows[0]; r <= m.at.rows[1]; r++) {
          for (let c = m.at.cols[0]; c <= m.at.cols[1]; c++) {
            const x = predCell(m.at.table, r, c);
            if (x && !seen.has(x)) { seen.add(x); covered.push(norm(x.text).toLowerCase().replace(/\s/g, "")); }
          }
        }
        const tm2 = tmap[m.at.table];
        if (tm2 && tm2.pred) tablePool = tm2.pred.cells.map((c) => norm(c.text)).join("|").toLowerCase().replace(/\s/g, "");
      } else {
        const f = key.fields.find((x) => labelOf(x) === stripLabel(norm(m.at.field)) && (x.n || 1) === (m.at.n || 1));
        const p = f && paired.get(f);
        if (p && p.got) covered = [norm(p.got).toLowerCase().replace(/\s/g, "")];
      }
      const pool = `${covered.join("|")}|${tablePool}|${poolText}`;
      const found = !want || semiGlobal(want, pool) <= Math.floor(want.length * 0.2);
      const clean = covered.every((x) => !x || (want && semiGlobal(x, want) <= Math.floor(x.length * 0.25)));
      if (!m.unsure) {
        add(acc, "strikeFound", found ? 1 : 0, 1);
        add(acc, "strike", found && clean ? 1 : 0, 1);
      }
    } else if (m.type === "footnote-ref") {
      const tm2 = tmap[m.at.table];
      const tok = `(${m.n})`;
      let hit = false;
      if (tm2 && tm2.pred) {
        const rc = tm2.map(m.at.r, 0);
        if (rc) {
          const rowCells = tm2.pred.cells.filter((c) => c.r <= rc[0] && c.r + (c.rowSpan || 1) > rc[0]);
          hit = rowCells.some((c) => norm(c.text).includes(tok));
          const ys = rowCells.map((c) => c.bbox).filter(Boolean);
          const y0 = ys.length ? Math.min(...ys.map((b) => b[1])) : null;
          const y1 = ys.length ? Math.max(...ys.map((b) => b[3])) : null;
          if (!hit && y0 != null && !rotated) {
            const sz = pageSize(doc, 1);
            hit = model.units.some((u) => u.bbox && u.text.includes(tok) && centreIn(u.bbox, [0, y0 / (sz.h || 1), 1, y1 / (sz.h || 1)], 0));
          }
        }
      }
      add(acc, "footnote", hit ? 1 : 0, 1);
    }
  }

  // signatures
  const sigs = key.marks.filter((m) => m.type === "signature");
  if (sigs.length || poolUnits.some((u) => MARKER.test(u.text))) {
    let M = 0; let J = 0; let A = 0; let present = 0; let dM = 0; let dN = 0;
    const markerUnits = model.units.filter((u) => MARKER.test(u.text));
    const atPos = new Set();
    for (const s of sigs) {
      let marker = false;
      let chars = 0;
      if (s.bbox) {
        const sa = area(s.bbox) || 1;
        for (const u of model.units) {
          if (!u.bbox) continue;
          const ov = inter(u.bbox, s.bbox);
          if (ov / (area(u.bbox) || 1) >= 0.5 || ov / sa >= 0.5) {
            if (MARKER.test(u.text)) { marker = true; atPos.add(u); }
            chars += u.text.replace(/\s/g, "").length;
          }
        }
        for (const f of model.figures) if (f.bbox && boxIou(f.bbox, s.bbox) >= 0.3) marker = true;
      }
      if (marker) { M++; present++; } else if (chars >= 2) { J++; present++; } else A++;
      const fd = s.at && s.at.field ? key.fields.find((x) => labelOf(x) === stripLabel(norm(s.at.field)) && (x.n || 1) === (s.at.n || 1)) : null;
      if (fd && fd.group === "review") { dN++; if (marker) dM++; }
    }
    const stray = markerUnits.filter((u) => !atPos.has(u)).length;
    add(acc, "sig", 2 * M, 2 * M + J + A + stray);
    add(acc, "sigPresence", present, sigs.length);
    add(acc, "sigMarker", M, sigs.length);
    if (dN) add(acc, "sigDecision", dM, dN);
  }

  // lines
  const pool = poolUnits.map((u) => normText(u.text).replace(/\s/g, "")).join("|");
  const lineBucket = { body: "body", note: "body", footnote: "body", label: "label" };
  for (const l of key.lines) {
    if (l.unsure) continue;
    const want = normText(l.text).replace(/\s/g, "");
    if (!want) continue;
    if (lineBucket[l.kind]) {
      const dist = Math.min(want.length, semiGlobal(want, pool));
      add(acc, lineBucket[l.kind], want.length - dist, want.length);
      add(acc, `lines_${l.kind}`, want.length - dist, want.length);
    } else if (l.kind === "stamp" || l.kind === "annotation") {
      add(acc, "aux", semiGlobal(want, pool) <= Math.floor(want.length * 0.2) ? 1 : 0, 1);
    }
  }

  // figures
  const tf = key.figures.filter((f) => !f.unsure && f.bbox);
  if (tf.length || liveFigs.length) {
    const usedF = new Set();
    let tp = 0;
    for (const t of tf) {
      let best = -1; let bi = 0;
      liveFigs.forEach((p, i) => { const v = p.bbox ? boxIou(t.bbox, p.bbox) : 0; if (!usedF.has(i) && v > bi) { bi = v; best = i; } });
      if (best >= 0 && bi >= 0.5) { usedF.add(best); tp++; }
    }
    add(acc, "figures", 2 * tp, tf.length + liveFigs.length);
  }
  return { id: key.id, blank: false, rotation: rot, acc, detail };
}

// ---- pooling and components ----

export function pool(pages) {
  const acc = {};
  for (const p of pages) for (const [k, [n, d]] of Object.entries(p.acc)) add(acc, k, n, d);
  return acc;
}

const WEIGHTS = { fields: 0.3, hand: 0.25, gritsTop: 0.15, marks: 0.15, body: 0.15 };

export function components(acc) {
  const v = (n) => (acc[n] && acc[n][1] > 0 ? acc[n][0] / acc[n][1] : null);
  const marksParts = [v("strikeFound") != null ? v("strike") : null, v("sig"), v("footnote")].filter((x) => x != null);
  const decisionNum = ["fieldsDecision", "handDecision", "checksDecision", "sigDecision"].reduce((s, n) => s + (acc[n] ? acc[n][0] : 0), 0);
  const decisionDen = ["fieldsDecision", "handDecision", "checksDecision", "sigDecision"].reduce((s, n) => s + (acc[n] ? acc[n][1] : 0), 0);
  const c = {
    fields: v("fields"), fieldsHeader: v("fieldsHeader"), fieldsFree: v("fieldsFree"), fieldsReview: v("fieldsReview"),
    fieldsPrinted: v("fields_printed"), fieldsTyped: v("fields_typed"), fieldsStamp: v("fields_stamp"), fieldsDecision: v("fieldsDecision"),
    fieldsHandExact: v("fieldsHandExact"), fieldsHandConf: v("fieldsHandConf"), fieldsHandSim: v("fieldsHandSim"), fieldsFound: v("fieldsFound"), fieldsEmpty: v("fieldsEmpty"),
    hand: v("hand"), handExact: v("handExact"), handFolded: v("handFolded"), handConf: v("handConf"), handSim: v("handSim"), handDrop: v("handDrop"),
    handDecision: v("handDecision"), printed: v("printed"), typed: v("typed"), emptyCells: v("emptyCells"),
    gritsTop: v("gritsTop"), gritsCon: v("gritsCon"),
    checks: v("checks"), checksDecision: v("checksDecision"),
    strike: v("strike"), strikeFound: v("strikeFound"), sig: v("sig"), sigPresence: v("sigPresence"), sigMarker: v("sigMarker"), footnote: v("footnote"),
    marks: marksParts.length ? marksParts.reduce((a, b) => a + b, 0) / marksParts.length : null,
    body: v("body"), bodyNote: v("lines_note"), bodyFootnote: v("lines_footnote"), annotation: v("aux"), label: v("label"),
    figures: v("figures"),
    blankClean: v("blankClean"), blankChars: v("blankChars"), blankFigures: v("blankFigures"), ghostChars: v("ghostChars"),
    insertion: v("insertion"),
    decision: decisionDen ? decisionNum / decisionDen : null,
  };
  c.handKept = c.handDrop == null ? null : 1 - c.handDrop;
  c.noInsertion = c.insertion == null ? null : 1 - c.insertion;
  let s = 0; let w = 0;
  for (const [k, wt] of Object.entries(WEIGHTS)) if (c[k] != null) { s += wt * c[k]; w += wt; }
  c.composite = w ? s / w : null;
  return c;
}

// ---- loading ----

export function loadKeys(dir, only) {
  return readdirSync(dir).filter((n) => n.endsWith(".json") && (!only || n.includes(only))).sort().map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")));
}

export function engineDoc(dir, id) {
  for (const n of [`${id}.pxd.json`, `${id}.json`]) if (existsSync(join(dir, n))) return JSON.parse(readFileSync(join(dir, n), "utf8"));
  return null;
}

export function scoreEngine(dir, keys) {
  const pages = [];
  const gaps = [];
  for (const k of keys) {
    const doc = engineDoc(dir, k.id);
    if (!doc) { gaps.push(k.id); continue; }
    pages.push(scoreFormPage(doc, k));
  }
  return { pages, gaps };
}

// ---- paired ----

export const PAIRED = ["composite", "fields", "fieldsHeader", "fieldsFree", "fieldsReview", "hand", "handKept", "printed", "gritsTop", "gritsCon", "checks", "marks", "strike", "sig", "footnote", "body", "blankClean", "noInsertion", "decision"];

export function paired(pagesA, pagesB, comps = PAIRED) {
  const byB = new Map(pagesB.map((p) => [p.id, p]));
  const out = {};
  for (const name of comps) {
    const d = [];
    for (const pa of pagesA) {
      const pb = byB.get(pa.id);
      if (!pb) continue;
      const x = components(pa.acc)[name];
      const y = components(pb.acc)[name];
      if (x != null && y != null) d.push(x - y);
    }
    if (!d.length) { out[name] = { n: 0, mean: null, lo: null, hi: null, p: null }; continue; }
    const ci = bootstrapCI(d, { resamples: 4000 });
    const w = wilcoxon(d);
    out[name] = { n: d.length, mean: mean(d), lo: ci.lo, hi: ci.hi, p: w.n ? w.pExact : 1 };
  }
  return out;
}

// ---- output ----

const f3 = (x) => (x == null ? "-" : (Math.round(x * 1000) / 1000).toFixed(3));
const ROWS = [
  ["composite", "composite"], ["fields", "fields (decision x2)"], ["fieldsHeader", "  header"], ["fieldsFree", "  free"], ["fieldsReview", "  review"],
  ["fieldsPrinted", "  printed (exact)"], ["fieldsTyped", "  typed (exact)"], ["fieldsHandExact", "  hand exact"], ["fieldsHandConf", "  hand confusable"], ["fieldsHandSim", "  hand similarity"],
  ["fieldsFound", "  label found"], ["fieldsEmpty", "  empty ok"], ["fieldsDecision", "  decision fields"],
  ["hand", "hand cells (decision x2)"], ["handExact", "  exact"], ["handFolded", "  case-folded"], ["handConf", "  confusable"], ["handSim", "  similarity"], ["handDrop", "  drop rate (lower better)"], ["handDecision", "  decision cells"],
  ["printed", "printed cells (exact)"], ["typed", "typed cells (exact)"], ["emptyCells", "empty cells kept empty"],
  ["gritsTop", "GriTS-Top"], ["gritsCon", "GriTS-Con"],
  ["checks", "checks (state)"], ["checksDecision", "  decision checks"],
  ["marks", "marks (mean of 3)"], ["strike", "  strike (found, clean)"], ["strikeFound", "  strike text found"], ["sig", "  signature F1"], ["sigPresence", "  signature presence"], ["sigMarker", "  signature marker"], ["footnote", "  footnote mark recall"],
  ["body", "body 1-CER"], ["bodyNote", "  note lines"], ["bodyFootnote", "  footnote lines"], ["annotation", "stamp/annotation recall"], ["label", "label lines 1-CER"],
  ["figures", "figures F1"],
  ["insertion", "insertion rate (lower better)"], ["decision", "decision sub-score"],
];

export function renderPooled(results) {
  const names = Object.keys(results);
  const comps = names.map((n) => components(pool(results[n].pages)));
  let out = `| component | ${names.join(" | ")} |\n|---|${names.map(() => "---").join("|")}|\n`;
  out += `| pages scored | ${names.map((n) => results[n].pages.length).join(" | ")} |\n`;
  for (const [k, label] of ROWS) out += `| ${label} | ${comps.map((c) => f3(c[k])).join(" | ")} |\n`;
  out += `| blank pages with no output | ${names.map((n, i) => (results[n].pages.some((p) => p.blank) ? `${f3(comps[i].blankClean)} (${results[n].pages.filter((p) => p.blank).length} pages)` : "-")).join(" | ")} |\n`;
  out += `| blank page chars per page | ${comps.map((c) => (c.blankChars == null ? "-" : (Math.round(c.blankChars * 10) / 10).toString())).join(" | ")} |\n`;
  out += `| blank page figures per page | ${comps.map((c) => (c.blankFigures == null ? "-" : f3(c.blankFigures))).join(" | ")} |\n`;
  out += `| show-through chars (all pages) | ${names.map((n) => pool(results[n].pages).ghostChars?.[0] ?? 0).join(" | ")} |\n`;
  return out;
}

export function renderPerPage(results) {
  const names = Object.keys(results);
  const ids = [...new Set(names.flatMap((n) => results[n].pages.map((p) => p.id)))].sort();
  let out = `| page | blank | ${names.map((n) => `${n} composite`).join(" | ")} |\n|---|---|${names.map(() => "---").join("|")}|\n`;
  for (const id of ids) {
    const any = names.map((n) => results[n].pages.find((p) => p.id === id)).find(Boolean);
    out += `| ${id} | ${any.blank ? "yes" : ""} | ${names.map((n) => { const p = results[n].pages.find((q) => q.id === id); return p ? (p.blank ? (components(p.acc).blankClean ? "clean" : `${pool([p]).blankChars[0]} chars, ${pool([p]).blankFigures[0]} fig`) : f3(components(p.acc).composite)) : "gap"; }).join(" | ")} |\n`;
  }
  return out;
}

export function renderPaired(res, a, b) {
  let out = `Paired ${a} - ${b} (positive favours ${a}); one-sided Wilcoxon, exact\n\n| component | n | mean delta | 95% CI | p |\n|---|---|---|---|---|\n`;
  for (const [k, r] of Object.entries(res)) out += `| ${k} | ${r.n} | ${f3(r.mean)} | ${f3(r.lo)} to ${f3(r.hi)} | ${r.p == null ? "-" : r.p.toFixed(4)} |\n`;
  return out;
}

const home = (p) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

export function parseArgs(argv) {
  const o = { engines: [], perPage: false, detail: false };
  const val = (i) => {
    if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error(`${argv[i]} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keys") o.keys = home(val(i++));
    else if (a === "--engine") {
      const v = val(i++);
      const at = v.indexOf("=");
      if (at < 1) throw new Error("--engine needs name=dir");
      o.engines.push([v.slice(0, at), home(v.slice(at + 1))]);
    } else if (a === "--json") o.json = val(i++);
    else if (a === "--pair") o.pair = val(i++).split(",");
    else if (a === "--only") o.only = val(i++);
    else if (a === "--per-page") o.perPage = true;
    else if (a === "--detail") o.detail = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.keys) throw new Error("--keys is required");
  if (!o.engines.length) throw new Error("at least one --engine name=dir is required");
  if (o.pair && o.pair.length !== 2) throw new Error("--pair needs two engine names");
  return o;
}

function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { process.stderr.write(`${e.message}\n`); process.exitCode = 2; return; }
  const keys = loadKeys(o.keys, o.only);
  const results = {};
  for (const [name, dir] of o.engines) results[name] = scoreEngine(dir, keys);
  let out = `Form scorer, ${keys.length} key pages (${keys.filter((k) => k.blank).length} blank)\n\n${renderPooled(results)}\n`;
  for (const [name, r] of Object.entries(results)) if (r.gaps.length) out += `Gap, ${name}: ${r.gaps.length} pages missing (${r.gaps.join(", ")})\n`;
  if (o.perPage) out += `\n${renderPerPage(results)}`;
  let pr = null;
  if (o.pair) {
    pr = paired(results[o.pair[0]].pages, results[o.pair[1]].pages);
    out += `\n${renderPaired(pr, o.pair[0], o.pair[1])}`;
  }
  if (o.detail) {
    for (const [name, r] of Object.entries(results)) for (const p of r.pages) {
      out += `\n${name} ${p.id}\n`;
      for (const f of p.detail.fields) out += `  field ${f.group} ${f.key}#${f.n}: ${JSON.stringify(f.exp)} -> ${JSON.stringify(f.got)} ${f.ok ? "ok" : "MISS"}\n`;
      for (const c of p.detail.cells) out += `  cell t${c.ti} r${c.r} c${c.c}: ${JSON.stringify(c.exp)} -> ${JSON.stringify(c.got)} ${c.ok ? "ok" : "MISS"}\n`;
    }
  }
  process.stdout.write(out);
  if (o.json) {
    const body = { keys: keys.length, engines: Object.fromEntries(Object.entries(results).map(([n, r]) => [n, { gaps: r.gaps, pooled: components(pool(r.pages)), pages: r.pages.map((p) => ({ id: p.id, blank: p.blank, components: components(p.acc) })) }])), paired: pr };
    writeFileSync(o.json, JSON.stringify(body, null, 1));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));

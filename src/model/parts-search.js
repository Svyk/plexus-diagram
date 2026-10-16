// Search over the parts of parsed PDFs. Pure: a parse doc becomes flat index rows.
// A search looks those rows up by gram. Nothing here touches IndexedDB or the graph.

import { parsePageRange, queryTerms } from "./library.js";

const PART_OF = { heading: "heading", para: "paragraph", list: "paragraph", footnote: "paragraph", code: "paragraph", table: "table", figure: "figure", formula: "formula", caption: "caption" };
const SNIPPET_W = 120;

const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

function tableText(block) {
  const cells = Array.isArray(block?.cells) ? block.cells : [];
  return cells.map((cell) => squash(cell?.text)).filter(Boolean).join(" ");
}

function blockText(block) {
  switch (block.type) {
    case "table": return tableText(block);
    case "list": return (block.items || []).map((item) => squash(item?.text)).filter(Boolean).join(" ");
    case "formula": return squash(block.latex || block.text);
    default: return squash(block.text);
  }
}

// Rows for one parsed doc, in reading order. A caption's text is also attached to the table or figure it names.
export function buildPartsIndex(doc, { url = "", docTitle = "", pdfUid = "" } = {}) {
  const blocks = doc?.blocks && typeof doc.blocks === "object" ? doc.blocks : {};
  const order = Array.isArray(doc?.order) ? doc.order : Object.keys(blocks);
  const attached = new Map();
  for (const id of order) {
    const b = blocks[id];
    if (b?.type === "caption" && b.for && blocks[b.for]) {
      const text = squash(b.text);
      if (text) attached.set(b.for, attached.has(b.for) ? `${attached.get(b.for)} ${text}` : text);
    }
  }
  const rows = [];
  for (const id of order) {
    const b = blocks[id];
    const kind = b && PART_OF[b.type];
    if (!kind) continue;
    let text = blockText(b);
    const cap = attached.get(b.id ?? id) || (typeof b.caption === "string" && !blocks[b.caption] ? squash(b.caption) : "");
    if (cap && kind !== "caption" && !text.includes(cap)) text = text ? `${text} ${cap}` : cap;
    if (!text && kind === "figure") text = "Figure";
    if (!text) continue;
    rows.push({
      kind,
      page: Number(b.page) || 0,
      text,
      lower: text.toLowerCase(),
      docTitle,
      url,
      pdfUid,
      sha256: doc?.sha256 || "",
      engine: doc?.engine || "",
      optsHash: doc?.optsHash || "",
      blockId: b.id ?? id,
    });
  }
  return rows;
}

function countHits(hay, needle) {
  let n = 0;
  let at = hay.indexOf(needle);
  while (at !== -1) {
    n += 1;
    at = hay.indexOf(needle, at + needle.length);
  }
  return n;
}

// One gram index per row array. Panel open fills it in idle slices. A keystroke never does.
const partIndexes = new WeakMap();
// Reused by the cheap scan so a key does not allocate a fresh array of every row.
const scratch = { ranked: [], pool: [] };
const wordBuf = [];
let postingAdds = 0;
let sliceCalls = 0;
let lastSliceMs = 0;

// A slice of the parts gram index. The shared background budget calls us once per idle callback.
export const PARTS_SLICE_MS = 8;

export function partsPostingAdds() { return postingAdds; }
export function partsSliceCalls() { return sliceCalls; }
export function partsLastSliceMs() { return lastSliceMs; }
export function partsIndexReady(rows) { return partIndexes.get(rows)?.ready === true; }

const defaultNow = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

function addPosting(map, key, i) {
  postingAdds += 1;
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  } else if (arr[arr.length - 1] === i) return;
  arr.push(i);
}

function hayStored(row) {
  const raw = row?.lower;
  return typeof raw === "string" ? raw : String(row?.text ?? "").toLowerCase();
}

function ensureIndex(rows) {
  let ix = partIndexes.get(rows);
  if (ix) return ix;
  const n = rows.length;
  ix = {
    lowers: new Array(n),
    tri: new Map(),
    bi: new Map(),
    ch: new Map(),
    stamp: new Uint32Array(n),
    gen: 1,
    hold: [],
    pool: [],
    ranked: [],
    specs: [],
    specPool: [],
    row: 0,
    start: 0,
    c: 0,
    end: 0,
    g: 0,
    mode: "find",
    ready: n === 0,
    n,
  };
  partIndexes.set(rows, ix);
  return ix;
}

// Index some of `rows` until `over()` is true. Returns false when it yielded early.
function indexUntil(ix, rows, over) {
  while (ix.row < ix.n) {
    const i = ix.row;
    const lower = ix.lowers[i] ?? (ix.lowers[i] = hayStored(rows[i]));
    const n = lower.length;
    if (ix.mode === "find") {
      let c = ix.c;
      let steps = 0;
      while (c < n && lower.charCodeAt(c) > 32) {
        c += 1;
        steps += 1;
        if (steps >= 48 && over()) { ix.c = c; return false; }
      }
      ix.end = c;
      ix.g = ix.start;
      ix.mode = "emit";
    }
    if (ix.mode === "emit") {
      const start = ix.start;
      const c = ix.end;
      const len = c - start;
      let steps = 0;
      while (ix.g < c) {
        if (steps >= 24 && over()) return false;
        const g = ix.g;
        if (len >= 3 && g <= c - 3) addPosting(ix.tri, lower.slice(g, g + 3), i);
        if (len >= 2 && g <= c - 2) addPosting(ix.bi, lower.slice(g, g + 2), i);
        if (len >= 1) addPosting(ix.ch, lower[g], i);
        ix.g = g + 1;
        steps += 1;
      }
      const next = c + 1;
      ix.start = next;
      ix.c = next;
      ix.mode = "find";
      if (next > n) {
        ix.row += 1;
        ix.start = 0;
        ix.c = 0;
        ix.end = 0;
        ix.g = 0;
      }
      if (over()) return false;
    }
  }
  ix.ready = true;
  return true;
}

// One idle slice. True when every row is indexed.
export function stepPartsIndex(rows, { deadline = null, now = defaultNow, sliceMs = PARTS_SLICE_MS } = {}) {
  sliceCalls += 1;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) { lastSliceMs = 0; return true; }
  let starved = false;
  if (typeof deadline?.timeRemaining === "function") {
    try { starved = deadline.timeRemaining() <= 0; } catch { starved = false; }
  }
  const t0 = now();
  const ix = ensureIndex(list);
  if (ix.ready) { lastSliceMs = 0; return true; }
  let checks = 0;
  const over = () => {
    checks += 1;
    lastSliceMs = now() - t0;
    if (starved && checks >= 1) return true;
    return lastSliceMs >= sliceMs;
  };
  return indexUntil(ix, list, over);
}

// Build the whole gram index now. For tests and callers that are not a keystroke.
export function finishPartsIndex(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return;
  const ix = ensureIndex(list);
  if (!ix.ready) indexUntil(ix, list, () => false);
}

// Panel open: slices of at most PARTS_SLICE_MS on the shared background budget. Never runs a slice itself.
// `partMs` is huge so the budget runs this job once per idle callback; the slice stops itself at 8 ms.
export function schedulePartsIndex(rows, { budget = null, now = defaultNow, onReady = null, sliceMs = PARTS_SLICE_MS } = {}) {
  if (!Array.isArray(rows) || !rows.length || typeof budget?.run !== "function") return () => {};
  let stopped = false;
  let cancel = null;
  cancel = budget.run((deadline) => {
    if (stopped) return true;
    const done = stepPartsIndex(rows, { deadline, now, sliceMs });
    if (done && !stopped && typeof onReady === "function") {
      try { onReady(); } catch { /* listener */ }
    }
    return done;
  }, { partMs: 1e6, label: "parts-index" });
  return () => {
    stopped = true;
    try { cancel?.(); } catch { /* gone */ }
  };
}

// Opens the panel's index job when a budget is passed. Without one, this does not index.
export function warmPartsIndex(rows, opts) {
  return schedulePartsIndex(rows, opts || {});
}

function wordsInto(term, into) {
  into.length = 0;
  let start = 0;
  for (let i = 0; i <= term.length; i += 1) {
    if (i === term.length || term.charCodeAt(i) <= 32) {
      if (i > start) into.push(term.slice(start, i));
      start = i + 1;
    }
  }
  return into;
}

function specAt(ix, i) {
  let spec = ix.specPool[i];
  if (!spec) {
    spec = { lists: [], n: 0 };
    ix.specPool[i] = spec;
  }
  return spec;
}

function fillLists(ix, word, into) {
  into.length = 0;
  if (word.length >= 3) {
    for (let i = 0; i <= word.length - 3; i += 1) {
      const ids = ix.tri.get(word.slice(i, i + 3));
      if (!ids) return false;
      into.push(ids);
    }
  } else if (word.length === 2) {
    const ids = ix.bi.get(word);
    if (!ids) return false;
    into.push(ids);
  } else if (word.length === 1) {
    const ids = ix.ch.get(word);
    if (!ids) return false;
    into.push(ids);
  } else return false;
  return true;
}

function kindOk(kinds, kind) {
  if (!kinds || !kinds.length) return true;
  for (let i = 0; i < kinds.length; i += 1) if (kinds[i] === kind) return true;
  return false;
}

function bump(ix) {
  ix.gen += 1;
  if (ix.gen === 0xffffffff) {
    ix.stamp.fill(0);
    ix.gen = 1;
  }
  return ix.gen;
}

// Intersect posting lists into ix.hold. `fresh` starts a new candidate set.
function takeWord(ix, lists, fresh) {
  const stamp = ix.stamp;
  const hold = ix.hold;
  let g = bump(ix);
  if (fresh) {
    let best = lists[0];
    for (let i = 1; i < lists.length; i += 1) if (lists[i].length < best.length) best = lists[i];
    for (let i = 0; i < best.length; i += 1) stamp[best[i]] = g;
    for (let li = 0; li < lists.length; li += 1) {
      const list = lists[li];
      if (list === best) continue;
      const g2 = bump(ix);
      for (let i = 0; i < list.length; i += 1) {
        const id = list[i];
        if (stamp[id] === g) stamp[id] = g2;
      }
      g = g2;
    }
    hold.length = 0;
    for (let i = 0; i < best.length; i += 1) if (stamp[best[i]] === g) hold.push(best[i]);
    return;
  }
  if (!hold.length) return;
  for (let i = 0; i < hold.length; i += 1) stamp[hold[i]] = g;
  for (let li = 0; li < lists.length; li += 1) {
    const list = lists[li];
    const g2 = bump(ix);
    for (let i = 0; i < list.length; i += 1) {
      const id = list[i];
      if (stamp[id] === g) stamp[id] = g2;
    }
    g = g2;
  }
  let w = 0;
  for (let i = 0; i < hold.length; i += 1) if (stamp[hold[i]] === g) hold[w++] = hold[i];
  hold.length = w;
}

function publish(row, hits) {
  const out = { hits };
  for (const key in row) {
    if (key === "lower") continue;
    out[key] = row[key];
  }
  return out;
}

function worse(a, b) {
  if (a.exact !== b.exact) return a.exact < b.exact;
  if (a.count !== b.count) return a.count < b.count;
  return a.seq > b.seq;
}

// Keep at most `take` hits. The slot objects live on `pool` and are reused on the next key.
function consider(ranked, pool, take, row, count, seq, exact) {
  if (ranked.length < take) {
    let slot = pool[ranked.length];
    if (!slot) {
      slot = { row: null, count: 0, seq: 0, exact: 0 };
      pool[ranked.length] = slot;
    }
    slot.row = row;
    slot.count = count;
    slot.seq = seq;
    slot.exact = exact;
    ranked.push(slot);
    return;
  }
  let w = 0;
  for (let i = 1; i < ranked.length; i += 1) if (worse(ranked[i], ranked[w])) w = i;
  const worst = ranked[w];
  if (exact < worst.exact) return;
  if (exact === worst.exact && count < worst.count) return;
  if (exact === worst.exact && count === worst.count && seq >= worst.seq) return;
  worst.row = row;
  worst.count = count;
  worst.seq = seq;
  worst.exact = exact;
}

function emitRanked(ranked, take) {
  ranked.sort((a, b) => b.exact - a.exact || b.count - a.count || a.seq - b.seq);
  const out = [];
  const n = Math.min(take, ranked.length);
  for (let i = 0; i < n; i += 1) out.push(publish(ranked[i].row, ranked[i].count));
  return out;
}

function takePlain(list, kinds, range, take) {
  const out = [];
  for (let i = 0; i < list.length && out.length < take; i += 1) {
    const row = list[i];
    if (!kindOk(kinds, row.kind)) continue;
    if (range && (row.page < range.from || row.page > range.to)) continue;
    out.push(publish(row, 0));
  }
  return out;
}

// Gram lookup. Does not add postings. Rows not indexed yet are absent from the lists.
function searchIndexed(list, ix, { phrase, terms, kinds, range, take }) {
  const specs = ix.specs;
  specs.length = 0;
  for (let t = 0; t < terms.length; t += 1) {
    wordsInto(terms[t], wordBuf);
    if (!wordBuf.length) return [];
    for (let w = 0; w < wordBuf.length; w += 1) {
      const spec = specAt(ix, specs.length);
      if (!fillLists(ix, wordBuf[w], spec.lists)) return [];
      let n = spec.lists[0].length;
      for (let i = 1; i < spec.lists.length; i += 1) if (spec.lists[i].length < n) n = spec.lists[i].length;
      spec.n = n;
      specs.push(spec);
    }
  }
  specs.sort((a, b) => a.n - b.n);
  takeWord(ix, specs[0].lists, true);
  for (let s = 1; s < specs.length; s += 1) {
    if (!ix.hold.length) break;
    takeWord(ix, specs[s].lists, false);
  }
  const hold = ix.hold;
  const ranked = ix.ranked;
  const pool = ix.pool;
  const lowers = ix.lowers;
  const multi = terms.length > 1;
  ranked.length = 0;
  for (let h = 0; h < hold.length; h += 1) {
    const i = hold[h];
    const row = list[i];
    if (!kindOk(kinds, row.kind)) continue;
    if (range && (row.page < range.from || row.page > range.to)) continue;
    const hay = lowers[i];
    let count = 0;
    let all = true;
    for (let t = 0; t < terms.length; t += 1) {
      const n = countHits(hay, terms[t]);
      if (!n) { all = false; break; }
      count += n;
    }
    if (!all) continue;
    consider(ranked, pool, take, row, count, i + 1, multi && hay.includes(phrase) ? 1 : 0);
  }
  return emitRanked(ranked, take);
}

// No gram index yet. One pass over the stored lower text. No new array of every row, no per-row lowercasing.
function searchCheap(list, { phrase, terms, kinds, range, take }) {
  const ranked = scratch.ranked;
  const pool = scratch.pool;
  const multi = terms.length > 1;
  ranked.length = 0;
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (!kindOk(kinds, row.kind)) continue;
    if (range && (row.page < range.from || row.page > range.to)) continue;
    const hay = typeof row?.lower === "string" ? row.lower : "";
    if (!hay) continue;
    let count = 0;
    let all = true;
    for (let t = 0; t < terms.length; t += 1) {
      const n = countHits(hay, terms[t]);
      if (!n) { all = false; break; }
      count += n;
    }
    if (!all) continue;
    consider(ranked, pool, take, row, count, i + 1, multi && hay.includes(phrase) ? 1 : 0);
  }
  return emitRanked(ranked, take);
}

// rows: index rows (possibly from several docs, in doc order). kinds: [] means any part kind.
// A row matches when every query term (whitespace-split; "quoted phrase" stays one term) is in it.
// Ranked: rows holding the whole query as a phrase, then total term hits, then reading order. With no text, reading order only.
// A keystroke does not build the gram index. It uses whatever slices have finished, or the cheap scan.
export function searchParts(rows, { text = "", kinds = [], pages = "" } = {}, limit = 40) {
  const list = Array.isArray(rows) ? rows : [];
  const phrase = String(text ?? "").trim().replace(/\s+/g, " ").replace(/"/g, "").toLowerCase();
  const terms = queryTerms(text);
  const range = parsePageRange(pages);
  const take = Math.max(1, Math.floor(Number(limit) || 40));
  if (!list.length) return [];
  if (!terms.length) return takePlain(list, kinds, range, take);
  const ix = partIndexes.get(list);
  // A half-built index is not searched. The key uses the cheap scan until every slice has finished.
  if (ix?.ready) return searchIndexed(list, ix, { phrase, terms, kinds, range, take });
  return searchCheap(list, { phrase, terms, kinds, range, take });
}

// {before, hit, after} around the first matching term (the whole phrase when the text holds it); the text head when nothing matches.
export function partSnippet(text, needle, width = SNIPPET_W) {
  const t = squash(text);
  const low = t.toLowerCase();
  const phrase = String(needle ?? "").trim().replace(/\s+/g, " ").replace(/"/g, "").toLowerCase();
  let n = "";
  let at = -1;
  if (phrase) {
    at = low.indexOf(phrase);
    if (at !== -1) n = phrase;
    else {
      for (const term of queryTerms(needle)) {
        at = low.indexOf(term);
        if (at !== -1) { n = term; break; }
      }
    }
  }
  if (at === -1) return { before: "", hit: "", after: t.length > width ? `${t.slice(0, width)}…` : t };
  const room = Math.max(0, width - n.length);
  const start = Math.max(0, at - Math.floor(room / 3));
  const end = Math.min(t.length, at + n.length + room - (at - start));
  return {
    before: `${start > 0 ? "…" : ""}${t.slice(start, at)}`,
    hit: t.slice(at, at + n.length),
    after: `${t.slice(at + n.length, end)}${end < t.length ? "…" : ""}`,
  };
}

export const PART_LABELS = { paragraph: "Paragraph", table: "Table", figure: "Figure", caption: "Caption", heading: "Heading", formula: "Formula" };

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

// One gram index per row array. The first search walks the text; later searches reuse it.
const partIndexes = new WeakMap();

function addPosting(map, key, i) {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  } else if (arr[arr.length - 1] === i) return;
  arr.push(i);
}

function buildSearchIndex(rows) {
  const n = rows.length;
  const lowers = new Array(n);
  const tri = new Map();
  const bi = new Map();
  const ch = new Map();
  for (let i = 0; i < n; i += 1) {
    const raw = rows[i]?.lower;
    const lower = typeof raw === "string" ? raw : String(rows[i]?.text ?? "").toLowerCase();
    lowers[i] = lower;
    let start = 0;
    for (let c = 0; c <= lower.length; c += 1) {
      if (c !== lower.length && lower.charCodeAt(c) > 32) continue;
      const len = c - start;
      if (len >= 3) {
        for (let g = start; g <= c - 3; g += 1) addPosting(tri, lower.slice(g, g + 3), i);
      }
      if (len >= 2) {
        for (let g = start; g <= c - 2; g += 1) addPosting(bi, lower.slice(g, g + 2), i);
      }
      if (len >= 1) {
        for (let g = start; g < c; g += 1) addPosting(ch, lower[g], i);
      }
      start = c + 1;
    }
  }
  return {
    lowers,
    tri,
    bi,
    ch,
    stamp: new Uint32Array(n),
    gen: 1,
    hold: [],
    pool: [],
    ranked: [],
    listBuf: [],
  };
}

function indexFor(rows) {
  let ix = partIndexes.get(rows);
  if (!ix) {
    ix = buildSearchIndex(rows);
    partIndexes.set(rows, ix);
  }
  return ix;
}

// Panel open builds the part rows, then this, so the first key does not walk them.
export function warmPartsIndex(rows) {
  if (Array.isArray(rows) && rows.length) indexFor(rows);
}

function wordsOf(term) {
  const words = [];
  let start = 0;
  for (let i = 0; i <= term.length; i += 1) {
    if (i === term.length || term.charCodeAt(i) <= 32) {
      if (i > start) words.push(term.slice(start, i));
      start = i + 1;
    }
  }
  return words;
}

function listsFor(ix, word) {
  const buf = ix.listBuf;
  buf.length = 0;
  if (word.length >= 3) {
    for (let i = 0; i <= word.length - 3; i += 1) {
      const ids = ix.tri.get(word.slice(i, i + 3));
      if (!ids) return null;
      buf.push(ids);
    }
  } else if (word.length === 2) {
    const ids = ix.bi.get(word);
    if (!ids) return null;
    buf.push(ids);
  } else if (word.length === 1) {
    const ids = ix.ch.get(word);
    if (!ids) return null;
    buf.push(ids);
  } else return null;
  return buf;
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

// rows: index rows (possibly from several docs, in doc order). kinds: [] means any part kind.
// A row matches when every query term (whitespace-split; "quoted phrase" stays one term) is in it.
// Ranked: rows holding the whole query as a phrase, then total term hits, then reading order. With no text, reading order only.
export function searchParts(rows, { text = "", kinds = [], pages = "" } = {}, limit = 40) {
  const list = Array.isArray(rows) ? rows : [];
  const phrase = String(text ?? "").trim().replace(/\s+/g, " ").replace(/"/g, "").toLowerCase();
  const terms = queryTerms(text);
  const kindSet = kinds && kinds.length ? new Set(kinds) : null;
  const range = parsePageRange(pages);
  const take = Math.max(1, Math.floor(Number(limit) || 40));
  if (!list.length) return [];
  if (!terms.length) {
    const out = [];
    for (let i = 0; i < list.length && out.length < take; i += 1) {
      const row = list[i];
      if (kindSet && !kindSet.has(row.kind)) continue;
      if (range && (row.page < range.from || row.page > range.to)) continue;
      out.push(publish(row, 0));
    }
    return out;
  }
  const ix = indexFor(list);
  const specs = [];
  for (let t = 0; t < terms.length; t += 1) {
    const words = wordsOf(terms[t]);
    if (!words.length) return [];
    for (let w = 0; w < words.length; w += 1) {
      const lists = listsFor(ix, words[w]);
      if (!lists) return [];
      const copy = lists.slice();
      let n = copy[0].length;
      for (let i = 1; i < copy.length; i += 1) if (copy[i].length < n) n = copy[i].length;
      specs.push({ lists: copy, n });
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
  ranked.length = 0;
  for (let h = 0; h < hold.length; h += 1) {
    const i = hold[h];
    const row = list[i];
    if (kindSet && !kindSet.has(row.kind)) continue;
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
    let slot = pool[ranked.length];
    if (!slot) {
      slot = { row: null, count: 0, seq: 0, exact: 0 };
      pool[ranked.length] = slot;
    }
    slot.row = row;
    slot.count = count;
    slot.seq = i + 1;
    slot.exact = terms.length > 1 && hay.includes(phrase) ? 1 : 0;
    ranked.push(slot);
  }
  ranked.sort((a, b) => b.exact - a.exact || b.count - a.count || a.seq - b.seq);
  const out = [];
  const n = Math.min(take, ranked.length);
  for (let i = 0; i < n; i += 1) out.push(publish(ranked[i].row, ranked[i].count));
  return out;
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

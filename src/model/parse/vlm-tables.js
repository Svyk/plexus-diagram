import { chooseTableReading, restoreLabeledTotals } from "./vlm-arbitrate.js";
import { isNumericToken } from "./vlm-boxes.js";
import { polishTableText } from "./ocr-fix.js";

// Replace a rule-assembly table with a local VLM reading of the same box.
// The helper returns cells that already contain text. The high-accuracy path
// arbitrates (`arbitrate: true`) and keeps whichever reading the page evidence
// supports. Without that, rule assembly stays when the reading does not look
// like the same table.
//
// applyStructureTables (the TableFormer path) accepts a replacement only when the
// set of full cell strings has Jaccard ≥ 0.15. A VLM often fixes a word the rules
// mis-read, so that set misses even when the grid is the same table. Here the
// replacement also stands when the tokens of the concatenated cell text have
// Jaccard ≥ 0.15. Below both thresholds the rule table is kept.

function normCell(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function setJaccard(a, b) {
  const A = new Set((a?.cells || []).map((c) => normCell(c.text)).filter(Boolean));
  const B = new Set((b?.cells || []).map((c) => normCell(c.text)).filter(Boolean));
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function tokenJaccard(a, b) {
  const tokens = (table) => {
    const out = new Set();
    for (const piece of (table?.cells || []).map((c) => normCell(c.text)).join(" ").split(/[^a-z0-9%.,-]+/)) {
      if (piece) out.add(piece);
    }
    return out;
  };
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function iou(a, b) {
  if (!a || !b) return 0;
  const ix = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const iy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (ix <= 0 || iy <= 0) return 0;
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

// A small rule fragment sitting inside the chosen grid is the same table.
// IoU stays low because the fragment is much smaller than the grid.
function mostlyInside(inner, outer) {
  if (!inner || !outer) return false;
  const area = Math.max(0, inner[2] - inner[0]) * Math.max(0, inner[3] - inner[1]);
  if (area <= 0) return false;
  const w = Math.max(0, Math.min(inner[2], outer[2]) - Math.max(inner[0], outer[0]));
  const h = Math.max(0, Math.min(inner[3], outer[3]) - Math.max(inner[1], outer[1]));
  return (w * h) / area >= 0.7;
}

function pageTokenBag(doc, page) {
  const bag = new Set();
  const add = (text) => {
    for (const part of String(text || "").toLowerCase().split(/[^a-z0-9.+-]+/)) {
      if (part.length > 1 || /\d/.test(part)) bag.add(part);
    }
  };
  for (const id of doc?.order || []) {
    const block = doc.blocks?.[id];
    if (!block || block.page !== page) continue;
    if (block.type === "table") for (const cell of block.cells || []) add(cell.text);
    else if (block.type === "list") for (const item of block.items || []) add(item.text);
    else add(block.text);
  }
  return bag;
}

function structureTokens(structure) {
  const bag = new Set();
  for (const cell of structure?.cells || []) {
    for (const part of String(cell.text || "").toLowerCase().split(/[^a-z0-9.+-]+/)) {
      if (part.length > 1 || /\d/.test(part)) bag.add(part);
    }
  }
  return bag;
}

function overlapsTable(doc, structure) {
  if (!structure?.bbox) return false;
  for (const id of doc?.order || []) {
    const block = doc.blocks?.[id];
    if (!block || block.type !== "table" || block.page !== structure.page || !block.bbox) continue;
    if (iou(block.bbox, structure.bbox) >= 0.15 || mostlyInside(block.bbox, structure.bbox) || mostlyInside(structure.bbox, block.bbox)) return true;
  }
  return false;
}

// On a text-layer page the layout model may return a table the rules missed.
// Keep that reading when its words are already on the page, and keep every
// reading of a page that was OCR'd (the scan path is unchanged). A reading
// that overlaps a rule table is kept so arbitration can choose.
export function keepTextLayerReads(doc, structures, ocrPages) {
  const ocr = new Set(ocrPages || []);
  const bags = new Map();
  return (structures || []).filter((structure) => {
    if (!structure || ocr.has(structure.page)) return true;
    if (overlapsTable(doc, structure)) return true;
    if (!bags.has(structure.page)) bags.set(structure.page, pageTokenBag(doc, structure.page));
    const cells = structureTokens(structure);
    if (!cells.size) return false;
    let hit = 0;
    for (const token of cells) if (bags.get(structure.page).has(token)) hit += 1;
    return hit / cells.size >= 0.55;
  });
}

export function tableRegions(doc, pages) {
  const want = pages && pages.length ? new Set(pages) : null;
  const out = [];
  for (const id of doc?.order || []) {
    const block = doc.blocks?.[id];
    if (!block || block.type !== "table" || !block.bbox) continue;
    if (want && !want.has(block.page)) continue;
    const bbox = Array.isArray(block.bbox) ? block.bbox : [block.bbox.x0, block.bbox.y0, block.bbox.x1, block.bbox.y1];
    if (bbox.length < 4 || bbox.some((n) => !Number.isFinite(n))) continue;
    out.push({ page: block.page, bbox });
  }
  return out;
}

function headerRowsOf(cells, rows) {
  let n = 0;
  for (let r = 0; r < rows; r++) {
    const row = (cells || []).filter((c) => c.r === r);
    if (!row.length || !row.every((c) => c.header)) break;
    n++;
  }
  return n;
}

function tableFromVlm(structure, { id = "vlm", method = "vlm" } = {}) {
  const cells = (structure.cells || []).map((cell) => ({
    r: cell.r,
    c: cell.c,
    rowSpan: cell.rowSpan || 1,
    colSpan: cell.colSpan || 1,
    text: cell.text || "",
    header: Boolean(cell.header),
  }));
  const rows = structure.rows || cells.reduce((m, c) => Math.max(m, c.r + (c.rowSpan || 1)), 0);
  const cols = structure.cols || cells.reduce((m, c) => Math.max(m, c.c + (c.colSpan || 1)), 0);
  return {
    id,
    type: "table",
    page: structure.page,
    bbox: structure.bbox,
    rows,
    cols,
    headerRows: structure.headerRows ?? headerRowsOf(cells, rows),
    headerCols: 0,
    cells,
    method,
    confidence: structure.confidence ?? 0.7,
    engine: "builtin",
  };
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

// A reading with no rule table is inserted only when it is a grid of numbers.
// A numbered list (one column of short integers, one column of sentences)
// and a prose block the reader called a table are not.
export function gridReading(table) {
  const cells = table?.cells || [];
  const texts = cells.map((c) => String(c.text || "").trim()).filter(Boolean);
  const rows = table?.rows || 0;
  const cols = table?.cols || 0;
  if (rows < 4 || cols < 2 || texts.length < 6) return false;
  const byCol = new Map();
  for (const cell of cells) {
    const text = String(cell.text || "").trim();
    if (!text) continue;
    if (!byCol.has(cell.c)) byCol.set(cell.c, []);
    byCol.get(cell.c).push(text);
  }
  const groups = [...byCol.values()];
  if (groups.length === 2) {
    const intCol = groups.some((col) => col.length >= 4 && col.filter((t) => /^\d{1,4}\.?$/.test(t)).length >= 0.6 * col.length);
    const proseCol = groups.some((col) => col.filter((t) => letterCount(t) >= 12).length >= 0.5 * col.length);
    if (intCol && proseCol) return false;
  }
  return texts.filter((t) => isNumericToken(t)).length / texts.length >= 0.45;
}

// `minJaccard` applies to both the full-string set and the token set. Either one
// is enough to replace. A region with no overlapping rule table is inserted
// when arbitration is off, or when the reading is a numeric grid.
// `trust` replaces every overlapping rule table. `arbitrate` keeps the better of
// the rule table and the reading, using `evidence` (page words and rules).
// `verifiedPages` are text-layer pages whose readings were already checked against the page words.
export function applyVlmTables(doc, structures, { method = "vlm", minJaccard = 0.15, trust = false, arbitrate = false, evidence = null, verifiedPages = [] } = {}) {
  if (!doc || !structures?.length) return { doc, applied: [] };
  const blocks = { ...doc.blocks };
  const order = [...(doc.order || [])];
  const applied = [];
  const used = new Set();
  let seq = 0;
  for (const structure of structures) {
    if (!structure?.cells?.length || !structure.bbox) continue;
    const built = tableFromVlm(structure, { id: `vlm${seq++}`, method });
    let host = null;
    let best = 0.15;
    for (const id of order) {
      const block = blocks[id];
      if (!block || block.type !== "table" || block.page !== structure.page || used.has(id)) continue;
      const overlap = iou(block.bbox, built.bbox);
      if (overlap > best) { best = overlap; host = block; }
    }
    if (!host) {
      let area = 0;
      for (const id of order) {
        const block = blocks[id];
        if (!block || block.type !== "table" || block.page !== structure.page || used.has(id)) continue;
        if (!mostlyInside(block.bbox, built.bbox)) continue;
        const box = block.bbox;
        const next = Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
        if (next > area) { area = next; host = block; }
      }
    }
    // On a text-layer page the reading already passed keepTextLayerReads (its words are on the page), so a
    // word table counts; elsewhere a reading with no rule table must be a numeric grid.
    if (arbitrate && !host && !gridReading(built) && !verifiedPages.includes(structure.page)) continue;
    // Full-string set Jaccard is what TableFormer uses. Token Jaccard is also
    // accepted: on this corpus that raised cell F1 from 0.140 to 0.155 and
    // left structure F1 at 0.606 versus 0.610.
    const same = host && (setJaccard(host, built) >= minJaccard || tokenJaccard(host, built) >= minJaccard);
    if (arbitrate && host) {
      const page = (evidence || []).find((item) => item.page === structure.page) || { words: [], rules: [] };
      const decision = chooseTableReading(host, built, page);
      if (decision.choice === "rule") continue;
      const chosen = decision.table;
      polishTableText(chosen);
      const aligned = restoreLabeledTotals(chosen, host);
      if (aligned !== chosen) {
        chosen.cells = aligned.cells;
        chosen.rows = aligned.rows;
        chosen.cols = aligned.cols;
        chosen.headerRows = aligned.headerRows;
      }
      for (const id of [...order]) {
        const block = blocks[id];
        if (!block || block.type !== "table" || block.page !== structure.page || block.id === host.id) continue;
        const box = chosen.bbox || built.bbox;
        if (iou(block.bbox, box) < 0.3 && !mostlyInside(block.bbox, box)) continue;
        delete blocks[id];
        const at = order.indexOf(id);
        if (at >= 0) order.splice(at, 1);
      }
      used.add(host.id);
      blocks[host.id] = {
        ...host,
        bbox: chosen.bbox || built.bbox,
        rows: chosen.rows,
        cols: chosen.cols,
        headerRows: chosen.headerRows,
        cells: chosen.cells,
        method,
        confidence: built.confidence,
        grid: undefined,
        repairs: undefined,
      };
      applied.push({ id: host.id, page: structure.page, rows: chosen.rows, cols: chosen.cols, choice: decision.choice });
      continue;
    }
    if (host && !same && !trust) continue;
    if (trust) {
      for (const id of [...order]) {
        const block = blocks[id];
        if (!block || block.type !== "table" || block.page !== structure.page) continue;
        if (iou(block.bbox, built.bbox) < 0.1) continue;
        delete blocks[id];
        const at = order.indexOf(id);
        if (at >= 0) order.splice(at, 1);
      }
      host = null;
    }
    if (host) {
      used.add(host.id);
      polishTableText(built);
      blocks[host.id] = {
        ...host,
        bbox: built.bbox,
        rows: built.rows,
        cols: built.cols,
        headerRows: built.headerRows,
        cells: built.cells,
        method,
        confidence: built.confidence,
        grid: undefined,
        repairs: undefined,
      };
      applied.push({ id: host.id, page: structure.page, rows: built.rows, cols: built.cols });
    } else {
      const id = built.id;
      while (blocks[id]) built.id = `${id}b`;
      polishTableText(built);
      blocks[built.id] = built;
      const at = order.findIndex((oid) => blocks[oid]?.page > structure.page);
      if (at < 0) order.push(built.id);
      else order.splice(at, 0, built.id);
      applied.push({ id: built.id, page: structure.page, rows: built.rows, cols: built.cols, inserted: true });
    }
  }
  return { doc: { ...doc, blocks, order }, applied };
}

function centerOf(bbox) {
  if (!bbox || bbox.length < 4) return null;
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function splitByWidth(text, widths) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!widths.length) return [];
  if (!words.length) return widths.map(() => "");
  if (widths.length === 1) return [words.join(" ")];
  const total = widths.reduce((sum, w) => sum + w, 0) || 1;
  const counts = widths.map((w) => Math.max(1, Math.round((words.length * w) / total)));
  let drift = words.length - counts.reduce((sum, n) => sum + n, 0);
  counts[counts.length - 1] = Math.max(0, counts[counts.length - 1] + drift);
  const out = [];
  let at = 0;
  for (const n of counts) {
    out.push(words.slice(at, at + n).join(" "));
    at += n;
  }
  if (at < words.length) {
    const rest = words.slice(at).join(" ");
    out[out.length - 1] = [out[out.length - 1], rest].filter(Boolean).join(" ");
  }
  return out;
}

// A page transcription is placed by alignment against the hosts' own Vision
// words, in document order. Each transcription word that matches a Vision word
// belongs to that word's host; the words between two anchored hosts are shared
// among the tail of the first, the hosts between that matched nothing, and the
// head of the second, in proportion to the Vision words those pieces still
// hold. A host with no Vision words takes its share from its box height. With
// no match on the page at all, the split is proportional to Vision word
// counts, the remainder on the earlier hosts. Returns one string per host;
// the strings concatenate to the transcription.
const ALIGN_CELLS_MAX = 4e6;

function alignKey(word) {
  return String(word || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

function editDistanceAtMost(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

// Weight of matching two words: zero when they are not the same word. Longer
// words anchor harder; a number counts as a word of at least three letters;
// a near spelling of a long word still counts.
function matchWeight(a, b) {
  if (a === b) {
    if (/\d/.test(a)) return Math.min(Math.max(a.length, 3), 8);
    return a.length < 2 ? 0 : Math.min(a.length, 8);
  }
  if (a.length < 2 || b.length < 2) return 0;
  if (a.length < 5 || b.length < 5) return 0;
  const slack = Math.min(a.length, b.length) >= 8 ? 2 : 1;
  if (editDistanceAtMost(a, b, slack) > slack) return 0;
  return 0.7 * Math.min(a.length, b.length, 8);
}

// Heaviest monotone matching of two key sequences. Returns [[i, j], ...] ascending.
function weightedLcs(A, B) {
  const n = A.length;
  const m = B.length;
  if (!n || !m || n * m > ALIGN_CELLS_MAX) return [];
  const W = m + 1;
  const dp = new Float32Array((n + 1) * W);
  for (let i = 1; i <= n; i++) {
    const a = A[i - 1];
    for (let j = 1; j <= m; j++) {
      let best = Math.max(dp[(i - 1) * W + j], dp[i * W + j - 1]);
      const w = matchWeight(a, B[j - 1]);
      if (w > 0) best = Math.max(best, dp[(i - 1) * W + j - 1] + w);
      dp[i * W + j] = best;
    }
  }
  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const here = dp[i * W + j];
    if (here === dp[(i - 1) * W + j]) i -= 1;
    else if (here === dp[i * W + j - 1]) j -= 1;
    else {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    }
  }
  return pairs.reverse();
}

// Largest-remainder split of `count` items over `weights`; a remainder goes to
// the earlier pieces. All-zero weights fall back to `alt`, then to equal shares.
function shareOut(count, weights, alt) {
  const k = weights.length;
  const out = new Array(k).fill(0);
  if (!k || count <= 0) return out;
  let use = weights;
  if (!use.some((w) => w > 0)) use = alt && alt.some((w) => w > 0) ? alt : null;
  if (!use) use = new Array(k).fill(1);
  const total = use.reduce((sum, w) => sum + w, 0);
  const raw = use.map((w) => (count * w) / total);
  let given = 0;
  for (let i = 0; i < k; i++) {
    out[i] = Math.floor(raw[i]);
    given += out[i];
  }
  const byRemainder = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let t = 0; given < count && t < byRemainder.length; t++, given++) out[byRemainder[t][1]] += 1;
  return out;
}

function hostHeight(host) {
  const b = host?.bbox;
  return b && b.length >= 4 ? Math.max(0, b[3] - b[1]) : 0;
}

// Fewer than this much matched weight is a stray word, not an anchor: one
// word of five letters, a number and a word, or two short words.
const ANCHOR_WEIGHT = 5;

export function placePageText(text, hosts) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const k = hosts.length;
  if (!k) return [];
  const keys = words.map(alignKey);
  const V = [];
  const visionCount = hosts.map((host, hi) => {
    const toks = String(host?.text || "").split(/\s+/).map(alignKey).filter((key) => key.length);
    for (const key of toks) V.push({ key, host: hi });
    return toks.length;
  });
  const pairs = weightedLcs(keys, V.map((v) => v.key));
  const weight = new Array(k).fill(0);
  for (const [ti, vi] of pairs) weight[V[vi].host] += matchWeight(keys[ti], V[vi].key);
  const first = new Array(k).fill(-1);
  const last = new Array(k).fill(-1);
  const firstV = new Array(k).fill(-1);
  const lastV = new Array(k).fill(-1);
  for (const [ti, vi] of pairs) {
    const hi = V[vi].host;
    if (weight[hi] < ANCHOR_WEIGHT) continue;
    if (first[hi] < 0) { first[hi] = ti; firstV[hi] = vi; }
    last[hi] = ti;
    lastV[hi] = vi;
  }
  const anchored = [];
  for (let hi = 0; hi < k; hi++) if (first[hi] >= 0) anchored.push(hi);
  const vStart = [];
  let acc = 0;
  for (let hi = 0; hi < k; hi++) { vStart.push(acc); acc += visionCount[hi]; }
  // Words each host owns: [from, to) over the transcription.
  const from = new Array(k).fill(0);
  const to = new Array(k).fill(0);
  if (!anchored.length) {
    const shares = shareOut(words.length, visionCount, hosts.map(hostHeight));
    let at = 0;
    for (let hi = 0; hi < k; hi++) { from[hi] = at; at += shares[hi]; to[hi] = at; }
    return hosts.map((_, hi) => words.slice(from[hi], to[hi]).join(" "));
  }
  for (const hi of anchored) { from[hi] = first[hi]; to[hi] = last[hi] + 1; }
  // Pieces of a gap: the earlier anchor's tail, the unanchored hosts, the later anchor's head.
  const fill = (gapFrom, gapTo, before, between, after) => {
    const pieces = [];
    if (before != null) pieces.push({ host: before, tail: true, w: vStart[before] + visionCount[before] - 1 - lastV[before], h: 0 });
    for (const hi of between) pieces.push({ host: hi, w: visionCount[hi], h: hostHeight(hosts[hi]) });
    if (after != null) pieces.push({ host: after, head: true, w: firstV[after] - vStart[after], h: 0 });
    // Each piece's unmatched Vision words say how many words it expects. Fewer
    // words than that are shared in proportion. The surplus goes to the hosts
    // between the anchors (by Vision words, then box height); with none, it
    // continues the earlier host, or starts the later host when the earlier
    // host's last word ended a sentence.
    const n = gapTo - gapFrom;
    const need = pieces.reduce((sum, p) => sum + p.w, 0);
    let shares;
    if (n <= need) shares = shareOut(n, pieces.map((p) => p.w), pieces.map((p) => p.h));
    else {
      shares = pieces.map((p) => p.w);
      const extra = n - need;
      const mids = pieces.map((p, i) => (!p.tail && !p.head ? i : -1)).filter((i) => i >= 0);
      if (mids.length) {
        const split = shareOut(extra, mids.map((i) => pieces[i].w), mids.map((i) => pieces[i].h));
        mids.forEach((i, e) => { shares[i] += split[e]; });
      } else if (before == null) shares[0] += extra;
      else {
        const tailEnd = words[gapFrom + pieces[0].w - 1] || "";
        const toHead = after != null && !between.length && /[.!?:]["')\]]*$/.test(tailEnd);
        shares[toHead ? pieces.length - 1 : 0] += extra;
      }
    }
    let at = gapFrom;
    pieces.forEach((piece, i) => {
      const n = shares[i];
      if (piece.tail) to[piece.host] = at + n;
      else if (piece.head) from[piece.host] = at;
      else { from[piece.host] = at; to[piece.host] = at + n; }
      at += n;
    });
  };
  const range = (a, b) => { const out = []; for (let hi = a; hi < b; hi++) out.push(hi); return out; };
  fill(0, first[anchored[0]], null, range(0, anchored[0]), anchored[0]);
  for (let a = 0; a + 1 < anchored.length; a++) {
    const lo = anchored[a];
    const hi = anchored[a + 1];
    fill(last[lo] + 1, first[hi], lo, range(lo + 1, hi), hi);
  }
  const tail = anchored[anchored.length - 1];
  fill(last[tail] + 1, words.length, tail, range(tail + 1, k), null);
  return hosts.map((_, hi) => words.slice(from[hi], to[hi]).join(" "));
}

// Replace the text of Vision lines whose centres sit in a VLM text region.
// The line boxes stay. `regions` are `{page, bbox, text}` in top-left PDF points.
// A `pageText` region is one page transcription placed by placePageText.
// `reads` records each page transcription with its hosts' Vision text, for
// the placement check (tools/parse-bench/text-placement.mjs).
export function alignVlmText(doc, regions) {
  if (!doc || !regions?.length) return { doc, applied: [], reads: [] };
  const blocks = { ...doc.blocks };
  let order = doc.order;
  const applied = [];
  const reads = [];
  const kinds = new Set(["para", "heading", "caption", "footnote"]);
  for (const region of regions) {
    if (!region?.text || !region.bbox) continue;
    const inside = [];
    for (const id of order || []) {
      const block = blocks[id];
      if (!block || block.page !== region.page || !kinds.has(block.type) || !block.bbox) continue;
      const c = centerOf(block.bbox);
      if (!c) continue;
      if (c[0] < region.bbox[0] || c[0] > region.bbox[2] || c[1] < region.bbox[1] || c[1] > region.bbox[3]) continue;
      inside.push(block);
    }
    if (!inside.length) {
      // Vision found nothing to host the reading. A page that already has a
      // paragraph keeps it: the region simply missed those lines.
      const have = (order || []).map((id) => blocks[id]).filter((block) => block && block.page === region.page && kinds.has(block.type));
      if (have.length || String(region.text).replace(/\s/g, "").length < 8) continue;
      if (order === doc.order) order = [...(doc.order || [])];
      const id = `vlmtext-p${region.page}-${applied.length + 1}`;
      blocks[id] = { id, type: "para", page: region.page, bbox: region.bbox.map((v) => Math.round(v)), text: region.text, confidence: 0.6, engine: "vlm" };
      order.push(id);
      applied.push(id);
      continue;
    }
    // A formula page is already transcribed in the page's own notation. A region
    // full of TeX commands is a second notation, and swapping it in wipes the line.
    const hostText = inside.map((b) => b.text).join(" ");
    if (texCommandCount(region.text) >= 2 && texCommandCount(hostText) === 0) continue;
    if (region.pageText) {
      const parts = placePageText(region.text, inside);
      reads.push({ page: region.page, text: region.text, hosts: inside.map((block) => ({ id: block.id, vision: block.text || "" })) });
      // A caption that shares no word with its slice is a different line.
      // The slice is kept on the nearest prose host so the transcription
      // stays in the page, and the caption keeps the reading it already had.
      const held = [];
      inside.forEach((block, i) => {
        const text = parts[i] || "";
        if (block.type === "caption" && text && block.text && !sharesWord(text, block.text)) {
          held.push(text);
          return;
        }
        if (text === block.text) return;
        blocks[block.id] = { ...block, text };
        applied.push(block.id);
      });
      if (held.length) {
        const host = [...inside].reverse().find((block) => block.type !== "caption" && blocks[block.id]);
        if (host) {
          const current = blocks[host.id].text || "";
          const text = [current, held.join(" ")].filter(Boolean).join(" ");
          if (text !== current) {
            blocks[host.id] = { ...blocks[host.id], text };
            if (!applied.includes(host.id)) applied.push(host.id);
          }
        }
      }
      continue;
    }
    inside.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
    const parts = splitByWidth(region.text, inside.map((b) => Math.max(1, b.bbox[2] - b.bbox[0])));
    inside.forEach((block, i) => {
      const text = parts[i] || "";
      if (!text || text === block.text) return;
      blocks[block.id] = { ...block, text };
      applied.push(block.id);
    });
  }
  return { doc: { ...doc, blocks, order }, applied, reads };
}

function texCommandCount(text) {
  return (String(text || "").match(/\\(?:[A-Za-z]+|[()[\]])/g) || []).length;
}

function sharesWord(a, b) {
  const words = new Set(String(a || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  for (const word of String(b || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []) {
    if (words.has(word)) return true;
  }
  return false;
}

function overlapsX(a, b) {
  return Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
}

// A layout figure_title box links the local line it covers to the nearest
// figure that has no caption. It does not move the figure box and it does
// not replace the line's text.
export function linkLayoutCaptions(doc, layout) {
  if (!doc || !layout?.length) return { doc, applied: [] };
  const titles = layout.filter((b) => b && b.label === "figure_title" && b.bbox && b.bbox.length >= 4);
  if (!titles.length) return { doc, applied: [] };
  const blocks = { ...doc.blocks };
  const applied = [];
  const figures = (doc.order || []).map((id) => blocks[id]).filter((b) => b && b.type === "figure" && b.bbox);
  for (const title of titles) {
    const hosts = [];
    for (const id of doc.order || []) {
      const block = blocks[id];
      if (!block || block.page !== title.page || (block.type !== "para" && block.type !== "caption") || !block.bbox || block.for) continue;
      const c = centerOf(block.bbox);
      if (!c) continue;
      if (c[0] < title.bbox[0] || c[0] > title.bbox[2] || c[1] < title.bbox[1] || c[1] > title.bbox[3]) continue;
      hosts.push(block);
    }
    if (!hosts.length) continue;
    hosts.sort((a, b) => String(b.text || "").length - String(a.text || "").length);
    const host = hosts[0];
    let best = null;
    let bestGap = Infinity;
    for (const fig of figures) {
      if (fig.page !== title.page || fig.caption) continue;
      const overlap = overlapsX(fig.bbox, host.bbox);
      if (overlap < 12) continue;
      let gap = 0;
      if (host.bbox[1] >= fig.bbox[3] - 4) gap = host.bbox[1] - fig.bbox[3];
      else if (host.bbox[3] <= fig.bbox[1] + 4) gap = fig.bbox[1] - host.bbox[3];
      if (gap > 80 || gap < 0) continue;
      if (gap < bestGap) { bestGap = gap; best = fig; }
    }
    if (!best) continue;
    blocks[best.id] = { ...blocks[best.id], caption: host.id };
    best.caption = host.id;
    const next = blocks[host.id];
    blocks[host.id] = next.type === "para" ? { ...next, type: "caption", for: best.id } : { ...next, for: best.id };
    applied.push({ figure: best.id, caption: host.id, page: title.page });
  }
  return { doc: { ...doc, blocks }, applied };
}

// A layout figure is added only on a page that has none. An existing figure
// stays, so a hint cannot pull figure F1 down by adding a second box.
export function hintLayoutFigures(doc, hints) {
  if (!doc || !hints?.length) return { doc, applied: [] };
  const blocks = { ...doc.blocks };
  const order = [...(doc.order || [])];
  const pagesWith = new Set();
  for (const id of order) {
    const block = blocks[id];
    if (block?.type === "figure") pagesWith.add(block.page);
  }
  const applied = [];
  let seq = 0;
  for (const hint of hints) {
    if (!hint?.bbox || pagesWith.has(hint.page)) continue;
    if (hint.label && hint.label !== "image" && hint.label !== "chart") continue;
    const id = `vfig${seq++}`;
    const block = {
      id,
      type: "figure",
      page: hint.page,
      bbox: hint.bbox,
      caption: null,
      image: { kind: "crop", source: hint.label || "image" },
      confidence: hint.score ?? 0.6,
      method: "vlm-layout",
      engine: "builtin",
    };
    blocks[id] = block;
    const at = order.findIndex((oid) => blocks[oid]?.page > hint.page);
    if (at < 0) order.push(id);
    else order.splice(at, 0, id);
    pagesWith.add(hint.page);
    applied.push({ id, page: hint.page });
  }
  return { doc: { ...doc, blocks, order }, applied };
}

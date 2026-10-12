// Load and validate a `pxd-phd/1` blueprint (~/wo/pxd-phd/schema.md). validate() is pure.
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const SCHEMA = "pxd-phd/1";
export const CARD_TYPES = ["note", "quote", "claim", "question", "pageref", "blockref", "pdf", "image", "table", "chart",
  "query", "ai-answer", "board", "todo", "embed", "formula", "code", "web"];
export const HL_COLORS = ["yellow", "red", "green", "blue", "purple"];
export const VIEWS = ["board", "kanban", "timeline", "gallery", "graph"];
export const DEFAULT_ROOT = "PhD/Cronobacter & Spore Control in PIF";

// The scale the real blueprint must reach (schema.md "Scale targets").
export const TARGETS = {
  mainCards: 1000, mainEdges: 1500, mainSections: 25, mainPdfCards: 60, mainTables: 40, mainImages: 60, mainBoardCards: 10,
  boards: 40, depth: 4, cards: 3000, edges: 5000, pdfs: 80, highlights: 1200, bigPdfs: 3, longPdfPages: 200,
};

const readJson = async (path, fallback) => (existsSync(path) ? JSON.parse(await readFile(path, "utf8")) : fallback);

export function parseJsonl(text, name = "jsonl") {
  const out = [];
  String(text).split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try { out.push(JSON.parse(t)); } catch (e) { throw new Error(`${name}:${i + 1}: ${e.message}`); }
  });
  return out;
}

export async function loadBlueprint(dir) {
  const meta = await readJson(join(dir, "meta.json"), null);
  const library = await readJson(join(dir, "library.json"), []);
  const boards = await readJson(join(dir, "boards.json"), []);
  const extras = await readJson(join(dir, "extras.json"), {});
  const cards = [];
  const cardDir = join(dir, "cards");
  if (existsSync(cardDir)) {
    for (const f of (await readdir(cardDir)).filter((n) => n.endsWith(".jsonl")).sort()) {
      cards.push(...parseJsonl(await readFile(join(cardDir, f), "utf8"), f));
    }
  }
  const edgesPath = join(dir, "edges.jsonl");
  const edges = existsSync(edgesPath) ? parseJsonl(await readFile(edgesPath, "utf8"), "edges.jsonl") : [];
  return { dir, meta, library, boards: Array.isArray(boards) ? boards : boards.boards || [], cards, edges, extras };
}

// "S001:h3" or "S001#h3" -> { source, index }.
export function parseHighlightRef(ref) {
  const m = /^([A-Za-z][\w-]*)[:#]h(\d+)$/.exec(String(ref ?? ""));
  return m ? { source: m[1], index: Number(m[2]) } : null;
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function validate(bp) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);
  if (!bp?.meta) err("meta.json missing");
  else if (bp.meta.schema !== SCHEMA) err(`meta.schema is ${bp.meta.schema}, want ${SCHEMA}`);

  const sources = new Map();
  let highlights = 0;
  for (const s of bp.library || []) {
    if (!s?.id) { err("library entry without id"); continue; }
    if (sources.has(s.id)) err(`library: duplicate id ${s.id}`);
    sources.set(s.id, s);
    if (s.kind !== "pdf" && s.kind !== "web") err(`library ${s.id}: kind ${s.kind}`);
    if (!s.title) err(`library ${s.id}: no title`);
    for (const [i, h] of (s.highlights || []).entries()) {
      highlights += 1;
      if (!h || typeof h.text !== "string" || h.text.trim().length < 3) err(`library ${s.id} h${i}: no text`);
      if (h?.color && !HL_COLORS.includes(h.color)) warn(`library ${s.id} h${i}: colour ${h.color} -> yellow`);
      if (h?.page !== undefined && !(Number.isInteger(h.page) && h.page >= 1)) warn(`library ${s.id} h${i}: page ${h.page}`);
    }
    if (s.kind === "web" && (s.highlights || []).length) warn(`library ${s.id}: web source highlights are written as quotes`);
  }

  const boards = new Map();
  for (const b of bp.boards || []) {
    if (!b?.id) { err("board without id"); continue; }
    if (boards.has(b.id)) err(`boards: duplicate id ${b.id}`);
    boards.set(b.id, b);
    if (b.view && !VIEWS.includes(b.view)) warn(`board ${b.id}: view ${b.view}`);
    const secs = new Map();
    for (const s of b.sections || []) {
      if (!s?.id) { err(`board ${b.id}: section without id`); continue; }
      if (secs.has(s.id)) err(`board ${b.id}: duplicate section ${s.id}`);
      secs.set(s.id, s);
      for (const k of ["x", "y", "w", "h"]) if (!isNum(s[k])) err(`board ${b.id} section ${s.id}: ${k} missing`);
    }
    for (const s of b.sections || []) {
      if (s.parent && !secs.has(s.parent)) err(`board ${b.id} section ${s.id}: parent ${s.parent} missing`);
      const seen = new Set([s.id]);
      let p = s.parent ? secs.get(s.parent) : null;
      while (p) {
        if (seen.has(p.id)) { err(`board ${b.id} section ${s.id}: parent cycle`); break; }
        seen.add(p.id);
        p = p.parent ? secs.get(p.parent) : null;
      }
    }
  }
  const roots = [...boards.values()].filter((b) => !b.parent);
  if (roots.length !== 1) err(`want exactly one root board, found ${roots.length}`);

  const cards = new Map();
  const perBoard = new Map();
  for (const c of bp.cards || []) {
    if (!c?.id) { err("card without id"); continue; }
    if (cards.has(c.id)) err(`cards: duplicate id ${c.id}`);
    cards.set(c.id, c);
    const b = boards.get(c.board);
    if (!b) { err(`card ${c.id}: board ${c.board} missing`); continue; }
    perBoard.set(c.board, (perBoard.get(c.board) || 0) + 1);
    if (!CARD_TYPES.includes(c.type)) err(`card ${c.id}: type ${c.type}`);
    if (c.section && !(b.sections || []).some((s) => s.id === c.section)) err(`card ${c.id}: section ${c.section} not on ${c.board}`);
    if (c.source && !sources.has(c.source)) err(`card ${c.id}: source ${c.source} missing`);
    if (c.highlight !== undefined) {
      const s = sources.get(c.source);
      if (!s || !Number.isInteger(c.highlight) || c.highlight < 0 || c.highlight >= (s.highlights || []).length) err(`card ${c.id}: highlight ${c.highlight} out of range`);
    }
    if (c.type === "pdf" && !c.source) err(`card ${c.id}: pdf card without source`);
    if (c.type === "table" && !(c.table?.rows?.length)) err(`card ${c.id}: table without rows`);
    if (c.type === "chart" && !(c.chart?.series?.length || c.table?.rows?.length)) err(`card ${c.id}: chart without series`);
    if (c.region && !(Array.isArray(c.region.f) && c.region.f.length === 4)) err(`card ${c.id}: region.f needs [x,y,w,h]`);
    if (c.region && c.type !== "image" && !c.source) err(`card ${c.id}: region needs a source PDF or an image card`);
    if (c.type === "image" && !(c.image?.url || (c.image?.source && c.image?.page))) err(`card ${c.id}: image needs url or source+page`);
    if (!isNum(c.x) || !isNum(c.y)) warn(`card ${c.id}: no x/y (auto-placed)`);
  }
  // A nested board names its card in the parent (`card`); that card must be type board on the parent board.
  const depthOf = new Map();
  for (const b of boards.values()) {
    if (!b.parent) continue;
    if (!boards.has(b.parent)) { err(`board ${b.id}: parent ${b.parent} missing`); continue; }
    const card = cards.get(b.card);
    if (!card) err(`board ${b.id}: card ${b.card} missing`);
    else {
      if (card.type !== "board") err(`board ${b.id}: card ${b.card} is ${card.type}, want board`);
      if (card.board !== b.parent) err(`board ${b.id}: card ${b.card} is on ${card.board}, want ${b.parent}`);
    }
  }
  const depth = (id, seen = new Set()) => {
    if (depthOf.has(id)) return depthOf.get(id);
    if (seen.has(id)) { err(`board ${id}: parent cycle`); return 0; }
    seen.add(id);
    const b = boards.get(id);
    const d = b?.parent && boards.has(b.parent) ? depth(b.parent, seen) + 1 : 1;
    depthOf.set(id, d);
    return d;
  };
  for (const id of boards.keys()) depth(id);
  const nestedFor = new Map([...boards.values()].filter((b) => b.card).map((b) => [b.card, b.id]));
  for (const c of cards.values()) if (c.type === "board" && !nestedFor.has(c.id)) warn(`card ${c.id}: board card with no nested board (written empty)`);

  const edgeIds = new Map();
  for (const e of bp.edges || []) if (e?.id) edgeIds.set(e.id, e);
  let edgeCount = 0;
  for (const [i, e] of (bp.edges || []).entries()) {
    const a = cards.get(e?.from);
    const b = cards.get(e?.to) || null;
    const bEdge = !b ? edgeIds.get(e?.to) : null;
    if (!a) { err(`edge ${i}: from ${e?.from} missing`); continue; }
    if (!b && !bEdge) { err(`edge ${i}: to ${e?.to} missing`); continue; }
    if (e.from === e.to) { err(`edge ${i}: self loop`); continue; }
    const toBoard = b ? b.board : cards.get(bEdge.from)?.board;
    if (a.board !== toBoard) { err(`edge ${i}: ${e.from} (${a.board}) and ${e.to} (${toBoard}) are on different boards`); continue; }
    if (e.fromCell && cards.get(e.from)?.type !== "table") warn(`edge ${i}: fromCell on a non-table`);
    if (e.toCell && b?.type !== "table") warn(`edge ${i}: toCell on a non-table`);
    edgeCount += 1;
  }

  const root = roots[0];
  const onMain = (bp.cards || []).filter((c) => c.board === root?.id);
  const pdfSources = [...sources.values()].filter((s) => s.kind === "pdf");
  const counts = {
    boards: boards.size,
    depth: Math.max(0, ...depthOf.values()),
    cards: cards.size,
    edges: edgeCount,
    pdfs: pdfSources.length,
    highlights,
    bigPdfs: pdfSources.filter((s) => (s.highlights || []).length >= 150).length,
    longPdfPages: Math.max(0, ...pdfSources.map((s) => Number(s.pages) || 0)),
    mainCards: onMain.length,
    mainEdges: (bp.edges || []).filter((e) => cards.get(e.from)?.board === root?.id).length,
    mainSections: (root?.sections || []).length,
    mainPdfCards: onMain.filter((c) => c.type === "pdf").length,
    mainTables: onMain.filter((c) => c.type === "table" || c.type === "chart").length,
    mainImages: onMain.filter((c) => c.type === "image").length,
    mainBoardCards: onMain.filter((c) => c.type === "board").length,
    types: Object.fromEntries(CARD_TYPES.map((t) => [t, (bp.cards || []).filter((c) => c.type === t).length])),
  };
  const shortfalls = Object.entries(TARGETS).filter(([k, v]) => (counts[k] ?? 0) < v).map(([k, v]) => `${k} ${counts[k] ?? 0} < ${v}`);
  return { ok: errors.length === 0, errors, warnings, counts, shortfalls, rootId: root?.id || null, depthOf };
}

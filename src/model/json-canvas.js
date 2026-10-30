// JSON Canvas 1.0 (jsoncanvas.org, Obsidian's .canvas) in and out. Pure: no DOM, no Roam calls.
// Import builds a Roam-shaped board tree (the shape templates use) that planCopy turns into creates.
// Text, file and link nodes become cards, groups become sections, edges become arrows.
// Export writes cards, text items and sections back with their world rects and the board's arrows.
import { PALETTE, UNTITLED_BOARD, boardString, classifyString, edgeString } from "./schema.js";

export const CANVAS_MAX_NODES = 2000;
export const CANVAS_MAX_EDGES = 4000;

// Obsidian's six preset colors. The other palette names are written as hex.
const PRESETS = { 1: "red", 2: "orange", 3: "yellow", 4: "green", 5: "teal", 6: "purple" };
const PRESET_OF = Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [v, k]));
const PALETTE_HEX = {
  gray: "#6b7280", red: "#dc2626", orange: "#ea580c", yellow: "#ca8a04", green: "#16a34a",
  teal: "#0d9488", blue: "#2563eb", indigo: "#4f46e5", purple: "#9333ea", pink: "#db2777",
};
const SIDES = ["top", "right", "bottom", "left"];
const URL_RE = /^https?:\/\/\S+$/i;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round1 = (n) => Math.round(n * 10) / 10;

function colorIn(v) {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (PRESETS[s]) return PRESETS[s];
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return undefined;
}

function colorOut(v) {
  if (!v) return undefined;
  if (PRESET_OF[v]) return PRESET_OF[v];
  if (PALETTE.includes(v)) return PALETTE_HEX[v];
  return /^#[0-9a-f]{6}$/.test(v) ? v : undefined;
}

// Code spans and URLs pass through the inline rewrites untouched.
const KEEP = /(`[^`\n]*`|https?:\/\/[^\s)\]]+)/;
const outsideKept = (s, fn) => String(s ?? "").split(KEEP).map((part, i) => (i % 2 ? part : fn(part))).join("");

// Obsidian Markdown to Roam: __bold__, *italic* and _italic_, ==highlight==, [[Note|alias]] and - [ ] tasks.
export function mdToRoam(s) {
  return outsideKept(s, (t) => t
    .replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g, (m, page, alias) => `[${alias}]([[${page}]])`)
    .replace(/==([^=\n]+)==/g, "^^$1^^")
    .replace(/(^|[^_\w])__(?!\s)([^_\n]*?[^_\s])__(?![_\w])/g, "$1**$2**")
    .replace(/(^|[^_\w])_(?![_\s])([^_\n]*?[^_\s])_(?![_\w])/g, "$1__$2__")
    .replace(/(^|[^*\w])\*(?![*\s])([^*\n]*?[^*\s])\*(?![*\w])/g, "$1__$2__")
    .replace(/^\[ \]\s+/, "{{[[TODO]]}} ")
    .replace(/^\[[xX]\]\s+/, "{{[[DONE]]}} "));
}

// Roam to Obsidian Markdown: the reverse of mdToRoam, plus what Obsidian has no use for. A block ref is its
// text when `resolve` knows it, a TODO is a task box, and a {{[[pdf]]: url}} is its url.
export function roamToMd(s, resolve = null, depth = 0) {
  const refs = (t) => t.replace(/\(\(([\w-]{1,64})\)\)/g, (m, uid) => {
    let text = null;
    if (typeof resolve === "function" && depth < 2) {
      try { text = resolve(uid); } catch { text = null; }
    }
    return typeof text === "string" ? roamToMd(text.replace(/\s*\n\s*/g, " "), resolve, depth + 1) : m;
  });
  const pdfs = String(s ?? "").replace(/\{\{\s*(?:\[\[pdf\]\]|pdf)\s*:\s*([^}]*?)\s*\}\}/g, "$1");
  return outsideKept(pdfs, (t) => refs(t)
    .replace(/\{\{\s*(?:\[\[)?TODO(?:\]\])?\s*\}\}\s*/g, "[ ] ")
    .replace(/\{\{\s*(?:\[\[)?DONE(?:\]\])?\s*\}\}\s*/g, "[x] ")
    .replace(/\[([^\]\n]+)\]\(\[\[([^\]\n]+)\]\]\)/g, (m, alias, page) => `[[${page}|${alias}]]`)
    .replace(/\^\^([^^\n]+)\^\^/g, "==$1==")
    .replace(/(^|[^_\w])__(?!\s)([^_\n]*?[^_\s])__(?![_\w])/g, "$1*$2*"));
}

// A text node's Markdown: the first line is the card's own string, the rest are child blocks.
// List items nest by indent; other lines are top-level children; a fenced code block stays one block.
// Blank lines outside code are dropped.
export function textToBlocks(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  const head = i < lines.length ? lines[i].trim().replace(/^#{1,6}\s+/, "").replace(/^[-*+]\s+/, "") : "";
  const root = { string: mdToRoam(head), children: [] };
  const stack = [{ indent: -1, node: root }];
  for (i += 1; i < lines.length; i += 1) {
    const raw = lines[i].replace(/\t/g, "  ");
    if (!raw.trim()) continue;
    if (/^\s*```[\w+-]*\s*$/.test(raw)) {
      const fence = [raw.trim()];
      for (i += 1; i < lines.length; i += 1) {
        fence.push(lines[i]);
        if (/^\s*```\s*$/.test(lines[i])) break;
      }
      stack.length = 1;
      root.children.push({ string: fence.join("\n").replace(/\n\s*```\s*$/, "\n```"), children: [] });
      continue;
    }
    const m = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    const indent = m ? m[1].length : 0;
    const string = mdToRoam(m ? m[2].trim() : raw.trim().replace(/^#{1,6}\s+/, ""));
    if (!m) stack.length = 1;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const node = { string, children: [] };
    stack[stack.length - 1].node.children.push(node);
    if (m) stack.push({ indent, node });
  }
  return root;
}

// A card's string and child blocks back to Markdown: the string, then the children as a nested list.
// A fenced code block keeps its lines.
export function blocksToText(string, children, resolve = null) {
  const out = [roamToMd(string, resolve)];
  const walk = (kids, depth) => {
    const sorted = [...(kids ?? [])].sort((a, b) => (a?.[":block/order"] ?? 0) - (b?.[":block/order"] ?? 0));
    for (const c of sorted) {
      const raw = String(c?.[":block/string"] ?? "");
      const pad = "  ".repeat(depth);
      if (raw.trim().startsWith("```")) out.push(raw.trim().split("\n").map((l) => `${pad}${l}`).join("\n"));
      else out.push(`${pad}- ${roamToMd(raw.replace(/\s*\n\s*/g, " "), resolve)}`);
      walk(c?.[":block/children"], depth + 1);
    }
  };
  walk(children, 0);
  return out.join("\n");
}

// Parses .canvas text. Returns { nodes, edges, skipped } or { error }.
export function parseCanvas(text) {
  let data;
  try { data = JSON.parse(String(text ?? "")); } catch { return { error: "This file is not JSON." }; }
  if (!isObj(data)) return { error: "This file is not a JSON Canvas." };
  const rawNodes = data.nodes ?? [];
  const rawEdges = data.edges ?? [];
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) return { error: "This file is not a JSON Canvas." };
  if (rawNodes.length > CANVAS_MAX_NODES) return { error: `This canvas has ${rawNodes.length} nodes; the limit is ${CANVAS_MAX_NODES}.` };
  const nodes = [];
  const ids = new Set();
  let skipped = 0;
  for (const n of rawNodes) {
    const id = isObj(n) && typeof n.id === "string" && n.id ? n.id : null;
    const x = num(n?.x);
    const y = num(n?.y);
    const w = num(n?.width);
    const h = num(n?.height);
    const type = n?.type;
    if (!id || ids.has(id) || x == null || y == null || w == null || h == null || w <= 0 || h <= 0
      || !["text", "file", "link", "group"].includes(type)
      || (type === "link" && !(typeof n.url === "string" && n.url.trim()))
      || (type === "file" && !(typeof n.file === "string" && n.file.trim()))) { skipped += 1; continue; }
    ids.add(id);
    nodes.push({
      id, type, x, y, w, h,
      color: colorIn(n.color),
      text: typeof n.text === "string" ? n.text : "",
      file: typeof n.file === "string" ? n.file : "",
      subpath: typeof n.subpath === "string" ? n.subpath : "",
      url: typeof n.url === "string" ? n.url : "",
      label: typeof n.label === "string" ? n.label : "",
    });
  }
  const edges = [];
  for (const e of rawEdges.slice(0, CANVAS_MAX_EDGES)) {
    if (!isObj(e) || !ids.has(e.fromNode) || !ids.has(e.toNode) || e.fromNode === e.toNode) { skipped += 1; continue; }
    edges.push({
      id: typeof e.id === "string" ? e.id : "",
      from: e.fromNode,
      to: e.toNode,
      fromSide: SIDES.includes(e.fromSide) ? e.fromSide : undefined,
      toSide: SIDES.includes(e.toSide) ? e.toSide : undefined,
      fromEnd: e.fromEnd === "arrow" ? "arrow" : "none",
      toEnd: e.toEnd === "none" ? "none" : "arrow",
      color: colorIn(e.color),
      label: typeof e.label === "string" ? e.label.replace(/\s*\n\s*/g, " ").trim() : "",
    });
  }
  skipped += Math.max(0, rawEdges.length - CANVAS_MAX_EDGES);
  return { nodes, edges, skipped };
}

// The card string a file node becomes. A Markdown note is its page: "Folder/Note.md" is [[Folder/Note]].
function fileString(file, subpath) {
  const path = file.trim();
  if (/\.md$/i.test(path)) return `[[${path.slice(0, -3)}]]`;
  if (/\.canvas$/i.test(path)) return `[[${path}]]`;
  return `${path}${subpath}`;
}

// A node belongs to a group that holds its center. A node that hangs over the group's edge stays in it.
const contains = (outer, inner) => {
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;
  return outer !== inner && cx >= outer.x && cy >= outer.y && cx <= outer.x + outer.w && cy <= outer.y + outer.h;
};

// A Roam-shaped tree for planCopy: the board block, its sections and cards (positions relative to their
// section, membership by the smallest group that holds the node's center), and a Connections block of arrows.
export function canvasToTree(parsed, { title = UNTITLED_BOARD } = {}) {
  const { nodes = [], edges = [] } = parsed ?? {};
  const local = new Map(nodes.map((n, i) => [n.id, `jc${i}`]));
  const groups = nodes.filter((n) => n.type === "group");
  const parentOf = new Map();
  for (const n of nodes) {
    let best = null;
    for (const g of groups) {
      if (!contains(g, n)) continue;
      if (n.type === "group" && g.w * g.h <= n.w * n.h) continue;
      if (!best || g.w * g.h < best.w * best.h) best = g;
    }
    parentOf.set(n.id, best?.id ?? null);
  }
  const block = (n) => {
    if (n.type === "group") return { string: n.label.trim() || "Group", children: [] };
    if (n.type === "link") return { string: n.url.trim(), children: [] };
    if (n.type === "file") return { string: fileString(n.file, n.subpath), children: [] };
    return textToBlocks(n.text);
  };
  const toNode = (uid, b) => ({
    ":block/uid": uid,
    ":block/string": b.string,
    ":block/open": true,
    ":block/children": b.children.map((c, i) => toNode(`${uid}-${i}`, c)),
  });
  const built = new Map();
  for (const n of nodes) {
    const b = block(n);
    const node = toNode(local.get(n.id), b);
    if (n.type !== "group") node[":block/open"] = false;
    built.set(n.id, { node, string: b.string });
  }
  const rootKids = [];
  const counts = { cards: 0, sections: 0, arrows: 0 };
  for (const n of nodes) {
    const parentId = parentOf.get(n.id);
    const p = parentId ? nodes.find((g) => g.id === parentId) : null;
    const { node } = built.get(n.id);
    const plexus = {
      type: n.type === "group" ? "section" : "card",
      x: round1(n.x - (p?.x ?? 0)),
      y: round1(n.y - (p?.y ?? 0)),
      w: round1(n.w),
      h: round1(n.h),
      v: 2,
    };
    if (n.color) plexus.color = n.color;
    node[":block/props"] = { plexus };
    if (n.type === "group") counts.sections += 1;
    else counts.cards += 1;
    if (p) built.get(p.id).node[":block/children"].push(node);
    else rootKids.push(node);
  }
  // An arrow names its ends the way the board reads them back: a page card by its page, others by uid.
  const refOf = (id) => {
    const cls = classifyString(built.get(id).string);
    return cls.kind === "page" && nodes.find((n) => n.id === id)?.type !== "group" ? `[[${cls.title}]]` : `((${local.get(id)}))`;
  };
  const arrows = edges.map((e, i) => {
    const flip = e.fromEnd === "arrow" && e.toEnd === "none";
    const from = flip ? e.to : e.from;
    const to = flip ? e.from : e.to;
    const fromSide = flip ? e.toSide : e.fromSide;
    const toSide = flip ? e.fromSide : e.toSide;
    const dir = e.fromEnd === "arrow" && e.toEnd === "arrow" ? "two" : e.fromEnd === "none" && e.toEnd === "none" ? "none" : "one";
    const plexus = { type: "edge", from: local.get(from), to: local.get(to) };
    if (dir !== "one") plexus.dir = dir;
    if (fromSide) plexus.fromSide = fromSide;
    if (toSide) plexus.toSide = toSide;
    if (e.color) plexus.color = e.color;
    counts.arrows += 1;
    return {
      ":block/uid": `jce${i}`,
      ":block/string": edgeString({ srcRef: refOf(from), dstRef: refOf(to), dir, label: e.label }),
      ":block/props": { plexus },
      ":block/children": [],
      ":block/open": true,
    };
  });
  if (arrows.length) {
    rootKids.push({
      ":block/uid": "jcedges",
      ":block/string": "Connections",
      ":block/props": { plexus: { type: "edges" } },
      ":block/children": arrows,
      ":block/open": false,
    });
  }
  return {
    tree: {
      ":block/uid": "jcroot",
      ":block/string": boardString(title),
      ":block/props": { plexus: { v: 2 } },
      ":block/children": rootKids,
      ":block/open": false,
    },
    counts,
  };
}

// File name to board title: "Project map.canvas" is "Project map".
export function canvasTitle(fileName) {
  const base = String(fileName ?? "").split(/[\\/]/).pop().replace(/\.canvas$/i, "").replace(/\.json$/i, "").trim();
  return base || UNTITLED_BOARD;
}

export function canvasFileName(title) {
  const name = String(title || UNTITLED_BOARD).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "board";
  return `${name}.canvas`;
}

// The node one board item becomes, or null for an item a canvas has no use for.
function nodeOf(item, r, resolve) {
  const base = { id: item.uid, x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.w)), height: Math.max(1, Math.round(r.h)) };
  const color = colorOut(item.color);
  if (color) base.color = color;
  if (item.type === "section") return { ...base, type: "group", label: roamToMd(String(item.string || item.title || "").trim(), resolve) };
  const string = String(item.string ?? "").trim();
  const cls = classifyString(string);
  if (item.type === "card" && cls.kind === "page" && !item.content?.length) {
    return { ...base, type: "file", file: /\.canvas$/i.test(cls.title) ? cls.title : `${cls.title}.md` };
  }
  if (URL_RE.test(string) && !item.content?.length) return { ...base, type: "link", url: string };
  const pdf = /^\{\{\s*(?:\[\[pdf\]\]|pdf)\s*:\s*(https?:\/\/[^\s}]+)\s*\}\}$/.exec(string);
  if (pdf && !item.content?.length) return { ...base, type: "link", url: pdf[1] };
  let text;
  if (item.kind === "board") text = item.title || "Board";
  else if (item.tableUid) text = blocksToText(string, [{ ":block/string": "{{[[table]]}}", ":block/children": item.content }], resolve);
  // A card that is one block ref (a ref, highlight, region or PDF card) shows its target: write what it shows.
  else if (cls.kind === "block") text = blocksToText(item.title || string, item.content, resolve);
  else text = blocksToText(string, item.type === "card" ? item.content : [], resolve);
  return { ...base, type: "text", text };
}

// The board as a JSON Canvas object: groups first (outer before inner) so they draw behind, then the
// rest in board order; arrows whose ends both made it. `rects` are world rects (worldRects or the view's).
// `resolve(uid)` gives a block's string so block refs inside text go out as their text.
// `leftOut` counts arrows a canvas can't hold (an arrow to an arrow).
export function exportCanvas(board, rects, { resolve = null } = {}) {
  const groups = [];
  const rest = [];
  const kept = new Set();
  for (const uid of board?.order ?? []) {
    const item = board.items.get(uid);
    const r = rects?.get(uid);
    if (!item || !r) continue;
    const node = nodeOf(item, r, resolve);
    if (!node) continue;
    kept.add(uid);
    (node.type === "group" ? groups : rest).push({ node, depth: item.depth ?? 0 });
  }
  groups.sort((a, b) => a.depth - b.depth);
  const nodes = [...groups, ...rest].map((e) => e.node);
  const edges = [];
  let leftOut = 0;
  for (const [uid, e] of board?.edges ?? []) {
    if (!e?.valid) continue;
    if (!kept.has(e.from) || !kept.has(e.to)) {
      if (board.edges.has(e.from) || board.edges.has(e.to)) leftOut += 1;
      continue;
    }
    const out = { id: uid, fromNode: e.from, toNode: e.to };
    if (SIDES.includes(e.fromSide)) out.fromSide = e.fromSide;
    if (SIDES.includes(e.toSide)) out.toSide = e.toSide;
    if (e.dir === "two") out.fromEnd = "arrow";
    if (e.dir === "none") out.toEnd = "none";
    const color = colorOut(e.color);
    if (color) out.color = color;
    if (e.label) out.label = e.label;
    edges.push(out);
  }
  return { canvas: { nodes, edges }, leftOut };
}

export function boardToCanvas(board, rects, opts) {
  return exportCanvas(board, rects, opts).canvas;
}

export function boardToCanvasText(board, rects, opts) {
  return `${JSON.stringify(boardToCanvas(board, rects, opts), null, "\t")}\n`;
}

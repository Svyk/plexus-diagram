// Pure exporters: a standalone SVG picture of a board and a Markdown outline. No DOM, no external refs.
import { arrowHeadPath, arrowSize, edgePath } from "./geometry.js";
import { boundsOf } from "./board.js";
import { PALETTE, UNTITLED_BOARD } from "./schema.js";
import { SHAPES, shapePath } from "./shapes.js";

const HEX = {
  light: {
    gray: ["#6b7280", "#f3f4f6", "#374151"], red: ["#dc2626", "#fef2f2", "#991b1b"],
    orange: ["#ea580c", "#fff7ed", "#9a3412"], yellow: ["#ca8a04", "#fefce8", "#854d0e"],
    green: ["#16a34a", "#f0fdf4", "#166534"], teal: ["#0d9488", "#f0fdfa", "#115e59"],
    blue: ["#2563eb", "#eff6ff", "#1e40af"], indigo: ["#4f46e5", "#eef2ff", "#3730a3"],
    purple: ["#9333ea", "#faf5ff", "#6b21a8"], pink: ["#db2777", "#fdf2f8", "#9d174d"],
  },
  dark: {
    gray: ["#9ca3af", "#2b3540", "#d1d5db"], red: ["#f87171", "#3a2a30", "#fca5a5"],
    orange: ["#fb923c", "#3a3028", "#fdba74"], yellow: ["#facc15", "#38351f", "#fde047"],
    green: ["#4ade80", "#22392e", "#86efac"], teal: ["#2dd4bf", "#1f3a3a", "#5eead4"],
    blue: ["#60a5fa", "#232f45", "#93c5fd"], indigo: ["#818cf8", "#2a2f4a", "#a5b4fc"],
    purple: ["#c084fc", "#35284a", "#d8b4fe"], pink: ["#f472b6", "#3f2838", "#f9a8d4"],
  },
};
const THEME = {
  light: { bg: "#ffffff", card: "#ffffff", border: "#d0d7de", text: "#1f2937", muted: "#5f6b7c", edge: "#6b7a8a" },
  dark: { bg: "#1e2a35", card: "#26333f", border: "#3b4b58", text: "#e6edf3", muted: "#a7b6c2", edge: "#a7b6c2" },
};

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const n1 = (n) => Math.round(n * 10) / 10;
const titleOf = (item) => {
  if (item.title) return item.title;
  if (item.kind === "image") return "Image";
  return item.string || "Untitled";
};

// First markdown image in a block string. Empty when the block is not an image.
export function imageSrc(string) {
  const m = /!\[[^\]]*\]\(([^)]*)\)/.exec(String(string ?? "").trim());
  return m ? m[1].trim() : "";
}

// Download name. A real board title wins. An empty or "Untitled board" title uses the page title.
export function pngFileName({ boardTitle = "", pageTitle = "", date = "" } = {}) {
  const board = String(boardTitle ?? "").trim();
  const page = String(pageTitle ?? "").trim();
  const named = board && board.toLowerCase() !== UNTITLED_BOARD.toLowerCase();
  const raw = (named ? board : page) || board || "board";
  const name = raw.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "board";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : "1970-01-01";
  return `${name} ${day}.png`;
}

// Items in `uids`, plus edges whose both ends are in that set. Rects stay the caller's map.
export function sliceBoard(board, uids) {
  const want = new Set(uids || []);
  const items = new Map();
  const order = [];
  for (const uid of board?.order || []) {
    if (!want.has(uid)) continue;
    const item = board.items.get(uid);
    if (!item) continue;
    items.set(uid, item);
    order.push(uid);
  }
  const edges = new Map();
  for (const [uid, edge] of board?.edges || []) {
    if (edge?.valid && want.has(edge.from) && want.has(edge.to)) edges.set(uid, edge);
  }
  return { ...board, items, order, edges };
}

// A canvas taints on any non-data image. Drop those tags; data URLs stay.
export function dropExternalImages(svg) {
  return String(svg ?? "").replace(/<image\b[^>]*\/>/g, (tag) => {
    const href = /\shref="([^"]*)"/.exec(tag);
    if (!href) return tag;
    const value = href[1].replace(/&amp;/g, "&");
    return value.startsWith("data:") ? tag : "";
  });
}

const imageHrefOf = (item, imageHrefs) => {
  if (!imageHrefs || item.kind !== "image") return "";
  const href = typeof imageHrefs.get === "function" ? imageHrefs.get(item.uid) : imageHrefs[item.uid];
  return typeof href === "string" && href.startsWith("data:") ? href : "";
};

export function boardToSvg(board, rects, { dark = false, padding = 48, maxItems = 500, imageHrefs = null } = {}) {
  const mode = dark ? "dark" : "light";
  const theme = THEME[mode];
  const hex = (color) => (typeof color === "string" && /^#[0-9a-f]{6}$/.test(color) ? [color, color, color] : HEX[mode][PALETTE.includes(color) ? color : "gray"]);
  const included = [];
  for (const uid of board.order) {
    if (included.length >= maxItems) break;
    if (rects.get(uid)) included.push(board.items.get(uid));
  }
  const inSet = new Set(included.map((i) => i.uid));
  const drawnEdges = [];
  for (const edge of board.edges.values()) {
    if (!edge.valid || !inSet.has(edge.from) || !inSet.has(edge.to)) continue;
    const a = rects.get(edge.from);
    const b = rects.get(edge.to);
    if (!a || !b) continue;
    drawnEdges.push({ edge, path: edgePath({ a, b, fromSide: edge.fromSide, toSide: edge.toSide, route: edge.route }) });
  }
  const rawBounds = boundsOf(included.map((i) => rects.get(i.uid))) ?? { x: 0, y: 0, w: 0, h: 0 };
  const bounds = { x: rawBounds.x, y: rawBounds.y, w: rawBounds.w, h: rawBounds.h };
  let minX = bounds.x;
  let minY = bounds.y;
  let maxX = bounds.x + bounds.w;
  let maxY = bounds.y + bounds.h;
  for (const { path } of drawnEdges) {
    for (const p of path.points || [path.start, path.end, path.mid]) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  bounds.x = minX;
  bounds.y = minY;
  bounds.w = Math.max(0, maxX - minX);
  bounds.h = Math.max(0, maxY - minY);
  const vx = bounds.x - padding;
  const vy = bounds.y - padding;
  const vw = Math.max(1, bounds.w + padding * 2);
  const vh = Math.max(1, bounds.h + padding * 2);
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n1(vx)} ${n1(vy)} ${n1(vw)} ${n1(vh)}" width="${n1(vw)}" height="${n1(vh)}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`);
  out.push(`<title>${esc(board.title || "Board")}</title>`);
  out.push(`<rect x="${n1(vx)}" y="${n1(vy)}" width="${n1(vw)}" height="${n1(vh)}" fill="${theme.bg}"/>`);

  const defs = [];
  const body = [];
  included.forEach((item, index) => {
    const r = rects.get(item.uid);
    const [line, fill, text] = hex(item.color);
    if (item.type === "section") {
      body.push(`<rect x="${n1(r.x)}" y="${n1(r.y)}" width="${n1(r.w)}" height="${n1(r.h)}" rx="12" fill="${fill}" fill-opacity="${dark ? 0.6 : 1}" stroke="${line}" stroke-width="2"/>`);
      body.push(`<text x="${n1(r.x + 4)}" y="${n1(r.y - 10)}" font-size="16" font-weight="700" fill="${text}">${esc(titleOf(item))}</text>`);
    } else if (item.type === "text") {
      const size = item.fontSize || 16;
      if (SHAPES.includes(item.shape)) {
        const paint = item.fill ? hex(item.fill)[1] : theme.card;
        const stroke = item.border ? hex(item.border)[0] : (item.color ? line : theme.border);
        const ink = item.textColor ? hex(item.textColor)[2] : theme.text;
        body.push(`<path d="${shapePath(r, item.shape)}" fill="${paint}" stroke="${stroke}" stroke-width="2"/>`);
        body.push(`<text x="${n1(r.x + r.w / 2)}" y="${n1(r.y + r.h / 2)}" font-size="${size}" text-anchor="middle" dominant-baseline="central" fill="${ink}">${esc(titleOf(item))}</text>`);
      } else if (item.look === "sticky") {
        const paper = item.fill ? hex(item.fill)[1] : (item.color ? fill : hex("yellow")[1]);
        const ink = item.textColor ? hex(item.textColor)[2] : (item.color ? text : hex("yellow")[2]);
        if (!defs.some((d) => d.includes("pxd-sticky-shadow"))) {
          defs.push(`<filter id="pxd-sticky-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-color="#1c1917" flood-opacity="0.22"/></filter>`);
        }
        body.push(`<rect x="${n1(r.x)}" y="${n1(r.y)}" width="${n1(r.w)}" height="${n1(r.h)}" rx="2" fill="${paper}" filter="url(#pxd-sticky-shadow)"/>`);
        body.push(`<text x="${n1(r.x + 12)}" y="${n1(r.y + size + 8)}" font-size="${size}" fill="${ink}">${esc(titleOf(item))}</text>`);
      } else {
        body.push(`<text x="${n1(r.x)}" y="${n1(r.y + size)}" font-size="${size}" fill="${theme.text}">${esc(titleOf(item))}</text>`);
      }
    } else {
      const clip = `pxd-clip-${index}`;
      defs.push(`<clipPath id="${clip}"><rect x="${n1(r.x + 10)}" y="${n1(r.y)}" width="${n1(Math.max(1, r.w - 20))}" height="${n1(r.h)}"/></clipPath>`);
      body.push(`<rect x="${n1(r.x)}" y="${n1(r.y)}" width="${n1(r.w)}" height="${n1(r.h)}" rx="8" fill="${theme.card}" stroke="${item.color ? line : theme.border}" stroke-width="${item.color ? 2 : 1}"/>`);
      const picture = imageHrefOf(item, imageHrefs);
      if (picture) {
        const ix = r.x + 8;
        const iy = r.y + 8;
        body.push(`<image href="${esc(picture)}" x="${n1(ix)}" y="${n1(iy)}" width="${n1(Math.max(1, r.w - 16))}" height="${n1(Math.max(1, r.h - 16))}" preserveAspectRatio="xMidYMid meet"/>`);
      } else {
        body.push(`<text x="${n1(r.x + 12)}" y="${n1(r.y + 26)}" font-size="14" font-weight="600" fill="${theme.text}" clip-path="url(#${clip})">${esc(titleOf(item))}</text>`);
      }
    }
  });
  if (defs.length) out.push(`<defs>${defs.join("")}</defs>`);
  out.push(...body);

  for (const { edge, path } of drawnEdges) {
    const stroke = edge.color ? hex(edge.color)[0] : theme.edge;
    const dash = edge.dash === "dashed" || edge.dash === "animated" ? ' stroke-dasharray="6 4"' : "";
    out.push(`<path d="${path.d}" fill="none" stroke="${stroke}" stroke-width="${edge.weight}"${dash}/>`);
    const size = arrowSize(1, edge.weight);
    if (edge.dir === "one" || edge.dir === "two") {
      out.push(`<path d="${arrowHeadPath(path.end, path.endAngle, size)}" fill="${stroke}" stroke="${stroke}" stroke-linejoin="round"/>`);
    }
    if (edge.dir === "two") {
      out.push(`<path d="${arrowHeadPath(path.start, path.startAngle + Math.PI, size)}" fill="${stroke}" stroke="${stroke}" stroke-linejoin="round"/>`);
    }
    if (edge.label) {
      const width = edge.label.length * 6.6 + 12;
      out.push(`<rect x="${n1(path.mid.x - width / 2)}" y="${n1(path.mid.y - 10)}" width="${n1(width)}" height="20" rx="4" fill="${theme.bg}" stroke="${stroke}" stroke-width="1"/>`);
      out.push(`<text x="${n1(path.mid.x)}" y="${n1(path.mid.y + 4)}" font-size="12" text-anchor="middle" fill="${theme.muted}">${esc(edge.label)}</text>`);
    }
  }
  out.push("</svg>");
  return out.join("\n");
}

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export function boardToMarkdown(board, rects) {
  const lines = [];
  const readingOrder = (uids) => uids
    .map((uid, i) => ({ uid, i, r: rects.get(uid) }))
    .sort((a, b) => (a.r?.y ?? 0) - (b.r?.y ?? 0) || (a.r?.x ?? 0) - (b.r?.x ?? 0) || a.i - b.i)
    .map((e) => e.uid);
  const content = (children, depth) => {
    for (const c of children ?? []) {
      const s = oneLine(c[":block/string"]);
      if (s) lines.push(`${"  ".repeat(depth)}- ${s}`);
      content(c[":block/children"], depth + 1);
    }
  };
  const walk = (uids) => {
    for (const uid of readingOrder(uids)) {
      const item = board.items.get(uid);
      if (!item) continue;
      if (item.type === "section") {
        if (lines.length) lines.push("");
        lines.push(`${"#".repeat(Math.min(6, item.depth + 1))} ${oneLine(titleOf(item))}`);
        walk(item.members);
      } else {
        lines.push(`- ${oneLine(titleOf(item))}`);
        const kids = [...(item.content ?? [])].sort((a, b) => (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0));
        content(kids, 1);
      }
    }
  };
  walk(board.roots);
  const edges = [...board.edges.values()].filter((e) => e.valid);
  if (edges.length) {
    if (lines.length) lines.push("");
    lines.push("## Connections");
    for (const e of edges) {
      const a = oneLine(titleOf(board.items.get(e.from)));
      const b = oneLine(titleOf(board.items.get(e.to)));
      lines.push(e.label ? `${a} -> ${e.label} -> ${b}` : `${a} -> ${b}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

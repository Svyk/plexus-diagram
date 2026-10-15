// INSTANT-1. Board open snapshot: a compact, inert copy of the last settled paint.
// Pure data. A face is a sanitized DOM tree (whitelisted tags, classes, data-*,
// a few style properties). Images that are data: URLs move to a thumb table so
// the snapshot JSON stays small. Nothing here reads layout or calls Roam.

export const SNAP_VERSION = 1;
export const SNAP_MAX_BYTES = 300 * 1024;
// Items with a face. A bigger board (PhD main board: 1,558 items) keeps faces for the SNAP_MAX_ITEMS items nearest
// the camera and a bare box for the rest, up to SNAP_MAX_BOXES; each box adds BOX_BYTES to the byte cap.
export const SNAP_MAX_ITEMS = 500;
export const SNAP_MAX_BOXES = 4000;
export const BOX_BYTES = 256;
export const snapByteCap = (items) => SNAP_MAX_BYTES + BOX_BYTES * Math.max(0, (Number(items) || 0) - SNAP_MAX_ITEMS);
export const FACE_MAX_NODES = 400;
export const FACE_MAX_CHARS = 16 * 1024;
export const LAYER_MAX_NODES = 1500;
const TEXT_MAX = 2000;
const CLASS_MAX = 8;
const DEPTH_MAX = 16;
const THUMB_DATA_MAX = 160 * 1024;

const TAGS = new Set([
  "div", "span", "p", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "del", "ins", "code", "pre",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "colgroup", "col", "br", "hr", "img", "label", "sup", "sub", "mark", "small", "button",
  "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "text", "tspan", "defs", "marker",
]);
const SVG_TAGS = new Set(["svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "text", "tspan", "defs", "marker"]);
// Read as span so a stored face never navigates.
const RENAME = { a: "span" };
const SKIP = new Set(["script", "style", "iframe", "object", "embed", "textarea", "input", "select", "video", "audio", "canvas", "noscript", "template", "link", "meta", "foreignobject"]);
const SVG_ATTRS = new Set([
  "viewBox", "d", "fill", "stroke", "stroke-width", "stroke-linejoin", "stroke-linecap", "stroke-dasharray", "opacity",
  "fill-opacity", "stroke-opacity", "width", "height", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2",
  "points", "transform", "marker-end", "marker-start", "markerWidth", "markerHeight", "refX", "refY", "orient",
  "text-anchor", "dominant-baseline", "font-size", "id", "preserveAspectRatio",
]);
const STYLE_PROPS = [
  "width", "height", "max-width", "min-height", "transform", "background", "background-color", "color",
  "border-color", "background-size", "background-position", "display", "left", "top",
];
const CLASS_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATA_RE = /^data-[a-z0-9-]{1,32}$/;
const UNSAFE_VALUE = /(javascript:|expression\(|url\(|@import|<)/i;

// Shell classes that describe a moment, not the board.
const TRANSIENT = new Set([
  "pxd-item--selected", "pxd-section--selected", "pxd-item--drop", "pxd-item--editing", "pxd-item--typing",
  "pxd-item--pulse", "pxd-item--flash", "pxd-item--hit", "pxd-item--dim", "pxd-item--offscreen", "pxd-item--into",
  "pxd-item--future", "pxd-item--fresh", "pxd-pdf-live", "pxd-item--lift", "pxd-item--snap",
]);
const ROOT_TRANSIENT = new Set(["pxd-root--gesturing", "pxd-root--editing", "pxd-root--searching", "pxd-root--focus", "pxd-root--present"]);

export function fnv(text) {
  let h = 0x811c9dc5;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const strOf = (node) => String(node?.[":block/string"] ?? node?.string ?? "");
const kidsOf = (node) => {
  const kids = node?.[":block/children"] ?? node?.children;
  if (!Array.isArray(kids)) return [];
  return kids
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c?.[":block/order"] ?? a.i) - (b.c?.[":block/order"] ?? b.i) || a.i - b.i)
    .map(({ c }) => c);
};

function contentText(nodes, depth = 0, out = []) {
  if (!Array.isArray(nodes) || depth > 4 || out.length > 400) return out;
  for (const node of nodes) {
    out.push(`${depth}:${strOf(node)}`);
    contentText(kidsOf(node), depth + 1, out);
  }
  return out;
}

// Everything a card face is drawn from that the board model knows. A face
// whose sig no longer matches is not shown.
export function itemSig(item) {
  if (!item) return "";
  return fnv(JSON.stringify([
    item.type, item.kind, item.string ?? "", item.title ?? "", Boolean(item.collapsed), item.color ?? "",
    item.fill ?? "", item.target?.uid ?? "", item.target?.title ?? "", contentText(item.content),
  ]));
}

// Version stamp of the whole board: layout plus every item sig plus edges.
export function boardStamp(board, rects = null) {
  if (!board?.items) return "";
  const parts = [];
  for (const uid of board.order || board.items.keys()) {
    const item = board.items.get(uid);
    if (!item) continue;
    const r = rects?.get?.(uid) || item;
    parts.push(`${uid}|${r.x},${r.y},${r.w},${r.h}|${item.parentUid ?? ""}|${itemSig(item)}`);
  }
  for (const edge of board.edges?.values?.() || []) parts.push(`e:${edge.uid}|${edge.from}|${edge.to}|${edge.label ?? ""}`);
  return fnv(parts.join("\n"));
}

// Cells of a Roam {{[[table]]}} card: each row is a chain of first children.
export function tableGrid(item, { rows: maxRows = 30, cols: maxCols = 10 } = {}) {
  const rows = [];
  for (const row of kidsOf({ ":block/children": item?.content })) {
    if (rows.length >= maxRows) break;
    const cells = [];
    let cell = row;
    while (cell && cells.length < maxCols) {
      cells.push(plainCell(strOf(cell)));
      cell = kidsOf(cell)[0];
    }
    rows.push(cells);
  }
  return rows;
}

function plainCell(text) {
  return String(text || "")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\(\(([^)]*)\)\)/g, "…")
    .replace(/\*\*|__|\^\^|~~/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function cleanClasses(value, drop = TRANSIENT) {
  const out = [];
  for (const name of String(value || "").split(/\s+/)) {
    if (!name || !CLASS_RE.test(name) || drop.has(name)) continue;
    out.push(name);
  }
  return out;
}

function classOf(el) {
  const raw = typeof el.getAttribute === "function" ? el.getAttribute("class") : el.className;
  return typeof raw === "string" ? raw : (raw?.baseVal ?? "");
}

function readStyle(el, thumbs) {
  const style = el.style;
  if (!style) return null;
  const out = {};
  let n = 0;
  const get = (name) => (typeof style.getPropertyValue === "function" ? style.getPropertyValue(name) : style[name]) || "";
  for (const name of STYLE_PROPS) {
    const value = String(get(name) || "").trim();
    if (!value || value.length > 120 || UNSAFE_VALUE.test(value)) continue;
    out[name] = value;
    n += 1;
  }
  // PDF covers paint from --pxd-cover: url(data:...). Keep the image as a thumb ref.
  const cover = String(get("--pxd-cover") || "");
  const m = /url\(\s*["']?(data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+)["']?\s*\)/.exec(cover);
  if (m && thumbs && m[1].length <= THUMB_DATA_MAX) {
    const key = `d:${fnv(m[1])}:${m[1].length}`;
    thumbs.set(key, m[1]);
    out["--pxd-cover"] = `@${key}`;
    n += 1;
  }
  return n ? out : null;
}

function imageSrc(src, thumbs) {
  const value = String(src || "");
  if (/^https:\/\//i.test(value) && value.length <= 2000 && !/["'<>\s]/.test(value)) return value;
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= THUMB_DATA_MAX && thumbs) {
    const key = `d:${fnv(value)}:${value.length}`;
    thumbs.set(key, value);
    return `@${key}`;
  }
  return "";
}

// Read a live subtree into a face. Reads only attributes, classes, inline style
// and text: no layout. `skip(el)` drops a child subtree (ports, grips).
// `canvases` turns a small <canvas> (the minimap) into an <img> of its pixels.
export function captureFace(el, { thumbs = null, skip = null, maxNodes = FACE_MAX_NODES, maxChars = FACE_MAX_CHARS, canvases = false } = {}) {
  const budget = { nodes: 0, chars: 0, maxNodes, maxChars, canvases };
  return walk(el, budget, thumbs, skip, 0, false);
}

function canvasFace(el, thumbs) {
  if (!thumbs || typeof el.toDataURL !== "function") return null;
  const w = Number(el.width) || 0;
  const h = Number(el.height) || 0;
  if (!w || !h || w * h > 400 * 400) return null;
  let url = "";
  try { url = el.toDataURL("image/png"); } catch { return null; }
  const src = imageSrc(url, thumbs);
  if (!src) return null;
  const node = { t: "img", s: src, a: { width: String(w), height: String(h) } };
  const cls = cleanClasses(classOf(el)).slice(0, CLASS_MAX);
  if (cls.length) node.c = cls.join(" ");
  return node;
}

function walk(el, budget, thumbs, skip, depth, inSvg) {
  if (!el || budget.nodes >= budget.maxNodes || budget.chars >= budget.maxChars) return null;
  if (el.nodeType === 3) {
    const text = String(el.nodeValue ?? el.textContent ?? "");
    if (!text) return null;
    const cut = text.slice(0, Math.min(TEXT_MAX, budget.maxChars - budget.chars));
    budget.chars += cut.length;
    return cut;
  }
  if (el.nodeType !== 1) return null;
  const raw = String(el.localName || el.tagName || "").toLowerCase();
  if (raw === "canvas" && budget.canvases) {
    budget.nodes += 1;
    return canvasFace(el, thumbs);
  }
  if (!raw || SKIP.has(raw)) return null;
  const tag = RENAME[raw] || raw;
  if (!TAGS.has(tag)) return null;
  if (skip && skip(el)) return null;
  if (depth > DEPTH_MAX) return null;
  budget.nodes += 1;
  const svg = inSvg || tag === "svg";
  const node = { t: tag };
  const cls = cleanClasses(classOf(el)).slice(0, CLASS_MAX);
  if (cls.length) node.c = cls.join(" ");
  const attrs = {};
  let hasAttr = false;
  for (const attr of [...(el.attributes || [])]) {
    const name = attr.name;
    const value = String(attr.value ?? "");
    if (!name || name === "class" || name === "style" || /^on/i.test(name)) continue;
    if (value.length > 400 || UNSAFE_VALUE.test(value)) continue;
    if (DATA_RE.test(name) || name === "aria-hidden" || name === "hidden" || (svg && SVG_ATTRS.has(name)) || (tag === "img" && (name === "width" || name === "height" || name === "alt"))) {
      attrs[name] = value.slice(0, 200);
      hasAttr = true;
    }
  }
  if (tag === "img") {
    const src = imageSrc(el.getAttribute?.("src") ?? el.src, thumbs);
    if (!src) { budget.nodes -= 1; return null; }
    node.s = src;
  }
  if (hasAttr) node.a = attrs;
  const style = readStyle(el, thumbs);
  if (style) node.y = style;
  const kids = [];
  const childNodes = [...(el.childNodes || el.children || [])];
  for (const child of childNodes) {
    const face = walk(child, budget, thumbs, skip, depth + 1, svg);
    if (face != null) kids.push(face);
  }
  // A DOM without text nodes (test stubs) keeps the text on the element itself.
  if (!childNodes.length && typeof el.textContent === "string" && el.textContent) {
    const cut = el.textContent.slice(0, Math.min(TEXT_MAX, budget.maxChars - budget.chars));
    budget.chars += cut.length;
    if (cut) kids.push(cut);
  }
  if (kids.length) node.k = kids;
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Build DOM from a face. Every value went through the whitelist on capture and
// goes through it again here: a stored snapshot is never trusted.
export function buildFace(doc, face, { thumbs = null, inSvg = false } = {}) {
  if (face == null) return null;
  if (typeof face === "string") return typeof doc.createTextNode === "function" ? doc.createTextNode(face.slice(0, TEXT_MAX)) : null;
  if (typeof face !== "object") return null;
  const tag = String(face.t || "");
  if (!TAGS.has(tag)) return null;
  const svg = inSvg || tag === "svg";
  let el;
  try {
    el = svg && SVG_TAGS.has(tag) && typeof doc.createElementNS === "function" ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag);
  } catch { return null; }
  const cls = cleanClasses(face.c).slice(0, CLASS_MAX);
  if (cls.length) el.setAttribute("class", cls.join(" "));
  if (face.a && typeof face.a === "object") {
    for (const [name, raw] of Object.entries(face.a)) {
      const value = String(raw ?? "");
      if (/^on/i.test(name) || value.length > 400 || UNSAFE_VALUE.test(value)) continue;
      if (DATA_RE.test(name) || name === "aria-hidden" || name === "hidden" || (svg && SVG_ATTRS.has(name)) || (tag === "img" && (name === "width" || name === "height" || name === "alt"))) {
        try { el.setAttribute(name, value); } catch { /* bad name */ }
      }
    }
  }
  if (tag === "img") {
    const src = resolveSrc(face.s, thumbs);
    if (!src) return null;
    el.setAttribute("src", src);
    el.setAttribute("draggable", "false");
    el.setAttribute("alt", el.getAttribute?.("alt") || "");
  }
  if (tag === "button") {
    el.setAttribute("type", "button");
    el.setAttribute("tabindex", "-1");
  }
  if (face.y && typeof face.y === "object" && el.style) {
    for (const [name, raw] of Object.entries(face.y)) {
      const value = String(raw ?? "");
      if (name === "--pxd-cover") {
        const data = resolveSrc(value, thumbs);
        if (data.startsWith("data:image/")) setStyle(el, name, `url("${data}")`);
        continue;
      }
      if (!STYLE_PROPS.includes(name) || value.length > 120 || UNSAFE_VALUE.test(value)) continue;
      setStyle(el, name, value);
    }
  }
  for (const kid of Array.isArray(face.k) ? face.k : []) {
    const node = buildFace(doc, kid, { thumbs, inSvg: svg });
    if (node) el.append(node);
  }
  return el;
}

function setStyle(el, name, value) {
  try {
    if (typeof el.style.setProperty === "function") el.style.setProperty(name, value);
    else el.style[name] = value;
  } catch { /* the engine refused the value */ }
}

function resolveSrc(value, thumbs) {
  const s = String(value || "");
  if (s.startsWith("@")) {
    const data = thumbs?.get?.(s.slice(1));
    return typeof data === "string" && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(data) ? data : "";
  }
  return /^https:\/\//i.test(s) && !/["'<>\s]/.test(s) ? s : "";
}

// Thumb keys a face refers to, so the store can load them with the snapshot.
export function faceThumbKeys(face, out = new Set()) {
  if (!face || typeof face !== "object") return out;
  if (typeof face.s === "string" && face.s.startsWith("@")) out.add(face.s.slice(1));
  const cover = face.y?.["--pxd-cover"];
  if (typeof cover === "string" && cover.startsWith("@")) out.add(cover.slice(1));
  for (const kid of Array.isArray(face.k) ? face.k : []) faceThumbKeys(kid, out);
  return out;
}

export function snapThumbKeys(snap) {
  const out = new Set();
  for (const item of snap?.items || []) {
    faceThumbKeys(item.face, out);
    if (item.thumb) out.add(item.thumb);
  }
  for (const layer of [snap?.edges, snap?.labels, ...(snap?.chrome || [])]) faceThumbKeys(layer, out);
  return out;
}

const finite = (n) => typeof n === "number" && Number.isFinite(n);

export function isSnapViewport(vp) {
  return Boolean(vp) && finite(vp.x) && finite(vp.y) && finite(vp.zoom) && vp.zoom > 0;
}

function cleanItem(item) {
  if (!item || typeof item.uid !== "string" || !item.uid || item.uid.length > 64) return null;
  if (!finite(item.x) || !finite(item.y) || !finite(item.w) || !finite(item.h)) return null;
  const out = {
    uid: item.uid,
    section: item.section === true,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    cls: cleanClasses(item.cls).join(" "),
    sig: typeof item.sig === "string" ? item.sig.slice(0, 16) : "",
  };
  if (typeof item.parent === "string" && item.parent.length <= 64) out.parent = item.parent;
  if (typeof item.thumb === "string" && item.thumb.length <= 200) out.thumb = item.thumb;
  if (item.face && typeof item.face === "object") out.face = item.face;
  if (item.badges && typeof item.badges === "object") out.badges = cleanBadges(item.badges);
  return out;
}

function cleanBadges(b) {
  const out = {};
  for (const key of ["refs", "boards", "open", "done"]) if (finite(b[key])) out[key] = b[key];
  return out;
}

function cleanRootStyle(style) {
  const out = {};
  for (const [name, raw] of Object.entries(style || {})) {
    const value = String(raw ?? "");
    if (!/^--pxd-[a-z0-9-]{1,40}$/.test(name) || value.length > 120 || UNSAFE_VALUE.test(value)) continue;
    out[name] = value;
  }
  return out;
}

export function cleanSnapshot(value) {
  if (!value || typeof value !== "object" || value.v !== SNAP_VERSION || !Array.isArray(value.items)) return null;
  if (value.items.length > SNAP_MAX_BOXES) return null;
  const items = [];
  for (const item of value.items) {
    const clean = cleanItem(item);
    if (clean) items.push(clean);
  }
  const height = finite(value.height) && value.height >= 40 && value.height <= 4000 ? value.height : 0;
  return {
    v: SNAP_VERSION,
    uid: typeof value.uid === "string" ? value.uid : "",
    stamp: typeof value.stamp === "string" ? value.stamp.slice(0, 16) : "",
    savedAt: finite(value.savedAt) ? value.savedAt : 0,
    height,
    width: finite(value.width) && value.width > 0 ? value.width : 0,
    vp: isSnapViewport(value.vp) ? { x: value.vp.x, y: value.vp.y, zoom: value.vp.zoom } : null,
    rootCls: cleanClasses(value.rootCls, ROOT_TRANSIENT).join(" "),
    rootStyle: cleanRootStyle(value.rootStyle),
    grid: value.grid && typeof value.grid === "object" ? value.grid : null,
    edges: value.edges && typeof value.edges === "object" ? value.edges : null,
    labels: value.labels && typeof value.labels === "object" ? value.labels : null,
    chrome: Array.isArray(value.chrome) ? value.chrome.filter((face) => face && typeof face === "object").slice(0, 16) : [],
    threshold: finite(value.threshold) && value.threshold > 0 && value.threshold < 4 ? value.threshold : 0.45,
    items,
  };
}

// JSON under the byte cap: drop the edge/label layers, then faces from the
// tail, then give up. A board over SNAP_MAX_BOXES is not cached at all.
export function packSnapshot(snap) {
  const clean = cleanSnapshot(snap);
  if (!clean) return null;
  const cap = snapByteCap(clean.items.length);
  const fit = (value) => {
    const text = JSON.stringify(value);
    return text.length <= cap ? text : null;
  };
  let text = fit(clean);
  if (text) return text;
  const lean = { ...clean, labels: null, chrome: [] };
  text = fit(lean);
  if (text) return text;
  lean.edges = null;
  text = fit(lean);
  if (text) return text;
  // Faces from the tail, by their measured size: one stringify per face was ~0.9 s on a 1,558-item board.
  const items = lean.items.map((item) => ({ ...item }));
  let over = JSON.stringify({ ...lean, items }).length - cap;
  for (let i = items.length - 1; i >= 0 && over > 0; i -= 1) {
    if (!items[i].face) continue;
    over -= JSON.stringify(items[i].face).length + 8;
    delete items[i].face;
  }
  text = fit({ ...lean, items });
  if (text) return text;
  // The measured drop fell short (escaping): drop half of the remaining faces from the tail per try, so a
  // 4,000-box snapshot costs a dozen stringifies, not one per face (~1.95 s of idle time).
  let faced = items.filter((item) => item.face).length;
  while (faced > 0) {
    let drop = Math.max(1, Math.ceil(faced / 2));
    for (let i = items.length - 1; i >= 0 && drop > 0; i -= 1) {
      if (!items[i].face) continue;
      delete items[i].face;
      drop -= 1;
      faced -= 1;
    }
    text = fit({ ...lean, items });
    if (text) return text;
  }
  return null;
}

export function parseSnapshot(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try { return cleanSnapshot(JSON.parse(raw)); } catch { return null; }
}

export { ROOT_TRANSIENT, TRANSIENT as SHELL_TRANSIENT };

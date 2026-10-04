import { SHAPES } from "./shapes.js";

export const PLEXUS_KEY = "plexus";
export const SCHEMA_VERSION = 2;
export const PALETTE = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"];
export const ITEM_TYPES = ["card", "section", "text"];
export const DEFAULT_SIZES = { card: { w: 280, h: 160 }, section: { w: 480, h: 320 }, text: { w: 240, h: 48 } };
export const PAGE_CARD = { w: 360, h: 480 };
export const MIN_SIZES = { card: { w: 200, h: 80 }, section: { w: 160, h: 100 }, text: { w: 60, h: 24 } };
export const DEFAULT_BOARD_CARD = { w: 320, h: 220 };
export const UNTITLED_BOARD = "Untitled board";
export const FONT_SIZES = [16, 24, 32, 48];
export const CARD_LOOKS = ["block", "card"];
export const TEXT_LOOKS = ["section-note", "sticky"];
export const STICKY_SIZE = { w: 200, h: 200 };
export const STICKY_COLOR = "yellow";
export const SECTION_LOOKS = ["lane", "calendar", "timer"];
export const LANE_AXES = ["horizontal", "vertical"];
export const LANE_SIZE = { horizontal: { w: 960, h: 180 }, vertical: { w: 240, h: 640 } };
export const CARD_FONT_MIN = 10;
export const CARD_FONT_MAX = 48;
export const CARD_FONT_DEFAULT = 14;
export const SECTION_TITLE_MIN = 10;
export const SECTION_TITLE_MAX = 48;
export const SECTION_TITLE_DEFAULT = 18;
export const ALIGNS = ["left", "center", "right", "justify"];
export const EDGE_DEFAULTS = { fromSide: "auto", toSide: "auto", dir: "one", route: "curve", dash: "solid", weight: 1 };
export const EDGE_WEIGHTS = [1, 2, 3, 4];
export const SIDES = ["auto", "top", "right", "bottom", "left"];
export const ARROWS = { one: "→", two: "↔", none: "—" };
export const DIRS = ["one", "two", "none"];
export const ROUTES = ["curve", "straight", "elbow", "around"];
export const DASHES = ["solid", "dashed", "animated"];
export const BOARD_PATTERNS = ["dots", "lines", "cross", "grid", "plain"];
export const DOCK_POSITIONS = ["bottom", "left", "top"];
export const BOARD_TONES = ["paper", ...PALETTE];
export const FIT_PAD = 24;
// Native diagram swatches, stored as lowercase hex. Named 1.2 colors stay names.
export const NATIVE_SWATCHES = [
  "#000000", "#a7b6c2", "#ffffff", "#f55656", "#ff66a1", "#c274c2",
  "#ad99ff", "#48aff0", "#2ee6d6", "#3dcc91", "#ffb366", "#f2b824", "#c99765",
];
export const ITEM_STYLE_KEYS = ["fontSize", "textColor", "align", "fill", "border", "shape"];
export const SECTION_STYLE_KEYS = ["titleSize", "titleColor", "titleFill", "areaFill", "border"];

const ARROW_TOKENS = Object.values(ARROWS);
const HEX_RE = /^#[0-9a-f]{6}$/;
const BLOCK_UID_RE = /^[\w-]{1,36}$/;
const blockUid = (v) => (typeof v === "string" && BLOCK_UID_RE.test(v) ? v : undefined);

const intIn = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);

// Lowercase #rrggbb only. Shorthand, alpha, and named CSS colors are rejected.
export function hexColor(v) {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  return HEX_RE.test(s) ? s : undefined;
}

// A 1.2 palette name, or a lowercase hex. Anything else is dropped.
export function styleColor(v) {
  if (PALETTE.includes(v)) return v;
  return hexColor(v);
}

// Board tone: a 1.2 tone name, or a lowercase hex.
export function boardColor(v) {
  if (BOARD_TONES.includes(v)) return v;
  return hexColor(v);
}

// CSS color for a stored style value. Palette names use the existing tokens.
export function cssColor(value, role = "line") {
  if (PALETTE.includes(value)) {
    const part = role === "text" ? "text" : role === "fill" ? "fill" : "line";
    return `var(--pxd-${value}-${part})`;
  }
  return hexColor(value);
}

// amount < 0 darkens toward black, amount > 0 lightens toward white. Result is lowercase hex.
export function shadeHex(hex, amount) {
  const h = hexColor(hex);
  if (!h || typeof amount !== "number" || !Number.isFinite(amount)) return undefined;
  const mix = (c) => (amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  const chan = (i) => Math.max(0, Math.min(255, Math.round(mix(parseInt(h.slice(i, i + 2), 16)))));
  return `#${[1, 3, 5].map((i) => chan(i).toString(16).padStart(2, "0")).join("")}`;
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function plainKeys(value) {
  if (Array.isArray(value)) return value.map(plainKeys);
  if (isObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k.startsWith(":") ? k.slice(1) : k] = plainKeys(v);
    }
    return out;
  }
  return value;
}

export function readPlexus(props) {
  if (!isObject(props)) return null;
  const plexus = plainKeys(props)[PLEXUS_KEY];
  return isObject(plexus) ? plexus : null;
}

export function mergePropsForWrite(props, plexus) {
  const out = isObject(props) ? plainKeys(props) : {};
  if (plexus == null) delete out[PLEXUS_KEY];
  else out[PLEXUS_KEY] = plainKeys(plexus);
  return out;
}

export function normalizeItemLayout(plexus) {
  const p = isObject(plexus) ? plexus : {};
  const num = (v) => (isNum(v) ? v : undefined);
  const type = ITEM_TYPES.includes(p.type) ? p.type : "card";
  const section = type === "section";
  return {
    type,
    x: num(p.x),
    y: num(p.y),
    w: num(p.w),
    h: num(p.h),
    color: styleColor(p.color),
    collapsed: p.collapsed === true ? true : p.collapsed === false ? false : undefined,
    // Sections use titleSize. Cards and text take an integer 10–48 (text used to be the four steps only).
    fontSize: section ? undefined : intIn(p.fontSize, CARD_FONT_MIN, CARD_FONT_MAX),
    pinned: p.pinned === true,
    kids: type === "card" && p.kids === true ? true : undefined,
    fit: p.fit === false ? false : undefined,
    look: type === "text"
      ? (TEXT_LOOKS.includes(p.look) ? p.look : undefined)
      : type === "section"
        ? (SECTION_LOOKS.includes(p.look) ? p.look : undefined)
        : (CARD_LOOKS.includes(p.look) ? p.look : undefined),
    axis: type === "section" && p.look === "lane"
      ? (p.axis === "vertical" ? "vertical" : "horizontal")
      : undefined,
    textColor: section ? undefined : styleColor(p.textColor),
    align: section || !ALIGNS.includes(p.align) ? undefined : p.align,
    fill: section ? undefined : styleColor(p.fill),
    border: styleColor(p.border),
    titleSize: section ? intIn(p.titleSize, SECTION_TITLE_MIN, SECTION_TITLE_MAX) : undefined,
    titleColor: section ? styleColor(p.titleColor) : undefined,
    titleFill: section ? styleColor(p.titleFill) : undefined,
    areaFill: section ? styleColor(p.areaFill) : undefined,
    shape: type === "text" && SHAPES.includes(p.shape) ? p.shape : undefined,
  };
}

// Board-level section defaults. titleSize 18 is the default and is omitted. Unknown keys are dropped.
export function normalizeSectionDefaults(raw) {
  const p = isObject(raw) ? raw : {};
  const out = {};
  const ts = intIn(p.titleSize, SECTION_TITLE_MIN, SECTION_TITLE_MAX);
  if (ts !== undefined && ts !== SECTION_TITLE_DEFAULT) out.titleSize = ts;
  for (const k of ["titleColor", "titleFill", "areaFill", "border"]) {
    const c = styleColor(p[k]);
    if (c) out[k] = c;
  }
  return out;
}

// Notes with no stored look are plain blocks. Page, ref, image and board cards stay cards.
export function cardLook(kind, stored) {
  if (CARD_LOOKS.includes(stored)) return stored;
  return kind === "note" ? "block" : "card";
}

// New note cards record the setting. Other kinds omit look and stay cards.
export function lookForNewString(string, preferred) {
  if (classifyString(string).kind !== "note") return undefined;
  return preferred === "card" ? "card" : "block";
}

const round1 = (n) => Math.round(n * 10) / 10;

export function serializeItemLayout(layout) {
  const l = isObject(layout) ? layout : {};
  const out = {};
  if (l.type && l.type !== "card") out.type = l.type;
  for (const k of ["x", "y", "w", "h"]) if (isNum(l[k])) out[k] = round1(l[k]);
  const color = styleColor(l.color);
  if (color) out.color = color;
  if (l.collapsed === true) out.collapsed = true;
  const type = ITEM_TYPES.includes(l.type) ? l.type : "card";
  if (type === "section") {
    const ts = intIn(l.titleSize, SECTION_TITLE_MIN, SECTION_TITLE_MAX);
    if (ts !== undefined && ts !== SECTION_TITLE_DEFAULT) out.titleSize = ts;
    for (const k of ["titleColor", "titleFill", "areaFill", "border"]) {
      const c = styleColor(l[k]);
      if (c) out[k] = c;
    }
  } else {
    const fs = intIn(l.fontSize, CARD_FONT_MIN, CARD_FONT_MAX);
    // 14 is the card default, so a card with no custom size stores nothing. Text keeps every size, including 24.
    if (fs !== undefined && !(type === "card" && fs === CARD_FONT_DEFAULT)) out.fontSize = fs;
    const textColor = styleColor(l.textColor);
    if (textColor) out.textColor = textColor;
    if (ALIGNS.includes(l.align)) out.align = l.align;
    const fill = styleColor(l.fill);
    if (fill) out.fill = fill;
    const border = styleColor(l.border);
    if (border) out.border = border;
  }
  if (l.v === SCHEMA_VERSION) out.v = SCHEMA_VERSION;
  if (l.pinned === true) out.pinned = true;
  if (type === "card" && l.kids === true) out.kids = true;
  if (l.type === "section" && l.fit === false) out.fit = false;
  if (type === "text") {
    if (TEXT_LOOKS.includes(l.look)) out.look = l.look;
    if (SHAPES.includes(l.shape)) out.shape = l.shape;
  } else if (type === "section" && SECTION_LOOKS.includes(l.look)) {
    out.look = l.look;
    if (l.look === "lane") out.axis = l.axis === "vertical" ? "vertical" : "horizontal";
  } else if (CARD_LOOKS.includes(l.look)) out.look = l.look;
  if (BOARD_PATTERNS.includes(l.bg)) out.bg = l.bg;
  const tone = boardColor(l.bgColor);
  if (tone) out.bgColor = tone;
  return out;
}

// A nested board is a card block whose own props carry `v: 2` next to its layout.
export function withBoardMarker(plexus, on) {
  const base = isObject(plexus) ? plainKeys(plexus) : {};
  if (on) return { ...base, v: SCHEMA_VERSION };
  delete base.v;
  delete base.bg;
  delete base.bgColor;
  delete base.bgImage;
  delete base.lodZoom;
  delete base.dock;
  return Object.keys(base).length ? base : null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Roam daily-note page title for a local date, e.g. "September 29th, 2026".
export function dailyPageTitle(date) {
  const d = date instanceof Date ? date : new Date(date);
  const day = d.getDate();
  const suffix = day >= 11 && day <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
  return `${MONTHS[d.getMonth()]} ${day}${suffix}, ${d.getFullYear()}`;
}

export function cleanVia(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const p of points) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    if (out.length >= 8) break;
  }
  return out;
}

export function normalizeEdge(plexus) {
  const p = isObject(plexus) ? plexus : {};
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const via = cleanVia(p.via);
  return {
    from: typeof p.from === "string" ? p.from : "",
    to: typeof p.to === "string" ? p.to : "",
    fromSide: pick(p.fromSide, SIDES, EDGE_DEFAULTS.fromSide),
    toSide: pick(p.toSide, SIDES, EDGE_DEFAULTS.toSide),
    dir: pick(p.dir, DIRS, EDGE_DEFAULTS.dir),
    route: pick(p.route, ROUTES, EDGE_DEFAULTS.route),
    dash: pick(p.dash, DASHES, EDGE_DEFAULTS.dash),
    weight: EDGE_WEIGHTS.includes(p.weight) ? p.weight : EDGE_DEFAULTS.weight,
    color: styleColor(p.color),
    ...(blockUid(p.fromBlock) ? { fromBlock: p.fromBlock } : {}),
    ...(blockUid(p.toBlock) ? { toBlock: p.toBlock } : {}),
    ...(via.length ? { via } : {}),
  };
}

export function serializeEdge(edge) {
  const e = isObject(edge) ? edge : {};
  const out = { type: "edge", from: e.from, to: e.to };
  for (const k of ["fromSide", "toSide", "dir", "route", "dash", "weight"]) {
    if (e[k] !== undefined && e[k] !== EDGE_DEFAULTS[k]) out[k] = e[k];
  }
  const color = styleColor(e.color);
  if (color) out.color = color;
  if (blockUid(e.fromBlock)) out.fromBlock = e.fromBlock;
  if (blockUid(e.toBlock)) out.toBlock = e.toBlock;
  const via = cleanVia(e.via);
  if (via.length) out.via = via;
  return out;
}

// True when `s` is exactly one `[[...]]` group with balanced nesting.
function isSingleWikiRef(s) {
  if (!s.startsWith("[[") || !s.endsWith("]]") || s.length < 5) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("[[", i)) { depth++; i++; }
    else if (s.startsWith("]]", i)) {
      depth--; i++;
      if (depth === 0 && i !== s.length - 1) return false;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

export function classifyString(s) {
  const t = String(s ?? "").trim();
  if (isSingleWikiRef(t)) return { kind: "page", title: t.slice(2, -2) };
  if (t.startsWith("#[[") && isSingleWikiRef(t.slice(1))) return { kind: "page", title: t.slice(3, -2) };
  const tag = /^#([^\s[\]#]+)$/.exec(t);
  if (tag) return { kind: "page", title: tag[1] };
  const block = /^\(\(([\w-]+)\)\)$/.exec(t);
  if (block) return { kind: "block", refUid: block[1] };
  if (/^\{\{(\[\[)?diagram/i.test(t)) return { kind: "board" };
  if (/^!\[[^\]]*\]\([^)]*\)$/.test(t)) return { kind: "image" };
  return { kind: "note" };
}

export function parseBoardTitle(s) {
  const m = /^\s*\{\{\s*(?:\[\[)?diagram(?:\]\])?\s*:([\s\S]*?)\}\}\s*$/i.exec(String(s ?? ""));
  return m ? m[1].trim() : "";
}

const cleanBoardTitle = (title) => String(title ?? "").replace(/\s*[\r\n]+\s*/g, " ").split("}}").join("").trim();

export function boardString(title) {
  return `{{[[diagram]]:${cleanBoardTitle(title) || UNTITLED_BOARD}}}`;
}

// Rewrites only the leading `{{[[diagram]]:...}}` token; the `[[diagram]]` or `diagram` form and any trailing text stay.
export function setBoardTitle(s, title) {
  const cur = String(s ?? "");
  const m = /^(\s*\{\{\s*(?:\[\[)?diagram(?:\]\])?)\s*(?::[^}]*)?\}\}/i.exec(cur);
  if (!m) return boardString(title);
  return `${m[1]}:${cleanBoardTitle(title) || UNTITLED_BOARD}}}${cur.slice(m[0].length)}`;
}

export function isUntitledBoard(title) {
  const t = String(title ?? "").trim().toLowerCase();
  return t === "" || t === UNTITLED_BOARD.toLowerCase();
}

export function plainText(s, max = 200) {
  let t = String(s ?? "");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  t = t.replace(/\[([^[\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\(\([\w-]+\)\)/g, "");
  t = t.replace(/\{\{[^}]*\}\}/g, "");
  let prev;
  do {
    prev = t;
    t = t.replace(/#?\[\[([^[\]]*)\]\]/g, "$1");
  } while (t !== prev);
  t = t.replace(/(^|\s)#([^\s#]+)/g, "$1$2");
  t = t.replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\^\^(.+?)\^\^/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]*)`/g, "$1");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > max) t = `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  return t;
}

export function firstLine(s) {
  const line = String(s ?? "").split("\n").find((l) => l.trim() !== "");
  return line === undefined ? "" : plainText(line);
}

export function semanticRef(item) {
  const t = item?.target;
  if (t?.kind === "page") return `[[${t.title}]]`;
  if (t?.kind === "block") return `((${t.refUid ?? t.uid}))`;
  return `((${item?.uid}))`;
}

export function edgeString({ srcRef, dstRef, dir = "one", label = "", srcBlock, dstBlock }) {
  if (blockUid(srcBlock)) srcRef = `((${srcBlock}))`;
  if (blockUid(dstBlock)) dstRef = `((${dstBlock}))`;
  const a = ARROWS[dir] ?? ARROWS.one;
  return label ? `${srcRef} ${a} ${label} ${a} ${dstRef}` : `${srcRef} ${a} ${dstRef}`;
}

export function parseEdgeLabel(s, srcRef, dstRef) {
  const str = String(s ?? "").trim();
  if (srcRef && dstRef) {
    let rest = null;
    for (const a of ARROW_TOKENS) {
      const prefix = `${srcRef} ${a} `;
      if (str.startsWith(prefix)) { rest = str.slice(prefix.length); break; }
    }
    if (rest !== null) {
      if (rest === dstRef) return "";
      for (const b of ARROW_TOKENS) {
        const suffix = ` ${b} ${dstRef}`;
        if (rest.endsWith(suffix)) return rest.slice(0, rest.length - suffix.length).trim();
      }
    }
  }
  let out = str;
  for (const token of [srcRef, dstRef, ...ARROW_TOKENS]) {
    if (token) out = out.split(token).join(" ");
  }
  return out.replace(/\s+/g, " ").trim();
}

export function colorForLabel(label) {
  if (label == null || label === "" || label === "mentions") return "gray";
  let h = 0x811c9dc5;
  const str = String(label);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return PALETTE[1 + (h % 9)];
}

export function attrNameOf(s) {
  if (typeof s !== "string") return null;
  const m = /^\s*([^:\n]{1,60})::/.exec(s);
  if (!m) return null;
  const name = m[1].trim();
  return name ? name : null;
}

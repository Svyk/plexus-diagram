export const PLEXUS_KEY = "plexus";
export const SCHEMA_VERSION = 2;
export const PALETTE = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"];
export const ITEM_TYPES = ["card", "section", "text"];
export const DEFAULT_SIZES = { card: { w: 280, h: 160 }, section: { w: 480, h: 320 }, text: { w: 240, h: 48 } };
export const MIN_SIZES = { card: { w: 200, h: 80 }, section: { w: 160, h: 100 }, text: { w: 60, h: 24 } };
export const DEFAULT_BOARD_CARD = { w: 320, h: 220 };
export const UNTITLED_BOARD = "Untitled board";
export const FONT_SIZES = [16, 24, 32, 48];
export const CARD_LOOKS = ["block", "card"];
export const EDGE_DEFAULTS = { fromSide: "auto", toSide: "auto", dir: "one", route: "curve", dash: "solid", weight: 1 };
export const SIDES = ["auto", "top", "right", "bottom", "left"];
export const ARROWS = { one: "→", two: "↔", none: "—" };
export const BOARD_PATTERNS = ["dots", "lines", "grid", "plain"];
export const BOARD_TONES = ["paper", ...PALETTE];
export const FIT_PAD = 24;

const ARROW_TOKENS = Object.values(ARROWS);
const ROUTES = ["curve", "straight", "elbow"];
const DASHES = ["solid", "dashed"];
const DIRS = ["one", "two", "none"];

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
  return {
    type: ITEM_TYPES.includes(p.type) ? p.type : "card",
    x: num(p.x),
    y: num(p.y),
    w: num(p.w),
    h: num(p.h),
    color: PALETTE.includes(p.color) ? p.color : undefined,
    collapsed: p.collapsed === true ? true : p.collapsed === false ? false : undefined,
    fontSize: FONT_SIZES.includes(p.fontSize) ? p.fontSize : undefined,
    pinned: p.pinned === true,
    fit: p.fit === false ? false : undefined,
    look: CARD_LOOKS.includes(p.look) ? p.look : undefined,
  };
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
  if (PALETTE.includes(l.color)) out.color = l.color;
  if (l.collapsed === true) out.collapsed = true;
  if (l.type === "text" && FONT_SIZES.includes(l.fontSize)) out.fontSize = l.fontSize;
  if (l.v === SCHEMA_VERSION) out.v = SCHEMA_VERSION;
  if (l.pinned === true) out.pinned = true;
  if (l.type === "section" && l.fit === false) out.fit = false;
  if (CARD_LOOKS.includes(l.look)) out.look = l.look;
  if (BOARD_PATTERNS.includes(l.bg)) out.bg = l.bg;
  if (BOARD_TONES.includes(l.bgColor)) out.bgColor = l.bgColor;
  return out;
}

// A nested board is a card block whose own props carry `v: 2` next to its layout.
export function withBoardMarker(plexus, on) {
  const base = isObject(plexus) ? plainKeys(plexus) : {};
  if (on) return { ...base, v: SCHEMA_VERSION };
  delete base.v;
  delete base.bg;
  delete base.bgColor;
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

export function normalizeEdge(plexus) {
  const p = isObject(plexus) ? plexus : {};
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  return {
    from: typeof p.from === "string" ? p.from : "",
    to: typeof p.to === "string" ? p.to : "",
    fromSide: pick(p.fromSide, SIDES, EDGE_DEFAULTS.fromSide),
    toSide: pick(p.toSide, SIDES, EDGE_DEFAULTS.toSide),
    dir: pick(p.dir, DIRS, EDGE_DEFAULTS.dir),
    route: pick(p.route, ROUTES, EDGE_DEFAULTS.route),
    dash: pick(p.dash, DASHES, EDGE_DEFAULTS.dash),
    weight: [1, 2, 3].includes(p.weight) ? p.weight : EDGE_DEFAULTS.weight,
    color: PALETTE.includes(p.color) ? p.color : undefined,
  };
}

export function serializeEdge(edge) {
  const e = isObject(edge) ? edge : {};
  const out = { type: "edge", from: e.from, to: e.to };
  for (const k of ["fromSide", "toSide", "dir", "route", "dash", "weight"]) {
    if (e[k] !== undefined && e[k] !== EDGE_DEFAULTS[k]) out[k] = e[k];
  }
  if (PALETTE.includes(e.color)) out.color = e.color;
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

export function edgeString({ srcRef, dstRef, dir = "one", label = "" }) {
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

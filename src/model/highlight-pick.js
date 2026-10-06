// PDF-3 picker. Group highlight rows, place at most 45, expand a date's children. No writes.

import { highlightNote } from "./highlight.js";
import { plainKeys } from "./schema.js";

const NAMES = new Set(["red", "orange", "yellow", "green", "blue", "purple", "pink"]);
const GROUP_RE = /^\[\[[^\[\]]+\]\]$/;
const COLOR_TOKEN = /#h\/([A-Za-z]+)/;
const TOKEN = /#h\/[A-Za-z]+/g;
const CARD_W = 300;
const CARD_H = 140;
const GAP = 24;
const COLS = 3;
const CAP = 45;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function highlightRecord(props) {
  if (!isObject(props)) return null;
  const colon = Object.prototype.hasOwnProperty.call(props, ":pdf-highlight");
  const plain = Object.prototype.hasOwnProperty.call(props, "pdf-highlight");
  if (!colon && !plain) return null;
  const raw = colon ? props[":pdf-highlight"] : props["pdf-highlight"];
  if (!isObject(raw)) return {};
  const flat = plainKeys(raw);
  return isObject(flat) ? flat : {};
}

function pageOf(record) {
  const position = record.position;
  if (!isObject(position)) return null;
  const rect = position.boundingRect;
  if (!isObject(rect)) return null;
  const page = rect.pageNumber;
  return typeof page === "number" && Number.isFinite(page) ? page : null;
}

function colorOf(string) {
  if (typeof string !== "string") return "gray";
  const match = COLOR_TOKEN.exec(string);
  if (!match) return "gray";
  const name = match[1].toLowerCase();
  return NAMES.has(name) ? name : "gray";
}

function snippetOf(string) {
  if (typeof string !== "string") return "";
  return string.replace(TOKEN, " ").replace(/[ \t]{2,}/g, " ").trim().slice(0, 80);
}

function groupOf(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const string = ancestors[i] && typeof ancestors[i].string === "string" ? ancestors[i].string.trim() : "";
    if (GROUP_RE.test(string)) return string;
  }
  return "";
}

function placedSet(placed) {
  const out = new Set();
  const list = placed instanceof Set ? placed : (Array.isArray(placed) ? placed : []);
  for (const value of list) {
    if (typeof value === "string" && value) out.add(value);
    else if (isObject(value) && isObject(value.target) && typeof value.target.uid === "string" && value.target.uid) {
      out.add(value.target.uid);
    }
  }
  return out;
}

function rowFrom(node, ancestors, placed) {
  const record = highlightRecord(node.props);
  const uid = typeof node.uid === "string" ? node.uid : "";
  return {
    uid,
    color: colorOf(node.string),
    snippet: snippetOf(node.string),
    page: record ? pageOf(record) : null,
    group: groupOf(ancestors),
    placed: uid !== "" && placed.has(uid),
    note: highlightNote(node.children),
  };
}

function walk(nodes, ancestors, placed, out) {
  for (const node of nodes) {
    if (!isObject(node)) continue;
    if (highlightRecord(node.props)) out.push(rowFrom(node, ancestors, placed));
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length) walk(children, ancestors.concat(node), placed, out);
  }
}

export function highlightRows(blocks, { placed } = {}) {
  const nodes = Array.isArray(blocks) ? blocks : (isObject(blocks) ? [blocks] : []);
  const out = [];
  walk(nodes, [], placedSet(placed), out);
  return out;
}

function capOf(cap) {
  if (typeof cap !== "number" || !Number.isFinite(cap)) return CAP;
  const n = Math.floor(cap);
  if (n < 0) return 0;
  return Math.min(n, CAP);
}

function originOf(origin) {
  const src = isObject(origin) ? origin : {};
  const x = typeof src.x === "number" && Number.isFinite(src.x) ? src.x : 0;
  const y = typeof src.y === "number" && Number.isFinite(src.y) ? src.y : 0;
  return { x, y };
}

// Grid is three columns. A column is a stack that shares one x.
function slot(index, mode) {
  if (mode === "column") return { col: 0, row: index };
  return { col: index % COLS, row: Math.floor(index / COLS) };
}

export function placeHighlights(rows, { mode, origin, cap } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const eligible = list.filter((row) => isObject(row)
    && typeof row.uid === "string"
    && row.uid !== ""
    && row.selected === true
    && row.placed !== true);
  const limit = capOf(cap);
  const take = eligible.slice(0, limit);
  const at = originOf(origin);
  const items = take.map((row, index) => {
    const { col, row: line } = slot(index, mode);
    return {
      string: `((${row.uid}))`,
      x: at.x + col * (CARD_W + GAP),
      y: at.y + line * (CARD_H + GAP),
      w: CARD_W,
      h: CARD_H,
    };
  });
  return { items, omitted: eligible.length - take.length };
}

export function expandDateHighlights(block) {
  if (!isObject(block) || !Array.isArray(block.children)) return null;
  const uids = [];
  for (const child of block.children) {
    if (!isObject(child) || !highlightRecord(child.props)) continue;
    if (typeof child.uid === "string" && child.uid) uids.push(child.uid);
  }
  return uids.length ? uids : null;
}

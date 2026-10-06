// PDF highlight card. Reads props and the block string. Tag rewrite returns a string. No writes.

import { PALETTE, plainKeys } from "./schema.js";

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "purple", "orange", "red"];

const COLOR_TOKEN = /#h\/([A-Za-z]+)/;
const TAG_TOKEN = /#h\/[A-Za-z]+/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function highlightRecord(props) {
  if (!isObject(props)) return null;
  const keys = Object.keys(props);
  const colon = keys.includes(":pdf-highlight");
  const plain = keys.includes("pdf-highlight");
  if (!colon && !plain) return null;
  const raw = colon ? props[":pdf-highlight"] : props["pdf-highlight"];
  if (!isObject(raw)) return {};
  const flat = plainKeys(raw);
  return isObject(flat) ? flat : {};
}

function pageNumberOf(record) {
  const position = record.position;
  if (!isObject(position)) return null;
  const rect = position.boundingRect;
  if (!isObject(rect)) return null;
  const page = rect.pageNumber;
  return typeof page === "number" && Number.isFinite(page) ? page : null;
}

function contentTextOf(record) {
  const content = record.content;
  if (!isObject(content)) return "";
  return typeof content.text === "string" ? content.text : "";
}

function highlightColor(string) {
  if (typeof string !== "string") return "gray";
  const match = COLOR_TOKEN.exec(string);
  if (!match) return "gray";
  const name = match[1].toLowerCase();
  return PALETTE.includes(name) ? name : "gray";
}

function stripHighlightTokens(string) {
  if (typeof string !== "string") return "";
  return string.replace(/#h\/[A-Za-z]+/g, " ").replace(/[ \t]{2,}/g, " ").trim();
}

function footerOf(page, pageTitle) {
  const title = typeof pageTitle === "string" ? pageTitle.trim() : "";
  const parts = [];
  if (page != null) parts.push(`p. ${page}`);
  if (title) parts.push(title);
  return parts.join(" · ");
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fieldNumber(obj, name) {
  const colon = finiteNumber(obj[`:${name}`]);
  if (colon != null) return colon;
  return finiteNumber(obj[name]);
}

function sizePair(obj) {
  if (!isObject(obj)) return null;
  const w = fieldNumber(obj, "width");
  const h = fieldNumber(obj, "height");
  if (w == null || h == null) return null;
  return { w, h };
}

function firstSize(value, seen) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstSize(item, seen);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value) || seen.has(value)) return null;
  seen.add(value);
  const pair = sizePair(value);
  if (pair) return pair;
  for (const key of Object.keys(value)) {
    if (key === "url" || key === ":url") continue;
    const found = firstSize(value[key], seen);
    if (found) return found;
  }
  return null;
}

export function rewriteHighlightTag(string, name) {
  if (typeof string !== "string") return string;
  if (typeof name !== "string" || !HIGHLIGHT_COLORS.includes(name)) return string;
  const token = `#h/${name}`;
  if (!TAG_TOKEN.test(string)) return `${string} ${token}`;
  return string.replace(TAG_TOKEN, token);
}

export function naturalSize(props) {
  if (!isObject(props)) return null;
  const seen = new Set();
  if (Object.prototype.hasOwnProperty.call(props, ":image-size")) {
    const found = firstSize(props[":image-size"], seen);
    if (found) return found;
  }
  if (Object.prototype.hasOwnProperty.call(props, "image-size")) {
    return firstSize(props["image-size"], seen);
  }
  return null;
}

function childFields(node, index) {
  if (!isObject(node)) return null;
  const string = typeof node.string === "string"
    ? node.string
    : (typeof node[":block/string"] === "string" ? node[":block/string"] : "");
  const props = isObject(node.props)
    ? node.props
    : (isObject(node[":block/props"]) ? node[":block/props"] : {});
  const orderRaw = node.order ?? node[":block/order"];
  const order = typeof orderRaw === "number" && Number.isFinite(orderRaw) ? orderRaw : index;
  const uidRaw = typeof node.uid === "string" && node.uid
    ? node.uid
    : (typeof node[":block/uid"] === "string" ? node[":block/uid"] : "");
  return { string, props, order, index, uid: uidRaw };
}

function orderedChildren(children) {
  const list = Array.isArray(children) ? children : [];
  const rows = [];
  for (let i = 0; i < list.length; i += 1) {
    const row = childFields(list[i], i);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => a.order - b.order || a.index - b.index);
  return rows;
}

// The note string is the first child that is not itself a highlight.
// Roam's note button creates that child empty; an empty string shows no note.
export function highlightNote(children) {
  for (const row of orderedChildren(children)) {
    if (highlightRecord(row.props)) continue;
    return row.string;
  }
  return "";
}

// Focus the note child Roam already created (empty or not). Otherwise the caller creates one plain child, string "".
export function noteActionPlan(children) {
  for (const row of orderedChildren(children)) {
    if (highlightRecord(row.props)) continue;
    return { kind: "focus", uid: row.uid };
  }
  return { kind: "create" };
}

export function highlightModel(input) {
  const src = isObject(input) ? input : {};
  const record = highlightRecord(src.props);
  if (!record) return null;
  const block = typeof src.string === "string" ? src.string : "";
  const rawType = typeof record.type === "string" ? record.type : "";
  const area = rawType === "area" || block.includes("![");
  const stored = contentTextOf(record);
  const page = pageNumberOf(record);
  return {
    type: area ? "area" : (rawType || "text"),
    text: area || stored === "" ? stripHighlightTokens(block) : stored,
    image: area,
    natural: naturalSize(src.props),
    page,
    color: highlightColor(block),
    footer: footerOf(page, src.pageTitle),
    note: highlightNote(src.children),
  };
}

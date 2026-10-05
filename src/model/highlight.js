// PDF-2 highlight card. Reads props and the block string. No writes.

import { PALETTE, plainKeys } from "./schema.js";

const COLOR_TOKEN = /#h\/([A-Za-z]+)/;

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
    page,
    color: highlightColor(block),
    footer: footerOf(page, src.pageTitle),
  };
}

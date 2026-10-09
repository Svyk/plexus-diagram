// anydoc Markdown → pxd-parse/1, then an insert plan.
// Does not import the host or session. drop.js passes planParseInsert in for DOCX/ODT
// so this file does not import drop.js.
//
// Write budget: each sent card is fromMarkdown + props (2 writes). OFFICE_BATCH is 22,
// the same split as PARSE_SECTION_CAP, so one gesture stays at 44 writes. The offer
// the user sees is "next 45". Row cap is separate from that budget.

import { SCHEMA, selectBlocks } from "./parse-schema.js";
import { toRoamMarkdown } from "./parse-to-roam-md.js";

export const ROW_CAP = 300;
export const ROW_TOAST = "first 300 rows";
export const WRITE_CAP = 45;
export const WRITES_PER_CARD = 2;
export const OFFICE_BATCH = Math.floor(WRITE_CAP / WRITES_PER_CARD);
export const NEXT_OFFER = "next 45";
export const OFFICE_STEP = 184;

const OFFICE_EXT = new Set(["docx", "pptx", "xlsx", "odt", "ods", "odp", "epub", "csv"]);
const ENC = /\.enc(?:[?#]|$)/i;

export function officeFormatFromName(name) {
  const text = String(name || "");
  if (ENC.test(text)) return null;
  const base = text.split(/[?#]/)[0];
  const match = /\.([A-Za-z0-9]+)$/.exec(base);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  return OFFICE_EXT.has(ext) ? ext : null;
}

export function officeFormatFromUrl(url) {
  const text = String(url || "").trim();
  if (!text || ENC.test(text)) return null;
  let path = text.split(/[?#]/)[0];
  try { path = new URL(text).pathname; } catch { /* use the trimmed path */ }
  return officeFormatFromName(path);
}

function nameFromUrl(url) {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last);
  } catch {
    return String(url || "").split("/").pop()?.split(/[?#]/)[0] || "";
  }
}

// https only. Roam's .enc uploads stay in Roam's reader. blob: is not an office fetch.
export function officeFetchAllowed(url) {
  const text = String(url || "").trim();
  if (!text || ENC.test(text)) return false;
  return /^https:\/\//i.test(text);
}

// The whole string is one markdown link, one bare https URL, or one <a href>.
export function officeTargetFromText(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 4000) return null;
  const linked = /^\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(raw);
  if (linked) {
    const url = linked[2];
    const format = officeFormatFromUrl(url) || officeFormatFromName(linked[1]);
    if (!format || !officeFetchAllowed(url)) return null;
    return { format, name: linked[1] || nameFromUrl(url), url };
  }
  if (/^https:\/\/\S+$/i.test(raw)) {
    const format = officeFormatFromUrl(raw);
    if (!format || !officeFetchAllowed(raw)) return null;
    return { format, name: nameFromUrl(raw), url: raw };
  }
  const anchor = /^\s*<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>[^<]*<\/a>\s*$/i.exec(raw);
  if (anchor) {
    const url = anchor[1];
    const format = officeFormatFromUrl(url);
    if (!format || !officeFetchAllowed(url)) return null;
    return { format, name: nameFromUrl(url), url };
  }
  return null;
}

function inlineText(value) {
  let text = String(value ?? "");
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/`([^`]*)`/g, "$1");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/~~([^~]+)~~/g, "$1");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2");
  text = text.replace(/<[^>]+>/g, "");
  return text.replace(/\s+/g, " ").trim();
}

function isAnchorLine(line) {
  return /^\s*<a\s+id="[^"]*"\s*\/?\s*>(?:\s*<\/a>)?\s*$/i.test(line);
}

function isRule(line) {
  return /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim());
}

function isListLine(line) {
  return /^(\s*)([-*+]|\d+\.)\s+\S/.test(line);
}

function splitRow(line) {
  let text = String(line || "").trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  return text.split("|").map((cell) => cell.trim());
}

function isSeparator(line) {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function isTableStart(lines, index) {
  return lines[index].includes("|") && index + 1 < lines.length && isSeparator(lines[index + 1]);
}

function isStructural(lines, index) {
  const line = lines[index];
  if (!line.trim() || isAnchorLine(line) || isRule(line)) return true;
  if (/^(#{1,6})\s+/.test(line)) return true;
  if (line.trimStart().startsWith("```") || line.trim() === "$$") return true;
  if (line.trimStart().startsWith(">")) return true;
  if (isTableStart(lines, index) || isListLine(line)) return true;
  return false;
}

function parseTable(lines, index) {
  const header = splitRow(lines[index]).map(inlineText);
  let cursor = index + 2;
  const body = [];
  while (cursor < lines.length && lines[cursor].includes("|") && lines[cursor].trim()) {
    if (isSeparator(lines[cursor])) break;
    body.push(splitRow(lines[cursor]).map(inlineText));
    cursor += 1;
  }
  const cols = Math.max(header.length, ...body.map((row) => row.length), 1);
  const rows = body.length + 1;
  const cells = [];
  const put = (r, values, headerRow) => {
    for (let c = 0; c < cols; c += 1) {
      cells.push({
        r,
        c,
        rowSpan: 1,
        colSpan: 1,
        text: values[c] || "",
        header: headerRow,
      });
    }
  };
  put(0, header, true);
  body.forEach((values, r) => put(r + 1, values, false));
  return {
    next: cursor,
    table: { type: "table", rows, cols, headerRows: 1, cells },
  };
}

export function parseMarkdownBlocks(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || isAnchorLine(line) || isRule(line)) { i += 1; continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: inlineText(heading[2]) });
      i += 1;
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      i += 1;
      const buf = [];
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }
    if (line.trim() === "$$") {
      i += 1;
      const buf = [];
      while (i < lines.length && lines[i].trim() !== "$$") {
        buf.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "formula", latex: inlineText(buf.join(" ")) });
      continue;
    }
    if (line.trimStart().startsWith(">")) {
      const buf = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "para", text: inlineText(buf.join(" ")), note: true });
      continue;
    }
    if (isTableStart(lines, i)) {
      const parsed = parseTable(lines, i);
      blocks.push(parsed.table);
      i = parsed.next;
      continue;
    }
    if (isListLine(line)) {
      const items = [];
      while (i < lines.length) {
        if (!lines[i].trim()) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j += 1;
          if (j < lines.length && isListLine(lines[j])) { i = j; continue; }
          break;
        }
        if (!isListLine(lines[i])) break;
        const match = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
        const indent = match[1].replace(/\t/g, "    ").length;
        const marker = match[2];
        const ordered = /^\d+\.$/.test(marker);
        items.push({
          text: inlineText(match[3]),
          level: Math.floor(indent / 2),
          marker: ordered ? marker : "•",
          ordered,
        });
        i += 1;
      }
      blocks.push({
        type: "list",
        ordered: items.length > 0 && items.every((item) => item.ordered),
        items: items.map(({ text, level, marker }) => ({ text, level, marker })),
      });
      continue;
    }
    const buf = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !isStructural(lines, i)) {
      buf.push(lines[i]);
      i += 1;
    }
    const text = inlineText(buf.join(" "));
    if (text) blocks.push({ type: "para", text });
  }
  return blocks;
}

export function markdownToParse(markdown, {
  format = "",
  title = "",
  engine = "anydoc",
  engineVersion = "anydoc-wasm/0.2.4",
  createdAt = "",
  sha256 = "",
} = {}) {
  const blocks = {};
  const order = [];
  parseMarkdownBlocks(markdown).forEach((block, index) => {
    const id = `b${index + 1}`;
    blocks[id] = { ...block, id };
    order.push(id);
  });
  const doc = { schema: SCHEMA, engine, engineVersion, order, blocks };
  if (title) doc.title = title;
  if (format) doc.sourceFormat = format;
  if (createdAt) doc.createdAt = createdAt;
  if (sha256) doc.sha256 = sha256;
  return doc;
}

export function capTable(table, cap = ROW_CAP) {
  if (!table || !Number.isInteger(table.rows) || table.rows <= cap) {
    return { table, truncated: false };
  }
  const cells = [];
  for (const cell of table.cells || []) {
    if (!Number.isInteger(cell?.r) || cell.r >= cap) continue;
    const rowSpan = Math.min(cell.rowSpan ?? 1, cap - cell.r);
    if (rowSpan < 1) continue;
    cells.push({ ...cell, rowSpan });
  }
  return { table: { ...table, rows: cap, cells }, truncated: true };
}

function cardMarkdown(title, body) {
  const blocks = {};
  const order = [];
  let n = 0;
  const add = (block) => {
    n += 1;
    const id = `k${n}`;
    const copy = { ...block, id };
    delete copy.note;
    blocks[id] = copy;
    order.push(id);
  };
  if (title) add({ type: "para", text: title });
  for (const block of body || []) {
    if (block.type === "heading") add({ type: "para", text: block.text || "" });
    else add(block);
  }
  if (!order.length) return "";
  return toRoamMarkdown({ schema: SCHEMA, engine: "anydoc", order, blocks }, order).markdown;
}

function batchRows(rows, offset) {
  const start = Math.max(0, Number.isFinite(offset) ? Math.floor(offset) : 0);
  const slice = rows.slice(start, start + OFFICE_BATCH);
  const next = start + slice.length;
  const more = next < rows.length;
  return {
    sections: slice,
    more,
    nextOffset: more ? next : undefined,
    offer: more ? NEXT_OFFER : undefined,
  };
}

function slidesFrom(doc) {
  const slides = [];
  let current = null;
  const close = () => {
    if (!current) return;
    slides.push(current);
    current = null;
  };
  const open = (title) => {
    close();
    current = { title, body: [] };
  };
  for (const block of selectBlocks(doc, null)) {
    if (block.type === "heading") {
      open(String(block.text || "").trim());
      continue;
    }
    if (block.type === "para" && block.note) {
      if (!current) open("");
      current.body.push({ type: "para", text: block.text || "" });
      close();
      continue;
    }
    if (!current) {
      if (block.type === "para") open(String(block.text || "").trim());
      else {
        open("");
        current.body.push(block);
      }
      continue;
    }
    current.body.push(block);
  }
  close();
  return slides.map((slide) => ({ title: slide.title, markdown: cardMarkdown(slide.title, slide.body) }));
}

function chaptersFrom(doc) {
  const chapters = [];
  let current = null;
  const push = () => { if (current) chapters.push(current); };
  for (const block of selectBlocks(doc, null)) {
    if (block.type === "heading") {
      push();
      current = { title: String(block.text || "").trim(), body: [] };
      continue;
    }
    if (!current) current = { title: "", body: [] };
    current.body.push(block);
  }
  push();
  return chapters.map((chapter) => ({
    title: chapter.title,
    markdown: cardMarkdown(chapter.title, chapter.body),
  }));
}

function gridsFrom(doc) {
  const tables = [];
  let name = "";
  for (const block of selectBlocks(doc, null)) {
    if (block.type === "heading") {
      name = String(block.text || "").trim();
      continue;
    }
    if (block.type !== "table") continue;
    const capped = capTable(block);
    const sheet = name || "Sheet";
    tables.push({
      name: sheet,
      truncated: capped.truncated,
      table: { ...capped.table, caption: sheet },
    });
  }
  return tables;
}

export function planFromParse(doc, { format = "", offset = 0, planSections } = {}) {
  const kind = String(format || doc?.sourceFormat || "").toLowerCase();
  if (kind === "docx" || kind === "odt") {
    if (typeof planSections !== "function") return { action: "empty" };
    const full = planSections(doc, { kind: "blocks", ids: Array.isArray(doc?.order) ? doc.order : [] });
    if (full?.action !== "sections") return full || { action: "empty" };
    return { action: "sections", ...batchRows(full.sections || [], offset) };
  }
  if (kind === "pptx" || kind === "odp") {
    return { action: "slides", ...batchRows(slidesFrom(doc), offset) };
  }
  if (kind === "epub") {
    return { action: "chapters", ...batchRows(chaptersFrom(doc), offset) };
  }
  if (kind === "xlsx" || kind === "csv" || kind === "ods") {
    const all = gridsFrom(doc);
    const batched = batchRows(all, offset);
    const toast = batched.sections.some((row) => row.truncated) ? ROW_TOAST : undefined;
    return { action: "grids", tables: batched.sections, toast, more: batched.more, nextOffset: batched.nextOffset, offer: batched.offer };
  }
  return { action: "empty" };
}

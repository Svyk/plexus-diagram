// Clipboard text. CSV is RFC 4180 (CRLF, quotes when needed).
// Markdown is a GFM table when the table has no spans, otherwise an HTML
// table that keeps rowspan and colspan. A page range uses # headings,
// lists, $$ formulas, and [^n] footnotes.

import { selectBlocks, tableGrid } from "./parse-schema.js";

function csvField(value, sep) {
  const text = value == null ? "" : String(value);
  const needs = sep === "\t" ? /["\t\r\n]/ : /[",\r\n]/;
  if (!needs.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCSV(table, { tsv = false } = {}) {
  const sep = tsv ? "\t" : ",";
  const grid = tableGrid(table);
  const lines = grid.map((row) => row.map((slot) => {
    const text = !slot || slot.covered || slot.cell == null ? "" : String(slot.text ?? "");
    return csvField(text, sep);
  }).join(sep));
  return lines.join("\r\n");
}

function htmlEscape(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function gfmCell(text) {
  return String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function tableHasSpan(table) {
  return (table.cells || []).some((cell) => (cell.rowSpan ?? 1) > 1 || (cell.colSpan ?? 1) > 1);
}

export function tableToMarkdown(table) {
  const grid = tableGrid(table);
  if (!grid.length) return "";
  if (!tableHasSpan(table)) {
    const width = grid[0].length;
    const lines = grid.map((row) => `| ${row.map((slot) => gfmCell(slot.text)).join(" | ")} |`);
    const rule = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
    lines.splice(1, 0, rule);
    return lines.join("\n");
  }
  const body = grid.map((row) => {
    const cells = [];
    for (const slot of row) {
      if (slot.covered) continue;
      const cell = slot.cell;
      const tag = cell?.header ? "th" : "td";
      const rs = cell && (cell.rowSpan ?? 1) > 1 ? ` rowspan="${cell.rowSpan}"` : "";
      const cs = cell && (cell.colSpan ?? 1) > 1 ? ` colspan="${cell.colSpan}"` : "";
      const text = cell ? htmlEscape(cell.text ?? "") : "";
      cells.push(`<${tag}${rs}${cs}>${text}</${tag}>`);
    }
    return `<tr>${cells.join("")}</tr>`;
  });
  return `<table>\n${body.join("\n")}\n</table>`;
}

const SUPERSCRIPT = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};

function footnoteText(text, refs) {
  let out = String(text ?? "");
  for (const ref of refs || []) {
    const mark = String(ref.mark ?? "");
    if (!mark || out.includes(`[^${mark}]`)) continue;
    const sup = Object.keys(SUPERSCRIPT).find((ch) => SUPERSCRIPT[ch] === mark);
    if (sup && out.includes(sup)) out = out.replace(sup, `[^${mark}]`);
    else out += `[^${mark}]`;
  }
  return out;
}

export function toMarkdown(doc, idsOrRange) {
  const blocks = selectBlocks(doc, idsOrRange);
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const lines = [];
  const notes = [];
  const seenNotes = new Set();
  const skip = new Set();
  for (const block of blocks) {
    if (block.type === "caption" && block.for && byId.has(block.for)) skip.add(block.id);
  }
  const captionOf = (block) => {
    for (const other of blocks) {
      if (other.type === "caption" && other.for === block.id) return other.text || "";
    }
    if (typeof block.caption === "string" && !byId.has(block.caption)) return block.caption;
    return "";
  };
  for (const block of blocks) {
    if (skip.has(block.id)) continue;
    if (block.type === "heading") {
      const level = Math.min(Math.max(block.level || 1, 1), 6);
      lines.push(`${"#".repeat(level)} ${block.text ?? ""}`);
    } else if (block.type === "para") {
      lines.push(footnoteText(block.text ?? "", block.footnoteRefs));
    } else if (block.type === "list") {
      for (const item of block.items || []) {
        const depth = Number.isInteger(item.level) && item.level > 0 ? item.level : 0;
        const pad = "  ".repeat(depth);
        const marker = block.ordered ? `${item.marker || "1."} ` : "- ";
        const bullet = block.ordered ? marker : "- ";
        const keep = !block.ordered && item.marker && item.marker !== "•" && item.marker !== "-" ? `${item.marker} ` : "";
        const orderedText = block.ordered ? `${item.marker && item.marker !== "1." ? `${item.marker} ` : ""}${item.text ?? ""}` : `${keep}${item.text ?? ""}`;
        lines.push(`${pad}${block.ordered ? "1. " : bullet}${orderedText}`.trimEnd());
      }
    } else if (block.type === "table") {
      lines.push(tableToMarkdown(block));
      const caption = captionOf(block);
      if (caption) lines.push(caption);
    } else if (block.type === "formula") {
      if (block.latex) lines.push(`$$${block.latex}$$${block.number ? ` ${block.number}` : ""}`);
      else lines.push(block.text || "Formula");
    } else if (block.type === "figure") {
      const caption = captionOf(block) || block.text || "Figure";
      const url = block.image?.url || "";
      lines.push(url ? `![${caption}](${url})` : caption);
    } else if (block.type === "caption") {
      lines.push(block.text ?? "");
    } else if (block.type === "code") {
      lines.push(`\`\`\`\n${block.text ?? ""}\n\`\`\``);
    } else if (block.type === "footnote") {
      if (!seenNotes.has(block.id)) {
        seenNotes.add(block.id);
        notes.push(`[^${block.mark}]: ${block.text ?? ""}`);
      }
    } else if (block.type === "scan") {
      lines.push(`Scanned page ${block.page} (no text)`);
    }
    for (const ref of block.footnoteRefs || []) {
      const note = ref.to ? byId.get(ref.to) : null;
      if (note && !seenNotes.has(note.id)) {
        seenNotes.add(note.id);
        notes.push(`[^${note.mark}]: ${note.text ?? ""}`);
      }
    }
  }
  if (notes.length) lines.push(notes.join("\n"));
  return lines.join("\n\n");
}

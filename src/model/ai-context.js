// Ask AI. Pure. Builds the text a model gets for one part of a parsed PDF: the part itself (FOCUS), the
// words around it (NEARBY), the heading chain it sits in (SECTION), and a short map of the whole
// document (DOCUMENT). Nothing here touches the DOM, the network, or Roam.

import { tableToMarkdown } from "./parse-to-text.js";
import { escapeMarkdownText, flattenLine, linkSafeText } from "./parse-to-roam-md.js";
import { parsedDocTitle } from "./pdf.js";

export const CONTEXT_TOKEN_CAP = 12000;
export const OUTLINE_TOKEN_CAP = 1500;
export const NEARBY_CHAR_BUDGET = 4000;
export const NEARBY_PARAS = 2;

const CHARS_PER_TOKEN = 4;
const PARA_CLIP = 1200;

export const INSTRUCTIONS = [
  "You are helping someone read one part of a PDF.",
  "Analyse the part under FOCUS. Use DOCUMENT, SECTION and NEARBY only to interpret it, not as the subject.",
  "Cite pages as [p. N] using the page numbers shown in the context.",
  "If the FOCUS alone does not support a claim, say so instead of filling the gap from elsewhere.",
].join("\n");

export const DEFAULT_PROMPT = "Explain this part in plain language.";

export const QUICK_PROMPTS = Object.freeze([
  { id: "explain", label: "Explain", prompt: "Explain this part in plain language." },
  { id: "summarize", label: "Summarize", prompt: "Summarize this part in three to five sentences." },
  { id: "numbers", label: "Key numbers", prompt: "List the key numbers in this part with their units and what each one measures." },
  { id: "unusual", label: "What's unusual?", prompt: "What is unusual, surprising or inconsistent in this part?" },
]);

const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const clip = (text, max) => {
  const t = String(text ?? "");
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};
export const estimateTokens = (text) => Math.ceil(String(text ?? "").length / CHARS_PER_TOKEN);

function orderOf(doc) {
  const blocks = doc?.blocks && typeof doc.blocks === "object" ? doc.blocks : {};
  const order = Array.isArray(doc?.order) ? doc.order : Object.keys(blocks);
  return order.filter((id) => blocks[id]);
}

function blockText(block) {
  if (!block) return "";
  if (block.type === "list") return (block.items || []).map((item) => squash(item.text)).filter(Boolean).join("; ");
  if (block.type === "table") return (block.cells || []).map((cell) => squash(cell.text)).filter(Boolean).join(" ");
  return squash(block.text || block.latex || "");
}

// The caption text of a table or figure: an attached caption block, else the block's own caption string.
function captionOf(doc, block) {
  if (!block) return "";
  const blocks = doc?.blocks || {};
  for (const id of orderOf(doc)) {
    const other = blocks[id];
    if (other.type === "caption" && other.for === block.id) return squash(other.text);
  }
  if (typeof block.caption === "string") {
    const hit = blocks[block.caption];
    return squash(hit ? hit.text : block.caption);
  }
  if (block.caption && typeof block.caption === "object") return squash(block.caption.text);
  return "";
}

function attachedCaptionIds(doc, block) {
  const ids = new Set();
  const blocks = doc?.blocks || {};
  if (!block) return ids;
  for (const id of orderOf(doc)) {
    if (blocks[id].type === "caption" && blocks[id].for === block.id) ids.add(id);
  }
  if (typeof block.caption === "string" && blocks[block.caption]) ids.add(block.caption);
  return ids;
}

const KIND_NAMES = { table: "Table", figure: "Figure", para: "Paragraph", list: "List", heading: "Heading", caption: "Caption", formula: "Formula", code: "Code", footnote: "Footnote", scan: "Scanned page" };

const LABEL_RE = /^((?:table|figure|fig\.?|chart|plate|exhibit)\s+[A-Za-z]?\d+(?:\.\d+)?[A-Za-z]?)/i;

function chipLabel(doc, block, selection) {
  if (selection) return "Selection";
  if (!block) return "Page";
  if (block.type === "table" || block.type === "figure" || block.type === "caption") {
    const cap = block.type === "caption" ? squash(block.text) : captionOf(doc, block);
    const m = LABEL_RE.exec(cap);
    if (m) return m[1].replace(/^fig\.?\s/i, "Figure ").replace(/\s+/g, " ");
  }
  if (block.type === "heading") return `Heading: ${clip(squash(block.text), 40)}`;
  return KIND_NAMES[block.type] || "Block";
}

// Find the block that holds a selection: same page first, then anywhere. Whitespace-insensitive.
export function findSelectionBlock(doc, selection, page = null) {
  const needle = squash(selection).toLowerCase();
  if (!needle) return null;
  const blocks = doc?.blocks || {};
  const probe = needle.length > 120 ? needle.slice(0, 120) : needle;
  const ids = orderOf(doc);
  const hit = (pool) => pool.find((id) => {
    const b = blocks[id];
    if (!b) return false;
    return blockText(b).toLowerCase().includes(probe);
  });
  if (page != null) {
    const found = hit(ids.filter((id) => blocks[id].page === page));
    if (found) return blocks[found];
  }
  const found = hit(ids);
  return found ? blocks[found] : null;
}

function sectionChain(doc, ids, index) {
  const blocks = doc.blocks;
  const stack = [];
  for (let i = 0; i <= index && i < ids.length; i += 1) {
    const b = blocks[ids[i]];
    if (b.type !== "heading") continue;
    const level = Math.max(1, Number(b.level) || 1);
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, text: squash(b.text), page: b.page });
  }
  return stack;
}

function outlineLines(doc, ids) {
  const blocks = doc.blocks;
  const heads = [];
  const items = [];
  for (const id of ids) {
    const b = blocks[id];
    if (b.type === "heading" && squash(b.text)) {
      const level = Math.min(Math.max(Number(b.level) || 1, 1), 6);
      heads.push({ level, line: `${"  ".repeat(level - 1)}- ${clip(squash(b.text), 100)} (p. ${b.page})` });
    } else if (b.type === "table" || b.type === "figure") {
      const cap = captionOf(doc, b);
      items.push(`- ${b.type === "table" ? "Table" : "Figure"}: ${cap ? clip(cap, 110) : "(no caption)"} (p. ${b.page})`);
    }
  }
  return { heads, items };
}

function fitOutline(doc, ids, maxChars) {
  const { heads, items } = outlineLines(doc, ids);
  if (maxChars <= 0) return "";
  const out = [];
  let used = 0;
  const push = (line) => {
    if (used + line.length + 1 > maxChars) return false;
    out.push(line);
    used += line.length + 1;
    return true;
  };
  // Shallow headings first so a trimmed outline still shows the shape of the document.
  const kept = new Set();
  for (let level = 1; level <= 6; level += 1) {
    for (let i = 0; i < heads.length; i += 1) {
      if (heads[i].level !== level) continue;
      if (used + heads[i].line.length + 1 > maxChars - 60) break;
      kept.add(i);
      used += heads[i].line.length + 1;
    }
  }
  used = 0;
  out.push("Headings:");
  used += 10;
  let skipped = 0;
  heads.forEach((h, i) => { if (kept.has(i)) push(h.line); else skipped += 1; });
  if (skipped) push(`- …${skipped} more headings`);
  if (items.length) {
    push("Tables and figures:");
    let shown = 0;
    for (const line of items) {
      if (!push(line)) break;
      shown += 1;
    }
    if (shown < items.length) push(`- …${items.length - shown} more`);
  }
  return out.join("\n");
}

function nearbyText(doc, ids, index, focusIds, budget, paras) {
  if (budget <= 0 || index < 0) return "";
  const blocks = doc.blocks;
  const usable = (id) => {
    if (focusIds.has(id)) return false;
    const b = blocks[id];
    return (b.type === "para" || b.type === "list") && blockText(b);
  };
  const before = [];
  for (let i = index - 1; i >= 0 && before.length < paras; i -= 1) if (usable(ids[i])) before.push(ids[i]);
  const after = [];
  for (let i = index + 1; i < ids.length && after.length < paras; i += 1) if (usable(ids[i])) after.push(ids[i]);
  // Nearest first, alternating sides, until the budget is spent.
  const pick = [];
  for (let k = 0; k < paras; k += 1) {
    if (before[k]) pick.push({ id: before[k], side: "before" });
    if (after[k]) pick.push({ id: after[k], side: "after" });
  }
  const chosen = [];
  let used = 0;
  for (const { id, side } of pick) {
    const b = blocks[id];
    const room = budget - used;
    if (room < 80) break;
    const text = clip(blockText(b), Math.min(PARA_CLIP, room - 30));
    const line = `[p. ${b.page}] ${text}`;
    used += line.length + 2;
    chosen.push({ id, side, line });
  }
  const pos = (id) => ids.indexOf(id);
  chosen.sort((a, b) => pos(a.id) - pos(b.id));
  return chosen.map((c) => c.line).join("\n\n");
}

function focusBody(doc, block) {
  if (!block) return "";
  if (block.type === "table") {
    const md = tableToMarkdown(block);
    const cap = captionOf(doc, block);
    return [cap ? `Caption: ${cap}` : "", md || "(table with no readable cells)"].filter(Boolean).join("\n\n");
  }
  if (block.type === "figure") {
    const cap = captionOf(doc, block);
    const inner = squash(block.text);
    return [`Figure caption: ${cap || "(none)"}`, inner && inner !== cap ? `Text inside the figure: ${inner}` : ""].filter(Boolean).join("\n");
  }
  if (block.type === "list") {
    return (block.items || []).map((item, i) => `${block.ordered ? `${i + 1}.` : "-"} ${squash(item.text)}`).join("\n");
  }
  if (block.type === "formula") return block.latex ? `$$${block.latex}$$` : squash(block.text);
  if (block.type === "code") return `\`\`\`\n${block.text ?? ""}\n\`\`\``;
  return squash(block.text ?? "");
}

function pageFocus(doc, ids, page) {
  const parts = [];
  for (const id of ids) {
    const b = doc.blocks[id];
    if (b.page !== page) continue;
    const text = focusBody(doc, b);
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

// focus: { blockId } | { blockId, selection } | { selection, page? } | { blockIds } | { page }.
// Returns { chip: { label, page, docTitle }, context, instructions, prompt, tokensEstimate, focusIds }.
export function buildFocusContext(doc, focus = {}, opts = {}) {
  const cap = (Number(opts.tokenCap) > 0 ? Number(opts.tokenCap) : CONTEXT_TOKEN_CAP) * CHARS_PER_TOKEN;
  const outlineCap = (Number(opts.outlineTokens) > 0 ? Number(opts.outlineTokens) : OUTLINE_TOKEN_CAP) * CHARS_PER_TOKEN;
  const nearbyCap = Number(opts.nearbyChars) >= 0 ? Number(opts.nearbyChars) : NEARBY_CHAR_BUDGET;
  const paras = Number.isInteger(opts.nearbyParas) && opts.nearbyParas >= 0 ? opts.nearbyParas : NEARBY_PARAS;
  const safe = doc && typeof doc === "object" ? doc : { blocks: {}, order: [] };
  const ids = orderOf(safe);
  const blocks = safe.blocks || {};
  const selection = squash(focus.selection);

  let block = focus.blockId ? blocks[focus.blockId] || null : null;
  if (!block && Array.isArray(focus.blockIds)) block = blocks[focus.blockIds.find((id) => blocks[id])] || null;
  if (!block && selection) block = findSelectionBlock(safe, selection, focus.page ?? null);
  const page = block ? block.page : (Number.isInteger(focus.page) ? focus.page : null);
  const extraIds = Array.isArray(focus.blockIds) ? focus.blockIds.filter((id) => blocks[id]) : [];
  const focusIds = new Set(extraIds.length ? extraIds : block ? [block.id] : []);
  for (const id of attachedCaptionIds(safe, block)) focusIds.add(id);
  const index = block ? ids.indexOf(block.id) : -1;

  const docTitle = parsedDocTitle(safe) || squash(safe.title) || "";

  let focusText = "";
  if (selection) {
    focusText = `Selected text:\n> ${clip(selection, 6000)}`;
    if (block && squash(blockText(block)) !== selection) {
      focusText += `\n\nThe block that contains it (${KIND_NAMES[block.type] || "block"}, p. ${block.page}):\n${focusBody(safe, block)}`;
    }
  } else if (extraIds.length > 1) {
    focusText = extraIds.map((id) => focusBody(safe, blocks[id])).filter(Boolean).join("\n\n");
  } else if (block) {
    focusText = focusBody(safe, block);
  } else if (page != null) {
    focusText = pageFocus(safe, ids, page);
  }

  const chain = block ? sectionChain(safe, ids, index) : [];
  const sectionText = chain.length
    ? `${chain.map((h) => h.text).join(" > ")} (starts p. ${chain[chain.length - 1].page})`
    : "(before the first heading, or no headings found)";

  const pageCount = Array.isArray(safe.pages) && safe.pages.length ? safe.pages.length : Number(safe.stats?.pages) || (ids.length ? Math.max(...ids.map((id) => blocks[id].page || 1)) : 0);

  const header = (name) => `=== ${name} ===`;
  const section = `${header("SECTION")}\n${sectionText}`;
  const focusHead = block
    ? `${header("FOCUS")}\n(${KIND_NAMES[block.type] || "Block"}, p. ${block.page})`
    : `${header("FOCUS")}\n(${page != null ? `page ${page}` : "no part found"})`;

  // Fixed parts first. The focus keeps its room; nearby and then the outline give way.
  const fixedChars = section.length + focusHead.length + 400;
  const focusRoom = Math.max(400, cap - fixedChars - 200);
  const focusBounded = focusText.length > focusRoom ? `${focusText.slice(0, focusRoom).trimEnd()}\n[focus trimmed to fit]` : focusText;
  const afterFixed = Math.max(0, cap - fixedChars - focusBounded.length);

  const nearbyBudget = Math.min(nearbyCap, afterFixed);
  const nearbyBody = nearbyText(safe, ids, index, focusIds, nearbyBudget, paras);
  const captionNear = block && (block.type === "table" || block.type === "figure") ? captionOf(safe, block) : "";
  const nearby = nearbyBody || captionNear
    ? `${header("NEARBY")}\n${[captionNear ? `Caption of the focus: ${captionNear}` : "", nearbyBody].filter(Boolean).join("\n\n")}`
    : "";

  const outlineRoom = Math.min(outlineCap, Math.max(0, afterFixed - nearby.length - 120));
  const outline = fitOutline(safe, ids, outlineRoom);
  const documentPart = `${header("DOCUMENT")}\nTitle: ${docTitle || "(untitled)"}\nPages: ${pageCount || "?"}${outline ? `\n\n${outline}` : ""}`;

  const context = [documentPart, section, nearby, `${focusHead}\n${focusBounded}`].filter(Boolean).join("\n\n");

  return {
    chip: { label: chipLabel(safe, block, selection), page, docTitle },
    context,
    instructions: INSTRUCTIONS,
    prompt: DEFAULT_PROMPT,
    tokensEstimate: estimateTokens(context) + estimateTokens(INSTRUCTIONS),
    focusIds: [...focusIds],
  };
}

// "Table 3 · p. 14 · Annual report"
export function chipText(chip) {
  if (!chip) return "";
  return [chip.label, chip.page != null ? `p. ${chip.page}` : "", chip.docTitle].filter(Boolean).join(" · ");
}

// The exact payload the dialog sends, as one readable string for the preview.
export function previewText({ instructions = "", context = "", prompt = "" } = {}) {
  return [`--- instructions ---\n${instructions}`, `--- context ---\n${context}`, `--- question ---\n${prompt}`].join("\n\n");
}

// A stand-in document for a selection with no parse behind it.
export function selectionDoc({ text = "", page = 1, title = "" } = {}) {
  const body = squash(text);
  return {
    schema: "pxd-parse/1",
    title,
    pages: [{ n: page }],
    order: ["sel"],
    blocks: { sel: { id: "sel", type: "para", page, text: body } },
  };
}

// "[p. 14]" and "[p. 3, 7]" in an answer -> pieces for the view to turn into links.
export function splitCitations(text) {
  const out = [];
  const re = /\[(?:p|pp)\.\s*(\d+(?:\s*[,–-]\s*\d+)*)\]/gi;
  let last = 0;
  let m;
  const src = String(text ?? "");
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ text: src.slice(last, m.index) });
    const pages = (m[1].match(/\d+/g) || []).map(Number);
    out.push({ text: m[0], page: pages[0], pages });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}

// The card for an answer: one header bullet, then one bullet per paragraph of the answer.
export function answerCardMarkdown({ answer = "", chip = null } = {}) {
  const paras = String(answer ?? "").split(/\n\s*\n/).map((p) => flattenLine(p)).filter(Boolean);
  if (!paras.length) return "";
  const head = `AI answer · ${chipText(chip) || "PDF"}`;
  const line = (text, leading) => `- ${escapeMarkdownText(linkSafeText(clip(text, 1800)), { leading })}`;
  return [line(head, true), ...paras.slice(0, 40).map((p) => line(p, true))].join("\n");
}

// Ask AI. Pure. Builds the text a model gets for one part of a parsed PDF: the part itself (Selected part), the
// words around it (Nearby text), the heading chain it sits in (Section), and a short map of the whole
// document (Document outline). Nothing here touches the DOM, the network, or Roam.

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
  "Analyse the part under \"Selected part\". Use \"Document outline\", \"Section\" and \"Nearby text\" only to interpret it, not as the subject.",
  "Cite pages as [p. N] using the page numbers shown in the context.",
  "If the selected part alone does not support a claim, say so instead of filling the gap from elsewhere.",
  "Refer to the selected part as 'this table', 'this paragraph' or 'this figure' (as appropriate); never mention section labels.",
].join("\n");

export const DOC_INSTRUCTIONS = [
  "You are helping someone read a PDF as a whole.",
  "Answer about the document as a whole. Use \"Document outline\" to locate things, and \"Relevant parts of the document\" for what the document says.",
  "Cite pages as [p. N] using the page numbers shown in the context.",
  "The parts under \"Relevant parts of the document\" were chosen for the question and are not the whole document. When they do not cover something, say so instead of filling the gap from elsewhere.",
  "Refer to it as 'this document'; never mention section labels.",
].join("\n");

// Added to the instructions only when the model is actually sent the picture.
export const FIGURE_INSTRUCTIONS = [
  "The context starts with the image of the selected part. Look at it.",
  "Read values off the chart: axes and their units, series or legend entries, and notable points (peaks, drops, crossings).",
  "Say when something is not legible instead of guessing. Do not invent numbers that are not visible; mark estimates read off a scale as approximate.",
  "Cite [p. N] for claims that rest on the document text; the caption and nearby text are in the context.",
].join("\n");

export const withImageInstructions = (instructions) => `${instructions}\n${FIGURE_INSTRUCTIONS}`;

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

const STOPWORDS = new Set("a an and are as at be but by for from has have he her his how i if in into is it its of on or our she so than that the their them then there these they this to was we were what when where which who why will with you your do does did can could should would not no".split(" "));
// Words of a "summarize this document" style request; a question made only of these asks for no topic.
const GENERIC_WORDS = new Set("summarize summarise summary overview describe explain tell me about document pdf paper report file main key points point plain language simple simply words sentences sentence three five short brief briefly give list whole entire all".split(" "));

export function tokenize(text) {
  const out = [];
  for (const w of String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    if (w.length >= 2 && !STOPWORDS.has(w)) out.push(w);
  }
  return out;
}

export function isGenericQuestion(question) {
  const words = tokenize(question);
  return !words.length || words.every((w) => GENERIC_WORDS.has(w));
}

const TABLE_CLIP = 3000;

// Parts of the whole document for retrieval: every block with text except captions that belong to a table or figure.
function retrievalParts(doc, ids) {
  const blocks = doc.blocks;
  const caps = new Map();
  const attached = new Set();
  for (const id of ids) {
    const b = blocks[id];
    if (b.type === "caption" && b.for && blocks[b.for] && !caps.has(b.for)) { caps.set(b.for, squash(b.text)); attached.add(id); }
  }
  const parts = [];
  ids.forEach((id, order) => {
    if (attached.has(id)) return;
    const b = blocks[id];
    let cap = "";
    if (b.type === "table" || b.type === "figure") {
      cap = caps.get(id) || "";
      if (!cap && typeof b.caption === "string") { const hit = blocks[b.caption]; cap = squash(hit ? hit.text : b.caption); }
      else if (!cap && b.caption && typeof b.caption === "object") cap = squash(b.caption.text);
    }
    const text = blockText(b);
    const scored = cap ? `${cap} ${text}` : text;
    if (!scored) return;
    parts.push({ id, order, block: b, cap, tokens: tokenize(scored) });
  });
  return parts;
}

function bm25(parts, queryTokens) {
  const k1 = 1.2;
  const b = 0.75;
  const uniq = [...new Set(queryTokens)];
  const n = parts.length;
  const df = new Map(uniq.map((t) => [t, 0]));
  let total = 0;
  const tfs = parts.map((part) => {
    total += part.tokens.length;
    const tf = new Map();
    for (const t of part.tokens) if (df.has(t)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, df.get(t) + 1);
    return tf;
  });
  const avg = total / Math.max(1, n);
  return parts.map((part, i) => {
    const tf = tfs[i];
    if (!tf.size) return 0;
    const len = part.tokens.length;
    let score = 0;
    for (const [t, f] of tf) {
      const d = df.get(t);
      const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (len / avg))));
    }
    return score;
  });
}

function renderPart(part) {
  const b = part.block;
  const kind = KIND_NAMES[b.type] || "Block";
  let body = focusBody(null, b);
  if (b.type === "table") {
    const md = tableToMarkdown(b);
    body = [part.cap ? `Caption: ${part.cap}` : "", md || "(table with no readable cells)"].filter(Boolean).join("\n");
  } else if (b.type === "figure") {
    const inner = squash(b.text);
    body = [`Figure caption: ${part.cap || "(none)"}`, inner && inner !== part.cap ? `Text inside the figure: ${inner}` : ""].filter(Boolean).join("\n");
  }
  return `${kind} [p. ${b.page}] ${clip(body, b.type === "table" ? TABLE_CLIP : PARA_CLIP)}`;
}

// Question-aware text from the whole document, whole parts in reading order, until the budget is spent.
// Always: the title heading, the first paragraph, an abstract. Then top BM25 parts (or a spread for a generic question).
function relevantParts(doc, ids, question, budget) {
  const parts = retrievalParts(doc, ids);
  if (!parts.length) return "";
  const rendered = new Map();
  const line = (part) => {
    let text = rendered.get(part.id);
    if (text == null) { text = renderPart(part); rendered.set(part.id, text); }
    return text;
  };
  const picked = new Set();
  let used = 0;
  const take = (part, force = false) => {
    if (picked.has(part.id)) return true;
    const text = line(part);
    if (!force && used + text.length + 2 > budget) return false;
    picked.add(part.id);
    used += text.length + 2;
    return true;
  };

  const firstHeading = parts.find((p) => p.block.type === "heading");
  if (firstHeading) take(firstHeading);
  const firstPara = parts.find((p) => p.block.type === "para");
  if (firstPara) take(firstPara);
  const abstractAt = parts.findIndex((p) => p.block.type === "heading" && /^\s*(abstract|summary|executive summary)\b/i.test(p.block.text || ""));
  if (abstractAt >= 0) { const next = parts.slice(abstractAt + 1).find((p) => p.block.type === "para"); if (next) take(next); }

  const generic = isGenericQuestion(question);
  if (!generic) {
    const scores = bm25(parts, tokenize(question));
    const ranked = parts.map((part, i) => ({ part, score: scores[i] })).filter((r) => r.score > 0).sort((x, y) => y.score - x.score || x.part.order - y.part.order);
    for (const { part } of ranked) {
      if (picked.has(part.id)) continue;
      take(part);
      if (used >= budget - 80) break;
    }
  }
  if (generic || picked.size <= 3) {
    // Spread: the first paragraph under each top-level heading, then every table and figure caption.
    const headLevels = parts.filter((p) => p.block.type === "heading").map((p) => Math.max(1, Number(p.block.level) || 1));
    const top = headLevels.length ? Math.min(...headLevels) : 1;
    const topLevel = top === 1 && headLevels.filter((l) => l === 1).length <= 1 ? 2 : top;
    let afterTop = false;
    for (const part of parts) {
      const b = part.block;
      if (b.type === "heading") afterTop = (Number(b.level) || 1) <= topLevel;
      else if (afterTop && (b.type === "para" || b.type === "list")) { take(part); afterTop = false; }
    }
    for (const part of parts) {
      if (part.block.type === "table" || part.block.type === "figure") take(part);
    }
    for (const part of parts) {
      if (used >= budget - 80) break;
      if (part.block.type !== "caption") take(part);
    }
  }
  return parts.filter((p) => picked.has(p.id)).map(line).join("\n\n");
}

// focus: { blockId } | { blockId, selection } | { selection, page? } | { blockIds } | { page } | { wholeDoc: true }.
// Returns { chip: { label, page, docTitle }, context, instructions, prompt, tokensEstimate, focusIds }.
export function buildFocusContext(doc, focus = {}, opts = {}) {
  // The instructions travel with the context, so they come out of the same budget.
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
  const noPages = safe.noPages === true;
  const page = noPages ? null : block ? block.page : (Number.isInteger(focus.page) ? focus.page : null);
  const extraIds = Array.isArray(focus.blockIds) ? focus.blockIds.filter((id) => blocks[id]) : [];
  const focusIds = new Set(extraIds.length ? extraIds : block ? [block.id] : []);
  for (const id of attachedCaptionIds(safe, block)) focusIds.add(id);
  const index = block ? ids.indexOf(block.id) : -1;
  const wholeDoc = focus.wholeDoc === true && !block && !selection && !Number.isInteger(focus.page);

  const instructions = wholeDoc ? DOC_INSTRUCTIONS : INSTRUCTIONS;
  const cap = (Number(opts.tokenCap) > 0 ? Number(opts.tokenCap) : CONTEXT_TOKEN_CAP) * CHARS_PER_TOKEN - instructions.length;

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
  } else if (wholeDoc) {
    // The outline rides in the document outline; the selected part is the opening text, leaving that room free.
    focusText = relevantParts(safe, ids, opts.question ?? focus.question ?? "", Math.max(400, cap - outlineCap - 1000));
  }

  const chain = block ? sectionChain(safe, ids, index) : [];
  const sectionText = chain.length
    ? `${chain.map((h) => h.text).join(" > ")} (starts p. ${chain[chain.length - 1].page})`
    : "(before the first heading, or no headings found)";

  const pageCount = Array.isArray(safe.pages) && safe.pages.length ? safe.pages.length : Number(safe.stats?.pages) || (ids.length ? Math.max(...ids.map((id) => blocks[id].page || 1)) : 0);

  const header = (name) => `=== ${name} ===`;
  const section = `${header("Section")}\n${sectionText}`;
  const focusHead = block
    ? `${header("Selected part")}\n(${KIND_NAMES[block.type] || "Block"}${noPages ? "" : `, p. ${block.page}`})`
    : wholeDoc
      ? `${header("Relevant parts of the document")}`
      : `${header("Selected part")}\n(${page != null ? `page ${page}` : "no part found"})`;

  // Fixed parts first. The focus keeps its room; nearby and then the outline give way.
  const fixedChars = section.length + focusHead.length + 400;
  const focusRoom = Math.max(400, cap - fixedChars - 200);
  const focusBounded = focusText.length > focusRoom ? `${focusText.slice(0, focusRoom).trimEnd()}\n[focus trimmed to fit]` : focusText;
  const afterFixed = Math.max(0, cap - fixedChars - focusBounded.length);

  const nearbyBudget = Math.min(nearbyCap, afterFixed);
  const nearbyBody = nearbyText(safe, ids, index, focusIds, nearbyBudget, paras);
  const captionNear = block && (block.type === "table" || block.type === "figure") ? captionOf(safe, block) : "";
  const nearby = nearbyBody || captionNear
    ? `${header("Nearby text")}\n${[captionNear ? `Caption of the selected part: ${captionNear}` : "", nearbyBody].filter(Boolean).join("\n\n")}`
    : "";

  const outlineRoom = Math.min(outlineCap, Math.max(0, afterFixed - nearby.length - 120));
  const outline = noPages ? "" : fitOutline(safe, ids, outlineRoom);
  const documentPart = `${header("Document outline")}\nTitle: ${docTitle || "(untitled)"}${noPages ? "" : `\nPages: ${pageCount || "?"}`}${outline ? `\n\n${outline}` : ""}`;

  const context = [documentPart, section, nearby, `${focusHead}\n${focusBounded}`].filter(Boolean).join("\n\n");

  return {
    chip: { label: wholeDoc ? docTitle || "Document" : chipLabel(safe, block, selection), page, docTitle: wholeDoc ? "" : docTitle },
    context,
    instructions,
    prompt: wholeDoc ? "Summarize this document in plain language." : DEFAULT_PROMPT,
    tokensEstimate: estimateTokens(context) + estimateTokens(instructions),
    focusIds: [...focusIds],
    figure: block && block.type === "figure" ? { caption: captionOf(safe, block) } : null,
  };
}

// A caption fit for `![alt](url)`: no brackets, parens, "!" or line breaks, so it stays one match of Roam's image pattern.
export function imageAlt(caption, fallback = "Figure") {
  const text = squash(String(caption ?? "").replace(/[[\]()!]/g, " "));
  return clip(text, 120) || fallback;
}

export const imageLine = (url, caption, fallback) => `![${imageAlt(caption, fallback)}](${String(url ?? "").trim()})`;

// Live AI turns an image line into a real image for Claude only inside the context, so the context carries the line (first, on its own line).
export function contextWithImage(context, url, caption, fallback) {
  const c = String(context ?? "");
  return url ? `Image of the selected part:\n${imageLine(url, caption, fallback)}\n\n${c}` : c;
}

export const IMAGE_QUESTION_PREFIX = "Look at the image of the selected part. ";

// The prompt stays plain text; with an image it points at the one in the context.
export function promptWithImage(question, url) {
  const q = String(question ?? "");
  return url ? `${IMAGE_QUESTION_PREFIX}${q}` : q;
}

// A stand-in document for one image on a board: its own words and the page it sits on, no PDF pages.
export function imageDoc({ caption = "", title = "" } = {}) {
  return {
    schema: "pxd-parse/1",
    title,
    noPages: true,
    pages: [{ n: 1 }],
    order: ["img"],
    blocks: { img: { id: "img", type: "figure", page: 1, caption: squash(caption), text: "" } },
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

// An answer split into paragraphs and lists: [{ type: "p", text } | { type: "list", ordered, items: [{ text, depth }] }].
export function parseAnswer(answer) {
  const out = [];
  let para = [];
  let list = null;
  let stack = [];
  const flush = () => {
    const text = para.join(" ").trim();
    if (text) out.push({ type: "p", text });
    para = [];
  };
  const endList = () => { list = null; stack = []; };
  for (const raw of String(answer ?? "").replace(/\r/g, "").split("\n")) {
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (item) {
      flush();
      const indent = item[1].replace(/\t/g, "  ").length;
      const ordered = /\d/.test(item[2]);
      if (!list || (stack.length <= 1 && indent <= stack[0] && list.ordered !== ordered)) {
        list = { type: "list", ordered, items: [] };
        stack = [];
        out.push(list);
      }
      while (stack.length && stack[stack.length - 1] >= indent) stack.pop();
      stack.push(indent);
      const text = item[3].trim();
      if (text) list.items.push({ text, depth: stack.length - 1 });
    } else if (!raw.trim()) {
      flush();
      endList();
    } else if (list && /^\s+/.test(raw) && list.items.length) {
      const last = list.items[list.items.length - 1];
      last.text = `${last.text} ${raw.trim()}`;
    } else {
      endList();
      para.push(raw.trim());
    }
  }
  flush();
  return out;
}

// An answer as Roam blocks: a paragraph is one block, a list item is one block (nested by indent).
// Returns [{ text, depth }].
export function answerBlocks(answer) {
  const out = [];
  for (const part of parseAnswer(answer)) {
    if (part.type === "p") out.push({ text: part.text, depth: 0 });
    else for (const item of part.items) out.push({ text: item.text, depth: item.depth });
  }
  return out;
}

// The card for an answer: one header bullet, then one bullet per paragraph or list item (indented for nesting).
// With imageUrl (an image the model was sent), the first child is that image, so the card shows what the model saw.
export function answerCardMarkdown({ answer = "", chip = null, imageUrl = "" } = {}) {
  const blocks = answerBlocks(answer).map((b) => ({ ...b, text: flattenLine(b.text) })).filter((b) => b.text);
  if (!blocks.length) return "";
  const head = `AI answer · ${chipText(chip) || "PDF"}`;
  const line = (text, depth = 0) => `${"  ".repeat(depth)}- ${escapeMarkdownText(linkSafeText(clip(text, 1800)), { leading: true })}`;
  const image = imageUrl ? [`  - ![](${String(imageUrl).trim()})`] : [];
  return [line(head), ...image, ...blocks.slice(0, 40).map((b) => line(b.text, Math.min(b.depth, 3)))].join("\n");
}

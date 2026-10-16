// PDF source pins. A pin is a plexus-pin block (kind "pdf") under the PDF block. This module plans
// strings, dedupe, clipboard payloads, and write counts. It does not touch the graph.

import { graphFromDeepLink, pageUidFromHash } from "./deeplink.js";
import { normalizeFrac, parseRegion, PIN_CONTAINER_STRING, serializeRegion } from "./regions.js";
import { viewportBox } from "../view/parse-overlay.js";

export const PIN_IOU = 0.9;
export const CAPTION_CAP = 300;
export const WITH_SOURCE_KEY = "plexus-diagram:with-source";
export const CARD_JSON_MIME = "application/x-plexus-card+json";
export const PIN_BOARDS_QUERY = "[:find ?b ?s :in $ ?pin :where [?c :block/refs ?pin] [?card :block/children ?c] [?b :block/children ?card] [?b :block/string ?s]]";

const UID_RE = /^[\w-]{1,32}$/;
const SOURCE_RE = /^Source::\s*\(\(([\w-]{1,32})\)\)\s*$/;
const DIAGRAM_RE = /\{\{(?:\[\[)?diagram(?:\]\])?/;

export const COPY_MENU = Object.freeze([
  { id: "copy", label: "Copy", keys: "⌘C" },
  { id: "plain", label: "Copy as plain text", keys: "⇧⌘C" },
  { id: "card", label: "Copy as card", keys: "⌥⌘C" },
  { id: "source", label: "Copy with source", keys: "⌥⇧⌘C" },
  { id: "crop", label: "Copy crop as image", keys: "" },
  { id: "link", label: "Copy link", keys: "" },
]);

const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

function rectOf(frac) {
  if (Array.isArray(frac) && frac.length >= 4) return { x: Number(frac[0]), y: Number(frac[1]), w: Number(frac[2]), h: Number(frac[3]) };
  if (!frac || typeof frac !== "object") return null;
  if ("rx" in frac) return { x: Number(frac.rx), y: Number(frac.ry), w: Number(frac.rw), h: Number(frac.rh) };
  return { x: Number(frac.x), y: Number(frac.y), w: Number(frac.w), h: Number(frac.h) };
}

function finiteRect(frac) {
  const box = rectOf(frac);
  if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite) || !(box.w > 0) || !(box.h > 0)) return null;
  return box;
}

function rectArea(frac) {
  const box = finiteRect(frac);
  return box ? box.w * box.h : 0;
}

function overlapArea(a, b) {
  const A = finiteRect(a);
  const B = finiteRect(b);
  if (!A || !B) return 0;
  const iw = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
  const ih = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
  if (iw <= 0 || ih <= 0) return 0;
  return iw * ih;
}

function centreInside(hit, block) {
  const H = finiteRect(hit);
  const B = finiteRect(block);
  if (!H || !B) return false;
  const cx = H.x + H.w / 2;
  const cy = H.y + H.h / 2;
  return cx >= B.x && cx <= B.x + B.w && cy >= B.y && cy <= B.y + B.h;
}

// A page-sized hit covers every block. Coverage counts only when the two areas are in the same neighbourhood.
const COVER_AREA_SLACK = 4;

function smallerMostlyCovered(hit, block, min) {
  const inter = overlapArea(hit, block);
  const hitArea = rectArea(hit);
  const blockArea = rectArea(block);
  const smaller = Math.min(hitArea, blockArea);
  if (!(inter > 0) || !(smaller > 0) || !(inter / smaller > min)) return false;
  return Math.max(hitArea, blockArea) <= smaller * COVER_AREA_SLACK;
}

function tableSize(block) {
  const grid = block?.grid;
  let rows = Number(block?.rows) || (Array.isArray(grid?.ys) ? grid.ys.length - 1 : 0);
  let cols = Number(block?.cols) || (Array.isArray(grid?.xs) ? grid.xs.length - 1 : 0);
  if (!(rows > 0) || !(cols > 0)) {
    for (const cell of block?.cells || []) {
      rows = Math.max(rows, (Number(cell.row) || 0) + (Number(cell.rowSpan) || 1));
      cols = Math.max(cols, (Number(cell.col) || 0) + (Number(cell.colSpan) || 1));
    }
  }
  return { rows: Math.max(0, rows), cols: Math.max(0, cols) };
}

export function pageFracFromBbox(bbox, page) {
  const at = viewportBox(bbox, page);
  if (!at) return null;
  const { box, vw, vh } = at;
  if (!(vw > 0) || !(vh > 0)) return null;
  return normalizeFrac([box[0] / vw, box[1] / vh, (box[2] - box[0]) / vw, (box[3] - box[1]) / vh]);
}

export function pinCaption(block, doc) {
  if (!block || typeof block !== "object") return "";
  if (block.type === "table") {
    const order = Array.isArray(doc?.order) ? doc.order : [];
    let n = 0;
    for (const id of order) {
      if (doc?.blocks?.[id]?.type === "table") n += 1;
      if (id === block.id) break;
    }
    if (n < 1) n = 1;
    const { rows, cols } = tableSize(block);
    const size = rows && cols ? ` · ${rows}×${cols}` : "";
    const page = Number(block.page) || 0;
    return squash(`Table ${n}${size}, p. ${page}`);
  }
  if (block.type === "figure" || block.type === "formula") {
    let caption = "";
    const named = block.caption;
    if (typeof named === "string" && named && doc?.blocks?.[named]?.text) caption = doc.blocks[named].text;
    else if (typeof named === "string" && named && !doc?.blocks?.[named]) caption = named;
    else {
      for (const other of Object.values(doc?.blocks || {})) {
        if (other?.type === "caption" && other.for === block.id && other.text) { caption = other.text; break; }
      }
    }
    return squash(caption).slice(0, CAPTION_CAP);
  }
  return squash(block.text || block.latex || "").slice(0, CAPTION_CAP);
}

// One card face: the figure (or a formula crop) and its caption on the same line.
// A missing URL keeps the caption, so a copy still has words when the crop was not uploaded.
export function figureCardMarkdown(block, doc) {
  if (!block || (block.type !== "figure" && !(block.type === "formula" && !block.latex))) return "";
  const caption = pinCaption(block, doc);
  const url = String(block.image?.url || block.url || "").trim();
  if (!url) return caption;
  let alt = caption.replace(/\]/g, "").trim();
  if (alt.length > 80) alt = alt.slice(0, 80).trim();
  if (!alt) alt = block.type === "formula" ? "Formula" : "Figure";
  const image = `![${alt}](${url})`;
  return caption ? `${image} ${caption}` : image;
}

// A pasted figure is a note card: the image, the caption lines, and the Source chip share one height.
// Width stays 280. A bare crop matches figureCardSize. A caption or a chip grows the card, capped at 520.
const FIGURE_COPY_W = 280;
const FIGURE_COPY_PAD = 26;
const FIGURE_COPY_LINE = 20;
const FIGURE_COPY_CHIP = 28;
const FIGURE_COPY_CHARS = 42;
const FIGURE_COPY_MAX_LINES = 6;
const FIGURE_COPY_IMAGE_CAP = 360;
const FIGURE_COPY_IMAGE_MIN = 72;
// A copied image with no crop box. 72px clips a real picture under a two-line caption.
const FIGURE_COPY_IMAGE_SLOT = 200;
const FIGURE_COPY_MAX = 520;

export function figureCopySize(block, doc, { source = false } = {}) {
  const caption = pinCaption(block, doc);
  const lines = caption
    ? Math.min(FIGURE_COPY_MAX_LINES, Math.max(1, Math.ceil(caption.length / FIGURE_COPY_CHARS)))
    : 0;
  const chip = source ? FIGURE_COPY_CHIP : 0;
  let image = 0;
  const box = block?.bbox;
  if (Array.isArray(box) && box.length >= 4) {
    const bw = Number(box[2]) - Number(box[0]);
    const bh = Number(box[3]) - Number(box[1]);
    if (bw > 0 && bh > 0) image = Math.round((FIGURE_COPY_W - FIGURE_COPY_PAD) * (bh / bw));
  }
  if (!(image > 0)) {
    const url = String(block?.image?.url || block?.url || "").trim();
    image = url ? FIGURE_COPY_IMAGE_SLOT : FIGURE_COPY_IMAGE_MIN;
  } else image = Math.min(FIGURE_COPY_IMAGE_CAP, image);
  let h = FIGURE_COPY_PAD + image + lines * FIGURE_COPY_LINE + chip;
  if (h > FIGURE_COPY_MAX) {
    const keep = chip + (lines ? FIGURE_COPY_LINE : 0);
    const room = Math.max(FIGURE_COPY_IMAGE_MIN, FIGURE_COPY_MAX - FIGURE_COPY_PAD - keep);
    image = Math.min(image, room);
    const textRoom = FIGURE_COPY_MAX - FIGURE_COPY_PAD - image - chip;
    const fit = Math.max(lines ? 1 : 0, Math.min(lines, Math.floor(textRoom / FIGURE_COPY_LINE)));
    h = FIGURE_COPY_PAD + image + fit * FIGURE_COPY_LINE + chip;
    if (h > FIGURE_COPY_MAX) h = FIGURE_COPY_MAX;
  }
  return { w: FIGURE_COPY_W, h: Math.round(h) };
}

export function isSourceAttrString(text) {
  return SOURCE_RE.test(String(text ?? "").trim());
}

// The parsed block a pin's page and fraction land on. Captions are the figure's label, not a part.
// Two similar boxes still need IoU above `min`. A word-sized hit matches the tightest block whose
// box holds the hit centre, or the block when the smaller rect is mostly covered.
export function matchParsedBlock(doc, { page, frac } = {}, min = 0.5) {
  const pg = Number(page);
  if (!Number.isInteger(pg) || pg < 1 || !Array.isArray(frac) || frac.length < 4) return null;
  const info = (doc?.pages || []).find((row) => Number(row?.n) === pg) || { n: pg, w: 612, h: 792, rotation: 0 };
  let floor = Number(min);
  if (!Number.isFinite(floor)) floor = 0.5;
  let best = null;
  let score = floor;
  let tight = null;
  let tightArea = Infinity;
  const ids = Array.isArray(doc?.order) && doc.order.length ? doc.order : Object.keys(doc?.blocks || {});
  for (const id of ids) {
    const block = doc?.blocks?.[id];
    if (!block || block.type === "caption" || Number(block.page) !== pg || !Array.isArray(block.bbox)) continue;
    const box = pageFracFromBbox(block.bbox, info);
    if (!box) continue;
    const iou = rectIou(box, frac);
    if (iou > score) {
      score = iou;
      best = block;
    }
    const area = rectArea(box);
    if (!(area > 0) || area >= tightArea) continue;
    if (centreInside(frac, box) || smallerMostlyCovered(frac, box, floor)) {
      tight = block;
      tightArea = area;
    }
  }
  if (best) return best;
  return tight;
}

export function rectIou(a, b) {
  const inter = overlapArea(a, b);
  if (!(inter > 0)) return 0;
  const union = rectArea(a) + rectArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

export function findDuplicatePin(regions, { page, frac } = {}, min = PIN_IOU) {
  const pg = Number(page);
  if (!Number.isInteger(pg) || pg < 1 || !frac) return null;
  for (const region of regions || []) {
    if (!region || region.kind !== "pdf" || Number(region.pg) !== pg || !region.uid) continue;
    if (rectIou(region.f, frac) >= min) return region;
  }
  return null;
}

export function pinSpecFromBlock(block, doc, pdfUid) {
  const parent = typeof pdfUid === "string" ? pdfUid.trim() : "";
  if (!block || !parent) return null;
  const page = Number(block.page);
  if (!Number.isInteger(page) || page < 1) return null;
  const info = (doc?.pages || []).find((row) => row?.n === page) || null;
  const frac = pageFracFromBbox(block.bbox, info || { w: 612, h: 792, rotation: 0 });
  if (!frac) return null;
  return { pdfUid: parent, page, frac, caption: pinCaption(block, doc) };
}

// What an Ask AI answer card cites: a pin for one parsed block, the PDF block itself for a whole-document question.
export function answerSource({ doc, blockId = "", pdfUid = "", wholeDoc = false } = {}) {
  const uid = typeof pdfUid === "string" ? pdfUid.trim() : "";
  if (!uid) return {};
  if (wholeDoc) return UID_RE.test(uid) ? { sourceUid: uid } : {};
  const block = blockId ? doc?.blocks?.[blockId] : null;
  const pin = block ? pinSpecFromBlock(block, doc, uid) : null;
  return pin ? { pin } : {};
}

export function sourceAttrString(uid) {
  const id = String(uid ?? "").trim();
  if (!UID_RE.test(id)) return "";
  return `Source:: ((${id}))`;
}

const SOURCE_LINE_RE = /^(?:[-*]\s+)?Source::\s*\(\(([\w-]{1,32})\)\)\s*$/;
const SIZE_LINE_RE = /^(?:[-*]\s+)?pxd-size::\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/;

function blankBullet(line) {
  return /^[-*•]\s*$/.test(String(line ?? "").trim());
}

// One top-level bullet. A second top-level bullet becomes a child, so fromMarkdown cannot
// leave a sibling card on the board.
function oneBulletTree(text) {
  const kept = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim() || blankBullet(line)) continue;
    kept.push(line);
  }
  if (!kept.length) return "";
  const allBullets = kept.every((line) => /^\s*[-*]\s+/.test(line));
  if (allBullets) {
    let seen = 0;
    let start = -1;
    for (let i = 0; i < kept.length; i += 1) {
      if (/^- /.test(kept[i])) {
        seen += 1;
        if (seen === 2) { start = i; break; }
      }
    }
    if (start < 0) return kept.join("\n");
    // Indent the second bullet and every line under it, so a child stays a child.
    return kept.map((line, i) => (i >= start ? `  ${line}` : line)).join("\n");
  }
  const first = kept[0].replace(/^\s*[-*]\s+/, "").trim();
  const rest = kept.slice(1).map((line) => {
    const body = line.replace(/^\s*[-*]\s+/, "").trim();
    return body ? `  - ${body}` : "";
  }).filter(Boolean);
  return [`- ${first}`, ...rest].join("\n");
}

// Copy with source is one card. The citation is a child (sourceUid), never a second board card.
// An empty body keeps the citation as the only bullet, so paste does not also make a blank card.
export function planCopiedSource({ markdown = "", source = "" } = {}) {
  let pin = String(source ?? "").trim();
  if (!UID_RE.test(pin)) pin = "";
  let found = Boolean(pin);
  const body = [];
  for (const line of String(markdown ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const match = SOURCE_LINE_RE.exec(line.trim());
    if (match) {
      found = true;
      if (!pin) pin = match[1];
      continue;
    }
    body.push(line);
  }
  const text = oneBulletTree(body.join("\n"));
  if (!text && pin) return { markdown: `- ${sourceAttrString(pin)}`, sourceUid: "", sourced: true };
  return { markdown: text, sourceUid: text ? pin : "", sourced: found && Boolean(text || pin) };
}

// Pull the machine size line and the Source citation off the raw copy. They must not become bullets.
function splitMarks(markdown) {
  let sourceUid = "";
  let size = null;
  const body = [];
  for (const line of String(markdown ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const src = SOURCE_LINE_RE.exec(line.trim());
    if (src) {
      if (!sourceUid) sourceUid = src[1];
      continue;
    }
    const sized = SIZE_LINE_RE.exec(line.trim());
    if (sized) {
      const w = Number(sized[1]);
      const h = Number(sized[2]);
      if (w > 0 && h > 0) size = { w: Math.round(w), h: Math.round(h) };
      continue;
    }
    body.push(line);
  }
  return { body: body.join("\n"), sourceUid, size };
}

function isCropBlock(block) {
  return Boolean(block && (block.type === "figure" || (block.type === "formula" && !block.latex)));
}

function imageFace(text) {
  const body = String(text ?? "");
  const match = /!\[([^\]]*)\]\(([^)\s]+)\)/.exec(body);
  if (!match) return null;
  const caption = body.replace(/!\[[^\]]*\]\([^)]+\)/g, " ").replace(/\s+/g, " ").trim();
  return { url: match[2], caption, markdown: body.trim() };
}

// One plan for every copy, paste, drop, and chip insert. A figure carries a height that fits the
// picture, the caption, and the Source chip. A size line wins, because the custom clipboard MIME
// does not survive a live paste. Table detection is added on top of this same plan.
export function copiedPartPlan({ block = null, doc = null, markdown = "", source = "", withSource = false } = {}) {
  const split = splitMarks(markdown);
  let sourceUid = split.sourceUid;
  const given = String(source ?? "").trim();
  if (!sourceUid && UID_RE.test(given)) sourceUid = given;
  const sourced = Boolean(sourceUid) || withSource === true;
  const crop = isCropBlock(block);
  const face = imageFace(split.body);
  if (crop || face) {
    const live = crop ? block : { type: "figure", caption: face.caption, image: { url: face.url } };
    const text = (crop ? figureCardMarkdown(block, doc) : "") || face?.markdown || split.body.trim();
    const size = split.size || figureCopySize(live, crop ? doc : null, { source: sourced });
    return {
      kind: "card",
      markdown: text,
      sourceUid,
      size,
      sourced,
      sized: Boolean(split.size),
      image: true,
      caption: "",
      table: null,
    };
  }
  const copied = planCopiedSource({ markdown: split.body, source: sourceUid });
  return {
    kind: "card",
    markdown: copied.markdown,
    sourceUid: copied.sourceUid,
    size: split.size || { w: 280, h: 160 },
    sourced: copied.sourced,
    sized: Boolean(split.size),
    image: false,
    caption: "",
    table: null,
  };
}

// Plain text for Copy as card / Copy with source. The size rides in the text because the JSON MIME is dropped.
export function copyMenuPlan({ id, block = null, doc = null, markdown = "", source = "" } = {}) {
  if (id !== "source" && id !== "card") return null;
  const plan = copiedPartPlan({ block, doc, markdown, source, withSource: id === "source" });
  const raw = splitMarks(markdown).body.trim();
  const body = raw || plan.markdown;
  const lines = [];
  if (body) lines.push(body);
  if (plan.image && plan.size && plan.size.w > 0 && plan.size.h > 0) {
    lines.push(`pxd-size:: ${Math.round(plan.size.w)} ${Math.round(plan.size.h)}`);
  }
  const pin = id === "source" ? (UID_RE.test(String(source ?? "").trim()) ? String(source).trim() : plan.sourceUid) : "";
  const cite = sourceAttrString(pin);
  if (cite) lines.push(cite);
  return { ...plan, sourceUid: pin || plan.sourceUid, text: lines.join("\n") };
}

// A click on a card's ((pin)) ref. A pdf pin opens the reader at that region.
// Anything else stays a normal block or page ref.
export function refOpenPlan({ uid = "", string = "", shiftKey = false } = {}) {
  const id = String(uid ?? "").trim();
  const region = parseRegion(String(string ?? ""));
  if (region && region.kind === "pdf" && region.supported !== false) {
    region.uid = id || region.uid || "";
    const plan = pinOpenPlan(region);
    if (plan) return { kind: "pin", mode: shiftKey ? "sidebar" : "main", plan };
  }
  return { kind: shiftKey ? "sidebar" : "block", uid: id };
}

// Where the scroller must sit so the fraction's top lands at 30% of the view,
// the same place a highlight ref uses.
export function fracScrollTop({ frac, pageTop, pageHeight, viewTop, viewHeight, scrollTop } = {}) {
  if (!Array.isArray(frac) || frac.length < 2) return null;
  const yInPage = Number(frac[1]);
  const pageH = Number(pageHeight);
  const viewH = Number(viewHeight);
  if (!Number.isFinite(yInPage) || !(pageH > 0) || !(viewH > 0)) return null;
  const pageT = Number(pageTop) || 0;
  const viewT = Number(viewTop) || 0;
  const current = Number(scrollTop);
  const top = Number.isFinite(current) ? current : 0;
  const markTop = pageT + yInPage * pageH;
  return Math.max(0, top + (markTop - viewT) - viewH * 0.3);
}

let notedPin = null;

export function notePendingPin(pending) {
  if (!pending?.pinUid) { notedPin = null; return null; }
  notedPin = pending;
  return pending;
}

export function takePendingPin(now = 0) {
  const pending = notedPin;
  if (!pending) return null;
  notedPin = null;
  if (Number(now) > Number(pending.until)) return null;
  return pending;
}

export function sourcePinOf(children) {
  for (const child of children || []) {
    const text = String(child?.[":block/string"] ?? child?.string ?? "").trim();
    const match = SOURCE_RE.exec(text);
    if (!match) continue;
    return { uid: match[1], string: text };
  }
  return null;
}

export function gestureSource(stored, altKey) {
  const on = stored === true || stored === "1" || stored === 1;
  return altKey ? !on : on;
}

export function readWithSource(storage) {
  try { return storage?.getItem?.(WITH_SOURCE_KEY) === "1"; } catch { return false; }
}

export function writeWithSource(storage, on) {
  const next = Boolean(on);
  try { storage?.setItem?.(WITH_SOURCE_KEY, next ? "1" : "0"); } catch { /* private mode */ }
  return next;
}

function tableSnapshot(table) {
  if (!table || typeof table !== "object" || Array.isArray(table)) return null;
  const cells = [];
  for (const cell of Array.isArray(table.cells) ? table.cells : []) {
    if (!cell || typeof cell !== "object") continue;
    const row = {
      r: Number.isInteger(cell.r) ? cell.r : 0,
      c: Number.isInteger(cell.c) ? cell.c : 0,
      text: String(cell.text ?? ""),
    };
    if (Number.isInteger(cell.colSpan) && cell.colSpan > 1) row.colSpan = cell.colSpan;
    if (Number.isInteger(cell.rowSpan) && cell.rowSpan > 1) row.rowSpan = cell.rowSpan;
    cells.push(row);
  }
  const snap = { cells };
  if (Number.isInteger(table.rows)) snap.rows = table.rows;
  if (Number.isInteger(table.cols)) snap.cols = table.cols;
  if (table.grid && typeof table.grid === "object") snap.grid = table.grid;
  return snap;
}

export function cardJsonPayload({ markdown = "", size = null, kind = "card", source = "", table = null, caption = "" } = {}) {
  const body = {
    markdown: String(markdown ?? ""),
    size: { w: Number(size?.w) > 0 ? Number(size.w) : 280, h: Number(size?.h) > 0 ? Number(size.h) : 160 },
    kind: String(kind || "card"),
  };
  const pin = String(source ?? "").trim();
  if (UID_RE.test(pin)) body.source = pin;
  if (body.kind === "table") {
    const snap = tableSnapshot(table);
    if (snap) body.table = snap;
    const cap = String(caption ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (cap) body.caption = cap;
  }
  return body;
}

export function parseCardJson(raw) {
  let data = null;
  try { data = JSON.parse(String(raw ?? "")); } catch { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (typeof data.markdown !== "string" || !data.markdown.trim()) return null;
  return cardJsonPayload(data);
}

export function pasteCardPlan(data, point) {
  const parsed = data && typeof data === "object" && typeof data.markdown === "string" ? cardJsonPayload(data) : parseCardJson(data);
  if (!parsed) return null;
  const copied = planCopiedSource({ markdown: parsed.markdown, source: parsed.source || "" });
  if (!copied.markdown.trim()) return null;
  const plan = {
    x: Number.isFinite(point?.x) ? point.x : 0,
    y: Number.isFinite(point?.y) ? point.y : 0,
    w: parsed.size.w,
    h: parsed.size.h,
    markdown: copied.markdown,
    sourceUid: copied.sourceUid || "",
  };
  if (parsed.kind === "table" && parsed.table) {
    plan.kind = "table";
    plan.table = parsed.table;
    plan.caption = String(parsed.caption || "");
  }
  return plan;
}

export function pinDeepLink({ graph, pageUid, pinUid } = {}) {
  const g = String(graph ?? "").trim();
  const page = String(pageUid ?? "").trim();
  const pin = String(pinUid ?? "").trim();
  if (!g || !UID_RE.test(page) || !UID_RE.test(pin)) return "";
  return `#/app/${encodeURIComponent(g)}/page/${encodeURIComponent(page)}?pxd-pin=${encodeURIComponent(pin)}`;
}

export function pxdPinTarget(hash) {
  const text = String(hash ?? "");
  const q = text.indexOf("?");
  if (q < 0) return null;
  let pin = "";
  try { pin = new URLSearchParams(text.slice(q + 1).split("#")[0]).get("pxd-pin") || ""; } catch { return null; }
  if (!UID_RE.test(pin)) return null;
  return { pinUid: pin, pageUid: pageUidFromHash(text), graph: graphFromDeepLink(text) };
}

export function pinClickMode({ shiftKey = false, metaKey = false, ctrlKey = false } = {}) {
  if (shiftKey) return "sidebar";
  if (metaKey || ctrlKey) return "main";
  return "popover";
}

// A Source click. The sidebar wins when that PDF is already open there.
export function sourceOpenPlan({ sidebar = false, card = false } = {}) {
  if (sidebar) return "sidebar";
  if (card) return "reader";
  return "roam";
}

export function pinOpenPlan(region) {
  if (!region || region.kind !== "pdf" || region.supported === false) return null;
  const pdfUid = String(region.drawingUid || "").trim();
  const page = Number(region.pg);
  if (!pdfUid || !Number.isInteger(page) || page < 1 || !Array.isArray(region.f)) return null;
  return { pdfUid, page, frac: region.f.slice(), pinUid: String(region.uid || "") };
}

export const PIN_PENDING_MS = 8000;

// "Open in reader" from an outline where no mounted board shows the PDF. The PDF's page is opened
// and the pin is kept pending, so the board that mounts there opens the reader at the pin.
export function pinOpenFallback({ opened = false, plan = null, pageUid = "", now = 0 } = {}) {
  if (opened || !plan?.pinUid) return null;
  const page = String(pageUid || "").trim();
  if (!UID_RE.test(page)) return null;
  return { openPage: page, pending: { pinUid: plan.pinUid, until: Number(now) + PIN_PENDING_MS } };
}

export function pinnedToast(page) {
  const n = Number(page);
  return Number.isInteger(n) && n >= 1 ? `Pinned p. ${n}` : "Pinned";
}

export function fracStyle(frac) {
  if (!Array.isArray(frac) || frac.length < 4) return null;
  const nums = frac.slice(0, 4).map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return {
    left: `${nums[0] * 100}%`,
    top: `${nums[1] * 100}%`,
    width: `${nums[2] * 100}%`,
    height: `${nums[3] * 100}%`,
  };
}

export function surroundingParagraph(doc, block) {
  if (!doc?.blocks || !block) return "";
  const order = Array.isArray(doc.order) ? doc.order : [];
  const at = order.indexOf(block.id);
  if (at < 0) return "";
  const textOf = (other) => {
    if (!other || other.page !== block.page) return "";
    if (other.type !== "para" && other.type !== "text" && other.type !== "heading" && other.type !== "list") return "";
    return squash(other.text || "");
  };
  let prev = "";
  for (let i = at - 1; i >= 0; i -= 1) {
    const other = doc.blocks[order[i]];
    if (!other || other.page !== block.page) break;
    const text = textOf(other);
    if (text) { prev = text; break; }
  }
  let next = "";
  for (let i = at + 1; i < order.length; i += 1) {
    const other = doc.blocks[order[i]];
    if (!other || other.page !== block.page) break;
    const text = textOf(other);
    if (text) { next = text; break; }
  }
  if (!prev && !next) return "";
  return [prev, squash(block.text || ""), next].filter(Boolean).join(" ");
}

export function boardsFromRefs(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    let uid = "";
    let string = "";
    if (Array.isArray(row)) {
      uid = String(row[0] ?? "");
      string = String(row[1] ?? "");
    } else if (row && typeof row === "object") {
      uid = String(row.uid ?? row[":block/uid"] ?? "");
      string = String(row.string ?? row[":block/string"] ?? "");
    }
    if (!uid || seen.has(uid) || !DIAGRAM_RE.test(string)) continue;
    seen.add(uid);
    out.push({ uid, string });
  }
  return out;
}

export function pinPdfUrl(url) {
  const text = typeof url === "string" ? url.trim() : "";
  if (!text || /\.enc(?:$|[?#])/i.test(text)) return "";
  return text;
}

// Design count: card and table are one step each. props adds the updateProps write
// insertParsedCard / insertParsedTable already spend. A single gesture stays ≤ 5.
export function pinWriteSteps({
  containerExists = false,
  reused = false,
  card = false,
  table = false,
  attr = false,
  props = false,
} = {}) {
  const steps = [];
  if (card) {
    steps.push("card");
    if (props) steps.push("props");
  }
  if (table) {
    steps.push("table");
    if (props) steps.push("props");
  }
  if (!reused) {
    if (!containerExists) steps.push("container");
    steps.push("pin");
  }
  if (attr) steps.push("attr");
  return { steps, writes: steps.length, oneTransaction: true };
}

export function planPinWrites(spec) {
  const regions = Array.isArray(spec?.regions) ? spec.regions : [];
  const hit = findDuplicatePin(regions, { page: spec?.page, frac: spec?.frac });
  if (hit?.uid) return { uid: hit.uid, reused: true, creates: [], containerUid: spec?.containerUid || "" };
  const pinUid = String(spec?.pinUid || "");
  const string = serializeRegion({
    kind: "pdf",
    drawingUid: spec.pdfUid,
    pg: spec.page,
    f: spec.frac,
    caption: spec.caption || "",
  });
  const creates = [];
  let containerUid = spec?.containerUid || "";
  if (!containerUid) {
    creates.push({
      role: "container",
      parentUid: spec.pdfUid,
      string: PIN_CONTAINER_STRING,
      open: false,
      props: { plexus: { type: "regions" } },
    });
    containerUid = "";
  }
  creates.push({ role: "pin", parentUid: containerUid, uid: pinUid, string });
  return { uid: pinUid, reused: false, creates, containerUid: spec?.containerUid || "" };
}

export function commitPinWrites(io, spec) {
  const pinUid = spec?.pinUid || io?.generateUid?.() || "";
  const plan = planPinWrites({ ...spec, pinUid });
  if (plan.reused) return { uid: plan.uid, writes: 0, reused: true, containerUid: plan.containerUid, steps: [], outside: 0 };
  let containerUid = spec?.containerUid || "";
  const steps = [];
  for (const step of plan.creates) {
    const parentUid = step.role === "pin" && !step.parentUid ? containerUid : step.parentUid;
    const made = io.createBlock({
      parentUid,
      order: "last",
      uid: step.uid || undefined,
      string: step.string,
      open: step.open,
      props: step.props,
    });
    const id = typeof made === "string" ? made : made?.uid || step.uid || "";
    if (step.role === "container") containerUid = id;
    steps.push(step.role);
  }
  return { uid: plan.uid, writes: steps.length, reused: false, containerUid, steps, outside: 0 };
}

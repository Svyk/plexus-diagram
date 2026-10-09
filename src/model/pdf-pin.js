// PDF source pins. A pin is a plexus-pin block (kind "pdf") under the PDF block. This module plans
// strings, dedupe, clipboard payloads, and write counts. It does not touch the graph.

import { graphFromDeepLink, pageUidFromHash } from "./deeplink.js";
import { normalizeFrac, PIN_CONTAINER_STRING, serializeRegion } from "./regions.js";
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

export function rectIou(a, b) {
  const A = rectOf(a);
  const B = rectOf(b);
  if (!A || !B) return 0;
  if (![A.x, A.y, A.w, A.h, B.x, B.y, B.w, B.h].every(Number.isFinite)) return 0;
  const iw = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
  const ih = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const union = A.w * A.h + B.w * B.h - inter;
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

export function sourceAttrString(uid) {
  const id = String(uid ?? "").trim();
  if (!UID_RE.test(id)) return "";
  return `Source:: ((${id}))`;
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

export function cardJsonPayload({ markdown = "", size = null, kind = "card", source = "" } = {}) {
  const body = {
    markdown: String(markdown ?? ""),
    size: { w: Number(size?.w) > 0 ? Number(size.w) : 280, h: Number(size?.h) > 0 ? Number(size.h) : 160 },
    kind: String(kind || "card"),
  };
  const pin = String(source ?? "").trim();
  if (UID_RE.test(pin)) body.source = pin;
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
  return {
    x: Number.isFinite(point?.x) ? point.x : 0,
    y: Number.isFinite(point?.y) ? point.y : 0,
    w: parsed.size.w,
    h: parsed.size.h,
    markdown: parsed.markdown,
    sourceUid: parsed.source || "",
  };
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

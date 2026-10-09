// Payload-style insert actions for the parsed view. The parse view sends
// { sha256, engine, optsHash, ids, pdfUid, kind }; the session wants converted content.

import { planParseInsert, PARSE_MISSING_TOAST, textCardMarkdown } from "../model/drop.js";
import { pinSpecFromBlock } from "../model/pdf-pin.js";
import { toRoamMarkdown } from "../model/parse-to-roam-md.js";
import { selectBlocks, tableGrid } from "../model/parse-schema.js";
import { parsedTableSize } from "../model/roam-table.js";
import { MIN_SIZES } from "../model/schema.js";
import { pageNoteBlocks } from "../model/footnotes.js";
import { imageKey } from "../host/parse-store.js";
import { dataUrlToBlob } from "./parse-crop.js";

const CARD_SIZE = { w: 280, h: 160 };

// Next free spot to the right of `rect`; steps down past any rect in `others` it would overlap.
export function freeSpotBeside(rect, size, others = [], gap = 40) {
  const r = rect && typeof rect === "object" ? rect : null;
  if (!r) return null;
  const w = Number(size?.w) || CARD_SIZE.w;
  const h = Number(size?.h) || CARD_SIZE.h;
  const x = (Number(r.x) || 0) + (Number(r.w) || 0) + gap;
  let y = Number(r.y) || 0;
  const hit = (yy) => others.find((o) => o && x < o.x + o.w && x + w > o.x && yy < o.y + o.h && yy + h > o.y);
  for (let guard = 0; guard < 200; guard += 1) {
    const blocker = hit(y);
    if (!blocker) break;
    y = blocker.y + blocker.h + gap;
  }
  return { x, y };
}

function mergedCells(table) {
  let n = 0;
  for (const cell of table?.cells || []) {
    if ((cell.rowSpan ?? 1) > 1 || (cell.colSpan ?? 1) > 1) n += 1;
  }
  return n;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// The first selected block. A section chip's ids start at the heading.
function pinFor(doc, payload) {
  if (!payload?.withSource || !doc) return null;
  const first = selectBlocks(doc, payload.ids)[0];
  if (!first) return null;
  return pinSpecFromBlock(first, doc, payload.pdfBlockUid || payload.pdfUid);
}

// Pure. What the click-to-place preview shows for a chip action, and how wide it is (board px).
// A table previews its first rows at the inserted table's width; a figure its crop; text its words.
// width and height are the footprint the insert will really take (the session's card clamp applied), board px.
export function placementContent(doc, ids, act, extra = null) {
  const blocks = selectBlocks(doc, ids);
  const first = blocks[0] || null;
  if (!first) return { content: { kind: "text", text: "" }, width: CARD_SIZE.w, height: CARD_SIZE.h };
  if (act === "table" && first.type === "table") {
    const rows = tableGrid(first).slice(0, 8).map((row) => row.filter((slot) => !slot.covered).map((slot) => String(slot.cell?.text ?? "")));
    const sized = parsedTableSize(first);
    const width = Math.max(MIN_SIZES.card.w, Number(sized?.w) || CARD_SIZE.w);
    const height = Math.max(MIN_SIZES.card.h, Number(sized?.h) || CARD_SIZE.h);
    return { content: { kind: "table", rows, rowCap: 8, colCap: 12, page: first.page, mode: extra?.mode || "grid" }, width, height };
  }
  if (blocks.length === 1 && first.type === "figure") {
    return { content: { kind: "figure", text: first.caption && doc?.blocks?.[first.caption]?.text ? doc.blocks[first.caption].text : "", page: first.page }, width: CARD_SIZE.w, height: CARD_SIZE.h };
  }
  const text = blocks.map((b) => (b.type === "list" ? (b.items || []).map((item) => item.text).join(" ") : b.text || b.latex || "")).join(" ");
  return { content: { kind: "text", text, page: first.page }, width: CARD_SIZE.w, height: CARD_SIZE.h };
}

export function createParseActions({ session, store, placeBeside, toast, select, show, focus, upload, toWorld } = {}) {
  const say = (message) => { try { if (typeof toast === "function") toast(message); } catch { /* host */ } };
  const pick = (uids) => {
    const list = (Array.isArray(uids) ? uids : []).filter((id) => typeof id === "string" && id);
    if (!list.length) return;
    try { select?.(list); } catch { /* host */ }
    try { show?.(list); } catch { /* host */ }
    try { focus?.(); } catch { /* host */ }
  };
  const spot = (pdfUid, size) => {
    let at = null;
    try { at = placeBeside?.(pdfUid, size); } catch { at = null; }
    return { x: Number.isFinite(at?.x) ? at.x : 0, y: Number.isFinite(at?.y) ? at.y : 0 };
  };
  const fnFormat = () => session?.footnoteFormat?.() ?? "off";
  // Where an insert lands: a placed client point (click-to-place), explicit board x/y, else beside the PDF.
  const where = (payload, size) => {
    const c = payload?.client;
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y) && typeof toWorld === "function") {
      let p = null;
      try { p = toWorld({ x: c.x, y: c.y }); } catch { p = null; }
      if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) return { x: p.x, y: p.y };
    }
    if (Number.isFinite(payload?.x) && Number.isFinite(payload?.y)) return { x: payload.x, y: payload.y };
    return spot(payload?.pdfUid, size);
  };
  const load = async (payload) => {
    let doc = null;
    try { doc = await store?.getParse?.(payload?.sha256, payload?.engine, payload?.optsHash); } catch { doc = null; }
    if (!doc) say(PARSE_MISSING_TOAST);
    return doc;
  };
  // Figures and formulas without a graph URL get their cached crop uploaded now, not at crop time.
  async function withUploadedImages(doc, ids) {
    const blocks = selectBlocks(doc, ids).filter((b) => (b?.type === "figure" || b?.type === "formula") && !(b.image?.url || b.url));
    if (!blocks.length || typeof upload !== "function") return doc;
    const next = { ...doc, blocks: { ...doc.blocks } };
    for (const block of blocks) {
      try {
        const src = await store?.getImage?.(imageKey(doc.sha256, block.id));
        const blob = typeof src === "string" ? dataUrlToBlob(src) : src;
        if (!blob) continue;
        const file = new File([blob], `figure-p${block.page ?? 0}.png`, { type: "image/png" });
        const url = await upload(file);
        if (url) next.blocks[block.id] = { ...block, image: { ...(block.image || {}), url } };
      } catch { /* caption fallback in toRoamMarkdown */ }
    }
    return next;
  }

  const actions = {
    async insertParsedBelow(payload) {
      const doc = await load(payload);
      if (!doc) return { ok: false, reason: "missing-cache" };
      const withImages = await withUploadedImages(doc, payload.ids);
      const { markdown, blockEstimate } = toRoamMarkdown(withImages, payload.ids, { footnoteFormat: fnFormat() });
      const pin = pinFor(doc, payload);
      const res = await session?.insertParsedBelow?.({ pdfUid: payload.pdfUid, markdown, blockEstimate, ...(pin ? { pin } : {}) });
      if (res?.ok) {
        pick(res.uids);
        const where = res.path === "card" ? "beside the PDF" : "below the PDF";
        say(`Inserted ${plural(blockEstimate, "block", "blocks")} ${where}`);
      }
      return res || { ok: false, reason: "no-session" };
    },

    async insertParsedTable(payload) {
      const doc = await load(payload);
      if (!doc) return { ok: false, reason: "missing-cache" };
      const table = selectBlocks(doc, payload.ids).find((b) => b?.type === "table");
      if (!table) return { ok: false, reason: "empty" };
      const sized = parsedTableSize(table);
      const at = where(payload, sized);
      const pin = pinFor(doc, payload);
      const res = await session?.insertParsedTable?.({ ...at, table, mode: payload.mode || "auto", notes: pageNoteBlocks(doc, table), ...(pin ? { pin } : {}) });
      if (res?.ok) {
        pick(res.uid ? [res.uid] : []);
        const merged = mergedCells(table);
        const how = res.path === "grid" ? "Roam Grid" : res.path === "flat" ? "flat Roam table" : "native Roam table";
        say(merged ? `Table inserted · ${how} with ${plural(merged, "merged cell", "merged cells")}` : `Table inserted · ${how}`);
      }
      return res || { ok: false, reason: "no-session" };
    },

    async sendParsedToBoard(payload) {
      const doc = await load(payload);
      if (!doc) return { ok: false, reason: "missing-cache" };
      const blocks = selectBlocks(doc, payload.ids);
      if (blocks.length && blocks.every((b) => b?.type === "table")) return actions.insertParsedTable(payload);
      const withImages = await withUploadedImages(doc, payload.ids);
      const plan = planParseInsert(withImages, { ...payload, kind: "blocks", footnoteFormat: fnFormat() });
      const pin = pinFor(doc, payload);
      if (plan.action === "sections") {
        const at = where(payload, CARD_SIZE);
        const res = await session?.sendParsedToBoard?.({ ...at, sections: plan.sections, ...(pin ? { pin } : {}) });
        if (res?.ok) {
          pick(res.uids);
          say(`Sent ${plural(plan.sections.length, "card", "cards")} to the board`);
        }
        return res || { ok: false, reason: "no-session" };
      }
      if (plan.action === "card") {
        const at = where(payload, CARD_SIZE);
        const res = await session?.insertParsedCard?.({ ...at, markdown: plan.markdown, ...(pin ? { pin } : {}) });
        if (res?.ok) {
          pick(res.uid ? [res.uid] : []);
          say("Sent 1 card to the board");
        }
        return res || { ok: false, reason: "no-session" };
      }
      return { ok: false, reason: "empty" };
    },

    // U3. Card / Quote from a reader selection: one note card beside the PDF (fromMarkdown + props, 2 writes).
    async insertTextCard(payload) {
      const markdown = textCardMarkdown(payload || {});
      if (!markdown) return { ok: false, reason: "empty" };
      const at = where(payload, CARD_SIZE);
      const res = await session?.insertParsedCard?.({ ...at, markdown });
      if (res?.ok) {
        pick(res.uid ? [res.uid] : []);
        say(payload.quote ? "Quote card inserted" : "Card inserted");
      }
      return res || { ok: false, reason: "no-session" };
    },

    async insertParsedCard(payload) {
      const doc = await load(payload);
      if (!doc) return { ok: false, reason: "missing-cache" };
      const withImages = await withUploadedImages(doc, payload.ids);
      const { markdown } = toRoamMarkdown(withImages, payload.ids, { footnoteFormat: fnFormat() });
      const at = where(payload, CARD_SIZE);
      const pin = pinFor(withImages, payload);
      const res = await session?.insertParsedCard?.({ ...at, markdown, ...(pin ? { pin } : {}) });
      if (res?.ok) {
        pick(res.uid ? [res.uid] : []);
        say("Card inserted");
      }
      return res || { ok: false, reason: "no-session" };
    },

    // The reader gets these actions as its session. Copy with source, Copy link and Copy ref to source write a pin
    // through it; without this pass-through they silently did nothing (live 2026-10-08).
    ensurePdfPin(spec) {
      if (typeof session?.ensurePdfPin !== "function") return Promise.resolve({ ok: false, reason: "no-session" });
      return session.ensurePdfPin(spec);
    },
  };
  return actions;
}

// Payload-style insert actions for the parsed view. The parse view sends
// { sha256, engine, optsHash, ids, pdfUid, kind }; the session wants converted content.

import { planParseInsert, PARSE_MISSING_TOAST, textCardMarkdown } from "../model/drop.js";
import { toRoamMarkdown } from "../model/parse-to-roam-md.js";
import { selectBlocks } from "../model/parse-schema.js";
import { parsedTableSize } from "../model/roam-table.js";
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

export function createParseActions({ session, store, placeBeside, toast, select, show, upload } = {}) {
  const say = (message) => { try { if (typeof toast === "function") toast(message); } catch { /* host */ } };
  const pick = (uids) => {
    const list = (Array.isArray(uids) ? uids : []).filter((id) => typeof id === "string" && id);
    if (!list.length) return;
    try { select?.(list); } catch { /* host */ }
    try { show?.(list); } catch { /* host */ }
  };
  const spot = (pdfUid, size) => {
    let at = null;
    try { at = placeBeside?.(pdfUid, size); } catch { at = null; }
    return { x: Number.isFinite(at?.x) ? at.x : 0, y: Number.isFinite(at?.y) ? at.y : 0 };
  };
  const fnFormat = () => session?.footnoteFormat?.() ?? "off";
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
      const { markdown, blockEstimate } = toRoamMarkdown(doc, payload.ids, { footnoteFormat: fnFormat() });
      const res = await session?.insertParsedBelow?.({ pdfUid: payload.pdfUid, markdown, blockEstimate });
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
      const at = Number.isFinite(payload.x) && Number.isFinite(payload.y) ? { x: payload.x, y: payload.y } : spot(payload.pdfUid, sized);
      const res = await session?.insertParsedTable?.({ ...at, table, mode: payload.mode || "auto", notes: pageNoteBlocks(doc, table) });
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
      if (plan.action === "sections") {
        const at = spot(payload.pdfUid, CARD_SIZE);
        const res = await session?.sendParsedToBoard?.({ ...at, sections: plan.sections });
        if (res?.ok) {
          pick(res.uids);
          say(`Sent ${plural(plan.sections.length, "card", "cards")} to the board`);
        }
        return res || { ok: false, reason: "no-session" };
      }
      if (plan.action === "card") {
        const at = spot(payload.pdfUid, CARD_SIZE);
        const res = await session?.insertParsedCard?.({ ...at, markdown: plan.markdown });
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
      const at = Number.isFinite(payload.x) && Number.isFinite(payload.y) ? { x: payload.x, y: payload.y } : spot(payload.pdfUid, CARD_SIZE);
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
      const at = spot(payload.pdfUid, CARD_SIZE);
      const res = await session?.insertParsedCard?.({ ...at, markdown });
      if (res?.ok) {
        pick(res.uid ? [res.uid] : []);
        say("Card inserted");
      }
      return res || { ok: false, reason: "no-session" };
    },
  };
  return actions;
}

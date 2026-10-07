// Pure parser for what a drop carries. No DOM: the view passes the DataTransfer-like object.
// Sources it understands: a parsed-PDF drag (PARSE_MIME), our own panel rows (CARD_MIME),
// Roam bullet drags (roam/block-uid-list*),
// Roam / browser URLs (`.../#/app/<graph>/page/<uid>`, in roam/roam-uri-list, text/uri-list or text/plain),
// anchors that carry data-link-uid / data-link-title, and text: [[Title]], #Tag, ((uid)), a bare 9-char uid.
// A page uid resolves to [[Title]] and a block uid to ((uid)) through the injected resolveUid.

import { selectBlocks } from "./parse-schema.js";
import { toRoamMarkdown } from "./parse-to-roam-md.js";

export const CARD_MIME = "application/x-plexus-card";
export const PARSE_MIME = "application/x-plexus-parse";
export const PARSE_MISSING_TOAST = "Parse result not found; parse the PDF again";
const MAX_DROP = 50;
const URL_LINE = /^(?:https?|roam):\/\//i;
const APP_URL = /#\/app\/([^/?#]+)(?:\/page\/([\w-]+))?/;

export function parseDropPayload(dataTransfer, { resolveUid, graph = "" } = {}) {
  if (!dataTransfer) return [];
  const take = (type) => {
    try { return String(dataTransfer.getData?.(type) || ""); } catch { return ""; }
  };
  const parseRaw = take(PARSE_MIME).trim();
  if (parseRaw) {
    try {
      const payload = JSON.parse(parseRaw);
      if (payload && typeof payload === "object" && !Array.isArray(payload)) return [{ parse: payload }];
    } catch { /* present but not JSON: do not scan it as a uid */ }
    return [];
  }
  const resolve = typeof resolveUid === "function" ? resolveUid : (uid) => `((${uid}))`;
  const own = take(CARD_MIME).trim();
  if (own) return [{ string: own }];
  const tokens = (text) => text.split(/\s+/).filter((t) => /^[\w-]+$/.test(t));
  let uids = tokens(take("roam/block-uid-list-only-parents"));
  if (!uids.length) uids = tokens(take("roam/block-uid-list"));
  if (!uids.length) {
    for (const type of ["roam/roam-uri-list", "text/uri-list", "text/plain"]) {
      for (const raw of take(type).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        if (type === "text/plain" && !URL_LINE.test(line)) continue;
        const app = APP_URL.exec(line);
        if (app && graph && decodeURIComponent(app[1]) !== graph) continue;
        const m = app ? (app[2] ? [null, app[2]] : null) : line.match(/\/page\/([\w-]+)/);
        if (m) uids.push(m[1]);
      }
      if (uids.length) break;
    }
  }
  if (!uids.length) {
    for (const m of take("text/html").matchAll(/data-link-uid="([\w-]+)"/g)) uids.push(m[1]);
  }
  if (uids.length) {
    const out = [];
    for (const uid of [...new Set(uids)].slice(0, MAX_DROP)) {
      let string = null;
      try { string = resolve(uid); } catch { string = null; }
      if (typeof string === "string" && string.trim()) out.push({ string });
    }
    if (out.length) return out;
  }
  const chunks = [take("text/plain"), take("text/html")];
  const types = dataTransfer.types;
  if (types) for (const type of types) chunks.push(take(type));
  const blob = chunks.join("\n");
  if (!blob.trim()) return [];
  const page = blob.match(/\[\[([^\]]+)\]\]/);
  if (page) return [{ string: `[[${page[1]}]]` }];
  const blockRef = blob.match(/\(\(([^)]+)\)\)/);
  if (blockRef) return [{ string: `((${blockRef[1]}))` }];
  const linked = take("text/html").match(/data-link-title="([^"]+)"/);
  if (linked) return [{ string: `[[${linked[1].replace(/&amp;/g, "&").replace(/&quot;/g, "\"")}]]` }];
  const plain = take("text/plain").trim();
  const tag = /^#([^\s#[\]/][^\s#[\]]*)$/.exec(plain);
  if (tag) return [{ string: `[[${tag[1]}]]` }];
  if (/^[A-Za-z0-9_-]{9}$/.test(plain)) {
    let string = null;
    try { string = resolve(plain); } catch { string = null; }
    if (typeof string === "string" && string.trim()) return [{ string }];
  }
  return [];
}

function headingTitle(block) {
  return String(block?.text ?? "").replace(/\s+/g, " ").trim();
}

// kind "table" → one table block. kind "blocks" → one card, or one section per heading
// when the ids cross more than one heading. Figures stay inside the markdown.
export function planParseInsert(doc, payload) {
  const kind = payload?.kind;
  const ids = Array.isArray(payload?.ids) ? payload.ids : [];
  const blocks = selectBlocks(doc, ids);
  if (kind === "table") {
    const table = blocks.find((block) => block?.type === "table") || null;
    if (!table) return { action: "empty" };
    return { action: "table", table };
  }
  if (kind !== "blocks" || !blocks.length) return { action: "empty" };
  const sections = [];
  let current = null;
  for (const block of blocks) {
    if (block.type === "heading") {
      current = { title: headingTitle(block), ids: [block.id] };
      sections.push(current);
    } else if (!current) {
      current = { title: "", ids: [block.id] };
      sections.push(current);
    } else current.ids.push(block.id);
  }
  if (sections.length > 1) {
    return {
      action: "sections",
      sections: sections.map((section) => ({
        title: section.title,
        markdown: toRoamMarkdown(doc, section.ids).markdown,
      })),
    };
  }
  return { action: "card", markdown: toRoamMarkdown(doc, ids).markdown };
}

// Missing cache writes nothing and toasts PARSE_MISSING_TOAST. The session methods
// own the write budget. Returns { ok, uids, ... } for the board to select.
export async function handleParseDrop({ payload, store, session, point, toast } = {}) {
  let doc = null;
  try {
    doc = await store?.getParse?.(payload?.sha256, payload?.engine, payload?.optsHash);
  } catch {
    doc = null;
  }
  if (!doc) {
    if (typeof toast === "function") toast(PARSE_MISSING_TOAST);
    return { ok: false, reason: "missing-cache", uids: [] };
  }
  const plan = planParseInsert(doc, payload);
  const x = Number.isFinite(point?.x) ? point.x : 0;
  const y = Number.isFinite(point?.y) ? point.y : 0;
  if (plan.action === "table") {
    const res = await session?.insertParsedTable?.({ x, y, table: plan.table, mode: "auto" });
    return { ...(res || { ok: false, reason: "empty" }), uids: res?.uid ? [res.uid] : [] };
  }
  if (plan.action === "sections") {
    const res = await session?.sendParsedToBoard?.({ x, y, sections: plan.sections });
    return { ...(res || { ok: false, reason: "empty" }), uids: Array.isArray(res?.uids) ? res.uids : [] };
  }
  if (plan.action === "card") {
    const res = await session?.insertParsedCard?.({ x, y, markdown: plan.markdown });
    return { ...(res || { ok: false, reason: "empty" }), uids: res?.uid ? [res.uid] : [] };
  }
  return { ok: false, reason: "empty", uids: [] };
}

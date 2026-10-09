// Pure parser for what a drop carries. No DOM: the view passes the DataTransfer-like object.
// Sources it understands: a parsed-PDF drag (PARSE_MIME), our own panel rows (CARD_MIME),
// Roam bullet drags (roam/block-uid-list*),
// Roam / browser URLs (`.../#/app/<graph>/page/<uid>`, in roam/roam-uri-list, text/uri-list or text/plain),
// anchors that carry data-link-uid / data-link-title, and text: [[Title]], #Tag, ((uid)), a bare 9-char uid.
// A page uid resolves to [[Title]] and a block uid to ((uid)) through the injected resolveUid.

import {
  NEXT_OFFER,
  OFFICE_STEP,
  markdownToParse,
  officeFetchAllowed,
  officeFormatFromName,
  officeTargetFromText,
  planFromParse,
} from "./anydoc-to-parse.js";
import { sha256Hex } from "./parse-hash.js";
import { pinSpecFromBlock } from "./pdf-pin.js";
import { selectBlocks } from "./parse-schema.js";
import { escapeMarkdownText, flattenLine, linkSafeText, toRoamMarkdown } from "./parse-to-roam-md.js";
import { pageNoteBlocks } from "./footnotes.js";

export const CARD_MIME = "application/x-plexus-card";
export const PARSE_MIME = "application/x-plexus-parse";
export const PARSE_MISSING_TOAST = "Parse result not found; parse the PDF again";
export const TEXT_CARD_MAX = 4000;
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
  const officeFiles = officeFilesFrom(dataTransfer);
  if (officeFiles.length) return officeFiles.map((office) => ({ office }));
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
    if (out.length === 1) {
      const office = officeTargetFromText(out[0].string);
      if (office) return [{ office }];
    }
    if (out.length) return out;
  }
  const soleOffice = (text) => {
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    if (lines.length !== 1) return null;
    return officeTargetFromText(lines[0]);
  };
  const droppedOffice = soleOffice(take("text/uri-list")) || soleOffice(take("text/plain")) || officeTargetFromText(take("text/html").trim());
  if (droppedOffice) return [{ office: droppedOffice }];
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

// U3/U5. A text payload ({ kind: "text", text, page, pdfUid, quote }) becomes one note card: the text on
// one line plus " (p. N)". A quote is a Roam blockquote. Links and tags in the text stay plain text.
export function textCardMarkdown({ text, page, quote = false } = {}) {
  let line = flattenLine(text);
  if (!line) return "";
  if (line.length > TEXT_CARD_MAX) line = `${line.slice(0, TEXT_CARD_MAX - 1).trimEnd()}…`;
  const n = Number(page);
  const suffix = Number.isInteger(n) && n > 0 ? ` (p. ${n})` : "";
  const body = escapeMarkdownText(linkSafeText(line) + suffix, { leading: !quote });
  return `- ${quote ? "> " : ""}${body}`;
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
        markdown: toRoamMarkdown(doc, section.ids, { footnoteFormat: payload?.footnoteFormat }).markdown,
      })),
    };
  }
  return { action: "card", markdown: toRoamMarkdown(doc, ids, { footnoteFormat: payload?.footnoteFormat }).markdown };
}

function pinForDrop(doc, payload) {
  if (!payload?.withSource || !doc) return null;
  const first = selectBlocks(doc, payload.ids)[0];
  if (!first) return null;
  return pinSpecFromBlock(first, doc, payload.pdfBlockUid || payload.pdfUid);
}

// Missing cache writes nothing and toasts PARSE_MISSING_TOAST. The session methods
// own the write budget. Returns { ok, uids, ... } for the board to select.
export async function handleParseDrop({ payload, store, session, point, toast } = {}) {
  if (payload?.kind === "text") {
    const markdown = textCardMarkdown(payload);
    if (!markdown) return { ok: false, reason: "empty", uids: [] };
    const res = await session?.insertParsedCard?.({
      x: Number.isFinite(point?.x) ? point.x : 0,
      y: Number.isFinite(point?.y) ? point.y : 0,
      markdown,
    });
    return { ...(res || { ok: false, reason: "empty" }), uids: res?.uid ? [res.uid] : [] };
  }
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
  const plan = planParseInsert(doc, { ...payload, footnoteFormat: session?.footnoteFormat?.() });
  const x = Number.isFinite(point?.x) ? point.x : 0;
  const y = Number.isFinite(point?.y) ? point.y : 0;
  const pin = pinForDrop(doc, payload);
  const cited = pin ? { pin } : {};
  if (plan.action === "table") {
    const res = await session?.insertParsedTable?.({ x, y, table: plan.table, mode: "auto", notes: pageNoteBlocks(doc, plan.table), ...cited });
    return { ...(res || { ok: false, reason: "empty" }), uids: res?.uid ? [res.uid] : [] };
  }
  if (plan.action === "sections") {
    const res = await session?.sendParsedToBoard?.({ x, y, sections: plan.sections, ...cited });
    return { ...(res || { ok: false, reason: "empty" }), uids: Array.isArray(res?.uids) ? res.uids : [] };
  }
  if (plan.action === "card") {
    const res = await session?.insertParsedCard?.({ x, y, markdown: plan.markdown, ...cited });
    return { ...(res || { ok: false, reason: "empty" }), uids: res?.uid ? [res.uid] : [] };
  }
  return { ok: false, reason: "empty", uids: [] };
}

function eachDroppedFile(dataTransfer, visit) {
  const files = dataTransfer?.files;
  if (files && typeof files.length === "number" && files.length) {
    for (let i = 0; i < files.length; i += 1) visit(files[i]);
    return;
  }
  const items = dataTransfer?.items;
  if (!items || typeof items.length !== "number") return;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item?.kind !== "file" || typeof item.getAsFile !== "function") continue;
    let file = null;
    try { file = item.getAsFile(); } catch { file = null; }
    if (file) visit(file);
  }
}

function officeFilesFrom(dataTransfer) {
  const out = [];
  eachDroppedFile(dataTransfer, (file) => {
    const format = officeFormatFromName(file?.name || "");
    if (!format) return;
    out.push({ format, name: file.name, file });
  });
  return out;
}

async function readOfficeBytes(office, fetchImpl) {
  const format = office?.format;
  if (!format || format === "pdf") return null;
  if (office?.file && typeof office.file.arrayBuffer === "function") {
    const bytes = new Uint8Array(await office.file.arrayBuffer());
    return { bytes, format };
  }
  const url = typeof office?.url === "string" ? office.url : "";
  if (!officeFetchAllowed(url)) {
    const err = new Error("fetch");
    err.code = "fetch";
    throw err;
  }
  const fetchFn = fetchImpl || globalThis.fetch?.bind(globalThis);
  if (typeof fetchFn !== "function") {
    const err = new Error("fetch");
    err.code = "fetch";
    throw err;
  }
  let res;
  try {
    res = await fetchFn(url, { mode: "cors", credentials: "omit" });
  } catch (err) {
    if (err && typeof err === "object" && !err.code) err.code = "fetch";
    throw err;
  }
  if (!res?.ok) {
    const err = new Error("fetch");
    err.code = "fetch";
    throw err;
  }
  return { bytes: new Uint8Array(await res.arrayBuffer()), format };
}

async function applyOfficePlan({ plan, session, x, y }) {
  if (!plan || plan.action === "empty") return { ok: false, uids: [], count: 0 };
  if (plan.action === "grids") {
    const uids = [];
    let py = y;
    const tables = plan.tables || [];
    for (const row of tables) {
      const res = await session?.insertParsedTable?.({ x, y: py, table: row.table, mode: "grid" });
      if (res?.uid) uids.push(res.uid);
      const height = Number(res?.h);
      py += (Number.isFinite(height) && height > 0 ? height : 280) + 24;
    }
    return { ok: uids.length > 0, uids, count: tables.length, nextY: py };
  }
  if (plan.action === "card" && plan.markdown) {
    const res = await session?.insertParsedCard?.({ x, y, markdown: plan.markdown });
    return { ok: Boolean(res?.uid), uids: res?.uid ? [res.uid] : [], count: res?.uid ? 1 : 0, nextY: y + OFFICE_STEP };
  }
  const sections = plan.sections || [];
  if (!sections.length) return { ok: false, uids: [], count: 0 };
  const res = await session?.sendParsedToBoard?.({ x, y, sections });
  const uids = Array.isArray(res?.uids) ? res.uids : [];
  return { ok: uids.length > 0, uids, count: sections.length, nextY: y + sections.length * OFFICE_STEP };
}

// Drop or Convert to cards. PDF is not an office format. The offer is returned, not toasted here.
export async function handleOfficeDrop({ office, convert, fetch: fetchImpl, session, point, doc = null, offset = 0 } = {}) {
  const x = Number.isFinite(point?.x) ? point.x : 0;
  const y = Number.isFinite(point?.y) ? point.y : 0;
  try {
    let parsed = doc;
    let ms = 0;
    if (!parsed) {
      const loaded = await readOfficeBytes(office, fetchImpl);
      if (!loaded) return { ok: false, reason: "fetch", toast: "Could not fetch this file", uids: [] };
      if (typeof convert !== "function") return { ok: false, reason: "convert", toast: "Could not convert this file", uids: [] };
      const out = await convert(loaded.bytes, loaded.format);
      ms = Number(out?.ms) || 0;
      let sha = "";
      try { sha = await sha256Hex(loaded.bytes); } catch { sha = ""; }
      parsed = markdownToParse(out?.markdown || "", {
        format: loaded.format,
        title: office?.name || "",
        sha256: sha,
      });
    }
    const plan = planFromParse(parsed, {
      format: office?.format || parsed?.sourceFormat,
      offset,
      planSections: planParseInsert,
    });
    const applied = await applyOfficePlan({ plan, session, x, y });
    if (!applied.ok) return { ok: false, reason: "empty", toast: "Could not convert this file", uids: [], ms };
    const more = Boolean(plan.more);
    return {
      ok: true,
      uids: applied.uids,
      toast: plan.toast || "",
      offer: more ? (plan.offer || NEXT_OFFER) : "",
      more,
      ms,
      continue: more ? () => handleOfficeDrop({
        office,
        convert,
        fetch: fetchImpl,
        session,
        doc: parsed,
        offset: plan.nextOffset,
        point: { x, y: applied.nextY ?? y + OFFICE_STEP },
      }) : undefined,
    };
  } catch (err) {
    const code = err?.code;
    if (code === "encrypted") return { ok: false, reason: "encrypted", toast: "Encrypted files stay in Roam's reader", uids: [] };
    if (code === "fetch" || code === "cors") return { ok: false, reason: "fetch", toast: "Could not fetch this file", uids: [] };
    return { ok: false, reason: code || "convert", toast: "Could not convert this file", uids: [] };
  }
}

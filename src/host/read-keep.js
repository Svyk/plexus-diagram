// Keeping a finished read in the graph, so another computer loads it instead of reading again.
// A read that costs time or money (helper, High accuracy, cloud) is uploaded once as a gzip file, and
// the PDF block's props note it under `plexus-reads`. Two writes per read: the upload and the prop.
// Restore is read-only: it fetches through the host (encrypted graphs decrypt only through file.get),
// checks the PDF's sha-256 and the schema, and puts the doc in the local parse store.

import { sha256Hex } from "../model/parse-hash.js";
import { validateParse } from "../model/parse-schema.js";
import { PARSE_REV } from "../model/parse/index.js";
import { isStaleParse } from "./parse-store.js";

export const READS_KEY = "plexus-reads";
export const READ_SCHEMA = "pxd-read/1";
export const KEEP_READS_SETTING = "keep-reads";

const RANK = Object.freeze({ high: 3, cloud: 2, other: 1 });

// null for the instant built-in parse and for an on-device browser read; otherwise { engine, mode, rank }.
export function readKind(doc) {
  if (!doc || typeof doc !== "object" || !doc.sha256 || !doc.engine) return null;
  if (doc.engine === "cloud") {
    const provider = typeof doc.options?.provider === "string" && doc.options.provider ? doc.options.provider : "llamaparse";
    return { engine: "cloud", mode: provider, rank: RANK.cloud };
  }
  if (doc.engine !== "builtin") return { engine: doc.engine, mode: "helper", rank: RANK.other };
  if (doc.ocr?.mode === "high") return { engine: "builtin", mode: "high", rank: RANK.high };
  const ocrPages = Boolean(doc.ocr?.pages?.length) || (doc.pages || []).some((p) => p.ocr);
  if (ocrPages && doc.ocr?.source === "helper") return { engine: "builtin", mode: "helper", rank: RANK.other };
  return null;
}

// Every page 1..N is in the doc, and N is the PDF's page count when the caller knows it.
export function isCompleteRead(doc, total = 0) {
  const pages = Array.isArray(doc?.pages) ? doc.pages : [];
  const count = Number(doc?.pageCount) || pages.length;
  if (!count || pages.length < count) return false;
  if (total && count < total) return false;
  const range = doc?.stats?.range;
  if (Array.isArray(range) && range.length === 2 && (range[0] !== 1 || range[1] < count)) return false;
  const seen = new Set(pages.map((p) => p?.n));
  for (let n = 1; n <= count; n += 1) if (!seen.has(n)) return false;
  return true;
}

export function readEntryKey(kind) {
  return `${kind.engine}:${kind.mode}`;
}

export function readFileName(sha256, engine, gz) {
  return `plexus-read-${String(sha256).slice(0, 12)}-${engine}.json${gz ? ".gz" : ""}`;
}

// The valid entries of a block's props, as [{ key, ...entry }].
export function readEntries(props) {
  const reads = props && typeof props === "object" ? props[READS_KEY] : null;
  if (!reads || typeof reads !== "object" || Array.isArray(reads)) return [];
  const out = [];
  for (const [key, e] of Object.entries(reads)) {
    if (!e || typeof e !== "object") continue;
    if (typeof e.url !== "string" || !e.url || typeof e.sha256 !== "string" || !e.sha256) continue;
    if (typeof e.engine !== "string" || typeof e.mode !== "string") continue;
    out.push({ key, ...e });
  }
  return out;
}

// A newer read of the same engine and mode replaces its entry; every other entry stays.
export function mergeReads(existing, entry) {
  const out = {};
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    for (const [k, v] of Object.entries(existing)) out[k] = v;
  }
  out[readEntryKey(entry)] = {
    url: entry.url, sha256: entry.sha256, engine: entry.engine, mode: entry.mode, parseRev: entry.parseRev,
    schema: entry.schema, bytes: entry.bytes, createdAt: entry.createdAt, docHash: entry.docHash,
  };
  return out;
}

function rankOf(entry) {
  if (entry.engine === "builtin" && entry.mode === "high") return RANK.high;
  if (entry.engine === "cloud") return RANK.cloud;
  return RANK.other;
}

// The url inside whatever markdown Roam's upload returned for a non-image file.
export function bareUrl(raw) {
  const text = String(raw ?? "").trim();
  const hit = /https?:\/\/[^\s)}\]"']+/.exec(text);
  return hit ? hit[0] : text;
}

async function gzipBytes(bytes) {
  if (typeof CompressionStream !== "function") return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function gunzipBytes(bytes) {
  if (typeof DecompressionStream !== "function") throw new Error("gunzip-unavailable");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function bytesOf(file) {
  if (!file) return null;
  if (file instanceof Uint8Array) return file;
  if (file instanceof ArrayBuffer) return new Uint8Array(file);
  if (ArrayBuffer.isView(file)) return new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  return null;
}

export function createReadKeeper({ host = null, session = null, store = null, settings = null, now = Date.now, log = null } = {}) {
  const warned = new Set();
  const warn = (what, error) => {
    if (warned.has(what)) return;
    warned.add(what);
    try { (log || console.warn)(`[plexus] keep reads: ${what}${error ? ` (${error?.message || error})` : ""}`); } catch { /* log */ }
  };
  const enabled = () => {
    try { return settings?.get?.(KEEP_READS_SETTING) !== false; } catch { return true; }
  };
  const propsOf = (uid) => {
    try { return host?.pullProps?.(uid) || {}; } catch { return {}; }
  };
  const inflight = new Set();

  // After a finished read. Never throws. Resolves { ok, reason?, url? }.
  async function keepRead(doc, { blockUid = "", total = 0 } = {}) {
    try {
      if (!enabled()) return { ok: false, reason: "off" };
      const kind = readKind(doc);
      if (!kind) return { ok: false, reason: "not-kept" };
      if (!blockUid || typeof host?.uploadFile !== "function") return { ok: false, reason: "no-target" };
      if (!isCompleteRead(doc, total)) return { ok: false, reason: "partial" };
      const text = JSON.stringify({ schema: READ_SCHEMA, parseRev: PARSE_REV, engine: kind.engine, mode: kind.mode, doc });
      const raw = new TextEncoder().encode(text);
      const docHash = await sha256Hex(raw);
      const key = readEntryKey(kind);
      const have = readEntries(propsOf(blockUid)).find((e) => e.key === key);
      if (have && have.docHash === docHash && have.sha256 === doc.sha256) return { ok: false, reason: "already" };
      const flight = `${blockUid}|${key}|${docHash}`;
      if (inflight.has(flight)) return { ok: false, reason: "busy" };
      inflight.add(flight);
      try {
        const zipped = await gzipBytes(raw);
        const payload = zipped || raw;
        const file = new File([payload], readFileName(doc.sha256, kind.engine, Boolean(zipped)), { type: zipped ? "application/gzip" : "application/json" });
        const url = bareUrl(await host.uploadFile(file));
        if (!url) return { ok: false, reason: "upload-failed" };
        const entry = {
          url, sha256: doc.sha256, engine: kind.engine, mode: kind.mode, parseRev: PARSE_REV,
          schema: READ_SCHEMA, bytes: payload.byteLength, createdAt: now(), docHash,
        };
        const write = async () => {
          await host.updateReads(blockUid, mergeReads(propsOf(blockUid)[READS_KEY], entry));
          return { ok: true };
        };
        const wrote = typeof session?.noteRead === "function"
          ? await session.noteRead(blockUid, entry)
          : await (typeof host.group === "function" ? host.group(write, "Keep read") : write());
        if (wrote && wrote.ok === false) return { ok: false, reason: wrote.reason || "write-failed" };
        return { ok: true, url, entry };
      } finally {
        inflight.delete(flight);
      }
    } catch (error) {
      warn("could not keep the read", error);
      return { ok: false, reason: "error" };
    }
  }

  // Local store has no doc for this PDF: load the best kept read whose sha-256 matches the PDF.
  // `getBytes()` answers the PDF's bytes (only called when the block has entries). Writes nothing.
  async function restoreRead({ blockUid = "", getBytes = null, url = "", sha256 = "" } = {}) {
    try {
      if (!blockUid || !store || typeof host?.getFile !== "function") return null;
      const entries = readEntries(propsOf(blockUid)).filter((e) => e.schema === READ_SCHEMA);
      if (!entries.length) return null;
      let sha = String(sha256 || "");
      if (!sha) {
        const bytes = typeof getBytes === "function" ? await getBytes() : null;
        if (!bytes) return null;
        sha = await sha256Hex(bytes);
      }
      const mine = entries
        .filter((e) => e.sha256 === sha)
        .sort((a, b) => rankOf(b) - rankOf(a) || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      for (const entry of mine) {
        try {
          const file = await host.getFile(entry.url);
          let bytes = await bytesOf(file);
          if (!bytes || !bytes.byteLength) { warn("kept read could not be fetched"); continue; }
          if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzipBytes(bytes);
          const payload = JSON.parse(new TextDecoder().decode(bytes));
          const doc = payload?.doc;
          if (payload?.schema !== READ_SCHEMA || !doc || doc.sha256 !== sha) { warn("kept read does not match its PDF"); continue; }
          if (!validateParse(doc).ok) { warn("kept read has an unknown schema"); continue; }
          if (!readKind(doc) || isStaleParse(doc)) continue;
          const stored = await store.putParse(doc);
          if (!stored) continue;
          if (url) await store.indexUrl?.(url, { sha256: sha, pageCount: doc.pageCount });
          return stored;
        } catch (error) {
          warn("kept read could not be loaded", error);
        }
      }
      return null;
    } catch (error) {
      warn("restore failed", error);
      return null;
    }
  }

  return { keepRead, restoreRead, enabled };
}

// Gets a figure's picture to a public https URL that Live AI Assistant can hand to a vision model.
// Live AI only reads `![alt](https://…)` inside the prompt, so a crop has to be a file in the graph first.
// Uploads once per figure (the URL is remembered in the parse store) and never on dialog open.

export const MAX_SIDE = 1600;
export const JPEG_ABOVE = 1.5 * 1024 * 1024;
export const URL_META_PREFIX = "figure-url:";

export const ENCRYPTED_NOTE = "This graph is encrypted, so the image can't be shared with the model; sending text only.";
export const UPLOAD_FAILED_NOTE = "Could not upload the figure; sending text only.";
export const NO_IMAGE_NOTE = "The figure's image is not available; sending text only.";

// https only, and never an encrypted-graph file: a provider cannot read those.
export function isUsableImageUrl(url) {
  const text = String(url ?? "").trim();
  if (!/^https:\/\/[^\s)]+$/i.test(text)) return false;
  const path = text.split(/[?#]/)[0];
  return !/\.enc$/i.test(path);
}

export function fitSize(w, h, max = MAX_SIDE) {
  const width = Number(w);
  const height = Number(h);
  if (!(width > 0) || !(height > 0)) return { w: 0, h: 0, scale: 1 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)), scale };
}

// A Blob from a Blob, a data: URL, or raw bytes. Null for anything else.
export function asBlob(value, BlobCtor = globalThis.Blob) {
  if (!value) return null;
  if (typeof value === "string") {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value);
    if (!m || !m[2]) return null;
    const bin = globalThis.atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new BlobCtor([bytes], { type: m[1] || "image/png" });
  }
  if (typeof value.size === "number" && typeof value.type === "string") return value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return new BlobCtor([value], { type: "image/png" });
  return null;
}

// Long side <= 1600 px, PNG; JPEG q0.9 when the PNG is still over 1.5 MB. Returns the blob itself when it is
// already small enough, and also when the browser cannot decode it (the caller then sends it as it is).
export async function shrinkImage(blob, { doc = globalThis.document, maxSide = MAX_SIDE, jpegAbove = JPEG_ABOVE } = {}) {
  try {
    const decode = globalThis.createImageBitmap;
    if (typeof decode !== "function" || !doc?.createElement) return blob;
    const bitmap = await decode(blob);
    const size = fitSize(bitmap.width, bitmap.height, maxSide);
    if (size.scale === 1 && blob.size <= jpegAbove && /png/i.test(blob.type || "")) {
      bitmap.close?.();
      return blob;
    }
    const canvas = doc.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.drawImage(bitmap, 0, 0, size.w, size.h);
    bitmap.close?.();
    const out = (type, q) => new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, q));
    const png = await out("image/png");
    if (png && png.size <= jpegAbove) return png;
    return (await out("image/jpeg", 0.9)) || png || blob;
  } catch {
    return blob;
  }
}

const extOf = (blob) => (/jpe?g/i.test(blob?.type || "") ? "jpg" : "png");

// store: { getMeta(key), putMeta(key, value) } (the parse store). upload(file) -> bare URL (host.uploadFile).
// encrypted() -> boolean. enabled() -> boolean (the setting). fetchFn: fetch. shrink: injectable for tests.
export function createFigureImages({ store = null, upload = null, encrypted = null, enabled = null, fetchFn = null, shrink = shrinkImage, now = Date.now } = {}) {
  const inflight = new Map();
  const isOn = () => { try { return typeof enabled === "function" ? enabled() !== false : true; } catch { return true; } };
  const isEncrypted = () => { try { return typeof encrypted === "function" ? Boolean(encrypted()) : false; } catch { return false; } };
  const metaKey = (key) => `${URL_META_PREFIX}${key}`;
  const doFetch = (...args) => (typeof fetchFn === "function" ? fetchFn(...args) : typeof globalThis.fetch === "function" ? globalThis.fetch(...args) : Promise.reject(new Error("no-fetch")));

  // Is a remembered URL still there? Only a 404 or 410 says no; a network or CORS failure is not proof.
  async function stillThere(url) {
    try {
      let res = await doFetch(url, { method: "HEAD" });
      if (res && (res.status === 405 || res.status === 501)) res = await doFetch(url, { method: "GET", headers: { Range: "bytes=0-0" } });
      return !(res && (res.status === 404 || res.status === 410));
    } catch {
      return true;
    }
  }

  async function peek(key) {
    try {
      const got = key && typeof store?.getMeta === "function" ? await store.getMeta(metaKey(key)) : null;
      return got && isUsableImageUrl(got.url) ? got.url : "";
    } catch {
      return "";
    }
  }

  async function resolve({ key = "", url = "", getBlob = null, name = "figure" } = {}) {
    if (!isOn()) return { ok: false, reason: "off" };
    if (isEncrypted()) return { ok: false, reason: "encrypted" };
    if (url) {
      if (isUsableImageUrl(url)) return { ok: true, url: String(url).trim(), uploaded: false };
      return { ok: false, reason: /\.enc(?:$|[?#])/i.test(String(url)) ? "encrypted" : "unusable" };
    }
    const cached = await peek(key);
    if (cached && (await stillThere(cached))) return { ok: true, url: cached, uploaded: false, cached: true };
    if (typeof upload !== "function") return { ok: false, reason: "upload-failed" };
    let blob = null;
    try { blob = asBlob(typeof getBlob === "function" ? await getBlob() : null); } catch { blob = null; }
    if (!blob) return { ok: false, reason: "no-image" };
    let sent = blob;
    try { sent = (await shrink(blob)) || blob; } catch { sent = blob; }
    let got = "";
    try {
      const file = new File([sent], `${name}.${extOf(sent)}`, { type: sent.type || "image/png" });
      got = String(await upload(file) ?? "").trim();
    } catch {
      return { ok: false, reason: "upload-failed" };
    }
    if (!isUsableImageUrl(got)) return { ok: false, reason: /\.enc(?:$|[?#])/i.test(got) ? "encrypted" : "upload-failed" };
    try { if (key) await store?.putMeta?.(metaKey(key), { url: got, at: now() }); } catch { /* cache */ }
    return { ok: true, url: got, uploaded: true };
  }

  // One upload per key at a time: a second Send while the first is uploading waits for it.
  function ensureUrl(spec = {}) {
    const key = spec.key || "";
    if (key && inflight.has(key)) return inflight.get(key);
    const job = resolve(spec).finally(() => { if (key) inflight.delete(key); });
    if (key) inflight.set(key, job);
    return job;
  }

  return { enabled: isOn, encrypted: isEncrypted, peek, ensureUrl };
}

export function noteFor(reason) {
  if (reason === "encrypted") return ENCRYPTED_NOTE;
  if (reason === "no-image") return NO_IMAGE_NOTE;
  if (reason === "off") return "";
  return UPLOAD_FAILED_NOTE;
}

let shared = null;
export function setFigureImages(service) { shared = service || null; }
export function getFigureImages() { return shared; }

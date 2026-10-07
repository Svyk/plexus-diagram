// PDF-1 cover plan. The reader is Roam's. No fetch and no :pdf write.

const PDF_MACRO = "{{[[pdf]]:";

export const PDF_READER_W = 640;
export const PDF_READER_H = 820;
export const PDF_CARD_MAX = 4000;

export function pdfMacroUrl(s) {
  if (typeof s !== "string") return "";
  const text = s.trim();
  if (!text.startsWith(PDF_MACRO)) return "";
  const match = /https?:\/\/[^\s}]+/.exec(text.slice(PDF_MACRO.length));
  if (!match) return "";
  // Encrypted graphs store PDFs as .enc. The url only keys the page lookup; nothing here fetches it.
  return match[0];
}

export function pdfPagePlan(url, pages) {
  if (!Array.isArray(pages)) return null;
  for (const row of pages) {
    if (row && typeof row === "object" && row.url === url) return row;
  }
  return null;
}

function fileName(url) {
  if (typeof url !== "string" || url === "") return "";
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split("#")[0].split("?")[0];
  }
  let seg = path.split("/").filter(Boolean).pop() || "";
  try { seg = decodeURIComponent(seg); } catch { /* keep the raw segment */ }
  if (seg.endsWith(".pdf")) seg = seg.slice(0, -4);
  return seg.trim();
}

// A Roam upload page is often titled with its storage path or a bare uid. Those are not names.
export function isStorageTitle(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return true;
  if (text.startsWith("{{") || text.includes("{{[[")) return true;
  if (/imgs\/app\//i.test(text)) return true;
  const last = text.split("/").filter(Boolean).pop() || text;
  const bare = last.replace(/\.pdf$/i, "");
  if (text.includes("/") && /^[A-Za-z0-9_-]{9,}$/.test(bare) && !/\.pdf$/i.test(last)) return true;
  if (!text.includes(" ") && /^[A-Za-z0-9_-]{9,}$/.test(text) && !/\.pdf$/i.test(text)) return true;
  return false;
}

function titleText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === "PDF" || isStorageTitle(text)) return "";
  return text;
}

// metadata Title, then the block alias, then the block text, then a human page title, then the file name.
export function pdfTitlePlan(source) {
  const src = source && typeof source === "object" ? source : {};
  const named = titleText(src.metadataTitle) || titleText(src.alias) || titleText(src.text) || titleText(src.title);
  if (named) return named;
  const file = titleText(fileName(src.url));
  return file || "PDF";
}

export function coverModel(source) {
  const src = source && typeof source === "object" ? source : {};
  const title = pdfTitlePlan(src);
  const count = typeof src.count === "number" && Number.isFinite(src.count) && src.count >= 1 ? src.count : 0;
  const label = count === 1 ? "1 highlight" : `${count} highlights`;
  return { title, count, label };
}

// Cap a PDF card. Does not raise a minimum; the resize gesture already applied one.
export function clampPdfCard(rect) {
  const src = rect && typeof rect === "object" ? rect : {};
  const out = { ...src };
  const w = Number(src.w);
  const h = Number(src.h);
  if (Number.isFinite(w)) out.w = Math.min(PDF_CARD_MAX, w);
  if (Number.isFinite(h)) out.h = Math.min(PDF_CARD_MAX, h);
  return out;
}

// FAST-9. Posters off means the caller mounts the embed. coverModel stays {title, count, label}.
export function postersEnabled(source) {
  if (!source || typeof source !== "object") return true;
  return source.posters !== false;
}

// Poster and the opened embed share this box. coverModel itself stays {title, count, label}.
export function coverOuterBox(source) {
  const cover = coverModel(source);
  const w = Number(source?.w);
  const h = Number(source?.h);
  return {
    title: cover.title,
    w: Number.isFinite(w) && w > 0 ? Math.round(w) : PDF_READER_W,
    h: Number.isFinite(h) && h > 0 ? Math.round(h) : PDF_READER_H,
  };
}

// One live heavy embed per board: a pdf reader, a video, an iframe, or a tweet.
export function readerRule(openUid, nextUid) {
  const current = openUid || null;
  if (nextUid == null || nextUid === "") return { open: current, close: null };
  if (nextUid === current) return { open: current, close: null };
  return { open: nextUid, close: current };
}

const HEAVY_MACRO = /\{\{\s*(?:\[\[)?(pdf|video|youtube|iframe|tweet|twitter)(?:\]\])?\s*:([^}]*)\}\}/gi;
const HEAVY_ONE = /\{\{\s*(?:\[\[)?(pdf|video|youtube|iframe|tweet|twitter)(?:\]\])?\s*:([^}]*)\}\}/i;
const REF_ONLY = /^\(\(([\w-]+)\)\)$/;
const EMBED_ONLY = /^\{\{\s*(?:\[\[)?embed(?:\]\])?\s*:\s*\(\(([\w-]+)\)\)\s*\}\}$/i;

function videoStem(url) {
  const name = fileName(url);
  if (!name) return "";
  return name.replace(/\.(mp4|webm|mov|m4v|ogg)$/i, "");
}

function embedTitle(kind, name, url) {
  if (name === "youtube") return "YouTube";
  if (kind === "tweet") {
    const handle = /(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/i.exec(String(url || ""));
    if (handle && handle[1].toLowerCase() !== "i" && handle[1].toLowerCase() !== "status") return `@${handle[1]}`;
    return "Tweet";
  }
  if (kind === "iframe") {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host) return host;
    } catch { /* the body is not a url */ }
    return "Embed";
  }
  if (kind === "video") return videoStem(url) || "Video";
  return fileName(url) || "PDF";
}

function embedKind(name) {
  const n = String(name || "").toLowerCase();
  if (n === "youtube" || n === "iframe") return "iframe";
  if (n === "tweet" || n === "twitter") return "tweet";
  if (n === "video") return "video";
  return "pdf";
}

// A data url or an image element that has already decoded. An http url would fetch, so it is not a thumb.
export function posterThumb(source) {
  const src = source && typeof source === "object" ? source : {};
  const direct = typeof src.thumb === "string" ? src.thumb.trim() : "";
  if (direct.startsWith("data:image/") && !/["'()]/.test(direct)) return direct;
  const img = src.thumb && typeof src.thumb === "object" ? src.thumb : null;
  if (img && img.complete === true && Number(img.naturalWidth) > 0) {
    const url = String(img.currentSrc || img.src || "");
    if ((url.startsWith("data:image/") || url.startsWith("blob:")) && !/["'()]/.test(url)) return url;
  }
  const fromText = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/.exec(String(src.url || src.string || ""));
  if (fromText && !/["'()]/.test(fromText[0])) return fromText[0];
  return "";
}

// The first heavy macro in a string, or a raw iframe/video that is the whole string.
// A pdf highlight is not a reader. A bare http url is not an embed.
export function heavyEmbed(string, opts) {
  if (opts && postersEnabled(opts) === false) return null;
  const text = String(string ?? "").trim();
  if (!text) return null;
  const match = HEAVY_ONE.exec(text);
  if (match) {
    const name = match[1].toLowerCase();
    const body = String(match[2] || "").trim();
    const urlMatch = /https?:\/\/[^\s}]+/.exec(body);
    const url = urlMatch ? urlMatch[0] : body;
    const kind = embedKind(name);
    return { kind, url, title: embedTitle(kind, name, url) };
  }
  if (/^<iframe\b/i.test(text)) return { kind: "iframe", url: "", title: "Embed" };
  if (/^<video\b/i.test(text)) return { kind: "video", url: "", title: "Video" };
  return null;
}

// ((uid)) or {{[[embed]]: ((uid))}} and nothing else. One hop, resolved by the caller.
export function heavyRefUid(string) {
  const text = String(string ?? "").trim();
  const block = REF_ONLY.exec(text);
  if (block) return block[1];
  const embed = EMBED_ONLY.exec(text);
  if (embed) return embed[1];
  return "";
}

// Title always. count and label only when the caller already has a number (pdf highlights).
// A missing count stays off the poster. No page count is invented here.
export function posterModel(source) {
  const src = source && typeof source === "object" ? source : {};
  const kind = embedKind(src.kind === "youtube" ? "iframe" : src.kind);
  const thumb = posterThumb(src);
  if (kind === "pdf" && (src.count != null || src.label || src.title || src.url)) {
    const cover = coverModel(src);
    const out = { kind: "pdf", title: cover.title, thumb };
    if (typeof src.count === "number" && Number.isFinite(src.count)) {
      out.count = cover.count;
      out.label = cover.label;
    }
    return out;
  }
  const given = typeof src.title === "string" ? src.title.trim() : "";
  const title = given || embedTitle(kind, src.kind === "youtube" ? "youtube" : kind, src.url);
  const out = { kind, title, thumb };
  if (typeof src.count === "number" && Number.isFinite(src.count) && src.count >= 0) {
    out.count = src.count;
    out.label = typeof src.label === "string" && src.label.trim() ? src.label.trim() : String(src.count);
  }
  return out;
}

// Poster for one string. A ref is one blockString hop. Pdf count comes only from `cover`.
export function embedPoster(string, opts = {}) {
  if (postersEnabled(opts) === false) return null;
  const { read, cover, uid = "" } = opts;
  const text = String(string ?? "").trim();
  if (!text) return null;
  let hit = heavyEmbed(text);
  let mountUid = uid || "";
  let source = text;
  if (!hit) {
    const ref = heavyRefUid(text);
    if (!ref || typeof read !== "function") return null;
    let inner = "";
    try { inner = read(ref); } catch { inner = ""; }
    if (typeof inner !== "string") return null;
    hit = heavyEmbed(inner.trim());
    if (!hit) return null;
    mountUid = ref;
    source = inner.trim();
  }
  if (hit.kind === "pdf") {
    let got = null;
    if (typeof cover === "function") {
      try { got = cover(source); } catch { got = null; }
    }
    const carried = got && typeof got === "object" && typeof got.count === "number" && Number.isFinite(got.count);
    const model = posterModel({
      kind: "pdf",
      title: (got && typeof got.title === "string" && got.title.trim()) || hit.title,
      url: hit.url,
      count: carried ? got.count : undefined,
      thumb: got?.thumb,
    });
    return { ...model, uid: mountUid, url: hit.url };
  }
  const model = posterModel({ kind: hit.kind, title: hit.title, url: hit.url });
  return { ...model, uid: mountUid, url: hit.url };
}

// Every heavy embed in a string, plus leftover words. A pure ref contributes no leftover.
export function embedSplit(string, opts = {}) {
  const text = String(string ?? "");
  const macros = [...text.matchAll(new RegExp(HEAVY_MACRO.source, "gi"))].map((m) => m[0]);
  if (macros.length) {
    const posters = macros.map((macro) => embedPoster(macro, opts)).filter(Boolean);
    const rest = text.replace(new RegExp(HEAVY_MACRO.source, "gi"), " ").replace(/\s+/g, " ").trim();
    return { posters, rest };
  }
  const one = embedPoster(text, opts);
  return { posters: one ? [one] : [], rest: "" };
}

export function pdfCardForUrl(url, cards) {
  if (typeof url !== "string" || url === "") return null;
  if (!Array.isArray(cards)) return null;
  for (const card of cards) {
    if (!card || typeof card !== "object") continue;
    if (pdfMacroUrl(card.source) !== url) continue;
    return typeof card.uid === "string" && card.uid !== "" ? card.uid : null;
  }
  return null;
}

export function writeReaderPage(input, page) {
  if (!input || typeof input.dispatchEvent !== "function") return false;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1) return false;
  const text = String(page);
  const ctor = globalThis.HTMLInputElement;
  const proto = typeof ctor === "function" ? Object.getOwnPropertyDescriptor(ctor.prototype, "value") : null;
  if (proto && typeof proto.set === "function") proto.set.call(input, text);
  else input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

// Pane width. localStorage plexus-diagram:read:<graph>, same class of store as the viewport.
export function readPaneKey(graph) {
  return `plexus-diagram:read:${typeof graph === "string" ? graph : ""}`;
}

// Side pane is 42% of the mount, clamped to 360–720. Under 720px of mount width it stacks.
// A missing mount (0) does not stack: the stored width, or 360, stays in range.
export function readPaneWidth(mountWidth, stored) {
  const mount = typeof mountWidth === "number" && Number.isFinite(mountWidth) ? mountWidth : 0;
  const stacked = mount > 0 && mount < 720;
  const given = typeof stored === "number" && Number.isFinite(stored) ? stored : Number(stored);
  const hasStored = Number.isFinite(given) && given > 0;
  if (stacked) return { stacked: true, width: Math.round(mount) };
  const raw = hasStored ? given : (mount > 0 ? Math.round(mount * 0.42) : 360);
  const width = Math.min(720, Math.max(360, Math.round(raw)));
  return { stacked: false, width };
}

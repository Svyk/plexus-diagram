// PDF-1 cover plan. The reader is Roam's. No fetch and no :pdf write.

const PDF_MACRO = "{{[[pdf]]:";

export const PDF_READER_W = 640;
export const PDF_READER_H = 820;

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

export function coverModel(source) {
  const src = source && typeof source === "object" ? source : {};
  const pageTitle = typeof src.title === "string" ? src.title.trim() : "";
  const title = pageTitle || fileName(src.url) || "PDF";
  const count = typeof src.count === "number" && Number.isFinite(src.count) && src.count >= 1 ? src.count : 0;
  const label = count === 1 ? "1 highlight" : `${count} highlights`;
  return { title, count, label };
}

export function readerRule(openUid, nextUid) {
  const current = openUid || null;
  if (nextUid == null || nextUid === "") return { open: current, close: null };
  if (nextUid === current) return { open: current, close: null };
  return { open: nextUid, close: current };
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

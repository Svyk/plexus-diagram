// Dark pages for Roam's own PDF reader (sidebar and main) and an in-card reader.
// Follow Roam uses bp3-dark (and the other Roam dark markers) or a measured background.

import { hostDark } from "./theme-follow.js";

export const PDF_READER_DARK_CLASS = "pxd-pdf-reader-dark";

export function normalizePdfReaderDark(value) {
  const token = String(value ?? "").trim().toLowerCase();
  if (token === "off" || token === "on" || token === "follow") return token;
  return "follow";
}

export function pdfReaderDarkOn(value, doc, background) {
  const token = normalizePdfReaderDark(value);
  if (token === "on") return true;
  if (token === "off") return false;
  return hostDark(doc, background);
}

export function applyPdfReaderDark(doc, on) {
  const root = doc?.documentElement;
  if (!root?.classList?.toggle) return false;
  root.classList.toggle(PDF_READER_DARK_CLASS, Boolean(on));
  return Boolean(on);
}

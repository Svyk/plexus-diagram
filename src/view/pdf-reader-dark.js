// Dark pages for Roam's own PDF reader (sidebar and main). The reader beside the board is left alone.
// Follow Roam uses bp3-dark (and the other Roam dark markers) or a measured background.

import { installPdfPhotoRestore } from "./pdf-photo-restore.js";
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

const photoStops = new WeakMap();

function startPhotos(doc) {
  if (!doc?.body || photoStops.has(doc)) return;
  const stop = installPdfPhotoRestore(doc);
  if (typeof stop === "function") photoStops.set(doc, stop);
}

function stopPhotos(doc) {
  const stop = doc ? photoStops.get(doc) : null;
  if (!stop) return;
  photoStops.delete(doc);
  stop();
}

export function applyPdfReaderDark(doc, on) {
  const root = doc?.documentElement;
  if (!root?.classList?.toggle) return false;
  const next = Boolean(on);
  root.classList.toggle(PDF_READER_DARK_CLASS, next);
  try {
    if (next) startPhotos(doc);
    else stopPhotos(doc);
  } catch { /* a stub document has no body observer */ }
  return next;
}

// Jump a PDF that is already open in Roam's sidebar, and find its page node.
// The parsed overlay is attached by the board; this module does not mount chips.

import { writeReaderPage } from "../model/pdf.js";

const SIDEBARS = ["#right-sidebar", ".rm-right-sidebar", ".rm-sidebar-window"];

export function sidebarPdfContainer(doc) {
  if (!doc || typeof doc.querySelectorAll !== "function") return null;
  for (const sel of SIDEBARS) {
    let roots = [];
    try { roots = [...doc.querySelectorAll(sel)]; } catch { roots = []; }
    for (const root of roots) {
      const box = root.querySelector?.(".rm-pdf-container") || null;
      if (box) return box;
    }
  }
  return null;
}

function readerField(box) {
  const bar = box?.querySelector?.(".rm-pdf-toolbar");
  const pool = bar?.querySelectorAll ? [...bar.querySelectorAll("input")] : [];
  const inputs = pool.length ? pool : [...(box?.querySelectorAll?.("input") || [])];
  const named = inputs.find((node) => node.classList?.contains?.("bp3-input") && /^\d+$/.test(String(node.value || "").trim()));
  if (named) return named;
  return inputs.find((node) => /^\d+$/.test(String(node.value || "").trim())) || inputs[0] || null;
}

export function jumpSidebarPdf(doc, page) {
  const box = sidebarPdfContainer(doc);
  if (!box) return false;
  return writeReaderPage(readerField(box), page);
}

export function sidebarPageEl(box, n) {
  if (!box?.querySelector) return null;
  const want = String(n);
  return box.querySelector(`.page[data-page-number="${want}"]`) || null;
}

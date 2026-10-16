// R4. <html class="pxd-sidebar-pdf"> while Roam's right sidebar holds a PDF. It replaces a .roam-app:has() rule: a
// :has() anchor above the board re-ran its style invalidation on every DOM change inside the board.

export const SIDEBAR_PDF_CLASS = "pxd-sidebar-pdf";
const PDF = ".rm-pdf-container";

// #right-sidebar by id and .rm-right-sidebar by class: both indexed lookups, no document walk.
const sidebars = (doc) => {
  const out = [];
  const byId = doc?.getElementById?.("right-sidebar");
  if (byId) out.push(byId);
  for (const el of doc?.getElementsByClassName?.("rm-right-sidebar") || []) if (el !== byId) out.push(el);
  return out;
};
const isSidebar = (node) => node?.id === "right-sidebar" || Boolean(node?.classList?.contains?.("rm-right-sidebar"));
const holdsPdf = (node) => Boolean(node?.matches?.(PDF) || node?.querySelector?.(PDF));

// True when these MutationRecords may have changed whether the sidebar holds a PDF. A record inside the board
// costs one contains() per sidebar.
export function sidebarPdfDirty(records, marked, doc = globalThis.document) {
  const bars = sidebars(doc);
  for (const record of records || []) {
    const target = record.target;
    if (bars.some((bar) => bar === target || bar.contains?.(target))) return true;
    for (const node of record.addedNodes || []) {
      if (node.nodeType === 1 && (isSidebar(node) || (bars.length && bars.some((bar) => node.contains?.(bar))))) return true;
    }
    if (!marked) continue;
    for (const node of record.removedNodes || []) {
      if (node.nodeType === 1 && (isSidebar(node) || holdsPdf(node))) return true;
    }
  }
  return false;
}

export function syncSidebarPdf(doc) {
  const html = doc?.documentElement;
  if (!html?.classList) return false;
  const on = sidebars(doc).some(holdsPdf);
  if (html.classList.contains(SIDEBAR_PDF_CLASS) !== on) html.classList.toggle(SIDEBAR_PDF_CLASS, on);
  return on;
}

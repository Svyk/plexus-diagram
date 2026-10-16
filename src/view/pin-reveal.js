// Jump a PDF that is already open in Roam's sidebar, and find its page node.
// The parsed overlay is attached by the board; this module does not mount chips.

import { pdfMacroUrl, writeReaderPage } from "../model/pdf.js";

const SIDEBARS = ["#right-sidebar", ".rm-right-sidebar", ".rm-sidebar-window"];
export const SIDEBAR_WAIT_MS = 5000;

function sidebarRoots(doc) {
  if (!doc || typeof doc.querySelectorAll !== "function") return [];
  const roots = [];
  for (const sel of SIDEBARS) {
    let found = [];
    try { found = [...doc.querySelectorAll(sel)]; } catch { found = []; }
    for (const root of found) if (root && !roots.includes(root)) roots.push(root);
  }
  return roots;
}

function sidebarPdfBoxes(doc) {
  const out = [];
  for (const root of sidebarRoots(doc)) {
    const boxes = root.querySelectorAll?.(".rm-pdf-container") || [];
    for (const box of boxes) {
      if (!box || out.includes(box) || box.closest?.(".pxd-read") || box.closest?.(".pxd-root")) continue;
      out.push(box);
    }
  }
  return out;
}

function uidFromWindow(box) {
  const win = box?.closest?.(".rm-sidebar-window");
  const id = String(win?.id || "");
  const mark = "sidebar-block-";
  const at = id.lastIndexOf(mark);
  if (at < 0) return "";
  return id.slice(at + mark.length).split(/[^\w-]/)[0] || "";
}

// The sidebar block's uid (window id or data-block-uid) and the PDF url when one is readable.
export function sidebarPdfTarget(box, readString) {
  const marked = box?.closest?.("[data-block-uid]")?.getAttribute?.("data-block-uid")
    || box?.getAttribute?.("data-block-uid")
    || "";
  const uid = String(marked || uidFromWindow(box) || "").trim();
  const stamped = String(box?.getAttribute?.("data-pdf-url") || box?.closest?.("[data-pdf-url]")?.getAttribute?.("data-pdf-url") || "").trim();
  let url = stamped;
  if (!url && uid && typeof readString === "function") {
    try { url = pdfMacroUrl(readString(uid) || "") || ""; } catch { url = ""; }
  }
  return { uid, url };
}

// True when the uid matches, or when the urls match. A wanted PDF with nothing to compare against is not a match.
export function pdfTargetsMatch(found, want) {
  const wantUid = String(want?.uid || "").trim();
  const wantUrl = String(want?.url || "").trim();
  if (!wantUid && !wantUrl) return false;
  const foundUid = String(found?.uid || "").trim();
  const foundUrl = String(found?.url || "").trim();
  if (wantUid && foundUid && wantUid === foundUid) return true;
  if (wantUrl && foundUrl && wantUrl === foundUrl) return true;
  return false;
}

export function sidebarPdfContainer(doc, want, readString) {
  const boxes = sidebarPdfBoxes(doc);
  if (!want || (!String(want.uid || "").trim() && !String(want.url || "").trim())) return boxes[0] || null;
  return boxes.find((box) => pdfTargetsMatch(sidebarPdfTarget(box, readString), want)) || null;
}

function readerField(box) {
  const bar = box?.querySelector?.(".rm-pdf-toolbar");
  const pool = bar?.querySelectorAll ? [...bar.querySelectorAll("input")] : [];
  const inputs = pool.length ? pool : [...(box?.querySelectorAll?.("input") || [])];
  const named = inputs.find((node) => node.classList?.contains?.("bp3-input") && /^\d+$/.test(String(node.value || "").trim()));
  if (named) return named;
  return inputs.find((node) => /^\d+$/.test(String(node.value || "").trim())) || inputs[0] || null;
}

export function jumpSidebarPdf(doc, page, want, readString) {
  if (!want || (!String(want.uid || "").trim() && !String(want.url || "").trim())) return false;
  const box = sidebarPdfContainer(doc, want, readString);
  if (!box) return false;
  return writeReaderPage(readerField(box), page);
}

export function sidebarPageEl(box, n) {
  if (!box?.querySelector) return null;
  const want = String(n);
  return box.querySelector(`.page[data-page-number="${want}"]`) || null;
}

// Poll until the sidebar shows this PDF. An immediate hit does not sleep. `now` must move, or the step cap stops the wait.
export async function waitForSidebarPdf({ doc, want, readString, timeout = SIDEBAR_WAIT_MS, step = 50, now = () => Date.now(), sleep, alive } = {}) {
  const start = typeof now === "function" ? now() : Date.now();
  const clock = typeof now === "function" ? now : () => Date.now();
  const found = () => sidebarPdfContainer(doc, want, readString);
  if (!want || (!String(want.uid || "").trim() && !String(want.url || "").trim())) return null;
  const immediate = found();
  if (immediate) return immediate;
  if (typeof sleep !== "function") return null;
  const pace = Math.max(1, Number(step) || 50);
  const cap = Math.max(1, Math.ceil((Number(timeout) || 0) / pace) + 1);
  for (let i = 0; i < cap; i += 1) {
    const elapsed = clock() - start;
    if (elapsed >= timeout) break;
    if (typeof alive === "function" && !alive()) return null;
    await sleep(Math.min(pace, timeout - elapsed));
    if (typeof alive === "function" && !alive()) return null;
    const box = found();
    if (box) return box;
  }
  return null;
}

// Fire once when `node` leaves the document. The returned function disconnects the observer.
export function watchNodeGone(node, doc, onGone) {
  if (!node || typeof onGone !== "function") return () => {};
  if (node.isConnected === false) {
    onGone();
    return () => {};
  }
  const Obs = doc?.defaultView?.MutationObserver || globalThis.MutationObserver;
  const root = doc?.body || doc?.documentElement;
  if (typeof Obs !== "function" || !root) return () => {};
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { obs.disconnect(); } catch { /* already gone */ }
  };
  const obs = new Obs(() => {
    if (stopped || node.isConnected !== false) return;
    stop();
    onGone();
  });
  try { obs.observe(root, { childList: true, subtree: true }); } catch { return () => {}; }
  return stop;
}

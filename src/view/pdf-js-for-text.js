// The pdf.js Roam already loaded, for the PDF text index. A worker is preferred. A lib whose
// getDocument is there but whose worker is not yet set is still usable: Roam often exposes
// pdfjsLib before any PDF has been viewed. Plexus never assigns a worker.

import { detectPdfjs } from "./pdf-first-page.js";

function frameWindows(doc) {
  let nodes = [];
  try { nodes = [...(doc?.querySelectorAll?.("iframe") || [])]; } catch { nodes = []; }
  const out = [];
  for (const node of nodes) {
    try {
      const win = node?.contentWindow;
      if (win) out.push(win);
    } catch { /* a cross-origin frame has no lib we can read */ }
  }
  return out;
}

// Worker-ready lib first (this window, then a reader frame). Then any lib with getDocument.
export function pdfJsForText(win, doc) {
  const scopes = [win, ...frameWindows(doc)];
  const found = [];
  for (const scope of scopes) {
    let one = null;
    try { one = detectPdfjs(scope); } catch { one = null; }
    if (one?.lib) found.push(one);
  }
  return found.find((one) => one.workerReady) || found[0] || null;
}

// Null drops the job. `{ retry: true }` means pdf.js is not ready yet: try again later.
// A worker that is ready and still cannot open the file is a bad file, not a missing lib.
export async function openPdfForText({ disposed = false, url, allow, found, open } = {}) {
  if (disposed) return null;
  if (typeof allow === "function" && !allow(url)) return null;
  const lib = found?.lib;
  if (!lib || typeof lib.getDocument !== "function") return { retry: true };
  let handle = null;
  try { handle = await open(lib, url); } catch { handle = null; }
  if (handle) return handle;
  return found.workerReady ? null : { retry: true };
}

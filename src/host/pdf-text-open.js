// Open one PDF with the pdf.js Roam already loaded, and decide which files still need that read.
// The caller supplies `allow` (encrypted and non-http urls stay out). Nothing here imports the parser.

import { pageFromTextContent } from "../model/pdf-text-search.js";
import { sha256Hex } from "../model/parse-hash.js";

// Parsed part rows already cover their file. Figures do not. `allow` drops what pdf.js must not fetch.
export function unparsedPdfJobs(rows, blocks, allow = () => true) {
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.kind === "figure") continue;
    if (row.url) seen.add(row.url);
  }
  const jobs = [];
  const queued = new Set();
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const url = String(block?.url || "");
    if (!url || seen.has(url) || queued.has(url) || !allow(url)) continue;
    queued.add(url);
    jobs.push({ url, pdfUid: block.uid || "", title: block.pageTitle || "" });
  }
  return jobs;
}

async function destroyPdf(pdf, task) {
  try { await pdf?.destroy?.(); } catch { /* gone */ }
  try { await task?.destroy?.(); } catch { /* gone */ }
}

// { hash, pageCount, readPage(n), close() }. Null when pdf.js cannot open the file.
export async function openPdfDocument(lib, url, { allow = () => true } = {}) {
  if (!allow(url) || !lib || typeof lib.getDocument !== "function") return null;
  let task = null;
  let pdf = null;
  try {
    task = lib.getDocument({ url, isEvalSupported: false, verbosity: 0 });
    pdf = await (task?.promise ?? task);
    if (!pdf || typeof pdf.getPage !== "function" || !(pdf.numPages > 0)) {
      await destroyPdf(pdf, task);
      return null;
    }
    const hash = await sha256Hex(String(url));
    let closed = false;
    return {
      hash,
      pageCount: pdf.numPages,
      async readPage(n) {
        const page = await pdf.getPage(n);
        let content = null;
        try { content = await page.getTextContent(); } catch { content = null; }
        const view = typeof page.getViewport === "function" ? page.getViewport({ scale: 1 }) : null;
        const built = pageFromTextContent({
          n,
          width: view?.width || 0,
          height: view?.height || 0,
          items: content?.items || [],
        });
        try { page.cleanup?.(); } catch { /* gone */ }
        return built;
      },
      async close() {
        if (closed) return;
        closed = true;
        await destroyPdf(pdf, task);
      },
    };
  } catch {
    await destroyPdf(pdf, task);
    return null;
  }
}
